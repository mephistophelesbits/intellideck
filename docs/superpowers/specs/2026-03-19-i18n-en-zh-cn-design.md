# i18n: English / Simplified Chinese Language Switching

**Date:** 2026-03-19
**Approach:** Lightweight custom hook + JSON translation files (no external i18n library)

---

## 1. Translation System

### Translation Files

Two JSON files organized by component/feature namespace:

- `lib/i18n/en.json` — English (default)
- `lib/i18n/zh-CN.json` — Simplified Chinese (Mainland)

Namespace structure:

```json
{
  "nav": {
    "rss": "RSS",
    "intelligence": "Intelligence",
    "briefings": "Briefings",
    "bookmarks": "Bookmarks",
    "search": "Search",
    "switchToLight": "Switch to Light Mode",
    "switchToDark": "Switch to Dark Mode",
    "switchLanguage": "Switch to Chinese"
  },
  "briefings": {
    "title": "Briefings",
    "description": "Manual-first daily briefs...",
    "generateBriefing": "Generate Briefing",
    "savedBriefings": "Saved Briefings",
    "executiveBrief": "Executive Brief",
    "chatWithBriefing": "Chat With Briefing",
    "suggestedPrompts": "Suggested Prompts",
    ...
  },
  "settings": { ... },
  "search": { ... },
  "addFeed": { ... },
  "article": { ... },
  "intelligence": { ... },
  "dashboard": { ... },
  "bookmarks": { ... },
  "landing": { ... }
}
```

### `useTranslation()` Hook

Located at `lib/i18n/index.ts`.

```typescript
type Locale = 'en' | 'zh-CN';

function useTranslation() {
  const locale = useSettingsStore((s) => s.locale);
  const t = (key: string) => {
    // Look up nested key (e.g., "nav.rss") from the locale's JSON
    // Falls back to English if key missing in zh-CN
  };
  return { t, locale };
}
```

The hook reads `locale` from the Zustand settings store and returns a `t()` function that resolves dot-notation keys against the appropriate translation file. Missing keys in `zh-CN` fall back to the English value.

---

## 2. State & Persistence

### Settings Store Changes (`lib/settings-store.ts`)

Add to `SettingsState`:

```typescript
locale: 'en' | 'zh-CN';
setLocale: (locale: 'en' | 'zh-CN') => void;
```

Default: `'en'`

`setLocale()` action behavior:
1. Updates `locale` in store
2. Auto-sets `aiSettings.language`:
   - `'zh-CN'` → `language: 'Chinese'`
   - `'en'` → `language: 'Original Language'`
3. Persists via existing `persistSettings()` / `/api/settings` mechanism

Add `locale` to `SettingsSnapshot` so it survives across sessions.

### Migration for Existing Users

`hydrateSettings()` replaces the entire store state with the server snapshot. For existing users whose persisted settings predate this feature, `locale` will be absent. The hydration must merge with defaults so missing `locale` falls back to `'en'`. This is handled by spreading `getDefaultSettingsSnapshot()` before the persisted data in `hydrateSettings`.

### Relationship with `aiSettings.language`

`setLocale()` always overwrites `aiSettings.language`. The Summary Language dropdown in SettingsModal is hidden when locale-driven switching is active — the locale toggle is the single source of truth for language. This avoids confusing states where locale says Chinese but AI summaries are in Japanese.

### `<html lang>` Attribute

The root layout (`app/layout.tsx`) sets `<html lang={locale}>` dynamically to reflect the current locale for accessibility.

---

## 3. Language Toggle Button

### Location

`TopNavBar.tsx` — right section, between the search icon and theme toggle button.

### Appearance

- Same dimensions and styling as the theme toggle: `w-9 h-9 rounded-full`
- Displays text: `"EN"` when locale is `en`, `"中"` when locale is `zh-CN`
- Clicking toggles between `en` and `zh-CN`

### Implementation

Note: `NAV_ITEMS` in `TopNavBar.tsx` is a module-level constant with hardcoded labels. It must be restructured to use translation keys (e.g., `labelKey: 'nav.rss'`) that are resolved via `t()` inside the component render.

```tsx
const NAV_ITEMS = [
  { href: '/', labelKey: 'nav.rss', icon: Rss },
  { href: '/intelligence', labelKey: 'nav.intelligence', icon: BrainCircuit },
  // ...
];

// Inside component:
<span>{t(item.labelKey)}</span>
```

Language toggle button:

```tsx
<button
  onClick={() => setLocale(locale === 'en' ? 'zh-CN' : 'en')}
  title={t('nav.switchLanguage')}
  className="w-9 h-9 flex items-center justify-center rounded-full text-foreground-secondary hover:bg-background-tertiary hover:text-foreground transition-colors font-semibold text-xs"
>
  {locale === 'en' ? 'EN' : '中'}
</button>
```

---

## 4. Briefing Report in Chinese

### API Changes (`app/api/briefings/generate/route.ts`)

The request body receives `locale` from the client. When `locale === 'zh-CN'`:

1. **Prompt instruction** — append to the existing prompt string: `"\n\nIMPORTANT: Write the entire response in Simplified Chinese (简体中文), including all section headings."` (no separate system prompt parameter needed)
2. **Section headings** become Chinese:
   - `## Executive Summary` → `## 执行摘要`
   - `## Key Themes` → `## 关键主题`
   - `## Why It Matters` → `## 重要性分析`
3. **Briefing title** switches to: `每日简报 ${date}`

When `locale === 'en'` (or absent), behavior is unchanged.

### Client Changes (`BriefingsWorkspace.tsx`)

- Passes `locale` in the request body when calling `/api/briefings/generate`
- All UI labels, suggested prompts, status messages use `t()` function

### Telegram Push

The Telegram push endpoint (`/api/briefings/push`) receives `locale` in the request body from the client. When `zh-CN`, the greeting and title labels (e.g., "DAILY BRIEFING" → "每日简报") are localized. The briefing content itself is already in Chinese if it was generated with `zh-CN` locale.

---

## 5. Translation Scope

### Translated (via `t()` function)

| Component | Items |
|-----------|-------|
| TopNavBar | Nav labels, button titles, language/theme toggle titles |
| BriefingsWorkspace | All headings, labels, buttons, empty states, suggested prompts, status messages, Telegram section, automation section |
| SettingsModal | Tab labels, section headers, option labels, dropdown options, status/error messages, button states |
| SearchWorkspace | Placeholder text, validation messages, result labels |
| AddFeedModal | Tab labels ("URL", "Categories", "OPML"), button text, error messages |
| AddColumnModal | Modal title, labels, buttons |
| ArticleCard | "AI Summary is disabled" message |
| IntelligenceDashboard | Section headings, stat labels, chart labels |
| Dashboard | Any UI chrome text |
| BookmarksModal | Headings, empty states |
| LandingPage | All marketing copy and CTAs |

### Not Translated (kept as-is)

- Feed category names (e.g., "Tech News (English)") — these describe feed content language
- Article titles and content — sourced from RSS feeds
- "RSS Deck" brand name
- AI provider names ("Ollama", "OpenAI", "Anthropic", etc.)
- Technical labels: model names, URLs, API key placeholders

---

## 6. File Structure

```
lib/i18n/
  index.ts          # useTranslation() hook, Locale type, t() implementation
  en.json           # English translations
  zh-CN.json        # Simplified Chinese translations
```

No new dependencies. No routing changes. No middleware.
