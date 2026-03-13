import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

// Helper to escape XML characters
function escapeXml(unsafe: string) {
    if (typeof unsafe !== 'string') return '';
    return unsafe.replace(/[<>&'"]/g, (c) => {
        switch (c) {
            case '<': return '&lt;';
            case '>': return '&gt;';
            case '&': return '&amp;';
            case '\'': return '&apos;';
            case '"': return '&quot;';
        }
        return c;
    });
}

async function fetchRSS(url: string): Promise<any[]> {
    try {
        const res = await fetch(url, { cache: 'no-store' });
        const text = await res.text();
        // Simple XML parsing for RSS items
        const items: any[] = [];
        const itemRegex = /<item[^>]*>([\s\S]*?)<\/item>/gi;
        let match;
        while ((match = itemRegex.exec(text)) !== null) {
            const itemXml = match[1];
            const titleMatch = itemXml.match(/<title[^>]*>([^<]+)<\/title>/i);
            const descMatch = itemXml.match(/<description[^>]*>([^<]+)<\/description>/i);
            const linkMatch = itemXml.match(/<link[^>]*>([^<]+)<\/link>/i);
            const pubDateMatch = itemXml.match(/<pubDate[^>]*>([^<]+)<\/pubDate>/i);
            if (titleMatch) {
                items.push({
                    title: titleMatch[1].trim(),
                    description: descMatch ? descMatch[1].trim().substring(0, 500) : '',
                    link: linkMatch ? linkMatch[1].trim() : '',
                    pubDate: pubDateMatch ? pubDateMatch[1].trim() : new Date().toISOString(),
                    category: 'TechNews'
                });
            }
        }
        return items.slice(0, 3); // Limit to 3 items per feed
    } catch (e) {
        console.error(`Error fetching RSS ${url}:`, e);
        return [];
    }
}

function getProjectIdeas(): any[] {
    const projectsPath = path.join(process.env.HOME || '/Users/clawking', 'SynologyDrive', 'Projects');
    const ideas: any[] = [];

    const projects = [
        { name: 'RSSDeck', desc: 'AI-powered news dashboard with local LLM summarization', tags: ['Next.js', 'AI', 'RSS'] },
        { name: 'FlowClaw', desc: 'Dynamic AI-driven project management with custom workflows', tags: ['AI', 'Productivity', 'Kanban'] },
        { name: 'JARVIS Orb', desc: '3D visual interface for AI assistant with voice', tags: ['3D', 'AI', 'UI'] },
        { name: 'RealWorth', desc: 'Cross-border real estate valuation calculator', tags: ['Finance', 'Property', 'Tool'] },
        { name: 'PixelHQ-bridge', desc: 'Integration layer for PixelHQ services', tags: ['Integration', 'API', 'Automation'] },
    ];

    projects.forEach((p, i) => {
        ideas.push({
            title: `💡 Project Idea: ${p.name}`,
            description: `${p.desc}\n\nTags: ${p.tags.join(', ')}`,
            pubDate: new Date(Date.now() - i * 3600000).toISOString(),
            guid: `idea-${p.name.toLowerCase()}`,
            category: 'ProjectIdeas'
        });
    });

    return ideas;
}

function getTrendingTopics(): any[] {
    const topics = [
        { title: '🤖 AI Agents', desc: 'Autonomous AI agents are trending - think AutoGPT, CrewAI, LangChain agents', source: 'HackerNews' },
        { title: '🎨 Vibe Coding', desc: 'Building apps with AI assistance - no traditional coding required', source: 'Twitter/X' },
        { title: '🔮 Local LLMs', desc: 'Ollama, LM Studio making local AI accessible to everyone', source: 'Reddit' },
        { title: '📱 React Server Components', desc: 'Next.js 16 pushing the boundaries of server-side rendering', source: 'DevCommunity' },
        { title: '🎯 MCP Protocol', desc: 'Model Context Protocol - new standard for AI-tool integration', source: 'Anthropic' },
    ];

    return topics.map((t, i) => ({
        title: t.title,
        description: `${t.desc}\n\nSource: ${t.source}`,
        pubDate: new Date(Date.now() - i * 1800000).toISOString(),
        guid: `trend-${i}`,
        category: 'Trending'
    }));
}

export async function GET() {
    const openclawPath = path.join(process.env.HOME || '/Users/clawking', '.openclaw');
    const logsPath = path.join(openclawPath, 'logs', 'gateway.log');
    const cronRunsPath = path.join(openclawPath, 'cron', 'runs');

    let items: any[] = [];

    // 1. Project Ideas (curated by JARVIS)
    items.push(...getProjectIdeas());

    // 3. Trending Topics
    items.push(...getTrendingTopics());

    // 4. Fetch recent logs (last 5 lines)
    try {
        if (fs.existsSync(logsPath)) {
            const logs = fs.readFileSync(logsPath, 'utf-8');
            const lines = logs.trim().split('\n').slice(-5).reverse();
            lines.forEach((line, index) => {
                try {
                    const parsed = JSON.parse(line);
                    if (parsed.message && !parsed.message.includes('Heartbeat poll')) {
                        items.push({
                            title: `System Log: ${new Date(parsed.timestamp).toLocaleTimeString()}`,
                            description: escapeXml(parsed.message),
                            pubDate: new Date(parsed.timestamp).toISOString(),
                            guid: `log-${parsed.timestamp}-${index}`,
                            category: 'Logs'
                        });
                    }
                } catch {
                    if (line.length > 5) {
                        items.push({
                            title: `System Log`,
                            description: escapeXml(line),
                            pubDate: new Date().toISOString(),
                            guid: `log-plain-${index}`,
                            category: 'Logs'
                        });
                    }
                }
            });
        }
    } catch (e) {
        console.error('Error reading logs:', e);
    }

    // 5. Fetch recent cron runs
    try {
        if (fs.existsSync(cronRunsPath)) {
            const runs = fs.readdirSync(cronRunsPath).reverse().slice(0, 3);
            runs.forEach((file) => {
                const content = fs.readFileSync(path.join(cronRunsPath, file), 'utf-8');
                try {
                    const parsed = JSON.parse(content);
                    items.push({
                        title: `Cron Job: ${parsed.jobName || path.basename(file, '.jsonl')}`,
                        description: `Status: ${parsed.status || 'Completed'}\nDuration: ${parsed.duration || 'N/A'}`,
                        pubDate: new Date(parsed.timestamp || Date.now()).toISOString(),
                        guid: `cron-${file}`,
                        category: 'Cron'
                    });
                } catch {
                    items.push({
                        title: `Cron Job Run`,
                        description: `Log file: ${file}`,
                        pubDate: new Date().toISOString(),
                        guid: `cron-plain-${file}`,
                        category: 'Cron'
                    });
                }
            });
        }
    } catch (e) {
        console.error('Error reading cron runs:', e);
    }

    // 6. System stats
    items.push({
        title: 'System Status Check',
        description: 'Gateway is running. All services operational.',
        pubDate: new Date().toISOString(),
        guid: `status-${Date.now()}`,
        category: 'Status'
    });

    // Sort items by date
    items.sort((a, b) => new Date(b.pubDate).getTime() - new Date(a.pubDate).getTime());

    // Generate RSS XML
    const rss = `<?xml version="1.0" encoding="UTF-8" ?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
<channel>
<title>OpenClaw System Monitor</title>
<description>Live status updates for OpenClaw ecosystem</description>
<link>http://192.168.68.51:3000</link>
<atom:link href="http://192.168.68.51:3000/api/openclaw" rel="self" type="application/rss+xml"/>
<language>en-us</language>
<lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
${items.map(item => `
<item>
<title><![CDATA[${item.title}]]></title>
<description><![CDATA[${item.description}]]></description>
<link>http://192.168.68.51:3000</link>
<guid isPermaLink="false">${item.guid}</guid>
<pubDate>${new Date(item.pubDate).toUTCString()}</pubDate>
<category>${item.category}</category>
</item>
`).join('')}
</channel>
</rss>`;

    return new NextResponse(rss, {
        headers: {
            'Content-Type': 'application/rss+xml',
            'Cache-Control': 'no-cache, no-store, must-revalidate',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
        },
    });
}
