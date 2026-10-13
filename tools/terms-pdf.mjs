// Prints a terms page to the PDF beside it, which the sign-up page offers as
// the download and the worker attaches to the client's copy:
//   node tools/terms-pdf.mjs terms/website-build-and-care-v1.0.html
import puppeteer from 'puppeteer-core';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const src = resolve(process.argv[2] || '');
if (!src.endsWith('.html')) { console.error('usage: node tools/terms-pdf.mjs <terms page .html>'); process.exit(2); }
const out = src.replace(/\.html$/, '.pdf');

const browser = await puppeteer.launch({ executablePath: process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
try {
  const page = await browser.newPage();
  await page.goto(pathToFileURL(src).href, { waitUntil: 'networkidle0' });
  await page.evaluateHandle('document.fonts.ready');
  const title = await page.$eval('h1', h => h.textContent.trim());
  const version = await page.$eval('.version', p => p.textContent.split('·')[0].trim());
  await page.pdf({
    path: out, format: 'A4', printBackground: true,
    margin: { top: '20mm', bottom: '20mm', left: '18mm', right: '18mm' },
    displayHeaderFooter: true, headerTemplate: '<span></span>',
    footerTemplate: `<div style="width:100%;font:8px sans-serif;color:#555;padding:0 18mm;display:flex;justify-content:space-between"><span>Iternal Ltd · ${title}, ${version}</span><span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span></div>`,
  });
  console.log('wrote', out);
} finally {
  await browser.close();
}
