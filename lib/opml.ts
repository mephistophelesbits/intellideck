/**
 * OPML (Outline Processor Markup Language) Parser
 * Used for importing RSS feed subscriptions from other readers
 */

export interface OPMLOutline {
  text: string;
  title?: string;
  type?: string;
  xmlUrl?: string;
  htmlUrl?: string;
  children?: OPMLOutline[];
}

export interface OPMLFeed {
  title: string;
  url: string;
  category?: string;
}

export interface OPMLParseResult {
  feeds: OPMLFeed[];
  categories: string[];
}

/**
 * Parse OPML XML string into structured feed data with high resilience
 */
export function parseOPML(xmlString: string): OPMLParseResult {
  const feeds: OPMLFeed[] = [];
  const categories = new Set<string>();

  // Helper to extract feeds from an outline element
  const extractFromOutline = (outline: Element) => {
    // Try multiple URL attributes (some readers use different ones)
    const xmlUrl =
      outline.getAttribute('xmlUrl') ||
      outline.getAttribute('xmlurl') ||
      outline.getAttribute('rss') ||
      outline.getAttribute('url') ||
      outline.getAttribute('rssUrl') ||
      outline.getAttribute('rssurl');

    if (xmlUrl) {
      // Try multiple title attributes
      const title =
        outline.getAttribute('title') ||
        outline.getAttribute('text') ||
        outline.getAttribute('name') ||
        'Untitled Feed';

      // Find parent outline for category
      let category: string | undefined;
      let parent = outline.parentElement;
      while (parent) {
        if (parent.tagName.toLowerCase() === 'outline') {
          const parentText = parent.getAttribute('text') || parent.getAttribute('title');
          // If the parent has text but no xmlUrl, it's a category
          if (parentText && !parent.getAttribute('xmlUrl') && !parent.getAttribute('xmlurl')) {
            category = parentText;
            break;
          }
        }
        parent = parent.parentElement;
      }

      feeds.push({ title, url: xmlUrl, category });
      if (category) categories.add(category);
    }
  };

  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlString, 'text/xml');

    // Check for parse error
    if (doc.querySelector('parsererror')) {
      throw new Error('XML Parse Error');
    }

    const outlines = doc.querySelectorAll('outline');
    outlines.forEach(extractFromOutline);
  } catch {
    // Fallback: Regex parsing for semi-malformed XML
    const outlineRegex = /<outline[^>]+>/gi;
    const attrRegex = /(\w+)="([^"]*)"/gi;

    let match;
    while ((match = outlineRegex.exec(xmlString)) !== null) {
      const tag = match[0];
      const attrs: Record<string, string> = {};
      let attrMatch;
      while ((attrMatch = attrRegex.exec(tag)) !== null) {
        attrs[attrMatch[1].toLowerCase()] = attrMatch[2];
      }

      const xmlUrl = attrs.xmlurl || attrs.rss || attrs.url || attrs.rssurl;
      if (xmlUrl) {
        feeds.push({
          title: attrs.title || attrs.text || attrs.name || 'Untitled Feed',
          url: xmlUrl,
        });
      }
    }
  }

  return {
    feeds,
    categories: Array.from(categories),
  };
}

/**
 * Validate if a string is valid OPML XML (now more permissive)
 */
export function isValidOPML(xmlString: string): boolean {
  if (!xmlString || typeof xmlString !== 'string') return false;

  // Basic check for OPML tags
  const hasOpmlTag = /<opml/i.test(xmlString);
  const hasOutlineTag = /<outline/i.test(xmlString);

  // Even if it's slightly malformed, if it has outlines with URLs, we accept it
  if (hasOpmlTag || hasOutlineTag) {
    const hasUrlAttr = /xmlUrl|rss|url|rssUrl/i.test(xmlString);
    return hasUrlAttr;
  }

  return false;
}

function escapeXmlAttribute(value: string) {
  return value.replace(/[<>&'"]/g, (char) => {
    switch (char) {
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '&':
        return '&amp;';
      case '\'':
        return '&apos;';
      case '"':
        return '&quot;';
      default:
        return char;
    }
  });
}

/**
 * Generate OPML XML from feeds
 */
export function generateOPML(feeds: OPMLFeed[], title: string = 'IntelliDeck Exports'): string {
  const categories = new Map<string, OPMLFeed[]>();

  // Group feeds by category
  feeds.forEach((feed) => {
    const cat = feed.category || 'Uncategorized';
    if (!categories.has(cat)) {
      categories.set(cat, []);
    }
    categories.get(cat)!.push(feed);
  });

  let xml = `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
  <head>
    <title>${escapeXmlAttribute(title)}</title>
    <dateCreated>${new Date().toISOString()}</dateCreated>
  </head>
  <body>`;

  categories.forEach((categoryFeeds, category) => {
    const escapedCategory = escapeXmlAttribute(category);
    if (category !== 'Uncategorized') {
      xml += `\n    <outline text="${escapedCategory}" title="${escapedCategory}">`;
    }

    categoryFeeds.forEach((feed) => {
      const escapedTitle = escapeXmlAttribute(feed.title);
      const escapedUrl = escapeXmlAttribute(feed.url);
      xml += `\n      <outline text="${escapedTitle}" title="${escapedTitle}" type="rss" xmlUrl="${escapedUrl}" htmlUrl=""/>`;
    });

    if (category !== 'Uncategorized') {
      xml += '\n    </outline>';
    }
  });

  xml += '\n  </body>\n</opml>';

  return xml;
}
