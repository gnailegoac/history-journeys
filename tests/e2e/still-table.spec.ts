// 真的定格图在真的页面上：地址里带 ?tier=still，这一站只放图片，不摆立体的沙盘。
// 查的是定格图的沙盘（src/stage/still）在浏览器里做的事：图片显出来、铺得对，题签是页面上的字、盖在图片上面，
// 今名换得过去，读到后面的小节换一张图，窗口从宽变窄换成窄的那一张；
// 而且整个过程没有下载沙盘程序那一块（engine-….js），页面上没有画布——画不了三维的设备不该为它多下载一百多 KB。
//
// 这一站还没有定格图（content/ 里没有清单）：自己的机器上跳过（新加的一座沙盘，图还没拍）；发布流程里算没通过——
// 定格图已经拍好放进了仓库，那里要是找不到，就是丢了，不能悄悄跳过去再发布。
// 沙盘栏在各种状态下怎么换图片、说什么话，用的是替身，在 tests/e2e/pane-stills.spec.ts。

import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { StopScene } from '../../src/domain/scene';
import type { StillManifest } from '../../src/domain/stills';
import { fitStill } from '../../src/stage/still/fit';
import { ENGINE_ENTRY } from '../content/budgetRules';
import { fileSize, readBytes } from '../support/readBytes';
import { headingsOf, sceneOnDisk, scrollToSection, stagePane, stripText, stripsOf } from './helpers';

const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};

/**
 * 沙盘程序那一块代码在这一次构建里叫什么（如 assets/engine-一串字符.js）。构建出来的文件名是带一串字符的，猜不得：
 * 从构建清单（dist/.vite/manifest.json）里读，和 tests/build/dist-size.test.ts 是同一个办法。
 * 对着自己起的开发服务跑（设了 E2E_BASE_URL）、或者没有构建清单时是 null。
 */
function engineChunk(): string | null {
  if (env.E2E_BASE_URL) return null;
  try {
    const manifest = JSON.parse(new TextDecoder().decode(readBytes('dist/.vite/manifest.json'))) as Record<string, { file?: string }>;
    return manifest[ENGINE_ENTRY]?.file ?? null;
  } catch {
    return null;
  }
}

/** content/ 里这一站定格图的清单；还没有时是 null。 */
function manifestOnDisk(figureId: string, stopId: string): StillManifest | null {
  const path = `content/figures/${figureId}/stills/${stopId}.json`;
  try {
    fileSize(path);
  } catch {
    return null;
  }
  return JSON.parse(new TextDecoder().decode(readBytes(path))) as StillManifest;
}

/** 图片上现在挂着的题签：id 和字，按挂的先后。 */
async function stripsOnStill(page: Page): Promise<{ id: string; text: string }[]> {
  return page.locator('.stage-still-host .strip').evaluateAll((strips) => strips.map((strip) => ({ id: strip.getAttribute('data-strip-id') ?? '', text: strip.textContent ?? '' })));
}

/** 摆在上面的那张图片，显出来了没有，是哪个文件。 */
async function topPicture(page: Page): Promise<{ loaded: boolean; src: string } | null> {
  return page.evaluate(() => {
    const img = document.querySelector<HTMLImageElement>('.stage-still-host .still-table img.is-top');
    return img ? { loaded: img.complete && img.naturalWidth > 0, src: img.currentSrc || img.src } : null;
  });
}

/**
 * 图片是不是摆在该摆的地方。该摆在哪，照页面交给定格图的大小和四边留的空（只放图片时按钮下面多一行说明，上面留得多一些），
 * 用 src/stage/still/fit.ts 算一遍；和页面上量到的那张图片的位置、大小比，差不到 1.5 像素。
 * （算法本身对不对由 Node 里的 tests/unit/still-fit.test.ts 查；这里查的是算出来的数真的落到了页面上。）
 * 返回图片放大了几倍。
 */
async function expectPlaced(page: Page, manifest: StillManifest, scene: StopScene): Promise<number> {
  let scale = 0;
  await expect(async () => {
    const seen = await page.evaluate(() => {
      const host = document.querySelector('.stage-still-host');
      const wrapper = host?.querySelector('.still-table');
      const img = wrapper?.querySelector('img.is-top');
      if (!host || !wrapper || !img) return null;
      const box = img.getBoundingClientRect();
      const frame = host.getBoundingClientRect();
      return {
        width: host.clientWidth,
        height: host.clientHeight,
        section: wrapper.getAttribute('data-still-section'),
        shape: wrapper.getAttribute('data-still-shape'),
        insets: wrapper.getAttribute('data-still-insets') ?? '',
        box: { left: box.left - frame.left, top: box.top - frame.top, width: box.width, height: box.height },
      };
    });
    expect(seen, '页面上没有找到定格图').not.toBeNull();
    if (!seen) return;
    const still = manifest.stills.find((s) => s.section === seen.section && s.shape === seen.shape);
    expect(still, `清单里没有“${seen.section}”${seen.shape} 的那一张`).toBeDefined();
    if (!still) return;
    const [top, right, bottom, left] = seen.insets.split(' ').map(Number);
    expect([top, right, bottom, left].every(Number.isFinite), `四边留的空：“${seen.insets}”`).toBe(true);
    const closest = scene.sections.find((s) => s.heading === seen.section)?.camera.closest;
    const fit = fitStill(still, manifest.shapes[still.shape], manifest.made, { width: seen.width, height: seen.height, insets: { top, right, bottom, left } }, closest);
    expect(Math.abs(seen.box.left - fit.left), '左边').toBeLessThan(1.5);
    expect(Math.abs(seen.box.top - fit.top), '上边').toBeLessThan(1.5);
    expect(Math.abs(seen.box.width - fit.width), '宽').toBeLessThan(1.5);
    expect(Math.abs(seen.box.height - fit.height), '高').toBeLessThan(1.5);
    scale = fit.scale;
  }).toPass({ timeout: 10_000 });
  return scale;
}

test('只放图片的一站：图片和题签都对，今名、换小节、窗口变窄都跟得上，不下载沙盘程序，没有画布', async ({ page }) => {
  const requests: string[] = [];
  page.on('request', (request) => requests.push(request.url()));
  const problems: string[] = [];
  page.on('pageerror', (error) => problems.push(`页面出错：${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(`控制台报错：${message.text()}`);
  });
  await page.emulateMedia({ reducedMotion: 'reduce' });

  // 第一位人物、第一个有沙盘的站
  await page.goto('/?tier=still#/');
  const card = page.locator('a.card[data-available="true"]').first();
  await expect(card).toBeVisible();
  const figureId = await card.getAttribute('data-figure-id');
  if (!figureId) throw new Error('人物卡片上没有 id');
  await card.click();
  await expect(page.locator('.stop-item').first()).toBeVisible();
  const stops = await page.locator('.stop-item[data-stop-status="complete"]').evaluateAll((items) => items.map((item) => item.getAttribute('data-stop-id')));
  const stopId = stops.find((id): id is string => id !== null && sceneOnDisk(figureId, id) !== null);
  test.skip(!stopId, '还没有哪一站有沙盘');
  if (!stopId) return;
  const scene = sceneOnDisk(figureId, stopId)!;
  const manifest = manifestOnDisk(figureId, stopId);
  // 定格图已经放进仓库了（校验规则 18 也要求每座沙盘都有清单）：发布流程里找不到算没通过，自己的机器上跳过
  if (env.CI) expect(manifest, `发布流程里 ${figureId}/${stopId} 没有定格图的清单（content/figures/${figureId}/stills/${stopId}.json）`).not.toBeNull();
  else test.skip(!manifest, `${figureId}/${stopId} 还没有定格图（STILLS_OUT=content/figures npm run stills 还没有往 content/ 里拍过）`);
  if (!manifest) return;
  const headings = headingsOf(scene);
  const pane = stagePane(page);
  const wrapper = page.locator('.stage-still-host .still-table');

  await page.locator(`.stop-item[data-stop-id="${stopId}"]`).click();

  // ---- 图片显出来了：这一节的、宽的那一张；沙盘栏说自己放的是图片
  await expect(pane).toHaveAttribute('data-stage-picture', 'still');
  await expect(pane).toHaveAttribute('data-stage-section', headings[0]);
  await expect(wrapper).toHaveAttribute('data-still-section', headings[0]);
  await expect(wrapper).toHaveAttribute('data-still-shape', 'wide');
  await expect.poll(async () => (await topPicture(page))?.loaded).toBe(true);
  const first = (await topPicture(page))!;
  expect(first.src).toContain(`${stopId}-1-wide`);
  // 图片摆在算出来的地方。这个窗口就是照着拍的那一种，只是按钮下面多了一行说明、上面留得多了一点：
  // 图片差不多还是拍的时候那么大（最多缩一成）
  const wideScale = await expectPlaced(page, manifest, scene);
  expect(wideScale).toBeGreaterThan(0.9);
  expect(wideScale).toBeLessThan(1.001);
  // 交给定格图的容器，就是拍的时候量到的那么大
  const host = await page.locator('.stage-still-host').evaluate((el) => [el.clientWidth, el.clientHeight]);
  expect(host).toEqual(manifest.shapes.wide.pane);

  // ---- 题签：这一节该摆的那几条，当时的名字；是页面上的字，盖在图片上面（点得到的是题签，不是图片）
  const expected = stripsOf(scene, headings[0]);
  await expect.poll(() => stripsOnStill(page)).toEqual(expected.map((strip) => ({ id: strip.id, text: stripText(strip, 'ancient') })));
  const firstStrip = page.locator(`.stage-still-host .strip[data-strip-id="${expected[0].id}"]`);
  await expect(firstStrip).toBeVisible();
  const onTop = await firstStrip.evaluate((strip) => {
    const box = strip.getBoundingClientRect();
    // 题签那一层不接鼠标，先让它接一下，才问得出这一点上最上面是谁
    const layer = strip.parentElement as HTMLElement;
    const was = layer.style.pointerEvents;
    layer.style.pointerEvents = 'auto';
    const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    layer.style.pointerEvents = was;
    return hit === strip || strip.contains(hit);
  });
  expect(onTop, '题签要盖在图片上面').toBe(true);
  // 指北和比例尺照图片报的画：比例尺上写着“多少米”或“多少公里”
  await expect(page.locator('.stage-scale-label')).toHaveText(/^\d+(\.\d+)? (米|公里)$/);

  // ---- 今名：题签上的字换了，图片不动
  const hasModern = expected.some((strip) => strip.modern);
  await page.getByRole('button', { name: '今名' }).click();
  await expect.poll(() => stripsOnStill(page)).toEqual(expected.map((strip) => ({ id: strip.id, text: stripText(strip, 'modern') })));
  expect((await topPicture(page))!.src).toBe(first.src);
  await page.getByRole('button', { name: '古名' }).click();
  await expect.poll(() => stripsOnStill(page)).toEqual(expected.map((strip) => ({ id: strip.id, text: stripText(strip, 'ancient') })));
  if (!hasModern) console.log(`“${headings[0]}”的题签都没有今天的名字，今名、古名看不出差别`);

  // ---- 读到后面的一节：换成那一节的图和题签
  const index = Math.min(3, headings.length - 1);
  const later = headings[index];
  if (index > 0) {
    await scrollToSection(page, later);
    await expect(pane).toHaveAttribute('data-stage-section', later);
    await expect(wrapper).toHaveAttribute('data-still-section', later);
    await expect.poll(async () => (await topPicture(page))?.src ?? '').toContain(`${stopId}-${index + 1}-wide`);
    await expect.poll(async () => (await topPicture(page))?.loaded).toBe(true);
    await expect.poll(() => stripsOnStill(page)).toEqual(stripsOf(scene, later).map((strip) => ({ id: strip.id, text: stripText(strip, 'ancient') })));
  }

  // ---- 窗口变窄（竖着拿的平板那么大）：换成窄的那一张，照现在的栏重新摆
  await page.setViewportSize({ width: 768, height: 1024 });
  await expect(wrapper).toHaveAttribute('data-still-shape', 'narrow');
  await expect.poll(async () => (await topPicture(page))?.src ?? '').toContain('-narrow');
  await expect.poll(async () => (await topPicture(page))?.loaded).toBe(true);
  // 窄的那一张是照这种窗口拍的；多了一行说明，留出来的那一块矮了一截，图片可以跟着缩一些，不会缩得离谱
  const narrowScale = await expectPlaced(page, manifest, scene);
  expect(narrowScale).toBeGreaterThan(0.6);
  expect(narrowScale).toBeLessThan(1.001);
  await expect(page.locator('.stage-still-host .strip').first()).toBeVisible();

  // ---- 从头到尾没有下载沙盘程序，页面上没有画布
  // 那一块叫什么从构建清单里读；读不到（对着开发服务跑）才照名字的样子认。发布流程里一定读得到
  const engineFile = engineChunk();
  if (env.CI) expect(engineFile, '发布流程里从构建清单读不出沙盘程序那一块的文件名').not.toBeNull();
  const isEngine = (url: string): boolean => (engineFile !== null && url.includes(`/${engineFile}`)) || /\/engine(-[^/]*)?\.(js|ts)(\?|$)/.test(url);
  expect(requests.filter(isEngine)).toEqual([]);
  expect(requests.some((url) => new RegExp(`${stopId}-1-wide[^/]*\\.jpg`).test(url))).toBe(true);
  await expect(page.locator('canvas')).toHaveCount(0);
  expect(problems).toEqual([]);
});
