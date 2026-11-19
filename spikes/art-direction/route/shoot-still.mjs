// 拍人物页暂时用的那张定格图：node shoot-still.mjs
// 拍的是全程沙盘的样张（?relief=b，整张沙盘的那个镜头）。只留沙盘和沙盘上的题签：
// 左边那页纸、图下面的题记、图例、小注、比例尺和指北都不拍进去，这些字由人物页自己印在图的下面。
//
// 先把页面服务开起来（在 spikes/art-direction 里）：
//   node ../../node_modules/vite/bin/vite.js . --port 5424 --strictPort
// 这台机器没有显卡，一帧要几秒；一次只开一个浏览器。拍完把页面服务关掉。
//
// 图存到 content/figures/su-shi/stills/route.jpg。样张自己印在图下面的题记和小注会打印出来：
// figure.json 里 routeStill 的 caption 照抄题记，note 照抄小注，前面只加一句“这是一张定格图，还不能转动。”。
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(here, '../../../package.json'));
const { chromium } = require('@playwright/test');
const base = process.env.SAMPLE_URL || 'http://localhost:5424/route/';
const out = path.join(here, '../../../content/figures/su-shi/stills/route.jpg');

// 画面和样张定稿时一样大（1440 × 900，右边的沙盘 880 × 900），题签的位置和小注的字才和定稿的那张一样。
const VIEW = { width: 1440, height: 900 };
// 沙盘连座子裁出来约 825 × 695；乘 1.7，图宽 1400 上下。
const SCALE = Number(process.env.SCALE || 1.7);
// 座子四周留多少（按 1 倍的画面算）：留给座子落在案上的那圈淡影。
const MARGIN = 48;
// 校验规则 16：定格图不超过 300 KB。先按 80 的质量存，太大就一档一档往下降。
const MAX_BYTES = 300 * 1024;
const QUALITIES = [80, 76, 72, 68];

fs.mkdirSync(path.dirname(out), { recursive: true });

const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
let failed = false;
try {
  const ctx = await browser.newContext({ viewport: VIEW, deviceScaleFactor: SCALE });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('[页面出错]', e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') console.log('[页面报错]', m.text().slice(0, 300));
  });
  const t0 = Date.now();
  await page.goto(base + 'index.html?relief=b');
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 300000 });
  await page.waitForTimeout(500);

  // 样张自己印的字：趁它们还在页面上，先读出来
  const dbg = await page.evaluate(() => window.__debug());
  if (dbg.problems.length) {
    failed = true;
    console.log('[路线从水上穿过去了]', JSON.stringify(dbg.problems));
  }

  // 把沙盘以外的东西藏起来。只是看不见，位置不动，所以沙盘在画面里的位置和大小不变
  await page.addStyleTag({ content: '.leaf, .scene .scrim, .scene .caption, .scene .legend { visibility: hidden !important; }' });
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));

  // 裁到沙盘：地形板、框、座子的八个角落在画面的哪里，加上立在沙盘上的题签，四周再留一圈
  const clip = await page.evaluate((margin) => {
    const { scene, camera, renderer } = window.table;
    const canvas = renderer.domElement.getBoundingClientRect();
    const Vector3 = camera.position.constructor;
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    const grow = (x, y) => {
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
    };
    scene.updateMatrixWorld();
    scene.traverse((o) => {
      // 投影子的才算：地形板、四边的切面、紫檀框、四只矮脚。案上那块淡影和路线不算
      if (!o.isMesh || !o.castShadow) return;
      o.geometry.computeBoundingBox();
      const b = o.geometry.boundingBox;
      for (const x of [b.min.x, b.max.x]) for (const y of [b.min.y, b.max.y]) for (const z of [b.min.z, b.max.z]) {
        const v = new Vector3(x, y, z).applyMatrix4(o.matrixWorld).project(camera);
        grow(canvas.left + (v.x * 0.5 + 0.5) * canvas.width, canvas.top + (-v.y * 0.5 + 0.5) * canvas.height);
      }
    });
    for (const el of document.querySelectorAll('#labels .tiqian, #marks .mark')) {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      grow(r.left, r.top);
      grow(r.right, r.bottom);
    }
    const left = Math.max(canvas.left, Math.floor(x0 - margin));
    const top = Math.max(canvas.top, Math.floor(y0 - margin));
    const right = Math.min(canvas.right, Math.ceil(x1 + margin));
    const bottom = Math.min(canvas.bottom, Math.ceil(y1 + margin));
    return { x: left, y: top, width: right - left, height: bottom - top };
  }, MARGIN);

  let saved = null;
  for (const quality of QUALITIES) {
    const bytes = await page.screenshot({ type: 'jpeg', quality, clip });
    if (bytes.length <= MAX_BYTES) {
      fs.writeFileSync(out, bytes);
      saved = { quality, bytes: bytes.length };
      break;
    }
    console.log(`质量 ${quality}：${Math.round(bytes.length / 1024)} KB，超过 300 KB，降一档再存`);
  }
  if (saved) {
    console.log(`存好了：${path.relative(path.join(here, '../../..'), out).replace(/\\/g, '/')}`);
    console.log(`  ${Math.round(clip.width * SCALE)} × ${Math.round(clip.height * SCALE)}，质量 ${saved.quality}，${Math.round(saved.bytes / 1024)} KB，用了 ${Date.now() - t0} 毫秒`);
  } else {
    failed = true;
    console.log('[没有存] 质量降到最低一档还是超过 300 KB：把 SCALE 调小一点再拍');
  }
  console.log('题记：', dbg.caption.join(' ｜ '));
  console.log('图例：', dbg.key);
  console.log('小注：', dbg.note);
  await ctx.close();
} finally {
  await browser.close();
}
if (failed) process.exit(1);
