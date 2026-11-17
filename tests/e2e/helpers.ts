// 端到端测试共用的小工具。测试只看结构和行为，不看正文的字句（内容还在改）。

import { expect } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';

/** 带地图替身的地址。 */
export function fakeUrl(hash: string): string {
  return `/?map=fake${hash}`;
}

export function mapPane(page: Page): Locator {
  return page.locator('.map-pane');
}

/** 等地图就绪，并且镜头停在指定的那一站（空字符串为全程）。 */
export async function expectMapAt(page: Page, stopId: string): Promise<void> {
  await expect(mapPane(page)).toHaveAttribute('data-map-state', 'ready');
  await expect(mapPane(page)).toHaveAttribute('data-map-stop', stopId);
}

/** 从首页进入第一位可以打开的人物，返回他的 id。 */
export async function openFirstFigure(page: Page): Promise<string> {
  await page.goto(fakeUrl('#/'));
  const card = page.locator('a.card[data-available="true"]').first();
  await expect(card).toBeVisible();
  const figureId = await card.getAttribute('data-figure-id');
  if (!figureId) throw new Error('人物卡片上没有 id');
  await card.click();
  await expect(page).toHaveURL(new RegExp(`#/${figureId}$`));
  // 等目录出来，后面数目录项时才数得准。
  await expect(page.locator('.stop-item').first()).toBeVisible();
  return figureId;
}

/** 目录里第一个已经写好的站的 id。 */
export async function firstWrittenStop(page: Page): Promise<string> {
  const item = page.locator('.stop-item[data-stop-status="complete"]').first();
  await expect(item).toBeVisible();
  const stopId = await item.getAttribute('data-stop-id');
  if (!stopId) throw new Error('目录项上没有站的 id');
  return stopId;
}
