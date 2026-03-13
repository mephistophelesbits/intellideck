'use client';

import { useState, useEffect } from 'react';
import { DeckContainer } from '@/components/deck/DeckContainer';
import { AppChrome } from '@/components/AppChrome';
import { useArticlesStore } from '@/lib/articles-store';
import { Article } from '@/lib/types';

export function Dashboard() {
    const [selectedArticle, setSelectedArticle] = useState<Article | null>(null);
    const [refreshAllTrigger, setRefreshAllTrigger] = useState(0);

    const articlesByColumn = useArticlesStore((state) => state.articlesByColumn);
    const articleToColumn = useArticlesStore((state) => state.articleToColumn);

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

    return (
        <AppChrome
            onRefreshAll={handleRefreshAll}
            renderContent={({ openAddFeedModal }) => (
                <div className="absolute inset-0 overflow-hidden">
                    <DeckContainer
                        onAddColumn={openAddFeedModal}
                        onArticleClick={handleArticleClick}
                        onCloseArticle={closeArticlePreview}
                        selectedArticle={selectedArticle}
                        refreshTrigger={refreshAllTrigger}
                    />
                </div>
            )}
        />
    );
}
