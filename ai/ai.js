// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 CLSOFTLAB (씨엘소프트랩), Dr. Lee Il-guk (이일국)
//
// ai/ai.js — pluggable AI client for GhostPace.
//
//   askAI(task, payload, { onToken } = {}) → Promise<string>
//
// If AI_ENDPOINT is empty (default demo), a deterministic Korean MockProvider
// answers using the app's own course / race / best-time data — no network, no
// key, reproducible. Otherwise the request is POSTed to the backend proxy and
// the streamed reply is forwarded token-by-token via onToken.
//
// Supported tasks:
//   'coach'      — AI 라이딩 코치: pacing/training advice for a course + results
//   'commentary' — 레이스 결과 분석/코멘터리: narrate a finished race
//   'recommend'  — 코스 추천: suggest a course by goal/level
//   'digest'     — 오늘의 추천 코스 + 코치 목표: on-load autonomous briefing
//
// AUTO-FALLBACK (무인): if the real endpoint fails, returns HTTP 429
// {fallback:true} (rate limit / monthly budget), or errors on the network BEFORE
// any token has streamed, askAI silently falls back to the offline mock so the
// app never breaks. (If failure happens mid-stream, the partial real answer is
// kept and the error surfaces — the mock is not appended, to avoid garbling.)
//
// The API key is NEVER handled here. Real calls go to the server proxy only.

import { AI_ENDPOINT } from './config.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------
export async function askAI(task, payload = {}, { onToken } = {}) {
  const endpoint = (AI_ENDPOINT || '').trim();
  if (!endpoint) return mockAnswer(task, payload, onToken);

  let started = false;
  const guarded = onToken ? (t) => { started = true; onToken(t); } : undefined;
  try {
    return await realAnswer(endpoint, task, payload, guarded);
  } catch (e) {
    // Nothing streamed yet (429 {fallback:true}, network error, non-OK) →
    // auto-fallback to the deterministic offline mock so the app never breaks.
    if (!started) return mockAnswer(task, payload, onToken);
    throw e; // already mid-stream: keep the partial real answer, surface the error
  }
}

// ---------------------------------------------------------------------------
// Real backend (streaming text/plain from server/index.mjs or worker.js)
// ---------------------------------------------------------------------------
async function realAnswer(endpoint, task, payload, onToken) {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ task, payload }),
  });
  if (!res.ok) {
    // 429 {fallback:true} and any other non-OK bubble up → askAI falls back to mock.
    const detail = await res.text().catch(() => '');
    throw new Error(`AI 서버 오류 (${res.status}) ${detail}`.trim());
  }
  // Stream when possible; fall back to a single read.
  if (!res.body || !res.body.getReader) {
    const text = await res.text();
    if (onToken && text) onToken(text);
    return text;
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let full = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = decoder.decode(value, { stream: true });
    if (chunk) { full += chunk; if (onToken) onToken(chunk); }
  }
  const tail = decoder.decode();
  if (tail) { full += tail; if (onToken) onToken(tail); }
  return full;
}

// ---------------------------------------------------------------------------
// Deterministic Korean MockProvider — grounded in the app's real data
// ---------------------------------------------------------------------------
async function mockAnswer(task, payload, onToken) {
  const text = buildMock(task, payload);
  if (onToken) {
    // Emit in small chunks for a live "typing" feel; deterministic content.
    const tokens = text.match(/\S+\s*|\n+/g) || [text];
    for (const tk of tokens) { onToken(tk); await sleep(10); }
  }
  return text;
}

function fmt(sec) {
  if (sec == null || !isFinite(sec)) return '--:--';
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return `${String(m).padStart(2, '0')}:${s.toFixed(1).padStart(4, '0')}`;
}
function pct(x) { return Math.round(x * 100); }

// Classify a course's climb character from its segment factors (real data).
function climbProfile(course) {
  const segs = (course && course.segments) || [];
  if (!segs.length) return { climb: false, min: 1, flatish: true };
  const min = Math.min(...segs.map((s) => s.factor));
  const climbFrac = segs.filter((s) => s.factor < 0.95).reduce((a, s) => a + s.frac, 0);
  return { climb: min < 0.9, min, climbFrac, flatish: min >= 0.98 };
}

function buildMock(task, payload) {
  switch (task) {
    case 'commentary': return mockCommentary(payload);
    case 'recommend':  return mockRecommend(payload);
    case 'digest':     return mockDigest(payload);
    case 'coach':
    default:           return mockCoach(payload);
  }
}

// ---- (AUTO) 오늘의 추천 코스 + 코치 목표 -------------------------------------
// On-load autonomous briefing, grounded in the app's real courses + best times.
// Deterministic, offline — the app "runs itself" even with no network / no key.
function mockDigest(p) {
  const courses = Array.isArray(p.courses) ? p.courses : [];
  const bests = p.bests || {};
  const tier = p.tier || 'Bronze';
  const runs = p.runs || 0;
  const lines = [];

  lines.push('☀️ 오늘의 라이딩 브리핑 (데모)');
  lines.push('');
  if (!courses.length) { lines.push('코스 데이터를 불러오는 중입니다.'); return lines.join('\n'); }

  // Level inferred from how much you've ridden; nudge toward un-raced courses.
  const level = runs >= 8 ? 'advanced' : runs >= 3 ? 'intermediate' : 'beginner';
  const scored = courses.map((c) => {
    const prof = climbProfile(c);
    let score = 2 - Math.abs((c.lengthKm || 5) - 5) / 5; // balanced length preference
    if (level === 'beginner') score += c.difficultyEn === 'Easy' ? 2 : c.difficultyEn === 'Medium' ? 1 : 0;
    else if (level === 'intermediate') score += c.difficultyEn === 'Medium' ? 2 : 1;
    else score += c.difficultyEn === 'Hard' ? 2 : 1;
    if (!bests[c.id]) score += 0.8; // prefer a course you haven't set a time on
    return { c, prof, score };
  }).sort((a, b) => b.score - a.score);

  const { c, prof } = scored[0];
  const raced = !!bests[c.id];
  lines.push(`오늘의 추천 코스: ${c.name} (${c.difficulty}, ${c.lengthKm}km, ${c.terrain})`);
  lines.push(prof.climb
    ? '  오르막 비중이 커서 근성(grit) 훈련에 좋은 날입니다.'
    : '  꾸준한 순항 페이스로 평균 속도를 끌어올리기 좋습니다.');
  lines.push('');
  lines.push(raced
    ? `코치 목표: 이 코스 베스트 ${fmt(bests[c.id].time)} 대비 3~5% 단축에 도전하세요.`
    : '코치 목표: 첫 주행은 완주를 목표로 페이스를 낮게 잡고 구간 감각을 익히세요.');
  lines.push(`현재 티어 ${tier} · 누적 ${runs} 레이스. 오늘 1회 완주로 기록을 남겨 보세요.`);
  lines.push('');
  lines.push('— GhostPace AI 브리핑 (DEMO · 모의 응답)');
  return lines.join('\n');
}

// ---- (1) AI 라이딩 코치 -----------------------------------------------------
function mockCoach(p) {
  const c = p.course || {};
  const prof = climbProfile(c);
  const best = p.best ? fmt(p.best.time) : null;
  const tier = p.tier || 'Bronze';
  const q = (p.question || '').trim();
  const lines = [];

  lines.push(`🚴 ${c.name || '이 코스'} 라이딩 코치 (데모)`);
  lines.push('');
  if (q) lines.push(`질문: "${q}"`);

  // Course-grounded pacing plan from the segment profile.
  if (prof.climb) {
    lines.push(`이 코스는 ${c.terrain || '기복 구간'}이 핵심입니다. 최저 난이도 계수가 ${prof.min.toFixed(2)}까지 떨어지는 오르막이 전체의 약 ${pct(prof.climbFrac || 0)}%를 차지해요.`);
    lines.push('페이스 전략: 초반 평지에서 심박을 너무 올리지 말고(체감 7/10), 오르막에서는 케이던스를 80~90rpm으로 유지하며 근성(grit)으로 버티세요. 정상 직전 200m를 남기고 마지막 스퍼트를 아껴 두는 게 순위 방어의 핵심입니다.');
  } else if (prof.flatish) {
    lines.push(`이 코스는 ${c.terrain || '평지 위주'}라 평균 속도 유지가 승부처입니다. 난이도 계수가 대체로 1.0 이상이라 꾸준히 밟을수록 유리해요.`);
    lines.push('페이스 전략: 출발 직후 오버페이스를 피하고, 목표 속도의 95%로 순항하다가 후반 1/3에서 단계적으로 끌어올리세요. 앞 라이더와 간격이 20m 안쪽이면 드래프팅 하듯 붙었다가 한 번에 추월하는 편이 포인트 효율이 좋습니다.');
  } else {
    lines.push(`이 코스는 완만한 기복이 섞여 있습니다. 구간별 난이도 계수(${(c.segments || []).map((s) => s.factor).join(', ')})에 맞춰 강약을 조절하세요.`);
    lines.push('페이스 전략: 내리막/평지에서 벌고 오르막에서 손실을 줄이는 "네거티브 스플릿"을 노리세요.');
  }

  // Results-grounded feedback.
  lines.push('');
  if (best) {
    lines.push(`현재 베스트 ${best} · 티어 ${tier} · 누적 ${((p.points || 0)).toLocaleString()}P. 다음 목표는 베스트 대비 3~5% 단축입니다.`);
    lines.push('훈련 팁: 이 코스 길이의 인터벌(3분 강 / 2분 약)을 주 2회 반복하면 무산소 역치가 올라가 후반 스퍼트가 살아납니다.');
  } else {
    lines.push('아직 이 코스 기록이 없네요. 첫 주행은 완주를 목표로 페이스를 낮게 잡고, 두 번째 주행부터 구간별로 조금씩 밀어붙여 베스트를 세워 보세요.');
  }

  // Live gap advice if a race is in progress.
  if (p.live && (p.live.gapAheadM != null || p.live.gapBehindM != null)) {
    lines.push('');
    if (p.live.gapAheadM != null) lines.push(`지금 앞 라이더와 ${Math.round(p.live.gapAheadM)}m. ${p.live.gapAheadM < 20 ? '추월 각입니다 — 5초만 강하게 밟으세요!' : '간격을 조금씩 줄이며 체력을 아끼세요.'}`);
    if (p.live.gapBehindM != null && p.live.gapBehindM < 25) lines.push(`뒤 라이더가 ${Math.round(p.live.gapBehindM)}m로 붙었습니다. 리듬을 잃지 말고 케이던스를 유지하세요.`);
  }
  lines.push('');
  lines.push('— GhostPace AI 코치 (DEMO · 모의 응답)');
  return lines.join('\n');
}

// ---- (2) 레이스 결과 분석/코멘터리 -----------------------------------------
function mockCommentary(p) {
  const c = p.course || {};
  const lines = [];
  const time = fmt(p.time);
  const rank = p.rank;
  const total = p.ridersCount || (p.standings ? p.standings.length : null);

  lines.push(`🎙️ ${c.name || '코스'} 레이스 코멘터리 (데모)`);
  lines.push('');
  lines.push(`최종 기록 ${time}, ${rank != null ? `${total ? `${total}명 중 ` : ''}${rank}위` : '완주'}로 결승선을 통과했습니다!`);

  if (p.isBest) lines.push('🏆 개인 베스트 갱신 — 오늘 페이스가 확실히 살아 있었습니다.');

  // Splits from the recorded trace (real player samples), if provided.
  if (Array.isArray(p.samples) && p.samples.length > 2) {
    const s = p.samples;
    const mid = s[Math.floor(s.length / 2)];
    const firstHalfV = mid.d / Math.max(mid.t, 0.1);
    const secondHalfV = (s[s.length - 1].d - mid.d) / Math.max(s[s.length - 1].t - mid.t, 0.1);
    const neg = secondHalfV > firstHalfV;
    lines.push('');
    lines.push(`전반 평균 ${(firstHalfV * 3.6).toFixed(1)}km/h, 후반 평균 ${(secondHalfV * 3.6).toFixed(1)}km/h — ${neg ? '후반에 오히려 가속한 이상적인 네거티브 스플릿이었습니다.' : '후반에 페이스가 다소 떨어졌습니다. 초반 배분을 조금 더 아꼈다면 기록 단축 여지가 있었어요.'}`);
  }

  // Standings context, if provided.
  if (Array.isArray(p.standings) && p.standings.length) {
    const me = p.standings.find((r) => r.me) || {};
    const rivals = p.standings.filter((r) => !r.me).slice(0, 2).map((r) => r.name).filter(Boolean);
    if (rivals.length) lines.push('');
    if (rivals.length) lines.push(`주요 경쟁자 ${rivals.join(', ')}와의 접전이 볼만했습니다.`);
    if (me.gapAheadM != null && me.gapAheadM > 0 && rank !== 1) lines.push(`선두와의 격차는 약 ${Math.round(me.gapAheadM)}m — 다음엔 충분히 뒤집을 수 있는 거리입니다.`);
  }

  // Points breakdown, if provided.
  if (p.sessionPoints != null || p.finishBonus != null) {
    lines.push('');
    lines.push(`획득 포인트: 추격/도주 ${p.sessionPoints || 0} + 완주 ${p.completion || 0} + 순위 보너스 ${p.finishBonus || 0} = 총 ${p.total != null ? p.total : (p.sessionPoints || 0) + (p.completion || 0) + (p.finishBonus || 0)}P.`);
  }
  lines.push('');
  lines.push(rank === 1 ? '완벽한 우승! 다음은 베스트 타임 경신에 도전해 보세요.' : '좋은 주행이었습니다. 고스트 리플레이로 오늘의 나를 다시 넘어서 보세요!');
  lines.push('');
  lines.push('— GhostPace AI 코멘터리 (DEMO · 모의 응답)');
  return lines.join('\n');
}

// ---- (3) 코스 추천 ----------------------------------------------------------
function mockRecommend(p) {
  const courses = Array.isArray(p.courses) ? p.courses : [];
  const goal = p.goal || 'balanced';   // 'endurance' | 'sprint' | 'climb' | 'balanced'
  const level = p.level || 'beginner'; // 'beginner' | 'intermediate' | 'advanced'
  const bests = p.bests || {};

  // Deterministic scoring over the real course data.
  const scored = courses.map((c) => {
    const prof = climbProfile(c);
    let score = 0;
    if (goal === 'climb') score += prof.climb ? 3 : (1 - prof.min);
    if (goal === 'sprint') score += (c.difficultyEn === 'Medium' || /스프린트|sprint/i.test(c.nameEn || c.name)) ? 3 : 1;
    if (goal === 'endurance') score += (c.lengthKm >= 7 ? 3 : c.lengthKm / 7);
    if (goal === 'balanced') score += 2 - Math.abs((c.lengthKm || 5) - 5) / 5;
    if (level === 'beginner') score += c.difficultyEn === 'Easy' ? 2 : c.difficultyEn === 'Medium' ? 1 : 0;
    if (level === 'intermediate') score += c.difficultyEn === 'Medium' ? 2 : 1;
    if (level === 'advanced') score += c.difficultyEn === 'Hard' ? 2 : 1;
    if (!bests[c.id]) score += 0.5; // nudge toward an un-raced course
    return { c, score, prof };
  }).sort((a, b) => b.score - a.score);

  const goalKo = { endurance: '지구력', sprint: '스프린트', climb: '클라이밍', balanced: '균형' }[goal] || '균형';
  const levelKo = { beginner: '입문', intermediate: '중급', advanced: '상급' }[level] || '입문';

  const lines = [];
  lines.push(`🗺️ AI 코스 추천 (데모) — 목표: ${goalKo} · 레벨: ${levelKo}`);
  lines.push('');
  if (!scored.length) { lines.push('추천할 코스 데이터가 없습니다.'); return lines.join('\n'); }

  const top = scored.slice(0, Math.min(3, scored.length));
  top.forEach(({ c, prof }, i) => {
    const bt = bests[c.id] ? ` · 내 베스트 ${fmt(bests[c.id].time)}` : ' · 미주행';
    lines.push(`${i + 1}. ${c.name} (${c.difficulty}, ${c.lengthKm}km, ${c.terrain})${bt}`);
    if (i === 0) {
      let why = '';
      if (goal === 'climb' && prof.climb) why = '연속 오르막이 근성 훈련에 최적입니다.';
      else if (goal === 'endurance' && c.lengthKm >= 7) why = '장거리라 체력 배분 연습에 딱 맞습니다.';
      else if (goal === 'sprint') why = '짧고 빠른 전개로 평균 속도를 끌어올리기 좋습니다.';
      else why = '길이·난이도 균형이 좋아 오늘 목표에 가장 잘 맞습니다.';
      lines.push(`   → 추천 1순위: ${why} ${levelKo} 라이더에게 적합한 난이도예요.`);
    }
  });
  lines.push('');
  lines.push(`먼저 1순위 "${top[0].c.name}"로 페이스를 잡아 보고, 익숙해지면 상위 코스로 난이도를 올려 보세요.`);
  lines.push('');
  lines.push('— GhostPace AI 코스 추천 (DEMO · 모의 응답)');
  return lines.join('\n');
}
