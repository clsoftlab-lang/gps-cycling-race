<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- Copyright 2026 CLSOFTLAB (씨엘소프트랩), Dr. Lee Il-guk (이일국) -->

# GhostPace AI Proxy (`server/`)

A tiny Node backend that adds **real Claude** to GhostPace. It is the **only**
place the Anthropic API key is ever used — **the browser never sees the key.**

Without this server, GhostPace runs in **DEMO MODE** using a deterministic Korean
MockProvider (`ai/ai.js`). The proxy is opt-in.

## What it does

- Exposes `POST /api/ai` accepting `{ "task", "payload" }`.
- `task` is one of `coach` (AI 라이딩 코치), `commentary` (레이스 코멘터리),
  `recommend` (코스 추천).
- Builds a grounded Korean prompt from `payload` and calls Claude with
  streaming (`model: claude-opus-5`, adaptive thinking), piping the text back as
  `text/plain` so the SPA renders it token-by-token.
- `GET /health` returns `{ ok, model, keyLoaded }`.

## Setup

```bash
cd server
cp .env.example .env          # then edit .env and paste your key
npm install                   # installs @anthropic-ai/sdk
npm run start:env             # loads .env (Node >= 20.6), listens on :8787
# — or, if you export ANTHROPIC_API_KEY yourself —
npm start
```

Then point the frontend at it — in `../ai/config.js`:

```js
export const AI_ENDPOINT = "http://localhost:8787/api/ai";
```

Reload the SPA and the AI panels now stream live Claude responses.

## Environment (`.env`)

| Variable | Required | Default | Notes |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | ✅ | — | **Server-side only. Never commit it.** |
| `ANTHROPIC_MODEL` | — | `claude-opus-5` | Model id |
| `PORT` | — | `8787` | Listen port |
| `CORS_ORIGIN` | — | `*` | Restrict to your site origin in production |

## Security

- **The key lives only in `server/.env` → `process.env.ANTHROPIC_API_KEY`.**
  It is never embedded in the browser bundle, `ai/config.js`, or the repo.
- `.env` is git-ignored. Only `.env.example` (no real value) is committed.
- Requests are size-capped and CORS-scoped; set `CORS_ORIGIN` to your domain in
  production.

## Notes

- No key on disk in the repo, and `node check.mjs` (repo root) scans the source
  for a real key format and fails if one is ever committed.
- This proxy is stateless; add rate limiting / auth before public exposure.

*Not an official Anthropic product.*
