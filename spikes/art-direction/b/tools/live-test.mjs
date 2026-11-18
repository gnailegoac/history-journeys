// 不固定镜头，照读者那样往下滚，看镜头跟不跟、有没有报错。
import { chromium } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })).newPage();
const errs = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errs.push(m.type() + ': ' + m.text().slice(0, 300)); });
page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
await page.goto('http://localhost:5422/b/index.html');
await page.waitForFunction(() => window.__ready === true, null, { timeout: 180000 });
for (const [sec, name] of [['水来了', 'rising'], ['住在城墙上', 'flood'], ['水退以后', 'close'], ['云龙山和百步洪', 'south'], ['要走了', 'arrive']]) {
  await page.evaluate((s) => window.__scrollToSection(s), sec);
  await page.waitForFunction((n) => window.table.shot === n, name, { timeout: 30000 });
  await page.waitForTimeout(4500);
  const labels = await page.evaluate(() => document.querySelectorAll('.tiqian').length);
  console.log(sec, '→', name, 'labels', labels);
  await page.screenshot({ path: path.join(here, '../shots-work', 'live-' + name + '.png') });
}
console.log(errs.length ? errs.join('\n') : 'no console errors');
await browser.close();
