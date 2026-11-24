// 整个版面（FigureLayout：人物页、站点页）的行为：用假 DOM（miniDom.ts）在 Node 里连同 content/ 里真的内容和沙盘的替身跑一遍。
// 不看版面和样式（那是 tests/e2e 的事）。
//
// 黄州在这个文件里是“写好了正文、还没有自己的沙盘的一站”的替身（2026-11-23 起）：黄州自己的沙盘做出来以后，
// content/ 里已经没有这样的一站了，可是这种情形还会再有（后面六座沙盘，哪一站都可能正文先写好），页面上这条路
// （沙盘栏摆全程沙盘上到这一站去的来路，按钮下面多一行话）还得查。所以只在这个文件里，把黄州的沙盘拿走：
// src/domain/sceneContent 的 hasStopTable、loadStopTable 问到黄州时答“没有”，别的原样；正文、凭据、全程沙盘都是真的。
// 黄州有了沙盘以后的样子，在 second-table.test.tsx 里查（那里不拿走什么）。
//
// 眉州（头一站，正文还没写）2026-11-23 起有了自己的沙盘。原来拿它当“还没写、也没有自己的沙盘的一站”的地方，
// 现在都换成 BARE：照 figure.json 和 content/ 里有哪些场景文件找出来的头一个这样的站（现在是杭州）。
// “头一站没有来路，说的是出发的路”那半句 2026-11-24 从页面的程序里拿掉了（头一站有了沙盘，哪一站也走不到它），查它的那几行一起拿掉。
//
// “有自己的沙盘、正文还没写的一站”（文字栏里是一句话、一张单子“沙盘上看的几处”、沙盘的凭据）也用替身查：哪一天六站的正文
// 都写好了，content/ 里就没有这样的站，页面上这条路还在。替身是 STAND_IN——最后一个还没写、也没有场景文件的站：
// 只在查它的那几条里（g.__standIn），hasStopTable 答“有”，loadStopTable 给的是徐州的沙盘，场景里的 stopId 换成它、
// 出处（sources）换成徐州 stops/xuzhou.json 里的那一份。眉州真的样子另有一条，content/ 里没有这样的站时自己跳过。
// 沙盘的数据读得慢、读不出来（g.__tableGate、g.__tableFails），正文读不出来（g.__textFails），也在这里装。
import { describe, expect, it, vi } from 'vitest';
import { stopHref } from '../../../src/app/router';
import { stopMarks, stripTexts } from '../../../src/domain';
import type { Figure, RouteScene, StopScene } from '../../../src/domain';
import { SITE_TITLE } from '../../../src/ui/text';
import { pickSection, readingLine, remainingScroll } from '../../../src/ui/useReadingSection';
import { readBytes } from '../../support/readBytes';
import { installMiniDom, MiniElement } from './miniDom';

const doc = installMiniDom('?stage=fake');
const win = (globalThis as any).window;
const g = globalThis as any;

// 全程沙盘读不出来的情形：g.__routeFails 是接下来还要读不出来几次（平常是 0，照常读）。
vi.mock('../../../src/ui/stageEngineSource', async (original) => {
  const actual = await original<typeof import('../../../src/ui/stageEngineSource')>();
  return {
    ...actual,
    pickRouteTable: (figureId: string) => {
      if (!((globalThis as any).__routeFails > 0)) return actual.pickRouteTable(figureId);
      (globalThis as any).__routeFails -= 1;
      return Promise.reject(new Error('这一次没读出来'));
    },
  };
});

// 黄州的沙盘在这个文件里拿走（见文件开头）。全程沙盘也是从这个模块读的（loadRouteTable），它不受影响。
// 拿走哪几站的沙盘记在 g.__noTable 里：只有黄州。
// g.__standIn 是借徐州的沙盘当“有沙盘、没有正文”的那一站（平常是 null，谁也不借）；g.__standInSources 是换进场景里的出处。
// g.__tableFails 是接下来沙盘的数据还要读不出来几次；g.__tableGate 是一个还没兑现的 Promise 时，沙盘的数据等它兑现了才给。
g.__noTable = new Set<string>(['huangzhou']);
g.__standIn = null;
g.__tableFails = 0;
g.__tableGate = null;
vi.mock('../../../src/domain/sceneContent', async (original) => {
  const actual = await original<typeof import('../../../src/domain/sceneContent')>();
  const flags = globalThis as any;
  const gone = (stopId: string): boolean => (flags.__noTable as Set<string>).has(stopId);
  return {
    ...actual,
    hasStopTable: (figureId: string, stopId: string) => flags.__standIn === stopId || (!gone(stopId) && actual.hasStopTable(figureId, stopId)),
    loadStopTable: async (figureId: string, stopId: string) => {
      if (flags.__tableGate) await flags.__tableGate;
      if (flags.__tableFails > 0) {
        flags.__tableFails -= 1;
        throw new Error('这一次没读出来');
      }
      if (flags.__standIn === stopId) {
        // 只借场景和地形文件，不借徐州的定格图和先画好的地面：这样的站刚有沙盘的时候多半也还没有它们
        const found = await actual.loadStopTable(figureId, 'xuzhou');
        return found && { terrainUrl: found.terrainUrl, scene: { ...found.scene, stopId, sources: flags.__standInSources } };
      }
      return gone(stopId) ? null : actual.loadStopTable(figureId, stopId);
    },
  };
});

// 正文读不出来的情形：g.__textFails 是真的时候，loadStop 抛错（平常照常读）。
g.__textFails = false;
vi.mock('../../../src/domain/content', async (original) => {
  const actual = await original<typeof import('../../../src/domain/content')>();
  return {
    ...actual,
    loadStop: (figureId: string, stopId: string) => ((globalThis as any).__textFails ? Promise.reject(new Error('正文这一次没读出来')) : actual.loadStop(figureId, stopId)),
  };
});

const { act } = await import('react');
const { createRoot } = await import('react-dom/client');
const { FigureLayout } = await import('../../../src/ui/FigureLayout');
const { FigureContents } = await import('../../../src/ui/FigureContents');
const { useOnDemand } = await import('../../../src/app/useLoaded');
const { resetFakeVisit } = await import('../../../src/ui/dev/fakeStage');

const scene = JSON.parse(new TextDecoder().decode(readBytes('content/figures/su-shi/scenes/xuzhou.json'))) as StopScene;
const headings = scene.sections.map((s) => s.heading);
/** 全程沙盘的场景，照 content/ 里真的文件：哪一节看哪一站的来路、摆哪几条题签，下面都从它读。 */
const route = JSON.parse(new TextDecoder().decode(readBytes('content/figures/su-shi/scenes/route.json'))) as RouteScene;
const WHOLE = route.sections[0].heading;
/** 全程沙盘上到这一站去的那一节叫什么。 */
const roadOf = (stopId: string): string => route.sections.find((s) => s.stop === stopId)!.heading;
/** 人物的资料，照 content/ 里真的文件：有几站、各叫什么、写没写好，下面都从它读，不另写一遍。 */
const figure = JSON.parse(new TextDecoder().decode(readBytes('content/figures/su-shi/figure.json'))) as Figure;
/** content/ 里哪几站有自己的场景文件（只看有没有这个文件，不读它）。 */
const sceneFiles = Object.keys(import.meta.glob('/content/figures/su-shi/scenes/*.json'));
const hasSceneFile = (stopId: string): boolean => sceneFiles.includes(`/content/figures/su-shi/scenes/${stopId}.json`);
/** 头一个还没写、也没有自己的沙盘的站：沙盘栏里摆的是全程沙盘上到它去的来路。眉州有了沙盘以后是杭州。 */
const BARE = figure.stops.find((stop) => stop.status === 'outline' && !hasSceneFile(stop.id))!.id;
/** 头一个还没写、可是有自己的沙盘的站（眉州）；没有这样的站是 undefined，查它的那一条自己跳过。 */
const UNWRITTEN_WITH_TABLE = figure.stops.find((stop) => stop.status === 'outline' && hasSceneFile(stop.id))?.id;
/** 借徐州的沙盘当“有沙盘、没有正文”的那一站：最后一个还没写、也没有场景文件的站（见文件开头）。 */
const STAND_IN = [...figure.stops].reverse().find((stop) => stop.status === 'outline' && !hasSceneFile(stop.id))!.id;
/** 换进替身的场景里的出处：徐州 stops/xuzhou.json 里的那一份（徐州场景里的 sourceIds 指的就是它们）。 */
const standInSources = (JSON.parse(new TextDecoder().decode(readBytes('content/figures/su-shi/stops/xuzhou.json'))) as { sources: { id: string; cite: string }[] }).sources;
g.__standInSources = standInSources;
/** 文字栏里那一句的两半，和沙盘摆不出来时没有正文的一站上说的三句。 */
const LEAF_FIRST = '这一站的正文还没写。';
const LEAF_REST = '按下面的一行，沙盘就换到那一处；各处的时间写在每一行里，不一定都在上面这几年里。';
const BARE_FAILED = '沙盘没能摆出来。';
const BARE_UNSUPPORTED = '这个浏览器画不出立体的沙盘。换一个新一点的浏览器，或者把手机、平板的系统升级以后再来看。';
const BARE_SLOW = '立体的沙盘在这台设备上太慢，先不摆了。';
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const settle = (ms = 60) => act(async () => void (await sleep(ms)));
const attr = (el: MiniElement | null, name: string) => el?.getAttribute(name) ?? null;
async function waitFor(ok: () => boolean, ms = 15000) {
  const until = Date.now() + ms;
  while (!ok() && Date.now() < until) await settle(20);
  if (!ok()) throw new Error('等不到');
}

/**
 * 点开一处折着的东西（<details>）：浏览器会把它的 open 设成真，再发一个 toggle 事件；假 DOM 里照样做一遍。
 * open 写假再发一次，就是关上。
 */
async function setFold(fold: MiniElement, open: boolean) {
  (fold as any).open = open;
  await act(async () => void fold.dispatchEvent({ type: 'toggle' }));
}

async function mount(search: string, stopId: string | null) {
  win.location.search = search;
  g.__sectionTops = {};
  const container = doc.createElement('div');
  doc.body.appendChild(container);
  const root = createRoot(container as any);
  const show = (id: string | null) => act(async () => root.render(<FigureLayout figureId="su-shi" stopId={id} />));
  await show(stopId);
  await waitFor(() => {
    const state = container.querySelector('.stage-pane')?.getAttribute('data-stage-state');
    // 人物还在读的时候版面是两栏的壳，壳里也有一栏（写着 loading）；栏上没写状态的（null）一样接着等
    return state != null && state !== 'loading';
  });
  return {
    container,
    show,
    pane: () => container.querySelector('.stage-pane')!,
    q: (selector: string) => container.querySelector(selector),
    all: (selector: string) => container.querySelectorAll(selector),
    /** 读到某一小节：它和它前面的标题都过了阅读线。 */
    read: async (heading: string) => {
      const at = headings.indexOf(heading);
      g.__sectionTops = Object.fromEntries(headings.map((h, i) => [h, i <= at ? 100 : 9999]));
      win.fire('scroll');
      await settle(40);
    },
    unmount: () => act(async () => root.unmount()),
  };
}

describe('整个版面 + 真的内容 + 沙盘的替身', () => {
  it('人物页：沙盘栏里摆着全程沙盘，看的是头一节；中间的按钮写“回到全程”；站的题签带着印，印通到那一站；今名换题签上的字；目录下面一行凭据', { timeout: 30_000 }, async () => {
    const page = await mount('?stage=fake', null);
    expect(attr(page.pane(), 'data-stage-state')).toBe('ready');
    expect(attr(page.pane(), 'data-stage-level')).toBe('route');
    expect(attr(page.pane(), 'data-stage-section')).toBe(WHOLE);
    expect(attr(page.q('.stage-caption'), 'data-section')).toBe(WHOLE);
    expect(page.q('.stage-reset')?.textContent).toBe('回到全程');
    // 按钮下面没有那一行话
    expect(page.q('.stage-notice')).toBeNull();
    expect(page.all('.stop-item').length).toBeGreaterThan(1);

    // 题签是这一节的那几条；是站的地名带着印：第几站、通到哪一站、写好了没有，照 figure.json
    const marks = stopMarks(figure, (id) => stopHref('su-shi', id));
    const texts = (names: 'ancient' | 'modern') => stripTexts(route, WHOLE, names);
    expect(page.all('.stage-host .strip').map((el) => attr(el, 'data-strip-id'))).toEqual(route.sections[0].strips);
    const wanted = texts('ancient').flatMap((text) => text.stops ?? []);
    expect(wanted.length).toBeGreaterThanOrEqual(figure.stops.length);
    expect(new Set(wanted)).toEqual(new Set(figure.stops.map((stop) => stop.id)));
    const seals = page.all('.stage-host .strip-seal');
    expect(seals.map((seal) => [attr(seal, 'data-stop-id'), attr(seal, 'href'), seal.textContent, attr(seal, 'data-filled')])).toEqual(
      wanted.map((id) => [id, `#/su-shi/${id}`, marks[id].label, String(marks[id].written)]),
    );
    // 头一节不看哪一站的来路：没有一方印带着“这一站”的圈
    expect(seals.filter((seal) => attr(seal, 'data-here') === 'true')).toHaveLength(0);

    // 今名：题签上的字换了（至少有一条不一样），印不变
    const words = (names: 'ancient' | 'modern') => texts(names).map((text) => text.text + (text.stops ?? []).map((id) => marks[id].label).join(''));
    expect(words('modern')).not.toEqual(words('ancient'));
    expect(page.all('.stage-host .strip').map((el) => el.textContent)).toEqual(words('ancient'));
    await act(async () => page.all('.names-switch button')[1].click());
    expect(page.all('.stage-host .strip').map((el) => el.textContent)).toEqual(words('modern'));

    // 目录下面折着的一行“凭据”：点开是全程沙盘上的东西，出处是全程沙盘自己的
    expect(page.all('details.provenance summary')).toHaveLength(1);
    expect(page.q('.scene-register')).toBeNull();
    await setFold(page.q('details.provenance')!, true);
    await waitFor(() => page.q('.scene-register') !== null);
    expect(page.all('.scene-register-group').filter((group) => attr(group, 'data-class') !== null).length).toBeGreaterThan(0);
    expect(page.all('.scene-not-drawn .scene-register-item')).toHaveLength(route.notDrawn.length);
    expect(page.all('.scene-credits p').map((p) => p.textContent)).toEqual(route.credits);
    const cited = new Set(page.all('.scene-register .provenance-cite').map((p) => p.textContent));
    expect(cited.size).toBeGreaterThan(0);
    for (const line of cited) expect(route.sources.some((source) => line === `出处：${source.cite}`), line ?? '').toBe(true);
    // 没有正文的凭据那一句
    expect(page.all('.provenance-item')).toHaveLength(0);
    await page.unmount();
  });

  it('全程沙盘这一次没读出来（不是没有）：说“沙盘没能摆出来”，带“再试一次”；不说“还没接进来”；再试读出来了，沙盘摆上，还没写的一站正文那一栏的后半句也回来', { timeout: 30_000 }, async () => {
    g.__routeFails = 2;
    const page = await mount('?stage=fake', 'mizhou');
    expect(attr(page.pane(), 'data-stage-state')).toBe('failed');
    // 密州的正文还没写：那一句不说“正文可以照常读”
    expect(figure.stops.find((stop) => stop.id === 'mizhou')?.status).toBe('outline');
    expect(page.q('.stage-message p')?.textContent).toBe(BARE_FAILED);
    expect(page.q('.stage-still-line')).toBeNull();
    expect(page.q('.fake-stage')).toBeNull();
    await waitFor(() => attr(page.q('.stop-page'), 'data-stop-text') === 'none');
    expect(page.q('.not-written')?.textContent).toBe('这一站的正文还没写。');
    // 再试一次：还是没读出来（第二次），那句话和按钮还在；再试一次：读出来了
    expect(page.q('.stage-retry')?.textContent).toBe('再试一次');
    await act(async () => page.q('.stage-retry')!.click());
    await waitFor(() => attr(page.pane(), 'data-stage-state') === 'failed' && g.__routeFails === 0);
    await act(async () => page.q('.stage-retry')!.click());
    await waitFor(() => attr(page.pane(), 'data-stage-state') === 'ready');
    expect(attr(page.pane(), 'data-stage-level')).toBe('route');
    expect(attr(page.pane(), 'data-stage-section')).toBe(roadOf('mizhou'));
    expect(page.q('.stage-message')).toBeNull();
    expect(page.q('.not-written')?.textContent).toBe('这一站的正文还没写。沙盘上是到这一站的来路。');
    await page.unmount();
  });

  it('人物页：?route=none（当作这位人物还没有全程沙盘）：一句话，没有凭据那一行；还没写的一站，正文那一栏不说沙盘上是来路', { timeout: 30_000 }, async () => {
    const page = await mount('?stage=fake&route=none', null);
    expect(attr(page.pane(), 'data-stage-state')).toBe('still');
    expect(attr(page.pane(), 'data-stage-level')).toBeNull();
    expect(page.q('.stage-still-line')?.textContent).toBe('全程沙盘还没接进来。');
    expect(page.q('.names-switch')).toBeNull();
    expect(page.q('.fake-stage')).toBeNull();
    expect(page.q('details.provenance')).toBeNull();
    // 还没写、也没有自己的沙盘的一站（原来用的是眉州；它有了沙盘，换成头一个这样的站）
    expect(figure.stops.find((stop) => stop.id === BARE)?.status).toBe('outline');
    expect(hasSceneFile(BARE)).toBe(false);
    await page.show(BARE);
    await waitFor(() => attr(page.q('.stop-page'), 'data-stop-text') === 'none');
    expect(attr(page.q('.stop-page'), 'data-stop-id')).toBe(BARE);
    expect(page.q('.not-written')?.textContent).toBe('这一站的正文还没写。');
    expect(page.q('.stage-still-line')?.textContent).toBe('全程沙盘还没接进来。');
    // 有自己的沙盘的一站照常
    await page.show('xuzhou');
    await waitFor(() => attr(page.pane(), 'data-stage-state') === 'ready');
    expect(attr(page.pane(), 'data-stage-level')).toBeNull();
    expect(page.q('.stage-reset')?.textContent).toBe('回到这一节');
    await page.unmount();
  });

  it('版面换了排法（平板转了个方向）：重排以后阅读线上换成了别的小节，就把刚才读到的那一小节带回阅读线上（落到了后面的小节上，带回的是它的尾；落到了前面，带回的是它的头；短的小节也一样；页面快滚到底、阅读线自己跟着滚动在挪的那一截里也一样），沙盘不跟着换；还在那一小节里不带，页面在最上面不带；窗口只是变大变小不带；没有在盯小节的页面（人物页、没有正文的一站）不听、不动', { timeout: 60_000 }, async () => {
    // 假 DOM 不排版，也不会滚：各小节的标题在窗口里多高由测试给（g.__sectionTops）。“重排以后落到了哪一节”就是把这些高度换一套。
    // 页面把一小节带回阅读线上是自己量了再滚的（window.scrollBy）：这里把各标题的高度和“已经滚了多少”（window.scrollY）照滚的这一截挪一遍，
    // 再把这一回是哪一小节到了阅读线上、是它的头还是它的尾记在 brought 里，滚了多少记在 moves 里。真的滚到了哪里，浏览器测试看（large-upright.spec.ts）。
    const brought: { section: string | undefined; put: string }[] = [];
    const moves: number[] = [];
    /** 读到第几节的样子：它和它前面的标题都过了阅读线（各隔一千像素，分得出是哪一节），后面的都还远。 */
    const topsAt = (at: number): Record<string, number> => Object.fromEntries(headings.map((h, i) => [h, i <= at ? -5000 + i * 1000 : 9000 + i * 1000]));
    /** 阅读线在假窗口里多高（假 DOM 里沙盘栏在正文旁边，看得见正文的那一块从 0 开始；页面离滚到底还远）。 */
    const LINE = readingLine(win.innerHeight, 0);
    /** 假的整页多高（miniDom.ts 给 <html> 的 scrollHeight）。 */
    const PAGE: number = g.document.documentElement.scrollHeight;
    /** 已经滚了 scrollY 的时候阅读线在假窗口里多高：页面快滚到底了，它就从 42% 的地方往下挪（和页面用的是同一对函数）。 */
    const lineWhen = (scrollY: number): number => readingLine(win.innerHeight, 0, remainingScroll(PAGE, win.innerHeight, scrollY));
    /** 各标题在这些高度上、已经滚了 scrollY 的时候，阅读线上是哪一小节（页面自己的 pickSection）。 */
    const onLine = (tops: Record<string, number>, scrollY: number): string | null =>
      pickSection(
        headings.map((h) => ({ section: h, top: tops[h] })),
        lineWhen(scrollY),
      );
    /** 带回来以后，那一小节的头在阅读线上面多远、或者它的尾在阅读线下面多远（src/ui/useReadingSection.ts 的 BRING_BACK_GAP_PX）。 */
    const GAP = 16;
    /** 假 DOM 里每一小节多高（miniDom.ts 给 .text-section 的盒子）。 */
    const TALL = 300;
    const HEAD = '头在阅读线上面一点';
    const TAIL = '尾在阅读线下面一点';
    win.scrollBy = (_x: number, y: number) => {
      const moved: Record<string, number> = Object.fromEntries(Object.entries(g.__sectionTops as Record<string, number>).map(([h, top]) => [h, top - y]));
      win.scrollY += y;
      // 滚完以后的阅读线。离页面的底还远，它不动，头或者尾离它 16 像素；它还在跟着滚动挪的时候，
      // 最后多滚的那 16 像素它也跟着挪了 16，隔着的是两个 16。
      const line = lineWhen(win.scrollY);
      const gap = line > LINE ? 2 * GAP : GAP;
      const head = headings.find((h) => Math.abs(moved[h] - (line - gap)) < 0.01);
      const tail = headings.find((h) => Math.abs(moved[h] + TALL - (line + gap)) < 0.01);
      brought.push({ section: head ?? tail, put: head ? HEAD : tail ? TAIL : '头和尾都不在阅读线旁边' });
      moves.push(y);
      g.__sectionTops = moved;
    };
    try {
      const page = await mount('?stage=fake', 'xuzhou');
      expect(attr(page.pane(), 'data-stage-section')).toBe(headings[0]);
      expect(win.mediaListeners.size, '有正文、有沙盘的一站：听着版面换没换排法').toBe(1);
      const requests = () => (attr(page.q('.fake-stage'), 'data-fake-requests') ?? '').split('|').filter(Boolean);

      // 页面在最上面（一个标题都还没过阅读线，算第一节）：换了排法不带，不把这一站的标题和抬头滚走
      win.fireMedia();
      await settle(200);
      expect(brought).toEqual([]);

      await page.read(headings[2]);
      await waitFor(() => attr(page.pane(), 'data-stage-section') === headings[2]);
      const asked = requests();
      expect(asked[asked.length - 1]).toBe(headings[2]);

      // 窗口变大变小、页面滚动：还是同一种排法，不带
      win.fire('resize');
      win.fire('scroll');
      await settle(40);
      expect(brought).toEqual([]);
      // 同一种排法里窗口变了大小，阅读线落到了第四节：也不带，沙盘照旧跟着阅读线走到第四节（带回来只在换排法的时候做）
      g.__sectionTops = topsAt(3);
      win.fire('resize');
      await waitFor(() => attr(page.pane(), 'data-stage-section') === headings[3]);
      expect(brought).toEqual([]);
      await page.read(headings[2]);
      await waitFor(() => attr(page.pane(), 'data-stage-section') === headings[2]);
      asked.push(headings[3], headings[2]);
      expect(requests()).toEqual(asked);

      // 换了排法，重排以后阅读线上还是第三节：读者还在那一节里，不带
      win.fireMedia();
      await settle(200);
      expect(brought).toEqual([]);

      // 换了排法，重排以后同一个滚动的位置落到了第四节（读者刚才快读完第三节了）：带回的是第三节的尾，摆在阅读线下面一点——
      // 不是把第三节的开头拉回来（那样读者眼前的东西全换了，要倒回去一整节）；沙盘没有被叫去第四节
      g.__sectionTops = topsAt(3);
      win.fireMedia();
      expect(brought, '带回的是第三节，它的尾摆在阅读线下面 16 像素的地方').toEqual([{ section: headings[2], put: TAIL }]);
      await settle(300);
      expect(attr(page.pane(), 'data-stage-section'), '沙盘还摆着第三节').toBe(headings[2]);
      expect(requests(), '沙盘被叫去换过小节').toEqual(asked);

      // 再换回来，这一回落到了第二节（读者刚才刚读到第三节）：又带一回，还是第三节，这一回是它的头，摆在阅读线上面一点
      g.__sectionTops = topsAt(1);
      win.fireMedia();
      expect(brought.slice(1), '带回的是第三节，它的头摆在阅读线上面 16 像素的地方').toEqual([{ section: headings[2], put: HEAD }]);
      await settle(300);
      expect(attr(page.pane(), 'data-stage-section')).toBe(headings[2]);
      expect(requests()).toEqual(asked);

      // 短的小节：第四节的标题紧跟在第三节后面（第三节 300 像素高，再隔 20 像素），重排以后阅读线落在第二节上。
      // 带回来以后第三节的头在阅读线上面一点，第四节的标题还在阅读线下面，沙盘还摆着第三节
      // （要是把第三节的开头摆到那一块的最上面，第四节的标题也过了阅读线，过一会儿沙盘就换到第四节去了）
      g.__sectionTops = { ...topsAt(1), [headings[2]]: 5000, [headings[3]]: 5000 + TALL + 20 };
      win.fireMedia();
      expect(brought.slice(2)).toEqual([{ section: headings[2], put: HEAD }]);
      expect(g.__sectionTops[headings[3]], '带回来以后，后面那一节的标题还在阅读线下面').toBeGreaterThan(LINE);
      await settle(300);
      expect(attr(page.pane(), 'data-stage-section'), '短的小节带回来以后，沙盘还摆着它').toBe(headings[2]);
      expect(requests(), '短的小节带回来以后，沙盘被叫去换过小节').toEqual(asked);

      // 页面快滚到底的那一截：往下只剩 400 像素好滚，阅读线已经从 42% 的地方往下挪了，正文往上滚多少、它就跟着往下挪多少。
      // 还是短的第三节（第四节的标题紧跟在后面），重排以后它的头落在阅读线下面 340 像素的地方，阅读线落在第二节上。
      // 页面要是照滚之前的那条阅读线量（把头滚到那条线上面 16 像素），滚完的时候阅读线已经挪到第四节的标题下面去了，沙盘就换到第四节；
      // 把阅读线的这一挪也算进去，滚完第三节的头在阅读线上面，第四节的标题还在阅读线下面。
      const LEFT = 400;
      const START = PAGE - win.innerHeight - LEFT;
      expect(remainingScroll(PAGE, win.innerHeight, START), '假的页面往下还能滚的').toBe(LEFT);
      const lineBefore = lineWhen(START);
      expect(lineBefore, '只剩这么一截好滚的时候，阅读线该已经从 42% 的地方往下挪了：没有挪的话这一步查不到东西').toBeGreaterThan(LINE);
      const nearEnd: Record<string, number> = { ...topsAt(1), [headings[2]]: lineBefore + 340, [headings[3]]: lineBefore + 340 + TALL + 20 };
      expect(onLine(nearEnd, START), '重排以后阅读线该落在第二节上').toBe(headings[1]);
      // 不算阅读线自己这一挪的量法要滚的：页面滚得了这么多（没有滚过页面的底），滚完阅读线上是第四节——所以这一步分得出两种量法
      const blind = nearEnd[headings[2]] - lineBefore + GAP;
      expect(blind, '不算阅读线这一挪的量法要滚的，页面该滚得了').toBeLessThanOrEqual(LEFT);
      expect(
        onLine(Object.fromEntries(headings.map((h) => [h, nearEnd[h] - blind])), START + blind),
        '照滚之前的阅读线量，滚完该落到第四节上：没有的话这一步分不出两种量法，换一组高度',
      ).toBe(headings[3]);
      win.scrollY = START;
      g.__sectionTops = nearEnd;
      win.fireMedia();
      expect(brought.slice(3), '页面快滚到底的那一截里，带回的是第三节的头').toEqual([{ section: headings[2], put: HEAD }]);
      expect(moves[3], '带回来要滚的，页面该滚得了（没有滚过页面的底）').toBeLessThanOrEqual(LEFT);
      expect(moves[3]).toBeGreaterThan(0);
      expect(win.scrollY).toBe(START + moves[3]);
      expect(lineWhen(win.scrollY), '滚完以后阅读线还在跟着滚动挪（比 42% 的地方低）').toBeGreaterThan(LINE);
      expect(onLine(g.__sectionTops, win.scrollY), '滚完以后阅读线上该是第三节').toBe(headings[2]);
      expect(g.__sectionTops[headings[3]], '滚完以后，后面那一节的标题还在阅读线下面').toBeGreaterThan(lineWhen(win.scrollY));
      await settle(300);
      expect(attr(page.pane(), 'data-stage-section'), '页面快滚到底的那一截里带回来以后，沙盘还摆着第三节').toBe(headings[2]);
      expect(requests(), '页面快滚到底的那一截里带回来以后，沙盘被叫去换过小节').toEqual(asked);
      // 回到离页面的底还远的地方
      win.scrollY = 0;

      // 读到了第二节以后再换、落到了第一节：带回的是第二节
      await page.read(headings[1]);
      await waitFor(() => attr(page.pane(), 'data-stage-section') === headings[1]);
      g.__sectionTops = topsAt(0);
      win.fireMedia();
      expect(brought.map((item) => item.section)).toEqual([headings[2], headings[2], headings[2], headings[2], headings[1]]);

      // 到人物页（没有小节）：不听了，换排法什么也不带
      brought.length = 0;
      await page.show(null);
      await waitFor(() => attr(page.pane(), 'data-stage-level') === 'route');
      expect(win.mediaListeners.size, '人物页不听').toBe(0);
      win.fireMedia();
      expect(brought).toEqual([]);
      await page.unmount();

      // 有沙盘、没有正文的一站：也不听、不动
      g.__standIn = STAND_IN;
      const leaf = await mount('?stage=fake', STAND_IN);
      await waitFor(() => attr(leaf.pane(), 'data-stage-state') === 'ready' && leaf.all('.view-item').length > 0);
      expect(win.mediaListeners.size, '没有正文的一站不听').toBe(0);
      win.fireMedia();
      expect(brought).toEqual([]);
      await leaf.unmount();
    } finally {
      g.__standIn = null;
      delete win.scrollBy;
      win.scrollY = 0;
    }
  });

  it('徐州：摆着第一节；读到后面的小节，镜头、题记、题签跟着换', { timeout: 60_000 }, async () => {
    const page = await mount('?stage=fake', 'xuzhou');
    expect(attr(page.q('.stop-page'), 'data-stop-text')).toBe('written');
    expect(attr(page.q('.stop-page'), 'data-stop-scene')).toBe('yes');
    expect(attr(page.pane(), 'data-stage-state')).toBe('ready');
    expect(attr(page.pane(), 'data-stage-section')).toBe(headings[0]);
    const fake = () => page.q('.fake-stage')!;
    expect(attr(fake(), 'data-fake-animated')).toBe('false');
    expect(page.all('.text-section').map((el) => attr(el, 'data-section'))).toEqual(headings);

    const stripIds = () => page.all('.stage-host .strip').map((el) => attr(el, 'data-strip-id'));
    const stripWords = () => page.all('.stage-host .strip').map((el) => el.textContent);
    const wordsOf = (index: number, names: 'ancient' | 'modern') =>
      scene.sections[index].strips.map((id) => {
        const strip = scene.strips.find((item) => item.id === id)!;
        return names === 'modern' && strip.modern ? strip.modern : strip.text;
      });
    const caption = () => page.q('.stage-caption')!;
    expect(stripIds()).toEqual(scene.sections[0].strips);
    expect(attr(caption(), 'data-section')).toBe(headings[0]);

    // 读到第三节：停够了才报给沙盘，沙盘滑过去。
    await page.read(headings[2]);
    await waitFor(() => attr(page.pane(), 'data-stage-section') === headings[2]);
    expect(attr(fake(), 'data-fake-animated')).toBe('true');
    expect(stripIds()).toEqual(scene.sections[2].strips);

    // 一掠而过的小节不报：第 4 节只停了几十毫秒就到了第 6 节。
    await page.read(headings[3]);
    await page.read(headings[5]);
    await waitFor(() => attr(page.pane(), 'data-stage-section') === headings[5]);
    await settle(450);
    expect(attr(page.pane(), 'data-stage-section')).toBe(headings[5]);
    expect(stripIds()).toEqual(scene.sections[5].strips);
    expect(page.all('.stage-far li').length).toBeGreaterThan(0);

    await page.read(headings[6]);
    await waitFor(() => attr(page.pane(), 'data-stage-section') === headings[6]);
    expect(stripWords()).toEqual(wordsOf(6, 'ancient'));

    // 今名。
    await act(async () => page.all('.names-switch button')[1].click());
    expect(stripWords()).toEqual(wordsOf(6, 'modern'));

    // 凭据里的“沙盘上的东西”。凭据里面的东西点开才取：折着的时候那里只有一句“加载中…”。
    expect(page.q('.scene-register')).toBeNull();
    expect(page.q('.provenance-body')?.textContent).toBe('加载中…');
    await setFold(page.q('details.provenance')!, true);
    await waitFor(() => page.q('.scene-register') !== null);
    const register = page.q('.scene-register')!;
    expect(register).not.toBeNull();
    // 五类各一组
    expect(page.all('.scene-register-group').filter((group) => attr(group, 'data-class') !== null)).toHaveLength(5);
    for (const thing of scene.things) expect(page.all(`.scene-register-item[data-scene-id="${thing.id}"]`)).toHaveLength(1);
    expect(page.all('.scene-not-drawn .scene-register-item')).toHaveLength(scene.notDrawn.length);
    expect(page.all('.scene-credits p').map((p) => p.textContent)).toEqual(scene.credits);

    // 徐州的沙盘上没有全程沙盘的那几样：不写 level，按钮是“回到这一节”，题签上没有印
    expect(attr(page.pane(), 'data-stage-level')).toBeNull();
    expect(page.q('.stage-reset')?.textContent).toBe('回到这一节');
    expect(page.all('.strip-seal')).toHaveLength(0);
    const xuzhouTable = page.q('.fake-stage');

    // 换到黄州（写好了正文，没有自己的沙盘）：徐州的沙盘拿走，摆上全程沙盘，看的是到黄州去的那一节；按钮下面一行话。
    await page.show('huangzhou');
    await waitFor(() => attr(page.pane(), 'data-stage-level') === 'route' && attr(page.pane(), 'data-stage-state') === 'ready' && attr(page.q('.stop-page'), 'data-stop-scene') === 'none');
    expect(page.q('.fake-stage')).not.toBe(xuzhouTable);
    expect(attr(page.pane(), 'data-stage-section')).toBe(roadOf('huangzhou'));
    expect(attr(page.q('.stage-caption'), 'data-section')).toBe(roadOf('huangzhou'));
    expect(page.q('.stage-notice p')?.textContent).toBe('这一站的沙盘还没做好，沙盘上是到这一站的来路。');
    expect(page.q('.stage-notice button')).toBeNull();
    expect(page.q('.stage-reset')?.textContent).toBe('回到这一段');
    // 这一节看的是黄州的来路：黄州的那一方印带着“这一站”的圈，别的不带
    expect(page.all('.strip-seal').filter((seal) => attr(seal, 'data-here') === 'true').map((seal) => attr(seal, 'data-stop-id'))).toEqual(['huangzhou']);
    // 今名留着
    expect(attr(page.q('.fake-stage'), 'data-fake-names')).toBe('modern');
    // 这一站的凭据点开：有正文的凭据，没有“沙盘上的东西”
    await waitFor(() => page.q('details.provenance') !== null);
    await setFold(page.q('details.provenance')!, true);
    await waitFor(() => page.q('.provenance-item') !== null);
    expect(page.q('.scene-register')).toBeNull();

    // 再回徐州：从第一节开始，不带着上一次读到的小节。
    g.__sectionTops = {};
    await page.show('xuzhou');
    await waitFor(() => attr(page.pane(), 'data-stage-state') === 'ready');
    expect(attr(page.pane(), 'data-stage-state')).toBe('ready');
    expect(attr(page.pane(), 'data-stage-section')).toBe(headings[0]);
    expect(attr(page.q('.fake-stage'), 'data-fake-animated')).toBe('false');
    // 今名留着。
    expect(attr(page.q('.fake-stage'), 'data-fake-names')).toBe('modern');

    // 还没写、也没有自己的沙盘的站（BARE）：全程沙盘上到这一站去的那一节；按钮下面没有那一行话，正文那一栏说沙盘上是什么。
    expect(figure.stops.findIndex((stop) => stop.id === BARE)).toBeGreaterThan(0);
    await page.show(BARE);
    await waitFor(() => attr(page.pane(), 'data-stage-level') === 'route' && attr(page.pane(), 'data-stage-state') === 'ready' && attr(page.q('.stop-page'), 'data-stop-text') === 'none');
    expect(attr(page.pane(), 'data-stage-section')).toBe(roadOf(BARE));
    expect(page.q('.stage-notice')).toBeNull();
    // 不是头一站：说的是来路
    expect(page.q('.not-written')?.textContent).toBe('这一站的正文还没写。沙盘上是到这一站的来路。');
    expect(attr(page.q('.stop-page'), 'data-stop-text')).toBe('none');
    expect(attr(page.q('.stop-page'), 'data-stop-scene')).toBe('none');
    expect(page.q('.stage-reset')?.textContent).toBe('回到这一段');
    const routeTable = page.q('.fake-stage');
    expect(attr(routeTable, 'data-fake-animated')).toBe('false');

    // 这样的站上没有“沙盘上看的几处”那张单子，也没有凭据那一行
    expect(page.q('.views')).toBeNull();
    expect(page.q('details.provenance')).toBeNull();

    // 回人物页：还是同一座全程沙盘（没有重摆），镜头滑回头一节；按钮换回“回到全程”。
    await page.show(null);
    await waitFor(() => attr(page.pane(), 'data-stage-section') === WHOLE);
    expect(page.q('.fake-stage')).toBe(routeTable);
    expect(attr(routeTable, 'data-fake-animated')).toBe('true');
    expect(page.q('.stage-reset')?.textContent).toBe('回到全程');
    expect(page.q('.stage-still-line')).toBeNull();

    // 从人物页到另一个没有自己的沙盘的站（黄州）：也是这一座，滑到它的来路；那一行话出来了。
    await page.show('huangzhou');
    await waitFor(() => attr(page.pane(), 'data-stage-section') === roadOf('huangzhou'));
    expect(page.q('.fake-stage')).toBe(routeTable);
    expect(page.q('.stage-notice p')?.textContent).toBe('这一站的沙盘还没做好，沙盘上是到这一站的来路。');
    await page.unmount();
  });

  it('站点页的抬头：一站一个小圆圈，只有这一站的做了记号，读屏不念；位置那一行中间是画出来的一小段线', { timeout: 60_000 }, async () => {
    const count = figure.stops.length;
    const at = figure.stops.findIndex((stop) => stop.id === 'xuzhou');
    expect(at).toBeGreaterThanOrEqual(0);
    const page = await mount('?stage=fake', 'xuzhou');
    // 前面那句话照旧说第几站、共几站
    expect(page.q('.page-head .eyebrow')?.textContent).toBe(`第 ${at + 1} 站 · 共 ${count} 站`);
    // 小圆圈：有几站就有几个，里面没有字；读屏不念（那句话已经说了）
    const ticks = page.q('.page-head .eyebrow .ticks')!;
    expect(ticks).not.toBeNull();
    expect(attr(ticks, 'aria-hidden')).toBe('true');
    expect(ticks.textContent).toBe('');
    const marked = () => page.all('.ticks span').map((square) => square.className === 'is-here');
    expect(marked()).toEqual(figure.stops.map((_, i) => i === at));
    // 换到头一站、最后一站：记号跟着走，还是只有一个
    for (const i of [0, count - 1]) {
      await page.show(figure.stops[i].id);
      await waitFor(() => attr(page.q('.stop-page'), 'data-stop-id') === figure.stops[i].id);
      expect(marked()).toEqual(figure.stops.map((_, j) => j === i));
      expect(page.q('.page-head .eyebrow')?.textContent).toBe(`第 ${i + 1} 站 · 共 ${count} 站`);
    }
    // 位置那一行：网站的名字和人物的名字中间不是一个斜杠，是一小段画出来的线，读屏不念
    const sep = page.q('.crumbs .crumbs-sep')!;
    expect(attr(sep, 'aria-hidden')).toBe('true');
    expect(page.q('.crumbs')?.textContent).toBe(`${SITE_TITLE}${figure.name}`);
    await page.unmount();
  });

  it('人物页的目录：圆点里的数字是汉字的一、二、三……，读屏不念；站名里不夹着“还没写”的小标签', { timeout: 30_000 }, async () => {
    const page = await mount('?stage=fake', null);
    const numerals = '一二三四五六七八九十';
    expect(figure.stops.length).toBeLessThanOrEqual(numerals.length);
    const seals = page.all('.stop-item .stop-number');
    expect(seals.map((seal) => seal.textContent)).toEqual(figure.stops.map((_, i) => numerals[i]));
    for (const seal of seals) expect(attr(seal, 'aria-hidden')).toBe('true');
    // 站名自己一块，里面只有站名；小标签是旁边的另一块（都是黑体，大小不一样）
    expect(page.all('.stop-item .stop-head .stop-title').map((title) => title.textContent)).toEqual(figure.stops.map((stop) => stop.title));
    expect(page.all('.stop-item .stop-title .tag')).toHaveLength(0);
    const unwritten = figure.stops.filter((stop) => stop.status !== 'complete').map((stop) => stop.id);
    expect(unwritten.length).toBeGreaterThan(0);
    expect(page.all('.stop-item .stop-head .tag').map((tag) => attr(tag.closest('.stop-item'), 'data-stop-id'))).toEqual(unwritten);
    await page.unmount();
  });

  it('目录超过十站：第十一站起圆点里用数字', async () => {
    const many: Figure = { ...figure, stops: Array.from({ length: 12 }, (_, i) => ({ ...figure.stops[i % figure.stops.length], id: `s${i + 1}` })) };
    const container = doc.createElement('div');
    doc.body.appendChild(container);
    const root = createRoot(container as any);
    await act(async () => root.render(<FigureContents figure={many} route={null} />));
    expect(container.querySelectorAll('.stop-number').map((seal) => seal.textContent)).toEqual(['一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '11', '12']);
    await act(async () => root.unmount());
  });

  it('“读原文”“凭据”那一行：加号、减号是页面上真的字，读屏不念；名字和原文的标题各是一块', { timeout: 30_000 }, async () => {
    const page = await mount('?stage=fake', 'xuzhou');
    const rows = [...page.all('details.original summary'), ...page.all('details.provenance summary')];
    expect(page.all('details.original summary').length).toBeGreaterThan(0);
    expect(page.all('details.provenance summary')).toHaveLength(1);
    for (const row of rows) {
      const mark = row.querySelector('.fold-mark')!;
      expect(attr(mark, 'aria-hidden')).toBe('true');
      // 两个字都在页面上：折着显头一个，点开显后一个（哪个显出来是样式表的事，在浏览器里查）
      expect(mark.querySelectorAll('span').map((sign) => sign.textContent)).toEqual(['+', '−']);
    }
    expect(page.all('details.original summary .fold-label').map((label) => label.textContent)).toEqual(page.all('details.original').map(() => '读原文'));
    expect(page.q('details.provenance summary .fold-label')?.textContent).toBe('凭据');
    // 原文的那一行还带着标题，是名字后面的另一块；凭据那一行没有
    for (const row of page.all('details.original summary')) expect(row.textContent.length).toBeGreaterThan('+−读原文'.length);
    expect(page.q('details.provenance summary')?.textContent).toBe('+−凭据');
    await page.unmount();
  });

  it('凭据里面的东西点开才取：折着只有一句“加载中…”，点开换成内容；关上再点开，内容还在', { timeout: 30_000 }, async () => {
    const page = await mount('?stage=fake', 'xuzhou');
    const fold = page.q('details.provenance')!;
    // 折着：那一行在，里面只有等着的那一句（折着的东西浏览器不显出来）
    expect(page.q('details.provenance summary')?.textContent).toBe('+−凭据');
    expect(page.all('.provenance-body p').map((line) => line.textContent)).toEqual(['加载中…']);
    expect(page.all('.provenance-group')).toHaveLength(0);
    // 点开：取到了，等着的那一句不在了
    await setFold(fold, true);
    await waitFor(() => page.q('.provenance-group') !== null);
    expect(page.all('.provenance-body .quiet')).toHaveLength(0);
    expect(page.all('.provenance-item').length).toBeGreaterThan(0);
    expect(page.q('.provenance-line')?.textContent).toBe('正文里的事和话，各自依据什么。');
    // 关上再点开：不重取，内容一直在
    await setFold(fold, false);
    expect(page.all('.provenance-item').length).toBeGreaterThan(0);
    await setFold(fold, true);
    expect(page.all('.provenance-body .quiet')).toHaveLength(0);
    await page.unmount();
  });

  it('贴着底边的那一条：三格——上一站、问讲解员、下一站；头一站左边空着，最后一站右边空着，没写的站中间空着', { timeout: 60_000 }, async () => {
    const count = figure.stops.length;
    const written = figure.stops.findIndex((stop) => stop.id === 'xuzhou');
    expect(written).toBeGreaterThan(0);
    expect(written).toBeLessThan(count - 1);
    const page = await mount('?stage=fake', 'xuzhou');
    /** 这一条里的三格，各是什么。 */
    const cells = () =>
      (page.q('.guide-dock')?.childNodes ?? []).map((cell) => {
        const el = cell as MiniElement;
        if (el.localName === 'a') {
          return { kind: 'link', rel: attr(el, 'rel'), href: attr(el, 'href'), label: el.querySelector('.walk-label')?.textContent, name: el.querySelector('.walk-name')?.textContent, side: el.className };
        }
        if (el.localName === 'button') return { kind: 'button', text: el.textContent };
        return { kind: 'empty', text: el.textContent };
      });
    const linkTo = (i: number, rel: 'prev' | 'next') => ({
      kind: 'link',
      rel,
      href: `#/su-shi/${figure.stops[i].id}`,
      label: rel === 'prev' ? '上一站' : '下一站',
      name: figure.stops[i].shortTitle,
      side: `walk-link is-${rel}`,
    });
    const empty = { kind: 'empty', text: '' };
    const ask = { kind: 'button', text: '问讲解员' };
    // 写好了的一站，在中间：三格都有
    await waitFor(() => page.q('.guide-open') !== null);
    expect(attr(page.q('.guide-dock'), 'aria-label')).toBe('换一站');
    expect(cells()).toEqual([linkTo(written - 1, 'prev'), ask, linkTo(written + 1, 'next')]);
    // 正文末尾是“回到各站目录”和“来源”两个链接；上一站、下一站只在这一条里，各一个
    expect(page.all('.stop-nav a').map((link) => [link.textContent, attr(link, 'href')])).toEqual([
      ['回到各站目录', '#/su-shi'],
      ['来源', '#/sources'],
    ]);
    expect(page.all('.stop-page a').filter((link) => attr(link, 'rel') === 'prev' || attr(link, 'rel') === 'next')).toHaveLength(2);
    // 头一站（还没写）：左边空着，中间空着，右边是下一站
    expect(figure.stops[0].status).not.toBe('complete');
    await page.show(figure.stops[0].id);
    await waitFor(() => attr(page.q('.stop-page'), 'data-stop-id') === figure.stops[0].id && attr(page.q('.stop-page'), 'data-stop-text') === 'none');
    expect(cells()).toEqual([empty, empty, linkTo(1, 'next')]);
    expect(page.q('.guide-open')).toBeNull();
    // 最后一站（还没写）：左边是上一站，中间空着，右边空着
    expect(figure.stops[count - 1].status).not.toBe('complete');
    await page.show(figure.stops[count - 1].id);
    await waitFor(() => attr(page.q('.stop-page'), 'data-stop-id') === figure.stops[count - 1].id && attr(page.q('.stop-page'), 'data-stop-text') === 'none');
    expect(cells()).toEqual([linkTo(count - 2, 'prev'), empty, empty]);
    // 人物页上没有这一条；目录后面是通到“来源”页的链接
    await page.show(null);
    await waitFor(() => page.q('.stop-page') === null);
    expect(page.q('.guide-dock')).toBeNull();
    expect(page.all('.figure-page .stop-nav a').map((link) => [link.textContent, attr(link, 'href')])).toEqual([['来源', '#/sources']]);
    await page.unmount();
  });

  it('“问讲解员”：一点就开，标题和“关闭”马上就有，里面先是“加载中…”，取到了换成内容；开着的时候那一条收起来', { timeout: 30_000 }, async () => {
    const page = await mount('?stage=fake', 'xuzhou');
    await waitFor(() => page.q('.guide-open') !== null);
    expect(page.q('.guide-panel')).toBeNull();
    expect(page.q('.guide-dock')?.hasAttribute('hidden')).toBe(false);
    await act(async () => page.q('.guide-open')!.click());
    // 这一下面板已经在了：标题、关闭；里面的东西或者还在取（一句“加载中…”），或者刚取到
    const panel = page.q('.guide-panel')!;
    expect(panel).not.toBeNull();
    expect(attr(panel, 'role')).toBe('dialog');
    expect(panel.querySelector('.guide-head h2')?.textContent).toBe('问讲解员');
    expect(panel.querySelector('.guide-close')?.textContent).toBe('关闭');
    expect(page.q('.guide-dock')?.hasAttribute('hidden')).toBe(true);
    await waitFor(() => page.q('.guide-panel .guide-form') !== null);
    expect(page.all('.guide-panel .quiet')).toHaveLength(0);
    expect(page.all('.guide-panel p').map((line) => line.textContent)).toEqual([
      '讲解员现在还不能回答问题。下面是以后可以问的问题的样子。',
      `等它能回答了，只依据这一站写下的内容回答，不扮演${figure.name}。`,
    ]);
    expect(page.all('.guide-samples li').length).toBeGreaterThan(0);
    // 关上：面板拿走，那一条回来；再点开，内容马上就在
    await act(async () => page.q('.guide-close')!.click());
    expect(page.q('.guide-panel')).toBeNull();
    expect(page.q('.guide-dock')?.hasAttribute('hidden')).toBe(false);
    await act(async () => page.q('.guide-open')!.click());
    expect(page.q('.guide-panel .guide-form')).not.toBeNull();
    await page.unmount();
  });

  it('点开才取的东西（useOnDemand）：没叫过不取；正在取、取到了不再取；没取到的，再叫一次重取', async () => {
    const calls: { resolve: (value: string) => void; reject: () => void }[] = [];
    const load = () => new Promise<string>((resolve, reject) => calls.push({ resolve, reject: () => reject(new Error('取不到')) }));
    function Probe() {
      const [got, ask] = useOnDemand(load);
      return <button onClick={ask}>{got === null ? '没叫过' : got.state === 'ready' ? got.value : got.state}</button>;
    }
    const container = doc.createElement('div');
    doc.body.appendChild(container);
    const root = createRoot(container as any);
    await act(async () => root.render(<Probe />));
    const button = container.querySelector('button')!;
    const press = () => act(async () => button.click());
    expect(button.textContent).toBe('没叫过');
    expect(calls).toHaveLength(0);
    await press();
    expect(button.textContent).toBe('loading');
    expect(calls).toHaveLength(1);
    // 正在取的时候再叫：不另取一遍
    await press();
    expect(calls).toHaveLength(1);
    // 没取到
    await act(async () => calls[0].reject());
    expect(button.textContent).toBe('error');
    // 再叫一次：重取；这一次取到了
    await press();
    expect(button.textContent).toBe('loading');
    expect(calls).toHaveLength(2);
    await act(async () => calls[1].resolve('取到了'));
    expect(button.textContent).toBe('取到了');
    // 取到了以后再叫：不再取
    await press();
    expect(calls).toHaveLength(2);
    expect(button.textContent).toBe('取到了');
    await act(async () => root.unmount());
  });

  it('还没有自己的沙盘的站：沙盘栏里摆的是全程沙盘上到这一站去的那一节，不经过“没能摆出来”“没有沙盘”这些样子，不先说一句“沙盘正在摆出来”', { timeout: 30_000 }, async () => {
    win.location.search = '?stage=fake';
    g.__sectionTops = {};
    const container = doc.createElement('div');
    doc.body.appendChild(container);
    const root = createRoot(container as any);
    // 沙盘栏的状态每写一次就记一笔（中间一闪而过的也记得到）。
    const states: string[] = [];
    const setAttribute = MiniElement.prototype.setAttribute;
    MiniElement.prototype.setAttribute = function (name: string, value: string) {
      if (name === 'data-stage-state') states.push(String(value));
      setAttribute.call(this, name, value);
    };
    try {
      await act(async () => root.render(<FigureLayout figureId="su-shi" stopId="huangzhou" />));
      await waitFor(() => container.querySelector('.stage-pane')?.getAttribute('data-stage-state') === 'ready');
    } finally {
      MiniElement.prototype.setAttribute = setAttribute;
    }
    expect(states.length).toBeGreaterThan(0);
    expect(new Set(states)).toEqual(new Set(['loading', 'ready']));
    expect(container.querySelector('.stage-pane')?.getAttribute('data-stage-level')).toBe('route');
    expect(container.querySelector('.stage-pane')?.getAttribute('data-stage-section')).toBe(roadOf('huangzhou'));
    expect(container.querySelector('.stage-loading')).toBeNull();
    expect(container.querySelector('.stop-page')?.getAttribute('data-stop-scene')).toBe('none');
    await act(async () => root.unmount());
  });

  it('徐州：起不来时题记还在', { timeout: 30_000 }, async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const page = await mount('?stage=fake-fail', 'xuzhou');
    expect(attr(page.pane(), 'data-stage-state')).toBe('failed');
    expect(attr(page.q('.stage-caption'), 'data-section')).toBe(headings[0]);
    await page.read(headings[2]);
    await waitFor(() => attr(page.q('.stage-caption'), 'data-section') === headings[2]);
    expect(attr(page.q('.stage-caption'), 'data-section')).toBe(headings[2]);
    expect(attr(page.q('.stop-page'), 'data-stop-scene')).toBe('yes');
    await page.unmount();
    warn.mockRestore();
  });

  // ---------------------------------------------------------------- 有自己的沙盘、正文还没写的一站
  //
  // 文字栏：一句话，小标题“沙盘上看的几处”，一张单子（一行一个按钮：名字、年份、题记），沙盘的凭据，两个链接。
  // 按一行，就是告诉版面“该摆这一节了”，同写好了的一站读到另一小节是一回事。

  /** 单子上的各行：名字（data-view）、是不是摆着的那一处、里面三块字。 */
  const viewRows = (page: Awaited<ReturnType<typeof mount>>) =>
    page.all('.views .view-item').map((item) => ({
      view: attr(item, 'data-view'),
      current: attr(item, 'aria-current'),
      name: item.querySelector('.stop-title')?.textContent,
      date: item.querySelector('.stop-meta')?.textContent,
      line: item.querySelector('.view-line')?.textContent,
      tag: item.querySelector('.tag')?.textContent ?? null,
    }));

  it('有沙盘、没有正文的一站（替身）：一句话、小标题、一张单子，头一行是摆着的；按第三行，记号马上换，沙盘跟过去；滚动页面不动；收起沙盘再按，沙盘自己展开；离开再回来是头一处；凭据是沙盘上的东西', { timeout: 60_000 }, async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    // 按过的那一行有没有被挪回看得见的地方：假 DOM 里没有 scrollIntoView，这里装一个只记账的
    const scrolled: { view: string | null; how: unknown }[] = [];
    (MiniElement.prototype as any).scrollIntoView = function (this: MiniElement, how: unknown) {
      scrolled.push({ view: attr(this, 'data-view'), how });
    };
    g.__standIn = STAND_IN;
    try {
      expect(figure.stops.find((stop) => stop.id === STAND_IN)?.status).toBe('outline');
      expect(hasSceneFile(STAND_IN)).toBe(false);
      const page = await mount('?stage=fake', STAND_IN);
      await waitFor(() => page.q('.views') !== null);
      expect(attr(page.q('.stop-page'), 'data-stop-text')).toBe('none');
      expect(attr(page.q('.stop-page'), 'data-stop-scene')).toBe('yes');

      // 那一句话；小标题是黑体的小节标题，单子挂在它名下
      expect(page.q('.not-written')?.textContent).toBe(LEAF_FIRST + LEAF_REST);
      const heading = page.q('.stop-page h2.section-heading')!;
      expect(heading.textContent).toBe('沙盘上看的几处');
      expect(attr(page.q('.views')!.parentNode as MiniElement, 'aria-labelledby')).toBe(attr(heading, 'id'));

      // 单子：场景有几节就有几行，顺序一样；每行是按钮，里面是名字、年份、题记；头一行是摆着的，只有它带记号和小标签
      const sections = scene.sections;
      expect(sections.length).toBeGreaterThanOrEqual(4);
      const expected = (shown: number) =>
        sections.map((s, i) => ({ view: s.heading, current: i === shown ? 'true' : null, name: s.heading, date: s.date, line: s.line, tag: i === shown ? '正在看' : null }));
      expect(viewRows(page)).toEqual(expected(0));
      for (const item of page.all('.views .view-item')) {
        expect(item.localName).toBe('button');
        expect(attr(item, 'type')).toBe('button');
      }
      expect(page.all('.views .tag').map((tag) => attr(tag, 'aria-hidden'))).toEqual(['true']);
      // 行上没有正文小节的记号；没有正文的东西，底下那一条中间空着；有“到沙盘”那一步
      expect(page.all('.stop-page [data-section]')).toHaveLength(0);
      expect(page.all('.text-section')).toHaveLength(0);
      expect(page.q('.text-about')).toBeNull();
      expect(page.q('.guide-open')).toBeNull();
      expect(page.q('.skip-to-stage')).not.toBeNull();

      // 沙盘栏：它自己的沙盘，头一节；中间的按钮写“回到这一处”；按钮下面没有那一行话
      expect(attr(page.pane(), 'data-stage-state')).toBe('ready');
      expect(attr(page.pane(), 'data-stage-level')).toBeNull();
      expect(attr(page.pane(), 'data-stage-section')).toBe(headings[0]);
      expect(page.q('.stage-reset')?.textContent).toBe('回到这一处');
      expect(page.q('.stage-notice')).toBeNull();

      // 按第三行：记号在这一下就换了（不等沙盘），沙盘和题记随后到；按的那一行下一帧被挪回看得见的地方
      const item = (i: number) => page.all('.views .view-item')[i];
      await act(async () => item(2).click());
      expect(viewRows(page)).toEqual(expected(2));
      await waitFor(() => attr(page.pane(), 'data-stage-section') === headings[2]);
      expect(attr(page.q('.stage-caption'), 'data-section')).toBe(headings[2]);
      expect(attr(page.q('.fake-stage'), 'data-fake-animated')).toBe('true');
      expect(page.all('.stage-host .strip').map((el) => attr(el, 'data-strip-id'))).toEqual(sections[2].strips);
      await waitFor(() => scrolled.length === 1);
      expect(scrolled).toEqual([{ view: headings[2], how: { block: 'nearest' } }]);

      // 没有正文带着镜头走：滚动页面，沙盘和记号都不动
      win.fire('scroll');
      await settle(400);
      expect(attr(page.pane(), 'data-stage-section')).toBe(headings[2]);
      expect(viewRows(page)).toEqual(expected(2));

      // 再按摆着的那一行：读者没有动过沙盘，什么也不变
      const requests = attr(page.q('.fake-stage'), 'data-fake-requests');
      await act(async () => item(2).click());
      await settle(100);
      expect(viewRows(page)).toEqual(expected(2));
      expect(attr(page.pane(), 'data-stage-section')).toBe(headings[2]);
      expect(attr(page.q('.fake-stage'), 'data-fake-moved')).toBe('false');
      expect(attr(page.q('.fake-stage'), 'data-fake-requests')).toBe(requests);

      // 读者把沙盘转开了（替身的“挪一下镜头”）：按别的一行不管它；按摆着的那一行，画面回到这一处（同栏里的“回到这一处”）
      await act(async () => page.q('.fake-stage-nudge')!.click());
      expect(attr(page.q('.fake-stage'), 'data-fake-moved')).toBe('true');
      expect(attr(page.q('.stage-reset'), 'aria-disabled')).toBe('false');
      await act(async () => item(2).click());
      await waitFor(() => attr(page.q('.fake-stage'), 'data-fake-moved') === 'false');
      expect(attr(page.q('.stage-reset'), 'aria-disabled')).toBe('true');
      expect(viewRows(page)).toEqual(expected(2));
      expect(attr(page.pane(), 'data-stage-section')).toBe(headings[2]);
      // 没有另要一次“换小节”：只是回到摆好的位置
      expect(attr(page.q('.fake-stage'), 'data-fake-requests')).toBe(requests);

      // 窄屏上收起沙盘（假 DOM 里的窗口不算宽屏）：再按第二行，不是白按——栏自己展开了，直接摆到第二处
      await act(async () => page.q('.stage-fold')!.click());
      expect(attr(page.q('.stage-fold'), 'aria-expanded')).toBe('false');
      expect(page.pane().className.split(' ')).toContain('is-folded');
      await act(async () => item(1).click());
      expect(viewRows(page)).toEqual(expected(1));
      expect(attr(page.q('.stage-fold'), 'aria-expanded')).toBe('true');
      expect(page.pane().className.split(' ')).not.toContain('is-folded');
      await waitFor(() => attr(page.pane(), 'data-stage-section') === headings[1]);
      expect(attr(page.q('.stage-caption'), 'data-section')).toBe(headings[1]);
      // 展开以后是直接摆到第二处的，不是先回到原来那一处再滑过去
      expect(attr(page.q('.fake-stage'), 'data-fake-animated')).toBe('false');
      expect(attr(page.q('.fake-stage'), 'data-fake-requests')?.split('|').at(-1)).toBe(headings[1]);
      // （到这里按过四次：第三行、摆着的那一行两次、第二行；每按一次，按的那一行都被挪回看得见的地方一次）
      await waitFor(() => scrolled.length === 4);
      expect(scrolled[3]).toEqual({ view: headings[1], how: { block: 'nearest' } });
      // 没收起的时候按一行，不去动“收起沙盘”那个按钮
      await act(async () => item(3).click());
      expect(attr(page.q('.stage-fold'), 'aria-expanded')).toBe('true');
      await waitFor(() => attr(page.pane(), 'data-stage-section') === headings[3]);

      // 凭据：只有“沙盘上的东西”一栏；出处是场景自己带的那一份
      expect(page.all('details.provenance summary')).toHaveLength(1);
      expect(page.q('.scene-register')).toBeNull();
      await setFold(page.q('details.provenance')!, true);
      await waitFor(() => page.q('.scene-register') !== null);
      expect(page.all('.scene-register-group').filter((group) => attr(group, 'data-class') !== null).length).toBeGreaterThan(0);
      expect(page.all('.scene-credits p').map((p) => p.textContent)).toEqual(scene.credits);
      const cited = new Set(page.all('.scene-register .provenance-cite').map((p) => p.textContent));
      expect(cited.size).toBeGreaterThan(0);
      for (const line of cited) expect(standInSources.some((source) => line === `出处：${source.cite}`), line ?? '').toBe(true);
      expect(page.all('.provenance-item')).toHaveLength(0);

      // 末尾的两个链接照旧
      expect(page.all('.stop-nav a').map((link) => link.textContent)).toEqual(['回到各站目录', '来源']);

      // 去人物页再回来：从头一处开始，不带着上一次按的
      await page.show(null);
      await waitFor(() => attr(page.pane(), 'data-stage-level') === 'route' && attr(page.pane(), 'data-stage-state') === 'ready');
      expect(page.q('.views')).toBeNull();
      await page.show(STAND_IN);
      await waitFor(() => page.q('.views') !== null && attr(page.pane(), 'data-stage-level') === null && attr(page.pane(), 'data-stage-state') === 'ready');
      expect(viewRows(page)).toEqual(expected(0));
      expect(attr(page.pane(), 'data-stage-section')).toBe(headings[0]);
      // 去一站写好了的（徐州）：单子没了，按钮写回“回到这一节”
      await page.show('xuzhou');
      await waitFor(() => attr(page.q('.stop-page'), 'data-stop-text') === 'written' && attr(page.pane(), 'data-stage-state') === 'ready');
      expect(page.q('.views')).toBeNull();
      expect(page.q('.not-written')).toBeNull();
      expect(page.q('.stage-reset')?.textContent).toBe('回到这一节');
      await page.unmount();
      expect(errors.mock.calls.map((call) => String(call[0]))).toEqual([]);
    } finally {
      g.__standIn = null;
      delete (MiniElement.prototype as any).scrollIntoView;
      errors.mockRestore();
    }
  });

  it('有沙盘、没有正文的一站（替身）：沙盘的数据还在读的时候，那一句只有前半句，没有单子；读出来了才有后半句和单子', { timeout: 30_000 }, async () => {
    let open: () => void = () => {};
    g.__tableGate = new Promise<void>((resolve) => (open = resolve));
    g.__standIn = STAND_IN;
    try {
      win.location.search = '?stage=fake';
      const container = doc.createElement('div');
      doc.body.appendChild(container);
      const root = createRoot(container as any);
      await act(async () => root.render(<FigureLayout figureId="su-shi" stopId={STAND_IN} />));
      const q = (selector: string) => container.querySelector(selector);
      await waitFor(() => attr(q('.stop-page'), 'data-stop-text') === 'none');
      // 沙盘的数据还没到：前半句已经在了，文字栏不是空的；没有后半句、单子、凭据
      expect(attr(q('.stop-page'), 'data-stop-scene')).toBe('loading');
      expect(attr(q('.stage-pane'), 'data-stage-state')).toBe('loading');
      expect(q('.not-written')?.textContent).toBe(LEAF_FIRST);
      expect(q('.views')).toBeNull();
      expect(q('details.provenance')).toBeNull();
      expect(container.querySelectorAll('.stop-nav a')).toHaveLength(2);
      // 到了
      open();
      g.__tableGate = null;
      await waitFor(() => q('.views') !== null);
      expect(attr(q('.stop-page'), 'data-stop-scene')).toBe('yes');
      expect(q('.not-written')?.textContent).toBe(LEAF_FIRST + LEAF_REST);
      expect(container.querySelectorAll('.views .view-item')).toHaveLength(scene.sections.length);
      await act(async () => root.unmount());
    } finally {
      open();
      g.__tableGate = null;
      g.__standIn = null;
    }
  });

  it('有沙盘、没有正文的一站（替身）：沙盘还在摆的时候（数据读出来了，画面还没有）按了第三行——记号和沙盘栏的题记马上换；沙盘摆好的时候，摆着的就是第三处', { timeout: 30_000 }, async () => {
    g.__standIn = STAND_IN;
    try {
      // 替身隔两秒才摆好：这一段里单子已经在了，读者可以按
      win.location.search = '?stage=fake&readygap=2000';
      const container = doc.createElement('div');
      doc.body.appendChild(container);
      const root = createRoot(container as any);
      await act(async () => root.render(<FigureLayout figureId="su-shi" stopId={STAND_IN} />));
      const q = (selector: string) => container.querySelector(selector);
      await waitFor(() => q('.views') !== null);
      expect(attr(q('.stage-pane'), 'data-stage-state')).toBe('loading');
      expect(attr(q('.stage-pane'), 'data-stage-section')).toBeNull();
      await act(async () => container.querySelectorAll('.views .view-item')[2].click());
      expect(container.querySelectorAll('.views .view-item').map((item) => attr(item, 'aria-current'))).toEqual(scene.sections.map((_, i) => (i === 2 ? 'true' : null)));
      await waitFor(() => attr(q('.stage-caption'), 'data-section') === headings[2]);
      // 这时候沙盘还没摆好
      expect(attr(q('.stage-pane'), 'data-stage-state')).toBe('loading');
      await waitFor(() => attr(q('.stage-pane'), 'data-stage-state') === 'ready');
      await waitFor(() => attr(q('.stage-pane'), 'data-stage-section') === headings[2]);
      expect(container.querySelectorAll('.stage-host .strip').map((el) => attr(el, 'data-strip-id'))).toEqual(scene.sections[2].strips);
      expect(container.querySelectorAll('.views .view-item').map((item) => attr(item, 'aria-current'))).toEqual(scene.sections.map((_, i) => (i === 2 ? 'true' : null)));
      await act(async () => root.unmount());
    } finally {
      g.__standIn = null;
    }
  });

  it('有沙盘、没有正文的一站（替身）：沙盘的数据没读出来——那一句只有前半句，没有单子；沙盘栏说“沙盘没能摆出来。”，不说“正文可以照常读”；再试一次读出来了，单子就有了', { timeout: 30_000 }, async () => {
    g.__tableFails = 1;
    g.__standIn = STAND_IN;
    try {
      const page = await mount('?stage=fake', STAND_IN);
      await waitFor(() => attr(page.q('.stop-page'), 'data-stop-scene') === 'failed' && attr(page.q('.stop-page'), 'data-stop-text') === 'none');
      expect(attr(page.pane(), 'data-stage-state')).toBe('failed');
      expect(page.q('.stage-message p')?.textContent).toBe(BARE_FAILED);
      expect(page.q('.not-written')?.textContent).toBe(LEAF_FIRST);
      expect(page.q('.views')).toBeNull();
      expect(page.q('details.provenance')).toBeNull();
      expect(page.q('.stage-retry')?.textContent).toBe('再试一次');
      await act(async () => page.q('.stage-retry')!.click());
      await waitFor(() => page.q('.views') !== null && attr(page.pane(), 'data-stage-state') === 'ready');
      expect(page.q('.not-written')?.textContent).toBe(LEAF_FIRST + LEAF_REST);
      await page.unmount();
    } finally {
      g.__tableFails = 0;
      g.__standIn = null;
    }
  });

  it('有沙盘、没有正文的一站（替身）：沙盘起不来、浏览器画不了、设备太慢——三句话都不说“正文可以照常读”；单子照旧在，按一行，沙盘栏的题记跟着换', { timeout: 60_000 }, async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    // 借来的沙盘不带图片：三种情形下沙盘栏里都只有一句话
    g.__standIn = STAND_IN;
    try {
      for (const [search, state, words, button] of [
        ['?stage=fake-fail', 'failed', BARE_FAILED, '再试一次'],
        ['?stage=fake-unsupported', 'unsupported', BARE_UNSUPPORTED, null],
        ['?stage=fake&slow=start2', 'slow', BARE_SLOW, '试试立体的沙盘'],
      ] as const) {
        resetFakeVisit();
        const page = await mount(search, STAND_IN);
        await waitFor(() => attr(page.pane(), 'data-stage-state') === state && page.q('.views') !== null);
        expect(page.q('.stage-message p')?.textContent, search).toBe(words);
        expect(page.q('.stage-retry')?.textContent ?? null, search).toBe(button);
        // 单子和那一句都在（场景读出来了，只是画面摆不出来）；按第二行：记号换了，沙盘栏的题记也换了
        expect(page.q('.not-written')?.textContent, search).toBe(LEAF_FIRST + LEAF_REST);
        expect(attr(page.q('.stage-caption'), 'data-section'), search).toBe(headings[0]);
        await act(async () => page.all('.views .view-item')[1].click());
        expect(viewRows(page).map((row) => row.current), search).toEqual(scene.sections.map((_, i) => (i === 1 ? 'true' : null)));
        await waitFor(() => attr(page.q('.stage-caption'), 'data-section') === headings[1]);
        await page.unmount();
      }
      // 写好了的一站那三句照旧带着“正文可以照常读”：在 pane-behaviour.test.tsx、pane-stills.test.tsx 里查（那里的沙盘栏是写好了的一站的）。
    } finally {
      resetFakeVisit();
      g.__standIn = null;
      warn.mockRestore();
      info.mockRestore();
    }
  });

  it('有沙盘、没有正文的一站（替身），只放图片的时候（设备太慢，或者地址里写了 ?tier=still），这座沙盘带着图片：栏里放的是头一处的图片；单子和那一句照旧在；按哪一行，图片就换成那一处的，题记跟着换', { timeout: 60_000 }, async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    // 借来的沙盘这一回带着图片的替身（?sectionstills=fake）：眉州的定格图做出来以后页面上就是这个样子
    g.__standIn = STAND_IN;
    try {
      for (const [search, words] of [
        ['?stage=fake&slow=start2&sectionstills=fake', '立体的沙盘在这台设备上太慢，这里放的是图片。'],
        ['?stage=fake&tier=still&sectionstills=fake', '这里放的是沙盘的图片，不能转动。'],
      ] as const) {
        resetFakeVisit();
        const page = await mount(search, STAND_IN);
        const still = () => page.q('.stage-still-host .fake-still');
        await waitFor(() => attr(page.pane(), 'data-stage-state') === 'slow' && attr(page.pane(), 'data-stage-picture') === 'still' && page.q('.views') !== null);
        await waitFor(() => attr(still(), 'data-fake-still-shown') === 'true');
        // 放着的是图片，不是立体的沙盘；说的那一句没有“正文可以照常读”；那一句和单子都在，头一行标着
        expect(page.q('.stage-host .fake-stage'), search).toBeNull();
        expect(page.q('.stage-says .stage-notice p')?.textContent, search).toBe(words);
        expect(page.q('.not-written')?.textContent, search).toBe(LEAF_FIRST + LEAF_REST);
        expect(attr(still(), 'data-fake-still-section'), search).toBe(headings[0]);
        expect(viewRows(page).map((row) => row.current), search).toEqual(scene.sections.map((_, i) => (i === 0 ? 'true' : null)));
        // 一行一行按过去（最后按回头一行）：记号马上换；图片、沙盘栏写着的小节、题记都换成那一处的
        for (const i of [...headings.keys()].slice(1).concat(0)) {
          await act(async () => page.all('.views .view-item')[i].click());
          expect(viewRows(page).map((row) => row.current), search).toEqual(scene.sections.map((_, k) => (k === i ? 'true' : null)));
          await waitFor(() => attr(still(), 'data-fake-still-section') === headings[i]);
          await waitFor(() => attr(page.pane(), 'data-stage-section') === headings[i] && attr(page.q('.stage-caption'), 'data-section') === headings[i]);
          expect(attr(page.pane(), 'data-stage-picture'), search).toBe('still');
        }
        await page.unmount();
      }
    } finally {
      resetFakeVisit();
      g.__standIn = null;
      info.mockRestore();
    }
  });

  it('写好了的一站（徐州），正文这一次没读出来：说“这一站的正文没能读出来。”，没有“沙盘上看的几处”那张单子（页面上那两个属性这时候同没写的站一样，认单子不能靠它们）', { timeout: 30_000 }, async () => {
    g.__textFails = true;
    try {
      const page = await mount('?stage=fake', 'xuzhou');
      await waitFor(() => attr(page.q('.stop-page'), 'data-stop-text') === 'none' && attr(page.q('.stop-page'), 'data-stop-scene') === 'yes' && attr(page.pane(), 'data-stage-state') === 'ready');
      expect(page.all('.stop-page .quiet').map((line) => line.textContent)).toEqual(['这一站的正文没能读出来。']);
      expect(page.q('.not-written')).toBeNull();
      expect(page.q('.views')).toBeNull();
      expect(page.q('.view-item')).toBeNull();
      expect(page.q('details.provenance')).toBeNull();
      // 它是写好了的一站：沙盘栏的按钮照旧
      expect(page.q('.stage-reset')?.textContent).toBe('回到这一节');
      await page.unmount();
    } finally {
      g.__textFails = false;
    }
  });

  // 眉州真的样子：content/ 里它自己的场景。哪一天没有这样的站了（六站的正文都写好），这一条自己跳过，上面替身的几条还在。
  it.runIf(UNWRITTEN_WITH_TABLE !== undefined)(
    '有自己的沙盘、正文还没写的站（眉州）：单子上是它的场景里的各处；一行一行按过去，沙盘跟到每一处；凭据里的出处是场景文件自己带的；去别的站再回来还是头一处',
    { timeout: 60_000 },
    async () => {
      const stopId = UNWRITTEN_WITH_TABLE as string;
      const own = JSON.parse(new TextDecoder().decode(readBytes(`content/figures/su-shi/scenes/${stopId}.json`))) as StopScene;
      const names = own.sections.map((s) => s.heading);
      const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
      const page = await mount('?stage=fake', stopId);
      await waitFor(() => page.q('.views') !== null);
      expect(attr(page.q('.stop-page'), 'data-stop-text')).toBe('none');
      expect(attr(page.q('.stop-page'), 'data-stop-scene')).toBe('yes');
      expect(page.q('.not-written')?.textContent).toBe(LEAF_FIRST + LEAF_REST);
      const rows = (shown: number) => own.sections.map((s, i) => ({ view: s.heading, current: i === shown ? 'true' : null, name: s.heading, date: s.date, line: s.line, tag: i === shown ? '正在看' : null }));
      expect(viewRows(page)).toEqual(rows(0));
      // 沙盘栏：这一站自己的沙盘（不写 level），头一处；题签是头一处的；没有印，按钮下面没有那一行话
      expect(attr(page.pane(), 'data-stage-state')).toBe('ready');
      expect(attr(page.pane(), 'data-stage-level')).toBeNull();
      expect(attr(page.pane(), 'data-stage-section')).toBe(names[0]);
      expect(page.all('.stage-host .strip').map((el) => attr(el, 'data-strip-id'))).toEqual(own.sections[0].strips);
      expect(page.all('.strip-seal')).toHaveLength(0);
      expect(page.q('.stage-notice')).toBeNull();
      expect(page.q('.stage-reset')?.textContent).toBe('回到这一处');
      // 一行一行按过去（最后按回头一行）：记号马上换，沙盘、题记、题签跟到
      for (const i of [...names.keys()].slice(1).concat(0)) {
        await act(async () => page.all('.views .view-item')[i].click());
        expect(viewRows(page)).toEqual(rows(i));
        await waitFor(() => attr(page.pane(), 'data-stage-section') === names[i]);
        expect(attr(page.q('.stage-caption'), 'data-section')).toBe(names[i]);
        expect(page.all('.stage-host .strip').map((el) => attr(el, 'data-strip-id'))).toEqual(own.sections[i].strips);
      }
      // 凭据：出处是场景文件自己的 sources
      await setFold(page.q('details.provenance')!, true);
      await waitFor(() => page.q('.scene-register') !== null);
      const cited = new Set(page.all('.scene-register .provenance-cite').map((p) => p.textContent));
      expect(cited.size).toBeGreaterThan(0);
      for (const line of cited) expect((own.sources ?? []).some((source) => line === `出处：${source.cite}`), line ?? '').toBe(true);
      expect(page.all('.scene-not-drawn .scene-register-item')).toHaveLength(own.notDrawn.length);
      // 按到第三处，去人物页（全程沙盘）再回来：重摆的是它自己的沙盘，头一处
      await act(async () => page.all('.views .view-item')[2].click());
      await waitFor(() => attr(page.pane(), 'data-stage-section') === names[2]);
      const table = page.q('.fake-stage');
      await page.show(null);
      await waitFor(() => attr(page.pane(), 'data-stage-level') === 'route' && attr(page.pane(), 'data-stage-state') === 'ready');
      await page.show(stopId);
      await waitFor(() => page.q('.views') !== null && attr(page.pane(), 'data-stage-level') === null && attr(page.pane(), 'data-stage-state') === 'ready');
      expect(page.q('.fake-stage')).not.toBe(table);
      expect(attr(page.pane(), 'data-stage-section')).toBe(names[0]);
      expect(viewRows(page)).toEqual(rows(0));
      await page.unmount();
      // 一路上页面没有往控制台里报错
      expect(errors.mock.calls.map((call) => String(call[0]))).toEqual([]);
      errors.mockRestore();
    },
  );
});
