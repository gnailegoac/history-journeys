// 用真地图给几个页面拍照，存到 tests/shots/real/，供人看。平时不跑：设环境变量 REAL_SHOTS=1 才跑。
// 没有显卡的机器上地图很慢，所以每一步都等得久。

import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
const DIR = 'tests/shots/real';

test.skip(!env.REAL_SHOTS, '只在 REAL_SHOTS=1 时拍照');

async function openAt(page: Page, hash: string, stopId: string): Promise<void> {
  await page.goto(`/${hash}`);
  const pane = page.locator('.map-pane');
  await expect(pane).toHaveAttribute('data-map-state', 'ready', { timeout: 150_000 });
  await expect(pane).toHaveAttribute('data-map-stop', stopId, { timeout: 150_000 });
  // 再留一点时间，让近处的地形和水系画完。
  await page.waitForTimeout(6_000);
}

test('宽屏 1440×900：人物页、黄州、点开小注、徐州', async ({ page }) => {
  test.setTimeout(600_000);
  await page.setViewportSize({ width: 1440, height: 900 });

  await openAt(page, '#/su-shi', '');
  await page.screenshot({ path: `${DIR}/figure-1440.png` });

  await openAt(page, '#/su-shi/huangzhou', 'huangzhou');
  await page.screenshot({ path: `${DIR}/huangzhou-1440.png` });
  await page.locator('.note-term').first().click();
  await expect(page.locator('.note').first()).toBeVisible();
  await page.screenshot({ path: `${DIR}/huangzhou-note-1440.png` });

  await openAt(page, '#/su-shi/xuzhou', 'xuzhou');
  await page.screenshot({ path: `${DIR}/xuzhou-1440.png` });
});

test('平板横放 1024×768、平板竖放 768×1024', async ({ page }) => {
  test.setTimeout(600_000);
  await page.setViewportSize({ width: 1024, height: 768 });
  await openAt(page, '#/su-shi/xuzhou', 'xuzhou');
  await page.screenshot({ path: `${DIR}/xuzhou-1024x768.png` });

  await page.setViewportSize({ width: 768, height: 1024 });
  await openAt(page, '#/su-shi/huangzhou', 'huangzhou');
  await page.screenshot({ path: `${DIR}/huangzhou-768x1024.png` });
});

test('手机 390×844：人物页、黄州', async ({ page }) => {
  test.setTimeout(600_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await openAt(page, '#/su-shi', '');
  await page.screenshot({ path: `${DIR}/figure-390x844.png` });

  await openAt(page, '#/su-shi/huangzhou', 'huangzhou');
  await page.screenshot({ path: `${DIR}/huangzhou-390x844.png` });
});
