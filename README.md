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
