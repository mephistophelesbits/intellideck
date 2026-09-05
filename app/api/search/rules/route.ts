import { NextRequest, NextResponse } from 'next/server';
import { deleteSearchRule, getSearchRules, reorderSearchRules, saveSearchRule } from '@/lib/server/search-repository';

export async function GET() {
  return NextResponse.json(getSearchRules());
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as {
      id?: string;
      name?: string;
      ruleColor?: string;
      query?: string;
      settings?: {
        matchMode?: 'or' | 'and';
        excludeKeywords?: string[];
      };
    };
    const normalizedBody = {
      id: body.id?.trim() || undefined,
      name: body.name,
      ruleColor: body.ruleColor,
      query: body.query,
      settings: body.settings,
    };
    if (!normalizedBody.query?.trim()) {
      return NextResponse.json({ error: 'Missing query' }, { status: 400 });
    }

    const payload = saveSearchRule({
      id: normalizedBody.id,
      name: normalizedBody.name,
      ruleColor: normalizedBody.ruleColor,
      query: normalizedBody.query,
      settings: normalizedBody.settings,
    });
    return NextResponse.json(payload);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to save search rule' },
      { status: 500 },
    );
  }
}

export async function DELETE(request: NextRequest) {
  const ruleId = request.nextUrl.searchParams.get('ruleId');
  if (!ruleId) {
    return NextResponse.json({ error: 'Missing ruleId' }, { status: 400 });
  }

  try {
    return NextResponse.json(deleteSearchRule(ruleId));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to delete search rule' },
      { status: 500 },
    );
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json() as {
      ruleIds?: string[];
    };

    if (!Array.isArray(body.ruleIds) || body.ruleIds.length === 0) {
      return NextResponse.json({ error: 'Missing ruleIds' }, { status: 400 });
    }

    return NextResponse.json(reorderSearchRules(body.ruleIds));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to reorder search rules' },
      { status: 500 },
    );
  }
}
