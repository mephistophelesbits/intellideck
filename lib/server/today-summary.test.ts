import { describe, it, expect } from 'vitest';
import {
  buildFallbackSummary,
  buildSummaryPrompt,
  cleanSummary,
  type PrioritySummaryItem,
  type SummarySignals,
} from './today-summary';

function item(overrides: Partial<PrioritySummaryItem>): PrioritySummaryItem {
  return {
    id: 'a',
    url: 'https://example.com/a',
    title: 'Untitled',
    sourceTitle: 'Source',
    category: 'General',
    tags: [],
    summary: null,
    content: null,
    publishedAt: '2026-06-17T00:00:00.000Z',
    updatedAt: '2026-06-17T00:00:00.000Z',
    ...overrides,
  };
}

const signals: SummarySignals = { entities: [], themes: [], locations: [] };

describe('buildFallbackSummary', () => {
  const items = [
    item({ id: '1', title: 'Ceasefire talks collapse', sourceTitle: 'BBC News' }),
    item({ id: '2', title: 'Central bank holds rates', sourceTitle: 'Reuters' }),
    item({ id: '3', title: 'New AI model released', sourceTitle: 'The Verge' }),
    item({ id: '4', title: 'Fourth story', sourceTitle: 'Extra' }),
  ];

  it('names the top 3 actual headlines, not generic topics', () => {
    const text = buildFallbackSummary(items, 'en');
    expect(text).toContain('Ceasefire talks collapse');
    expect(text).toContain('Central bank holds rates');
    expect(text).toContain('New AI model released');
    // exactly three numbered lines
    expect(text).toMatch(/^1\. /m);
    expect(text).toMatch(/^2\. /m);
    expect(text).toMatch(/^3\. /m);
    expect(text).not.toMatch(/^4\. /m);
    // the old vague boilerplate is gone
    expect(text).not.toContain('policy, geopolitics, technology');
  });

  it('includes the source for each headline', () => {
    const text = buildFallbackSummary(items, 'en');
    expect(text).toContain('BBC News');
    expect(text).toContain('Reuters');
  });

  it('supports Simplified Chinese', () => {
    const text = buildFallbackSummary(items, 'zh-CN');
    expect(text).toContain('Ceasefire talks collapse');
    expect(text).toMatch(/^1\. /m);
  });

  it('handles an empty feed gracefully', () => {
    expect(buildFallbackSummary([], 'en')).toMatch(/No items/);
    expect(buildFallbackSummary([], 'zh-CN')).toMatch(/暂无/);
  });

  it('handles fewer than three items', () => {
    const text = buildFallbackSummary(items.slice(0, 2), 'en');
    expect(text).toMatch(/^1\. /m);
    expect(text).toMatch(/^2\. /m);
    expect(text).not.toMatch(/^3\. /m);
  });
});

describe('cleanSummary', () => {
  it('strips thinking blocks but preserves the top-3 line structure', () => {
    const raw = '<think>let me reason</think>Overall the news is busy.\n1. A — matters\n2. B — matters\n3. C — matters';
    const cleaned = cleanSummary(raw);
    expect(cleaned).not.toContain('let me reason');
    expect(cleaned.split('\n')).toHaveLength(4);
    expect(cleaned).toMatch(/^1\. A — matters$/m);
  });

  it('removes markdown headings, bold, and stray bullets', () => {
    const cleaned = cleanSummary('## Heading\n**Overview**\n- 1. Item one');
    expect(cleaned).not.toContain('##');
    expect(cleaned).not.toContain('**');
    expect(cleaned).toContain('1. Item one');
  });
});

describe('buildSummaryPrompt', () => {
  const items = [
    item({ id: '1', title: 'Ceasefire talks collapse' }),
    item({ id: '2', title: 'Central bank holds rates' }),
  ];

  it('asks for the top three stories and includes the feed titles', () => {
    const prompt = buildSummaryPrompt(items, signals, 'en');
    expect(prompt).toMatch(/THREE most important/);
    expect(prompt).toContain('Ceasefire talks collapse');
    expect(prompt).toContain('Central bank holds rates');
    expect(prompt).toContain('Write in English.');
  });

  it('switches language instruction for zh-CN', () => {
    const prompt = buildSummaryPrompt(items, signals, 'zh-CN');
    expect(prompt).toContain('Write in Simplified Chinese.');
  });
});
