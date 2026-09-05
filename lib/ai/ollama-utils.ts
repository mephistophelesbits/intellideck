// Matches CJK ideographs, kana, hangul, and CJK/fullwidth punctuation.
const CJK_PATTERN =
  /[　-〿぀-ヿ㐀-䶿一-鿿가-힯豈-﫿＀-￯]/g;

/**
 * Rough token estimate. Latin/mixed text runs ~3.5 chars per token, but CJK
 * characters tokenize at roughly ~1.5 tokens EACH under SentencePiece. Counting
 * them separately avoids badly under-sizing num_ctx for Chinese/Japanese/Korean
 * feeds — under-sizing truncates the prompt and produces garbage ("Okay"/empty)
 * output. We bias slightly high so num_ctx errs toward fitting the whole prompt.
 */
export function estimateTokens(text: string): number {
  const cjk = (text.match(CJK_PATTERN) || []).length;
  const other = text.length - cjk;
  return Math.ceil(cjk * 1.5 + other / 3.5);
}

/**
 * Compute num_ctx for an Ollama request.
 * Takes the full prompt text, estimates tokens, adds 20% headroom for output,
 * rounds up to nearest 512, clamps between 2048 and 8192.
 */
export function computeNumCtx(promptText: string): number {
  const estimated = estimateTokens(promptText);
  const withHeadroom = Math.ceil(estimated * 1.2);
  const rounded = Math.ceil(withHeadroom / 512) * 512;
  return Math.max(2048, Math.min(8192, rounded));
}

/**
 * Truncate text to maxChars at a sentence boundary where possible.
 * Falls back to hard cut if no sentence boundary found in the last 20% of the window.
 */
export function truncateForOllama(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const window = text.slice(0, maxChars);
  const lastSentence = window.search(/[.!?][^.!?]*$/);
  const cutoff = lastSentence > maxChars * 0.8 ? lastSentence + 1 : maxChars;
  return window.slice(0, cutoff).trimEnd() + '…';
}

/**
 * Check if Ollama is reachable. Returns quickly (3s timeout).
 */
export async function checkOllamaHealth(
  baseUrl: string
): Promise<{ ok: boolean; error?: string }> {
  try {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), 3000);
    const res = await fetch(`${baseUrl}/api/tags`, { signal: controller.signal });
    clearTimeout(id);
    return { ok: res.ok };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'unreachable' };
  }
}
