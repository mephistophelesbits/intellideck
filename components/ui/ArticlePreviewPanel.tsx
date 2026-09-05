'use client';

import { useState, useEffect, useCallback } from 'react';
import { X, ExternalLink, Calendar, User, ChevronLeft, Bookmark, Loader2, AlertCircle, Newspaper, FileText, Download, Eye } from 'lucide-react';
import { format } from 'date-fns';
import DOMPurify from 'dompurify';
import { Article } from '@/lib/types';
import { useBookmarksStore } from '@/lib/bookmarks-store';
import { useSettingsStore, getThemeById } from '@/lib/settings-store';
import { useArticlesStore } from '@/lib/articles-store';
import { useArticleCacheStore } from '@/lib/article-cache-store';
import { useUrlPreview } from '@/components/ui/UrlPreviewPopup';
import { TimeAgo } from '@/components/ui/TimeAgo';
import { decodeHtml, cn } from '@/lib/utils';
import { findRelatedArticles, RelatedArticle } from '@/lib/text-similarity';

interface ScrapedArticle {
  title: string;
  content: string;
  textContent: string;
  excerpt: string;
  byline: string | null;
  siteName: string | null;
  length: number;
}

interface ArticlePreviewPanelProps {
  article: Article | null;
  onClose: () => void;
}

export function ArticlePreviewPanel({ article, onClose }: ArticlePreviewPanelProps) {
  const { isBookmarked, toggleBookmark } = useBookmarksStore();
  const themeId = useSettingsStore((state) => state.themeId);
  const isDark = getThemeById(themeId).isDark;
  const articlesByColumn = useArticlesStore((state) => state.articlesByColumn);
  const { openPreview } = useUrlPreview();

  // Handle link clicks - Cmd/Ctrl+Click to preview, regular click to open
  const handleContentClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    const link = target.closest('a');

    if (link && link.href) {
      // Cmd/Ctrl + Click to preview
      if (e.metaKey || e.ctrlKey) {
        e.preventDefault();
        openPreview(link.href, { x: e.clientX, y: e.clientY });
      }
      // Regular click opens in new tab (default behavior with target="_blank")
    }
  }, [openPreview]);

  // Cache store
  const {
    getScrapedContent: getCachedScrapedContent,
    setScrapedContent: setCachedScrapedContent,
  } = useArticleCacheStore();
  const [scrapedContent, setScrapedContent] = useState<ScrapedArticle | null>(null);
  const [isScraping, setIsScraping] = useState(false);
  const [scrapeError, setScrapeError] = useState<string | null>(null);

  // Similar Posts state
  const [similarArticles, setSimilarArticles] = useState<RelatedArticle[]>([]);

  // Load from cache or reset state when article changes
  useEffect(() => {
    if (!article) {
      return;
    }

    // Try to load cached scraped content
    const cachedScraped = getCachedScrapedContent(article.link);
    if (cachedScraped) {
      setScrapedContent(cachedScraped);
    } else {
      setScrapedContent(null);
    }
    setScrapeError(null);

    // Compute basic similar articles immediately upon opening
    try {
      const related = findRelatedArticles(article, articlesByColumn, {
        maxResults: 5,
        minScore: 0.1,
      });
      setSimilarArticles(related);
    } catch {
      setSimilarArticles([]);
    }

  }, [article, articlesByColumn, getCachedScrapedContent]);

  useEffect(() => {
    if (!article || article.content || scrapedContent) return;

    let cancelled = false;
    const controller = new AbortController();

    async function loadStoredContent() {
      try {
        const response = await fetch(`/api/articles/content?articleId=${encodeURIComponent(article!.id)}`, {
          cache: 'no-store',
          signal: controller.signal,
        });
        if (!response.ok) return;

        const data = await response.json() as {
          content?: string | null;
          textContent?: string | null;
          contentSnippet?: string | null;
        };
        if (cancelled || !data.content) return;

        const storedArticle: ScrapedArticle = {
          title: article!.title,
          content: data.content,
          textContent: data.textContent || data.contentSnippet || '',
          excerpt: data.contentSnippet || '',
          byline: null,
          siteName: article!.sourceTitle || null,
          length: data.textContent?.length || data.content.length,
        };
        setScrapedContent(storedArticle);
        setCachedScrapedContent(article!.link, storedArticle);
      } catch (error) {
        if (!controller.signal.aborted) {
          console.warn('Stored article content fetch failed:', error);
        }
      }
    }

    void loadStoredContent();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [article, scrapedContent, setCachedScrapedContent]);

  // Auto-fetch full article content after 4 seconds if feed didn't provide it
  useEffect(() => {
    if (!article) return;
    if (scrapedContent) return;
    const isTweet = (() => { try { const h = new URL(article.link).hostname.replace(/^www\./, ''); return h === 'twitter.com' || h === 'x.com'; } catch { return false; } })();
    if (!isTweet && (article.content?.length ?? 0) >= 500) return;

    const timer = setTimeout(() => {
      void handleFetchFullArticle();
    }, 4000);

    return () => clearTimeout(timer);
    // handleFetchFullArticle omitted from deps: it is recreated every render
    // (not wrapped in useCallback), so including it would restart the timer
    // on every render. The existing guards inside the function prevent double-fetching.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [article?.id, scrapedContent]);

  // Extract URLs from HTML content
  const extractFirstUrl = (htmlContent: string, excludeUrl?: string): string | null => {
    if (!htmlContent) return null;

    // Decode HTML entities first
    const decoded = htmlContent
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&amp;/g, '&');

    // Pattern to find href links - looking for actual article links
    const hrefPattern = /href=["']?(https?:\/\/[^"'\s>]+)/gi;
    let match;

    while ((match = hrefPattern.exec(decoded)) !== null) {
      const url = match[1];
      // Skip if same as article link, skip common non-article URLs
      if (url === excludeUrl) continue;
      if (url.includes('twitter.com') || url.includes('x.com')) continue;
      if (url.includes('facebook.com')) continue;
      if (url.includes('linkedin.com/share')) continue;
      if (url.match(/\.(jpg|jpeg|png|gif|svg|webp|ico)(\?|$)/i)) continue;

      return url;
    }

    // Fallback: find any URL in text
    const urlPattern = /https?:\/\/[^\s<>"'\]]+/gi;
    while ((match = urlPattern.exec(decoded)) !== null) {
      const url = match[0].replace(/[.,;:!?)]+$/, ''); // Clean trailing punctuation
      if (url === excludeUrl) continue;
      if (url.includes('twitter.com') || url.includes('x.com')) continue;
      if (url.includes('facebook.com')) continue;
      if (url.match(/\.(jpg|jpeg|png|gif|svg|webp|ico)(\?|$)/i)) continue;

      return url;
    }

    return null;
  };

  const isTweetUrl = (url: string) => {
    try {
      const host = new URL(url).hostname.replace(/^www\./, '');
      return host === 'twitter.com' || host === 'x.com';
    } catch {
      return false;
    }
  };

  // Fetch full article content
  async function handleFetchFullArticle() {
    if (!article || isScraping || scrapedContent) return;

    setIsScraping(true);
    setScrapeError(null);

    // Tweet URLs need a different fetch path
    if (isTweetUrl(article.link)) {
      try {
        const response = await fetch('/api/tweet', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: article.link }),
        });
        const data = await response.json();
        if (response.ok && data.tweet) {
          setScrapedContent(data.tweet);
          setCachedScrapedContent(article.link, data.tweet);
        } else {
          setScrapeError(data.error || 'Failed to fetch tweet');
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to fetch tweet';
        setScrapeError(message);
      } finally {
        setIsScraping(false);
      }
      return;
    }

    const tryFetchUrl = async (url: string): Promise<{ success: boolean; article?: ScrapedArticle; error?: string }> => {
      try {
        const response = await fetch('/api/scrape', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url }),
        });

        const data = await response.json();

        if (!response.ok) {
          return { success: false, error: data.error || 'Failed to fetch article' };
        }

        // Check if content is too short (less than 200 chars usually means extraction failed)
        if (!data.article?.textContent || data.article.textContent.length < 200) {
          return { success: false, error: 'Extracted content too short' };
        }

        return { success: true, article: data.article };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to fetch article';
        return { success: false, error: message };
      }
    };

    try {
      // First try the main article URL
      let result = await tryFetchUrl(article.link);

      // If failed, try to find a URL in the content as fallback
      if (!result.success) {
        const contentToSearch = article.content || article.contentSnippet || '';
        const fallbackUrl = extractFirstUrl(contentToSearch, article.link);

        if (fallbackUrl) {

          const fallbackResult = await tryFetchUrl(fallbackUrl);
          if (fallbackResult.success) {
            result = fallbackResult;
          }
        }
      }

      if (!result.success) {
        throw new Error(result.error || 'Failed to fetch article');
      }

      setScrapedContent(result.article!);
      // Cache the scraped content
      setCachedScrapedContent(article.link, result.article!);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to fetch full article';
      setScrapeError(message);
    } finally {
      setIsScraping(false);
    }
  }

  if (!article) {
    return (
      <div className="w-full h-full bg-background-secondary flex flex-col items-center justify-center text-foreground-secondary">
        <ChevronLeft className="w-12 h-12 mb-3 opacity-30" />
        <p className="text-base font-medium">No Article Selected</p>
        <p className="text-sm mt-1 opacity-70">Click an article to preview it here</p>
      </div>
    );
  }

  const bookmarked = isBookmarked(article.id);
  const formattedDate = format(new Date(article.pubDate), 'MMMM d, yyyy • h:mm a');

  // Sanitize HTML content
  const sanitizedContent = article.content
    ? DOMPurify.sanitize(article.content, {
      ALLOWED_TAGS: ['p', 'br', 'strong', 'em', 'b', 'i', 'u', 'a', 'ul', 'ol', 'li', 'blockquote', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'img', 'figure', 'figcaption', 'pre', 'code'],
      ALLOWED_ATTR: ['href', 'src', 'alt', 'title', 'target', 'rel'],
      ADD_ATTR: ['target'],
    })
    : null;

  const handleBookmarkClick = () => {
    toggleBookmark(article);
  };

  return (
    <div className="w-full h-full bg-background-secondary flex flex-col ironman-mode">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-background-tertiary flex-shrink-0">
        <div className="flex items-center gap-2 text-sm min-w-0">
          {article.sourceTitle && (
            <span className="font-semibold text-accent truncate">{decodeHtml(article.sourceTitle)}</span>
          )}
          <span className="text-foreground-secondary flex-shrink-0">•</span>
          <TimeAgo date={article.pubDate} className="text-warning font-medium flex-shrink-0" />
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <button
            onClick={onClose}
            className="p-2 hover:bg-background-secondary rounded-lg transition-colors text-foreground-secondary hover:text-foreground"
            title="Close preview"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto column-scroll">
        {/* Thumbnail */}
        {article.thumbnail && (
          <div className="w-full h-56 overflow-hidden">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={article.thumbnail}
              alt=""
              className="w-full h-full object-cover"
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = 'none';
              }}
            />
          </div>
        )}

        <div className="p-6">
          {/* Title */}
          <h1 className="text-2xl font-bold text-foreground leading-tight mb-4">
            {decodeHtml(article.title)}
          </h1>

          {/* Action Toolbar */}
          <div className="flex items-center gap-2 mb-6">
            {/* Fetch Full Article button */}
            <button
              onClick={handleFetchFullArticle}
              disabled={isScraping || !!scrapedContent}
              className={cn(
                'flex items-center gap-2 px-3 py-2 rounded-lg border text-sm font-medium transition-all',
                scrapedContent
                  ? 'text-success bg-success/10 border-success/30'
                  : isScraping
                    ? 'text-foreground-secondary bg-background-secondary border-border cursor-not-allowed'
                    : 'text-foreground-secondary bg-background-secondary border-border hover:text-foreground hover:border-foreground'
              )}
              title={scrapedContent ? 'Full article loaded' : 'Fetch full article content'}
            >
              {isScraping ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Download className={cn('w-4 h-4', scrapedContent && 'text-success')} />
              )}
              <span>Content</span>
            </button>

            {/* Bookmark button */}
            <button
              onClick={handleBookmarkClick}
              className={cn(
                'flex items-center gap-2 px-3 py-2 rounded-lg border text-sm font-medium transition-all ml-auto',
                bookmarked
                  ? 'text-warning bg-warning/10 border-warning/30'
                  : 'text-foreground-secondary bg-background-secondary border-border hover:text-warning hover:border-warning'
              )}
              title={bookmarked ? 'Remove bookmark' : 'Add bookmark'}
            >
              <Bookmark className={cn('w-4 h-4', bookmarked && 'fill-current')} />
              <span>{bookmarked ? 'Saved' : 'Save'}</span>
            </button>
          </div>

          {/* Meta */}
          <div className="flex flex-wrap items-center gap-4 text-sm text-foreground-secondary mb-6 pb-6 border-b border-border">
            {(article.author || scrapedContent?.byline) && (
              <div className="flex items-center gap-2">
                <User className="w-4 h-4" />
                <span>{decodeHtml(scrapedContent?.byline || article.author || '')}</span>
              </div>
            )}
            <div className="flex items-center gap-2">
              <Calendar className="w-4 h-4 text-warning" />
              <span className="text-warning">{formattedDate}</span>
            </div>
            {scrapedContent && (
              <div className="flex items-center gap-2 text-success">
                <FileText className="w-4 h-4" />
                <span>Full article ({Math.round(scrapedContent.length / 1000)}k chars)</span>
              </div>
            )}
            <div className="flex items-center gap-2 text-foreground-secondary/60" title="Hold Cmd/Ctrl and click any link to preview it">
              <Eye className="w-3.5 h-3.5" />
              <span className="text-xs">⌘+Click links to preview</span>
            </div>
          </div>

          {/* Scrape error */}
          {scrapeError && (
            <div className="mb-4 p-3 rounded-lg bg-error/10 border border-error/30 flex items-start gap-2 text-error">
              <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
              <span className="text-sm">{scrapeError}</span>
            </div>
          )}
          {/* Article Content - Cmd/Ctrl+Click links to preview */}
          {scrapedContent ? (
            <div
              onClick={handleContentClick}
              className={cn(
                "prose max-w-none font-serif prose-headings:text-foreground prose-headings:font-semibold prose-p:text-foreground prose-p:leading-relaxed prose-a:text-accent prose-a:no-underline hover:prose-a:underline prose-strong:text-foreground prose-blockquote:border-l-accent prose-blockquote:text-foreground-secondary prose-code:text-accent prose-code:bg-background-tertiary prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-pre:bg-background-tertiary prose-pre:whitespace-pre-wrap prose-pre:break-words prose-img:rounded-lg prose-img:max-w-full",
                isDark && "prose-invert"
              )}
              dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(scrapedContent.content) }}
            />
          ) : sanitizedContent ? (
            <div
              onClick={handleContentClick}
              className={cn(
                "prose max-w-none font-serif prose-headings:text-foreground prose-headings:font-semibold prose-p:text-foreground prose-p:leading-relaxed prose-a:text-accent prose-a:no-underline hover:prose-a:underline prose-strong:text-foreground prose-blockquote:border-l-accent prose-blockquote:text-foreground-secondary prose-code:text-accent prose-code:bg-background-tertiary prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-pre:bg-background-tertiary prose-pre:whitespace-pre-wrap prose-pre:break-words prose-img:rounded-lg prose-img:max-w-full",
                isDark && "prose-invert"
              )}
              dangerouslySetInnerHTML={{ __html: sanitizedContent }}
            />
          ) : article.contentSnippet ? (
            <p className="text-foreground-secondary leading-relaxed">
              {decodeHtml(article.contentSnippet)}
            </p>
          ) : (
            <p className="text-foreground-secondary italic">
              No content preview available.
            </p>
          )}

          {/* Similar Posts Section */}
          {similarArticles.length > 0 && (
            <div className="mt-10 pt-6 border-t border-border">
              <h3 className="text-lg font-bold text-foreground mb-4 flex items-center gap-2">
                <Newspaper className="w-5 h-5 text-accent" />
                Similar Posts
              </h3>
              <div className="grid grid-cols-1 gap-3">
                {similarArticles.map((ra) => (
                  <a
                    key={ra.article.id}
                    href={ra.article.link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="p-3 rounded-lg border border-border bg-background-tertiary hover:border-accent hover:bg-background-secondary transition-all flex flex-col gap-1"
                  >
                    <div className="text-sm font-semibold text-foreground line-clamp-2">
                      {decodeHtml(ra.article.title)}
                    </div>
                    <div className="flex items-center gap-2 text-xs text-foreground-secondary">
                      <span className="font-medium text-accent truncate max-w-[150px]">
                        {decodeHtml(ra.article.sourceTitle || 'Unknown')}
                      </span>
                      <span>•</span>
                      <TimeAgo date={ra.article.pubDate} className="text-[10px]" />
                    </div>
                  </a>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="flex-shrink-0 px-6 py-4 border-t border-border bg-background-tertiary">
        <a
          href={article.link}
          target="_blank"
          rel="noopener noreferrer"
          className="w-full py-3 bg-accent hover:bg-accent-hover text-[color:var(--accent-foreground)] font-medium rounded-lg transition-colors flex items-center justify-center gap-2"
        >
          <ExternalLink className="w-5 h-5" />
          Read Original Article
        </a>
      </div>
    </div>
  );
}
