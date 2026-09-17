// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 CLSOFTLAB (씨엘소프트랩), Dr. Lee Il-guk (이일국)
//
// race-engine.js — pure-ish simulation math for the GPS Cycling Race demo.
// No DOM, no rendering, no globals. Everything here is deterministic given
// the same seed + the same sequence of player speeds + the same dt sequence.
// This is what the unit tests in check.mjs exercise.

// ---------------------------------------------------------------------------
// Deterministic PRNG (mulberry32). Same seed -> same stream, forever.
// ---------------------------------------------------------------------------
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Hash two integers into a stable 32-bit seed. Used so a ghost's noise depends
// on its own seed AND the distance bucket, without keeping mutable RNG state.
export function hash2(a, b) {
  let h = (a >>> 0) ^ Math.imul((b >>> 0) + 0x9e3779b9, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

// ---------------------------------------------------------------------------
// Course helpers
// ---------------------------------------------------------------------------

// Total course length in metres.
export function courseLengthMeters(course) {
  return Math.round((course.lengthKm || 0) * 1000);
}

// Find which segment a distance (metres) falls in and return its speed factor.
// Segments are fractions of the course with a difficulty/gradient factor that
// scales a rider's cruising speed (climb < 1, descent/flat >= 1).
export function segmentFactorAt(course, distanceM) {
  const total = courseLengthMeters(course);
  if (total <= 0) return 1;
  const frac = clamp(distanceM / total, 0, 0.999999);
  let acc = 0;
  const segs = course.segments && course.segments.length ? course.segments : [{ frac: 1, factor: 1 }];
  for (const s of segs) {
    acc += s.frac;
    if (frac < acc) return s.factor;
  }
  return segs[segs.length - 1].factor;
}

// ---------------------------------------------------------------------------
// Rider factory
// ---------------------------------------------------------------------------

// Convert km/h -> m/s.
export const kmhToMs = (kmh) => (kmh * 1000) / 3600;
export const msToKmh = (ms) => (ms * 3600) / 1000;

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

// Build the AI/ghost riders for a race from the course pace data + a seed.
// Each ghost has a base cruising speed (km/h) and a "grit" value that shapes
// how it responds to segment difficulty. All derived deterministically.
export function buildGhosts(course, seed) {
  const rng = mulberry32(seed);
  const defs = course.ghosts && course.ghosts.length ? course.ghosts : [];
  return defs.map((g, i) => {
    // small deterministic personality jitter per ghost
    const jitter = (rng() - 0.5) * 1.2; // +/- 0.6 km/h
    return {
      id: g.id || `ghost${i + 1}`,
      name: g.name || `Ghost ${i + 1}`,
      kind: g.kind || 'ai',
      color: g.color || '#888',
      baseKmh: (g.baseKmh || 28) + jitter,
      grit: g.grit != null ? g.grit : 0.6, // 0..1, how well it holds pace on climbs
      seed: hash2(seed, i + 1),
      distance: 0,
      speedMs: 0,
      finished: false,
      finishTime: null,
      rank: 0,
    };
  });
}

// Compute a ghost's instantaneous speed (m/s) at its current distance.
// Deterministic: depends on ghost.seed and a quantized distance bucket only.
export function ghostSpeedAt(course, ghost, distanceM) {
  const factor = segmentFactorAt(course, distanceM);
  // On climbs (factor<1) high grit riders lose less; on flats everyone near base.
  const gritComp = 1 - (1 - factor) * (1 - ghost.grit);
  const eff = factor < 1 ? gritComp : factor;
  // deterministic micro-variation per 50 m bucket (breathing/effort ripple)
  const bucket = Math.floor(distanceM / 50);
  const noise = (mulberry32(hash2(ghost.seed, bucket))() - 0.5) * 0.08; // +/-4%
  const kmh = ghost.baseKmh * eff * (1 + noise);
  return kmhToMs(Math.max(3, kmh));
}

// ---------------------------------------------------------------------------
// Race state
// ---------------------------------------------------------------------------

// Create a fresh race state. `player` is a rider object controlled externally.
export function createRace(course, seed, opts = {}) {
  const ghosts = buildGhosts(course, seed);
  const player = {
    id: 'player',
    name: opts.playerName || 'YOU',
    kind: 'player',
    color: opts.playerColor || '#ff3b6b',
    distance: 0,
    speedMs: 0,
    finished: false,
    finishTime: null,
    rank: 0,
  };
  const riders = [player, ...ghosts];
  return {
    course,
    seed,
    lengthM: courseLengthMeters(course),
    elapsed: 0,
    started: false,
    finished: false,
    player,
    ghosts,
    riders,
    tickCount: 0,
    events: [], // chase/flee events for scoring & voice lines
  };
}

// Advance the whole race by dt seconds. `playerSpeedKmh` is the commanded
// player cruising speed for this tick (from slider / auto-pace). Returns the
// same state (mutated) for convenience. Pure w.r.t. inputs -> deterministic.
export function tick(state, dt, playerSpeedKmh) {
  if (state.finished || dt <= 0) return state;
  state.started = true;
  state.elapsed += dt;
  state.tickCount += 1;

  // player
  const p = state.player;
  if (!p.finished) {
    p.speedMs = kmhToMs(Math.max(0, playerSpeedKmh || 0));
    p.distance += p.speedMs * dt;
    if (p.distance >= state.lengthM) {
      p.distance = state.lengthM;
      p.finished = true;
      p.finishTime = state.elapsed;
    }
  }

  // ghosts
  for (const g of state.ghosts) {
    if (g.finished) continue;
    g.speedMs = ghostSpeedAt(state.course, g, g.distance);
    g.distance += g.speedMs * dt;
    if (g.distance >= state.lengthM) {
      g.distance = state.lengthM;
      g.finished = true;
      g.finishTime = state.elapsed;
    }
  }

  computeStandings(state);

  // whole race finishes when the player crosses the line
  if (p.finished) state.finished = true;
  return state;
}

// Sort riders by distance and assign ranks + neighbour gaps. Mutates state.
export function computeStandings(state) {
  const sorted = [...state.riders].sort((a, b) => b.distance - a.distance);
  for (let i = 0; i < sorted.length; i++) {
    sorted[i].rank = i + 1;
  }
  state.standings = sorted;
  // neighbour gaps for the player
  const idx = sorted.findIndex((r) => r.id === 'player');
  const ahead = idx > 0 ? sorted[idx - 1] : null;
  const behind = idx < sorted.length - 1 ? sorted[idx + 1] : null;
  const p = state.player;
  state.gapAhead = ahead ? gapBetween(ahead, p) : null;
  state.gapBehind = behind ? gapBetween(p, behind) : null;
  state.aheadRider = ahead;
  state.behindRider = behind;
  return state;
}

// Gap between a leading rider `lead` and a trailing rider `trail`.
// distance gap in metres (>=0) and an estimated time gap in seconds using the
// trailing rider's current speed (how long until they'd close it at this pace).
export function gapBetween(lead, trail) {
  const distM = Math.max(0, lead.distance - trail.distance);
  const refMs = Math.max(kmhToMs(3), trail.speedMs || kmhToMs(3));
  const timeS = distM / refMs;
  return { distanceM: distM, timeS };
}

// ---------------------------------------------------------------------------
// Scoring — chase success / flee success detection between two snapshots.
// A "chase" succeeds when the player passes a rider that was ahead.
// A "flee" succeeds when the player pulls a gap open past a threshold on a
// rider that was close behind. Returns points earned this transition.
// ---------------------------------------------------------------------------
export function scoreTransition(prev, curr, opts = {}) {
  const chasePts = opts.chasePoints || 120;
  const fleePts = opts.fleePoints || 80;
  const fleeGapM = opts.fleeGapMeters || 60;
  let points = 0;
  const events = [];
  // rank improvement = overtook someone
  if (prev.playerRank && curr.playerRank < prev.playerRank) {
    const gained = prev.playerRank - curr.playerRank;
    points += chasePts * gained;
    events.push({ type: 'chase', gained, points: chasePts * gained });
  }
  // opened a decisive gap on the chaser behind
  if (
    prev.gapBehindM != null &&
    curr.gapBehindM != null &&
    prev.gapBehindM < fleeGapM &&
    curr.gapBehindM >= fleeGapM
  ) {
    points += fleePts;
    events.push({ type: 'flee', points: fleePts });
  }
  return { points, events };
}

// Snapshot the scoring-relevant scalars from a race state.
export function snapshot(state) {
  return {
    playerRank: state.player.rank,
    gapAheadM: state.gapAhead ? state.gapAhead.distanceM : null,
    gapBehindM: state.gapBehind ? state.gapBehind.distanceM : null,
    elapsed: state.elapsed,
    distance: state.player.distance,
  };
}

// ---------------------------------------------------------------------------
// Rank tier from lifetime points.
// ---------------------------------------------------------------------------
export const TIERS = [
  { name: 'Bronze', min: 0, color: '#cd7f32' },
  { name: 'Silver', min: 1500, color: '#c0c0c0' },
  { name: 'Gold', min: 4000, color: '#ffd700' },
  { name: 'Platinum', min: 9000, color: '#8ee8ff' },
  { name: 'Diamond', min: 18000, color: '#b9f2ff' },
  { name: 'Legend', min: 35000, color: '#ff6bd6' },
];

export function tierFor(points) {
  let t = TIERS[0];
  for (const tier of TIERS) if (points >= tier.min) t = tier;
  return t;
}

export function levelFor(points) {
  // gentle curve: level rises with sqrt of points
  return Math.max(1, Math.floor(Math.sqrt(points / 50)) + 1);
}

// Format seconds -> mm:ss.d
export function fmtTime(sec) {
  if (sec == null || !isFinite(sec)) return '--:--';
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return `${String(m).padStart(2, '0')}:${s.toFixed(1).padStart(4, '0')}`;
}
