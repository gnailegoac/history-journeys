// 出五张样张。先把页面服务跑起来（在项目根目录执行）：
//   node node_modules/vite/bin/vite.js spikes/art-direction --port 5423 --strictPort
// 再执行：node spikes/art-direction/c/shoot.mjs        出全部五张（2 倍像素），存到 c/shots/
//         node spikes/art-direction/c/shoot.mjs 03 1   只出某一张；后一个数是像素倍数（调试时用 1 更快）
// 服务不在 5423 端口时：SHOT_BASE=http://localhost:端口/c/ node spikes/art-direction/c/shoot.mjs
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const BASE = process.env.SHOT_BASE ?? 'http://localhost:5423/c/';
const OUT = fileURLToPath(new URL('./shots/', import.meta.url));
const only = process.argv[2];
const dpr = Number(process.argv[3] ?? 2);
mkdirSync(OUT, { recursive: true });

const DESKTOP = { width: 1440, height: 900 };
const PHONE = { width: 390, height: 844 };
const SHOTS = [
  { file: '01-stop-arrive.png', url: 'index.html?shot=arrive', viewport: DESKTOP }, // 站点页，“到徐州”，整张沙盘
  { file: '02-stop-flood.png', url: 'index.html?shot=flood', viewport: DESKTOP }, // 站点页，“住在城墙上”，大水
  { file: '03-close.png', url: 'index.html?shot=close', viewport: DESKTOP }, // 站点页，“水退以后”，东门上的黄楼
  { file: '04-home.png', url: 'home.html', viewport: DESKTOP }, // 首页
  { file: '05-phone.png', url: 'index.html?shot=arrive', viewport: PHONE, mobile: true }, // 站点页在手机上
];

// 这台机器没有显卡，一次只开一个浏览器、一页一页拍
const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
for (const s of SHOTS) {
  if (only && !s.file.startsWith(only)) continue;
  const page = await browser.newPage({ viewport: s.viewport, deviceScaleFactor: dpr, isMobile: !!s.mobile, hasTouch: !!s.mobile });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  const t0 = Date.now();
  await page.goto(BASE + s.url, { waitUntil: 'load', timeout: 180000 });
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 300000 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: OUT + s.file });
  console.log(`${s.file}  ${Date.now() - t0} ms${errors.length ? '  有报错：' + errors.join(' | ') : ''}`);
  await page.close();
}
await browser.close();
