// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 CLSOFTLAB (씨엘소프트랩), Dr. Lee Il-guk (이일국)
//
// check.mjs — CI verification for GhostPace.
//  1) courses.json parses and has valid shape
//  2) index.html has all required containers
//  3) unit tests for race-engine.js: positions / gaps / rank / finish +
//     determinism, computed and asserted numerically.
// Run: node check.mjs  (exit 0 = pass, 1 = fail)

import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  createRace, tick, snapshot, scoreTransition, computeStandings,
  kmhToMs, msToKmh, tierFor, levelFor, buildGhosts, gapBetween,
} from './race-engine.js';
import { AI_ENDPOINT } from './ai/config.js';

const ROOT = dirname(fileURLToPath(import.meta.url));
let pass = 0, fail = 0;
const fails = [];

function ok(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; fails.push(name + (extra ? ` — ${extra}` : '')); console.log(`  ✗ ${name}${extra ? ' — ' + extra : ''}`); }
}
function approx(a, b, eps = 1e-6) { return Math.abs(a - b) <= eps; }

// A fixed synthetic course the engine tests fully control.
const TEST_COURSE = {
  id: 'test', name: 'Test', shapeSeed: 7, lengthKm: 10.0,
  segments: [{ frac: 1, factor: 1 }],
  ghosts: [
    { id: 'a', name: 'A', baseKmh: 24, grit: 0.6, color: '#111' },
    { id: 'b', name: 'B', baseKmh: 30, grit: 0.7, color: '#222' },
    { id: 'c', name: 'C', baseKmh: 20, grit: 0.5, color: '#333' },
  ],
};

// -------------------------------------------------------------------------
console.log('\n[1] data/courses.json');
try {
  const raw = await readFile(join(ROOT, 'data', 'courses.json'), 'utf8');
  const data = JSON.parse(raw);
  ok('courses.json parses', true);
  ok('has >= 6 courses', (data.courses || []).length >= 6, `got ${data.courses?.length}`);
  let shapeOk = true, reasons = [];
  for (const c of data.courses) {
    if (!c.id || !c.name) { shapeOk = false; reasons.push('missing id/name'); }
    if (!(c.lengthKm > 0)) { shapeOk = false; reasons.push(`${c.id} bad lengthKm`); }
    if (!Array.isArray(c.segments) || !c.segments.length) { shapeOk = false; reasons.push(`${c.id} no segments`); }
    const sum = (c.segments || []).reduce((a, s) => a + s.frac, 0);
    if (!approx(sum, 1, 1e-6)) { shapeOk = false; reasons.push(`${c.id} seg frac sum ${sum}`); }
    if (!Array.isArray(c.ghosts) || c.ghosts.length < 1) { shapeOk = false; reasons.push(`${c.id} no ghosts`); }
  }
  ok('every course well-formed (segments sum to 1, has ghosts)', shapeOk, reasons.join('; '));
} catch (e) {
  ok('courses.json parses', false, e.message);
}

// -------------------------------------------------------------------------
console.log('\n[2] index.html required containers');
try {
  const html = await readFile(join(ROOT, 'index.html'), 'utf8');
  const required = ['course-list', 'track-svg', 'standings', 'hud', 'speed-slider', 'profile', 'leaderboard'];
  for (const id of required) ok(`#${id} present`, new RegExp(`id=["']${id}["']`).test(html));
  ok('loads app.js as module', /<script[^>]*type=["']module["'][^>]*src=["']app\.js["']/.test(html));
} catch (e) {
  ok('index.html readable', false, e.message);
}

// -------------------------------------------------------------------------
console.log('\n[3] node --check on all JS');
for (const f of ['race-engine.js', 'render.js', 'app.js', 'check.mjs']) {
  try {
    execFileSync(process.execPath, ['--check', join(ROOT, f)], { stdio: 'pipe' });
    ok(`node --check ${f}`, true);
  } catch (e) {
    ok(`node --check ${f}`, false, String(e.stderr || e.message).split('\n')[0]);
  }
}

// -------------------------------------------------------------------------
console.log('\n[4] race-engine unit tests');

// 4a) position math: constant 36 km/h = 10 m/s; 100 ticks * 0.1s = 100 m
{
  const r = createRace(TEST_COURSE, 12345);
  for (let i = 0; i < 100; i++) tick(r, 0.1, 36);
  ok('player advances by speed*time (36km/h,10s => 100m)', approx(r.player.distance, 100, 1e-6), `got ${r.player.distance}`);
  ok('player speed stored as m/s (10)', approx(r.player.speedMs, 10, 1e-9), `got ${r.player.speedMs}`);
  ok('kmh<->ms round-trip', approx(msToKmh(kmhToMs(28)), 28, 1e-9));
}

// 4b) determinism: two identical runs -> identical rider distances
{
  const run = () => {
    const r = createRace(TEST_COURSE, 999);
    const speeds = [20, 25, 30, 28, 33, 31, 29, 27, 35, 40];
    for (let i = 0; i < 200; i++) tick(r, 0.05, speeds[i % speeds.length]);
    return r.riders.map((x) => x.distance);
  };
  const A = run(), B = run();
  const same = A.length === B.length && A.every((v, i) => v === B[i]);
  ok('deterministic ghosts (same seed+inputs => identical distances)', same, same ? '' : `A=${A}, B=${B}`);
}

// 4c) different seeds => different ghost trajectories (not degenerate)
{
  const g1 = buildGhosts(TEST_COURSE, 1)[0];
  const g2 = buildGhosts(TEST_COURSE, 2)[0];
  ok('different seeds give different ghost base pace', g1.baseKmh !== g2.baseKmh, `${g1.baseKmh} vs ${g2.baseKmh}`);
}

// 4d) rank + gap: player at 42 km/h passes slower ghosts over time
{
  const r = createRace(TEST_COURSE, 555);
  for (let i = 0; i < 40; i++) tick(r, 0.25, 42); // 10s @ ~11.67 m/s => ~116m
  computeStandings(r);
  ok('standings computed for all riders', r.standings.length === r.riders.length);
  const ranksUnique = new Set(r.standings.map((x) => x.rank)).size === r.riders.length;
  ok('ranks are unique 1..N', ranksUnique);
  ok('player rank within [1,N]', r.player.rank >= 1 && r.player.rank <= r.riders.length);
  // player faster than all ghost base paces (max 30) so should be leading
  ok('fast player reaches rank 1', r.player.rank === 1, `rank ${r.player.rank}`);
  ok('leader has no ahead-gap', r.gapAhead === null);
  ok('behind-gap is positive distance', r.gapBehind && r.gapBehind.distanceM > 0, JSON.stringify(r.gapBehind));
}

// 4e) gapBetween pure math
{
  const lead = { distance: 250, speedMs: 10 };
  const trail = { distance: 100, speedMs: 10 };
  const g = gapBetween(lead, trail);
  ok('gap distance = 150m', approx(g.distanceM, 150));
  ok('gap time = dist/trailSpeed = 15s', approx(g.timeS, 15), `got ${g.timeS}`);
}

// 4f) finish detection + clamp
{
  const shortCourse = { ...TEST_COURSE, lengthKm: 0.5 }; // 500 m
  const r = createRace(shortCourse, 42);
  let ticks = 0;
  while (!r.finished && ticks < 10000) { tick(r, 0.1, 40); ticks++; }
  ok('race finishes on short course', r.finished, `after ${ticks} ticks`);
  ok('player marked finished', r.player.finished);
  ok('player distance clamped to length (500m)', approx(r.player.distance, 500, 1e-6), `got ${r.player.distance}`);
  ok('finishTime recorded and positive', r.player.finishTime > 0);
  // 40 km/h = 11.111 m/s, 500m => ~45s. sanity window.
  ok('finishTime in sane range (40..55s)', r.player.finishTime > 40 && r.player.finishTime < 55, `got ${r.player.finishTime}`);
}

// 4g) scoring: overtaking (rank improves) yields chase points
{
  const prev = { playerRank: 3, gapAheadM: 10, gapBehindM: 5 };
  const curr = { playerRank: 1, gapAheadM: null, gapBehindM: 40 };
  const res = scoreTransition(prev, curr, { chasePoints: 100 });
  ok('chase from rank 3->1 gives 200 pts (2 places)', res.points === 200, `got ${res.points}`);
  ok('chase event emitted', res.events.some((e) => e.type === 'chase'));
  // flee: opening gap past threshold
  const res2 = scoreTransition({ playerRank: 2, gapBehindM: 30 }, { playerRank: 2, gapBehindM: 70 }, { fleeGapMeters: 60, fleePoints: 80 });
  ok('flee past 60m threshold gives 80 pts', res2.points === 80, `got ${res2.points}`);
  const res3 = scoreTransition({ playerRank: 2, gapBehindM: 30 }, { playerRank: 2, gapBehindM: 40 }, {});
  ok('no points when nothing decisive happens', res3.points === 0);
}

// 4h) tiers & levels monotonic
{
  ok('0 pts => Bronze', tierFor(0).name === 'Bronze');
  ok('5000 pts => Gold', tierFor(5000).name === 'Gold');
  ok('40000 pts => Legend', tierFor(40000).name === 'Legend');
  ok('level rises with points', levelFor(10000) > levelFor(100));
}

// 4i) snapshot shape
{
  const r = createRace(TEST_COURSE, 1);
  tick(r, 0.1, 28);
  const s = snapshot(r);
  ok('snapshot has playerRank + gaps + elapsed', 'playerRank' in s && 'gapAheadM' in s && 'gapBehindM' in s && 'elapsed' in s);
}

// -------------------------------------------------------------------------
console.log('\n[5] AI layer — syntax + security');

// 5a) node --check on every AI + server source file
for (const f of ['ai/config.js', 'ai/ai.js', 'ai/ai-ui.js', 'server/index.mjs']) {
  try {
    execFileSync(process.execPath, ['--check', join(ROOT, f)], { stdio: 'pipe' });
    ok(`node --check ${f}`, true);
  } catch (e) {
    ok(`node --check ${f}`, false, String(e.stderr || e.message).split('\n')[0]);
  }
}

// 5b) demo must ship with AI_ENDPOINT empty (mock provider active, no backend)
ok('AI_ENDPOINT is empty (demo = mock)', AI_ENDPOINT === '', `got ${JSON.stringify(AI_ENDPOINT)}`);

// 5c) no real Anthropic API key committed anywhere in the AI/server surface.
//     Regex is assembled from parts so THIS scanner never contains a literal key.
{
  const KEY_RE = new RegExp('sk-' + 'ant-[A-Za-z0-9_-]{20,}');
  const scanFiles = [
    'ai/config.js', 'ai/ai.js', 'ai/ai-ui.js',
    'server/index.mjs', 'server/package.json', 'server/.env.example', 'server/README.md',
    'README.md', 'README.ko.md',
  ];
  const leaked = [];
  for (const f of scanFiles) {
    try {
      const t = await readFile(join(ROOT, f), 'utf8');
      if (KEY_RE.test(t)) leaked.push(f);
    } catch (e) { /* file may be absent; skip */ }
  }
  ok('no real API key format present in source', leaked.length === 0, leaked.join(', '));
  // .env (the real one) must never be committed / present in the working tree
  let envPresent = false;
  try { await readFile(join(ROOT, 'server', '.env'), 'utf8'); envPresent = true; } catch (e) { /* good */ }
  ok('server/.env is not committed', !envPresent, envPresent ? 'server/.env exists — do not commit it' : '');
}

// -------------------------------------------------------------------------
console.log(`\n──────────────────────────────`);
console.log(`RESULT: ${pass} passed, ${fail} failed`);
if (fail) { console.log('FAILURES:\n - ' + fails.join('\n - ')); process.exit(1); }
console.log('ALL CHECKS PASSED ✅');
process.exit(0);
