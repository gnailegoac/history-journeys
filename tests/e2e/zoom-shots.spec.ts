// 远近一排照片：用真沙盘，在两个小节上像读者那样拿滚轮把镜头从近拉到远，每到一个远近拍一张，供人看（不进仓库）。
// 看的是模型跟着远近变的时候连不连得上：相邻的两张之间，不该有东西突然冒出来、突然没了或者跳了位置；
// 细处收到一半的样子要看得过去；放大了的东西脚下要有它的影子。
// 平时不跑：设环境变量 REAL_SHOTS=1 才跑。只拍宽屏（1440×900）一套。
//
// 拍哪里：第一个有沙盘的那一站的第 3、第 5 小节（徐州是“住在城墙上”和“云龙山和百步洪”），
// 折算过的远近 D 大约 5、8、12、18、27、40、60 公里各一张。
// D 是“同样的一米多少像素，在 900 像素高、视角 21 度的画面上要离多远”（src/stage/three/kit/figure.ts 的 equivalentDistance）；
// 这里从沙盘栏里的比例尺读出“一米多少像素”，反过来算出现在的 D，一边滚一边对，差不到 3% 才拍。
//
// 存到哪：平时是 tests/shots/zoom；想另存一套就设 SHOTS_DIR（和 real-shots 是同一个变量，可以存进同一个文件夹）。
// 文件名：zoom-<站>-<第几节>-<多少公里>km.png，只拍沙盘栏那一块；另写一页 zoom-<站>.html，把两排照片并排摆好。
// 画质：不设是完整的一档；设 TIER=reduced 拍减配的一档。每拍一张之前都看一眼沙盘栏：放着的是立体的沙盘，画质是要的这一档。
// 例：REAL_SHOTS=1 SHOTS_DIR=tests/shots/b-look-1 npx playwright test tests/e2e/zoom-shots.spec.ts

import { mkdirSync, writeFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { StageTier } from '../../src/stage/types';
import { expectRealTable, headingsOf, openFigureWithTable, realUrl, scrollToSection, stagePane, twoFrames } from './helpers';

const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
const DIR = env.SHOTS_DIR ?? 'tests/shots/zoom';

/** 拍第几小节（从 1 数起）。 */
const SECTIONS = [3, 5];
/** 每一节拍这几个远近（D，公里），从近到远。 */
const DISTANCES_KM = [5, 8, 12, 18, 27, 40, 60];
/** 滚到离要的 D 差不到这么多成才拍。 */
const CLOSE_ENOUGH = 0.03;
/** 最多滚几回（比例尺上的那一段是取整的像素，读出来的 D 差百分之一上下，所以要一边滚一边对）。 */
const MAX_TRIES = 8;

/** 900 像素高、视角 21 度的画面上，离镜头 1 米远、1 米宽的东西是多少像素：D 就是照这块画面折算的。 */
const REFERENCE_FOCAL_PX = 900 / 2 / Math.tan((21 * Math.PI) / 360);
/** three.js 的 OrbitControls 滚轮每滚 100，镜头的远近乘或除 0.95（examples/jsm/controls/OrbitControls.js 的 _getZoomScale）。 */
const WHEEL_STEP = Math.log(1 / 0.95) / 100;

test.skip(!env.REAL_SHOTS, '只在 REAL_SHOTS=1 时拍照');

/** 用哪一档画质拍。写了别的字就停下来，不悄悄当成完整的一档。 */
function tierToShoot(): StageTier {
  const asked = env.TIER;
  if (asked === undefined || asked === '' || asked === 'full') return 'full';
  if (asked === 'reduced') return 'reduced';
  throw new Error(`环境变量 TIER 只能是 full 或 reduced，现在是“${asked}”`);
}

/** 现在的 D（米）：从沙盘栏里的比例尺读“多少像素宽的一段是多少米”。读不出来时抛出错误。 */
async function currentD(page: Page): Promise<number> {
  const read = await page.evaluate(() => {
    const label = document.querySelector('.stage-scale-label')?.textContent ?? '';
    const bar = document.querySelector<HTMLElement>('.stage-scale-bar');
    return { label, px: bar ? parseFloat(bar.style.width) : NaN };
  });
  const match = /^(\d+(?:\.\d+)?) (米|公里)$/.exec(read.label);
  if (!match || !(read.px > 0)) throw new Error(`沙盘栏里的比例尺读不出来：“${read.label}”，${read.px} 像素`);
  const metres = Number(match[1]) * (match[2] === '公里' ? 1000 : 1);
  return REFERENCE_FOCAL_PX / (read.px / metres);
}

/** 拿滚轮把镜头拉到 D 大约是 targetM 的地方；返回最后读到的 D。鼠标要先放在画布上。 */
async function zoomTo(page: Page, targetM: number): Promise<number> {
  let now = await currentD(page);
  for (let i = 0; i < MAX_TRIES && Math.abs(Math.log(targetM / now)) > Math.log(1 + CLOSE_ENOUGH); i++) {
    const before = now;
    // 往下滚（正数）是拉远，往上滚是拉近
    await page.mouse.wheel(0, Math.log(targetM / now) / WHEEL_STEP);
    // 等沙盘画过、比例尺跟着改了（用软件画的时候一帧要等一会儿）；两秒还没动，就是镜头已经到头了
    for (let waited = 0; waited < 20 && now === before; waited++) {
      await twoFrames(page);
      now = await currentD(page);
      if (now === before) await page.waitForTimeout(100);
    }
  }
  return now;
}

test('宽屏 1440×900：第 3、第 5 小节，从近到远各拍一排', async ({ page }) => {
  test.setTimeout(1_200_000);
  const tier = tierToShoot();
  await page.setViewportSize({ width: 1440, height: 900 });
  // 不要滑动的动画：换小节直接摆到位，拍的是每个远近上停稳以后的样子
  await page.emulateMedia({ reducedMotion: 'reduce' });

  const problems: string[] = [];
  page.on('pageerror', (error) => problems.push(`页面出错：${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') problems.push(`控制台（${message.type()}）：${message.text()}`);
  });

  const { found } = await openFigureWithTable(page, realUrl('#/', tier));
  test.skip(!found, '还没有哪一站有沙盘');
  if (!found) return;

  await page.locator(`.stop-item[data-stop-id="${found.stopId}"]`).click();
  const pane = stagePane(page);
  await expectRealTable(page, tier, 240_000);

  const headings = headingsOf(found.scene);
  const rows: { heading: string; shots: { file: string; wantKm: number; gotKm: number }[] }[] = [];
  for (const n of SECTIONS.filter((index) => index <= headings.length)) {
    const heading = headings[n - 1];
    await scrollToSection(page, heading);
    await expect(pane).toHaveAttribute('data-stage-section', heading, { timeout: 120_000 });
    await page.waitForTimeout(1_000);

    // 鼠标放在沙盘栏留出来的那一块中间（按钮下面、题记上面），滚轮才是滚在画布上
    const box = (await pane.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height * 0.4);
    const startM = await currentD(page);
    console.log(`“${heading}”摆好时 D 是 ${(startM / 1000).toFixed(1)} 公里`);

    const shots: { file: string; wantKm: number; gotKm: number }[] = [];
    for (const wantKm of DISTANCES_KM) {
      const gotM = await zoomTo(page, wantKm * 1000);
      expect(Math.abs(gotM / (wantKm * 1000) - 1), `“${heading}”想拉到 D ${wantKm} 公里，只到了 ${(gotM / 1000).toFixed(1)} 公里（镜头能拉的范围不够，或者滚轮没有滚在画布上）`).toBeLessThanOrEqual(CLOSE_ENOUGH);
      // 停稳：手一放开，沙盘要补画一次影子、把题签重摆一遍
      await page.waitForTimeout(1_000);
      // 读者动了镜头，摆着的仍然是这一节；放着的还是立体的沙盘，还是要的这一档
      await expect(pane).toHaveAttribute('data-stage-section', heading);
      await expectRealTable(page, tier);
      const file = `zoom-${found.stopId}-${n}-${String(wantKm).padStart(2, '0')}km.png`;
      await page.screenshot({ path: `${DIR}/${file}`, clip: box });
      shots.push({ file, wantKm, gotKm: gotM / 1000 });
      console.log(`“${heading}” D ${wantKm} 公里（实际 ${(gotM / 1000).toFixed(2)}）：${DIR}/${file}`);
    }
    rows.push({ heading, shots });
  }
  expect(rows.length, '这座沙盘的小节不够，一排也没有拍').toBeGreaterThan(0);

  // 一页并排的：一节一排，从近到远
  const page_ = [
    '<!doctype html>',
    '<meta charset="utf-8">',
    `<title>${found.stopId}：从近到远</title>`,
    '<style>body{margin:16px;font:14px/1.5 sans-serif;background:#f4f1ea;color:#222}h2{font-size:16px;margin:20px 0 6px}.row{display:flex;gap:6px;overflow-x:auto}figure{margin:0;flex:none}img{display:block;height:460px}figcaption{font-size:12px}</style>',
    `<h1>${found.stopId}：从近到远（${tier === 'full' ? '完整' : '减配'}的一档）</h1>`,
    '<p>相邻的两张之间：有没有东西突然冒出来、突然没了、跳了位置？细处收到一半的样子看得过去吗？放大了的东西脚下有影子吗？</p>',
    ...rows.flatMap((row) => [
      `<h2>${row.heading}</h2>`,
      '<div class="row">',
      ...row.shots.map((shot) => `<figure><img src="${shot.file}" alt=""><figcaption>D ${shot.wantKm} 公里（实际 ${shot.gotKm.toFixed(2)}）</figcaption></figure>`),
      '</div>',
    ]),
    '',
  ].join('\n');
  mkdirSync(DIR, { recursive: true });
  writeFileSync(`${DIR}/zoom-${found.stopId}.html`, page_);
  console.log(`并排的一页：${DIR}/zoom-${found.stopId}.html`);

  if (problems.length > 0) console.log(`页面上的报错和警告：\n${problems.join('\n')}`);
});
