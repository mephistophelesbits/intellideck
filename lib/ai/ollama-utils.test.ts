import { describe, it, expect } from 'vitest';
import { estimateTokens, computeNumCtx } from './ollama-utils';

describe('estimateTokens (CJK-aware)', () => {
  it('counts CJK characters much heavier than latin', () => {
    const latin = 'a'.repeat(100);              // ~29 tokens
    const chinese = '新闻'.repeat(50);           // 100 CJK chars -> ~150 tokens
    expect(estimateTokens(chinese)).toBeGreaterThan(estimateTokens(latin) * 3);
  });

  it('a Chinese-heavy prompt no longer under-sizes num_ctx below its real size', () => {
    // ~1700 Chinese chars ~= 2550 tokens; old estimator (len/3.5) gave ~486 -> num_ctx 2048 (too small)
    const prompt = '中美关系与人工智能监管动态。'.repeat(130);
    const est = estimateTokens(prompt);
    expect(est).toBeGreaterThan(2000);
    // Must exceed the old 2048 floor that truncated Chinese prompts into garbage.
    expect(computeNumCtx(prompt)).toBeGreaterThan(2048);
  });

  it('still handles pure-latin prompts reasonably', () => {
    expect(estimateTokens('hello world '.repeat(10))).toBeLessThan(60);
    expect(computeNumCtx('short prompt')).toBe(2048); // floor
  });
});
