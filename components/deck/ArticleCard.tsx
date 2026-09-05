import { Bookmark } from 'lucide-react';
import { Article } from '@/lib/types';
import { useBookmarksStore } from '@/lib/bookmarks-store';
import { useReadArticlesStore } from '@/lib/read-articles-store';
import { useSettingsStore } from '@/lib/settings-store';
import { TimeAgo } from '@/components/ui/TimeAgo';
import { cn, decodeHtml } from '@/lib/utils';
import { useTranslation } from '@/lib/i18n';


interface ArticleCardProps {
  article: Article;
  viewMode?: 'compact' | 'comfortable';
  onClick: (article: Article) => void;
  isSelected?: boolean;
}

// Meridian design direction: show the source's favicon next to its name.
// Purely presentational — derived from the feed's site URL (or the article link).
function sourceFaviconUrl(article: Article): string | null {
  const base = article.sourceUrl || article.link;
  if (!base) return null;
  try {
    const host = new URL(base).hostname;
    return `https://www.google.com/s2/favicons?domain=${host}&sz=64`;
  } catch {
    return null;
  }
}



export function ArticleCard({ article, viewMode = 'comfortable', onClick, isSelected = false }: ArticleCardProps) {
  const { t } = useTranslation();
  const { isBookmarked, toggleBookmark } = useBookmarksStore();
  const bookmarked = isBookmarked(article.id);
  const { isRead, markRead } = useReadArticlesStore();
  const read = isRead(article.id);
  const { keywordAlerts } = useSettingsStore();
  const matchedAlert = keywordAlerts
    .filter(a => a.enabled)
    .find(a => {
      const escaped = a.keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return new RegExp(`\\b${escaped}\\b`, 'i').test(article.title);
    });
  const handleBookmarkClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    toggleBookmark(article);
  };

  return (
    <button
      onClick={() => {
        markRead(article.id);
        onClick(article);
      }}
      className={cn(
        'w-full text-left p-3 border-b border-border hover:bg-background-tertiary transition-colors group relative article-card',
        viewMode === 'compact' && 'py-2',
        isSelected && 'bg-accent/20 border-l-2 border-l-accent',
        read && 'opacity-50 hover:opacity-100'
      )}
    >
      <div className="flex gap-3">
        {article.thumbnail && viewMode === 'comfortable' && (
          <div className="flex-shrink-0">
            <img
              src={article.thumbnail}
              alt=""
              loading="lazy"
              decoding="async"
              referrerPolicy="no-referrer"
              className="w-16 h-16 object-cover rounded"
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = 'none';
              }}
            />
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-start gap-2">
            {!read && (
              <span className="mt-1.5 w-2 h-2 rounded-full bg-accent flex-shrink-0" />
            )}
            <h3
              className={cn(
                'transition-colors line-clamp-2 flex-1',
                read ? 'font-normal text-foreground-secondary' : 'font-medium',
                !matchedAlert && !read && 'text-foreground group-hover:text-accent',
                !matchedAlert && read && 'text-foreground-secondary',
                viewMode === 'compact' ? 'text-sm' : 'text-base'
              )}
              style={matchedAlert ? { color: matchedAlert.color } : undefined}
            >
              {decodeHtml(article.title)}
            </h3>
            {matchedAlert && (
              <span
                style={{
                  background: matchedAlert.color + '22',
                  color: matchedAlert.color,
                  border: `1px solid ${matchedAlert.color}55`,
                }}
                className="text-[10px] font-bold px-1.5 py-0.5 rounded-full flex-shrink-0 mt-0.5"
              >
                {matchedAlert.keyword}
              </span>
            )}
          </div>
          {article.contentSnippet && viewMode === 'comfortable' && (
            <p className="text-sm text-foreground-secondary mt-1 line-clamp-2">
              {decodeHtml(article.contentSnippet)}
            </p>
          )}

          <div className="flex items-center gap-1.5 mt-1.5 text-xs">
            {article.sourceTitle && (
              <>
                {sourceFaviconUrl(article) && (
                  <img
                    src={sourceFaviconUrl(article)!}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    referrerPolicy="no-referrer"
                    className="w-3.5 h-3.5 rounded-sm flex-shrink-0"
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = 'none';
                    }}
                  />
                )}
                <span className="truncate max-w-[140px] text-accent font-mono text-[10px] uppercase tracking-wide font-medium">
                  {decodeHtml(article.sourceTitle)}
                </span>
                <span className="text-foreground-secondary">·</span>
              </>
            )}
            <TimeAgo date={article.pubDate} className="text-warning font-mono text-[10px] font-medium" />
          </div>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="absolute top-2 right-2 flex flex-col gap-1">
        {/* Bookmark button */}
        <div
          onClick={handleBookmarkClick}
          className={cn(
            'p-1.5 rounded transition-all',
            bookmarked
              ? 'text-warning bg-warning/10'
              : 'text-foreground-secondary opacity-0 group-hover:opacity-100 hover:text-warning hover:bg-warning/10'
          )}
          title={bookmarked ? t('article.removeBookmark') : t('article.addBookmark')}
        >
          <Bookmark className={cn('w-4 h-4', bookmarked && 'fill-current')} />
        </div>
      </div>
    </button>
  );
}
