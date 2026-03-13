import { NextResponse } from 'next/server';
import { getDeckState } from '@/lib/server/deck-repository';

export async function GET() {
  return NextResponse.json(getDeckState());
}
