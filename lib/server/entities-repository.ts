import 'server-only';

import { nanoid } from 'nanoid';
import { getDb } from './db';
import { runLLM } from './llm';
import { getServerAISettings } from './settings-repository';
import type { ExtractedEntity, EntityType } from './entity-extraction';
import { canonicalizeEntity } from './entity-aliases';

export interface EntityRow {
  id: string;
  name: string;
  normalizedName: string;
  entityType: string;
  summary: string | null;
  salience: number;
  mentionCount: number;
  firstSeen: string | null;
  lastSeen: string | null;
}

function normalize(name: string): string {
  return name.toLowerCase().replace(/\s+/g, ' ').trim();
}

// Map the extractor's 2.0 type vocabulary onto the existing entity_type column.
function mapType(type: EntityType): string {
  switch (type) {
    case 'person': return 'person';
    case 'place': return 'location';
    case 'tech':
    case 'product': return 'topic';
    case 'org':
    default: return 'organization';
  }
}

export function upsertEntitiesForArticle(
  articleId: string,
  occurredAt: string,
  entities: ExtractedEntity[],
): void {
  const db = getDb();

  const selectByName = db.prepare('SELECT id FROM entities WHERE normalized_name = ?');
  const insertEntity = db.prepare(`
    INSERT INTO entities (
      id, name, normalized_name, entity_type, created_at, updated_at,
      salience, mention_count, first_seen, last_seen, summary_dirty_count
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, 1)
  `);
  const selectSalience = db.prepare('SELECT salience FROM entities WHERE id = ?');
  const bumpEntity = db.prepare(`
    UPDATE entities
    SET mention_count = mention_count + 1,
        last_seen = ?,
        updated_at = ?,
        salience = ?,
        summary_dirty_count = summary_dirty_count + 1
    WHERE id = ?
  `);
  const touchEntity = db.prepare(`
    UPDATE entities
    SET last_seen = ?,
        updated_at = ?,
        salience = ?
    WHERE id = ?
  `);
  const decrementEntity = db.prepare(`
    UPDATE entities
    SET mention_count = mention_count - 1,
        updated_at = ?
    WHERE id = ? AND mention_count > 0
  `);
  const deleteOrphanedEntities = db.prepare(`
    DELETE FROM entities
    WHERE id = ?
      AND mention_count <= 0
      AND NOT EXISTS (SELECT 1 FROM article_entities WHERE entity_id = ?)
  `);
  const deleteLinks = db.prepare('DELETE FROM article_entities WHERE article_id = ?');
  const selectExistingLinks = db.prepare('SELECT entity_id AS entityId FROM article_entities WHERE article_id = ?');
  const insertLink = db.prepare(`
    INSERT INTO article_entities (
      article_id, entity_id, mention_count, weight, salience, sentiment, snippet
    ) VALUES (?, ?, 1, ?, ?, NULL, ?)
    ON CONFLICT(article_id, entity_id) DO UPDATE SET
      salience = excluded.salience,
      weight = excluded.weight,
      snippet = excluded.snippet
  `);

  const previousEntityIds = new Set(
    (selectExistingLinks.all(articleId) as Array<{ entityId: string }>).map((row) => row.entityId)
  );
  deleteLinks.run(articleId);

  const nextEntityIds = new Set<string>();
  for (const rawEntity of entities) {
    const canon = canonicalizeEntity(rawEntity.name, rawEntity.type);
    const entity = { ...rawEntity, name: canon.name, type: canon.type };
    const normalizedName = normalize(entity.name);
    if (!normalizedName) continue;

    const existing = selectByName.get(normalizedName) as { id: string } | undefined;
    let entityId: string;

    if (existing) {
      entityId = existing.id;
      // Salience is a decayed running max of per-mention centrality (cheap Phase-1 proxy).
      const current = selectSalience.get(entityId) as { salience: number };
      const nextSalience = Math.max(current.salience * 0.9, entity.salience);
      if (previousEntityIds.has(entityId) || nextEntityIds.has(entityId)) {
        touchEntity.run(occurredAt, occurredAt, nextSalience, entityId);
      } else {
        bumpEntity.run(occurredAt, occurredAt, nextSalience, entityId);
      }
    } else {
      entityId = nanoid();
      insertEntity.run(
        entityId, entity.name, normalizedName, mapType(entity.type),
        occurredAt, occurredAt, entity.salience, occurredAt, occurredAt,
      );
    }

    if (nextEntityIds.has(entityId)) continue;
    nextEntityIds.add(entityId);
    insertLink.run(articleId, entityId, entity.salience, entity.salience, entity.snippet || null);
  }

  for (const entityId of previousEntityIds) {
    if (nextEntityIds.has(entityId)) continue;
    decrementEntity.run(occurredAt, entityId);
    deleteOrphanedEntities.run(entityId, entityId);
  }
}

const SUMMARY_SNIPPET_LIMIT = 12;

// Debounced rolling-summary regeneration. Only entities whose summary_dirty_count has
// crossed the threshold get re-summarized, so this is cheap to call on every worker tick.
export async function regenerateDirtyEntitySummaries(threshold = 4): Promise<number> {
  const db = getDb();
  const settings = getServerAISettings();
  if (!settings.enabled) return 0;

  const dirty = db.prepare(`
    SELECT id, name, entity_type AS entityType
    FROM entities
    WHERE summary_dirty_count >= ?
    ORDER BY salience DESC
    LIMIT 25
  `).all(threshold) as Array<{ id: string; name: string; entityType: string }>;

  const selectSnippets = db.prepare(`
    SELECT snippet FROM article_entities
    WHERE entity_id = ? AND snippet IS NOT NULL AND snippet != ''
    ORDER BY salience DESC LIMIT ?
  `);
  const updateSummary = db.prepare(`
    UPDATE entities
    SET summary = ?, summary_dirty_count = 0, summary_updated_at = ?
    WHERE id = ?
  `);

  let updated = 0;
  for (const entity of dirty) {
    const snippets = (selectSnippets.all(entity.id, SUMMARY_SNIPPET_LIMIT) as Array<{ snippet: string }>)
      .map((row) => row.snippet);
    if (snippets.length === 0) {
      updateSummary.run(null, new Date().toISOString(), entity.id);
      continue;
    }
    const prompt = [
      `Write a 2-3 sentence rolling summary of "${entity.name}" (${entity.entityType}) based ONLY on these recent mentions.`,
      'Be factual and concise. No preamble.',
      '',
      ...snippets.map((s) => `- ${s}`),
    ].join('\n');

    try {
      const text = await runLLM(settings, prompt, { temperature: 0.2 });
      updateSummary.run(text.trim(), new Date().toISOString(), entity.id);
      updated += 1;
    } catch (error) {
      console.error(`[entity-summary] failed for ${entity.id}:`, error);
    }
  }
  return updated;
}

export function getEntityById(id: string): EntityRow | null {
  const db = getDb();
  const row = db.prepare(`
    SELECT id, name, normalized_name AS normalizedName, entity_type AS entityType,
           summary, salience, mention_count AS mentionCount,
           first_seen AS firstSeen, last_seen AS lastSeen
    FROM entities WHERE id = ?
  `).get(id) as EntityRow | undefined;
  return row ?? null;
}

export interface EntityArticle {
  id: string;
  title: string;
  url: string;
  sourceTitle: string | null;
  publishedAt: string | null;
  salience: number | null;
  snippet: string | null;
}

export interface EntityDetail {
  entity: EntityRow;
  articles: EntityArticle[];
}

export function getEntityDetail(id: string): EntityDetail | null {
  const entity = getEntityById(id);
  if (!entity) return null;
  const db = getDb();
  const articles = db.prepare(`
    SELECT a.id AS id, a.title AS title, a.canonical_url AS url,
           a.source_title AS sourceTitle,
           COALESCE(a.published_at, a.created_at) AS publishedAt,
           ae.salience AS salience, ae.snippet AS snippet
    FROM article_entities ae
    JOIN articles a ON a.id = ae.article_id
    WHERE ae.entity_id = ?
    ORDER BY COALESCE(a.published_at, a.created_at) DESC
    LIMIT 100
  `).all(id) as EntityArticle[];
  return { entity, articles };
}
