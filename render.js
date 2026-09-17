// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 CLSOFTLAB (씨엘소프트랩), Dr. Lee Il-guk (이일국)
//
// render.js — all drawing. Builds the schematic course track as an inline SVG
// path and places rider markers along it by distance fraction. No sim math
// lives here (that is race-engine.js); this module only turns state -> pixels.

import { mulberry32 } from './race-engine.js';

const SVGNS = 'http://www.w3.org/2000/svg';

// Generate a smooth closed loop track path from a course's shapeSeed.
// Points sit on an ellipse with seeded radial wobble; joined with a
// Catmull-Rom -> cubic Bezier conversion so the track reads as a real circuit.
export function trackPathD(course, w, h) {
  const rng = mulberry32(course.shapeSeed || 1);
  const cx = w / 2;
  const cy = h / 2;
  const rx = w * 0.4;
  const ry = h * 0.36;
  const n = 10 + Math.floor(rng() * 4); // 10..13 nodes
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const wob = 0.72 + rng() * 0.5; // radial variation
    pts.push([cx + Math.cos(a) * rx * wob, cy + Math.sin(a) * ry * wob]);
  }
  return catmullRomClosed(pts);
}

function catmullRomClosed(pts) {
  const n = pts.length;
  const p = (i) => pts[((i % n) + n) % n];
  let d = `M ${p(0)[0].toFixed(2)} ${p(0)[1].toFixed(2)} `;
  for (let i = 0; i < n; i++) {
    const p0 = p(i - 1), p1 = p(i), p2 = p(i + 1), p3 = p(i + 2);
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += `C ${c1x.toFixed(2)} ${c1y.toFixed(2)}, ${c2x.toFixed(2)} ${c2y.toFixed(2)}, ${p2[0].toFixed(2)} ${p2[1].toFixed(2)} `;
  }
  return d + 'Z';
}

// Build the whole track scene into an <svg>. Returns handles used every frame.
export function buildTrack(svg, course, riders) {
  const w = 100, h = 100; // viewBox units
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  svg.innerHTML = '';

  const d = trackPathD(course, w, h);

  // shadow / road base
  const base = el('path', { d, class: 'track-base' });
  // dashed centre line
  const line = el('path', { d, class: 'track-line' });
  svg.appendChild(base);
  svg.appendChild(line);

  // measure with a hidden path element
  const meas = el('path', { d });
  meas.style.visibility = 'hidden';
  svg.appendChild(meas);
  const totalLength = meas.getTotalLength ? meas.getTotalLength() : 1;

  // start/finish marker
  const start = meas.getPointAtLength ? meas.getPointAtLength(0) : { x: 50, y: 50 };
  const flag = el('g', { class: 'startflag' });
  flag.appendChild(el('circle', { cx: start.x, cy: start.y, r: 2.4, class: 'start-dot' }));
  svg.appendChild(flag);

  // rider markers
  const markers = {};
  for (const r of riders) {
    const g = el('g', { class: `rider rider-${r.kind}`, 'data-id': r.id });
    const dot = el('circle', { r: r.kind === 'player' ? 2.6 : 2.0, fill: r.color });
    dot.setAttribute('class', 'rider-dot');
    const label = el('text', { class: 'rider-label' });
    label.textContent = r.kind === 'player' ? 'YOU' : r.name;
    g.appendChild(dot);
    g.appendChild(label);
    svg.appendChild(g);
    markers[r.id] = { g, dot, label };
  }
  return { pathEl: meas, totalLength, markers, lengthM: 1 };
}

// Position every rider marker for the current frame.
export function drawRiders(scene, state) {
  const total = state.lengthM || 1;
  for (const r of state.riders) {
    const m = scene.markers[r.id];
    if (!m) continue;
    const frac = Math.max(0, Math.min(1, r.distance / total));
    // offset progress slightly per lap so overlapping riders fan out visually
    const pos = scene.pathEl.getPointAtLength(frac * scene.totalLength);
    m.g.setAttribute('transform', `translate(${pos.x.toFixed(2)} ${pos.y.toFixed(2)})`);
    m.g.classList.toggle('is-finished', r.finished);
    if (m.label) {
      m.label.setAttribute('x', 0);
      m.label.setAttribute('y', -3.4);
    }
  }
}

// Small helper for creating namespaced SVG elements.
function el(tag, attrs) {
  const node = document.createElementNS(SVGNS, tag);
  if (attrs) for (const k in attrs) node.setAttribute(k, attrs[k]);
  return node;
}

// Render the live standings list. Pure DOM given state.standings.
export function drawStandings(listEl, state) {
  if (!state.standings) return;
  const rows = state.standings
    .map((r) => {
      const you = r.id === 'player' ? ' me' : '';
      const km = (r.distance / 1000).toFixed(2);
      const fin = r.finished ? ' ✓' : '';
      return `<li class="stand-row${you}">
        <span class="rk">${r.rank}</span>
        <span class="sw" style="background:${r.color}"></span>
        <span class="nm">${r.id === 'player' ? '나' : escapeHtml(r.name)}${fin}</span>
        <span class="dist">${km}km</span>
      </li>`;
    })
    .join('');
  listEl.innerHTML = rows;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
