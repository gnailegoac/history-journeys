// 内容的清单那一小块（src/domain/contentLists.ts）没取到、取得慢的时候，页面是什么样。
// 这一小块里是每位人物的每个文件怎么读（各站的文件、场景文件、两种清单……）：页面的程序一开始跑就去要它，
// 读一座沙盘、读一站的正文都要先等它到。页面一打开就下载的那一块里只留首页的卡片和每位人物的 figure.json。
// 这里把它的请求拦下来（断掉，或者压住不放），在首页、人物页、一站的页面上各看一遍：
//   没取到：页面说的话和一个内容文件没取到时一样——卡片、人物的资料照常（它们不靠这一小块），沙盘栏里一句话和“再试一次”，
//           写好了的一站，正文那一栏是“这一站的正文没能读出来。”（沙盘栏的那一句这时候不说“正文可以照常读”）；
//           点“再试一次”真的再取一遍，沙盘摆出来，没读出来的正文也重读出来；
//   取得慢：页面先是等着的样子（卡片、目录照常，沙盘栏空着等，写好了的一站正文“正文加载中…”），不说“没能……”；到了就照常。
//   还没写正文的一站（有自己的沙盘的，没有的）：正文那一栏不靠这一小块——它没取到、取得慢，那一栏都是“这一站的正文还没写。”，
//           同挪出清单以前一样；不说“没能读出来”，也不停在“正文加载中…”。
// 沙盘用的是替身（?stage=fake）：这里看的是内容读不读得到，不是沙盘画得怎么样。
// 整个版面在假 DOM 里的那一半（沙盘和正文都没读出来、再试一次）在 tests/unit/page/page-behaviour.test.tsx。

import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { readBytes } from '../support/readBytes';
import { fakeUrl, firstOpenFigureOnDisk, roadOf, routeOnDisk, sceneOnDisk, stagePane, stopsWithScenes } from './helpers';

/** 那一小块的请求：构建出来的叫 contentLists-<一串字符>.js，开发服务上是源文件。 */
const LISTS_REQUEST = /\/contentLists(-[\w-]+)?\.(js|ts)(\?.*)?$/;

const FIGURE = firstOpenFigureOnDisk();
/** 一站写好了正文、又有自己的沙盘的站：这一位人物的头一个。 */
const STOP = stopsWithScenes().find((one) => one.figureId === FIGURE && one.written) ?? null;

const PAGES = [
  { name: '首页', hash: () => '#/' },
  { name: '人物页', hash: () => `#/${FIGURE}` },
  { name: '一站的页面（写好了正文、有自己的沙盘）', hash: () => `#/${FIGURE}/${STOP?.stopId}` },
] as const;

const FAILED_TEXT = '这一站的正文没能读出来。';
/** 还没写正文的一站，正文那一栏的那一句：前半句一上来就有；后半句看沙盘（它自己的沙盘读出来了，或者摆着全程沙盘上的来路）。 */
const LEAF_FIRST = '这一站的正文还没写。';
const LEAF_OWN = '按下面的一行，沙盘就换到那一处；各处的时间写在每一行里，不一定都在上面这几年里。';
const LEAF_ROAD = '沙盘上是到这一站的来路。';
/** 没有正文可读的时候（还没写，或者这一次没读出来），沙盘栏说的那一句：不带“正文可以照常读”。 */
const PANE_FAILED_NO_TEXT = '沙盘没能摆出来。';

/**
 * 这位人物还没写正文的两种站，照 figure.json 和 content/ 里有没有场景文件找，各取头一个：
 * own 有自己的沙盘（眉州）；road 没有，全程沙盘上有到它去的那一节（沙盘栏里摆的是来路）。没有这样的站是 null，查它的那几条自己跳过。
 */
function unwrittenStops(): { own: string | null; road: string | null } {
  if (FIGURE === null) return { own: null, road: null };
  const figure = JSON.parse(new TextDecoder().decode(readBytes(`content/figures/${FIGURE}/figure.json`))) as { stops: { id: string; status?: string }[] };
  const route = routeOnDisk(FIGURE);
  const leaves = figure.stops.filter((stop) => stop.status !== 'complete').map((stop) => stop.id);
  return {
    own: leaves.find((id) => sceneOnDisk(FIGURE, id) !== null) ?? null,
    road: leaves.find((id) => sceneOnDisk(FIGURE, id) === null && route !== null && roadOf(route, id) !== null) ?? null,
  };
}
const LEAVES = unwrittenStops();
const LEAF_PAGES = [
  { name: '有自己的沙盘', stop: LEAVES.own, rest: LEAF_OWN },
  { name: '没有自己的沙盘（摆着全程沙盘上的来路）', stop: LEAVES.road, rest: LEAF_ROAD },
] as const;

/** 还没写正文的一站照常的样子：沙盘摆好了（它自己的，或者全程沙盘），那一句的后半句也在；有自己的沙盘的，单子在。 */
async function expectLeafWhole(page: Page, leaf: (typeof LEAF_PAGES)[number]): Promise<void> {
  const pane = stagePane(page);
  await expect(pane).toHaveAttribute('data-stage-state', 'ready');
  if (leaf.rest === LEAF_OWN) {
    await expect(pane).not.toHaveAttribute('data-stage-level', 'route');
    await expect(page.locator('.views .view-item').first()).toBeVisible();
  } else {
    await expect(pane).toHaveAttribute('data-stage-level', 'route');
  }
  // 认那一句自己（.not-written）：有自己的沙盘的一站，下面折着的凭据里另有一行不显出来的“加载中…”
  await expect(page.locator('.stop-page .not-written')).toHaveText(LEAF_FIRST + leaf.rest);
  await expect(page.locator('.stop-page')).toHaveAttribute('data-stop-text', 'none');
  await expect(pane.locator('.stage-retry')).toHaveCount(0);
}

/** 这一页上不靠那一小块的东西照常在：首页是卡片，人物页是各站的目录，一站的页面是抬头。 */
async function expectShell(page: Page, name: (typeof PAGES)[number]['name']): Promise<void> {
  if (name === '首页') {
    await expect(page.locator('a.card[data-available="true"]').first()).toBeVisible();
    await expect(page.locator('.home-title')).toBeVisible();
  } else if (name === '人物页') {
    await expect(page.locator('.stop-item').first()).toBeVisible();
    await expect(page.locator('.page-title')).toBeVisible();
  } else {
    await expect(page.locator('.stop-page')).toHaveAttribute('data-stop-id', STOP!.stopId);
    await expect(page.locator('.page-title')).toBeVisible();
    await expect(page.locator('.facts')).toBeVisible();
  }
}

/** 这一页照常的样子：沙盘摆好了（首页、人物页是全程沙盘，一站的页面是它自己的沙盘），一站的正文读出来了。 */
async function expectWhole(page: Page, name: (typeof PAGES)[number]['name']): Promise<void> {
  const pane = stagePane(page);
  await expect(pane).toHaveAttribute('data-stage-state', 'ready');
  if (name === '一站的页面（写好了正文、有自己的沙盘）') {
    await expect(pane).not.toHaveAttribute('data-stage-level', 'route');
    await expect(page.locator('.stop-page')).toHaveAttribute('data-stop-text', 'written');
    await expect(page.locator('.stop-page')).toHaveAttribute('data-stop-scene', 'yes');
    await expect(page.locator('.text-section').first()).toBeVisible();
    await expect(page.locator('.stop-page')).not.toContainText(FAILED_TEXT);
  } else {
    await expect(pane).toHaveAttribute('data-stage-level', 'route');
  }
  await expect(pane.locator('.stage-retry')).toHaveCount(0);
}

test.describe('内容的清单那一小块没取到', () => {
  for (const { name, hash } of PAGES) {
    test(`${name}：不靠它的东西照常；沙盘栏里一句话和“再试一次”${name.startsWith('一站') ? '，正文那一栏说“这一站的正文没能读出来。”' : ''}；点“再试一次”真的再取一遍，都读出来了`, async ({ page }) => {
      test.skip(FIGURE === null || STOP === null, 'content/ 里没有可以点进去的人物，或者他没有写好了正文又有沙盘的站');
      const uncaught: string[] = [];
      page.on('pageerror', (error) => uncaught.push(String(error)));
      // 断着的时候，要几次断几次；放开以后照常
      let cut = true;
      const asked: string[] = [];
      await page.route(LISTS_REQUEST, (routed) => {
        asked.push(cut ? 'cut' : 'through');
        return cut ? routed.abort() : routed.continue();
      });
      await page.goto(fakeUrl(hash()));

      // 不靠这一小块的东西照常在
      await expectShell(page, name);
      // 沙盘栏：没能摆出来，可以再试
      const pane = stagePane(page);
      await expect(pane).toHaveAttribute('data-stage-state', 'failed');
      await expect(pane.locator('.stage-message p')).toContainText('沙盘没能摆出来');
      const retry = pane.locator('.stage-retry');
      await expect(retry).toHaveText('再试一次');
      if (name.startsWith('一站')) {
        // 正文那一栏：和正文的文件没取到时是同一句
        await expect(page.locator('.stop-page')).toHaveAttribute('data-stop-text', 'none');
        await expect(page.locator('.stop-page .quiet')).toHaveText([FAILED_TEXT]);
        await expect(page.locator('.stop-page')).toHaveAttribute('data-stop-scene', 'failed');
        await expect(page.locator('.text-section')).toHaveCount(0);
        // 正文没读出来：沙盘栏的那一句不说“正文可以照常读”（两栏不说相反的话）
        await expect(pane.locator('.stage-message p')).toHaveText(PANE_FAILED_NO_TEXT);
      }
      // 页面一开始跑要过一次，读沙盘（和正文）的时候又要过：都断了
      expect(asked.length).toBeGreaterThanOrEqual(1);
      expect(asked).not.toContain('through');
      const before = asked.length;

      // 网通了。再试一次：真的再去取一遍，这一回取到了
      cut = false;
      await retry.click();
      await expectWhole(page, name);
      expect(asked.slice(before)).toContain('through');
      expect(asked.slice(before)).not.toContain('cut');
      // 没有哪个出错没人接（页面一开始跑的那一次没取到，不能成了“未处理的错误”）
      expect(uncaught).toEqual([]);
    });
  }

  test('页面一开始跑的那一次没取到、后面取得到：读者什么也看不出来——读沙盘的时候自己又取了一遍', async ({ page }) => {
    test.skip(FIGURE === null, 'content/ 里没有可以点进去的人物');
    const uncaught: string[] = [];
    page.on('pageerror', (error) => uncaught.push(String(error)));
    const asked: string[] = [];
    await page.route(LISTS_REQUEST, (routed) => {
      asked.push(asked.length === 0 ? 'cut' : 'through');
      return asked.length === 1 ? routed.abort() : routed.continue();
    });
    await page.goto(fakeUrl(`#/${FIGURE}`));
    await expectWhole(page, '人物页');
    expect(asked[0]).toBe('cut');
    expect(asked).toContain('through');
    expect(uncaught).toEqual([]);
  });
});

test.describe('内容的清单那一小块取得慢', () => {
  for (const { name, hash } of PAGES) {
    test(`${name}：先是等着的样子，不说“没能……”；到了就照常`, async ({ page }) => {
      test.skip(FIGURE === null || STOP === null, 'content/ 里没有可以点进去的人物，或者他没有写好了正文又有沙盘的站');
      const uncaught: string[] = [];
      page.on('pageerror', (error) => uncaught.push(String(error)));
      // 压住不放，叫放才放
      const held: (() => void)[] = [];
      let open = false;
      await page.route(LISTS_REQUEST, async (routed) => {
        if (!open) await new Promise<void>((resolve) => held.push(resolve));
        return routed.continue();
      });
      await page.goto(fakeUrl(hash()));

      // 不靠这一小块的东西先出来了
      await expectShell(page, name);
      // 等这一小块的请求真的发出去、被压住
      await expect.poll(() => held.length, { message: '那一小块的请求该发出去了' }).toBeGreaterThanOrEqual(1);
      // 沙盘栏等着：空着（只有底色），不说“没能摆出来”，没有“再试一次”
      const pane = stagePane(page);
      await expect(pane).toHaveAttribute('data-stage-state', 'loading');
      await expect(pane.locator('.stage-retry')).toHaveCount(0);
      await expect(pane.locator('.stage-message')).toHaveCount(0);
      if (name.startsWith('一站')) {
        await expect(page.locator('.stop-page')).toHaveAttribute('data-stop-text', 'loading');
        await expect(page.locator('.stop-page .quiet')).toHaveText(['正文加载中…']);
        await expect(page.locator('.stop-page')).toHaveAttribute('data-stop-scene', 'loading');
      }
      // 压了一会儿还是等着的样子，没有变成“没能……”
      await page.waitForTimeout(600);
      await expect(pane).toHaveAttribute('data-stage-state', 'loading');
      await expect(pane).not.toContainText('没能');
      await expect(page.locator('.reading')).not.toContainText('没能读出来');

      // 放开：照常
      open = true;
      for (const release of held) release();
      await expectWhole(page, name);
      expect(uncaught).toEqual([]);
    });
  }
});

// 还没写正文的一站没有正文文件（figure.json 里写着，规则 3 管着）：正文那一栏不去读，也不等那一小块。
// 挪出清单以前，这样的一站网怎么样都说“这一站的正文还没写。”；挪出以后还是。
test.describe('还没写正文的一站：正文那一栏不靠内容的清单那一小块', () => {
  for (const leaf of LEAF_PAGES) {
    test(`${leaf.name}，那一小块没取到：正文那一栏还是“这一站的正文还没写。”，不说“没能读出来”；沙盘栏里一句话和“再试一次”；点“再试一次”，沙盘摆出来，那一句的后半句也有了`, async ({ page }) => {
      test.skip(FIGURE === null || leaf.stop === null, 'content/ 里没有可以点进去的人物，或者他没有这样的站');
      const uncaught: string[] = [];
      page.on('pageerror', (error) => uncaught.push(String(error)));
      let cut = true;
      const asked: string[] = [];
      await page.route(LISTS_REQUEST, (routed) => {
        asked.push(cut ? 'cut' : 'through');
        return cut ? routed.abort() : routed.continue();
      });
      await page.goto(fakeUrl(`#/${FIGURE}/${leaf.stop}`));

      await expect(page.locator('.stop-page')).toHaveAttribute('data-stop-id', leaf.stop!);
      const pane = stagePane(page);
      await expect(pane).toHaveAttribute('data-stage-state', 'failed');
      await expect(pane.locator('.stage-message p')).toHaveText(PANE_FAILED_NO_TEXT);
      const retry = pane.locator('.stage-retry');
      await expect(retry).toHaveText('再试一次');
      // 正文那一栏：只有前半句（沙盘没摆出来，后半句不说）；不是“没能读出来”，也不是“正文加载中…”
      await expect(page.locator('.stop-page .quiet')).toHaveText([LEAF_FIRST]);
      await expect(page.locator('.stop-page')).toHaveAttribute('data-stop-text', 'none');
      await expect(page.locator('.reading')).not.toContainText('没能读出来');
      await expect(page.locator('.reading')).not.toContainText('正文加载中');
      expect(asked).not.toContain('through');
      const before = asked.length;

      // 网通了。再试一次：沙盘摆出来，那一句还是“还没写”，后半句有了
      cut = false;
      await retry.click();
      await expectLeafWhole(page, leaf);
      expect(asked.slice(before)).toContain('through');
      expect(asked.slice(before)).not.toContain('cut');
      await expect(page.locator('.reading')).not.toContainText('没能读出来');
      expect(uncaught).toEqual([]);
    });

    test(`${leaf.name}，那一小块取得慢：等着的只有沙盘栏，正文那一栏已经是“这一站的正文还没写。”，不停在“正文加载中…”；到了就照常`, async ({ page }) => {
      test.skip(FIGURE === null || leaf.stop === null, 'content/ 里没有可以点进去的人物，或者他没有这样的站');
      const uncaught: string[] = [];
      page.on('pageerror', (error) => uncaught.push(String(error)));
      const held: (() => void)[] = [];
      let open = false;
      await page.route(LISTS_REQUEST, async (routed) => {
        if (!open) await new Promise<void>((resolve) => held.push(resolve));
        return routed.continue();
      });
      await page.goto(fakeUrl(`#/${FIGURE}/${leaf.stop}`));

      await expect(page.locator('.stop-page')).toHaveAttribute('data-stop-id', leaf.stop!);
      await expect.poll(() => held.length, { message: '那一小块的请求该发出去了' }).toBeGreaterThanOrEqual(1);
      // 沙盘栏等着；正文那一栏不等：那一句已经在了
      const pane = stagePane(page);
      await expect(pane).toHaveAttribute('data-stage-state', 'loading');
      await expect(page.locator('.stop-page .quiet')).toHaveText([LEAF_FIRST]);
      await expect(page.locator('.stop-page')).toHaveAttribute('data-stop-text', 'none');
      await expect(page.locator('.reading')).not.toContainText('正文加载中');
      // 压了一会儿还是这样
      await page.waitForTimeout(600);
      await expect(pane).toHaveAttribute('data-stage-state', 'loading');
      await expect(page.locator('.stop-page .quiet')).toHaveText([LEAF_FIRST]);
      await expect(page.locator('.reading')).not.toContainText('正文加载中');
      await expect(page.locator('.reading')).not.toContainText('没能读出来');

      // 放开：照常
      open = true;
      for (const release of held) release();
      await expectLeafWhole(page, leaf);
      expect(uncaught).toEqual([]);
    });
  }
});
