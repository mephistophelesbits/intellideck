import { NextRequest, NextResponse } from 'next/server';
import { generateText, type AIProvider } from '@/lib/ai/providers';
import { getTodayPriorityFeed } from '@/lib/server/articles-repository';
import { getBriefingContextPack } from '@/lib/server/articles-repository';
import { getLatestTodaySummary, saveBriefing } from '@/lib/server/briefings-repository';
import { getPersistedSettings } from '@/lib/server/settings-repository';
import { getDefaultSettingsSnapshot } from '@/lib/settings-store';

const SUMMARY_INTERVAL_MS = 12 * 60 * 60 * 1000;
const MAX_SUMMARY_STORIES = 14;

type PrioritySummaryItem = {
  id: string;
  url: string;
  title: string;
  sourceTitle: string | null;
  category: string | null;
  tags?: string[];
  summary: string | null;
  content: string | null;
  publishedAt: string | null;
  updatedAt: string;
};

function isFreshSummary() {
  const latest = getLatestTodaySummary();
  if (!latest) return null;
  if (!latest.executiveSummary.trim()) return null;

  const generatedAt = Date.parse(latest.briefingDate || latest.createdAt);
  if (!Number.isFinite(generatedAt)) return null;

  return Date.now() - generatedAt < SUMMARY_INTERVAL_MS ? latest : null;
}

function stripThinkingProcess(text: string) {
  return text
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/```(?:thinking|reasoning|thoughts)[\s\S]*?```/gi, '')
    .replace(/^\s*(?:thinking|reasoning|thought process|chain of thought)\s*:\s*[\s\S]*$/gim, '')
    .replace(/^\s*(?:Here(?:'|’)s my reasoning|I(?:'|’)ll reason through this|Let me think)[\s\S]*$/gim, '')
    .trim();
}

function oneParagraph(text: string) {
  const cleaned = stripThinkingProcess(text)
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*[-*]\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim();

  return cleaned.split(/\n\s*\n/)[0]?.trim() || cleaned;
}

function fallbackPriorityItems(): PrioritySummaryItem[] {
  return getTodayPriorityFeed(MAX_SUMMARY_STORIES, 2).map((item) => ({
    id: item.id,
    url: item.url,
    title: item.title,
    sourceTitle: item.sourceTitle,
    category: item.category,
    tags: item.tags,
    summary: item.summary,
    content: item.content,
    publishedAt: item.publishedAt,
    updatedAt: item.updatedAt,
  }));
}

function buildFallbackSummary(items: PrioritySummaryItem[], locale: string) {
  const sources = Array.from(new Set(items.slice(0, 6).map((item) => item.sourceTitle).filter(Boolean)));
  const tags = Array.from(new Set(items.flatMap((item) => item.tags ?? []))).slice(0, 6);

  if (locale === 'zh-CN') {
    return `优先信息流目前集中在${tags.slice(0, 4).join('、') || '主要时事'}等主题，主要来源包括${sources.slice(0, 3).join('、') || '多个来源'}。当前最重要的信号是政策、地缘政治、技术与安全动态正在相互影响，值得持续跟踪是否出现新的升级、政策转向或市场影响。`;
  }

  return `The Priority feed is focused on ${tags.slice(0, 4).join(', ') || 'major current-affairs developments'}, drawing mainly from ${sources.slice(0, 3).join(', ') || 'multiple sources'}. The main signal is that policy, geopolitics, technology, and security developments are intersecting right now, so the next useful watchpoints are escalation, policy shifts, and market or operational impact.`;
}

function buildSummaryPrompt(items: PrioritySummaryItem[], locale: string) {
  const topStories = items.slice(0, MAX_SUMMARY_STORIES);
  const contextPack = getBriefingContextPack(topStories.map((item) => item.id), 2);

  const storiesText = topStories
    .map((item, index) => `${index + 1}. ${item.title}
Source: ${item.sourceTitle || 'Unknown Source'}
Category: ${item.category || 'General'}
Tags: ${(item.tags ?? []).slice(0, 6).join(', ') || 'none'}
Published: ${item.publishedAt || item.updatedAt}
Summary: ${item.summary || item.content?.slice(0, 500) || 'No summary available'}`)
    .join('\n\n');

  const signalText = [
    `Dominant entities: ${contextPack.dominantEntities.slice(0, 8).map((entity) => entity.name).join(', ') || 'none'}`,
    `Dominant themes: ${contextPack.dominantThemes.slice(0, 8).map((theme) => theme.name).join(', ') || 'none'}`,
    `Dominant locations: ${contextPack.dominantLocations.slice(0, 8).map((location) => location.name).join(', ') || 'none'}`,
  ].join('\n');

  const languageInstruction = locale === 'zh-CN'
    ? 'Write in Simplified Chinese.'
    : 'Write in English.';

  return `You are IntelliDeck's news editor. Summarize ONLY the Priority Feed below.

Rules:
- Return exactly one paragraph.
- 80-130 words.
- Focus on the main current-affairs picture and why it matters.
- Do not include headings, bullets, markdown, thinking, reasoning, or process notes.
- ${languageInstruction}

Priority Feed:
${storiesText}

Cross-story signals:
${signalText}`;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const force = Boolean(body.force);
    const freshSummary = force ? null : isFreshSummary();
    if (freshSummary) {
      return NextResponse.json({ ...freshSummary, reused: true });
    }

    const settings = getPersistedSettings(getDefaultSettingsSnapshot());
    const aiSettings = body.aiSettings || settings.aiSettings;
    const locale = body.locale || settings.aiSettings.language || 'en';
    const priorityItems = Array.isArray(body.priorityItems) && body.priorityItems.length > 0
      ? body.priorityItems.slice(0, MAX_SUMMARY_STORIES) as PrioritySummaryItem[]
      : fallbackPriorityItems();

    if (priorityItems.length === 0) {
      return NextResponse.json({ error: 'No priority feed items available for summary generation' }, { status: 400 });
    }

    const now = new Date();
    const provider = (aiSettings.provider || 'ollama') as AIProvider;
    let summaryText = '';

    try {
      const result = await generateText(provider, buildSummaryPrompt(priorityItems, locale), {
        apiKey: aiSettings.apiKeys?.[provider] || aiSettings.apiKey,
        baseUrl: aiSettings.ollamaUrl,
        model: aiSettings.model || 'llama3.2',
        temperature: 0.15,
        maxTokens: 260,
      });
      summaryText = oneParagraph(result.text);
    } catch (error) {
      console.warn('Today summary AI generation failed; using fallback summary:', error);
    }

    summaryText ||= buildFallbackSummary(priorityItems, locale);

    const summary = saveBriefing({
      briefingDate: now.toISOString(),
      title: locale === 'zh-CN'
        ? `今日摘要 ${now.toLocaleDateString()}`
        : `Summary ${now.toLocaleDateString()}`,
      executiveSummary: summaryText,
      keyThemes: Array.from(new Set(priorityItems.flatMap((item) => item.tags ?? []))).slice(0, 6),
      topStories: priorityItems.slice(0, 8).map((item) => ({
        articleId: item.id,
        title: item.title,
        url: item.url,
        sourceTitle: item.sourceTitle,
        category: item.category,
      })),
      modelProvider: provider,
      modelName: aiSettings.model || 'llama3.2',
    });

    return NextResponse.json(summary);
  } catch (error: unknown) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to generate summary' },
      { status: 500 }
    );
  }
}
