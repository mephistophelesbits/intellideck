'use client';

import { useEffect } from 'react';
import { useSettingsStore } from '@/lib/settings-store';

export function HtmlLangUpdater() {
  const locale = useSettingsStore((state) => state.locale);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  return null;
}
