import { create } from 'zustand';

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
    fontFamily: 'var(--font-dm-sans), sans-serif',
  },
  {
    id: 'stitch-dark',
    name: 'Reader Studio (Dark)',
    background: '#0d0d0d',
    backgroundSecondary: '#141414',
    backgroundTertiary: 'rgba(20, 20, 20, 0.7)',
    foreground: '#f1f5f9',
    foregroundSecondary: '#9ca3af',
    accent: '#22c55e',
    accentHover: '#16a34a',
    border: '#262626',
    isDark: true,
    fontFamily: 'var(--font-dm-sans), sans-serif',
  },
];

export type ArticleAgeFilter = 'all' | '1day' | '3days' | '7days';

interface SettingsState {
  themeId: string;
  defaultRefreshInterval: number; // in minutes
  defaultViewMode: 'compact' | 'comfortable';

  showPreviewPanel: boolean;
  articleAgeFilter: ArticleAgeFilter;

  setTheme: (themeId: string) => void;
  setDefaultRefreshInterval: (interval: number) => void;
  setDefaultViewMode: (mode: 'compact' | 'comfortable') => void;

  setShowPreviewPanel: (show: boolean) => void;
  setArticleAgeFilter: (filter: ArticleAgeFilter) => void;

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
  hydrateSettings: (settings: SettingsSnapshot) => void;
}

export type SettingsSnapshot = Pick<
  SettingsState,
  | 'themeId'
  | 'defaultRefreshInterval'
  | 'defaultViewMode'
  | 'showPreviewPanel'
  | 'articleAgeFilter'
  | 'aiSettings'
  | 'briefingSettings'
>;

export function getDefaultSettingsSnapshot(): SettingsSnapshot {
  return {
    themeId: 'stitch-dark',
    defaultRefreshInterval: 10,
    defaultViewMode: 'comfortable',
    showPreviewPanel: true,
    articleAgeFilter: 'all',
    aiSettings: {
      enabled: true,
      sentimentEnabled: true,
      provider: 'ollama',
      ollamaUrl: 'http://localhost:11434',
      apiKeys: {},
      model: 'llama3.2',
      language: 'Original Language',
      customSummaryPrompt: '',
    },
    briefingSettings: {
      enabled: false,
      times: ['08:00'],
      telegramEnabled: false,
      telegramToken: '',
      telegramChatId: '',
      lastGenerated: null,
    },
  };
}

function toSettingsSnapshot(state: SettingsState): SettingsSnapshot {
  return {
    themeId: state.themeId,
    defaultRefreshInterval: state.defaultRefreshInterval,
    defaultViewMode: state.defaultViewMode,
    showPreviewPanel: state.showPreviewPanel,
    articleAgeFilter: state.articleAgeFilter,
    aiSettings: state.aiSettings,
    briefingSettings: state.briefingSettings,
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
  hydrateSettings: (settings) => set(() => settings),
}));

export function getThemeById(id: string): ThemeColors {
  return themes.find((t) => t.id === id) || themes[0];
}
