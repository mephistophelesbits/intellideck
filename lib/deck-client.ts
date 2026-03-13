import { Column, DeckStateSnapshot, FeedSource } from './types';

async function parseDeckResponse(response: Response): Promise<DeckStateSnapshot> {
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || 'Request failed');
  }

  return data as DeckStateSnapshot;
}

export async function fetchDeckState() {
  const response = await fetch('/api/deck', { cache: 'no-store' });
  return parseDeckResponse(response);
}

export async function createColumnRequest(column: Column) {
  const response = await fetch('/api/deck/columns', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(column),
  });
  return parseDeckResponse(response);
}

export async function updateColumnRequest(columnId: string, updates: Partial<Column>) {
  const response = await fetch(`/api/deck/columns/${columnId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  });
  return parseDeckResponse(response);
}

export async function deleteColumnRequest(columnId: string) {
  const response = await fetch(`/api/deck/columns/${columnId}`, {
    method: 'DELETE',
  });
  return parseDeckResponse(response);
}

export async function reorderColumnsRequest(columnIds: string[]) {
  const response = await fetch('/api/deck/columns/reorder', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ columnIds }),
  });
  return parseDeckResponse(response);
}

export async function addFeedToColumnRequest(columnId: string, feed: FeedSource) {
  const response = await fetch(`/api/deck/columns/${columnId}/feeds`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(feed),
  });
  return parseDeckResponse(response);
}

export async function updateFeedInColumnRequest(
  columnId: string,
  feedId: string,
  updates: Partial<FeedSource>
) {
  const response = await fetch(`/api/deck/columns/${columnId}/feeds/${feedId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  });
  return parseDeckResponse(response);
}

export async function removeFeedFromColumnRequest(columnId: string, feedId: string) {
  const response = await fetch(`/api/deck/columns/${columnId}/feeds/${feedId}`, {
    method: 'DELETE',
  });
  return parseDeckResponse(response);
}

export async function saveFeedRequest(feed: FeedSource) {
  const response = await fetch('/api/deck/feeds', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(feed),
  });
  return parseDeckResponse(response);
}

export async function deleteSavedFeedRequest(feedId: string) {
  const response = await fetch(`/api/deck/feeds/${feedId}`, {
    method: 'DELETE',
  });
  return parseDeckResponse(response);
}

export function getOpmlExportUrl() {
  return '/api/deck/feeds/opml';
}
