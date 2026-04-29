import { NextResponse } from 'next/server';
import { runRetentionCleanup } from '@/lib/server/db';

export const dynamic = 'force-dynamic';

/**
 * POST /api/cleanup
 * Body: { daysToKeep: number }
 *
 * Deletes articles older than `daysToKeep` days and prunes old trend snapshots.
 * Returns { articlesDeleted, snapshotsDeleted }.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const daysToKeep = Number(body?.daysToKeep);

    if (!Number.isFinite(daysToKeep) || daysToKeep < 1 || daysToKeep > 365) {
      return NextResponse.json(
        { error: 'daysToKeep must be a number between 1 and 365' },
        { status: 400 }
      );
    }

    const result = runRetentionCleanup(daysToKeep);
    return NextResponse.json({ ok: true, ...result });
  } catch (err: unknown) {
    console.error('[cleanup] Error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 }
    );
  }
}
