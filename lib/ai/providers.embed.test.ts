import { describe, it, expect, vi, afterEach } from 'vitest';
import { embedText, embedTextBatch } from './providers';

afterEach(() => vi.restoreAllMocks());

describe('embedText (ollama)', () => {
  it('returns the embedding vector from the Ollama response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ embedding: [0.1, 0.2, 0.3] }), { status: 200 }),
    );
    const vec = await embedText('ollama', 'hello world', { model: 'nomic-embed-text' });
    expect(vec).toEqual([0.1, 0.2, 0.3]);
  });

  it('throws on a non-ok response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('boom', { status: 500 }));
    await expect(
      embedText('ollama', 'x', { model: 'nomic-embed-text' }),
    ).rejects.toThrow(/Ollama embedding error/);
  });

  it('shrinks and retries on a context-length overflow, then succeeds', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: 'the input length exceeds the context length' }), { status: 500 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ embedding: [0.4, 0.5] }), { status: 200 }),
      );
    const longText = 'x'.repeat(5000);
    const vec = await embedText('ollama', longText, { model: 'nomic-embed-text' });
    expect(vec).toEqual([0.4, 0.5]);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    // Second attempt sent a shorter prompt.
    const secondBody = JSON.parse((fetchSpy.mock.calls[1][1] as RequestInit).body as string);
    expect(secondBody.prompt.length).toBeLessThan(5000);
  });
});

describe('embedTextBatch (ollama)', () => {
  it('embeds many texts in a single /api/embed call', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ embeddings: [[0.1, 0.2], [0.3, 0.4]] }), { status: 200 }),
    );
    const out = await embedTextBatch('ollama', ['a', 'b'], { model: 'nomic-embed-text' });
    expect(out).toEqual([[0.1, 0.2], [0.3, 0.4]]);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const url = fetchSpy.mock.calls[0][0] as string;
    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    expect(url).toMatch(/\/api\/embed$/);
    expect(body.input).toEqual(['a', 'b']);
  });

  it('returns [] for an empty input without calling the network', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    expect(await embedTextBatch('ollama', [], { model: 'nomic-embed-text' })).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('falls back to per-item embedding when the batch call fails, so one bad input cannot fail the batch', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      // batch /api/embed fails
      .mockResolvedValueOnce(new Response('boom', { status: 500 }))
      // per-item /api/embeddings: first succeeds, second errors → null
      .mockResolvedValueOnce(new Response(JSON.stringify({ embedding: [1, 1] }), { status: 200 }))
      .mockResolvedValueOnce(new Response('nope', { status: 500 }));
    const out = await embedTextBatch('ollama', ['good', 'bad'], { model: 'nomic-embed-text' });
    expect(out).toEqual([[1, 1], null]);
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });
});
