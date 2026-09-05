import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('server-only', () => ({}));

const generateText = vi.fn();
vi.mock('@/lib/ai/providers', () => ({ generateText: (...args: unknown[]) => generateText(...args) }));

import { extractEntitiesLLM, extractEntitiesDeterministic, type ExtractedEntity } from './entity-extraction';

afterEach(() => vi.resetAllMocks());

const aiOptions = { provider: 'ollama' as const, model: 'qwen2.5:7b' };

describe('extractEntitiesLLM', () => {
  it('parses a valid JSON entity array', async () => {
    generateText.mockResolvedValue({
      text: JSON.stringify({
        entities: [
          { name: 'OpenAI', type: 'org', salience: 0.9, snippet: 'OpenAI announced...' },
          { name: 'Sam Altman', type: 'person', salience: 0.5, snippet: 'Sam Altman said...' },
        ],
      }),
    });
    const result = await extractEntitiesLLM('OpenAI news', 'OpenAI announced...', aiOptions);
    expect(result.map((e: ExtractedEntity) => e.name)).toEqual(['OpenAI', 'Sam Altman']);
    expect(result[0].type).toBe('org');
    expect(result[0].salience).toBeCloseTo(0.9);
  });

  it('strips ```json fences before parsing', async () => {
    generateText.mockResolvedValue({
      text: '```json\n{"entities":[{"name":"NVIDIA","type":"org","salience":1,"snippet":"x"}]}\n```',
    });
    const result = await extractEntitiesLLM('t', 'c', aiOptions);
    expect(result[0].name).toBe('NVIDIA');
  });

  it('accepts a bare JSON array (no entities wrapper)', async () => {
    generateText.mockResolvedValue({
      text: JSON.stringify([
        { name: 'NVIDIA', type: 'org', salience: 0.4, snippet: 'NVIDIA reported earnings' },
        { name: 'Jensen Huang', type: 'person', salience: 0.3, snippet: 'CEO Jensen Huang' },
      ]),
    });
    const result = await extractEntitiesLLM('t', 'c', aiOptions);
    expect(result.map((e: ExtractedEntity) => e.name)).toEqual(['NVIDIA', 'Jensen Huang']);
    expect(result[1].snippet).toBe('CEO Jensen Huang');
  });

  it('falls back to the regex extractor when the model returns junk', async () => {
    generateText.mockResolvedValue({ text: 'not json at all' });
    const result = await extractEntitiesLLM('Apple Inc reports earnings', 'Apple Inc ...', aiOptions);
    // regex fallback finds capitalised multi-word names; must not throw and must return an array
    expect(Array.isArray(result)).toBe(true);
  });

  it('caps the entity count at 16', async () => {
    const many = Array.from({ length: 40 }, (_, i) => ({
      name: `Entity ${i}`, type: 'org', salience: 0.5, snippet: 's',
    }));
    generateText.mockResolvedValue({ text: JSON.stringify({ entities: many }) });
    const result = await extractEntitiesLLM('t', 'c', aiOptions);
    expect(result.length).toBeLessThanOrEqual(16);
  });
});

describe('extractEntitiesDeterministic', () => {
  it('merges Chinese (jieba) and Latin (regex) entities', () => {
    const out = extractEntitiesDeterministic(
      '拜登会见库克',
      'The Federal Reserve and Goldman Sachs commented. 新华社报道。',
    );
    const names = out.map((e: ExtractedEntity) => e.name);
    expect(names).toContain('拜登'); // Chinese, from jieba
    expect(names.some((n) => /Federal Reserve|Goldman/.test(n))).toBe(true); // Latin, from regex
  });

  it('caps merged entities at 16', () => {
    const latin = Array.from({ length: 30 }, (_, i) => `Acme Corp${i}`).join(' reported. ');
    const out = extractEntitiesDeterministic('Markets update', latin);
    expect(out.length).toBeLessThanOrEqual(16);
  });

  it('extracts the filing-headline subject company that jieba misses', () => {
    // jieba tags nothing usable in 长久物流/华联股份; the colon-subject is the only
    // signal that distinguishes one A-share filing from another.
    const a = extractEntitiesDeterministic('长久物流：拟以5000万元—1亿元回购公司股份', '');
    const b = extractEntitiesDeterministic('华联股份：拟1亿元—1.5亿元回购公司股份', '');
    expect(a.find((e) => e.name === '长久物流')?.type).toBe('org');
    expect(b.find((e) => e.name === '华联股份')?.type).toBe('org');
    // and they do NOT share an entity — the whole point
    const overlap = a.map((e) => e.name).filter((n) => b.some((e) => e.name === n));
    expect(overlap).toEqual([]);
  });

  it('extracts place names so international-news clusters have shared connective entities', () => {
    const out = extractEntitiesDeterministic('美国暂时解除对伊朗石油制裁', '');
    const places = out.filter((e) => e.type === 'place').map((e) => e.name);
    expect(places).toContain('美国');
    expect(places).toContain('伊朗');
  });
});
