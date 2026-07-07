/* ============================================================
   ISLAND BOOT — the only island code normal page views load.
   Injects the nav button, shows the "world is being created"
   loader on click, then dynamically imports the island proper.
   Three.js and island.js cost visitors nothing until they ask.
   ============================================================ */

const PAGE = (() => {
  const file = location.pathname.split('/').pop() || 'index.html';
  return file.replace(/\.html?$/i, '') || 'index';
})();

const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

/* ── Styles for the button + loader ── */
const css = `
.isl-nav-btn {
  background: transparent;
  color: var(--aqua, #0bafaa);
  border: 1px solid color-mix(in srgb, var(--aqua, #0bafaa) 55%, transparent);
  font-family: var(--f, 'Maven Pro', sans-serif);
  font-size: 12px; font-weight: 700;
  letter-spacing: .06em; text-transform: uppercase;
  padding: 9px 18px; border-radius: 3px;
  cursor: none; white-space: nowrap;
  transition: transform .15s, box-shadow .25s, background .2s, color .2s;
}
.isl-nav-btn:hover {
  transform: translateY(-1px);
  background: color-mix(in srgb, var(--aqua, #0bafaa) 12%, transparent);
  box-shadow: 0 8px 28px rgba(11,175,170,.25);
}
.isl-nav-btn[aria-busy="true"] { opacity: .55; pointer-events: none; }
@media (max-width: 900px) { .isl-nav-btn { display: none; } }

.isl-loader {
  position: fixed; inset: 0; z-index: 9990;
  background: var(--dark, #060f26);
  display: flex; flex-direction: column;
  align-items: center; justify-content: center;
  gap: 18px; text-align: center;
  font-family: var(--f, 'Maven Pro', sans-serif);
  color: var(--white, #ffffff);
  opacity: 0; transition: opacity .45s ease;
  overflow: hidden; cursor: none; padding: 24px;
}
.isl-loader.on { opacity: 1; }
.isl-loader-logo { width: 120px; max-width: 40vw; animation: islPulse 2.4s ease-in-out infinite; }
html[data-theme="light"] .isl-loader-logo.logo-dark { display: none; }
html:not([data-theme="light"]) .isl-loader-logo.logo-light { display: none; }
.isl-loader-line { font-size: 17px; font-weight: 700; letter-spacing: .02em; }
.isl-loader-sub {
  font-size: 13px; font-weight: 500; letter-spacing: .08em; text-transform: uppercase;
  opacity: .55; min-height: 18px; transition: opacity .3s;
}
.isl-loader-bar {
  width: 220px; height: 2px; border-radius: 2px;
  background: color-mix(in srgb, var(--white, #fff) 14%, transparent);
  overflow: hidden;
}
.isl-loader-fill {
  height: 100%; width: 0%;
  background: var(--sunrise, linear-gradient(135deg, #e26713, #e0a614));
  transition: width .8s cubic-bezier(.2,.6,.2,1);
}
.isl-loader-err { font-size: 14px; opacity: .8; max-width: 420px; line-height: 1.5; }
.isl-loader-return {
  background: var(--sunrise, linear-gradient(135deg, #e26713, #e0a614));
  color: #fff; border: none; border-radius: 3px;
  font-family: inherit; font-size: 12px; font-weight: 700;
  letter-spacing: .06em; text-transform: uppercase;
  padding: 11px 24px; cursor: none;
}
.isl-dot {
  position: absolute; bottom: -12px; border-radius: 50%;
  pointer-events: none; opacity: 0;
  animation: islRise linear infinite;
}
@keyframes islPulse { 0%,100% { opacity: 1; } 50% { opacity: .55; } }
@keyframes islRise {
  0%   { transform: translateY(0);      opacity: 0; }
  12%  { opacity: .7; }
  88%  { opacity: .5; }
  100% { transform: translateY(-105vh); opacity: 0; }
}
@media (prefers-reduced-motion: reduce) {
  .isl-loader-logo { animation: none; }
  .isl-dot { display: none; }
}
`;

const styleEl = document.createElement('style');
styleEl.textContent = css;
document.head.appendChild(styleEl);

/* ── Nav button (desktop) + mobile nav entry ── */
const BTN_LABEL = 'Enter the Island';

const btn = document.createElement('button');
btn.type = 'button';
btn.className = 'isl-nav-btn';
btn.textContent = BTN_LABEL;
btn.setAttribute('aria-label', 'Enter the Island — an explorable 3D version of this site');

const navBtn = document.querySelector('#nav .nav-btn');
if (navBtn) navBtn.insertAdjacentElement('afterend', btn);
else document.getElementById('nav')?.appendChild(btn);

const mobileNav = document.getElementById('mobileNav');
let mobLink = null;
if (mobileNav) {
  mobLink = document.createElement('a');
  mobLink.href = '#';
  mobLink.textContent = BTN_LABEL;
  mobLink.style.color = 'var(--aqua, #0bafaa)';
  const mobCta = mobileNav.querySelector('.mob-cta');
  if (mobCta) mobileNav.insertBefore(mobLink, mobCta);
  else mobileNav.appendChild(mobLink);
}

/* The site's custom cursor grows over interactive elements; it wired
   its listeners before we existed, so mirror that for our button. */
const cur = document.getElementById('cur');
if (cur) {
  [btn, mobLink].filter(Boolean).forEach(el => {
    el.addEventListener('mouseenter', () => cur.classList.add('big'));
    el.addEventListener('mouseleave', () => cur.classList.remove('big'));
  });
}

/* ── Loader overlay ── */
const BUILD_LINES = [
  'Plotting the shoreline…',
  'Shaping the island…',
  'Raising the standing stones…',
  'Hanging the gallery…',
  'Building the workshops…',
  'Shelving the reading room…',
  'Lighting the beacon…',
];

function makeLoader() {
  const el = document.createElement('div');
  el.className = 'isl-loader';
  el.setAttribute('role', 'status');
  el.setAttribute('aria-live', 'polite');
  el.innerHTML = `
    <img src="assets/logo-white.png" alt="" class="isl-loader-logo logo-dark">
    <img src="assets/logo-navy.png" alt="" class="isl-loader-logo logo-light">
    <div class="isl-loader-line">Please wait while the world is created&hellip;</div>
    <div class="isl-loader-sub"></div>
    <div class="isl-loader-bar"><div class="isl-loader-fill"></div></div>
  `;
  const palette = ['#e26713', '#e0a614', '#0bafaa'];
  if (!reducedMotion.matches) {
    for (let i = 0; i < 16; i++) {
      const d = document.createElement('span');
      d.className = 'isl-dot';
      const s = 2 + Math.random() * 4;
      d.style.width = d.style.height = s + 'px';
      d.style.left = (Math.random() * 100) + 'vw';
      d.style.background = palette[i % palette.length];
      d.style.animationDuration = (7 + Math.random() * 9) + 's';
      d.style.animationDelay = (-Math.random() * 12) + 's';
      el.appendChild(d);
    }
  }
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add('on'));

  const sub = el.querySelector('.isl-loader-sub');
  const fill = el.querySelector('.isl-loader-fill');
  let lineIdx = 0;
  sub.textContent = BUILD_LINES[0];
  const cycle = setInterval(() => {
    lineIdx = (lineIdx + 1) % BUILD_LINES.length;
    sub.textContent = BUILD_LINES[lineIdx];
  }, 1100);

  const api = {
    el,
    progress(pct) { fill.style.width = pct + '%'; },
    fail(message) {
      clearInterval(cycle);
      el.querySelector('.isl-loader-line').textContent = "The island couldn't be built this time.";
      sub.remove();
      el.querySelector('.isl-loader-bar').remove();
      const err = document.createElement('p');
      err.className = 'isl-loader-err';
      err.textContent = message;
      const back = document.createElement('button');
      back.type = 'button';
      back.className = 'isl-loader-return';
      back.textContent = 'Return to the site';
      back.addEventListener('click', () => api.remove());
      el.append(err, back);
      back.focus();
      document.body.style.overflow = '';
    },
    remove() {
      clearInterval(cycle);
      el.classList.remove('on');
      setTimeout(() => el.remove(), 480);
    },
  };
  return api;
}

function webglAvailable() {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch { return false; }
}

const delay = ms => new Promise(r => setTimeout(r, ms));

/* ── Entry flow ── */
let island = null;       // built instance, kept for instant re-entry
let building = false;

async function enterIsland() {
  if (building) return;

  if (island) { island.enter(PAGE); return; }

  if (!webglAvailable()) {
    const loader = makeLoader();
    loader.fail('Your browser has 3D graphics switched off, so the island has nowhere to stand. Everything on it lives in the ordinary pages too.');
    return;
  }

  building = true;
  btn.setAttribute('aria-busy', 'true');
  document.body.style.overflow = 'hidden';
  const loader = makeLoader();
  loader.progress(18);

  try {
    const minShow = delay(reducedMotion.matches ? 300 : 1400);
    const mod = await import('./island.js');
    loader.progress(55);
    island = await mod.createIsland({
      page: PAGE,
      onExit: () => { btn.focus(); },
    });
    loader.progress(100);
    await minShow;
    island.enter(PAGE);
    loader.remove();
  } catch (err) {
    console.error('[island] build failed:', err);
    island = null;
    loader.fail('Something went wrong while raising it from the sea. The ordinary site is untouched — please carry on there.');
  } finally {
    building = false;
    btn.removeAttribute('aria-busy');
  }
}

btn.addEventListener('click', enterIsland);
mobLink?.addEventListener('click', e => {
  e.preventDefault();
  // Close the mobile menu so the loader isn't hidden behind it.
  mobileNav.classList.remove('open');
  document.querySelector('.nav-hamburger')?.classList.remove('open');
  document.querySelector('.nav-hamburger')?.setAttribute('aria-expanded', 'false');
  enterIsland();
});
