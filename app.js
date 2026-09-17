// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 CLSOFTLAB (씨엘소프트랩), Dr. Lee Il-guk (이일국)
//
// app.js — SPA orchestration. Loads courses, drives the race loop with
// requestAnimationFrame, applies scoring, persists to localStorage, and wires
// the screens (course select / race / result / profile). DEMO MODE only.

import {
  createRace, tick, snapshot, scoreTransition, fmtTime,
  msToKmh, tierFor, levelFor, kmhToMs,
} from './race-engine.js';
import { buildTrack, drawRiders, drawStandings } from './render.js';
import { initAiUi } from './ai/ai-ui.js';

const STORE_KEY = 'ghostpace.v1';
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

// --------------------------------------------------------------------------
// Persistent store (localStorage with try/catch + reset)
// --------------------------------------------------------------------------
const DEFAULT_STATE = { points: 0, badges: [], best: {}, runs: 0, ghosts: {} };

function loadStore() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return { ...DEFAULT_STATE };
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_STATE, ...parsed };
  } catch (e) {
    console.warn('store load failed, using defaults', e);
    return { ...DEFAULT_STATE };
  }
}
function saveStore(s) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(s));
  } catch (e) {
    console.warn('store save failed (demo continues in-memory)', e);
  }
}
function wipeStore() {
  try { localStorage.removeItem(STORE_KEY); } catch (e) { /* ignore */ }
  store = { ...DEFAULT_STATE };
  saveStore(store);
}

let store = loadStore();

// --------------------------------------------------------------------------
// Voice-line examples (wearable audio cue text — mock)
// --------------------------------------------------------------------------
const VOICE = {
  chase: ['추월 성공! 다음 라이더까지 밀어붙이세요.', '한 명 제쳤습니다. 페이스 유지!', '순위 상승! 앞을 노리세요.'],
  flee: ['따돌렸습니다! 간격을 벌리세요.', '뒤 라이더 떨궜습니다. 좋아요!', '도주 성공, 이 속도 유지!'],
  caught: ['뒤에 라이더가 붙었습니다. 스퍼트!', '추격당하는 중, 속도를 올리세요.'],
  finish: ['피니시! 기록을 확인하세요.', '완주했습니다. 수고하셨습니다!'],
};
function say(kind) {
  const arr = VOICE[kind] || [];
  if (!arr.length) return;
  const t = arr[Math.floor(Math.random() * arr.length)];
  const box = $('#voice-line');
  box.textContent = '🔊 ' + t;
  box.classList.add('show');
  clearTimeout(box._t);
  box._t = setTimeout(() => box.classList.remove('show'), 2600);
}

// --------------------------------------------------------------------------
// App state
// --------------------------------------------------------------------------
let COURSES = [];
let current = { course: null, race: null, scene: null, prevSnap: null, sessionPoints: 0, recording: [], running: false, auto: false, raf: 0, lastTs: 0, useGhost: false };

// --------------------------------------------------------------------------
// Screen navigation
// --------------------------------------------------------------------------
function go(name) {
  $$('.screen').forEach((s) => s.classList.remove('active'));
  const scr = $('#screen-' + name);
  if (scr) scr.classList.add('active');
  if (name === 'profile') renderProfile();
  if (name === 'courses') stopLoop();
  window.scrollTo(0, 0);
}

// --------------------------------------------------------------------------
// Course list
// --------------------------------------------------------------------------
function renderCourses() {
  const wrap = $('#course-list');
  wrap.innerHTML = COURSES.map((c) => {
    const best = store.best[c.id];
    const bt = best ? fmtTime(best.time) : '—';
    const diffClass = c.difficultyEn ? c.difficultyEn.toLowerCase() : 'medium';
    return `<article class="course-card" data-id="${c.id}">
      <div class="cc-top" style="--accent:${c.color}">
        <span class="diff ${diffClass}">${c.difficulty}</span>
        <span class="len">${c.lengthKm} km</span>
      </div>
      <h3>${c.name}</h3>
      <p class="cc-desc">${c.desc}</p>
      <div class="cc-meta">
        <span>🏁 ${c.terrain}</span>
        <span>👤 ${c.ghosts.length} 라이더</span>
      </div>
      <div class="cc-best"><span>내 베스트</span><b>${bt}</b></div>
      <button class="btn primary block" data-race="${c.id}">레이스 시작</button>
    </article>`;
  }).join('');
}

// --------------------------------------------------------------------------
// Race setup
// --------------------------------------------------------------------------
function openRace(courseId) {
  const course = COURSES.find((c) => c.id === courseId);
  if (!course) return;
  current.course = course;
  current.useGhost = !!store.ghosts[courseId];
  $('#race-title').textContent = course.name;
  $('#race-tier').textContent = tierFor(store.points).name;
  go('race');
  setupRace();
}

function setupRace() {
  const course = current.course;
  // deterministic seed per course; replays reproduce identically
  const seed = (course.shapeSeed || 1) * 2654435761 >>> 0;
  const race = createRace(course, seed, { playerName: '나' });
  race.lengthM = race.lengthM || Math.round(course.lengthKm * 1000);

  // optional: add my stored best-run ghost as an extra deterministic rider
  const rec = current.useGhost ? store.ghosts[course.id] : null;
  if (rec && rec.samples && rec.samples.length > 1) {
    const gh = {
      id: 'myghost', name: '내 고스트', kind: 'replay', color: '#ffd166',
      distance: 0, speedMs: 0, finished: false, finishTime: null, rank: 0,
      _rec: rec, _replay: true,
    };
    race.ghosts.push(gh);
    race.riders.push(gh);
  }

  const scene = buildTrack($('#track-svg'), course, race.riders);
  current.race = race;
  current.scene = scene;
  current.prevSnap = snapshot(race);
  current.sessionPoints = 0;
  current.recording = [];
  current.running = false;
  current.lastTs = 0;
  import_computeStandings(race); // seed ranks/gaps so HUD shows sensible pre-start values
  drawRiders(scene, race);
  drawStandings($('#standings'), race);
  updateHUD();
  $('#btn-start').textContent = '▶ 출발';
}

// replay ghost distance from its recording at time t (linear interp)
function replayDistanceAt(rec, t) {
  const s = rec.samples;
  if (t <= s[0].t) return s[0].d;
  const last = s[s.length - 1];
  if (t >= last.t) return last.d;
  // binary-ish linear scan (recordings are small, downsampled)
  for (let i = 1; i < s.length; i++) {
    if (t <= s[i].t) {
      const a = s[i - 1], b = s[i];
      const f = (t - a.t) / (b.t - a.t || 1);
      return a.d + (b.d - a.d) * f;
    }
  }
  return last.d;
}

// --------------------------------------------------------------------------
// Race loop
// --------------------------------------------------------------------------
function startLoop() {
  if (current.running || !current.race) return;
  if (current.race.finished) return;
  current.running = true;
  current.lastTs = performance.now();
  $('#btn-start').textContent = '⏸ 일시정지';
  current.raf = requestAnimationFrame(frame);
}
function stopLoop() {
  current.running = false;
  if (current.raf) cancelAnimationFrame(current.raf);
  current.raf = 0;
  if ($('#btn-start')) $('#btn-start').textContent = '▶ 출발';
}

function frame(ts) {
  if (!current.running) return;
  let dt = (ts - current.lastTs) / 1000;
  current.lastTs = ts;
  if (dt > 0.1) dt = 0.1; // clamp big gaps (tab switches)
  stepRace(dt);
  if (current.race.finished) {
    finishRace();
    return;
  }
  current.raf = requestAnimationFrame(frame);
}

// One simulation step (also reused conceptually by the engine tests).
function stepRace(dt) {
  const race = current.race;
  const speedKmh = current.auto ? autoPace(race) : parseFloat($('#speed-slider').value);

  // advance replay ghost before/after tick (engine ignores unknown riders)
  const before = race.elapsed;
  tick(race, dt, speedKmh);
  // move replay rider along its recording
  for (const g of race.ghosts) {
    if (g._replay && !g.finished) {
      const d = replayDistanceAt(g._rec, race.elapsed);
      g.speedMs = (d - g.distance) / (race.elapsed - before || dt);
      g.distance = Math.min(d, race.lengthM);
      if (g.distance >= race.lengthM) { g.finished = true; g.finishTime = race.elapsed; }
    }
  }
  // recompute standings including replay rider movement
  import_computeStandings(race);

  // record player trace (downsample ~5 Hz)
  const rec = current.recording;
  if (!rec.length || race.elapsed - rec[rec.length - 1].t >= 0.2) {
    rec.push({ t: +race.elapsed.toFixed(2), d: +race.player.distance.toFixed(1) });
  }

  // scoring
  const snap = snapshot(race);
  const { points, events } = scoreTransition(current.prevSnap, snap, {});
  if (points) {
    current.sessionPoints += points;
    for (const e of events) say(e.type === 'chase' ? 'chase' : 'flee');
  } else if (current.prevSnap.gapBehindM != null && snap.gapBehindM != null &&
             current.prevSnap.gapBehindM > 25 && snap.gapBehindM <= 25) {
    say('caught');
  }
  current.prevSnap = snap;

  drawRiders(current.scene, race);
  drawStandings($('#standings'), race);
  updateHUD();
}

// Recompute standings (import a tiny helper without extra module churn).
function import_computeStandings(race) {
  // mirrors engine.computeStandings but included here so replay-rider moves
  // are reflected; engine already ran once inside tick().
  const sorted = [...race.riders].sort((a, b) => b.distance - a.distance);
  sorted.forEach((r, i) => (r.rank = i + 1));
  race.standings = sorted;
  const idx = sorted.findIndex((r) => r.id === 'player');
  const ahead = idx > 0 ? sorted[idx - 1] : null;
  const behind = idx < sorted.length - 1 ? sorted[idx + 1] : null;
  const p = race.player;
  const gap = (lead, trail) => ({
    distanceM: Math.max(0, lead.distance - trail.distance),
    timeS: Math.max(0, lead.distance - trail.distance) / Math.max(kmhToMs(3), trail.speedMs || kmhToMs(3)),
  });
  race.gapAhead = ahead ? gap(ahead, p) : null;
  race.gapBehind = behind ? gap(p, behind) : null;
  race.aheadRider = ahead;
  race.behindRider = behind;
}

// Auto-pace AI for the player: hold ~92% of the strongest ghost's base pace,
// surging when a rival is within 20 m ahead.
function autoPace(race) {
  const rivals = race.ghosts.filter((g) => !g._replay);
  const top = rivals.reduce((m, g) => Math.max(m, g.baseKmh || 0), 26);
  let target = top * 0.98;
  if (race.gapAhead && race.gapAhead.distanceM < 20) target = top * 1.08;
  const v = Math.min(45, target);
  $('#speed-slider').value = v.toFixed(1);
  $('#speed-val').textContent = v.toFixed(0);
  return v;
}

// --------------------------------------------------------------------------
// HUD
// --------------------------------------------------------------------------
function updateHUD() {
  const race = current.race;
  if (!race) return;
  const p = race.player;
  $('#hud-rank').textContent = `${p.rank}/${race.riders.length}`;
  $('#hud-speed').textContent = msToKmh(p.speedMs).toFixed(0);
  $('#hud-time').textContent = fmtTime(race.elapsed);
  $('#hud-dist').textContent = (p.distance / 1000).toFixed(2);
  $('#hud-ahead').textContent = race.gapAhead
    ? `${race.gapAhead.distanceM.toFixed(0)}m · ${race.gapAhead.timeS.toFixed(1)}s` : '선두!';
  $('#hud-behind').textContent = race.gapBehind
    ? `${race.gapBehind.distanceM.toFixed(0)}m · ${race.gapBehind.timeS.toFixed(1)}s` : '최후미';
  // mock biometrics correlate to effort
  const kmh = msToKmh(p.speedMs);
  $('#hud-hr').textContent = race.started ? Math.round(95 + kmh * 3.1) : '–';
  $('#hud-cad').textContent = race.started ? Math.round(60 + kmh * 1.4) : '–';
}

// --------------------------------------------------------------------------
// Finish -> scoring, records, leaderboard
// --------------------------------------------------------------------------
function finishRace() {
  stopLoop();
  say('finish');
  const race = current.race;
  const course = current.course;
  const time = race.finishTime || race.player.finishTime || race.elapsed;

  // finishing-position bonus
  const finishBonus = Math.max(0, (race.riders.length - race.player.rank + 1)) * 100;
  const completion = 200;
  const total = current.sessionPoints + finishBonus + completion;

  store.points += total;
  store.runs += 1;

  // best time + leaderboard
  const prevBest = store.best[course.id];
  const isBest = !prevBest || time < prevBest.time;
  if (isBest) {
    store.best[course.id] = { time, at: Date.now(), rank: race.player.rank };
    // store the winning run as the replay ghost (downsample already done)
    store.ghosts[course.id] = { samples: current.recording.slice(), time };
    addBadge('첫 베스트 갱신');
  }
  // course leaderboard (top times: mine + synthetic seeded field for context)
  const lb = buildLeaderboard(course, time);

  if (race.player.rank === 1) addBadge('🥇 1위 피니시');
  if (course.difficultyEn === 'Hard') addBadge('⛰ 하드코스 완주');
  saveStore(store);

  const resultData = {
    course, time, total, finishBonus, completion,
    sessionPoints: current.sessionPoints, rank: race.player.rank,
    ridersCount: race.riders.length, isBest, lb,
    standings: (race.standings || race.riders).map((r) => ({
      name: r.name, rank: r.rank, me: r.id === 'player',
      gapAheadM: r.id === 'player' && race.gapAhead ? race.gapAhead.distanceM : null,
    })),
    samples: current.recording.slice(),
  };
  current.lastResult = resultData; // consumed by the AI commentary feature
  renderResult(resultData);
  go('result');
}

function buildLeaderboard(course, myTime) {
  // deterministic synthetic rivals for leaderboard context (demo) + my best
  const rng = mulb(course.shapeSeed || 1);
  const field = [];
  const par = (course.lengthKm / 27) * 3600; // rough par seconds @27km/h
  for (let i = 0; i < 5; i++) {
    field.push({ name: course.ghosts[i % course.ghosts.length].name + ` #${i + 1}`, time: par * (0.9 + rng() * 0.35), me: false });
  }
  const best = store.best[course.id];
  field.push({ name: '나 (베스트)', time: best ? best.time : myTime, me: true });
  field.sort((a, b) => a.time - b.time);
  return field.slice(0, 8);
}

// tiny local PRNG (avoid extra import churn for leaderboard flavor)
function mulb(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

function addBadge(name) {
  if (!store.badges.includes(name)) store.badges.push(name);
}

function renderResult(r) {
  const tier = tierFor(store.points);
  $('#result-card').innerHTML = `
    <div class="rc-head" style="--accent:${r.course.color}">
      <h3>${r.course.name}</h3>
      ${r.isBest ? '<span class="best-badge">🏆 베스트 갱신!</span>' : ''}
    </div>
    <div class="rc-grid">
      <div class="rc-cell"><span>기록</span><b>${fmtTime(r.time)}</b></div>
      <div class="rc-cell"><span>최종 순위</span><b>${r.rank}위</b></div>
      <div class="rc-cell"><span>획득 포인트</span><b>+${r.total}</b></div>
      <div class="rc-cell"><span>현재 티어</span><b>${tier.name}</b></div>
    </div>
    <div class="rc-break">
      <span>추격/도주 ${r.sessionPoints}</span>
      <span>완주 ${r.completion}</span>
      <span>순위 보너스 ${r.finishBonus}</span>
    </div>`;

  $('#leaderboard').innerHTML = r.lb.map((row, i) => `
    <li class="lb-row${row.me ? ' me' : ''}">
      <span class="rk">${i + 1}</span>
      <span class="nm">${row.name}</span>
      <span class="tm">${fmtTime(row.time)}</span>
    </li>`).join('');
}

// --------------------------------------------------------------------------
// Profile
// --------------------------------------------------------------------------
function renderProfile() {
  const tier = tierFor(store.points);
  const lvl = levelFor(store.points);
  const bests = Object.entries(store.best);
  $('#profile').innerHTML = `
    <div class="pf-hero" style="--tier:${tier.color}">
      <div class="pf-av">🚴</div>
      <div>
        <div class="pf-lvl">LV.${lvl}</div>
        <div class="pf-tier" style="color:${tier.color}">${tier.name} 티어</div>
        <div class="pf-pts">${store.points.toLocaleString()} P · ${store.runs} 레이스</div>
      </div>
    </div>
    <div class="pf-sec"><h3>배지 (${store.badges.length})</h3>
      <div class="badges">${store.badges.length ? store.badges.map((b) => `<span class="badge">${b}</span>`).join('') : '<span class="muted">아직 배지가 없습니다. 레이스를 완주해 보세요!</span>'}</div>
    </div>
    <div class="pf-sec"><h3>코스별 베스트</h3>
      ${bests.length ? `<ul class="pf-bests">${bests.map(([id, b]) => {
        const c = COURSES.find((x) => x.id === id);
        return `<li><span>${c ? c.name : id}</span><b>${fmtTime(b.time)}</b></li>`;
      }).join('')}</ul>` : '<p class="muted">기록이 없습니다.</p>'}
    </div>`;
}

// --------------------------------------------------------------------------
// Theme
// --------------------------------------------------------------------------
function initTheme() {
  let t = 'dark';
  try { t = localStorage.getItem('ghostpace.theme') || 'dark'; } catch (e) { /* ignore */ }
  document.body.setAttribute('data-theme', t);
  $('#theme-toggle').textContent = t === 'dark' ? '🌙' : '☀';
}
function toggleTheme() {
  const cur = document.body.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  document.body.setAttribute('data-theme', cur);
  $('#theme-toggle').textContent = cur === 'dark' ? '🌙' : '☀';
  try { localStorage.setItem('ghostpace.theme', cur); } catch (e) { /* ignore */ }
}

// --------------------------------------------------------------------------
// Wiring
// --------------------------------------------------------------------------
function wire() {
  document.body.addEventListener('click', (e) => {
    const goBtn = e.target.closest('[data-go]');
    if (goBtn) { go(goBtn.dataset.go); return; }
    const raceBtn = e.target.closest('[data-race]');
    if (raceBtn) { openRace(raceBtn.dataset.race); return; }
  });

  $('#speed-slider').addEventListener('input', (e) => {
    $('#speed-val').textContent = parseFloat(e.target.value).toFixed(0);
    if (current.auto) { current.auto = false; $('#btn-auto').classList.remove('on'); }
  });

  $('#btn-start').addEventListener('click', () => {
    if (current.running) stopLoop(); else startLoop();
  });
  $('#btn-auto').addEventListener('click', () => {
    current.auto = !current.auto;
    $('#btn-auto').classList.toggle('on', current.auto);
    if (current.auto && !current.running) startLoop();
  });
  $('#btn-reset').addEventListener('click', () => { stopLoop(); setupRace(); });
  $('#btn-again').addEventListener('click', () => { if (current.course) { go('race'); setupRace(); } });
  $('#theme-toggle').addEventListener('click', toggleTheme);
  $('#btn-wipe').addEventListener('click', () => {
    if (confirm('모든 기록·포인트·배지를 삭제할까요? (되돌릴 수 없음)')) { wipeStore(); renderProfile(); renderCourses(); }
  });
}

// --------------------------------------------------------------------------
// Boot
// --------------------------------------------------------------------------
async function boot() {
  initTheme();
  wire();
  try {
    const res = await fetch('data/courses.json');
    const data = await res.json();
    COURSES = data.courses || [];
  } catch (e) {
    console.error('course load failed', e);
    $('#course-list').innerHTML = '<p class="muted">코스 데이터를 불러오지 못했습니다. 로컬 서버로 실행했는지 확인하세요.</p>';
    return;
  }
  renderCourses();
  initAiUi({
    getCourses: () => COURSES,
    getStore: () => store,
    getCurrent: () => current,
    tierFor,
    fmtTime,
  });
  go('courses');
}

boot();
