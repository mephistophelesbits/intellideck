import 'server-only';

import type { AIProvider } from '@/lib/ai/providers';
import { runLLM } from './llm';
import { extractEntities as extractEntitiesRegex } from './intelligence';
import { extractCjkEntities, extractCjkHeadlineOrg } from './cjk-ner';

export type EntityType = 'org' | 'person' | 'tech' | 'place' | 'product';

export interface ExtractedEntity {
  name: string;
  type: EntityType;
  salience: number; // 0..1, how central to this article
  snippet: string;
}

export interface ExtractAIOptions {
  provider: AIProvider;
  model: string;
  apiKey?: string;
  baseUrl?: string;
}

const VALID_TYPES: ReadonlySet<string> = new Set(['org', 'person', 'tech', 'place', 'product']);
const MAX_ENTITIES = 16;
const MAX_INPUT_CHARS = 6000;

function buildPrompt(title: string, content: string): string {
  const body = `${title}\n\n${content}`.slice(0, MAX_INPUT_CHARS);
  return [
    'Extract the named entities from the news article below.',
    'Return ONLY minified JSON, no prose, no markdown fences.',
    'Schema: {"entities":[{"name":string,"type":"org"|"person"|"tech"|"place"|"product","salience":number,"snippet":string}]}',
    '- name: the canonical name (no titles/honorifics).',
    '- salience: 0..1, how central the entity is to THIS article.',
    '- snippet: the single sentence where it most centrally appears.',
    `- Return at most ${MAX_ENTITIES} entities, most salient first.`,
    '',
    'ARTICLE:',
    body,
  ].join('\n');
}

function stripFences(text: string): string {
  return text
    .replace(/^\s*```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();
}

function coerceEntities(raw: unknown): ExtractedEntity[] | null {
  if (!raw || typeof raw !== 'object') return null;
  // Accept both shapes: a bare array (many models emit this) or { entities: [...] }.
  const list = Array.isArray(raw) ? raw : (raw as { entities?: unknown }).entities;
  if (!Array.isArray(list)) return null;
  const out: ExtractedEntity[] = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const obj = item as Record<string, unknown>;
    const name = typeof obj.name === 'string' ? obj.name.trim() : '';
    const type = typeof obj.type === 'string' ? obj.type.toLowerCase() : '';
    if (!name || !VALID_TYPES.has(type)) continue;
    const salience = typeof obj.salience === 'number' ? Math.max(0, Math.min(1, obj.salience)) : 0.5;
    const snippet = typeof obj.snippet === 'string' ? obj.snippet.trim().slice(0, 500) : '';
    out.push({ name, type: type as EntityType, salience, snippet });
    if (out.length >= MAX_ENTITIES) break;
  }
  return out;
}

export function extractEntitiesDeterministic(title: string, content: string): ExtractedEntity[] {
  const typeMap: Record<string, EntityType> = {
    organization: 'org',
    person: 'person',
    topic: 'tech',
  };

  // Merge Latin (capitalization regex) and Chinese (jieba nr/nrt/nt) entities by a
  // lowercased-trimmed name key. Latin wins on the rare CN/EN collision — it carries
  // the fuller type set. Sort by occurrence frequency, then cap.
  const merged = new Map<string, { name: string; type: EntityType; count: number }>();

  for (const e of extractCjkEntities(`${title}\n${content}`)) {
    merged.set(e.name.toLowerCase().trim(), { name: e.name, type: e.type, count: e.count });
  }

  // Filing-headline subject company (华联股份：…) — jieba misses these compact stock
  // names, but they are the one entity that distinguishes otherwise genre-identical
  // disclosures. Seed it with a high count so it ranks as the article's salient actor.
  const headlineOrg = extractCjkHeadlineOrg(title);
  if (headlineOrg) {
    merged.set(headlineOrg.toLowerCase().trim(), { name: headlineOrg, type: 'org', count: 5 });
  }
  for (const e of extractEntitiesRegex(title, content)) {
    merged.set(e.name.toLowerCase().trim(), {
      name: e.name,
      type: typeMap[e.entityType] ?? 'org',
      count: e.mentionCount,
    });
  }

  return Array.from(merged.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, MAX_ENTITIES)
    .map((e) => ({
      name: e.name,
      type: e.type,
      salience: Math.min(1, e.count / 5),
      snippet: '',
    }));
}

export async function extractEntitiesLLM(
  title: string,
  content: string,
  ai: ExtractAIOptions,
): Promise<ExtractedEntity[]> {
  const prompt = buildPrompt(title, content);
  let text: string;
  try {
    // Entity JSON output is large relative to the prompt; budget context for it so the
    // response is not truncated mid-JSON.
    text = await runLLM(ai, prompt, { temperature: 0, outputBudget: 2048, maxTokens: 2048 });
  } catch {
    return extractEntitiesDeterministic(title, content);
  }

  let parsed: ExtractedEntity[] | null = null;
  try {
    parsed = coerceEntities(JSON.parse(stripFences(text)));
  } catch {
    parsed = null;
  }

  if (parsed && parsed.length > 0) return parsed;
  return extractEntitiesDeterministic(title, content);
}
