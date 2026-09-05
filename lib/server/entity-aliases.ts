import 'server-only';

import { getDb } from './db';
import type { EntityType } from './entity-extraction';

interface AliasGroup {
  canonical: string;
  type: EntityType; // 'person' | 'org' only for this curated set
  aliases: string[];
}

// Curated, bilingual (EN + 简体中文). People and organizations only — countries are
// handled by the location path. Extend as the feeds warrant.
export const ENTITY_ALIASES: AliasGroup[] = [
  { canonical: 'Federal Reserve', type: 'org', aliases: ['fed', 'the fed', 'us federal reserve', '美联储', '联准会'] },
  { canonical: 'White House', type: 'org', aliases: ['the white house', '白宫'] },
  { canonical: 'United Nations', type: 'org', aliases: ['un', 'u.n.', '联合国'] },
  { canonical: 'NATO', type: 'org', aliases: ['north atlantic treaty organization', '北约'] },
  { canonical: 'European Union', type: 'org', aliases: ['eu', 'e.u.', '欧盟'] },
  { canonical: 'Apple', type: 'org', aliases: ['apple inc', 'apple inc.', '苹果', '苹果公司'] },
  { canonical: 'Nvidia', type: 'org', aliases: ['nvidia corp', '英伟达'] },
  { canonical: 'TSMC', type: 'org', aliases: ['taiwan semiconductor', '台积电'] },
  { canonical: 'Joe Biden', type: 'person', aliases: ['biden', 'president biden', '拜登', '乔·拜登'] },
  { canonical: 'Donald Trump', type: 'person', aliases: ['trump', 'president trump', '特朗普', '川普'] },
  { canonical: 'Xi Jinping', type: 'person', aliases: ['xi', 'president xi', '习近平', '习'] },
  { canonical: 'Vladimir Putin', type: 'person', aliases: ['putin', '普京'] },
];

function normalize(name: string): string {
  return name.toLowerCase().replace(/\s+/g, ' ').trim();
}

// entity_type column value for the curated types (avoids importing mapType, which would
// create a cycle with entities-repository).
function typeColumn(type: EntityType): string {
  return type === 'person' ? 'person' : 'organization';
}

// normalizedAlias -> canonical group, built once. Includes the canonical name itself.
const REVERSE = new Map<string, AliasGroup>();
for (const group of ENTITY_ALIASES) {
  for (const key of [group.canonical, ...group.aliases]) {
    REVERSE.set(normalize(key), group);
  }
}

/**
 * Map an entity name+type to its canonical form if known, else return unchanged.
 * Also corrects the type from the alias map (e.g. White House -> org).
 */
export function canonicalizeEntity(name: string, type: EntityType): { name: string; type: EntityType } {
  const group = REVERSE.get(normalize(name));
  if (!group) return { name, type };
  return { name: group.canonical, type: group.type };
}

/**
 * One-time, idempotent backfill: merge existing entity rows that match a curated alias
 * group onto a single canonical row, repointing article_entities and deleting the
 * duplicate rows. Scoped to the curated set, so re-running is cheap and finds nothing
 * once converged. Returns the number of duplicate rows merged.
 */
export function mergeAliasedEntities(): number {
  const db = getDb();
  let merged = 0;

  for (const group of ENTITY_ALIASES) {
    const canonNorm = normalize(group.canonical);
    const names = [group.canonical, ...group.aliases].map(normalize);
    const placeholders = names.map(() => '?').join(',');
    const rows = db
      .prepare(`SELECT id, normalized_name AS norm, mention_count AS mc FROM entities WHERE normalized_name IN (${placeholders})`)
      .all(...names) as Array<{ id: string; norm: string; mc: number }>;
    if (rows.length <= 1) continue;

    // survivor: the canonical-named row if present, else the highest mention_count row
    const survivor =
      rows.find((r) => r.norm === canonNorm) ??
      rows.reduce((a, b) => (b.mc > a.mc ? b : a));

    try {
      db.exec('BEGIN');
      db.prepare('UPDATE entities SET name = ?, normalized_name = ?, entity_type = ? WHERE id = ?')
        .run(group.canonical, canonNorm, typeColumn(group.type), survivor.id);
      for (const dup of rows) {
        if (dup.id === survivor.id) continue;
        db.prepare('UPDATE OR IGNORE article_entities SET entity_id = ? WHERE entity_id = ?').run(survivor.id, dup.id);
        db.prepare('DELETE FROM article_entities WHERE entity_id = ?').run(dup.id);
        db.prepare('DELETE FROM entities WHERE id = ?').run(dup.id);
        merged += 1;
      }
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      console.error(`[entity-aliases] merge failed for ${group.canonical}:`, err);
    }
  }
  return merged;
}
