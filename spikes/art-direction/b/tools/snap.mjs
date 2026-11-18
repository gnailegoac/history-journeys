// 干活时拍一张看：node tools/snap.mjs <页面和参数> <存到 shots-work 的名字> [宽] [高] [倍率]
import { chromium } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const [page_, name, w = '1440', h = '900', dpr = '1', scrollTo = ''] = process.argv.slice(2);
const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: +w, height: +h }, deviceScaleFactor: +dpr });
const page = await ctx.newPage();
page.on('console', (m) => console.log('[page]', m.type(), m.text()));
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
const t0 = Date.now();
await page.goto(`http://localhost:5422/b/${page_}`);
await page.waitForFunction(() => window.__ready === true, null, { timeout: 180000 });
if (scrollTo) {
  await page.evaluate((s) => window.__scrollToSection && window.__scrollToSection(s), scrollTo);
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 180000 });
}
await page.waitForTimeout(400);
await page.screenshot({ path: path.join(here, '../shots-work', name + '.png') });
console.log('saved', name, Date.now() - t0, 'ms');
await browser.close();
