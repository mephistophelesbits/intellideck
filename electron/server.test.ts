import { describe, it, expect, vi, beforeEach } from 'vitest';
import { waitForServer, buildServerUrl } from './server';

describe('buildServerUrl', () => {
  it('builds http url with given port', () => {
    expect(buildServerUrl(3001)).toBe('http://127.0.0.1:3001');
  });

  it('defaults to port 3001', () => {
    expect(buildServerUrl()).toBe('http://127.0.0.1:3001');
  });

  it('allows overriding host', () => {
    expect(buildServerUrl(3001, 'localhost')).toBe('http://localhost:3001');
  });
});

describe('waitForServer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('resolves when fetch succeeds', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true });
    await expect(waitForServer('http://localhost:3001', 100, 3)).resolves.toBeUndefined();
  });

  it('retries on failure then resolves', async () => {
    global.fetch = vi.fn()
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))
      .mockResolvedValue({ ok: true });
    await expect(waitForServer('http://localhost:3001', 10, 3)).resolves.toBeUndefined();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('throws after max retries', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(waitForServer('http://localhost:3001', 10, 3)).rejects.toThrow('Server did not start');
  });
});
