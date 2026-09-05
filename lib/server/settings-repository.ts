import 'server-only';

import { getDb } from './db';
import { getDefaultSettingsSnapshot } from '@/lib/settings-store';
import type { AIProvider } from '@/lib/ai/providers';
import type { KeywordAlert } from '@/lib/types';

export type PersistedSettings = {
  themeId: string;
  defaultRefreshInterval: number;
  defaultViewMode: 'compact' | 'comfortable';
  showPreviewPanel: boolean;
  articleAgeFilter: 'all' | '1day' | '3days' | '7days';
  aiSettings: {
    enabled: boolean;
    sentimentEnabled: boolean;
    provider: 'ollama' | 'openai' | 'anthropic' | 'gemini' | 'minimax' | 'kimi' | 'nvidia';
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
  voiceProfiles?: Record<string, { rules: string[]; fewShot: string[] }>;
  keywordAlerts: KeywordAlert[];
  webSearchSettings?: {
    enabled: boolean;
    searxngUrl: string;
    braveApiKey: string;
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

export interface ServerAISettings {
  enabled: boolean;
  provider: AIProvider;
  model: string;
  baseUrl?: string;
  apiKey?: string;
  embedModel: string;
  language: string;
}

// Resolve the persisted AI configuration into the shape the provider layer expects.
// Embeddings are always local (Ollama) regardless of the chat provider.
export function getServerAISettings(): ServerAISettings {
  const { aiSettings } = getPersistedSettings(getDefaultSettingsSnapshot());
  return {
    enabled: aiSettings.enabled,
    provider: aiSettings.provider,
    model: aiSettings.model,
    baseUrl: aiSettings.ollamaUrl,
    apiKey: aiSettings.apiKeys?.[aiSettings.provider],
    embedModel: 'nomic-embed-text',
    language: aiSettings.language,
  };
}

export interface VoiceProfile {
  rules: string[];
  fewShot: string[];
}

export function getVoiceProfile(platform: string): VoiceProfile {
  const settings = getPersistedSettings(getDefaultSettingsSnapshot());
  const profile = settings.voiceProfiles?.[platform];
  return {
    rules: profile?.rules ?? [],
    fewShot: profile?.fewShot ?? [],
  };
}
