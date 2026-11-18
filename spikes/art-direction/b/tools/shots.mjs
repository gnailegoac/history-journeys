// 干活时一次拍几张（只开一个浏览器，一张一张拍）：
//   node tools/shots.mjs "名字|页面和参数|宽|高|倍率|滚到哪一节" ...
// 存到 shots-work/名字.png；同时把题签的位置打出来，方便查有没有压住东西。
import { chromium } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(here, '../shots-work');
fs.mkdirSync(outDir, { recursive: true });
const jobs = process.argv.slice(2).map((j) => {
  const [name, url, w = '1440', h = '900', dpr = '1', section = ''] = j.split('|');
  return { name, url, w: +w, h: +h, dpr: +dpr, section };
});
const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
for (const j of jobs) {
  const ctx = await browser.newContext({ viewport: { width: j.w, height: j.h }, deviceScaleFactor: j.dpr, isMobile: j.w < 500, hasTouch: j.w < 500 });
  const page = await ctx.newPage();
  page.on('console', (m) => {
    const t = m.text();
    if (m.type() === 'error' || m.type() === 'warning' || t.startsWith('TRI') || t.startsWith('[b]')) console.log('[page]', m.type(), t);
  });
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  const t0 = Date.now();
  await page.goto(`http://localhost:5422/b/${j.url}`);
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 240000 });
  if (j.section) await page.evaluate((s) => window.__scrollToSection && window.__scrollToSection(s), j.section);
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(outDir, j.name + '.png') });
  const dbg = await page.evaluate(() => (window.__overlay && window.__overlay.debug ? window.__overlay.debug() : null));
  console.log('saved', j.name, Date.now() - t0, 'ms');
  if (dbg) console.log('  labels', JSON.stringify(dbg));
  await ctx.close();
}
await browser.close();
