// 拍样张：node shoot.mjs [文件名里的一段，只拍对得上的几张]
// 先把页面服务开起来（在 spikes/art-direction 里）：
//   node ../../../node_modules/vite/bin/vite.js .. --port 5424 --strictPort
// 这台机器没有显卡，一帧要几秒；一次只开一个浏览器，一张一张拍。
// SCALE=1 拍 1 倍的放在 shots-work/（干活时看）；默认 2 倍放在 shots/。
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(here, '../../../package.json'));
const { chromium } = require('@playwright/test');
const scale = Number(process.env.SCALE || 2);
const out = path.join(here, scale === 2 ? 'shots' : 'shots-work');
const base = process.env.SAMPLE_URL || 'http://localhost:5424/route/';
const only = process.argv[2];
fs.mkdirSync(out, { recursive: true });

const DESK = { width: 1440, height: 900 };
const PHONE = { width: 390, height: 844 };
const SHOTS = [
  { file: '01-figure-whole-a.png', url: 'index.html?relief=a', view: DESK },
  { file: '02-figure-whole-b.png', url: 'index.html?relief=b', view: DESK },
  { file: '03-leg-xuzhou.png', url: 'index.html?shot=leg&to=xuzhou&relief=b', view: DESK },
  { file: '04-relief-a.png', url: 'index.html?shot=relief&relief=a', view: DESK },
  { file: '05-relief-b.png', url: 'index.html?shot=relief&relief=b', view: DESK },
  { file: '06-phone.png', url: 'index.html?relief=b', view: PHONE },
  { file: '07-top-check.png', url: 'index.html?shot=top&relief=b', view: DESK },
];

let bad = false;
const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
for (const s of SHOTS) {
  if (only && !s.file.includes(only)) continue;
  const phone = s.view.width < 500;
  const ctx = await browser.newContext({ viewport: s.view, deviceScaleFactor: scale, isMobile: phone, hasTouch: phone });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('[页面出错]', e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') console.log('[页面报错]', m.text().slice(0, 300));
  });
  const t0 = Date.now();
  await page.goto(base + s.url);
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 300000 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(out, s.file) });
  const dbg = await page.evaluate(() => window.__debug());
  console.log(s.file, Date.now() - t0, 'ms', JSON.stringify(dbg.info));
  console.log('  题记：', dbg.caption.join(' ｜ '));
  console.log('  图例（' + dbg.keyLines + ' 行）：', dbg.key);
  console.log('  小注（' + dbg.noteLines + ' 行）：', dbg.note);
  if (process.env.DEBUG) console.log(JSON.stringify(dbg.labels), JSON.stringify(dbg.legs));
  if (dbg.problems.length) {
    bad = true;
    console.log('[路线从水上穿过去了]', JSON.stringify(dbg.problems));
  }
  await ctx.close();
}
await browser.close();
if (bad) process.exit(1);
