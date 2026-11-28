// 歌德的全程沙盘在浏览器里：他的人物页和八站的页面，照地址打开（首页上他的卡片合着、开着都一样）。
// 这是头一份在浏览器里摆“平着的纸条”的测试，也是头一位没有行迹的人物的页面：
//   一、人物页，四种标准的窗口和 820 × 1180，真的沙盘程序：摆得出来，看的是头一节；栏上没有时间轴（不写 data-stage-bar，
//       没有那一条，时间轴的那一段程序不去取）；他的样式的那一半取了一次，苏轼的样式不取；平着的纸条那一小块取了；楷体的文件不取。
//       苏轼的人物页上反过来：歌德的样式、平着的纸条那一小块都不取。
//   二、九节（人物页的头一节，八站的页面各一节，还是同一块画布）：每一节画几批在预算里；纸条每一条都摆出来，不出留出来的那一块，
//       引线不超过 48 像素，古名、今名两种；这一节讲的那一站，圆点外面有一圈；每一站的页面上是第二种说法
//       （“这一站的正文还没写。沙盘上是这一站的路。”），按钮下面没有那一行话，中间的按钮是“回到这一段”，底下那一条两头的站对。
//       魏玛的纸条前头两个圆点（三、八），各按一下到各自的那一站。
//   三、只放图片（?tier=still）：宽、窄两种栏上九节各一张，一共十八张，就是清单里的那十八张；纸条摆在图片上；
//       那一句“这里放的是沙盘的图片，不能转动。”；题记旁边的短句里有“地面没抹平”，“说明”里有地形怎么整理的那一句。
//   四、他的样式那一半没取到、取得慢；平着的纸条那一小块头一回没取到（自己再取一次，读者不用按什么）、两回都没取到（“再试一次”）、取得慢。
//   五、字：人物页、一站的页面、点开的凭据，显出来的每一段字都是随站的字体画的；纸条上的字是宋体；楷体的文件没有取。
//   六、凭据：开头是那几条总的说明，照文件里的先后；没有“记号”一栏，没有行迹的出处。
//   七、不出网站：他的页面、苏轼的页面，每一个请求都是网站自己的；苏轼的页面上没有取他的哪一个文件（两位共用的那几块里列着的名字不算）。
//   八、首页上他的卡片：合着是单子上的一行，标着“还没写”；开着是链接，最后一行是“先看他走过的路”，点了到他的人物页。照卡片现在的样子查。
// 另有一条看“内容的清单晚到的那一会儿”：他的栏上先照有行迹的写着 data-stage-bar，全程沙盘读出来的那一下拿掉。
// 用真的沙盘程序的几项指定完整的一档；没有显卡的机器上、发布流程的软件渲染里都要过，所以等的地方都是轮着问，不靠固定的时间。
// 只认 Chromium。纸条出不出地面的边，这里不查（页面上拿不到地面的四个角）：Node 里的验收照沙盘程序拿到的画面查着
//（tests/stage/route-views.test.ts；那个画面有多大，tests/e2e/pane-boxes.spec.ts 在页面上量过）。

import { expect, test } from '@playwright/test';
import type { CDPSession, Page } from '@playwright/test';
import type { RouteScene } from '../../src/domain/scene';
import { stripTexts } from '../../src/domain/sceneText';
import type { StillManifest } from '../../src/domain/stills';
import type { Figure, FigureCard } from '../../src/domain/types';
import { STYLES, labelKind } from '../../src/stage/styles';
import { DRAW_CALLS_MAX } from '../stage/support/budgets';
import { STANDARD_PANES, engineSize } from '../stage/support/standardPanes';
import type { StandardPane } from '../stage/support/standardPanes';
import { namesIn, readBytes } from '../support/readBytes';
import { FONT_RECORD, fontFileOf, plainName } from './fontHelpers';
import { expectRealTable, firstOpenFigureOnDisk, fontsReady, foldBodiesReady, realUrl, routeOnDisk, stagePane, stageReadout, stopsWithScenes } from './helpers';

const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};

/** 这份测试查的那一位。 */
const FIGURE = 'goethe';
const readJson = <T>(path: string): T => JSON.parse(new TextDecoder().decode(readBytes(path))) as T;
const figure = readJson<Figure>(`content/figures/${FIGURE}/figure.json`);
const route = routeOnDisk(FIGURE) as RouteScene;
const stills = readJson<StillManifest>(`content/figures/${FIGURE}/stills/route.json`);
const cards = readJson<FigureCard[]>('content/figures/index.json').sort((a, b) => a.sortYear - b.sortYear);
const card = cards.find((one) => one.id === FIGURE);
/** 首页上头一位可以点进去的人物（沙盘栏里摆的是他的全程沙盘）；另一位人物的页面拿他来看。 */
const FIRST_OPEN = firstOpenFigureOnDisk();
const OTHER = cards.find((one) => one.available && one.id !== FIGURE)?.id ?? null;

const WHOLE = route.sections[0].heading;
/** 一站的页面上全程沙盘看的那一节。 */
const viewOf = (stopId: string): string => route.sections.find((section) => section.stop === stopId)!.heading;
/** 一节的纸条：id 和两种叫法的字。 */
const slipsOf = (heading: string, names: 'ancient' | 'modern'): { id: string; text: string }[] => stripTexts(route, heading, names).map((strip) => ({ id: strip.id, text: strip.text }));

const READY_MS = 120_000;
const SECTION_MS = 60_000;
const LEADER_MAX_PX = 48;
const STILL_LINE = '这里放的是沙盘的图片，不能转动。';
const FAILED_WORDS = '沙盘没能摆出来';

/** 取一小块程序的请求：构建出来的叫 <名字>-<一串字符>.js，开发服务上是源文件。 */
const chunk = (name: string): RegExp => new RegExp(`/${name}(-[\\w-]{8})?\\.(js|ts|tsx)(\\?.*)?$`);
const HIS_STYLE = route.style;
const HIS_HALF = chunk(`${HIS_STYLE}-route`);
const SLIPS = chunk('slips');
const BAR = chunk('TimeBar');
const LISTS = chunk('contentLists');
const KAI_FILE = /yanlu-kai[^/]*\.woff2/;
/** 他的页面可以取的字体文件，照记录（src/fonts/fonts.json）：框架的两个，和范围是他的那几个（名字不带文件夹、不带 .woff2）。 */
const HIS_FONTS = FONT_RECORD.files.filter((item) => item.scope === 'frame' || item.scope === FIGURE).map((item) => plainName(item.file));
/**
 * 一串请求里别的范围的字体文件：字体文件是按范围分的，他的页面只该取框架的两个（yanlu-sans、yanlu-song）和他自己的
 *（yanlu-sans-<他的 id>、yanlu-song-<他的 id>、yanlu-song-<他的 id>-more）。别人的一个也不该取。
 * 一个请求要的是哪个文件照记录认（fontFileOf：先试长的名字，构建以后名字后面多的那一串八个字符才不会和别人的 id 认混——
 * 光看名字的样子，yanlu-song-<八个字符的 id>.woff2 和构建出来的框架的宋体分不开）；记录里没有的 .woff2 也算别人的。
 */
const othersFonts = (urls: string[]): string[] => urls.map(fontFileOf).filter((name): name is string => name !== null && !HIS_FONTS.includes(name));

/** 这个浏览器有没有 WebGL2。没有时：发布流程里算没通过，自己的机器上跳过。 */
async function needWebGL2(page: Page): Promise<void> {
  const hasWebGL2 = await page.evaluate(() => {
    try {
      return document.createElement('canvas').getContext('webgl2') !== null;
    } catch {
      return false;
    }
  });
  if (env.CI) expect(hasWebGL2, '发布流程的浏览器没有 WebGL2：真沙盘一次也没有起来过，不能算通过').toBe(true);
  else test.skip(!hasWebGL2, '这个浏览器没有 WebGL2');
}

/** 记下这一页发出去的每一个请求的地址。 */
function watchRequests(page: Page): { all: () => string[]; of: (pattern: RegExp) => string[] } {
  const seen: string[] = [];
  page.on('request', (request) => seen.push(request.url()));
  return { all: () => [...seen], of: (pattern) => seen.filter((url) => pattern.test(url)) };
}

/** 页面上的报错，记下来最后一起看。 */
function watchProblems(page: Page): string[] {
  const problems: string[] = [];
  page.on('pageerror', (error) => problems.push(`页面出错：${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(`控制台报错：${message.text()}`);
  });
  return problems;
}

/** 不重新打开页面，换到另一个地址（人物页、他的哪一站）：还是那一块画布。 */
async function go(page: Page, hash: string): Promise<void> {
  await page.evaluate((to) => {
    window.location.hash = to;
  }, hash);
}

interface SeenSlip {
  id: string;
  text: string;
  shown: boolean;
  box: { left: number; top: number; right: number; bottom: number };
  /** 引线多长；没有引线（没有点的名字，或者没画）是 0。 */
  leader: number;
  ring: boolean;
}

/** 一层画面（立体的沙盘那一层，或者图片那一层）上现在的纸条，和留出来的那一块（按钮下面、题记上面）。 */
async function slipsOn(page: Page, host: '.stage-host' | '.stage-still-host'): Promise<{ slips: SeenSlip[]; free: { left: number; top: number; right: number; bottom: number }; kind: string | null }> {
  return page.evaluate((host) => {
    const pane = document.querySelector('.stage-pane')!.getBoundingClientRect();
    const layer = document.querySelector(host)!;
    const below = (selector: string): number | null => {
      const el = document.querySelector(selector);
      const box = el?.getBoundingClientRect();
      return box && box.height > 0 ? box.bottom : null;
    };
    const foot = document.querySelector('.stage-foot')?.getBoundingClientRect();
    const free = { left: pane.left, top: below('.stage-notice') ?? below('.stage-controls') ?? pane.top, right: pane.right, bottom: foot && foot.height > 0 ? foot.top : pane.bottom };
    const slips = Array.from(layer.querySelectorAll<HTMLElement>('.strip-slip')).map((el) => {
      const id = el.dataset.stripId ?? '';
      const box = el.getBoundingClientRect();
      const line = layer.querySelector<SVGLineElement>(`line[data-strip-leader="${id}"]`);
      const drawn = line !== null && getComputedStyle(line).display !== 'none';
      const n = (name: string): number => Number(line?.getAttribute(name) ?? 0);
      return {
        id,
        text: el.querySelector('.strip-name')?.textContent ?? '',
        shown: getComputedStyle(el).visibility !== 'hidden' && box.width > 0,
        box: { left: box.left, top: box.top, right: box.right, bottom: box.bottom },
        leader: drawn ? Math.hypot(n('x2') - n('x1'), n('y2') - n('y1')) : 0,
        ring: false,
      };
    });
    return { slips, free, kind: layer.querySelector<HTMLElement>('[data-kind]')?.dataset.kind ?? null };
  }, host);
}

/**
 * 等这一层上的纸条摆好（要的每一条都在、都显出来，连着两次问到的位置一样），再查：一条不少，字对，不出留出来的那一块，
 * 引线不超过 48 像素。返回最长的引线。
 * leaders 写 'printed' 的时候不查 48 像素，只把最长的引线交回去给人印：按钮下面多一行话的栏上，每一座全程沙盘的验收
 * 也只查纸条摆不摆得下（tests/stage/route-views.test.ts 的“上面多一行说明的画面”），只放图片的一档从头到尾是这样的栏。
 */
async function expectSlips(page: Page, host: '.stage-host' | '.stage-still-host', wanted: { id: string; text: string }[], where: string, leaders: 'capped' | 'printed' = 'capped'): Promise<number> {
  let last = '';
  let seen = await slipsOn(page, host);
  await expect
    .poll(
      async () => {
        seen = await slipsOn(page, host);
        const now = JSON.stringify(seen.slips.map((slip) => [slip.id, slip.text, slip.shown, Math.round(slip.box.left), Math.round(slip.box.top)]));
        const settled = now === last && wanted.every((want) => seen.slips.some((slip) => slip.id === want.id && slip.shown && slip.text === want.text));
        last = now;
        return settled;
      },
      { message: `${where}：纸条没有摆齐（要 ${wanted.map((want) => want.text).join('、')}）`, timeout: SECTION_MS, intervals: [200, 300, 500] },
    )
    .toBe(true);
  expect(seen.kind, `${where}：这一层的题签是平着的纸条`).toBe('slip');
  expect(seen.slips.map((slip) => slip.id), `${where}：纸条不多不少`).toEqual(wanted.map((want) => want.id));
  const problems: string[] = [];
  for (const slip of seen.slips) {
    if (slip.box.left < seen.free.left - 0.5 || slip.box.right > seen.free.right + 0.5 || slip.box.top < seen.free.top - 0.5 || slip.box.bottom > seen.free.bottom + 0.5) problems.push(`“${slip.text}”出了留出来的那一块`);
    if (leaders === 'capped' && slip.leader > LEADER_MAX_PX + 0.05) problems.push(`“${slip.text}”的引线 ${slip.leader.toFixed(1)} 像素`);
  }
  expect(problems, where).toEqual([]);
  return Math.max(0, ...seen.slips.map((slip) => slip.leader));
}

/** 他的页面上没有时间轴：栏上不写，那一条不在。 */
async function expectNoBar(page: Page, where: string): Promise<void> {
  expect(await stagePane(page).getAttribute('data-stage-bar'), `${where}：栏上不写 data-stage-bar`).toBeNull();
  await expect(page.locator('.stage-bar'), `${where}：没有时间轴的那一条`).toHaveCount(0);
}

test.describe('歌德的全程沙盘', () => {
  test('内容里的样子：他有全程沙盘，没有行迹，八站都还没写、都没有自己的沙盘；他的样式只有全程沙盘用的那一半，题签是平着的纸条；清单里十八张定格图', () => {
    const files = namesIn(`content/figures/${FIGURE}`);
    expect(files).not.toContain('itinerary.json');
    expect(figure.stops.map((stop) => stop.id)).toEqual(route.sections.slice(1).map((section) => section.stop));
    expect(figure.stops).toHaveLength(8);
    expect(figure.stops.every((stop) => stop.status === 'outline' && stop.table !== true)).toBe(true);
    expect(stopsWithScenes().filter((one) => one.figureId === FIGURE)).toEqual([]);
    expect(route.sections).toHaveLength(9);
    expect(labelKind(HIS_STYLE)).toBe('slip');
    expect(STYLES.find((row) => row.id === HIS_STYLE)?.load).toBeUndefined();
    expect(stills.stills).toHaveLength(18);
    // 首页上有他的一张卡片，写着各站都还没写
    expect(card, 'content/figures/index.json 里要有他的卡片').toBeDefined();
    expect(card?.outline).toBe(true);
  });

  test('人物页，四种标准的窗口和 820 × 1180，真的沙盘程序（完整的一档）：摆得出来，看的是头一节；没有时间轴，那一段程序不去取；他的样式那一半取一次，别的样式不取；平着的纸条那一小块取一次；楷体的文件不取；沙盘程序拿到的画面是栏里面的那一块', async ({ page }) => {
    test.setTimeout(420_000);
    const first = STANDARD_PANES[0];
    await page.setViewportSize(first.window);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const problems = watchProblems(page);
    const requests = watchRequests(page);
    await page.goto(realUrl(`#/${FIGURE}`, 'full', '&debug=1'));
    await needWebGL2(page);
    const pane = stagePane(page);
    await expect(pane).toHaveAttribute('data-stage-level', 'route', { timeout: READY_MS });
    await expectRealTable(page, 'full', READY_MS);
    await expect(pane).toHaveAttribute('data-stage-section', WHOLE);
    await expect(page.locator('.page-title')).toHaveText(figure.name);
    await expect(page.locator('.stops a.stop-item')).toHaveCount(figure.stops.length);
    await expectNoBar(page, '人物页');
    await expect(pane.locator('.stage-reset')).toHaveText('回到全程');
    await expectSlips(page, '.stage-host', slipsOf(WHOLE, 'ancient'), `窗口 ${first.window.width} × ${first.window.height}`);
    // 取了什么：他的样式那一半一次，平着的纸条那一小块一次；时间轴的那一段、别的样式、楷体的文件都没有取
    expect(requests.of(HIS_HALF), '他的样式那一半').toHaveLength(1);
    expect(requests.of(SLIPS), '平着的纸条那一小块').toHaveLength(1);
    expect(requests.of(BAR), '时间轴的那一段程序').toEqual([]);
    for (const row of STYLES.filter((one) => one.id !== HIS_STYLE)) expect(requests.of(chunk(`${row.id}(-route)?`)), `别的样式 ${row.id}`).toEqual([]);
    expect(requests.of(KAI_FILE), '楷体的文件').toEqual([]);
    // 字体文件是按范围分的：他的人物页上，另一位人物的、“来源”页的字体文件一个也没有取
    expect(othersFonts(requests.all()), '别的范围的字体文件').toEqual([]);

    // 五种窗口：改窗口的大小，等沙盘程序拿到的画面换成这种栏里面的那一块，再看
    const windows: StandardPane[] = [...STANDARD_PANES, { name: '820 × 661', window: { width: 820, height: 1180 }, size: { width: 820, height: 661 }, insets: STANDARD_PANES[2].insets }];
    for (const one of windows) {
      const where = `窗口 ${one.window.width} × ${one.window.height}`;
      await page.setViewportSize(one.window);
      const wanted = engineSize(one);
      await expect
        .poll(async () => JSON.stringify((await stageReadout(page))?.shot?.size ?? null), { message: `${where}：沙盘程序拿到的画面`, timeout: SECTION_MS })
        .toBe(JSON.stringify(wanted));
      await expectRealTable(page, 'full', READY_MS);
      await expect(pane).toHaveAttribute('data-stage-section', WHOLE);
      await expectNoBar(page, where);
      expect(await pane.evaluate((el: HTMLElement) => `${el.offsetWidth} × ${el.offsetHeight}`), `${where}：沙盘栏的大小`).toBe(`${one.size.width} × ${one.size.height}`);
      // 上下留的空是页面量了栏里的东西以后才交给沙盘程序的，比画面的大小晚一步：等它到
      await expect
        .poll(
          async () => {
            const insets = (await stageReadout(page))?.shot?.insets;
            return insets ? [insets.top, insets.bottom] : null;
          },
          { message: `${where}：上下留的空`, timeout: SECTION_MS },
        )
        .toEqual([one.insets.top, one.insets.bottom]);
      const longest = await expectSlips(page, '.stage-host', slipsOf(WHOLE, 'ancient'), where);
      const readout = (await stageReadout(page))!;
      console.log(`歌德的人物页 ${where}：沙盘栏 ${one.size.width} × ${one.size.height}，画面 ${wanted.width} × ${wanted.height}，${readout.triangles} 个三角形、画 ${readout.drawCalls} 批；十一条纸条最长的引线 ${longest.toFixed(1)} 像素`);
      expect(readout.drawCalls).toBeLessThanOrEqual(DRAW_CALLS_MAX);
    }
    // 换了五回窗口，样式、纸条那一小块都没有再取；时间轴的那一段程序还是没有取
    expect(requests.of(HIS_HALF)).toHaveLength(1);
    expect(requests.of(SLIPS)).toHaveLength(1);
    expect(requests.of(BAR)).toEqual([]);
    expect(problems).toEqual([]);
  });

  test('另一位人物（有行迹的）的人物页，真的沙盘程序：歌德的样式、平着的纸条那一小块都不取，他的哪一个内容文件也不取；栏上带着时间轴', async ({ page }) => {
    test.setTimeout(300_000);
    test.skip(OTHER === null, 'content/ 里没有另一位可以点进去的人物');
    await page.setViewportSize(STANDARD_PANES[0].window);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const requests = watchRequests(page);
    await page.goto(realUrl(`#/${OTHER}`, 'full'));
    await needWebGL2(page);
    await expect(stagePane(page)).toHaveAttribute('data-stage-level', 'route', { timeout: READY_MS });
    await expectRealTable(page, 'full', READY_MS);
    await expect(stagePane(page)).toHaveAttribute('data-stage-bar', '');
    expect(requests.of(HIS_HALF), '歌德的样式').toEqual([]);
    expect(requests.of(SLIPS), '平着的纸条那一小块').toEqual([]);
    expect(requests.all().filter(isHisContent), '歌德的内容文件').toEqual([]);
    // 这个认法在这一页上认不认得出来：叫页面照它认的名字取他的一个内容文件，再数一遍，数到的就该是这一个。
    // （构建出来的网站里他的文件叫 assets/<名字>-<一串字符>，地址里没有他的文件夹：只照文件夹认，上面那一句永远是空的。）
    const probe = hisBuiltPaths()[0] ?? `content/figures/${FIGURE}/figure.json`;
    await page.evaluate(async (path) => {
      await fetch(path).catch(() => undefined);
    }, probe);
    await expect.poll(() => requests.all().filter(isHisContent).length, { message: `取了他的一个内容文件（${probe}）以后，认法该认出这一个` }).toBe(1);
  });

  test('九节，真的沙盘程序（完整的一档），还是同一块画布：每一节画几批在预算里；纸条一条不少、不出留出来的那一块、引线不超过 48 像素，古名今名两种；这一节讲的那一站圆点外面有一圈；八站的页面上是第二种说法，按钮下面没有那一行话，“回到这一段”，底下那一条两头的站对；魏玛的两个圆点各到各的一站', async ({ page }) => {
    test.setTimeout(600_000);
    await page.setViewportSize(STANDARD_PANES[0].window);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const problems = watchProblems(page);
    await page.goto(realUrl(`#/${FIGURE}`, 'full', '&debug=1'));
    await needWebGL2(page);
    const pane = stagePane(page);
    await expectRealTable(page, 'full', READY_MS);
    await page.locator('.stage-host canvas').evaluate((el) => el.setAttribute('data-same-canvas', 'yes'));
    const batches: string[] = [];

    /** 这一节摆好了：画几批，纸条两种叫法各查一遍（换了今名再换回来）。 */
    const checkView = async (heading: string): Promise<void> => {
      await expect(pane).toHaveAttribute('data-stage-section', heading, { timeout: SECTION_MS });
      await expectRealTable(page, 'full', READY_MS);
      await expect(page.locator('.stage-host canvas')).toHaveAttribute('data-same-canvas', 'yes');
      await expect(page.locator('.stage-caption')).toHaveAttribute('data-section', heading);
      await expectNoBar(page, heading);
      const ancient = await expectSlips(page, '.stage-host', slipsOf(heading, 'ancient'), `“${heading}”，古名`);
      const readout = (await stageReadout(page))!;
      expect(readout.drawCalls, `“${heading}”画几批`).toBeGreaterThan(5);
      expect(readout.drawCalls, `“${heading}”画几批`).toBeLessThanOrEqual(DRAW_CALLS_MAX);
      await pane.locator('.names-switch button', { hasText: '今名' }).click();
      const modern = await expectSlips(page, '.stage-host', slipsOf(heading, 'modern'), `“${heading}”，今名`);
      await pane.locator('.names-switch button', { hasText: '古名' }).click();
      await expectSlips(page, '.stage-host', slipsOf(heading, 'ancient'), `“${heading}”，换回古名`);
      batches.push(`${heading} ${readout.drawCalls} 批（${readout.triangles} 个三角形；引线最长 ${ancient.toFixed(0)} / ${modern.toFixed(0)} 像素）`);
    };

    // 头一节：人物页
    await checkView(WHOLE);
    // 魏玛是两站：纸条前头两个圆点，写着这两站是第几站
    const numbers = '一二三四五六七八九十';
    const twice = route.places.find((place) => (place.stops?.length ?? 0) === 2);
    expect(twice, '要有一个地方是两站').toBeDefined();
    const twiceStrip = route.sections[0].strips.find((id) => route.strips.find((strip) => strip.id === id)?.of === twice!.id)!;
    const discs = pane.locator(`.stage-host .strip-slip[data-strip-id="${twiceStrip}"] a.strip-disc`);
    await expect(discs).toHaveCount(2);
    expect(await discs.evaluateAll((list) => list.map((disc) => [disc.getAttribute('data-stop-id'), disc.textContent, disc.getAttribute('href')]))).toEqual(
      twice!.stops!.map((stopId) => [stopId, numbers[figure.stops.findIndex((stop) => stop.id === stopId)], `#/${FIGURE}/${stopId}`]),
    );

    // 八站的页面：照先后走一遍，每一站看的是它自己的那一节
    for (const [i, stop] of figure.stops.entries()) {
      const heading = viewOf(stop.id);
      await go(page, `#/${FIGURE}/${stop.id}`);
      await expect(page.locator('.stop-page')).toHaveAttribute('data-stop-id', stop.id);
      await checkView(heading);
      // 第二种说法；按钮下面没有那一行话；中间的按钮
      await expect(page.locator('.not-written'), stop.id).toHaveText('这一站的正文还没写。沙盘上是这一站的路。');
      await expect(page.locator('.stage-notice'), `${stop.id}：按钮下面没有那一行话`).toHaveCount(0);
      await expect(pane.locator('.stage-reset'), stop.id).toHaveText('回到这一段');
      // 这一节讲的那一站：它的圆点外面有一圈；别的站没有
      const here = await pane.locator('.stage-host .strip-disc').evaluateAll((list) => list.map((disc) => `${disc.getAttribute('data-stop-id')} ${disc.getAttribute('data-here')}`));
      expect(here.filter((one) => one.endsWith(' true')), `${stop.id}：有一圈的圆点`).toEqual([`${stop.id} true`]);
      // 底下那一条：上一站、下一站
      const ends = await page.locator('.guide-dock a[rel]').evaluateAll((links) => links.map((link) => `${link.getAttribute('rel')} ${link.getAttribute('href')}`));
      expect(ends, `${stop.id}：底下那一条`).toEqual([...(i > 0 ? [`prev #/${FIGURE}/${figure.stops[i - 1].id}`] : []), ...(i < figure.stops.length - 1 ? [`next #/${FIGURE}/${figure.stops[i + 1].id}`] : [])]);
    }
    console.log(`歌德的全程沙盘九节（完整的一档，窗口 1440 × 900）：\n  ${batches.join('\n  ')}`);

    // 魏玛的两个圆点：回到人物页，各按一下（像手指那样点在圆点的正中），各到各的一站，还是这一块画布
    for (const stopId of twice!.stops!) {
      await go(page, `#/${FIGURE}`);
      await expect(page.locator('.stops a.stop-item').first()).toBeVisible();
      await expect(pane).toHaveAttribute('data-stage-section', WHOLE, { timeout: SECTION_MS });
      await expectSlips(page, '.stage-host', slipsOf(WHOLE, 'ancient'), '回到人物页');
      const box = (await pane.locator(`.stage-host .strip-slip[data-strip-id="${twiceStrip}"] a.strip-disc[data-stop-id="${stopId}"]`).boundingBox())!;
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      await expect(page).toHaveURL(new RegExp(`#/${FIGURE}/${stopId}$`));
      await expect(page.locator('.stop-page')).toHaveAttribute('data-stop-id', stopId);
      await expect(pane).toHaveAttribute('data-stage-section', viewOf(stopId), { timeout: SECTION_MS });
      await expect(page.locator('.stage-host canvas')).toHaveAttribute('data-same-canvas', 'yes');
    }
    expect(problems).toEqual([]);
  });

  test('只放图片（?tier=still）：宽、窄两种栏上九节各一张图片，一共十八张，就是清单里的那十八张；纸条摆在图片上；“这里放的是沙盘的图片，不能转动。”；题记旁边的短句里有“地面没抹平”，“说明”里有地形怎么整理的那一句；没有时间轴，沙盘程序不取', async ({ page }) => {
    test.setTimeout(300_000);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const problems = watchProblems(page);
    const requests = watchRequests(page);
    const pane = stagePane(page);
    const shown: string[] = [];
    const plain = (url: string): string => decodeURIComponent(url.slice(url.lastIndexOf('/') + 1)).replace(/-[\w-]{8}(\.\w+)$/, '$1');
    for (const [shape, size] of [
      ['wide', STANDARD_PANES[0].window],
      ['narrow', STANDARD_PANES[2].window],
    ] as const) {
      await page.goto('about:blank');
      await page.setViewportSize(size);
      await page.goto(`/?tier=still#/${FIGURE}`);
      const longest: string[] = [];
      for (const [n, section] of route.sections.entries()) {
        const where = `${shape === 'wide' ? '宽' : '窄'}的栏，“${section.heading}”`;
        if (n > 0) {
          await go(page, `#/${FIGURE}/${section.stop}`);
          await expect(page.locator('.stop-page')).toHaveAttribute('data-stop-id', section.stop!);
        }
        await expect(pane, where).toHaveAttribute('data-stage-state', 'slow', { timeout: SECTION_MS });
        await expect(pane, where).toHaveAttribute('data-stage-picture', 'still', { timeout: SECTION_MS });
        await expect(pane, where).toHaveAttribute('data-stage-section', section.heading, { timeout: SECTION_MS });
        await expect(page.locator('.stage-notice p'), where).toHaveText(STILL_LINE);
        await expect(pane.locator('.stage-retry'), where).toHaveText('试试立体的沙盘');
        await expectNoBar(page, where);
        // 放着的是这一节、这种栏的那一张，画出来了
        const wanted = stills.stills.find((still) => still.section === section.heading && still.shape === shape)!;
        const img = page.locator('.stage-still-host img.still-picture.is-top');
        await expect.poll(async () => plain((await img.evaluate((el: HTMLImageElement) => (el.complete && el.naturalWidth > 0 ? el.currentSrc || el.src : ''))) || ''), { message: `${where}：放着的图片`, timeout: SECTION_MS }).toBe(wanted.file);
        expect(await img.evaluate((el: HTMLImageElement) => [el.naturalWidth, el.naturalHeight]), where).toEqual([wanted.width, wanted.height]);
        shown.push(wanted.file);
        // 图片上的纸条：一条不少、字对、不出留出来的那一块；按钮下面有一行话，所以引线只印出来（见 expectSlips）
        longest.push(`${section.heading} ${(await expectSlips(page, '.stage-still-host', slipsOf(section.heading, 'ancient'), where, 'printed')).toFixed(0)}`);
        // 题记旁边的短句：地面照量出来的样子，没有抹平（宽的栏印常印着的一句，窄的栏印更短的一句）
        const note = await page.locator('.stage-note').evaluate((el) => Array.from(el.querySelectorAll<HTMLElement>('.stage-note-short, .stage-note-brief')).filter((line) => getComputedStyle(line).display !== 'none').map((line) => line.textContent ?? ''));
        expect(note.length, `${where}：题记旁边的短句`).toBe(1);
        expect(note[0], where).toContain('地面没抹平');
      }
      console.log(`歌德的定格图上的纸条（${shape === 'wide' ? '宽' : '窄'}的栏，窗口 ${size.width} × ${size.height}，按钮下面一行话）：各节最长的引线 ${longest.join('，')} 像素`);
      // “说明”展开：地形怎么整理的那一句在里面
      await pane.locator('.stage-note-button').click();
      await expect(page.locator('.stage-note-panel .stage-note-lines')).toContainText(route.terrain.recipe.note!.trim());
      await pane.locator('.stage-note-close').click();
    }
    // 十八张：正好是清单里的那十八个文件，每一张都是从网站自己取的
    expect([...shown].sort()).toEqual(stills.stills.map((still) => still.file).sort());
    const fetched = requests.all().filter((url) => /\/route-\d-(wide|narrow)[^/]*\.jpg/.test(url));
    expect([...new Set(fetched.map(plain))].sort()).toEqual(stills.stills.map((still) => still.file).sort());
    // 只放图片：沙盘程序、样式都没有取；平着的纸条那一小块取了（图片上的纸条靠它）；时间轴的那一段、楷体的文件没有取
    expect(requests.of(chunk('engine'))).toEqual([]);
    expect(requests.of(HIS_HALF)).toEqual([]);
    expect(requests.of(SLIPS).length).toBeGreaterThanOrEqual(1);
    expect(requests.of(BAR)).toEqual([]);
    expect(requests.of(KAI_FILE)).toEqual([]);
    expect(problems).toEqual([]);
  });

  test('他的样式那一半没取到：沙盘栏说立体的沙盘没能摆出来，图片照常放着、纸条在上面，带“再试一次”；点了真的再取一遍，沙盘摆出来了', async ({ page }) => {
    test.setTimeout(300_000);
    await page.setViewportSize({ width: 1024, height: 640 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const uncaught: string[] = [];
    page.on('pageerror', (error) => uncaught.push(String(error)));
    let cut = true;
    const asked: string[] = [];
    await page.route(HIS_HALF, (routed) => {
      asked.push(cut ? 'cut' : 'through');
      return cut ? routed.abort() : routed.continue();
    });
    await page.goto(realUrl(`#/${FIGURE}`, 'full'));
    await needWebGL2(page);
    const pane = stagePane(page);
    await expect(pane).toHaveAttribute('data-stage-state', 'failed', { timeout: READY_MS });
    await expect(pane).toContainText(FAILED_WORDS);
    await expect(pane).toHaveAttribute('data-stage-picture', 'still');
    await expectSlips(page, '.stage-still-host', slipsOf(WHOLE, 'ancient'), '样式没取到，图片上');
    await expect(page.locator('.stops a.stop-item')).toHaveCount(figure.stops.length);
    const retry = pane.locator('.stage-retry');
    await expect(retry).toHaveText('再试一次');
    expect(asked.length).toBeGreaterThanOrEqual(1);
    expect(asked).not.toContain('through');
    const before = asked.length;
    cut = false;
    await retry.click();
    await expectRealTable(page, 'full', READY_MS);
    expect(asked.slice(before)).toContain('through');
    await expect(pane.locator('.stage-retry')).toHaveCount(0);
    await expect(pane).not.toContainText(FAILED_WORDS);
    await expectSlips(page, '.stage-host', slipsOf(WHOLE, 'ancient'), '再试一次以后');
    expect(uncaught).toEqual([]);
  });

  test('他的样式那一半取得慢：压着的时候图片放着，不说“没能……”，没有“再试一次”；放开以后照常摆出来', async ({ page }) => {
    test.setTimeout(300_000);
    await page.setViewportSize({ width: 1024, height: 640 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const uncaught: string[] = [];
    page.on('pageerror', (error) => uncaught.push(String(error)));
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => (release = resolve));
    let asked = 0;
    await page.route(HIS_HALF, async (routed) => {
      asked++;
      await held;
      await routed.continue();
    });
    await page.goto(realUrl(`#/${FIGURE}`, 'full'));
    await needWebGL2(page);
    const pane = stagePane(page);
    await expect.poll(() => asked, { timeout: READY_MS }).toBeGreaterThanOrEqual(1);
    // 压着：图片在，纸条在上面；栏上是“正在摆”，没有那两样
    await expect(pane).toHaveAttribute('data-stage-picture', 'still', { timeout: SECTION_MS });
    await expectSlips(page, '.stage-still-host', slipsOf(WHOLE, 'ancient'), '样式压着，图片上');
    expect(await pane.getAttribute('data-stage-state')).toBe('loading');
    await expect(pane).not.toContainText(FAILED_WORDS);
    await expect(pane.locator('.stage-retry')).toHaveCount(0);
    release();
    await expectRealTable(page, 'full', READY_MS);
    await expectSlips(page, '.stage-host', slipsOf(WHOLE, 'ancient'), '放开以后');
    expect(asked).toBe(1);
    expect(uncaught).toEqual([]);
  });

  test('平着的纸条那一小块头一回没取到：自己再取一次，取到了——沙盘照常摆出来，纸条在，读者不用按什么，栏上从头到尾没有说过“没能摆出来”', async ({ page }) => {
    test.setTimeout(300_000);
    await page.setViewportSize({ width: 1024, height: 640 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const uncaught: string[] = [];
    page.on('pageerror', (error) => uncaught.push(String(error)));
    const asked: string[] = [];
    await page.route(SLIPS, (routed) => {
      // 每一处来取的头一回断掉（图片那一层、立体的沙盘各取各的：断的是头一个请求），以后都放行
      asked.push(asked.length === 0 ? 'cut' : 'through');
      return asked.length === 1 ? routed.abort() : routed.continue();
    });
    // 栏上说过的话都记下来
    await page.addInitScript(() => {
      const said = ((window as Window & { __said?: string[] }).__said = [] as string[]);
      new MutationObserver(() => {
        const pane = document.querySelector('.stage-pane');
        const now = `${pane?.getAttribute('data-stage-state') ?? ''}|${Array.from(pane?.querySelectorAll('.stage-says p') ?? []).map((p) => p.textContent).join(' ')}`;
        if (said[said.length - 1] !== now) said.push(now);
      }).observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
    });
    await page.goto(realUrl(`#/${FIGURE}`, 'full'));
    await needWebGL2(page);
    const pane = stagePane(page);
    await expectRealTable(page, 'full', READY_MS);
    await expectSlips(page, '.stage-host', slipsOf(WHOLE, 'ancient'), '头一回没取到');
    expect(asked[0]).toBe('cut');
    expect(asked.slice(1).length).toBeGreaterThanOrEqual(1);
    expect(asked.slice(1)).not.toContain('cut');
    const said = await page.evaluate(() => (window as Window & { __said?: string[] }).__said ?? []);
    expect(said.filter((line) => line.startsWith('failed') || line.includes('没能摆出来')), '栏上说过的话').toEqual([]);
    await expect(pane.locator('.stage-retry')).toHaveCount(0);
    expect(uncaught).toEqual([]);
  });

  test('平着的纸条那一小块两回都没取到（网一直不通）：沙盘栏说没能摆出来，图片放着、上面没有纸条，带“再试一次”；网通了点一下，沙盘摆出来，纸条在', async ({ page }) => {
    test.setTimeout(300_000);
    await page.setViewportSize({ width: 1024, height: 640 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const uncaught: string[] = [];
    page.on('pageerror', (error) => uncaught.push(String(error)));
    let cut = true;
    const asked: string[] = [];
    await page.route(SLIPS, (routed) => {
      asked.push(cut ? 'cut' : 'through');
      return cut ? routed.abort() : routed.continue();
    });
    await page.goto(realUrl(`#/${FIGURE}`, 'full'));
    await needWebGL2(page);
    const pane = stagePane(page);
    await expect(pane).toHaveAttribute('data-stage-state', 'failed', { timeout: READY_MS });
    await expect(pane).toContainText(FAILED_WORDS);
    const retry = pane.locator('.stage-retry');
    await expect(retry).toHaveText('再试一次');
    // 每一处来取的都取了两回（头一回、自己再取的一回），都断了
    expect(asked.length).toBeGreaterThanOrEqual(2);
    expect(asked.length % 2, `取了 ${asked.length} 回`).toBe(0);
    expect(asked).not.toContain('through');
    // 图片放着的话，上面没有竖着的纸条，也没有平着的纸条
    await expect(page.locator('.stage-still-host .strip-slip, .stage-still-host .strip')).toHaveCount(0);
    cut = false;
    const before = asked.length;
    await retry.click();
    await expectRealTable(page, 'full', READY_MS);
    await expectSlips(page, '.stage-host', slipsOf(WHOLE, 'ancient'), '再试一次以后');
    expect(asked.slice(before)).toContain('through');
    expect(asked.slice(before)).not.toContain('cut');
    await expect(pane).not.toContainText(FAILED_WORDS);
    expect(uncaught).toEqual([]);
  });

  test('平着的纸条那一小块取得慢，只放图片的时候：图片先放，上面还没有纸条，说的是平常的那一句；放开以后纸条摆上去，栏上什么也不换', async ({ page }) => {
    test.setTimeout(180_000);
    await page.setViewportSize(STANDARD_PANES[0].window);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => (release = resolve));
    let asked = 0;
    await page.route(SLIPS, async (routed) => {
      asked++;
      await held;
      await routed.continue();
    });
    await page.goto(`/?tier=still#/${FIGURE}`);
    const pane = stagePane(page);
    await expect(pane).toHaveAttribute('data-stage-picture', 'still', { timeout: SECTION_MS });
    await expect.poll(() => asked, { timeout: SECTION_MS }).toBeGreaterThanOrEqual(1);
    await expect(pane).toHaveAttribute('data-stage-state', 'slow');
    await expect(page.locator('.stage-notice p')).toHaveText(STILL_LINE);
    await expect(page.locator('.stage-still-host .strip-slip')).toHaveCount(0);
    release();
    await expectSlips(page, '.stage-still-host', slipsOf(WHOLE, 'ancient'), '放开以后');
    await expect(pane).toHaveAttribute('data-stage-state', 'slow');
    await expect(page.locator('.stage-notice p')).toHaveText(STILL_LINE);
    await expect(pane.locator('.stage-retry')).toHaveText('试试立体的沙盘');
  });

  test('内容的清单晚到的那一会儿：他的栏上先照有行迹的写着 data-stage-bar（还没有画面）；清单到了、全程沙盘读出来的那一下拿掉，从此没有时间轴，那一段程序没有取', async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize(STANDARD_PANES[2].window);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const requests = watchRequests(page);
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => (release = resolve));
    let asked = 0;
    await page.route(LISTS, async (routed) => {
      asked++;
      await held;
      await routed.continue();
    });
    await page.goto(`/?stage=fake#/${FIGURE}`);
    const pane = stagePane(page);
    // 人物的资料到了（各站的目录在），清单还压着：栏在“正在摆”，没有画面，照有行迹的写着
    await expect(page.locator('.stops a.stop-item')).toHaveCount(figure.stops.length);
    await expect.poll(() => asked).toBeGreaterThanOrEqual(1);
    await expect(pane).toHaveAttribute('data-stage-state', 'loading');
    await expect(pane).toHaveAttribute('data-stage-picture', 'none');
    await expect(pane).toHaveAttribute('data-stage-bar', '');
    await expect(page.locator('.stage-bar')).toHaveCount(0);
    const tall = await pane.evaluate((el: HTMLElement) => el.offsetHeight);
    release();
    await expect(pane).toHaveAttribute('data-stage-state', 'ready', { timeout: SECTION_MS });
    await expectNoBar(page, '清单到了以后');
    // 沙盘在上的排法里，栏少了那一条时间轴的高
    await expect.poll(() => pane.evaluate((el: HTMLElement) => el.offsetHeight)).toBe(STANDARD_PANES[2].size.height);
    expect(tall - STANDARD_PANES[2].size.height, '压着的那一会儿栏高出一条时间轴').toBe(96);
    expect(requests.of(BAR)).toEqual([]);
  });

  test('字：人物页、一站的页面、点开的凭据，显出来的每一段字都是随站的字体画的，没有哪个字落到设备自带的字体上；纸条上的字是随站的宋体；楷体的文件没有取。凭据：开头是那几条总的说明，照文件里的先后；没有“记号”一栏，没有行迹的出处', async ({ page }) => {
    test.setTimeout(300_000);
    await page.setViewportSize(STANDARD_PANES[0].window);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const requests = watchRequests(page);
    const client = await page.context().newCDPSession(page);
    await client.send('DOM.enable');
    await client.send('CSS.enable');
    const check = async (where: string, atLeast: number): Promise<void> => {
      await fontsReady(page);
      const seen = await platformFonts(page, client);
      expect(seen.length, `${where}：显出来的字太少，怕是没打开`).toBeGreaterThanOrEqual(atLeast);
      const bad = seen.flatMap(({ text, where: at, fonts }) => fonts.filter((font) => !font.isCustomFont || !/^Yanlu (Sans|Song|Kai)$/.test(font.familyName)).map((font) => `${at}“${text}”：有字是 ${font.familyName}（${font.glyphCount} 个字形，${font.isCustomFont ? '网页带的' : '设备自带的'}）画的`));
      expect(bad, `${where}：这几处的字不是随站的字体画的（字体里没有这个字就运行 npm run fonts）`).toEqual([]);
      expect(seen.flatMap(({ fonts }) => fonts.map((font) => font.familyName)).filter((name) => name === 'Yanlu Kai'), `${where}：没有哪个字是楷体画的`).toEqual([]);
    };
    // 人物页（只放图片：纸条在图片上，字都在）
    await page.goto(`/?tier=still#/${FIGURE}`);
    await expect(stagePane(page)).toHaveAttribute('data-stage-picture', 'still', { timeout: SECTION_MS });
    await expectSlips(page, '.stage-still-host', slipsOf(WHOLE, 'ancient'), '人物页');
    await check('人物页', 60);
    expect(await page.locator('.stage-still-host .strip-slip .strip-name').first().evaluate((el) => getComputedStyle(el).fontFamily), '纸条上的字').toMatch(/^"?Yanlu Song/);
    // 凭据点开：里面的东西到了以后再看
    await page.locator('details.provenance > summary').first().click();
    await foldBodiesReady(page);
    const register = page.locator('details.provenance[open] .scene-register');
    await expect(register).toHaveCount(1);
    //   开头的几条总的说明：排在各栏的前面，照文件里的先后，id 不印
    const general = route.general ?? [];
    expect(general.length).toBeGreaterThan(0);
    expect(await register.locator('p.scene-general').allTextContents()).toEqual(general.map((line) => line.text));
    const order = await register.evaluate((el) => Array.from(el.children).map((child) => (child.classList.contains('scene-general') ? 'general' : child.classList.contains('scene-register-group') ? 'group' : child.tagName.toLowerCase())));
    expect(order.lastIndexOf('general'), '总的说明排在各栏前面').toBeLessThan(order.indexOf('group'));
    for (const line of general) await expect(register, `id 不印：${line.id}`).not.toContainText(line.id);
    //   没有小像，没有“记号”一栏；没有行迹，没有行迹的出处
    expect(route.piece).toBeUndefined();
    await expect(page.locator('details.provenance[open] .scene-marks')).toHaveCount(0);
    await expect(page.locator('details.provenance[open] .itinerary-sources')).toHaveCount(0);
    await check('人物页，凭据点开', 300);
    // 一站的页面
    await go(page, `#/${FIGURE}/${figure.stops[4].id}`);
    await expect(page.locator('.stop-page')).toHaveAttribute('data-stop-id', figure.stops[4].id);
    await expect(stagePane(page)).toHaveAttribute('data-stage-section', viewOf(figure.stops[4].id), { timeout: SECTION_MS });
    await expectSlips(page, '.stage-still-host', slipsOf(viewOf(figure.stops[4].id), 'ancient'), '一站的页面');
    await check(`一站的页面（${figure.stops[4].id}）`, 30);
    // 这三样看下来，楷体的文件一次也没有取；另一位人物的、“来源”页的字体文件也一个没有取（他的页面只取框架的两个和他自己的）
    expect(requests.of(KAI_FILE), '楷体的文件').toEqual([]);
    expect(othersFonts(requests.all()), '别的范围的字体文件').toEqual([]);
    expect(requests.of(new RegExp(`yanlu-song-${FIGURE}-more[^/]*\\.woff2`)), '点开了凭据：他自己点开才要的那个字体文件取了一次').toHaveLength(1);
  });

  test('不出网站：他的人物页、一站的页面、点开的凭据，另一位人物的首页、人物页、一站的页面，每一个请求都是网站自己的；另一位人物的页面上没有取他的哪一个文件', async ({ page, baseURL }) => {
    test.setTimeout(300_000);
    await page.setViewportSize(STANDARD_PANES[0].window);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const requests = watchRequests(page);
    const origin = new URL(baseURL ?? 'http://localhost:5400').origin;
    const outside = (): string[] => requests.all().filter((url) => !url.startsWith(`${origin}/`) && !url.startsWith('data:') && !url.startsWith('blob:') && url !== 'about:blank');
    // 他的页面
    await page.goto(`/?tier=still#/${FIGURE}`);
    await expect(stagePane(page)).toHaveAttribute('data-stage-picture', 'still', { timeout: SECTION_MS });
    await page.locator('details.provenance > summary').first().click();
    await foldBodiesReady(page);
    await go(page, `#/${FIGURE}/${figure.stops[0].id}`);
    await expect(stagePane(page)).toHaveAttribute('data-stage-section', viewOf(figure.stops[0].id), { timeout: SECTION_MS });
    expect(outside(), '他的页面上出了网站的请求').toEqual([]);
    // 他的文件：构建清单里 content/figures/<他>/ 底下各项的文件名，加上他的样式那一半、平着的纸条那一小块
    const mine = (url: string): boolean => isHisContent(url) || HIS_HALF.test(url) || SLIPS.test(url);
    expect(requests.all().filter(mine).length, '他的页面上取了他的文件（这个认法认得出来）').toBeGreaterThan(3);

    // 另一位人物的页面：首页、人物页、他的一站
    test.skip(OTHER === null, 'content/ 里没有另一位可以点进去的人物');
    const other = watchRequests(page);
    await page.goto('about:blank');
    await page.goto('/?tier=still#/');
    await expect(page.locator('.cards .card')).toHaveCount(cards.length);
    await expect(stagePane(page)).toHaveAttribute('data-stage-picture', 'still', { timeout: SECTION_MS });
    await go(page, `#/${OTHER}`);
    await expect(page.locator('.stops a.stop-item').first()).toBeVisible();
    await expect(stagePane(page)).toHaveAttribute('data-stage-picture', 'still', { timeout: SECTION_MS });
    const stop = readJson<Figure>(`content/figures/${OTHER}/figure.json`).stops[0].id;
    await go(page, `#/${OTHER}/${stop}`);
    await expect(page.locator('.stop-page')).toHaveAttribute('data-stop-id', stop);
    await expect(stagePane(page)).toHaveAttribute('data-stage-picture', 'still', { timeout: SECTION_MS });
    expect(other.all().filter((url) => !url.startsWith(`${origin}/`) && !url.startsWith('data:') && !url.startsWith('blob:') && url !== 'about:blank'), '另一位人物的页面上出了网站的请求').toEqual([]);
    expect(other.all().filter(mine), '另一位人物的页面上取了歌德的文件').toEqual([]);
  });

  test('首页上他的卡片，照卡片现在的样子：合着是单子上的一行，标着“还没写”，不是链接；开着是链接，最后一行是“先看他走过的路”，点了到他的人物页。沙盘栏里摆的是第一位可以点进去的人物的全程沙盘；他的页面照地址总打得开', async ({ page }) => {
    test.setTimeout(180_000);
    await page.setViewportSize(STANDARD_PANES[0].window);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/?stage=fake#/');
    await expect(page.locator('.cards .card')).toHaveCount(cards.length);
    const mine = page.locator(`.cards .card[data-figure-id="${FIGURE}"]`);
    await expect(mine).toHaveCount(1);
    await expect(mine.locator('.card-name')).toHaveText(figure.name);
    await expect(mine.locator('.card-era')).toHaveText(`${card!.era} · ${card!.years}`);
    await expect(mine.locator('.card-tagline')).toHaveText(figure.tagline);
    await expect(page.locator('.home-layout')).toHaveAttribute('data-figure', FIRST_OPEN!);
    await expect(stagePane(page)).toHaveAttribute('data-stage-state', 'ready');
    if (card!.available) {
      expect(await mine.evaluate((el) => el.tagName)).toBe('A');
      await expect(mine).toHaveAttribute('href', `#/${FIGURE}`);
      await expect(mine.locator('.card-go')).toHaveText('先看他走过的路');
      await expect(mine.locator('.tag')).toHaveCount(0);
      await mine.click();
      await expect(page).toHaveURL(new RegExp(`#/${FIGURE}$`));
    } else {
      expect(await mine.evaluate((el) => el.tagName)).toBe('DIV');
      await expect(mine.locator('.tag')).toHaveText('还没写');
      await expect(mine.locator('.card-go')).toHaveCount(0);
      await expect(mine.locator('a')).toHaveCount(0);
      await mine.click();
      await expect(page).toHaveURL(/#\/$/);
      // 照地址打开
      await go(page, `#/${FIGURE}`);
    }
    await expect(page.locator('.page-title')).toHaveText(figure.name);
    await expect(page.locator('.stops a.stop-item')).toHaveCount(figure.stops.length);
    await expect(stagePane(page)).toHaveAttribute('data-stage-level', 'route');
    await expect(stagePane(page)).toHaveAttribute('data-stage-section', WHOLE);
    await expectNoBar(page, '他的人物页');
    // 目录里每一站都标着“还没写”，都点得进去
    await expect(page.locator('.stops a.stop-item .tag')).toHaveText(figure.stops.map(() => '还没写'));
  });
});

interface UsedFont {
  familyName: string;
  postScriptName: string;
  isCustomFont: boolean;
  glyphCount: number;
}

/**
 * 页面上显出来的每一段字（文字节点）各是哪些字体画的（浏览器的调试接口说的）。不算沙盘和定格图的替身、没显出来的、只有空白的。
 * 和 tests/e2e/fonts.spec.ts 是同一种问法。
 */
async function platformFonts(page: Page, client: CDPSession): Promise<{ where: string; text: string; fonts: UsedFont[] }[]> {
  const runs = await page.evaluate(() => {
    const found: { where: string; text: string }[] = [];
    const nodes: Text[] = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = (node.textContent ?? '').trim();
      const el = node.parentElement;
      if (text === '' || !el) continue;
      if (el.closest('.fake-stage, .fake-still, script, style, noscript')) continue;
      if (el.getClientRects().length === 0) continue;
      if (!el.checkVisibility({ visibilityProperty: true, checkVisibilityCSS: true })) continue;
      nodes.push(node as Text);
      found.push({ where: `${el.tagName.toLowerCase()}${typeof el.className === 'string' && el.className.trim() !== '' ? `.${el.className.trim().split(/\s+/).join('.')}` : ''}`, text: text.length > 24 ? `${text.slice(0, 24)}…` : text });
    }
    (window as Window & { __fontRuns?: Text[] }).__fontRuns = nodes;
    return found;
  });
  await client.send('DOM.getDocument', { depth: 0 });
  const { result: list } = (await client.send('Runtime.evaluate', { expression: 'window.__fontRuns', returnByValue: false })) as { result: { objectId?: string } };
  if (!list.objectId) throw new Error('页面上没有记下那些字');
  const { result: properties } = (await client.send('Runtime.getProperties', { objectId: list.objectId, ownProperties: true })) as { result: { name: string; value?: { objectId?: string } }[] };
  const handles = new Map(properties.filter((property) => /^\d+$/.test(property.name)).map((property) => [Number(property.name), property.value?.objectId]));
  const out: { where: string; text: string; fonts: UsedFont[] }[] = [];
  for (const [i, run] of runs.entries()) {
    const objectId = handles.get(i);
    if (!objectId) continue;
    const { nodeId } = (await client.send('DOM.requestNode', { objectId })) as { nodeId: number };
    const { fonts } = (await client.send('CSS.getPlatformFontsForNode', { nodeId })) as { fonts: UsedFont[] };
    out.push({ ...run, fonts });
  }
  await client.send('Runtime.releaseObject', { objectId: list.objectId });
  return out;
}

/** 构建出来的网站里他的内容文件叫什么（照 dist/.vite/manifest.json；没有构建过、或者对着开发服务跑的时候是空的，那时照地址里的文件夹认）。 */
function hisBuiltFiles(): string[] {
  return hisBuiltPaths().map((path) => path.slice(path.lastIndexOf('/') + 1));
}

/** 同上，连着文件夹（assets/<名字>-<一串字符>.<后缀>）：从网站的根取得到。 */
function hisBuiltPaths(): string[] {
  try {
    const manifest = readJson<Record<string, { file: string; assets?: string[] }>>('dist/.vite/manifest.json');
    return Object.keys(manifest)
      .filter((key) => key.startsWith(`content/figures/${FIGURE}/`))
      .map((key) => manifest[key].file);
  } catch {
    return [];
  }
}

/** 这个地址取的是不是他的内容文件：开发服务上照地址里他的文件夹认，构建出来的网站里照构建清单里他那几个文件的名字认。 */
function isHisContent(url: string): boolean {
  return url.includes(`/figures/${FIGURE}/`) || hisBuiltFiles().some((name) => url.endsWith(`/${name}`));
}
