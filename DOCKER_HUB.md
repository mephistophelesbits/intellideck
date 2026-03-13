# RSS Deck

![RSS Deck Screenshot](https://raw.githubusercontent.com/mephistophelesbits/rssdeck/main/docs/screenshot.png)

**RSS Deck** is a modern, privacy-first, multi-column RSS reader featuring a TweetDeck-style interface with deep local AI integration. Everything runs locally on your machine—no cloud subscriptions, no paywalls, no tracking.

## ✨ Key Features

- **Multi-Column Dashboard:** Organize your news sources side-by-side with adjustable column widths.
- **Local AI Powered (Ollama):** Instant article summarization and free-form chat with your news using models like Llama 3 or Mistral.
- **Full Article Extraction:** Built-in web scraper extracts full article text, bypassing "read more" buttons and ad-heavy sites.
- **Custom Prompts:** Write your own AI instructions for custom research summaries and morning briefings.
- **Daily Telegram Briefings:** Connect a Telegram bot to get a curated, AI-summarized morning briefing of your top feeds.
- **Privacy First:** Your feeds, settings, and reading history stay completely in your local browser storage.

## 🚀 Quick Start (Docker)

To run the latest version of RSS Deck, simply execute:

```bash
docker run -d -p 3000:3000 -v rss-data:/app/data --name rssdeck kianfong/rssdeck:latest
```

*Note: For Apple Silicon (M1/M2/M3) users, you may need to append `--platform linux/amd64` to the command, or build the image locally from source.*

### Docker Compose

```yaml
version: '3.8'

services:
  rss-deck:
    image: kianfong/rssdeck:latest
    container_name: rss-deck
    ports:
      - "3000:3000"
    restart: unless-stopped
    volumes:
      - rss-deck-data:/app/data

volumes:
  rss-deck-data:
```

## 🧠 Connecting to Local AI (Ollama)
For the AI features to work, you will need a running instance of [Ollama](https://ollama.ai/) accessible by the container. RSS Deck defaults to looking for Ollama at `http://localhost:11434`. 
You can easily spin up Ollama locally and pull a model:
```bash
ollama run llama3.2
```

## 🔗 Links

- **GitHub Repository**: [mephistophelesbits/rssdeck](https://github.com/mephistophelesbits/rssdeck)
- **Bug Tracker**: [Issues](https://github.com/mephistophelesbits/rssdeck/issues)
