// 给界面拍几张照，存到 tests/shots/ui/，供人看。平时不跑：设环境变量 UI_SHOTS=1 才跑。
// 用的是沙盘的替身，照片里的沙盘栏不是真的沙盘；最后一组（still-…）连每一小节的图片也是替身。

import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { expectStageAt, expectStill, fakeUrl, firstStopWithScene, firstWrittenStop, headingsOf, openFirstFigure, sceneOnDisk, scrollToSection, shoot, stagePane } from './helpers';
import { PANE_QUERIES, expectPane, stopUrl } from './paneHelpers';

const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
const DIR = 'tests/shots/ui';

test.skip(!env.UI_SHOTS, '只在 UI_SHOTS=1 时拍照');

/** 打开一站，等沙盘栏定下来：有沙盘的站摆着第一节，没有的放定格图。返回这一站各小节的标题（没有沙盘时是空的）。 */
async function openStop(page: Page, figureId: string, stopId: string): Promise<string[]> {
  await page.goto(fakeUrl(`#/${figureId}/${stopId}`));
  await expect(page.locator('.text-section').first()).toBeVisible();
  const scene = sceneOnDisk(figureId, stopId);
  if (!scene) {
    await expectStill(page);
    return [];
  }
  const headings = headingsOf(scene);
  await expectStageAt(page, headings[0]);
  return headings;
}

test('宽屏：首页、人物页、站点页、读到后面的小节、点开小注', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(fakeUrl('#/'));
  await expect(page.locator('.card').first()).toBeVisible();
  await shoot(page, { path: `${DIR}/home-1440.png` });

  const figureId = await openFirstFigure(page);
  await expectStill(page);
  await shoot(page, { path: `${DIR}/figure-1440.png` });

  const stopId = await firstWrittenStop(page);
  const headings = await openStop(page, figureId, stopId);
  await shoot(page, { path: `${DIR}/stop-1440.png` });

  if (headings.length > 2) {
    await scrollToSection(page, headings[2]);
    await expectStageAt(page, headings[2]);
    await shoot(page, { path: `${DIR}/stop-third-section-1440.png` });
    await page.evaluate(() => window.scrollTo(0, 0));
    await expectStageAt(page, headings[0]);
  }

  await page.locator('.note-term').first().click();
  await expect(page.locator('.note').first()).toBeVisible();
  await shoot(page, { path: `${DIR}/stop-note-open-1440.png` });
});

test('平板竖放：站点页、讲解员面板', async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 1024 });
  const figureId = await openFirstFigure(page);
  const stopId = await firstWrittenStop(page);
  await openStop(page, figureId, stopId);
  await shoot(page, { path: `${DIR}/stop-768x1024.png` });

  await page.getByRole('button', { name: '问讲解员' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await shoot(page, { path: `${DIR}/guide-768x1024.png` });
});

test('沙盘起不来、浏览器画不了时的站点页', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const figureId = await openFirstFigure(page);
  const stopId = await firstWrittenStop(page);
  test.skip(sceneOnDisk(figureId, stopId) === null, '第一个写好的站还没有沙盘');

  await page.goto('about:blank');
  await page.goto(`/?stage=fake-fail#/${figureId}/${stopId}`);
  await expect(page.locator('.stage-pane')).toHaveAttribute('data-stage-state', 'failed');
  await expect(page.locator('.text-section').first()).toBeVisible();
  await shoot(page, { path: `${DIR}/stop-failed-1440.png` });

  await page.goto('about:blank');
  await page.goto(`/?stage=fake-unsupported#/${figureId}/${stopId}`);
  await expect(page.locator('.stage-pane')).toHaveAttribute('data-stage-state', 'unsupported');
  await expect(page.locator('.text-section').first()).toBeVisible();
  await shoot(page, { path: `${DIR}/stop-unsupported-1440.png` });
});

// 立体的沙盘摆不了、放着每一小节的图片时的沙盘栏（设计里那张表的状态 3 到 6），电脑和竖着拿的平板各一套。
// 沙盘和图片都是替身：照片里看的是那一行话、那一排按钮、题记怎么排，不是图片本身。
for (const size of [
  { width: 1440, height: 900 },
  { width: 768, height: 1024 },
]) {
  test(`${size.width}×${size.height}：放着图片时的沙盘栏（画不了、太慢、读者要来的沙盘、只放图片、画面断了、没摆出来）`, async ({ page }) => {
    await page.setViewportSize(size);
    const figureId = await openFirstFigure(page);
    const found = await firstStopWithScene(page, figureId);
    test.skip(found === null, '还没有带沙盘的站');
    const { stopId, scene } = found!;
    const headings = headingsOf(scene);
    const tag = `${size.width}x${size.height}`;
    const pane = stagePane(page);
    const open = async (query: string) => {
      await page.goto('about:blank');
      await page.goto(stopUrl(query, figureId, stopId));
      await expect(page.locator('.text-section').first()).toBeVisible();
    };

    // 状态 3：浏览器画不了。
    await open(PANE_QUERIES.unsupported);
    await expectPane(page, 'unsupported', 'still');
    await shoot(page, { path: `${DIR}/still-3-unsupported-${tag}.png` });

    // 状态 4：太慢。再点“试试立体的沙盘”，是状态 4a（那一行话句尾是“换回图片”）。
    await open(PANE_QUERIES.slow);
    await expectPane(page, 'slow', 'still');
    await shoot(page, { path: `${DIR}/still-4-slow-${tag}.png` });
    await pane.locator('.stage-controls .stage-retry').click();
    await expectPane(page, 'ready', 'table');
    await shoot(page, { path: `${DIR}/still-4a-asked-${tag}.png` });

    // 状态 4c：地址里指定了只放图片。
    await open(PANE_QUERIES.only);
    await expectPane(page, 'slow', 'still');
    await shoot(page, { path: `${DIR}/still-4c-only-${tag}.png` });

    // 状态 5：摆好以后画面断了。
    await open(PANE_QUERIES.ready);
    await expectStageAt(page, headings[0]);
    await expectPane(page, 'ready', 'table');
    await page.evaluate(() => document.querySelector<HTMLElement>('.fake-stage-lose')?.click());
    await expectPane(page, 'lost', 'still');
    await shoot(page, { path: `${DIR}/still-5-lost-${tag}.png` });

    // 状态 6：没摆出来。
    await open(PANE_QUERIES.failed);
    await expectPane(page, 'failed', 'still');
    await shoot(page, { path: `${DIR}/still-6-failed-${tag}.png` });

    // 状态 1：图片垫着、沙盘还在摆（什么话都不说）。
    await open(PANE_QUERIES.stillFirst);
    await expectPane(page, 'loading', 'still');
    await shoot(page, { path: `${DIR}/still-1-loading-${tag}.png` });
  });
}
