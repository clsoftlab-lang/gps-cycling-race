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
  `recommend` (코스 추천), `digest` (오늘의 추천 코스 + 코치 목표 — on-load auto).
- Builds a grounded Korean prompt from `payload` and calls Claude with
  streaming, piping the text back as `text/plain` so the SPA renders it
  token-by-token.
- **Cost-efficient by default:** model `claude-haiku-4-5` (`AI_MODEL`), **prompt
  caching** on the stable per-task system block, modest per-task `max_tokens`,
  a **per-IP rate limit** and a **monthly token budget**.
- **Thinking/effort:** Haiku 4.5 sends **no** `thinking`/effort (it rejects them);
  raising `AI_MODEL` to `claude-sonnet-5` / `claude-opus-5` enables
  `thinking:{type:'adaptive'}` + `output_config:{effort: AI_EFFORT}`.
- **Guardrails → fallback:** over the rate limit or monthly cap the proxy returns
  **HTTP 429 `{fallback:true}`**, and the frontend auto-falls-back to the offline
  mock so the app never breaks (무인).
- `GET /health` returns `{ ok, model, keyLoaded, monthTokens, monthlyCap }`.

The task routing, prompts, model/caching rules and output caps are shared with the
Cloudflare Worker via [`ai-tasks.mjs`](ai-tasks.mjs), so both backends stay identical.

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
| `AI_MODEL` | — | `claude-haiku-4-5` | Cost-first default; raise to `claude-sonnet-5` / `claude-opus-5` |
| `AI_EFFORT` | — | `low` | Thinking effort — non-Haiku models only |
| `AI_MONTHLY_TOKEN_CAP` | — | `2000000` | Monthly token budget; over cap → `429 {fallback:true}` |
| `AI_RATE_PER_MIN` | — | `20` | Per-IP requests/min; over limit → `429 {fallback:true}` |
| `PORT` | — | `8787` | Listen port |
| `CORS_ORIGIN` | — | `*` | Restrict to your site origin in production |

## ☁️ Free deploy — Cloudflare Workers (`worker.js`, 무인)

For zero-maintenance hosting on Cloudflare's free tier (no server to babysit), use
the Worker variant. It calls the Anthropic REST API directly with the same task
routing + model/caching rules, and the key lives ONLY as a Worker **secret**.

```bash
cd server
npm i -g wrangler                      # once
wrangler secret put ANTHROPIC_API_KEY  # paste your key — never in wrangler.toml/repo
wrangler deploy                        # deploys worker.js per wrangler.toml
```

Then point the frontend at the Worker URL — in `../ai/config.js`:

```js
export const AI_ENDPOINT = "https://<your-worker>.workers.dev/api/ai";
```

Non-secret overrides (`AI_MODEL`, `AI_EFFORT`, `AI_RATE_PER_MIN`, `CORS_ORIGIN`)
live in `wrangler.toml [vars]`. The API key does **not** — it is a secret only.

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
