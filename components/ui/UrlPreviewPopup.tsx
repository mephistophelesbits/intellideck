'use client';

import { useState, useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { X, ExternalLink, Loader2, AlertCircle, Globe } from 'lucide-react';
import DOMPurify from 'dompurify';
import { cn } from '@/lib/utils';

interface ScrapedContent {
  title: string;
  content: string;
  textContent: string;
  excerpt: string;
  byline: string | null;
  siteName: string | null;
  length: number;
}

interface UrlPreviewPopupProps {
  url: string;
  onClose: () => void;
  position?: { x: number; y: number };
}

export function UrlPreviewPopup({ url, onClose, position }: UrlPreviewPopupProps) {
  const [content, setContent] = useState<ScrapedContent | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const popupRef = useRef<HTMLDivElement>(null);

  // Close on escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  // Fetch content on mount
  useEffect(() => {
    const fetchContent = async () => {
      setIsLoading(true);
      setError(null);

      try {
        const response = await fetch('/api/scrape', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url }),
        });

        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || 'Failed to fetch preview');
        }

        setContent(data.article);
      } catch (err: any) {
        setError(err.message || 'Failed to load preview');
      } finally {
        setIsLoading(false);
      }
    };

    fetchContent();
  }, [url]);

  // Calculate position to keep popup in viewport
  const getPopupStyle = () => {
    if (!position) {
      return {
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
      };
    }

    const popupWidth = 400;
    const popupHeight = 500;
    const padding = 20;

    let x = position.x;
    let y = position.y;

    // Adjust if popup would go off right edge
    if (x + popupWidth + padding > window.innerWidth) {
      x = window.innerWidth - popupWidth - padding;
    }

    // Adjust if popup would go off bottom edge
    if (y + popupHeight + padding > window.innerHeight) {
      y = window.innerHeight - popupHeight - padding;
    }

    // Ensure minimum margins
    x = Math.max(padding, x);
    y = Math.max(padding, y);

    return {
      top: `${y}px`,
      left: `${x}px`,
    };
  };

  // Extract domain from URL
  const getDomain = (urlString: string) => {
    try {
      return new URL(urlString).hostname;
    } catch {
      return urlString;
    }
  };

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 z-[100]"
        onClick={onClose}
      />

      {/* Popup */}
      <div
        ref={popupRef}
        className="fixed z-[101] w-[400px] max-h-[500px] bg-background-secondary border border-border rounded-xl shadow-2xl overflow-hidden flex flex-col"
        style={getPopupStyle()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-background-tertiary flex-shrink-0">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <Globe className="w-4 h-4 text-foreground-secondary flex-shrink-0" />
            <span className="text-sm text-foreground-secondary truncate">
              {getDomain(url)}
            </span>
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="p-1.5 hover:bg-background-secondary rounded-lg transition-colors text-foreground-secondary hover:text-accent"
              title="Open in new tab"
            >
              <ExternalLink className="w-4 h-4" />
            </a>
            <button
              onClick={onClose}
              className="p-1.5 hover:bg-background-secondary rounded-lg transition-colors text-foreground-secondary hover:text-foreground"
              title="Close preview"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {isLoading && (
            <div className="flex flex-col items-center justify-center py-12 text-foreground-secondary">
              <Loader2 className="w-8 h-8 animate-spin mb-3" />
              <p className="text-sm">Loading preview...</p>
            </div>
          )}

          {error && (
            <div className="flex flex-col items-center justify-center py-12 text-foreground-secondary">
              <AlertCircle className="w-8 h-8 mb-3 text-error" />
              <p className="text-sm text-error mb-2">{error}</p>
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-accent hover:underline"
              >
                Open link directly
              </a>
            </div>
          )}

          {content && !isLoading && (
            <div className="space-y-3">
              {/* Title */}
              <h2 className="text-lg font-semibold text-foreground leading-tight">
                {content.title}
              </h2>

              {/* Meta */}
              {(content.siteName || content.byline) && (
                <div className="flex items-center gap-2 text-xs text-foreground-secondary">
                  {content.siteName && <span>{content.siteName}</span>}
                  {content.siteName && content.byline && <span>•</span>}
                  {content.byline && <span>{content.byline}</span>}
                </div>
              )}

              {/* Excerpt */}
              {content.excerpt && (
                <p className="text-sm text-foreground-secondary italic border-l-2 border-accent pl-3">
                  {content.excerpt}
                </p>
              )}

              {/* Content preview */}
              <div
                className="text-sm text-foreground-secondary leading-relaxed prose prose-sm max-w-none
                  prose-headings:text-foreground prose-headings:font-semibold prose-headings:text-sm
                  prose-p:text-foreground-secondary prose-p:my-2
                  prose-a:text-accent prose-a:no-underline hover:prose-a:underline
                  prose-strong:text-foreground
                  prose-img:rounded-lg prose-img:max-w-full prose-img:h-auto"
                dangerouslySetInnerHTML={{
                  __html: DOMPurify.sanitize(content.content, {
                    ALLOWED_TAGS: ['p', 'br', 'strong', 'em', 'b', 'i', 'a', 'ul', 'ol', 'li', 'blockquote', 'h1', 'h2', 'h3', 'img'],
                    ALLOWED_ATTR: ['href', 'src', 'alt', 'title', 'target', 'rel'],
                  }),
                }}
              />

              {/* Content length */}
              <div className="text-xs text-foreground-secondary/50 pt-2 border-t border-border">
                {Math.round(content.length / 1000)}k characters
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-border bg-background-tertiary flex-shrink-0">
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="w-full py-2 bg-accent hover:bg-accent-hover text-white font-medium rounded-lg transition-colors flex items-center justify-center gap-2 text-sm"
          >
            <ExternalLink className="w-4 h-4" />
            Open Full Page
          </a>
        </div>
      </div>
    </>
  );
}

// Hook to manage URL preview state
import { createContext, useContext, useCallback, ReactNode } from 'react';

interface UrlPreviewContextType {
  previewUrl: string | null;
  previewPosition: { x: number; y: number } | undefined;
  openPreview: (url: string, position?: { x: number; y: number }) => void;
  closePreview: () => void;
}

const UrlPreviewContext = createContext<UrlPreviewContextType | null>(null);

export function UrlPreviewProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewPosition, setPreviewPosition] = useState<{ x: number; y: number } | undefined>();

  const openPreview = useCallback((url: string, position?: { x: number; y: number }) => {
    setPreviewUrl(url);
    setPreviewPosition(position);
  }, []);

  const closePreview = useCallback(() => {
    setPreviewUrl(null);
    setPreviewPosition(undefined);
  }, []);

  useEffect(() => {
    closePreview();
  }, [pathname, closePreview]);

  return (
    <UrlPreviewContext.Provider value={{ previewUrl, previewPosition, openPreview, closePreview }}>
      {children}
      {previewUrl && (
        <UrlPreviewPopup
          url={previewUrl}
          position={previewPosition}
          onClose={closePreview}
        />
      )}
    </UrlPreviewContext.Provider>
  );
}

export function useUrlPreview() {
  const context = useContext(UrlPreviewContext);
  if (!context) {
    throw new Error('useUrlPreview must be used within a UrlPreviewProvider');
  }
  return context;
}
