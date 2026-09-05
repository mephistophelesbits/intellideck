import { NextResponse } from 'next/server';
import { ollamaBreaker } from '@/lib/ai/providers';

export const dynamic = 'force-dynamic';

export async function POST() {
  ollamaBreaker.reset();
  return NextResponse.json({ ok: true, message: 'Circuit breaker reset — Ollama calls will resume.' });
}
