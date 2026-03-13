'use client';

import { useEffect } from 'react';
import { useSettingsStore, getThemeById } from '@/lib/settings-store';

interface ThemeProviderProps {
  children: React.ReactNode;
}

function getReadableAccentForeground(accent: string) {
  const normalized = accent.replace('#', '');
  const hex = normalized.length === 3
    ? normalized.split('').map((char) => `${char}${char}`).join('')
    : normalized;

  if (!/^[0-9a-fA-F]{6}$/.test(hex)) {
    return '#ffffff';
  }

  const red = parseInt(hex.slice(0, 2), 16);
  const green = parseInt(hex.slice(2, 4), 16);
  const blue = parseInt(hex.slice(4, 6), 16);
  const luminance = (0.2126 * red) + (0.7152 * green) + (0.0722 * blue);

  return luminance > 170 ? '#111827' : '#ffffff';
}

export function ThemeProvider({ children }: ThemeProviderProps) {
  const themeId = useSettingsStore((state) => state.themeId);

  useEffect(() => {
    const theme = getThemeById(themeId);
    const root = document.documentElement;

    root.style.setProperty('--background', theme.background);
    root.style.setProperty('--background-secondary', theme.backgroundSecondary);
    root.style.setProperty('--background-tertiary', theme.backgroundTertiary);
    root.style.setProperty('--foreground', theme.foreground);
    root.style.setProperty('--foreground-secondary', theme.foregroundSecondary);
    root.style.setProperty('--accent', theme.accent);
    root.style.setProperty('--accent-hover', theme.accentHover);
    root.style.setProperty(
      '--accent-foreground',
      theme.accentForeground || getReadableAccentForeground(theme.accent),
    );
    root.style.setProperty('--border', theme.border);
    root.style.setProperty('--font-sans', theme.fontFamily || 'var(--font-dm-sans), sans-serif');
    root.setAttribute('data-theme', themeId);

    // Manage dark mode class for Tailwind
    if (theme.isDark) {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
  }, [themeId]);

  return <>{children}</>;
}
