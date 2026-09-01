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

// One entry per screenshot. Add new live sites here.
const SHOTS = [
  { file: 'screenshot-goodnews.png', url: 'https://goodnews.london.gov.uk', width: 1440, height: 900 },
  { file: 'screenshot-goodnews-mobile.png', url: 'https://goodnews.london.gov.uk', width: 390, height: 844, mobile: true },
  { file: 'screenshot-tech4good.png', url: 'https://tech4goodsouthwest.org', width: 1440, height: 900 },
  { file: 'screenshot-genius.png', url: 'https://www.generatinggenius.org.uk', width: 1440, height: 900 },
  { file: 'screenshot-marvinrees.png', url: 'https://marvinrees.com', width: 1440, height: 900 },
];

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
        await page.screenshot({ path: out });
        await page.close();
        const kb = Math.round(fs.statSync(out).size / 1024);
        if (kb < 10) throw new Error('suspiciously small (' + kb + 'KB) — blank page?');
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
