import 'server-only';

import { nanoid } from 'nanoid';
import { getDb } from './db';

export type FeedbackValue = -1 | 0 | 1;
export type RecommendationVariant = 'baseline' | 'personalized' | 'exploration';

type Feature = {
  type: 'tag' | 'category' | 'source' | 'entity' | 'theme';
  key: string;
  step: number;
};

type PreferenceWeightRow = {
  feature_type: Feature['type'];
  feature_key: string;
  weight: number;
};

type FeedbackRow = {
  article_id: string;
  value: -1 | 1;
};

const MAX_FEATURE_WEIGHT = 12;
const MAX_PREFERENCE_BOOST = 35;

function normalizeFeatureKey(value: string | null | undefined) {
  return value?.replace(/\s+/g, ' ').trim().toLowerCase().slice(0, 96) || '';
}

function parseTags(tagsJson: string | null) {
  if (!tagsJson) return [];

  try {
    const parsed = JSON.parse(tagsJson);
    if (!Array.isArray(parsed)) return [];

    return parsed
      .map((tag) => {
        if (typeof tag === 'string') return tag;
        if (tag && typeof tag === 'object' && typeof tag.name === 'string') return tag.name;
        return null;
      })
      .filter((tag): tag is string => Boolean(tag?.trim()))
      .slice(0, 12);
  } catch {
    return [];
  }
}

function uniqueFeatures(features: Feature[]) {
  const seen = new Set<string>();
  return features.filter((feature) => {
    const key = `${feature.type}:${feature.key}`;
    if (!feature.key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export function getPreferenceStateSignature() {
  const db = getDb();
  const row = db.prepare(`
    SELECT
      COUNT(*) AS feedback_count,
      COALESCE(MAX(updated_at), '') AS latest_feedback_at
    FROM article_feedback
  `).get() as { feedback_count: number; latest_feedback_at: string };

  return `${row.feedback_count}:${row.latest_feedback_at}`;
}

export function getFeedbackValues(articleIds: string[]) {
  if (articleIds.length === 0) return new Map<string, -1 | 1>();

  const db = getDb();
  const placeholders = articleIds.map(() => '?').join(',');
  const rows = db.prepare(`
    SELECT article_id, value
    FROM article_feedback
    WHERE article_id IN (${placeholders})
  `).all(...articleIds) as FeedbackRow[];

  return new Map(rows.map((row) => [row.article_id, row.value]));
}

export function getPreferenceWeightMap() {
  const db = getDb();
  const rows = db.prepare(`
    SELECT feature_type, feature_key, weight
    FROM preference_weights
    WHERE weight != 0
  `).all() as PreferenceWeightRow[];

  const weights = new Map<string, number>();
  for (const row of rows) {
    weights.set(`${row.feature_type}:${row.feature_key}`, row.weight);
  }

  return weights;
}

export function getFeedbackCount() {
  const db = getDb();
  const row = db.prepare('SELECT COUNT(*) AS count FROM article_feedback').get() as { count: number };
  return row.count;
}

export function computePreferenceBoost(input: {
  category: string | null;
  sourceTitle: string | null;
  tags: string[];
  tagDetails?: Array<{ name: string; type: string; score: number }>;
  weights: Map<string, number>;
}) {
  const features = uniqueFeatures([
    ...(input.category && input.category !== 'General'
      ? [{ type: 'category' as const, key: normalizeFeatureKey(input.category), step: 1 }]
      : []),
    ...(input.sourceTitle
      ? [{ type: 'source' as const, key: normalizeFeatureKey(input.sourceTitle), step: 1 }]
      : []),
    ...input.tags.map((tag) => ({ type: 'tag' as const, key: normalizeFeatureKey(tag), step: 1 })),
    ...(input.tagDetails ?? [])
      .filter((tag) => tag.type === 'entity')
      .map((tag) => ({ type: 'entity' as const, key: normalizeFeatureKey(tag.name), step: 1 })),
  ]);

  const boost = features.reduce((sum, feature) => {
    return sum + (input.weights.get(`${feature.type}:${feature.key}`) ?? 0);
  }, 0);

  return Number(clamp(boost, -MAX_PREFERENCE_BOOST, MAX_PREFERENCE_BOOST).toFixed(2));
}

function getArticleFeatures(articleId: string) {
  const db = getDb();
  const article = db.prepare(`
    SELECT
      a.source_title,
      aa.primary_category,
      aa.tags_json
    FROM articles a
    LEFT JOIN article_analysis aa ON aa.article_id = a.id
    WHERE a.id = ?
  `).get(articleId) as {
    source_title: string | null;
    primary_category: string | null;
    tags_json: string | null;
  } | undefined;

  if (!article) return [];

  const entityRows = db.prepare(`
    SELECT e.name
    FROM article_entities ae
    JOIN entities e ON e.id = ae.entity_id
    WHERE ae.article_id = ?
    ORDER BY ae.weight DESC, ae.mention_count DESC
    LIMIT 8
  `).all(articleId) as Array<{ name: string }>;

  const themeRows = db.prepare(`
    SELECT t.name
    FROM article_themes at
    JOIN themes t ON t.id = at.theme_id
    WHERE at.article_id = ?
    ORDER BY at.score DESC
    LIMIT 8
  `).all(articleId) as Array<{ name: string }>;

  return uniqueFeatures([
    ...(article.primary_category && article.primary_category !== 'General'
      ? [{ type: 'category' as const, key: normalizeFeatureKey(article.primary_category), step: 0.5 }]
      : []),
    ...(article.source_title
      ? [{ type: 'source' as const, key: normalizeFeatureKey(article.source_title), step: 0.4 }]
      : []),
    ...parseTags(article.tags_json).map((tag) => ({
      type: 'tag' as const,
      key: normalizeFeatureKey(tag),
      step: 0.8,
    })),
    ...entityRows.map((entity) => ({
      type: 'entity' as const,
      key: normalizeFeatureKey(entity.name),
      step: 0.25,
    })),
    ...themeRows.map((theme) => ({
      type: 'theme' as const,
      key: normalizeFeatureKey(theme.name),
      step: 0.25,
    })),
  ]);
}

export function saveArticleFeedback(articleId: string, value: FeedbackValue) {
  const db = getDb();
  const now = new Date().toISOString();
  const existing = db.prepare(`
    SELECT id, value
    FROM article_feedback
    WHERE article_id = ?
  `).get(articleId) as { id: string; value: -1 | 1 } | undefined;

  if (existing?.value === value) {
    value = 0;
  }

  const nextValue = value === 1 || value === -1 ? value : 0;
  const delta = nextValue - (existing?.value ?? 0);
  if (delta === 0) {
    return { articleId, value: nextValue };
  }

  try {
    db.exec('BEGIN');
    if (nextValue === 0) {
      db.prepare('DELETE FROM article_feedback WHERE article_id = ?').run(articleId);
    } else {
      db.prepare(`
        INSERT INTO article_feedback (id, article_id, value, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(article_id) DO UPDATE SET
          value = excluded.value,
          updated_at = excluded.updated_at
      `).run(existing?.id ?? nanoid(), articleId, nextValue, existing ? now : now, now);
    }

    const positiveDelta = (nextValue === 1 ? 1 : 0) - (existing?.value === 1 ? 1 : 0);
    const negativeDelta = (nextValue === -1 ? 1 : 0) - (existing?.value === -1 ? 1 : 0);
    const upsertWeight = db.prepare(`
      INSERT INTO preference_weights (
        feature_type, feature_key, weight, positive_count, negative_count, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(feature_type, feature_key) DO UPDATE SET
        weight = min(?, max(?, preference_weights.weight + excluded.weight)),
        positive_count = max(0, preference_weights.positive_count + excluded.positive_count),
        negative_count = max(0, preference_weights.negative_count + excluded.negative_count),
        updated_at = excluded.updated_at
    `);

    for (const feature of getArticleFeatures(articleId)) {
      upsertWeight.run(
        feature.type,
        feature.key,
        feature.step * delta,
        positiveDelta,
        negativeDelta,
        now,
        MAX_FEATURE_WEIGHT,
        -MAX_FEATURE_WEIGHT
      );
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  return { articleId, value: nextValue };
}

export function recordPriorityFeedImpressions(items: Array<{
  id: string;
  priorityScore: number;
  recommendationVariant?: RecommendationVariant;
}>) {
  if (items.length === 0) return;

  const db = getDb();
  const now = new Date().toISOString();
  const statement = db.prepare(`
    INSERT INTO article_impressions (id, article_id, surface, position, score, variant, shown_at)
    VALUES (?, ?, 'today_priority', ?, ?, ?, ?)
  `);

  try {
    db.exec('BEGIN');
    items.forEach((item, index) => {
      statement.run(
        nanoid(),
        item.id,
        index,
        item.priorityScore,
        item.recommendationVariant ?? 'baseline',
        now
      );
    });
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
