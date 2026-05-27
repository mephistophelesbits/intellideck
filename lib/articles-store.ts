import { create } from 'zustand';
import { Article } from './types';

interface ArticlesState {
  // Map of columnId -> articles
  articlesByColumn: Map<string, Article[]>;
  // Map of articleId -> columnId for quick lookup
  articleToColumn: Map<string, string>;

  setColumnArticles: (columnId: string, articles: Article[]) => void;
  removeColumnArticles: (columnId: string) => void;
  cleanupStaleColumns: (activeColumnIds: string[]) => void;
  getColumnArticles: (columnId: string) => Article[];
  getColumnForArticle: (articleId: string) => string | undefined;
}

export const useArticlesStore = create<ArticlesState>((set, get) => ({
  articlesByColumn: new Map(),
  articleToColumn: new Map(),

  setColumnArticles: (columnId, articles) =>
    set((state) => {
      const newArticlesByColumn = new Map(state.articlesByColumn);
      newArticlesByColumn.set(columnId, articles);

      const newArticleToColumn = new Map(state.articleToColumn);
      state.articlesByColumn.get(columnId)?.forEach((article) => {
        if (newArticleToColumn.get(article.id) === columnId) {
          newArticleToColumn.delete(article.id);
        }
      });
      articles.forEach((article) => {
        newArticleToColumn.set(article.id, columnId);
      });

      return {
        articlesByColumn: newArticlesByColumn,
        articleToColumn: newArticleToColumn
      };
    }),

  removeColumnArticles: (columnId) =>
    set((state) => {
      const newArticlesByColumn = new Map(state.articlesByColumn);
      newArticlesByColumn.delete(columnId);

      // Rebuild articleToColumn map
      const newArticleToColumn = new Map<string, string>();
      newArticlesByColumn.forEach((columnArticles, colId) => {
        columnArticles.forEach((article) => {
          newArticleToColumn.set(article.id, colId);
        });
      });

      return {
        articlesByColumn: newArticlesByColumn,
        articleToColumn: newArticleToColumn
      };
    }),

  cleanupStaleColumns: (activeColumnIds) =>
    set((state) => {
      const activeSet = new Set(activeColumnIds);
      const newArticlesByColumn = new Map<string, Article[]>();
      state.articlesByColumn.forEach((columnArticles, colId) => {
        if (activeSet.has(colId)) {
          newArticlesByColumn.set(colId, columnArticles);
        }
      });

      const newArticleToColumn = new Map<string, string>();
      newArticlesByColumn.forEach((columnArticles, colId) => {
        columnArticles.forEach((article) => {
          newArticleToColumn.set(article.id, colId);
        });
      });

      return {
        articlesByColumn: newArticlesByColumn,
        articleToColumn: newArticleToColumn,
      };
    }),

  getColumnArticles: (columnId) => {
    return get().articlesByColumn.get(columnId) || [];
  },

  getColumnForArticle: (articleId) => {
    return get().articleToColumn.get(articleId);
  },
}));
