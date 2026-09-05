'use client';

import { useEffect, useState, useCallback } from 'react';
import { cn } from '@/lib/utils';
import { TimeAgo } from '@/components/ui/TimeAgo';
import { WifiOff, Loader2, AlertCircle, RotateCcw } from 'lucide-react';

export interface AgentStatus {
  ok: boolean;
  issues: string[];
  feeds: { total: number; lastFetchedAt: string | null; errorCount: number };
  articles: { today: number; pendingEnrichment: number; withEmbedding: number };
  ai: { enabled: boolean; reachable: boolean; embedModelOk: boolean; chatModelOk: boolean; breakerOpen: boolean; model: string };
}

export function useAgentStatus() {
  const [status, setStatus] = useState<AgentStatus | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    const loadStatus = async () => {
      const response = await fetch('/api/agent/status');
      const text = await response.text();
      if (!text.trim()) {
        throw new Error('Empty agent status response');
      }
      return JSON.parse(text) as AgentStatus;
    };

    loadStatus()
      .then(setStatus)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 60_000);
    return () => clearInterval(id);
  }, [load]);

  return { status, loading, reload: load };
}

function Dot({ ok, warn }: { ok: boolean; warn?: boolean }) {
  return (
    <span className={cn(
      'inline-block w-1.5 h-1.5 rounded-full flex-shrink-0',
      ok ? 'bg-green-400' : warn ? 'bg-yellow-400' : 'bg-red-400'
    )} />
  );
}

export function AgentStatusBar({ status, loading, reload }: { status: AgentStatus | null; loading: boolean; reload?: () => void }) {
  const [resetting, setResetting] = useState(false);

  const resetBreaker = async () => {
    setResetting(true);
    try {
      await fetch('/api/agent/reset-breaker', { method: 'POST' });
      reload?.();
    } finally {
      setResetting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-1.5 text-foreground-secondary/50 text-xs px-6 py-1.5 border-b border-border/30 flex-shrink-0">
        <Loader2 className="w-3 h-3 animate-spin" />
        <span>Checking system…</span>
      </div>
    );
  }

  if (!status) return null;

  const { feeds, articles, ai } = status;
  const hasIssues = !status.ok || feeds.errorCount > 0;

  return (
    <div className={cn(
      'flex items-center gap-4 text-xs px-6 py-1.5 border-b flex-shrink-0 flex-wrap',
      hasIssues ? 'border-yellow-500/20 bg-yellow-500/5' : 'border-border/30'
    )}>
      <span className="flex items-center gap-1.5 text-foreground-secondary/60">
        <Dot ok={!!feeds.lastFetchedAt} />
        {feeds.lastFetchedAt ? (
          <>Feeds refreshed <TimeAgo date={feeds.lastFetchedAt} /></>
        ) : (
          'No feeds fetched yet'
        )}
        {feeds.errorCount > 0 && (
          <span className="text-yellow-400 flex items-center gap-1">
            <AlertCircle className="w-3 h-3" />
            {feeds.errorCount} error{feeds.errorCount > 1 ? 's' : ''}
          </span>
        )}
      </span>

      <span className="text-foreground-secondary/30">·</span>

      <span className="text-foreground-secondary/60">
        {articles.today} article{articles.today !== 1 ? 's' : ''} today
      </span>

      {articles.pendingEnrichment > 0 && (
        <>
          <span className="text-foreground-secondary/30">·</span>
          <span className="flex items-center gap-1 text-foreground-secondary/60">
            <Loader2 className="w-3 h-3 animate-spin" />
            {articles.pendingEnrichment} enriching
          </span>
        </>
      )}

      {!ai.enabled ? (
        <span className="flex items-center gap-1 text-foreground-secondary/40">
          <Dot ok={false} warn />
          AI off
        </span>
      ) : !ai.reachable ? (
        <span className="flex items-center gap-1 text-yellow-400">
          <WifiOff className="w-3 h-3" />
          Ollama unreachable
        </span>
      ) : ai.breakerOpen ? (
        <span className="flex items-center gap-2 text-red-400">
          <AlertCircle className="w-3 h-3" />
          Circuit breaker open
          <button
            onClick={resetBreaker}
            disabled={resetting}
            className="flex items-center gap-1 text-foreground-secondary hover:text-foreground bg-background-tertiary px-2 py-0.5 rounded transition-colors"
          >
            {resetting ? <Loader2 className="w-3 h-3 animate-spin" /> : <RotateCcw className="w-3 h-3" />}
            Reset
          </button>
        </span>
      ) : !ai.embedModelOk ? (
        <span className="flex items-center gap-1 text-yellow-400">
          <AlertCircle className="w-3 h-3" />
          Embed model not loaded
        </span>
      ) : !ai.chatModelOk ? (
        <span className="flex items-center gap-1 text-yellow-400">
          <AlertCircle className="w-3 h-3" />
          Chat model "{ai.model}" not found
        </span>
      ) : (
        <span className="flex items-center gap-1 text-foreground-secondary/60">
          <Dot ok />
          AI ready
        </span>
      )}
    </div>
  );
}
