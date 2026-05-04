'use client';

import { useState, useEffect } from 'react';
import { nanoid } from 'nanoid';
import { X, Palette, Clock, Eye, EyeOff, Sparkles, Loader2, CheckCircle, XCircle, Save, Zap, ChevronUp, Database, Trash2, ALargeSmall } from 'lucide-react';
import { useSettingsStore, themes, getThemeById, type FontSize } from '@/lib/settings-store';
import { useDeckStore } from '@/lib/store';
import { useArticlesStore } from '@/lib/articles-store';
import { cn } from '@/lib/utils';
import { useTranslation } from '@/lib/i18n';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function SettingsModal({ isOpen, onClose }: SettingsModalProps) {
  const {
    themeId,
    fontSize,
    defaultRefreshInterval,
    defaultViewMode,

    setTheme,
    setFontSize,
    setDefaultRefreshInterval,
    setDefaultViewMode,

    aiSettings,
    setAiSettings,
    keywordAlerts,
    setKeywordAlerts,
  } = useSettingsStore();

  const { t } = useTranslation();

  const [ollamaStatus, setOllamaStatus] = useState<'checking' | 'connected' | 'disconnected'>('checking');
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [showApiKey, setShowApiKey] = useState(false);
  const [isTestingAi, setIsTestingAi] = useState(false);
  const [aiTestStatus, setAiTestStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [aiTestMessage, setAiTestMessage] = useState<string | null>(null);
  const [aiSaved, setAiSaved] = useState(false);
  const [showAllThemes, setShowAllThemes] = useState(false);

  const [newKeyword, setNewKeyword] = useState('');
  const [newColor, setNewColor] = useState('#ff4444');

  const [activeTab, setActiveTab] = useState<'general' | 'ai' | 'keyword-alerts' | 'data'>('general');

  // Data / retention state
  const RETENTION_OPTIONS = [7, 14, 30, 60, 90];
  const [retentionDays, setRetentionDays] = useState(30);
  const [cleanupRunning, setCleanupRunning] = useState(false);
  const [cleanupMessage, setCleanupMessage] = useState<string | null>(null);
  const [cleanupError, setCleanupError] = useState(false);

  useDeckStore((state) => state.columns);
  useArticlesStore((state) => state.articlesByColumn);

  // Check Ollama connection when modal opens or URL changes
  useEffect(() => {
    if (!isOpen || aiSettings.provider !== 'ollama') return;

    const checkOllama = async () => {
      setOllamaStatus('checking');
      try {
        const response = await fetch(`/api/ai/summarize?ollamaUrl=${encodeURIComponent(aiSettings.ollamaUrl)}`);
        const data = await response.json();

        if (data.connected) {
          setOllamaStatus('connected');
          setAvailableModels(data.models?.map((m: any) => m.name) || []);
        } else {
          setOllamaStatus('disconnected');
          setAvailableModels([]);
        }
      } catch {
        setOllamaStatus('disconnected');
        setAvailableModels([]);
      }
    };

    checkOllama();
  }, [isOpen, aiSettings.ollamaUrl, aiSettings.provider]);

  const testAiConnection = async () => {
    setIsTestingAi(true);
    setAiTestStatus('idle');
    setAiTestMessage(null);

    // 15s timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);

    try {
      const res = await fetch('/api/ai/summarize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'Connection test',
          content: 'Reply with exactly one word: OK',
          provider: aiSettings.provider,
          apiKey: aiSettings.apiKeys?.[aiSettings.provider] || '',
          ollamaUrl: aiSettings.ollamaUrl,
          model: aiSettings.model,
          language: 'English',
        }),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      const data = await res.json();
      if (res.ok && data.summary) {
        setAiTestStatus('success');
        setAiTestMessage(t('settings.connectionSuccessful'));
        setTimeout(() => setAiTestStatus('idle'), 4000);
      } else {
        setAiTestStatus('error');
        setAiTestMessage(data.error || 'No response from model');
      }
    } catch (err: any) {
      if (err.name === 'AbortError') {
        setAiTestStatus('error');
        setAiTestMessage(t('settings.requestTimedOut'));
      } else {
        setAiTestStatus('error');
        setAiTestMessage(err.message || 'Request failed');
      }
    } finally {
      setIsTestingAi(false);
      clearTimeout(timeoutId);
    }
  };

  const handleSaveAi = () => {
    // Settings are already persisted via Zustand, just show confirmation
    setAiSaved(true);
    setTimeout(() => setAiSaved(false), 2000);
  };

  const runCleanup = async () => {
    setCleanupRunning(true);
    setCleanupMessage(null);
    setCleanupError(false);
    try {
      const res = await fetch('/api/cleanup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ daysToKeep: retentionDays }),
      });
      const data = await res.json();
      if (res.ok) {
        setCleanupMessage(
          t('settings.data.cleanupDone')
            .replace('{articles}', String(data.articlesDeleted))
            .replace('{snapshots}', String(data.snapshotsDeleted))
        );
      } else {
        setCleanupError(true);
        setCleanupMessage(t('settings.data.cleanupError'));
      }
    } catch {
      setCleanupError(true);
      setCleanupMessage(t('settings.data.cleanupError'));
    } finally {
      setCleanupRunning(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative bg-background-secondary border border-border rounded-xl w-full max-w-lg max-h-[85vh] mx-4 shadow-2xl flex flex-col overflow-hidden">
        {/* Header & Tabs */}
        <div className="flex flex-col border-b border-border">
          <div className="flex items-center justify-between px-4 py-3">
            <h2 className="text-lg font-semibold">{t('settings.title')}</h2>
            <button
              onClick={onClose}
              className="p-1 hover:bg-background-tertiary rounded transition-colors text-foreground-secondary hover:text-foreground"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
          <div className="flex px-4 gap-4 text-sm">
            <button
              onClick={() => setActiveTab('general')}
              className={cn(
                "pb-2 transition-colors relative",
                activeTab === 'general' ? "text-foreground font-medium" : "text-foreground-secondary hover:text-foreground"
              )}
            >
              {t('settings.general')}
              {activeTab === 'general' && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-accent rounded-t-full" />}
            </button>
            <button
              onClick={() => setActiveTab('ai')}
              className={cn(
                "pb-2 transition-colors relative",
                activeTab === 'ai' ? "text-foreground font-medium" : "text-foreground-secondary hover:text-foreground"
              )}
            >
              {t('settings.aiAssistant')}
              {activeTab === 'ai' && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-accent rounded-t-full" />}
            </button>
            <button
              onClick={() => setActiveTab('keyword-alerts')}
              className={cn(
                "pb-2 transition-colors relative",
                activeTab === 'keyword-alerts' ? "text-foreground font-medium" : "text-foreground-secondary hover:text-foreground"
              )}
            >
              {t('settings.keywordAlerts.tab')}
              {activeTab === 'keyword-alerts' && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-accent rounded-t-full" />}
            </button>
            <button
              onClick={() => setActiveTab('data')}
              className={cn(
                "pb-2 transition-colors relative",
                activeTab === 'data' ? "text-foreground font-medium" : "text-foreground-secondary hover:text-foreground"
              )}
            >
              {t('settings.data.tab')}
              {activeTab === 'data' && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-accent rounded-t-full" />}
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-6">
          {activeTab === 'general' && (
            <div className="space-y-6 animate-in fade-in zoom-in-95 duration-200">
              {/* Theme Selection */}
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <Palette className="w-4 h-4" />
                  <span>{t('settings.colorTheme')}</span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {themes.map((theme) => (
                    <button
                      key={theme.id}
                      onClick={() => setTheme(theme.id)}
                      className={cn(
                        'flex items-center gap-3 p-3 rounded-lg border transition-all text-left',
                        themeId === theme.id
                          ? 'border-accent bg-accent/10'
                          : 'border-border hover:border-foreground-secondary'
                      )}
                    >
                      <div className="flex gap-1">
                        <div
                          className="w-4 h-4 rounded-full"
                          style={{ backgroundColor: theme.background }}
                        />
                        <div
                          className="w-4 h-4 rounded-full"
                          style={{ backgroundColor: theme.accent }}
                        />
                      </div>
                      <span className="text-sm">{theme.name}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Text Size */}
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <ALargeSmall className="w-4 h-4" />
                  <span>Text Size</span>
                </div>
                <div className="flex gap-2">
                  {([
                    { value: 'small', label: 'Small', style: 'text-xs' },
                    { value: 'normal', label: 'Normal', style: 'text-sm' },
                    { value: 'large', label: 'Large', style: 'text-base' },
                  ] as { value: FontSize; label: string; style: string }[]).map(({ value, label, style }) => (
                    <button
                      key={value}
                      onClick={() => setFontSize(value)}
                      className={cn(
                        'flex-1 px-3 py-2 rounded-lg border transition-all',
                        style,
                        fontSize === value
                          ? 'border-accent bg-accent text-[color:var(--accent-foreground)]'
                          : 'border-border hover:border-foreground-secondary'
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Auto Refresh Interval */}
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <Clock className="w-4 h-4" />
                  <span>{t('settings.autoRefresh')}</span>
                </div>
                <div className="flex gap-2 flex-wrap">
                  {[5, 10, 15, 30, 60].map((mins) => (
                    <button
                      key={mins}
                      onClick={() => setDefaultRefreshInterval(mins)}
                      className={cn(
                        'px-3 py-1.5 rounded-lg border text-sm transition-all',
                        defaultRefreshInterval === mins
                          ? 'border-accent bg-accent text-white'
                          : 'border-border hover:border-foreground-secondary'
                      )}
                    >
                      {mins} {t('settings.min')}
                    </button>
                  ))}
                </div>
              </div>

              {/* Default View Mode */}
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <Eye className="w-4 h-4" />
                  <span>{t('settings.defaultViewMode')}</span>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => setDefaultViewMode('comfortable')}
                    className={cn(
                      'flex-1 px-3 py-2 rounded-lg border text-sm transition-all',
                      defaultViewMode === 'comfortable'
                        ? 'border-accent bg-accent text-white'
                        : 'border-border hover:border-foreground-secondary'
                    )}
                  >
                    {t('settings.comfortable')}
                  </button>
                  <button
                    onClick={() => setDefaultViewMode('compact')}
                    className={cn(
                      'flex-1 px-3 py-2 rounded-lg border text-sm transition-all',
                      defaultViewMode === 'compact'
                        ? 'border-accent bg-accent text-white'
                        : 'border-border hover:border-foreground-secondary'
                    )}
                  >
                    {t('settings.compact')}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Keyword Alerts */}
          {activeTab === 'keyword-alerts' && (
            <div className="space-y-4 animate-in fade-in zoom-in-95 duration-200">
              <p className="text-sm text-foreground-secondary">
                {t('settings.keywordAlerts.description')}
              </p>

              {/* Add new alert */}
              <div className="flex gap-2 items-center">
                <input
                  type="text"
                  value={newKeyword}
                  onChange={(e) => setNewKeyword(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && newKeyword.trim()) {
                      setKeywordAlerts([...keywordAlerts, { id: nanoid(), keyword: newKeyword.trim(), color: newColor, enabled: true }]);
                      setNewKeyword('');
                    }
                  }}
                  placeholder={t('settings.keywordAlerts.placeholder')}
                  className="flex-1 bg-background-secondary border border-border rounded px-3 py-1.5 text-sm text-foreground placeholder:text-foreground-secondary focus:outline-none focus:border-accent"
                />
                <input
                  type="color"
                  value={newColor}
                  onChange={(e) => setNewColor(e.target.value)}
                  className="w-8 h-8 rounded cursor-pointer border border-border bg-transparent"
                  title="Choose alert color"
                />
                <button
                  onClick={() => {
                    if (!newKeyword.trim()) return;
                    setKeywordAlerts([...keywordAlerts, { id: nanoid(), keyword: newKeyword.trim(), color: newColor, enabled: true }]);
                    setNewKeyword('');
                  }}
                  disabled={!newKeyword.trim()}
                  className="px-3 py-1.5 text-sm bg-accent/20 text-accent border border-accent/30 rounded hover:bg-accent/30 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {t('settings.keywordAlerts.add')}
                </button>
              </div>

              {/* Alert list */}
              {keywordAlerts.length === 0 ? (
                <p className="text-sm text-foreground-secondary italic">{t('settings.keywordAlerts.empty')}</p>
              ) : (
                <div className="space-y-2">
                  {keywordAlerts.map((alert) => (
                    <div key={alert.id} className="flex items-center gap-2 bg-background-secondary border border-border rounded-lg px-3 py-2">
                      {/* Color dot */}
                      <div
                        className="w-3 h-3 rounded-full flex-shrink-0"
                        style={{ background: alert.color }}
                      />
                      {/* Keyword */}
                      <span className="flex-1 text-sm text-foreground">{alert.keyword}</span>
                      {/* Enable toggle */}
                      <button
                        onClick={() => setKeywordAlerts(keywordAlerts.map(a => a.id === alert.id ? { ...a, enabled: !a.enabled } : a))}
                        className={cn(
                          'w-9 h-5 rounded-full transition-colors relative flex-shrink-0',
                          alert.enabled ? 'bg-accent' : 'bg-border'
                        )}
                        title={alert.enabled ? 'Disable alert' : 'Enable alert'}
                      >
                        <div className={cn(
                          'w-4 h-4 bg-white rounded-full absolute top-0.5 transition-transform',
                          alert.enabled ? 'translate-x-4' : 'translate-x-0.5'
                        )} />
                      </button>
                      {/* Color swatch */}
                      <label className="relative w-7 h-7 rounded cursor-pointer flex-shrink-0 border border-border overflow-hidden" title="Change color">
                        <input
                          type="color"
                          value={alert.color}
                          onChange={(e) => setKeywordAlerts(keywordAlerts.map(a => a.id === alert.id ? { ...a, color: e.target.value } : a))}
                          className="w-full h-full opacity-0 absolute"
                        />
                        <div className="w-full h-full" style={{ background: alert.color }} />
                      </label>
                      {/* Delete */}
                      <button
                        onClick={() => setKeywordAlerts(keywordAlerts.filter(a => a.id !== alert.id))}
                        className="text-foreground-secondary hover:text-foreground transition-colors flex-shrink-0 text-lg leading-none"
                        title="Delete alert"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* AI Settings */}
          {activeTab === 'ai' && (
            <div className="space-y-6 animate-in fade-in zoom-in-95 duration-200">
              <div className="space-y-3 pt-4 border-t border-border">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-accent" />
                    {t('settings.aiAssistant')}
                  </h3>
                  <button
                    onClick={() => setAiSettings({ enabled: !aiSettings.enabled })}
                    className={cn(
                      'relative w-10 h-5 rounded-full transition-colors',
                      aiSettings.enabled ? 'bg-accent' : 'bg-border'
                    )}
                  >
                    <div
                      className={cn(
                        'absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform',
                        aiSettings.enabled ? 'translate-x-5' : 'translate-x-0.5'
                      )}
                    />
                  </button>
                </div>

                {aiSettings.enabled && (
                  <div className="space-y-3">
                    {/* AI Provider */}
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-foreground-secondary">
                        {t('settings.aiProvider')}
                      </label>
                      <select
                        value={aiSettings.provider}
                        onChange={(e) => setAiSettings({
                          provider: e.target.value as any,
                          model: e.target.value === 'ollama' ? 'llama3.2' :
                            e.target.value === 'openai' ? 'gpt-4.1' :
                              e.target.value === 'anthropic' ? 'claude-sonnet-4-6' :
                                e.target.value === 'minimax' ? 'MiniMax-M2.5' :
                                  e.target.value === 'kimi' ? 'kimi-k2.5' :
                                    'gemini-3-pro-preview'
                        })}
                        className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus:border-accent focus:outline-none"
                      >
                        <option value="ollama">{t('settings.ollamaLocal')}</option>
                        <option value="openai">{t('settings.openaiApi')}</option>
                        <option value="anthropic">{t('settings.anthropicApi')}</option>
                        <option value="gemini">{t('settings.geminiApi')}</option>
                        <option value="minimax">{t('settings.minimaxApi')}</option>
                        <option value="kimi">{t('settings.kimiApi')}</option>
                      </select>
                    </div>

                    {/* API Key for Cloud Providers */}
                    {aiSettings.provider !== 'ollama' && (
                      <div className="space-y-1 animate-in fade-in slide-in-from-top-1">
                        <label className="text-xs font-medium text-foreground-secondary">
                          {t('settings.apiKey')}
                        </label>
                        <div className="relative">
                          <input
                            type={showApiKey ? 'text' : 'password'}
                            value={aiSettings.apiKeys?.[aiSettings.provider] || ''}
                            onChange={(e) => {
                              const newApiKeys = { ...(aiSettings.apiKeys || {}), [aiSettings.provider]: e.target.value };
                              setAiSettings({ apiKeys: newApiKeys });
                            }}
                            placeholder={t('settings.enterApiKey', { provider: aiSettings.provider })}
                            className="w-full px-3 py-2 pr-9 rounded-lg border border-border bg-background text-sm focus:border-accent focus:outline-none transition-all"
                          />
                          <button
                            type="button"
                            onClick={() => setShowApiKey(!showApiKey)}
                            className="absolute right-2 top-1/2 -translate-y-1/2 text-foreground-secondary hover:text-foreground transition-colors"
                            title={showApiKey ? t('settings.hideApiKey') : t('settings.showApiKey')}
                          >
                            {showApiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Ollama URL for Local */}
                    {aiSettings.provider === 'ollama' && (
                      <div className="space-y-1 animate-in fade-in slide-in-from-top-1">
                        <label className="text-xs font-medium text-foreground-secondary">
                          {t('settings.ollamaUrl')}
                        </label>
                        <input
                          type="text"
                          value={aiSettings.ollamaUrl}
                          onChange={(e) => setAiSettings({ ollamaUrl: e.target.value })}
                          placeholder="http://localhost:11434"
                          className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus:border-accent focus:outline-none"
                        />
                        {/* Connection Status */}
                        <div className="flex items-center gap-2 text-xs mt-1">
                          {ollamaStatus === 'checking' && (
                            <>
                              <Loader2 className="w-3 h-3 animate-spin text-foreground-secondary" />
                              <span className="text-foreground-secondary">{t('settings.checkingConnection')}</span>
                            </>
                          )}
                          {ollamaStatus === 'connected' && (
                            <>
                              <CheckCircle className="w-3 h-3 text-success" />
                              <span className="text-success">{t('settings.ollamaConnected')}</span>
                            </>
                          )}
                          {ollamaStatus === 'disconnected' && (
                            <>
                              <XCircle className="w-3 h-3 text-error" />
                              <span className="text-error">{t('settings.ollamaNotRunning')}</span>
                            </>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Model Selection */}
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-foreground-secondary">
                        {t('settings.model')}
                      </label>
                      {aiSettings.provider === 'ollama' && availableModels.length > 0 ? (
                        <select
                          value={aiSettings.model}
                          onChange={(e) => setAiSettings({ model: e.target.value })}
                          className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus:border-accent focus:outline-none"
                        >
                          {availableModels.map((model) => (
                            <option key={model} value={model}>
                              {model}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input
                          type="text"
                          value={aiSettings.model}
                          onChange={(e) => setAiSettings({ model: e.target.value })}
                          placeholder={aiSettings.provider === 'ollama' ? 'llama3.2' : 'e.g. gpt-4o-mini'}
                          className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus:border-accent focus:outline-none"
                        />
                      )}
                      {aiSettings.provider === 'ollama' && (
                        <p className="text-xs text-foreground-secondary">
                          Run <code className="bg-background-tertiary px-1 rounded">ollama pull llama3.2</code> to install.
                        </p>
                      )}
                    </div>

                    {/* Custom Summary Prompt */}
                    <div className="space-y-2 animate-in fade-in slide-in-from-top-1">
                      <div className="flex items-center justify-between">
                        <label className="text-xs font-medium text-foreground-secondary">
                          {t('settings.customPrompt')}
                        </label>
                      </div>
                      <textarea
                        value={aiSettings.customSummaryPrompt || ''}
                        onChange={(e) => setAiSettings({ customSummaryPrompt: e.target.value })}
                        placeholder={t('settings.customPromptPlaceholder')}
                        className="w-full h-24 px-3 py-2 rounded-lg border border-border bg-background text-sm focus:border-accent focus:outline-none resize-y"
                      />
                      <p className="text-[10px] text-foreground-secondary leading-tight">
                        Overrides the default AI instruction. Use <code className="bg-background-tertiary px-1 rounded">{'{{title}}'}</code> and <code className="bg-background-tertiary px-1 rounded">{'{{content}}'}</code> as placeholders.
                      </p>
                    </div>

                    {/* Save & Test buttons */}
                    <div className="flex items-center gap-2 pt-1">
                      <button
                        onClick={handleSaveAi}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${aiSaved
                          ? 'bg-success text-white'
                          : 'bg-accent text-white hover:bg-accent/90'
                          }`}
                      >
                        {aiSaved ? (
                          <><CheckCircle className="w-3.5 h-3.5" /> {t('settings.saved')}</>
                        ) : (
                          <><Save className="w-3.5 h-3.5" /> {t('settings.save')}</>
                        )}
                      </button>
                      <button
                        onClick={testAiConnection}
                        disabled={isTestingAi}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all border ${aiTestStatus === 'success'
                          ? 'border-success text-success bg-success/10'
                          : aiTestStatus === 'error'
                            ? 'border-error text-error bg-error/10'
                            : 'border-border text-foreground-secondary hover:text-foreground hover:border-foreground-secondary'
                          } disabled:opacity-50`}
                      >
                        {isTestingAi ? (
                          <><Loader2 className="w-3.5 h-3.5 animate-spin" /> {t('settings.testing')}</>
                        ) : aiTestStatus === 'success' ? (
                          <><CheckCircle className="w-3.5 h-3.5" /> {t('settings.working')}</>
                        ) : aiTestStatus === 'error' ? (
                          <><XCircle className="w-3.5 h-3.5" /> {t('settings.failed')}</>
                        ) : (
                          <><Zap className="w-3.5 h-3.5" /> {t('settings.testAi')}</>
                        )}
                      </button>
                      {aiTestMessage && (
                        <span className={`text-xs truncate ${aiTestStatus === 'success' ? 'text-success' : 'text-error'
                          }`}>
                          {aiTestMessage}
                        </span>
                      )}
                    </div>

                  </div>
                )}
              </div>
            </div>
          )}

          {/* Data / Retention tab */}
          {activeTab === 'data' && (
            <div className="space-y-6 animate-in fade-in zoom-in-95 duration-200">
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <Database className="w-4 h-4" />
                  <span>{t('settings.data.retentionTitle')}</span>
                </div>
                <p className="text-xs text-foreground-secondary leading-relaxed">
                  {t('settings.data.retentionDesc')}
                </p>

                {/* Retention period selector */}
                <div className="flex gap-2 flex-wrap">
                  {[7, 14, 30, 60, 90].map((days) => (
                    <button
                      key={days}
                      onClick={() => setRetentionDays(days)}
                      className={cn(
                        'px-3 py-1.5 rounded-lg border text-sm transition-all',
                        retentionDays === days
                          ? 'border-accent bg-accent text-white'
                          : 'border-border hover:border-foreground-secondary'
                      )}
                    >
                      {days} {t('settings.data.days')}
                    </button>
                  ))}
                </div>

                {/* Run cleanup button */}
                <div className="flex items-center gap-3 pt-1">
                  <button
                    onClick={runCleanup}
                    disabled={cleanupRunning}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-error/10 text-error border border-error/30 hover:bg-error/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {cleanupRunning ? (
                      <><Loader2 className="w-3.5 h-3.5 animate-spin" /> {t('settings.data.running')}</>
                    ) : (
                      <><Trash2 className="w-3.5 h-3.5" /> {t('settings.data.runCleanup')}</>
                    )}
                  </button>
                  {cleanupMessage && (
                    <span className={cn('text-xs', cleanupError ? 'text-error' : 'text-success')}>
                      {cleanupMessage}
                    </span>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex-shrink-0 px-4 py-3 border-t border-border bg-background-tertiary">
          <p className="text-xs text-foreground-secondary text-center">
            {t('settings.settingsSavedAuto')}
          </p>
        </div>
      </div>
    </div >
  );
}
