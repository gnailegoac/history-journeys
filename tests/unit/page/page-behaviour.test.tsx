// 整个版面（FigureLayout：人物页、站点页）的行为：用假 DOM（miniDom.ts）在 Node 里连同 content/ 里真的内容和沙盘的替身跑一遍。
// 不看版面和样式（那是 tests/e2e 的事）。
import { describe, expect, it, vi } from 'vitest';
import type { Figure, StopScene } from '../../../src/domain';
import { SITE_TITLE } from '../../../src/ui/text';
import { readBytes } from '../../support/readBytes';
import { installMiniDom, MiniElement } from './miniDom';

const doc = installMiniDom('?stage=fake');
const win = (globalThis as any).window;
const g = globalThis as any;

const { act } = await import('react');
const { createRoot } = await import('react-dom/client');
const { FigureLayout } = await import('../../../src/ui/FigureLayout');
const { FigureContents } = await import('../../../src/ui/FigureContents');
const { useOnDemand } = await import('../../../src/app/useLoaded');

const scene = JSON.parse(new TextDecoder().decode(readBytes('content/figures/su-shi/scenes/xuzhou.json'))) as StopScene;
const headings = scene.sections.map((s) => s.heading);
/** 人物的资料，照 content/ 里真的文件：有几站、各叫什么、写没写好，下面都从它读，不另写一遍。 */
const figure = JSON.parse(new TextDecoder().decode(readBytes('content/figures/su-shi/figure.json'))) as Figure;
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
    if (state === 'still') return container.querySelector('.stage-still-box')?.getAttribute('data-still') !== 'loading';
    return state !== undefined && state !== 'loading';
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
  it('人物页：定格图', { timeout: 30_000 }, async () => {
    const page = await mount('?stage=fake', null);
    expect(attr(page.pane(), 'data-stage-state')).toBe('still');
    expect(attr(page.q('.stage-still-box'), 'data-still')).toBe('shown');
    expect(attr(page.q('.stage-still img'), 'alt')).toBeTruthy();
    expect(page.q('.names-switch')).toBeNull();
    expect(page.all('.stop-item').length).toBeGreaterThan(1);
    await page.unmount();
  });

  it('人物页：?still=none', { timeout: 30_000 }, async () => {
    const page = await mount('?stage=fake&still=none', null);
    expect(attr(page.q('.stage-still-box'), 'data-still')).toBe('none');
    expect(page.q('.stage-still-line')?.textContent).toBe('全程沙盘还没接进来。');
    expect(page.q('.stage-still')).toBeNull();
    await page.unmount();
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

    // 换到黄州：沙盘拿走，换成定格图和一句话。
    await page.show('huangzhou');
    await waitFor(() => attr(page.pane(), 'data-stage-state') === 'still' && attr(page.q('.stop-page'), 'data-stop-scene') === 'none' && page.q('.stage-still img') !== null);
    expect(attr(page.pane(), 'data-stage-state')).toBe('still');
    expect(attr(page.q('.stop-page'), 'data-stop-scene')).toBe('none');
    expect(page.q('.stage-still-line')?.textContent).toBe('这一站的沙盘还没做好，先看全程。');
    expect(page.q('.stage-still img')).not.toBeNull();
    expect(page.q('.fake-stage')).toBeNull();
    // 这一站的凭据点开：有正文的凭据，没有“沙盘上的东西”
    await waitFor(() => page.q('details.provenance') !== null);
    await setFold(page.q('details.provenance')!, true);
    await waitFor(() => page.q('.provenance-item') !== null);
    expect(page.q('.scene-register')).toBeNull();
    expect(page.all('.strip')).toHaveLength(0);

    // 再回徐州：从第一节开始，不带着上一次读到的小节。
    g.__sectionTops = {};
    await page.show('xuzhou');
    await waitFor(() => attr(page.pane(), 'data-stage-state') === 'ready');
    expect(attr(page.pane(), 'data-stage-state')).toBe('ready');
    expect(attr(page.pane(), 'data-stage-section')).toBe(headings[0]);
    expect(attr(page.q('.fake-stage'), 'data-fake-animated')).toBe('false');
    // 今名留着。
    expect(attr(page.q('.fake-stage'), 'data-fake-names')).toBe('modern');

    // 还没写的站。
    await page.show('meishan');
    await waitFor(() => attr(page.pane(), 'data-stage-state') === 'still' && attr(page.q('.stop-page'), 'data-stop-text') === 'none');
    expect(attr(page.pane(), 'data-stage-state')).toBe('still');
    expect(attr(page.q('.stop-page'), 'data-stop-text')).toBe('none');
    expect(attr(page.q('.stop-page'), 'data-stop-scene')).toBe('none');

    // 回人物页。
    await page.show(null);
    await waitFor(() => attr(page.pane(), 'data-stage-state') === 'still' && page.q('.stage-still-line') === null);
    expect(attr(page.pane(), 'data-stage-state')).toBe('still');
    expect(page.q('.stage-still-line')).toBeNull();
    await page.unmount();
  });

  it('站点页的抬头：一站一个小方块，只有这一站的做了记号，读屏不念；位置那一行中间是画出来的一小段线', { timeout: 60_000 }, async () => {
    const count = figure.stops.length;
    const at = figure.stops.findIndex((stop) => stop.id === 'xuzhou');
    expect(at).toBeGreaterThanOrEqual(0);
    const page = await mount('?stage=fake', 'xuzhou');
    // 前面那句话照旧说第几站、共几站
    expect(page.q('.page-head .eyebrow')?.textContent).toBe(`第 ${at + 1} 站 · 共 ${count} 站`);
    // 小方块：有几站就有几个，里面没有字；读屏不念（那句话已经说了）
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

  it('人物页的目录：数字印是汉字的一、二、三……，读屏不念；站名里不夹着“还没写”的小标签', { timeout: 30_000 }, async () => {
    const page = await mount('?stage=fake', null);
    const numerals = '一二三四五六七八九十';
    expect(figure.stops.length).toBeLessThanOrEqual(numerals.length);
    const seals = page.all('.stop-item .stop-number');
    expect(seals.map((seal) => seal.textContent)).toEqual(figure.stops.map((_, i) => numerals[i]));
    for (const seal of seals) expect(attr(seal, 'aria-hidden')).toBe('true');
    // 站名（楷体）自己一块，里面只有站名；小标签（宋体）是旁边的另一块
    expect(page.all('.stop-item .stop-head .stop-title').map((title) => title.textContent)).toEqual(figure.stops.map((stop) => stop.title));
    expect(page.all('.stop-item .stop-title .tag')).toHaveLength(0);
    const unwritten = figure.stops.filter((stop) => stop.status !== 'complete').map((stop) => stop.id);
    expect(unwritten.length).toBeGreaterThan(0);
    expect(page.all('.stop-item .stop-head .tag').map((tag) => attr(tag.closest('.stop-item'), 'data-stop-id'))).toEqual(unwritten);
    await page.unmount();
  });

  it('目录超过十站：第十一站起数字印用数字', async () => {
    const many: Figure = { ...figure, stops: Array.from({ length: 12 }, (_, i) => ({ ...figure.stops[i % figure.stops.length], id: `s${i + 1}` })) };
    const container = doc.createElement('div');
    doc.body.appendChild(container);
    const root = createRoot(container as any);
    await act(async () => root.render(<FigureContents figure={many} />));
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

  it('还没有沙盘的站：沙盘栏一上来就是定格图那一种，不先说一句“沙盘正在摆出来”', { timeout: 30_000 }, async () => {
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
      await waitFor(() => container.querySelector('.stage-still img') !== null);
    } finally {
      MiniElement.prototype.setAttribute = setAttribute;
    }
    expect(states.length).toBeGreaterThan(0);
    expect(new Set(states)).toEqual(new Set(['still']));
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
});
