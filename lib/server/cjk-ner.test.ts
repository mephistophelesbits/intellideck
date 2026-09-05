import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('server-only', () => ({}));

import { extractCjkEntities, extractCjkHeadlineOrg, __setCjkLoaderForTest } from './cjk-ner';

afterEach(() => __setCjkLoaderForTest(null)); // restore the real jieba loader

describe('extractCjkEntities (real @node-rs/jieba)', () => {
  it('extracts Chinese + foreign person names and organizations', () => {
    const out = extractCjkEntities('美国总统拜登在白宫会见了苹果公司首席执行官库克，新华社报道。');
    const names = out.map((e) => e.name);
    expect(names).toContain('拜登'); // nrt (foreign/translated name)
    expect(names).toContain('库克'); // nrt
    const xinhua = out.find((e) => e.name === '新华社');
    expect(xinhua?.type).toBe('org'); // nt
  });

  it('returns [] for text with no CJK characters (jieba never invoked)', () => {
    expect(extractCjkEntities('The Federal Reserve met with Goldman Sachs.')).toEqual([]);
  });

  it('counts repeated occurrences of the same token', () => {
    const out = extractCjkEntities('库克表示，库克随后离开。');
    expect(out.find((e) => e.name === '库克')?.count).toBe(2);
  });

  it('extracts place names (ns) — the connective tissue of international news', () => {
    const out = extractCjkEntities('美国暂时解除对伊朗石油制裁，直至8月21日');
    const byName = new Map(out.map((e) => [e.name, e.type]));
    expect(byName.get('美国')).toBe('place');
    expect(byName.get('伊朗')).toBe('place');
  });

  describe('extractCjkHeadlineOrg', () => {
    it('extracts the company subject before the colon in A-share filing headlines', () => {
      expect(extractCjkHeadlineOrg('华联股份：拟1亿元—1.5亿元回购公司股份')).toBe('华联股份');
      expect(extractCjkHeadlineOrg('长久物流：拟以5000万元—1亿元回购公司股份')).toBe('长久物流');
    });

    it('handles a halfwidth colon too', () => {
      expect(extractCjkHeadlineOrg('通威股份: 拟增资')).toBe('通威股份');
    });

    it('returns null for label prefixes that are not company names', () => {
      expect(extractCjkHeadlineOrg('突发：某地发生地震')).toBeNull();
      expect(extractCjkHeadlineOrg('快讯：市场大涨')).toBeNull();
    });

    it('returns null when there is no colon or the subject is implausible', () => {
      expect(extractCjkHeadlineOrg('英国首相斯塔默宣布辞职')).toBeNull();
      expect(extractCjkHeadlineOrg('A：B')).toBeNull(); // too short / not CJK
    });
  });

  it('falls back to [] when jieba fails to load', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    __setCjkLoaderForTest(() => {
      throw new Error('binary missing');
    });
    expect(extractCjkEntities('美国总统拜登访问北京')).toEqual([]);
    errSpy.mockRestore();
  });
});
