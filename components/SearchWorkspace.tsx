'use client';

import { useEffect, useMemo, useState } from 'react';
import { Search, Save, Trash2, ExternalLink, Database, RefreshCw } from 'lucide-react';
import { AppChrome } from '@/components/AppChrome';
import { ArticlePreviewPanel } from '@/components/ui/ArticlePreviewPanel';
import { RelativeTime } from '@/components/ui/RelativeTime';
import { Article } from '@/lib/types';
import { decodeHtml } from '@/lib/utils';

type SavedSearchRule = {
  id: string;
  name: string;
  query: string;
  keywords: string[];
  createdAt: string;
  updatedAt: string;
  lastRunAt: string | null;
};

type SearchResult = {
  id: string;
  title: string;
  url: string;
  publishedAt: string | null;
  sourceTitle: string | null;
  sourceUrl: string | null;
  contentSnippet: string | null;
  rawContent: string | null;
  category: string | null;
  importanceScore: number;
  matchedTerms: string[];
  relevance: number;
};

export function SearchWorkspace() {
  const [query, setQuery] = useState('');
  const [ruleName, setRuleName] = useState('');
  const [savedRules, setSavedRules] = useState<SavedSearchRule[]>([]);
  const [selectedRuleId, setSelectedRuleId] = useState<string | null>(null);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [keywords, setKeywords] = useState<string[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [workspaceMessage, setWorkspaceMessage] = useState<string | null>(null);
  const [selectedArticle, setSelectedArticle] = useState<Article | null>(null);

  const selectedRule = savedRules.find((rule) => rule.id === selectedRuleId) ?? null;

  useEffect(() => {
    void loadRules();
  }, []);

  const searchMeta = useMemo(() => {
    const sourceCount = new Set(results.map((result) => result.sourceTitle || result.sourceUrl || result.id)).size;
    return {
      resultCount: results.length,
      sourceCount,
    };
  }, [results]);

  async function loadRules() {
    const response = await fetch('/api/search/rules', { cache: 'no-store' });
    const data = await response.json();
    setSavedRules(data);
  }

  async function handleRunSearch(nextQuery?: string) {
    const queryToRun = (nextQuery ?? query).trim();
    if (!queryToRun) {
      setWorkspaceMessage('Enter one or more keywords separated by commas.');
      return;
    }

    setIsSearching(true);
    setWorkspaceMessage(null);

    try {
      const response = await fetch('/api/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: queryToRun }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Search failed');
      }

      setQuery(queryToRun);
      setKeywords(data.keywords ?? []);
      setResults(data.results ?? []);
      setSelectedArticle(data.results?.[0] ? mapSearchResultToArticle(data.results[0]) : null);
    } catch (error) {
      setWorkspaceMessage(error instanceof Error ? error.message : 'Search failed');
    } finally {
      setIsSearching(false);
    }
  }

  async function handleSaveRule() {
    const trimmedQuery = query.trim();
    if (!trimmedQuery) {
      setWorkspaceMessage('Run or enter a search before saving it.');
      return;
    }

    setIsSaving(true);
    setWorkspaceMessage(null);

    try {
      const response = await fetch('/api/search/rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: selectedRule?.query === trimmedQuery ? selectedRule.id : undefined,
          name: ruleName.trim() || undefined,
          query: trimmedQuery,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Failed to save search');
      }

      setSavedRules(data);
      const match = data.find((rule: SavedSearchRule) => rule.query === trimmedQuery);
      if (match) {
        setSelectedRuleId(match.id);
        setRuleName(match.name);
      }
      setWorkspaceMessage('Search rule saved locally.');
    } catch (error) {
      setWorkspaceMessage(error instanceof Error ? error.message : 'Failed to save search');
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDeleteRule(ruleId: string) {
    const response = await fetch(`/api/search/rules?ruleId=${encodeURIComponent(ruleId)}`, {
      method: 'DELETE',
    });
    const data = await response.json();
    if (!response.ok) {
      setWorkspaceMessage(data.error || 'Failed to delete search rule');
      return;
    }

    setSavedRules(data);
    if (selectedRuleId === ruleId) {
      setSelectedRuleId(null);
      setRuleName('');
    }
  }

  const handleSelectRule = async (rule: SavedSearchRule) => {
    setSelectedRuleId(rule.id);
    setRuleName(rule.name);
    setQuery(rule.query);
    await handleRunSearch(rule.query);
  };

  const handleRefreshAll = async () => {
    const response = await fetch('/api/intelligence/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || 'Failed to refresh saved feeds');
    }
  };

  return (
    <AppChrome onRefreshAll={handleRefreshAll}>
      <div className="flex h-full overflow-hidden">
        <aside className="w-[280px] border-r border-border bg-background-secondary/70 p-4">
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent/15 text-accent">
              <Search className="h-4 w-4" />
            </div>
            <div>
              <h1 className="text-lg font-semibold">Search</h1>
              <p className="text-xs text-foreground-secondary">Saved article search rules</p>
            </div>
          </div>

          <div className="mt-4 space-y-3">
            <input
              type="text"
              value={ruleName}
              onChange={(event) => setRuleName(event.target.value)}
              placeholder="Rule name (optional)"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:border-accent focus:outline-none"
            />
            <button
              type="button"
              onClick={handleSaveRule}
              disabled={isSaving}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-accent px-3 py-2 text-sm font-medium text-[color:var(--accent-foreground)] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Save className="h-4 w-4" />
              {isSaving ? 'Saving…' : 'Save Search'}
            </button>
          </div>

          <div className="mt-5 flex items-center justify-between">
            <div className="text-xs font-medium uppercase tracking-[0.22em] text-foreground-secondary">Saved Rules</div>
            <div className="text-xs text-foreground-secondary">{savedRules.length}</div>
          </div>

          <div className="mt-3 space-y-2 overflow-y-auto pr-1" style={{ maxHeight: 'calc(100vh - 260px)' }}>
            {savedRules.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border p-4 text-sm text-foreground-secondary">
                Save a search to reuse your keyword rules later.
              </div>
            ) : (
              savedRules.map((rule) => (
                <div
                  key={rule.id}
                  className={`rounded-xl border p-3 transition-colors ${
                    selectedRuleId === rule.id
                      ? 'border-accent bg-accent/10'
                      : 'border-border bg-background hover:border-foreground-secondary/30'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => void handleSelectRule(rule)}
                    className="w-full text-left"
                  >
                    <div className="truncate text-sm font-medium">{rule.name}</div>
                    <div className="mt-1 line-clamp-2 text-xs text-foreground-secondary">{rule.query}</div>
                    <div className="mt-2 flex flex-wrap gap-1">
                      {rule.keywords.slice(0, 4).map((keyword) => (
                        <span key={keyword} className="rounded-full border border-border px-2 py-0.5 text-[11px] text-foreground-secondary">
                          {keyword}
                        </span>
                      ))}
                    </div>
                  </button>
                  <div className="mt-3 flex items-center justify-between text-[11px] text-foreground-secondary">
                    <span>{rule.lastRunAt ? `Ran ${new Date(rule.lastRunAt).toLocaleDateString()}` : 'Not run yet'}</span>
                    <button
                      type="button"
                      onClick={() => void handleDeleteRule(rule.id)}
                      className="rounded-md p-1 transition-colors hover:bg-background-tertiary hover:text-error"
                      aria-label={`Delete ${rule.name}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 overflow-hidden">
          <div className="flex min-w-0 flex-1 flex-col border-r border-border">
            <header className="border-b border-border bg-background-secondary px-5 py-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-lg font-semibold">Article Search</h2>
                  <p className="mt-1 text-sm text-foreground-secondary">
                    Search your stored corpus with comma-separated keywords. Example: <span className="text-foreground">china, semiconductors, export controls</span>
                  </p>
                </div>
                <div className="rounded-xl border border-border bg-background px-3 py-2 text-xs text-foreground-secondary">
                  <div className="font-medium text-foreground">{searchMeta.resultCount}</div>
                  <div>results</div>
                </div>
              </div>

              <div className="mt-4 flex gap-3">
                <div className="relative flex-1">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-foreground-secondary" />
                  <input
                    type="text"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        void handleRunSearch();
                      }
                    }}
                    placeholder="Keywords separated by commas"
                    className="w-full rounded-xl border border-border bg-background px-10 py-3 text-sm focus:border-accent focus:outline-none"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => void handleRunSearch()}
                  disabled={isSearching}
                  className="rounded-xl bg-accent px-4 py-3 text-sm font-medium text-[color:var(--accent-foreground)] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isSearching ? 'Searching…' : 'Search'}
                </button>
                <button
                  type="button"
                  onClick={() => void handleRunSearch()}
                  disabled={isSearching || !query.trim()}
                  className="inline-flex items-center justify-center rounded-xl border border-border bg-background px-4 py-3 text-sm font-medium text-foreground-secondary transition-colors hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-50"
                  title="Refresh search results"
                >
                  <RefreshCw className={`h-4 w-4 ${isSearching ? 'animate-spin' : ''}`} />
                </button>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                {keywords.map((keyword) => (
                  <span key={keyword} className="rounded-full border border-border bg-background px-2.5 py-1 text-xs text-foreground-secondary">
                    {keyword}
                  </span>
                ))}
                {keywords.length > 0 && (
                  <span className="text-xs text-foreground-secondary">
                    {searchMeta.sourceCount} sources
                  </span>
                )}
              </div>
              {workspaceMessage && (
                <div className="mt-3 text-sm text-foreground-secondary">{workspaceMessage}</div>
              )}
            </header>

            <div className="flex-1 overflow-y-auto">
              {results.length === 0 ? (
                <div className="flex h-full flex-col items-center justify-center px-6 text-center text-foreground-secondary">
                  <Database className="mb-4 h-10 w-10 opacity-40" />
                  <p className="text-base font-medium text-foreground">Search your stored articles</p>
                  <p className="mt-2 max-w-lg text-sm">
                    Results include title, article snippet, source title, extracted themes, and entities from the local intelligence database.
                  </p>
                </div>
              ) : (
                <div className="divide-y divide-border">
                  {results.map((result, index) => (
                    <button
                      key={result.id}
                      type="button"
                      onClick={() => setSelectedArticle(mapSearchResultToArticle(result))}
                      className={`block w-full p-4 text-left transition-colors hover:bg-background-secondary ${
                        selectedArticle?.id === result.id ? 'bg-accent/10' : ''
                      }`}
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 text-xs text-foreground-secondary">
                            <span className="rounded-full border border-border px-2 py-0.5">{index + 1}</span>
                            {result.category && <span>{result.category}</span>}
                            {result.sourceTitle && <span className="truncate">{decodeHtml(result.sourceTitle)}</span>}
                            {result.publishedAt && <RelativeTime date={result.publishedAt} />}
                          </div>
                          <h3 className="mt-2 line-clamp-2 text-base font-semibold text-foreground">
                            {decodeHtml(result.title)}
                          </h3>
                          {result.contentSnippet && (
                            <p className="mt-2 line-clamp-2 text-sm text-foreground-secondary">
                              {decodeHtml(result.contentSnippet)}
                            </p>
                          )}
                          <div className="mt-3 flex flex-wrap items-center gap-2">
                            {result.matchedTerms.map((term) => (
                              <span key={term} className="rounded-full bg-accent/10 px-2 py-0.5 text-[11px] text-accent">
                                {term}
                              </span>
                            ))}
                          </div>
                        </div>
                        <div className="shrink-0 text-right">
                          <div className="text-sm font-semibold">{result.relevance.toFixed(1)}</div>
                          <div className="text-[11px] uppercase tracking-[0.18em] text-foreground-secondary">score</div>
                          <a
                            href={result.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(event) => event.stopPropagation()}
                            className="mt-3 inline-flex rounded-lg border border-border p-2 text-foreground-secondary transition-colors hover:border-accent hover:text-accent"
                            title="Open original"
                          >
                            <ExternalLink className="h-4 w-4" />
                          </a>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="hidden xl:block xl:w-[38%] xl:min-w-[380px]">
            <ArticlePreviewPanel
              article={selectedArticle}
              onClose={() => setSelectedArticle(null)}
            />
          </div>
        </div>
      </div>
    </AppChrome>
  );
}

function mapSearchResultToArticle(result: SearchResult): Article {
  return {
    id: result.id,
    title: result.title,
    link: result.url,
    pubDate: result.publishedAt || new Date().toISOString(),
    contentSnippet: result.contentSnippet || undefined,
    content: result.rawContent || undefined,
    sourceTitle: result.sourceTitle || undefined,
    sourceUrl: result.sourceUrl || undefined,
  };
}
