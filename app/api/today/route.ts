import { NextResponse } from 'next/server';
import { getTodayPriorityFeed, getIntelligenceOverview, updateArticleFullContent } from '@/lib/server/articles-repository';
import { getLatestTodaySummary } from '@/lib/server/briefings-repository';
import { scrapeArticle, type ScrapedArticle } from '@/lib/server/article-scraper';
import { generateText, type AIProvider } from '@/lib/ai/providers';
import { getDefaultSettingsSnapshot } from '@/lib/settings-store';
import { getPersistedSettings } from '@/lib/server/settings-repository';
import { getPreferenceStateSignature, recordPriorityFeedImpressions } from '@/lib/server/preferences-repository';

type PriorityItem = ReturnType<typeof getTodayPriorityFeed>[number];

type CuratedSelection = {
  index: number;
  action: 'include' | 'exclude';
  score: number;
  urgency?: 'urgent' | 'important' | 'watch';
  reason: string;
};

const OLLAMA_CURATION_TIMEOUT_MS = 25_000;
const CLOUD_CURATION_TIMEOUT_MS = 45_000;
const FULL_ARTICLE_CONCURRENCY = 3;
const MIN_FULL_ARTICLE_TEXT_LENGTH = 800;
const MIN_SCRAPED_TEXT_LENGTH = 200;
const MIN_AI_CURATED_ITEMS = 12;
const MAX_TODAY_ITEMS = 18;
const FRESH_ITEM_ANCHOR_COUNT = 6;

type TodayPayload = {
  latestBriefing: ReturnType<typeof getLatestTodaySummary>;
  priorityItems: PriorityItem[];
  curation: {
    mode: 'ai' | 'deterministic';
    provider?: string;
    model?: string;
    candidateCount?: number;
    selectedCount?: number;
    error: string | null;
    refreshing?: boolean;
    generatedAt?: string;
  };
  topTags: Array<{ tag: string; count: number }>;
  sourceHealth: ReturnType<typeof getIntelligenceOverview>['feedHealth'];
  lastIngestedAt: string | null;
  topMovers: ReturnType<typeof getIntelligenceOverview>['topMovers'];
};

let todayCache: { signature: string; createdAt: number; payload: TodayPayload } | null = null;
let revalidationSignature: string | null = null;
let revalidationPromise: Promise<void> | null = null;

function withTimeout<T>(promise: Promise<T>, timeoutMs: number) {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error('AI curation timed out')), timeoutMs);
    }),
  ]);
}

function truncateText(text: string | null, length = 180) {
  if (!text) return '';
  return text.length > length ? `${text.slice(0, length)}...` : text;
}

function extractJsonArray(text: string) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const candidate = fenced || text;

  for (let start = candidate.indexOf('['); start !== -1; start = candidate.indexOf('[', start + 1)) {
    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let index = start; index < candidate.length; index += 1) {
      const char = candidate[index];

      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (char === '\\') {
          escaped = true;
        } else if (char === '"') {
          inString = false;
        }
        continue;
      }

      if (char === '"') {
        inString = true;
      } else if (char === '[') {
        depth += 1;
      } else if (char === ']') {
        depth -= 1;
        if (depth === 0) {
          try {
            return JSON.parse(candidate.slice(start, index + 1));
          } catch {
            break;
          }
        }
      }
    }
  }

  const objectStart = candidate.indexOf('{');
  const objectEnd = candidate.lastIndexOf('}');
  if (objectStart === -1 || objectEnd === -1 || objectEnd <= objectStart) {
    throw new Error('AI response did not include a JSON array');
  }

  const parsed = JSON.parse(candidate.slice(objectStart, objectEnd + 1));
  if (Array.isArray(parsed?.items)) return parsed.items;
  if (Array.isArray(parsed?.selections)) return parsed.selections;
  if (Array.isArray(parsed?.stories)) return parsed.stories;

  throw new Error('AI response did not include a JSON array');
}

function buildCurationPrompt(items: PriorityItem[]) {
  const candidates = items.map((item, index) => [
    index,
    item.title,
    item.sourceTitle || 'Unknown Source',
    item.category || 'General',
    item.tags.slice(0, 5),
    Math.round(item.priorityScore),
    item.urgency,
    truncateText(item.summary),
  ]);

  return `You are IntelliDeck's local news editor. Select stories for the user's Today feed.

Prioritize:
- high impact AI, semiconductors, software, cloud, cybersecurity, startups, public tech companies, markets, and tech business
- China/USA policy only when it affects technology, trade, chips, AI, markets, or business operations
- fresh concrete developments
- include the newest concrete developments unless they are duplicates or noise
- source diversity
- reject duplicates, promotions, weak commentary, and generic elections/military/geopolitics unless they have direct tech/business impact

Return ONLY JSON array, no markdown. Include 12-18 objects:
[{"index":0,"action":"include","score":0-100,"urgency":"urgent|important|watch"}]

Candidates are [index,title,source,category,tags,score,urgency,summary]:
${JSON.stringify(candidates, null, 2)}`;
}

function stripHtml(value: string) {
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function hasFullEnoughContent(item: PriorityItem) {
  return stripHtml(item.content || '').length >= MIN_FULL_ARTICLE_TEXT_LENGTH;
}

function isScrapableArticleUrl(url: string) {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, '');
    return (
      ['http:', 'https:'].includes(parsed.protocol) &&
      host !== 'twitter.com' &&
      host !== 'x.com'
    );
  } catch {
    return false;
  }
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T) => Promise<R>
) {
  const results: R[] = [];
  let nextIndex = 0;

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(items[index]);
    }
  }));

  return results;
}

async function downloadFullArticlesForPriorityFeed(items: PriorityItem[]) {
  const targets = items.filter((item) => !hasFullEnoughContent(item) && isScrapableArticleUrl(item.url));
  if (targets.length === 0) return items;

  const downloaded = await mapWithConcurrency(targets, FULL_ARTICLE_CONCURRENCY, async (item) => {
    try {
      const scraped = await scrapeArticle(item.url);
      if (scraped.textContent.length < MIN_SCRAPED_TEXT_LENGTH) return null;

      updateArticleFullContent(item.id, scraped);
      return { itemId: item.id, scraped };
    } catch (error) {
      console.warn('Priority feed article download failed:', item.url, error);
      return null;
    }
  });

  const scrapedById = new Map<string, ScrapedArticle>();
  for (const result of downloaded) {
    if (result) scrapedById.set(result.itemId, result.scraped);
  }

  return items.map((item) => {
    const scraped = scrapedById.get(item.id);
    if (!scraped) return item;

    return {
      ...item,
      author: item.author || scraped.byline,
      summary: item.summary || scraped.excerpt || scraped.textContent.slice(0, 300),
      content: scraped.content || item.content,
    };
  });
}

function buildTodaySignature(
  candidateItems: PriorityItem[],
  curationSettings: string
) {
  return JSON.stringify({
    curationSettings,
    candidates: candidateItems.map((item) => [
      item.id,
      item.publishedAt || item.updatedAt,
      Math.round(item.priorityScore),
    ]),
  });
}

function getCurationSettingsSignature() {
  const settings = getPersistedSettings(getDefaultSettingsSnapshot());
  const provider = settings.aiSettings.provider || 'ollama';

  return JSON.stringify({
    policyVersion: 4,
    enabled: settings.aiSettings.enabled,
    provider,
    model: settings.aiSettings.model || null,
    ollamaUrl: provider === 'ollama' ? settings.aiSettings.ollamaUrl : null,
    hasApiKey: Boolean(settings.aiSettings.apiKeys?.[provider]),
    preferenceState: getPreferenceStateSignature(),
  });
}

function buildTodayPayload(input: {
  latestBriefing: ReturnType<typeof getLatestTodaySummary>;
  overview: ReturnType<typeof getIntelligenceOverview>;
  priorityItems: PriorityItem[];
  curation: TodayPayload['curation'];
}): TodayPayload {
  const tagCounts = new Map<string, number>();

  for (const item of input.priorityItems) {
    for (const tag of item.tags) {
      tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
    }
  }

  return {
    latestBriefing: input.latestBriefing,
    priorityItems: input.priorityItems,
    curation: {
      ...input.curation,
      generatedAt: new Date().toISOString(),
    },
    topTags: Array.from(tagCounts.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 12)
      .map(([tag, count]) => ({ tag, count })),
    sourceHealth: input.overview.feedHealth,
    lastIngestedAt: input.overview.totals.lastIngestedAt,
    topMovers: input.overview.topMovers,
  };
}

function scheduleFullArticleDownloads(signature: string, items: PriorityItem[]) {
  void downloadFullArticlesForPriorityFeed(items).then((hydratedItems) => {
    if (!todayCache || todayCache.signature !== signature) return;
    todayCache = {
      ...todayCache,
      payload: {
        ...todayCache.payload,
        priorityItems: hydratedItems,
      },
    };
  });
}

async function buildFreshTodayPayload(input: {
  signature: string;
  latestBriefing: ReturnType<typeof getLatestTodaySummary>;
  overview: ReturnType<typeof getIntelligenceOverview>;
  candidateItems: PriorityItem[];
}) {
  const curation = await curateWithAI(input.candidateItems);
  const payload = buildTodayPayload({
    latestBriefing: input.latestBriefing,
    overview: input.overview,
    priorityItems: curation.items,
    curation: curation.meta,
  });

  todayCache = {
    signature: input.signature,
    createdAt: Date.now(),
    payload,
  };
  recordPriorityFeedImpressions(curation.items);
  scheduleFullArticleDownloads(input.signature, curation.items);
  return payload;
}

function scheduleRevalidation(input: {
  signature: string;
  latestBriefing: ReturnType<typeof getLatestTodaySummary>;
  overview: ReturnType<typeof getIntelligenceOverview>;
  candidateItems: PriorityItem[];
}) {
  if (revalidationPromise && revalidationSignature === input.signature) return;

  revalidationSignature = input.signature;
  revalidationPromise = buildFreshTodayPayload(input)
    .then(() => undefined)
    .catch((error) => {
      console.warn('Today feed revalidation failed:', error);
    })
    .finally(() => {
      revalidationSignature = null;
      revalidationPromise = null;
    });
}

function buildProvisionalTodayPayload(input: {
  signature: string;
  latestBriefing: ReturnType<typeof getLatestTodaySummary>;
  overview: ReturnType<typeof getIntelligenceOverview>;
  candidateItems: PriorityItem[];
}) {
  const priorityItems = input.candidateItems.slice(0, 18);
  const payload = buildTodayPayload({
    latestBriefing: input.latestBriefing,
    overview: input.overview,
    priorityItems,
    curation: {
      mode: 'deterministic' as const,
      candidateCount: input.candidateItems.length,
      selectedCount: priorityItems.length,
      error: null,
    },
  });

  todayCache = {
    signature: input.signature,
    createdAt: Date.now(),
    payload,
  };
  recordPriorityFeedImpressions(priorityItems);

  return payload;
}

function sortByDisplayDateDesc(a: PriorityItem, b: PriorityItem) {
  return new Date(b.publishedAt || b.updatedAt).getTime() - new Date(a.publishedAt || a.updatedAt).getTime();
}

function uniquePriorityItems(items: PriorityItem[]) {
  const seen = new Set<string>();
  const unique: PriorityItem[] = [];

  for (const item of items) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    unique.push(item);
  }

  return unique;
}

function normalizeSelection(selection: unknown, maxIndex: number): CuratedSelection | null {
  if (!selection || typeof selection !== 'object') return null;
  const data = selection as Partial<CuratedSelection>;
  if (typeof data.index !== 'number' || data.index < 0 || data.index > maxIndex) return null;
  if (data.action !== 'include' && data.action !== 'exclude') return null;
  const score = typeof data.score === 'number' ? data.score : 50;
  const urgency = data.urgency === 'urgent' || data.urgency === 'important' || data.urgency === 'watch'
    ? data.urgency
    : 'watch';

  return {
    index: data.index,
    action: data.action,
    score: Math.max(0, Math.min(100, score)),
    urgency,
    reason: typeof data.reason === 'string' && data.reason.trim()
      ? data.reason.trim().slice(0, 140)
      : 'Selected by local AI editor',
  };
}

async function curateWithAI(items: PriorityItem[]) {
  const settings = getPersistedSettings(getDefaultSettingsSnapshot());
  if (!settings.aiSettings.enabled || items.length === 0) {
    return {
      items: items.slice(0, 18),
      meta: { mode: 'deterministic' as const, error: null as string | null },
    };
  }

  try {
    const provider = settings.aiSettings.provider || 'ollama';
    const timeoutMs = provider === 'ollama' ? OLLAMA_CURATION_TIMEOUT_MS : CLOUD_CURATION_TIMEOUT_MS;
    const result = await withTimeout(
      generateText(provider as AIProvider, buildCurationPrompt(items), {
        apiKey: settings.aiSettings.apiKeys?.[provider] || undefined,
        baseUrl: settings.aiSettings.ollamaUrl,
        model: settings.aiSettings.model || 'llama3.2',
        temperature: 0.1,
        maxTokens: 1400,
      }),
      timeoutMs
    );
    const parsed = extractJsonArray(result.text);
    if (!Array.isArray(parsed)) {
      throw new Error('AI curation did not return an array');
    }

    const selections = parsed
      .map((selection) => normalizeSelection(selection, items.length - 1))
      .filter((selection): selection is CuratedSelection => Boolean(selection))
      .filter((selection) => selection.action === 'include')
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_TODAY_ITEMS);

    if (selections.length === 0) {
      throw new Error('AI curation returned no included stories');
    }

    const selectedIndexes = new Set(selections.map((selection) => selection.index));
    const selectedItems = selections
      .map((selection) => {
        const item = items[selection.index];
        return {
          ...item,
          aiScore: selection.score,
          curationReason: selection.reason,
          urgency: selection.urgency || item.urgency,
          reasons: Array.from(new Set([selection.reason, ...item.reasons])).slice(0, 3),
        };
      });
    const freshAnchors = [...items]
      .sort(sortByDisplayDateDesc)
      .slice(0, FRESH_ITEM_ANCHOR_COUNT);
    const fillItems = items
      .filter((_, index) => !selectedIndexes.has(index))
      .sort((a, b) => b.priorityScore - a.priorityScore)
      .slice(0, Math.max(0, MIN_AI_CURATED_ITEMS - selectedItems.length));
    const finalItems = uniquePriorityItems([...freshAnchors, ...selectedItems, ...fillItems])
      .slice(0, MAX_TODAY_ITEMS)
      .sort(sortByDisplayDateDesc);

    return {
      items: finalItems,
      meta: {
        mode: 'ai' as const,
        provider,
        model: settings.aiSettings.model || 'llama3.2',
        candidateCount: items.length,
        selectedCount: finalItems.length,
        error: null as string | null,
      },
    };
  } catch (error) {
    return {
      items: items.slice(0, 18),
      meta: {
        mode: 'deterministic' as const,
        error: error instanceof Error ? error.message : 'AI curation failed',
      },
    };
  }
}

export async function GET() {
  const latestBriefing = getLatestTodaySummary();
  const overview = getIntelligenceOverview(2);
  const candidateItems = getTodayPriorityFeed(40, 2);
  const curationSettings = getCurationSettingsSignature();
  const signature = buildTodaySignature(candidateItems, curationSettings);

  if (todayCache?.signature === signature) {
    const payload = {
      ...todayCache.payload,
      latestBriefing,
    };
    todayCache = {
      ...todayCache,
      payload,
    };

    return NextResponse.json({
      ...payload,
      curation: {
        ...payload.curation,
        refreshing: revalidationSignature === signature,
      },
    });
  }

  if (todayCache) {
    const payload = buildProvisionalTodayPayload({
      signature,
      latestBriefing,
      overview,
      candidateItems,
    });
    scheduleRevalidation({ signature, latestBriefing, overview, candidateItems });
    return NextResponse.json({
      ...payload,
      curation: {
        ...payload.curation,
        refreshing: true,
      },
    });
  }

  const payload = buildProvisionalTodayPayload({
    signature,
    latestBriefing,
    overview,
    candidateItems,
  });
  scheduleRevalidation({ signature, latestBriefing, overview, candidateItems });

  return NextResponse.json({
    ...payload,
    curation: {
      ...payload.curation,
      refreshing: true,
    },
  });
}
