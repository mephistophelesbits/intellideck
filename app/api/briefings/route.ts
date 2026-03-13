import { NextResponse } from 'next/server';
import { getBriefings } from '@/lib/server/briefings-repository';

export async function GET() {
  return NextResponse.json(getBriefings());
}
