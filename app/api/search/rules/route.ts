import { NextRequest, NextResponse } from 'next/server';
import { deleteSearchRule, getSearchRules, saveSearchRule } from '@/lib/server/search-repository';

export async function GET() {
  return NextResponse.json(getSearchRules());
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as { id?: string; name?: string; query?: string };
    if (!body.query?.trim()) {
      return NextResponse.json({ error: 'Missing query' }, { status: 400 });
    }

    return NextResponse.json(saveSearchRule({
      id: body.id,
      name: body.name,
      query: body.query,
    }));
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
