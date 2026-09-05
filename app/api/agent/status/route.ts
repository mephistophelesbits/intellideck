import { NextResponse } from 'next/server';
import { getDb } from '@/lib/server/db';
import { getServerAISettings } from '@/lib/server/settings-repository';
import { getPendingEnrichmentCount } from '@/lib/server/articles-repository';
import { ollamaBreaker } from '@/lib/ai/providers';

export const dynamic = 'force-dynamic';

async function checkOllama(baseUrl: string, embedModel: string, chatModel: string) {
  try {
    const res = await fetch(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return { reachable: false, embedModelOk: false, chatModelOk: false, models: [] as string[] };
    const data = await res.json() as { models?: Array<{ name: string }> };
    const names = (data.models ?? []).map((m) => m.name);
    return {
      reachable: true,
      embedModelOk: names.some((n) => n.startsWith(embedModel.split(':')[0])),
      chatModelOk: names.some((n) => n.startsWith(chatModel.split(':')[0])),
      models: names,
    };
  } catch {
    return { reachable: false, embedModelOk: false, chatModelOk: false, models: [] as string[] };
  }
}

export async function GET() {
  const db = getDb();
  const settings = getServerAISettings();

  const feedRow = db.prepare(`
    SELECT COUNT(*) AS total,
           MAX(last_fetched_at) AS lastFetchedAt,
           SUM(CASE WHEN last_error IS NOT NULL THEN 1 ELSE 0 END) AS errorCount
    FROM saved_feeds
  `).get() as { total: number; lastFetchedAt: string | null; errorCount: number };

  const todayStart = new Date().toISOString().slice(0, 10);

  const articleRow = db.prepare(`
    SELECT
      COUNT(CASE WHEN COALESCE(published_at, created_at) >= ? THEN 1 END) AS today,
      COUNT(CASE WHEN COALESCE(published_at, created_at) >= datetime('now', '-48 hours') THEN 1 END) AS last48h,
      COUNT(*) AS total
    FROM articles
  `).get(todayStart) as { today: number; last48h: number; total: number };

  let withEmbedding = 0;
  try {
    const r = db.prepare(`SELECT COUNT(*) AS cnt FROM article_vectors`).get() as { cnt: number };
    withEmbedding = r.cnt;
  } catch { /* sqlite-vec not loaded */ }

  const pendingEnrichment = getPendingEnrichmentCount();

  const ollamaStatus = settings.enabled
    ? await checkOllama(settings.baseUrl ?? 'http://localhost:11434', settings.embedModel, settings.model)
    : { reachable: false, embedModelOk: false, chatModelOk: false, models: [] as string[] };

  // Derive a simple pipeline health summary
  const issues: string[] = [];
  if (!settings.enabled) issues.push('AI disabled in settings');
  if (settings.enabled && !ollamaStatus.reachable) issues.push(`Ollama not reachable at ${settings.baseUrl}`);
  if (settings.enabled && ollamaStatus.reachable && !ollamaStatus.embedModelOk) issues.push(`Embed model "${settings.embedModel}" not found in Ollama`);
  if (settings.enabled && ollamaStatus.reachable && !ollamaStatus.chatModelOk) issues.push(`Chat model "${settings.model}" not found in Ollama`);
  if (ollamaBreaker.isOpen) issues.push('Ollama circuit breaker is open — LLM calls are paused. Reset it once the model is fixed.');
  if (feedRow.total === 0) issues.push('No feeds configured');
  if (feedRow.errorCount > 0) issues.push(`${feedRow.errorCount} feed(s) have errors`);
  if (articleRow.last48h === 0 && feedRow.total > 0) issues.push('No articles in last 48h — feeds may be stale');

  return NextResponse.json({
    ok: issues.length === 0,
    issues,
    feeds: {
      total: feedRow.total,
      lastFetchedAt: feedRow.lastFetchedAt,
      errorCount: feedRow.errorCount,
    },
    articles: {
      today: articleRow.today,
      last48h: articleRow.last48h,
      total: articleRow.total,
      withEmbedding,
      pendingEnrichment,
    },
    ai: {
      enabled: settings.enabled,
      provider: settings.provider,
      model: settings.model,
      embedModel: settings.embedModel,
      baseUrl: settings.baseUrl,
      breakerOpen: ollamaBreaker.isOpen,
      ...ollamaStatus,
    },
  });
}
