'use client';

import { useState, useRef, useEffect } from 'react';
import { Settings, Eye, Clock, Pencil, Check, X, Rss, Trash2, Plus, Loader2 } from 'lucide-react';
import { Column, FeedSource } from '@/lib/types';
import { useDeckStore } from '@/lib/store';
import {
  addFeedToColumnRequest,
  removeFeedFromColumnRequest,
  updateColumnRequest,
  updateFeedInColumnRequest,
} from '@/lib/deck-client';
import { cn, generateId } from '@/lib/utils';

interface ColumnSettingsMenuProps {
  column: Column;
}

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

export function ColumnSettingsMenu({ column }: ColumnSettingsMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isRenaming, setIsRenaming] = useState(false);
  const [newTitle, setNewTitle] = useState(column.title);
  const [showSources, setShowSources] = useState(false);
  const [editingSourceId, setEditingSourceId] = useState<string | null>(null);
  const [editingSourceUrl, setEditingSourceUrl] = useState('');
  const [editingSourceTitle, setEditingSourceTitle] = useState('');
  const [isAddingSource, setIsAddingSource] = useState(false);
  const [newSourceUrl, setNewSourceUrl] = useState('');
  const [isValidating, setIsValidating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const setColumns = useDeckStore((state) => state.setColumns);
  const setSavedFeeds = useDeckStore((state) => state.setSavedFeeds);

  const applyDeckState = (deckState: { columns: Column[]; savedFeeds: FeedSource[] }) => {
    setColumns(deckState.columns);
    setSavedFeeds(deckState.savedFeeds);
  };

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        setIsRenaming(false);
        setShowSources(false);
        setEditingSourceId(null);
        setIsAddingSource(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  // Focus input when renaming
  useEffect(() => {
    if (isRenaming && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isRenaming]);

  const handleRename = async () => {
    if (newTitle.trim() && newTitle !== column.title) {
      applyDeckState(await updateColumnRequest(column.id, { title: newTitle.trim() }));
    }
    setIsRenaming(false);
  };

  const handleViewModeChange = async (mode: 'compact' | 'comfortable') => {
    applyDeckState(await updateColumnRequest(column.id, {
      settings: { ...column.settings, viewMode: mode },
    }));
  };

  const handleRefreshIntervalChange = async (interval: number) => {
    applyDeckState(await updateColumnRequest(column.id, {
      settings: { ...column.settings, refreshInterval: interval },
    }));
  };

  const handleEditSource = (source: FeedSource) => {
    setEditingSourceId(source.id);
    setEditingSourceUrl(source.url);
    setEditingSourceTitle(source.title);
  };

  const handleSaveSourceEdit = async () => {
    if (!editingSourceId || !editingSourceUrl.trim()) return;

    applyDeckState(await updateFeedInColumnRequest(column.id, editingSourceId, {
      url: editingSourceUrl.trim(),
      title: editingSourceTitle.trim() || undefined,
    }));
    setEditingSourceId(null);
  };

  const handleDeleteSource = async (sourceId: string) => {
    applyDeckState(await removeFeedFromColumnRequest(column.id, sourceId));
  };

  const handleAddSource = async () => {
    if (!newSourceUrl.trim()) {
      setError('Please enter a URL');
      return;
    }

    setIsValidating(true);
    setError(null);

    try {
      const res = await fetch(`/api/rss?url=${encodeURIComponent(newSourceUrl)}`);
      if (!res.ok) {
        throw new Error(await getApiError(res, 'Failed to validate feed'));
      }

      const data = await res.json();
      if (data.error) throw new Error(data.error);

      applyDeckState(await addFeedToColumnRequest(column.id, {
        id: generateId(),
        url: newSourceUrl,
        title: data.title || 'Custom Feed',
      }));

      setNewSourceUrl('');
      setIsAddingSource(false);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to validate feed');
      console.error(err);
    } finally {
      setIsValidating(false);
    }
  };

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="p-1.5 hover:bg-background-secondary rounded transition-colors text-foreground-secondary hover:text-foreground"
        title="Column Settings"
      >
        <Settings className="w-4 h-4" />
      </button>

      {isOpen && (
        <div className="absolute right-0 top-full mt-1 w-72 bg-background-tertiary border border-border rounded-lg shadow-xl z-50 overflow-hidden max-h-[70vh] overflow-y-auto">
          {/* Rename Section */}
          <div className="p-2 border-b border-border">
            {isRenaming ? (
              <div className="flex items-center gap-1">
                <input
                  ref={inputRef}
                  type="text"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void handleRename();
                    if (e.key === 'Escape') {
                      setNewTitle(column.title);
                      setIsRenaming(false);
                    }
                  }}
                  className="flex-1 px-2 py-1 text-sm bg-background border border-border rounded focus:outline-none focus:ring-1 focus:ring-accent"
                />
                <button
                  onClick={() => void handleRename()}
                  className="p-1 hover:bg-background rounded text-success"
                >
                  <Check className="w-4 h-4" />
                </button>
                <button
                  onClick={() => {
                    setNewTitle(column.title);
                    setIsRenaming(false);
                  }}
                  className="p-1 hover:bg-background rounded text-error"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <button
                onClick={() => setIsRenaming(true)}
                className="w-full flex items-center gap-2 px-2 py-1.5 text-sm hover:bg-background rounded transition-colors"
              >
                <Pencil className="w-4 h-4" />
                Rename Column
              </button>
            )}
          </div>

          {/* Sources Section */}
          <div className="p-2 border-b border-border">
            <button
              onClick={() => setShowSources(!showSources)}
              className="w-full flex items-center justify-between px-2 py-1.5 text-sm hover:bg-background rounded transition-colors"
            >
              <div className="flex items-center gap-2">
                <Rss className="w-4 h-4" />
                Manage Sources ({column.sources.length})
              </div>
              <span className="text-xs text-foreground-secondary">
                {showSources ? '▲' : '▼'}
              </span>
            </button>

            {showSources && (
              <div className="mt-2 space-y-1">
                {column.sources.map((source) => (
                  <div key={source.id} className="bg-background rounded p-2">
                    {editingSourceId === source.id ? (
                      <div className="space-y-2">
                        <input
                          type="text"
                          value={editingSourceTitle}
                          onChange={(e) => setEditingSourceTitle(e.target.value)}
                          placeholder="Feed title"
                          className="w-full px-2 py-1 text-xs bg-background-tertiary border border-border rounded focus:outline-none focus:ring-1 focus:ring-accent"
                        />
                        <input
                          type="url"
                          value={editingSourceUrl}
                          onChange={(e) => setEditingSourceUrl(e.target.value)}
                          placeholder="Feed URL"
                          className="w-full px-2 py-1 text-xs bg-background-tertiary border border-border rounded focus:outline-none focus:ring-1 focus:ring-accent"
                        />
                        <div className="flex justify-end gap-1">
                          <button
                            onClick={() => void handleSaveSourceEdit()}
                            className="p-1 hover:bg-background-tertiary rounded text-success"
                          >
                            <Check className="w-3 h-3" />
                          </button>
                          <button
                            onClick={() => setEditingSourceId(null)}
                            className="p-1 hover:bg-background-tertiary rounded text-error"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center justify-between">
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium truncate">{source.title}</p>
                          <p className="text-xs text-foreground-secondary truncate">{source.url}</p>
                        </div>
                        <div className="flex items-center gap-1 ml-2">
                          <button
                            onClick={() => handleEditSource(source)}
                            className="p-1 hover:bg-background-tertiary rounded text-foreground-secondary hover:text-foreground"
                          >
                            <Pencil className="w-3 h-3" />
                          </button>
                          <button
                            onClick={() => void handleDeleteSource(source.id)}
                            className="p-1 hover:bg-background-tertiary rounded text-foreground-secondary hover:text-error"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}

                {/* Add New Source */}
                {isAddingSource ? (
                  <div className="bg-background rounded p-2 space-y-2">
                    <input
                      type="url"
                      value={newSourceUrl}
                      onChange={(e) => {
                        setNewSourceUrl(e.target.value);
                        setError(null);
                      }}
                      placeholder="https://example.com/feed.xml"
                      className="w-full px-2 py-1 text-xs bg-background-tertiary border border-border rounded focus:outline-none focus:ring-1 focus:ring-accent"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') void handleAddSource();
                        if (e.key === 'Escape') {
                          setIsAddingSource(false);
                          setNewSourceUrl('');
                        }
                      }}
                    />
                    {error && <p className="text-xs text-error">{error}</p>}
                    <div className="flex justify-end gap-1">
                      <button
                        onClick={() => void handleAddSource()}
                        disabled={isValidating}
                        className="p-1 hover:bg-background-tertiary rounded text-success disabled:opacity-50"
                      >
                        {isValidating ? (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        ) : (
                          <Check className="w-3 h-3" />
                        )}
                      </button>
                      <button
                        onClick={() => {
                          setIsAddingSource(false);
                          setNewSourceUrl('');
                          setError(null);
                        }}
                        className="p-1 hover:bg-background-tertiary rounded text-error"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => setIsAddingSource(true)}
                    className="w-full flex items-center gap-2 px-2 py-1.5 text-xs hover:bg-background rounded transition-colors text-accent"
                  >
                    <Plus className="w-3 h-3" />
                    Add Source
                  </button>
                )}
              </div>
            )}
          </div>

          {/* View Mode */}
          <div className="p-2 border-b border-border">
            <div className="flex items-center gap-2 px-2 py-1 text-xs text-foreground-secondary">
              <Eye className="w-3 h-3" />
              View Mode
            </div>
            <div className="flex gap-1 mt-1">
              <button
                onClick={() => void handleViewModeChange('comfortable')}
                className={cn(
                  'flex-1 px-2 py-1 text-xs rounded transition-colors',
                  column.settings.viewMode === 'comfortable'
                    ? 'bg-accent text-white'
                    : 'hover:bg-background'
                )}
              >
                Comfortable
              </button>
              <button
                onClick={() => void handleViewModeChange('compact')}
                className={cn(
                  'flex-1 px-2 py-1 text-xs rounded transition-colors',
                  column.settings.viewMode === 'compact'
                    ? 'bg-accent text-white'
                    : 'hover:bg-background'
                )}
              >
                Compact
              </button>
            </div>
          </div>

          {/* Refresh Interval */}
          <div className="p-2">
            <div className="flex items-center gap-2 px-2 py-1 text-xs text-foreground-secondary">
              <Clock className="w-3 h-3" />
              Refresh Interval
            </div>
            <div className="flex flex-wrap gap-1 mt-1">
              {[5, 10, 15, 30].map((mins) => (
                <button
                  key={mins}
                  onClick={() => void handleRefreshIntervalChange(mins)}
                  className={cn(
                    'px-2 py-1 text-xs rounded transition-colors',
                    column.settings.refreshInterval === mins
                      ? 'bg-accent text-white'
                      : 'hover:bg-background'
                  )}
                >
                  {mins}m
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
