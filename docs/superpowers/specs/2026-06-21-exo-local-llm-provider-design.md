# exo-labs as a local LLM provider

**Date:** 2026-06-21
**Status:** Approved (design)

## Goal

Let IntelliDeck use a local [exo-labs](https://github.com/exo-explore/exo) cluster as the
chat/generation provider, selectable from Settings like any other provider. Embeddings stay
on Ollama. exo is added alongside the existing providers — Ollama is not replaced.

## Background

exo exposes an **OpenAI-compatible** API (default `http://localhost:52415/v1/chat/completions`),
runs locally, and needs **no API key**. In provider terms it is the OpenAI path with a
configurable base URL and no `Authorization` header.

Two facts from the current code shape the design:

1. Embeddings are hardcoded to Ollama (`embedText('ollama', …)` in
   `lib/server/articles-repository.ts:765`) and read `settings.baseUrl`.
2. Generation reads the *same* `settings.baseUrl`, which today is just `aiSettings.ollamaUrl`
   (`lib/server/settings-repository.ts:99`).

Because exo runs on a different port (52415) than Ollama (11434), and Ollama must keep serving
embeddings while exo serves generation, a single shared `baseUrl` cannot serve both. The design
separates the generation base URL from the embedding base URL.

## Decisions

- exo default endpoint: `http://localhost:52415/v1` (runs on this machine).
- Embeddings remain on Ollama (`nomic-embed-text`); exo is generation-only. exo's embedding
  support is limited, and "add a provider" does not mean replacing Ollama.

## Changes

### 1. Provider layer — `lib/ai/providers.ts`

- Add `'exo'` to the `AIProvider` union.
- Add `generateExo` and `generateChatExo`. These are the existing OpenAI-compatible shape with:
  - `baseUrl` defaulting to `http://localhost:52415/v1`,
  - no API key / no `Authorization` header,
  - the standard `/chat/completions` body and `choices[0].message.content` parsing.
- Refactor: extract the shared OpenAI-compatible request/response body used by openai, kimi,
  minimax, nvidia, and now exo into one helper (e.g. `generateOpenAICompatible(messages, {
  url, apiKey?, model, ... })`). This avoids duplicating a fifth near-identical function. The
  refactor is limited to these already-near-identical functions; no behavior change for existing
  providers. `embedText` adds no exo branch (exo is generation-only).
- Wire `exo` into the `generateText` and `generateChat` switch statements.

### 2. Settings store — `lib/settings-store.ts`

- Add `'exo'` to the `provider` union in `aiSettings`.
- Add `exoUrl: string` next to `ollamaUrl`.
- Default `exoUrl: 'http://localhost:52415/v1'` in `getDefaultSettingsSnapshot`.

### 3. Server settings resolver — `lib/server/settings-repository.ts`

- Add `'exo'` to the `provider` union and to `ServerAISettings`.
- Add `embedBaseUrl: string` to `ServerAISettings`.
- In `getServerAISettings`:
  - `baseUrl = aiSettings.provider === 'exo' ? aiSettings.exoUrl : aiSettings.ollamaUrl`
  - `embedBaseUrl = aiSettings.ollamaUrl` (always Ollama)
  - `apiKey` stays `aiSettings.apiKeys?.[provider]` (undefined for exo, which is fine).

### 4. Embedding call site — `lib/server/articles-repository.ts`

- Change the embed call to use `settings.embedBaseUrl` instead of `settings.baseUrl`, so
  embeddings always hit Ollama even when the chat provider is exo.

### 5. Settings UI — `components/ui/SettingsModal.tsx`

- Add `<option value="exo">{t('settings.exoLocal')}</option>` to the provider select.
- Add a default model when switching to exo (the select's `onChange` already sets a per-provider
  default model; use a sensible exo default, e.g. the model name the user's cluster serves —
  placeholder `llama-3.2-3b`, editable).
- Treat exo like Ollama in the panel: show a local-URL field bound to `exoUrl` (not the API-key
  field), and a connection check against the exo endpoint. The existing Ollama connection-check
  block is `provider === 'ollama'`-gated; add an analogous exo branch (or generalize the
  condition to `provider === 'ollama' || provider === 'exo'` with the URL/value swapped by
  provider).

### 6. i18n — `lib/i18n/en.json`, `lib/i18n/zh-CN.json`

- Add `settings.exoLocal` (e.g. "exo (Local Cluster)" / "exo（本地集群）").
- Add any exo-specific URL/help label strings used by the UI branch.

## Out of scope

- exo embeddings.
- Replacing or removing Ollama.
- Multi-node / cluster discovery UI — the user points IntelliDeck at one exo endpoint URL.

## Testing

- Unit: add an exo case to the provider tests mirroring the OpenAI-compatible test shape (mock
  `fetch`, assert the request hits the exo base URL with no `Authorization` header and parses
  `choices[0].message.content`).
- Verify the existing `providers.embed.test.ts` still passes unchanged (embeddings untouched).
- Manual: in Settings, select exo, confirm the URL field + connection check appear and the
  API-key field does not; run an enrichment and confirm generation goes to exo while embeddings
  still go to Ollama.
