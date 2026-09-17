<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- Copyright 2026 CLSOFTLAB (씨엘소프트랩), Dr. Lee Il-guk (이일국) -->

# 🚴 GhostPace — GPS Cycling Race (Demo)

**Race ghosts and AI riders on a course in real time — chase the rider ahead, flee the one behind, climb the ranks.**

A working single-player-vs-ghosts cycling racing simulator that runs entirely in your browser. Pick a course, control your pace, watch your rider and several deterministic ghost/AI riders move live on a schematic track, earn points for chasing and escaping, save your best time to the course leaderboard, and replay your own ghost.

> 🇰🇷 한국어 문서: **[README.ko.md](README.ko.md)**

### 🔴 LIVE DEMO: https://clsoftlab-lang.github.io/gps-cycling-race/

---

## What it is

Outdoor-cycling competition, turned into a game. In a real product you would see other riders' *real* GPS positions on the same course and race them. This demo delivers the **feel and mechanics** of that with a genuine physics-lite race simulation — no servers, no accounts, no real GPS needed.

## How the race sim works

The race is a real tick-based simulation, not an animation script.

- **Course** = an inline-SVG closed-loop track generated deterministically from the course's `shapeSeed` (`render.js` → `trackPathD`). Riders are placed along the path by distance fraction using the browser's `getPointAtLength`.
- **Your rider** advances by a **speed you control** (a km/h slider, or 🤖 auto-pace). Each tick: `distance += speed(m/s) × dt`.
- **Ghost / AI riders** advance on **documented pace curves** (`ghostSpeedAt`): a base cruising speed × the current segment's difficulty factor (climb `< 1`, flat/descent `≥ 1`), shaped by each rider's `grit` (how well they hold pace on climbs), plus a small deterministic per-50 m effort ripple.
- Every tick the engine **computes standings** — sorts all riders by distance, assigns ranks, and computes the **gap** (metres + estimated seconds) to the rider immediately ahead and behind.
- **`requestAnimationFrame`** drives the loop in `app.js`; `dt` is clamped so tab-switches don't teleport riders.
- **Deterministic:** same `seed` + same sequence of your speeds + same `dt` sequence → byte-identical positions. This is what makes **ghost replays reproduce exactly**, and it's asserted by the unit tests in `check.mjs`.

The math lives in **`race-engine.js`** (pure, no DOM). Drawing lives in **`render.js`**. Orchestration/UI/storage lives in **`app.js`**.

## Features

- 🗺️ **6 courses** — 한강 라이트 루프, 강변북로 스프린트, 남산 힐클라임, 올림픽 벨로드롬, 북한강 롱라이드, 해안도로 크리테리움 (length, difficulty, terrain, segment profiles).
- 🏁 **Live race screen** — your rider + multiple ghost/AI riders moving on the track, live rank, speed, elapsed time, distance, and **gap to the rider ahead/behind**.
- 🎮 **Game elements** — points for **chase success** (overtaking) and **flee success** (opening a decisive gap), plus completion & finishing-position bonuses; **rank tiers** Bronze → Legend.
- 🏆 **Records & leaderboard** — per-course best time and a course leaderboard (your best vs a deterministic field).
- 👻 **Ghost replay** — your best run is recorded and can be raced against as a deterministic "내 고스트" rider.
- 👤 **Profile** — level, points, tier, badges, per-course bests.
- ➕ **Extras** — split-segment difficulty profiles, **mock heart-rate & cadence** readouts, and **wearable voice-cue example lines** ("추월 성공! 다음 라이더까지 밀어붙이세요.").
- 🌗 Light + dark theme, mobile-first responsive, energetic sporty Korean UI.

## Run locally

No build step. Any static file server works (ES modules + `fetch` need `http://`, not `file://`).

```bash
# from the repo root
python -m http.server 8993
# open http://localhost:8993
```

Then: **pick a course → 출발 → adjust your speed → chase/flee → finish → save best → replay your ghost.**

## 🟨 DEMO-MODE BOUNDARIES (read this)

**This is a DEMO. It is a simulation, not a real GPS multiplayer product.** Specifically:

- **The ghost/AI riders are simulated on a schematic course — NOT real people and NOT real GPS.** The track is a stylized loop, not a real map route.
- **Ghost pace comes from seed data + deterministic curves**, not from recorded real rides.
- **Records/points/best times persist to `localStorage` only — that is NOT a real database.** They live in one browser, can be wiped, and never sync.
- **There are NO accounts and NO PII.** Nothing is uploaded anywhere. Browser Geolocation is *not* used (a real build would make it optional and clearly labeled).
- **A real production build would add:** real GPS tracking, live multiplayer netcode (seeing other riders' actual positions), authenticated accounts, server-side anti-cheat, and a real leaderboard database.

All rider names, courses, and leaderboard entries are **fictional demo data**.

## Tech

- Plain **HTML + CSS + ES-module JavaScript**, relative paths, **no build / no dependencies**.
- Track & riders = **inline SVG**. Loop = `requestAnimationFrame`.
- `race-engine.js` (sim math) · `render.js` (drawing) · `app.js` (app) · `data/courses.json` (course + ghost data).
- **CI:** `node check.mjs` — validates JSON, runs `node --check` on all JS, verifies required containers in `index.html`, and **unit-tests `race-engine.js`** (positions, gaps, ranks, finish, scoring, determinism) — 40+ assertions.

## 🤖 AI 기능 (API 연동)

GhostPace ships a **secure, pluggable AI layer** with four features:

1. **AI 라이딩 코치 챗봇** (race screen) — pacing & training advice grounded in the
   chosen course's segment profile and your own best time / tier, plus live gap
   coaching mid-race.
2. **레이스 결과 분석/코멘터리** (result screen) — narrates a finished race from its
   splits, final rank, gaps, and points breakdown.
3. **코스 추천** (course-select screen) — suggests a course by your goal & level.
4. **오늘의 추천 코스 + 코치 목표** (course-select screen) — an **autonomous, on-load**
   briefing built from your courses + best times. It generates itself when the app
   opens and works offline via the mock.

**Demo = mock (default).** With `ai/config.js` → `AI_ENDPOINT = ""`, all four run
against a **deterministic Korean MockProvider** (`ai/ai.js`) built from the app's
own courses / race data / best times. No network, no account, no key.

**Enable real Claude** via the backend proxy in [`server/`](server/):

```bash
cd server
cp .env.example .env      # paste your key into .env
npm install && npm run start:env
```

then set `ai/config.js` → `AI_ENDPOINT = "http://localhost:8787/api/ai"` and
reload. The proxy calls Claude (default model **`claude-haiku-4-5`**, streamed) and
pipes the reply back token-by-token. See the 고도화 section below for the
cost-efficient / free-hosting / autonomous details.

> **🔒 Keys are server-side ONLY — never in the browser or repo.** The
> `ANTHROPIC_API_KEY` lives exclusively in `server/.env`
> (`process.env.ANTHROPIC_API_KEY`) or the Cloudflare Worker secret, and is
> **never** placed in the browser, in `ai/config.js`, or anywhere in the repo.
> `.env` is git-ignored, and `node check.mjs` scans the source for a real key
> format and fails if one is ever committed.

## ⚙️ 고도화 — 무인·저비용 실 AI 연동

The AI layer is tuned to run **unmanned (무인)** and **cost-efficiently (저비용)**
on **real Claude**, while never breaking.

**Cost model.** Default model **`claude-haiku-4-5`** (**$1 / MTok input, $5 / MTok
output**), configurable via `AI_MODEL` (raise to `claude-sonnet-5` / `claude-opus-5`
for higher quality). On top of that:

- **Prompt caching** — the stable per-task system prompt is sent as a
  `cache_control:{type:'ephemeral'}` block, so repeated calls read it from cache
  and pay far less on input.
- **Output caps** — a modest per-task `max_tokens` (~400–700).
- **Thinking only where it helps** — Haiku sends no `thinking`/effort (it rejects
  them, avoiding 400s); larger models get `thinking:{type:'adaptive'}` +
  `output_config:{effort}`.
- **Budget + rate limit** — a per-IP rate limit (`AI_RATE_PER_MIN`, default 20/min)
  and a **monthly token cap** (`AI_MONTHLY_TOKEN_CAP`, default 2,000,000). Over
  either, the backend returns **HTTP 429 `{fallback:true}`**.

**Rough cost.** A typical grounded request is ~1.5K input + ~0.4K output tokens →
about **$0.003–0.004 each**, i.e. **≈ $3–4 per 1,000 requests** on Haiku 4.5 —
lower once prompt caching warms up.

**Free, unmanned hosting.** A **Cloudflare Workers** variant
([`server/worker.js`](server/worker.js) + [`wrangler.toml`](server/wrangler.toml))
runs the same logic on Cloudflare's free tier — one deploy, no server to babysit:

```bash
cd server
wrangler secret put ANTHROPIC_API_KEY   # key is a SECRET, never in the repo
wrangler deploy
```

**Autonomous & never-breaks.** If the endpoint fails, is rate-limited, hits the
monthly cap (`429 {fallback:true}`), or the network is down, `ai/ai.js`
**auto-falls-back to the offline mock** — so the app keeps working with zero
attention. The "오늘의 추천 코스 + 코치 목표" briefing generates itself on load and
works fully offline the same way.

> **🔒 API keys are server-side only — never in the browser or repo.** The key
> lives only in `server/.env` or as the Cloudflare Worker secret.

## Contributors

- **Dr. Lee Il-guk (이일국)** — concept, direction
- **LWJ**, **LMJ** — contributors
- **Claude** (Anthropic) — implementation assistance

## License

- Code: **Apache-2.0** — see [LICENSE](LICENSE).
- Documentation: **CC BY 4.0**.
- SPDX headers and `Copyright 2026 CLSOFTLAB (씨엘소프트랩), Dr. Lee Il-guk (이일국)` throughout.

---

*Not an official Anthropic product.*

## 🎓 Idea origin

The seed idea for this project came from the **entrepreneurship class taught by Dr. Lee Il-guk (이일국) at Yongin University (용인대학교)**. The students in that class produced startup ideas of remarkable, standout creativity — this project is one of those exceptional ideas, finally brought to life as a working service. Built with deep admiration and gratitude for those students' imagination. *(No student personal information is included; only the idea itself was used, implemented clean-room.)*
