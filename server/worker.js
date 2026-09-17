// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 CLSOFTLAB (씨엘소프트랩), Dr. Lee Il-guk (이일국)
//
// server/worker.js — GhostPace AI proxy as a Cloudflare Worker (free tier).
//
// 무인(autonomous) hosting: no server to babysit. Same task routing + model /
// prompt-caching / thinking-gating / output-cap rules as the Node proxy — shared
// from ai-tasks.mjs. Calls the Anthropic REST API directly. The API key lives ONLY
// as the Worker secret ANTHROPIC_API_KEY (`wrangler secret put ANTHROPIC_API_KEY`)
// and is never sent to the browser.
//
// Deploy:  cd server && wrangler secret put ANTHROPIC_API_KEY && wrangler deploy
// Then set ai/config.js → AI_ENDPOINT = "https://<your-worker>.workers.dev/api/ai".

import { buildRequest, DEFAULT_MODEL } from './ai-tasks.mjs';

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';

// Per-isolate best-effort rate limit (Workers are stateless across isolates; use
// Cloudflare Rate Limiting rules for hard limits in production).
const rate = new Map(); // ip -> { count, resetAt }

function cors(origin) {
  return {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

function rateLimited(ip, perMin) {
  const now = Date.now();
  let e = rate.get(ip);
  if (!e || now >= e.resetAt) { e = { count: 0, resetAt: now + 60_000 }; rate.set(ip, e); }
  e.count += 1;
  return e.count > perMin;
}

export default {
  async fetch(request, env) {
    const origin = env.CORS_ORIGIN || '*';
    const headers = cors(origin);
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });

    if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/health')) {
      const model = env.AI_MODEL || DEFAULT_MODEL;
      return json({ ok: true, service: 'ghostpace-ai-worker', model, keyLoaded: !!env.ANTHROPIC_API_KEY }, 200, headers);
    }

    if (request.method !== 'POST' || !url.pathname.startsWith('/api/ai')) {
      return new Response('Not found', { status: 404, headers });
    }
    if (!env.ANTHROPIC_API_KEY) {
      return new Response('ANTHROPIC_API_KEY secret가 설정되지 않았습니다. (wrangler secret put ANTHROPIC_API_KEY)', { status: 500, headers });
    }

    // Cost guardrail → 429 {fallback:true}; the frontend auto-falls-back to mock.
    const perMin = Number(env.AI_RATE_PER_MIN) || 20;
    const ip = request.headers.get('cf-connecting-ip') ||
      (request.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'unknown';
    if (rateLimited(ip, perMin)) return json({ fallback: true }, 429, headers);

    let task = 'coach', payload = {};
    try {
      const body = await request.json();
      task = body.task || 'coach';
      payload = body.payload || {};
    } catch { /* empty/invalid body → defaults */ }

    const model = env.AI_MODEL || DEFAULT_MODEL;
    const effort = env.AI_EFFORT || 'low';
    const reqBody = buildRequest(model, task, payload, effort);

    let upstream;
    try {
      upstream = await fetch(ANTHROPIC_URL, {
        method: 'POST',
        headers: {
          'x-api-key': env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ ...reqBody, stream: false }),
      });
    } catch (err) {
      return json({ fallback: true, error: String(err && err.message || err) }, 429, headers);
    }

    if (!upstream.ok) {
      // On upstream failure, signal fallback so the app never breaks (무인).
      return json({ fallback: true, status: upstream.status }, 429, headers);
    }

    const data = await upstream.json();
    const text = Array.isArray(data.content)
      ? data.content.filter((b) => b.type === 'text').map((b) => b.text).join('')
      : '';
    // Token usage is available at data.usage for external metering / budgeting.
    return new Response(text, {
      status: 200,
      headers: { ...headers, 'Content-Type': 'text/plain; charset=utf-8' },
    });
  },
};

function json(obj, status, headers) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json; charset=utf-8' },
  });
}
