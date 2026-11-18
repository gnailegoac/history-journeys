// 开发用：拍一张。node snap.mjs <网址路径和参数> <输出文件> [宽] [高] [倍数]
import { chromium } from '@playwright/test';
const [, , path, out, w = '1440', h = '900', dpr = '1'] = process.argv;
const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: +w, height: +h }, deviceScaleFactor: +dpr });
const logs = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(m.type() + ': ' + m.text()); });
page.on('pageerror', (e) => logs.push('pageerror: ' + e.message));
const t0 = Date.now();
await page.goto('http://localhost:5421/a/' + path, { waitUntil: 'load' });
try { await page.waitForFunction('window.__ready === true', null, { timeout: 90000 }); } catch (e) { logs.push('timeout waiting for __ready'); }
await page.waitForTimeout(300);
const info = await page.evaluate(() => window.__info || null);
await page.screenshot({ path: out });
console.log(JSON.stringify({ out, secs: (Date.now() - t0) / 1000, info }), logs.slice(0, 12).join('\n'));
await browser.close();
