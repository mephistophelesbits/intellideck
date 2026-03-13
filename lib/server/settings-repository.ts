import 'server-only';

import { getDb } from './db';

export type PersistedSettings = {
  themeId: string;
  defaultRefreshInterval: number;
  defaultViewMode: 'compact' | 'comfortable';
  showPreviewPanel: boolean;
  articleAgeFilter: 'all' | '1day' | '3days' | '7days';
  aiSettings: {
    enabled: boolean;
    sentimentEnabled: boolean;
    provider: 'ollama' | 'openai' | 'anthropic' | 'gemini' | 'minimax' | 'kimi';
    ollamaUrl: string;
    apiKeys: Record<string, string>;
    model: string;
    language: string;
    customSummaryPrompt?: string;
  };
  briefingSettings: {
    enabled: boolean;
    times: string[];
    telegramEnabled: boolean;
    telegramToken: string;
    telegramChatId: string;
    lastGenerated: string | null;
  };
};

const SETTINGS_ID = 'global';

export function getPersistedSettings(defaults: PersistedSettings) {
  const db = getDb();
  const row = db.prepare(`
    SELECT settings_json
    FROM app_settings
    WHERE id = ?
  `).get(SETTINGS_ID) as { settings_json: string } | undefined;

  if (!row) {
    return defaults;
  }

  return {
    ...defaults,
    ...JSON.parse(row.settings_json),
  } as PersistedSettings;
}

export function savePersistedSettings(settings: PersistedSettings) {
  const db = getDb();
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO app_settings (id, settings_json, created_at, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      settings_json = excluded.settings_json,
      updated_at = excluded.updated_at
  `).run(
    SETTINGS_ID,
    JSON.stringify(settings),
    now,
    now,
  );

  return settings;
}
