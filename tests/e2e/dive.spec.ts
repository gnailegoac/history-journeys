// 从全程沙盘到一站自己的沙盘：先潜下去，再换页（src/ui/dive.ts，沙盘程序的 dive）。真沙盘，指定画质（不受机器快慢影响）。
// 查的是先后，不是画面：点下去的那一刻地址没有变、沙盘栏写上 data-stage-dive；潜完地址才是那一站的，那一站的沙盘照常摆出来；
// 从首页的印、人物页的印、目录里的链接都一样；点第二下不多换一页；潜到一半按返回，马上回去，以后也不再换；?dive=none 一点就换。
// 一路上的事由页面里的一个记事的记下来（记号什么时候出来、那时候地址是什么、地址什么时候变），不数画了几帧，也不只读一次。
// 潜的画面拍在 tests/shots/e-dive/（不进仓库）。运行：npx playwright test tests/e2e/dive.spec.ts

import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { DIVE_GUARD_MS } from '../../src/ui/diveClock';
import { expectRealTable, fakeUrl, realUrl, roadOf, routeOnDisk, sceneOnDisk, stagePane, stopsWithScenes } from './helpers';

const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};

/**
 * 潜的各项按的是哪一站：全程沙盘上排在最前面的、有自己的沙盘、正文也写好了的一站（现在是徐州）；没有是空字符串。
 * 有自己的沙盘、正文还没写的站（眉州）按了也会潜：那一种另有一项（文件末尾），按的是 unwrittenDiveStopOnDisk 挑出来的站。
 */
function diveStopOnDisk(figureId: string): string {
  const written = new Set(stopsWithScenes().filter((one) => one.figureId === figureId && one.written).map((one) => one.stopId));
  return routeOnDisk(figureId)?.sections.find((section) => section.stop && written.has(section.stop))?.stop ?? '';
}

/**
 * 有自己的沙盘、正文还没写的站里，全程沙盘上排在最前面的一个（现在是眉州，全程沙盘的头一站）；没有是空字符串。
 * 各站的正文都写好的那一天没有这样的站了，查它的那一项自己跳过。
 */
function unwrittenDiveStopOnDisk(figureId: string): string {
  const unwritten = new Set(stopsWithScenes().filter((one) => one.figureId === figureId && !one.written).map((one) => one.stopId));
  return routeOnDisk(figureId)?.sections.find((section) => section.stop && unwritten.has(section.stop))?.stop ?? '';
}

/** 等全程沙盘摆好最多多久（毫秒）：发布流程的机器用软件画。 */
const READY_MS = 120_000;

interface Note {
  at: number;
  what: string;
  hash: string;
}

/** 在页面里装一个记事的：点了一下、栏上的记号出来了（那时候地址是什么）、地址变了，各记一笔，带着钟点。 */
async function watchDive(page: Page): Promise<void> {
  await page.evaluate(() => {
    const log: { at: number; what: string; hash: string }[] = [];
    (window as unknown as { __diveLog: typeof log }).__diveLog = log;
    const note = (what: string): void => void log.push({ at: performance.now(), what, hash: location.hash });
    let last: string | null = null;
    new MutationObserver(() => {
      const now = document.querySelector('.stage-pane')?.getAttribute('data-stage-dive') ?? null;
      if (now !== last) note(now === null ? 'mark off' : `mark ${now}`);
      last = now;
    }).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-stage-dive'] });
    // 没有沙盘栏的那一种版面上的“加载中…”：潜过去的路上不该出来
    new MutationObserver(() => {
      if (document.querySelector('main.plain-page') && !log.some((n) => n.what === 'plain page')) note('plain page');
    }).observe(document.body, { subtree: true, childList: true });
    window.addEventListener('hashchange', () => note('hash'));
    document.addEventListener('click', () => note('click'), true);
  });
}

const notes = (page: Page): Promise<Note[]> => page.evaluate(() => (window as unknown as { __diveLog: Note[] }).__diveLog.slice());
const hashNow = (page: Page): Promise<string> => page.evaluate(() => location.hash);

/** 这个浏览器有没有 WebGL2。没有时：发布流程里算没通过，自己的机器上跳过。 */
async function needWebGL2(page: Page): Promise<void> {
  const has = await page.evaluate(() => {
    try {
      return document.createElement('canvas').getContext('webgl2') !== null;
    } catch {
      return false;
    }
  });
  if (env.CI) expect(has, '发布流程的浏览器没有 WebGL2：潜下去一次也没有试过，不能算通过').toBe(true);
  else test.skip(!has, '这个浏览器没有 WebGL2');
}

/** 打开首页，等真的全程沙盘摆好；返回第一位人物和他第一个有自己的沙盘的站。没有全程沙盘、没有这样的站，这一项跳过（发布流程里算没通过）。 */
async function openHome(page: Page, extra = ''): Promise<{ figureId: string; stopId: string }> {
  await page.setViewportSize({ width: 1024, height: 640 });
  await page.goto(realUrl('#/', 'full', extra));
  await needWebGL2(page);
  const card = page.locator('a.card[data-available="true"]').first();
  await expect(card).toBeVisible();
  const figureId = (await card.getAttribute('data-figure-id')) ?? '';
  // 有自己的沙盘的一站：从全程沙盘的场景里找（到哪几站去），要 content/ 里真有那一站的场景文件
  const stopId = diveStopOnDisk(figureId);
  if (env.CI) expect(stopId, '发布流程里没有“全程沙盘加一站自己的沙盘”：潜下去一次也没有试过，不能算通过').not.toBe('');
  else test.skip(stopId === '', '还没有“全程沙盘加一站自己的沙盘”');
  // 有自己的沙盘的站不止一个了（眉州、徐州、黄州）：按的是全程沙盘上排在最前面的、正文也写好了的那一个，说出来是哪一站
  const all = (routeOnDisk(figureId)?.sections ?? []).map((section) => section.stop).filter((stop): stop is string => !!stop && sceneOnDisk(figureId, stop) !== null);
  console.log(`[潜] 这一项按的是 ${stopId}；有自己的沙盘、按了也会潜的站：${all.join('、')}`);
  await routeUp(page);
  return { figureId, stopId };
}

/** 等栏里的全程沙盘摆好，放着的是立体的沙盘。 */
async function routeUp(page: Page): Promise<void> {
  const pane = stagePane(page);
  await expect(pane).toHaveAttribute('data-stage-level', 'route', { timeout: READY_MS });
  await expectRealTable(page, 'full', READY_MS);
}

/** 从首页进人物页，等全程沙盘摆好（人物页和首页的版面不是同一个，沙盘要重摆一次）。 */
async function toFigure(page: Page): Promise<void> {
  await page.locator('a.card[data-available="true"]').first().click();
  await expect(page.locator('.stop-item').first()).toBeVisible();
  await routeUp(page);
}

/** 沙盘上这一站的印里，找一方真的按得到的（没被别的东西盖住），返回它的中心。 */
async function sealPoint(page: Page, stopId: string): Promise<{ x: number; y: number }> {
  const find = (): Promise<{ x: number; y: number } | null> =>
    page.evaluate((id) => {
      for (const seal of Array.from(document.querySelectorAll<HTMLElement>(`.stage-host .strip-seal[data-stop-id="${id}"]`))) {
        const r = seal.getBoundingClientRect();
        const x = r.left + r.width / 2;
        const y = r.top + r.height / 2;
        if (document.elementFromPoint(x, y)?.closest('.strip-seal') === seal) return { x, y };
      }
      return null;
    }, stopId);
  await expect.poll(find, { message: `沙盘上要有一方按得到的“${stopId}”的印` }).not.toBeNull();
  return (await find())!;
}

/**
 * 潜完以后的那几样：记号出来的时候地址还是原来的；地址是照钟点换的（不早于记号出来以后 0.8 秒），只换了一次；
 * 从点下去到换地址用了多久只印出来，不设上限：到点一定放行是用假的钟在 tests/unit/dive.test.ts 里查的，
 * 这里的机器画一帧要多久不由我们定（发布流程的机器用软件画，比这里慢一倍）。
 * 现在的地址是那一站的，栏里是那一站自己的沙盘，照常摆好；记号没有了；头一张图片是按“潜过来的”放的；一路上没有换成没有沙盘栏的那一种版面。
 */
async function expectArrived(page: Page, figureId: string, stopId: string, from: string, where: string): Promise<void> {
  const there = `#/${figureId}/${stopId}`;
  await expect.poll(async () => (await notes(page)).some((n) => n.what === `mark ${stopId}`), { message: `${where}：沙盘栏上要写上正往哪一站潜` }).toBe(true);
  await expect.poll(() => hashNow(page), { message: `${where}：潜完地址换成那一站的` }).toBe(there);
  const log = await notes(page);
  const click = log.find((n) => n.what === 'click')!;
  const mark = log.find((n) => n.what === `mark ${stopId}`)!;
  const hashes = log.filter((n) => n.what === 'hash');
  expect(mark.hash, `${where}：记号出来的时候地址还没有变`).toBe(from);
  expect(hashes, `${where}：地址只换一次`).toHaveLength(1);
  expect(hashes[0].hash).toBe(there);
  expect(hashes[0].at - mark.at, `${where}：不到钟点不换地址`).toBeGreaterThanOrEqual(800);
  console.log(`${where}：点下去 ${Math.round(mark.at - click.at)} 毫秒以后栏上写了记号，再过 ${Math.round(hashes[0].at - mark.at)} 毫秒换了地址（从点下去算起 ${Math.round(hashes[0].at - click.at)} 毫秒）`);

  const pane = stagePane(page);
  await expect(page.locator('.stop-page')).toHaveAttribute('data-stop-id', stopId);
  await expect(pane).not.toHaveAttribute('data-stage-level', 'route');
  await expect(pane).not.toHaveAttribute('data-stage-dive', /./);
  await expect(pane.locator('.stage-still-host')).toHaveClass(/is-(coming|arriving)/);
  await expectRealTable(page, 'full', READY_MS);
  await expect(pane.locator('canvas')).toHaveCount(1);
  expect((await notes(page)).filter((n) => n.what === 'plain page'), `${where}：潜过去的路上没有换成没有沙盘栏的那一种“加载中…”`).toEqual([]);
}

test('潜下去：在人物页的沙盘上按一站的印，地址先不变、栏上写着正往哪一站潜，潜完才到那一站，那一站的沙盘照常摆好', async ({ page }) => {
  test.setTimeout(300_000);
  const { figureId, stopId } = await openHome(page);
  await toFigure(page);
  const here = await hashNow(page);
  const at = await sealPoint(page, stopId);
  await watchDive(page);
  await page.mouse.click(at.x, at.y);
  await expectArrived(page, figureId, stopId, here, '人物页的印');
});

test('潜下去：在首页的沙盘上按一站的印，也是潜完才到那一站', async ({ page }) => {
  test.setTimeout(300_000);
  const { figureId, stopId } = await openHome(page);
  const here = await hashNow(page);
  const at = await sealPoint(page, stopId);
  await watchDive(page);
  await page.mouse.click(at.x, at.y);
  await expectArrived(page, figureId, stopId, here, '首页的印');
});

test('潜下去：点目录里的链接也一样；紧接着再点一下，不多换一页', async ({ page }) => {
  test.setTimeout(300_000);
  const { figureId, stopId } = await openHome(page);
  await toFigure(page);
  const here = await hashNow(page);
  await watchDive(page);
  // 在页面里连点两下：点完的那一刻地址还是原来的（浏览器换地址是当场的事，潜的时候它被拦下了）
  const after = await page.locator(`.stop-item[data-stop-id="${stopId}"]`).evaluate((link: HTMLElement) => {
    const before = history.length;
    link.click();
    link.click();
    return { hash: location.hash, before };
  });
  expect(after.hash, '点完的那一刻地址还没有变').toBe(here);
  await expectArrived(page, figureId, stopId, here, '目录里的链接，连点两下');
  expect(await page.evaluate(() => history.length), '只多了一页').toBe(after.before + 1);
  // 再等过“到点了一定放行”的那个钟点：没有第二次换地址
  await page.waitForTimeout(DIVE_GUARD_MS + 300);
  expect((await notes(page)).filter((n) => n.what === 'hash')).toHaveLength(1);
});

test('正在潜的时候按返回：马上回去，沙盘回到原来的小节、画面还在，以后也不再换到那一站', async ({ page }) => {
  test.setTimeout(300_000);
  const { figureId, stopId } = await openHome(page);
  await toFigure(page);
  const figureHash = await hashNow(page);
  const route = routeOnDisk(figureId)!;
  // 先到它前面那一站（没有自己的沙盘：栏里还是同一座全程沙盘），再从那里按“下一站”潜
  const ids = await page.locator('.stop-item').evaluateAll((items) => items.map((item) => item.getAttribute('data-stop-id') ?? ''));
  const before = ids[ids.indexOf(stopId) - 1];
  test.skip(!before || sceneOnDisk(figureId, before) !== null || !roadOf(route, before), '它前面那一站也有自己的沙盘（或者没有来路）：这一项要另找走法');
  const pane = stagePane(page);
  await page.locator(`.stop-item[data-stop-id="${before}"]`).click();
  await expect(pane).toHaveAttribute('data-stage-section', roadOf(route, before)!, { timeout: READY_MS });
  await routeUp(page);

  await watchDive(page);
  const next = page.locator('.guide-dock a[rel="next"]');
  await expect(next).toHaveAttribute('href', `#/${figureId}/${stopId}`);
  // 点下去，紧接着按返回：两步在页面里连着做，中间不等。潜已经开始了，返回排在头一帧画出来以前；
  // 中间等一会儿的话，画一帧要一秒的机器上那一会儿会落在潜完以后（那是另一回事：最后几十毫秒按返回来不及）
  const pressed = await next.evaluate((link: HTMLElement) => {
    link.click();
    const hash = location.hash;
    history.back();
    return hash;
  });
  expect(pressed).toBe(`#/${figureId}/${before}`);
  await expect.poll(() => hashNow(page), { message: '返回马上算数' }).toBe(figureHash);
  await expect(pane).not.toHaveAttribute('data-stage-dive', /./);
  // 一路上：栏上先写了正往哪一站潜（那时候地址还没有变），后来记号拿掉了。记号拿掉和地址变了的通知谁先谁后不是规矩，不查
  const log = (await notes(page)).filter((n) => n.what !== 'click');
  expect(log[0]).toMatchObject({ what: `mark ${stopId}`, hash: `#/${figureId}/${before}` });
  expect(log.map((n) => n.what)).toContain('mark off');
  // 等过“到点了一定放行”的钟点：地址没有再变
  await page.waitForTimeout(DIVE_GUARD_MS + 300);
  expect(await hashNow(page)).toBe(figureHash);
  expect((await notes(page)).filter((n) => n.what === 'hash').map((n) => n.hash)).toEqual([figureHash]);
  // 还是那一座全程沙盘，回到了头一节；放画面的那一块没有留在淡掉的样子上
  await expect(pane).toHaveAttribute('data-stage-section', route.sections[0].heading, { timeout: READY_MS });
  await routeUp(page);
  await expect.poll(() => pane.locator('.stage-canvas').evaluate((el) => getComputedStyle(el).opacity), { message: '画面要回来' }).toBe('1');
  await expect.poll(() => pane.locator('.stage-host .strip-seal').count(), { message: '题签要回来' }).toBeGreaterThan(0);
});

test('?dive=none：不潜，一点地址就换，那一站的沙盘照常摆好', async ({ page }) => {
  test.setTimeout(300_000);
  const { figureId, stopId } = await openHome(page, '&dive=none');
  await toFigure(page);
  await watchDive(page);
  const pressed = await page.locator(`.stop-item[data-stop-id="${stopId}"]`).evaluate((link: HTMLElement) => {
    link.click();
    return location.hash;
  });
  expect(pressed, '点完的那一刻地址已经是那一站的').toBe(`#/${figureId}/${stopId}`);
  const pane = stagePane(page);
  await expect(page.locator('.stop-page')).toHaveAttribute('data-stop-id', stopId);
  await expect(pane).not.toHaveAttribute('data-stage-level', 'route');
  await expectRealTable(page, 'full', READY_MS);
  expect((await notes(page)).filter((n) => n.what.startsWith('mark')), '栏上从没写过潜的记号').toEqual([]);
  await expect(pane.locator('.stage-still-host')).not.toHaveClass(/is-(coming|arriving)/);
});

test('沙盘的替身：平时不潜，一点地址就换；地址里带 ?dive=1 才潜，潜完才换', async ({ page }) => {
  for (const [extra, dives] of [['', false], ['&dive=1', true]] as const) {
    await page.goto(fakeUrl('#/', extra));
    const card = page.locator('a.card[data-available="true"]').first();
    await expect(card).toBeVisible();
    const figureId = (await card.getAttribute('data-figure-id')) ?? '';
    const stopId = diveStopOnDisk(figureId);
    test.skip(stopId === '', '还没有“全程沙盘加一站自己的沙盘”');
    await card.click();
    const pane = stagePane(page);
    await expect(pane).toHaveAttribute('data-stage-level', 'route');
    await expect(pane).toHaveAttribute('data-stage-state', 'ready');
    await expect(pane).toHaveAttribute('data-stage-picture', 'table');
    const here = await hashNow(page);
    await watchDive(page);
    const pressed = await page.locator(`.stop-item[data-stop-id="${stopId}"]`).evaluate((link: HTMLElement) => {
      link.click();
      return location.hash;
    });
    const there = `#/${figureId}/${stopId}`;
    expect(pressed, dives ? '潜的时候，点完的那一刻地址还没有变' : '不潜的时候，点完的那一刻地址已经换了').toBe(dives ? here : there);
    await expect.poll(() => hashNow(page)).toBe(there);
    await expect(page.locator('.stop-page')).toHaveAttribute('data-stop-id', stopId);
    await expect(pane).not.toHaveAttribute('data-stage-level', 'route');
    await expect(pane).toHaveAttribute('data-stage-state', 'ready');
    const log = await notes(page);
    const marks = log.filter((n) => n.what.startsWith('mark')).map((n) => `${n.what} ${n.hash}`);
    if (dives) {
      expect(marks[0], '栏上写了正往哪一站潜，那时候地址还没有变').toBe(`mark ${stopId} ${here}`);
      const mark = log.find((n) => n.what === `mark ${stopId}`)!;
      const hash = log.find((n) => n.what === 'hash')!;
      expect(hash.at - mark.at, '不到钟点不换地址').toBeGreaterThanOrEqual(800);
    } else {
      expect(marks, '栏上从没写过潜的记号').toEqual([]);
    }
  }
});

// 有自己的沙盘、正文还没写的站（眉州，全程沙盘的头一站）：在人物页的沙盘上按它的印，同徐州、黄州一样先潜再换页；
// 落下去是它自己的沙盘、头一处，文字栏里那张单子“沙盘上看的几处”的头一行标着；按返回回到全程沙盘的头一节，不再换回去；
// 直接打开它的地址：不潜，也是头一处。各站的正文都写好的那一天没有这样的站了，这一项自己跳过（上面几项照旧查写好了的站）。
test('潜进一站正文还没写的站（眉州）：按它的印潜下去，落在它自己的沙盘的头一处，单子的头一行标着；按返回回到全程沙盘；直接打开它的地址也摆在头一处，不潜', async ({ page }) => {
  test.setTimeout(300_000);
  await page.setViewportSize({ width: 1024, height: 640 });
  await page.goto(realUrl('#/', 'full'));
  await needWebGL2(page);
  const card = page.locator('a.card[data-available="true"]').first();
  await expect(card).toBeVisible();
  const figureId = (await card.getAttribute('data-figure-id')) ?? '';
  const stopId = unwrittenDiveStopOnDisk(figureId);
  test.skip(stopId === '', '没有“有自己的沙盘、正文还没写”的站：这一种潜法没有站可以按');
  const scene = sceneOnDisk(figureId, stopId)!;
  const route = routeOnDisk(figureId)!;
  const first = scene.sections[0].heading;
  const pane = stagePane(page);
  const marked = page.locator('.views .view-item[aria-current="true"]');
  await routeUp(page);
  await toFigure(page);
  const figureHash = await hashNow(page);

  // ---- 按它的印：先潜，潜完才换地址；落在它自己的沙盘上
  const at = await sealPoint(page, stopId);
  await watchDive(page);
  await page.mouse.click(at.x, at.y);
  await expectArrived(page, figureId, stopId, figureHash, `${stopId}（正文还没写）的印`);
  // 头一处：沙盘、题记都是头一处的；单子有几处就有几行，只有头一行标着
  await expect(page.locator('.stop-page')).toHaveAttribute('data-stop-text', 'none');
  await expect(page.locator('.stop-page')).toHaveAttribute('data-stop-scene', 'yes');
  await expect(pane).toHaveAttribute('data-stage-section', first);
  await expect(page.locator('.stage-caption')).toHaveAttribute('data-section', first);
  await expect(page.locator('.views .view-item')).toHaveCount(scene.sections.length);
  await expect(marked).toHaveCount(1);
  await expect(marked).toHaveAttribute('data-view', first);
  await expect(page.locator('.views .view-item').first()).toHaveAttribute('aria-current', 'true');
  await expect(pane.locator('.stage-reset')).toHaveText('回到这一处');

  // ---- 按返回：回到人物页，全程沙盘的头一节；单子没有了；等过“到点了一定放行”的钟点，地址没有再换回那一站
  await page.goBack();
  await expect.poll(() => hashNow(page), { message: '返回回到人物页' }).toBe(figureHash);
  await expect(pane).toHaveAttribute('data-stage-level', 'route', { timeout: READY_MS });
  await expect(pane).toHaveAttribute('data-stage-section', route.sections[0].heading, { timeout: READY_MS });
  await routeUp(page);
  await expect(pane).not.toHaveAttribute('data-stage-dive', /./);
  await expect(page.locator('.views')).toHaveCount(0);
  await page.waitForTimeout(DIVE_GUARD_MS + 300);
  expect(await hashNow(page)).toBe(figureHash);

  // ---- 直接打开它的地址：不潜（栏上从没写过记号，头一张图片不是按“潜过来的”放的），它自己的沙盘摆在头一处，头一行标着
  await page.goto('about:blank');
  await page.goto(realUrl(`#/${figureId}/${stopId}`, 'full'));
  await watchDive(page);
  await expect(page.locator('.stop-page')).toHaveAttribute('data-stop-id', stopId);
  await expect(pane).not.toHaveAttribute('data-stage-level', 'route');
  await expectRealTable(page, 'full', READY_MS);
  await expect(pane).toHaveAttribute('data-stage-section', first);
  await expect(marked).toHaveCount(1);
  await expect(marked).toHaveAttribute('data-view', first);
  await expect(pane.locator('.stage-still-host')).not.toHaveClass(/is-(coming|arriving)/);
  expect((await notes(page)).filter((n) => n.what.startsWith('mark')), '直接打开：栏上从没写过潜的记号').toEqual([]);
  expect(await hashNow(page)).toBe(`#/${figureId}/${stopId}`);
});
