import { NextRequest, NextResponse } from 'next/server';
import { getDefaultSettingsSnapshot } from '@/lib/settings-store';
import { getPersistedSettings, savePersistedSettings } from '@/lib/server/settings-repository';

export async function GET() {
  return NextResponse.json(getPersistedSettings(getDefaultSettingsSnapshot()));
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    return NextResponse.json(savePersistedSettings(body));
  } catch (error: unknown) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to save settings' },
      { status: 500 },
    );
  }
}
