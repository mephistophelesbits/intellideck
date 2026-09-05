// Pure formatting helpers for the Today "Daily briefing" summary.
// Kept free of DB / network access so they can be unit-tested in isolation;
// the route (app/api/today/summary/route.ts) supplies the data and the LLM call.

export type PrioritySummaryItem = {
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

export type SummarySignals = {
  entities: string[];
  themes: string[];
  locations: string[];
};

export function stripThinkingProcess(text: string) {
  return text
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/```(?:thinking|reasoning|thoughts)[\s\S]*?```/gi, '')
    .replace(/^\s*(?:thinking|reasoning|thought process|chain of thought)\s*:\s*[\s\S]*$/gim, '')
    .replace(/^\s*(?:Here(?:'|’)s my reasoning|I(?:'|’)ll reason through this|Let me think)[\s\S]*$/gim, '')
    .trim();
}

// Structure-preserving cleanup: drops markdown chrome and thinking output but keeps
// the line breaks so the "overview + top 3" layout survives into the briefing card
// (which renders with `whitespace-pre-wrap`).
export function cleanSummary(text: string) {
  return stripThinkingProcess(text)
    .replace(/^#{1,6}\s+/gm, '')      // markdown headings
    .replace(/\*\*/g, '')             // bold markers
    .replace(/^\s*[-*]\s+/gm, '')     // stray bullet markers (we use "1." numbering)
    .replace(/[ \t]+/g, ' ')          // collapse intra-line whitespace
    .replace(/[ \t]*\n[ \t]*/g, '\n') // trim each line's edges
    .replace(/\n{3,}/g, '\n\n')       // cap consecutive blank lines
    .trim();
}

function topThree(items: PrioritySummaryItem[]) {
  return items.slice(0, 3);
}

// Deterministic fallback used when the LLM is unreachable/slow. Unlike the old
// "topics from sources" boilerplate, this names the actual top 3 headlines so the
// reader still gets the leading stories even when generation is down.
export function buildFallbackSummary(items: PrioritySummaryItem[], locale: string) {
  const top = topThree(items);

  if (top.length === 0) {
    return locale === 'zh-CN'
      ? '优先信息流暂无可用条目。'
      : 'No items are available in the Priority feed yet.';
  }

  if (locale === 'zh-CN') {
    const lead = '当前优先信息流中最重要的三条动态：';
    const lines = top.map(
      (item, index) => `${index + 1}. ${item.title}（${item.sourceTitle || '未知来源'}）`
    );
    return [lead, ...lines].join('\n');
  }

  const lead = 'The three biggest developments in your Priority feed right now:';
  const lines = top.map(
    (item, index) => `${index + 1}. ${item.title} (${item.sourceTitle || 'Unknown source'})`
  );
  return [lead, ...lines].join('\n');
}

export function buildSummaryPrompt(
  items: PrioritySummaryItem[],
  signals: SummarySignals,
  locale: string
) {
  const storiesText = items
    .map((item, index) => `${index + 1}. ${item.title}
Source: ${item.sourceTitle || 'Unknown Source'}
Category: ${item.category || 'General'}
Tags: ${(item.tags ?? []).slice(0, 6).join(', ') || 'none'}
Published: ${item.publishedAt || item.updatedAt}
Summary: ${item.summary || item.content?.slice(0, 500) || 'No summary available'}`)
    .join('\n\n');

  const signalText = [
    `Dominant entities: ${signals.entities.slice(0, 8).join(', ') || 'none'}`,
    `Dominant themes: ${signals.themes.slice(0, 8).join(', ') || 'none'}`,
    `Dominant locations: ${signals.locations.slice(0, 8).join(', ') || 'none'}`,
  ].join('\n');

  const languageInstruction = locale === 'zh-CN'
    ? 'Write in Simplified Chinese.'
    : 'Write in English.';

  return `You are IntelliDeck's news editor. From the Priority Feed below, identify the THREE most important news stories or movements right now and brief the reader on them.

How to choose the top 3:
- Pick the genuinely most significant developments — escalation, major decisions, launches, rulings, or large real-world impact — NOT simply the most frequent topic or tag.
- If several entries cover the same event, treat them as one story.

Output format (plain text, no markdown):
- First, one short sentence giving the overall picture.
- Then exactly three lines, each starting "1. ", "2. ", "3. ".
- Each line: a concrete headline in your own words, then " — " and why it matters / what actually moved.
- Be specific: name the actors, places, and the concrete development. No filler, no hedging.
- 110-180 words total. No headings, no bullet symbols, no bold, no thinking or process notes.
- ${languageInstruction}

Priority Feed:
${storiesText}

Cross-story signals:
${signalText}`;
}
