/* ============================================================
   THE ITERNAL ISLAND — a spatial version of the site.
   Not a game: no score, no failure. A circular island whose
   places are the site's sections; walking it is another way
   of reading the website.

   Staging is "Little Prince": the avatar stays front-centre and
   the world rotates underfoot. All reading content is real HTML
   in panels over the canvas — never 3D text.
   ============================================================ */

import * as THREE from './vendor/three.module.min.js';
import { STATIONS, PAGE_SPAWN, GALLERY_ITEMS, GALLERY_LABEL } from './content.js';

/* ── Brand palette ── */
const C = {
  tan: 0xe26713, gold: 0xe0a614, navy: 0x0a2156, blue: 0x1d6a91,
  aqua: 0x0bafaa, dark: 0x060f26, deep: 0x07133a, surf: 0x0c1d4e,
  grass: 0x123a63, grassLight: 0x175a78, cliff: 0x0a1c40, under: 0x071129,
  lamp: 0xffc878, white: 0xe8e4da,
};

const PATH_R = 24;          // radius the avatar and stations live on
const ISLAND_R = 30;
const NEAR_EPS = 0.16;      // radians: "you are at this station"
const WALK_SPEED = 0.55;    // radians per second

/* Deterministic rng so the island looks identical every visit */
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const lerp = (a, b, k) => a + (b - a) * k;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
/* shortest signed angular distance a→b */
function angTo(a, b) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

function el(tag, cls, html) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (html != null) n.innerHTML = html;
  return n;
}

/* Soft radial glow texture used for sprites, stars, the wisp */
function makeGlowTexture(inner = 'rgba(255,255,255,1)', outer = 'rgba(255,255,255,0)') {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 2, 64, 64, 62);
  grad.addColorStop(0, inner);
  grad.addColorStop(0.35, inner.replace(/,1\)$/, ',.55)'));
  grad.addColorStop(1, outer);
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/* Small text plate (station numbers etc.) as a sprite */
function makeTextSprite(text, colorCss = '#e0a614', px = 44) {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 128;
  const g = c.getContext('2d');
  g.font = `700 ${px}px 'Maven Pro', sans-serif`;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.shadowColor = colorCss; g.shadowBlur = 18;
  g.fillStyle = colorCss;
  g.fillText(text, 64, 66);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.SpriteMaterial({ map: t, transparent: true, depthWrite: false });
  const s = new THREE.Sprite(m);
  s.scale.set(2.2, 2.2, 1);
  return s;
}

/* ============================================================
   OVERLAY CSS (HUD, panels, chip, map)
   ============================================================ */
const CSS = `
.isl-root {
  position: fixed; inset: 0; z-index: 9980;
  background: #060f26; display: none;
  opacity: 0; transition: opacity .4s ease;
  font-family: var(--f, 'Maven Pro', sans-serif);
  cursor: none;
}
.isl-root.on { opacity: 1; }
.isl-root canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
.isl-sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }

.isl-top {
  position: absolute; top: 0; left: 0; right: 0;
  display: flex; align-items: center; justify-content: space-between;
  padding: 18px 26px; pointer-events: none;
}
.isl-brand { display: flex; align-items: center; gap: 12px; }
.isl-brand img { height: 20px; display: block; }
.isl-brand span {
  font-size: 11px; font-weight: 700; letter-spacing: .18em;
  text-transform: uppercase; color: rgba(255,255,255,.55);
}
.isl-exit {
  pointer-events: auto;
  background: rgba(255,255,255,.06);
  border: 1px solid rgba(255,255,255,.16);
  color: #fff; font-family: inherit;
  font-size: 11px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase;
  padding: 9px 16px; border-radius: 3px; cursor: none;
  backdrop-filter: blur(8px); transition: background .2s;
}
.isl-exit:hover { background: rgba(255,255,255,.14); }

.isl-chip {
  position: absolute; left: 50%; bottom: 34px; transform: translateX(-50%) translateY(8px);
  background: rgba(7,19,58,.78); border: 1px solid rgba(255,255,255,.12);
  border-radius: 100px; padding: 10px 22px;
  display: flex; align-items: center; gap: 12px;
  color: #fff; backdrop-filter: blur(10px);
  opacity: 0; transition: opacity .25s, transform .25s;
  pointer-events: none; white-space: nowrap; max-width: 92vw;
}
.isl-chip.on { opacity: 1; transform: translateX(-50%) translateY(0); }
.isl-chip b { font-size: 13px; font-weight: 700; letter-spacing: .04em; }
.isl-chip span { font-size: 11.5px; opacity: .6; letter-spacing: .06em; text-transform: uppercase; }

.isl-hint {
  position: absolute; left: 26px; bottom: 30px;
  font-size: 11.5px; letter-spacing: .05em; color: rgba(255,255,255,.5);
  max-width: 300px; line-height: 1.7;
  opacity: 0; transition: opacity .5s; pointer-events: none;
}
.isl-hint.on { opacity: 1; }

.isl-map { position: absolute; right: 26px; bottom: 26px; }
.isl-map svg { display: block; }
.isl-map .isl-dot-st { cursor: none; pointer-events: auto; }
.isl-map .isl-dot-st:focus { outline: none; }
.isl-map .isl-dot-st:focus circle { stroke: #e0a614; stroke-width: 2px; }

.isl-scrim {
  position: absolute; inset: 0; background: rgba(4,9,26,.35);
  opacity: 0; transition: opacity .3s; pointer-events: none;
}
.isl-scrim.on { opacity: 1; pointer-events: auto; }

.isl-panel {
  position: absolute; top: 0; right: 0; bottom: 0;
  width: min(500px, 94vw);
  background: rgba(7,19,58,.88);
  border-left: 1px solid rgba(255,255,255,.08);
  backdrop-filter: blur(16px);
  transform: translateX(102%); transition: transform .38s cubic-bezier(.3,.8,.3,1);
  display: flex; flex-direction: column;
  color: #fff;
}
.isl-panel.on { transform: translateX(0); }
.isl-panel-head {
  display: flex; align-items: flex-start; justify-content: space-between;
  padding: 24px 28px 0;
}
.isl-panel-kicker {
  font-size: 11px; font-weight: 700; letter-spacing: .16em; text-transform: uppercase;
  color: #e0a614; margin-bottom: 6px;
}
.isl-panel-title { font-size: 13px; font-weight: 700; letter-spacing: .05em; opacity: .55; text-transform: uppercase; }
.isl-panel-close {
  background: rgba(255,255,255,.07); border: 1px solid rgba(255,255,255,.14);
  border-radius: 50%; width: 34px; height: 34px; flex: none;
  color: #fff; font-size: 15px; line-height: 1; cursor: none; font-family: inherit;
}
.isl-panel-close:hover { background: rgba(255,255,255,.16); }
.isl-panel-body { padding: 18px 28px 34px; overflow-y: auto; overscroll-behavior: contain; }

.isl-panel-body .ip-h { font-size: 25px; font-weight: 800; line-height: 1.18; margin: 4px 0 14px; }
.isl-panel-body .ip-warm {
  background: linear-gradient(135deg, #e26713, #e0a614);
  -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent;
}
.isl-panel-body .ip-p { font-size: 14.5px; line-height: 1.68; opacity: .85; margin-bottom: 14px; }
.isl-panel-body .ip-note { font-size: 12px; line-height: 1.6; opacity: .5; margin-top: 16px; }
.isl-panel-body .ip-pts, .isl-panel-body .ip-svcs { display: grid; gap: 16px; margin: 18px 0 6px; }
.isl-panel-body .ip-pt, .isl-panel-body .ip-svc { display: flex; gap: 14px; }
.isl-panel-body .ip-pt-n { color: #e0a614; font-weight: 700; font-size: 13px; padding-top: 2px; }
.isl-panel-body .ip-pt-h { font-size: 15px; font-weight: 700; margin-bottom: 4px; }
.isl-panel-body .ip-pt-p { font-size: 13.5px; line-height: 1.6; opacity: .72; }
.isl-panel-body .ip-cases { display: grid; gap: 14px; margin: 16px 0 4px; }
.isl-panel-body .ip-case {
  border: 1px solid rgba(255,255,255,.09); border-radius: 8px; padding: 14px 16px;
}
.isl-panel-body .ip-case-img { width: 100%; border-radius: 6px; margin-bottom: 10px; display: block; }
.isl-panel-body .ip-case-h { font-size: 15.5px; font-weight: 700; margin: 8px 0 4px; }
.isl-panel-body .ip-case-p { font-size: 13px; line-height: 1.6; opacity: .72; }
.isl-panel-body .ip-badge {
  display: inline-block; font-size: 10px; font-weight: 700; letter-spacing: .1em;
  text-transform: uppercase; color: #e0a614;
  border: 1px solid rgba(224,166,20,.4); border-radius: 100px; padding: 3px 10px;
}
.isl-panel-body .ip-tags { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
.isl-panel-body .ip-tag {
  font-size: 11px; letter-spacing: .02em; color: rgba(255,255,255,.75);
  border: 1px solid rgba(11,175,170,.4); border-radius: 100px; padding: 3px 10px;
}
.isl-panel-body .ip-ideas { display: grid; gap: 18px; margin: 16px 0 4px; }
.isl-panel-body .ip-idea-meta { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
.isl-panel-body .ip-idea-date { font-size: 11px; opacity: .5; }
.isl-panel-body .ip-actions { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 20px; }
.isl-panel-body .ip-btn {
  background: linear-gradient(135deg, #e26713, #e0a614); color: #fff;
  border: none; border-radius: 3px; font-family: inherit; text-decoration: none;
  font-size: 12px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase;
  padding: 12px 22px; cursor: none; display: inline-block;
}
.isl-panel-body .ip-btn-line {
  background: transparent; color: #fff;
  border: 1px solid rgba(255,255,255,.28); border-radius: 3px; font-family: inherit;
  font-size: 12px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase;
  padding: 12px 22px; cursor: none; display: inline-block; text-decoration: none;
}
.isl-panel-body .ip-gal-img { width: 100%; border-radius: 8px; margin: 14px 0; display: block; }

/* Light theme */
html[data-theme="light"] .isl-root { background: #f4f1ec; }
html[data-theme="light"] .isl-brand span { color: rgba(10,33,86,.6); }
html[data-theme="light"] .isl-exit { background: rgba(10,33,86,.06); border-color: rgba(10,33,86,.25); color: #0a2156; }
html[data-theme="light"] .isl-exit:hover { background: rgba(10,33,86,.12); }
html[data-theme="light"] .isl-chip { background: rgba(255,255,255,.8); border-color: rgba(10,33,86,.15); color: #0a2156; }
html[data-theme="light"] .isl-hint { color: rgba(10,33,86,.55); }
html[data-theme="light"] .isl-scrim { background: rgba(234,230,223,.4); }
html[data-theme="light"] .isl-panel { background: rgba(244,241,236,.92); border-left-color: rgba(10,33,86,.12); color: #0a2156; }
html[data-theme="light"] .isl-panel-close { background: rgba(10,33,86,.06); border-color: rgba(10,33,86,.2); color: #0a2156; }
html[data-theme="light"] .isl-panel-body .ip-tag { color: rgba(10,33,86,.75); }
html[data-theme="light"] .isl-panel-body .ip-case { border-color: rgba(10,33,86,.14); }
html[data-theme="light"] .isl-panel-body .ip-btn-line { color: #0a2156; border-color: rgba(10,33,86,.35); }

@media (max-width: 1100px) {
  .isl-hint { bottom: 96px; }
}
@media (max-width: 640px) {
  .isl-top { padding: 14px 16px; }
  .isl-hint { left: 16px; bottom: 96px; max-width: 220px; }
  .isl-map { right: 16px; bottom: 16px; transform: scale(.85); transform-origin: bottom right; }
  .isl-chip {
    bottom: 90px; white-space: normal; text-align: center;
    flex-direction: column; gap: 3px; padding: 10px 18px; border-radius: 16px;
  }
}
@media (prefers-reduced-motion: reduce) {
  .isl-root, .isl-panel, .isl-chip { transition: none; }
}
`;

let cssInjected = false;

/* ============================================================
   createIsland — builds everything once, returns { enter, exit }
   ============================================================ */
export async function createIsland({ page, onExit } = {}) {
  if (!cssInjected) {
    const s = document.createElement('style');
    s.textContent = CSS;
    document.head.appendChild(s);
    cssInjected = true;
  }

  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const coarse = matchMedia('(pointer: coarse)').matches;
  const rng = mulberry32(20260702);

  /* stations with radians + runtime state */
  const stations = STATIONS.map(s => ({ ...s, rad: THREE.MathUtils.degToRad(s.angle), group: null }));
  const stationById = id => stations.find(s => s.id === id);

  /* ── DOM scaffold ── */
  const root = el('div', 'isl-root');
  root.tabIndex = -1;
  root.setAttribute('role', 'application');
  root.setAttribute('aria-label', 'The Iternal island — an explorable version of this site');

  const canvas = document.createElement('canvas');
  root.appendChild(canvas);

  const live = el('div', 'isl-sr');
  live.setAttribute('aria-live', 'polite');
  root.appendChild(live);

  const top = el('div', 'isl-top');
  const brand = el('div', 'isl-brand');
  const logo = document.createElement('img');
  logo.src = 'assets/logo-white.png';
  logo.alt = 'Iternal';
  brand.appendChild(logo);
  brand.appendChild(el('span', null, 'The Island'));
  const exitBtn = el('button', 'isl-exit', 'Exit the island&ensp;·&ensp;Esc');
  exitBtn.type = 'button';
  top.append(brand, exitBtn);
  root.appendChild(top);

  const chip = el('div', 'isl-chip');
  const chipTitle = el('b');
  const chipHint = el('span');
  chip.append(chipTitle, chipHint);
  root.appendChild(chip);

  const hint = el('div', 'isl-hint', coarse
    ? 'Hold the left or right side of the screen to walk.<br>Tap a place to walk to it — tap again to enter.'
    : 'Hold &larr; &rarr; to walk &middot; click a place to walk to it,<br>click again to enter &middot; E enters &middot; Esc leaves.');
  root.appendChild(hint);

  /* ring map */
  const mapWrap = el('div', 'isl-map');
  const SVGNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(SVGNS, 'svg');
  svg.setAttribute('width', '92'); svg.setAttribute('height', '92');
  svg.setAttribute('viewBox', '-46 -46 92 92');
  const ringCircle = document.createElementNS(SVGNS, 'circle');
  ringCircle.setAttribute('r', '32');
  ringCircle.setAttribute('fill', 'none');
  ringCircle.setAttribute('stroke', 'rgba(160,180,220,.35)');
  ringCircle.setAttribute('stroke-width', '1');
  svg.appendChild(ringCircle);
  const dotGroup = document.createElementNS(SVGNS, 'g');
  svg.appendChild(dotGroup);
  const mapDots = stations.map(st => {
    const g = document.createElementNS(SVGNS, 'g');
    g.setAttribute('class', 'isl-dot-st');
    g.setAttribute('tabindex', '0');
    g.setAttribute('role', 'button');
    g.setAttribute('aria-label', `Travel to ${st.title}`);
    const c = document.createElementNS(SVGNS, 'circle');
    c.setAttribute('r', '4');
    c.setAttribute('cx', String(Math.sin(st.rad) * 32));
    c.setAttribute('cy', String(-Math.cos(st.rad) * 32));
    c.setAttribute('fill', 'rgba(150,170,215,.9)');
    const t = document.createElementNS(SVGNS, 'title');
    t.textContent = st.title;
    g.append(t, c);
    dotGroup.appendChild(g);
    return { g, c, st };
  });
  /* fixed "you" marker at the top of the map */
  const you = document.createElementNS(SVGNS, 'circle');
  you.setAttribute('r', '2.6');
  you.setAttribute('cx', '0'); you.setAttribute('cy', '-32');
  you.setAttribute('fill', '#e0a614');
  you.setAttribute('stroke', 'rgba(224,166,20,.35)');
  you.setAttribute('stroke-width', '4');
  svg.appendChild(you);
  mapWrap.appendChild(svg);
  root.appendChild(mapWrap);

  /* panel */
  const scrim = el('div', 'isl-scrim');
  const panel = el('aside', 'isl-panel');
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.innerHTML = `
    <div class="isl-panel-head">
      <div><div class="isl-panel-kicker"></div><div class="isl-panel-title"></div></div>
      <button type="button" class="isl-panel-close" aria-label="Close panel">&#10005;</button>
    </div>
    <div class="isl-panel-body" tabindex="-1"></div>
  `;
  root.append(scrim, panel);
  const panelKicker = panel.querySelector('.isl-panel-kicker');
  const panelTitle = panel.querySelector('.isl-panel-title');
  const panelBody = panel.querySelector('.isl-panel-body');
  const panelClose = panel.querySelector('.isl-panel-close');

  document.body.appendChild(root);

  /* site's custom cursor: grow over our interactive elements */
  const cur = document.getElementById('cur');
  const hoverGrow = el2 => {
    if (!cur || !el2) return;
    el2.addEventListener('mouseenter', () => cur.classList.add('big'));
    el2.addEventListener('mouseleave', () => cur.classList.remove('big'));
  };
  [exitBtn, panelClose, mapWrap].forEach(hoverGrow);

  /* ── Renderer / scene / camera ── */
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, coarse ? 1.75 : 2));
  renderer.toneMapping = THREE.NoToneMapping;

  const scene = new THREE.Scene();

  const camera = new THREE.PerspectiveCamera(44, 1, 0.1, 400);
  /* each mode frames the world differently; the camera lerps between rigs */
  const RIGS = {
    island: { pos: new THREE.Vector3(0, 10.5, PATH_R + 22), tgt: new THREE.Vector3(0, 3.2, PATH_R - 2) },
    gallery: { pos: new THREE.Vector3(0, 4.6, 36.5), tgt: new THREE.Vector3(0, 2.6, 21.5) },
  };
  const camPos = RIGS.island.pos.clone();
  const camTarget = RIGS.island.tgt.clone();
  camera.position.copy(camPos);
  camera.lookAt(camTarget);

  /* ── Lights (theme-adjusted later) ── */
  const hemi = new THREE.HemisphereLight(0x1d3a6e, 0x07133a, 0.6);
  const sun = new THREE.DirectionalLight(0xffd9a0, 1.0);
  sun.position.set(45, 65, 25);
  scene.add(hemi, sun);

  /* ── Sky ── */
  const skyGroup = new THREE.Group();
  scene.add(skyGroup);
  const starTex = makeGlowTexture('rgba(255,255,255,1)');
  function starField(count, size, color, opacity) {
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const a = rng() * Math.PI * 2;
      const y = (rng() * 2 - 0.35) * 90;
      const r = 120 + rng() * 60;
      pos[i * 3] = Math.sin(a) * r;
      pos[i * 3 + 1] = y;
      pos[i * 3 + 2] = Math.cos(a) * r;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const m = new THREE.PointsMaterial({
      map: starTex, size, color, transparent: true, opacity,
      sizeAttenuation: false, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const p = new THREE.Points(g, m);
    skyGroup.add(p);
    return p;
  }
  const stars1 = starField(340, 2.6, 0xffffff, 0.85);
  const stars2 = starField(160, 3.4, 0x9fdfe0, 0.55);

  /* ── The world (rotates underfoot) ── */
  const world = new THREE.Group();
  scene.add(world);

  /* the pond lives in the quiet wedge between the reading room and the lighthouse;
     its stream runs outward along the same bearing and falls off the rim */
  const STREAM_A = 4.94;
  const POND = { x: Math.sin(STREAM_A) * 12, z: Math.cos(STREAM_A) * 12, r: 3.4 };

  /* terrain height used by props so they sit on the ground */
  function bumpAt(x, z) {
    const r = Math.hypot(x, z);
    let b = Math.sin(x * 0.55 + z * 0.83) * Math.cos(x * 0.31 - z * 0.47) * 1.05
          + Math.sin(x * 1.7 + z * 1.1) * 0.22;
    let mask = 1;
    const pathDist = Math.abs(r - PATH_R);
    if (pathDist < 3) mask *= 0.12 + 0.88 * (pathDist / 3);          // flat walking ring
    const theta = Math.atan2(x, z);
    for (const st of stations) {
      if (Math.abs(angTo(theta, st.rad)) < 0.3 && r > 19 && r < 29.5) mask *= 0.08; // station pads
    }
    if (r > ISLAND_R - 1.2) mask *= 0.4;
    let y = b * mask;
    if (r < 9) y += 1.35 * Math.pow((9 - r) / 9, 1.4);               // gentle rise up to the Core
    const pd = Math.hypot(x - POND.x, z - POND.z);
    if (pd < POND.r + 1.6) {
      const k = Math.max(0, 1 - pd / (POND.r + 1.6));
      y = y * (1 - k) - 0.55 * k;                                    // pond basin
    }
    return y;
  }

  /* tessellated disc (concentric rings) — a cylinder cap is a single fan
     with no interior vertices, so the hill and pond would never show */
  function discGeometry(R, ringsN, segs) {
    const rings = [[[0, 0]]];
    for (let k = 1; k <= ringsN; k++) {
      const rr = (R * k) / ringsN, ring = [];
      for (let s = 0; s < segs; s++) {
        const a = (s / segs) * Math.PI * 2;
        ring.push([Math.sin(a) * rr, Math.cos(a) * rr]);
      }
      rings.push(ring);
    }
    const positions = [];
    const tri = (p1, p2, p3) => positions.push(p1[0], 0, p1[1], p2[0], 0, p2[1], p3[0], 0, p3[1]);
    for (let s = 0; s < segs; s++) tri(rings[0][0], rings[1][s], rings[1][(s + 1) % segs]);
    for (let k = 1; k < ringsN; k++) {
      for (let s = 0; s < segs; s++) {
        const a1 = rings[k][s], a2 = rings[k][(s + 1) % segs];
        const b1 = rings[k + 1][s], b2 = rings[k + 1][(s + 1) % segs];
        tri(a1, b1, b2);
        tri(a1, b2, a2);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
    return geo;   // non-indexed by construction — right for flat shading
  }

  function colourise(geo) {
    const pos = geo.getAttribute('position');
    const colors = new Float32Array(pos.count * 3);
    const cGrass = new THREE.Color(C.grass), cGrassL = new THREE.Color(C.grassLight);
    const cAqua = new THREE.Color(0x14606e), cCliff = new THREE.Color(C.cliff);
    const cEdge = new THREE.Color(0x0d2748), tmp = new THREE.Color();
    for (let f = 0; f < pos.count; f += 3) {
      const ax = (pos.getX(f) + pos.getX(f + 1) + pos.getX(f + 2)) / 3;
      const ay = (pos.getY(f) + pos.getY(f + 1) + pos.getY(f + 2)) / 3;
      const az = (pos.getZ(f) + pos.getZ(f + 1) + pos.getZ(f + 2)) / 3;
      const r = Math.hypot(ax, az);
      const h = Math.abs(Math.sin(ax * 2.1 + az * 1.3) * Math.cos(ax * 0.7 - az * 1.9));
      if (ay > -0.95) {
        if (Math.hypot(ax - POND.x, az - POND.z) < POND.r + 0.4) tmp.set(0x0a2038); // pond bed
        else if (r > ISLAND_R - 1.6) tmp.copy(cEdge);
        else if (h > 0.82) tmp.copy(cAqua);
        else tmp.copy(cGrass).lerp(cGrassL, h * 0.8);
      } else {
        tmp.copy(cCliff).lerp(new THREE.Color(C.under), clamp((-ay - 1) / 5, 0, 1));
      }
      for (let v = 0; v < 3; v++) { colors[(f + v) * 3] = tmp.r; colors[(f + v) * 3 + 1] = tmp.g; colors[(f + v) * 3 + 2] = tmp.b; }
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  }

  function buildTerrain() {
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.95, side: THREE.DoubleSide });

    /* top surface */
    const top = discGeometry(ISLAND_R, 15, 72);
    const tp = top.getAttribute('position');
    for (let i = 0; i < tp.count; i++) tp.setY(i, bumpAt(tp.getX(i), tp.getZ(i)));
    top.computeVertexNormals();
    colourise(top);
    world.add(new THREE.Mesh(top, mat));

    /* cliff sides (open-ended — the disc is the cap) */
    const geo = new THREE.CylinderGeometry(ISLAND_R, ISLAND_R + 4.5, 6, 72, 3, true).toNonIndexed();
    geo.translate(0, -3, 0);
    const pos = geo.getAttribute('position');
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      if (y > -0.01) pos.setY(i, bumpAt(pos.getX(i), pos.getZ(i)));
    }
    geo.computeVertexNormals();
    colourise(geo);
    world.add(new THREE.Mesh(geo, mat));

    /* rocky underside */
    const under = new THREE.CylinderGeometry(ISLAND_R + 4.5, 2.5, 20, 26, 4).toNonIndexed();
    under.translate(0, -16, 0);
    const up = under.getAttribute('position');
    for (let i = 0; i < up.count; i++) {
      const y = up.getY(i);
      if (y < -7.5) {
        const j = Math.sin(up.getX(i) * 1.3 + up.getZ(i) * 0.9 + y) * 1.8;
        up.setX(i, up.getX(i) + j); up.setZ(i, up.getZ(i) - j * 0.7);
      }
    }
    under.computeVertexNormals();
    const um = new THREE.MeshStandardMaterial({ color: C.under, flatShading: true, roughness: 1 });
    world.add(new THREE.Mesh(under, um));

    /* walking ring guide */
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(PATH_R, 0.14, 6, 128),
      new THREE.MeshBasicMaterial({ color: C.aqua, transparent: true, opacity: 0.28, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.32;
    world.add(ring);
  }
  buildTerrain();

  /* ── Props ── */
  const stdMat = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.9, ...extra });
  const glowMat = (color, intensity = 1.2) => new THREE.MeshStandardMaterial({
    color, emissive: color, emissiveIntensity: intensity, flatShading: true, roughness: 0.6,
  });

  function makeTree(scale = 1, golden = false) {
    const g = new THREE.Group();
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.2, 0.9, 5), stdMat(0x1a2a4d));
    trunk.position.y = 0.45;
    g.add(trunk);
    const col = golden ? 0xa87a10 : (rng() > 0.5 ? 0x0e3550 : 0x11486b);
    let y = 1.1, r = 0.95;
    for (let i = 0; i < 3; i++) {
      const cone = new THREE.Mesh(new THREE.ConeGeometry(r, 1.25, 6), stdMat(col));
      cone.position.y = y;
      g.add(cone);
      y += 0.72; r *= 0.72;
    }
    g.scale.setScalar(scale);
    return g;
  }

  function placeOnGround(obj, angle, radius, rotY = null) {
    obj.position.set(Math.sin(angle) * radius, bumpAt(Math.sin(angle) * radius, Math.cos(angle) * radius), Math.cos(angle) * radius);
    obj.rotation.y = rotY == null ? rng() * Math.PI * 2 : rotY;
    world.add(obj);
  }

  /* inner trees + rocks, avoiding station pads, the Core glade, the pond and the ley lines */
  const clearOfStations = (a, eps) => stations.every(st => Math.abs(angTo(a, st.rad)) > eps);
  const innerSpotFree = (a, r) => {
    if (r < 7.5) return false;                                        // the Core's glade
    const x = Math.sin(a) * r, z = Math.cos(a) * r;
    if (Math.hypot(x - POND.x, z - POND.z) < POND.r + 1.8) return false;
    if (Math.abs(angTo(a, STREAM_A)) * r < 1.6) return false;         // the stream's course
    return stations.every(st => Math.abs(angTo(a, st.rad)) * r > 1.4); // ley-line spokes
  };
  let planted = 0;
  for (let i = 0; i < 60 && planted < 22; i++) {
    const a = rng() * Math.PI * 2, r = 7.5 + rng() * 12;
    if (!innerSpotFree(a, r)) continue;
    placeOnGround(makeTree(0.8 + rng() * 0.9, rng() > 0.88), a, r);
    planted++;
  }
  for (let i = 0; i < 9; i++) {
    const a = rng() * Math.PI * 2;
    if (!clearOfStations(a, 0.35) || Math.abs(angTo(a, STREAM_A)) < 0.12) continue;
    placeOnGround(makeTree(0.7 + rng() * 0.6, rng() > 0.85), a, 27.4 + rng() * 1.9);
  }
  for (let i = 0; i < 20; i++) {
    const a = rng() * Math.PI * 2, r = 7.5 + rng() * 20.5;
    if (r > 20 && !clearOfStations(a, 0.28)) continue;
    if (r <= 20 && !innerSpotFree(a, r)) continue;
    const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(0.3 + rng() * 0.7, 0), stdMat(C.deep));
    placeOnGround(rock, a, r);
  }

  /* floating rocks below + companion islets for depth */
  const floaters = [];
  for (let i = 0; i < 6; i++) {
    const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(1 + rng() * 2.4, 0), stdMat(C.under));
    const a = rng() * Math.PI * 2, r = 16 + rng() * 22;
    rock.position.set(Math.sin(a) * r, -13 - rng() * 9, Math.cos(a) * r);
    rock.userData.phase = rng() * Math.PI * 2;
    rock.userData.baseY = rock.position.y;
    world.add(rock);
    floaters.push(rock);
  }
  for (let i = 0; i < 3; i++) {
    const islet = new THREE.Group();
    const topR = 2.2 + rng() * 2.2;
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(topR, topR + 0.8, 1.4, 9), stdMat(C.grass));
    const bot = new THREE.Mesh(new THREE.CylinderGeometry(topR + 0.8, 0.6, 4.5, 9), stdMat(C.under));
    bot.position.y = -2.9;
    islet.add(cap, bot);
    islet.add(makeTree(0.9, i === 1));
    islet.children[2].position.y = 0.6;
    const a = rng() * Math.PI * 2, r = 52 + rng() * 22;
    islet.position.set(Math.sin(a) * r, -6 + rng() * 10, Math.cos(a) * r);
    islet.userData.phase = rng() * Math.PI * 2;
    islet.userData.baseY = islet.position.y;
    world.add(islet);
    floaters.push(islet);
  }

  /* ── The island's heart ──
     A Core monument on the central rise — the site's orbital motif writ
     large — with ley lines running out to every station and light pulses
     travelling along them: the small core powering the seven places. */
  const heart = { rings: [], pulses: [], leyMats: [] };

  {
    const g = new THREE.Group();
    const baseY = bumpAt(0, 0);
    g.position.y = baseY - 0.15;
    /* stepped plinth, bottom step sunk into the hill */
    const steps = [[3.2, 0.7], [2.4, 0.5], [1.6, 0.45]];
    let sy = 0;
    for (const [sr, sh] of steps) {
      const step = new THREE.Mesh(new THREE.CylinderGeometry(sr, sr + 0.25, sh, 9), stdMat(C.surf));
      step.position.y = sy + sh / 2;
      step.rotation.y = rng() * 0.8;
      g.add(step);
      sy += sh;
    }
    /* four weathered stones around it */
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + 0.5;
      const stone = new THREE.Mesh(new THREE.BoxGeometry(0.6, 1.6 + rng() * 0.7, 0.45), stdMat(0x14315f));
      stone.position.set(Math.sin(a) * 4.6, 0.7, Math.cos(a) * 4.6);
      stone.rotation.set((rng() - 0.5) * 0.12, rng() * Math.PI, (rng() - 0.5) * 0.12);
      g.add(stone);
    }
    /* the floating core orb */
    const orbGroup = new THREE.Group();
    orbGroup.position.y = sy + 2.2;
    heart.orbGroup = orbGroup;
    heart.orbBaseY = sy + 2.2;
    const orb = new THREE.Mesh(new THREE.SphereGeometry(0.8, 16, 12), glowMat(C.gold, 2.2));
    const orbGlow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: makeGlowTexture('rgba(255,200,120,1)'), transparent: true, opacity: 0.75,
      depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    orbGlow.scale.setScalar(5);
    const orbLight = new THREE.PointLight(0xffc878, 12, 30, 1.4);
    heart.orbLight = orbLight;
    orbGroup.add(orb, orbGlow, orbLight);
    /* three orbit rings at different tilts — the homepage motif */
    const ringDefs = [
      [1.7, C.aqua, 0.55, 'z', 0.5],
      [2.4, C.gold, 0.45, 'x', -0.35],
      [3.1, C.blue, 0.4, 'z', 0.24],
    ];
    for (const [rr, col, op, , sp] of ringDefs) {
      const holder = new THREE.Group();
      holder.rotation.set(rng() * 0.9, rng() * Math.PI, rng() * 0.9);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(rr, 0.04, 6, 48),
        new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: op, blending: THREE.AdditiveBlending, depthWrite: false }));
      const dot = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), glowMat(col, 1.8));
      dot.position.x = rr;
      ring.add(dot);
      holder.add(ring);
      orbGroup.add(holder);
      /* spin carries the dot round the ring; the slow tumble stops any
         ring parking edge-on to the camera, where it reads as a line */
      heart.rings.push({ holder, ring, sp, tum: 0.1 + rng() * 0.12 });
    }
    g.add(orbGroup);
    world.add(g);
  }

  /* ley lines: centre → each station, with a pulse running outward */
  {
    const pulseTex = makeGlowTexture('rgba(120,235,225,1)');
    for (const st of stations) {
      const pts = [];
      const N = 26;
      for (let i = 0; i < N; i++) {
        const rr = 4.4 + ((22.3 - 4.4) * i) / (N - 1);
        const x = Math.sin(st.rad) * rr, z = Math.cos(st.rad) * rr;
        pts.push(new THREE.Vector3(x, bumpAt(x, z) + 0.14, z));
      }
      const lineMat = new THREE.LineBasicMaterial({
        color: C.aqua, transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false,
      });
      heart.leyMats.push(lineMat);
      world.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), lineMat));
      const spr = new THREE.Sprite(new THREE.SpriteMaterial({
        map: pulseTex, color: 0xaef2ec, transparent: true, opacity: 0.9,
        depthWrite: false, blending: THREE.AdditiveBlending,
      }));
      spr.scale.setScalar(1.1);
      spr.position.copy(pts[0]);
      spr.visible = !reduced;    // pulses are motion; the static lines stay for reduced-motion visitors
      world.add(spr);
      heart.pulses.push({ spr, pts, u: rng(), speed: 0.09 + rng() * 0.05 });
    }
  }

  /* the pond */
  {
    const pondY = bumpAt(POND.x, POND.z);
    const water = new THREE.Mesh(
      new THREE.CircleGeometry(POND.r, 24),
      new THREE.MeshStandardMaterial({
        color: 0x0d3a5c, emissive: C.aqua, emissiveIntensity: 0.18,
        roughness: 0.25, transparent: true, opacity: 0.92,
      })
    );
    water.rotation.x = -Math.PI / 2;
    water.position.set(POND.x, pondY + 0.32, POND.z);
    world.add(water);
    heart.water = water.material;
    /* reeds, lilies, shore rocks */
    for (let i = 0; i < 9; i++) {
      const a = rng() * Math.PI * 2, rr = POND.r * (0.75 + rng() * 0.35);
      const x = POND.x + Math.sin(a) * rr, z = POND.z + Math.cos(a) * rr;
      const reed = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.04, 0.9 + rng() * 0.7, 4), stdMat(0x14606e));
      reed.position.set(x, pondY + 0.7, z);
      reed.rotation.set((rng() - 0.5) * 0.2, 0, (rng() - 0.5) * 0.2);
      world.add(reed);
    }
    for (let i = 0; i < 4; i++) {
      const a = rng() * Math.PI * 2, rr = POND.r * (0.2 + rng() * 0.5);
      const lily = new THREE.Mesh(new THREE.CircleGeometry(0.22 + rng() * 0.15, 7), stdMat(0x1a6a5e));
      lily.rotation.x = -Math.PI / 2;
      lily.position.set(POND.x + Math.sin(a) * rr, pondY + 0.34, POND.z + Math.cos(a) * rr);
      world.add(lily);
    }
    for (let i = 0; i < 5; i++) {
      const a = rng() * Math.PI * 2;
      const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(0.25 + rng() * 0.45, 0), stdMat(C.deep));
      const rr = POND.r + 0.5 + rng() * 0.6;
      const x = POND.x + Math.sin(a) * rr, z = POND.z + Math.cos(a) * rr;
      rock.position.set(x, bumpAt(x, z) + 0.15, z);
      world.add(rock);
    }
    /* fallen-log bench facing the water */
    const log = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.32, 2.4, 7), stdMat(0x1a2a4d));
    const lx = POND.x * 1.42, lz = POND.z * 1.42;
    log.position.set(lx, bumpAt(lx, lz) + 0.3, lz);
    log.rotation.set(Math.PI / 2, 0, Math.atan2(POND.x, POND.z) + Math.PI / 2 + 0.25);
    world.add(log);
  }

  /* ── stream + waterfall: the pond drains over the rim ── */
  {
    /* ribbon: strip of quads along a centreline, tangential width */
    const ribbonGeo = (pts, halfWs) => {
      const P = [], UV = [], IDX = [];
      for (let i = 0; i < pts.length; i++) {
        const prev = pts[Math.max(0, i - 1)], next = pts[Math.min(pts.length - 1, i + 1)];
        let dx = next.x - prev.x, dz = next.z - prev.z;
        const len = Math.hypot(dx, dz) || 1;
        dx /= len; dz /= len;
        const hw = Array.isArray(halfWs) ? halfWs[i] : halfWs;
        const p = pts[i];
        P.push(p.x - dz * hw, p.y, p.z + dx * hw, p.x + dz * hw, p.y, p.z - dx * hw);
        const v = i / (pts.length - 1);
        UV.push(0, v, 1, v);
        if (i > 0) {
          const b = i * 2;
          IDX.push(b - 2, b - 1, b, b - 1, b + 1, b);
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(P), 3));
      g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(UV), 2));
      g.setIndex(IDX);
      g.computeVertexNormals();
      return g;
    };

    /* the stream, pond → rim, sharing the pond water's material */
    const sPts = [];
    for (let i = 0; i <= 16; i++) {
      const rr = 15.1 + ((29.9 - 15.1) * i) / 16;
      const x = Math.sin(STREAM_A) * rr, z = Math.cos(STREAM_A) * rr;
      sPts.push(new THREE.Vector3(x, bumpAt(x, z) + 0.12, z));
    }
    world.add(new THREE.Mesh(ribbonGeo(sPts, 0.55), heart.water));
    /* a few bank rocks */
    for (let i = 0; i < 5; i++) {
      const rr = 16.5 + rng() * 12;
      const side = rng() > 0.5 ? 1 : -1;
      const a = STREAM_A + (side * (0.85 + rng() * 0.5)) / rr;
      const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(0.2 + rng() * 0.35, 0), stdMat(C.deep));
      placeOnGround(rock, a, rr);
      rock.position.y += 0.12;
    }

    /* footbridge where the walking path crosses the stream */
    const bridge = new THREE.Group();
    const arch = [0, 0.09, 0.13, 0.09, 0];
    for (let i = 0; i < 5; i++) {
      const plank = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.1, 1.9), stdMat(0x1b3560));
      plank.position.set(-1 + i * 0.5, 0.32 + arch[i], 0);
      plank.rotation.z = (i - 2) * -0.07;
      bridge.add(plank);
    }
    for (const sz of [-0.85, 0.85]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.09, 0.12), stdMat(0x142c55));
      rail.position.set(0, 0.62, sz);
      bridge.add(rail);
    }
    bridge.position.set(Math.sin(STREAM_A) * PATH_R, bumpAt(Math.sin(STREAM_A) * PATH_R, Math.cos(STREAM_A) * PATH_R), Math.cos(STREAM_A) * PATH_R);
    bridge.rotation.y = STREAM_A;
    world.add(bridge);

    /* the fall itself: scrolling streak texture, fading out below */
    const streakCanvas = document.createElement('canvas');
    streakCanvas.width = 128; streakCanvas.height = 256;
    const sg = streakCanvas.getContext('2d');
    for (let i = 0; i < 46; i++) {
      sg.fillStyle = `rgba(255,255,255,${0.16 + rng() * 0.5})`;
      sg.fillRect(Math.floor(rng() * 126), Math.floor(rng() * 256), 1.5 + rng() * 4, 24 + rng() * 90);
    }
    const streakTex = new THREE.CanvasTexture(streakCanvas);
    streakTex.wrapS = streakTex.wrapT = THREE.RepeatWrapping;
    streakTex.colorSpace = THREE.SRGBColorSpace;
    heart.fallTex = streakTex;

    const fadeCanvas = document.createElement('canvas');
    fadeCanvas.width = 8; fadeCanvas.height = 128;
    const fg = fadeCanvas.getContext('2d');
    const fGrad = fg.createLinearGradient(0, 0, 0, 128);
    fGrad.addColorStop(0, '#ffffff');
    fGrad.addColorStop(0.55, '#e8e8e8');
    fGrad.addColorStop(1, '#000000');
    fg.fillStyle = fGrad;
    fg.fillRect(0, 0, 8, 128);
    const fadeTex = new THREE.CanvasTexture(fadeCanvas);

    const fallMat = new THREE.MeshBasicMaterial({
      color: 0x9adfe8, map: streakTex, alphaMap: fadeTex,
      transparent: true, opacity: 0.72, depthWrite: false, side: THREE.DoubleSide,
    });
    heart.fallMat = fallMat;
    const fPts = [
      [29.7, 0.18], [31.4, -1.1], [33.6, -4.2], [34.7, -8], [35.1, -13], [35.1, -19.5],
    ].map(([rr, y]) => new THREE.Vector3(Math.sin(STREAM_A) * rr, y, Math.cos(STREAM_A) * rr));
    const fHalfW = [0.55, 0.62, 0.72, 0.85, 1.0, 1.2];
    world.add(new THREE.Mesh(ribbonGeo(fPts, fHalfW), fallMat));

    /* mist where the water vanishes */
    const mist = new THREE.Group();
    const mistTex = makeGlowTexture('rgba(160,225,235,1)');
    for (let i = 0; i < 3; i++) {
      const puff = new THREE.Sprite(new THREE.SpriteMaterial({
        map: mistTex, transparent: true, opacity: 0.16 + i * 0.05,
        depthWrite: false, blending: THREE.AdditiveBlending,
      }));
      puff.scale.setScalar(3 + i * 1.6);
      puff.position.set((rng() - 0.5) * 1.6, -i * 1.1, (rng() - 0.5) * 1.6);
      mist.add(puff);
    }
    mist.position.set(Math.sin(STREAM_A) * 35.1, -16.5, Math.cos(STREAM_A) * 35.1);
    world.add(mist);
    heart.mist = mist;
  }

  /* cairns at the glade's edge */
  for (const [ca, cr] of [[1.35, 6.6], [4.1, 6.9], [5.6, 13.5]]) {
    const cairn = new THREE.Group();
    let cy = 0;
    for (let i = 0; i < 3; i++) {
      const s = 0.5 - i * 0.13;
      const stone = new THREE.Mesh(new THREE.DodecahedronGeometry(s, 0), stdMat(C.deep));
      stone.scale.y = 0.6;
      stone.position.y = cy + s * 0.4;
      stone.rotation.y = rng() * Math.PI;
      cairn.add(stone);
      cy += s * 0.72;
    }
    placeOnGround(cairn, ca, cr);
  }

  /* fireflies drifting between the trees */
  {
    const COUNT = 54;
    const base = new Float32Array(COUNT * 3);
    const phases = new Float32Array(COUNT);
    const pos = new Float32Array(COUNT * 3);
    const col = new Float32Array(COUNT * 3);
    const cGoldF = new THREE.Color(0xffc878), cAquaF = new THREE.Color(0x53e0d8);
    for (let i = 0; i < COUNT; i++) {
      const a = rng() * Math.PI * 2, rr = 6 + rng() * 15;
      base[i * 3] = Math.sin(a) * rr;
      base[i * 3 + 1] = bumpAt(Math.sin(a) * rr, Math.cos(a) * rr) + 0.7 + rng() * 1.6;
      base[i * 3 + 2] = Math.cos(a) * rr;
      pos.set([base[i * 3], base[i * 3 + 1], base[i * 3 + 2]], i * 3);
      phases[i] = rng() * Math.PI * 2;
      const c2 = rng() > 0.45 ? cAquaF : cGoldF;
      col[i * 3] = c2.r; col[i * 3 + 1] = c2.g; col[i * 3 + 2] = c2.b;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const flies = new THREE.Points(geo, new THREE.PointsMaterial({
      map: starTex, vertexColors: true, size: 5.5, sizeAttenuation: false,
      transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    flies.frustumCulled = false;
    world.add(flies);
    heart.flies = { geo, base, phases, count: COUNT, mat: flies.material };
  }

  /* ── Station builders ── */
  const windowMats = [];   // dim these in light theme
  const stationLights = [];

  function lampPost(x, z) {
    const g = new THREE.Group();
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 2.1, 6), stdMat(0x142c55));
    post.position.y = 1.05;
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.19, 8, 6), glowMat(C.lamp, 1.6));
    bulb.position.y = 2.2;
    const light = new THREE.PointLight(C.lamp, 5, 9, 1.4);
    light.position.y = 2.2;
    stationLights.push(light);
    g.add(post, bulb, light);
    g.position.set(x, 0, z);
    return g;
  }

  const build = {
    dock(g) {
      const wood = stdMat(0x1b3560);
      for (let i = 0; i < 5; i++) {
        const plank = new THREE.Mesh(new THREE.BoxGeometry(2.8, 0.18, 1.45), wood);
        plank.position.set(0, 0.55, 1.2 + i * 1.55);
        g.add(plank);
        if (i % 2 === 0) {
          for (const sx of [-1.25, 1.25]) {
            const post = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 1.6, 6), wood);
            post.position.set(sx, -0.1, 1.2 + i * 1.55);
            g.add(post);
          }
        }
      }
      /* sign */
      const sign = new THREE.Group();
      const sPost = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 2.3, 6), stdMat(0x142c55));
      sPost.position.y = 1.15;
      const board = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.85, 0.12), stdMat(C.surf));
      board.position.y = 2.15;
      const trim = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.06, 0.14), glowMat(C.gold, 0.9));
      trim.position.y = 2.62;
      sign.add(sPost, board, trim);
      sign.position.set(-2.3, 0, 0.4);
      sign.rotation.y = 0.4;
      g.add(sign);
      /* little boat, bobbing off the edge */
      const boat = new THREE.Group();
      const hull = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.5, 0.8), stdMat(0x8a4a12));
      const rim2 = new THREE.Mesh(new THREE.BoxGeometry(1.85, 0.14, 0.95), stdMat(0xa8601a));
      rim2.position.y = 0.28;
      const lant = new THREE.Mesh(new THREE.SphereGeometry(0.11, 6, 5), glowMat(C.lamp, 1.4));
      lant.position.set(0.7, 0.6, 0);
      boat.add(hull, rim2, lant);
      boat.position.set(2.6, -0.7, 7.6);
      boat.rotation.y = -0.5;
      boat.userData.boat = true;
      g.add(boat);
      g.add(lampPost(1.9, 0.6));
    },

    clients(g) {
      const floor = new THREE.Mesh(new THREE.CylinderGeometry(3.6, 3.9, 0.4, 8), stdMat(C.surf));
      floor.position.y = 0.2;
      g.add(floor);
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
        const col = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.26, 3.9, 7), stdMat(0x16305e));
        col.position.set(Math.sin(a) * 2.9, 2.3, Math.cos(a) * 2.9);
        const cap = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.16, 0.55), glowMat(C.gold, 0.7));
        cap.position.set(Math.sin(a) * 2.9, 4.32, Math.cos(a) * 2.9);
        g.add(col, cap);
      }
      const roof = new THREE.Mesh(new THREE.ConeGeometry(4.1, 1.9, 8), stdMat(C.navy));
      roof.position.y = 5.4;
      const roofTrim = new THREE.Mesh(new THREE.TorusGeometry(3.6, 0.07, 6, 24), glowMat(C.gold, 0.8));
      roofTrim.rotation.x = Math.PI / 2;
      roofTrim.position.y = 4.5;
      g.add(roof, roofTrim);
      /* glowing doorway facing the path */
      const portal = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 2.9),
        new THREE.MeshBasicMaterial({ color: C.aqua, transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
      portal.position.set(0, 1.85, -2.55);
      portal.userData.pulse = true;
      g.add(portal);
      g.add(lampPost(-3.4, -1.4));
    },

    diff(g) {
      const heights = [4.1, 5.2, 4.5];
      for (let i = 0; i < 3; i++) {
        const h = heights[i];
        const stone = new THREE.Mesh(new THREE.BoxGeometry(1.5, h, 0.95), stdMat(i === 1 ? 0x14315f : C.surf));
        stone.position.set((i - 1) * 2.6, h / 2, (i === 1 ? -0.6 : 0.3));
        stone.rotation.y = (rng() - 0.5) * 0.3;
        stone.rotation.z = (rng() - 0.5) * 0.06;
        g.add(stone);
        const num = makeTextSprite(['01', '02', '03'][i]);
        num.position.set((i - 1) * 2.6, h + 1.0, (i === 1 ? -0.6 : 0.3));
        num.userData.bob = rng() * Math.PI * 2;
        g.add(num);
      }
      /* the site's orbital motif around the middle stone */
      const orbit = new THREE.Group();
      const ring = new THREE.Mesh(new THREE.TorusGeometry(2.5, 0.035, 6, 48),
        new THREE.MeshBasicMaterial({ color: C.aqua, transparent: true, opacity: 0.5 }));
      const dot = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), glowMat(C.aqua, 1.6));
      dot.position.x = 2.5;
      orbit.add(ring, dot);
      orbit.rotation.x = Math.PI / 2 - 0.45;
      orbit.position.set(0, 3.4, -0.6);
      orbit.userData.spin = true;
      g.add(orbit);
      g.add(lampPost(3.4, 0.8));
    },

    work(g) {
      const hall = new THREE.Mesh(new THREE.BoxGeometry(7.2, 3.1, 4.4), stdMat(C.surf));
      hall.position.set(0, 1.55, 0.6);
      const roof = new THREE.Mesh(new THREE.BoxGeometry(7.8, 0.35, 5), stdMat(C.navy));
      roof.position.set(0, 3.28, 0.6);
      g.add(hall, roof);
      /* portico */
      for (const sx of [-1.6, -0.55, 0.55, 1.6]) {
        const col = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.19, 2.6, 7), stdMat(0x1a3a6a));
        col.position.set(sx, 1.3, -2.1);
        g.add(col);
      }
      const ped = new THREE.Mesh(new THREE.CylinderGeometry(2.55, 2.55, 0.5, 3), stdMat(C.navy));
      ped.rotation.z = Math.PI / 2;
      ped.rotation.y = Math.PI / 2;
      ped.scale.set(1, 1, 0.42);
      ped.position.set(0, 3.15, -2.1);
      g.add(ped);
      const door = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 2.2),
        new THREE.MeshBasicMaterial({ color: 0xffca7a, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false }));
      door.position.set(0, 1.15, -1.61);
      g.add(door);
      /* banners */
      for (const sx of [-2.9, 2.9]) {
        const banner = new THREE.Mesh(new THREE.PlaneGeometry(0.75, 2), glowMat(sx < 0 ? C.tan : C.gold, 0.55));
        banner.position.set(sx, 1.9, -1.85);
        g.add(banner);
      }
      const win = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.8), glowMat(C.lamp, 1.1));
      win.position.set(2.2, 2, -1.61);
      windowMats.push(win.material);
      g.add(win);
      g.add(lampPost(-4.2, -0.9));
    },

    svcs(g) {
      /* 01 — the crane / half-built wall */
      const crane = new THREE.Group();
      const base = new THREE.Mesh(new THREE.BoxGeometry(1, 0.5, 1), stdMat(C.navy));
      base.position.y = 0.25;
      const mast = new THREE.Mesh(new THREE.BoxGeometry(0.22, 4.6, 0.22), stdMat(0xb06018));
      mast.position.y = 2.55;
      const jib = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.18, 0.18), stdMat(0xb06018));
      jib.position.set(1.05, 4.7, 0);
      const wire = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.6, 4), stdMat(0x999999));
      wire.position.set(2.15, 3.85, 0);
      const block = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, 0.4), glowMat(C.gold, 0.5));
      block.position.set(2.15, 2.9, 0);
      crane.add(base, mast, jib, wire, block);
      for (let i = 0; i < 3; i++) {
        const row = new THREE.Mesh(new THREE.BoxGeometry(1.9 - i * 0.5, 0.4, 0.5), stdMat(0x16305e));
        row.position.set(1.9, 0.2 + i * 0.42, 0.9);
        crane.add(row);
      }
      crane.position.set(-3.1, 0, 0.4);
      crane.rotation.y = 0.5;
      g.add(crane);

      /* 02 — the observatory */
      const obs = new THREE.Group();
      const drum = new THREE.Mesh(new THREE.CylinderGeometry(1.15, 1.3, 1.7, 10), stdMat(C.surf));
      drum.position.y = 0.85;
      const dome = new THREE.Mesh(new THREE.SphereGeometry(1.15, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), stdMat(C.blue));
      dome.position.y = 1.7;
      const scope = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.18, 1.5, 7), stdMat(0x1a3a6a));
      scope.position.set(0.35, 2.6, -0.35);
      scope.rotation.set(0.7, 0, -0.35);
      obs.add(drum, dome, scope);
      obs.position.set(0.2, 0, -0.7);
      g.add(obs);

      /* 03 — the forge (the delivery model is literally called Forge) */
      const forge = new THREE.Group();
      const shed = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.5, 1.7), stdMat(C.surf));
      shed.position.y = 0.75;
      const chimney = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.26, 1.6, 7), stdMat(C.navy));
      chimney.position.set(0.7, 2.1, 0.3);
      const mouth = new THREE.Mesh(new THREE.PlaneGeometry(0.85, 0.75),
        new THREE.MeshBasicMaterial({ color: 0xff8a30, transparent: true, opacity: 0.75, blending: THREE.AdditiveBlending, depthWrite: false }));
      mouth.position.set(0, 0.55, -0.86);
      const ember = new THREE.PointLight(0xff7a20, 6, 7, 1.6);
      ember.position.set(0, 0.8, -1.2);
      stationLights.push(ember);
      const anvil = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.35, 0.25), stdMat(0x222c44));
      anvil.position.set(-1, 0.45, -1.4);
      forge.add(shed, chimney, mouth, ember, anvil);
      forge.position.set(3.1, 0, 0.5);
      forge.rotation.y = -0.4;
      g.add(forge);

      const nums = [[-3.1, 5.6, 0.4], [0.2, 3.6, -0.7], [3.1, 3, 0.5]];
      nums.forEach((p, i) => {
        const s = makeTextSprite(['01', '02', '03'][i]);
        s.position.set(p[0], p[1], p[2]);
        s.userData.bob = i * 2;
        g.add(s);
      });
      g.add(lampPost(-1.4, -2));
    },

    insights(g) {
      const house = new THREE.Mesh(new THREE.BoxGeometry(3.6, 2.5, 3), stdMat(C.surf));
      house.position.y = 1.25;
      g.add(house);
      const roof = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.4, 3.4, 3), stdMat(C.navy));
      roof.rotation.z = Math.PI / 2;
      roof.rotation.y = Math.PI / 2;
      roof.scale.set(1, 1, 0.55);
      roof.position.y = 3.15;
      g.add(roof);
      for (const [wx, wz] of [[-0.95, -1.51], [0.95, -1.51]]) {
        const win = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.9), glowMat(C.lamp, 1.2));
        win.position.set(wx, 1.35, wz);
        windowMats.push(win.material);
        g.add(win);
      }
      /* book stacks */
      const bookCols = [C.tan, C.gold, C.blue, C.aqua, 0x8891c9];
      for (const [bx, bz, n] of [[-2.6, -0.4, 4], [2.5, -1, 3]]) {
        for (let i = 0; i < n; i++) {
          const book = new THREE.Mesh(new THREE.BoxGeometry(0.85 - rng() * 0.15, 0.16, 0.6), stdMat(bookCols[Math.floor(rng() * bookCols.length)]));
          book.position.set(bx + (rng() - 0.5) * 0.18, 0.1 + i * 0.17, bz + (rng() - 0.5) * 0.12);
          book.rotation.y = (rng() - 0.5) * 0.5;
          g.add(book);
        }
      }
      /* bench */
      const seat = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.12, 0.5), stdMat(0x1b3560));
      seat.position.set(0.2, 0.5, -2.4);
      for (const sx of [-0.5, 0.9]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.5, 0.45), stdMat(0x1b3560));
        leg.position.set(sx + 0.2, 0.25, -2.4);
        g.add(leg);
      }
      g.add(seat);
      g.add(lampPost(1.9, -2.2));
    },

    cta(g) {
      /* rocky mound */
      const mound = new THREE.Mesh(new THREE.DodecahedronGeometry(2.1, 0), stdMat(C.cliff));
      mound.scale.y = 0.45;
      mound.position.y = 0.2;
      g.add(mound);
      /* tower */
      const tower = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 1.45, 7.6, 12), stdMat(C.white));
      tower.position.y = 4.3;
      g.add(tower);
      for (const by of [2.6, 4.8]) {
        const band = new THREE.Mesh(new THREE.CylinderGeometry(1.45 - (by / 7.6) * 0.5 + 0.03, 1.45 - (by / 7.6) * 0.5 + 0.06, 0.55, 12), stdMat(C.navy));
        band.position.y = by;
        g.add(band);
      }
      /* gallery + lamp room */
      const deck = new THREE.Mesh(new THREE.CylinderGeometry(1.35, 1.35, 0.25, 12), stdMat(C.navy));
      deck.position.y = 8.2;
      const rail = new THREE.Mesh(new THREE.TorusGeometry(1.28, 0.045, 6, 20), stdMat(C.gold));
      rail.rotation.x = Math.PI / 2;
      rail.position.y = 8.65;
      const lampRoom = new THREE.Mesh(new THREE.CylinderGeometry(0.72, 0.72, 1.15, 10), glowMat(0xffd98a, 2.2));
      lampRoom.position.y = 8.95;
      const cap = new THREE.Mesh(new THREE.ConeGeometry(0.95, 0.95, 10), stdMat(C.navy));
      cap.position.y = 10;
      g.add(deck, rail, lampRoom, cap);
      const lampLight = new THREE.PointLight(0xffd98a, 14, 30, 1.3);
      lampLight.position.y = 9;
      stationLights.push(lampLight);
      g.add(lampLight);
      /* the sweeping beam — two opposite cones parented to a head */
      const head = new THREE.Group();
      head.position.y = 8.95;
      const beamGeo = new THREE.ConeGeometry(3.1, 24, 20, 1, true);
      beamGeo.translate(0, -12, 0);
      const beamMat = new THREE.MeshBasicMaterial({
        color: 0xffe9b0, transparent: true, opacity: 0.16,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
      });
      for (const dir of [1, -1]) {
        const beam = new THREE.Mesh(beamGeo, beamMat);
        beam.rotation.z = dir * Math.PI / 2;
        head.add(beam);
      }
      head.userData.beam = true;
      g.add(head);
      g.userData.beamHead = head;
      g.userData.beamMat = beamMat;
      g.add(lampPost(2.8, -0.9));
    },
  };

  for (const st of stations) {
    const g = new THREE.Group();
    g.position.set(Math.sin(st.rad) * PATH_R, 0.1, Math.cos(st.rad) * PATH_R);
    g.rotation.y = st.rad;             // local -z faces the island centre / the path
    g.userData.stationId = st.id;
    build[st.id](g);
    /* selection ring on the ground */
    const sel = new THREE.Mesh(
      new THREE.TorusGeometry(3.1, 0.09, 6, 48),
      new THREE.MeshBasicMaterial({ color: C.gold, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    sel.rotation.x = Math.PI / 2;
    sel.position.y = 0.34;
    g.add(sel);
    st.selRing = sel;
    st.group = g;
    world.add(g);
  }
  const stationHitList = stations.map(s => s.group);

  /* ── Avatar: a wisp of the site's own particles ── */
  const avatar = new THREE.Group();
  scene.add(avatar);
  const AV_Y = 1.55;
  avatar.position.set(0, AV_Y, PATH_R);

  const core = new THREE.Mesh(new THREE.SphereGeometry(0.3, 12, 10), glowMat(C.gold, 2.4));
  avatar.add(core);
  const glowTexGold = makeGlowTexture('rgba(255,200,120,1)');
  const glowSprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTexGold, transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  glowSprite.scale.setScalar(3);
  avatar.add(glowSprite);
  const avLight = new THREE.PointLight(0xffc878, 9, 16, 1.5);
  avatar.add(avLight);

  /* orbiting halo particles */
  const haloGroups = [];
  for (const [n, col, r0] of [[26, 0xffc878, 0.7], [18, 0x39d1cc, 1.05]]) {
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const a = rng() * Math.PI * 2, b = rng() * Math.PI;
      const r = r0 + rng() * 0.35;
      pos[i * 3] = Math.sin(b) * Math.sin(a) * r;
      pos[i * 3 + 1] = Math.cos(b) * r * 0.8;
      pos[i * 3 + 2] = Math.sin(b) * Math.cos(a) * r;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const pts = new THREE.Points(geo, new THREE.PointsMaterial({
      map: starTex, color: col, size: 7, sizeAttenuation: false,
      transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    avatar.add(pts);
    haloGroups.push(pts);
  }

  /* trail — points left behind in world space while walking */
  const TRAIL_N = 42;
  const trailPos = new Float32Array(TRAIL_N * 3);
  const trailCol = new Float32Array(TRAIL_N * 3);
  const trailGeo = new THREE.BufferGeometry();
  trailGeo.setAttribute('position', new THREE.BufferAttribute(trailPos, 3));
  trailGeo.setAttribute('color', new THREE.BufferAttribute(trailCol, 3));
  const trail = new THREE.Points(trailGeo, new THREE.PointsMaterial({
    map: starTex, size: 6, sizeAttenuation: false, vertexColors: true,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  trail.frustumCulled = false;
  world.add(trail);
  let trailIdx = 0;
  const trailAges = new Float32Array(TRAIL_N).fill(1e9);

  /* ============================================================
     State
     ============================================================ */
  let active = false;
  let firstEnter = true;
  let mode = 'island';            // 'island' | 'gallery'
  let angle = 0;                  // avatar's position on the ring (radians)
  let vel = 0;
  let inputDir = 0;               // -1 walk left, +1 walk right
  let autoTarget = null;          // radians, walk-to destination
  let selected = null;            // selected station
  let panelOpen = false;
  let hintShown = false;
  let walked = false;
  let galleryEnv = null;          // lazy sub-environment
  let galleryLoading = false;
  let rafId = 0;
  let lastT = 0;
  const clock = new THREE.Clock();

  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();

  /* ── Theme ── */
  const isLight = () => document.documentElement.getAttribute('data-theme') === 'light';
  function applyTheme() {
    const light = isLight();
    const sky = new THREE.Color(light ? 0xe9e2d4 : C.dark);
    scene.background = sky;
    scene.fog = new THREE.Fog(sky, mode === 'gallery' ? 30 : 55, mode === 'gallery' ? 80 : 165);
    hemi.color.set(light ? 0xfff3e0 : 0x1d3a6e);
    hemi.groundColor.set(light ? 0xcbd6e4 : 0x07133a);
    hemi.intensity = light ? 1.05 : 0.78;
    sun.color.set(light ? 0xffffff : 0xffd9a0);
    sun.intensity = light ? 1.6 : 1.0;
    stars1.visible = stars2.visible = !light;
    for (const m of windowMats) m.emissiveIntensity = light ? 0.15 : 1.2;
    for (const l of stationLights) l.intensity = light ? 1.2 : l.userData.baseI ?? (l.userData.baseI = l.intensity);
    const cta = stationById('cta').group;
    if (cta.userData.beamMat) cta.userData.beamMat.opacity = light ? 0.05 : 0.16;
    heart.orbLight.intensity = light ? 4 : 12;
    for (const m of heart.leyMats) m.opacity = light ? 0.09 : 0.16;
    heart.flies.mat.opacity = light ? 0 : 0.85;      // fireflies are a night thing
    heart.water.emissiveIntensity = light ? 0.06 : 0.18;
    heart.fallMat.opacity = light ? 0.55 : 0.72;
    galleryEnv?.applyTheme?.(light);
  }
  for (const l of stationLights) l.userData.baseI = l.intensity;
  const themeObs = new MutationObserver(applyTheme);
  themeObs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  applyTheme();

  /* ── HUD helpers ── */
  function setChip(title, hintText) {
    if (!title) { chip.classList.remove('on'); return; }
    chipTitle.textContent = title;
    chipHint.textContent = hintText || '';
    chip.classList.add('on');
  }
  function announce(msg) { live.textContent = msg; }

  function nearestStation() {
    let best = null, bestD = Infinity;
    for (const st of stations) {
      const d = Math.abs(angTo(angle, st.rad));
      if (d < bestD) { bestD = d; best = st; }
    }
    return { st: best, d: bestD };
  }

  function select(st, walk = true) {
    if (selected && selected !== st) selected.selRing.material.opacity = 0;
    selected = st;
    if (walk) {
      if (reduced) {
        /* fast travel: brief fade instead of the walk */
        root.style.transition = 'opacity .15s';
        root.style.opacity = '0.25';
        setTimeout(() => {
          angle = st.rad;
          autoTarget = null;
          root.style.opacity = '';
          root.style.transition = '';
        }, 160);
        autoTarget = null;
      } else {
        autoTarget = st.rad;
      }
    }
  }

  function updateChip() {
    if (panelOpen) { chip.classList.remove('on'); return; }
    if (mode === 'gallery') {
      const c = galleryEnv?.chip();
      if (c) setChip(c.title, c.hint); else setChip(null);
      return;
    }
    const { st, d } = nearestStation();
    const enterWord = coarse ? 'tap again to enter' : 'click again or press E to enter';
    if (selected && Math.abs(angTo(angle, selected.rad)) < NEAR_EPS) {
      setChip(selected.title, selected.environment ? `${enterWord} the gallery` : enterWord);
    } else if (selected && autoTarget != null) {
      setChip(selected.title, 'walking there…');
    } else if (d < NEAR_EPS) {
      setChip(st.title, st.hint ? `${st.hint} — ${coarse ? 'tap' : 'E'} to enter` : `${coarse ? 'tap' : 'press E'} to enter`);
    } else {
      setChip(null);
    }
  }

  /* ── Panels ── */
  let panelPrevFocus = null;
  function openPanel({ kicker, title, html }) {
    panelKicker.textContent = kicker || '';
    panelTitle.textContent = title || '';
    panelBody.innerHTML = html;
    panelOpen = true;
    panelPrevFocus = document.activeElement;
    scrim.classList.add('on');
    panel.classList.add('on');
    panelBody.scrollTop = 0;
    panelClose.focus();
    panelBody.querySelectorAll('a, button').forEach(hoverGrow);
  }
  function closePanel() {
    if (!panelOpen) return;
    panelOpen = false;
    scrim.classList.remove('on');
    panel.classList.remove('on');
    (panelPrevFocus && root.contains(panelPrevFocus) ? panelPrevFocus : root).focus?.();
  }
  scrim.addEventListener('click', closePanel);
  panelClose.addEventListener('click', closePanel);
  panel.addEventListener('click', e => {
    const t = e.target.closest('[data-island-travel]');
    if (!t) return;
    const st = stationById(t.getAttribute('data-island-travel'));
    if (st) { closePanel(); select(st); }
  });

  function openStation(st) {
    if (st.environment === 'gallery') { enterGallery(); return; }
    openPanel({ kicker: st.kicker, title: st.title, html: st.panel });
    announce(`${st.title} panel open.`);
  }

  function openGalleryItem(item) {
    const img = item.image ? `<img src="${item.image}" alt="${item.imageAlt || ''}" class="ip-gal-img">` : '';
    const body = item.heading
      ? `<h3 class="ip-h">${item.heading}</h3>${img}<p class="ip-p">${item.body}</p>`
      : `<h3 class="ip-h">${item.name}</h3><p class="ip-p">One of the organisations Iternal works with.</p>`;
    openPanel({
      kicker: item.sector,
      title: item.name,
      html: body + `<div class="ip-actions"><button class="ip-btn-line" data-island-close>Back to the gallery</button></div>`,
    });
  }
  panel.addEventListener('click', e => {
    if (e.target.closest('[data-island-close]')) closePanel();
  });

  /* ── Gallery sub-environment (pluggable) ── */
  async function enterGallery() {
    if (galleryLoading) return;
    if (!galleryEnv) {
      galleryLoading = true;
      setChip('Clients Pavilion', 'opening the gallery…');
      try {
        const modG = await import('./gallery.js');
        galleryEnv = modG.createGallery({
          THREE, C, items: GALLERY_ITEMS, label: GALLERY_LABEL,
          makeGlowTexture, makeTextSprite, stdMat, glowMat, rng: mulberry32(77),
          reduced,
        });
        scene.add(galleryEnv.group);
      } catch (err) {
        console.error('[island] gallery failed to load:', err);
        setChip('Clients Pavilion', 'the gallery is closed just now');
        galleryLoading = false;
        return;
      }
      galleryLoading = false;
    }
    mode = 'gallery';
    world.visible = false;
    avatar.visible = true;
    galleryEnv.enter();
    applyTheme();
    announce('The clients gallery. Walk left and right along the pieces; Escape returns to the island.');
    updateChip();
  }
  function exitGallery() {
    mode = 'island';
    galleryEnv?.exit();
    world.visible = true;
    applyTheme();
    announce('Back on the island, at the clients pavilion.');
  }

  /* ── Input ── */
  function interact() {
    if (panelOpen) return;
    if (mode === 'gallery') { galleryEnv?.keyInteract(openGalleryItem); return; }
    const { st, d } = nearestStation();
    if (d < NEAR_EPS) { select(st, false); openStation(st); }
    else if (selected) select(selected); // resume walking to selection
  }

  function escAction() {
    if (panelOpen) { closePanel(); return; }
    if (mode === 'gallery') { exitGallery(); return; }
    exit();
  }

  const keys = new Set();
  function onKeyDown(e) {
    if (!active) return;
    if (e.key === 'Escape') { e.preventDefault(); escAction(); return; }
    if (panelOpen) {
      if (e.key === 'Tab') trapTab(e, panel);
      return;
    }
    switch (e.key) {
      case 'ArrowLeft': case 'a': case 'A': keys.add('L'); e.preventDefault(); break;
      case 'ArrowRight': case 'd': case 'D': keys.add('R'); e.preventDefault(); break;
      case 'e': case 'E': case 'Enter':
        if (e.target === root || e.target === document.body || e.target === canvas) { interact(); e.preventDefault(); }
        break;
      case 'Tab': trapTab(e, root); break;
    }
    inputDir = (keys.has('R') ? 1 : 0) - (keys.has('L') ? 1 : 0);
    if (inputDir) { autoTarget = null; markWalked(); }
  }
  function onKeyUp(e) {
    switch (e.key) {
      case 'ArrowLeft': case 'a': case 'A': keys.delete('L'); break;
      case 'ArrowRight': case 'd': case 'D': keys.delete('R'); break;
    }
    inputDir = (keys.has('R') ? 1 : 0) - (keys.has('L') ? 1 : 0);
  }
  function trapTab(e, container) {
    const focusables = [...container.querySelectorAll('button, a[href], [tabindex="0"]')]
      .filter(n => n.offsetParent !== null || n instanceof SVGElement);
    if (!focusables.length) return;
    const first = focusables[0], last = focusables[focusables.length - 1];
    if (e.shiftKey && (document.activeElement === first || !container.contains(document.activeElement))) {
      last.focus(); e.preventDefault();
    } else if (!e.shiftKey && (document.activeElement === last || !container.contains(document.activeElement))) {
      first.focus(); e.preventDefault();
    }
  }

  function markWalked() {
    if (!walked) {
      walked = true;
      setTimeout(() => hint.classList.remove('on'), 2600);
    }
  }

  /* pointer: tap = pick, hold = walk (left/right half of the screen) */
  let pdown = null;
  let holdTimer = 0;
  canvas.addEventListener('pointerdown', e => {
    if (panelOpen) return;
    try { canvas.setPointerCapture(e.pointerId); } catch {}
    pdown = { x: e.clientX, y: e.clientY, t: performance.now(), held: false };
    holdTimer = setTimeout(() => {
      if (!pdown) return;
      pdown.held = true;
      inputDir = pdown.x < innerWidth / 2 ? -1 : 1;
      autoTarget = null;
      markWalked();
    }, 200);
  });
  canvas.addEventListener('pointermove', e => {
    if (!pdown) return;
    if (Math.hypot(e.clientX - pdown.x, e.clientY - pdown.y) > 14) pdown.moved = true;
    if (pdown.held) inputDir = e.clientX < innerWidth / 2 ? -1 : 1;
  });
  function pointerEnd(e) {
    clearTimeout(holdTimer);
    if (!pdown) return;
    const wasTap = !pdown.held && !pdown.moved && performance.now() - pdown.t < 420;
    if (pdown.held) inputDir = 0;
    pdown = null;
    if (wasTap) pick(e.clientX, e.clientY);
  }
  canvas.addEventListener('pointerup', pointerEnd);
  canvas.addEventListener('pointercancel', () => { clearTimeout(holdTimer); if (pdown?.held) inputDir = 0; pdown = null; });

  function pick(x, y) {
    ndc.set((x / innerWidth) * 2 - 1, -(y / innerHeight) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    if (mode === 'gallery') {
      galleryEnv?.pick(raycaster, openGalleryItem);
      return;
    }
    const hits = raycaster.intersectObjects(stationHitList, true);
    if (!hits.length) return;
    let obj = hits[0].object;
    while (obj && !obj.userData.stationId) obj = obj.parent;
    if (!obj) return;
    const st = stationById(obj.userData.stationId);
    if (!st) return;
    if (selected === st && Math.abs(angTo(angle, st.rad)) < NEAR_EPS) openStation(st);
    else select(st);
  }

  exitBtn.addEventListener('click', () => exit());
  mapDots.forEach(({ g, st }) => {
    g.addEventListener('click', () => { select(st); markWalked(); });
    g.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(st); } });
    hoverGrow(g);
  });

  const onVis = () => { if (document.hidden) stopLoop(); else if (active) startLoop(); };
  document.addEventListener('visibilitychange', onVis);

  function onResize() {
    const w = innerWidth, h = innerHeight;
    if (!w || !h) return;   // minimised windows report 0×0 — a NaN aspect poisons the projection matrix
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.fov = camera.aspect < 0.9 ? 56 : 44;
    camera.updateProjectionMatrix();
  }
  addEventListener('resize', onResize);
  onResize();

  /* subtle camera parallax with the mouse */
  let par = { x: 0, y: 0, tx: 0, ty: 0 };
  if (!reduced && !coarse) {
    addEventListener('mousemove', e => {
      par.tx = (e.clientX / innerWidth - 0.5) * 1.4;
      par.ty = (e.clientY / innerHeight - 0.5) * 0.8;
    });
  }

  canvas.addEventListener('webglcontextlost', e => {
    e.preventDefault();
    console.warn('[island] WebGL context lost — leaving the island.');
    exit();
  });

  /* ============================================================
     Frame loop
     ============================================================ */
  function frame() {
    rafId = requestAnimationFrame(frame);
    tick(Math.min(clock.getDelta(), 0.05));
  }

  function tick(dt) {
    const t = (lastT += dt);

    /* movement */
    let dir = inputDir;
    if (autoTarget != null && !dir) {
      const d = angTo(angle, autoTarget);
      if (Math.abs(d) < 0.012) { angle = autoTarget; autoTarget = null; updateChipSoon(); }
      else dir = Math.sign(d) * clamp(Math.abs(d) * 3.2, 0.25, 1);
    }
    if (mode === 'island') {
      vel = lerp(vel, dir * WALK_SPEED, reduced ? 1 : Math.min(1, dt * 7));
      if (Math.abs(vel) > 0.0004) {
        angle = (angle + vel * dt) % (Math.PI * 2);
        if (angle < 0) angle += Math.PI * 2;
      }
      world.rotation.y = -angle;

      /* trail */
      if (Math.abs(vel) > 0.05 && !reduced) {
        trailPos[trailIdx * 3] = Math.sin(angle) * PATH_R + (rng() - 0.5) * 0.3;
        trailPos[trailIdx * 3 + 1] = AV_Y + Math.sin(t * 2.1) * 0.1 + (rng() - 0.5) * 0.3;
        trailPos[trailIdx * 3 + 2] = Math.cos(angle) * PATH_R + (rng() - 0.5) * 0.3;
        trailAges[trailIdx] = 0;
        trailIdx = (trailIdx + 1) % TRAIL_N;
        trailGeo.attributes.position.needsUpdate = true;
      }
      for (let i = 0; i < TRAIL_N; i++) {
        trailAges[i] += dt;
        const a = clamp(1 - trailAges[i] / 1.4, 0, 1);
        trailCol[i * 3] = a * 1;
        trailCol[i * 3 + 1] = a * 0.72;
        trailCol[i * 3 + 2] = a * 0.4;
      }
      trailGeo.attributes.color.needsUpdate = true;
    } else if (galleryEnv) {
      vel = lerp(vel, dir * WALK_SPEED, Math.min(1, dt * 7));
      galleryEnv.update(dt, vel, t);
    }

    /* avatar life */
    if (!reduced) {
      const walkBoost = clamp(Math.abs(vel) / WALK_SPEED, 0, 1);
      avatar.position.y = AV_Y + Math.sin(t * (2 + walkBoost * 1.6)) * (0.1 + walkBoost * 0.08);
      avatar.rotation.z = lerp(avatar.rotation.z, -Math.sign(vel) * walkBoost * 0.16, 0.1);
      haloGroups[0].rotation.y += dt * (0.7 + walkBoost);
      haloGroups[1].rotation.y -= dt * (0.5 + walkBoost * 0.8);
      haloGroups[1].rotation.x = Math.sin(t * 0.7) * 0.3;
      glowSprite.material.opacity = 0.75 + Math.sin(t * 2.4) * 0.12;
      skyGroup.rotation.y += dt * 0.004;
    }

    /* world life */
    if (!reduced && mode === 'island') {
      for (const f of floaters) f.position.y = f.userData.baseY + Math.sin(t * 0.5 + f.userData.phase) * 0.7;
      for (const st of stations) {
        st.group.traverse(o => {
          if (o.userData.bob != null) o.position.y += Math.sin(t * 1.6 + o.userData.bob) * 0.0016;
          if (o.userData.spin) o.rotation.z += dt * 0.5;
          if (o.userData.boat) { o.position.y = -0.7 + Math.sin(t * 0.9) * 0.12; o.rotation.z = Math.sin(t * 0.8) * 0.05; }
          if (o.userData.pulse) o.material.opacity = 0.32 + Math.sin(t * 2.2) * 0.14;
        });
      }
      const beamHead = stationById('cta').group.userData.beamHead;
      if (beamHead) beamHead.rotation.y += dt * 0.55;

      /* the heart: orbit rings, floating orb, ley pulses, fireflies */
      for (const r of heart.rings) {
        r.ring.rotation.z += dt * r.sp;
        r.holder.rotation.x += dt * r.tum;
        r.holder.rotation.y += dt * r.tum * 0.7;
      }
      heart.orbGroup.position.y = heart.orbBaseY + Math.sin(t * 1.1) * 0.18;
      for (const p of heart.pulses) {
        p.u = (p.u + dt * p.speed) % 1;
        const idx = p.u * (p.pts.length - 1);
        const i0 = Math.floor(idx), f2 = idx - i0;
        const a2 = p.pts[i0], b2 = p.pts[Math.min(i0 + 1, p.pts.length - 1)];
        p.spr.position.set(a2.x + (b2.x - a2.x) * f2, a2.y + (b2.y - a2.y) * f2 + 0.08, a2.z + (b2.z - a2.z) * f2);
        p.spr.material.opacity = 0.25 + Math.sin(p.u * Math.PI) * 0.6;
      }
      heart.fallTex.offset.y -= dt * 0.55;
      heart.mist.rotation.y += dt * 0.35;
      const fp = heart.flies.geo.attributes.position;
      for (let i = 0; i < heart.flies.count; i++) {
        const ph = heart.flies.phases[i];
        fp.setXYZ(i,
          heart.flies.base[i * 3] + Math.sin(t * 0.23 + ph * 1.7) * 0.45,
          heart.flies.base[i * 3 + 1] + Math.sin(t * 0.7 + ph) * 0.35,
          heart.flies.base[i * 3 + 2] + Math.cos(t * 0.19 + ph * 1.3) * 0.45);
      }
      fp.needsUpdate = true;
    }

    /* selection ring pulse */
    for (const st of stations) {
      const target = st === selected ? 0.55 + (reduced ? 0 : Math.sin(t * 3) * 0.2) : 0;
      st.selRing.material.opacity = lerp(st.selRing.material.opacity, target, 0.12);
    }

    /* camera: settle onto the current mode's rig, mouse parallax on top */
    const rig = RIGS[mode] || RIGS.island;
    const camK = reduced ? 1 : Math.min(1, dt * 3);
    camPos.lerp(rig.pos, camK);
    camTarget.lerp(rig.tgt, camK);
    if (!reduced && !coarse) {
      par.x = lerp(par.x, par.tx, 0.04);
      par.y = lerp(par.y, par.ty, 0.04);
    }
    camera.position.set(camPos.x + par.x, camPos.y - par.y, camPos.z);
    camera.lookAt(camTarget);

    /* ring map rotation */
    dotGroup.setAttribute('transform', `rotate(${-THREE.MathUtils.radToDeg(angle)})`);
    for (const { c, st } of mapDots) {
      c.setAttribute('fill', st === selected ? '#e0a614'
        : Math.abs(angTo(angle, st.rad)) < NEAR_EPS ? '#0bafaa' : 'rgba(150,170,215,.9)');
    }

    updateChip();
    renderer.render(scene, camera);
  }

  let chipTimer = 0;
  function updateChipSoon() { clearTimeout(chipTimer); chipTimer = setTimeout(updateChip, 60); }

  function startLoop() {
    if (rafId) return;
    clock.getDelta();
    rafId = requestAnimationFrame(frame);
  }
  function stopLoop() {
    cancelAnimationFrame(rafId);
    rafId = 0;
  }

  /* ============================================================
     enter / exit
     ============================================================ */
  function enter(pageKey) {
    if (active) return;
    active = true;
    document.body.style.overflow = 'hidden';
    root.style.display = 'block';
    requestAnimationFrame(() => root.classList.add('on'));
    if (firstEnter) {
      firstEnter = false;
      const spawn = stationById(PAGE_SPAWN[pageKey] || 'dock') || stations[0];
      angle = spawn.rad;
      world.rotation.y = -angle;
      if (!reduced) {
        world.scale.setScalar(0.94);
        const grow = () => {
          world.scale.multiplyScalar(1.004);
          if (world.scale.x < 1) requestAnimationFrame(grow);
          else world.scale.setScalar(1);
        };
        requestAnimationFrame(grow);
      }
      hint.classList.add('on');
      hintShown = true;
      setTimeout(() => { if (!walked) hint.classList.remove('on'); }, 12000);
    }
    startLoop();
    root.focus({ preventScroll: true });
    announce('The Iternal island. Seven places stand around a circular shore; walk with the arrow keys or by holding either side of the screen, press E to enter a place, Escape to leave.');
  }

  function exit() {
    if (!active) return;
    active = false;
    closePanel();
    if (mode === 'gallery') exitGallery();
    inputDir = 0; vel = 0; keys.clear();
    root.classList.remove('on');
    setTimeout(() => { root.style.display = 'none'; stopLoop(); }, 420);
    document.body.style.overflow = '';
    onExit?.();
  }

  document.addEventListener('keydown', onKeyDown);
  document.addEventListener('keyup', onKeyUp);

  /* warm-up render so the first shown frame is instant */
  onResize();
  renderer.render(scene, camera);

  /* dev-only introspection: add ?isldebug to the URL */
  if (location.search.includes('isldebug')) {
    window.__isl = {
      THREE, scene, camera, renderer, world, stations, avatar,
      get gallery() { return galleryEnv; },
      get state() { return { mode, angle, selected: selected?.id, panelOpen, active }; },
      /* drive the sim manually — rAF never fires while the page is hidden */
      step(ms = 16, frames = 1) {
        for (let i = 0; i < frames; i++) tick(Math.min(ms, 50) / 1000);
      },
    };
  }

  return { enter, exit };
}
