// 主流程：首页 → 人物页 → 一站 → 小注、原文、凭据 → 下一站、上一站 → 讲解员；
// 再加沙盘栏的各种情形：定格图、摆着沙盘、起不来、画不了、画面断了、竖着拿的平板（沙盘在上、文字在下的排法）、减少动态效果。
// 用沙盘的替身（?stage=fake）。只看结构和行为，不看正文的字句。
// 用替身时不写 ?sectionstills 就当这座沙盘没有每一小节的图片，所以这里看的都是“没有图片”时的沙盘栏；
// 有图片时的样子在 pane-stills.spec.ts。

import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import type { StopScene } from '../../src/domain/scene';
import { bigEnoughToTry } from '../../src/stage/three/tier';
import { STRIP_NARROW_BELOW_PX } from '../stage/support/stripSizes';
import {
  expectStageAt,
  expectStill,
  fakeRequests,
  fakeStage,
  fakeUrl,
  firstStopWithScene,
  firstWrittenStop,
  firstWrittenStopWithoutScene,
  headingsOf,
  openFirstFigure,
  paneMoments,
  sceneOnDisk,
  scrollThrough,
  scrollToBottom,
  scrollToSection,
  stagePane,
  stripText,
  stripsOf,
  stripsOnStage,
  twoFrames,
  watchPane,
} from './helpers';
import type { PaneMoment } from './helpers';

const KINDS = /^(历史|地理|人文|科学)$/;
const BASES = /^(他本人的话|史书和当时人的记载|后人的记载|编写时补的)$/;
const CLASSES = /^(真的|今天的位置|按正文摆的|示意的|点缀)$/;

const FAILED = '沙盘没能摆出来，正文可以照常读。';
const UNSUPPORTED = '这个浏览器画不出立体的沙盘。换一个新一点的浏览器，或者把手机、平板的系统升级以后再来看。正文可以照常读。';
const LOST = '沙盘的画面断了。';
const NO_ROUTE = '全程沙盘还没接进来。';
const NO_SCENE = '这一站的沙盘还没做好，先看全程。';
const NO_SCENE_ALONE = '这一站的沙盘还没做好。';

/** 从首页一路点进第一个写好的站。 */
async function openWrittenStop(page: Page): Promise<{ figureId: string; stopId: string }> {
  const figureId = await openFirstFigure(page);
  const stopId = await firstWrittenStop(page);
  await page.locator(`.stop-item[data-stop-id="${stopId}"]`).click();
  await expect(page).toHaveURL(new RegExp(`#/${figureId}/${stopId}$`));
  await expect(page.locator('.stop-page')).toHaveAttribute('data-stop-text', 'written');
  return { figureId, stopId };
}

/** 找到第一个有沙盘的站。一个都没有时，这一项测试跳过。 */
async function findStopWithScene(page: Page): Promise<{ figureId: string; stopId: string; scene: StopScene; headings: string[] }> {
  const figureId = await openFirstFigure(page);
  const found = await firstStopWithScene(page, figureId);
  test.skip(found === null, '还没有带沙盘的站');
  const { stopId, scene } = found!;
  return { figureId, stopId, scene, headings: headingsOf(scene) };
}

/** 直接打开一个有沙盘的站（不经过目录），等正文出来。query 是地址里的参数，用它挑哪一种替身。 */
async function openStopWithScene(page: Page, query = '?stage=fake') {
  const found = await findStopWithScene(page);
  await page.goto('about:blank');
  await page.goto(`/${query}#/${found.figureId}/${found.stopId}`);
  await expect(page.locator('.stop-page')).toHaveAttribute('data-stop-text', 'written');
  await expect(page.locator('.stop-page')).toHaveAttribute('data-stop-scene', 'yes');
  return found;
}

/** 一句话是不是整句都看得见：没有被“…”截掉，也没有被框裁掉。 */
async function shownInFull(line: Locator): Promise<boolean> {
  return line.evaluate((el) => el.scrollWidth <= el.clientWidth + 1 && el.scrollHeight <= el.clientHeight + 1);
}

/** 一句话占了几行。 */
async function rowsOf(line: Locator): Promise<number> {
  return line.evaluate((el) => Math.round(el.getBoundingClientRect().height / parseFloat(getComputedStyle(el).lineHeight)));
}

/** 题记那一块有多高；页面告诉沙盘四边各留出多少（上 右 下 左）。换小节前后拿来比。 */
async function captionHeightAndInsets(page: Page): Promise<{ height: number; insets: string }> {
  const box = await stagePane(page).locator('.stage-caption').boundingBox();
  return { height: box!.height, insets: (await fakeStage(page).getAttribute('data-fake-insets')) ?? '' };
}

/** 页面告诉沙盘下边留出多少，是不是正好是题记那一条的高（从它的上边到沙盘栏的下边）。 */
async function expectBottomInsetIsFoot(page: Page): Promise<void> {
  const pane = (await stagePane(page).boundingBox())!;
  const foot = (await stagePane(page).locator('.stage-foot').boundingBox())!;
  await expect.poll(async () => Number(((await fakeStage(page).getAttribute('data-fake-insets')) ?? '').split(' ')[2])).toBe(Math.round(pane.y + pane.height - foot.y));
}

/**
 * 沙盘栏说的“摆着哪一节”和题记，从来没有抢在沙盘前头：每一刻说的，都是替身那时候已经摆到过的小节。
 * （替身到了以后页面要过一小会儿才换字，所以只查“不抢先”，不查“一模一样”。）
 */
function expectNeverAhead(moments: PaneMoment[]): void {
  const reached: (string | null)[] = [];
  for (const moment of moments) {
    reached.push(moment.fake);
    expect(reached).toContain(moment.pane);
    expect(reached).toContain(moment.caption);
  }
}

/**
 * 焦点在沙盘栏上的时候按一下 Tab：到的是栏里的第一个按钮，没有跑到栏外面去。
 * （真沙盘上第一个是“古名”；替身自己在画面里还有几个按钮，排在它前头。）
 */
async function expectOnFirstButtonInPane(page: Page): Promise<void> {
  const where = await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll<HTMLElement>('.stage-pane button'));
    const mine = buttons.filter((button) => !button.closest('.fake-stage'));
    return { at: buttons.indexOf(document.activeElement as HTMLElement), firstOfPage: mine[0]?.textContent ?? '' };
  });
  expect(where.at).toBe(0);
  expect(where.firstOfPage).toBe('古名');
}

/**
 * “说明”按钮看着小（20 像素高），能点的地方有 44 像素高、44 像素宽：往上 16 像素、往下 8 像素、左右各出去一点，
 * 点下去点到的都还是它；再往外一点就不是了。
 */
async function expectNoteButtonTapArea(page: Page): Promise<void> {
  const box = (await stagePane(page).locator('.stage-note-button').boundingBox())!;
  expect(box.height).toBeLessThan(44);
  const hits = await page.evaluate(
    ({ x, y, width, height }) => {
      const at = (px: number, py: number) => document.elementFromPoint(px, py)?.className === 'stage-note-button';
      const midX = x + width / 2;
      const midY = y + height / 2;
      const side = (44 - width) / 2;
      return {
        above: at(midX, y - 14),
        below: at(midX, y + height + 6),
        left: at(x - Math.max(0, side - 2), midY),
        right: at(x + width + Math.max(0, side - 2), midY),
        tooHigh: at(midX, y - 19),
      };
    },
    box,
  );
  expect(hits).toEqual({ above: true, below: true, left: true, right: true, tooHigh: false });
}

/** 进了一站以后，等沙盘栏定下来：有沙盘的站摆着第一节，没有的放定格图。 */
async function expectPaneSettled(page: Page, figureId: string, stopId: string): Promise<void> {
  const scene = sceneOnDisk(figureId, stopId);
  if (scene) await expectStageAt(page, headingsOf(scene)[0]);
  else await expectStill(page);
}

test('首页：标题、一句话、人物卡片；没写好的人物不是链接；旁边的绢上是全程的图片；卡片后面有“来源”', async ({ page }) => {
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

  // 首页旁边的绢上是人物页用的那个沙盘栏，放着全程的图片：没有沙盘的按钮和题记。
  await expect(stagePane(page)).toHaveCount(1);
  await expectStill(page);
  await expect(stagePane(page).locator('.names-switch, .stage-foot, .stage-host')).toHaveCount(0);

  // 卡片后面是通到“来源”页的链接
  await expect(page.locator('.home .stop-nav a')).toHaveText('来源');
  await expect(page.locator('.home .stop-nav a')).toHaveAttribute('href', '#/sources');
});

test('首页 → 人物页 → 一站：小注、原文、凭据、下一站和上一站、讲解员', async ({ page }) => {
  // ---- 人物页
  const figureId = await openFirstFigure(page);
  const title = page.getByRole('heading', { level: 1 });
  await expect(title).toBeVisible();
  await expect(title).toBeFocused();
  expect(await page.title()).toContain(await title.innerText());
  await expect(page.locator('.figure-intro p').first()).toBeVisible();
  await expectStill(page);

  const items = page.locator('.stop-item');
  const stopCount = await items.count();
  expect(stopCount).toBeGreaterThan(1);
  for (const item of await items.all()) {
    await expect(item.locator('.stop-title')).not.toBeEmpty();
    await expect(item.locator('.stop-meta')).not.toBeEmpty();
    const written = (await item.getAttribute('data-stop-status')) === 'complete';
    await expect(item.locator('.tag')).toHaveCount(written ? 0 : 1);
  }

  // ---- 从目录进一站
  const stopId = await firstWrittenStop(page);
  await page.locator(`.stop-item[data-stop-id="${stopId}"]`).click();
  await expect(page).toHaveURL(new RegExp(`#/${figureId}/${stopId}$`));
  await expect(page.locator('.stop-page')).toHaveAttribute('data-stop-text', 'written');
  await expectPaneSettled(page, figureId, stopId);

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
    // 每个小节带着自己的标题，沙盘靠它知道读到了哪。
    await expect(section).toHaveAttribute('data-section', await section.getByRole('heading', { level: 2 }).innerText());
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
    // 那一行是并排的三块：加号（点开是减号）、“读原文”、原文的标题
    await expect(original.locator('summary .fold-label')).toHaveText('读原文');
    await expect(original.locator('summary')).toContainText('读原文');
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

  // ---- 下一站、上一站：在贴着底边的那一条里，不在正文里（这一站在头或在尾时，只有一个方向）
  const bar = page.locator('.guide-dock');
  await expect(bar).toBeVisible();
  const next = bar.locator('a[rel="next"]');
  const prev = bar.locator('a[rel="prev"]');
  await expect(page.locator('.stop-page a[rel="next"], .stop-page a[rel="prev"]')).toHaveCount((await next.count()) + (await prev.count()));
  // 正文末尾并排的两个链接：回到各站目录，来源（上一站、下一站不在这里了）
  await expect(page.locator('.stop-nav a')).toHaveText(['回到各站目录', '来源']);
  for (const link of [next, prev]) {
    if ((await link.count()) === 0) continue;
    // 一格里上下两行：“上一站”或者“下一站”，和那一站的短名字
    await expect(link.locator('.walk-label')).toHaveText((await link.getAttribute('rel')) === 'next' ? '下一站' : '上一站');
    await expect(link.locator('.walk-name')).not.toBeEmpty();
  }
  const forward = (await next.count()) > 0;
  const there = forward ? next : prev;
  const back = forward ? prev : next;
  const otherId = (await there.getAttribute('href'))!.split('/').pop()!;
  expect(otherId).not.toBe(stopId);
  await there.click();
  await expect(page).toHaveURL(new RegExp(`#/${figureId}/${otherId}$`));
  await expect(page.locator('.stop-page')).toHaveAttribute('data-stop-id', otherId);
  await expectPaneSettled(page, figureId, otherId);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);

  // 回到原来那一站：从头读起，沙盘也回到第一节。
  await back.click();
  await expect(page).toHaveURL(new RegExp(`#/${figureId}/${stopId}$`));
  await expectPaneSettled(page, figureId, stopId);

  // ---- 回到目录
  await page.locator('.stop-nav-list').click();
  await expect(page).toHaveURL(new RegExp(`#/${figureId}$`));
  await expectStill(page);
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

test('凭据、讲解员面板里面的东西点开才取：一点就开，里面先是“加载中…”；没取到说一句话，关上再点开重取', async ({ page }) => {
  // 这两段程序的请求：各自头一次断掉，第二次压住、叫放才放。
  const asked: string[] = [];
  const held: (() => void)[] = [];
  await page.route(/\/assets\/(ProvenanceBody|GuideBody)-[^/]*\.js$/, async (route) => {
    const name = /(ProvenanceBody|GuideBody)-/.exec(route.request().url())![1];
    asked.push(name);
    if (asked.filter((item) => item === name).length === 1) return route.abort();
    await new Promise<void>((resolve) => held.push(resolve));
    return route.continue();
  });
  const FAILED_LINE = '没能读出来。关上再点开，可以再试一次；还不行，就刷新一下网页。';
  const WAIT_LINE = '加载中…';

  await openWrittenStop(page);
  // 页面打开了、正文出来了：两段程序都还没要
  await expect(page.locator('.text-section').first()).toBeVisible();
  await expect(page.locator('.guide-open')).toBeVisible();
  expect(asked).toEqual([]);

  // ---- 凭据
  const fold = page.locator('details.provenance');
  const body = fold.locator('.provenance-body');
  await expect(body).toBeHidden();
  await fold.locator('summary').click();
  // 一点就开；这一次取不到：一句话，说怎么再试
  expect(await fold.evaluate((el: HTMLDetailsElement) => el.open)).toBe(true);
  await expect(body).toHaveText(FAILED_LINE);
  expect(asked).toEqual(['ProvenanceBody']);
  // 关上再点开：重取。压着的时候那里是“加载中…”
  await fold.locator('summary').click();
  await expect(body).toBeHidden();
  await fold.locator('summary').click();
  await expect(body).toHaveText(WAIT_LINE);
  await expect.poll(() => asked).toEqual(['ProvenanceBody', 'ProvenanceBody']);
  expect(await body.locator('.quiet').evaluate((el) => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(16);
  await expect.poll(() => held.length).toBe(1);
  held.shift()!();
  await expect(fold.locator('.provenance-item').first()).toBeVisible();
  await expect(body.locator('.quiet')).toHaveCount(0);
  // 取到以后关上再点开：不再取，内容还在
  await fold.locator('summary').click();
  await fold.locator('summary').click();
  await expect(fold.locator('.provenance-item').first()).toBeVisible();
  expect(asked).toEqual(['ProvenanceBody', 'ProvenanceBody']);

  // ---- 讲解员面板
  const opener = page.getByRole('button', { name: '问讲解员' });
  await opener.click();
  const dialog = page.getByRole('dialog');
  // 一点就开：标题和“关闭”马上就有；这一次里面的东西取不到
  await expect(dialog.getByRole('heading', { name: '问讲解员' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: '关闭' })).toBeVisible();
  await expect(dialog.locator('.quiet')).toHaveText(FAILED_LINE);
  await expect(dialog.locator('.guide-form')).toHaveCount(0);
  await dialog.getByRole('button', { name: '关闭' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();
  // 再点开：重取；压着的时候是“加载中…”
  await opener.click();
  await expect(dialog.locator('.quiet')).toHaveText(WAIT_LINE);
  await expect.poll(() => asked.filter((item) => item === 'GuideBody').length).toBe(2);
  await expect.poll(() => held.length).toBe(1);
  held.shift()!();
  await expect(dialog.locator('.guide-form')).toBeVisible();
  await expect(dialog.locator('.quiet')).toHaveCount(0);
  await expect(dialog.locator('.guide-samples li').first()).toBeVisible();
  // 关上再开：不再取
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await opener.click();
  await expect(dialog.locator('.guide-form')).toBeVisible();
  expect(asked.filter((item) => item === 'GuideBody')).toHaveLength(2);
});

test('人物页的沙盘栏：一张定格图和图下面的字，没有沙盘的按钮；宽屏的版面', async ({ page }) => {
  await openFirstFigure(page);
  const hasStill = await expectStill(page);
  const pane = stagePane(page);

  // 宽屏：文字栏 440 到 500px，沙盘栏占满旁边，文字滚动时它不动。
  const viewport = page.viewportSize()!;
  const paneBox = (await pane.boundingBox())!;
  expect(paneBox.x).toBeGreaterThanOrEqual(440);
  expect(paneBox.x).toBeLessThanOrEqual(500);
  expect(paneBox.x + paneBox.width).toBeCloseTo(viewport.width, 0);
  expect(paneBox.height).toBeCloseTo(viewport.height, 0);
  await page.evaluate(() => window.scrollTo(0, 600));
  expect((await pane.boundingBox())!.y).toBeCloseTo(0, 0);
  await page.evaluate(() => window.scrollTo(0, 0));

  // 这里没有沙盘，也就没有古名今名、回到这一节、收起这几个按钮，没有题记。
  await expect(pane).not.toHaveAttribute('data-stage-section');
  await expect(pane.locator('.names-switch')).toHaveCount(0);
  await expect(pane.locator('.stage-reset')).toHaveCount(0);
  await expect(pane.locator('.stage-fold')).toHaveCount(0);
  await expect(pane.locator('.stage-host')).toHaveCount(0);
  await expect(pane.locator('.stage-caption')).toHaveCount(0);

  if (hasStill) {
    // 有定格图：图读得出来，有给看不见图的人的一句话；题记、如实的说明、用了谁的数据都不空。
    const img = pane.locator('.stage-still img');
    await expect(img).toBeVisible();
    await expect(img).toHaveAttribute('alt', /.+/);
    await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(true);
    // 图的宽高写在页面上，和图片文件一样：图还没下载完，地方就照这个比例留好了，下面的字不会被挤着跳一下。
    const written = await img.evaluate((el: HTMLImageElement) => ({ width: Number(el.getAttribute('width')), height: Number(el.getAttribute('height')), naturalWidth: el.naturalWidth, naturalHeight: el.naturalHeight }));
    expect(written.width).toBe(written.naturalWidth);
    expect(written.height).toBe(written.naturalHeight);
    await expect(pane.locator('.stage-still-caption')).not.toBeEmpty();
    await expect(pane.locator('.stage-still-note')).not.toBeEmpty();
    await expect(pane.locator('.stage-still-credit')).not.toBeEmpty();
    await expect(pane.locator('.stage-still-line')).toHaveCount(0);
    // 图不出沙盘栏的左右。
    const imgBox = (await img.boundingBox())!;
    expect(imgBox.x).toBeGreaterThanOrEqual(paneBox.x);
    expect(imgBox.x + imgBox.width).toBeLessThanOrEqual(paneBox.x + paneBox.width + 1);
  } else {
    // 这位人物还没有定格图：只有一句话。
    test.info().annotations.push({ type: '说明', description: '这位人物还没有定格图，只查了那一句话' });
    await expect(pane.locator('.stage-still-line')).toHaveText(NO_ROUTE);
    await expect(pane.locator('.stage-still')).toHaveCount(0);
  }

  // 各站目录照旧。
  expect(await page.locator('.stop-item').count()).toBeGreaterThan(1);
});

test('人物页没有定格图时：一句话，各站目录照旧', async ({ page }) => {
  const figureId = await openFirstFigure(page);
  await page.goto('about:blank');
  await page.goto(fakeUrl(`#/${figureId}`, '&still=none'));
  await expect(page.locator('.stop-item').first()).toBeVisible();

  expect(await expectStill(page)).toBe(false);
  const pane = stagePane(page);
  await expect(pane.locator('.stage-still-line')).toHaveText(NO_ROUTE);
  await expect(pane.locator('.stage-still')).toHaveCount(0);
  await expect(pane.locator('.names-switch')).toHaveCount(0);
  await expect(pane.locator('.stage-reset')).toHaveCount(0);

  const items = page.locator('.stop-item');
  expect(await items.count()).toBeGreaterThan(1);
  for (const item of await items.all()) {
    await expect(item.locator('.stop-title')).not.toBeEmpty();
  }
});

test('有沙盘的一站：跟着读到的小节换镜头、题记和题签；古名今名；回到这一节', async ({ page }) => {
  const { scene, headings } = await openStopWithScene(page);
  test.skip(headings.length < 4, '这一站的小节太少，测不了换小节');
  const pane = stagePane(page);
  const fake = fakeStage(page);
  const caption = pane.locator('.stage-caption');
  const reset = pane.locator('.stage-reset');
  const [first, , third, fourth] = headings;

  // ---- 直接打开一站：摆的是第一节，第一次摆放不滑；不抢焦点。放着的是立体的沙盘，下面那一层没有图片。
  await expectStageAt(page, first);
  await expect(pane).toHaveAttribute('data-stage-picture', 'table');
  await expect(pane.locator('.stage-still-host')).toBeEmpty();
  await expect(fake).toHaveCount(1);
  await expect(fake).toHaveAttribute('data-fake-section', first);
  await expect(fake).toHaveAttribute('data-fake-animated', 'false');
  expect(await page.evaluate(() => document.activeElement === document.body)).toBe(true);
  await expect(pane.locator('.stage-loading')).toHaveCount(0);
  await expect(pane.locator('.stage-message')).toHaveCount(0);

  // ---- 沙盘旁边的字：这一节的时间、题记、一句如实的说明。
  await expect(caption).toHaveAttribute('data-section', first);
  await expect(caption.locator('.stage-section-name')).toHaveText(first);
  await expect(caption.locator('.stage-date')).not.toBeEmpty();
  const line = caption.locator('.stage-line');
  await expect(line).toBeVisible();
  await expect(line).not.toBeEmpty();
  expect(await shownInFull(line)).toBe(true);
  expect(await rowsOf(line)).toBe(1);
  // 宽屏上说明是一句话（short），最多两行，整句都看得见：说到哪些是示意、平地修整过、山高夸大了几倍、模型和河都放大了。
  const short = caption.locator('.stage-note-short');
  await expect(short).toBeVisible();
  await expect(caption.locator('.stage-note-brief')).toBeHidden();
  await expect(short).toContainText(/是示意；平地修整过；山高夸大 \d+(\.\d+)? 倍；模型和河都放大了/);
  expect(await shownInFull(short)).toBe(true);
  expect(await rowsOf(short)).toBeLessThanOrEqual(2);
  // 完整的几句话不常印着：旁边有个“说明”按钮，没点的时候不展开。
  const noteButton = caption.locator('.stage-note-button');
  await expect(noteButton).toHaveText('说明');
  await expect(noteButton).toHaveAttribute('aria-expanded', 'false');
  await expect(pane.locator('.stage-note-panel')).toHaveCount(0);
  // 题记这一块不到沙盘栏的五分之一高。
  const start = await captionHeightAndInsets(page);
  expect(start.height).toBeLessThan((await pane.boundingBox())!.height / 5);

  // ---- 指北和比例尺：替身报的是转 30 度、“2 公里”宽 96 像素。它们在题记的第一行里，不压在沙盘上。
  await expect(pane.locator('.stage-north')).toBeVisible();
  await expect(pane.locator('.stage-north g')).toHaveAttribute('transform', 'rotate(30.0)');
  await expect(pane.locator('.stage-scale')).toContainText('2 公里');
  expect((await pane.locator('.stage-scale-bar').boundingBox())!.width).toBeCloseTo(96, 0);
  await expect(caption.locator('.stage-caption-head .stage-legend')).toBeVisible();
  const legendBox = (await pane.locator('.stage-legend').boundingBox())!;
  const captionBox = (await caption.boundingBox())!;
  expect(legendBox.y).toBeGreaterThanOrEqual(captionBox.y);
  expect(legendBox.y + legendBox.height).toBeLessThanOrEqual(captionBox.y + captionBox.height);

  // ---- 页面告诉了沙盘上下各留出多少：上面是按钮，下面正好是题记那一条。
  const insets = start.insets.split(' ').map(Number);
  expect(insets).toHaveLength(4);
  expect(insets[0]).toBeGreaterThanOrEqual(44);
  await expectBottomInsetIsFoot(page);

  // ---- 题签：正好是这一节写的那几条，字是当时的名字。
  const expectStrips = async (heading: string, names: 'ancient' | 'modern') => {
    const wanted = stripsOf(scene, heading).map((strip) => ({ id: strip.id, text: stripText(strip, names) }));
    await expect.poll(() => stripsOnStage(page)).toEqual(wanted);
  };
  await expectStrips(first, 'ancient');
  await expect(pane.locator('.stage-host .strip').first()).toBeVisible();
  // 题签是竖着写的。
  await expect.poll(() => pane.locator('.stage-host .strip').evaluateAll((items) => items.filter((item) => item.isConnected).map((item) => getComputedStyle(item).writingMode)[0] ?? '')).toBe('vertical-rl');

  // ---- 按钮够大；宽屏上没有“收起”。
  for (const button of await pane.locator('.stage-controls button:visible').all()) {
    expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  }
  await expect(pane.locator('.stage-fold')).toBeHidden();

  // ---- 读到第三节：镜头滑过去，到了以后题记和题签才换。
  await watchPane(page);
  await scrollToSection(page, third);
  await expectStageAt(page, third);
  await expect(fake).toHaveAttribute('data-fake-section', third);
  await expect(fake).toHaveAttribute('data-fake-animated', 'true');
  await expect(caption).toHaveAttribute('data-section', third);
  await expect(caption.locator('.stage-section-name')).toHaveText(third);
  await expectStrips(third, 'ancient');
  // 一路上：沙盘栏说的“摆着哪一节”和题记，从来没有抢在沙盘前头；指令发出去以后、镜头到之前，它们还是第一节的。
  const glide = await paneMoments(page);
  expectNeverAhead(glide);
  expect(glide.some((moment) => moment.requests.split('|').includes(third) && moment.pane === first && moment.caption === first)).toBe(true);
  expect(await fakeRequests(page)).toEqual([third]);
  // 题记那一块还是那么高，沙盘四边留的空一点没变：画面不会在换了小节以后再跳一下。
  expect(await captionHeightAndInsets(page)).toEqual(start);
  await expectBottomInsetIsFoot(page);

  // ---- 古名、今名：题签换成今天的名字，按钮留在按下的样子；换了小节也还是今名。
  await expect(fake).toHaveAttribute('data-fake-names', 'ancient');
  await page.getByRole('button', { name: '今名' }).click();
  await expect(fake).toHaveAttribute('data-fake-names', 'modern');
  await expect(page.getByRole('button', { name: '今名' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: '古名' })).toHaveAttribute('aria-pressed', 'false');
  await expectStrips(third, 'modern');

  // ---- 沙盘正往第一节滑的时候，很快地滚过第三节、停在第四节：最后摆的是第四节，不停在半路上。
  // （滚到第一节、等沙盘收到去第一节的指令、马上滚过第三节停在第四节，在页面里一次做完，不受测试程序快慢的影响。）
  await watchPane(page);
  await scrollThrough(page, [first, third, fourth], 40, true);
  await expectStageAt(page, fourth);
  await page.waitForTimeout(800);
  await expectStageAt(page, fourth);
  await expect(caption).toHaveAttribute('data-section', fourth);
  // 一掠而过的第三节没有报给沙盘。
  expect(await fakeRequests(page)).toEqual([third, first, fourth]);
  const superseded = await paneMoments(page);
  expectNeverAhead(superseded);
  // 去第四节的指令发出去的时候，镜头要是还在往第一节去的路上（平常都是这样），那一次就是被顶掉的：
  // 它“照常完成”了，沙盘栏却不能就此说自己摆着第一节。
  const overtaken = superseded.findIndex((moment) => moment.requests.split('|').includes(fourth));
  expect(overtaken).toBeGreaterThanOrEqual(0);
  if (superseded[overtaken].pane === third) {
    expect(superseded.slice(overtaken).every((moment) => moment.pane !== first && moment.caption !== first)).toBe(true);
  } else {
    test.info().annotations.push({ type: '说明', description: '这一回机器慢，镜头先到了第一节才收到去第四节的指令，没有碰上“途中被顶掉”' });
  }
  expect(await captionHeightAndInsets(page)).toEqual(start);
  await expect(fake).toHaveAttribute('data-fake-names', 'modern');
  await expect(page.getByRole('button', { name: '今名' })).toHaveAttribute('aria-pressed', 'true');
  await expectStrips(fourth, 'modern');
  await page.getByRole('button', { name: '古名' }).click();
  await expectStrips(fourth, 'ancient');

  // ---- “回到这一节”：读者动过镜头才点得了，点了之后又点不了，小节不变。
  await expect(reset).toHaveText('回到这一节');
  await expect(reset).toBeDisabled();
  await page.locator('.fake-stage-nudge').click();
  await expect(reset).toBeEnabled();
  await reset.click();
  await expect(reset).toBeDisabled();
  await expectStageAt(page, fourth);

  // ---- 滚到页面最底下：轮到最后一节。每一节题记那一块都一样高，说明都看得全。
  await scrollToBottom(page);
  await expectStageAt(page, headings[headings.length - 1]);
  expect(await captionHeightAndInsets(page)).toEqual(start);
  expect(await shownInFull(short)).toBe(true);

  // ---- 沙盘在一边不动，正文照常滚。
  expect((await pane.boundingBox())!.y).toBeCloseTo(0, 0);
});

test('窗口没变、沙盘栏自己变窄了（像页面长出了一条滚动条）：栏照新的宽度重排，沙盘得了通知；宽度没变就不通知', async ({ page }) => {
  const { headings } = await openStopWithScene(page);
  await expectStageAt(page, headings[0]);
  const pane = stagePane(page);
  const fake = fakeStage(page);
  /** 页面记在栏上的宽度（--pane-w）和题记的字号（--line-size）。 */
  const written = () => pane.evaluate((el: HTMLElement) => ({ w: el.style.getPropertyValue('--pane-w'), size: el.style.getPropertyValue('--line-size'), wide: el.classList.contains('is-wide') }));
  const resizes = async () => Number(await fake.getAttribute('data-fake-resizes'));
  const inner = () => pane.evaluate((el) => el.clientWidth);
  const window0 = await page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
  const width = await inner();
  expect(await written()).toEqual({ w: `${width}px`, size: '19px', wide: true });
  // 等沙盘栏停稳（刚打开时量留边、摆题签会叫几次），记下这时候通知过几次
  await page.waitForTimeout(400);
  const before = await resizes();

  // 整页右边让出 17 像素，一条滚动条那么宽。窗口的大小没有变，浏览器不会报“大小变了”
  await page.evaluate(() => {
    document.documentElement.style.paddingRight = '17px';
  });
  await expect.poll(inner).toBe(width - 17);
  await expect.poll(async () => (await written()).w, { message: '栏窄了 17 像素，记在栏上的宽度没有跟着变' }).toBe(`${width - 17}px`);
  await expect.poll(resizes, { message: '栏窄了，沙盘没有得到通知' }).toBeGreaterThan(before);
  expect(await page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }))).toEqual(window0);

  // 再让出一大截，窄到题记换成窄的排法：类名也跟着换
  const after = await resizes();
  await page.evaluate(() => {
    document.documentElement.style.paddingRight = '400px';
  });
  await expect.poll(async () => (await written()).wide).toBe(false);
  expect((await written()).w).toBe(`${width - 400}px`);
  await expect.poll(resizes).toBeGreaterThan(after);

  // 只是高矮变了、宽度没变（栏下面的东西多了少了，另有地方管）：不为这个通知沙盘。
  // 改的是栏自己的高（在页面底下垫一截空不算：栏的高是照窗口定的，一点不变，量栏的那个东西根本不会被叫到）；
  // 先看栏真的矮了、量栏的东西也真的被叫到了，再看沙盘没有得到通知
  await page.waitForTimeout(400);
  const settled = await resizes();
  const box = await pane.evaluate((el: HTMLElement) => ({ w: el.offsetWidth, h: el.offsetHeight }));
  expect(box.h).toBeGreaterThan(600);
  const boxesSeen = () => page.evaluate(() => (window as Window & { __paneBoxes?: number }).__paneBoxes ?? 0);
  await pane.evaluate((el: HTMLElement) => {
    const seen = window as Window & { __paneBoxes?: number };
    seen.__paneBoxes = 0;
    new ResizeObserver(() => {
      seen.__paneBoxes = (seen.__paneBoxes ?? 0) + 1;
    }).observe(el);
  });
  // 刚开始看的那一下算一次；等它过了再改高（同一帧里改的话，两次并成一次）
  await expect.poll(boxesSeen).toBe(1);
  await pane.evaluate((el: HTMLElement) => {
    el.style.height = '500px';
  });
  await expect.poll(() => pane.evaluate((el: HTMLElement) => el.offsetHeight), { message: '栏的高没有变，这一步什么也查不到' }).toBe(500);
  await expect.poll(boxesSeen, { message: '栏矮了，量栏的东西却没有被叫到' }).toBe(2);
  expect(await pane.evaluate((el: HTMLElement) => el.offsetWidth)).toBe(box.w);
  await page.waitForTimeout(600);
  expect(await resizes(), '栏只是矮了、宽度没变，却通知了沙盘').toBe(settled);
});

test('沙盘旁边的“说明”：点了才展开完整的几句话，盖在沙盘上，不挤题记，不动沙盘；再点、按 Esc、换小节都收起', async ({ page }) => {
  const { headings } = await openStopWithScene(page);
  test.skip(headings.length < 3, '这一站的小节太少，测不了换小节');
  await expectStageAt(page, headings[0]);
  const pane = stagePane(page);
  const fake = fakeStage(page);
  const caption = pane.locator('.stage-caption');
  const button = caption.locator('.stage-note-button');
  const panel = pane.locator('.stage-note-panel');
  const before = await captionHeightAndInsets(page);
  const resizes = await fake.getAttribute('data-fake-resizes');
  const captionBox = (await caption.boundingBox())!;

  await expectNoteButtonTapArea(page);

  // 点开：完整的几句话，说到哪些是示意、山高夸大了几倍。
  await button.click();
  await expect(panel).toBeVisible();
  await expect(button).toHaveAttribute('aria-expanded', 'true');
  await expect(button).toHaveAttribute('aria-controls', (await panel.getAttribute('id'))!);
  const lines = panel.locator('.stage-note-lines p');
  expect(await lines.count()).toBeGreaterThanOrEqual(3);
  await expect(lines.first()).toContainText('示意');
  await expect(panel.locator('.stage-note-lines')).toContainText(/夸大了 \d+(\.\d+)? 倍/);
  // 它盖在沙盘的下边：在题记上面、按钮那一排下面，不出沙盘栏；题记一点没动。
  const panelBox = (await panel.boundingBox())!;
  const paneBox = (await pane.boundingBox())!;
  const controlsBox = (await pane.locator('.stage-controls').boundingBox())!;
  expect(panelBox.y + panelBox.height).toBeLessThanOrEqual(captionBox.y);
  expect(panelBox.y).toBeGreaterThanOrEqual(controlsBox.y + controlsBox.height);
  expect(panelBox.x).toBeGreaterThanOrEqual(paneBox.x);
  expect(panelBox.x + panelBox.width).toBeLessThanOrEqual(paneBox.x + paneBox.width);
  expect((await caption.boundingBox())!).toEqual(captionBox);
  // 沙盘四边留的空没变，也没有叫沙盘重摆：画面不动。
  expect(await captionHeightAndInsets(page)).toEqual(before);
  expect(await fake.getAttribute('data-fake-resizes')).toBe(resizes);
  expect(await fakeRequests(page)).toEqual([]);

  // 再点一下收起。
  await button.click();
  await expect(panel).toHaveCount(0);
  await expect(button).toHaveAttribute('aria-expanded', 'false');
  expect(await captionHeightAndInsets(page)).toEqual(before);

  // 用键盘：走到按钮上按回车展开，按 Esc 收起，焦点还在按钮上。
  await button.focus();
  await page.keyboard.press('Enter');
  await expect(panel).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(panel).toHaveCount(0);
  await expect(button).toBeFocused();

  // 展开以后点里面的“关闭”：收起，焦点回到“说明”按钮上。
  await button.click();
  const close = panel.locator('.stage-note-close');
  expect((await close.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await close.click();
  await expect(panel).toHaveCount(0);
  await expect(button).toBeFocused();

  // 展开着读到别的小节：沙盘到了、题记换了，展开的那一块也收起来（它说的是上一节）。
  await button.click();
  await expect(panel).toBeVisible();
  await scrollToSection(page, headings[2]);
  await expectStageAt(page, headings[2]);
  await expect(panel).toHaveCount(0);
  await expect(button).toHaveAttribute('aria-expanded', 'false');
  expect(await captionHeightAndInsets(page)).toEqual(before);
  await button.click();
  await expect(panel).toHaveAttribute('data-section', headings[2]);
});

test('用键盘：标题后面有一步“到沙盘”，走到它上面才显出来；按了以后焦点到沙盘栏，下一步就是它的按钮', async ({ page }) => {
  const { headings } = await openStopWithScene(page);
  await expectStageAt(page, headings[0]);
  const skip = page.locator('.skip-to-stage');
  await expect(skip).toHaveText('到沙盘');
  // 平时不占地方、看不见。
  expect((await skip.boundingBox())!.width).toBeLessThanOrEqual(2);
  // 它是正文这一栏里标题之后第一样走得到的东西。
  const firstInArticle = await page.evaluate(() => {
    const all = Array.from(document.querySelectorAll<HTMLElement>('.stop-page a[href], .stop-page button:not([disabled])'));
    return all[0]?.className ?? '';
  });
  expect(firstInArticle).toBe('skip-to-stage');
  await skip.focus();
  await expect(skip).toBeInViewport();
  const box = (await skip.boundingBox())!;
  expect(box.height).toBeGreaterThanOrEqual(44);
  expect(box.width).toBeGreaterThanOrEqual(44);
  const scrollBefore = await page.evaluate(() => window.scrollY);
  await page.keyboard.press('Enter');
  await expect(stagePane(page)).toBeFocused();
  expect(await page.evaluate(() => window.scrollY)).toBe(scrollBefore);
  // 焦点到了栏上，看得出来：一圈 3 像素的墨色框，叠在栏里所有东西的上面（画面、按钮那一排、题记把栏自己盖满了，
  // 画在栏自己身上的框露不出来），和栏一样大，不挡手指和鼠标
  const ring = await stagePane(page).evaluate((pane) => {
    const style = getComputedStyle(pane, '::after');
    const layers = Array.from(pane.children).map((child) => Number(getComputedStyle(child).zIndex) || 0);
    return { content: style.content, edge: `${style.borderTopWidth} ${style.borderTopStyle} ${style.borderTopColor}`, position: style.position, inset: `${style.top} ${style.right} ${style.bottom} ${style.left}`, above: Number(style.zIndex) > Math.max(...layers), taps: style.pointerEvents };
  });
  expect(ring).toEqual({ content: '""', edge: '3px solid rgb(40, 35, 31)', position: 'absolute', inset: '0px 0px 0px 0px', above: true, taps: 'none' });
  await page.keyboard.press('Tab');
  await expectOnFirstButtonInPane(page);
  // 焦点走到按钮上，栏上的那一圈就没有了
  expect(await stagePane(page).evaluate((pane) => getComputedStyle(pane, '::after').content)).toBe('none');
});

test('题签指到沙盘外面的远处时，沙盘旁边写着它在哪个方向、多远', async ({ page }) => {
  const { scene, headings } = await openStopWithScene(page);
  const farIds = new Set(scene.far.map((far) => far.id));
  const heading = headings.find((item) => stripsOf(scene, item).some((strip) => farIds.has(strip.of)));
  test.skip(heading === undefined, '这一站没有指到远处的题签');
  await expectStageAt(page, headings[0]);

  if (heading === headings[headings.length - 1]) await scrollToBottom(page);
  else await scrollToSection(page, heading!);
  await expectStageAt(page, heading!);

  const wanted = stripsOf(scene, heading!).filter((strip) => farIds.has(strip.of));
  const far = stagePane(page).locator('.stage-far li');
  await expect(far).toHaveCount(wanted.length);
  for (const strip of wanted) {
    const line = stagePane(page).locator(`.stage-far li[data-far-id="${strip.of}"]`);
    await expect(line).toBeVisible();
    // 如“往西南约 24 公里（今安徽萧县白土镇）”。整句都看得见。
    await expect(line).toContainText(/往[东南西北]{1,2}约 \d+ 公里/);
    expect(await shownInFull(line)).toBe(true);
    // 远处的题签也摆在沙盘上（在沙盘边上）。
    await expect(stagePane(page).locator(`.stage-host .strip[data-strip-id="${strip.id}"]`)).toHaveAttribute('data-tone', 'far');
  }
});

test('凭据里有“沙盘上的东西”一栏：按类别列出来，后面是没有画的，最后是用了谁的数据', async ({ page }) => {
  const { scene } = await openStopWithScene(page);
  const provenance = page.locator('details.provenance');
  await provenance.locator('summary').click();

  const register = provenance.locator('.scene-register');
  await expect(register).toBeVisible();
  await expect(register.locator('h3')).toHaveText('沙盘上的东西');

  // 每一组的名字是五类之一，不重复；每一项有名字和依据。
  const groups = register.locator('.scene-register-group[data-class]');
  const count = await groups.count();
  expect(count).toBeGreaterThan(0);
  expect(count).toBeLessThanOrEqual(5);
  const labels = await groups.locator('h4').allInnerTexts();
  expect(new Set(labels).size).toBe(labels.length);
  for (const label of labels) expect(label).toMatch(CLASSES);
  for (const group of await groups.all()) {
    const entries = group.locator('.scene-register-item');
    expect(await entries.count()).toBeGreaterThan(0);
    for (const entry of await entries.all()) {
      await expect(entry.locator('.scene-register-name')).not.toBeEmpty();
      await expect(entry.locator('.scene-register-basis')).not.toBeEmpty();
    }
  }
  // 场景里的每样摆件都列在里面。
  for (const thing of scene.things) {
    await expect(register.locator(`.scene-register-item[data-scene-id="${thing.id}"]`)).toHaveCount(1);
  }

  // 没有画的东西：场景里写了几样，这里就列几样，各有一句为什么。
  const notDrawn = register.locator('.scene-not-drawn .scene-register-item');
  await expect(notDrawn).toHaveCount(scene.notDrawn.length);
  for (const item of await notDrawn.all()) {
    await expect(item.locator('.scene-register-basis')).not.toBeEmpty();
  }

  // 最后是用了谁的数据，一家一行。
  const credits = register.locator('.scene-credits p');
  await expect(credits).toHaveCount(scene.credits.length);
  await expect(credits).toHaveText(scene.credits);
  expect(await register.evaluate((el) => el.lastElementChild?.className)).toBe('scene-credits');

  // 正文的凭据照旧在上面。
  expect(await provenance.locator('.provenance-group').count()).toBeGreaterThan(0);
});

test('还没有沙盘的站：放定格图和一句话，正文照常读', async ({ page }) => {
  const figureId = await openFirstFigure(page);
  const stopId = await firstWrittenStopWithoutScene(page, figureId);
  test.skip(stopId === null, '写好的站都有沙盘了');
  // 这一站没有沙盘是不用等就知道的：沙盘栏从头到尾不该说过“沙盘正在摆出来”。从现在起盯着。
  await page.evaluate(() => {
    const target = window as Window & { __saidLoading?: boolean };
    target.__saidLoading = false;
    new MutationObserver(() => {
      if (document.querySelector('.stage-pane[data-stage-state="loading"], .stage-loading')) target.__saidLoading = true;
    }).observe(document.body, { attributes: true, childList: true, subtree: true });
  });
  await page.locator(`.stop-item[data-stop-id="${stopId}"]`).click();
  await expect(page).toHaveURL(new RegExp(`#/${figureId}/${stopId}$`));
  await expect(page.locator('.stop-page')).toHaveAttribute('data-stop-text', 'written');
  await expect(page.locator('.stop-page')).toHaveAttribute('data-stop-scene', 'none');

  const pane = stagePane(page);
  const hasStill = await expectStill(page);
  await expect(pane.locator('.stage-still-line')).toHaveText(hasStill ? NO_SCENE : NO_SCENE_ALONE);
  expect(await page.evaluate(() => (window as Window & { __saidLoading?: boolean }).__saidLoading)).toBe(false);
  if (hasStill) {
    await expect(pane.locator('.stage-still img')).toBeVisible();
    await expect(pane.locator('.stage-still-note')).not.toBeEmpty();
    await expect(pane.locator('.stage-still-credit')).not.toBeEmpty();
  }
  await expect(pane.locator('.names-switch')).toHaveCount(0);
  await expect(pane.locator('.stage-reset')).toHaveCount(0);
  await expect(pane.locator('.stage-caption')).toHaveCount(0);
  // 这一栏里没有可按的东西，标题后面也就没有“到沙盘”那一步。
  await expect(page.locator('.skip-to-stage')).toHaveCount(0);

  // 正文、小注、凭据、换站都照常；凭据里没有“沙盘上的东西”。
  await expect(page.locator('.text-section').first()).toBeVisible();
  await page.locator('.note-term').first().click();
  await expect(page.locator('.note').first()).toBeVisible();
  await page.locator('details.provenance summary').click();
  await expect(page.locator('.provenance-item').first()).toBeVisible();
  await expect(page.locator('.scene-register')).toHaveCount(0);
  await page.evaluate(() => window.scrollTo(0, 900));
  await expectStill(page);
  await expect(page.locator('.stop-nav-list')).toBeVisible();

  // 没有定格图时只说前半句。
  await page.goto('about:blank');
  await page.goto(fakeUrl(`#/${figureId}/${stopId}`, '&still=none'));
  expect(await expectStill(page)).toBe(false);
  await expect(stagePane(page).locator('.stage-still-line')).toHaveText(NO_SCENE_ALONE);
});

test('还没写的站：有抬头和一句话，沙盘栏放定格图', async ({ page }) => {
  const figureId = await openFirstFigure(page);
  const outline = page.locator('.stop-item[data-stop-status="outline"]').first();
  test.skip((await outline.count()) === 0, '各站都写好了');
  const stopId = (await outline.getAttribute('data-stop-id'))!;
  await outline.click();
  await expect(page).toHaveURL(new RegExp(`#/${figureId}/${stopId}$`));

  await expect(page.locator('.stop-page')).toHaveAttribute('data-stop-text', 'none');
  await expect(page.locator('.stop-page')).toHaveAttribute('data-stop-scene', 'none');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.locator('.facts > div')).toHaveCount(3);
  await expect(page.locator('.not-written')).toBeVisible();
  await expect(page.locator('.text-section')).toHaveCount(0);
  await expect(page.locator('.text-about')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '问讲解员' })).toHaveCount(0);
  await expect(page.locator('.stop-nav-list')).toBeVisible();
  // 贴着底边的那一条照样在：没有“问讲解员”，上一站、下一站照旧（在头或在尾的站只有一个方向），都指着目录里挨着它的那一站
  const ids = await page.evaluate(() => Array.from(document.querySelectorAll('.guide-dock a')).map((link) => `${link.getAttribute('rel')} ${link.getAttribute('href')}`));
  await page.goBack();
  const order = await page.locator('.stop-item').evaluateAll((items) => items.map((item) => item.getAttribute('data-stop-id') ?? ''));
  const at = order.indexOf(stopId);
  const expected = [at > 0 ? `prev #/${figureId}/${order[at - 1]}` : null, at < order.length - 1 ? `next #/${figureId}/${order[at + 1]}` : null].filter((item) => item !== null);
  expect(expected.length).toBeGreaterThan(0);
  expect(ids).toEqual(expected);
  await page.goForward();
  await expect(page.locator('.stop-page')).toHaveAttribute('data-stop-id', stopId);
  const dock = page.locator('.guide-dock');
  await expect(dock).toBeVisible();
  await expect(dock.locator('button')).toHaveCount(0);
  await expect(dock.locator('a')).toHaveCount(expected.length);

  const hasStill = await expectStill(page);
  await expect(stagePane(page).locator('.stage-still-line')).toHaveText(hasStill ? NO_SCENE : NO_SCENE_ALONE);
});

test('沙盘起不来：一句话和“再试一次”，题记和说明还在，照常阅读', async ({ page }) => {
  const warnings: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'warning') warnings.push(message.text());
  });
  const { headings } = await openStopWithScene(page, '?stage=fake-fail');
  const pane = stagePane(page);

  await expect(pane).toHaveAttribute('data-stage-state', 'failed');
  await expect(pane).toHaveAttribute('data-stage-picture', 'none');
  // 沙盘一次都没摆出来，所以没有“摆着哪一节”；原因写在控制台里，不给读者看。
  await expect(pane).not.toHaveAttribute('data-stage-section');
  await expect.poll(() => warnings.some((text) => text.includes('[沙盘]') && text.includes('按要求起不来'))).toBe(true);
  await expect(pane.locator('.stage-message p')).toHaveText(FAILED);
  await expect(pane).not.toContainText('按要求起不来');
  const retry = pane.locator('.stage-retry');
  await expect(retry).toHaveText('再试一次');
  expect((await retry.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await expect(pane.locator('.stage-controls')).toHaveCount(0);
  await expect(pane.locator('.stage-host')).toHaveCount(0);
  await expect(pane.locator('.stage-legend')).toHaveCount(0);

  // 这一小节的题记和如实的说明照样有，而且跟着读到的小节换。
  const caption = pane.locator('.stage-caption');
  await expect(caption).toHaveAttribute('data-section', headings[0]);
  await expect(caption.locator('.stage-date')).not.toBeEmpty();
  await expect(caption.locator('.stage-note')).toContainText('示意');
  // “说明”照样能点开；这时候没有沙盘，展开的那一块接在题记下面。
  await caption.locator('.stage-note-button').click();
  await expect(pane.locator('.stage-note-panel .stage-note-lines')).toContainText('示意');
  await caption.locator('.stage-note-button').click();
  await expect(pane.locator('.stage-note-panel')).toHaveCount(0);
  if (headings.length > 2) {
    await scrollToSection(page, headings[2]);
    await expect(caption).toHaveAttribute('data-section', headings[2]);
    await page.evaluate(() => window.scrollTo(0, 0));
  }

  // 再试一次：替身还是起不来，还是这句话，控制台里又记了一次。按的那个按钮换掉了，焦点落在新的“再试一次”上，没有掉到页面外头。
  const before = warnings.filter((text) => text.includes('按要求起不来')).length;
  await retry.focus();
  await page.keyboard.press('Enter');
  await expect.poll(() => warnings.filter((text) => text.includes('按要求起不来')).length).toBeGreaterThan(before);
  await expect(pane).toHaveAttribute('data-stage-state', 'failed');
  await expect(pane.locator('.stage-message p')).toHaveText(FAILED);
  await expect(pane.locator('.stage-retry')).toBeFocused();

  // 正文、小注、换页都照常。
  await expect(page.locator('.text-section').first()).toBeVisible();
  const term = page.locator('.note-term').first();
  await term.click();
  await expect(page.locator('.note').first()).toBeVisible();
  await page.locator('.stop-nav-list').click();
  await expect(page.locator('.stop-item').first()).toBeVisible();
});

test('浏览器画不了立体的沙盘：一句大白话，没有按钮，页面上不出现技术词', async ({ page }) => {
  const warnings: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'warning') warnings.push(message.text());
  });
  const { headings } = await openStopWithScene(page, '?stage=fake-unsupported');
  const pane = stagePane(page);

  await expect(pane).toHaveAttribute('data-stage-state', 'unsupported');
  await expect(pane).not.toHaveAttribute('data-stage-section');
  await expect(pane.locator('.stage-message p')).toHaveText(UNSUPPORTED);
  await expect(pane.locator('.stage-retry')).toHaveCount(0);
  await expect(pane.locator('.stage-controls')).toHaveCount(0);
  await expect(pane.locator('.names-switch')).toHaveCount(0);
  await expect(pane.locator('.stage-host')).toHaveCount(0);

  // 技术上的原因只写在控制台里。
  expect(await page.locator('body').innerText()).not.toMatch(/webgl/i);
  await expect.poll(() => warnings.some((text) => text.includes('[沙盘]') && text.includes('no-webgl2'))).toBe(true);

  // 题记和说明照样有；正文照常读。
  await expect(pane.locator('.stage-caption')).toHaveAttribute('data-section', headings[0]);
  await expect(pane.locator('.stage-note')).toContainText('示意');
  await expect(page.locator('.text-section').first()).toBeVisible();
  await page.locator('.note-term').first().click();
  await expect(page.locator('.note').first()).toBeVisible();
});

test('沙盘的画面中途断了：一句话和“重新摆出来”，点了以后沙盘回来', async ({ page }) => {
  const { headings } = await openStopWithScene(page);
  const pane = stagePane(page);
  await expectStageAt(page, headings[0]);

  // 这几句话都换在同一块一直在页面上的地方里（读屏软件才念得出后来换进去的话）。
  const says = pane.locator('.stage-says');
  await expect(says).toHaveAttribute('role', 'status');
  await expect(says).toBeEmpty();

  // 画面断的时候，焦点正在栏里的“今名”上。
  await page.getByRole('button', { name: '今名' }).focus();
  await page.evaluate(() => document.querySelector<HTMLElement>('.fake-stage-lose')?.click());
  await expect(pane).toHaveAttribute('data-stage-state', 'lost');
  await expect(pane).toHaveAttribute('data-stage-picture', 'none');
  await expect(pane).not.toHaveAttribute('data-stage-section');
  await expect(says.locator('.stage-message p')).toHaveText(LOST);
  await expect(pane.locator('.stage-notice')).toHaveCount(0);
  await expect(fakeStage(page)).toHaveCount(0);
  await expect(pane.locator('.stage-controls')).toHaveCount(0);
  await expect(pane.locator('.stage-caption')).toHaveAttribute('data-section', headings[0]);
  await expect(page.locator('.text-section').first()).toBeVisible();

  // 按钮没了，焦点落在“重新摆出来”上；按回车，沙盘回来，焦点在沙盘栏上，下一步 Tab 就进到栏里的按钮上。
  const rebuild = pane.locator('.stage-retry');
  await expect(rebuild).toHaveText('重新摆出来');
  await expect(rebuild).toBeFocused();
  await page.keyboard.press('Enter');
  await expectStageAt(page, headings[0]);
  await expect(fakeStage(page)).toHaveCount(1);
  await expect(pane.locator('.stage-message')).toHaveCount(0);
  await expect(pane.locator('.names-switch')).toBeVisible();
  await expect(pane).toBeFocused();
  await page.keyboard.press('Tab');
  await expectOnFirstButtonInPane(page);
});

test('从目录进一站再回目录：沙盘摆出来，离开时拿走', async ({ page }) => {
  const { figureId, stopId, headings } = await findStopWithScene(page);
  // 从目录点进去：摆好以后“正在摆”那句话没有了。（替身一下就摆好，那句话本身由真沙盘的冒烟测试来看。）
  await page.locator(`.stop-item[data-stop-id="${stopId}"]`).click();
  const pane = stagePane(page);
  await expectStageAt(page, headings[0]);
  await expect(pane.locator('.stage-loading')).toHaveCount(0);
  await expect(fakeStage(page)).toHaveCount(1);
  // 一路点进来的，第一次摆放也不滑。
  await expect(fakeStage(page)).toHaveAttribute('data-fake-animated', 'false');

  // 回到人物页：沙盘拿走，换成定格图。
  await page.locator('.stop-nav-list').click();
  await expect(page).toHaveURL(new RegExp(`#/${figureId}$`));
  await expectStill(page);
  await expect(fakeStage(page)).toHaveCount(0);
  await expect(page.locator('.strip')).toHaveCount(0);
});

// 窗口不到 960 像素宽、或者是竖着的（高不小于宽）时，沙盘在上、文字在下。标准的画面里这样排的是竖着拿的平板（768×1024），
// 和竖着拿的大平板（1024×1366，在 large-upright.spec.ts 里查）；手机不在考虑之内，不查。
test.describe('竖着拿的平板（768×1024）', () => {
  test.use({ viewport: { width: 768, height: 1024 } });

  test('窄屏：沙盘在上不动，文字在下面滚，沙盘能收起和展开', async ({ page }) => {
    const { headings } = await openStopWithScene(page);
    await expectStageAt(page, headings[0]);
    const pane = stagePane(page);
    const fold = pane.locator('.stage-fold');
    const fake = fakeStage(page);

    // 沙盘在最上面，占屏幕高度的 56%（tokens.css 的 --stage-height-narrow；decisions.md 第 23 条）；文字在它下面。
    const open = (await pane.boundingBox())!;
    expect(open.y).toBeCloseTo(0, 0);
    expect(open.width).toBeCloseTo(768, 0);
    expect(open.height).toBeGreaterThan(1024 * 0.54);
    expect(open.height).toBeLessThan(1024 * 0.58);
    const reading = (await page.locator('.reading').boundingBox())!;
    expect(reading.y).toBeGreaterThanOrEqual(open.y + open.height - 1);

    // 题记印着，一行，整句看得见。
    const caption = pane.locator('.stage-caption');
    const line = caption.locator('.stage-line');
    await expect(line).toBeVisible();
    await expect(line).not.toBeEmpty();
    expect(await shownInFull(line)).toBe(true);
    expect(await rowsOf(line)).toBe(1);
    // 说明：这一栏有 584 像素以上宽，用的是最多两行的那一种写法（不是很窄的栏上一行的短写法），整句看得见，没有被截掉。
    const note = caption.locator('.stage-note-short');
    await expect(note).toBeVisible();
    await expect(caption.locator('.stage-note-brief')).toBeHidden();
    expect(await rowsOf(note)).toBeLessThanOrEqual(2);
    expect(await shownInFull(note)).toBe(true);
    expect(await note.evaluate((el) => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(11);
    // 题记这一条不占掉沙盘的三分之一。
    const start = await captionHeightAndInsets(page);
    expect((await pane.locator('.stage-foot').boundingBox())!.height).toBeLessThan(open.height / 3);
    await expectBottomInsetIsFoot(page);

    // 比例尺和指北在题记第一行的右头，不压在沙盘上。这一栏够宽，比例尺就是替身报的那一段（“2 公里”宽 96 像素）；
    // 很窄的栏上才换一段短的（在下面几种屏幕都查的那一项里查）。
    await expect(caption.locator('.stage-caption-head .stage-legend')).toBeVisible();
    const legendBox = (await pane.locator('.stage-legend').boundingBox())!;
    const captionBox = (await caption.boundingBox())!;
    expect(legendBox.y).toBeGreaterThanOrEqual(captionBox.y);
    expect(legendBox.y + legendBox.height).toBeLessThanOrEqual(captionBox.y + captionBox.height);
    expect(legendBox.x + legendBox.width).toBeLessThanOrEqual(captionBox.x + captionBox.width);
    await expect(pane.locator('.stage-scale-label')).toHaveText('2 公里');
    expect((await pane.locator('.stage-scale-bar').boundingBox())!.width).toBeCloseTo(96, 0);
    // 第一行里的小节名和时间没有被比例尺挤掉。
    expect(await shownInFull(caption.locator('.stage-date'))).toBe(true);

    // “说明”：按钮能点的地方够大；点开，完整的几句话盖在沙盘上（按钮那一排和题记之间），放不下就在里面滚；
    // 题记和沙盘四边留的空都不动。
    await expectNoteButtonTapArea(page);
    const noteButton = caption.locator('.stage-note-button');
    const panel = pane.locator('.stage-note-panel');
    await noteButton.click();
    await expect(panel).toBeVisible();
    const panelBox = (await panel.boundingBox())!;
    const controlsBox = (await pane.locator('.stage-controls').boundingBox())!;
    expect(panelBox.y).toBeGreaterThanOrEqual(controlsBox.y + controlsBox.height);
    expect(panelBox.y + panelBox.height).toBeLessThanOrEqual(captionBox.y);
    expect(panelBox.x).toBeGreaterThanOrEqual(0);
    expect(panelBox.x + panelBox.width).toBeLessThanOrEqual(768);
    expect(await panel.evaluate((el) => getComputedStyle(el).overflowY)).toBe('auto');
    expect(await captionHeightAndInsets(page)).toEqual(start);
    await noteButton.click();
    await expect(panel).toHaveCount(0);

    // 文字滚动，沙盘留在原处。
    await page.evaluate(() => window.scrollTo(0, 900));
    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(800);
    expect((await pane.boundingBox())!.y).toBeCloseTo(0, 0);
    await page.evaluate(() => window.scrollTo(0, 0));
    await expectStageAt(page, headings[0]);

    // 读到哪一节，看的是沙盘下面那一块：第三节的标题在沙盘下面一点（整个屏幕的 42% 以下）时，已经算读到了。
    if (headings.length > 2) {
      await scrollToSection(page, headings[2], 60);
      const top = await page.locator('.text-section').nth(2).evaluate((el) => el.getBoundingClientRect().top);
      expect(top).toBeGreaterThan(1024 * 0.42);
      expect(top).toBeGreaterThan(open.height);
      await expectStageAt(page, headings[2]);
      await expect(pane.locator('.stage-caption')).toHaveAttribute('data-section', headings[2]);
      // 换了小节，题记那一块还是那么高，沙盘四边留的空没变；说明还是整句看得见。
      expect(await captionHeightAndInsets(page)).toEqual(start);
      expect(await shownInFull(note)).toBe(true);
      expect(await shownInFull(line)).toBe(true);
    }

    // 收起、展开，之后都告诉了沙盘。
    await expect(fold).toHaveText('收起沙盘');
    await expect(fold).toHaveAttribute('aria-expanded', 'true');
    const resizesBefore = Number(await fake.getAttribute('data-fake-resizes'));
    await fold.click();
    await expect(fold).toHaveText('展开沙盘');
    await expect(fold).toHaveAttribute('aria-expanded', 'false');
    const folded = (await pane.boundingBox())!;
    expect(folded.height).toBeLessThan(open.height / 2);
    expect(folded.height).toBeGreaterThan(44);
    await expect.poll(async () => Number(await fake.getAttribute('data-fake-resizes'))).toBeGreaterThan(resizesBefore);
    expect((await fake.boundingBox())!.height).toBeCloseTo(folded.height, -1);
    await expect(pane.locator('.stage-foot')).toBeHidden();
    // 收起以后只留一排按钮：沙盘不显出来（缩在这么矮的一条里没法看），只剩“展开沙盘”可以点。
    await expect(fake).toBeHidden();
    await expect(pane.locator('.names-switch')).toBeHidden();
    await expect(pane.locator('.stage-reset')).toBeHidden();
    expect(folded.height).toBeLessThan(80);
    // 收起来的这一条，沙盘程序量到的容器是 768 × 59。它不够“试画”的那两条线（src/stage/three/tier.ts 的 bigEnoughToTry）：
    // 真的沙盘不拿这么一窄条量这台设备的快慢。（tests/stage/view-tier.test.ts 用的就是这里量到的大小。）
    const foldedHost = await pane.locator('.stage-host').evaluate((el) => ({ w: el.clientWidth, h: el.clientHeight }));
    expect(foldedHost).toEqual({ w: 768, h: 59 });
    expect(bigEnoughToTry(foldedHost.w, foldedHost.h)).toBe(false);

    // 收起的时候读回第一节：沙盘看不见，不叫它白跑。
    const requestsFolded = await fakeRequests(page);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(600);
    expect(await fakeRequests(page)).toEqual(requestsFolded);

    // 展开：回到原来那么高，沙盘直接摆到读到的那一节（不滑），留边又量了一遍。
    const resizesFolded = Number(await fake.getAttribute('data-fake-resizes'));
    await fold.click();
    await expect(fold).toHaveText('收起沙盘');
    expect((await pane.boundingBox())!.height).toBeCloseTo(open.height, 0);
    await expect.poll(async () => Number(await fake.getAttribute('data-fake-resizes'))).toBeGreaterThan(resizesFolded);
    // 展开着的够“试画”的那条线。
    const openHost = await pane.locator('.stage-host').evaluate((el) => ({ w: el.clientWidth, h: el.clientHeight }));
    expect(bigEnoughToTry(openHost.w, openHost.h)).toBe(true);
    await expect(pane.locator('.stage-foot')).toBeVisible();
    await expect(fake).toBeVisible();
    await expect(pane.locator('.names-switch')).toBeVisible();
    if (headings.length > 2) {
      await expect.poll(() => fakeRequests(page)).toEqual([...requestsFolded, headings[0]]);
      await expect(fake).toHaveAttribute('data-fake-animated', 'false');
    }
    await expectStageAt(page, headings[0]);
    expect(await captionHeightAndInsets(page)).toEqual(start);
    await expectBottomInsetIsFoot(page);

    // 收起以后把窗口拉宽（平板横过来）：沙盘栏是整栏的，沙盘和题记照常显出来。
    await fold.click();
    await expect(fake).toBeHidden();
    await page.setViewportSize({ width: 1024, height: 768 });
    await expect(fake).toBeVisible();
    await expect(pane.locator('.stage-foot')).toBeVisible();
    await expect(pane.locator('.names-switch')).toBeVisible();
    await page.setViewportSize({ width: 768, height: 1024 });
    await expect(fake).toBeHidden();
    await fold.click();
    await expect(fake).toBeVisible();

    // 字号和按钮大小。
    const fontSize = await page.locator('.stop-text p').first().evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    expect(fontSize).toBeGreaterThanOrEqual(17);
    for (const button of await pane.locator('.stage-controls button:visible').all()) {
      expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
    expect((await page.getByRole('button', { name: '问讲解员' }).boundingBox())!.height).toBeGreaterThanOrEqual(44);

    // “问讲解员”在贴着底边的一整条里；滚到底，最后一行在这一条上面，没被挡住。
    const dock = (await page.locator('.guide-dock').boundingBox())!;
    expect(dock.width).toBeCloseTo(768, 0);
    expect(dock.y + dock.height).toBeCloseTo(1024, 0);
    await scrollToBottom(page);
    const lastLine = (await page.locator('.stop-nav-list').boundingBox())!;
    expect(lastLine.y + lastLine.height).toBeLessThanOrEqual(dock.y);
    // 滚到底，轮到最后一节。
    await expectStageAt(page, headings[headings.length - 1]);

    // 页面不会左右晃。
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });

  test('窄屏：读到半截画面断了，沙盘栏留在原处、还是那么高，那句话和“重新摆出来”就在眼前', async ({ page }) => {
    const { headings } = await openStopWithScene(page);
    await expectStageAt(page, headings[0]);
    const pane = stagePane(page);
    const open = (await pane.boundingBox())!;

    // 往下读到第三节，这时候画面断了。
    const reading = headings[Math.min(2, headings.length - 1)];
    await scrollToSection(page, reading);
    await expectStageAt(page, reading);
    const scrolled = await page.evaluate(() => window.scrollY);
    expect(scrolled).toBeGreaterThan(open.height);
    await page.evaluate(() => document.querySelector<HTMLElement>('.fake-stage-lose')?.click());
    await expect(pane).toHaveAttribute('data-stage-state', 'lost');

    // 沙盘栏还钉在顶上，和原来一样高；正文没有跟着跳。
    const lost = (await pane.boundingBox())!;
    expect(lost.y).toBeCloseTo(0, 0);
    expect(lost.height).toBeCloseTo(open.height, 0);
    expect(await pane.evaluate((el) => getComputedStyle(el).position)).toBe('sticky');
    expect(await page.evaluate(() => window.scrollY)).toBe(scrolled);
    // 那句话和按钮在屏幕上看得见，在题记的上面，不和它叠在一起。
    const message = pane.locator('.stage-message p');
    await expect(message).toHaveText(LOST);
    await expect(message).toBeInViewport();
    const rebuild = pane.locator('.stage-retry');
    await expect(rebuild).toBeInViewport();
    const rebuildBox = (await rebuild.boundingBox())!;
    expect(rebuildBox.height).toBeGreaterThanOrEqual(44);
    expect(rebuildBox.y + rebuildBox.height).toBeLessThanOrEqual((await pane.locator('.stage-caption').boundingBox())!.y);
    await expect(pane.locator('.stage-fold')).toHaveCount(0);

    // 重新摆出来：沙盘回来，直接摆着读到的那一节；正文还在原处。
    // （照着按钮的位置点，像手指那样；测试工具自己的“点这个元素”在点之前会把钉在顶上的东西滚回页面开头。）
    await page.mouse.click(rebuildBox.x + rebuildBox.width / 2, rebuildBox.y + rebuildBox.height / 2);
    await expectStageAt(page, reading);
    await expect(fakeStage(page)).toHaveAttribute('data-fake-animated', 'false');
    expect(await page.evaluate(() => window.scrollY)).toBe(scrolled);
    expect((await pane.boundingBox())!.height).toBeCloseTo(open.height, 0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });

  test('窄屏：没摆沙盘时（定格图、起不来）沙盘栏不钉在顶上，跟着页面滚走', async ({ page }) => {
    const { figureId, stopId } = await findStopWithScene(page);
    // 人物页：定格图或一句话。
    await expectStill(page);
    expect(await stagePane(page).evaluate((el) => getComputedStyle(el).position)).not.toBe('sticky');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    // 起不来的沙盘：一句话和按钮在最上面，下面接着是正文。
    await page.goto('about:blank');
    await page.goto(`/?stage=fake-fail#/${figureId}/${stopId}`);
    const pane = stagePane(page);
    await expect(pane).toHaveAttribute('data-stage-state', 'failed');
    await expect(pane.locator('.stage-message p')).toHaveText(FAILED);
    expect(await pane.evaluate((el) => getComputedStyle(el).position)).not.toBe('sticky');
    await expect(pane.locator('.stage-fold')).toHaveCount(0);
    const paneBox = (await pane.boundingBox())!;
    expect(paneBox.height).toBeLessThan(1024 * 0.5);
    const reading = (await page.locator('.reading').boundingBox())!;
    expect(reading.y).toBeGreaterThanOrEqual(paneBox.y + paneBox.height - 1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
});

// 窗口很矮的时候（电脑上把网页放大到两倍，1440 × 900 的屏幕就只有 720 × 450；也像横着拿、宽度不到 960 的平板）：
// 窄屏的排法，沙盘栏只有窗口的 56% 高，按钮那一排和题记之间剩不下几行。
test.describe('很矮的窗口（720×450：把网页放大到两倍）', () => {
  test.use({ viewport: { width: 720, height: 450 } });

  test('“说明”展开的那一块至少有 160 像素高：题记上面不够，就往下盖住题记；不出沙盘栏，不盖按钮；里面滚得动，“关闭”点得到', async ({ page }) => {
    const { headings } = await openStopWithScene(page);
    await expectStageAt(page, headings[0]);
    const pane = stagePane(page);
    await pane.locator('.stage-note-button').click();
    const panel = pane.locator('.stage-note-panel');
    await expect(panel).toBeVisible();
    const got = await pane.evaluate((el) => {
      const box = (selector: string) => {
        const r = el.querySelector(selector)!.getBoundingClientRect();
        return { top: r.top, bottom: r.bottom, height: r.height };
      };
      const inside = el.querySelector('.stage-note-panel')!;
      const r = el.getBoundingClientRect();
      return { pane: { top: r.top, bottom: r.bottom, height: r.height }, panel: box('.stage-note-panel'), controls: box('.stage-controls'), caption: box('.stage-caption'), inside: inside.scrollHeight, shown: inside.clientHeight };
    });
    // 这个窗口上题记上面只剩下五十来像素：真的是不够的情形
    expect(got.caption.top - got.controls.bottom, '这个窗口上按钮和题记之间本来就够高，查不到东西').toBeLessThan(100);
    expect(got.panel.height, '展开的那一块只剩一条缝').toBeGreaterThanOrEqual(159);
    expect(got.panel.top, '盖住了按钮那一排').toBeGreaterThanOrEqual(got.controls.bottom - 0.5);
    expect(got.panel.bottom, '伸到沙盘栏外面去了').toBeLessThanOrEqual(got.pane.bottom);
    expect(got.panel.bottom, '不够高的时候是往下盖住题记').toBeGreaterThan(got.caption.top);
    // 放不下的在里面滚；“关闭”就在眼前，点了收起，焦点回到“说明”上（它又露出来了）
    expect(got.inside).toBeGreaterThan(got.shown);
    const close = panel.locator('.stage-note-close');
    await expect(close).toBeInViewport();
    await close.click();
    await expect(panel).toHaveCount(0);
    await expect(pane.locator('.stage-note-button')).toBeFocused();
  });

  test('按钮下面还有一行话的时候（放的是图片）地方更少：展开的那一块盖到题记的下边为止，不伸到沙盘栏外面，也不盖那一行话', async ({ page }) => {
    const found = await findStopWithScene(page);
    await page.goto('about:blank');
    await page.goto('/?stage=fake-unsupported&sectionstills=fake#/' + found.figureId + '/' + found.stopId);
    const pane = stagePane(page);
    await expect(pane).toHaveAttribute('data-stage-picture', 'still');
    await expect(pane.locator('.stage-notice')).toBeVisible();
    await pane.locator('.stage-note-button').click();
    const panel = pane.locator('.stage-note-panel');
    await expect(panel).toBeVisible();
    const got = await pane.evaluate((el) => {
      const box = (selector: string) => {
        const r = el.querySelector(selector)!.getBoundingClientRect();
        return { top: r.top, bottom: r.bottom, height: r.height };
      };
      const r = el.getBoundingClientRect();
      return { paneBottom: r.bottom, panel: box('.stage-note-panel'), notice: box('.stage-notice'), caption: box('.stage-caption') };
    });
    expect(got.panel.bottom, '伸到沙盘栏外面去了（下边被裁掉）').toBeLessThanOrEqual(got.paneBottom);
    expect(got.panel.top, '盖住了按钮下面的那一行话').toBeGreaterThanOrEqual(got.notice.bottom - 0.5);
    expect(got.panel.bottom, '该一直盖到题记的下边').toBeGreaterThan(got.caption.bottom - 8);
    expect(got.panel.height, '展开的那一块只剩一条缝').toBeGreaterThanOrEqual(140);
    await expect(panel.locator('.stage-note-close')).toBeInViewport();
  });
});

test.describe('竖着拿的平板（768×1024）：焦点落到钉着的沙盘栏里', () => {
  test.use({ viewport: { width: 768, height: 1024 } });

  test('页面不跳：点“说明”再点“关闭”；用键盘一个一个走到栏里的按钮上。焦点回到正文里，走到的东西照旧不被栏挡住', async ({ page }) => {
    const { headings } = await openStopWithScene(page);
    await expectStageAt(page, headings[0]);
    const pane = stagePane(page);
    const at = () => page.evaluate(() => Math.round(window.scrollY));
    expect(await pane.evaluate((el) => getComputedStyle(el).position)).toBe('sticky');
    // 读到半截
    await page.evaluate(() => window.scrollTo(0, 1200));
    await expect.poll(at).toBe(1200);
    await twoFrames(page);

    // 用手（或者鼠标）：点“说明”，再点展开的那一块里的“关闭”，焦点回到“说明”按钮上。
    // 照着按钮在屏幕上的位置点下去，像手指和鼠标那样（测试工具自己的“点一下”会先把按钮“滚到看得见的地方”，那正是要查的那一跳）
    const press = async (target: Locator): Promise<void> => {
      const box = (await target.boundingBox())!;
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    };
    const noteButton = pane.locator('.stage-note-button');
    await press(noteButton);
    const panel = pane.locator('.stage-note-panel');
    await expect(panel).toBeVisible();
    expect(await at(), '点“说明”，页面跳了').toBe(1200);
    await press(panel.locator('.stage-note-close'));
    await expect(panel).toHaveCount(0);
    await expect(noteButton).toBeFocused();
    await twoFrames(page);
    expect(await at(), '点“说明”再点“关闭”，页面跳了').toBe(1200);

    // 用键盘：底下那一条的最后一格再往后，就是栏里的按钮。一个一个走过去，页面都不动
    await page.locator('.guide-dock .walk-link.is-next').focus();
    await twoFrames(page);
    const base = await at();
    const reached: string[] = [];
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press('Tab');
      const where = await page.evaluate(() => {
        const el = document.activeElement;
        return el && el !== document.body && el.closest('.stage-pane') ? (el.textContent ?? '') : null;
      });
      if (where === null) break;
      reached.push(where);
      await twoFrames(page);
      expect(await at(), '焦点到了栏里的“' + where + '”上，页面跳了').toBe(base);
    }
    expect(reached, '用键盘走到了栏里的按钮').toEqual(expect.arrayContaining(['古名', '今名', '收起沙盘', '说明']));

    // 程序把焦点放到栏自己身上（“到沙盘”那一步做的事）：也不跳
    await pane.evaluate((el: HTMLElement) => el.focus());
    await twoFrames(page);
    expect(await at(), '焦点放到沙盘栏上，页面跳了').toBe(base);

    // 焦点回到正文里：上面那一截照旧算数。找一样被钉着的栏挡住的、走得到的东西，把焦点放上去，它该滚到栏的下面来
    const shown = await page.evaluate(() => {
      const paneBottom = document.querySelector('.stage-pane')!.getBoundingClientRect().bottom;
      const all = Array.from(document.querySelectorAll<HTMLElement>('.stop-page .note-term, .stop-page summary'));
      const hidden = all.find((el) => {
        const r = el.getBoundingClientRect();
        return r.top > 0 && r.bottom < paneBottom - 40;
      });
      if (!hidden) return null;
      hidden.focus();
      return { top: hidden.getBoundingClientRect().top, paneBottom };
    });
    expect(shown, '正文里没有找到一样被栏挡住的东西，这一步查不到').not.toBeNull();
    expect(shown!.top, '焦点到了正文里被栏挡住的东西上，它没有滚出来').toBeGreaterThanOrEqual(shown!.paneBottom);
  });
});

test.describe('系统设置了“减少动态效果”', () => {
  test.use({ contextOptions: { reducedMotion: 'reduce' } });

  test('把这个设置告诉沙盘；换小节时不滑', async ({ page }) => {
    const { headings } = await openStopWithScene(page);
    test.skip(headings.length < 3, '这一站的小节太少，测不了换小节');
    await expectStageAt(page, headings[0]);
    const fake = fakeStage(page);
    await expect(fake).toHaveAttribute('data-fake-reduced-motion', 'true');

    await scrollToSection(page, headings[2]);
    await expectStageAt(page, headings[2]);
    await expect(fake).toHaveAttribute('data-fake-section', headings[2]);
    await expect(fake).toHaveAttribute('data-fake-animated', 'false');
  });

  // 沙盘栏宽窄不同的几种屏幕（换小节不滑，走得快）：
  //   1024×768  平板横放：沙盘栏 584 宽，栏宽的排法里最窄的一档
  //   1180×820  大一些的平板横放
  //   768×1024  平板竖放：沙盘在上，栏和屏幕一样宽
  //   360×740   很窄的栏（不到 584 像素宽）：题记和说明用短写法的那一种。不是为手机调什么，只是短写法要有一处查
  for (const size of [
    { width: 1024, height: 768 },
    { width: 1180, height: 820 },
    { width: 768, height: 1024 },
    { width: 360, height: 740 },
  ]) {
    test(`${size.width}×${size.height}：每一小节题记那一块都一样高，题记、说明、远处都看得全，沙盘四边留的空不变`, async ({ page }) => {
      await page.setViewportSize(size);
      const { headings } = await openStopWithScene(page);
      await expectStageAt(page, headings[0]);
      const pane = stagePane(page);
      const caption = pane.locator('.stage-caption');
      const paneBox = (await pane.boundingBox())!;
      const wide = paneBox.width >= STRIP_NARROW_BELOW_PX;
      const start = await captionHeightAndInsets(page);
      // 题记这一块不到沙盘栏的三分之一高。
      expect(start.height).toBeLessThan(paneBox.height / 3);
      // 很窄的栏上，比例尺换了一段短的（替身报的是“2 公里”宽 96 像素，这里写成“1 公里”宽 48 像素）
      if (!wide) {
        await expect(pane.locator('.stage-scale-label')).toHaveText('1 公里');
        expect((await pane.locator('.stage-scale-bar').boundingBox())!.width).toBeCloseTo(48, 0);
      }

      for (const [i, heading] of headings.entries()) {
        if (i === headings.length - 1) await scrollToBottom(page);
        else if (i > 0) await scrollToSection(page, heading);
        await expectStageAt(page, heading);
        await expect(caption).toHaveAttribute('data-section', heading);
        const label = `${size.width}×${size.height} “${heading}”`;
        expect(await captionHeightAndInsets(page), label).toEqual(start);
        await expectBottomInsetIsFoot(page);

        // 第一行：小节名和时间没有被比例尺挤掉。
        expect(await shownInFull(caption.locator('.stage-caption-title')), label).toBe(true);
        // 说明：栏宽时是最多两行的 short，栏窄时是一行的 brief；都是整句看得见。
        const note = caption.locator(wide ? '.stage-note-short' : '.stage-note-brief');
        await expect(note).toBeVisible();
        await expect(caption.locator(wide ? '.stage-note-brief' : '.stage-note-short')).toBeHidden();
        expect(await shownInFull(note), label).toBe(true);
        expect(await rowsOf(note), label).toBeLessThanOrEqual(wide ? 2 : 1);
        // 一行的短写法写的是：示意的有几样、平地修整过、山高夸大了几倍、模型和河放大了
        if (!wide) await expect(note).toHaveText(/^\d+ 样是示意；平地修整过；山高夸大 \d+(\.\d+)? 倍；模型和河放大了$/);
        expect(await note.evaluate((el) => parseFloat(getComputedStyle(el).fontSize)), label).toBeGreaterThanOrEqual(11);
        // 题记：栏宽时一行，栏窄时连同远处最多两行；都是整句看得见。
        const line = caption.locator('.stage-line');
        await expect(line).toBeVisible();
        if (wide) {
          expect(await shownInFull(line), label).toBe(true);
          expect(await rowsOf(line), label).toBe(1);
          for (const far of await caption.locator('.stage-far li').all()) expect(await shownInFull(far), label).toBe(true);
        } else {
          expect(await shownInFull(caption.locator('.stage-words')), label).toBe(true);
        }
        // 这一块里的东西都没有超出它的框。
        expect(await caption.evaluate((el) => el.scrollHeight <= el.clientHeight + 1), label).toBe(true);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    });
  }
});

test('宽屏的正文字号不小于 18px', async ({ page }) => {
  await openWrittenStop(page);
  const fontSize = await page.locator('.stop-text p').first().evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  expect(fontSize).toBeGreaterThanOrEqual(18);
  const lineHeight = await page.locator('.stop-text p').first().evaluate((el) => parseFloat(getComputedStyle(el).lineHeight));
  expect(lineHeight / fontSize).toBeGreaterThan(1.8);
});
