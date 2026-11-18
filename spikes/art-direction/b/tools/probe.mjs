// 问页面：场景里的某几个点落在屏幕哪里（摆题签用）。node tools/probe.mjs "<页面>" "x,y,z;x,y,z"
import { chromium } from '@playwright/test';
const [url, pts] = process.argv.slice(2);
const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })).newPage();
await page.goto('http://localhost:5422/b/' + url);
await page.waitForFunction(() => window.__ready === true, null, { timeout: 180000 });
const res = await page.evaluate((list) => list.map((p) => { const r = window.table.project(p[0], p[1], p[2]); return [Math.round(r.x), Math.round(r.y)]; }), pts.split(';').map((s) => s.split(',').map(Number)));
console.log(JSON.stringify(res));
await browser.close();
