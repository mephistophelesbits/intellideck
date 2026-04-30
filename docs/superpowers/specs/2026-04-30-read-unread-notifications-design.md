# Read/Unread Tracking + Desktop Notifications

**Date:** 2026-04-30
**Status:** Approved

---

## Overview

Two related features:

1. **Read/Unread tracking** — articles in columns visually distinguish unread from read. Opening an article marks it read. Column headers show an unread count badge. A "mark all read" button clears a column.
2. **Desktop notifications** — when a background column refresh finds new articles matching a keyword alert, fire an OS notification (Web Notifications API, works natively in Electron renderer).

---

## Data Layer

### New DB table

Added to `lib/server/db.ts` `initializeDatabase()`:

```sql
CREATE TABLE IF NOT EXISTS read_articles (
  article_id TEXT PRIMARY KEY,
  read_at    TEXT NOT NULL
);
```

No foreign key to `articles` — article IDs from RSS feeds are ephemeral and may not be in the `articles` table. The read table is a lightweight set of strings.

### New repository: `lib/server/read-articles-repository.ts`

```ts
markRead(articleId: string): void
markAllRead(articleIds: string[]): void
getAllReadIds(): string[]   // for hydration on app load
```

All operations use `INSERT OR IGNORE` / `INSERT OR REPLACE` for idempotency.

---

## API

### `/api/articles/read`

| Method | Body | Response | Description |
|--------|------|----------|-------------|
| GET | — | `{ readIds: string[] }` | All read IDs — used for client hydration |
| POST | `{ articleId: string }` | `{ ok: true }` | Mark single article read |
| POST | `{ articleIds: string[] }` | `{ ok: true }` | Mark batch read (mark all) |

Single vs batch is distinguished by which key is present in the POST body.

---

## Client Store

### `lib/read-articles-store.ts` (Zustand)

```ts
interface ReadArticlesState {
  readIds: Set<string>
  hydrateReadIds(ids: string[]): void
  markRead(id: string): void         // optimistic + POST /api/articles/read
  markAllRead(ids: string[]): void   // optimistic + POST /api/articles/read
  isRead(id: string): boolean
}
```

Follows the same pattern as `bookmarks-store.ts`: optimistic local update, fire-and-forget API call, no error recovery needed (worst case an article shows as unread again after reload).

### Hydration

`StoreHydration.tsx` gets a new `useEffect` on mount that fetches `GET /api/articles/read` and calls `hydrateReadIds(data.readIds)`.

---

## UI Changes

### `ArticleCard.tsx`

- Import `useReadArticlesStore`
- Derive `read = isRead(article.id)`
- **Unread**: accent dot (8px, `bg-accent`, rounded-full) left of title + `font-bold` title + full opacity
- **Read**: no dot + `font-normal` title + `opacity-50`
- `onClick` handler calls `markRead(article.id)` before calling the existing `onArticleClick`

### `Column.tsx` header

- Compute `unreadCount = articles.filter(a => !isRead(a.id)).length`
- Render a badge `<span className="...bg-accent text-white text-xs px-1.5 py-0.5 rounded-full">{unreadCount}</span>` next to the column title, hidden when `unreadCount === 0`
- Render a "Mark all read" icon button (Lucide `CheckCheck`) in the column header action row, visible when `unreadCount > 0`, calls `markAllRead(articles.map(a => a.id))`

---

## Desktop Notifications

### Permission

`AppChrome.tsx` — on mount, after a short delay (500ms to let the app settle):

```ts
if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
  void Notification.requestPermission()
}
```

Silent no-op if already granted or denied. No-op in non-Electron web contexts where `Notification` may be blocked.

### Triggering

`Column.tsx` — add a `prevArticleIdsRef = useRef<Set<string>>(new Set())` to track which article IDs were present before the last refresh.

After each `fetchFeeds()` resolves and `setArticles(next)` is called:

1. Compute `newArticles = next.filter(a => !prevArticleIdsRef.current.has(a.id))`
2. Update `prevArticleIdsRef.current = new Set(next.map(a => a.id))`
3. Skip notification if `prevArticleIdsRef.current` was empty (initial load — don't blast notifications on startup)
4. For each new article, check if it matches any enabled keyword alert (same regex logic as `ArticleCard`)
5. If matches found and `document.visibilityState === 'hidden'` and `Notification.permission === 'granted'`:
   ```ts
   new Notification(`🔔 ${matchedAlert.keyword}`, {
     body: article.title,
     icon: '/icon.png',
   })
   ```

One notification per matched article (not one per keyword — first matching alert wins).

---

## What's Not In Scope

- Syncing read state across multiple devices or Docker instances
- Marking articles read by scrolling past (scroll-based tracking)
- Unread count in the dock badge or system tray
- Read state for the Bookmarks or Search pages (only deck columns)
