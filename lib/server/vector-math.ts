import 'server-only';

/** Cosine similarity in [-1, 1]; returns 0 if either vector is empty/zero/length-mismatched. */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/**
 * Incrementally fold `next` into a running mean.
 * @param current existing mean (or null when count is 0)
 * @param next the new vector to add
 * @param count number of vectors already represented by `current`
 */
export function runningMean(current: number[] | null, next: number[], count: number): number[] {
  if (!current || count <= 0) return [...next];
  return current.map((v, i) => (v * count + next[i]) / (count + 1));
}
