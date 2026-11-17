// 主流程：首页 → 人物页 → 一站 → 小注、原文、凭据 → 下一站、上一站 → 讲解员。
// 用地图替身（?map=fake）。只看结构和行为，不看正文的字句。

import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { expectMapAt, fakeUrl, firstWrittenStop, mapPane, openFirstFigure } from './helpers';

const KINDS = /^(历史|地理|人文|科学)$/;
const BASES = /^(他本人的话|史书和当时人的记载|后人的记载|编写时补的)$/;

/** 从首页一路点进第一个写好的站。 */
async function openWrittenStop(page: Page): Promise<{ figureId: string; stopId: string }> {
  const figureId = await openFirstFigure(page);
  const stopId = await firstWrittenStop(page);
  await page.locator(`.stop-item[data-stop-id="${stopId}"]`).click();
  await expect(page).toHaveURL(new RegExp(`#/${figureId}/${stopId}$`));
  await expect(page.locator('.stop-page')).toHaveAttribute('data-stop-text', 'written');
  return { figureId, stopId };
}

test('首页：标题、一句话、人物卡片；没写好的人物不是链接', async ({ page }) => {
  await page.goto(fakeUrl('#/'));
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.locator('.home-line')).not.toBeEmpty();
  expect(await page.title()).toBe(await page.getByRole('heading', { level: 1 }).innerText());

  const cards = page.locator('.cards .card');
  await expect(cards.first()).toBeVisible();
  for (const card of await cards.all()) {
    await expect(card.locator('.card-name')).not.toBeEmpty();
    await expect(card.locator('.card-era')).not.toBeEmpty();
    await expect(card.locator('.card-tagline')).not.toBeEmpty();
  }

  await expect(page.locator('a.card[data-available="true"]').first()).toBeVisible();
  for (const card of await page.locator('.card[data-available="false"]').all()) {
    expect(await card.evaluate((el) => el.tagName)).not.toBe('A');
    await expect(card.locator('a')).toHaveCount(0);
    await expect(card.locator('.tag')).toHaveText('还没写');
  }

  // 首页没有地图。
  await expect(mapPane(page)).toHaveCount(0);
});

test('首页 → 人物页 → 一站：小注、原文、凭据、下一站和上一站、讲解员', async ({ page }) => {
  // ---- 人物页
  const figureId = await openFirstFigure(page);
  const title = page.getByRole('heading', { level: 1 });
  await expect(title).toBeVisible();
  await expect(title).toBeFocused();
  expect(await page.title()).toContain(await title.innerText());
  await expect(page.locator('.figure-intro p').first()).toBeVisible();
  await expectMapAt(page, '');

  const items = page.locator('.stop-item');
  const stopCount = await items.count();
  expect(stopCount).toBeGreaterThan(1);
  await expect(page.locator('.fake-map-dot')).toHaveCount(stopCount);
  for (const item of await items.all()) {
    await expect(item.locator('.stop-title')).not.toBeEmpty();
    await expect(item.locator('.stop-meta')).not.toBeEmpty();
    const written = (await item.getAttribute('data-stop-status')) === 'complete';
    await expect(item.locator('.tag')).toHaveCount(written ? 0 : 1);
  }

  // 给地图做个记号：后面换页时应该还是同一张。
  await page.evaluate(() => {
    (document.querySelector('.fake-map') as HTMLElement).dataset.mark = 'same';
  });

  // ---- 从目录进一站
  const stopId = await firstWrittenStop(page);
  await page.locator(`.stop-item[data-stop-id="${stopId}"]`).click();
  await expect(page).toHaveURL(new RegExp(`#/${figureId}/${stopId}$`));
  await expect(page.locator('.stop-page')).toHaveAttribute('data-stop-text', 'written');
  await expectMapAt(page, stopId);
  await expect(page.locator('.fake-map')).toHaveAttribute('data-mark', 'same');
  await expect(page.locator('.fake-map-dot[aria-current="true"]')).toHaveAttribute('data-stop-id', stopId);

  await expect(title).toBeFocused();
  expect(await page.title()).toContain(await title.innerText());
  await expect(page.locator('.facts > div')).toHaveCount(3);
  // 抬头和正文之间有两句说明：正文是改写的，带虚线的词可以点开。
  const about = page.locator('.page-head + .text-about');
  await expect(about.locator('p')).toHaveCount(2);
  await expect(about.locator('p').first()).toContainText('改写');
  await expect(about.locator('p').last()).toBeVisible();
  await expect(page.locator('.text-about + .stop-text')).toHaveCount(1);
  const sections = page.locator('.text-section');
  expect(await sections.count()).toBeGreaterThan(0);
  for (const section of await sections.all()) {
    await expect(section.getByRole('heading', { level: 2 })).toBeVisible();
  }

  // ---- 小注：就地点开，再点一下或点“关闭”收起
  const term = page.locator('.note-term').first();
  const noteId = await term.getAttribute('data-note-id');
  const note = page.locator(`.note[data-note-id="${noteId}"]`);
  await expect(term).toHaveAttribute('aria-expanded', 'false');
  await term.click();
  await expect(note).toBeVisible();
  await expect(term).toHaveAttribute('aria-expanded', 'true');
  await expect(note.locator('.note-kind')).toHaveText(KINDS);
  await expect(note.locator('.note-title')).not.toBeEmpty();
  await expect(note.locator('p').first()).not.toBeEmpty();
  // 小注的最后一行是出处。
  await expect(note.locator('p').last()).toHaveClass('note-sources');
  await expect(note.locator('.note-sources')).toHaveText(/^出处：.+/);
  // 紧跟在它那一段下面，不是弹出来的。
  const rightUnderParagraph = await term.evaluate((el) => {
    let next = el.closest('p')?.nextElementSibling;
    while (next && next.classList.contains('note')) {
      if (next.getAttribute('data-note-id') === el.getAttribute('data-note-id')) return true;
      next = next.nextElementSibling;
    }
    return false;
  });
  expect(rightUnderParagraph).toBe(true);
  expect(await note.evaluate((el) => getComputedStyle(el).position)).toBe('static');

  await note.getByRole('button', { name: /关闭/ }).click();
  await expect(note).toHaveCount(0);
  await expect(term).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(note).toBeVisible();
  await term.click();
  await expect(note).toHaveCount(0);

  // ---- 原文（这一站有才测）
  const originals = page.locator('details.original');
  if ((await originals.count()) > 0) {
    const original = originals.first();
    await expect(original.locator('summary')).toContainText('读原文：');
    await expect(original.locator('.original-text')).toBeHidden();
    await original.locator('summary').click();
    await expect(original.locator('.original-date')).toBeVisible();
    await expect(original.locator('.original-text')).toBeVisible();
    await expect(original.locator('.original-plain').first()).toBeVisible();
    expect(await original.locator('.original-text').evaluate((el) => getComputedStyle(el).whiteSpace)).toBe('pre-line');
  }

  // ---- 图片（这一站有才测）
  for (const figure of await page.locator('.stop-image').all()) {
    await expect(figure.locator('img')).toHaveAttribute('alt', /.+/);
    await expect(figure.locator('.stop-image-caption')).not.toBeEmpty();
    await expect(figure.locator('.stop-image-credit')).not.toBeEmpty();
  }

  // ---- 凭据：默认折起
  const provenance = page.locator('details.provenance');
  await expect(provenance.locator('.provenance-body')).toBeHidden();
  await provenance.locator('summary').click();
  const provenanceItems = provenance.locator('.provenance-item');
  await expect(provenanceItems.first()).toBeVisible();
  expect(await provenance.locator('.provenance-group').count()).toBeGreaterThan(0);
  for (const item of await provenanceItems.all()) {
    await expect(item.locator('.tag')).toHaveText(BASES);
  }

  // ---- 下一站、上一站（这一站在头或在尾时，只有一个方向）
  const next = page.locator('.stop-nav-link.is-next');
  const prev = page.locator('.stop-nav-link.is-prev');
  const forward = (await next.count()) > 0;
  const there = forward ? next : prev;
  const back = forward ? prev : next;
  const otherId = (await there.getAttribute('href'))!.split('/').pop()!;
  expect(otherId).not.toBe(stopId);
  await there.click();
  await expect(page).toHaveURL(new RegExp(`#/${figureId}/${otherId}$`));
  await expect(page.locator('.stop-page')).toHaveAttribute('data-stop-id', otherId);
  await expectMapAt(page, otherId);
  await expect(page.locator('.fake-map')).toHaveAttribute('data-mark', 'same');
  expect(await page.evaluate(() => window.scrollY)).toBe(0);

  await back.click();
  await expect(page).toHaveURL(new RegExp(`#/${figureId}/${stopId}$`));
  await expectMapAt(page, stopId);

  // ---- 回到目录
  await page.locator('.stop-nav-list').click();
  await expect(page).toHaveURL(new RegExp(`#/${figureId}$`));
  await expectMapAt(page, '');
  await expect(page.locator('.fake-map')).toHaveAttribute('data-mark', 'same');
  await page.goBack();
  await expect(page.locator('.stop-page')).toHaveAttribute('data-stop-text', 'written');

  // ---- 讲解员：界面在，不能提问；标题下面第一句就说明现在还不能回答
  const opener = page.getByRole('button', { name: '问讲解员' });
  await opener.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('heading', { name: '问讲解员' })).toBeVisible();
  const notYet = dialog.locator('.guide-head + p');
  await expect(notYet).toHaveText('讲解员现在还不能回答问题。下面是以后可以问的问题的样子。');
  expect(await notYet.evaluate((el) => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(16);
  await expect(dialog).not.toContainText('答疑功能还没有接入');
  await expect(dialog.getByRole('textbox')).toBeDisabled();
  await expect(dialog.getByRole('button', { name: '发送' })).toBeDisabled();
  // 示例问题只是几行字：没有框，里面没有能点、能走到的东西。
  const samples = dialog.locator('.guide-samples li');
  if ((await samples.count()) > 0) {
    await expect(samples.first()).not.toBeEmpty();
    expect(await samples.first().evaluate((el) => getComputedStyle(el).borderTopWidth)).toBe('0px');
    await expect(dialog.locator('.guide-samples').locator('button, a, [tabindex], [role="button"]')).toHaveCount(0);
  }
  await dialog.getByRole('button', { name: '关闭' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();
});

test('地图栏：点地图上的站、古名今名、回到这一站、宽屏的版面', async ({ page }) => {
  const figureId = await openFirstFigure(page);
  await expectMapAt(page, '');
  const fake = page.locator('.fake-map');
  const reset = page.locator('.map-reset');

  // 宽屏：文字栏 440 到 500px，地图占满旁边，文字滚动时地图不动。
  const viewport = page.viewportSize()!;
  const paneBox = (await mapPane(page).boundingBox())!;
  expect(paneBox.x).toBeGreaterThanOrEqual(440);
  expect(paneBox.x).toBeLessThanOrEqual(500);
  expect(paneBox.x + paneBox.width).toBeCloseTo(viewport.width, 0);
  expect(paneBox.height).toBeCloseTo(viewport.height, 0);
  await page.evaluate(() => window.scrollTo(0, 600));
  expect((await mapPane(page).boundingBox())!.y).toBeCloseTo(0, 0);
  await expect(page.locator('.map-fold')).toBeHidden();
  await expect(page.locator('.map-notice')).not.toBeEmpty();

  // 人物页上是“回到全程”，没动过镜头时点不了。
  await expect(reset).toHaveText('回到全程');
  await expect(reset).toBeDisabled();

  // 古名、今名。
  await expect(fake).toHaveAttribute('data-fake-names', 'ancient');
  await page.getByRole('button', { name: '今名' }).click();
  await expect(fake).toHaveAttribute('data-fake-names', 'modern');
  await expect(page.getByRole('button', { name: '今名' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: '古名' })).toHaveAttribute('aria-pressed', 'false');

  // 点地图上的一站，打开那一站的页面。
  const dot = page.locator('.fake-map-dot').first();
  const stopId = (await dot.getAttribute('data-stop-id'))!;
  await dot.click();
  await expect(page).toHaveURL(new RegExp(`#/${figureId}/${stopId}$`));
  await expectMapAt(page, stopId);
  await expect(fake).toHaveAttribute('data-fake-animated', 'true');
  await expect(fake).toHaveAttribute('data-fake-names', 'modern');

  // 站点页上是“回到这一站”：动过镜头才点得了，点了之后又点不了。
  await expect(reset).toHaveText('回到这一站');
  await expect(reset).toBeDisabled();
  await page.locator('.fake-map-nudge').click();
  await expect(reset).toBeEnabled();
  await reset.click();
  await expect(reset).toBeDisabled();
  await expectMapAt(page, stopId);

  // 直接打开一站：第一次摆放不飞。
  await page.goto('about:blank');
  await page.goto(fakeUrl(`#/${figureId}/${stopId}`));
  await expectMapAt(page, stopId);
  await expect(fake).toHaveAttribute('data-fake-animated', 'false');
  expect(await page.evaluate(() => document.activeElement === document.body)).toBe(true);

  // 按钮够大，正文字号够大。
  for (const button of await page.locator('.map-controls button:visible').all()) {
    expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  }
});

test('还没写的站：有抬头和一句话，地图照样过去', async ({ page }) => {
  const figureId = await openFirstFigure(page);
  const outline = page.locator('.stop-item[data-stop-status="outline"]').first();
  test.skip((await outline.count()) === 0, '各站都写好了');
  const stopId = (await outline.getAttribute('data-stop-id'))!;
  await outline.click();
  await expect(page).toHaveURL(new RegExp(`#/${figureId}/${stopId}$`));

  await expect(page.locator('.stop-page')).toHaveAttribute('data-stop-text', 'none');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.locator('.facts > div')).toHaveCount(3);
  await expect(page.locator('.not-written')).toBeVisible();
  await expect(page.locator('.text-section')).toHaveCount(0);
  await expect(page.locator('.text-about')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '问讲解员' })).toHaveCount(0);
  await expect(page.locator('.stop-nav-list')).toBeVisible();
  await expectMapAt(page, stopId);
});

test('地图起不来：只留一句话，照常阅读', async ({ page }) => {
  const { figureId, stopId } = await openWrittenStop(page);
  await page.goto('about:blank');
  const warnings: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'warning') warnings.push(message.text());
  });
  await page.goto(`/?map=fake-fail#/${figureId}/${stopId}`);

  await expect(mapPane(page)).toHaveAttribute('data-map-state', 'failed');
  // 镜头一次都没到过，所以没有“到了哪一站”；原因写在控制台里。
  await expect(mapPane(page)).not.toHaveAttribute('data-map-stop');
  expect(warnings.some((text) => text.includes('[地图]') && text.includes('按要求起不来'))).toBe(true);
  await expect(mapPane(page).locator('.map-message')).toBeVisible();
  await expect(page.locator('.map-controls')).toHaveCount(0);

  await expect(page.locator('.text-section').first()).toBeVisible();
  const term = page.locator('.note-term').first();
  await term.click();
  await expect(page.locator('.note').first()).toBeVisible();
  await page.locator('.stop-nav-list').click();
  await expect(page.locator('.stop-item').first()).toBeVisible();
});

test.describe('手机（390×844）', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('窄屏：地图在上不动，文字在下面滚，地图能收起和展开', async ({ page }) => {
    const { stopId } = await openWrittenStop(page);
    await expectMapAt(page, stopId);
    const pane = mapPane(page);
    const fold = page.locator('.map-fold');
    const fake = page.locator('.fake-map');

    // 地图在最上面，约占屏幕高度的四成；文字在它下面。
    const open = (await pane.boundingBox())!;
    expect(open.y).toBeCloseTo(0, 0);
    expect(open.width).toBeCloseTo(390, 0);
    expect(open.height).toBeGreaterThan(844 * 0.38);
    expect(open.height).toBeLessThan(844 * 0.42);
    const reading = (await page.locator('.reading').boundingBox())!;
    expect(reading.y).toBeGreaterThanOrEqual(open.y + open.height - 1);

    // 文字滚动，地图留在原处。
    await page.evaluate(() => window.scrollTo(0, 900));
    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(800);
    expect((await pane.boundingBox())!.y).toBeCloseTo(0, 0);

    // 收起、展开，之后都告诉了地图。
    await expect(fold).toHaveText('收起地图');
    await expect(fold).toHaveAttribute('aria-expanded', 'true');
    const resizesBefore = Number(await fake.getAttribute('data-fake-resizes'));
    await fold.click();
    await expect(fold).toHaveText('展开地图');
    await expect(fold).toHaveAttribute('aria-expanded', 'false');
    const folded = (await pane.boundingBox())!;
    expect(folded.height).toBeLessThan(open.height / 2);
    expect(folded.height).toBeGreaterThan(44);
    expect(Number(await fake.getAttribute('data-fake-resizes'))).toBeGreaterThan(resizesBefore);
    expect((await fake.boundingBox())!.height).toBeCloseTo(folded.height, -1);

    await fold.click();
    await expect(fold).toHaveText('收起地图');
    expect((await pane.boundingBox())!.height).toBeCloseTo(open.height, 0);

    // 字号和按钮大小。
    const fontSize = await page.locator('.stop-text p').first().evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    expect(fontSize).toBeGreaterThanOrEqual(17);
    for (const button of await page.locator('.map-controls button:visible').all()) {
      expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
    expect((await page.getByRole('button', { name: '问讲解员' }).boundingBox())!.height).toBeGreaterThanOrEqual(44);

    // “问讲解员”在贴着底边的一整条里；滚到底，最后一行在这一条上面，没被挡住。
    const dock = (await page.locator('.guide-dock').boundingBox())!;
    expect(dock.width).toBeCloseTo(390, 0);
    expect(dock.y + dock.height).toBeCloseTo(844, 0);
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    const lastLine = (await page.locator('.stop-nav-list').boundingBox())!;
    expect(lastLine.y + lastLine.height).toBeLessThanOrEqual(dock.y);

    // 页面不会左右晃。
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
});

test.describe('系统设置了“减少动态效果”', () => {
  test.use({ contextOptions: { reducedMotion: 'reduce' } });

  test('把这个设置告诉地图', async ({ page }) => {
    await openFirstFigure(page);
    await expectMapAt(page, '');
    await expect(page.locator('.fake-map')).toHaveAttribute('data-fake-reduced-motion', 'true');
  });
});

test('宽屏的正文字号不小于 18px', async ({ page }) => {
  await openWrittenStop(page);
  const fontSize = await page.locator('.stop-text p').first().evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  expect(fontSize).toBeGreaterThanOrEqual(18);
  const lineHeight = await page.locator('.stop-text p').first().evaluate((el) => parseFloat(getComputedStyle(el).lineHeight));
  expect(lineHeight / fontSize).toBeGreaterThan(1.8);
});
