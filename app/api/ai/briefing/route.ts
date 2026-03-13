import { NextRequest, NextResponse } from 'next/server';
import { generateText } from '@/lib/ai/providers';



function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case '&': return '&amp;';
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '"': return '&quot;';
      case "'": return '&#39;';
      default: return char;
    }
  });
}

export async function POST(req: NextRequest) {
  try {
    const {
      articles,
      aiSettings,
      telegramSettings
    } = await req.json();

    // Generate news briefing
    let briefing = '';
    if (articles && articles.length > 0) {
      const articlesText = articles.map((a: any, i: number) => `${i + 1}. ${a.title}`).join('\n');
      const prompt = `You are a News Intelligence Officer. Analyze the following headlines and provide a concise intelligence briefing.

1. Select the 3-5 most important or time-sensitive developments as "STRATEGIC HEADLINES".
2. Group the rest into key topics and provide a "TOPIC SUMMARY" for each.

Format:
**🚨 STRATEGIC HEADLINES**
- **[Headline]**: [One-line context]

**📂 TOPIC SUMMARIES**
- **[Topic Category]**: [Concise summary of developments]

Headlines:
${articlesText}

Briefing:`;

      const result = await generateText(
        aiSettings?.provider || 'ollama',
        prompt,
        {
          apiKey: aiSettings?.apiKeys?.[aiSettings?.provider] || aiSettings?.apiKey,
          baseUrl: aiSettings?.ollamaUrl,
          model: aiSettings?.model || 'llama3.2',
        }
      );
      briefing = result.text;
    }



    // Build Telegram message
    const hour = new Date().getHours();
    let greeting = '🌅';
    let title = 'DAILY BRIEFING';

    if (hour >= 12 && hour < 17) {
      greeting = '☀️';
      title = 'AFTERNOON BRIEFING';
    } else if (hour >= 17 || hour < 5) {
      greeting = '🌙';
      title = 'EVENING BRIEFING';
    }

    let message = `${greeting} <b>${title}</b>\n\n`;

    if (briefing) {
      // Escape HTML chars first, then convert Markdown bold to HTML bold
      const safeBriefing = escapeHtml(briefing)
        .replace(/\*\*(.*?)\*\*/g, '<b>$1</b>') // **bold** -> <b>bold</b>
        .replace(/^\s*[-*]\s+/gm, '• ');        // List items -> Bullet points

      message += `${safeBriefing}\n\n`;
    }



    message += `<i>Generated at ${new Date().toLocaleTimeString()}</i>`;

    // Push to Telegram
    let telegramError = null;
    if (telegramSettings?.enabled && telegramSettings.token && telegramSettings.chatId) {
      const telegramUrl = `https://api.telegram.org/bot${telegramSettings.token}/sendMessage`;

      try {
        const res = await fetch(telegramUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: telegramSettings.chatId,
            text: message,
            parse_mode: 'HTML'
          }),
        });

        if (!res.ok) {
          telegramError = await res.text();
        }
      } catch (err: any) {
        telegramError = err.message;
      }
    }

    return NextResponse.json({
      briefing,
      message,
      telegramError,
      timestamp: new Date().toISOString()
    });
  } catch (error: any) {
    console.error('Briefing failed:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
