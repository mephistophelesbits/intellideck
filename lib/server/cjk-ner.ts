import 'server-only';

import { createRequire } from 'node:module';

export interface CjkEntity {
  name: string;
  type: 'person' | 'org' | 'place';
  count: number;
}

const CJK_CHAR = /[一-鿿]/;
// Bound per-article tagging cost: the lead of an article carries the salient actors,
// and jieba tagging is linear in length. Mirrors the LLM extractor's input cap.
const MAX_INPUT_CHARS = 6000;
// nr: Chinese personal name. nrt: translated/foreign name (e.g. 拜登/库克) — essential
// for international news. nt: organization/institution. ns: geo-political place
// (国家/城市) — the connective entity that binds international-news clusters
// (美国/伊朗/英国); without it macro stories share nothing and never cluster.
const PERSON_TAGS = new Set(['nr', 'nrt']);
const ORG_TAGS = new Set(['nt']);
const PLACE_TAGS = new Set(['ns']);
// Filler tokens jieba sometimes tags as proper nouns but which are not actors.
// Extend as noise is observed in real feeds.
const BLACKLIST = new Set<string>(['记者', '本报', '该公司', '有限公司', '报道']);

// Newsroom label prefixes that precede a colon in headlines but are NOT the subject
// company/actor (突发：…, 快讯：…). Used to reject false colon-subjects.
const HEADLINE_LABELS = new Set<string>([
  '突发', '快讯', '独家', '重磅', '注意', '警惕', '提醒', '通知', '公告', '最新',
  '刚刚', '深度', '原创', '专访', '视频', '直击', '关注', '热点', '财经', '快看',
  '盘点', '聚焦', '速览', '解读', '观察', '评论', '社论', '头条', '现场', '预警',
]);

interface Tagger {
  tag(sentence: string, hmm?: boolean): Array<{ word: string; tag: string }>;
}

type Loader = () => Tagger;

const defaultLoader: Loader = () => {
  // createRequire keeps the native module load synchronous (so extractCjkEntities stays
  // sync) and lets us catch a missing/incompatible binary instead of crashing on import.
  const require = createRequire(import.meta.url);
  const { Jieba } = require('@node-rs/jieba') as { Jieba: { withDict(d: Uint8Array): Tagger } };
  const { dict } = require('@node-rs/jieba/dict') as { dict: Uint8Array };
  return Jieba.withDict(dict);
};

let loader: Loader = defaultLoader;
let initialized = false;
let tagger: Tagger | null = null;

function getTagger(): Tagger | null {
  if (initialized) return tagger;
  initialized = true;
  try {
    tagger = loader();
  } catch (err) {
    console.error('[cjk-ner] @node-rs/jieba unavailable; Chinese NER disabled (Latin-only fallback):', err);
    tagger = null;
  }
  return tagger;
}

function majorityCjk(s: string): boolean {
  let cjk = 0;
  let total = 0;
  for (const ch of s) {
    total += 1;
    if (ch >= '一' && ch <= '鿿') cjk += 1;
  }
  return total > 0 && cjk * 2 > total;
}

/**
 * Extract Chinese person (nr/nrt) and organization (nt) names from text via jieba POS
 * tagging. Deterministic, no LLM. Returns [] for text with no CJK characters or when
 * jieba is unavailable. `count` is the number of occurrences of the token in the text.
 */
export function extractCjkEntities(text: string): CjkEntity[] {
  if (!text || !CJK_CHAR.test(text)) return [];
  const t = getTagger();
  if (!t) return [];

  let tagged: Array<{ word: string; tag: string }>;
  try {
    tagged = t.tag(text.length > MAX_INPUT_CHARS ? text.slice(0, MAX_INPUT_CHARS) : text);
  } catch {
    return [];
  }

  const counts = new Map<string, CjkEntity>();
  for (const { word, tag } of tagged) {
    const type: 'person' | 'org' | 'place' | null = PERSON_TAGS.has(tag)
      ? 'person'
      : ORG_TAGS.has(tag)
        ? 'org'
        : PLACE_TAGS.has(tag)
          ? 'place'
          : null;
    if (!type) continue;
    const name = word.trim();
    if (name.length < 2) continue;
    if (!majorityCjk(name)) continue;
    if (BLACKLIST.has(name)) continue;
    const existing = counts.get(name);
    if (existing) existing.count += 1;
    else counts.set(name, { name, type, count: 1 });
  }
  return Array.from(counts.values());
}

/**
 * Extract the subject company/actor from a Chinese filing-style headline of the form
 * `主体：事件…` (e.g. 华联股份：拟回购公司股份). jieba reliably MISSES these compact
 * stock-name subjects (长久物流 → no tag, 通威股份 → 威/威 garbage), yet they are the only
 * thing distinguishing one A-share disclosure from another. Pulling the colon-subject gives
 * each filing a distinct org entity, so genre-identical-but-unrelated filings stop merging
 * into one story. High precision by construction: rejects newsroom labels (突发/快讯) and
 * anything that does not look like a 2–12 char CJK name. Returns null when no plausible
 * subject is present.
 */
export function extractCjkHeadlineOrg(title: string): string | null {
  if (!title) return null;
  const m = title.match(/^\s*([^：:]{1,16})[：:]/);
  if (!m) return null;
  const subject = m[1].trim();
  if (subject.length < 2 || subject.length > 12) return null;
  if (!majorityCjk(subject)) return null;
  if (HEADLINE_LABELS.has(subject) || BLACKLIST.has(subject)) return null;
  // A real subject is a compact noun phrase, not a clause: reject if it contains
  // whitespace or sentence punctuation (those signal the colon is rhetorical, not a label).
  if (/[\s，。！？、；,.!?;]/.test(subject)) return null;
  return subject;
}

/** Test-only: override the jieba loader (e.g. to simulate a load failure) and reset state. */
export function __setCjkLoaderForTest(override: Loader | null): void {
  loader = override ?? defaultLoader;
  initialized = false;
  tagger = null;
}
