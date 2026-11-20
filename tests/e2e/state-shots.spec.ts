// 给页面的几种状态各拍一张照，用真的沙盘，供人看（不进仓库）：看的是字和版面，不是沙盘。
// real-shots.spec.ts 拍的是人物页和每一小节；这里拍它没拍到的：
//   home-<宽>x<高>.png               首页
//   state-note-…                    点开一条小注
//   state-original-…                点开一篇原文
//   state-provenance-…              点开凭据
//   state-register-…                凭据里“沙盘上的东西”一栏
//   state-guide-…                   讲解员面板开着
//   state-no-table-…                写好了正文、还没有沙盘的一站
//   state-not-written-…             还没写的一站
//   state-no-stop-…、state-no-figure-…  两种“没找到”
// 平时不跑：设环境变量 REAL_SHOTS=1 才跑。拍四种标准的窗口；只拍一种，命令后面加 -g "1440"、-g "横着"、-g "竖着"
// 或 -g "1366"（竖放的大平板，1024 × 1366）。
// SHOTS_DIR 是存到哪个文件夹（不设是 tests/shots/real）；TIER 是哪一档画质（不设是完整的一档；reduced 是减配的一档；
// still 是只放图片的样子）。拍之前都等字体到齐（helpers.ts 的 shoot）。
// 例：REAL_SHOTS=1 SHOTS_DIR=tests/shots/c-a-fonts npx playwright test tests/e2e/state-shots.spec.ts -g "1440"

import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { StageTier } from '../../src/stage/types';
import { expectRealTable, expectStill, firstWrittenStopWithoutScene, openFigureWithTable, realUrl, shoot, stagePane } from './helpers';

const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
const DIR = env.SHOTS_DIR ?? 'tests/shots/real';

test.skip(!env.REAL_SHOTS, '只在 REAL_SHOTS=1 时拍照');

/** 拍什么：立体的沙盘的哪一档，或者只放图片的样子。写了别的字就停下来。 */
function tierToShoot(): StageTier | 'still' {
  const asked = env.TIER;
  if (asked === undefined || asked === '' || asked === 'full') return 'full';
  if (asked === 'reduced') return 'reduced';
  if (asked === 'still') return 'still';
  throw new Error(`环境变量 TIER 只能是 full、reduced 或 still，现在是“${asked}”`);
}

/** 把页面上的一样东西滚到看得见正文的那一块的上边（沙盘钉在顶上时，是沙盘栏的下边：页面自己留着这个空）。 */
async function scrollToTop(page: Page, selector: string): Promise<void> {
  await page.locator(selector).first().evaluate((el) => el.scrollIntoView({ block: 'start' }));
}

async function shootStates(page: Page, size: { width: number; height: number }): Promise<void> {
  const tier = tierToShoot();
  const tag = `${size.width}x${size.height}`;
  const url = (hash: string): string => (tier === 'still' ? realUrl(hash, null, '&tier=still') : realUrl(hash, tier));
  await page.setViewportSize(size);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const pane = stagePane(page);
  /** 沙盘栏定下来了：摆着要的那一档，或者放着图片。 */
  const paneSettled = async (): Promise<void> => {
    if (tier === 'still') await expect(pane).toHaveAttribute('data-stage-picture', 'still', { timeout: 120_000 });
    else await expectRealTable(page, tier, 240_000);
  };
  /** 等页面停稳再拍。 */
  const snap = async (name: string): Promise<void> => {
    await page.waitForTimeout(1_200);
    await shoot(page, { path: `${DIR}/${name}-${tag}.png` });
  };

  // 首页
  await page.goto(url('#/'));
  await expect(page.locator('.card').first()).toBeVisible();
  await snap('home');

  const { figureId, found } = await openFigureWithTable(page, url('#/'));
  const noTable = await firstWrittenStopWithoutScene(page, figureId);
  const notWritten = await page.locator('.stop-item[data-stop-status="outline"]').first().getAttribute('data-stop-id').catch(() => null);

  if (found) {
    await page.locator(`.stop-item[data-stop-id="${found.stopId}"]`).click();
    await expect(page.locator('.text-section').first()).toBeVisible();
    await paneSettled();

    // 点开第一条小注（在页面里直接点：不让测试工具把页面滚动）
    await page.locator('.note-term').first().evaluate((term: HTMLElement) => term.click());
    await expect(page.locator('.note').first()).toBeVisible();
    await paneSettled();
    await snap('state-note');
    await page.locator('.note-term').first().evaluate((term: HTMLElement) => term.click());

    // 点开第一篇原文
    await page.locator('details.original').first().evaluate((fold: HTMLDetailsElement) => {
      fold.open = true;
    });
    await scrollToTop(page, 'details.original');
    await paneSettled();
    await snap('state-original');

    // 点开凭据；再往下到“沙盘上的东西”
    await page.locator('details.provenance').first().evaluate((fold: HTMLDetailsElement) => {
      fold.open = true;
    });
    await scrollToTop(page, 'details.provenance');
    await paneSettled();
    await snap('state-provenance');
    await scrollToTop(page, '.scene-register');
    await paneSettled();
    await snap('state-register');

    // 讲解员面板（回到页面开头再打开）
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.getByRole('button', { name: '问讲解员' }).evaluate((button: HTMLElement) => button.click());
    await expect(page.getByRole('dialog')).toBeVisible();
    await paneSettled();
    await snap('state-guide');
    await page.keyboard.press('Escape');
  }

  // 写好了正文、还没有沙盘的一站
  if (noTable) {
    await page.goto('about:blank');
    await page.goto(url(`#/${figureId}/${noTable}`));
    await expect(page.locator('.text-section').first()).toBeVisible();
    await expectStill(page);
    await snap('state-no-table');
  }

  // 还没写的一站
  if (notWritten) {
    await page.goto('about:blank');
    await page.goto(url(`#/${figureId}/${notWritten}`));
    await expect(page.locator('.not-written')).toBeVisible();
    await expectStill(page);
    await snap('state-not-written');
  }

  // 两种“没找到”
  await page.goto('about:blank');
  await page.goto(url(`#/${figureId}/no-such-stop`));
  await expect(page.locator('.page-title')).toHaveText('没有这一站');
  await snap('state-no-stop');
  await page.goto('about:blank');
  await page.goto(url('#/no-such-figure'));
  await expect(page.locator('.page-title')).toHaveText('没有找到这位人物');
  await snap('state-no-figure');
}

test('宽屏 1440×900：页面的几种状态', async ({ page }) => {
  test.setTimeout(900_000);
  await shootStates(page, { width: 1440, height: 900 });
});

test('横着拿的平板 1024×768：页面的几种状态', async ({ page }) => {
  test.setTimeout(900_000);
  await shootStates(page, { width: 1024, height: 768 });
});

test('竖着拿的平板 768×1024：页面的几种状态', async ({ page }) => {
  test.setTimeout(900_000);
  await shootStates(page, { width: 768, height: 1024 });
});

// 名字里不写“竖着”两个字：-g "竖着" 只挑上面那一种。
test('大平板竖放 1024×1366：页面的几种状态', async ({ page }) => {
  test.setTimeout(900_000);
  await shootStates(page, { width: 1024, height: 1366 });
});
