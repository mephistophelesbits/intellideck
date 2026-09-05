# Ollama Local LLM Optimization — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix Ollama integration so article summarize streams tokens in real-time, priority feed curation doesn't silently fail from context truncation, and all Ollama requests include a correctly-sized `num_ctx`.

**Architecture:** Add a thin `ollama-utils.ts` module that computes `num_ctx` from actual prompt size and truncates inputs. Update the summarize route to stream NDJSON from Ollama and forward as SSE. Update curation to cap candidates and compact the prompt for local models.

**Tech Stack:** Next.js App Router (Response with ReadableStream for SSE), Ollama `/api/generate` streaming NDJSON, Zustand, React fetch + ReadableStream

---

### Task 1: Create `lib/ai/ollama-utils.ts`

**Files:**
- Create: `lib/ai/ollama-utils.ts`

- [ ] **Step 1: Create the file**

```typescript
// lib/ai/ollama-utils.ts

/** Rough token estimate: ~3.5 chars per token for English/mixed text */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.5);
}

/**
 * Compute num_ctx for an Ollama request.
 * Takes the full prompt text, estimates tokens, adds 20% headroom for output,
 * rounds up to nearest 512, clamps between 2048 and 8192.
 */
export function computeNumCtx(promptText: string): number {
  const estimated = estimateTokens(promptText);
  const withHeadroom = Math.ceil(estimated * 1.2);
  const rounded = Math.ceil(withHeadroom / 512) * 512;
  return Math.max(2048, Math.min(8192, rounded));
}

/**
 * Truncate text to maxChars at a sentence boundary where possible.
 * Falls back to hard cut if no sentence boundary found in the last 20% of the window.
 */
export function truncateForOllama(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const window = text.slice(0, maxChars);
  const lastSentence = window.search(/[.!?][^.!?]*$/);
  const cutoff = lastSentence > maxChars * 0.8 ? lastSentence + 1 : maxChars;
  return window.slice(0, cutoff).trimEnd() + '…';
}

/**
 * Check if Ollama is reachable. Returns quickly (3s timeout).
 */
export async function checkOllamaHealth(
  baseUrl: string
): Promise<{ ok: boolean; error?: string }> {
  try {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), 3000);
    const res = await fetch(`${baseUrl}/api/tags`, { signal: controller.signal });
    clearTimeout(id);
    return { ok: res.ok };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'unreachable' };
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add lib/ai/ollama-utils.ts
git commit -m "feat: add ollama-utils — num_ctx computation, truncation, health check"
```

---

### Task 2: Wire `num_ctx` into `providers.ts` Ollama functions

**Files:**
- Modify: `lib/ai/providers.ts`

- [ ] **Step 1: Update `generateOllama`**

In `lib/ai/providers.ts`, replace the `generateOllama` function:

```typescript
import { computeNumCtx } from '@/lib/ai/ollama-utils';

async function generateOllama(prompt: string, options: AIRequestOptions): Promise<AIResponse> {
    const baseUrl = options.baseUrl || 'http://localhost:11434';
    const numCtx = computeNumCtx(prompt);
    const response = await fetch(`${baseUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            model: options.model,
            prompt: prompt,
            stream: false,
            options: {
                temperature: options.temperature ?? 0.7,
                num_predict: options.maxTokens,
                num_ctx: numCtx,
            }
        }),
    });

    if (!response.ok) {
        const error = await response.text();
        throw new Error(`Ollama error: ${error}`);
    }

    const data = await response.json();
    return { text: data.response };
}
```

- [ ] **Step 2: Update `generateChatOllama`**

Replace the `generateChatOllama` function:

```typescript
async function generateChatOllama(messages: AIChatMessage[], options: AIRequestOptions): Promise<AIResponse> {
    const baseUrl = options.baseUrl || 'http://localhost:11434';
    const promptEstimate = messages.map((m) => m.content).join('\n');
    const numCtx = computeNumCtx(promptEstimate);
    const response = await fetch(`${baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            model: options.model,
            messages: messages,
            stream: false,
            options: {
                temperature: options.temperature ?? 0.7,
                num_ctx: numCtx,
            }
        }),
    });

    if (!response.ok) {
        const error = await response.text();
        throw new Error(`Ollama error: ${error}`);
    }

    const data = await response.json();
    return { text: data.message.content };
}
```

- [ ] **Step 3: Commit**

```bash
git add lib/ai/providers.ts
git commit -m "fix: pass computed num_ctx in all Ollama requests to prevent silent context truncation"
```

---

### Task 3: Stream Ollama summarize via SSE

**Files:**
- Modify: `app/api/ai/summarize/route.ts`

Ollama's `/api/generate` with `stream: true` returns NDJSON lines:
`{"model":"…","response":"token","done":false}` … `{"model":"…","response":"","done":true}`

We forward each token as an SSE `data:` line. Cloud providers keep the existing non-streaming path and return `{"summary": "…"}` as before.

- [ ] **Step 1: Rewrite the POST handler to branch on provider**

Replace the entire `POST` export in `app/api/ai/summarize/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { generateText, AIProvider } from '@/lib/ai/providers';
import { computeNumCtx, truncateForOllama } from '@/lib/ai/ollama-utils';

const DEFAULT_OLLAMA_URL = 'http://localhost:11434';
// Max article chars sent to Ollama — keeps prompt within ~2500 tokens
const OLLAMA_CONTENT_MAX_CHARS = 6000;

interface RelatedSource {
  title: string;
  source: string;
  snippet: string;
  url?: string;
}

interface WebSource {
  title: string;
  snippet: string;
  url: string;
}

function buildSimplePrompt(title: string, content: string, language: string): string {
  const langInstruction = language === 'Original Language'
    ? "the EXACT SAME LANGUAGE as the original content. If it is in Chinese, you MUST summarize in Chinese. If it is in English, you MUST summarize in English."
    : language;

  return `Summarize the following news article in ${langInstruction}.
Keep it concise (maximum 3 bullet points).
Format the response as markdown bullet points.
Only output the bullet points, no introduction or conclusion.
CRITICAL: You MUST use the same language for the summary as the content provided below.

Title: ${title}
Content: ${content}
`;
}

function buildEnhancedPrompt(
  title: string,
  content: string,
  language: string,
  relatedArticles: RelatedSource[],
  webResults: WebSource[]
): string {
  const langInstruction = language === 'Original Language'
    ? "the EXACT SAME LANGUAGE as the main article. If the article is in Chinese, you MUST output the entire summary in Chinese. Do not use English if the article is Chinese."
    : language;

  let prompt = `You are a news analyst providing comprehensive summaries by cross-referencing multiple sources.

Analyze the following article along with related sources and provide an accurate, well-rounded summary in ${langInstruction}.

## MAIN ARTICLE
**Title:** ${title}
**Content:** ${content}
`;

  if (relatedArticles.length > 0) {
    prompt += `
## RELATED ARTICLES FROM USER'S NEWS FEEDS
${relatedArticles.map((a, i) => `${i + 1}. **${a.title}** (${a.source})
   ${a.snippet}`).join('\n\n')}
`;
  }

  if (webResults.length > 0) {
    prompt += `
## ADDITIONAL WEB SOURCES
${webResults.map((w, i) => `${i + 1}. **${w.title}**
   ${w.snippet}`).join('\n\n')}
`;
  }

  prompt += `
## YOUR TASK
Provide a comprehensive summary with the following sections:

### Key Facts
- List 3-4 main facts from the story, verified across sources where possible

### Perspectives
- Note any different angles or viewpoints from different sources (if applicable)

### Source Overview
- Briefly note how many sources covered this topic and any notable differences

Format as markdown. Be accurate and concise.
CRITICAL: You MUST use the same language for the summary as the Main Article provided above. Do not translate it to English if the article is in another language.`;

  return prompt;
}

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const {
      content,
      title,
      model,
      language,
      provider = 'ollama',
      apiKey,
      ollamaUrl,
      enhancedMode,
      relatedArticles,
      webResults,
      customSummaryPrompt
    } = await req.json();

    if (!content) {
      return NextResponse.json({ error: 'Content is required' }, { status: 400 });
    }

    const selectedModel = model || (provider === 'ollama' ? 'llama3.2' : 'gpt-4.1');
    const lang = language || 'English';
    const baseUrl = ollamaUrl || DEFAULT_OLLAMA_URL;

    // For Ollama, truncate content to avoid overflowing local context windows
    const isOllama = provider === 'ollama';
    const effectiveContent = isOllama
      ? truncateForOllama(content, OLLAMA_CONTENT_MAX_CHARS)
      : content;

    let prompt = '';
    if (customSummaryPrompt && customSummaryPrompt.trim().length > 0) {
      prompt = customSummaryPrompt
        .replace('{{content}}', effectiveContent)
        .replace('{{title}}', title || '');
      if (!prompt.includes(effectiveContent)) {
        prompt += `\n\nTitle: ${title}\nContent: ${effectiveContent}`;
      }
    } else {
      prompt = enhancedMode
        ? buildEnhancedPrompt(title, effectiveContent, lang, relatedArticles || [], webResults || [])
        : buildSimplePrompt(title, effectiveContent, lang);
    }

    // Ollama: stream tokens as SSE
    if (isOllama) {
      return streamOllamaSummarize(prompt, selectedModel, baseUrl);
    }

    // Cloud providers: non-streaming, return JSON as before
    const result = await generateText(provider as AIProvider, prompt, {
      model: selectedModel,
      apiKey,
      baseUrl,
    });

    return NextResponse.json({
      summary: result.text,
      enhancedMode: !!enhancedMode,
      sourcesUsed: enhancedMode ? {
        relatedArticles: relatedArticles?.length || 0,
        webResults: webResults?.length || 0,
      } : undefined,
    });
  } catch (error: any) {
    console.error('AI Summary Error:', error);
    if (error.message?.includes('ECONNREFUSED')) {
      return NextResponse.json(
        { error: 'Cannot connect to Ollama. Make sure Ollama is running (ollama serve).' },
        { status: 502 }
      );
    }
    return NextResponse.json(
      { error: error.message || 'Failed to generate summary' },
      { status: 500 }
    );
  }
}

function streamOllamaSummarize(
  prompt: string,
  model: string,
  baseUrl: string
): Response {
  const numCtx = computeNumCtx(prompt);

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();

      function send(data: string) {
        controller.enqueue(encoder.encode(`data: ${data}\n\n`));
      }

      try {
        const ollamaRes = await fetch(`${baseUrl}/api/generate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model,
            prompt,
            stream: true,
            options: { num_ctx: numCtx },
          }),
        });

        if (!ollamaRes.ok || !ollamaRes.body) {
          const errText = await ollamaRes.text().catch(() => ollamaRes.statusText);
          send(JSON.stringify({ error: `Ollama error: ${errText}` }));
          controller.close();
          return;
        }

        const reader = ollamaRes.body.getReader();
        const decoder = new TextDecoder();
        let buf = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });

          const lines = buf.split('\n');
          buf = lines.pop() ?? '';

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            try {
              const chunk = JSON.parse(trimmed) as { response?: string; done?: boolean };
              if (chunk.response) {
                send(JSON.stringify({ token: chunk.response }));
              }
              if (chunk.done) {
                send(JSON.stringify({ done: true }));
              }
            } catch {
              // ignore malformed lines
            }
          }
        }

        send(JSON.stringify({ done: true }));
      } catch (err: any) {
        send(JSON.stringify({ error: err.message || 'Stream error' }));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}

// GET endpoint to check available models
export async function GET(req: NextRequest) {
  try {
    const searchParams = req.nextUrl.searchParams;
    const ollamaUrl = searchParams.get('ollamaUrl') || DEFAULT_OLLAMA_URL;

    const response = await fetch(`${ollamaUrl}/api/tags`);

    if (!response.ok) {
      return NextResponse.json(
        { error: 'Failed to fetch models from Ollama' },
        { status: 502 }
      );
    }

    const data = await response.json();
    const models = data.models?.map((m: any) => ({
      name: m.name,
      size: m.size,
      modified: m.modified_at,
    })) || [];

    return NextResponse.json({ models, connected: true });
  } catch (error: any) {
    return NextResponse.json(
      { models: [], connected: false, error: 'Ollama not running' },
      { status: 200 }
    );
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add app/api/ai/summarize/route.ts
git commit -m "feat: stream Ollama summarize via SSE, truncate content to fit local context"
```

---

### Task 4: Update `ArticleCard.tsx` to consume SSE stream

**Files:**
- Modify: `components/deck/ArticleCard.tsx`

- [ ] **Step 1: Replace `handleSummarize` with streaming-aware version**

Replace the `handleSummarize` function and state declarations in `ArticleCard.tsx`:

```typescript
  const [summary, setSummary] = useState<string | null>(null);
  const [isSummarizing, setIsSummarizing] = useState(false);
  const [showSummary, setShowSummary] = useState(false);

  const handleSummarize = async (e: React.MouseEvent) => {
    e.stopPropagation();

    if (showSummary && summary) {
      setShowSummary(false);
      return;
    }

    if (summary) {
      setShowSummary(true);
      return;
    }

    if (!aiSettings.enabled) {
      alert(t('article.aiSummaryDisabled'));
      return;
    }

    setIsSummarizing(true);
    setShowSummary(true);

    try {
      const res = await fetch('/api/ai/summarize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: article.title,
          content: article.content || article.contentSnippet || '',
          provider: aiSettings.provider,
          apiKey: aiSettings.apiKeys?.[aiSettings.provider] || '',
          ollamaUrl: aiSettings.ollamaUrl,
          model: aiSettings.model,
          language: aiSettings.language,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error);
      }

      const contentType = res.headers.get('content-type') ?? '';

      if (contentType.includes('text/event-stream') && res.body) {
        // Ollama streaming path
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let accumulated = '';
        let buf = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });

          const lines = buf.split('\n');
          buf = lines.pop() ?? '';

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            try {
              const payload = JSON.parse(line.slice(6)) as {
                token?: string;
                done?: boolean;
                error?: string;
              };
              if (payload.error) throw new Error(payload.error);
              if (payload.token) {
                accumulated += payload.token;
                setSummary(accumulated);
              }
            } catch (parseErr: any) {
              if (parseErr.message && !parseErr.message.includes('JSON')) {
                throw parseErr;
              }
            }
          }
        }
      } else {
        // Cloud provider JSON path
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        setSummary(data.summary);
      }
    } catch (err: any) {
      setSummary(`Error: ${err.message}`);
    } finally {
      setIsSummarizing(false);
    }
  };
```

- [ ] **Step 2: Commit**

```bash
git add components/deck/ArticleCard.tsx
git commit -m "feat: stream Ollama summary tokens into ArticleCard as they arrive"
```

---

### Task 5: Optimize curation prompt for Ollama in `/api/today/route.ts`

**Files:**
- Modify: `app/api/today/route.ts`

Two changes: (1) compact the prompt for local models by removing the `summary` field; (2) cap candidates at 20 for Ollama; (3) add a fast health pre-check before waiting 25s to time out.

- [ ] **Step 1: Add Ollama-specific curation prompt builder**

After the existing `buildCurationPrompt` function, add:

```typescript
function buildOllamaCurationPrompt(items: PriorityItem[]) {
  // Compact format: no summary field — saves ~180 chars × N items ≈ 2000+ tokens
  const candidates = items.map((item, index) => [
    index,
    item.title,
    item.sourceTitle || 'Unknown',
    item.category || 'General',
    item.tags.slice(0, 3),
    Math.round(item.priorityScore),
    item.urgency,
  ]);

  return `You are IntelliDeck's news editor. Select stories for the Today feed.

Prioritize: high-impact AI, semiconductors, cloud, cybersecurity, startups, markets, tech business. Reject duplicates, promotions, generic geopolitics.

Return ONLY a JSON array, no markdown, no explanation. Include 12-18 objects:
[{"index":0,"action":"include","score":0-100,"urgency":"urgent|important|watch"}]

Candidates [index,title,source,category,tags,score,urgency]:
${JSON.stringify(candidates)}`;
}
```

- [ ] **Step 2: Update `curateWithAI` to use compact prompt + candidate cap + health check**

Replace the `curateWithAI` function:

```typescript
const OLLAMA_MAX_CANDIDATES = 20;

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
    const isOllama = provider === 'ollama';
    const timeoutMs = isOllama ? OLLAMA_CURATION_TIMEOUT_MS : CLOUD_CURATION_TIMEOUT_MS;

    // For Ollama: fast health check before committing to a 25s wait
    if (isOllama) {
      const { ok, error: healthError } = await checkOllamaHealth(
        settings.aiSettings.ollamaUrl || 'http://localhost:11434'
      );
      if (!ok) {
        throw new Error(`Ollama not reachable: ${healthError ?? 'no response'}`);
      }
    }

    // Reduce candidate count for local models to keep prompt within context window
    const candidates = isOllama ? items.slice(0, OLLAMA_MAX_CANDIDATES) : items;
    const prompt = isOllama
      ? buildOllamaCurationPrompt(candidates)
      : buildCurationPrompt(candidates);

    const result = await withTimeout(
      generateText(provider as AIProvider, prompt, {
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
      .map((selection) => normalizeSelection(selection, candidates.length - 1))
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
        const item = candidates[selection.index];
        return {
          ...item,
          aiScore: selection.score,
          curationReason: selection.reason,
          urgency: selection.urgency || item.urgency,
          reasons: Array.from(new Set([selection.reason, ...item.reasons])).slice(0, 3),
        };
      });
    const freshAnchors = [...candidates]
      .sort(sortByDisplayDateDesc)
      .slice(0, FRESH_ITEM_ANCHOR_COUNT);
    const fillItems = candidates
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
        candidateCount: candidates.length,
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
```

- [ ] **Step 3: Add import for `checkOllamaHealth`**

At the top of `app/api/today/route.ts`, add:
```typescript
import { checkOllamaHealth } from '@/lib/ai/ollama-utils';
```

- [ ] **Step 4: Commit**

```bash
git add app/api/today/route.ts
git commit -m "fix: compact ollama curation prompt, cap at 20 candidates, add health pre-check"
```
