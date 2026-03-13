import { create } from 'zustand';
import { Article } from './types';

interface BookmarksState {
  bookmarks: Article[];
  hydrateBookmarks: (bookmarks: Article[]) => void;
  addBookmark: (article: Article) => void;
  removeBookmark: (articleId: string) => void;
  isBookmarked: (articleId: string) => boolean;
  toggleBookmark: (article: Article) => void;
}

function persistBookmark(article: Article) {
  if (typeof window === 'undefined') return;
  void fetch('/api/bookmarks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(article),
  }).catch((error) => {
    console.error('Failed to save bookmark:', error);
  });
}

function deletePersistedBookmark(articleId: string) {
  if (typeof window === 'undefined') return;
  void fetch(`/api/bookmarks?articleId=${encodeURIComponent(articleId)}`, {
    method: 'DELETE',
  }).catch((error) => {
    console.error('Failed to delete bookmark:', error);
  });
}

export const useBookmarksStore = create<BookmarksState>()((set, get) => ({
  bookmarks: [],
  hydrateBookmarks: (bookmarks) => set({ bookmarks }),

  addBookmark: (article) =>
    set((state) => {
      if (state.bookmarks.some((bookmark) => bookmark.id === article.id)) {
        return state;
      }
      persistBookmark(article);
      return {
        bookmarks: [{ ...article, bookmarked: true }, ...state.bookmarks],
      };
    }),

  removeBookmark: (articleId) =>
    set((state) => {
      deletePersistedBookmark(articleId);
      return {
        bookmarks: state.bookmarks.filter((bookmark) => bookmark.id !== articleId),
      };
    }),

  isBookmarked: (articleId) => {
    return get().bookmarks.some((bookmark) => bookmark.id === articleId);
  },

  toggleBookmark: (article) => {
    const state = get();
    if (state.bookmarks.some((bookmark) => bookmark.id === article.id)) {
      state.removeBookmark(article.id);
    } else {
      state.addBookmark(article);
    }
  },
}));
