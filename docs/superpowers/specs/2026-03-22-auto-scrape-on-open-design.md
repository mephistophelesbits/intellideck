# Auto-Scrape on Article Open — Design Spec

**Date:** 2026-03-22
**Status:** Approved
**Scope:** Automatically fetch full article content after the reading panel has been open for 4 seconds, when the feed didn't already provide full content.

---

## Overview

When a user clicks an article and leaves the reading panel open for 4 seconds, automatically call the existing scrape logic (`handleFetchFullArticle`) to pull the full article body via Mozilla Readability. This eliminates the need to manually click "Fetch Full Article" for most articles.

---

## Behaviour

| Condition | Result |
|-----------|--------|
| Article already has scraped content cached (`scrapedContent !== null`) | Do nothing — already have full content |
| Article's RSS feed content is ≥ 500 characters (`article.content?.length >= 500`) | Do nothing — feed provided full content |
| Otherwise | Start 4-second timer; on expiry call `handleFetchFullArticle()` |
| User switches to a different article before 4s | Cancel timer (no fetch) |
| Component unmounts before 4s | Cancel timer (no fetch) |

**500-character threshold:** RSS snippets are typically 100–200 chars. A genuine full-body article in the feed is almost always 500+ chars. This avoids redundant scraping when the feed already provides full text.

**No new UI:** The 4-second wait is silent. Once scraping starts, the existing `isScraping` spinner (already rendered in `ArticlePreviewPanel`) covers the loading state. No countdown indicator is needed.

---

## Implementation

### File changed

`components/ui/ArticlePreviewPanel.tsx` — add one `useEffect` after the existing article-change effect (~line 181).

### New effect

```ts
useEffect(() => {
  if (!article) return;
  if (scrapedContent) return;
  if ((article.content?.length ?? 0) >= 500) return;

  const timer = setTimeout(() => {
    void handleFetchFullArticle();
  }, 4000);

  return () => clearTimeout(timer);
}, [article?.id, scrapedContent]);
```

### Key decisions

- **`useRef` not needed** — the timer ID is captured by the closure in the cleanup function, so no ref is required.
- **`handleFetchFullArticle` already has all guards** — `if (!article || isScraping || scrapedContent) return;` prevents double-fetching even if the effect fires unexpectedly.
- **`article?.id` as dependency** — resets the timer whenever the user opens a different article.
- **`scrapedContent` as dependency** — cancels the timer if scraping was triggered manually before 4s elapsed.
- **`handleFetchFullArticle` intentionally omitted from deps** — it is not wrapped in `useCallback`, so it is recreated on every render. Including it in the dependency array would cause the effect to fire (and restart the timer) on every render. Omitting it is intentional and follows the existing pattern in the file.

---

## Out of Scope

- No settings toggle to enable/disable auto-scrape.
- No visual countdown during the 4-second wait.
- No changes to the scrape API, cache logic, or any other component.
