'use client';

import { X, Bookmark, Trash2, ExternalLink } from 'lucide-react';
import { useBookmarksStore } from '@/lib/bookmarks-store';
import { TimeAgo } from '@/components/ui/TimeAgo';
import { Article } from '@/lib/types';
import { decodeHtml } from '@/lib/utils';
import { useTranslation } from '@/lib/i18n';

interface BookmarksModalProps {
  isOpen: boolean;
  onClose: () => void;
  onArticleClick: (article: Article) => void;
}

export function BookmarksModal({ isOpen, onClose, onArticleClick }: BookmarksModalProps) {
  const { t } = useTranslation();
  const { bookmarks, removeBookmark } = useBookmarksStore();

  if (!isOpen) return null;

  const handleArticleClick = (article: Article) => {
    onArticleClick(article);
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
      <div className="relative bg-background-secondary border border-border rounded-xl w-full max-w-2xl mx-4 shadow-2xl max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border flex-shrink-0">
          <div className="flex items-center gap-2">
            <Bookmark className="w-5 h-5 text-warning" />
            <h2 className="text-lg font-semibold">{t('bookmarks.title')}</h2>
            <span className="text-sm text-foreground-secondary">
              {t('bookmarks.savedCount', { count: bookmarks.length })}
            </span>
          </div>
          <button
            onClick={onClose}
            className="p-1 hover:bg-background-tertiary rounded transition-colors text-foreground-secondary hover:text-foreground"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {bookmarks.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-foreground-secondary">
              <Bookmark className="w-12 h-12 mb-3 opacity-30" />
              <p className="text-base font-medium">{t('bookmarks.noBookmarks')}</p>
              <p className="text-sm mt-1 opacity-70">
                {t('bookmarks.noBookmarksDesc')}
              </p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {bookmarks.map((article) => (
                <div
                  key={article.id}
                  className="p-4 hover:bg-background-tertiary transition-colors group"
                >
                  <div className="flex gap-3">
                    {article.thumbnail && (
                      <div className="flex-shrink-0">
                        <img
                          src={article.thumbnail}
                          alt=""
                          className="w-20 h-20 object-cover rounded"
                          onError={(e) => {
                            (e.target as HTMLImageElement).style.display = 'none';
                          }}
                        />
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <button
                        onClick={() => handleArticleClick(article)}
                        className="text-left w-full"
                      >
                        <h3 className="font-medium text-foreground group-hover:text-accent transition-colors line-clamp-2">
                          {decodeHtml(article.title)}
                        </h3>
                        {article.contentSnippet && (
                          <p className="text-sm text-foreground-secondary mt-1 line-clamp-2">
                            {decodeHtml(article.contentSnippet)}
                          </p>
                        )}
                      </button>
                      <div className="flex items-center justify-between mt-2">
                        <div className="flex items-center gap-2 text-xs">
                          {article.sourceTitle && (
                            <>
                              <span className="text-accent font-medium truncate max-w-[150px]">
                                {decodeHtml(article.sourceTitle)}
                              </span>
                              <span className="text-foreground-secondary">·</span>
                            </>
                          )}
                          <TimeAgo date={article.pubDate} className="text-warning font-medium" />
                        </div>
                        <div className="flex items-center gap-1">
                          <a
                            href={article.link}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="p-1.5 rounded hover:bg-background text-foreground-secondary hover:text-accent transition-colors"
                            title={t('bookmarks.openOriginal')}
                            onClick={(e) => e.stopPropagation()}
                          >
                            <ExternalLink className="w-4 h-4" />
                          </a>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              removeBookmark(article.id);
                            }}
                            className="p-1.5 rounded hover:bg-background text-foreground-secondary hover:text-error transition-colors"
                            title={t('bookmarks.removeBookmark')}
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
