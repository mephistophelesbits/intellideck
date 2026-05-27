#!/usr/bin/env node
/**
 * IntelliDeck MCP Server (zero-dependency)
 * Uses Node.js built-in node:sqlite (Node 22+) and raw JSON-RPC 2.0 over stdio.
 *
 * DB path resolution (first match wins):
 *   1. INTELLIDECK_DB env var
 *   2. ~/Library/Application Support/IntelliDeck/data/intellideck.db  (Electron prod)
 *   3. <script_dir>/data/intellideck.db
 *   4. <script_dir>/data/rssdeck.db  (legacy dev)
 *
 * Register in ~/Library/Application Support/Claude/claude_desktop_config.json:
 *   "intellideck": {
 *     "command": "node",
 *     "args": ["/Users/fong/SynologyDrive/Jarvis/Projects/IntelliDeck/intellideck-mcp.mjs"]
 *   }
 */

import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── DB resolution ─────────────────────────────────────────────────────────────

function findDb() {
  const candidates = [
    process.env.INTELLIDECK_DB,
    join(homedir(), 'Library', 'Application Support', 'IntelliDeck', 'data', 'intellideck.db'),
    join(__dirname, 'data', 'intellideck.db'),
    join(__dirname, 'data', 'rssdeck.db'),
  ].filter(Boolean);

  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  throw new Error(
    'IntelliDeck database not found. Open IntelliDeck at least once or set INTELLIDECK_DB.'
  );
}

let _db = null;
function getDb() {
  if (!_db) {
    _db = new DatabaseSync(findDb(), { open: true });
    _db.exec('PRAGMA journal_mode=WAL; PRAGMA query_only=ON;');
  }
  return _db;
}

// ── Tool implementations ──────────────────────────────────────────────────────

function listColumns() {
  const rows = getDb()
    .prepare('SELECT id, title, type, sources_json FROM columns_state ORDER BY position')
    .all();
  return rows.map(r => ({
    id: r.id,
    title: r.title,
    type: r.type,
    sources: JSON.parse(r.sources_json || '[]').map(s => ({ id: s.id, title: s.title })),
  }));
}

function getTodayPriorityFeed({ days = 2, limit = 30 } = {}) {
  const cutoff = new Date(Date.now() - days * 86400_000).toISOString();
  const rows = getDb().prepare(`
    SELECT
      a.id, a.title, a.canonical_url AS url, a.source_title,
      a.published_at, a.created_at, a.content_snippet, a.author,
      aa.primary_category AS category, aa.tags_json, aa.importance_score
    FROM articles a
    LEFT JOIN article_analysis aa ON aa.article_id = a.id
    WHERE COALESCE(a.published_at, a.created_at) >= ?
    ORDER BY COALESCE(aa.importance_score, 0) DESC,
             COALESCE(a.published_at, a.created_at) DESC
    LIMIT ?
  `).all(cutoff, limit);

  return rows.map(r => ({
    id: r.id,
    title: r.title,
    url: r.url,
    source: r.source_title,
    publishedAt: r.published_at || r.created_at,
    category: r.category,
    tags: parseTags(r.tags_json, 8),
    importanceScore: Math.round((r.importance_score || 0) * 10) / 10,
    summary: (r.content_snippet || '').slice(0, 400),
  }));
}

function parseTags(json, max) {
  const raw = JSON.parse(json || '[]');
  return raw.slice(0, max).map(t => (typeof t === 'string' ? t : t?.name ?? String(t)));
}

function getColumnArticles({ column_id, limit = 30 } = {}) {
  const db = getDb();
  const col = db.prepare('SELECT sources_json FROM columns_state WHERE id = ?').get(column_id);
  if (!col) return { error: `Column '${column_id}' not found. Call list_columns to see valid IDs.` };

  const sources = JSON.parse(col.sources_json || '[]');
  const urls = sources.map(s => s.url).filter(Boolean);
  if (!urls.length) return { error: 'Column has no source URLs configured.' };

  const placeholders = urls.map(() => '?').join(',');
  const rows = db.prepare(`
    SELECT
      a.id, a.title, a.canonical_url AS url, a.source_title,
      a.published_at, a.created_at, a.content_snippet,
      aa.primary_category AS category, aa.tags_json, aa.importance_score
    FROM articles a
    LEFT JOIN article_analysis aa ON aa.article_id = a.id
    WHERE a.source_url IN (${placeholders})
    ORDER BY COALESCE(a.published_at, a.created_at) DESC
    LIMIT ?
  `).all(...urls, limit);

  return rows.map(r => ({
    id: r.id,
    title: r.title,
    url: r.url,
    source: r.source_title,
    publishedAt: r.published_at || r.created_at,
    category: r.category,
    tags: parseTags(r.tags_json, 6),
    importanceScore: Math.round((r.importance_score || 0) * 10) / 10,
    summary: (r.content_snippet || '').slice(0, 400),
  }));
}

function getLatestBriefing() {
  const row = getDb().prepare(`
    SELECT briefing_date, title, executive_summary, key_themes_json, top_stories_json
    FROM briefings ORDER BY created_at DESC LIMIT 1
  `).get();
  if (!row) return { status: 'No briefing generated yet. Open IntelliDeck to trigger one.' };
  return {
    date: row.briefing_date,
    title: row.title,
    executiveSummary: row.executive_summary,
    keyThemes: JSON.parse(row.key_themes_json || '[]'),
    topStories: JSON.parse(row.top_stories_json || '[]'),
  };
}

// ── MCP tool definitions ──────────────────────────────────────────────────────

const TOOLS = [
  {
    name: 'list_columns',
    description: 'List all IntelliDeck deck columns with their IDs, titles, and source feeds.',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'get_today_priority_feed',
    description: 'Return top priority articles from the last N days ranked by importance score. Each article includes title, source, publishedAt, category, tags, importanceScore, and summary.',
    inputSchema: {
      type: 'object',
      properties: {
        days:  { type: 'number', description: 'How many days back to look (default 2)' },
        limit: { type: 'number', description: 'Max articles to return (default 30)' },
      },
    },
  },
  {
    name: 'get_column_articles',
    description: 'Return the latest articles for a specific deck column. Common IDs: col-tech-en (Hacker News + The Verge), col-tech-zh (36Kr + 少数派), col-world-en (BBC + Reuters), col-world-zh (BBC中文 + 联合早报).',
    inputSchema: {
      type: 'object',
      properties: {
        column_id: { type: 'string', description: 'Column ID, e.g. "col-tech-zh"' },
        limit:     { type: 'number', description: 'Max articles to return (default 30)' },
      },
      required: ['column_id'],
    },
  },
  {
    name: 'get_latest_briefing',
    description: 'Return the most recent AI-generated daily briefing: executive summary, key themes, top stories.',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
];

// ── JSON-RPC 2.0 / MCP stdio handler ─────────────────────────────────────────

function respond(id, result) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n');
}

function errorResponse(id, code, message) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } }) + '\n');
}

function handleRequest(msg) {
  const { id, method, params } = msg;

  if (method === 'initialize') {
    return respond(id, {
      protocolVersion: '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: 'intellideck', version: '1.0.0' },
    });
  }

  if (method === 'notifications/initialized') return; // no response needed

  if (method === 'tools/list') {
    return respond(id, { tools: TOOLS });
  }

  if (method === 'tools/call') {
    const { name, arguments: args = {} } = params || {};
    try {
      let data;
      if (name === 'list_columns')             data = listColumns();
      else if (name === 'get_today_priority_feed') data = getTodayPriorityFeed(args);
      else if (name === 'get_column_articles') data = getColumnArticles(args);
      else if (name === 'get_latest_briefing') data = getLatestBriefing();
      else return errorResponse(id, -32601, `Unknown tool: ${name}`);

      return respond(id, {
        content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
      });
    } catch (err) {
      return respond(id, {
        content: [{ type: 'text', text: `Error: ${err.message}` }],
        isError: true,
      });
    }
  }

  if (method === 'ping') return respond(id, {});

  // Unknown methods — respond with empty result to avoid hanging
  if (id !== undefined && id !== null) respond(id, {});
}

const rl = createInterface({ input: process.stdin, terminal: false });
rl.on('line', line => {
  const trimmed = line.trim();
  if (!trimmed) return;
  try {
    handleRequest(JSON.parse(trimmed));
  } catch {
    // ignore malformed input
  }
});
