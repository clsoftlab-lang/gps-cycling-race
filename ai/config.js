// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 CLSOFTLAB (씨엘소프트랩), Dr. Lee Il-guk (이일국)
//
// ai/config.js — AI layer configuration.
//
// AI_ENDPOINT selects the provider used by ai/ai.js:
//   - ""  (empty, the default)  → DEMO MODE: deterministic Korean MockProvider,
//                                 grounded in the app's own courses / race data.
//   - "http://localhost:8787/api/ai" (or your deployed proxy URL)
//                               → REAL Claude, streamed through the backend proxy
//                                 in server/ (which alone holds ANTHROPIC_API_KEY).
//
// ⚠️ NEVER put an API key here or anywhere else in the browser/repo. The key
//    lives ONLY server-side (server/.env → process.env.ANTHROPIC_API_KEY).
export const AI_ENDPOINT = "";
