// 拍样张。先把页面服务起来：
//   node ../../../node_modules/vite/bin/vite.js .. --port 5421 --strictPort
// 再在这个文件夹里：
//   node shoot.mjs            → shots/ 里五张（外加一张 03b），两倍像素
//   node shoot.mjs 1 work     → 一倍像素，放到 shots-work/（看效果用，快）
//   node shoot.mjs 1 work 02  → 只拍文件名里带 02 的
// 这台机器没有显卡，一帧要几秒；一次只开一个浏览器。
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const dpr = Number(process.argv[2] || 2);
const outDir = new URL(process.argv[3] === 'work' ? './shots-work/' : './shots/', import.meta.url);
const only = process.argv[4];
mkdirSync(outDir, { recursive: true });
const BASE = process.env.SAMPLE_BASE || 'http://localhost:5421/a/';

const DESK = { width: 1440, height: 900 };
const PHONE = { width: 390, height: 844 };
const SHOTS = [
  // 站点页的开头：到徐州
  { file: '01-stop-arrive.png', url: 'index.html?shot=arrive', view: DESK },
  // 站点页读到“住在城墙上”：大水。点开“重阳”的小注
  { file: '02-stop-flood.png', url: 'index.html?shot=flood&note=n7', scrollTo: 'sec-3', view: DESK },
  // 水退以后：东门上的黄楼（沙盘铺满整页，页面上点“看大图”就是这个样子）
  { file: '03-close.png', url: 'index.html?shot=close&wide', view: DESK },
  // 同一个镜头，放在正文旁边。点开“刷了黄土”的小注
  { file: '03b-close-page.png', url: 'index.html?shot=close&note=n8', scrollTo: 'sec-4', view: DESK },
  // 首页
  { file: '04-home.png', url: 'home.html', view: DESK },
  // 手机上的站点页：到徐州
  { file: '05-phone.png', url: 'index.html?shot=arrive&note=none', view: PHONE, phone: true },
];

const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
for (const s of SHOTS) {
  if (only && !s.file.includes(only)) continue;
  const page = await browser.newPage({ viewport: s.view, deviceScaleFactor: dpr, isMobile: !!s.phone, hasTouch: !!s.phone });
  const problems = [];
  page.on('pageerror', (e) => problems.push('pageerror: ' + e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push('console: ' + m.text());
  });
  const t0 = Date.now();
  await page.goto(BASE + s.url, { waitUntil: 'load' });
  await page.waitForFunction('window.__ready === true', null, { timeout: 180000 });
  if (s.scrollTo) {
    await page.evaluate((id) => {
      const el = document.getElementById(id);
      window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 34);
    }, s.scrollTo);
  }
  await page.waitForTimeout(500);
  const file = new URL(s.file, outDir);
  await page.screenshot({ path: decodeURIComponent(file.pathname.replace(/^\/([A-Za-z]:)/, '$1')) });
  const info = await page.evaluate(() => window.__info || null);
  console.log(s.file, ((Date.now() - t0) / 1000).toFixed(1) + 's', JSON.stringify(info), problems.join(' | '));
  await page.close();
}
await browser.close();
