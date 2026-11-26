// 从全程沙盘到一站自己的沙盘，“这一下点的要不要潜”的规矩和潜的先后（src/ui/dive.ts）。
// 窗口、沙盘栏那一边都是这里给的假的；有没有自己的沙盘问的是真的内容（hasStopTable）。
// 运行：npx vitest run tests/unit/dive.test.ts

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { figureHref, homeHref, sourcesHref, stopHref } from '../../src/app/router';
import { hasStopTable, loadFigure, stopMarks } from '../../src/domain';
import { readBytes } from '../support/readBytes';
import { DIVE_GUARD_MS, DIVE_MS, cameByDive, diveStop, watchDives, type DiveClick, type DiveHost, type DivePane, type DiveWindow } from '../../src/ui/dive';

const FIGURE = 'su-shi';
const figure = await loadFigure(FIGURE);
if (!figure) throw new Error('没有这位人物');
/** 有自己的沙盘的一站，和没有的一站：从真的内容里找。 */
const OWN = figure.stops.find((s) => hasStopTable(figure, s.id))?.id ?? '';
const BARE = figure.stops.find((s) => !hasStopTable(figure, s.id))?.id ?? '';
/** 沙盘栏那一边答“这一站有没有自己的沙盘”：照真的内容（figure.json 里各站写的）。 */
const own = (stop: string): boolean => hasStopTable(figure, stop);

const READY: DivePane = { ready: true, tucked: false, calm: false, on: true };

/** 一个链接（或者不是链接的东西）上的一下点击。inner 是点在链接里面的字上。 */
function click(href: string | null, more: Partial<DiveClick> & { linkTarget?: string; inner?: boolean } = {}) {
  const link = { getAttribute: (name: string) => (name === 'href' ? href : name === 'target' ? (more.linkTarget ?? null) : null) };
  const closest = (selector: string) => (selector === 'a[href^="#"]' && href !== null && href.startsWith('#') ? link : null);
  const target = more.inner ? { closest } : { ...link, closest };
  const event = {
    defaultPrevented: false,
    button: 0,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    ...more,
    target: target as unknown as EventTarget,
    preventDefault() {
      event.defaultPrevented = true;
    },
  };
  return event;
}

describe('这一下要不要潜（diveStop）', () => {
  it('内容里真的有一站有自己的沙盘、有一站没有', () => {
    expect(OWN).not.toBe('');
    expect(BARE).not.toBe('');
    // 沙盘栏手里是各站的印（stopMarks），它照印上的 own 答：每一站的 own 和 hasStopTable 说的一样
    const marks = stopMarks(figure, (id) => stopHref(FIGURE, id));
    expect(figure.stops.map((stop) => [stop.id, marks[stop.id].own])).toEqual(figure.stops.map((stop) => [stop.id, hasStopTable(figure, stop.id)]));
  });

  it('平常的一点，点在通到有自己的沙盘的一站的链接上：潜，地址就是链接上写的', () => {
    const href = stopHref(FIGURE, OWN);
    expect(diveStop(click(href), FIGURE, READY, own)).toEqual({ stop: OWN, hash: href });
    // 点在链接里面的字上也一样（印、地名、“下一站”里的字）
    expect(diveStop(click(href, { inner: true }), FIGURE, READY, own)).toEqual({ stop: OWN, hash: href });
  });

  it('别的链接都不潜：没有自己的沙盘的一站、人物页、首页、来源、别的人物的一站、站外的链接、不是链接', () => {
    for (const href of [stopHref(FIGURE, BARE), figureHref(FIGURE), homeHref, sourcesHref, stopHref('someone-else', OWN), `https://example.org/${stopHref(FIGURE, OWN)}`, null]) {
      expect(diveStop(click(href), FIGURE, READY, own), String(href)).toBeNull();
    }
  });

  it('按着别的键、不是左键、已经有人拦下了、链接写了要在别处打开：不潜', () => {
    const href = stopHref(FIGURE, OWN);
    for (const more of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }, { button: 2 }, { defaultPrevented: true }, { linkTarget: '_blank' }]) {
      expect(diveStop(click(href, more), FIGURE, READY, own), JSON.stringify(more)).toBeNull();
    }
  });

  it('栏里的全程沙盘没摆好（或者放的是图片、是不会潜的沙盘）、收起来了、系统说要少动、开关关着：不潜', () => {
    const href = stopHref(FIGURE, OWN);
    for (const pane of [{ ready: false }, { tucked: true }, { calm: true }, { on: false }]) {
      expect(diveStop(click(href), FIGURE, { ...READY, ...pane }, own), JSON.stringify(pane)).toBeNull();
    }
  });
});

// ---------------------------------------------------------------- 先后

function rig(pane: DivePane = READY) {
  const listeners = new Map<string, Set<(event: any) => void>>();
  const win = {
    location: { hash: figureHref(FIGURE) },
    addEventListener: (type: string, listener: (event: any) => void) => void (listeners.get(type) ?? listeners.set(type, new Set()).get(type))!.add(listener),
    removeEventListener: (type: string, listener: (event: any) => void) => void listeners.get(type)?.delete(listener),
    setTimeout: (run: () => void, ms: number) => setTimeout(run, ms) as unknown as number,
    clearTimeout: (id: number) => clearTimeout(id),
  };
  const calls: string[] = [];
  /** 每一次叫沙盘潜，各留一个“潜完了”的把手。 */
  const dives: ((reached: boolean) => void)[] = [];
  let canDive = true;
  const host: DiveHost = {
    pane: () => pane,
    own,
    dive(stop, ms) {
      calls.push(`dive ${stop} ${ms}`);
      if (!canDive) return null;
      return new Promise<boolean>((resolve) => dives.push(resolve));
    },
    mark: (stop) => void calls.push(`mark ${stop}`),
    preload: (stop) => void calls.push(`preload ${stop}`),
    back: () => void calls.push('back'),
  };
  const watch = watchDives(FIGURE, host, win as unknown as DiveWindow);
  return {
    win,
    calls,
    dives,
    watch,
    noDive: () => (canDive = false),
    press(href: string | null, more?: Parameters<typeof click>[1]) {
      const event = click(href, more);
      listeners.get('click')?.forEach((listener) => listener(event));
      return event;
    },
    /** 地址自己变了（返回、前进，或者浏览器照一个链接走了）。 */
    hashChanged(hash: string) {
      win.location.hash = hash;
      listeners.get('hashchange')?.forEach((listener) => listener({}));
    },
    /** 读者离开了这个网站（这一页被浏览器收起来了）；地址没有变。 */
    pageHidden() {
      listeners.get('pagehide')?.forEach((listener) => listener({}));
    },
    listening: () => [...listeners.values()].reduce((sum, set) => sum + set.size, 0),
  };
}

/** 让完成了的 Promise 后面接的事做完。 */
const flush = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

describe('样式表里的那一条淡出', () => {
  it('等的工夫加上淡的工夫，正好是潜的钟点（DIVE_MS）：早了画面是空的，晚了换页时画面还没淡完', () => {
    const css = new TextDecoder().decode(readBytes('src/styles/stage.css'));
    const rule = /\.stage-pane\[data-stage-dive\] \.stage-canvas \{[^}]*transition: opacity (\d+)ms [a-z-]+ (\d+)ms;/.exec(css);
    expect(rule, '样式表里要有这一条').not.toBeNull();
    expect(Number(rule?.[1]) + Number(rule?.[2])).toBe(DIVE_MS);
  });
});

describe('潜的先后（watchDives）', () => {
  const HERE = figureHref(FIGURE);
  const THERE = stopHref(FIGURE, OWN);

  beforeEach(() => void vi.useFakeTimers());
  afterEach(() => void vi.useRealTimers());

  it('点下去：浏览器不换地址，沙盘潜，栏上写记号，那一站的东西开始取；潜完才换成链接上的地址，记号留着', async () => {
    const r = rig();
    const event = r.press(THERE);
    expect(event.defaultPrevented).toBe(true);
    expect(r.calls).toEqual([`dive ${OWN} ${DIVE_MS}`, `mark ${OWN}`, `preload ${OWN}`]);
    vi.advanceTimersByTime(DIVE_MS - 1);
    await flush();
    expect(r.win.location.hash).toBe(HERE);
    expect(cameByDive(`${FIGURE}/${OWN}`)).toBe(false);
    r.dives[0](true);
    await flush();
    expect(r.win.location.hash).toBe(THERE);
    expect(r.calls).not.toContain('mark null');
    // 那一站的沙盘栏问得到“是潜过来的”；别的沙盘问不到；过了三秒也问不到
    expect(cameByDive(`${FIGURE}/${OWN}`)).toBe(true);
    expect(cameByDive(`${FIGURE}/route`)).toBe(false);
    vi.advanceTimersByTime(3000);
    expect(cameByDive(`${FIGURE}/${OWN}`)).toBe(false);
  });

  it('沙盘一直不回话：到点了照样换地址；没到点不换', async () => {
    const r = rig();
    r.press(THERE);
    vi.advanceTimersByTime(DIVE_GUARD_MS - 1);
    expect(r.win.location.hash).toBe(HERE);
    vi.advanceTimersByTime(1);
    expect(r.win.location.hash).toBe(THERE);
    expect(DIVE_GUARD_MS).toBeGreaterThan(DIVE_MS);
    expect(DIVE_GUARD_MS).toBeLessThanOrEqual(1200);
  });

  it('沙盘半路停了（画面丢了、关掉了、被读者接过去）：马上放行', async () => {
    const r = rig();
    r.press(THERE);
    r.dives[0](false);
    await flush();
    expect(r.win.location.hash).toBe(THERE);
  });

  it('沙盘嫌慢了（hurry）：马上放行；没在潜的时候叫它，什么也不做', async () => {
    const r = rig();
    r.watch.hurry();
    expect(r.win.location.hash).toBe(HERE);
    r.press(THERE);
    r.watch.hurry();
    expect(r.win.location.hash).toBe(THERE);
  });

  it('正在潜，同一个链接再点一下：什么也不变，沙盘只潜一次', async () => {
    const r = rig();
    r.press(THERE);
    const again = r.press(THERE);
    expect(again.defaultPrevented).toBe(true);
    expect(r.calls.filter((c) => c.startsWith('dive'))).toHaveLength(1);
    expect(r.win.location.hash).toBe(HERE);
    r.dives[0](true);
    await flush();
    expect(r.win.location.hash).toBe(THERE);
  });

  it('正在潜，点了别的链接：不拦它，不潜了，沙盘回原来的小节；后来潜完、到点，都不再动地址', async () => {
    const r = rig();
    r.press(THERE);
    const other = r.press(stopHref(FIGURE, BARE));
    expect(other.defaultPrevented).toBe(false);
    expect(r.calls.slice(-2)).toEqual(['mark null', 'back']);
    r.hashChanged(stopHref(FIGURE, BARE));
    r.dives[0](true);
    await flush();
    vi.advanceTimersByTime(DIVE_GUARD_MS * 2);
    expect(r.win.location.hash).toBe(stopHref(FIGURE, BARE));
    expect(r.calls.filter((c) => c === 'back')).toHaveLength(1);
  });

  it('正在潜，按着别的键点（要在新标签页里打开）：不拦、不管，照旧潜——同一个链接也好，别的链接也好', async () => {
    const r = rig();
    r.press(THERE);
    const calls = r.calls.length;
    for (const more of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { button: 1 }]) {
      expect(r.press(THERE, more).defaultPrevented, JSON.stringify(more)).toBe(false);
      expect(r.press(stopHref(FIGURE, BARE), more).defaultPrevented, JSON.stringify(more)).toBe(false);
    }
    expect(r.calls).toHaveLength(calls);
    r.dives[0](true);
    await flush();
    expect(r.win.location.hash).toBe(THERE);
  });

  it('正在潜，点在不是链接的地方：照旧潜', async () => {
    const r = rig();
    r.press(THERE);
    r.press(null);
    expect(r.calls).not.toContain('mark null');
    r.dives[0](true);
    await flush();
    expect(r.win.location.hash).toBe(THERE);
  });

  it('正在潜，读者按了返回：马上听他的，不潜了，以后也不再动地址', async () => {
    const r = rig();
    r.press(THERE);
    r.hashChanged(homeHref);
    expect(r.calls.slice(-2)).toEqual(['mark null', 'back']);
    r.dives[0](true);
    await flush();
    vi.advanceTimersByTime(DIVE_GUARD_MS * 2);
    expect(r.win.location.hash).toBe(homeHref);
  });

  it('正在潜，读者离开了这个网站（地址没有变，这一页被浏览器收起来了）：不潜了；他再回来，潜完、到点都不再动地址', async () => {
    const r = rig();
    r.press(THERE);
    r.pageHidden();
    expect(r.calls.slice(-2)).toEqual(['mark null', 'back']);
    expect(vi.getTimerCount()).toBe(0);
    r.dives[0](true);
    await flush();
    vi.advanceTimersByTime(DIVE_GUARD_MS * 2);
    expect(r.win.location.hash).toBe(HERE);
    // 没在潜的时候离开：什么也不做
    const idle = rig();
    idle.pageHidden();
    expect(idle.calls).toEqual([]);
  });

  it('按了返回，而沙盘“被顶掉了”的回话抢在地址变了的通知前头到（页面换页的那一边先收到通知）：也不再动地址', async () => {
    const r = rig();
    r.press(THERE);
    // 地址已经变了，通知还没到这里
    r.win.location.hash = homeHref;
    r.dives[0](false);
    await flush();
    expect(r.win.location.hash).toBe(homeHref);
    expect(r.calls.slice(-2)).toEqual(['mark null', 'back']);
    r.hashChanged(homeHref);
    vi.advanceTimersByTime(DIVE_GUARD_MS * 2);
    expect(r.win.location.hash).toBe(homeHref);
    expect(r.calls.filter((c) => c === 'back')).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('不潜了以后再点同一个链接：从头潜一次；前一趟晚到的回话不算数', async () => {
    const r = rig();
    r.press(THERE);
    r.hashChanged(HERE);
    r.press(THERE);
    expect(r.calls.filter((c) => c.startsWith('dive'))).toHaveLength(2);
    // 前一趟的回话到了（沙盘被后一趟顶掉，答的是 false）：后一趟不能因此提前放行
    r.dives[0](false);
    await flush();
    expect(r.win.location.hash).toBe(HERE);
    r.dives[1](true);
    await flush();
    expect(r.win.location.hash).toBe(THERE);
  });

  it('还在潜，沙盘栏就被拿走了（end）：那一下点击已经拦下了，地址马上换成链接上的；监听和定时器都收掉，以后什么也不做', async () => {
    const r = rig();
    r.press(THERE);
    r.watch.end();
    expect(r.win.location.hash).toBe(THERE);
    expect(vi.getTimerCount()).toBe(0);
    expect(r.listening()).toBe(0);
    const calls = r.calls.length;
    r.dives[0](true);
    await flush();
    vi.advanceTimersByTime(DIVE_GUARD_MS * 2);
    expect(r.win.location.hash).toBe(THERE);
    expect(r.calls).toHaveLength(calls);
    expect(r.calls).not.toContain('mark null');
  });

  it('沙盘栏是因为页面换页才拿走的（地址已经不是点下去时的那一个）、或者没在潜：end 不动地址', async () => {
    const r = rig();
    r.press(THERE);
    // 页面换页的那一边先收到通知、先把栏拿走，这里的 hashchange 还没轮到
    r.win.location.hash = homeHref;
    r.watch.end();
    expect(r.win.location.hash).toBe(homeHref);
    expect(vi.getTimerCount()).toBe(0);
    const idle = rig();
    idle.watch.end();
    expect(idle.win.location.hash).toBe(HERE);
  });

  it('地址换过去了，栏居然还在：过一会儿把记号拿掉、沙盘回原来的小节；栏拿走了就不用', async () => {
    const stays = rig();
    stays.press(THERE);
    stays.dives[0](true);
    await flush();
    vi.advanceTimersByTime(1000);
    expect(stays.calls.slice(-2)).toEqual(['mark null', 'back']);

    const gone = rig();
    gone.press(THERE);
    gone.dives[0](true);
    await flush();
    gone.watch.end();
    vi.advanceTimersByTime(1000);
    expect(gone.calls).not.toContain('mark null');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('不该潜的一点、栏里没有会潜的沙盘：不拦，什么也不做', () => {
    const r = rig();
    expect(r.press(stopHref(FIGURE, BARE)).defaultPrevented).toBe(false);
    expect(r.press(THERE, { ctrlKey: true }).defaultPrevented).toBe(false);
    expect(r.calls).toEqual([]);
    r.noDive();
    expect(r.press(THERE).defaultPrevented).toBe(false);
    expect(r.calls).toEqual([`dive ${OWN} ${DIVE_MS}`]);
    expect(vi.getTimerCount()).toBe(0);

    const off = rig({ ...READY, on: false });
    expect(off.press(THERE).defaultPrevented).toBe(false);
    expect(off.calls).toEqual([]);
  });
});
