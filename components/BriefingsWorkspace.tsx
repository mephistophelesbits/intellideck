'use client';

import { useEffect, useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { MessageSquare, Sparkles, Newspaper, ScanSearch, Link2, Trash2, Send, Eye, EyeOff, Plus } from 'lucide-react';
import { AppChrome } from '@/components/AppChrome';
import { useSettingsStore } from '@/lib/settings-store';

type PersistedBriefingChatMessage = {
  id: string;
  briefingId: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
};

type Briefing = {
  id: string;
  briefingDate: string;
  title: string;
  executiveSummary: string;
  keyThemes: string[];
  topStories: Array<{
    articleId: string;
    title: string;
    url: string;
    sourceTitle: string | null;
    category: string | null;
  }>;
  chatMessages?: PersistedBriefingChatMessage[];
};

type ChatMessage = {
  role: 'user' | 'assistant';
  content: string;
};

function TelegramIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M21.5 4.5c.4-.2.8.2.7.6l-3.1 14.6c-.1.5-.7.7-1.1.5l-4.6-3.4-2.3 2.2c-.3.3-.8.1-.8-.3v-3.1l8.4-7.7c.3-.3-.1-.7-.4-.5L7.9 14.1 3.4 12.7c-.6-.2-.6-1 .1-1.2l18-7Z" />
    </svg>
  );
}

export function BriefingsWorkspace() {
  const aiSettings = useSettingsStore((state) => state.aiSettings);
  const briefingSettings = useSettingsStore((state) => state.briefingSettings);
  const setBriefingSettings = useSettingsStore((state) => state.setBriefingSettings);
  const [briefings, setBriefings] = useState<Briefing[]>([]);
  const [selectedBriefingId, setSelectedBriefingId] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [isChatting, setIsChatting] = useState(false);
  const [workspaceMessage, setWorkspaceMessage] = useState<string | null>(null);
  const [showTelegramToken, setShowTelegramToken] = useState(false);
  const [isPushingTelegram, setIsPushingTelegram] = useState(false);
  const [isAutomationOpen, setIsAutomationOpen] = useState(false);
  const isTelegramReady = briefingSettings.telegramEnabled && Boolean(briefingSettings.telegramToken && briefingSettings.telegramChatId);

  const selectedBriefing = briefings.find((briefing) => briefing.id === selectedBriefingId) ?? null;
  const summarySections = useMemo(
    () =>
      selectedBriefing?.executiveSummary
        .split(/\n\s*\n/)
        .map((section) => section.trim())
        .filter(Boolean) ?? [],
    [selectedBriefing?.executiveSummary]
  );
  const topSources = useMemo(() => {
    const counts = new Map<string, number>();
    for (const story of selectedBriefing?.topStories ?? []) {
      const source = story.sourceTitle || 'Unknown Source';
      counts.set(source, (counts.get(source) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 4);
  }, [selectedBriefing]);
  const leadStory = selectedBriefing?.topStories[0] ?? null;
  const groupedStories = useMemo(() => {
    const groups = new Map<string, Briefing['topStories']>();
    for (const story of selectedBriefing?.topStories ?? []) {
      const key = story.category || 'General';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(story);
    }
    return Array.from(groups.entries());
  }, [selectedBriefing]);

  const loadBriefings = async () => {
    const response = await fetch('/api/briefings', { cache: 'no-store' });
    const data = await response.json();
    setBriefings(data);
    if (!selectedBriefingId && data.length > 0) {
      setSelectedBriefingId(data[0].id);
    }
  };

  const loadBriefingDetail = async (briefingId: string) => {
    const response = await fetch(`/api/briefings/${briefingId}`, { cache: 'no-store' });
    const detail = await response.json();
    if (!response.ok) {
      throw new Error(detail.error || 'Failed to load briefing');
    }

    setBriefings((current) => current.map((briefing) => (
      briefing.id === briefingId ? detail : briefing
    )));
    setSelectedBriefingId(briefingId);
    setChatMessages(
      (detail.chatMessages || []).map((message: PersistedBriefingChatMessage) => ({
        role: message.role,
        content: message.content,
      }))
    );
  };

  useEffect(() => {
    void loadBriefings();
  }, []);

  const handleGenerate = async () => {
    setIsGenerating(true);
    try {
      const response = await fetch('/api/briefings/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ aiSettings }),
      });
      const briefing = await response.json();
      if (!response.ok) {
        throw new Error(briefing.error || 'Failed to generate briefing');
      }

      setBriefings((current) => [briefing, ...current]);
      await loadBriefingDetail(briefing.id);
    } catch (error) {
      console.error(error);
    } finally {
      setIsGenerating(false);
    }
  };

  const handlePushToTelegram = async () => {
    if (!selectedBriefing || !briefingSettings.telegramToken || !briefingSettings.telegramChatId) {
      return;
    }

    setIsPushingTelegram(true);
    setWorkspaceMessage(null);

    try {
      const response = await fetch('/api/briefings/push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          briefing: selectedBriefing,
          telegramToken: briefingSettings.telegramToken,
          telegramChatId: briefingSettings.telegramChatId,
        }),
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to push briefing');
      }

      setWorkspaceMessage('Briefing pushed to Telegram.');
    } catch (error) {
      setWorkspaceMessage(error instanceof Error ? error.message : 'Failed to push briefing.');
    } finally {
      setIsPushingTelegram(false);
    }
  };

  const handleDeleteBriefing = async (briefingId: string) => {
    const briefing = briefings.find((item) => item.id === briefingId);
    if (!briefing) return;

    const confirmed = window.confirm(`Delete "${briefing.title}"?`);
    if (!confirmed) return;

    const response = await fetch(`/api/briefings/${briefingId}`, {
      method: 'DELETE',
    });
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Failed to delete briefing');
    }

    setBriefings((current) => current.filter((item) => item.id !== briefingId));

    if (selectedBriefingId === briefingId) {
      const remaining = briefings.filter((item) => item.id !== briefingId);
      const nextBriefing = remaining[0] ?? null;
      setSelectedBriefingId(nextBriefing?.id ?? null);
      setChatMessages(
        (nextBriefing?.chatMessages || []).map((message) => ({
          role: message.role,
          content: message.content,
        }))
      );
    }
  };

  const handleChat = async () => {
    if (!selectedBriefing || !chatInput.trim()) return;

    const nextMessages = [...chatMessages, { role: 'user' as const, content: chatInput.trim() }];
    setChatMessages(nextMessages);
    setChatInput('');
    setIsChatting(true);

    try {
      const response = await fetch(`/api/briefings/${selectedBriefing.id}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: nextMessages,
          aiSettings,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Failed to chat with briefing');
      }

      setChatMessages((current) => [...current, { role: 'assistant', content: data.reply }]);
    } catch (error) {
      console.error(error);
    } finally {
      setIsChatting(false);
    }
  };

  const actions = (
    <>
      <button
        onClick={() => setIsAutomationOpen(true)}
        className="px-3 py-1.5 rounded-lg border border-border bg-background text-xs font-medium text-foreground-secondary hover:border-accent hover:text-foreground transition-colors"
      >
        Brief Automation
      </button>
      <button
        onClick={() => void handleGenerate()}
        disabled={isGenerating}
        className="px-3 py-1.5 rounded-lg bg-accent text-[color:var(--accent-foreground)] text-xs font-medium hover:bg-accent-hover disabled:opacity-50 transition-colors"
      >
        {isGenerating ? 'Generating…' : 'Generate Briefing'}
      </button>
    </>
  );

  const handleRefreshAll = async () => {
    setWorkspaceMessage(null);
    const response = await fetch('/api/intelligence/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || 'Failed to refresh saved feeds');
    }
    setWorkspaceMessage(`Refreshed ${data.successfulFeeds}/${data.totalFeeds} feeds and ingested ${data.totalArticles} articles.`);
    await loadBriefings();
  };

  return (
    <AppChrome onRefreshAll={handleRefreshAll}>
      <div className="h-full overflow-y-auto">
        <div className="w-full px-4 py-4 md:px-5 md:py-5">
          <header className="mb-4 flex items-start justify-between gap-3 flex-wrap">
            <div className="min-w-0">
              <h1 className="text-2xl font-semibold">Briefings</h1>
              <p className="mt-1 text-xs md:text-sm text-foreground-secondary">
                Manual-first daily briefs and follow-up chat grounded in the persisted article corpus.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {actions}
            </div>
          </header>

          <div className="space-y-4 md:space-y-5">
        {workspaceMessage && (
          <div className="rounded-xl border border-border bg-background-secondary px-4 py-3 text-sm text-foreground-secondary">
            {workspaceMessage}
          </div>
        )}

        <div className="grid gap-4 2xl:grid-cols-[320px_minmax(0,1fr)]">
          <aside className="rounded-2xl border border-border bg-background-secondary p-3 xl:sticky xl:top-4 xl:self-start">
            <h2 className="text-xs font-medium uppercase tracking-[0.18em] text-foreground-secondary mb-3">Saved Briefings</h2>
            <div className="space-y-2 xl:max-h-[calc(100vh-220px)] xl:overflow-y-auto pr-1">
              {briefings.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border p-4 text-sm text-foreground-secondary">
                  No briefings yet. Generate one to create a saved morning desk.
                </div>
              ) : (
                briefings.map((briefing) => (
                  <div
                    key={briefing.id}
                    className={`rounded-xl border p-2.5 transition-colors ${
                      selectedBriefingId === briefing.id
                        ? 'border-accent bg-accent/10'
                        : 'border-border hover:border-foreground-secondary'
                    }`}
                  >
                    <div className="flex items-start gap-2">
                      <button
                        onClick={() => {
                          setSelectedBriefingId(briefing.id);
                          void loadBriefingDetail(briefing.id);
                        }}
                        className="min-w-0 flex-1 text-left"
                      >
                        <div className="font-medium">{briefing.title}</div>
                        <div className="text-xs text-foreground-secondary mt-1">
                          {new Date(briefing.briefingDate).toLocaleString()}
                        </div>
                        {briefing.keyThemes.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {briefing.keyThemes.slice(0, 2).map((theme) => (
                              <span key={theme} className="rounded-full bg-background px-2 py-0.5 text-[11px] text-foreground-secondary">
                                {theme}
                              </span>
                            ))}
                          </div>
                        )}
                        <div className="text-xs text-foreground-secondary mt-2">
                          {briefing.topStories.length} ranked stories
                        </div>
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleDeleteBriefing(briefing.id)}
                        className="rounded-lg border border-border bg-background p-2 text-foreground-secondary hover:border-error hover:text-error transition-colors"
                        title="Delete briefing"
                        aria-label={`Delete briefing ${briefing.title}`}
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </aside>

          <div className="space-y-4">
            {selectedBriefing ? (
              <>
                <section className="rounded-2xl border border-border bg-background-secondary p-4">
                  <div className="mb-4 flex items-start justify-between gap-4 flex-wrap">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 mb-2">
                        <Sparkles className="w-4 h-4 text-accent" />
                        <span className="text-xs uppercase tracking-[0.22em] text-foreground-secondary">Executive Brief</span>
                      </div>
                      <h2 className="text-xl font-semibold leading-tight">{selectedBriefing.title}</h2>
                      <p className="mt-2 text-sm text-foreground-secondary">
                        Generated {new Date(selectedBriefing.briefingDate).toLocaleString()} from the stored article corpus.
                      </p>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-3">
                      <div className="rounded-xl border border-border bg-background px-3 py-2.5">
                        <div className="text-[11px] uppercase tracking-[0.18em] text-foreground-secondary">Stories</div>
                        <div className="mt-1 text-lg font-semibold">{selectedBriefing.topStories.length}</div>
                      </div>
                      <div className="rounded-xl border border-border bg-background px-3 py-2.5">
                        <div className="text-[11px] uppercase tracking-[0.18em] text-foreground-secondary">Themes</div>
                        <div className="mt-1 text-lg font-semibold">{selectedBriefing.keyThemes.length}</div>
                      </div>
                      <div className="rounded-xl border border-border bg-background px-3 py-2.5">
                        <div className="text-[11px] uppercase tracking-[0.18em] text-foreground-secondary">Sources</div>
                        <div className="mt-1 text-lg font-semibold">{topSources.length}</div>
                      </div>
                    </div>
                  </div>
                  <div className="mb-4 grid gap-2 xl:grid-cols-[minmax(0,1.4fr)_minmax(280px,0.6fr)]">
                    <div className="rounded-xl border border-border bg-background px-3 py-2.5">
                      <div className="text-[11px] uppercase tracking-[0.18em] text-foreground-secondary">Lead Story</div>
                      <div className="mt-1 text-sm font-medium">{leadStory?.title || 'No lead story selected'}</div>
                      {leadStory?.sourceTitle && (
                        <div className="mt-1 text-xs text-foreground-secondary">{leadStory.sourceTitle}</div>
                      )}
                    </div>
                    <div className="rounded-xl border border-border bg-background px-3 py-2.5">
                      <div className="text-[11px] uppercase tracking-[0.18em] text-foreground-secondary">Theme Stack</div>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {selectedBriefing.keyThemes.slice(0, 6).map((theme) => (
                          <span key={theme} className="px-3 py-1 rounded-full bg-accent/10 text-accent text-xs">
                            {theme}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                  <div className="grid gap-4 xl:grid-cols-[minmax(0,1.25fr)_320px]">
                    <div className="rounded-2xl border border-border bg-background p-4">
                      <div className="mb-3 flex items-center justify-between gap-3">
                        <div className="text-xs uppercase tracking-[0.24em] text-foreground-secondary">Briefing Notes</div>
                        <button
                          type="button"
                          onClick={() => void handlePushToTelegram()}
                          disabled={!isTelegramReady || isPushingTelegram}
                          className={`inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                            isTelegramReady
                              ? 'border-accent bg-accent/10 text-accent hover:bg-accent/15'
                              : 'border-border bg-background-secondary text-foreground-secondary opacity-70 cursor-not-allowed'
                          }`}
                          title={isTelegramReady ? 'Push this briefing to Telegram' : 'Configure Telegram in Brief Automation first'}
                        >
                          <TelegramIcon className="w-3.5 h-3.5" />
                          {isPushingTelegram ? 'Pushing…' : 'Push to Telegram'}
                        </button>
                      </div>
                      <div className="prose prose-sm max-w-none text-foreground dark:prose-invert prose-headings:text-foreground prose-p:text-foreground prose-strong:text-foreground prose-li:text-foreground prose-ul:text-foreground prose-ol:text-foreground prose-a:text-accent">
                        <ReactMarkdown>{selectedBriefing.executiveSummary}</ReactMarkdown>
                      </div>
                      <div className="mt-5 border-t border-border pt-4">
                        <div className="flex items-center gap-2 mb-3">
                          <ScanSearch className="w-4 h-4 text-accent" />
                          <h3 className="text-sm font-medium">Chat With Briefing</h3>
                        </div>
                        <div className="space-y-2.5 mb-3 max-h-[320px] overflow-y-auto rounded-2xl border border-border bg-background-secondary p-3">
                          {chatMessages.map((message, index) => (
                            <div
                              key={`${message.role}-${index}`}
                              className={`rounded-xl p-2.5 ${
                                message.role === 'assistant'
                                  ? 'bg-background border border-border'
                                  : 'bg-accent text-[color:var(--accent-foreground)]'
                              }`}
                            >
                              <div className="text-xs uppercase tracking-wide opacity-70 mb-1">{message.role}</div>
                              <div className={`text-sm whitespace-pre-wrap ${message.role === 'assistant' ? 'text-foreground' : 'text-[color:var(--accent-foreground)]'}`}>{message.content}</div>
                            </div>
                          ))}
                          {chatMessages.length === 0 && (
                            <div className="rounded-xl border border-dashed border-border p-4 text-sm text-foreground-secondary">
                              Ask what changed, which stories matter most, or how the themes connect.
                            </div>
                          )}
                        </div>
                        <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_260px]">
                          <div className="flex gap-2.5">
                            <input
                              value={chatInput}
                              onChange={(event) => setChatInput(event.target.value)}
                              onKeyDown={(event) => {
                                if (event.key === 'Enter' && !event.shiftKey) {
                                  event.preventDefault();
                                  void handleChat();
                                }
                              }}
                              placeholder="Ask about the briefing, themes, or top stories"
                              className="flex-1 px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:border-accent"
                            />
                            <button
                              onClick={() => void handleChat()}
                              disabled={isChatting || !chatInput.trim()}
                              className="px-3 py-2 rounded-lg bg-accent text-[color:var(--accent-foreground)] text-sm font-medium hover:bg-accent-hover disabled:opacity-50 transition-colors"
                            >
                              {isChatting ? 'Sending…' : 'Send'}
                            </button>
                          </div>
                          <div className="rounded-2xl border border-border bg-background-secondary p-3">
                            <div className="text-xs uppercase tracking-[0.24em] text-foreground-secondary mb-2.5">Suggested Prompts</div>
                            <div className="space-y-2">
                              {[
                                'What are the biggest risks in this briefing?',
                                'Which two stories are likely to evolve next?',
                                'Summarize the briefing for a 60-second update.',
                                'Show how the top themes connect across categories.',
                              ].map((prompt) => (
                                <button
                                  key={prompt}
                                  onClick={() => setChatInput(prompt)}
                                  className="w-full text-left rounded-xl border border-border bg-background px-3 py-2 text-sm hover:border-accent transition-colors"
                                >
                                  {prompt}
                                </button>
                              ))}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                    <div className="space-y-3">
                      <div className="rounded-2xl border border-border bg-background p-3">
                        <div className="text-xs uppercase tracking-[0.24em] text-foreground-secondary mb-2.5">What Changed</div>
                        <div className="space-y-2">
                          {summarySections.slice(0, 3).map((section, index) => (
                            <div key={index} className="rounded-xl border border-border bg-background-secondary px-3 py-2.5 text-sm text-foreground-secondary">
                              {section.replace(/^[-*#\s]+/, '')}
                            </div>
                          ))}
                        </div>
                      </div>
                      <div className="rounded-2xl border border-border bg-background p-3">
                        <div className="text-xs uppercase tracking-[0.24em] text-foreground-secondary mb-2.5">Top Sources</div>
                        <div className="space-y-2">
                          {topSources.map(([source, count]) => (
                            <div key={source} className="flex items-center justify-between rounded-xl border border-border bg-background-secondary px-3 py-2 text-sm">
                              <span className="font-medium">{source}</span>
                              <span className="text-foreground-secondary">{count}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                </section>

                <section className="rounded-2xl border border-border bg-background-secondary p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <Newspaper className="w-4 h-4 text-accent" />
                    <h2 className="text-lg font-medium">Ranked Story Board</h2>
                  </div>
                  <div className="grid gap-3 2xl:grid-cols-2">
                    {groupedStories.map(([category, stories]) => (
                      <div key={category} className="rounded-2xl border border-border bg-background p-3">
                        <div className="flex items-center justify-between gap-3 mb-3">
                          <div className="font-medium">{category}</div>
                          <div className="text-xs text-foreground-secondary">{stories.length} stories</div>
                        </div>
                        <div className="space-y-2.5">
                          {stories.map((story, index) => (
                            <a
                              key={story.articleId}
                              href={story.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="block rounded-xl border border-border bg-background-secondary p-2.5 hover:border-accent transition-colors"
                            >
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <div className="mb-1 flex items-center gap-2 flex-wrap">
                                    <span className="text-xs text-foreground-secondary">#{index + 1} in {category}</span>
                                    {index === 0 && (
                                      <span className="rounded-full bg-accent/10 px-2 py-0.5 text-[11px] font-medium text-accent">
                                        Lead
                                      </span>
                                    )}
                                  </div>
                                  <div className="font-medium leading-snug">{story.title}</div>
                                  <div className="text-xs text-foreground-secondary mt-2">{story.sourceTitle || 'Unknown Source'}</div>
                                </div>
                                <Link2 className="w-4 h-4 text-foreground-secondary flex-shrink-0 mt-1" />
                              </div>
                            </a>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              </>
            ) : (
              <section className="rounded-2xl border border-border bg-background-secondary p-5">
                <p className="text-sm text-foreground-secondary">
                  No saved briefings yet. Generate the first manual briefing from the stored article corpus.
                </p>
              </section>
            )}
          </div>
        </div>
          </div>
        </div>
      </div>
      {isAutomationOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setIsAutomationOpen(false)} />
          <div className="relative z-10 w-full max-w-2xl rounded-2xl border border-border bg-background-secondary p-4 shadow-2xl mx-4">
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold">Brief Automation</h2>
                <p className="mt-1 text-sm text-foreground-secondary">
                  Choose when to auto-generate the daily brief and optionally push the current saved briefing to Telegram.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsAutomationOpen(false)}
                className="rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-foreground-secondary hover:border-accent hover:text-foreground transition-colors"
              >
                Close
              </button>
            </div>

            <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
              <div className="rounded-2xl border border-border bg-background p-3">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div className="text-xs uppercase tracking-[0.22em] text-foreground-secondary">Generate Automatically</div>
                  <button
                    type="button"
                    onClick={() => setBriefingSettings({ enabled: !briefingSettings.enabled })}
                    className={`inline-flex h-6 w-11 items-center rounded-full px-0.5 transition-colors ${briefingSettings.enabled ? 'bg-accent' : 'bg-border'}`}
                    aria-label="Toggle automatic briefing generation"
                  >
                    <span
                      className={`h-5 w-5 rounded-full bg-white transition-transform ${briefingSettings.enabled ? 'translate-x-5' : 'translate-x-0'}`}
                    />
                  </button>
                </div>
                <div className="mb-2 flex items-center justify-between">
                  <div className="text-xs uppercase tracking-[0.22em] text-foreground-secondary">Schedule Times</div>
                  <button
                    type="button"
                    onClick={() => setBriefingSettings({ times: [...briefingSettings.times, '09:00'] })}
                    className="inline-flex items-center gap-1 rounded-lg border border-border bg-background-secondary px-2 py-1 text-xs text-foreground-secondary hover:border-accent hover:text-foreground transition-colors"
                  >
                    <Plus className="w-3 h-3" />
                    Add Time
                  </button>
                </div>
                <div className="space-y-2">
                  {briefingSettings.times.map((time, index) => (
                    <div key={`${time}-${index}`} className="flex items-center gap-2">
                      <input
                        type="time"
                        value={time}
                        onChange={(event) => {
                          const nextTimes = [...briefingSettings.times];
                          nextTimes[index] = event.target.value;
                          setBriefingSettings({ times: nextTimes });
                        }}
                        className="flex-1 rounded-lg border border-border bg-background-secondary px-3 py-2 text-sm focus:border-accent focus:outline-none"
                      />
                      {briefingSettings.times.length > 1 && (
                        <button
                          type="button"
                          onClick={() => {
                            const nextTimes = briefingSettings.times.filter((_, itemIndex) => itemIndex !== index);
                            setBriefingSettings({ times: nextTimes });
                          }}
                          className="rounded-lg border border-border bg-background-secondary px-2 py-2 text-foreground-secondary hover:border-error hover:text-error transition-colors"
                          aria-label="Remove scheduled time"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
                <p className="mt-2 text-[11px] text-foreground-secondary">
                  Automatic generation runs when the app is open and the current time passes one of these slots.
                </p>
              </div>

              <div className="rounded-2xl border border-border bg-background p-3">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <Send className="w-4 h-4 text-accent" />
                    <div className="text-sm font-medium">Push to Telegram</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setBriefingSettings({ telegramEnabled: !briefingSettings.telegramEnabled })}
                    className={`inline-flex h-6 w-11 items-center rounded-full px-0.5 transition-colors ${briefingSettings.telegramEnabled ? 'bg-accent' : 'bg-border'}`}
                    aria-label="Toggle Telegram push"
                  >
                    <span
                      className={`h-5 w-5 rounded-full bg-white transition-transform ${briefingSettings.telegramEnabled ? 'translate-x-5' : 'translate-x-0'}`}
                    />
                  </button>
                </div>

                {briefingSettings.telegramEnabled && (
                  <div className="space-y-3">
                    <div>
                      <label className="mb-1 block text-xs font-medium text-foreground-secondary">Bot Token</label>
                      <div className="relative">
                        <input
                          type={showTelegramToken ? 'text' : 'password'}
                          value={briefingSettings.telegramToken}
                          onChange={(event) => setBriefingSettings({ telegramToken: event.target.value })}
                          placeholder="123456:ABC-DEF..."
                          className="w-full rounded-lg border border-border bg-background-secondary px-3 py-2 pr-10 text-sm focus:border-accent focus:outline-none"
                        />
                        <button
                          type="button"
                          onClick={() => setShowTelegramToken((current) => !current)}
                          className="absolute right-2 top-1/2 -translate-y-1/2 text-foreground-secondary hover:text-foreground"
                          aria-label={showTelegramToken ? 'Hide Telegram token' : 'Show Telegram token'}
                        >
                          {showTelegramToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      </div>
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-medium text-foreground-secondary">Chat ID</label>
                      <input
                        type="text"
                        value={briefingSettings.telegramChatId}
                        onChange={(event) => setBriefingSettings({ telegramChatId: event.target.value })}
                        placeholder="e.g. 123456789"
                        className="w-full rounded-lg border border-border bg-background-secondary px-3 py-2 text-sm focus:border-accent focus:outline-none"
                      />
                    </div>
                    <p className="text-[11px] text-foreground-secondary">
                      The pushed message uses the current saved briefing summary and top stories.
                    </p>
                    <button
                      type="button"
                      onClick={() => void handlePushToTelegram()}
                      disabled={isPushingTelegram || !selectedBriefing || !briefingSettings.telegramToken || !briefingSettings.telegramChatId}
                      className="inline-flex items-center gap-2 rounded-lg bg-accent px-3 py-2 text-sm font-medium text-[color:var(--accent-foreground)] hover:bg-accent-hover disabled:opacity-50 transition-colors"
                    >
                      <Send className="w-4 h-4" />
                      {isPushingTelegram ? 'Pushing…' : 'Push Current Briefing'}
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </AppChrome>
  );
}
