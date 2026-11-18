// 拍样张：node shoot.mjs（先把页面服务开在 5422 端口上，见下）
//   node ../../../node_modules/vite/bin/vite.js .. --port 5422 --strictPort
// 这台机器没有显卡，一帧要几秒；一次只开一个浏览器，一张一张拍。
// SCALE=1 拍 1 倍的（干活时看）；默认 2 倍。
//
// 要交的五张是 01–05；06、07 是多拍的两张（只看沙盘的东门近景、云龙山和百步洪一节）。
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, 'shots');
const base = process.env.SAMPLE_URL || 'http://localhost:5422/b/';
const scale = Number(process.env.SCALE || 2);
fs.mkdirSync(out, { recursive: true });

const DESK = { width: 1440, height: 900 };
const PHONE = { width: 390, height: 844 };
const SHOTS = [
  { file: '01-stop-arrive.png', url: 'index.html?shot=arrive&note=n2', view: DESK },
  { file: '02-stop-flood.png', url: 'index.html?shot=flood&note=n2', view: DESK, section: '住在城墙上' },
  { file: '03-close.png', url: 'index.html?shot=close&note=n8', view: DESK, section: '水退以后' },
  { file: '04-home.png', url: 'home.html', view: DESK },
  { file: '05-phone.png', url: 'index.html?shot=arrive&note=n2', view: PHONE },
  { file: '06-close-wide.png', url: 'index.html?shot=close&wide=1', view: DESK },
  { file: '07-stop-south.png', url: 'index.html?shot=south&note=n10', view: DESK, section: '云龙山和百步洪' },
];

const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
for (const s of SHOTS) {
  const phone = s.view.width < 500;
  const ctx = await browser.newContext({ viewport: s.view, deviceScaleFactor: scale, isMobile: phone, hasTouch: phone });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('[页面出错]', e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') console.log('[页面报错]', m.text().slice(0, 300));
  });
  const t0 = Date.now();
  await page.goto(base + s.url);
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 240000 });
  if (s.section) await page.evaluate((name) => window.__scrollToSection(name), s.section);
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(out, s.file) });
  console.log(s.file, Date.now() - t0, 'ms');
  await ctx.close();
}
await browser.close();
