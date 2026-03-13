import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

interface ScrapedContent {
  title: string;
  content: string;
  textContent: string;
  excerpt: string;
  byline: string | null;
  siteName: string | null;
  length: number;
  cachedAt: number;
}

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  webResults?: { title: string; url: string; snippet: string }[];
}

interface ArticleSummary {
  summary: string;
  relatedArticles: { title: string; source: string; url: string }[];
  webResults: { title: string; url: string; snippet: string }[];
  cachedAt: number;
}

interface ArticleChat {
  messages: ChatMessage[];
  updatedAt: number;
}

interface ArticleCacheState {
  // Scraped content cache (keyed by article URL)
  scrapedContent: Record<string, ScrapedContent>;
  // AI summary cache (keyed by article ID)
  summaries: Record<string, ArticleSummary>;
  // Chat history cache (keyed by article ID)
  chats: Record<string, ArticleChat>;

  // Scraped content actions
  setScrapedContent: (url: string, content: Omit<ScrapedContent, 'cachedAt'>) => void;
  getScrapedContent: (url: string) => ScrapedContent | null;

  // Summary actions
  setSummary: (articleId: string, summary: ArticleSummary) => void;
  getSummary: (articleId: string) => ArticleSummary | null;

  // Chat actions
  setChatMessages: (articleId: string, messages: ChatMessage[]) => void;
  addChatMessage: (articleId: string, message: ChatMessage) => void;
  getChatMessages: (articleId: string) => ChatMessage[];
  clearChat: (articleId: string) => void;

  // Cleanup old cache (older than 7 days)
  cleanupOldCache: () => void;
}

const CACHE_MAX_AGE = 7 * 24 * 60 * 60 * 1000; // 7 days
const MAX_SCRAPED_ENTRIES = 10;
const MAX_SUMMARY_ENTRIES = 18;
const MAX_CHAT_THREADS = 12;
const MAX_CHAT_MESSAGES = 12;
const MAX_SCRAPED_HTML_LENGTH = 6000;
const MAX_SCRAPED_TEXT_LENGTH = 12000;
const MAX_SUMMARY_LENGTH = 8000;
const MAX_CHAT_MESSAGE_LENGTH = 2000;
const MAX_WEB_RESULTS = 4;
const MAX_WEB_SNIPPET_LENGTH = 220;

function trimText(value: string | null | undefined, maxLength: number) {
  if (!value) return '';
  return value.length > maxLength ? `${value.slice(0, maxLength)}…` : value;
}

function sanitizeWebResults(webResults?: { title: string; url: string; snippet: string }[]) {
  return (webResults ?? []).slice(0, MAX_WEB_RESULTS).map((result) => ({
    title: trimText(result.title, 180),
    url: result.url,
    snippet: trimText(result.snippet, MAX_WEB_SNIPPET_LENGTH),
  }));
}

function sanitizeScrapedContent(content: Omit<ScrapedContent, 'cachedAt'> | ScrapedContent): Omit<ScrapedContent, 'cachedAt'> {
  return {
    title: trimText(content.title, 240),
    content: trimText(content.content, MAX_SCRAPED_HTML_LENGTH),
    textContent: trimText(content.textContent, MAX_SCRAPED_TEXT_LENGTH),
    excerpt: trimText(content.excerpt, 500),
    byline: content.byline ? trimText(content.byline, 120) : null,
    siteName: content.siteName ? trimText(content.siteName, 120) : null,
    length: Math.min(content.length, MAX_SCRAPED_TEXT_LENGTH),
  };
}

function sanitizeSummary(summary: ArticleSummary): ArticleSummary {
  return {
    summary: trimText(summary.summary, MAX_SUMMARY_LENGTH),
    relatedArticles: summary.relatedArticles.slice(0, MAX_WEB_RESULTS).map((article) => ({
      title: trimText(article.title, 240),
      source: trimText(article.source, 120),
      url: article.url,
    })),
    webResults: sanitizeWebResults(summary.webResults),
    cachedAt: summary.cachedAt,
  };
}

function sanitizeChatMessages(messages: ChatMessage[]) {
  return messages.slice(-MAX_CHAT_MESSAGES).map((message) => ({
    role: message.role,
    content: trimText(message.content, MAX_CHAT_MESSAGE_LENGTH),
    webResults: sanitizeWebResults(message.webResults),
  }));
}

function limitRecordEntries<T extends { [key: string]: { cachedAt?: number; updatedAt?: number } }>(
  record: T,
  maxEntries: number,
) {
  const sorted = Object.entries(record).sort(([, a], [, b]) => {
    const left = a.updatedAt ?? a.cachedAt ?? 0;
    const right = b.updatedAt ?? b.cachedAt ?? 0;
    return right - left;
  });

  return Object.fromEntries(sorted.slice(0, maxEntries)) as T;
}

function compactCacheState(state: Pick<ArticleCacheState, 'scrapedContent' | 'summaries' | 'chats'>) {
  const now = Date.now();

  const scrapedContent = limitRecordEntries(
    Object.fromEntries(
      Object.entries(state.scrapedContent)
        .filter(([, content]) => now - content.cachedAt < CACHE_MAX_AGE)
        .map(([url, content]) => [
          url,
          { ...sanitizeScrapedContent(content), cachedAt: content.cachedAt },
        ]),
    ) as Record<string, ScrapedContent>,
    MAX_SCRAPED_ENTRIES,
  );

  const summaries = limitRecordEntries(
    Object.fromEntries(
      Object.entries(state.summaries)
        .filter(([, summary]) => now - summary.cachedAt < CACHE_MAX_AGE)
        .map(([articleId, summary]) => [
          articleId,
          { ...sanitizeSummary(summary), cachedAt: summary.cachedAt },
        ]),
    ) as Record<string, ArticleSummary>,
    MAX_SUMMARY_ENTRIES,
  );

  const chats = limitRecordEntries(
    Object.fromEntries(
      Object.entries(state.chats)
        .filter(([, chat]) => now - chat.updatedAt < CACHE_MAX_AGE)
        .map(([articleId, chat]) => [
          articleId,
          { messages: sanitizeChatMessages(chat.messages), updatedAt: chat.updatedAt },
        ]),
    ) as Record<string, ArticleChat>,
    MAX_CHAT_THREADS,
  );

  return { scrapedContent, summaries, chats };
}

export const useArticleCacheStore = create<ArticleCacheState>()(
  persist(
    (set, get) => ({
      scrapedContent: {},
      summaries: {},
      chats: {},

      setScrapedContent: (url, content) =>
        set((state) => compactCacheState({
          ...state,
          scrapedContent: {
            ...state.scrapedContent,
            [url]: { ...sanitizeScrapedContent(content), cachedAt: Date.now() },
          },
        })),

      getScrapedContent: (url) => {
        const content = get().scrapedContent[url];
        if (!content) return null;
        // Check if cache is still valid
        if (Date.now() - content.cachedAt > CACHE_MAX_AGE) {
          return null;
        }
        return content;
      },

      setSummary: (articleId, summary) =>
        set((state) => compactCacheState({
          ...state,
          summaries: {
            ...state.summaries,
            [articleId]: { ...sanitizeSummary(summary), cachedAt: Date.now() },
          },
        })),

      getSummary: (articleId) => {
        const summary = get().summaries[articleId];
        if (!summary) return null;
        if (Date.now() - summary.cachedAt > CACHE_MAX_AGE) {
          return null;
        }
        return summary;
      },

      setChatMessages: (articleId, messages) =>
        set((state) => compactCacheState({
          ...state,
          chats: {
            ...state.chats,
            [articleId]: { messages: sanitizeChatMessages(messages), updatedAt: Date.now() },
          },
        })),

      addChatMessage: (articleId, message) =>
        set((state) => {
          const existingChat = state.chats[articleId];
          const messages = sanitizeChatMessages(existingChat ? [...existingChat.messages, message] : [message]);
          return compactCacheState({
            ...state,
            chats: {
              ...state.chats,
              [articleId]: { messages, updatedAt: Date.now() },
            },
          });
        }),

      getChatMessages: (articleId) => {
        const chat = get().chats[articleId];
        if (!chat) return [];
        if (Date.now() - chat.updatedAt > CACHE_MAX_AGE) {
          return [];
        }
        return chat.messages;
      },

      clearChat: (articleId) =>
        set((state) => {
          const { [articleId]: _, ...remainingChats } = state.chats;
          return { chats: remainingChats };
        }),

      cleanupOldCache: () =>
        set((state) => compactCacheState(state)),
    }),
    {
      name: 'rss-deck-article-cache',
      version: 2,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => compactCacheState(state),
      migrate: (persistedState) => {
        const state = persistedState as Partial<ArticleCacheState> | undefined;
        return compactCacheState({
          scrapedContent: state?.scrapedContent ?? {},
          summaries: state?.summaries ?? {},
          chats: state?.chats ?? {},
        });
      },
    }
  )
);
