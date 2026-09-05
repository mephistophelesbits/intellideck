'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Column } from '@/components/deck/Column';
import { ReadingColumn } from '@/components/deck/ReadingColumn';
import { AppChrome } from '@/components/AppChrome';
import { useArticlesStore } from '@/lib/articles-store';
import { useReadArticlesStore } from '@/lib/read-articles-store';
import { useDeckStore } from '@/lib/store';
import { Article } from '@/lib/types';
import { Plus, BookOpen } from 'lucide-react';
import { cn } from '@/lib/utils';

export function Dashboard() {
    const [selectedArticle, setSelectedArticle] = useState<Article | null>(null);
    const [refreshAllTrigger, setRefreshAllTrigger] = useState(0);
    const [selectedColumnId, setSelectedColumnId] = useState<string | null>(null);
    const [middleWidth, setMiddleWidth] = useState(480);
    const isResizingRef = useRef(false);
    const resizeStartXRef = useRef(0);
    const resizeStartWidthRef = useRef(0);

    const columns = useDeckStore((state) => state.columns);
    const articlesByColumn = useArticlesStore((state) => state.articlesByColumn);
    const { isRead } = useReadArticlesStore();
    const articleToColumn = useArticlesStore((state) => state.articleToColumn);

    const effectiveSelectedColumnId = selectedColumnId ?? columns[0]?.id ?? null;
    const selectedColumn = columns.find((c) => c.id === effectiveSelectedColumnId) ?? null;

    const handleRefreshAll = async () => {
        const response = await fetch('/api/intelligence/refresh', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
        });
        const data = await response.json();
        if (!response.ok) {
            throw new Error(data.error || 'Failed to refresh saved feeds');
        }
        setRefreshAllTrigger((prev) => prev + 1);
    };

    const handleArticleClick = (article: Article) => {
        setSelectedArticle(article);
    };

    const closeArticlePreview = () => {
        setSelectedArticle(null);
    };

    // Keyboard navigation for articles
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            // Don't handle if no article is selected
            if (!selectedArticle) return;

            // Don't handle if user is typing in an input
            if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

            if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                e.preventDefault();

                // Find which column this article belongs to
                const columnId = articleToColumn.get(selectedArticle.id);
                if (!columnId) return;

                // Get articles from the same column
                const columnArticles = articlesByColumn.get(columnId);
                if (!columnArticles || columnArticles.length === 0) return;

                const currentIndex = columnArticles.findIndex(
                    (article) => article.id === selectedArticle.id
                );

                if (currentIndex === -1) return;

                let newIndex: number;
                if (e.key === 'ArrowUp') {
                    // Go to previous (above) article in the column
                    newIndex = currentIndex - 1;
                    if (newIndex < 0) newIndex = columnArticles.length - 1; // Wrap to end
                } else {
                    // Go to next (below) article in the column
                    newIndex = currentIndex + 1;
                    if (newIndex >= columnArticles.length) newIndex = 0; // Wrap to start
                }

                setSelectedArticle(columnArticles[newIndex]);
            }

            // Escape to close preview
            if (e.key === 'Escape') {
                setSelectedArticle(null);
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [selectedArticle, articlesByColumn, articleToColumn]);

    const handleMiddleResizeStart = useCallback((e: React.MouseEvent) => {
        e.preventDefault();
        isResizingRef.current = true;
        resizeStartXRef.current = e.clientX;
        resizeStartWidthRef.current = middleWidth;

        const onMove = (ev: MouseEvent) => {
            if (!isResizingRef.current) return;
            const diff = ev.clientX - resizeStartXRef.current;
            setMiddleWidth(Math.max(220, Math.min(600, resizeStartWidthRef.current + diff)));
        };
        const onUp = () => {
            isResizingRef.current = false;
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
        };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
    }, [middleWidth]);

    return (
        <AppChrome
            onRefreshAll={handleRefreshAll}
            renderContent={({ openAddFeedModal }) => (
                <div className="absolute inset-0 flex flex-col overflow-hidden">
                    <div className="relative flex-1 overflow-hidden">
                        <div className="flex h-full">
                            <div className="w-56 flex-shrink-0 border-r border-border flex flex-col bg-background-secondary">
                                <div className="flex-1 overflow-y-auto">
                                    {columns.length === 0 && (
                                        <div className="flex flex-col items-center justify-center h-full px-4 py-8 text-center gap-3">
                                            <p className="text-sm text-foreground-secondary">No feed groups yet</p>
                                            <button
                                                onClick={openAddFeedModal}
                                                className="text-xs text-accent hover:underline"
                                            >
                                                Add your first feed
                                            </button>
                                        </div>
                                    )}
                                    {columns.map((col) => (
                                        <div
                                            key={col.id}
                                            className={cn(
                                                'border-b border-border/50 transition-colors cursor-pointer hover:bg-background-tertiary',
                                                effectiveSelectedColumnId === col.id && 'bg-accent/10 border-l-2 border-l-accent'
                                            )}
                                            onClick={() => {
                                                setSelectedColumnId(col.id);
                                                setSelectedArticle(null);
                                            }}
                                        >
                                            <div className="px-3 py-2 flex items-center justify-between gap-2">
                                                <div className={cn('text-sm truncate', effectiveSelectedColumnId === col.id && 'font-medium')}>{col.title}</div>
                                                {(() => {
                                                    const articles = articlesByColumn.get(col.id) ?? [];
                                                    const unread = articles.filter((a) => !isRead(a.id)).length;
                                                    return unread > 0 ? (
                                                        <span className="flex-shrink-0 text-[10px] font-bold bg-accent text-white px-1.5 py-0.5 rounded-full leading-none">
                                                            {unread}
                                                        </span>
                                                    ) : null;
                                                })()}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                                <div className="p-2 border-t border-border flex-shrink-0">
                                    <button
                                        onClick={openAddFeedModal}
                                        className="w-full flex items-center justify-center gap-1.5 px-3 py-2 text-sm text-foreground-secondary hover:text-foreground hover:bg-background-tertiary rounded-lg transition-colors"
                                    >
                                        <Plus className="w-4 h-4" />
                                        Add Column
                                    </button>
                                </div>
                            </div>

                            <div className="flex-shrink-0 overflow-hidden relative" style={{ width: middleWidth }}>
                                {selectedColumn ? (
                                    <Column
                                        key={selectedColumn.id}
                                        column={selectedColumn}
                                        onArticleClick={handleArticleClick}
                                        selectedArticleId={selectedArticle?.id ?? null}
                                        refreshTrigger={refreshAllTrigger}
                                        fillWidth
                                        forceViewMode="compact"
                                    />
                                ) : (
                                    <div className="flex items-center justify-center h-full text-foreground-secondary text-sm">
                                        Select a group
                                    </div>
                                )}
                                <div
                                    onMouseDown={handleMiddleResizeStart}
                                    className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-accent/50 transition-colors z-10"
                                />
                            </div>

                            <div className="flex-1 min-w-0 overflow-hidden">
                                {selectedArticle ? (
                                    <ReadingColumn
                                        article={selectedArticle}
                                        onClose={closeArticlePreview}
                                        fillWidth
                                    />
                                ) : (
                                    <div className="flex flex-col items-center justify-center h-full text-foreground-secondary gap-2">
                                        <BookOpen className="w-8 h-8 opacity-30" />
                                        <p className="text-sm">Select an article to read</p>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            )}
        />
    );
}
