import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import {
  buildSmartSearchGroups,
  buildSmartSearchTags,
  detectSmartSearchAlerts,
  buildSmartSearchQueryPlan,
  isJunkSearchEntity,
  mapSmartSearchRows,
  rankSmartSearchCandidates,
} from './smart-search';
import type { SmartSearchCandidate, SmartSearchResult, SmartSearchSqlRow } from './smart-search-types';

describe('buildSmartSearchQueryPlan', () => {
  it('normalizes comma, newline, and Chinese separators', () => {
    const plan = buildSmartSearchQueryPlan('Nvidia, China；chips\nexport controls');

    expect(plan.keywords).toEqual(['nvidia', 'china', 'chips', 'export controls']);
    expect(plan.includeTerms).toEqual(['nvidia', 'china', 'chips', 'export controls']);
    expect(plan.normalizedQuery).toBe('nvidia china chips export controls');
  });

  it('detects mixed Chinese and English queries', () => {
    const plan = buildSmartSearchQueryPlan('英伟达 中国 chips');

    expect(plan.detectedLanguage).toBe('mixed');
    expect(plan.keywords).toEqual(['英伟达', '中国', 'chips']);
  });

  it('detects breaking-news intent', () => {
    const plan = buildSmartSearchQueryPlan('breaking nvidia china export controls');

    expect(plan.intent).toBe('breaking');
  });

  it('detects exclusions without treating them as positive terms', () => {
    const plan = buildSmartSearchQueryPlan('openai copyright -stock price exclude:jobs');

    expect(plan.includeTerms).toEqual(['openai', 'copyright']);
    expect(plan.excludeTerms).toEqual(['stock', 'price', 'jobs']);
  });
});

describe('isJunkSearchEntity', () => {
  it('rejects boilerplate URL entities', () => {
    expect(isJunkSearchEntity('Article URL')).toBe(true);
    expect(isJunkSearchEntity('Comments URL')).toBe(true);
    expect(isJunkSearchEntity('URL')).toBe(true);
    expect(isJunkSearchEntity('Telegram Channel')).toBe(true);
  });

  it('keeps meaningful entities', () => {
    expect(isJunkSearchEntity('Nvidia')).toBe(false);
    expect(isJunkSearchEntity('US Commerce Department')).toBe(false);
    expect(isJunkSearchEntity('中国')).toBe(false);
  });

  it('rejects url-like and generic boilerplate strings', () => {
    expect(isJunkSearchEntity('https://example.com/story')).toBe(true);
    expect(isJunkSearchEntity('Read More')).toBe(true);
    expect(isJunkSearchEntity('Unknown')).toBe(true);
  });
});

function candidate(overrides: Partial<SmartSearchCandidate>): SmartSearchCandidate {
  return {
    id: 'a1',
    title: 'Nvidia export controls hit China AI chips',
    url: 'https://example.com/a1',
    publishedAt: '2026-06-30T00:00:00.000Z',
    sourceTitle: 'Reuters',
    sourceUrl: 'https://reuters.test',
    contentSnippet: 'Nvidia and China are central to new chip export controls.',
    rawContent: null,
    scrapedText: null,
    language: 'en',
    category: 'Technology',
    importanceScore: 80,
    entities: [],
    themes: [],
    ...overrides,
  };
}

describe('rankSmartSearchCandidates', () => {
  it('ranks strong relevant older articles above weak fresh articles', () => {
    const plan = buildSmartSearchQueryPlan('nvidia china chips');
    const ranked = rankSmartSearchCandidates(plan, [
      candidate({
        id: 'weak-new',
        title: 'Latest market update',
        publishedAt: '2026-07-01T00:00:00.000Z',
        contentSnippet: 'AI mentioned in passing.',
        importanceScore: 30,
      }),
      candidate({
        id: 'strong-old',
        title: 'Nvidia China chip export controls widen',
        publishedAt: '2026-06-29T00:00:00.000Z',
        contentSnippet: 'Nvidia, China and AI chips are directly affected by export controls.',
        importanceScore: 70,
      }),
    ], Date.parse('2026-07-01T12:00:00.000Z'));

    expect(ranked[0].id).toBe('strong-old');
    expect(ranked[0].score.final).toBeGreaterThan(ranked[1].score.final);
    expect(ranked[0].reasons).toContain('Strong title match');
  });

  it('penalizes junk-only entity matches', () => {
    const plan = buildSmartSearchQueryPlan('url world');
    const ranked = rankSmartSearchCandidates(plan, [
      candidate({
        id: 'junk',
        title: 'Article URL / World',
        entities: [{ id: 'e1', name: 'Article URL', type: 'OTHER', mentionCount: 9, weight: 1, salience: 1, isJunk: true }],
        themes: [{ id: 't1', name: 'World', score: 9, categoryHint: 'World' }],
      }),
      candidate({
        id: 'real',
        title: 'World leaders discuss shipping risk through Hormuz',
        contentSnippet: 'Shipping through the Strait of Hormuz faces geopolitical risk.',
        entities: [{ id: 'e2', name: 'Hormuz', type: 'LOCATION', mentionCount: 3, weight: 2, salience: 0.8, isJunk: false }],
        themes: [{ id: 't2', name: 'Geopolitical Conflict', score: 8, categoryHint: 'World' }],
      }),
    ], Date.parse('2026-07-01T12:00:00.000Z'));

    expect(ranked[0].id).toBe('real');
    expect(ranked.find((result) => result.id === 'junk')?.score.penalties).toBeGreaterThan(0);
  });

  it('blends in a semantic score when a match is provided, defaulting absent ids to 0', () => {
    const plan = buildSmartSearchQueryPlan('nvidia china chips');
    const semanticScores = new Map([['semantic-hit', 90]]);
    const ranked = rankSmartSearchCandidates(plan, [
      candidate({ id: 'semantic-hit', title: 'Latest market update', contentSnippet: 'No keyword overlap here.' }),
      candidate({ id: 'no-semantic-data', title: 'Latest market update', contentSnippet: 'No keyword overlap here.' }),
    ], Date.parse('2026-07-01T12:00:00.000Z'), semanticScores);

    const withSemantic = ranked.find((result) => result.id === 'semantic-hit')!;
    const withoutSemantic = ranked.find((result) => result.id === 'no-semantic-data')!;

    expect(withSemantic.score.semantic).toBe(90);
    expect(withoutSemantic.score.semantic).toBe(0);
    expect(withSemantic.score.final).toBeGreaterThan(withoutSemantic.score.final);
    expect(withSemantic.reasons).toContain('Semantically similar to query');
  });
});


describe('mapSmartSearchRows', () => {
  it('groups flat SQL rows by article and marks junk entities', () => {
    const rows: SmartSearchSqlRow[] = [
      {
        id: 'a1',
        title: 'Nvidia China chip export controls',
        canonical_url: 'https://example.com/a1',
        published_at: '2026-07-01T00:00:00.000Z',
        created_at: '2026-07-01T00:00:00.000Z',
        source_title: 'Reuters',
        source_url: 'https://reuters.test',
        content_snippet: 'Export controls affect Nvidia chips in China.',
        raw_content: null,
        scraped_text: null,
        language: 'en',
        primary_category: 'Technology',
        importance_score: 82,
        entity_id: 'e1',
        entity_name: 'Nvidia',
        entity_type: 'ORG',
        mention_count: 4,
        entity_weight: 2.5,
        entity_salience: 0.9,
        theme_id: 't1',
        theme_name: 'Export Controls',
        category_hint: 'Policy',
        theme_score: 9,
      },
      {
        id: 'a1',
        title: 'Nvidia China chip export controls',
        canonical_url: 'https://example.com/a1',
        published_at: '2026-07-01T00:00:00.000Z',
        created_at: '2026-07-01T00:00:00.000Z',
        source_title: 'Reuters',
        source_url: 'https://reuters.test',
        content_snippet: 'Export controls affect Nvidia chips in China.',
        raw_content: null,
        scraped_text: null,
        language: 'en',
        primary_category: 'Technology',
        importance_score: 82,
        entity_id: 'e2',
        entity_name: 'Article URL',
        entity_type: 'OTHER',
        mention_count: 8,
        entity_weight: 1,
        entity_salience: 0.2,
        theme_id: 't1',
        theme_name: 'Export Controls',
        category_hint: 'Policy',
        theme_score: 9,
      },
    ];

    const candidates = mapSmartSearchRows(rows);

    expect(candidates).toHaveLength(1);
    expect(candidates[0].entities).toHaveLength(2);
    expect(candidates[0].entities.find((entity) => entity.name === 'Article URL')?.isJunk).toBe(true);
    expect(candidates[0].themes).toHaveLength(1);
  });
});

describe('buildSmartSearchTags', () => {
  it('turns meaningful entities, themes, and event language into tags', () => {
    const tags = buildSmartSearchTags(candidate({
      title: 'OpenAI sued by publisher over copyright',
      entities: [{ id: 'e1', name: 'OpenAI', type: 'ORG', mentionCount: 4, weight: 3, salience: 0.9, isJunk: false }],
      themes: [{ id: 't1', name: 'Copyright', score: 8, categoryHint: 'Law' }],
    }), buildSmartSearchQueryPlan('openai copyright lawsuit'));

    expect(tags).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'entity', label: 'OpenAI' }),
      expect.objectContaining({ type: 'theme', label: 'Copyright' }),
      expect.objectContaining({ type: 'event', label: 'lawsuit' }),
    ]));
  });
});

function resultForGroup(overrides: Partial<SmartSearchResult>): SmartSearchResult {
  const [result] = rankSmartSearchCandidates(
    buildSmartSearchQueryPlan('nvidia china export controls'),
    [candidate({
      id: 'group-base',
      title: 'Nvidia China export controls tighten',
      sourceTitle: 'Reuters',
      entities: [{ id: 'e1', name: 'Nvidia', type: 'ORG', mentionCount: 4, weight: 3, salience: 0.9, isJunk: false }],
      themes: [{ id: 't1', name: 'Export Controls', score: 9, categoryHint: 'Policy' }],
      ...overrides,
    })],
    Date.parse('2026-07-01T12:00:00.000Z'),
  );
  return result;
}

describe('buildSmartSearchGroups', () => {
  it('groups by meaningful entity and theme instead of junk anchors', () => {
    const groups = buildSmartSearchGroups([
      resultForGroup({ id: 'a1', sourceTitle: 'Reuters' }),
      resultForGroup({ id: 'a2', sourceTitle: 'Bloomberg', title: 'Nvidia China chip export rules update' }),
      resultForGroup({
        id: 'junk',
        title: 'Article URL / World',
        entities: [{ id: 'e2', name: 'Article URL', type: 'OTHER', mentionCount: 8, weight: 1, salience: 0.2, isJunk: true }],
        themes: [{ id: 't2', name: 'World', score: 9, categoryHint: 'World' }],
      }),
    ]);

    expect(groups[0].title).toBe('Nvidia / Export Controls');
    expect(groups[0].articleCount).toBe(2);
    expect(groups[0].sourceCount).toBe(2);
    expect(groups.some((group) => group.title === 'Article URL / World')).toBe(false);
  });
});

describe('detectSmartSearchAlerts', () => {
  it('detects breaking escalation across multiple sources inside a recent group', () => {
    const results = [
      resultForGroup({ id: 'a1', sourceTitle: 'Reuters', publishedAt: '2026-07-01T10:00:00.000Z' }),
      resultForGroup({ id: 'a2', sourceTitle: 'Bloomberg', publishedAt: '2026-07-01T10:30:00.000Z' }),
      resultForGroup({ id: 'a3', sourceTitle: 'SCMP', publishedAt: '2026-07-01T11:00:00.000Z' }),
    ];
    const groups = buildSmartSearchGroups(results);
    const alerts = detectSmartSearchAlerts(groups, results, Date.parse('2026-07-01T12:00:00.000Z'));

    expect(alerts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'breaking',
        severity: 'high',
        title: 'Nvidia / Export Controls is accelerating',
      }),
    ]));
  });
});
