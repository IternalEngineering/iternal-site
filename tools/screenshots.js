#!/usr/bin/env node
/**
 * Refresh the live-site screenshots in assets/.
 * Drives an installed Chrome via puppeteer-core (no bundled browser).
 * CHROME env var overrides the binary; defaults cover Windows and the
 * GitHub Actions ubuntu runner.
 *
 * Run from the repo root:  npm install && node tools/screenshots.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');

const CHROME = process.env.CHROME ||
  (process.platform === 'win32'
    ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
    : '/usr/bin/google-chrome');

// One entry per screenshot. Add new live sites here. WebP keeps each one under ~200KB.
const SHOTS = [
  { file: 'screenshot-goodnews.webp', url: 'https://goodnews.london.gov.uk', width: 1440, height: 900 },
  { file: 'screenshot-goodnews-mobile.webp', url: 'https://goodnews.london.gov.uk', width: 390, height: 844, mobile: true },
  { file: 'screenshot-tech4good.webp', url: 'https://tech4goodsouthwest.org', width: 1440, height: 900 },
  { file: 'screenshot-genius.webp', url: 'https://www.generatinggenius.org.uk', width: 1440, height: 900 },
  { file: 'screenshot-marvinrees.webp', url: 'https://marvinrees.com', width: 1440, height: 900 },
  { file: 'screenshot-pawlett.webp', url: 'https://pawlettpavilion.com', width: 1440, height: 900 },
  { file: 'screenshot-bplaced.webp', url: 'https://bplaced.co.uk', width: 1440, height: 900 },
  { file: 'screenshot-jays.webp', url: 'https://jaystransport.co.uk', width: 1440, height: 900 },
  { file: 'screenshot-cnz.webp', url: 'https://civicnetzero.com', width: 1440, height: 900 },
];

// Bot checks and sign-in walls a headless browser runs into. A capture showing one of
// these is skipped, so the page keeps last week's good screenshot (the 5 Oct 2026 run
// published CivicNetZero's Cloudflare check and a YouTube "not a bot" prompt over Jay's).
const BLOCKED = /performing security verification|verify you are human|checking your browser|just a moment\.\.\.|attention required|confirm you.re not a bot|sign in to confirm/i;

// Remove fixed/sticky cookie-consent overlays without accepting anything.
// ponytail: text heuristic, add a per-shot `hide` selector if a site outgrows it.
function stripCookieBanners() {
  const nodes = document.querySelectorAll('div, section, dialog, aside');
  for (const el of nodes) {
    const style = getComputedStyle(el);
    if (style.position !== 'fixed' && style.position !== 'sticky') continue;
    if (/\bcookie(s)?\b/i.test(el.innerText || '')) el.remove();
  }
}

// Text of the page and every frame in it (the YouTube prompt sits inside an embed).
async function blockedBy(page) {
  for (const frame of page.frames()) {
    const text = await frame.evaluate(() => (document.body && document.body.innerText) || '').catch(() => '');
    const m = text.match(BLOCKED);
    if (m) return m[0];
  }
  return '';
}

(async () => {
  let failures = 0;
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    args: ['--no-sandbox', '--hide-scrollbars'],
  });
  try {
    for (const s of SHOTS) {
      const out = path.join(__dirname, '..', 'assets', s.file);
      try {
        const page = await browser.newPage();
        await page.setViewport({ width: s.width, height: s.height, isMobile: !!s.mobile, hasTouch: !!s.mobile });
        if (s.mobile) await page.setUserAgent('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36');
        await page.goto(s.url, { waitUntil: 'networkidle2', timeout: 60000 });
        await new Promise(r => setTimeout(r, 2000)); // late banners/animations
        await page.evaluate(stripCookieBanners);
        const blocked = await blockedBy(page);
        if (blocked) {
          await page.close();
          console.warn('skip ' + s.file + '  ' + s.url + '  — showed "' + blocked + '"; keeping the last good screenshot');
          continue;
        }
        const img = await page.screenshot({ type: 'webp', quality: 82 });
        await page.close();
        const kb = Math.round(img.length / 1024);
        if (kb < 5) throw new Error('suspiciously small (' + kb + 'KB) — blank page?');
        fs.writeFileSync(out, img); // only written once it has passed both checks
        console.log('ok  ' + s.file + '  (' + kb + 'KB)  ' + s.url);
      } catch (e) {
        failures++;
        console.error('FAIL ' + s.file + '  ' + s.url + '  — ' + (e.message || e));
      }
    }
  } finally {
    await browser.close();
  }
  process.exit(failures ? 1 : 0);
})();
