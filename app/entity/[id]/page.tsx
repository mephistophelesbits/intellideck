'use client';

import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { useTranslation } from '@/lib/i18n';
import { TimeAgo } from '@/components/ui/TimeAgo';

interface EntityDetailResponse {
  entity: {
    id: string;
    name: string;
    entityType: string;
    summary: string | null;
    salience: number;
    mentionCount: number;
    firstSeen: string | null;
    lastSeen: string | null;
  };
  articles: Array<{
    id: string;
    title: string;
    url: string;
    sourceTitle: string | null;
    publishedAt: string | null;
    salience: number | null;
    snippet: string | null;
  }>;
}

export default function EntityPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { t } = useTranslation();
  const [data, setData] = useState<EntityDetailResponse | null>(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    fetch(`/api/intelligence/entity/${id}`, { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : Promise.reject(res.status)))
      .then(setData)
      .catch(() => setNotFound(true));
  }, [id]);

  if (notFound) {
    return <div className="p-8 text-foreground opacity-60">{t('entity.notFound')}</div>;
  }
  if (!data) {
    return <div className="p-8 text-foreground opacity-60">…</div>;
  }

  const { entity, articles } = data;

  return (
    <div className="max-w-3xl mx-auto p-6 space-y-6 text-foreground">
      <Link href="/intelligence" className="text-sm text-accent hover:underline">
        ← {t('entity.back')}
      </Link>

      <header className="space-y-2">
        <p className="text-xs uppercase tracking-wide opacity-60">{entity.entityType}</p>
        <h1 className="text-2xl font-semibold">{entity.name}</h1>
        <div className="flex flex-wrap gap-4 text-sm opacity-70">
          <span>{t('entity.salience')}: {entity.salience.toFixed(2)}</span>
          <span>{t('entity.mentions')}: {entity.mentionCount}</span>
          {entity.firstSeen && (
            <span>{t('entity.firstSeen')}: <TimeAgo date={entity.firstSeen} /></span>
          )}
          {entity.lastSeen && (
            <span>{t('entity.lastSeen')}: <TimeAgo date={entity.lastSeen} /></span>
          )}
        </div>
      </header>

      <section className="rounded-lg border border-border p-4">
        <p className="text-sm leading-relaxed">{entity.summary || t('entity.noSummary')}</p>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium opacity-70">
          {t('entity.appearsIn')} ({articles.length})
        </h2>
        <ul className="space-y-2">
          {articles.map((article) => (
            <li key={article.id} className="rounded-lg border border-border p-3">
              <a
                href={article.url}
                target="_blank"
                rel="noreferrer"
                className="font-medium hover:underline"
              >
                {article.title}
              </a>
              <div className="mt-1 flex gap-3 text-xs opacity-60">
                {article.sourceTitle && <span>{article.sourceTitle}</span>}
                {article.publishedAt && <TimeAgo date={article.publishedAt} />}
              </div>
              {article.snippet && <p className="mt-2 text-sm opacity-70">{article.snippet}</p>}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
