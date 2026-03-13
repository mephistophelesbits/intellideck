import { create } from 'zustand';
import { Column, FeedSource } from './types';
import { DEFAULT_COLUMNS } from './default-deck';

export const DEFAULT_COLUMN_WIDTH = 350;
export const MIN_COLUMN_WIDTH = 280;
export const MAX_COLUMN_WIDTH = 600;

interface DeckState {
  columns: Column[];
  setColumns: (columns: Column[]) => void;
  addColumn: (column: Column) => void;
  removeColumn: (columnId: string) => void;
  updateColumn: (columnId: string, updates: Partial<Column>) => void;
  setColumnWidth: (columnId: string, width: number) => void;
  addFeedToColumn: (columnId: string, feed: FeedSource) => void;
  removeFeedFromColumn: (columnId: string, feedId: string) => void;
  moveColumn: (fromIndex: number, toIndex: number) => void;
  reorderColumns: (newOrder: string[]) => void;

  // Custom Feeds persistence
  savedFeeds: FeedSource[];
  setSavedFeeds: (feeds: FeedSource[]) => void;
  addSavedFeed: (feed: FeedSource) => void;
  removeSavedFeed: (feedId: string) => void;
  updateSavedFeed: (feedId: string, updates: Partial<FeedSource>) => void;
}

export const useDeckStore = create<DeckState>()(
  (set) => ({
      columns: DEFAULT_COLUMNS,
      savedFeeds: [],

      setColumns: (columns) =>
        set({
          columns: columns.map((column) => ({
            ...column,
            width: column.width || DEFAULT_COLUMN_WIDTH,
          })),
        }),

      setSavedFeeds: (feeds) => set({ savedFeeds: feeds }),

      addSavedFeed: (feed) =>
        set((state) => {
          // Prevent duplicates by URL
          if (state.savedFeeds.some(f => f.url === feed.url)) return state;
          return { savedFeeds: [feed, ...state.savedFeeds] };
        }),

      removeSavedFeed: (feedId) =>
        set((state) => ({
          savedFeeds: state.savedFeeds.filter((f) => f.id !== feedId),
        })),

      updateSavedFeed: (feedId, updates) =>
        set((state) => ({
          savedFeeds: state.savedFeeds.map((f) =>
            f.id === feedId ? { ...f, ...updates } : f
          ),
        })),

      addColumn: (column) =>
        set((state) => ({
          columns: [...state.columns, { ...column, width: column.width || DEFAULT_COLUMN_WIDTH }],
        })),

      removeColumn: (columnId) =>
        set((state) => ({
          columns: state.columns.filter((col) => col.id !== columnId),
        })),



      updateColumn: (columnId, updates) =>
        set((state) => ({
          columns: state.columns.map((col) =>
            col.id === columnId ? { ...col, ...updates } : col
          ),
        })),

      setColumnWidth: (columnId, width) =>
        set((state) => ({
          columns: state.columns.map((col) =>
            col.id === columnId
              ? { ...col, width: Math.max(MIN_COLUMN_WIDTH, Math.min(MAX_COLUMN_WIDTH, width)) }
              : col
          ),
        })),

      addFeedToColumn: (columnId, feed) =>
        set((state) => ({
          columns: state.columns.map((col) =>
            col.id === columnId
              ? { ...col, sources: [...col.sources, feed] }
              : col
          ),
        })),

      removeFeedFromColumn: (columnId, feedId) =>
        set((state) => ({
          columns: state.columns.map((col) =>
            col.id === columnId
              ? { ...col, sources: col.sources.filter((f) => f.id !== feedId) }
              : col
          ),
        })),

      moveColumn: (fromIndex, toIndex) =>
        set((state) => {
          const newColumns = [...state.columns];
          const [removed] = newColumns.splice(fromIndex, 1);
          newColumns.splice(toIndex, 0, removed);
          return { columns: newColumns };
        }),

      reorderColumns: (newOrder) =>
        set((state) => {
          const columnMap = new Map(state.columns.map((col) => [col.id, col]));
          const reorderedColumns = newOrder
            .map((id) => columnMap.get(id))
            .filter((col): col is Column => col !== undefined);
          return { columns: reorderedColumns };
        }),
    })
);
