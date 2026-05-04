'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { X, ExternalLink, Calendar, User, ChevronLeft, Bookmark, Sparkles, Loader2, AlertCircle, Globe, Newspaper, FileText, Download, MessageCircle, Send, Search, Eye, Languages } from 'lucide-react';
import { format } from 'date-fns';
import DOMPurify from 'dompurify';
import ReactMarkdown from 'react-markdown';
import { Article } from '@/lib/types';
import { useBookmarksStore } from '@/lib/bookmarks-store';
import { useSettingsStore, getThemeById } from '@/lib/settings-store';
import { useArticlesStore } from '@/lib/articles-store';
import { useArticleCacheStore } from '@/lib/article-cache-store';
import { useUrlPreview } from '@/components/ui/UrlPreviewPopup';
import { RelativeTime } from '@/components/ui/RelativeTime';
import { decodeHtml, cn } from '@/lib/utils';
import { findRelatedArticles, generateSearchQuery, RelatedArticle } from '@/lib/text-similarity';

interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
}

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  webResults?: WebSearchResult[];
}

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

type SummaryPhase = 'idle' | 'scraping' | 'finding-related' | 'searching-web' | 'generating' | 'done' | 'error';

export function ArticlePreviewPanel({ article, onClose }: ArticlePreviewPanelProps) {
  const { isBookmarked, toggleBookmark } = useBookmarksStore();
  const aiSettings = useSettingsStore((state) => state.aiSettings);
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
    getSummary: getCachedSummary,
    setSummary: setCachedSummary,
    getChatMessages: getCachedChatMessages,
    setChatMessages: setCachedChatMessages,
  } = useArticleCacheStore();

  const [summary, setSummary] = useState<string | null>(null);
  const [phase, setPhase] = useState<SummaryPhase>('idle');
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [relatedArticles, setRelatedArticles] = useState<RelatedArticle[]>([]);
  const [webResults, setWebResults] = useState<WebSearchResult[]>([]);
  const [scrapedContent, setScrapedContent] = useState<ScrapedArticle | null>(null);
  const [isScraping, setIsScraping] = useState(false);
  const [scrapeError, setScrapeError] = useState<string | null>(null);

  // Chat state
  const [showChat, setShowChat] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [isChatting, setIsChatting] = useState(false);
  const [enableWebSearch, setEnableWebSearch] = useState(true);
  const chatContainerRef = useRef<HTMLDivElement>(null);

  // Translation state
  const [translatedSummary, setTranslatedSummary] = useState<string | null>(null);
  const [isTranslating, setIsTranslating] = useState(false);
  const [showTranslated, setShowTranslated] = useState(false);

  // Similar Posts state
  const [similarArticles, setSimilarArticles] = useState<RelatedArticle[]>([]);

  // Auto-scroll chat to bottom when messages change or while typing
  useEffect(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
    }
  }, [chatMessages, isChatting]);

  // Load from cache or reset state when article changes
  useEffect(() => {
    if (!article) {
      setSummary(null);
      setSummaryError(null);
      setPhase('idle');
      setRelatedArticles([]);
      setWebResults([]);
      setScrapedContent(null);
      setScrapeError(null);
      setShowChat(false);
      setChatMessages([]);
      setChatInput('');
      setTranslatedSummary(null);
      setIsTranslating(false);
      setShowTranslated(false);
      setSimilarArticles([]);
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

    // Try to load cached summary
    const cachedSummary = getCachedSummary(article.id);
    if (cachedSummary) {
      setSummary(cachedSummary.summary);
      setRelatedArticles(cachedSummary.relatedArticles.map(r => ({
        article: { id: r.url, title: r.title, link: r.url, pubDate: '', sourceTitle: r.source } as Article,
        score: 1,
        matchedKeywords: [],
      })));
      setWebResults(cachedSummary.webResults);
      setPhase('done');
    } else {
      setSummary(null);
      setRelatedArticles([]);
      setWebResults([]);
      setPhase('idle');
    }
    setSummaryError(null);

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

    // Try to load cached chat
    const cachedChat = getCachedChatMessages(article.id);
    if (cachedChat.length > 0) {
      setChatMessages(cachedChat);
      setShowChat(true);
    } else {
      setChatMessages([]);
      setShowChat(false);
    }
    setChatInput('');
  }, [article?.id, article?.link, getCachedScrapedContent, getCachedSummary, getCachedChatMessages]);

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
  const handleFetchFullArticle = async () => {
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
      } catch (error: any) {
        setScrapeError(error.message || 'Failed to fetch tweet');
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
      } catch (error: any) {
        return { success: false, error: error.message || 'Failed to fetch article' };
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
    } catch (error: any) {
      setScrapeError(error.message || 'Failed to fetch full article');
    } finally {
      setIsScraping(false);
    }
  };

  const handleSummarize = async (fetchFullFirst: boolean = false) => {
    if (!article || (phase !== 'idle' && phase !== 'error')) return;

    setSummaryError(null);
    let articleContent = scrapedContent?.textContent || article.content || article.contentSnippet || '';

    try {
      // Phase 0: Optionally scrape full article first
      if (fetchFullFirst && !scrapedContent) {
        setPhase('scraping');
        try {
          const endpoint = isTweetUrl(article.link) ? '/api/tweet' : '/api/scrape';
          const scrapeResponse = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: article.link }),
          });
          const scrapeData = await scrapeResponse.json();

          const fetched = isTweetUrl(article.link) ? scrapeData.tweet : scrapeData.article;
          const hasGoodContent = scrapeResponse.ok && fetched?.textContent?.length > 0;

          if (hasGoodContent) {
            setScrapedContent(fetched);
            setCachedScrapedContent(article.link, fetched);
            articleContent = fetched.textContent;
          } else {
            // Try fallback URL from content
            const contentToSearch = article.content || article.contentSnippet || '';
            const fallbackUrl = extractFirstUrl(contentToSearch, article.link);

            if (fallbackUrl) {

              const fallbackResponse = await fetch('/api/scrape', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url: fallbackUrl }),
              });
              const fallbackData = await fallbackResponse.json();

              if (fallbackResponse.ok && fallbackData.article) {
                setScrapedContent(fallbackData.article);
                setCachedScrapedContent(article.link, fallbackData.article);
                articleContent = fallbackData.article.textContent;
              }
            }
          }
        } catch {
          console.warn('Scraping failed, continuing with available content');
        }
      }

      // Phase 1: Find related articles from user's feeds
      setPhase('finding-related');
      const related = findRelatedArticles(article, articlesByColumn, {
        maxResults: 5,
        minScore: 0.1,
      });
      setRelatedArticles(related);

      // Phase 2: Search web for additional sources (in parallel-ish)
      setPhase('searching-web');
      let webSearchResults: WebSearchResult[] = [];
      try {
        const searchQuery = generateSearchQuery(article);
        const webResponse = await fetch('/api/ai/web-search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: searchQuery, maxResults: 5 }),
        });
        const webData = await webResponse.json();
        webSearchResults = webData.results || [];
        setWebResults(webSearchResults);
      } catch {
        // Web search failed, continue with what we have
        console.warn('Web search failed, continuing without web results');
      }

      // Phase 3: Generate enhanced summary
      setPhase('generating');
      const contentToSummarize = articleContent;

      const response = await fetch('/api/ai/summarize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: article.title,
          content: contentToSummarize,
          provider: aiSettings.provider,
          apiKey: aiSettings.apiKeys?.[aiSettings.provider] || '',
          model: aiSettings.model,
          language: aiSettings.language,
          ollamaUrl: aiSettings.ollamaUrl,
          enhancedMode: true,
          relatedArticles: related.map((r) => ({
            title: r.article.title,
            source: r.article.sourceTitle || 'Unknown',
            snippet: (r.article.contentSnippet || '').slice(0, 200),
            url: r.article.link,
          })),
          webResults: webSearchResults.map((w) => ({
            title: w.title,
            snippet: w.snippet,
            url: w.url,
          })),
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to generate summary');
      }

      setSummary(data.summary);
      setPhase('done');

      // Cache the summary
      setCachedSummary(article.id, {
        summary: data.summary,
        relatedArticles: related.map((r) => ({
          title: r.article.title,
          source: r.article.sourceTitle || 'Unknown',
          url: r.article.link,
        })),
        webResults: webSearchResults,
        cachedAt: Date.now(),
      });
    } catch (error: any) {
      setSummaryError(error.message || 'Failed to generate summary');
      setPhase('error');
    }
  };

  // Handle chat message submission
  const handleChatSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!article || !chatInput.trim() || isChatting) return;

    const userMessage = chatInput.trim();
    setChatInput('');

    // Add user message to chat
    const newUserMessage: ChatMessage = { role: 'user', content: userMessage };
    const updatedMessages = [...chatMessages, newUserMessage];
    setChatMessages(updatedMessages);

    setIsChatting(true);

    try {
      const articleContent = scrapedContent?.textContent || article.content || article.contentSnippet || '';

      const response = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: updatedMessages,
          articleContext: {
            title: article.title,
            content: articleContent,
            source: article.sourceTitle,
            url: article.link,
          },
          provider: aiSettings.provider,
          apiKey: aiSettings.apiKeys?.[aiSettings.provider] || '',
          model: aiSettings.model,
          ollamaUrl: aiSettings.ollamaUrl,
          searchWeb: enableWebSearch,
          searchQuery: enableWebSearch ? `${article.title} ${userMessage}` : undefined,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to get response');
      }

      // Add assistant response to chat
      const assistantMessage: ChatMessage = {
        role: 'assistant',
        content: data.reply,
        webResults: data.webResults,
      };
      const finalMessages = [...updatedMessages, assistantMessage];
      setChatMessages(finalMessages);
      // Cache the chat messages
      setCachedChatMessages(article.id, finalMessages);
    } catch (error: any) {
      // Add error message
      setChatMessages((prev) => [
        ...prev,
        { role: 'assistant', content: `Error: ${error.message}` },
      ]);
    } finally {
      setIsChatting(false);
    }
  };

  const handleTranslateSummary = async () => {
    if (!summary || isTranslating) return;

    if (translatedSummary) {
      setShowTranslated(!showTranslated);
      return;
    }

    setIsTranslating(true);
    try {
      const targetLang = aiSettings.language === 'English' ? 'Chinese' : 'English';
      const response = await fetch('/api/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          task: 'translate',
          content: summary,
          targetLanguage: targetLang,
          provider: aiSettings.provider,
          apiKey: aiSettings.apiKeys?.[aiSettings.provider] || '',
          model: aiSettings.model,
          ollamaUrl: aiSettings.ollamaUrl,
        }),
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error);

      setTranslatedSummary(data.translation);
      setShowTranslated(true);
    } catch (error: any) {
      console.error('Translation failed:', error);
      alert('Translation failed: ' + error.message);
    } finally {
      setIsTranslating(false);
    }
  };

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
  const isBusy = phase !== 'idle' && phase !== 'done' && phase !== 'error';

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

  const getPhaseMessage = () => {
    switch (phase) {
      case 'scraping':
        return 'Fetching full article...';
      case 'finding-related':
        return 'Finding related articles...';
      case 'searching-web':
        return 'Searching web sources...';
      case 'generating':
        return 'Generating comprehensive summary...';
      default:
        return 'Processing...';
    }
  };

  // Check if we have limited content (just snippet)
  const hasLimitedContent = !article?.content && !scrapedContent;

  return (
    <div className="w-full h-full bg-background-secondary flex flex-col ironman-mode">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-background-tertiary flex-shrink-0">
        <div className="flex items-center gap-2 text-sm min-w-0">
          {article.sourceTitle && (
            <span className="font-semibold text-accent truncate">{decodeHtml(article.sourceTitle)}</span>
          )}
          <span className="text-foreground-secondary flex-shrink-0">•</span>
          <RelativeTime date={article.pubDate} className="text-warning font-medium flex-shrink-0" />
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

            {/* AI Summary button */}
            {aiSettings.enabled && (
              <button
                onClick={() => handleSummarize(hasLimitedContent)}
                disabled={isBusy || phase === 'done'}
                className={cn(
                  'flex items-center gap-2 px-3 py-2 rounded-lg border text-sm font-medium transition-all',
                  phase === 'done'
                    ? 'text-accent bg-accent/10 border-accent/30'
                    : isBusy
                      ? 'text-accent bg-accent/10 border-accent/20 cursor-wait'
                      : 'text-foreground-secondary bg-background-secondary border-border hover:text-accent hover:border-accent'
                )}
                title={phase === 'done' ? 'Summary generated' : (hasLimitedContent ? 'Deep Research (will fetch full article)' : 'Deep Research Summary')}
              >
                {isBusy ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Sparkles className={cn('w-4 h-4', phase === 'done' && 'fill-current')} />
                )}
                <span>Research</span>
              </button>
            )}

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



          {/* AI Summary Section */}
          {(phase !== 'idle' || summaryError) && (
            <div className="mb-6 p-4 rounded-lg bg-background-tertiary border border-border">
              <div className="flex items-center gap-2 mb-3">
                <Sparkles className="w-4 h-4 text-accent" />
                <span className="text-sm font-semibold text-accent">AI Research Summary</span>
                {phase === 'done' && (
                  <div className="flex items-center gap-2 ml-auto">
                    <button
                      onClick={handleTranslateSummary}
                      disabled={isTranslating}
                      className={cn(
                        'flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-medium transition-colors',
                        showTranslated
                          ? 'bg-accent/20 text-accent'
                          : 'bg-background-secondary text-foreground-secondary hover:text-foreground'
                      )}
                      title={showTranslated ? 'Show Original' : 'Translate Content'}
                    >
                      {isTranslating ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : (
                        <Languages className="w-3 h-3" />
                      )}
                      {showTranslated ? 'Original' : 'Translate'}
                    </button>
                    <span className="text-xs text-foreground-secondary">
                      {relatedArticles.length + webResults.length} sources
                    </span>
                  </div>
                )}
              </div>

              {/* Loading state */}
              {isBusy && (
                <div className="flex items-center gap-2 text-foreground-secondary">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span className="text-sm">{getPhaseMessage()}</span>
                </div>
              )}

              {/* Error state */}
              {phase === 'error' && summaryError && (
                <div className="flex items-start gap-2 text-error">
                  <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                  <span className="text-sm">{summaryError}</span>
                </div>
              )}

              {/* Summary content */}
              {(summary || translatedSummary) && (
                <div className="text-sm text-foreground">
                  <ReactMarkdown
                    components={{
                      ul: ({ children }) => <ul className="list-disc list-inside space-y-1 my-2 ml-1">{children}</ul>,
                      ol: ({ children }) => <ol className="list-decimal list-inside space-y-1 my-2 ml-1">{children}</ol>,
                      li: ({ children }) => <li className="text-foreground-secondary leading-relaxed">{children}</li>,
                      p: ({ children }) => <p className="my-2 text-foreground-secondary leading-relaxed">{children}</p>,
                      strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
                      em: ({ children }) => <em className="italic">{children}</em>,
                      h1: ({ children }) => <h1 className="text-lg font-bold text-foreground mt-4 mb-2">{children}</h1>,
                      h2: ({ children }) => <h2 className="text-base font-bold text-foreground mt-4 mb-2">{children}</h2>,
                      h3: ({ children }) => <h3 className="text-sm font-semibold text-accent uppercase tracking-wide mt-4 mb-2">{children}</h3>,
                      a: ({ href, children }) => <a href={href} className="text-accent hover:underline" target="_blank" rel="noopener noreferrer">{children}</a>,
                      code: ({ children }) => <code className="bg-background-tertiary px-1.5 py-0.5 rounded text-sm font-mono">{children}</code>,
                      blockquote: ({ children }) => <blockquote className="border-l-2 border-accent pl-4 my-2 italic text-foreground-secondary">{children}</blockquote>,
                    }}
                  >
                    {showTranslated ? translatedSummary || summary : summary}
                  </ReactMarkdown>
                </div>
              )}

              {/* Sources section */}
              {phase === 'done' && (relatedArticles.length > 0 || webResults.length > 0) && (
                <div className="mt-4 pt-4 border-t border-border/50 space-y-3">
                  {/* Related from feeds */}
                  {relatedArticles.length > 0 && (
                    <div>
                      <div className="flex items-center gap-1.5 text-xs font-medium text-foreground-secondary mb-2">
                        <Newspaper className="w-3.5 h-3.5" />
                        Related from your feeds ({relatedArticles.length})
                      </div>
                      <div className="space-y-1">
                        {relatedArticles.slice(0, 3).map((ra) => (
                          <a
                            key={ra.article.id}
                            href={ra.article.link}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="block text-xs text-foreground-secondary/80 hover:text-accent truncate"
                          >
                            • {decodeHtml(ra.article.title)}
                            <span className="text-foreground-secondary/50 ml-1">
                              ({ra.article.sourceTitle})
                            </span>
                          </a>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Web sources */}
                  {webResults.length > 0 && (
                    <div>
                      <div className="flex items-center gap-1.5 text-xs font-medium text-foreground-secondary mb-2">
                        <Globe className="w-3.5 h-3.5" />
                        Web sources ({webResults.length})
                      </div>
                      <div className="space-y-1">
                        {webResults.slice(0, 3).map((wr, i) => (
                          <a
                            key={i}
                            href={wr.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="block text-xs text-foreground-secondary/80 hover:text-accent truncate"
                          >
                            • {wr.title}
                          </a>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Continue to Chat Section */}
              {phase === 'done' && (
                <div className="mt-4 pt-4 border-t border-border/50">
                  {!showChat ? (
                    <button
                      onClick={() => setShowChat(true)}
                      className="w-full py-2.5 px-4 rounded-lg bg-accent/10 hover:bg-accent/20 text-accent font-medium text-sm transition-colors flex items-center justify-center gap-2"
                    >
                      <MessageCircle className="w-4 h-4" />
                      Continue to Chat
                    </button>
                  ) : (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 text-sm font-medium text-accent">
                          <MessageCircle className="w-4 h-4" />
                          Chat about this article
                        </div>
                        <button
                          onClick={() => setShowChat(false)}
                          className="text-xs text-foreground-secondary hover:text-foreground"
                        >
                          Hide
                        </button>
                      </div>

                      {/* Chat Messages */}
                      {chatMessages.length > 0 && (
                        <div ref={chatContainerRef} className="space-y-3 max-h-64 overflow-y-auto">
                          {chatMessages.map((msg, idx) => (
                            <div
                              key={idx}
                              className={cn(
                                'text-sm rounded-lg p-3',
                                msg.role === 'user'
                                  ? 'bg-accent/10 text-foreground ml-4'
                                  : 'bg-background-secondary text-foreground-secondary mr-4'
                              )}
                            >
                              <div className="text-xs font-medium mb-1 opacity-70">
                                {msg.role === 'user' ? 'You' : 'AI'}
                              </div>
                              <ReactMarkdown
                                components={{
                                  ul: ({ children }) => <ul className="list-disc list-inside space-y-0.5 my-1">{children}</ul>,
                                  ol: ({ children }) => <ol className="list-decimal list-inside space-y-0.5 my-1">{children}</ol>,
                                  li: ({ children }) => <li>{children}</li>,
                                  p: ({ children }) => <p className="my-1">{children}</p>,
                                  strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
                                  a: ({ href, children }) => <a href={href} className="text-accent hover:underline" target="_blank" rel="noopener noreferrer">{children}</a>,
                                }}
                              >
                                {msg.content}
                              </ReactMarkdown>
                              {/* Show web results if used */}
                              {msg.webResults && msg.webResults.length > 0 && (
                                <div className="mt-2 pt-2 border-t border-border/30">
                                  <div className="text-xs text-foreground-secondary/70 flex items-center gap-1 mb-1">
                                    <Search className="w-3 h-3" />
                                    Sources used
                                  </div>
                                  <div className="space-y-0.5">
                                    {msg.webResults.slice(0, 2).map((wr, i) => (
                                      <a
                                        key={i}
                                        href={wr.url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="block text-xs text-accent/70 hover:text-accent truncate"
                                      >
                                        • {wr.title}
                                      </a>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>
                          ))}
                          {isChatting && (
                            <div className="flex items-center gap-2 text-foreground-secondary text-sm p-3">
                              <Loader2 className="w-4 h-4 animate-spin" />
                              {enableWebSearch ? 'Searching and thinking...' : 'Thinking...'}
                            </div>
                          )}
                        </div>
                      )}

                      {/* Web Search Toggle */}
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => setEnableWebSearch(!enableWebSearch)}
                          className={cn(
                            'flex items-center gap-1.5 text-xs px-2 py-1 rounded-md transition-colors',
                            enableWebSearch
                              ? 'bg-accent/20 text-accent'
                              : 'bg-background-secondary text-foreground-secondary hover:text-foreground'
                          )}
                        >
                          <Globe className="w-3 h-3" />
                          Web Search {enableWebSearch ? 'On' : 'Off'}
                        </button>
                      </div>

                      {/* Chat Input */}
                      <form onSubmit={handleChatSubmit} className="flex gap-2">
                        <input
                          type="text"
                          value={chatInput}
                          onChange={(e) => setChatInput(e.target.value)}
                          placeholder="Ask a question about this article..."
                          className="flex-1 px-3 py-2 text-sm rounded-lg border border-border bg-background focus:border-accent focus:outline-none"
                          disabled={isChatting}
                        />
                        <button
                          type="submit"
                          disabled={!chatInput.trim() || isChatting}
                          className="px-3 py-2 rounded-lg bg-accent text-white disabled:opacity-50 disabled:cursor-not-allowed hover:bg-accent-hover transition-colors"
                        >
                          <Send className="w-4 h-4" />
                        </button>
                      </form>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Article Content - Cmd/Ctrl+Click links to preview */}
          {scrapedContent ? (
            <div
              onClick={handleContentClick}
              className={cn(
                "prose max-w-none prose-headings:text-foreground prose-headings:font-semibold prose-p:text-foreground prose-p:leading-relaxed prose-a:text-accent prose-a:no-underline hover:prose-a:underline prose-strong:text-foreground prose-blockquote:border-l-accent prose-blockquote:text-foreground-secondary prose-code:text-accent prose-code:bg-background-tertiary prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-pre:bg-background-tertiary prose-img:rounded-lg prose-img:max-w-full",
                isDark && "prose-invert"
              )}
              dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(scrapedContent.content) }}
            />
          ) : sanitizedContent ? (
            <div
              onClick={handleContentClick}
              className={cn(
                "prose max-w-none prose-headings:text-foreground prose-headings:font-semibold prose-p:text-foreground prose-p:leading-relaxed prose-a:text-accent prose-a:no-underline hover:prose-a:underline prose-strong:text-foreground prose-blockquote:border-l-accent prose-blockquote:text-foreground-secondary prose-code:text-accent prose-code:bg-background-tertiary prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-pre:bg-background-tertiary prose-img:rounded-lg prose-img:max-w-full",
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
                      <RelativeTime date={ra.article.pubDate} className="text-[10px]" />
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
