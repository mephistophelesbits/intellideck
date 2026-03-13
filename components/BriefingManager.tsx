'use client';

import { useEffect, useRef } from 'react';
import { useSettingsStore } from '@/lib/settings-store';

function getLatestDueTimestamp(times: string[], now: Date) {
  const dueTimestamps = times
    .map((time) => {
      const [hours, minutes] = time.split(':').map(Number);
      if (Number.isNaN(hours) || Number.isNaN(minutes)) return null;
      const scheduled = new Date(now);
      scheduled.setHours(hours, minutes, 0, 0);
      return scheduled.getTime() <= now.getTime() ? scheduled.getTime() : null;
    })
    .filter((value): value is number => value !== null)
    .sort((a, b) => b - a);

  return dueTimestamps[0] ?? null;
}

export function BriefingManager() {
  const aiSettings = useSettingsStore((state) => state.aiSettings);
  const briefingSettings = useSettingsStore((state) => state.briefingSettings);
  const setBriefingSettings = useSettingsStore((state) => state.setBriefingSettings);
  const isRunningRef = useRef(false);

  useEffect(() => {
    const checkSchedule = async () => {
      if (isRunningRef.current || !briefingSettings.enabled || briefingSettings.times.length === 0) {
        return;
      }

      const now = new Date();
      const latestDue = getLatestDueTimestamp(briefingSettings.times, now);
      if (!latestDue) return;

      const lastGenerated = briefingSettings.lastGenerated ? new Date(briefingSettings.lastGenerated).getTime() : 0;
      if (lastGenerated >= latestDue) return;

      isRunningRef.current = true;

      try {
        const response = await fetch('/api/briefings/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ aiSettings }),
        });
        const briefing = await response.json();
        if (!response.ok) {
          throw new Error(briefing.error || 'Failed to generate scheduled briefing');
        }

        if (briefingSettings.telegramEnabled && briefingSettings.telegramToken && briefingSettings.telegramChatId) {
          await fetch('/api/briefings/push', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              briefing,
              telegramToken: briefingSettings.telegramToken,
              telegramChatId: briefingSettings.telegramChatId,
            }),
          });
        }

        setBriefingSettings({ lastGenerated: new Date().toISOString() });
      } catch (error) {
        console.error('Scheduled briefing failed:', error);
      } finally {
        isRunningRef.current = false;
      }
    };

    void checkSchedule();
    const interval = window.setInterval(() => {
      void checkSchedule();
    }, 60_000);

    return () => window.clearInterval(interval);
  }, [
    aiSettings,
    briefingSettings.enabled,
    briefingSettings.lastGenerated,
    briefingSettings.telegramChatId,
    briefingSettings.telegramEnabled,
    briefingSettings.telegramToken,
    briefingSettings.times,
    setBriefingSettings,
  ]);

  return null;
}
