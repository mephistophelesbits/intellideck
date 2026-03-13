import { NextRequest, NextResponse } from 'next/server';
import { deleteBookmark, getBookmarks, saveBookmark } from '@/lib/server/bookmarks-repository';
import { Article } from '@/lib/types';

export async function GET() {
  return NextResponse.json(getBookmarks());
}

export async function POST(request: NextRequest) {
  try {
    const article = await request.json() as Article;
    return NextResponse.json(saveBookmark(article));
  } catch (error: unknown) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to save bookmark' },
      { status: 500 },
    );
  }
}

export async function DELETE(request: NextRequest) {
  const articleId = request.nextUrl.searchParams.get('articleId');
  if (!articleId) {
    return NextResponse.json({ error: 'Missing articleId' }, { status: 400 });
  }

  return NextResponse.json(deleteBookmark(articleId));
}
