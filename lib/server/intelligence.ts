import 'server-only';

type CategoryRule = {
  category: string;
  patterns: RegExp[];
};

type ThemeRule = {
  name: string;
  categoryHint?: string;
  patterns: RegExp[];
};

type LocationSeed = {
  name: string;
  normalizedName: string;
  countryCode: string;
  lat: number;
  lng: number;
  locationType: 'country' | 'city';
  aliases?: string[];
};

const CATEGORY_RULES: CategoryRule[] = [
  { category: 'AI', patterns: [/\bai\b/i, /artificial intelligence/i, /\bllm\b/i, /openai/i, /anthropic/i, /gemini/i] },
  { category: 'Technology', patterns: [/software/i, /hardware/i, /semiconductor/i, /chip/i, /startup/i, /developer/i, /hacker news/i] },
  { category: 'Markets', patterns: [/stock/i, /market/i, /nasdaq/i, /dow/i, /s&p/i, /bond/i, /yield/i, /crypto/i, /bitcoin/i] },
  { category: 'Business', patterns: [/company/i, /earnings/i, /merger/i, /acquisition/i, /revenue/i, /profit/i] },
  { category: 'Politics', patterns: [/election/i, /president/i, /congress/i, /senate/i, /minister/i, /government/i, /policy/i] },
  { category: 'World', patterns: [/war/i, /diplomat/i, /border/i, /sanction/i, /nato/i, /united nations/i, /conflict/i] },
  { category: 'Science', patterns: [/research/i, /scientist/i, /space/i, /nasa/i, /physics/i, /biology/i] },
  { category: 'Health', patterns: [/health/i, /medical/i, /disease/i, /hospital/i, /vaccine/i, /drug/i] },
  { category: 'Energy', patterns: [/oil/i, /gas/i, /solar/i, /renewable/i, /power grid/i, /nuclear/i] },
  { category: 'Climate', patterns: [/climate/i, /emissions/i, /wildfire/i, /hurricane/i, /flood/i, /carbon/i] },
  { category: 'China', patterns: [/\bchina\b/i, /beijing/i, /shanghai/i, /taiwan/i] },
  { category: 'Southeast Asia', patterns: [/malaysia/i, /singapore/i, /indonesia/i, /thailand/i, /vietnam/i, /philippines/i] },
];

const THEME_RULES: ThemeRule[] = [
  { name: 'Semiconductors', categoryHint: 'Technology', patterns: [/semiconductor/i, /\bchip(s|maker|makers)?\b/i, /tsmc/i, /nvidia/i, /advanced micro devices/i, /\bamd\b/i] },
  { name: 'AI Models', categoryHint: 'AI', patterns: [/\bllm\b/i, /foundation model/i, /chatgpt/i, /gpt-4/i, /claude/i, /gemini/i, /model release/i] },
  { name: 'AI Regulation', categoryHint: 'AI', patterns: [/ai safety/i, /ai act/i, /model regulation/i, /deepfake/i, /ai policy/i] },
  { name: 'Cybersecurity', categoryHint: 'Technology', patterns: [/cyber/i, /ransomware/i, /breach/i, /malware/i, /zero-day/i, /phishing/i] },
  { name: 'Cloud Infrastructure', categoryHint: 'Technology', patterns: [/cloud/i, /data center/i, /\bgpu cluster\b/i, /server farm/i] },
  { name: 'Trade Policy', categoryHint: 'World', patterns: [/tariff/i, /export control/i, /trade war/i, /trade deal/i, /import restriction/i] },
  { name: 'Monetary Policy', categoryHint: 'Markets', patterns: [/federal reserve/i, /\bfed\b/i, /interest rate/i, /rate cut/i, /rate hike/i, /central bank/i] },
  { name: 'Market Volatility', categoryHint: 'Markets', patterns: [/sell-off/i, /rally/i, /all-time high/i, /correction/i, /volatility/i] },
  { name: 'Energy Transition', categoryHint: 'Energy', patterns: [/renewable/i, /battery storage/i, /energy transition/i, /grid modernization/i, /clean energy/i] },
  { name: 'Oil and Gas', categoryHint: 'Energy', patterns: [/\boil\b/i, /\bgas\b/i, /opec/i, /lng/i, /crude/i] },
  { name: 'Electric Vehicles', categoryHint: 'Technology', patterns: [/\bev\b/i, /electric vehicle/i, /tesla/i, /battery plant/i] },
  { name: 'Geopolitical Conflict', categoryHint: 'World', patterns: [/military/i, /airstrike/i, /missile/i, /troops/i, /ceasefire/i, /sanction/i] },
  { name: 'Elections', categoryHint: 'Politics', patterns: [/election/i, /ballot/i, /campaign/i, /polling/i, /primary/i] },
  { name: 'Industrial Policy', categoryHint: 'Business', patterns: [/subsidy/i, /industrial policy/i, /factory investment/i, /incentive package/i] },
  { name: 'Open Source', categoryHint: 'Technology', patterns: [/open source/i, /github/i, /linux/i, /apache/i] },
  { name: 'Space Launch', categoryHint: 'Science', patterns: [/rocket/i, /satellite/i, /launch/i, /spacex/i, /orbital/i] },
  { name: 'Biotech', categoryHint: 'Health', patterns: [/biotech/i, /clinical trial/i, /gene therapy/i, /biopharma/i] },
  { name: 'Public Health', categoryHint: 'Health', patterns: [/outbreak/i, /public health/i, /epidemic/i, /vaccine/i, /hospital system/i] },
  { name: 'Climate Risk', categoryHint: 'Climate', patterns: [/wildfire/i, /flood/i, /heatwave/i, /storm surge/i, /extreme weather/i] },
  { name: 'China Policy', categoryHint: 'China', patterns: [/\bchina\b/i, /beijing/i, /pla\b/i, /taiwan strait/i] },
];

const LOCATION_SEEDS: LocationSeed[] = [
  { name: 'United States', normalizedName: 'united states', countryCode: 'US', lat: 37.0902, lng: -95.7129, locationType: 'country', aliases: ['usa', 'u.s.', 'u.s.a.', 'america'] },
  { name: 'China', normalizedName: 'china', countryCode: 'CN', lat: 35.8617, lng: 104.1954, locationType: 'country' },
  { name: 'United Kingdom', normalizedName: 'united kingdom', countryCode: 'GB', lat: 55.3781, lng: -3.436, locationType: 'country', aliases: ['uk', 'britain', 'england'] },
  { name: 'Malaysia', normalizedName: 'malaysia', countryCode: 'MY', lat: 4.2105, lng: 101.9758, locationType: 'country' },
  { name: 'Singapore', normalizedName: 'singapore', countryCode: 'SG', lat: 1.3521, lng: 103.8198, locationType: 'country' },
  { name: 'Indonesia', normalizedName: 'indonesia', countryCode: 'ID', lat: -0.7893, lng: 113.9213, locationType: 'country' },
  { name: 'Thailand', normalizedName: 'thailand', countryCode: 'TH', lat: 15.87, lng: 100.9925, locationType: 'country' },
  { name: 'Vietnam', normalizedName: 'vietnam', countryCode: 'VN', lat: 14.0583, lng: 108.2772, locationType: 'country' },
  { name: 'Philippines', normalizedName: 'philippines', countryCode: 'PH', lat: 12.8797, lng: 121.774, locationType: 'country' },
  { name: 'Japan', normalizedName: 'japan', countryCode: 'JP', lat: 36.2048, lng: 138.2529, locationType: 'country' },
  { name: 'South Korea', normalizedName: 'south korea', countryCode: 'KR', lat: 35.9078, lng: 127.7669, locationType: 'country', aliases: ['korea'] },
  { name: 'India', normalizedName: 'india', countryCode: 'IN', lat: 20.5937, lng: 78.9629, locationType: 'country' },
  { name: 'Russia', normalizedName: 'russia', countryCode: 'RU', lat: 61.524, lng: 105.3188, locationType: 'country' },
  { name: 'Ukraine', normalizedName: 'ukraine', countryCode: 'UA', lat: 48.3794, lng: 31.1656, locationType: 'country' },
  { name: 'Israel', normalizedName: 'israel', countryCode: 'IL', lat: 31.0461, lng: 34.8516, locationType: 'country' },
  { name: 'Gaza', normalizedName: 'gaza', countryCode: 'PS', lat: 31.3547, lng: 34.3088, locationType: 'city' },
  { name: 'Taiwan', normalizedName: 'taiwan', countryCode: 'TW', lat: 23.6978, lng: 120.9605, locationType: 'country' },
  { name: 'Germany', normalizedName: 'germany', countryCode: 'DE', lat: 51.1657, lng: 10.4515, locationType: 'country' },
  { name: 'France', normalizedName: 'france', countryCode: 'FR', lat: 46.2276, lng: 2.2137, locationType: 'country' },
  { name: 'London', normalizedName: 'london', countryCode: 'GB', lat: 51.5072, lng: -0.1276, locationType: 'city' },
  { name: 'New York', normalizedName: 'new york', countryCode: 'US', lat: 40.7128, lng: -74.006, locationType: 'city' },
  { name: 'Washington', normalizedName: 'washington', countryCode: 'US', lat: 38.9072, lng: -77.0369, locationType: 'city', aliases: ['washington dc'] },
  { name: 'San Francisco', normalizedName: 'san francisco', countryCode: 'US', lat: 37.7749, lng: -122.4194, locationType: 'city' },
  { name: 'Los Angeles', normalizedName: 'los angeles', countryCode: 'US', lat: 34.0522, lng: -118.2437, locationType: 'city' },
  { name: 'Beijing', normalizedName: 'beijing', countryCode: 'CN', lat: 39.9042, lng: 116.4074, locationType: 'city' },
  { name: 'Shanghai', normalizedName: 'shanghai', countryCode: 'CN', lat: 31.2304, lng: 121.4737, locationType: 'city' },
  { name: 'Shenzhen', normalizedName: 'shenzhen', countryCode: 'CN', lat: 22.5431, lng: 114.0579, locationType: 'city' },
  { name: 'Hong Kong', normalizedName: 'hong kong', countryCode: 'HK', lat: 22.3193, lng: 114.1694, locationType: 'city' },
  { name: 'Taipei', normalizedName: 'taipei', countryCode: 'TW', lat: 25.033, lng: 121.5654, locationType: 'city' },
  { name: 'Tokyo', normalizedName: 'tokyo', countryCode: 'JP', lat: 35.6762, lng: 139.6503, locationType: 'city' },
  { name: 'Seoul', normalizedName: 'seoul', countryCode: 'KR', lat: 37.5665, lng: 126.978, locationType: 'city' },
  { name: 'Singapore City', normalizedName: 'singapore city', countryCode: 'SG', lat: 1.2903, lng: 103.8519, locationType: 'city', aliases: ['singapore'] },
  { name: 'Kuala Lumpur', normalizedName: 'kuala lumpur', countryCode: 'MY', lat: 3.139, lng: 101.6869, locationType: 'city', aliases: ['kl'] },
  { name: 'Jakarta', normalizedName: 'jakarta', countryCode: 'ID', lat: -6.2088, lng: 106.8456, locationType: 'city' },
  { name: 'Bangkok', normalizedName: 'bangkok', countryCode: 'TH', lat: 13.7563, lng: 100.5018, locationType: 'city' },
  { name: 'Hanoi', normalizedName: 'hanoi', countryCode: 'VN', lat: 21.0278, lng: 105.8342, locationType: 'city' },
  { name: 'Manila', normalizedName: 'manila', countryCode: 'PH', lat: 14.5995, lng: 120.9842, locationType: 'city' },
];

const ENTITY_BLACKLIST = new Set([
  'The', 'A', 'An', 'And', 'But', 'For', 'With', 'From', 'Into', 'Over', 'After', 'Before',
  'Why', 'How', 'What', 'When', 'Where', 'Breaking', 'Live', 'Update', 'Updates', 'News',
  'Opinion', 'Analysis', 'Exclusive', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday',
  'Saturday', 'Sunday', 'January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December', 'Reuters', 'Bloomberg', 'AP',
]);

const ENTITY_CONNECTORS = ['of', 'for', 'and', 'the', 'to'];
const ENTITY_ALIAS_MAP = new Map<string, string>([
  ['u.s.', 'United States'],
  ['u.s', 'United States'],
  ['us', 'United States'],
  ['usa', 'United States'],
  ['u.s.a.', 'United States'],
  ['fed', 'Federal Reserve'],
  ['federal reserve bank', 'Federal Reserve'],
  ['ecb', 'European Central Bank'],
  ['boj', 'Bank of Japan'],
  ['pboc', "People's Bank of China"],
  ['sec', 'SEC'],
  ['fcc', 'FCC'],
  ['ftc', 'FTC'],
  ['open ai', 'OpenAI'],
  ['chat gpt', 'ChatGPT'],
  ['tsmc', 'TSMC'],
  ['amd', 'AMD'],
  ['ap', 'Associated Press'],
  ['uk', 'United Kingdom'],
  ['eu', 'European Union'],
]);
const LOCATION_ALIAS_MAP = new Map<string, string>([
  ['u.s.', 'united states'],
  ['u.s', 'united states'],
  ['us', 'united states'],
  ['usa', 'united states'],
  ['uk', 'united kingdom'],
  ['britain', 'united kingdom'],
  ['england', 'united kingdom'],
  ['washington dc', 'washington'],
  ['dc', 'washington'],
  ['nyc', 'new york'],
  ['sf', 'san francisco'],
  ['kl', 'kuala lumpur'],
]);

function normalizeText(text: string) {
  return text
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenize(text: string) {
  return normalizeText(text).toLowerCase();
}

function escapeForRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function countPatternMatches(text: string, pattern: RegExp) {
  const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`;
  const regex = new RegExp(pattern.source, flags);
  return text.match(regex)?.length ?? 0;
}

export function classifyCategory(title: string, content: string) {
  const haystack = `${title}\n${content}`;
  for (const rule of CATEGORY_RULES) {
    if (rule.patterns.some((pattern) => pattern.test(haystack))) {
      return rule.category;
    }
  }
  return 'General';
}

export function extractThemes(title: string, content: string, category?: string) {
  const titleText = normalizeText(title);
  const contentText = normalizeText(content);
  const scoredThemes = new Map<string, { name: string; normalizedName: string; categoryHint: string | null; score: number }>();

  for (const rule of THEME_RULES) {
    const titleMatches = rule.patterns.reduce((sum, pattern) => sum + countPatternMatches(titleText, pattern), 0);
    const contentMatches = rule.patterns.reduce((sum, pattern) => sum + countPatternMatches(contentText, pattern), 0);
    let score = titleMatches * 3 + contentMatches;
    if (category && rule.categoryHint === category) {
      score += 1.5;
    }
    if (score <= 0) continue;

    scoredThemes.set(rule.name, {
      name: rule.name,
      normalizedName: rule.name.toLowerCase(),
      categoryHint: rule.categoryHint || null,
      score: Number(score.toFixed(2)),
    });
  }

  if (category && category !== 'General') {
    scoredThemes.set(category, {
      name: category,
      normalizedName: category.toLowerCase(),
      categoryHint: category,
      score: Math.max(scoredThemes.get(category)?.score ?? 0, 1),
    });
  }

  return Array.from(scoredThemes.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);
}

export function extractLocations(title: string, content: string) {
  const haystack = tokenize(`${title}\n${content}`);
  const matches = new Map<string, LocationSeed & { mentionCount: number }>();

  for (const location of LOCATION_SEEDS) {
    const aliases = [location.normalizedName, ...(location.aliases ?? [])];
    const mentionCount = aliases.reduce((count, alias) => {
      const regex = new RegExp(`\\b${escapeForRegex(alias.toLowerCase())}\\b`, 'g');
      const found = haystack.match(regex);
      return count + (found?.length ?? 0);
    }, 0);

    if (mentionCount > 0) {
      matches.set(location.normalizedName, {
        ...location,
        mentionCount,
      });
    }
  }

  for (const [alias, normalizedName] of LOCATION_ALIAS_MAP.entries()) {
    const regex = new RegExp(`\\b${escapeForRegex(alias.toLowerCase())}\\b`, 'g');
    const mentionCount = haystack.match(regex)?.length ?? 0;
    if (mentionCount === 0) continue;
    const canonicalLocation = LOCATION_SEEDS.find((location) => location.normalizedName === normalizedName);
    if (!canonicalLocation) continue;
    const existing = matches.get(normalizedName);
    matches.set(normalizedName, {
      ...canonicalLocation,
      mentionCount: (existing?.mentionCount ?? 0) + mentionCount,
    });
  }

  return Array.from(matches.values());
}

export function extractEntities(title: string, content: string) {
  const text = normalizeText(`${title}. ${content}`);
  const counts = new Map<string, { name: string; count: number }>();
  const patterns = [
    /\b(?:[A-Z][a-z]+|[A-Z]{2,})(?:\s+(?:of|for|and|the|to)\s+|\s+)(?:[A-Z][a-zA-Z.&-]+|[A-Z]{2,})(?:\s+(?:[A-Z][a-zA-Z.&-]+|[A-Z]{2,})){0,2}\b/g,
    /\b[A-Z]{2,}(?:\s+[A-Z]{2,}){0,2}\b/g,
    /\b[A-Z][a-z]+(?:\s+[A-Z][a-zA-Z.&-]+){1,3}\b/g,
  ];

  for (const pattern of patterns) {
    const matches = text.match(pattern) ?? [];
    for (const rawMatch of matches) {
      const entity = normalizeEntityName(rawMatch);
      if (!entity) continue;
      counts.set(entity.normalizedName, {
        name: entity.name,
        count: (counts.get(entity.normalizedName)?.count ?? 0) + 1,
      });
    }
  }

  return Array.from(counts.entries())
    .map(([normalizedName, value]) => ({
      name: value.name,
      normalizedName,
      mentionCount: value.count,
      entityType: inferEntityType(value.name),
    }))
    .sort((a, b) => b.mentionCount - a.mentionCount)
    .slice(0, 16);
}

function normalizeEntityName(raw: string) {
  const compact = raw
    .replace(/^[^A-Z]+/, '')
    .replace(/[^A-Za-z0-9.&'\-\s]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (compact.length < 3) return null;
  if (ENTITY_BLACKLIST.has(compact)) return null;
  if (/^\d+$/.test(compact)) return null;

  const words = compact.split(' ');
  if (words.length === 1 && /^[A-Z][a-z]+$/.test(words[0])) {
    if (ENTITY_BLACKLIST.has(words[0])) return null;
    return { name: words[0], normalizedName: words[0].toLowerCase() };
  }

  const cleanedWords = words.filter((word, index) => {
    if (!word) return false;
    if (ENTITY_CONNECTORS.includes(word.toLowerCase())) return index > 0 && index < words.length - 1;
    if (/^[A-Z]{2,}$/.test(word)) return true;
    if (/^[A-Z][a-zA-Z.&'-]+$/.test(word)) return true;
    return false;
  });

  if (cleanedWords.length === 0) return null;

  const name = cleanedWords.join(' ');
  if (ENTITY_BLACKLIST.has(name)) return null;
  if (name.split(' ').every((part) => ENTITY_CONNECTORS.includes(part.toLowerCase()))) return null;

  const aliasKey = name.toLowerCase();
  const canonicalName = ENTITY_ALIAS_MAP.get(aliasKey) ?? name;

  return {
    name: canonicalName,
    normalizedName: canonicalName.toLowerCase(),
  };
}

function inferEntityType(name: string) {
  if (/\b(Inc|Corp|Corporation|Ltd|LLC|Group|Technologies|Systems|Bank|University|Committee|Ministry|Agency|Administration)\b/.test(name)) {
    return 'organization';
  }
  if (/^[A-Z]{2,}(?:\s+[A-Z]{2,})*$/.test(name)) {
    return 'organization';
  }
  if (name.split(' ').length >= 2) {
    return 'person';
  }
  return 'topic';
}
