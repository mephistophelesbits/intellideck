'use client';

import { useState, useEffect, useCallback } from 'react';
import { Plus, Pencil, X, Check, Trash2, GripVertical, Loader2, ExternalLink, AlertCircle } from 'lucide-react';
import { AppChrome } from '@/components/AppChrome';
import { FeedList, FeedListWithItems } from '@/lib/types';
import { cn } from '@/lib/utils';

export default function ListsPage() {
    const [lists, setLists] = useState<FeedList[]>([]);
    const [selectedListId, setSelectedListId] = useState<string | null>(null);
    const [selectedList, setSelectedList] = useState<FeedListWithItems | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // Editing state
    const [editingListId, setEditingListId] = useState<string | null>(null);
    const [editingName, setEditingName] = useState('');

    // New list creation
    const [isCreatingNew, setIsCreatingNew] = useState(false);
    const [newListName, setNewListName] = useState('');

    // Add feed state
    const [newFeedUrl, setNewFeedUrl] = useState('');
    const [isAddingFeed, setIsAddingFeed] = useState(false);
    const [addFeedError, setAddFeedError] = useState<string | null>(null);

    // Delete error
    const [deleteError, setDeleteError] = useState<string | null>(null);

    const fetchLists = useCallback(async () => {
        try {
            const res = await fetch('/api/lists');
            if (!res.ok) throw new Error('Failed to fetch lists');
            const data = await res.json();
            setLists(data);
            setIsLoading(false);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to load lists');
            setIsLoading(false);
        }
    }, []);

    const fetchListDetail = useCallback(async (listId: string) => {
        try {
            const res = await fetch(`/api/lists/${listId}`);
            if (!res.ok) throw new Error('Failed to fetch list detail');
            const data = await res.json();
            setSelectedList(data);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to load list detail');
        }
    }, []);

    useEffect(() => {
        void fetchLists();
    }, [fetchLists]);

    useEffect(() => {
        if (selectedListId) {
            void fetchListDetail(selectedListId);
        } else {
            setSelectedList(null);
        }
    }, [selectedListId, fetchListDetail]);

    const handleCreateList = async () => {
        if (!newListName.trim()) return;

        try {
            const res = await fetch('/api/lists', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: newListName }),
            });
            if (!res.ok) throw new Error('Failed to create list');

            const newList = await res.json();
            setLists(prev => [...prev, newList]);
            setSelectedListId(newList.id);
            setNewListName('');
            setIsCreatingNew(false);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to create list');
        }
    };

    const handleRenameList = async (listId: string) => {
        if (!editingName.trim()) return;

        try {
            const res = await fetch(`/api/lists/${listId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: editingName }),
            });
            if (!res.ok) throw new Error('Failed to rename list');

            const updatedList = await res.json();
            setLists(prev => prev.map(l => l.id === listId ? updatedList : l));
            setEditingListId(null);
            setEditingName('');

            if (selectedListId === listId) {
                void fetchListDetail(listId);
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to rename list');
        }
    };

    const handleDeleteList = async (listId: string) => {
        try {
            const res = await fetch(`/api/lists/${listId}`, { method: 'DELETE' });
            if (res.status === 409) {
                const data = await res.json();
                setDeleteError(data.error || 'List is in use by columns');
                return;
            }
            if (!res.ok) throw new Error('Failed to delete list');

            setLists(prev => prev.filter(l => l.id !== listId));
            if (selectedListId === listId) {
                setSelectedListId(null);
                setSelectedList(null);
            }
            setDeleteError(null);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to delete list');
        }
    };

    const handleAddFeed = async () => {
        if (!selectedListId || !newFeedUrl.trim()) return;

        setIsAddingFeed(true);
        setAddFeedError(null);

        try {
            const res = await fetch(`/api/lists/${selectedListId}/feeds`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url: newFeedUrl }),
            });
            if (!res.ok) {
                const data = await res.json();
                throw new Error(data.error || 'Failed to add feed');
            }

            setNewFeedUrl('');
            void fetchListDetail(selectedListId);
            void fetchLists();
        } catch (err) {
            setAddFeedError(err instanceof Error ? err.message : 'Failed to add feed');
        } finally {
            setIsAddingFeed(false);
        }
    };

    const handleRemoveFeed = async (feedId: string) => {
        if (!selectedListId) return;

        try {
            const res = await fetch(`/api/lists/${selectedListId}/feeds/${feedId}`, {
                method: 'DELETE',
            });
            if (!res.ok) throw new Error('Failed to remove feed');

            void fetchListDetail(selectedListId);
            void fetchLists();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to remove feed');
        }
    };

    const getDomain = (url: string) => {
        try {
            return new URL(url).hostname;
        } catch {
            return url;
        }
    };

    return (
        <AppChrome showAddFeedAction={false}>
            <div className="flex h-full overflow-hidden">
                {/* Left Panel - List Directory */}
                <div className="w-72 border-r border-border flex flex-col bg-background-secondary flex-shrink-0">
                    <div className="p-4 border-b border-border">
                        <div className="flex items-center justify-between mb-3">
                            <h2 className="font-semibold">Sources & Lists</h2>
                            <button
                                onClick={() => setIsCreatingNew(true)}
                                className="p-1.5 hover:bg-background-tertiary rounded-lg transition-colors text-foreground-secondary hover:text-foreground"
                                title="Create new list"
                            >
                                <Plus className="w-4 h-4" />
                            </button>
                        </div>

                        {isCreatingNew && (
                            <div className="flex gap-2 mb-3">
                                <input
                                    type="text"
                                    value={newListName}
                                    onChange={(e) => setNewListName(e.target.value)}
                                    placeholder="List name"
                                    className="flex-1 px-2 py-1.5 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-accent"
                                    autoFocus
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter') void handleCreateList();
                                        if (e.key === 'Escape') {
                                            setIsCreatingNew(false);
                                            setNewListName('');
                                        }
                                    }}
                                />
                                <button
                                    onClick={() => void handleCreateList()}
                                    disabled={!newListName.trim()}
                                    className="p-1.5 bg-accent hover:bg-accent-hover disabled:opacity-50 text-white rounded-lg transition-colors"
                                >
                                    <Check className="w-4 h-4" />
                                </button>
                                <button
                                    onClick={() => {
                                        setIsCreatingNew(false);
                                        setNewListName('');
                                    }}
                                    className="p-1.5 hover:bg-background-tertiary rounded-lg transition-colors text-foreground-secondary"
                                >
                                    <X className="w-4 h-4" />
                                </button>
                            </div>
                        )}
                    </div>

                    <div className="flex-1 overflow-y-auto">
                        {isLoading ? (
                            <div className="flex items-center justify-center h-32">
                                <Loader2 className="w-6 h-6 animate-spin text-accent" />
                            </div>
                        ) : lists.length === 0 ? (
                            <div className="flex flex-col items-center justify-center h-32 text-foreground-secondary px-4">
                                <p className="text-sm text-center">No feed lists yet</p>
                                <p className="text-xs mt-1">Create one to organize your feeds</p>
                            </div>
                        ) : (
                            <div className="divide-y divide-border">
                                {lists.map((list) => (
                                    <div key={list.id}>
                                        {editingListId === list.id ? (
                                            <div className="p-3 bg-background-tertiary">
                                                <div className="flex gap-2">
                                                    <input
                                                        type="text"
                                                        value={editingName}
                                                        onChange={(e) => setEditingName(e.target.value)}
                                                        className="flex-1 px-2 py-1 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-accent"
                                                        autoFocus
                                                        onKeyDown={(e) => {
                                                            if (e.key === 'Enter') void handleRenameList(list.id);
                                                            if (e.key === 'Escape') setEditingListId(null);
                                                        }}
                                                    />
                                                    <button
                                                        onClick={() => void handleRenameList(list.id)}
                                                        className="p-1 bg-accent hover:bg-accent-hover text-white rounded transition-colors"
                                                    >
                                                        <Check className="w-3.5 h-3.5" />
                                                    </button>
                                                    <button
                                                        onClick={() => setEditingListId(null)}
                                                        className="p-1 hover:bg-background rounded transition-colors text-foreground-secondary"
                                                    >
                                                        <X className="w-3.5 h-3.5" />
                                                    </button>
                                                </div>
                                            </div>
                                        ) : (
                                            <button
                                                onClick={() => setSelectedListId(list.id)}
                                                className={cn(
                                                    'w-full p-3 text-left hover:bg-background-tertiary transition-colors group relative',
                                                    selectedListId === list.id && 'bg-accent/10 border-l-2 border-l-accent'
                                                )}
                                            >
                                                <div className="flex items-center justify-between">
                                                    <div className="min-w-0 flex-1">
                                                        <div className="font-medium text-sm truncate">{list.name}</div>
                                                        <div className="text-xs text-foreground-secondary">
                                                            {list.feedCount} {list.feedCount === 1 ? 'feed' : 'feeds'}
                                                        </div>
                                                    </div>
                                                    <button
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            setEditingListId(list.id);
                                                            setEditingName(list.name);
                                                        }}
                                                        className="p-1 opacity-0 group-hover:opacity-100 hover:bg-background rounded transition-all text-foreground-secondary hover:text-foreground"
                                                    >
                                                        <Pencil className="w-3.5 h-3.5" />
                                                    </button>
                                                </div>
                                            </button>
                                        )}
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>

                {/* Right Panel - Selected List Detail */}
                <div className="flex-1 flex flex-col min-w-0">
                    {selectedList ? (
                        <>
                            <div className="p-4 border-b border-border bg-background-secondary">
                                <div className="flex items-center justify-between">
                                    <div>
                                        <h2 className="text-lg font-semibold">{selectedList.name}</h2>
                                        <p className="text-sm text-foreground-secondary">
                                            {selectedList.feedCount} {selectedList.feedCount === 1 ? 'feed' : 'feeds'}
                                        </p>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <button
                                            onClick={() => {
                                                // Navigate to deck to use Add Feed Modal with this list
                                                // TODO: Implement proper modal integration with parent component
                                                window.location.href = '/?createColumnFromList=' + selectedListId;
                                            }}
                                            className="px-3 py-1.5 text-sm bg-accent hover:bg-accent-hover text-white rounded-lg transition-colors"
                                            title="Navigate to deck to create a column from this list"
                                        >
                                            Use in New Column →
                                        </button>
                                        <button
                                            onClick={() => void handleDeleteList(selectedList.id)}
                                            className="p-1.5 hover:bg-background-tertiary rounded-lg transition-colors text-foreground-secondary hover:text-error"
                                            title="Delete list"
                                        >
                                            <Trash2 className="w-4 h-4" />
                                        </button>
                                    </div>
                                </div>

                                {deleteError && (
                                    <div className="mt-3 p-2 bg-error/10 border border-error/30 rounded-lg flex items-center gap-2 text-error text-sm">
                                        <AlertCircle className="w-4 h-4 flex-shrink-0" />
                                        {deleteError}
                                        <button
                                            onClick={() => setDeleteError(null)}
                                            className="ml-auto p-1 hover:bg-error/20 rounded transition-colors"
                                        >
                                            <X className="w-3 h-3" />
                                        </button>
                                    </div>
                                )}
                            </div>

                            {/* Add Feed */}
                            <div className="p-4 border-b border-border">
                                <div className="flex gap-2">
                                    <input
                                        type="url"
                                        value={newFeedUrl}
                                        onChange={(e) => {
                                            setNewFeedUrl(e.target.value);
                                            setAddFeedError(null);
                                        }}
                                        placeholder="Paste feed URL"
                                        className="flex-1 px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-accent"
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter') void handleAddFeed();
                                        }}
                                    />
                                    <button
                                        onClick={() => void handleAddFeed()}
                                        disabled={isAddingFeed || !newFeedUrl.trim()}
                                        className="px-4 py-2 bg-accent hover:bg-accent-hover disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors flex items-center gap-2"
                                    >
                                        {isAddingFeed ? (
                                            <Loader2 className="w-4 h-4 animate-spin" />
                                        ) : (
                                            <>
                                                <Plus className="w-4 h-4" />
                                                Add
                                            </>
                                        )}
                                    </button>
                                </div>
                                {addFeedError && (
                                    <p className="text-sm text-error mt-2">{addFeedError}</p>
                                )}
                            </div>

                            {/* Feed List */}
                            <div className="flex-1 overflow-y-auto">
                                {selectedList.items.length === 0 ? (
                                    <div className="flex flex-col items-center justify-center h-64 text-foreground-secondary">
                                        <p className="text-sm">No feeds in this list</p>
                                        <p className="text-xs mt-1">Add feeds using the input above</p>
                                    </div>
                                ) : (
                                    <div className="divide-y divide-border">
                                        {selectedList.items.map((item) => (
                                            <div
                                                key={item.id}
                                                className="flex items-center gap-3 p-3 hover:bg-background-secondary group transition-colors"
                                            >
                                                <div className="cursor-grab opacity-0 group-hover:opacity-100 transition-opacity text-foreground-secondary">
                                                    <GripVertical className="w-4 h-4" />
                                                </div>
                                                <div className="w-2 h-2 rounded-full flex-shrink-0"
                                                    style={{
                                                        backgroundColor: item.lastError ? '#ef4444' : item.lastFetchedAt ? '#22c55e' : '#6b7280'
                                                    }}
                                                    title={item.lastError || (item.lastFetchedAt ? 'Healthy' : 'Not yet fetched')}
                                                />
                                                <div className="flex-1 min-w-0">
                                                    <div className="font-medium text-sm truncate">{item.title}</div>
                                                    <div className="text-xs text-foreground-secondary truncate">{getDomain(item.url)}</div>
                                                </div>
                                                <a
                                                    href={item.url}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="p-1.5 opacity-0 group-hover:opacity-100 hover:bg-background-tertiary rounded transition-all text-foreground-secondary hover:text-foreground"
                                                    title="Open feed URL"
                                                >
                                                    <ExternalLink className="w-4 h-4" />
                                                </a>
                                                <button
                                                    onClick={() => void handleRemoveFeed(item.id)}
                                                    className="p-1.5 opacity-0 group-hover:opacity-100 hover:bg-background-tertiary rounded transition-all text-foreground-secondary hover:text-error"
                                                    title="Remove feed"
                                                >
                                                    <X className="w-4 h-4" />
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>

                            {/* Footer */}
                            <div className="p-3 border-t border-border bg-background-secondary text-xs text-foreground-secondary">
                                Used by {selectedList.feedCount} column{selectedList.feedCount !== 1 ? 's' : ''}
                            </div>
                        </>
                    ) : (
                        <div className="flex-1 flex flex-col items-center justify-center text-foreground-secondary">
                            <p className="text-lg font-medium mb-2">No List Selected</p>
                            <p className="text-sm">Select a list from the left panel to view its details</p>
                        </div>
                    )}
                </div>
            </div>
        </AppChrome>
    );
}
