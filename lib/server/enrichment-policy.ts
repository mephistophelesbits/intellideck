// Bounds how much expensive LLM enrichment the pipeline does.
//
// Enrichment (entity extraction + story adjudication) feeds the Today/Priority/Story
// intelligence, which is about CURRENT news. Running it on stale articles is low value
// and — critically — turns any inference-host outage into a flood: when Ollama is
// down for a day or two, every article ingested meanwhile piles up and then hammers a
// single-slot inference server for hours once it recovers, starving live requests.
// Skipping the LLM work for old articles caps that flood. Embeddings are cheap and
// still run for everything, so vector search/clustering is unaffected.

export const ENRICHMENT_LLM_MAX_AGE_MS = 48 * 60 * 60 * 1000; // 48h

/**
 * Whether an article is fresh enough to warrant the expensive LLM enrichment steps.
 * Unknown/unparseable timestamps default to true (don't silently skip current items).
 */
export function shouldLlmEnrich(
  occurredAt: string | null | undefined,
  now: number = Date.now(),
  maxAgeMs: number = ENRICHMENT_LLM_MAX_AGE_MS
): boolean {
  if (!occurredAt) return true;
  const t = Date.parse(occurredAt);
  if (!Number.isFinite(t)) return true;
  return now - t <= maxAgeMs;
}
