export interface Article {
  id: string;
  title: string;
  link: string;
  pubDate: string;
  contentSnippet?: string;
  content?: string; // Full HTML content from content:encoded
  author?: string;
  thumbnail?: string;
  sourceTitle?: string;
  sourceUrl?: string;
  bookmarked?: boolean;
}

export interface FeedSource {
  id: string;
  url: string;
  title: string;
  icon?: string;
  siteUrl?: string;
  lastFetchedAt?: string | null;
  lastError?: string | null;
}

export interface ColumnSettings {
  refreshInterval: number; // in minutes
  viewMode: 'compact' | 'comfortable';
}

export interface Column {
  id: string;
  title: string;
  type: 'single-feed' | 'category' | 'unified' | 'list' | 'search';
  sources: FeedSource[];
  settings: ColumnSettings;
  width: number; // Column width in pixels
  feedListId?: string;
  searchRuleId?: string;
}

export interface FeedResponse {
  title: string;
  description?: string;
  link?: string;
  items: Article[];
}

export interface DeckStateSnapshot {
  columns: Column[];
  savedFeeds: FeedSource[];
}

export interface KeywordAlert {
  id: string;       // nanoid — stable React key, survives keyword edits
  keyword: string;  // stored as entered; matching is case-insensitive
  color: string;    // hex color string, e.g. "#ff4444"
  enabled: boolean; // false = skip during matching but keep in list
}

export interface FeedList {
  id: string;
  name: string;
  feedCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface FeedListWithItems extends FeedList {
  items: Array<FeedSource & { feedListItemId: string; position: number }>;
}

// Client-safe shape of a saved search rule. Mirrors SavedSearchRule from
// search-repository without importing the server-only module in client components.
export interface SearchRule {
  id: string;
  name: string;
  ruleColor: string;
  query: string;
  keywords: string[];
  settings: {
    matchMode: 'or' | 'and';
    excludeKeywords: string[];
  };
  lastRunAt: string | null;
}

export type AdSentinel = { type: 'ad'; id: string };
export type FeedItem = Article | AdSentinel;
