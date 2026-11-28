// 随站的字体按范围分（一页只拿框架的两个文件和它自己那个范围的），在真的页面上查。照记录（src/fonts/fonts.json 的 pages）说
// 每一种页面该拿哪几个文件；浏览器真的来要了哪几个，一个请求一个请求记下来。字体的名单里没有“兜底”的那一层
//（一站的页面上只有框架的和这一站的，别的范围的文件不在名单里），靠的是做字体的工具把每一种页面显示的字数对了：这里是它在浏览器里的证据。
//
//   一、框架的文件和这一页自己的文件都压住不给，浏览器不去要别的字体文件（每一种页面）。
//   二、每一种页面平常要的，正好是记录里这一种页面不用点开就要的那几个，各一次；歌德的页面不要苏轼的，苏轼的不要歌德的，
//       “来源”页不要哪位人物的。点开才要的文件到该要的时候才要：折着的点开了；写好了的一站空下来两秒以后。各一次。
//   三、在一份页面里从苏轼走到歌德再走回来：去的时候只多要歌德的文件，回来什么也不要；文件在手里的页面，正文那一栏从来不等。
//   四、index.html 里先不生效的预先声明：页面的程序还没到，照地址合得上的那几行已经生效了，别的范围的一行也没有取；
//       把 index.html 里那几行脚本拿掉，页面的程序自己把这一页的文件要来，只是晚一步。
//   五、这一页自己的文件来得慢：正文那一栏先等一小会儿（最多 0.3 秒）再显出来，显出来的时候字都在（框架的字已经是随站的字，
//       别的先用设备自带的字顶着）；文件到了换成随站的字，题签还在原处。
// 每一段字都是哪个文件画的（走一遍网站），在 tests/e2e/fonts.spec.ts。
// 这些只证明 Chromium 里是这样。iPad 上的 Safari 这台机器跑不了。
//
// 照片存到 tests/shots/fonts/（不进仓库）；想另存一处，设环境变量 SHOTS_DIR。

import { mkdirSync, writeFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import type { CDPSession, Page } from '@playwright/test';
import { fontsReady, foldBodiesReady, realUrl, stagePane } from './helpers';
import { FONT_RECORD, SONG, debugger_, fileOfFont, fontsOfRuns, holdFonts, isShipped, ownOf, pageFiles, recorded, watchFonts } from './fontHelpers';
import { readBytes } from '../support/readBytes';

const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
const DIR = env.SHOTS_DIR ?? 'tests/shots/fonts';
const utf8 = new TextDecoder();

/** 页面的主程序（构建以后的，或者开发服务上的）。 */
const MAIN_SCRIPT = /\/(assets\/index-[\w-]+\.js|src\/main\.tsx)(\?.*)?$/;

interface StopOnDisk {
  id: string;
  status: string;
}
/** 可以点进去的人物（照卡片的先后），和他的各站。 */
const FIGURES = (JSON.parse(utf8.decode(readBytes('content/figures/index.json'))) as { id: string; sortYear: number; available: boolean }[])
  .sort((a, b) => a.sortYear - b.sortYear)
  .filter((card) => card.available)
  .map((card) => ({ id: card.id, stops: (JSON.parse(utf8.decode(readBytes(`content/figures/${card.id}/figure.json`))) as { stops: StopOnDisk[] }).stops }));
/** 这一站有没有自己的字体文件（记录里有它那一项）。 */
const isUnit = (figure: string, stop: string): boolean => FONT_RECORD.pages.some((page) => page.kind === 'unit' && page.figure === figure && page.unit === stop);

/** 每一种页面各一个地址：首页；每位人物的人物页、他有自己的文件的每一站、没有自己的文件的头一站；“来源”页；三种不是哪一页的地址。 */
const ADDRESSES: { label: string; hash: string; kind: 'pane' | 'sources' | 'missing'; written: boolean }[] = [
  { label: '首页', hash: '#/', kind: 'pane', written: false },
  ...FIGURES.flatMap((figure) => {
    const bare = figure.stops.find((stop) => !isUnit(figure.id, stop.id));
    return [
      { label: `${figure.id} 的人物页`, hash: `#/${figure.id}`, kind: 'pane' as const, written: false },
      ...figure.stops.filter((stop) => isUnit(figure.id, stop.id)).map((stop) => ({ label: `${figure.id} 的 ${stop.id}（有自己的字体文件）`, hash: `#/${figure.id}/${stop.id}`, kind: 'pane' as const, written: stop.status === 'complete' })),
      ...(bare ? [{ label: `${figure.id} 的 ${bare.id}（没有自己的字体文件）`, hash: `#/${figure.id}/${bare.id}`, kind: 'pane' as const, written: false }] : []),
    ];
  }),
  { label: '“来源”页', hash: '#/sources', kind: 'sources', written: false },
  { label: '没有这位人物', hash: '#/no-such-figure', kind: 'missing', written: false },
  { label: '#/sources/…（不是哪一页）', hash: '#/sources/x', kind: 'missing', written: false },
  ...(FIGURES[0] ? [{ label: `${FIGURES[0].id} 没有这一站（摆着他的全程沙盘）`, hash: `#/${FIGURES[0].id}/no-such-stop`, kind: 'pane' as const, written: false }] : []),
];

/** 只放图片的样子（不摆立体的沙盘，快；题签是页面摆的，和立体的那一档是同样的字）。 */
const url = (hash: string): string => realUrl(hash, null, '&tier=still');

/** 等这一页出来：有沙盘栏的等图片垫上；“来源”页等两栏；不是哪一页的等那一句话。字体到没到不管。 */
async function up(page: Page, address: (typeof ADDRESSES)[number]): Promise<void> {
  if (address.kind === 'pane') await expect(stagePane(page)).toHaveAttribute('data-stage-picture', 'still', { timeout: 60_000 });
  else if (address.kind === 'sources') {
    await expect(page.locator('.sources-list li').first()).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('.sources .quiet')).toHaveCount(0);
  } else await expect(page.locator('.page-title')).toBeVisible({ timeout: 30_000 });
}

const sorted = (names: readonly string[]): string[] => [...names].sort();

/** 不等字体，照现在的样子拍一张（测试工具自己的拍照会先等字体到齐，字体压着的时候它就一直等）。 */
async function shootNow(client: CDPSession, path: string): Promise<void> {
  const { data } = (await client.send('Page.captureScreenshot', { format: 'png' })) as { data: string };
  mkdirSync(path.slice(0, path.lastIndexOf('/')), { recursive: true });
  writeFileSync(path, Uint8Array.from(atob(data), (ch) => ch.charCodeAt(0)));
}

test('记录里每一种页面都在这里走到了：只有框架的、首页、每位人物的人物页、他有自己的文件的每一站、“来源”页；两位以上的人物', () => {
  expect(FIGURES.length).toBeGreaterThanOrEqual(2);
  const walked = new Set(ADDRESSES.map((address) => pageFiles(address.hash).page));
  expect(FONT_RECORD.pages.filter((page) => !walked.has(page)).map((page) => `${page.kind} ${page.figure ?? ''} ${page.unit ?? ''}`)).toEqual([]);
  // 认地址的那一段和记录对得上：一站自己有文件的拿它自己的宋体，没有的拿人物的
  for (const page of FONT_RECORD.pages) for (const file of [...page.rest, ...page.pressed]) expect(FONT_RECORD.files.map((item) => item.file)).toContain(file);
});

test('框架的两个文件和这一页自己的文件都压住不给的时候，浏览器不去要别的字体文件：每一种页面来要的，正好是记录里这一种页面不用点开就要的那几个，各一次——别的范围的、点开才要的一个也没有来要（字体的名单里没有“兜底”的一层，这一条替它守着）', async ({ browser, baseURL }) => {
  test.setTimeout(600_000);
  const seen: string[] = [];
  for (const address of ADDRESSES) {
    // 一页一个干净的页面（什么都没存着），凡是字体文件都压住
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce', baseURL });
    const page = await context.newPage();
    try {
      const gate = await holdFonts(page, () => true);
      const want = pageFiles(address.hash).rest;
      await page.goto(url(address.hash), { waitUntil: 'commit' });
      await up(page, address);
      // 该要的都来要过了（压着没放）
      await expect.poll(() => sorted(gate.held()), { timeout: 30_000, message: `${address.label}：压着字体文件的时候，来要的字体文件` }).toEqual(sorted(want));
      // 再等两秒：这中间没有再来要别的（字还都是别的字体顶着的；写好了的一站“空下来再取”的那一步等的是字体到齐，这时走不到）
      await page.waitForTimeout(2_000);
      expect(sorted(gate.held()), `${address.label}：压着字体文件又过了两秒，来要的字体文件（照先后：${gate.held().join('、')}）`).toEqual(sorted(want));
      // 页面上有字（不空着）
      expect((await page.locator('main').innerText()).trim().length, `${address.label}：压着字体文件的时候页面上的字`).toBeGreaterThan(5);
      seen.push(`${address.label}（${address.hash}）：${gate.held().join('、')}`);
      gate.release();
    } finally {
      await context.close();
    }
  }
  console.log(['字体文件都压住的时候，每一种页面来要的字体文件（照来要的先后）：', ...seen.map((line) => `  ${line}`)].join('\n'));
});

test('每一种页面平常要的字体文件，正好是记录里这一种页面不用点开就要的那几个，各一次：歌德的页面不要苏轼的（也不要楷体），苏轼的不要歌德的，“来源”页不要哪位人物的，不是哪一页的地址只要框架的两个。点开才要的那个文件：首页、人物页、没写的站上等三秒半不要；写好了的一站，字体到齐以后自己要来，只要一次', async ({ browser, baseURL }) => {
  test.setTimeout(600_000);
  const seen: string[] = [];
  for (const address of ADDRESSES) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce', baseURL });
    const page = await context.newPage();
    try {
      const fonts = watchFonts(page);
      const { rest, pressed } = pageFiles(address.hash);
      await page.goto(url(address.hash));
      await up(page, address);
      if (address.hash === '#/') await expect.poll(() => page.locator('.stage-pane .strip').evaluateAll((strips) => strips.filter((strip) => getComputedStyle(strip).visibility === 'visible').length), { message: '首页的全程沙盘上题签该挂出来' }).toBeGreaterThan(5);
      await fontsReady(page);
      // 不用点开就要的：都来要过了，各一次；没有别的范围的
      await expect.poll(() => sorted(fonts.names().filter((name) => !pressed.includes(name))), { message: `${address.label}：要的字体文件（${fonts.all().join(' ')}）` }).toEqual(sorted(rest));
      if (address.written) {
        // 写好了的一站：字体到齐以后，页面自己把这一站点开才要的那个文件要来（等的是它来，不卡几秒之内）
        expect(pressed, `${address.label}：记录里它有点开才要的文件`).toHaveLength(1);
        await expect.poll(() => fonts.of(pressed[0]).length, { timeout: 30_000, message: `${address.label}：字体到齐以后，点开才要的那个文件该自己要来` }).toBe(1);
        await fontsReady(page);
        await page.waitForTimeout(1_000);
      } else {
        await page.waitForTimeout(3_500);
        expect(fonts.names().filter((name) => recorded(name).role === 'pressed'), `${address.label}：等了三秒半，点开才要的文件不该要（${fonts.all().join(' ')}）`).toEqual([]);
      }
      expect(sorted(fonts.names()), `${address.label}：一共要的字体文件，各一次（${fonts.all().join(' ')}）`).toEqual(sorted([...rest, ...(address.written ? pressed : [])]));
      // 说得明白一些：要来的文件，不是框架的，就是这一页那位人物（或者“来源”页）的
      const figure = pageFiles(address.hash).page.figure;
      for (const name of fonts.names()) {
        const file = recorded(name);
        expect(file.scope === 'frame' || file.scope === (figure ?? 'sources'), `${address.label}：要了别的范围的 ${name}`).toBe(true);
        expect(file.unit === null || file.unit === pageFiles(address.hash).page.unit, `${address.label}：要了别的站的 ${name}`).toBe(true);
      }
      // 字节：这一页不用点开就要的合计，就是记录里这一种页面的那个数
      expect(rest.reduce((sum, name) => sum + recorded(name).bytes, 0)).toBe(pageFiles(address.hash).page.bytes);
      seen.push(`${address.label}（${address.hash}）：${rest.length} 个文件 ${pageFiles(address.hash).page.bytes} 字节 —— ${fonts.all().join(' ')}`);
    } finally {
      await context.close();
    }
  }
  console.log(['每一种页面要的字体文件（文件@打开以后多少毫秒）：', ...seen.map((line) => `  ${line}`)].join('\n'));
});

test('点开才要的文件，点开了才要、只要一次：人物页上点开凭据，要的是这位人物点开才要的那一个；没写正文、有自己的沙盘的一站上点开凭据，要的是这一站的；再点开别的、合上再点开，都不再要', async ({ page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  const fonts = watchFonts(page);
  const unwritten = FIGURES.flatMap((figure) => figure.stops.filter((stop) => stop.status !== 'complete' && isUnit(figure.id, stop.id)).map((stop) => `#/${figure.id}/${stop.id}`))[0];
  const cases = [...FIGURES.map((figure) => `#/${figure.id}`), ...(unwritten ? [unwritten] : [])];
  expect(cases.length).toBeGreaterThanOrEqual(2);
  for (const hash of cases) {
    const { pressed } = pageFiles(hash);
    expect(pressed, `${hash}：记录里它有点开才要的文件`).toHaveLength(1);
    await page.goto('about:blank');
    await page.goto(url(hash));
    await expect(stagePane(page)).toHaveAttribute('data-stage-picture', 'still', { timeout: 60_000 });
    await fontsReady(page);
    await page.waitForTimeout(1_500);
    const before = fonts.of(pressed[0]).length;
    const fold = page.locator('details.provenance > summary').first();
    await expect(fold, `${hash}：这一页有一行折着的凭据`).toHaveCount(1);
    await fold.evaluate((summary: HTMLElement) => summary.click());
    await foldBodiesReady(page);
    await expect.poll(() => fonts.of(pressed[0]).length - before, { message: `${hash}：点开凭据以后，${pressed[0]} 该来要（${fonts.all().join(' ')}）` }).toBe(1);
    await fontsReady(page);
    // 合上再点开：不再要
    await fold.evaluate((summary: HTMLElement) => summary.click());
    await fold.evaluate((summary: HTMLElement) => summary.click());
    await fontsReady(page);
    expect(fonts.of(pressed[0]).length - before, `${hash}：${pressed[0]} 只该要一次`).toBe(1);
    // 点开的那一块里的字，都是这一页拿到的文件画的
    const client = await debugger_(page);
    const drawn = await fontsOfRuns(page, client, 'details.provenance[open]');
    expect(drawn.length, `${hash}：点开的凭据里的字`).toBeGreaterThan(5);
    const allowed = [...pageFiles(hash).rest, ...pressed];
    const bad = drawn.flatMap(({ run, fonts: used }) => used.filter((font) => !allowed.includes(fileOfFont(font) ?? '')).map((font) => `${run.where}“${run.text}”：${font.familyName}（${font.postScriptName}${font.isCustomFont ? '' : '，设备自带的'}）`));
    expect(bad, `${hash}：点开的凭据里，这几处的字不是这一页拿到的字体文件画的`).toEqual([]);
    await client.detach();
  }
});

test('在一份页面里从头一位人物走到另一位再走回来：去的时候只多要另一位的文件（不要楷体），回来一个也不要；再进一站只多要这一站的宋体。文件已经在手里的页面，正文那一栏从来不挂“等一等”', async ({ page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  expect(FIGURES.length).toBeGreaterThanOrEqual(2);
  const [first, second] = FIGURES.map((figure) => figure.id);
  // 记下 <html> 上每一回挂上 data-fonts-wait（正文那一栏等字体）是在哪个地址上
  await page.addInitScript(() => {
    const waits: string[] = [];
    (window as unknown as { __fontWaits: string[] }).__fontWaits = waits;
    const watch = (): void => {
      new MutationObserver(() => {
        if (document.documentElement.hasAttribute('data-fonts-wait') && waits[waits.length - 1] !== location.hash) waits.push(location.hash);
      }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-fonts-wait'] });
    };
    if (document.documentElement) watch();
    else new MutationObserver((_records, observer) => (document.documentElement ? (observer.disconnect(), watch()) : undefined)).observe(document, { childList: true });
  });
  const fonts = watchFonts(page);
  const go = (hash: string): Promise<void> => page.evaluate((to) => void (window.location.hash = to), hash);
  const settled = async (shows: string): Promise<string[]> => {
    await expect(page.locator(shows).first()).toBeVisible({ timeout: 30_000 });
    await expect(stagePane(page)).toHaveAttribute('data-stage-picture', 'still', { timeout: 60_000 });
    await fontsReady(page);
    await page.waitForTimeout(1_200);
    await fontsReady(page);
    return fonts.names();
  };
  await page.goto(url(`#/${first}`));
  const atFirst = await settled(`.figure-layout[data-figure="${first}"] .page-title`);
  expect(sorted(atFirst)).toEqual(sorted(pageFiles(`#/${first}`).rest));
  // 到另一位：只多要他自己的（框架的已经在手里）
  await go(`#/${second}`);
  const atSecond = await settled(`.figure-layout[data-figure="${second}"] .page-title`);
  expect(sorted(atSecond.slice(atFirst.length)), `到 ${second} 多要的字体文件`).toEqual(sorted(ownOf(pageFiles(`#/${second}`).rest)));
  expect(atSecond.slice(atFirst.length).filter((name) => recorded(name).scope !== second)).toEqual([]);
  // 回来：一个也不要
  await go(`#/${first}`);
  const back = await settled(`.figure-layout[data-figure="${first}"] .page-title`);
  expect(back.slice(atSecond.length), `回到 ${first} 不该再要字体文件`).toEqual([]);
  // 回来的那一页文件都在手里：正文那一栏没有等（这一回没有挂过 data-fonts-wait）
  const waits = await page.evaluate(() => (window as unknown as { __fontWaits: string[] }).__fontWaits);
  expect(waits.filter((hash) => hash === `#/${first}`).length, `文件在手里的页面不等：挂过“等一等”的地址 ${waits.join('、')}`).toBeLessThanOrEqual(1);
  expect(waits[waits.length - 1] === `#/${first}` && waits.length > 1, `回到 ${first} 的那一回不该挂“等一等”（挂过的地址：${waits.join('、')}）`).toBe(false);
  expect(await page.evaluate(() => document.documentElement.hasAttribute('data-fonts-wait'))).toBe(false);
  // 再进他有自己的文件的一站：只多要这一站的宋体（黑体、楷体是人物的，已经在手里）
  const unit = FIGURES.find((figure) => figure.id === first)?.stops.find((stop) => isUnit(first, stop.id));
  expect(unit, `${first} 要有一站有自己的字体文件`).toBeDefined();
  if (!unit) return;
  const stopHash = `#/${first}/${unit.id}`;
  await go(stopHash);
  const atStop = await settled(`.stop-page[data-stop-id="${unit.id}"]`);
  const more = atStop.slice(back.length).filter((name) => recorded(name).role === 'rest');
  expect(more, `进 ${unit.id} 多要的不用点开的字体文件`).toEqual(pageFiles(stopHash).rest.filter((name) => recorded(name).unit === unit.id));
  // 这一路要过的文件各只一次
  expect(new Set(atStop).size, `一路上要的字体文件各只一次（${fonts.all().join(' ')}）`).toBe(atStop.length);
  console.log(`一份页面里 ${first} → ${second} → ${first} → ${unit.id}：${fonts.all().join(' ')}；正文那一栏等过字体的地址：${waits.join('、') || '没有'}`);
});

test('index.html 里先不生效的预先声明：页面的程序还压着没到，照地址合得上的那几行已经生效、文件已经来要了——这位人物的黑体，和这一站自己的宋体（它没有自己的就是人物的），首页是沙盘栏里摆着的那位人物的；别的范围的一行也没有取，楷体不在里面，不是哪一页的地址只取框架的两个。放行以后页面要齐这一页的文件，各一次', async ({ browser, baseURL }) => {
  test.setTimeout(600_000);
  const seen: string[] = [];
  for (const address of ADDRESSES) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce', baseURL });
    const page = await context.newPage();
    try {
      const fonts = watchFonts(page);
      let open: () => void = () => {};
      const gate = new Promise<void>((resolve) => (open = resolve));
      let held = 0;
      await page.route(MAIN_SCRIPT, async (route) => {
        held++;
        await gate;
        await route.continue().catch(() => {});
      });
      await page.goto(url(address.hash), { waitUntil: 'commit' });
      await expect.poll(() => held, { message: '页面的程序来要过了（压着没放）' }).toBeGreaterThanOrEqual(1);
      // 这时候只有 index.html 自己：两行生效的预先声明，和那几行脚本抄出来生效的几行
      const { rest } = pageFiles(address.hash);
      const early = rest.filter((name) => recorded(name).source !== 'kai');
      await expect.poll(() => sorted(fonts.names()), { message: `${address.label}：页面的程序还没到的时候来要的字体文件（${fonts.all().join(' ')}）` }).toEqual(sorted(early));
      await page.waitForTimeout(1_000);
      expect(sorted(fonts.names()), `${address.label}：页面的程序还没到，又过了一秒（${fonts.all().join(' ')}）`).toEqual(sorted(early));
      // 页面上那一段先不生效的还都在，生效的是抄出来的另一份
      const lines = await page.evaluate(() => ({ inert: document.querySelectorAll('link[rel="preload"][media="not all"]').length, live: Array.from(document.querySelectorAll('link[rel="preload"][as="font"]:not([media])')).length }));
      expect(lines.inert, 'index.html 里先不生效的预先声明').toBe(FONT_RECORD.files.filter((item) => item.scope !== 'frame' && item.role === 'rest' && item.source !== 'kai').length);
      expect(lines.live, `${address.label}：生效的预先声明`).toBe(early.length);
      seen.push(`${address.label}（${address.hash}）：${fonts.all().join(' ')}`);
      open();
      await up(page, address);
      await fontsReady(page);
      await expect.poll(() => sorted(fonts.names().filter((name) => recorded(name).role === 'rest')), { message: `${address.label}：放行以后要齐了这一页的文件（${fonts.all().join(' ')}）` }).toEqual(sorted(rest));
      expect(new Set(fonts.names()).size, `${address.label}：各只要一次（${fonts.all().join(' ')}）`).toBe(fonts.names().length);
    } finally {
      await context.close();
    }
  }
  console.log(['页面的程序还没到的时候，index.html 自己要来的字体文件（文件@毫秒）：', ...seen.map((line) => `  ${line}`)].join('\n'));
});

test('把 index.html 里照地址取字体的那几行脚本拿掉：页面的程序压着的时候来要的只有框架的两个（这一页自己的那几个是那几行脚本先要的）；放行以后页面的程序自己把这一页的文件要齐，各一次，页面照样对', async ({ browser, baseURL }) => {
  test.setTimeout(300_000);
  /** 那几行脚本：从 var parts = location.hash 开头的那一个普通脚本。 */
  const PLAIN = /<script>\s*\(function \(\) \{\s*var parts = location\.hash[\s\S]*?\}\)\(\);\s*<\/script>/;
  const cases = ADDRESSES.filter((address) => address.kind !== 'missing').filter((address, index, all) => index === 0 || index === all.length - 1 || address.written || address.hash.split('/').length === 2);
  expect(cases.length).toBeGreaterThanOrEqual(4);
  for (const address of cases) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce', baseURL });
    const page = await context.newPage();
    try {
      const fonts = watchFonts(page);
      let cut = 0;
      await page.route(
        (address_) => address_.pathname === '/' || address_.pathname.endsWith('/index.html'),
        async (route) => {
          const response = await route.fetch();
          const html = await response.text();
          if (PLAIN.test(html)) cut++;
          await route.fulfill({ response, body: html.replace(PLAIN, '') });
        },
      );
      let open: () => void = () => {};
      const gate = new Promise<void>((resolve) => (open = resolve));
      let held = 0;
      await page.route(MAIN_SCRIPT, async (route) => {
        held++;
        await gate;
        await route.continue().catch(() => {});
      });
      await page.goto(url(address.hash), { waitUntil: 'commit' });
      await expect.poll(() => held, { message: '页面的程序来要过了（压着没放）' }).toBeGreaterThanOrEqual(1);
      expect(cut, 'index.html 里找到了那几行脚本，拿掉了').toBe(1);
      const frame = pageFiles('#/no-such-figure').rest;
      await expect.poll(() => sorted(fonts.names()), { message: `${address.label}：没有那几行脚本、页面的程序还没到的时候来要的字体文件` }).toEqual(sorted(frame));
      await page.waitForTimeout(1_000);
      expect(sorted(fonts.names()), `${address.label}：没有那几行脚本，页面的程序还没到——只该有框架的两个（${fonts.all().join(' ')}）`).toEqual(sorted(frame));
      expect(await page.evaluate(() => document.documentElement.getAttribute('data-fonts'))).toBeNull();
      open();
      await up(page, address);
      await fontsReady(page);
      const { rest } = pageFiles(address.hash);
      await expect.poll(() => sorted(fonts.names().filter((name) => recorded(name).role === 'rest')), { message: `${address.label}：页面的程序自己把这一页的文件要齐了（${fonts.all().join(' ')}）` }).toEqual(sorted(rest));
      expect(new Set(fonts.names()).size, `${address.label}：各只要一次`).toBe(fonts.names().length);
      // 页面照样对：两个属性是页面的程序写的；每一段字都是这一页拿到的文件画的
      const parts = address.hash.replace(/^#\//, '').split('/').filter((part) => part !== '');
      await expect.poll(() => page.evaluate(() => [document.documentElement.getAttribute('data-fonts'), document.documentElement.getAttribute('data-fonts-unit')])).toEqual([parts[0] ?? FONT_RECORD.home, parts[1] ?? null]);
      const client = await debugger_(page);
      const drawn = await fontsOfRuns(page, client);
      const bad = drawn.flatMap(({ run, fonts: used }) => used.filter((font) => !rest.includes(fileOfFont(font) ?? '')).map((font) => `${run.where}“${run.text}”：${font.familyName}（${font.postScriptName}）`));
      expect(bad, `${address.label}：没有那几行脚本，这几处的字不是这一页拿到的字体文件画的`).toEqual([]);
      await client.detach();
    } finally {
      await context.close();
    }
  }
});

test('这一页自己的字体文件来得慢（框架的两个先到）：正文那一栏先等着不显出来，等不到 0.3 秒以外去——文件还压着，它也显出来了，字都在（框架的文件里有的字已经是随站的字，别的先用设备自带的字顶着）；放行以后每一段字都换成这一页拿到的随站的字，正文那一栏不再等；题签还在原处、还是那么大（差不过半个像素）', async ({ browser, baseURL }) => {
  test.setTimeout(300_000);
  const figure = FIGURES.find((item) => item.stops.some((stop) => stop.status === 'complete' && isUnit(item.id, stop.id)));
  const stop = figure?.stops.find((item) => item.status === 'complete' && isUnit(figure.id, item.id));
  expect(figure && stop, '要有一站写好了正文、有自己的字体文件').toBeTruthy();
  if (!figure || !stop) return;
  const hash = `#/${figure.id}/${stop.id}`;
  const { rest } = pageFiles(hash);
  const own = ownOf(rest);
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce', baseURL });
  const page = await context.newPage();
  try {
    const gate = await holdFonts(page, own);
    const client = await debugger_(page);
    await page.goto(url(hash), { waitUntil: 'commit' });
    await expect(page.locator('.text-section').first()).toBeAttached({ timeout: 30_000 });
    await expect(stagePane(page)).toHaveAttribute('data-stage-picture', 'still', { timeout: 60_000 });
    await expect.poll(() => sorted(gate.held()), { message: '这一页自己的字体文件都来要过了（压着没放）' }).toEqual(sorted(own));
    // 等到“等一等”拿掉（文件还压着：是时候到了拿掉的）；这以后正文那一栏是看得见的
    await expect.poll(() => page.evaluate(() => document.documentElement.hasAttribute('data-fonts-wait')), { message: '文件一直不到，正文那一栏也该显出来（<html> 上的 data-fonts-wait 拿掉）' }).toBe(false);
    await expect.poll(() => page.locator('.reading-inner').evaluate((el) => getComputedStyle(el).opacity)).toBe('1');
    const strips = page.locator('.stage-still-host .strip');
    await expect.poll(() => strips.evaluateAll((items) => items.filter((item) => getComputedStyle(item).visibility === 'visible').length), { message: '题签该挂出来（字体文件压着也一样）' }).toBeGreaterThan(0);
    const boxes = (): Promise<{ text: string; x: number; y: number; width: number; height: number }[]> =>
      strips.evaluateAll((items) =>
        items
          .filter((item) => getComputedStyle(item).visibility === 'visible')
          .map((item) => {
            const box = item.getBoundingClientRect();
            return { text: item.textContent ?? '', x: box.x, y: box.y, width: box.width, height: box.height };
          }),
      );
    // 压着的时候：每一段字都有字形；没有哪一段是这一页自己的文件画的；正文里两种字都有——框架的文件画的，和设备自带的
    const early = await fontsOfRuns(page, client, 'main', false);
    expect(early.length).toBeGreaterThan(40);
    for (const item of early) {
      expect(item.fonts.reduce((sum, font) => sum + font.glyphCount, 0), `压着这一页自己的字体文件的时候，“${item.run.text}”上没有字`).toBeGreaterThan(0);
      for (const font of item.fonts) expect(own.includes(fileOfFont(font) ?? ''), `“${item.run.text}”已经是 ${font.postScriptName} 画的了：文件没有压住，这一项没查到东西`).toBe(false);
    }
    const body = early.filter((item) => item.run.where.includes('p'));
    const byFrame = body.flatMap((item) => item.fonts).filter((font) => fileOfFont(font) === 'yanlu-song').reduce((sum, font) => sum + font.glyphCount, 0);
    const byDevice = body.flatMap((item) => item.fonts).filter((font) => !font.isCustomFont).reduce((sum, font) => sum + font.glyphCount, 0);
    expect(byFrame, '框架的宋体文件已经到了：正文里它有的字已经是它画的').toBeGreaterThan(0);
    expect(byDevice, '这一站自己的文件还压着：正文里别的字先用设备自带的字顶着').toBeGreaterThan(0);
    const earlyBoxes = await boxes();
    await shootNow(client, `${DIR}/scope-file-held-1440x900.png`);
    // 放行：每一段字都是这一页拿到的文件画的
    gate.release();
    let late = early;
    await expect
      .poll(
        async () => {
          late = await fontsOfRuns(page, client, 'main', false);
          return late.flatMap((item) => item.fonts).filter((font) => !rest.includes(fileOfFont(font) ?? '')).length;
        },
        { timeout: 30_000, message: '放行以后，正文那一栏里还有字不是这一页拿到的随站的字体画的' },
      )
      .toBe(0);
    for (const item of late) for (const font of item.fonts) expect(isShipped(font, SONG) || font.familyName.startsWith('Yanlu'), `“${item.run.text}”`).toBe(true);
    expect(await page.evaluate(() => document.documentElement.hasAttribute('data-fonts-wait'))).toBe(false);
    // 题签不动：每一条还在原处，还是那么大（差不过半个像素）。换完字体页面要重排一遍，量一次不算数，等到量出来对上为止
    const moved = (now: { text: string; x: number; y: number; width: number; height: number }[]): string[] => {
      if (now.length !== earlyBoxes.length) return [`题签原来 ${earlyBoxes.length} 条，现在 ${now.length} 条`];
      return now.flatMap((item, i) => {
        const was = earlyBoxes[i];
        const same = item.text === was.text && Math.abs(item.x - was.x) <= 0.5 && Math.abs(item.y - was.y) <= 0.5 && Math.abs(item.width - was.width) <= 0.5 && Math.abs(item.height - was.height) <= 0.5;
        return same ? [] : [`“${was.text}”原来在 (${was.x.toFixed(1)}, ${was.y.toFixed(1)})、${was.width.toFixed(1)} × ${was.height.toFixed(1)}，现在“${item.text}”在 (${item.x.toFixed(1)}, ${item.y.toFixed(1)})、${item.width.toFixed(1)} × ${item.height.toFixed(1)}`];
      });
    };
    await expect.poll(async () => moved(await boxes()), { message: '这一页自己的字体文件到了以后，题签挪了地方或者变了大小（差过了半个像素）' }).toEqual([]);
    console.log(`${hash}：压着 ${own.join('、')} 的时候，正文里框架的宋体画了 ${byFrame} 个字形，设备自带的字顶着 ${byDevice} 个；放行以后 ${late.length} 段字都是这一页拿到的文件画的；题签 ${earlyBoxes.length} 条没有动`);
  } finally {
    await context.close();
  }
});
