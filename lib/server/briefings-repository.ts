import 'server-only';

import { generateId } from '@/lib/utils';
import { getDb } from './db';

export type StoredBriefing = {
  id: string;
  briefingDate: string;
  title: string;
  executiveSummary: string;
  keyThemes: string[];
  topStories: Array<{
    articleId: string;
    title: string;
    url: string;
    sourceTitle: string | null;
    category: string | null;
  }>;
  createdAt: string;
  modelProvider: string | null;
  modelName: string | null;
  chatMessages?: BriefingChatMessage[];
};

export type BriefingChatMessage = {
  id: string;
  briefingId: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
};

export function saveBriefing(input: Omit<StoredBriefing, 'id' | 'createdAt'>) {
  const db = getDb();
  const now = new Date().toISOString();
  const id = generateId();

  db.prepare(`
    INSERT INTO briefings (
      id, briefing_date, title, executive_summary, key_themes_json, top_stories_json,
      scope_json, created_at, model_provider, model_name
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    input.briefingDate,
    input.title,
    input.executiveSummary,
    JSON.stringify(input.keyThemes),
    JSON.stringify(input.topStories),
    JSON.stringify({ mode: 'manual', topStoryCount: input.topStories.length }),
    now,
    input.modelProvider,
    input.modelName
  );

  return getBriefingById(id);
}

export function getBriefings() {
  const db = getDb();
  return db.prepare(`
    SELECT *
    FROM briefings
    ORDER BY briefing_date DESC, created_at DESC
  `).all().map(mapBriefingRow) as StoredBriefing[];
}

export function getBriefingById(id: string) {
  const db = getDb();
  const row = db.prepare(`SELECT * FROM briefings WHERE id = ?`).get(id);
  if (!row) return null;
  const briefing = mapBriefingRow(row);
  return {
    ...briefing,
    chatMessages: getBriefingChatMessages(id),
  };
}

export function deleteBriefingById(id: string) {
  const db = getDb();
  const result = db.prepare(`DELETE FROM briefings WHERE id = ?`).run(id);
  return result.changes > 0;
}

export function getBriefingChatMessages(briefingId: string) {
  const db = getDb();
  return db.prepare(`
    SELECT id, briefing_id, role, content, created_at
    FROM briefing_chat_messages
    WHERE briefing_id = ?
    ORDER BY created_at ASC
  `).all(briefingId).map((row) => {
    const data = row as {
      id: string;
      briefing_id: string;
      role: 'user' | 'assistant';
      content: string;
      created_at: string;
    };

    return {
      id: data.id,
      briefingId: data.briefing_id,
      role: data.role,
      content: data.content,
      createdAt: data.created_at,
    };
  }) as BriefingChatMessage[];
}

export function appendBriefingChatMessage(
  briefingId: string,
  role: 'user' | 'assistant',
  content: string
) {
  const db = getDb();
  const id = generateId();
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO briefing_chat_messages (
      id, briefing_id, role, content, created_at
    ) VALUES (?, ?, ?, ?, ?)
  `).run(id, briefingId, role, content, now);

  return {
    id,
    briefingId,
    role,
    content,
    createdAt: now,
  };
}

function mapBriefingRow(row: unknown): StoredBriefing {
  const data = row as {
    id: string;
    briefing_date: string;
    title: string;
    executive_summary: string;
    key_themes_json: string;
    top_stories_json: string;
    created_at: string;
    model_provider: string | null;
    model_name: string | null;
  };

  return {
    id: data.id,
    briefingDate: data.briefing_date,
    title: data.title,
    executiveSummary: data.executive_summary,
    keyThemes: JSON.parse(data.key_themes_json),
    topStories: JSON.parse(data.top_stories_json),
    createdAt: data.created_at,
    modelProvider: data.model_provider,
    modelName: data.model_name,
  };
}
