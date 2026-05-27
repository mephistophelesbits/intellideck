#!/usr/bin/env python3
"""
IntelliDeck MCP Server
Reads directly from the local SQLite database — no HTTP, no Chrome needed.

DB path resolution (first match wins):
  1. $INTELLIDECK_DB  — override via env var
  2. ~/Library/Application Support/IntelliDeck/data/intellideck.db  (Electron production)
  3. <script_dir>/data/intellideck.db  (dev build)
  4. <script_dir>/data/rssdeck.db      (legacy dev name)

Tools:
  get_today_priority_feed  — top articles from last N days ranked by importance
  get_column_articles      — articles for a deck column (col-tech-zh, col-tech-en, …)
  get_latest_briefing      — most recent AI-generated briefing summary
  list_columns             — list all deck columns with their source feeds
"""

import json
import os
import sqlite3
from datetime import datetime, timedelta, timezone
from pathlib import Path

from mcp.server.fastmcp import FastMCP

# ── DB path resolution ────────────────────────────────────────────────────────

def find_db() -> Path:
    candidates = [
        os.environ.get("INTELLIDECK_DB"),
        Path.home() / "Library" / "Application Support" / "IntelliDeck" / "data" / "intellideck.db",
        Path(__file__).parent / "data" / "intellideck.db",
        Path(__file__).parent / "data" / "rssdeck.db",
    ]
    for c in candidates:
        if c and Path(c).exists():
            return Path(c)
    raise FileNotFoundError(
        "IntelliDeck database not found. "
        "Set INTELLIDECK_DB env var or ensure IntelliDeck has been opened at least once."
    )

mcp = FastMCP("intellideck")


def get_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(str(find_db()), check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA query_only=ON")
    return conn


# ── Tools ─────────────────────────────────────────────────────────────────────

@mcp.tool()
def list_columns() -> str:
    """List all deck columns — returns ID, title, type, and source feeds for each."""
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT id, title, type, sources_json FROM columns_state ORDER BY position"
        ).fetchall()
    result = []
    for r in rows:
        sources = json.loads(r["sources_json"] or "[]")
        result.append({
            "id": r["id"],
            "title": r["title"],
            "type": r["type"],
            "sources": [{"id": s.get("id"), "title": s.get("title")} for s in sources],
        })
    return json.dumps(result, ensure_ascii=False, indent=2)


@mcp.tool()
def get_today_priority_feed(days: int = 2, limit: int = 30) -> str:
    """
    Return top priority articles from the last N days, sorted by importance score.
    Each article includes: title, source, publishedAt, category, tags,
    importanceScore, and content summary.

    Args:
        days:  How many days back to look (default 2)
        limit: Max articles to return (default 30)
    """
    cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()

    sql = """
        SELECT
            a.id,
            a.title,
            a.canonical_url        AS url,
            a.source_title,
            a.published_at,
            a.created_at,
            a.content_snippet,
            a.author,
            aa.primary_category    AS category,
            aa.tags_json,
            aa.importance_score
        FROM articles a
        LEFT JOIN article_analysis aa ON aa.article_id = a.id
        WHERE COALESCE(a.published_at, a.created_at) >= ?
        ORDER BY COALESCE(aa.importance_score, 0) DESC,
                 COALESCE(a.published_at, a.created_at) DESC
        LIMIT ?
    """
    with get_conn() as conn:
        rows = conn.execute(sql, (cutoff, limit)).fetchall()

    result = []
    for r in rows:
        tags = json.loads(r["tags_json"] or "[]")
        result.append({
            "id": r["id"],
            "title": r["title"],
            "url": r["url"],
            "source": r["source_title"],
            "publishedAt": r["published_at"] or r["created_at"],
            "category": r["category"],
            "tags": tags[:8],
            "importanceScore": round(float(r["importance_score"] or 0), 1),
            "summary": (r["content_snippet"] or "")[:400],
        })

    return json.dumps(result, ensure_ascii=False, indent=2)


@mcp.tool()
def get_column_articles(column_id: str, limit: int = 30) -> str:
    """
    Return the latest articles for a specific deck column.
    Call list_columns() first to see all available IDs.

    Common column IDs:
      col-tech-en   — Tech News (EN):  Hacker News + The Verge
      col-tech-zh   — 科技资讯 (ZH):   36Kr + 少数派
      col-world-en  — World News (EN): BBC + Reuters
      col-world-zh  — 世界新闻 (ZH):   BBC 中文 + 联合早报

    Args:
        column_id: The column ID string (e.g. "col-tech-zh")
        limit:     Max articles to return (default 30)
    """
    with get_conn() as conn:
        col = conn.execute(
            "SELECT sources_json FROM columns_state WHERE id = ?", (column_id,)
        ).fetchone()

        if not col:
            return json.dumps({"error": f"Column '{column_id}' not found. Call list_columns() to see valid IDs."})

        sources = json.loads(col["sources_json"] or "[]")
        source_urls = [s["url"] for s in sources if s.get("url")]

        if not source_urls:
            return json.dumps({"error": "Column has no source URLs configured."})

        placeholders = ",".join("?" * len(source_urls))
        sql = f"""
            SELECT
                a.id,
                a.title,
                a.canonical_url   AS url,
                a.source_title,
                a.published_at,
                a.created_at,
                a.content_snippet,
                aa.primary_category AS category,
                aa.tags_json,
                aa.importance_score
            FROM articles a
            LEFT JOIN article_analysis aa ON aa.article_id = a.id
            WHERE a.source_url IN ({placeholders})
            ORDER BY COALESCE(a.published_at, a.created_at) DESC
            LIMIT ?
        """
        rows = conn.execute(sql, (*source_urls, limit)).fetchall()

    result = []
    for r in rows:
        tags = json.loads(r["tags_json"] or "[]")
        result.append({
            "id": r["id"],
            "title": r["title"],
            "url": r["url"],
            "source": r["source_title"],
            "publishedAt": r["published_at"] or r["created_at"],
            "category": r["category"],
            "tags": tags[:6],
            "importanceScore": round(float(r["importance_score"] or 0), 1),
            "summary": (r["content_snippet"] or "")[:400],
        })

    return json.dumps(result, ensure_ascii=False, indent=2)


@mcp.tool()
def get_latest_briefing() -> str:
    """
    Return the most recent AI-generated daily briefing: executive summary,
    key themes, and top stories. Returns a status message if none exists yet.
    """
    sql = """
        SELECT briefing_date, title, executive_summary, key_themes_json, top_stories_json
        FROM briefings
        ORDER BY created_at DESC
        LIMIT 1
    """
    with get_conn() as conn:
        row = conn.execute(sql).fetchone()

    if not row:
        return json.dumps({"status": "No briefing generated yet. Open IntelliDeck to trigger one."})

    return json.dumps({
        "date": row["briefing_date"],
        "title": row["title"],
        "executiveSummary": row["executive_summary"],
        "keyThemes": json.loads(row["key_themes_json"] or "[]"),
        "topStories": json.loads(row["top_stories_json"] or "[]"),
    }, ensure_ascii=False, indent=2)


# ── Entry point ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    mcp.run(transport="stdio")
