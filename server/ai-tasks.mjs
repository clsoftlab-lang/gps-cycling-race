// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 CLSOFTLAB (씨엘소프트랩), Dr. Lee Il-guk (이일국)
//
// server/ai-tasks.mjs — shared task routing + request builder.
//
// Used by BOTH the Node proxy (index.mjs) and the Cloudflare Worker (worker.js)
// so the two backends stay byte-for-byte identical in prompts, model/caching
// rules, thinking/effort gating, and per-task output caps. No key, no I/O here.

// Stable per-task system prompts — Korean, demo-safe, grounded in the payload.
// Sent as a cache_control:{type:'ephemeral'} system block so repeated calls read
// from cache and cost less.
export const SYSTEMS = {
  coach:
    '당신은 "GhostPace" 사이클링 시뮬레이터의 AI 라이딩 코치입니다. 사용자가 고른 코스의 구간 난이도(segments)와 본인 기록(best/points/tier), 실시간 간격(live)만을 근거로 페이싱·훈련 조언을 한국어로 간결하게(6문장 이내) 제공하세요. 데이터에 없는 사실을 지어내지 마세요.',
  commentary:
    '당신은 "GhostPace" 레이스 코멘터리 캐스터입니다. 제공된 완주 기록(time), 순위(rank), 스플릿(samples), 순위표(standings), 포인트 내역만을 근거로 방금 끝난 레이스를 생동감 있게, 그러나 사실에 맞게 한국어로(6문장 이내) 중계하세요.',
  recommend:
    '당신은 "GhostPace" 코스 추천 도우미입니다. 제공된 코스 목록(courses)과 사용자의 목표(goal)·레벨(level)·기록(bests)만을 근거로 가장 적합한 코스 1~3개를 한국어로 추천하고 이유를 짧게 설명하세요. 목록에 없는 코스를 만들지 마세요.',
  digest:
    '당신은 "GhostPace"의 온-로드 데일리 브리핑 도우미입니다. 제공된 코스 목록(courses)과 사용자의 기록(bests)·티어(tier)·주행수(runs)만을 근거로 "오늘의 추천 코스 1개"와 "오늘의 코치 목표"를 한국어로 아주 짧게(4문장 이내) 제시하세요. 목록에 없는 코스를 만들지 마세요.',
};

// Modest per-task output caps. Raise only where a task truly needs more room.
export const MAX_TOKENS = {
  coach: 700,
  commentary: 700,
  recommend: 500,
  digest: 400,
};
export const DEFAULT_MAX_TOKENS = 700;

// Default cost-first model. May be raised to `claude-sonnet-5` or `claude-opus-5`
// via the AI_MODEL env var / Worker var for higher quality.
export const DEFAULT_MODEL = 'claude-haiku-4-5';

// Haiku 4.5 does NOT accept adaptive thinking / effort — sending them 400s.
export function isHaiku(model) {
  return String(model || '').startsWith('claude-haiku');
}

export function buildUserMessage(task, payload) {
  const p = payload || {};
  if (task === 'recommend') {
    const list = (p.courses || []).map((c) =>
      `- ${c.name} (id=${c.id}, ${c.difficulty}/${c.difficultyEn}, ${c.lengthKm}km, ${c.terrain}, segments=${JSON.stringify(c.segments)})`).join('\n');
    return `목표: ${p.goal}\n레벨: ${p.level}\n내 베스트: ${JSON.stringify(p.bests || {})}\n\n코스 목록:\n${list}\n\n위 목표/레벨에 맞는 코스를 추천해 주세요.`;
  }
  if (task === 'digest') {
    const list = (p.courses || []).map((c) =>
      `- ${c.name} (id=${c.id}, ${c.difficulty}/${c.difficultyEn}, ${c.lengthKm}km, ${c.terrain})`).join('\n');
    return `내 티어: ${p.tier}\n주행수: ${p.runs}\n내 베스트: ${JSON.stringify(p.bests || {})}\n\n코스 목록:\n${list}\n\n오늘의 추천 코스 1개와 오늘의 코치 목표를 알려주세요.`;
  }
  if (task === 'commentary') {
    return `완주 데이터(JSON):\n${JSON.stringify(p, null, 2)}\n\n이 레이스를 코멘터리해 주세요.`;
  }
  // coach (default)
  const q = p.question ? `\n사용자 질문: ${p.question}` : '';
  return `현재 코스와 내 상태(JSON):\n${JSON.stringify({ course: p.course, best: p.best, points: p.points, tier: p.tier, runs: p.runs, live: p.live }, null, 2)}${q}\n\n페이싱/훈련 조언을 해주세요.`;
}

// Build the Anthropic Messages request body. Same rules for Node SDK and REST:
//  - system as a cached block array (prompt caching)
//  - modest per-task max_tokens
//  - thinking/effort ONLY for non-Haiku models
export function buildRequest(model, task, payload, effort) {
  const system = SYSTEMS[task] || SYSTEMS.coach;
  const req = {
    model,
    max_tokens: MAX_TOKENS[task] || DEFAULT_MAX_TOKENS,
    system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: buildUserMessage(task, payload) }],
  };
  if (!isHaiku(model)) {
    req.thinking = { type: 'adaptive' };
    req.output_config = { effort: effort || 'low' };
  }
  return req;
}

// Sum every token bucket from a final message `usage` object (incl. cache).
export function usageTokens(usage) {
  if (!usage) return 0;
  return (usage.input_tokens || 0) + (usage.output_tokens || 0) +
    (usage.cache_creation_input_tokens || 0) + (usage.cache_read_input_tokens || 0);
}
