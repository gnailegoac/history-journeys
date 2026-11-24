// 有自己的沙盘、正文还没写的一站（眉州是头一个）：文字栏里的那张单子“沙盘上看的几处”，在浏览器里才看得出来的几样。
// 沙盘用替身（?stage=fake），场景是 content/ 里这一站真的场景；四种标准的窗口各走一遍。
// 单子里有什么字、按一行以后哪些东西跟着变，在 Node 里查过了（tests/unit/page/page-behaviour.test.tsx）；这里只查：
//   一行有多高、在不在那一栏里，页面有没有横着的滚动条；
//   像读者那样用鼠标按一行（按的是屏幕上的那个点，不叫程序去“点这个元素”——那样浏览器会先把它滚到眼前），沙盘换过去；
//   沙盘在上的两种窗口：收起沙盘、把页面滚一截、再按一行——栏自己展开了，按的那一行还在看得见的那一块里（沙盘栏下面、底下那一条上面）；
//   用键盘：Tab 一个一个走的先后；走到的那一行不被钉着的沙盘栏挡住；回车就换到那一处，焦点留在那一行上；
//   一路上页面不出错。
//   按了哪一处不记在地址里，也不添浏览记录；
// 真沙盘上按一行换不换得过去，在 real-table.spec.ts 里（两档画质各一遍）。
//
// 量框、读属性都是等到它成立为止（expect.poll、toHaveAttribute）：刚按下去、刚展开的那一下，页面还没排完。

import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { STANDARD_PANES } from '../stage/support/standardPanes';
import { fakeUrl, fontsReady, stagePane, stopsWithScenes, twoFrames } from './helpers';

const WINDOWS = STANDARD_PANES.map((pane) => pane.window);
/** 头一个有自己的沙盘、正文还没写的站；没有这样的站，这个文件的测试都跳过。 */
const STOP = stopsWithScenes().find((one) => !one.written);
/** 一行至少多高（像素）：同目录里的一行一样，4rem。 */
const ROW_MIN = 64;

interface Box {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

/** 单子上第 index 行的框（照屏幕算）。 */
function rowBox(page: Page, index: number): Promise<Box> {
  return page.evaluate((i) => {
    const box = document.querySelectorAll('.views .view-item')[i].getBoundingClientRect();
    return { top: box.top, bottom: box.bottom, left: box.left, right: box.right };
  }, index);
}

/** 看得见文字的那一块，从哪到哪：沙盘钉在上面时从它的下边起，到底下那一条的上边止。 */
function freeBand(page: Page): Promise<{ top: number; bottom: number; narrow: boolean }> {
  return page.evaluate(() => {
    const pane = document.querySelector('.stage-pane')!;
    const leaf = document.querySelector('.reading')!.getBoundingClientRect();
    const paneBox = pane.getBoundingClientRect();
    const above = paneBox.left < leaf.right && paneBox.right > leaf.left;
    const dock = document.querySelector('.guide-dock');
    return { top: above ? Math.max(0, paneBox.bottom) : 0, bottom: dock ? dock.getBoundingClientRect().top : window.innerHeight, narrow: above };
  });
}

/** 把第 index 行滚到看得见的那一块的正中，再像读者那样在它的正中按一下鼠标。 */
async function pressRow(page: Page, index: number): Promise<void> {
  await page.evaluate((i) => {
    const pane = document.querySelector('.stage-pane')!.getBoundingClientRect();
    const leaf = document.querySelector('.reading')!.getBoundingClientRect();
    const top = pane.left < leaf.right && pane.right > leaf.left ? Math.max(0, pane.bottom) : 0;
    const dock = document.querySelector('.guide-dock');
    const bottom = dock ? dock.getBoundingClientRect().top : window.innerHeight;
    const box = document.querySelectorAll('.views .view-item')[i].getBoundingClientRect();
    window.scrollBy(0, box.top + box.height / 2 - (top + bottom) / 2);
  }, index);
  await twoFrames(page);
  const box = await rowBox(page, index);
  const band = await freeBand(page);
  const y = Math.min(Math.max((box.top + box.bottom) / 2, band.top + 4), band.bottom - 4);
  expect(y, `第 ${index + 1} 行滚到了看得见的地方`).toBeGreaterThan(box.top);
  expect(y).toBeLessThan(box.bottom);
  await page.mouse.click((box.left + box.right) / 2, y);
}

/** 现在摆着记号（aria-current）的是哪几行。 */
function currentRows(page: Page): Promise<(string | null)[]> {
  return page.locator('.views .view-item[aria-current="true"]').evaluateAll((items) => items.map((item) => item.getAttribute('data-view')));
}

test.describe('有自己的沙盘、正文还没写的一站：沙盘上看的几处', () => {
  test.skip(!STOP, '没有“有自己的沙盘、正文还没写”的站');

  for (const size of WINDOWS) {
    test(`窗口 ${size.width} × ${size.height}：单子的每一行够高、在那一栏里；按一行沙盘换过去；沙盘收起时按一行，栏自己展开、那一行还看得见；键盘走得通；页面不出错`, async ({ page }) => {
      const { figureId, stopId, scene } = STOP!;
      const names = scene.sections.map((section) => section.heading);
      const problems: string[] = [];
      page.on('pageerror', (error) => problems.push(`页面出错：${error.message}`));
      page.on('console', (message) => {
        if (message.type() === 'error') problems.push(`控制台报错：${message.text()}`);
      });
      await page.setViewportSize(size);
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.goto(fakeUrl(`#/${figureId}/${stopId}`));
      const pane = stagePane(page);
      const views = page.locator('.views');
      await expect(views).toBeVisible();
      await expect(pane).toHaveAttribute('data-stage-state', 'ready');
      await expect(pane).toHaveAttribute('data-stage-section', names[0]);
      await fontsReady(page);
      const where = `窗口 ${size.width} × ${size.height}，${stopId}`;
      const visited = await page.evaluate(() => history.length);

      // ---- 单子：一行一个按钮，顺序是场景里各处的顺序；头一行是摆着的，只有它带强调色的线和小标签
      const items = views.locator('.view-item');
      await expect(items).toHaveCount(names.length);
      expect(await items.evaluateAll((list) => list.map((item) => item.getAttribute('data-view')))).toEqual(names);
      expect(await currentRows(page)).toEqual([names[0]]);
      await expect(views.locator('.tag')).toHaveCount(1);
      await expect(items.first().locator('.tag')).toHaveText('正在看');
      await expect(page.locator('.stop-page h2.section-heading')).toHaveText('沙盘上看的几处');
      await expect(pane.locator('.stage-reset')).toHaveText('回到这一处');

      // ---- 每一行至少 64 像素高，左右都在文字那一栏里；页面没有横着的滚动条
      const column = await page.locator('.reading-inner').evaluate((el) => {
        const box = el.getBoundingClientRect();
        return { left: box.left, right: box.right };
      });
      const rows = await items.evaluateAll((list) =>
        list.map((item) => {
          const box = item.getBoundingClientRect();
          const style = getComputedStyle(item);
          return { height: box.height, left: box.left, right: box.right, rule: style.borderLeftColor, ruleWidth: style.borderLeftWidth };
        }),
      );
      console.log(`${where}：各行高 ${rows.map((row) => Math.round(row.height)).join('、')} 像素，文字那一栏 ${Math.round(column.right - column.left)} 像素宽`);
      for (const [i, row] of rows.entries()) {
        expect(row.height, `${where}：第 ${i + 1} 行的高`).toBeGreaterThanOrEqual(ROW_MIN);
        expect(row.left, `${where}：第 ${i + 1} 行的左边`).toBeGreaterThanOrEqual(column.left - 0.5);
        expect(row.right, `${where}：第 ${i + 1} 行的右边`).toBeLessThanOrEqual(column.right + 0.5);
      }
      // 摆着的那一行左边的线是强调色，别的行那道线是透明的；宽度都一样（换一处字不左右挪），都是 3 像素：
      // 这道线和键盘的焦点框现在是同一种颜色，靠样子分——线只在左边一道、3 像素，框是四边一圈、2 像素、离开 2 像素；线是两样里重的一样
      const accent = await page.evaluate(() => {
        const probe = document.createElement('i');
        probe.style.color = 'var(--color-accent)';
        document.body.appendChild(probe);
        const colour = getComputedStyle(probe).color;
        probe.remove();
        return colour;
      });
      expect(rows[0].rule, `${where}：摆着的那一行左边的线`).toBe(accent);
      for (const row of rows.slice(1)) expect(row.rule, `${where}：别的行左边的线`).toBe('rgba(0, 0, 0, 0)');
      expect(new Set(rows.map((row) => row.ruleWidth)).size).toBe(1);
      expect(rows[0].ruleWidth, `${where}：每一行左边那道线的宽`).toBe('3px');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${where}：页面有横着的滚动条`).toBe(true);

      // ---- 按第三行：记号换到它上面，沙盘换到那一处，题记也是那一处的
      await pressRow(page, 2);
      await expect.poll(() => currentRows(page), `${where}：按了第三行`).toEqual([names[2]]);
      await expect(pane).toHaveAttribute('data-stage-section', names[2]);
      await expect(pane.locator('.stage-caption')).toHaveAttribute('data-section', names[2]);
      await expect(items.nth(2).locator('.tag')).toHaveText('正在看');
      await expect(views.locator('.tag')).toHaveCount(1);

      // ---- 读者把沙盘转开了（替身的“挪一下镜头”：用程序点，不用鼠标——那个按钮在沙盘栏里，鼠标去点会把页面滚走）：
      //      再按摆着的那一行，画面回到这一处，栏里的“回到这一处”又变回不管用的样子；记号没有动
      const fake = pane.locator('.fake-stage');
      await page.evaluate(() => document.querySelector<HTMLElement>('.fake-stage-nudge')?.click());
      await expect(fake, `${where}：替身说镜头动过了`).toHaveAttribute('data-fake-moved', 'true');
      await expect(pane.locator('.stage-reset')).toHaveAttribute('aria-disabled', 'false');
      await pressRow(page, 2);
      await expect(fake, `${where}：按了摆着的那一行，画面该回来`).toHaveAttribute('data-fake-moved', 'false');
      await expect(pane.locator('.stage-reset')).toHaveAttribute('aria-disabled', 'true');
      expect(await currentRows(page)).toEqual([names[2]]);
      await expect(pane).toHaveAttribute('data-stage-section', names[2]);

      // ---- 沙盘在上的窗口：收起沙盘，把页面滚一截，再按第二行——栏自己展开，摆到第二处；按的那一行还在看得见的那一块里
      const band = await freeBand(page);
      if (band.narrow) {
        const fold = pane.locator('.stage-fold');
        const open = (await pane.boundingBox())!.height;
        const foldBox = (await fold.boundingBox())!;
        await page.mouse.click(foldBox.x + foldBox.width / 2, foldBox.y + foldBox.height / 2);
        await expect(fold).toHaveAttribute('aria-expanded', 'false');
        await expect.poll(async () => (await pane.boundingBox())!.height, `${where}：栏收起来了`).toBeLessThan(open / 2);
        await pressRow(page, 1);
        await expect(fold, `${where}：沙盘收起时按了第二行，栏该自己展开`).toHaveAttribute('aria-expanded', 'true');
        await expect.poll(() => currentRows(page)).toEqual([names[1]]);
        await expect(pane).toHaveAttribute('data-stage-section', names[1]);
        await expect.poll(async () => (await pane.boundingBox())!.height, `${where}：栏展开了`).toBeGreaterThan(open - 2);
        await expect
          .poll(
            async () => {
              const box = await rowBox(page, 1);
              const free = await freeBand(page);
              return box.top >= free.top - 0.5 && box.bottom <= free.bottom + 0.5;
            },
            { message: `${where}：栏展开以后，按的那一行整个在沙盘栏下面、底下那一条上面` },
          )
          .toBe(true);
        const after = await rowBox(page, 1);
        const free = await freeBand(page);
        console.log(`${where}：栏展开以后，按的那一行在 ${Math.round(after.top)} 到 ${Math.round(after.bottom)}，看得见的那一块是 ${Math.round(free.top)} 到 ${Math.round(free.bottom)}`);
      }

      // ---- 用键盘：从标题起 Tab 一个一个走——“到沙盘”，单子的各行，凭据，回到各站目录，来源，底下那一条里的链接，然后才是沙盘栏的按钮
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.locator('.page-title').focus();
      const focused = (): Promise<string> =>
        page.evaluate(() => {
          const el = document.activeElement as HTMLElement | null;
          if (!el) return '';
          if (el.classList.contains('view-item')) return `view:${el.getAttribute('data-view')}`;
          if (el.closest('.stage-pane')) return 'pane';
          if (el.closest('.guide-dock')) return 'dock';
          return el.className ? `.${el.className.split(' ')[0]}` : el.localName;
        });
      const walked: string[] = [];
      for (let i = 0; i < names.length + 12; i += 1) {
        await page.keyboard.press('Tab');
        const at = await focused();
        walked.push(at);
        if (at.startsWith('view:')) {
          // 走到的这一行整个看得见：没有被钉着的沙盘栏、底下那一条挡住
          await expect
            .poll(
              async () => {
                const index = names.indexOf(at.slice(5));
                const box = await rowBox(page, index);
                const free = await freeBand(page);
                return box.top >= free.top - 0.5 && box.bottom <= free.bottom + 0.5;
              },
              { message: `${where}：用键盘走到“${at.slice(5)}”那一行，它该整个看得见` },
            )
            .toBe(true);
          // 走到的这一行画着焦点的框（页面上别处一样的那一种：两个像素的实线，离开两个像素）：这一行是没有边、没有底色的按钮，
          // 框是键盘上唯一看得出“现在在哪”的东西
          await expect
            .poll(
              () =>
                page.evaluate(() => {
                  const style = getComputedStyle(document.activeElement as HTMLElement);
                  return `${style.outlineStyle} ${Math.round(parseFloat(style.outlineWidth))}`;
                }),
              { message: `${where}：用键盘走到“${at.slice(5)}”那一行，它该画着焦点的框` },
            )
            .toBe('solid 2');
        }
        if (at === 'pane') break;
      }
      const docks = walked.filter((at) => at === 'dock').length;
      expect(docks, `${where}：底下那一条里有上一站、下一站的链接`).toBeGreaterThan(0);
      expect(walked, `${where}：Tab 走的先后`).toEqual(['.skip-to-stage', ...names.map((name) => `view:${name}`), 'summary', '.stop-nav-list', '.stop-nav-sources', ...Array.from({ length: docks }, () => 'dock'), 'pane']);

      // ---- 回车：焦点放在最后一行上按回车，换到那一处，焦点还在那一行上（下一步 Tab 接着往下走）
      const last = names.length - 1;
      await items.nth(last).focus();
      await page.keyboard.press('Enter');
      await expect.poll(() => currentRows(page), `${where}：在最后一行上按了回车`).toEqual([names[last]]);
      await expect(pane).toHaveAttribute('data-stage-section', names[last]);
      expect(await focused()).toBe(`view:${names[last]}`);
      // 空格也一样：回到头一行
      await items.first().focus();
      await page.keyboard.press('Space');
      await expect.poll(() => currentRows(page)).toEqual([names[0]]);
      await expect(pane).toHaveAttribute('data-stage-section', names[0]);

      // ---- 地址没有变（按了哪一处不记在地址里），也没有添浏览记录（按“返回”是离开这一站，不是回到上一处）；页面一路上没有出错
      expect(new URL(page.url()).hash).toBe(`#/${figureId}/${stopId}`);
      expect(await page.evaluate(() => history.length), `${where}：按了几行以后浏览记录的条数`).toBe(visited);
      expect(problems, `${where}：页面上的报错`).toEqual([]);
    });
  }
});
