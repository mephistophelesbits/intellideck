import { NextRequest, NextResponse } from 'next/server';
import { touchSearchRuleLastRun } from '@/lib/server/search-repository';
import { runSmartArticleSearch } from '@/lib/server/smart-search';
import type { SmartSearchResponse, SmartSearchResult } from '@/lib/server/smart-search-types';

// Shape the UI already knows how to render (from the old classic-search endpoint). Keeping this
// stable means the frontend didn't need to change when the engine underneath switched to smart
// search — only this adapter needed to know about SmartSearchResult's richer shape.
type LegacySearchResult = {
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
  escalationCount24h: number;
  isEscalating: boolean;
};

function toLegacyResult(result: SmartSearchResult, escalationCounts: Map<string, number>): LegacySearchResult {
  const escalationCount24h = escalationCounts.get(result.id);
  return {
    id: result.id,
    title: result.title,
    url: result.url,
    publishedAt: result.publishedAt,
    sourceTitle: result.sourceTitle,
    sourceUrl: result.sourceUrl,
    contentSnippet: result.contentSnippet,
    rawContent: result.rawContent,
    category: result.category,
    importanceScore: result.importanceScore,
    matchedTerms: result.matchedTerms,
    relevance: result.score.final,
    escalationCount24h: escalationCount24h ?? 1,
    isEscalating: escalationCount24h !== undefined,
  };
}

function toLegacyResponse(smart: SmartSearchResponse) {
  const escalationCounts = new Map<string, number>();
  for (const alert of smart.alerts) {
    for (const articleId of alert.articleIds) {
      escalationCounts.set(articleId, Math.max(escalationCounts.get(articleId) ?? 0, alert.articleIds.length));
    }
  }

  return {
    keywords: smart.keywords,
    results: smart.results.map((result) => toLegacyResult(result, escalationCounts)),
  };
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as {
      query?: string;
      days?: number;
      limit?: number;
      ruleId?: string;
      settings?: {
        matchMode?: 'or' | 'and';
        excludeKeywords?: string[];
      };
    };
    const query = body.query?.trim() ?? '';
    const days = typeof body.days === 'number' && body.days > 0 ? Math.min(body.days, 90) : undefined;
    const limit = typeof body.limit === 'number' && body.limit > 0 ? Math.min(body.limit, 500) : undefined;

    if (!query) {
      return NextResponse.json({ error: 'Missing query' }, { status: 400 });
    }

    const smartResponse = await runSmartArticleSearch(query, {
      days,
      limit,
      matchMode: body.settings?.matchMode,
      excludeKeywords: body.settings?.excludeKeywords,
    });

    if (body.ruleId) {
      touchSearchRuleLastRun(body.ruleId);
    }

    return NextResponse.json(toLegacyResponse(smartResponse));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to search articles' },
      { status: 500 },
    );
  }
}
