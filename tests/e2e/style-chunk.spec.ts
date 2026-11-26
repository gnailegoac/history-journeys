// 时代样式的小块程序（src/stage/styles.ts 登记的；一种样式分两小块：站点沙盘取整套，全程沙盘只取每一座沙盘都用的那一半）没取到、取得慢的时候，页面是什么样。
// 样式不在沙盘程序里：摆写着它的沙盘时才下载，沙盘程序一到就去要。这里把它的请求拦下来（断掉，或者压住不放），
// 在人物页（全程沙盘）和一站的页面（它自己的沙盘）上各看一遍：
//   没取到：沙盘栏说的是立体的沙盘没能摆出来时的那一句（有定格图的沙盘照常放着图片，这一句在按钮下面），带“再试一次”；
//           正文、目录照常。点“再试一次”真的再取一遍，这一回取到了，立体的沙盘摆出来；
//   取得慢：先是等着的样子——不说“没能……”，没有“再试一次”；放开以后照常摆出来。
// 再从人物页的全程沙盘点进一站自己的沙盘看一遍（最后一组）：那时候要的只有站点沙盘才用的那一小块，断掉、压住各一回。
// 用的是真的沙盘程序（地址里指定完整的一档，不带 ?stage=fake）：替身不取样式。只认 Chromium（断过一回重新去取，别的浏览器没有试过）。
// 不靠浏览器的那一半（样式没取到，沙盘说得出缘故；再摆一座重新取）在 tests/stage/route-view.test.ts 和 tests/stage/styles.test.ts。

import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { STYLES } from '../../src/stage/styles';
import { expectRealTable, firstOpenFigureOnDisk, realUrl, routeOnDisk, stagePane, stopsWithScenes } from './helpers';

const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};

const FIGURE = firstOpenFigureOnDisk();
/** 这位人物的全程沙盘，和他头一个有自己的沙盘的站（照磁盘上的文件找）。 */
const ROUTE = FIGURE === null ? null : routeOnDisk(FIGURE);
const STOP = stopsWithScenes().find((one) => one.figureId === FIGURE) ?? null;

/**
 * 一种样式的小块的请求，两小块都认：构建出来的叫 <样式的名字>-<一串字符>.js 和 <样式的名字>-route-<一串字符>.js，
 * 开发服务上是源文件 style/<样式的名字>/ 里的 <样式的名字>.ts 和 <样式的名字>-route.ts。
 */
const styleRequest = (id: string): RegExp => new RegExp(`/${id}(-[\\w-]+)?\\.(js|ts)(\\?.*)?$`);

/** 每一座沙盘都用的那一半的请求（<样式的名字>-route-<一串字符>.js，开发服务上是 <样式的名字>-route.ts）。 */
const halfRequest = (id: string): RegExp => new RegExp(`/${id}-route(-[\\w-]+)?\\.(js|ts)(\\?.*)?$`);
/** 站点沙盘才用的那一小块自己的请求：样式的两小块里不是那一半的那一个。 */
const stopChunkRequest =
  (id: string) =>
  (url: URL): boolean =>
    styleRequest(id).test(url.href) && !halfRequest(id).test(url.href);

const PAGES = [
  { name: '人物页（全程沙盘）', hash: () => `#/${FIGURE}`, style: () => ROUTE?.style ?? null },
  { name: '一站的页面（它自己的沙盘）', hash: () => `#/${FIGURE}/${STOP?.stopId}`, style: () => STOP?.scene.style ?? null },
] as const;

const READY_MS = 120_000;
const FAILED_WORDS = '沙盘没能摆出来';

/** 这个浏览器有没有 WebGL2。没有时：发布流程里算没通过，自己的机器上跳过。 */
async function needWebGL2(page: Page): Promise<void> {
  const hasWebGL2 = await page.evaluate(() => {
    try {
      return document.createElement('canvas').getContext('webgl2') !== null;
    } catch {
      return false;
    }
  });
  if (env.CI) expect(hasWebGL2, '发布流程的浏览器没有 WebGL2：真沙盘一次也没有起来过，不能算通过').toBe(true);
  else test.skip(!hasWebGL2, '这个浏览器没有 WebGL2');
}

/** 这一页上不靠沙盘的东西照常在：人物页是各站的目录，一站的页面是抬头。 */
async function expectShell(page: Page, name: (typeof PAGES)[number]['name']): Promise<void> {
  if (name.startsWith('人物页')) await expect(page.locator('.stop-item').first()).toBeVisible();
  else await expect(page.locator('.stop-page')).toHaveAttribute('data-stop-id', STOP!.stopId);
  await expect(page.locator('.page-title')).toBeVisible();
}

test.describe('时代样式那一小块没取到', () => {
  for (const { name, hash, style } of PAGES) {
    test(`${name}：沙盘栏说立体的沙盘没能摆出来，带“再试一次”；别的照常；点“再试一次”真的再取一遍，沙盘摆出来了`, async ({ page }) => {
      test.setTimeout(300_000);
      const id = style();
      test.skip(FIGURE === null || id === null, 'content/ 里没有可以点进去的人物，或者他没有这样的沙盘');
      expect(STYLES.map((row) => row.id), '场景里写的样式不在登记表里').toContain(id);
      await page.setViewportSize({ width: 1024, height: 640 });
      await page.emulateMedia({ reducedMotion: 'reduce' });
      const uncaught: string[] = [];
      page.on('pageerror', (error) => uncaught.push(String(error)));
      // 断着的时候，要几次断几次；放开以后照常
      let cut = true;
      const asked: string[] = [];
      await page.route(styleRequest(id as string), (routed) => {
        asked.push(cut ? 'cut' : 'through');
        return cut ? routed.abort() : routed.continue();
      });
      await page.goto(realUrl(hash(), 'full'));
      await needWebGL2(page);

      await expectShell(page, name);
      // 沙盘栏：立体的沙盘没能摆出来，可以再试（有定格图的，图片照常放着）
      const pane = stagePane(page);
      await expect(pane).toHaveAttribute('data-stage-state', 'failed', { timeout: READY_MS });
      await expect(pane).toContainText(FAILED_WORDS);
      const retry = pane.locator('.stage-retry');
      await expect(retry).toHaveText('再试一次');
      await expect(pane).not.toHaveAttribute('data-stage-picture', 'table');
      // 样式要过（至少一次），都断了
      expect(asked.length).toBeGreaterThanOrEqual(1);
      expect(asked).not.toContain('through');
      const before = asked.length;

      // 网通了。再试一次：真的再去取一遍，这一回取到了，立体的沙盘摆出来
      cut = false;
      await retry.click();
      await expectRealTable(page, 'full', READY_MS);
      expect(asked.slice(before)).toContain('through');
      expect(asked.slice(before)).not.toContain('cut');
      await expect(pane.locator('.stage-retry')).toHaveCount(0);
      await expect(pane).not.toContainText(FAILED_WORDS);
      // 没有哪个出错没人接（页面一开始要的那一次没取到，不能成了“未处理的错误”）
      expect(uncaught).toEqual([]);
    });
  }
});

test.describe('时代样式那一小块取得慢', () => {
  for (const { name, hash, style } of PAGES) {
    test(`${name}：压着的时候是等着的样子，不说“没能……”，没有“再试一次”；放开以后照常摆出来`, async ({ page }) => {
      test.setTimeout(300_000);
      const id = style();
      test.skip(FIGURE === null || id === null, 'content/ 里没有可以点进去的人物，或者他没有这样的沙盘');
      await page.setViewportSize({ width: 1024, height: 640 });
      await page.emulateMedia({ reducedMotion: 'reduce' });
      const uncaught: string[] = [];
      page.on('pageerror', (error) => uncaught.push(String(error)));
      // 压住：请求先不放行，等这里叫 release
      let release: () => void = () => {};
      const held = new Promise<void>((resolve) => (release = resolve));
      let asked = 0;
      await page.route(styleRequest(id as string), async (routed) => {
        asked++;
        await held;
        await routed.continue();
      });
      await page.goto(realUrl(hash(), 'full'));
      await needWebGL2(page);

      await expectShell(page, name);
      const pane = stagePane(page);
      // 等到样式真的被要过了，再看四秒：这一段里沙盘栏一直是等着的样子（立体的沙盘还没有摆出来，也没有说摆不出来）
      await expect.poll(() => asked, { timeout: READY_MS }).toBeGreaterThanOrEqual(1);
      const until = Date.now() + 4000;
      while (Date.now() < until) {
        await expect(pane).not.toHaveAttribute('data-stage-state', 'failed');
        await expect(pane).not.toHaveAttribute('data-stage-picture', 'table');
        await expect(pane).not.toContainText(FAILED_WORDS);
        await expect(pane.locator('.stage-retry')).toHaveCount(0);
        await page.waitForTimeout(250);
      }

      // 放开：照常摆出来
      release();
      await expectRealTable(page, 'full', READY_MS);
      await expect(pane.locator('.stage-retry')).toHaveCount(0);
      await expect(pane).not.toContainText(FAILED_WORDS);
      expect(uncaught).toEqual([]);
    });
  }
});

// 从人物页的全程沙盘点进一站自己的沙盘（潜进去）：全程沙盘摆着的时候，样式里每一座沙盘都用的那一半早就取到了，
// 这时候要的只有站点沙盘才用的那一小块——它单独去取的只有这一处。上面两组是一打开就在那一页上（两小块一起要）。
test.describe('从全程沙盘潜进一站自己的沙盘：站点沙盘才用的那一小块单独去取', () => {
  /** 打开人物页，等全程沙盘摆好；那一小块的请求从一开始就拦着，照 answer 说的办。返回要过几次、各是怎么办的。 */
  async function openOnRoute(page: Page, id: string, answer: () => 'cut' | 'through' | Promise<void>): Promise<string[]> {
    await page.setViewportSize({ width: 1024, height: 640 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const asked: string[] = [];
    await page.route(stopChunkRequest(id), async (routed) => {
      const how = answer();
      if (how === 'cut') {
        asked.push('cut');
        return routed.abort();
      }
      if (how === 'through') {
        asked.push('through');
        return routed.continue();
      }
      asked.push('held');
      await how;
      return routed.continue();
    });
    await page.goto(realUrl(`#/${FIGURE}`, 'full'));
    await needWebGL2(page);
    await expectRealTable(page, 'full', READY_MS);
    await expect(stagePane(page)).toHaveAttribute('data-stage-level', 'route');
    return asked;
  }

  test('那一小块没取到：到了这一站的页面，沙盘栏说立体的沙盘没能摆出来，带“再试一次”；点“再试一次”真的再取一遍，这一站自己的沙盘摆出来了', async ({ page }) => {
    test.setTimeout(300_000);
    const id = STOP?.scene.style ?? null;
    test.skip(FIGURE === null || ROUTE === null || STOP === null || id === null, 'content/ 里没有既有全程沙盘、又有一站有自己的沙盘的人物');
    const uncaught: string[] = [];
    page.on('pageerror', (error) => uncaught.push(String(error)));
    let cut = true;
    const asked = await openOnRoute(page, id as string, () => (cut ? 'cut' : 'through'));
    // 全程沙盘摆好了：站点沙盘才用的那一小块一次也没有要过（全程沙盘只取那一半）
    expect(asked).toEqual([]);

    await page.locator(`.stop-item[data-stop-id="${STOP!.stopId}"]`).click();
    await expect(page.locator('.stop-page')).toHaveAttribute('data-stop-id', STOP!.stopId, { timeout: READY_MS });
    const pane = stagePane(page);
    await expect(pane).toHaveAttribute('data-stage-state', 'failed', { timeout: READY_MS });
    await expect(pane).toContainText(FAILED_WORDS);
    const retry = pane.locator('.stage-retry');
    await expect(retry).toHaveText('再试一次');
    await expect(pane).not.toHaveAttribute('data-stage-picture', 'table');
    await expect(page.locator('.page-title')).toBeVisible();
    expect(asked.length).toBeGreaterThanOrEqual(1);
    expect(asked).not.toContain('through');
    const before = asked.length;

    // 网通了。再试一次：真的再去取一遍，这一回取到了，摆出来的是这一站自己的沙盘
    cut = false;
    await retry.click();
    await expectRealTable(page, 'full', READY_MS);
    await expect(pane).not.toHaveAttribute('data-stage-level', 'route');
    expect(asked.slice(before)).toContain('through');
    expect(asked.slice(before)).not.toContain('cut');
    await expect(pane.locator('.stage-retry')).toHaveCount(0);
    await expect(pane).not.toContainText(FAILED_WORDS);
    expect(uncaught).toEqual([]);
  });

  test('那一小块取得慢：压着的时候是等着的样子，不说“没能……”，没有“再试一次”；放开以后这一站自己的沙盘照常摆出来', async ({ page }) => {
    test.setTimeout(300_000);
    const id = STOP?.scene.style ?? null;
    test.skip(FIGURE === null || ROUTE === null || STOP === null || id === null, 'content/ 里没有既有全程沙盘、又有一站有自己的沙盘的人物');
    const uncaught: string[] = [];
    page.on('pageerror', (error) => uncaught.push(String(error)));
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => (release = resolve));
    const asked = await openOnRoute(page, id as string, () => held);
    expect(asked).toEqual([]);

    await page.locator(`.stop-item[data-stop-id="${STOP!.stopId}"]`).click();
    await expect(page.locator('.stop-page')).toHaveAttribute('data-stop-id', STOP!.stopId, { timeout: READY_MS });
    const pane = stagePane(page);
    // 等到那一小块真的被要过了，再看四秒：这一段里沙盘栏一直是等着的样子（这一站自己的沙盘还没有摆出来，也没有说摆不出来）
    await expect.poll(() => asked.length, { timeout: READY_MS }).toBeGreaterThanOrEqual(1);
    const until = Date.now() + 4000;
    while (Date.now() < until) {
      await expect(pane).not.toHaveAttribute('data-stage-state', 'failed');
      await expect(pane).not.toHaveAttribute('data-stage-picture', 'table');
      await expect(pane).not.toContainText(FAILED_WORDS);
      await expect(pane.locator('.stage-retry')).toHaveCount(0);
      await page.waitForTimeout(250);
    }

    // 放开：这一站自己的沙盘照常摆出来
    release();
    await expectRealTable(page, 'full', READY_MS);
    await expect(pane).not.toHaveAttribute('data-stage-level', 'route');
    await expect(pane.locator('.stage-retry')).toHaveCount(0);
    await expect(pane).not.toContainText(FAILED_WORDS);
    expect(uncaught).toEqual([]);
  });
});
