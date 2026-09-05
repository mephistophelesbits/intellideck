export type SmartSearchMode = 'quick' | 'deep' | 'story' | 'monitoring';

export type SmartSearchOptions = {
  days?: number;
  limit?: number;
  mode?: SmartSearchMode;
  includeDebug?: boolean;
  useLlm?: boolean;
  matchMode?: 'or' | 'and';
  // Extra exclude terms from a saved rule's settings, merged in alongside any `exclude:`/`-term`
  // tokens already parsed out of the query text itself.
  excludeKeywords?: string[];
};

export type SmartSearchQueryPlan = {
  originalQuery: string;
  normalizedQuery: string;
  keywords: string[];
  phrases: string[];
  includeTerms: string[];
  excludeTerms: string[];
  detectedLanguage: 'en' | 'zh' | 'mixed' | 'unknown';
  intent: 'breaking' | 'research' | 'company' | 'market' | 'policy' | 'sports' | 'general';
};

export type SmartSearchEntitySignal = {
  id: string;
  name: string;
  type: string;
  mentionCount: number;
  weight: number;
  salience: number | null;
  isJunk: boolean;
};

export type SmartSearchThemeSignal = {
  id: string;
  name: string;
  score: number;
  categoryHint: string | null;
};

export type SmartSearchCandidate = {
  id: string;
  title: string;
  url: string;
  publishedAt: string | null;
  sourceTitle: string | null;
  sourceUrl: string | null;
  contentSnippet: string | null;
  rawContent: string | null;
  scrapedText?: string | null;
  language: string | null;
  category: string | null;
  importanceScore: number;
  entities: SmartSearchEntitySignal[];
  themes: SmartSearchThemeSignal[];
};

export type SmartSearchScoreBreakdown = {
  lexical: number;
  entity: number;
  theme: number;
  semantic: number;
  importance: number;
  freshness: number;
  velocity: number;
  sourceQuality: number;
  penalties: number;
  final: number;
};

export type SmartSearchTag = {
  type: 'entity' | 'theme' | 'event' | 'intent' | 'language' | 'region' | 'quality';
  label: string;
  confidence: number;
};

export type SmartSearchResult = SmartSearchCandidate & {
  matchedTerms: string[];
  tags: SmartSearchTag[];
  score: SmartSearchScoreBreakdown;
  reasons: string[];
  storyKey: string;
};

export type SmartSearchGroup = {
  id: string;
  title: string;
  storyKey: string;
  articleCount: number;
  sourceCount: number;
  firstSeenAt: string | null;
  latestSeenAt: string | null;
  topEntities: string[];
  topThemes: string[];
  topArticleIds: string[];
  velocityScore: number;
  relevanceScore: number;
};

export type SmartSearchAlert = {
  type: 'breaking' | 'escalating' | 'new-story' | 'high-importance';
  severity: 'low' | 'medium' | 'high';
  title: string;
  reason: string;
  articleIds: string[];
  entities: string[];
  themes: string[];
};

export type SmartSearchFacets = {
  sources: Array<{ name: string; count: number }>;
  entities: Array<{ name: string; count: number }>;
  themes: Array<{ name: string; count: number }>;
  languages: Array<{ name: string; count: number }>;
};

export type SmartSearchDebugSignal = {
  articleId?: string;
  stage: string;
  message: string;
  value?: unknown;
};

export type SmartSearchLlmStatus = {
  enabled: boolean;
  used: boolean;
  timedOut: boolean;
  model?: string;
  latencyMs?: number;
  error?: string;
};

export type SmartSearchResponse = {
  keywords: string[];
  queryPlan: SmartSearchQueryPlan;
  results: SmartSearchResult[];
  groups: SmartSearchGroup[];
  alerts: SmartSearchAlert[];
  facets: SmartSearchFacets;
  debugSignals: SmartSearchDebugSignal[];
  llmStatus?: SmartSearchLlmStatus;
};

export type SmartSearchSqlRow = {
  id: string;
  title: string;
  canonical_url: string;
  published_at: string | null;
  created_at: string;
  source_title: string | null;
  source_url: string | null;
  content_snippet: string | null;
  raw_content: string | null;
  scraped_text: string | null;
  language: string | null;
  primary_category: string | null;
  importance_score: number | null;
  entity_id: string | null;
  entity_name: string | null;
  entity_type: string | null;
  mention_count: number | null;
  entity_weight: number | null;
  entity_salience: number | null;
  theme_id: string | null;
  theme_name: string | null;
  category_hint: string | null;
  theme_score: number | null;
};
