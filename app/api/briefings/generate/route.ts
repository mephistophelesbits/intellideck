import { NextRequest, NextResponse } from 'next/server';
import { generateText } from '@/lib/ai/providers';
import {
  getBriefingContextPack,
  getRecentArticlesForBriefing,
  getStorylineClusters,
} from '@/lib/server/articles-repository';
import { saveBriefing } from '@/lib/server/briefings-repository';

function extractThemes(articles: Array<{ primary_category: string | null }>) {
  return Array.from(
    new Set(
      articles
        .map((article) => article.primary_category)
        .filter((category): category is string => Boolean(category))
    )
  ).slice(0, 6);
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const aiSettings = body.aiSettings || {};
    const recentArticles = getRecentArticlesForBriefing(50, 2);
    const storylines = getStorylineClusters(7);

    if (recentArticles.length === 0) {
      return NextResponse.json({ error: 'No recent articles available for briefing generation' }, { status: 400 });
    }

    const storylineIndex = new Map<string, string>();
    for (const storyline of storylines) {
      for (const article of storyline.articles) {
        storylineIndex.set(article.id, storyline.id);
      }
    }

    const sourceCounts = new Map<string, number>();
    const rankedStories = recentArticles
      .map((article) => {
        const sourceKey = article.source_title || 'Unknown Source';
        const priorSourceCount = sourceCounts.get(sourceKey) ?? 0;
        sourceCounts.set(sourceKey, priorSourceCount + 1);

        const diversityBonus = priorSourceCount === 0 ? 18 : Math.max(0, 10 - priorSourceCount * 4);
        const categoryBonus = article.primary_category && article.primary_category !== 'General' ? 8 : 0;
        const trendBonus = Math.min(18, article.entity_count * 2);
        const themeBonus = Math.min(10, article.theme_count * 2);
        const briefingScore = Number(((article.importance_score ?? 0) + diversityBonus + categoryBonus + trendBonus + themeBonus).toFixed(2));

        return {
          ...article,
          briefingScore,
          storylineId: storylineIndex.get(article.id) ?? null,
        };
      })
      .sort((a, b) => b.briefingScore - a.briefingScore);

    const storylineCounts = new Map<string, number>();
    const selectedStories: Array<(typeof rankedStories)[number]> = [];
    const candidates = [...rankedStories];

    while (selectedStories.length < 10 && candidates.length > 0) {
      candidates.sort((a, b) => {
        const aPenalty = a.storylineId ? (storylineCounts.get(a.storylineId) ?? 0) * 14 : 0;
        const bPenalty = b.storylineId ? (storylineCounts.get(b.storylineId) ?? 0) * 14 : 0;
        return (b.briefingScore - bPenalty) - (a.briefingScore - aPenalty);
      });

      const nextStory = candidates.shift();
      if (!nextStory) break;

      if (nextStory.storylineId) {
        const count = storylineCounts.get(nextStory.storylineId) ?? 0;
        if (count >= 2) {
          continue;
        }
        storylineCounts.set(nextStory.storylineId, count + 1);
      }

      selectedStories.push(nextStory);
    }

    const topStories = selectedStories.map((article) => ({
      articleId: article.id,
      title: article.title,
      url: article.canonical_url,
      sourceTitle: article.source_title,
      category: article.primary_category,
    }));
    const contextPack = getBriefingContextPack(topStories.map((story) => story.articleId), 7);

    const articlesText = rankedStories
      .slice(0, 12)
      .map((story, index) => `${index + 1}. [${story.primary_category || 'General'}] ${story.title} (${story.source_title || 'Unknown Source'}) score=${story.briefingScore}`)
      .join('\n');

    const articleContextText = contextPack.articles
      .slice(0, 8)
      .map((article) => `- ${article.title}
  Category: ${article.category || 'General'}
  Source: ${article.sourceTitle || 'Unknown Source'}
  Entities: ${article.entities.map((entity) => entity.name).join(', ') || 'none'}
  Themes: ${article.themes.map((theme) => theme.name).join(', ') || 'none'}
  Locations: ${article.locations.map((location) => location.name).join(', ') || 'none'}`)
      .join('\n');

    const globalSignalsText = [
      `Dominant entities: ${contextPack.dominantEntities.map((entity) => `${entity.name}(${entity.mentions})`).join(', ') || 'none'}`,
      `Dominant themes: ${contextPack.dominantThemes.map((theme) => `${theme.name}(${theme.score.toFixed(1)})`).join(', ') || 'none'}`,
      `Dominant locations: ${contextPack.dominantLocations.map((location) => `${location.name}(${location.mentions})`).join(', ') || 'none'}`,
      `Top movers: ${contextPack.categoryMovers.map((mover) => `${mover.category}(${mover.delta >= 0 ? '+' : ''}${mover.delta})`).join(', ') || 'none'}`,
    ].join('\n');
    const storylineText = contextPack.storylines
      .slice(0, 5)
      .map((storyline, index) => `${index + 1}. ${storyline.title} | ${storyline.storyCount} stories | ${storyline.sourceCount} sources | entities: ${storyline.entities.map((entity) => entity.name).join(', ') || 'none'} | themes: ${storyline.themes.map((theme) => theme.name).join(', ') || 'none'} | locations: ${storyline.locations.map((location) => location.name).join(', ') || 'none'}`)
      .join('\n');

    const prompt = `You are a News Intelligence Officer. Create a concise daily briefing from the following stories.

Return markdown with:
## Executive Summary
One short paragraph.

## Key Themes
- Up to 5 themes

## Why It Matters
2-3 bullet points

Stories:
${articlesText}

Retrieved article context:
${articleContextText}

Historical and cross-story signals:
${globalSignalsText}

Storyline clusters:
${storylineText || 'none'}`;

    const result = await generateText(
      aiSettings.provider || 'ollama',
      prompt,
      {
        apiKey: aiSettings.apiKeys?.[aiSettings.provider] || aiSettings.apiKey,
        baseUrl: aiSettings.ollamaUrl,
        model: aiSettings.model || 'llama3.2',
      }
    );

    const briefing = saveBriefing({
      briefingDate: new Date().toISOString(),
      title: `Daily Briefing ${new Date().toLocaleDateString()}`,
      executiveSummary: result.text,
      keyThemes: extractThemes(topStories.map((story) => ({ primary_category: story.category }))),
      topStories,
      modelProvider: aiSettings.provider || 'ollama',
      modelName: aiSettings.model || 'llama3.2',
    });

    return NextResponse.json(briefing);
  } catch (error: unknown) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to generate briefing' },
      { status: 500 }
    );
  }
}
