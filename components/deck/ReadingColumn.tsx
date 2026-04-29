'use client';

import { X } from 'lucide-react';
import { Article } from '@/lib/types';
import { ArticlePreviewPanel } from '@/components/ui/ArticlePreviewPanel';
import { cn } from '@/lib/utils';
import { useState, useRef, useCallback, useEffect } from 'react';

interface ReadingColumnProps {
    article: Article;
    onClose: () => void;
}

const DEFAULT_READING_WIDTH = 550;
const MIN_READING_WIDTH = 400;
const MAX_READING_WIDTH = 900;

export function ReadingColumn({ article, onClose }: ReadingColumnProps) {
    const [width, setWidth] = useState(DEFAULT_READING_WIDTH);
    const [isResizing, setIsResizing] = useState(false);

    const panelRef = useRef<HTMLDivElement>(null);
    const startXRef = useRef(0);
    const startWidthRef = useRef(0);

    // Scroll the panel into view whenever it mounts (i.e. a new article is opened,
    // or the active column changes). Uses 'nearest' so it scrolls minimally —
    // just enough to reveal the left edge of the panel next to the clicked column.
    useEffect(() => {
        panelRef.current?.scrollIntoView({ behavior: 'smooth', inline: 'nearest', block: 'nearest' });
    }, [article.id]);

    const handleResizeStart = (e: React.MouseEvent) => {
        e.preventDefault();
        setIsResizing(true);
        startXRef.current = e.clientX;
        startWidthRef.current = width;

        document.addEventListener('mousemove', handleResizeMove);
        document.addEventListener('mouseup', handleResizeEnd);
    };

    const handleResizeMove = useCallback((e: MouseEvent) => {
        const diff = e.clientX - startXRef.current;
        const newWidth = Math.max(MIN_READING_WIDTH, Math.min(MAX_READING_WIDTH, startWidthRef.current + diff));
        setWidth(newWidth);
    }, []);

    const handleResizeEnd = useCallback(() => {
        setIsResizing(false);
        document.removeEventListener('mousemove', handleResizeMove);
        document.removeEventListener('mouseup', handleResizeEnd);
    }, [handleResizeMove]);

    return (
        <div
            ref={panelRef}
            className="h-full flex flex-col bg-background/95 backdrop-blur-sm border-r border-border relative z-10 border-l-4 border-l-accent shadow-2xl"
            style={{
                width: `${width}px`,
                flexShrink: 0,
                flexGrow: 0,
            }}
        >
            {/* Accent tint overlay */}
            <div className="absolute inset-0 bg-accent/5 pointer-events-none" />
            <div className="flex-1 overflow-hidden">
                <ArticlePreviewPanel
                    article={article}
                    onClose={onClose}
                />
            </div>

            {/* Resize Handle */}
            <div
                onMouseDown={handleResizeStart}
                className={cn(
                    'absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-accent/50 transition-colors z-20',
                    isResizing && 'bg-accent'
                )}
            />
        </div>
    );
}
