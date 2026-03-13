'use client';

import { useState, useRef } from 'react';
import { X, Loader2, Check, Link2, Folder, Upload, FileText } from 'lucide-react';
import { useDeckStore, DEFAULT_COLUMN_WIDTH } from '@/lib/store';
import { useSettingsStore } from '@/lib/settings-store';
import { categories, Category } from '@/lib/categories';
import { parseOPML, isValidOPML, OPMLFeed } from '@/lib/opml';
import { cn, generateId } from '@/lib/utils';

interface AddColumnModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type Tab = 'url' | 'categories' | 'opml';

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

export function AddColumnModal({ isOpen, onClose }: AddColumnModalProps) {
  const [activeTab, setActiveTab] = useState<Tab>('categories');
  const [url, setUrl] = useState('');
  const [isValidating, setIsValidating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // OPML state
  const [opmlFeeds, setOpmlFeeds] = useState<OPMLFeed[]>([]);
  const [opmlError, setOpmlError] = useState<string | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const addColumn = useDeckStore((state) => state.addColumn);
  const { defaultRefreshInterval, defaultViewMode } = useSettingsStore();

  if (!isOpen) return null;

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

      addColumn({
        id: generateId(),
        title: data.title || 'Custom Feed',
        type: 'single-feed',
        sources: [
          {
            id: generateId(),
            url: url,
            title: data.title || 'Custom Feed',
          },
        ],
        settings: {
          refreshInterval: defaultRefreshInterval,
          viewMode: defaultViewMode,
        },
        width: DEFAULT_COLUMN_WIDTH,
      });

      setUrl('');
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to validate feed. Please check the URL.');
      console.error(err);
    } finally {
      setIsValidating(false);
    }
  };

  const handleAddCategory = (category: Category) => {
    addColumn({
      id: generateId(),
      title: category.name,
      type: 'category',
      sources: category.feeds.map((feed) => ({
        ...feed,
        id: generateId(),
      })),
      settings: {
        refreshInterval: defaultRefreshInterval,
        viewMode: defaultViewMode,
      },
      width: DEFAULT_COLUMN_WIDTH,
    });
    onClose();
  };

  // OPML Import Handlers
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

  const handleImportOPML = () => {
    if (opmlFeeds.length === 0) return;

    setIsImporting(true);

    // Add all feeds as a single column
    addColumn({
      id: generateId(),
      title: 'Imported Feeds',
      type: 'unified',
      sources: opmlFeeds.map((feed) => ({
        id: generateId(),
        url: feed.url,
        title: feed.title,
      })),
      settings: {
        refreshInterval: defaultRefreshInterval,
        viewMode: defaultViewMode,
      },
      width: DEFAULT_COLUMN_WIDTH,
    });

    setIsImporting(false);
    setOpmlFeeds([]);
    onClose();
  };

  const handleImportAllAsColumns = () => {
    if (opmlFeeds.length === 0) return;

    setIsImporting(true);

    // Group by category
    const byCategory = new Map<string, OPMLFeed[]>();
    opmlFeeds.forEach((feed) => {
      const cat = feed.category || 'Imported';
      if (!byCategory.has(cat)) byCategory.set(cat, []);
      byCategory.get(cat)!.push(feed);
    });

    // Add each category as a column
    byCategory.forEach((feeds, category) => {
      addColumn({
        id: generateId(),
        title: category,
        type: 'category',
        sources: feeds.map((feed) => ({
          id: generateId(),
          url: feed.url,
          title: feed.title,
        })),
        settings: {
          refreshInterval: defaultRefreshInterval,
          viewMode: defaultViewMode,
        },
        width: DEFAULT_COLUMN_WIDTH,
      });
    });

    setIsImporting(false);
    setOpmlFeeds([]);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative bg-background-secondary border border-border rounded-xl w-full max-w-lg mx-4 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h2 className="text-lg font-semibold">Add Column</h2>
          <button
            onClick={onClose}
            className="p-1 hover:bg-background-tertiary rounded transition-colors text-foreground-secondary hover:text-foreground"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-border">
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
            OPML Import
          </button>
        </div>

        {/* Content */}
        <div className="p-4">
          {activeTab === 'categories' && (
            <div className="grid grid-cols-2 gap-3">
              {categories.map((category) => (
                <button
                  key={category.id}
                  onClick={() => handleAddCategory(category)}
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
                    if (e.key === 'Enter') handleAddCustomFeed();
                  }}
                />
                {error && (
                  <p className="text-sm text-error mt-2">{error}</p>
                )}
              </div>

              <button
                onClick={handleAddCustomFeed}
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
                    Add Feed
                  </>
                )}
              </button>

              <p className="text-xs text-foreground-secondary text-center">
                Enter the URL of any RSS or Atom feed
              </p>
            </div>
          )}

          {activeTab === 'opml' && (
            /* OPML Import Tab */
            <div className="space-y-4">
              <div className="border-2 border-dashed border-border rounded-lg p-6 text-center hover:border-accent transition-colors">
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
                  onClick={() => fileInputRef.current?.click()}
                  className="px-4 py-2 bg-background-tertiary hover:bg-border text-sm font-medium rounded-lg transition-colors"
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

                  <div className="max-h-48 overflow-y-auto space-y-2 border border-border rounded-lg p-3">
                    {opmlFeeds.slice(0, 10).map((feed, idx) => (
                      <div key={idx} className="text-sm">
                        <span className="font-medium">{feed.title}</span>
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
                      onClick={handleImportOPML}
                      disabled={isImporting}
                      className="flex-1 py-2.5 bg-accent hover:bg-accent-hover disabled:opacity-50 text-white font-medium rounded-lg transition-colors flex items-center justify-center gap-2"
                    >
                      {isImporting ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Check className="w-4 h-4" />
                      )}
                      Add as One Column
                    </button>
                    <button
                      onClick={handleImportAllAsColumns}
                      disabled={isImporting}
                      className="flex-1 py-2.5 bg-background-tertiary hover:bg-border disabled:opacity-50 font-medium rounded-lg transition-colors"
                    >
                      Split by Category
                    </button>
                  </div>
                </div>
              )}

              <p className="text-xs text-foreground-secondary text-center">
                Import feeds from Feedly, Inoreader, Google Reader, etc.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
