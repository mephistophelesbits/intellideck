import { describe, expect, it } from 'vitest';
import { generateOPML } from './opml';

describe('generateOPML', () => {
  it('escapes XML attribute values', () => {
    const opml = generateOPML(
      [
        {
          title: 'A&B "News"',
          url: 'https://example.com/feed?x=1&y="2"',
          category: "Tech's <Best>",
        },
      ],
      'IntelliDeck & Friends'
    );

    expect(opml).toContain('IntelliDeck &amp; Friends');
    expect(opml).toContain('Tech&apos;s &lt;Best&gt;');
    expect(opml).toContain('A&amp;B &quot;News&quot;');
    expect(opml).toContain('https://example.com/feed?x=1&amp;y=&quot;2&quot;');
  });
});
