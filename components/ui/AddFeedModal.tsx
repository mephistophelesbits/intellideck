'use client';

import { useRef, useState } from 'react';
import { X, Loader2, Check, Link2, Folder, Plus, Columns, Trash2, Upload, FileText } from 'lucide-react';
import { useDeckStore, DEFAULT_COLUMN_WIDTH } from '@/lib/store';
import { useSettingsStore } from '@/lib/settings-store';
import { categories, Category } from '@/lib/categories';
import { parseOPML, isValidOPML, OPMLFeed } from '@/lib/opml';
import {
  addFeedToColumnRequest,
  createColumnRequest,
  deleteSavedFeedRequest,
  fetchDeckState,
  getOpmlExportUrl,
  updateColumnRequest,
} from '@/lib/deck-client';
import { DeckStateSnapshot, FeedSource } from '@/lib/types';
import { cn, generateId } from '@/lib/utils';

interface AddFeedModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type Tab = 'url' | 'categories' | 'opml';
type TargetType = 'new' | string;

async function getApiError(response: Response, fallback: string) {
  try {
    const data = await response.json();
    if (data?.error && typeof data.error === 'string') {
      return data.error;
    }
  } catch {
    // Ignore JSON parse errors and fall back to the default message.
  }

  return fallback;
}

export function AddFeedModal({ isOpen, onClose }: AddFeedModalProps) {
  const [activeTab, setActiveTab] = useState<Tab>('categories');
  const [url, setUrl] = useState('');
  const [isValidating, setIsValidating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [targetColumn, setTargetColumn] = useState<TargetType>('new');
  const [opmlFeeds, setOpmlFeeds] = useState<OPMLFeed[]>([]);
  const [opmlError, setOpmlError] = useState<string | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const columns = useDeckStore((state) => state.columns);
  const savedFeeds = useDeckStore((state) => state.savedFeeds);
  const setColumns = useDeckStore((state) => state.setColumns);
  const setSavedFeeds = useDeckStore((state) => state.setSavedFeeds);
  const { defaultRefreshInterval, defaultViewMode } = useSettingsStore();

  if (!isOpen) return null;

  const applyDeckState = (deckState: DeckStateSnapshot) => {
    setColumns(deckState.columns);
    setSavedFeeds(deckState.savedFeeds);
  };

  const buildFeed = (feedUrl: string, title: string): FeedSource => ({
    id: generateId(),
    url: feedUrl,
    title,
  });

  const buildColumnPayload = (
    id: string,
    title: string,
    type: 'single-feed' | 'category' | 'unified',
    sources: FeedSource[]
  ) => ({
    id,
    title,
    type,
    sources,
    settings: {
      refreshInterval: defaultRefreshInterval,
      viewMode: defaultViewMode,
    },
    width: DEFAULT_COLUMN_WIDTH,
  });

  const requireTargetColumn = () => {
    const column = columns.find((item) => item.id === targetColumn);
    if (!column) {
      throw new Error('Target column not found');
    }
    return column;
  };

  const handleAddCustomFeed = async () => {
    if (!url.trim()) {
      setError('Please enter a URL');
      return;
    }

    setIsValidating(true);
    setError(null);

    try {
      const res = await fetch(`/api/rss?url=${encodeURIComponent(url)}`);
      if (!res.ok) {
        throw new Error(await getApiError(res, 'Failed to validate feed'));
      }

      const data = await res.json();
      if (data.error) throw new Error(data.error);

      const feedTitle = data.title || 'Custom Feed';
      const feed = buildFeed(url, feedTitle);

      if (targetColumn === 'new') {
        applyDeckState(await createColumnRequest(
          buildColumnPayload(generateId(), feedTitle, 'single-feed', [feed])
        ));
      } else {
        applyDeckState(await addFeedToColumnRequest(targetColumn, feed));
      }

      setUrl('');
      setTargetColumn('new');
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to validate feed. Please check the URL.');
      console.error(err);
    } finally {
      setIsValidating(false);
    }
  };

  const handleAddCategory = async (category: Category) => {
    try {
      const feeds = category.feeds.map((feed) => buildFeed(feed.url, feed.title));

      if (targetColumn === 'new') {
        applyDeckState(await createColumnRequest(
          buildColumnPayload(generateId(), category.name, 'category', feeds)
        ));
      } else {
        const column = requireTargetColumn();
        applyDeckState(await updateColumnRequest(targetColumn, {
          sources: [...column.sources, ...feeds],
        }));
      }

      setTargetColumn('new');
      onClose();
    } catch (error) {
      console.error(error);
    }
  };

  const handleOPMLFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setOpmlError(null);
    setOpmlFeeds([]);

    try {
      const text = await file.text();

      if (!isValidOPML(text)) {
        setOpmlError('Invalid OPML file. Please check the format.');
        return;
      }

      const result = parseOPML(text);

      if (result.feeds.length === 0) {
        setOpmlError('No RSS feeds found in this OPML file.');
        return;
      }

      setOpmlFeeds(result.feeds);
    } catch (err) {
      setOpmlError('Failed to parse OPML file.');
      console.error(err);
    }
  };

  const handleImportOPML = async () => {
    if (opmlFeeds.length === 0) return;

    setIsImporting(true);

    try {
      const sources = opmlFeeds.map((feed) => buildFeed(feed.url, feed.title));

      if (targetColumn === 'new') {
        applyDeckState(await createColumnRequest(
          buildColumnPayload(generateId(), 'Imported Feeds', 'unified', sources)
        ));
      } else {
        const column = requireTargetColumn();
        applyDeckState(await updateColumnRequest(targetColumn, {
          sources: [...column.sources, ...sources],
        }));
      }

      setOpmlFeeds([]);
      setOpmlError(null);
      setTargetColumn('new');
      onClose();
    } catch (error) {
      console.error(error);
    } finally {
      setIsImporting(false);
    }
  };

  const handleImportAsColumns = async () => {
    if (opmlFeeds.length === 0) return;

    setIsImporting(true);

    try {
      const byCategory = new Map<string, OPMLFeed[]>();
      opmlFeeds.forEach((feed) => {
        const category = feed.category || 'Imported';
        if (!byCategory.has(category)) byCategory.set(category, []);
        byCategory.get(category)!.push(feed);
      });

      for (const [category, feeds] of byCategory.entries()) {
        await createColumnRequest(
          buildColumnPayload(
            generateId(),
            category,
            'unified',
            feeds.map((feed) => buildFeed(feed.url, feed.title))
          )
        );
      }

      applyDeckState(await fetchDeckState());
      setOpmlFeeds([]);
      setOpmlError(null);
      onClose();
    } catch (error) {
      console.error(error);
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      <div className="relative bg-background-secondary border border-border rounded-xl w-full max-w-lg mx-4 shadow-2xl max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border flex-shrink-0">
          <h2 className="text-lg font-semibold">Add Feed</h2>
          <button
            onClick={onClose}
            className="p-1 hover:bg-background-tertiary rounded transition-colors text-foreground-secondary hover:text-foreground"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-4 py-3 border-b border-border bg-background-tertiary/50 flex-shrink-0">
          <label className="flex items-center gap-2 text-sm font-medium mb-2">
            <Columns className="w-4 h-4" />
            Add to
          </label>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setTargetColumn('new')}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-sm transition-all',
                targetColumn === 'new'
                  ? 'border-accent bg-accent text-white'
                  : 'border-border hover:border-foreground-secondary'
              )}
            >
              <Plus className="w-3.5 h-3.5" />
              New Column
            </button>
            {columns.map((col) => (
              <button
                key={col.id}
                onClick={() => setTargetColumn(col.id)}
                className={cn(
                  'px-3 py-1.5 rounded-lg border text-sm transition-all truncate max-w-[150px]',
                  targetColumn === col.id
                    ? 'border-accent bg-accent text-white'
                    : 'border-border hover:border-foreground-secondary'
                )}
              >
                {col.title}
              </button>
            ))}
          </div>
        </div>

        <div className="flex border-b border-border flex-shrink-0">
          <button
            onClick={() => setActiveTab('categories')}
            className={cn(
              'flex-1 px-4 py-2.5 text-sm font-medium transition-colors flex items-center justify-center gap-2',
              activeTab === 'categories'
                ? 'text-accent border-b-2 border-accent'
                : 'text-foreground-secondary hover:text-foreground'
            )}
          >
            <Folder className="w-4 h-4" />
            Categories
          </button>
          <button
            onClick={() => setActiveTab('url')}
            className={cn(
              'flex-1 px-4 py-2.5 text-sm font-medium transition-colors flex items-center justify-center gap-2',
              activeTab === 'url'
                ? 'text-accent border-b-2 border-accent'
                : 'text-foreground-secondary hover:text-foreground'
            )}
          >
            <Link2 className="w-4 h-4" />
            Custom URL
          </button>
          <button
            onClick={() => setActiveTab('opml')}
            className={cn(
              'flex-1 px-4 py-2.5 text-sm font-medium transition-colors flex items-center justify-center gap-2',
              activeTab === 'opml'
                ? 'text-accent border-b-2 border-accent'
                : 'text-foreground-secondary hover:text-foreground'
            )}
          >
            <Upload className="w-4 h-4" />
            OPML
          </button>
        </div>

        <div className="p-4 flex-1 overflow-y-auto">
          {activeTab === 'categories' && (
            <div className="grid grid-cols-2 gap-3">
              {categories.map((category) => (
                <button
                  key={category.id}
                  onClick={() => void handleAddCategory(category)}
                  className="flex flex-col items-start p-3 rounded-lg border border-border hover:border-accent hover:bg-background-tertiary transition-all text-left group"
                >
                  <span className="text-2xl mb-2">{category.icon}</span>
                  <span className="font-medium text-sm group-hover:text-accent transition-colors">
                    {category.name}
                  </span>
                  <span className="text-xs text-foreground-secondary mt-0.5">
                    {category.feeds.length} feeds
                  </span>
                </button>
              ))}
            </div>
          )}

          {activeTab === 'url' && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-2">
                  RSS Feed URL
                </label>
                <input
                  type="url"
                  value={url}
                  onChange={(e) => {
                    setUrl(e.target.value);
                    setError(null);
                  }}
                  placeholder="https://example.com/feed.xml"
                  className="w-full px-3 py-2 bg-background border border-border rounded-lg text-foreground placeholder-foreground-secondary focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void handleAddCustomFeed();
                  }}
                />
                {error && (
                  <p className="text-sm text-error mt-2">{error}</p>
                )}
              </div>

              <button
                onClick={() => void handleAddCustomFeed()}
                disabled={isValidating || !url.trim()}
                className="w-full py-2.5 bg-accent hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors flex items-center justify-center gap-2"
              >
                {isValidating ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Validating...
                  </>
                ) : (
                  <>
                    <Check className="w-4 h-4" />
                    {targetColumn === 'new' ? 'Add as New Column' : 'Add to Column'}
                  </>
                )}
              </button>

              {savedFeeds.length > 0 && (
                <div className="mt-6 pt-6 border-t border-border">
                  <div className="flex items-center justify-between gap-3 mb-3">
                    <h3 className="text-sm font-medium">Saved Feeds</h3>
                    <a href={getOpmlExportUrl()} className="text-xs text-accent hover:underline">
                      Export OPML
                    </a>
                  </div>
                  <div className="space-y-2 max-h-[200px] overflow-y-auto">
                    {savedFeeds.map((feed) => (
                      <div
                        key={feed.id}
                        className="flex items-center gap-2 p-2 rounded-lg border border-border hover:bg-background-tertiary group"
                      >
                        <button
                          onClick={() => setUrl(feed.url)}
                          className="flex-1 text-left truncate"
                        >
                          <div className="font-medium text-sm truncate">{feed.title}</div>
                          <div className="text-xs text-foreground-secondary truncate">{feed.url}</div>
                        </button>
                        <button
                          onClick={async () => {
                            try {
                              applyDeckState(await deleteSavedFeedRequest(feed.id));
                            } catch (error) {
                              console.error(error);
                            }
                          }}
                          className="p-1.5 text-foreground-secondary hover:text-error hover:bg-background-secondary rounded opacity-0 group-hover:opacity-100 transition-opacity"
                          title="Delete saved feed"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <p className="text-xs text-foreground-secondary text-center mt-2">
                Enter the URL of any RSS or Atom feed
              </p>
            </div>
          )}

          {activeTab === 'opml' && (
            <div className="space-y-4">
              <div
                className="border-2 border-dashed border-border rounded-lg p-6 text-center hover:border-accent transition-colors cursor-pointer"
                onClick={() => fileInputRef.current?.click()}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".opml,.xml"
                  onChange={handleOPMLFileChange}
                  className="hidden"
                />
                <FileText className="w-10 h-10 mx-auto mb-3 text-foreground-secondary" />
                <p className="text-sm font-medium mb-1">
                  Drop your OPML file here
                </p>
                <p className="text-xs text-foreground-secondary mb-3">
                  or click to browse
                </p>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    fileInputRef.current?.click();
                  }}
                  className="px-4 py-2 bg-accent hover:bg-accent-hover text-white rounded-lg text-sm transition-colors"
                >
                  Select File
                </button>
              </div>

              {opmlError && (
                <p className="text-sm text-error text-center">{opmlError}</p>
              )}

              {opmlFeeds.length > 0 && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">
                      Found {opmlFeeds.length} feeds
                    </span>
                    <button
                      onClick={() => {
                        setOpmlFeeds([]);
                        setOpmlError(null);
                      }}
                      className="text-xs text-foreground-secondary hover:text-foreground"
                    >
                      Clear
                    </button>
                  </div>

                  <div className="bg-background-tertiary rounded-lg p-3 space-y-2 max-h-[200px] overflow-y-auto">
                    {opmlFeeds.slice(0, 10).map((feed, idx) => (
                      <div key={idx} className="text-sm">
                        <span className="font-medium">{feed.title}</span>
                        {feed.category && (
                          <span className="text-xs text-accent ml-2">({feed.category})</span>
                        )}
                        <span className="text-xs text-foreground-secondary block truncate">
                          {feed.url}
                        </span>
                      </div>
                    ))}
                    {opmlFeeds.length > 10 && (
                      <p className="text-xs text-foreground-secondary text-center py-2">
                        ...and {opmlFeeds.length - 10} more
                      </p>
                    )}
                  </div>

                  <div className="flex gap-2">
                    <button
                      onClick={() => void handleImportOPML()}
                      disabled={isImporting}
                      className="flex-1 py-2.5 bg-accent hover:bg-accent-hover disabled:opacity-50 text-white font-medium rounded-lg transition-colors flex items-center justify-center gap-2"
                    >
                      {isImporting ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Check className="w-4 h-4" />
                      )}
                      {targetColumn === 'new' ? 'Import as Column' : 'Add to Column'}
                    </button>
                    {targetColumn === 'new' && (
                      <button
                        onClick={() => void handleImportAsColumns()}
                        disabled={isImporting}
                        className="flex-1 py-2.5 border-2 border-accent hover:bg-accent-hover hover:text-white disabled:opacity-50 text-accent font-medium rounded-lg transition-colors flex items-center justify-center gap-2"
                      >
                        {isImporting ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <Columns className="w-4 h-4" />
                        )}
                        Import as Multiple Columns
                      </button>
                    )}
                  </div>

                  <p className="text-xs text-foreground-secondary text-center">
                    Choose to import all feeds into one column or create separate columns by category
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
