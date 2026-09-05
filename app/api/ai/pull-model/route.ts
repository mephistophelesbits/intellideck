import { NextRequest, NextResponse } from 'next/server';
import { getServerAISettings } from '@/lib/server/settings-repository';

export async function POST(req: NextRequest) {
  const { model } = await req.json() as { model: string };
  if (!model) return NextResponse.json({ error: 'model required' }, { status: 400 });

  const settings = getServerAISettings();
  const baseUrl = settings.baseUrl || 'http://localhost:11434';

  try {
    // Stream pull progress from Ollama back to the client
    const ollamaRes = await fetch(`${baseUrl}/api/pull`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: model, stream: false }),
      signal: AbortSignal.timeout(120_000),
    });

    if (!ollamaRes.ok) {
      const text = await ollamaRes.text();
      return NextResponse.json({ error: text }, { status: ollamaRes.status });
    }

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? 'Pull failed' }, { status: 500 });
  }
}
