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
  type: 'single-feed' | 'category' | 'unified';
  sources: FeedSource[];
  settings: ColumnSettings;
  width: number; // Column width in pixels
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
