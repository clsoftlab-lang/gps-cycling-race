// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 CLSOFTLAB (씨엘소프트랩), Dr. Lee Il-guk (이일국)
//
// server/index.mjs — GhostPace AI proxy.
//
// The ONLY place the Anthropic API key is ever used. The browser never sees it.
// The frontend POSTs { task, payload } to /api/ai; this proxy builds a grounded
// prompt, calls Claude with streaming, and pipes the text straight back so the
// SPA can render it token-by-token. Enable it by setting ai/config.js →
// AI_ENDPOINT to this server's /api/ai URL.
//
// Run:  cp .env.example .env  &&  edit .env  &&  npm install  &&  npm start

import http from 'node:http';
import Anthropic from '@anthropic-ai/sdk';

const PORT = Number(process.env.PORT) || 8787;
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-opus-5';

const client = new Anthropic(); // reads ANTHROPIC_API_KEY from the environment

// System prompts per task — Korean, demo-safe, grounded in supplied payload.
const SYSTEMS = {
  coach:
    '당신은 "GhostPace" 사이클링 시뮬레이터의 AI 라이딩 코치입니다. 사용자가 고른 코스의 구간 난이도(segments)와 본인 기록(best/points/tier), 실시간 간격(live)만을 근거로 페이싱·훈련 조언을 한국어로 간결하게(6문장 이내) 제공하세요. 데이터에 없는 사실을 지어내지 마세요.',
  commentary:
    '당신은 "GhostPace" 레이스 코멘터리 캐스터입니다. 제공된 완주 기록(time), 순위(rank), 스플릿(samples), 순위표(standings), 포인트 내역만을 근거로 방금 끝난 레이스를 생동감 있게, 그러나 사실에 맞게 한국어로(6문장 이내) 중계하세요.',
  recommend:
    '당신은 "GhostPace" 코스 추천 도우미입니다. 제공된 코스 목록(courses)과 사용자의 목표(goal)·레벨(level)·기록(bests)만을 근거로 가장 적합한 코스 1~3개를 한국어로 추천하고 이유를 짧게 설명하세요. 목록에 없는 코스를 만들지 마세요.',
};

function buildUserMessage(task, payload) {
  const p = payload || {};
  if (task === 'recommend') {
    const list = (p.courses || []).map((c) =>
      `- ${c.name} (id=${c.id}, ${c.difficulty}/${c.difficultyEn}, ${c.lengthKm}km, ${c.terrain}, segments=${JSON.stringify(c.segments)})`).join('\n');
    return `목표: ${p.goal}\n레벨: ${p.level}\n내 베스트: ${JSON.stringify(p.bests || {})}\n\n코스 목록:\n${list}\n\n위 목표/레벨에 맞는 코스를 추천해 주세요.`;
  }
  if (task === 'commentary') {
    return `완주 데이터(JSON):\n${JSON.stringify(p, null, 2)}\n\n이 레이스를 코멘터리해 주세요.`;
  }
  // coach (default)
  const q = p.question ? `\n사용자 질문: ${p.question}` : '';
  return `현재 코스와 내 상태(JSON):\n${JSON.stringify({ course: p.course, best: p.best, points: p.points, tier: p.tier, runs: p.runs, live: p.live }, null, 2)}${q}\n\n페이싱/훈련 조언을 해주세요.`;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > 1e6) req.destroy(); });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', CORS_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  if (req.method === 'GET' && (req.url === '/' || req.url === '/health')) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, service: 'ghostpace-ai-proxy', model: MODEL, keyLoaded: !!process.env.ANTHROPIC_API_KEY }));
    return;
  }
  if (req.method !== 'POST' || !req.url.startsWith('/api/ai')) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
    return;
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('ANTHROPIC_API_KEY가 설정되지 않았습니다. server/.env를 확인하세요.');
    return;
  }

  try {
    const raw = await readBody(req);
    const { task = 'coach', payload = {} } = JSON.parse(raw || '{}');
    const system = SYSTEMS[task] || SYSTEMS.coach;
    const messages = [{ role: 'user', content: buildUserMessage(task, payload) }];

    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-cache' });

    const stream = client.messages.stream({
      model: MODEL,
      max_tokens: 2048,
      thinking: { type: 'adaptive' },
      system,
      messages,
    });
    stream.on('text', (t) => res.write(t));
    await stream.finalMessage();
    res.end();
  } catch (err) {
    const msg = 'AI 처리 오류: ' + (err && err.message ? err.message : String(err));
    if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(msg);
  }
});

server.listen(PORT, () => {
  console.log(`GhostPace AI proxy listening on http://localhost:${PORT}  (model: ${MODEL})`);
  console.log(`Frontend: set ai/config.js → AI_ENDPOINT = "http://localhost:${PORT}/api/ai"`);
});
