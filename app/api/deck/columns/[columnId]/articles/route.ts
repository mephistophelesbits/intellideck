import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/server/db';
import { runArticleSearch } from '@/lib/server/search-repository';
import { Article } from '@/lib/types';

const COLUMN_ARTICLE_LIMIT = 100;

type ColumnRow = {
    id: string;
    type: string;
    feed_list_id: string | null;
    search_rule_id: string | null;
    sources_json: string;
};

type FeedListItemRow = {
    url: string;
};

type ArticleRow = {
    id: string;
    canonical_url: string;
    title: string;
    published_at: string | null;
    created_at: string;
    author: string | null;
    content_snippet: string | null;
    image_url: string | null;
    source_title: string | null;
    source_url: string | null;
};

type SearchRuleRow = {
    id: string;
    name: string;
    query: string;
    keywords_json: string;
};

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ columnId: string }> }
) {
    try {
        const { columnId } = await params;
        const db = getDb();

        const column = db.prepare(`
      SELECT id, type, feed_list_id, search_rule_id, sources_json
      FROM columns_state
      WHERE id = ?
    `).get(columnId) as ColumnRow | undefined;

        if (!column) {
            return NextResponse.json({ error: 'Column not found' }, { status: 404 });
        }

        if (column.type === 'list' && column.feed_list_id) {
            const feedUrls = db.prepare(`
        SELECT sf.url
        FROM feed_list_items fli
        JOIN saved_feeds sf ON sf.id = fli.feed_id
        WHERE fli.list_id = ?
        ORDER BY fli.position ASC
      `).all(column.feed_list_id) as FeedListItemRow[];

            return NextResponse.json(getCachedArticlesForFeeds(feedUrls.map(f => f.url)));
        }

        if (column.type === 'search' && column.search_rule_id) {
            // Fetch articles using search rule
            const searchRule = db.prepare(`
        SELECT id, name, query, keywords_json
        FROM search_rules
        WHERE id = ?
      `).get(column.search_rule_id) as SearchRuleRow | undefined;

            if (!searchRule) {
                return NextResponse.json({ error: 'Search rule not found' }, { status: 404 });
            }

            const searchResult = runArticleSearch(searchRule.query);

            // Convert SearchResult to Article format
            const articles: Article[] = searchResult.results.slice(0, COLUMN_ARTICLE_LIMIT).map(r => ({
                id: r.id,
                title: r.title,
                link: r.url,
                pubDate: r.publishedAt || new Date().toISOString(),
                contentSnippet: r.contentSnippet || undefined,
                sourceTitle: r.sourceTitle || undefined,
                sourceUrl: r.sourceUrl || undefined,
            }));

            return NextResponse.json(articles);
        }

        const sources = JSON.parse(column.sources_json) as Array<{ url?: string }>;
        return NextResponse.json(getCachedArticlesForFeeds(
            sources.map((source) => source.url).filter((url): url is string => Boolean(url))
        ));
    } catch (error) {
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Failed to fetch articles' },
            { status: 500 },
        );
    }
}

function getCachedArticlesForFeeds(urls: string[]): Article[] {
    const sourceUrls = Array.from(new Set(
        urls.flatMap((url) => {
            const trimmed = url.trim();
            if (!trimmed) return [];
            return trimmed.startsWith('http://') || trimmed.startsWith('https://')
                ? [trimmed]
                : [trimmed, `http://${trimmed}`, `https://${trimmed}`];
        })
    ));

    if (sourceUrls.length === 0) return [];

    const placeholders = sourceUrls.map(() => '?').join(', ');
    const rows = getDb().prepare(`
        SELECT
            id,
            canonical_url,
            title,
            published_at,
            created_at,
            author,
            content_snippet,
            image_url,
            source_title,
            source_url
        FROM articles
        WHERE source_url IN (${placeholders})
        ORDER BY COALESCE(published_at, created_at) DESC, updated_at DESC
        LIMIT ?
    `).all(...sourceUrls, COLUMN_ARTICLE_LIMIT) as ArticleRow[];

    return rows.map((row) => ({
        id: row.id,
        title: row.title,
        link: row.canonical_url,
        pubDate: row.published_at || row.created_at,
        contentSnippet: row.content_snippet ?? undefined,
        author: row.author ?? undefined,
        thumbnail: row.image_url ?? undefined,
        sourceTitle: row.source_title ?? undefined,
        sourceUrl: row.source_url ?? undefined,
    }));
}
