// 沙盘栏（StagePane）带着每一小节的图片（定格图）和画质分档时的各种状态：用假 DOM（miniDom.ts）在 Node 里，
// 把沙盘栏、沙盘的替身（?stage=fake…）、定格图的替身（?sectionstills=fake…）和题签层连起来跑。
// 场景是几组测试共用的那座小沙盘；沙盘旁边的字用假的。不看版面和样式（那是 tests/e2e/pane-stills.spec.ts 的事）。
//
// 各项对着设计里“每一种状态”的那张表：图片先出来（1）、沙盘盖上去（2、2b）、画不了（3）、太慢（4、4a、4b、4c）、
// 画面断了（5）、没摆出来（6）、图片取不到（9）、读着读着降一档（10）；再加题记跟着哪一张画面、指北和比例尺、焦点。
// 没有图片时的样子（3b、5b、6b、8）在 pane-behaviour.test.tsx 里，那里的测试不带 sectionstills。
//
// 有些状态只出现一小会儿（沙盘盖着图片显出来的那 240 毫秒）。为了不漏掉，这里把页面上几个属性每一次被写成什么都记下来（见 spy）。
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SectionInfo, StopScene } from '../../../src/domain';
import type { StillManifest } from '../../../src/domain/stills';
import type { StopTable } from '../../../src/stage/types';
import { FIXTURE_HEADINGS, fixtureScene } from '../../support/fixtureScene';
import { installMiniDom, MiniElement } from './miniDom';

const doc = installMiniDom('?stage=fake');
const win = (globalThis as any).window;

// 真的沙盘程序（three.js）：这里只数它有没有被取过。画不了的浏览器上，页面不该去取它。
const engineLoads = vi.hoisted(() => ({ count: 0 }));
vi.mock('../../../src/stage/three/engine', () => {
  engineLoads.count += 1;
  return { engine: { name: 'never', version: '0', support: () => ({ ok: false, reason: 'no-webgl2' }), create: () => Promise.reject(new Error('不该摆')) } };
});

vi.mock('../../../src/domain', async (original) => {
  const actual = await original<typeof import('../../../src/domain')>();
  return {
    ...actual,
    sectionHeadings: (scene: StopScene) => scene.sections.map((s) => s.heading),
    sectionInfo: (scene: StopScene, heading: string): SectionInfo => {
      const s = scene.sections.find((x) => x.heading === heading)!;
      return { section: heading, date: s.date, line: s.line, note: { short: '短', brief: '更短', lines: ['长一', '长二'] }, far: [] };
    },
    stripTexts: (scene: StopScene, heading: string, names: 'ancient' | 'modern') => {
      const s = scene.sections.find((x) => x.heading === heading)!;
      return s.strips.map((id) => {
        const strip = scene.strips.find((x) => x.id === id)!;
        const tone = strip.of === 'river' ? 'water' : strip.of === 'far-town' ? 'far' : 'place';
        return { id, text: names === 'modern' && strip.modern ? strip.modern : strip.text, tone } as const;
      });
    },
  };
});

const { act } = await import('react');
const { createRoot } = await import('react-dom/client');
const { StagePane } = await import('../../../src/ui/StagePane');
const { resetFakeVisit } = await import('../../../src/ui/dev/fakeStage');
const { pickStillEngine } = await import('../../../src/ui/stageEngineSource');
const { STAGE_TEXT, stageDebugLine } = await import('../../../src/ui/text');

const [FIRST, SECOND] = FIXTURE_HEADINGS;
const table: StopTable = { kind: 'stop', key: 'f/s', scene: fixtureScene(), terrainUrl: 't.bin' };
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const settle = (ms = 20) => act(async () => void (await sleep(ms)));
const attr = (el: MiniElement | null, name: string) => el?.getAttribute(name) ?? null;

/** 设计里批准的几句话，照原样抄在这里：src/ui/text.ts 里的字被改动了，这里要红。 */
const SAYS = {
  loading: '沙盘正在摆出来，要等一会儿…',
  unsupported: '这个浏览器画不出立体的沙盘，这里放的是图片。',
  slow: '立体的沙盘在这台设备上太慢，这里放的是图片。',
  slowAlone: '立体的沙盘在这台设备上太慢，先不摆了，正文可以照常读。',
  only: '这里放的是沙盘的图片，不能转动。',
  lost: '沙盘的画面断了，这里先放图片。',
  failed: '沙盘没能摆出来，这里先放图片。',
  failedAlone: '沙盘没能摆出来，正文可以照常读。',
  asked: '设备慢的话，可以换回图片。',
  tryTable: '试试立体的沙盘',
  back: '换回图片',
  rebuild: '重新摆出来',
  retry: '再试一次',
  reset: '回到这一节',
};

/** 页面上这几个属性每一次被写成什么，按先后记下来；cls 是被写的那个元素当时的类名。 */
interface Write {
  name: string;
  value: string;
  cls: string;
}
const WATCHED = new Set(['data-stage-state', 'data-stage-picture', 'data-fake-still-shown', 'data-fake-tier', 'data-fake-slow', 'class']);
const writes: Write[] = [];
const setAttribute = MiniElement.prototype.setAttribute;
MiniElement.prototype.setAttribute = function (name: string, value: string) {
  if (WATCHED.has(name)) writes.push({ name, value: String(value), cls: name === 'class' ? String(value) : this.className });
  setAttribute.call(this, name, value);
};
/** 某个属性一路上被写成过哪些值（按先后）。 */
const written = (name: string) => writes.filter((w) => w.name === name).map((w) => w.value);
/** 放画面的那一块有没有挂过“沙盘正盖着图片显出来”的类。 */
const everHandedOver = () => writes.some((w) => w.name === 'class' && w.value.includes('is-handing-over'));

let warn: ReturnType<typeof vi.spyOn>;
const warned = (...words: string[]) => warn.mock.calls.some((call: unknown[]) => words.every((word) => call.map(String).join(' ').includes(word)));
/** 换档是设备慢的时候本来该走的路：只用 console.info 记一笔，不算警告。 */
let info: ReturnType<typeof vi.spyOn>;
const told = (...words: string[]) => info.mock.calls.some((call: unknown[]) => words.every((word) => call.map(String).join(' ').includes(word)));

async function mount(search: string, opts: { reducedMotion?: boolean } = {}) {
  win.location.search = search;
  win.matchMedia = (query: string) => ({ matches: opts.reducedMotion === true && query.includes('prefers-reduced-motion') });
  resetFakeVisit();
  doc.activeElement = null;
  writes.length = 0;
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  info = vi.spyOn(console, 'info').mockImplementation(() => {});
  const container = doc.createElement('div');
  doc.body.appendChild(container);
  const root = createRoot(container as any);
  let section: string | null = null;
  const render = () =>
    act(async () => {
      root.render(<StagePane onStopPage written table={{ state: 'ready', value: table }} section={section} route={{ state: 'ready', value: null }} onReloadTable={() => {}} />);
    });
  await render();

  const pane = () => container.querySelector('.stage-pane')!;
  const q = (selector: string) => container.querySelector(selector);
  const all = (selector: string) => container.querySelectorAll(selector);
  /** 等到 ok() 成立（最多等 ms 毫秒）。机器忙的时候定时器会晚，所以等的是结果，不是固定的一段时间。 */
  const until = async (ok: () => boolean, ms = 10_000) => {
    const end = Date.now() + ms;
    while (!ok() && Date.now() < end) await settle(10);
    if (!ok()) throw new Error(`等了 ${ms} 毫秒也没等到：${ok.toString()}`);
  };
  const state = () => attr(pane(), 'data-stage-state');
  const picture = () => attr(pane(), 'data-stage-picture');
  return {
    container,
    pane,
    q,
    all,
    until,
    state,
    picture,
    shows: () => attr(pane(), 'data-stage-section'),
    caption: () => attr(q('.stage-caption'), 'data-section'),
    notice: () => q('.stage-says .stage-notice p')?.textContent ?? null,
    fakeTable: () => q('.stage-host .fake-stage'),
    fakeStill: () => q('.stage-still-host .fake-still'),
    stillStrips: () => all('.stage-still-host .strip').map((el) => el.textContent),
    /** 那一排按钮里现在有哪几个（按先后）。 */
    controls: () => all('.stage-controls button').map((el) => el.textContent),
    click: (selector: string) => act(async () => q(selector)!.click()),
    read: (section_: string | null) => {
      section = section_;
      return render();
    },
    /** 等到这一种状态，而且放着这一种画面。 */
    settled: (state_: string, picture_: string) => until(() => state() === state_ && picture() === picture_),
    unmount: async () => {
      await act(async () => root.unmount());
      container.remove();
    },
  };
}

afterEach(() => {
  warn?.mockRestore();
  info?.mockRestore();
});

describe('沙盘栏 + 每一小节的图片（状态 1、2、2b）', () => {
  it('状态 1：图片先出来，带着题签、题记、指北和比例尺；什么话都不说；古名今名管用，“回到这一节”点不了', { timeout: 30_000 }, async () => {
    const page = await mount('?stage=fake&sectionstills=fake&readygap=700');
    await page.settled('loading', 'still');
    await page.until(() => page.fakeTable() !== null);
    // 图片在下面那一层里；上面那一层的沙盘已经在摆了，还没显出来。
    expect(page.state()).toBe('loading');
    expect(attr(page.fakeStill(), 'data-fake-still-section')).toBe(FIRST);
    expect(page.q('.stage-host')?.className).toBe('stage-host');
    expect(page.shows()).toBe(FIRST);
    expect(page.caption()).toBe(FIRST);
    expect(page.stillStrips()).toEqual(['样城', '样水']);
    // 图片四边留的空和沙盘的一样：上面是按钮（8 + 44），下面是题记（600 − 500）。
    expect(attr(page.fakeStill(), 'data-fake-still-insets')).toBe('52 0 100 0');
    // 指北和比例尺是图片那一层报的（定格图的替身报 12 度、“5 公里”宽 80 像素；沙盘的替身报的是 30 度、“2 公里”）。
    expect(attr(page.q('.stage-north g'), 'transform')).toBe('rotate(12.0)');
    expect(page.q('.stage-scale-label')?.textContent).toBe('5 公里');
    expect(page.q('.stage-scale-bar')?.style.width).toBe('80px');
    // 图片只是先垫着：什么话都不说。
    expect(page.q('.stage-says')?.childNodes).toHaveLength(0);
    expect(page.q('.stage-foot')?.className).toBe('stage-foot');
    expect(attr(page.q('.stage-says'), 'role')).toBe('status');
    // 三个按钮都在；“回到这一节”点不了。
    expect(page.controls()).toEqual(['古名', '今名', SAYS.reset, '收起沙盘']);
    expect(attr(page.q('.stage-reset'), 'aria-disabled')).toBe('true');
    expect(page.pane().className).toBe('stage-pane is-pinned is-wide is-kai');

    // 今名：图片上的题签换了字；正在摆的沙盘也知道了。
    await act(async () => page.all('.names-switch button')[1].click());
    expect(attr(page.fakeStill(), 'data-fake-still-names')).toBe('modern');
    expect(page.stillStrips()).toEqual(['样市', '样水']);
    expect(attr(page.fakeTable(), 'data-fake-names')).toBe('modern');
    // 读到第二节：图片跟过去，题记跟着图片换。
    await page.read(SECOND);
    await page.until(() => attr(page.fakeStill(), 'data-fake-still-section') === SECOND && page.caption() === SECOND);
    expect(page.shows()).toBe(SECOND);
    expect(page.stillStrips()).toEqual(['样市', '远镇']);

    await page.settled('ready', 'table');
    expect(page.shows()).toBe(SECOND);
    expect(attr(page.fakeTable(), 'data-fake-section')).toBe(SECOND);
    // 从头到尾没说过“沙盘正在摆出来”。
    expect(writes.some((w) => w.name === 'class' && w.value === 'stage-loading')).toBe(false);
    await page.unmount();
  });

  it('状态 1：等了一秒半图片和沙盘都还没有，才说“沙盘正在摆出来”；图片一出来这句话就收掉', { timeout: 30_000 }, async () => {
    // 钟点在打开页面之前记：那一秒半是从页面一打开数起的。打开以后才记的话，机器一慢（打开用了一百多毫秒），下面“至少过了 1400 毫秒”就会差一点而不过。
    const started = Date.now();
    const page = await mount('?stage=fake&sectionstills=fake&stillgap=2100&readygap=3200');
    await settle(900);
    expect(page.state()).toBe('loading');
    expect(page.picture()).toBe('none');
    expect(page.q('.stage-loading')).toBeNull();
    await page.until(() => page.q('.stage-loading') !== null);
    expect(Date.now() - started).toBeGreaterThanOrEqual(1400);
    expect(page.q('.stage-says .stage-loading')?.textContent).toBe(SAYS.loading);
    expect(page.picture()).toBe('none');
    // 图片出来了：还在摆，但是不说了。
    await page.settled('loading', 'still');
    expect(page.q('.stage-loading')).toBeNull();
    await page.settled('ready', 'table');
    expect(page.q('.stage-loading')).toBeNull();
    await page.unmount();
  });

  it('状态 2：沙盘摆好了，盖着图片显出来；这中间图片上的题签藏着；显完图片就拿走；从头到尾只有一座沙盘', { timeout: 30_000 }, async () => {
    const page = await mount('?stage=fake&sectionstills=fake&readygap=300');
    await page.settled('loading', 'still');
    expect(everHandedOver()).toBe(false);
    let tables = 0;
    let readyAt = 0;
    await page.until(() => {
      tables = Math.max(tables, page.all('.fake-stage').length);
      if (page.state() === 'ready' && readyAt === 0) readyAt = Date.now();
      return page.state() === 'ready';
    });
    // 摆好的这一刻：沙盘显出来了（盖在图片上），放画面的那一块挂着“正在换”的类（样式表靠它把图片上的题签藏起来）；
    // 图片还在下面，所以“放着的是什么”还算图片。
    expect(page.q('.stage-canvas')?.className).toBe('stage-canvas is-handing-over');
    expect(page.q('.stage-host')?.className).toBe('stage-host is-up');
    expect(page.picture()).toBe('still');
    expect(page.fakeStill()).not.toBeNull();
    expect(page.fakeTable()).not.toBeNull();
    expect(page.shows()).toBe(FIRST);
    // 题记、指北和比例尺已经跟着上面的沙盘了。
    expect(attr(page.q('.stage-north g'), 'transform')).toBe('rotate(30.0)');
    expect(page.q('.stage-scale-label')?.textContent).toBe('2 公里');

    await page.until(() => {
      tables = Math.max(tables, page.all('.fake-stage').length);
      return page.picture() === 'table';
    });
    // 显完了（240 毫秒）：图片那一层拿走了，类也摘了。
    expect(Date.now() - readyAt).toBeGreaterThanOrEqual(200);
    expect(page.q('.stage-canvas')?.className).toBe('stage-canvas');
    expect(page.fakeStill()).toBeNull();
    expect(page.q('.stage-still-host')?.childNodes).toHaveLength(0);
    expect(page.all('.strips')).toHaveLength(1);
    expect(page.all('.stage-host .strip').map((el) => el.textContent)).toEqual(['样城', '样水']);
    expect(page.q('.stage-says')?.childNodes).toHaveLength(0);
    expect(tables).toBe(1);
    expect(written('data-stage-picture').filter((v, i, list) => v !== list[i - 1])).toEqual(['none', 'still', 'table']);
    // 这以后读到第二节，只有沙盘去（图片那一层已经没了）。
    await page.read(SECOND);
    await page.until(() => page.shows() === SECOND);
    expect(attr(page.fakeTable(), 'data-fake-requests')).toBe(SECOND);
    await page.unmount();
    expect(page.container.childNodes).toHaveLength(0);
  });

  it('状态 2：系统设置了“减少动态效果”时不慢慢显，摆好就直接换', { timeout: 30_000 }, async () => {
    const page = await mount('?stage=fake&sectionstills=fake&readygap=300', { reducedMotion: true });
    await page.settled('loading', 'still');
    await page.settled('ready', 'table');
    expect(everHandedOver()).toBe(false);
    expect(page.fakeStill()).toBeNull();
    expect(attr(page.fakeTable(), 'data-fake-reduced-motion')).toBe('true');
    expect(written('data-stage-picture').filter((v, i, list) => v !== list[i - 1])).toEqual(['none', 'still', 'table']);
    await page.unmount();
  });

  it('状态 2b：沙盘比图片先好，图片就一次也不显出来', { timeout: 30_000 }, async () => {
    const page = await mount('?stage=fake&sectionstills=fake&stillgap=900');
    await page.settled('ready', 'table');
    expect(everHandedOver()).toBe(false);
    expect(page.fakeStill()).toBeNull();
    // 过了图片本来该出来的时候，它也没有出来。
    await settle(1100);
    expect(written('data-fake-still-shown')).not.toContain('true');
    expect(written('data-stage-picture')).not.toContain('still');
    expect(page.fakeStill()).toBeNull();
    expect(page.picture()).toBe('table');
    await page.unmount();
  });
});

describe('立体的沙盘摆不了，放的是图片（状态 3 到 6）', () => {
  it('状态 3：浏览器画不了。一行话，没有按钮；图片跟着读到的小节换，题记跟着图片；那一行话在 role=status 里', { timeout: 30_000 }, async () => {
    const page = await mount('?stage=fake-unsupported&sectionstills=fake');
    await page.settled('unsupported', 'still');
    expect(page.notice()).toBe(SAYS.unsupported);
    expect(attr(page.q('.stage-notice')?.parentNode as MiniElement, 'role')).toBe('status');
    expect(page.q('.stage-message')).toBeNull();
    expect(page.q('.stage-retry')).toBeNull();
    expect(page.q('.stage-notice-button')).toBeNull();
    // “回到这一节”没有用处，不摆；别的两个照旧。
    expect(page.controls()).toEqual(['古名', '今名', '收起沙盘']);
    expect(page.pane().className).toBe('stage-pane is-pinned is-wide is-kai');
    expect(page.fakeTable()).toBeNull();
    expect(page.pane().textContent.toLowerCase()).not.toContain('webgl');
    expect(warned('画不出立体的沙盘', 'no-webgl2')).toBe(true);
    // 没碰过这一栏：不抢焦点。
    expect(doc.activeElement).toBeNull();
    // 上面留的空连那一行话一起算（8 + 44 + 30）。题记那一条上挂着记号：展开的说明照它再矮一行，不盖住那一行话。
    expect(attr(page.fakeStill(), 'data-fake-still-insets')).toBe('82 0 100 0');
    expect(page.q('.stage-foot')?.className).toBe('stage-foot under-notice');
    expect(page.shows()).toBe(FIRST);
    expect(page.caption()).toBe(FIRST);
    // 指北有角度，比例尺有字。
    expect(attr(page.q('.stage-caption-head .stage-north g'), 'transform')).toBe('rotate(12.0)');
    expect(page.q('.stage-caption-head .stage-scale-label')?.textContent).toBe('5 公里');

    await page.read(SECOND);
    await page.until(() => page.shows() === SECOND);
    expect(attr(page.fakeStill(), 'data-fake-still-section')).toBe(SECOND);
    expect(attr(page.fakeStill(), 'data-fake-still-requests')).toBe(SECOND);
    expect(page.caption()).toBe(SECOND);
    expect(page.stillStrips()).toEqual(['样城', '远镇']);
    await act(async () => page.all('.names-switch button')[1].click());
    expect(page.stillStrips()).toEqual(['样市', '远镇']);
    // “说明”照样能展开。
    await page.click('.stage-note-button');
    expect(page.all('.stage-note-panel .stage-note-lines p')).toHaveLength(2);
    // 收起（假的页面算窄屏）：读到别的小节不叫图片白换；展开时直接换过去。
    await page.click('.stage-fold');
    expect(page.pane().className).toBe('stage-pane is-pinned is-folded is-wide is-kai');
    await page.read(FIRST);
    await settle(100);
    expect(attr(page.fakeStill(), 'data-fake-still-requests')).toBe(SECOND);
    await page.click('.stage-fold');
    await page.until(() => page.shows() === FIRST);
    expect(attr(page.fakeStill(), 'data-fake-still-requests')).toBe(`${SECOND}|${FIRST}`);
    await page.unmount();
    expect(page.container.childNodes).toHaveLength(0);
  });

  it('状态 3：不带 ?stage（走真的那条路）而浏览器画不了：页面先问一句就知道，沙盘程序没有去取', { timeout: 30_000 }, async () => {
    const before = engineLoads.count;
    const page = await mount('?sectionstills=fake');
    await page.settled('unsupported', 'still');
    expect(page.notice()).toBe(SAYS.unsupported);
    expect(page.q('.stage-retry')).toBeNull();
    await settle(100);
    expect(engineLoads.count).toBe(before);
    expect(engineLoads.count).toBe(0);
    await page.unmount();
  });

  it('状态 4、4a：太慢。一行话，“试试立体的沙盘”在那排按钮中间；点了照减配的一档摆，说明是读者要的；“换回图片”、慢得没法用都回到图片', { timeout: 60_000 }, async () => {
    // 这一次访问的头两座替身都还没摆好就说太慢：完整的一档、减配的一档各试过一次，沙盘程序就说 too-slow。
    const page = await mount('?stage=fake&slow=start2&sectionstills=fake');
    await page.settled('slow', 'still');
    expect(written('data-fake-tier')).toEqual(['full', 'reduced']);
    expect(page.fakeTable()).toBeNull();
    expect(page.notice()).toBe(SAYS.slow);
    expect(page.q('.stage-message')).toBeNull();
    expect(page.controls()).toEqual(['古名', '今名', SAYS.tryTable, '收起沙盘']);
    expect(page.q('.stage-controls .stage-retry')?.textContent).toBe(SAYS.tryTable);
    expect(page.q('.stage-notice-button')).toBeNull();
    expect(page.pane().className).toBe('stage-pane is-pinned is-wide is-kai');
    // 降了一档、再降到只放图片：两句都只是记一笔，控制台里没有警告
    expect(told('降一档')).toBe(true);
    expect(told('这一次访问只放图片')).toBe(true);
    expect(warned('太慢')).toBe(false);
    expect(page.shows()).toBe(FIRST);
    // 图片从头到尾是同一层，没有跟着沙盘重摆。
    const still = page.fakeStill();
    expect(written('data-fake-still-shown').filter((v) => v === 'true')).toHaveLength(1);

    // ---- 4a：试试立体的沙盘。按的那个按钮没了，焦点落在这一栏上。
    page.q('.stage-retry')!.focus();
    await page.click('.stage-retry');
    expect(doc.activeElement).toBe(page.pane());
    // 从按下起那一行话就换了，句尾是“换回图片”；中间的按钮换回“回到这一节”。上面留的空没变，图片没动。
    expect(page.state()).toBe('loading');
    expect(page.notice()).toBe(SAYS.asked);
    expect(page.q('.stage-says .stage-notice .stage-notice-button')?.textContent).toBe(SAYS.back);
    expect(page.controls()).toEqual(['古名', '今名', SAYS.reset, '收起沙盘']);
    // “换回图片”在页面里排在那一排按钮后面（屏幕上它就在那一排的下面一行）：用键盘一个一个走，先后和看到的上下一致。
    const inOrder = page.all('button').map((el) => el.textContent);
    expect(inOrder.indexOf(SAYS.back)).toBeGreaterThan(inOrder.indexOf('收起沙盘'));
    expect(inOrder.filter((text) => text === SAYS.back)).toHaveLength(1);
    expect(page.fakeStill()).toBe(still);
    await page.settled('ready', 'table');
    expect(attr(page.fakeTable(), 'data-fake-tier')).toBe('reduced');
    expect(attr(page.fakeTable(), 'data-fake-asked')).toBe('true');
    expect(attr(page.fakeTable(), 'data-fake-forced')).toBe('false');
    expect(attr(page.fakeTable(), 'data-fake-insets')).toBe('82 0 100 0');
    expect(page.notice()).toBe(SAYS.asked);
    expect(page.all('.fake-stage')).toHaveLength(1);
    expect(page.fakeStill()).toBeNull();

    // ---- 换回图片：沙盘关掉，回到状态 4；按的那个按钮没了，焦点落到“试试立体的沙盘”上。
    page.q('.stage-notice-button')!.focus();
    await page.click('.stage-notice-button');
    await page.settled('slow', 'still');
    expect(page.fakeTable()).toBeNull();
    expect(page.notice()).toBe(SAYS.slow);
    expect(page.q('.stage-notice-button')).toBeNull();
    expect(doc.activeElement).toBe(page.q('.stage-retry'));
    expect(page.q('.stage-retry')?.textContent).toBe(SAYS.tryTable);

    // ---- 再试一次立体的；这一回它慢得没法用（替身上按“说太慢”）：也回到状态 4。
    await page.click('.stage-retry');
    await page.settled('ready', 'table');
    expect(attr(page.fakeTable(), 'data-fake-asked')).toBe('true');
    page.q('.stage-reset')!.focus();
    await page.click('.fake-stage-slow');
    await page.settled('slow', 'still');
    expect(page.fakeTable()).toBeNull();
    expect(page.notice()).toBe(SAYS.slow);
    expect(told('慢得没法用')).toBe(true);
    expect(warned('慢得没法用')).toBe(false);
    // “回到这一节”换成了“试试立体的沙盘”，焦点跟过去。
    expect(doc.activeElement).toBe(page.q('.stage-retry'));
    await page.unmount();
  });

  it('状态 4b：太慢，这座沙盘又没有图片。一句话带一个按钮，栏不钉着；点了照样摆读者要的那一座', { timeout: 30_000 }, async () => {
    const page = await mount('?stage=fake&slow=start2');
    await page.settled('slow', 'none');
    expect(page.q('.stage-says .stage-message p')?.textContent).toBe(SAYS.slowAlone);
    expect(page.q('.stage-message .stage-retry')?.textContent).toBe(SAYS.tryTable);
    expect(page.q('.stage-notice')).toBeNull();
    expect(page.q('.stage-controls')).toBeNull();
    expect(page.q('.stage-host')).toBeNull();
    expect(page.pane().className).toBe('stage-pane is-wide is-kai');
    expect(page.caption()).toBe(FIRST);
    await page.read(SECOND);
    expect(page.caption()).toBe(SECOND);

    page.q('.stage-retry')!.focus();
    await page.click('.stage-retry');
    expect(doc.activeElement).toBe(page.pane());
    await page.settled('ready', 'table');
    expect(attr(page.fakeTable(), 'data-fake-tier')).toBe('reduced');
    expect(attr(page.fakeTable(), 'data-fake-asked')).toBe('true');
    expect(attr(page.fakeTable(), 'data-fake-section')).toBe(SECOND);
    // 没有图片可换，也就不说“可以换回图片”。
    expect(page.q('.stage-notice')).toBeNull();
    expect(attr(page.fakeTable(), 'data-fake-insets')).toBe('52 0 100 0');
    // 慢得没法用：回到那一句话。
    await page.click('.fake-stage-slow');
    await page.settled('slow', 'none');
    expect(page.q('.stage-message p')?.textContent).toBe(SAYS.slowAlone);
    await page.unmount();
  });

  it('状态 4c：地址里写了 ?tier=still。一上来就是图片，沙盘一次也不摆；那句话在哪台设备上都是真话；别的 tier 原样交给沙盘', { timeout: 30_000 }, async () => {
    const page = await mount('?stage=fake&tier=still&sectionstills=fake');
    expect(page.state()).toBe('slow');
    await page.settled('slow', 'still');
    expect(new Set(written('data-stage-state'))).toEqual(new Set(['slow']));
    expect(written('data-fake-tier')).toEqual([]);
    expect(page.notice()).toBe(SAYS.only);
    expect(page.controls()).toEqual(['古名', '今名', SAYS.tryTable, '收起沙盘']);
    await page.click('.stage-retry');
    await page.settled('ready', 'table');
    expect(attr(page.fakeTable(), 'data-fake-tier')).toBe('reduced');
    expect(attr(page.fakeTable(), 'data-fake-asked')).toBe('true');
    await page.click('.stage-notice-button');
    await page.settled('slow', 'still');
    expect(page.notice()).toBe(SAYS.only);
    await page.unmount();

    // ?tier=reduced、?tier=full：照这一档摆，是“指定”的（不嫌慢）；“说太慢”的按钮按了也没有用。
    for (const tier of ['reduced', 'full']) {
      const forced = await mount(`?stage=fake&tier=${tier}&slow=start`);
      await forced.settled('ready', 'table');
      expect(attr(forced.fakeTable(), 'data-fake-tier')).toBe(tier);
      expect(attr(forced.fakeTable(), 'data-fake-forced')).toBe('true');
      expect(attr(forced.fakeTable(), 'data-fake-asked')).toBe('false');
      await forced.click('.fake-stage-slow');
      await settle(60);
      expect(forced.state()).toBe('ready');
      expect(attr(forced.fakeTable(), 'data-fake-slow')).toBe('false');
      await forced.unmount();
    }
  });

  it('状态 5：画面断了。图片顶上来，一行话，“重新摆出来”在那排按钮中间；点了以后图片垫着重摆（状态 1），再换回沙盘', { timeout: 30_000 }, async () => {
    const page = await mount('?stage=fake&sectionstills=fake');
    await page.settled('ready', 'table');
    const namesSwitch = page.q('.names-switch');
    const caption = page.q('.stage-caption');
    await page.read(SECOND);
    await page.until(() => page.shows() === SECOND);

    // 断的时候焦点在“回到这一节”上：它换成了“重新摆出来”，焦点跟过去。
    page.q('.stage-reset')!.focus();
    await page.click('.fake-stage-lose');
    expect(page.state()).toBe('lost');
    expect(page.fakeTable()).toBeNull();
    expect(page.all('.stage-host .strip')).toHaveLength(0);
    expect(page.notice()).toBe(SAYS.lost);
    expect(page.q('.stage-message')).toBeNull();
    expect(page.controls()).toEqual(['古名', '今名', SAYS.rebuild, '收起沙盘']);
    expect(doc.activeElement).toBe(page.q('.stage-controls .stage-retry'));
    // 这一栏、古名今名、题记都是原来的那几个元素，没有整个重来。
    expect(page.pane().className).toBe('stage-pane is-pinned is-wide is-kai');
    expect(page.q('.names-switch')).toBe(namesSwitch);
    expect(page.q('.stage-caption')).toBe(caption);
    expect(warned('画面断了')).toBe(true);
    // 图片出来以前，题记跟着读到的小节；出来以后放的是读到的那一节。
    expect(page.caption()).toBe(SECOND);
    await page.settled('lost', 'still');
    expect(attr(page.fakeStill(), 'data-fake-still-section')).toBe(SECOND);
    expect(page.shows()).toBe(SECOND);

    // 重新摆出来：按的那个按钮没了，焦点落在这一栏上；图片垫着，那一行话收掉；摆好了再换回沙盘。
    const still = page.fakeStill();
    await page.click('.stage-retry');
    expect(doc.activeElement).toBe(page.pane());
    expect(page.state()).toBe('loading');
    expect(page.picture()).toBe('still');
    expect(page.fakeStill()).toBe(still);
    expect(page.q('.stage-says')?.childNodes).toHaveLength(0);
    expect(page.controls()).toEqual(['古名', '今名', SAYS.reset, '收起沙盘']);
    await page.settled('ready', 'table');
    expect(attr(page.fakeTable(), 'data-fake-section')).toBe(SECOND);
    expect(attr(page.fakeTable(), 'data-fake-animated')).toBe('false');
    expect(page.all('.fake-stage')).toHaveLength(1);
    expect(page.fakeStill()).toBeNull();

    // 断的时候焦点在“今名”上：这个按钮还在，焦点不动。
    const modern = page.all('.names-switch button')[1];
    modern.focus();
    await page.click('.fake-stage-lose');
    expect(page.state()).toBe('lost');
    expect(doc.activeElement).toBe(modern);
    await page.unmount();
  });

  it('状态 6：没摆出来。图片照放，一行话，“再试一次”在那排按钮中间；再试还是不成，图片一直是那一层', { timeout: 30_000 }, async () => {
    const page = await mount('?stage=fake-fail&sectionstills=fake');
    await page.settled('failed', 'still');
    expect(page.notice()).toBe(SAYS.failed);
    expect(page.q('.stage-message')).toBeNull();
    expect(page.controls()).toEqual(['古名', '今名', SAYS.retry, '收起沙盘']);
    expect(page.pane().className).toBe('stage-pane is-pinned is-wide is-kai');
    // 一打开就没起来，读者没碰过这一栏：不抢焦点。
    expect(doc.activeElement).toBeNull();
    const told = () => warn.mock.calls.filter((call: unknown[]) => String(call[0]).includes('没能摆出来') && String(call[1]).includes('按要求起不来')).length;
    expect(told()).toBe(1);
    await page.read(SECOND);
    await page.until(() => page.shows() === SECOND);
    expect(page.caption()).toBe(SECOND);

    const still = page.fakeStill();
    page.q('.stage-retry')!.focus();
    await page.click('.stage-retry');
    await page.until(() => told() === 2 && page.state() === 'failed');
    expect(page.picture()).toBe('still');
    expect(page.fakeStill()).toBe(still);
    expect(page.notice()).toBe(SAYS.failed);
    // 新的一座还是没起来：焦点落在新的“再试一次”上，没有掉到页面外头。
    expect(doc.activeElement).toBe(page.q('.stage-retry'));
    expect(written('data-fake-still-shown').filter((v) => v === 'true')).toHaveLength(1);
    await page.unmount();
  });
});

describe('图片取不到（状态 9）', () => {
  it('头一张就取不到：这一次当这座沙盘没有图片，照没有图片的样子办；那句话不提图片', { timeout: 30_000 }, async () => {
    const page = await mount('?stage=fake-unsupported&sectionstills=fake-fail');
    await page.until(() => page.state() === 'unsupported' && page.q('.stage-message') !== null);
    expect(page.picture()).toBe('none');
    expect(page.q('.stage-message p')?.textContent).toBe(STAGE_TEXT.unsupported);
    expect(page.pane().textContent).not.toContain('图片');
    expect(page.q('.stage-notice')).toBeNull();
    expect(page.q('.stage-controls')).toBeNull();
    expect(page.q('.stage-canvas')).toBeNull();
    expect(page.pane().className).toBe('stage-pane is-wide is-kai');
    expect(warned('图片取不到')).toBe(true);
    await page.unmount();

    // 立体的沙盘摆得出来时：图片取不到不碍事，和没有图片一样。
    const fine = await mount('?stage=fake&sectionstills=fake-fail&readygap=200');
    await fine.settled('ready', 'table');
    expect(written('data-stage-picture')).not.toContain('still');
    expect(everHandedOver()).toBe(false);
    expect(fine.q('.stage-still-host')?.childNodes).toHaveLength(0);
    // 这以后画面断了：是没有图片时的那一句话。
    await fine.click('.fake-stage-lose');
    expect(fine.state()).toBe('lost');
    expect(fine.q('.stage-message p')?.textContent).toBe('沙盘的画面断了。');
    expect(fine.q('.stage-controls')).toBeNull();
    await fine.unmount();
  });

  it('后来换到的一张取不到：图片不放了，换成没有图片时的那句话和它的按钮，题记跟着读到的小节；读到另一小节再放一次，取得到图片就回来', { timeout: 30_000 }, async () => {
    const page = await mount('?stage=fake-fail&sectionstills=fake&stillfail=2');
    await page.settled('failed', 'still');
    expect(page.notice()).toBe(SAYS.failed);
    page.all('.names-switch button')[0].focus();
    await page.read(SECOND);
    await page.until(() => page.q('.stage-message') !== null);
    expect(page.state()).toBe('failed');
    expect(page.picture()).toBe('none');
    expect(page.shows()).toBeNull();
    expect(page.q('.stage-message p')?.textContent).toBe(SAYS.failedAlone);
    expect(page.q('.stage-message .stage-retry')?.textContent).toBe(SAYS.retry);
    expect(page.q('.stage-notice')).toBeNull();
    expect(page.fakeStill()).toBeNull();
    expect(page.all('.strip')).toHaveLength(0);
    expect(page.q('.stage-controls')).toBeNull();
    expect(page.pane().className).toBe('stage-pane is-wide is-kai');
    expect(page.caption()).toBe(SECOND);
    expect(warned('图片取不到')).toBe(true);
    // 焦点原来在“古名”上，它没了：落到那句话的按钮上。
    expect(doc.activeElement).toBe(page.q('.stage-retry'));
    // 一张取不到，不是从此一张也不放：再读回第一节（它的图片取得到），再放一次，图片回来了，按钮下面还是那一行话
    await page.read(FIRST);
    await page.settled('failed', 'still');
    expect(page.fakeStill()).not.toBeNull();
    expect(page.shows()).toBe(FIRST);
    expect(page.caption()).toBe(FIRST);
    expect(page.notice()).toBe(SAYS.failed);
    expect(page.q('.stage-message')).toBeNull();
    expect(page.q('.stage-controls')).not.toBeNull();
    // 又读到取不到的那一节：照旧收起来，等下一回
    await page.read(SECOND);
    await page.until(() => page.q('.stage-message') !== null);
    expect(page.picture()).toBe('none');
    expect(page.fakeStill()).toBeNull();
    // 浏览器明说断着网的时候不试（试了也是白试，栏还要白白变一回样子）；说网又通了，不用等读到另一小节就再放一次。
    // 这时候读到的还是取不到的那一节，所以先读回第一节再断网，看的是“断着网不试，通了才试”
    const nav = win.navigator;
    win.navigator = { onLine: false };
    await page.read(FIRST);
    await settle(100);
    expect(page.fakeStill(), '断着网还去取图片了').toBeNull();
    expect(page.q('.stage-message')).not.toBeNull();
    win.navigator = { onLine: true };
    await act(async () => win.fire('online'));
    await page.settled('failed', 'still');
    expect(page.shows()).toBe(FIRST);
    win.navigator = nav;
    await page.unmount();
  });
});

describe('读着读着嫌慢，降一档（状态 10）', () => {
  it('摆好以后嫌慢：这一座先留在原处，图片出来了才关掉，再摆低一档的；低一档还嫌慢，换成图片（状态 4）', { timeout: 60_000 }, async () => {
    const page = await mount('?stage=fake&sectionstills=fake&stillgap=300');
    await page.settled('ready', 'table');
    expect(attr(page.fakeTable(), 'data-fake-tier')).toBe('full');
    expect(attr(page.fakeTable(), 'data-fake-forced')).toBe('false');
    await page.read(SECOND);
    await page.until(() => page.shows() === SECOND);

    await page.click('.fake-stage-slow');
    // 这一刻：算“正在摆”，嫌慢的那一座还在画面上（它不再画了），“回到这一节”点不了；什么话都不说。
    expect(page.state()).toBe('loading');
    expect(page.picture()).toBe('table');
    expect(attr(page.fakeTable(), 'data-fake-slow')).toBe('true');
    expect(attr(page.q('.stage-reset'), 'aria-disabled')).toBe('true');
    expect(page.q('.stage-says')?.childNodes).toHaveLength(0);
    expect(page.shows()).toBe(SECOND);
    // 一路看着：嫌慢的那一座没了的时候，图片已经出来了；页面上从来没有两座沙盘。
    let goneBeforeStill = false;
    let tables = 0;
    await page.until(() => {
      tables = Math.max(tables, page.all('.fake-stage').length);
      const slowOne = page.q('.fake-stage[data-fake-slow="true"]');
      if (!slowOne && attr(page.fakeStill(), 'data-fake-still-shown') !== 'true' && page.state() !== 'ready') goneBeforeStill = true;
      return slowOne === null;
    });
    expect(goneBeforeStill).toBe(false);
    expect(told('降一档')).toBe(true);
    expect(warned('降一档')).toBe(false);
    await page.until(() => {
      tables = Math.max(tables, page.all('.fake-stage').length);
      return page.state() === 'ready' && page.picture() === 'table';
    });
    expect(tables).toBe(1);
    expect(attr(page.fakeTable(), 'data-fake-tier')).toBe('reduced');
    expect(attr(page.fakeTable(), 'data-fake-forced')).toBe('false');
    expect(attr(page.fakeTable(), 'data-fake-asked')).toBe('false');
    expect(attr(page.fakeTable(), 'data-fake-section')).toBe(SECOND);
    expect(page.fakeStill()).toBeNull();
    expect(written('data-stage-state')).not.toContain('slow');

    // 减配的一档也嫌慢：图片顶上来，沙盘程序说带不动，换成图片。
    await page.click('.fake-stage-slow');
    await page.settled('slow', 'still');
    expect(page.fakeTable()).toBeNull();
    expect(page.notice()).toBe(SAYS.slow);
    expect(page.controls()).toEqual(['古名', '今名', SAYS.tryTable, '收起沙盘']);
    expect(written('data-fake-tier')).toEqual(['full', 'reduced']);
    await page.unmount();
  });

  it('图片迟迟不来：嫌慢的那一座最多留一秒半，就关掉重摆', { timeout: 30_000 }, async () => {
    const page = await mount('?stage=fake&sectionstills=fake&stillgap=5000');
    await page.settled('ready', 'table');
    const clicked = Date.now();
    await page.click('.fake-stage-slow');
    expect(page.picture()).toBe('table');
    await settle(900);
    expect(attr(page.fakeTable(), 'data-fake-slow')).toBe('true');
    await page.until(() => page.q('.fake-stage[data-fake-slow="true"]') === null);
    expect(Date.now() - clicked).toBeGreaterThanOrEqual(1400);
    expect(written('data-fake-still-shown')).not.toContain('true');
    await page.settled('ready', 'table');
    expect(attr(page.fakeTable(), 'data-fake-tier')).toBe('reduced');
    await page.unmount();
  });

  it('还没摆好就嫌慢（?slow=start）：图片垫着，接着摆低一档的；没有图片时也一样降一档', { timeout: 30_000 }, async () => {
    const page = await mount('?stage=fake&slow=start&sectionstills=fake');
    await page.settled('ready', 'table');
    expect(written('data-fake-tier')).toEqual(['full', 'reduced']);
    expect(attr(page.fakeTable(), 'data-fake-tier')).toBe('reduced');
    expect(page.all('.fake-stage')).toHaveLength(1);
    expect(written('data-stage-state')).not.toContain('slow');
    // 嫌慢的那一座一次也没显出来过：放着的先是图片，后来是低一档的沙盘。
    expect(written('data-stage-picture').filter((v, i, list) => v !== list[i - 1])).toEqual(['none', 'still', 'table']);
    await page.unmount();

    const plain = await mount('?stage=fake&slow=start');
    await plain.settled('ready', 'table');
    expect(written('data-fake-tier')).toEqual(['full', 'reduced']);
    expect(plain.all('.fake-stage')).toHaveLength(1);
    expect(plain.q('.stage-says')?.childNodes).toHaveLength(0);
    await plain.unmount();
  });
});

describe('题记跟着画面，不跟着读到哪', () => {
  it('图片来得慢：读到第二节以后，图片还是第一节的那一阵，题记也还是第一节的；图片换了才换', { timeout: 30_000 }, async () => {
    const page = await mount('?stage=fake-unsupported&sectionstills=fake&stillgap=400');
    await page.settled('unsupported', 'still');
    const seen: { pane: string | null; caption: string | null; still: string | null }[] = [];
    const watch = () => seen.push({ pane: page.shows(), caption: page.caption(), still: attr(page.fakeStill(), 'data-fake-still-section') });
    await page.read(SECOND);
    watch();
    expect(attr(page.fakeStill(), 'data-fake-still-requests')).toBe(SECOND);
    expect(page.shows()).toBe(FIRST);
    expect(page.caption()).toBe(FIRST);
    await page.until(() => {
      watch();
      return page.shows() === SECOND;
    });
    expect(page.caption()).toBe(SECOND);
    expect(attr(page.fakeStill(), 'data-fake-still-section')).toBe(SECOND);
    expect(seen.some((moment) => moment.pane === FIRST)).toBe(true);
    for (const moment of seen) {
      expect(moment.caption).toBe(moment.pane);
      // 页面说的小节从不抢在图片前头。
      if (moment.pane === SECOND) expect(moment.still).toBe(SECOND);
    }
    await page.unmount();
  });
});

describe('别的小事', () => {
  it('?debug=1：沙盘摆好以后栏里印一行读数；不带就没有', { timeout: 30_000 }, async () => {
    const page = await mount('?stage=fake&debug=1');
    await page.settled('ready', 'table');
    await page.until(() => (page.q('.stage-foot .stage-debug')?.textContent ?? '') !== '');
    // 替身不给画质的读数，所以只有最后一段。
    expect(page.q('.stage-debug')?.textContent).toMatch(/^摆好用了 \d+\.\d 秒$/);
    await page.unmount();

    const plain = await mount('?stage=fake');
    await plain.settled('ready', 'table');
    expect(plain.q('.stage-debug')).toBeNull();
    await plain.unmount();
  });

  it('那一行读数怎么写：就是设计里的那一句；还没量到的数说“还没”', () => {
    const perf = { tier: 'full' as const, pixelRatio: 2, buffer: { width: 1880, height: 1800 }, frames: 40, trialMs: 23.4, glideMs: 16.6 };
    expect(stageDebugLine(perf, 3.14)).toBe('画质：完整；像素比 2；试画 23 毫秒；移动时每帧 17 毫秒；摆好用了 3.1 秒');
    expect(stageDebugLine({ ...perf, tier: 'reduced', pixelRatio: 1.39, trialMs: null, glideMs: null }, 0.96)).toBe('画质：减配；像素比 1.39；还没试画；镜头还没移动过；摆好用了 1.0 秒');
    expect(stageDebugLine(undefined, 0.04)).toBe('摆好用了 0.0 秒');
    expect(stageDebugLine(undefined, null)).toBe('');
  });

  it('按钮下面的那一行话，每一句都不超过 22 个字（一行放得下）', () => {
    for (const line of [STAGE_TEXT.stillUnsupported, STAGE_TEXT.stillSlow, STAGE_TEXT.stillOnly, STAGE_TEXT.stillLost, STAGE_TEXT.stillFailed]) {
      expect([...line].length, line).toBeLessThanOrEqual(22);
    }
    // “设备慢的话……”后面还跟着一个四个字的按钮。
    expect([...STAGE_TEXT.askedLine].length + [...STAGE_TEXT.backToStills].length).toBeLessThanOrEqual(18);
  });

  it('每一小节的图片由谁来放：用沙盘的替身时，不写 sectionstills 就当没有图片（沙盘自己带着图片也一样）', () => {
    const withStills: StopTable = { ...table, stills: { manifest: {} as StillManifest, urls: {} } };
    const choose = (search: string, which: StopTable) => {
      win.location.search = search;
      return pickStillEngine(which);
    };
    for (const search of ['?stage=fake', '?stage=fake-fail', '?stage=fake-unsupported']) {
      expect(choose(search, withStills), search).toBeNull();
      expect(choose(search, table), search).toBeNull();
      expect(choose(`${search}&sectionstills=fake`, table), search).not.toBeNull();
      expect(choose(`${search}&sectionstills=fake-fail`, table), search).not.toBeNull();
      expect(choose(`${search}&sectionstills=none`, withStills), search).toBeNull();
    }
    // 真的沙盘程序：沙盘带着图片才放；?sectionstills=none 当作没有；?sectionstills=fake 什么沙盘都放替身。
    expect(choose('', table)).toBeNull();
    expect(choose('', withStills)).not.toBeNull();
    expect(choose('?sectionstills=none', withStills)).toBeNull();
    expect(choose('?sectionstills=fake', table)).not.toBeNull();
    expect(choose('?tier=full', withStills)).not.toBeNull();
  });
});
