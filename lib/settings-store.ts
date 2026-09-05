import { create } from 'zustand';
import type { KeywordAlert } from '@/lib/types';

export interface ThemeColors {
  id: string;
  name: string;
  background: string;
  backgroundSecondary: string;
  backgroundTertiary: string;
  foreground: string;
  foregroundSecondary: string;
  accent: string;
  accentHover: string;
  accentForeground?: string;
  border: string;
  isDark: boolean;
  fontFamily?: string;
}

export const themes: ThemeColors[] = [
  {
    id: 'stitch-light',
    name: 'Feed Dashboard (Light)',
    background: '#f6f6f8',
    backgroundSecondary: '#ffffff',
    backgroundTertiary: 'rgba(255, 255, 255, 0.6)',
    foreground: '#0f172a',
    foregroundSecondary: '#64748b',
    accent: '#1152d4',
    accentHover: '#0e45b3',
    border: '#e2e8f0',
    isDark: false,
    fontFamily: 'var(--font-inter), sans-serif',
  },
  {
    id: 'stitch-dark',
    name: 'Cyberpunk Neon (Dark)',
    background: '#0a0a12',
    backgroundSecondary: '#12121f',
    backgroundTertiary: '#050510',
    foreground: '#e0e0ff',
    foregroundSecondary: '#8888aa',
    accent: '#00e5ff',
    accentHover: '#33eeff',
    accentForeground: '#000000',
    border: '#1e1e3a',
    isDark: true,
    fontFamily: 'var(--font-inter), sans-serif',
  },
];

export type ArticleAgeFilter = 'all' | '1day' | '3days' | '7days';
export type FontSize = 'small' | 'normal' | 'large';

export const FONT_SIZE_PX: Record<FontSize, number> = {
  small: 13,
  normal: 16,
  large: 19,
};

interface SettingsState {
  themeId: string;
  fontSize: FontSize;
  defaultRefreshInterval: number; // in minutes
  defaultViewMode: 'compact' | 'comfortable';

  showPreviewPanel: boolean;
  articleAgeFilter: ArticleAgeFilter;
  locale: 'en' | 'zh-CN';

  setTheme: (themeId: string) => void;
  setFontSize: (size: FontSize) => void;
  setDefaultRefreshInterval: (interval: number) => void;
  setDefaultViewMode: (mode: 'compact' | 'comfortable') => void;

  setShowPreviewPanel: (show: boolean) => void;
  setArticleAgeFilter: (filter: ArticleAgeFilter) => void;
  setLocale: (locale: 'en' | 'zh-CN') => void;

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
  setAiSettings: (settings: Partial<SettingsState['aiSettings']>) => void;

  briefingSettings: {
    enabled: boolean;
    times: string[];
    telegramEnabled: boolean;
    telegramToken: string;
    telegramChatId: string;
    lastGenerated: string | null;
  };
  setBriefingSettings: (settings: Partial<SettingsState['briefingSettings']>) => void;
  voiceProfiles: Record<string, { rules: string[]; fewShot: string[] }>;
  setVoiceProfiles: (profiles: Record<string, { rules: string[]; fewShot: string[] }>) => void;
  keywordAlerts: KeywordAlert[];
  setKeywordAlerts: (alerts: KeywordAlert[]) => void;

  webSearchSettings: {
    enabled: boolean;
    searxngUrl: string;   // e.g. http://localhost:8080
    braveApiKey: string;
  };
  setWebSearchSettings: (settings: Partial<SettingsState['webSearchSettings']>) => void;

  hydrateSettings: (settings: SettingsSnapshot) => void;
}

export type SettingsSnapshot = Pick<
  SettingsState,
  | 'themeId'
  | 'fontSize'
  | 'defaultRefreshInterval'
  | 'defaultViewMode'
  | 'showPreviewPanel'
  | 'articleAgeFilter'
  | 'locale'
  | 'aiSettings'
  | 'briefingSettings'
  | 'voiceProfiles'
  | 'keywordAlerts'
  | 'webSearchSettings'
>;

export function getDefaultSettingsSnapshot(): SettingsSnapshot {
  return {
    themeId: 'stitch-dark',
    fontSize: 'normal',
    defaultRefreshInterval: 10,
    defaultViewMode: 'comfortable',
    showPreviewPanel: true,
    articleAgeFilter: 'all',
    locale: 'en',
    aiSettings: {
      enabled: true,
      sentimentEnabled: true,
      provider: 'ollama',
      ollamaUrl: 'http://localhost:11434',
      apiKeys: {},
      model: 'gemma3:12b',
      language: 'Original Language',
      customSummaryPrompt: '',
    },
    briefingSettings: {
      enabled: true,
      times: ['09:00'],
      telegramEnabled: false,
      telegramToken: '',
      telegramChatId: '',
      lastGenerated: null,
    },
    voiceProfiles: {
      xhs: {
        rules: [
          'first person, warm with dry humor',
          'no em dashes',
          'under 1000 characters',
          'no generic AI-sounding phrases; sharp editorial sensibility',
          'lead with a concrete hook, not a thesis statement',
        ],
        fewShot: [],
      },
    },
    keywordAlerts: [],
    webSearchSettings: {
      enabled: false,
      searxngUrl: 'http://localhost:8080',
      braveApiKey: '',
    },
  };
}

function toSettingsSnapshot(state: SettingsState): SettingsSnapshot {
  return {
    themeId: state.themeId,
    fontSize: state.fontSize,
    defaultRefreshInterval: state.defaultRefreshInterval,
    defaultViewMode: state.defaultViewMode,
    showPreviewPanel: state.showPreviewPanel,
    articleAgeFilter: state.articleAgeFilter,
    locale: state.locale,
    aiSettings: state.aiSettings,
    briefingSettings: state.briefingSettings,
    voiceProfiles: state.voiceProfiles,
    keywordAlerts: state.keywordAlerts,
    webSearchSettings: state.webSearchSettings,
  };
}

function persistSettings(state: SettingsSnapshot) {
  if (typeof window === 'undefined') return;

  void fetch('/api/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(state),
  }).catch((error) => {
    console.error('Failed to persist settings:', error);
  });
}

export const useSettingsStore = create<SettingsState>()((set) => ({
  ...getDefaultSettingsSnapshot(),

  setTheme: (themeId) =>
    set((state) => {
      persistSettings(toSettingsSnapshot({ ...state, themeId }));
      return { themeId };
    }),
  setFontSize: (fontSize) =>
    set((state) => {
      persistSettings(toSettingsSnapshot({ ...state, fontSize }));
      return { fontSize };
    }),
  setDefaultRefreshInterval: (interval) =>
    set((state) => {
      persistSettings(toSettingsSnapshot({ ...state, defaultRefreshInterval: interval }));
      return { defaultRefreshInterval: interval };
    }),
  setDefaultViewMode: (mode) =>
    set((state) => {
      persistSettings(toSettingsSnapshot({ ...state, defaultViewMode: mode }));
      return { defaultViewMode: mode };
    }),

  setShowPreviewPanel: (show) =>
    set((state) => {
      persistSettings(toSettingsSnapshot({ ...state, showPreviewPanel: show }));
      return { showPreviewPanel: show };
    }),
  setArticleAgeFilter: (filter) =>
    set((state) => {
      persistSettings(toSettingsSnapshot({ ...state, articleAgeFilter: filter }));
      return { articleAgeFilter: filter };
    }),
  setAiSettings: (newSettings) =>
    set((state) => {
      const aiSettings = { ...state.aiSettings, ...newSettings };
      persistSettings(toSettingsSnapshot({ ...state, aiSettings }));
      return { aiSettings };
    }),

  setBriefingSettings: (newSettings) =>
    set((state) => {
      const briefingSettings = { ...state.briefingSettings, ...newSettings };
      persistSettings(toSettingsSnapshot({ ...state, briefingSettings }));
      return { briefingSettings };
    }),
  setVoiceProfiles: (voiceProfiles) =>
    set((state) => {
      persistSettings(toSettingsSnapshot({ ...state, voiceProfiles }));
      return { voiceProfiles };
    }),
  setKeywordAlerts: (alerts) =>
    set((state) => {
      const keywordAlerts = alerts;
      persistSettings(toSettingsSnapshot({ ...state, keywordAlerts }));
      return { keywordAlerts };
    }),
  setWebSearchSettings: (newSettings) =>
    set((state) => {
      const webSearchSettings = { ...state.webSearchSettings, ...newSettings };
      persistSettings(toSettingsSnapshot({ ...state, webSearchSettings }));
      return { webSearchSettings };
    }),
  setLocale: (locale) =>
    set((state) => {
      const language = locale === 'zh-CN' ? 'Chinese' : 'Original Language';
      const aiSettings = { ...state.aiSettings, language };
      const nextState = { ...state, locale, aiSettings };
      persistSettings(toSettingsSnapshot(nextState));
      return { locale, aiSettings };
    }),
  hydrateSettings: (settings) => set(() => ({
    ...getDefaultSettingsSnapshot(),
    ...settings,
  })),
}));

export function getThemeById(id: string): ThemeColors {
  return themes.find((t) => t.id === id) || themes[0];
}
