# RSS Deck - AI-Powered News Dashboard

A modern, multi-column RSS reader with local AI integration for summarizing, sentiment analysis, and chatting with articles.

[![Buy Me A Coffee](https://img.shields.io/badge/Buy%20Me%20A%20Coffee-%F0%9F%A4%9D-yellow)](https://buymeacoffee.com/kianfongl)
[![Docker Image](https://img.shields.io/badge/Docker-kianfong%2Frssdeck-blue)](https://hub.docker.com/r/kianfong/rssdeck)

![RSS Deck Dark Theme](docs/dark_dashboard.png)
<br/>
![RSS Deck Light Theme](docs/light_dashboard.png)

## ✨ v2.0 Features

📰 **Clean Top Navigation Interface** - Overhauled v2.0 UI with a frosted glass top navigation bar and dynamic multi-column feeds

🤖 **Local AI Integration** - Powered by Ollama for privacy-first AI features:
  - Instant article summarization
  - Smart AI Settings (Per-provider keys, Connection Testing)
  - Chat with any article

🔒 **Privacy Focused** - Everything runs locally. No cloud APIs, no data collection

📰 **Full-Article Scraping** - Custom scraper with Mozilla's Readability for complete article content

📖 **Inline Reading Column** - Click any article to open it as a dedicated reading column right next to the feed, without covering other content

🎨 **Refined Aesthetic Themes** - Simplified, beautiful design modes:
  - Stitch 1 "Reader Studio" (Dark Mode)
  - Stitch 2 "Feed Dashboard" (Light Mode)

📱 **Responsive Design** - Works on desktop and mobile

## 🚀 Quick Start

### Prerequisites

- Node.js 18+ 
- Docker & Docker Compose (for containerized deployment)
- Ollama (for local AI features)

### Local Development

```bash
# Clone the repository
git clone https://github.com/mephistophelesbits/rssdeck.git
cd rssdeck

# Install dependencies
npm install

# Start development server (often runs on port 3000 or 3001)
npm run dev

# Open http://localhost:3000 (or http://localhost:3001 if 3000 is taken)
```

### Docker Deployment (Pre-built Image)

> [!NOTE]
> The pre-built image is optimized for `amd64`. If you are on a **Mac with Apple Silicon (M1/M2/M3)**, we recommend [building locally](#docker-deployment-build-locally) for better performance.

```bash
# One-line deploy (Mac users may need --platform linux/amd64)
docker run -d -p 3000:3000 -v rss-data:/app/data --name rssdeck --platform linux/amd64 kianfong/rssdeck:latest

# Or with docker-compose
docker-compose up -d
```

### Docker Deployment (Build Locally)

This is the **recommended method for Mac Apple Silicon** users to ensure native performance.

```bash
# Clone and build locally
git clone https://github.com/mephistophelesbits/rssdeck.git
cd rssdeck
docker-compose up -d --build

# Access at http://localhost:3000
```

#### 🛡️ Troubleshooting Mac Docker Errors

If you see `no matching manifest for linux/arm64/v8 in the manifest list entries`, it means you're trying to pull an `amd64` image on an `arm64` Mac. 

**Solution:** Use the **Build Locally** method above, or add `--platform linux/amd64` to your `docker run` command.

### Ollama Setup

```bash
# Install Ollama
# Download from https://ollama.ai

# Pull a model (recommended: llama3.2 or mistral)
ollama pull llama3.2

# RSS Deck will automatically connect to Ollama at http://localhost:11434
```

## 📁 Project Structure

```
rss-deck/
├── app/
│   ├── api/              # API routes (RSS, AI, scraping)
│   ├── bookmarks/        # Bookmarks page
│   ├── dashboard/        # Dashboard route (/dashboard)
│   ├── page.tsx          # Root page (Dashboard by default, Landing in production)
│   └── layout.tsx        # App layout
├── components/
│   ├── deck/             # Deck column components
│   │   ├── DeckContainer.tsx
│   │   ├── Column.tsx
│   │   └── ReadingColumn.tsx  # Inline reading panel
│   ├── ui/               # UI components
│   ├── Dashboard.tsx     # Main dashboard component
│   ├── LandingPage.tsx   # Marketing landing page
│   ├── BriefingManager.tsx
│   └── ThemeProvider.tsx
├── lib/
│   ├── ai/               # AI provider implementations
│   ├── rss/              # RSS parsing utilities
│   └── settings-store.ts # State management
├── public/               # Static assets
├── Dockerfile
├── docker-compose.yml
└── package.json
```

## 🎯 Use Cases

- **Morning Briefing** - Get an AI-summarized overview of your morning news
- **Topic Research** - Chat with articles to dive deeper into complex topics
- **Sentiment Tracking** - Visual indicators help you gauge overall news mood
- **Full-Content Reading** - No more frustrating paywalls or ad-heavy sites

## 🛠️ Tech Stack

- **Framework**: Next.js 15 with TypeScript
- **Styling**: Tailwind CSS
- **State**: Zustand
- **AI**: Ollama (local LLM)
- **RSS**: Custom parser + Mozilla Readability
- **Deployment**: Docker

## 🦞 RSSdeck-MCP (For AI Agents)

Looking to power your AI agent with RSS data? Check out **[RSSdeck-MCP](https://github.com/mephistophelesbits/rssdeck-mcp)** — an MCP server that provides token-efficient RSS summaries for AI agents.

- **TL;DR Summaries** — Not full articles
- **Relevance Scoring** — Filters by your interests
- **Deduplication** — Removes duplicate stories
- **Perfect for OpenClaw** and other AI agents

```
RSSdeck (Web UI) → Export OPML → RSSdeck-MCP → AI Agent
```

[Learn more →](https://github.com/mephistophelesbits/rssdeck-mcp)

## 📋 Changelog

### v2.0.0 (March 2026)
- **UI Architecture Overhaul** - Replaced the vertical side rail navigation with a clean, unified top navigation bar across all views (Dashboard, Intelligence, Briefings, Bookmarks).
- **Stitch Design System** - Implemented the premium "Stitch" design logic, prioritizing deep contrasts for Dark Mode and vibrant `#1152d4` accents for Light Mode.
- **Improved Scrollbars** - Enlarged tracking thumbs and visible deck horizontals to ensure usability is as excellent as the aesthetics.
- **Glassmorphism Components** - Introduced transparent, backdrop-blurred cards for overlays and article panels yielding a much more modern app footprint.

### v1.4.0 (Feb 2026)
- **Similar Posts** - Added a zero-API-cost client-side text similarity engine. Reading any article will instantly display related articles from your feeds at the bottom.
- **Custom Prompts** - Added customizable AI instructions in the Settings Modal for both Article Summarization ("Research") and Morning Briefings.
- **Tabbed Settings UI** - Grouped Settings into General, AI Assistant, and Morning Briefing tabs for a much cleaner experience.
- **NAS & HTTP Support** - Fixed an issue preventing new feeds from being added over non-secure (HTTP) environments like Synology Docker containers by replacing `crypto.randomUUID()` with a wider-compatible ID generator. Also surfaced detailed DNS/network error messages to the UI to help debug connection issues.

### v1.3.0 (Feb 2026)
- **Smart AI Settings** - Configure separate API keys for OpenAI, Anthropic, Gemini, deepseek etc. Keys are automatically switched when you change providers.
- **Connection Testing** - "Test AI" button to verify your API key and network connection (with timeout protection).
- **Latest Models** - Updated default models to Feb 2026 state-of-the-art (GPT-4.1, Claude 3.6 Sonnet, Gemini 3.0 Pro).
- **UI Polish** - Added API key visibility toggle and removed deprecated sentiment analysis features.
- **Intelligent Briefing** - AI acts as a "News Intelligence Officer", selecting strategic headlines and summarizing key topics (no stock noise).
- **Telegram Formatting** - Switched to robust HTML messages with bot token management & testing UI.
- **Visual Overhaul** - Added 6 new themes (Nord, Dracula, etc.) with dynamic font switching (Inter, Fira Code) and collapsible settings UI.

### v1.2.0 (Feb 2026)
- **Inline Reading Column** - Article content now opens as a dedicated column next to the source feed, keeping all other columns visible
- **Separated Landing & Dashboard** - Dashboard is the default app view; the marketing landing page is served separately in production via `NEXT_PUBLIC_APP_MODE=landing`
- **Reading Column Styling** - Reading panel features a distinct accent-tinted background and border to differentiate it from feed columns

### v1.1.0 (Feb 2026)
- **OPML Import** - Bulk import feeds from Feedly, Inoreader, Google Reader
- **Summary Caching** - Stable article IDs prevent re-summarizing
- **Notification Rate Limiting** - 1-hour cooldown per article
- **Telegram Briefings** - Daily AI-curated news delivered to Telegram
- **Landing Page** - Product marketing page (served via `NEXT_PUBLIC_APP_MODE=landing`)
- **Stock Ticker** - Real-time portfolio with AI trading signals
- **8 Themes** - Including J.A.R.V.I.S., Matrix, Cyberpunk

## 📝 The Story Behind RSS Deck

I built RSS Deck because I missed the command-center feeling of TweetDeck, but wanted modern features:
- Full article content (not just snippets)
- Local AI for summarization and chat
- Beautiful, distraction-free reading

As someone who "can't code," I built this entirely through "vibe coding" with AI tools. If I can build this, imagine what you could create too.

[Read the full story →](vibe_coding_journey.md)

## 🤝 Contributing

Contributions are welcome! Whether you want to:
- Add new features
- Fix bugs
- Improve documentation
- Suggest themes

Open an issue or submit a PR!

## 📄 License

MIT License - feel free to use, modify, and share.

## 🙏 Acknowledgments

- [Next.js](https://nextjs.org/) - The React framework
- [Ollama](https://ollama.ai/) - Local AI made simple
- [Mozilla Readability](https://github.com/mozilla/readability) - Article parsing
- [Tailwind CSS](https://tailwindcss.com/) - Utility-first CSS

---

**Built with 💻 and 🤖 by Wong Kian Fong**

If this project inspires you, [give it a ⭐ on GitHub](https://github.com/mephistophelesbits/rssdeck)!

☕ **[Buy me a coffee](https://buymeacoffee.com/kianfongl)** — Support vibe coding and open source tools
# Trigger build
