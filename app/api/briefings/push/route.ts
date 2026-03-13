import { NextRequest, NextResponse } from 'next/server';

function escapeHtml(text: string) {
  return text.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case '&': return '&amp;';
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '"': return '&quot;';
      case '\'': return '&#39;';
      default: return char;
    }
  });
}

function formatBriefingMessage(briefing: {
  title: string;
  executiveSummary: string;
  keyThemes?: string[];
  topStories?: Array<{ title: string; sourceTitle: string | null; url: string }>;
}) {
  const safeSummary = escapeHtml(briefing.executiveSummary)
    .replace(/^##\s+(.*)$/gm, '<b>$1</b>')
    .replace(/\*\*(.*?)\*\*/g, '<b>$1</b>')
    .replace(/^\s*[-*]\s+/gm, '• ');

  const themes = (briefing.keyThemes ?? []).slice(0, 5).map((theme) => `• ${escapeHtml(theme)}`).join('\n');
  const topStories = (briefing.topStories ?? []).slice(0, 5).map((story, index) => (
    `${index + 1}. <a href="${story.url}">${escapeHtml(story.title)}</a>${story.sourceTitle ? ` <i>(${escapeHtml(story.sourceTitle)})</i>` : ''}`
  )).join('\n');

  return [
    `🗞️ <b>${escapeHtml(briefing.title)}</b>`,
    '',
    safeSummary,
    themes ? `\n<b>Key Themes</b>\n${themes}` : '',
    topStories ? `\n<b>Top Stories</b>\n${topStories}` : '',
  ].filter(Boolean).join('\n');
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const briefing = body.briefing;
    const telegramToken = body.telegramToken;
    const telegramChatId = body.telegramChatId;

    if (!briefing?.title || !briefing?.executiveSummary || !telegramToken || !telegramChatId) {
      return NextResponse.json({ error: 'Missing push payload' }, { status: 400 });
    }

    const response = await fetch(`https://api.telegram.org/bot${telegramToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: telegramChatId,
        text: formatBriefingMessage(briefing),
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }),
    });

    if (!response.ok) {
      return NextResponse.json({ error: await response.text() }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to push briefing' },
      { status: 500 }
    );
  }
}
