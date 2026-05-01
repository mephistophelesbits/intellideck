# House Ad Feed Injection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Insert a "Buy Me a Coffee" house ad card after every 10th article in each feed column, keeping the free macOS app monetisable without any external ad network.

**Architecture:** Add `AdSentinel` and `FeedItem` types to `lib/types.ts`, create a new `AdCard` component styled to match `ArticleCard`, and add an `injectAds` helper in `Column.tsx` that splices sentinels into the articles array before rendering.

**Tech Stack:** Next.js 14, React, TypeScript, Tailwind CSS, Lucide icons, Electron (external links via `window.open`)

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `lib/types.ts` | Modify | Add `AdSentinel` and `FeedItem` union type |
| `components/deck/AdCard.tsx` | Create | Buy Me a Coffee card, styled to match `ArticleCard` |
| `components/deck/Column.tsx` | Modify | Add `injectAds` helper, update render loop to handle `FeedItem[]` |
| `lib/injectAds.test.ts` | Create | Unit tests for the `injectAds` pure function |
| `lib/injectAds.ts` | Create | Extracted pure `injectAds` helper (testable without React) |

---

## Task 1: Add types to `lib/types.ts`

**Files:**
- Modify: `lib/types.ts`

- [ ] **Step 1: Add `AdSentinel` and `FeedItem` to the end of `lib/types.ts`**

Append after the last export in the file:

```ts
export type AdSentinel = { type: 'ad'; id: string };
export type FeedItem = Article | AdSentinel;
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /Users/fong/SynologyDrive/Jarvis/Projects/IntelliDeck/.claude/worktrees/amazing-buck-4de8ed
npx tsc --noEmit
```

Expected: no errors related to types.ts

- [ ] **Step 3: Commit**

```bash
git add lib/types.ts
git commit -m "feat: add AdSentinel and FeedItem types"
```

---

## Task 2: Extract and test the `injectAds` pure function

**Files:**
- Create: `lib/injectAds.ts`
- Create: `lib/injectAds.test.ts`

- [ ] **Step 1: Write the failing tests in `lib/injectAds.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { injectAds } from './injectAds';
import { Article } from './types';

function makeArticles(count: number): Article[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `a${i}`,
    title: `Article ${i}`,
    link: `https://example.com/${i}`,
    pubDate: new Date().toISOString(),
  }));
}

describe('injectAds', () => {
  it('returns articles unchanged when count is less than 10', () => {
    const articles = makeArticles(9);
    const result = injectAds(articles);
    expect(result).toHaveLength(9);
    expect(result.every((item) => !('type' in item && item.type === 'ad'))).toBe(true);
  });

  it('inserts one ad after the 10th article', () => {
    const articles = makeArticles(10);
    const result = injectAds(articles);
    expect(result).toHaveLength(11);
    expect(result[10]).toEqual({ type: 'ad', id: 'ad-9' });
  });

  it('inserts two ads for 20 articles', () => {
    const articles = makeArticles(20);
    const result = injectAds(articles);
    expect(result).toHaveLength(22);
    expect(result[10]).toEqual({ type: 'ad', id: 'ad-9' });
    expect(result[21]).toEqual({ type: 'ad', id: 'ad-19' });
  });

  it('preserves article order', () => {
    const articles = makeArticles(12);
    const result = injectAds(articles);
    const articleItems = result.filter((item) => !('type' in item && item.type === 'ad'));
    expect(articleItems.map((a) => (a as Article).id)).toEqual(articles.map((a) => a.id));
  });

  it('returns empty array for empty input', () => {
    expect(injectAds([])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run lib/injectAds.test.ts
```

Expected: FAIL — `Cannot find module './injectAds'`

- [ ] **Step 3: Implement `lib/injectAds.ts`**

```ts
import { Article, AdSentinel, FeedItem } from './types';

export function injectAds(articles: Article[]): FeedItem[] {
  const result: FeedItem[] = [];
  articles.forEach((article, i) => {
    result.push(article);
    if ((i + 1) % 10 === 0) {
      result.push({ type: 'ad', id: `ad-${i}` } satisfies AdSentinel);
    }
  });
  return result;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run lib/injectAds.test.ts
```

Expected: all 5 tests PASS

- [ ] **Step 5: Commit**

```bash
git add lib/injectAds.ts lib/injectAds.test.ts
git commit -m "feat: add injectAds helper with tests"
```

---

## Task 3: Create `AdCard` component

**Files:**
- Create: `components/deck/AdCard.tsx`

- [ ] **Step 1: Create `components/deck/AdCard.tsx`**

```tsx
'use client';

import { Coffee } from 'lucide-react';

export function AdCard() {
  const handleClick = () => {
    window.open('https://buymeacoffee.com/kianfongl', '_blank', 'noopener,noreferrer');
  };

  return (
    <div className="border-b border-border px-3 py-3 bg-accent-light/40 hover:bg-accent-light/60 transition-colors">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <Coffee className="w-4 h-4 text-accent flex-shrink-0" />
          <p className="text-sm text-foreground">
            Like IntelliDeck?{' '}
            <button
              onClick={handleClick}
              className="text-accent hover:underline font-medium"
            >
              Buy Fong a coffee.
            </button>
          </p>
        </div>
        <span className="text-[10px] text-foreground-secondary flex-shrink-0 mt-0.5">Support</span>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add components/deck/AdCard.tsx
git commit -m "feat: add AdCard house ad component"
```

---

## Task 4: Wire `injectAds` into `Column.tsx`

**Files:**
- Modify: `components/deck/Column.tsx`

- [ ] **Step 1: Add imports at the top of `Column.tsx`**

After the existing imports, add:

```ts
import { AdCard } from './AdCard';
import { injectAds } from '@/lib/injectAds';
import { FeedItem } from '@/lib/types';
```

The existing import line `import { Column as ColumnType, Article } from '@/lib/types';` stays — just append `FeedItem` to it:

```ts
import { Column as ColumnType, Article, FeedItem } from '@/lib/types';
```

And add the AdCard/injectAds imports separately:

```ts
import { AdCard } from './AdCard';
import { injectAds } from '@/lib/injectAds';
```

- [ ] **Step 2: Replace the articles render loop inside `Column.tsx`**

Find this block (lines 380–388):

```tsx
return filteredArticles.map((article) => (
  <ArticleCard
    key={article.id}
    article={article}
    viewMode={column.settings.viewMode}
    onClick={onArticleClick}
    isSelected={article.id === selectedArticleId}
  />
));
```

Replace with:

```tsx
const feedItems: FeedItem[] = injectAds(filteredArticles);
return feedItems.map((item) => {
  if ('type' in item && item.type === 'ad') {
    return <AdCard key={item.id} />;
  }
  return (
    <ArticleCard
      key={item.id}
      article={item}
      viewMode={column.settings.viewMode}
      onClick={onArticleClick}
      isSelected={item.id === selectedArticleId}
    />
  );
});
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 4: Run existing tests to confirm nothing broke**

```bash
npx vitest run
```

Expected: all tests PASS

- [ ] **Step 5: Commit**

```bash
git add components/deck/Column.tsx
git commit -m "feat: inject house ad card every 10th article in feed columns"
```

---

## Task 5: Manual verification

- [ ] **Step 1: Start the dev server**

```bash
npm run dev
```

- [ ] **Step 2: Open the app and verify**

- Open a column with 10+ articles
- Scroll down — after the 10th article card, an ad card should appear with a coffee icon and "Like IntelliDeck? Buy Fong a coffee."
- A "Support" label should be visible in the top-right of the card
- Clicking "Buy Fong a coffee." should open `https://buymeacoffee.com/kianfongl` in the default browser
- Columns with fewer than 10 articles should show no ad card

- [ ] **Step 3: Check dark/light theme**

Toggle the theme and confirm the `AdCard` background (`bg-accent-light/40`) looks good in both modes.
