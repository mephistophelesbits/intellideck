import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { annotateEscalationSignals, parseSearchKeywords, summarizeMonitoringGroup, type SavedSearchRule, type SearchResult } from './search-repository';

const rule: SavedSearchRule = {
  id: 'r1',
  name: 'AI Chips',
  ruleColor: '#f97316',
  query: 'ai, chips',
  keywords: ['ai', 'chips'],
  settings: {
    matchMode: 'or',
    excludeKeywords: [],
  },
  orderIndex: 0,
  createdAt: '2026-06-01T00:00:00.000Z',
  updatedAt: '2026-06-01T00:00:00.000Z',
  lastRunAt: null,
};

function result(overrides: Partial<SearchResult>): SearchResult {
  return {
    id: 'a1',
    title: 'AI chips surge after earnings beat',
    url: 'https://example.com/a1',
    publishedAt: '2026-06-28T00:00:00.000Z',
    sourceTitle: 'Reuters',
    sourceUrl: 'https://reuters.test',
    contentSnippet: 'A positive breakthrough for AI chips.',
    rawContent: null,
    category: 'Technology',
    importanceScore: 8,
    matchedTerms: ['ai', 'chips'],
    relevance: 21,
    escalationCount24h: 1,
    isEscalating: false,
    ...overrides,
  };
}

describe('summarizeMonitoringGroup', () => {
  it('parses full-width and multiline keyword separators', () => {
    expect(parseSearchKeywords('trump，xi；elon musk\njensen huang')).toEqual([
      'trump',
      'xi',
      'elon musk',
      'jensen huang',
    ]);
  });

  it('keeps all parsed keywords without truncating after 12 terms', () => {
    expect(parseSearchKeywords(
      'one,two,three,four,five,six,seven,eight,nine,ten,eleven,twelve,thirteen,fourteen',
    )).toEqual([
      'one',
      'two',
      'three',
      'four',
      'five',
      'six',
      'seven',
      'eight',
      'nine',
      'ten',
      'eleven',
      'twelve',
      'thirteen',
      'fourteen',
    ]);
  });

  it('computes feed counts, positive sentiment, and breaking highlights', () => {
    const summary = summarizeMonitoringGroup(
      rule,
      [
        result({ id: 'a1' }),
        result({
          id: 'a2',
          title: 'Breaking: AI chip partnership expands',
          url: 'https://example.com/a2',
          sourceTitle: 'Bloomberg',
          sourceUrl: 'https://bloomberg.test',
          relevance: 25,
          importanceScore: 9,
        }),
      ],
      {
        articleCount: 2,
        feedCount: 2,
        latestPublishedAt: '2026-06-28T00:00:00.000Z',
        averageRelevance: 23,
      },
      Date.parse('2026-06-28T04:00:00.000Z'),
    );

    expect(summary.feedCount).toBe(2);
    expect(summary.articleCount).toBe(2);
    expect(summary.sentimentLabel).toBe('positive');
    expect(summary.escalatingCount).toBe(0);
    expect(summary.breakingHighlights[0].title).toContain('Breaking');
  });

  it('returns neutral sentiment and no highlights when rows are empty', () => {
    const summary = summarizeMonitoringGroup(
      rule,
      [],
      {
        articleCount: 0,
        feedCount: 0,
        latestPublishedAt: null,
        averageRelevance: 0,
      },
    );

    expect(summary.sentimentScore).toBe(0);
    expect(summary.sentimentLabel).toBe('neutral');
    expect(summary.escalatingCount).toBe(0);
    expect(summary.breakingHighlights).toEqual([]);
  });

  it('tags same headlines repeated within 24 hours as escalating', () => {
    const rows = annotateEscalationSignals([
      result({
        id: 'a1',
        title: 'AI chip demand surges after Nvidia forecast',
        publishedAt: '2026-06-28T03:00:00.000Z',
      }),
      result({
        id: 'a2',
        title: 'Breaking: AI chip demand surges after Nvidia forecast',
        url: 'https://example.com/a2',
        publishedAt: '2026-06-28T07:00:00.000Z',
      }),
      result({
        id: 'a3',
        title: 'Older AI chip demand surges after Nvidia forecast',
        url: 'https://example.com/a3',
        publishedAt: '2026-06-26T00:00:00.000Z',
      }),
    ], Date.parse('2026-06-28T08:00:00.000Z'));

    expect(rows[0].isEscalating).toBe(true);
    expect(rows[0].escalationCount24h).toBe(2);
    expect(rows[1].isEscalating).toBe(true);
    expect(rows[1].escalationCount24h).toBe(2);
    expect(rows[2].isEscalating).toBe(false);
    expect(rows[2].escalationCount24h).toBe(1);

    const summary = summarizeMonitoringGroup(
      rule,
      rows,
      {
        articleCount: rows.length,
        feedCount: 2,
        latestPublishedAt: '2026-06-28T07:00:00.000Z',
        averageRelevance: 23,
      },
      Date.parse('2026-06-28T08:00:00.000Z'),
    );

    expect(summary.escalatingCount).toBe(2);
  });
});
