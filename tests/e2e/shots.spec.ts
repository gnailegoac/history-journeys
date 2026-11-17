// 给界面拍几张照，存到 tests/shots/ui/，供人看。平时不跑：设环境变量 UI_SHOTS=1 才跑。
// 用的是地图替身，照片里的地图栏不是真的地图。

import { expect, test } from '@playwright/test';
import { expectMapAt, fakeUrl, firstWrittenStop, openFirstFigure } from './helpers';

const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
const DIR = 'tests/shots/ui';

test.skip(!env.UI_SHOTS, '只在 UI_SHOTS=1 时拍照');

test('宽屏：首页、人物页、站点页、点开小注', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(fakeUrl('#/'));
  await expect(page.locator('.card').first()).toBeVisible();
  await page.screenshot({ path: `${DIR}/home-1440.png` });

  const figureId = await openFirstFigure(page);
  await expectMapAt(page, '');
  await page.screenshot({ path: `${DIR}/figure-1440.png` });

  const stopId = await firstWrittenStop(page);
  await page.goto(fakeUrl(`#/${figureId}/${stopId}`));
  await expectMapAt(page, stopId);
  await expect(page.locator('.text-section').first()).toBeVisible();
  await page.screenshot({ path: `${DIR}/stop-1440.png` });

  await page.locator('.note-term').first().click();
  await expect(page.locator('.note').first()).toBeVisible();
  await page.screenshot({ path: `${DIR}/stop-note-open-1440.png` });
});

test('平板竖放和手机：站点页、讲解员面板', async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 1024 });
  const figureId = await openFirstFigure(page);
  const stopId = await firstWrittenStop(page);
  await page.goto(fakeUrl(`#/${figureId}/${stopId}`));
  await expectMapAt(page, stopId);
  await expect(page.locator('.text-section').first()).toBeVisible();
  await page.screenshot({ path: `${DIR}/stop-768x1024.png` });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: `${DIR}/stop-390x844.png` });

  await page.getByRole('button', { name: '问讲解员' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.screenshot({ path: `${DIR}/guide-390x844.png` });
});
