import { NextRequest, NextResponse } from 'next/server';
import { generateChat, AIChatMessage } from '@/lib/ai/providers';
import { getBriefingContextPack } from '@/lib/server/articles-repository';
import { appendBriefingChatMessage, getBriefingById } from '@/lib/server/briefings-repository';

type RouteContext = {
  params: Promise<{ briefingId: string }>;
};

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { briefingId } = await context.params;
    const briefing = getBriefingById(briefingId);

    if (!briefing) {
      return NextResponse.json({ error: 'Briefing not found' }, { status: 404 });
    }

    const body = await request.json();
    const messages = (body.messages || []) as AIChatMessage[];
    const aiSettings = body.aiSettings || {};
    const latestUserMessage = [...messages].reverse().find((message) => message.role === 'user');
    const contextPack = getBriefingContextPack(briefing.topStories.map((story) => story.articleId), 7);

    const systemPrompt = `You are a briefing analyst. Answer based on this saved briefing and the linked top stories.

BRIEFING TITLE: ${briefing.title}
EXECUTIVE SUMMARY:
${briefing.executiveSummary}

KEY THEMES:
${briefing.keyThemes.map((theme) => `- ${theme}`).join('\n')}

TOP STORIES:
${briefing.topStories.map((story, index) => `${index + 1}. ${story.title} (${story.sourceTitle || 'Unknown Source'}) - ${story.url}`).join('\n')}

RETRIEVED CONTEXT:
Dominant entities: ${contextPack.dominantEntities.map((entity) => `${entity.name}(${entity.mentions})`).join(', ') || 'none'}
Dominant themes: ${contextPack.dominantThemes.map((theme) => `${theme.name}(${theme.score.toFixed(1)})`).join(', ') || 'none'}
Dominant locations: ${contextPack.dominantLocations.map((location) => `${location.name}(${location.mentions})`).join(', ') || 'none'}
Category movers: ${contextPack.categoryMovers.map((mover) => `${mover.category}(${mover.delta >= 0 ? '+' : ''}${mover.delta})`).join(', ') || 'none'}
Storylines:
${contextPack.storylines.map((storyline, index) => `${index + 1}. ${storyline.title} | ${storyline.storyCount} stories | ${storyline.sourceCount} sources | entities: ${storyline.entities.map((entity) => entity.name).join(', ') || 'none'} | themes: ${storyline.themes.map((theme) => theme.name).join(', ') || 'none'} | locations: ${storyline.locations.map((location) => location.name).join(', ') || 'none'}`).join('\n') || 'none'}

ARTICLE CONTEXT:
${contextPack.articles.map((article, index) => `${index + 1}. ${article.title}
Category: ${article.category || 'General'}
Source: ${article.sourceTitle || 'Unknown Source'}
Entities: ${article.entities.map((entity) => entity.name).join(', ') || 'none'}
Themes: ${article.themes.map((theme) => theme.name).join(', ') || 'none'}
Locations: ${article.locations.map((location) => location.name).join(', ') || 'none'}
URL: ${article.url}`).join('\n\n')}
`;

    const result = await generateChat(
      aiSettings.provider || 'ollama',
      [{ role: 'system', content: systemPrompt }, ...messages],
      {
        apiKey: aiSettings.apiKeys?.[aiSettings.provider] || aiSettings.apiKey,
        baseUrl: aiSettings.ollamaUrl,
        model: aiSettings.model || 'llama3.2',
      }
    );

    if (latestUserMessage?.content) {
      appendBriefingChatMessage(briefingId, 'user', latestUserMessage.content);
    }
    appendBriefingChatMessage(briefingId, 'assistant', result.text.trim());

    return NextResponse.json({ reply: result.text.trim() });
  } catch (error: unknown) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to chat with briefing' },
      { status: 500 }
    );
  }
}
