// 给页面的几种状态各拍一张照，用真的沙盘，供人看（不进仓库）：看的是字和版面，不是沙盘。
// real-shots.spec.ts 拍的是人物页和每一小节；这里拍它没拍到的：
//   home-<宽>x<高>.png               首页（绢上的全程图片取到了再拍）
//   sources-…、sources-full-…、sources-foot-…  “来源”页：第一屏；整页，从头到尾一张长图；滚到最下面
//   figure-list-…                   人物页的各站目录（在第一屏下面，滚到它拍）
//   figure-foot-…                   人物页滚到最下面：目录后面通到“来源”页的链接
//   stop-foot-…                     有沙盘的一站滚到最下面：正文末尾的“回到各站目录”和“来源”
//   state-note-…                    点开一条小注（小注不在第一屏里的窗口上，先把带着那个词的一段滚到看得见的地方）
//   state-original-…                点开一篇原文
//   state-provenance-…              点开凭据（里面的东西是点开才取的，等它到了再拍）
//   state-register-…                凭据里“沙盘上的东西”一栏
//   state-guide-…                   讲解员面板开着（也等里面的东西到了再拍）
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
import { expectRealTable, firstWrittenStopWithoutScene, foldBodiesReady, openFigureWithTable, realUrl, shoot, stagePane } from './helpers';

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

  // 首页（绢上的全程图片取到了再拍）
  await page.goto(url('#/'));
  await expect(page.locator('.card').first()).toBeVisible();
  // 绢上的全程沙盘摆好了再拍（只放图片的那一种：等图片显出来）
  await paneSettled();
  await snap('home');

  // “来源”页：从首页卡片后面的链接点进去。里面的东西是点进去才取的，两栏还要读内容：都到了再拍
  await page.locator('.home .stop-nav a').evaluate((link: HTMLElement) => link.click());
  await expect(page.locator('.sources-list li').first()).toBeVisible();
  await expect(page.locator('.sources .quiet')).toHaveCount(0);
  await snap('sources');
  await shoot(page, { path: `${DIR}/sources-full-${tag}.png`, fullPage: true });
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await snap('sources-foot');

  const { figureId, found } = await openFigureWithTable(page, url('#/'));
  // 人物页的各站目录：在第一屏下面，滚到“各站目录”那个标题拍
  await paneSettled();
  await page.getByRole('heading', { name: '各站目录' }).evaluate((heading) => heading.scrollIntoView({ block: 'start' }));
  // 鼠标挪到角上：不然它正好停在哪一站上，那一站的名字就是“鼠标移上去”的红色
  await page.mouse.move(1, 1);
  await snap('figure-list');
  // 目录后面通到“来源”页的链接：滚到页面最下面拍
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await snap('figure-foot');
  await page.evaluate(() => window.scrollTo(0, 0));
  const noTable = await firstWrittenStopWithoutScene(page, figureId);
  const notWritten = await page.locator('.stop-item[data-stop-status="outline"]').first().getAttribute('data-stop-id').catch(() => null);

  if (found) {
    await page.locator(`.stop-item[data-stop-id="${found.stopId}"]`).click();
    await expect(page.locator('.text-section').first()).toBeVisible();
    await paneSettled();

    // 点开第一条小注（在页面里直接点：不让测试工具把页面滚动）
    await page.locator('.note-term').first().evaluate((term: HTMLElement) => term.click());
    await expect(page.locator('.note').first()).toBeVisible();
    // 小注要是不全在看得见正文的那一块里（竖着拿的平板上，它在钉着的沙盘下面、第一屏以外）：把带着那个词的一段滚到那一块的上边
    await page.locator('.note').first().evaluate((note) => {
      const pane = document.querySelector('.stage-pane');
      const bar = document.querySelector('.guide-dock');
      const paneBox = pane?.getBoundingClientRect();
      const box = note.getBoundingClientRect();
      const top = pane && paneBox && getComputedStyle(pane).position === 'sticky' && paneBox.left < box.right && paneBox.right > box.left ? paneBox.bottom : 0;
      const bottom = bar ? bar.getBoundingClientRect().top : window.innerHeight;
      if (box.top < top || box.bottom > bottom) (note.previousElementSibling ?? note).scrollIntoView({ block: 'start' });
    });
    await paneSettled();
    await snap('state-note');
    await page.locator('.note-term').first().evaluate((term: HTMLElement) => term.click());
    await page.evaluate(() => window.scrollTo(0, 0));

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
    await foldBodiesReady(page);
    await expect(page.locator('.provenance-item').first()).toBeAttached();
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
    await foldBodiesReady(page);
    await expect(page.locator('.guide-panel .guide-form')).toBeVisible();
    await paneSettled();
    await snap('state-guide');
    await page.keyboard.press('Escape');

    // 正文的末尾：“回到各站目录”和“来源”（滚到页面最下面；沙盘跟到最后一节，等它停下来）
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await paneSettled();
    await snap('stop-foot');
  }

  // 写好了正文、还没有沙盘的一站
  if (noTable) {
    await page.goto('about:blank');
    await page.goto(url(`#/${figureId}/${noTable}`));
    await expect(page.locator('.text-section').first()).toBeVisible();
    await paneSettled();
    await snap('state-no-table');
  }

  // 还没写的一站
  if (notWritten) {
    await page.goto('about:blank');
    await page.goto(url(`#/${figureId}/${notWritten}`));
    await expect(page.locator('.not-written')).toBeVisible();
    await paneSettled();
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
