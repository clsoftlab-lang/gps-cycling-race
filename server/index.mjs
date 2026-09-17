// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 CLSOFTLAB (씨엘소프트랩), Dr. Lee Il-guk (이일국)
//
// server/index.mjs — GhostPace AI proxy (cost-efficient, autonomous-friendly).
//
// The ONLY place the Anthropic API key is ever used. The browser never sees it.
// The frontend POSTs { task, payload } to /api/ai; this proxy builds a grounded,
// cached prompt, calls Claude with streaming, and pipes the text straight back so
// the SPA can render it token-by-token. Enable it by setting ai/config.js →
// AI_ENDPOINT to this server's /api/ai URL.
//
// Cost controls:
//   - Cost-first default model claude-haiku-4-5 (override with AI_MODEL).
//   - Prompt caching on the stable system block.
//   - Modest per-task max_tokens.
//   - Per-IP rate limit + a monthly token budget → HTTP 429 {fallback:true}.
//
// Run:  cp .env.example .env  &&  edit .env  &&  npm install  &&  npm run start:env

import http from 'node:http';
import Anthropic from '@anthropic-ai/sdk';
import { buildRequest, usageTokens, isHaiku, DEFAULT_MODEL } from './ai-tasks.mjs';

const PORT = Number(process.env.PORT) || 8787;
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';
// Cost-first default. Raise to claude-sonnet-5 / claude-opus-5 for higher quality.
const MODEL = process.env.AI_MODEL || DEFAULT_MODEL;
const EFFORT = process.env.AI_EFFORT || 'low';

// --- Cost guardrails -------------------------------------------------------
const RATE_PER_MIN = Number(process.env.AI_RATE_PER_MIN) || 20;
const MONTHLY_TOKEN_CAP = Number(process.env.AI_MONTHLY_TOKEN_CAP) || 2_000_000;

const rate = new Map(); // ip -> { count, resetAt }
function rateLimited(ip) {
  const now = Date.now();
  let e = rate.get(ip);
  if (!e || now >= e.resetAt) { e = { count: 0, resetAt: now + 60_000 }; rate.set(ip, e); }
  e.count += 1;
  return e.count > RATE_PER_MIN;
}

let usage = { month: monthKey(), tokens: 0 };
function monthKey() { return new Date().toISOString().slice(0, 7); }
function budgetExceeded() {
  const m = monthKey();
  if (usage.month !== m) usage = { month: m, tokens: 0 }; // reset each month
  return usage.tokens >= MONTHLY_TOKEN_CAP;
}
function addUsage(u) { usage.tokens += usageTokens(u); }

const client = new Anthropic(); // reads ANTHROPIC_API_KEY from the environment

function clientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (xff) return String(xff).split(',')[0].trim();
  return req.socket?.remoteAddress || 'unknown';
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > 1e6) req.destroy(); });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function sendFallback(res, code) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({ fallback: true }));
}

const server = http.createServer(async (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', CORS_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  if (req.method === 'GET' && (req.url === '/' || req.url === '/health')) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      ok: true, service: 'ghostpace-ai-proxy', model: MODEL,
      keyLoaded: !!process.env.ANTHROPIC_API_KEY,
      monthTokens: usage.tokens, monthlyCap: MONTHLY_TOKEN_CAP,
    }));
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

  // Cost guardrails → 429 {fallback:true}. The frontend auto-falls-back to mock.
  if (rateLimited(clientIp(req))) { sendFallback(res, 429); return; }
  if (budgetExceeded()) { sendFallback(res, 429); return; }

  try {
    const raw = await readBody(req);
    const { task = 'coach', payload = {} } = JSON.parse(raw || '{}');
    const request = buildRequest(MODEL, task, payload, EFFORT);

    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-cache' });

    const stream = client.messages.stream(request);
    stream.on('text', (t) => res.write(t));
    const final = await stream.finalMessage();
    addUsage(final && final.usage); // accumulate monthly token budget
    res.end();
  } catch (err) {
    const msg = 'AI 처리 오류: ' + (err && err.message ? err.message : String(err));
    if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(msg);
  }
});

server.listen(PORT, () => {
  console.log(`GhostPace AI proxy on http://localhost:${PORT}  (model: ${MODEL}, thinking: ${isHaiku(MODEL) ? 'off' : 'adaptive'})`);
  console.log(`Cost caps: ${RATE_PER_MIN}/min per IP, ${MONTHLY_TOKEN_CAP.toLocaleString()} tokens/month`);
  console.log(`Frontend: set ai/config.js → AI_ENDPOINT = "http://localhost:${PORT}/api/ai"`);
});
