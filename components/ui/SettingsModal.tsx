'use client';

import { useState, useEffect } from 'react';
import { X, Palette, Clock, Eye, EyeOff, Sparkles, Loader2, CheckCircle, XCircle, Save, Zap, ChevronDown, ChevronUp } from 'lucide-react';
import { useSettingsStore, themes, getThemeById } from '@/lib/settings-store';
import { useDeckStore } from '@/lib/store';
import { useArticlesStore } from '@/lib/articles-store';
import { cn } from '@/lib/utils';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function SettingsModal({ isOpen, onClose }: SettingsModalProps) {
  const {
    themeId,
    defaultRefreshInterval,
    defaultViewMode,

    setTheme,
    setDefaultRefreshInterval,
    setDefaultViewMode,

    aiSettings,
    setAiSettings,
  } = useSettingsStore();

  const [ollamaStatus, setOllamaStatus] = useState<'checking' | 'connected' | 'disconnected'>('checking');
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [showApiKey, setShowApiKey] = useState(false);
  const [isTestingAi, setIsTestingAi] = useState(false);
  const [aiTestStatus, setAiTestStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [aiTestMessage, setAiTestMessage] = useState<string | null>(null);
  const [aiSaved, setAiSaved] = useState(false);
  const [showAllThemes, setShowAllThemes] = useState(false);

  const [activeTab, setActiveTab] = useState<'general' | 'ai'>('general');

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
        setAiTestMessage('Connection successful!');
        setTimeout(() => setAiTestStatus('idle'), 4000);
      } else {
        setAiTestStatus('error');
        setAiTestMessage(data.error || 'No response from model');
      }
    } catch (err: any) {
      if (err.name === 'AbortError') {
        setAiTestStatus('error');
        setAiTestMessage('Request timed out (15s)');
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
            <h2 className="text-lg font-semibold">Settings</h2>
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
              General
              {activeTab === 'general' && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-accent rounded-t-full" />}
            </button>
            <button
              onClick={() => setActiveTab('ai')}
              className={cn(
                "pb-2 transition-colors relative",
                activeTab === 'ai' ? "text-foreground font-medium" : "text-foreground-secondary hover:text-foreground"
              )}
            >
              AI Assistant
              {activeTab === 'ai' && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-accent rounded-t-full" />}
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
                  <span>Color Theme</span>
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

              {/* Auto Refresh Interval */}
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <Clock className="w-4 h-4" />
                  <span>Auto Refresh Interval</span>
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
                      {mins} min
                    </button>
                  ))}
                </div>
              </div>

              {/* Default View Mode */}
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <Eye className="w-4 h-4" />
                  <span>Default View Mode</span>
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
                    Comfortable
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
                    Compact
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* AI Settings */}
          {activeTab === 'ai' && (
            <div className="space-y-6 animate-in fade-in zoom-in-95 duration-200">
              <div className="space-y-3 pt-4 border-t border-border">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-accent" />
                    AI Assistant
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
                        AI Provider
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
                        <option value="ollama">Ollama (Local)</option>
                        <option value="openai">OpenAI (API)</option>
                        <option value="anthropic">Anthropic (API)</option>
                        <option value="gemini">Google Gemini (API)</option>
                        <option value="minimax">Minimax (API)</option>
                        <option value="kimi">Kimi / Moonshot (API)</option>
                      </select>
                    </div>

                    {/* API Key for Cloud Providers */}
                    {aiSettings.provider !== 'ollama' && (
                      <div className="space-y-1 animate-in fade-in slide-in-from-top-1">
                        <label className="text-xs font-medium text-foreground-secondary">
                          API Key
                        </label>
                        <div className="relative">
                          <input
                            type={showApiKey ? 'text' : 'password'}
                            value={aiSettings.apiKeys?.[aiSettings.provider] || ''}
                            onChange={(e) => {
                              const newApiKeys = { ...(aiSettings.apiKeys || {}), [aiSettings.provider]: e.target.value };
                              setAiSettings({ apiKeys: newApiKeys });
                            }}
                            placeholder={`Enter ${aiSettings.provider} API key`}
                            className="w-full px-3 py-2 pr-9 rounded-lg border border-border bg-background text-sm focus:border-accent focus:outline-none transition-all"
                          />
                          <button
                            type="button"
                            onClick={() => setShowApiKey(!showApiKey)}
                            className="absolute right-2 top-1/2 -translate-y-1/2 text-foreground-secondary hover:text-foreground transition-colors"
                            title={showApiKey ? 'Hide API key' : 'Show API key'}
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
                          Ollama URL
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
                              <span className="text-foreground-secondary">Checking connection...</span>
                            </>
                          )}
                          {ollamaStatus === 'connected' && (
                            <>
                              <CheckCircle className="w-3 h-3 text-success" />
                              <span className="text-success">Ollama connected</span>
                            </>
                          )}
                          {ollamaStatus === 'disconnected' && (
                            <>
                              <XCircle className="w-3 h-3 text-error" />
                              <span className="text-error">Ollama not running</span>
                            </>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Model Selection */}
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-foreground-secondary">
                        Model
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

                    {/* Summary Language */}
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-foreground-secondary">
                        Summary Language
                      </label>
                      <select
                        value={aiSettings.language}
                        onChange={(e) => setAiSettings({ language: e.target.value })}
                        className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus:border-accent focus:outline-none"
                      >
                        <option value="Original Language">Original Language (Auto)</option>
                        <option value="English">English</option>
                        <option value="Spanish">Spanish</option>
                        <option value="French">French</option>
                        <option value="German">German</option>
                        <option value="Chinese">Chinese</option>
                        <option value="Japanese">Japanese</option>
                        <option value="Korean">Korean</option>
                        <option value="Portuguese">Portuguese</option>
                      </select>
                    </div>

                    {/* Custom Summary Prompt */}
                    <div className="space-y-2 animate-in fade-in slide-in-from-top-1">
                      <div className="flex items-center justify-between">
                        <label className="text-xs font-medium text-foreground-secondary">
                          Custom Summary Prompt
                        </label>
                      </div>
                      <textarea
                        value={aiSettings.customSummaryPrompt || ''}
                        onChange={(e) => setAiSettings({ customSummaryPrompt: e.target.value })}
                        placeholder="e.g. You are an expert analyst. Summarize this article in 3 bullet points."
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
                          <><CheckCircle className="w-3.5 h-3.5" /> Saved!</>
                        ) : (
                          <><Save className="w-3.5 h-3.5" /> Save</>
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
                          <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Testing...</>
                        ) : aiTestStatus === 'success' ? (
                          <><CheckCircle className="w-3.5 h-3.5" /> Working!</>
                        ) : aiTestStatus === 'error' ? (
                          <><XCircle className="w-3.5 h-3.5" /> Failed</>
                        ) : (
                          <><Zap className="w-3.5 h-3.5" /> Test AI</>
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
        </div>

        {/* Footer */}
        <div className="flex-shrink-0 px-4 py-3 border-t border-border bg-background-tertiary">
          <p className="text-xs text-foreground-secondary text-center">
            Settings are saved automatically
          </p>
        </div>
      </div>
    </div >
  );
}
