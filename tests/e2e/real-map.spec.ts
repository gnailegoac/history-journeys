// 真地图的冒烟测试：不带 ?map=fake，等地图栏报告就绪。
// 浏览器没有 WebGL2 时跳过。这台开发机没有显卡，地图很慢，所以等得久。

import { expect, test } from '@playwright/test';

test('真地图：人物页上地图能起来，再进一站镜头能到', async ({ page }) => {
  test.setTimeout(240_000);
  // 发布流程里的机器用软件渲染三维地图，画面越大越慢。这里只看地图能不能起来，用小一点的窗口（仍是宽屏版面）。
  await page.setViewportSize({ width: 1024, height: 640 });

  await page.goto('/#/');
  const hasWebGL2 = await page.evaluate(() => {
    try {
      return document.createElement('canvas').getContext('webgl2') !== null;
    } catch {
      return false;
    }
  });
  test.skip(!hasWebGL2, '这个浏览器没有 WebGL2');

  const card = page.locator('a.card[data-available="true"]').first();
  await card.click();
  const pane = page.locator('.map-pane');
  // 先等它有个结果（就绪或失败），失败时不用白等。
  await expect(pane).not.toHaveAttribute('data-map-state', 'loading', { timeout: 120_000 });
  await expect(pane).toHaveAttribute('data-map-state', 'ready', { timeout: 1_000 });
  await expect(pane).toHaveAttribute('data-map-stop', '', { timeout: 60_000 });
  await expect(pane.locator('canvas').first()).toBeVisible();

  // 进第一站：镜头到了以后，地图栏上写着这一站。
  const item = page.locator('.stop-item').first();
  const stopId = await item.getAttribute('data-stop-id');
  await item.click();
  await expect(pane).toHaveAttribute('data-map-state', 'ready');
  await expect(pane).toHaveAttribute('data-map-stop', stopId ?? '', { timeout: 90_000 });
});
