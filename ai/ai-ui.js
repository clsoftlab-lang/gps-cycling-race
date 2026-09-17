// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 CLSOFTLAB (씨엘소프트랩), Dr. Lee Il-guk (이일국)
//
// ai/ai-ui.js — wires the three AI features into the existing SPA. It reads
// live app state through the small `api` object passed by app.js and never
// touches the race engine or storage directly. All output streams into the
// page via askAI's onToken callback, so it "visibly works" in demo/mock mode.

import { askAI } from './ai.js';

const $ = (s, r = document) => r.querySelector(s);

// Render helper: stream tokens into an output box, with busy/error states.
async function run(outEl, btnEl, task, payload) {
  if (!outEl) return;
  outEl.textContent = '';
  outEl.classList.add('busy');
  if (btnEl) btnEl.disabled = true;
  try {
    await askAI(task, payload, { onToken: (t) => { outEl.textContent += t; outEl.scrollTop = outEl.scrollHeight; } });
  } catch (e) {
    outEl.textContent = 'AI 응답을 가져오지 못했습니다: ' + (e && e.message ? e.message : e) +
      '\n(데모는 mock으로 동작합니다. 실 AI는 server/ 프록시와 ai/config.js의 AI_ENDPOINT 설정이 필요합니다.)';
  } finally {
    outEl.classList.remove('busy');
    if (btnEl) btnEl.disabled = false;
  }
}

export function initAiUi(api) {
  const getCourses = api.getCourses || (() => []);
  const getStore = api.getStore || (() => ({}));
  const getCurrent = api.getCurrent || (() => ({}));

  // ---- (3) 코스 추천 (course-select screen) ----
  const recBtn = $('#ai-recommend-btn');
  if (recBtn) {
    recBtn.addEventListener('click', () => {
      const store = getStore();
      run($('#ai-recommend-out'), recBtn, 'recommend', {
        goal: $('#ai-goal') ? $('#ai-goal').value : 'balanced',
        level: $('#ai-level') ? $('#ai-level').value : 'beginner',
        courses: getCourses(),
        bests: store.best || {},
      });
    });
  }

  // ---- (1) AI 라이딩 코치 (race screen) ----
  function coachPayload(question) {
    const cur = getCurrent();
    const store = getStore();
    const course = cur.course || {};
    const race = cur.race;
    const live = race ? {
      gapAheadM: race.gapAhead ? race.gapAhead.distanceM : null,
      gapBehindM: race.gapBehind ? race.gapBehind.distanceM : null,
      rank: race.player ? race.player.rank : null,
    } : null;
    return {
      question: question || '',
      course,
      best: (store.best || {})[course.id] || null,
      points: store.points || 0,
      tier: api.tierFor ? api.tierFor(store.points || 0).name : undefined,
      runs: store.runs || 0,
      live,
    };
  }
  const coachBtn = $('#ai-coach-btn');
  if (coachBtn) coachBtn.addEventListener('click', () => run($('#ai-coach-out'), coachBtn, 'coach', coachPayload('')));
  const coachForm = $('#ai-coach-form');
  if (coachForm) {
    coachForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const input = $('#ai-coach-input');
      const q = input ? input.value.trim() : '';
      if (!q) return;
      run($('#ai-coach-out'), coachBtn, 'coach', coachPayload(q));
      if (input) input.value = '';
    });
  }

  // ---- (2) 레이스 결과 분석/코멘터리 (result screen) ----
  const comBtn = $('#ai-commentary-btn');
  if (comBtn) {
    comBtn.addEventListener('click', () => {
      const cur = getCurrent();
      const r = cur.lastResult;
      if (!r) { const out = $('#ai-commentary-out'); if (out) out.textContent = '먼저 레이스를 완주하세요.'; return; }
      run($('#ai-commentary-out'), comBtn, 'commentary', {
        course: r.course,
        time: r.time,
        rank: r.rank,
        ridersCount: r.ridersCount,
        isBest: r.isBest,
        sessionPoints: r.sessionPoints,
        completion: r.completion,
        finishBonus: r.finishBonus,
        total: r.total,
        standings: r.standings,
        samples: r.samples,
      });
    });
  }
}
