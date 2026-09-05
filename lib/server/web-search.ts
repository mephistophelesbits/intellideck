import 'server-only';

import { getPersistedSettings } from './settings-repository';
import { getDefaultSettingsSnapshot } from '@/lib/settings-store';

export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
  source?: string;
}

export interface WebSearchResponse {
  results: WebSearchResult[];
  query: string;
  provider: string;
}

// ---------------------------------------------------------------------------
// SearXNG (self-hosted) — primary
// ---------------------------------------------------------------------------
async function searchSearxng(query: string, baseUrl: string, maxResults: number): Promise<WebSearchResult[]> {
  const url = `${baseUrl}/search?q=${encodeURIComponent(query)}&format=json&categories=news,general&language=en`;
  const res = await fetch(url, {
    headers: { 'Accept': 'application/json' },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) return [];
  const data = await res.json() as { results?: Array<{ title: string; url: string; content?: string; engine?: string }> };
  return (data.results ?? []).slice(0, maxResults).map((r) => ({
    title: r.title,
    url: r.url,
    snippet: r.content ?? '',
    source: r.engine,
  }));
}

// ---------------------------------------------------------------------------
// Brave Search API — secondary
// ---------------------------------------------------------------------------
async function searchBrave(query: string, apiKey: string, maxResults: number): Promise<WebSearchResult[]> {
  const url = `https://api.search.brave.com/res/v1/news/search?q=${encodeURIComponent(query)}&count=${maxResults}&freshness=pw`;
  const res = await fetch(url, {
    headers: {
      'Accept': 'application/json',
      'Accept-Encoding': 'gzip',
      'X-Subscription-Token': apiKey,
    },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) return [];
  const data = await res.json() as { results?: Array<{ title: string; url: string; description?: string; meta_url?: { hostname?: string } }> };
  return (data.results ?? []).slice(0, maxResults).map((r) => ({
    title: r.title,
    url: r.url,
    snippet: r.description ?? '',
    source: r.meta_url?.hostname,
  }));
}

// ---------------------------------------------------------------------------
// DuckDuckGo HTML scraping — fallback
// ---------------------------------------------------------------------------
function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"').replace(/&#39;/gi, "'").replace(/&nbsp;/gi, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/&#x([a-fA-F0-9]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

async function searchDuckDuckGo(query: string, maxResults: number): Promise<WebSearchResult[]> {
  const url = `https://duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const ua = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/121.0.0.0 Safari/537.36';
  const res = await fetch(url, {
    headers: { 'User-Agent': ua, 'Accept': 'text/html', 'Accept-Language': 'en-US,en;q=0.9' },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) return [];
  const html = await res.text();
  const titleRe = /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
  const snippetRe = /<a[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/gi;
  const titles = [...html.matchAll(titleRe)];
  const snippets = [...html.matchAll(snippetRe)];
  const results: WebSearchResult[] = [];
  for (let i = 0; i < Math.min(titles.length, maxResults); i++) {
    let href = titles[i][1];
    if (href.includes('uddg=')) {
      const m = href.match(/uddg=([^&]*)/);
      if (m) href = decodeURIComponent(m[1]);
    }
    const title = decodeEntities(titles[i][2].replace(/<[^>]*>/g, '').trim());
    const snippet = snippets[i] ? decodeEntities(snippets[i][1].replace(/<[^>]*>/g, '').trim()) : '';
    if (href && title && !href.startsWith('/')) results.push({ title, url: href, snippet });
  }
  return results;
}

// ---------------------------------------------------------------------------
// Unified search — tries providers in order
// ---------------------------------------------------------------------------
export async function webSearch(query: string, maxResults = 5): Promise<WebSearchResponse> {
  const settings = getPersistedSettings(getDefaultSettingsSnapshot());
  const ws = settings.webSearchSettings;

  // 1. DuckDuckGo — no config required
  try {
    const results = await searchDuckDuckGo(query, maxResults);
    if (results.length > 0) return { results, query, provider: 'duckduckgo' };
  } catch { /* fall through */ }

  // 2. Brave Search API
  if (ws?.braveApiKey) {
    try {
      const results = await searchBrave(query, ws.braveApiKey, maxResults);
      if (results.length > 0) return { results, query, provider: 'brave' };
    } catch { /* fall through */ }
  }

  // 3. SearXNG (self-hosted)
  if (ws?.searxngUrl) {
    try {
      const results = await searchSearxng(query, ws.searxngUrl, maxResults);
      if (results.length > 0) return { results, query, provider: 'searxng' };
    } catch { /* fall through */ }
  }

  return { results: [], query, provider: 'none' };
}
