import { describe, it, expect, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';

vi.mock('server-only', () => ({}));

const db = new DatabaseSync(':memory:');
db.exec(`CREATE TABLE app_settings (id TEXT PRIMARY KEY, settings_json TEXT NOT NULL, created_at TEXT, updated_at TEXT);`);
vi.mock('./db', () => ({ getDb: () => db }));

import { getVoiceProfile } from './settings-repository';

describe('getVoiceProfile', () => {
  it('returns the default XHS profile when nothing is persisted', () => {
    const p = getVoiceProfile('xhs');
    expect(p.rules).toContain('no em dashes');
    expect(Array.isArray(p.fewShot)).toBe(true);
  });

  it('returns an empty profile for an unknown platform', () => {
    const p = getVoiceProfile('linkedin');
    expect(p).toEqual({ rules: [], fewShot: [] });
  });

  it('returns the persisted profile when present', () => {
    db.prepare("INSERT INTO app_settings (id, settings_json, created_at, updated_at) VALUES ('global', ?, 't', 't')")
      .run(JSON.stringify({ voiceProfiles: { xhs: { rules: ['custom rule'], fewShot: ['my post'] } } }));
    const p = getVoiceProfile('xhs');
    expect(p.rules).toEqual(['custom rule']);
    expect(p.fewShot).toEqual(['my post']);
  });
});
