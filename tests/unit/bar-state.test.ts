// 时间轴怎么动（src/timebar/barState.ts）和它记着的那一份（src/timebar/barStore.ts）：在 Node 里跑，不要浏览器。
// 行迹和全程沙盘的各节是 content/ 里真的；钟、下一帧、定时器、沙盘栏现在摆着什么，都是这里交进去的假的——
// 钟不自己走，测试说走多少毫秒就走多少；“沙盘栏”只是一张小纸条（摆着哪一节、有没有小像、读者动没动过镜头），记下时间轴向它报了什么。
// 哪一段落在哪一站里、有几节，都从真的文件里读，不写死在这里。

import { describe, expect, it } from 'vitest';
import type { ItineraryBar } from '../../src/domain/itinerary';
import type { RouteScene } from '../../src/domain/scene';
import { dayAt, unitsAt } from '../../src/timebar/barScale';
import { BAR_KEYS, HOLD_MAX_MS, KEYS_REST_MS, KEY_STEPS, PLAY_UNITS_A_SECOND, barControl, keyStep, sectionAt, stretchStep } from '../../src/timebar/barState';
import type { BarEnv, PaneReport } from '../../src/timebar/barState';
import { barStore } from '../../src/timebar/barStore';
import { readBytes } from '../support/readBytes';

const readJson = <T>(path: string): T => JSON.parse(new TextDecoder().decode(readBytes(path))) as T;
const bar = readJson<ItineraryBar>('content/figures/su-shi/itinerary.bar.json');
const route = readJson<RouteScene>('content/figures/su-shi/scenes/route.json');
const sections = route.sections;
/** 头一节：全程。 */
const WHOLE = sections[0].heading;
const lastDay = bar.stretches[bar.stretches.length - 1].until;
/** 第 i 段从第几天起。 */
const startOf = (i: number): number => (i === 0 ? 0 : bar.stretches[i - 1].until);
/** 第 i 段该看哪一节。 */
const sectionOfStretch = (i: number): string => sectionAt(bar, sections, (startOf(i) + bar.stretches[i].until) / 2);
/** 头一个“住在一站里、够长（三个单位以上）”的段，和它后面那一段要换的一节不一样的：播放、按键的几项用它。 */
const STAY = bar.stretches.findIndex((s, i) => s.look === 'stop' && i + 1 < bar.stretches.length && sectionOfStretch(i + 1) !== sectionOfStretch(i));
/** 一段住在一站里、它后面那一段该看的是全程（不在哪一站里）的：按键走出去用它。 */
const STAY_THEN_WHOLE = bar.stretches.findIndex((s, i) => s.look === 'stop' && i + 1 < bar.stretches.length && sectionOfStretch(i + 1) === WHOLE);

let made = 0;
/** 搭一条时间轴：假的钟和假的沙盘栏。 */
function rig(options: { calm?: boolean; pane?: Partial<PaneReport>; key?: string } = {}) {
  const store = barStore(options.key ?? `测试/${++made}`);
  let clock = 0;
  let ids = 1;
  const frames = new Map<number, () => void>();
  const timers = new Map<number, { at: number; run: () => void }>();
  const pane: PaneReport = { section: WHOLE, figure: true, moved: false, ...options.pane };
  const goals: string[] = [];
  const counts = { resets: 0, frames: 0 };
  const env: BarEnv = {
    now: () => clock,
    frame: (run) => {
      counts.frames += 1;
      frames.set(ids, run);
      return ids++;
    },
    cancelFrame: (id) => void frames.delete(id),
    later: (run, ms) => {
      timers.set(ids, { at: clock + ms, run });
      return ids++;
    },
    cancelLater: (id) => void timers.delete(id),
    calm: options.calm === true,
    pane: () => ({ ...pane }),
    goal: (heading) => void goals.push(heading),
    reset: () => {
      counts.resets += 1;
      pane.moved = false;
    },
  };
  const control = barControl(bar, sections, store, env);
  /** 钟走 ms 毫秒，分 steps 步；每一步先响到点的定时器，再画约好的那一帧。 */
  const advance = (ms: number, steps = 1): void => {
    for (let i = 0; i < steps; i++) {
      clock += ms / steps;
      for (const [id, timer] of [...timers]) {
        if (timer.at > clock + 1e-9) continue;
        timers.delete(id);
        timer.run();
      }
      for (const [id, run] of [...frames]) {
        frames.delete(id);
        run();
      }
    }
  };
  return { store, control, pane, goals, counts, advance, pending: () => frames.size + timers.size, env };
}
const units = (day: number): number => unitsAt(barControl(bar, sections, barStore(`量/${++made}`), rig().env).scale, day);

describe('时间轴怎么动', () => {
  it('真的行迹里找得到这几项要用的段', () => {
    expect(STAY).toBeGreaterThan(0);
    expect(STAY_THEN_WHOLE).toBeGreaterThan(0);
    expect(sectionOfStretch(0)).toBe(WHOLE);
  });

  it('播放是钟的函数：每秒 1.25 个单位；设备慢只是画得少，不是走得久', () => {
    expect(PLAY_UNITS_A_SECOND).toBe(1.25);
    const run = (frames: number): number => {
      const t = rig({ pane: { section: sectionOfStretch(STAY) } });
      t.store.set({ day: startOf(STAY) });
      t.control.play();
      expect(t.store.get().playing).toBe(true);
      t.advance(2000, frames);
      return unitsAt(t.control.scale, t.store.get().day);
    };
    const from = units(startOf(STAY));
    // 两秒：画一帧、画四十帧、画一百二十帧，圆钮都到同一个地方
    expect(run(1)).toBeCloseTo(from + 2.5, 9);
    expect(run(40)).toBeCloseTo(from + 2.5, 9);
    expect(run(120)).toBeCloseTo(from + 2.5, 9);
  });

  it('从圆钮停着的地方播起；到头停下，再按从头播', () => {
    const t = rig();
    // 最后一段里，离最后一天半个单位的地方
    const near = dayAt(t.control.scale, t.control.scale.total - 0.5);
    expect(sectionAt(bar, sections, near)).toBe(WHOLE);
    t.store.set({ day: near });
    t.control.play();
    expect(t.store.get().day).toBe(near);
    t.advance(200, 4);
    expect(t.store.get().day).toBeGreaterThan(near);
    expect(t.store.get().day).toBeLessThan(lastDay);
    // 到头：停在最后一天，不播了，算停着；不再约下一帧
    t.advance(2000, 10);
    expect(t.store.get()).toMatchObject({ day: lastDay, playing: false, rest: true });
    expect(t.pending()).toBe(0);
    // 再按：从头播
    t.control.play();
    expect(t.store.get()).toMatchObject({ day: 0, playing: true });
    t.advance(400, 4);
    expect(unitsAt(t.control.scale, t.store.get().day)).toBeCloseTo(0.5, 9);
  });

  it('换到另一节镜头的地方，钟停下来等：栏报了那一节摆好了就接着走', () => {
    const here = sectionOfStretch(STAY);
    const next = sectionOfStretch(STAY + 1);
    const t = rig({ pane: { section: here } });
    const edge = bar.stretches[STAY].until;
    t.store.set({ day: dayAt(t.control.scale, units(edge) - 0.25) });
    t.control.play();
    // 这一段该看的就是摆着的那一节：不报
    t.advance(100, 2);
    expect(t.goals).toEqual([]);
    // 走过了头：报下一段的那一节，圆钮停在那一段的起头等
    t.advance(300, 6);
    expect(t.goals).toEqual([next]);
    expect(t.store.get().day).toBe(edge);
    t.advance(1000, 20);
    expect(t.store.get()).toMatchObject({ day: edge, playing: true });
    expect(t.goals).toEqual([next]);
    // 栏摆好了那一节：接着走，等的那一阵不算
    t.pane.section = next;
    t.control.paneChanged();
    t.advance(800, 16);
    expect(unitsAt(t.control.scale, t.store.get().day)).toBeCloseTo(units(edge) + 1, 6);
    expect(t.goals).toEqual([next]);
  });

  it('等到 3 秒那一节还没有摆好：沙盘上摆着的是全程，或者沙盘上本来就没有小像（只放图片、还没摆好），接着走；摆着的是别的一节，停下，按钮变回“播放”——不让小像走在一条这一节没有画的路上', () => {
    expect(HOLD_MAX_MS).toBe(3000);
    const edge = bar.stretches[STAY].until;
    const begin = (pane: Partial<PaneReport>) => {
      // 从摆着这一站的那一节播起，播到要换一节的地方停下来等；这时候沙盘栏是 pane 说的样子
      const t = rig({ pane: { section: sectionOfStretch(STAY) } });
      t.store.set({ day: dayAt(t.control.scale, units(edge) - 0.25) });
      t.control.play();
      t.advance(400, 8);
      expect(t.store.get().day).toBe(edge);
      expect(t.goals).toEqual([sectionOfStretch(STAY + 1)]);
      Object.assign(t.pane, pane);
      // 等了不到 3 秒：还在等
      t.advance(2700, 27);
      expect(t.store.get()).toMatchObject({ day: edge, playing: true });
      t.advance(400, 4);
      return t;
    };
    // 摆着的是全程（每一趟路都画着）：接着走
    const whole = begin({ section: WHOLE, figure: true });
    expect(whole.store.get().playing).toBe(true);
    expect(whole.store.get().day).toBeGreaterThan(edge);
    // 沙盘上本来没有小像（只放图片；还没摆好）：接着走
    const pictures = begin({ section: sectionOfStretch(STAY), figure: false });
    expect(pictures.store.get().playing).toBe(true);
    expect(pictures.store.get().day).toBeGreaterThan(edge);
    const none = begin({ section: null, figure: false });
    expect(none.store.get().day).toBeGreaterThan(edge);
    // 摆着的是别的一节、沙盘上有小像：停下，停在那一段的起头，算停着
    const other = begin({ section: sectionOfStretch(STAY), figure: true });
    expect(other.store.get()).toMatchObject({ day: edge, playing: false, rest: true });
    expect(other.pending()).toBe(0);
    other.advance(5000, 50);
    expect(other.store.get()).toMatchObject({ day: edge, playing: false });
  });

  it('读者一碰就停：按在轴上、轴上按键、上一段下一段，别处的一碰（按在沙盘上、在沙盘上滚轮、点“图例”、点进一站、点题签上的圆点、点古名今名的开关、点“回到这一节”、网页转到后台、栏收起来、沙盘画面断了）都叫 stop；停了以后不自己再播', () => {
    const playing = () => {
      const t = rig({ pane: { section: sectionOfStretch(STAY) } });
      t.store.set({ day: startOf(STAY) });
      t.control.play();
      t.advance(400, 8);
      expect(t.store.get().playing).toBe(true);
      return t;
    };
    const stopped = (t: ReturnType<typeof rig>): void => {
      expect(t.store.get().playing).toBe(false);
      const day = t.store.get().day;
      // 钟接着走，圆钮不动，也不再约下一帧
      const frames = t.counts.frames;
      t.advance(3000, 30);
      expect(t.store.get().day).toBe(day);
      expect(t.store.get().playing).toBe(false);
      expect(t.counts.frames).toBe(frames);
    };
    // 别处的一碰
    const a = playing();
    a.control.stop();
    expect(a.store.get().rest).toBe(true);
    stopped(a);
    // 按在轴上（接着放手）
    const b = playing();
    b.control.press(units(b.store.get().day));
    expect(b.store.get().playing).toBe(false);
    b.control.release();
    stopped(b);
    // 轴上按键
    const c = playing();
    c.control.key('ArrowLeft');
    c.advance(KEYS_REST_MS);
    stopped(c);
    // 上一段、下一段
    const d = playing();
    d.control.step(1);
    stopped(d);
    // 这一条拿走了
    const e = playing();
    e.control.dispose();
    stopped(e);
    // 没在播放的时候 stop 什么也不做
    const idle = rig();
    idle.control.stop();
    expect(idle.store.get()).toEqual({ day: 0, used: false, rest: true, playing: false });
  });

  it('拖过好几站：一路上至多叫沙盘换一次（退到全程），放手再换一次；读者自己动过镜头的，多一次“回到这一节”', () => {
    const here = sectionOfStretch(STAY);
    const mid = (i: number): number => units((startOf(i) + bar.stretches[i].until) / 2);
    // 摆着的是一站的那一节：从这一站讲的年月里拖出去，一直拖到最后
    const t = rig({ pane: { section: here } });
    t.control.press(mid(STAY));
    expect(t.goals).toEqual([]);
    t.control.drag(mid(STAY) + 0.1);
    expect(t.goals).toEqual([]);
    for (let i = STAY + 1; i < bar.stretches.length; i++) t.control.drag(mid(i));
    expect(t.goals).toEqual([WHOLE]);
    expect(t.counts.resets).toBe(0);
    t.control.release();
    const end = sectionOfStretch(bar.stretches.length - 1);
    expect(t.goals).toEqual([WHOLE, end]);
    expect(t.store.get().rest).toBe(true);

    // 摆着的就是全程，读者自己动过镜头：拖进一站讲的年月里，报一次全程，另按一下“回到全程”；再拖不再报、不再按
    const moved = rig({ pane: { section: WHOLE, moved: true } });
    moved.control.press(mid(0));
    expect([moved.goals, moved.counts.resets]).toEqual([[], 0]);
    moved.control.drag(mid(STAY));
    expect([moved.goals, moved.counts.resets]).toEqual([[WHOLE], 1]);
    moved.pane.moved = true;
    for (let i = STAY + 1; i < bar.stretches.length; i++) moved.control.drag(mid(i));
    expect([moved.goals, moved.counts.resets]).toEqual([[WHOLE], 1]);
    moved.control.release();
    expect([moved.goals, moved.counts.resets]).toEqual([[WHOLE, end], 1]);

    // 摆着的就是全程，读者没有动过镜头：不按
    const still = rig({ pane: { section: WHOLE } });
    still.control.press(mid(0));
    still.control.drag(mid(STAY));
    expect([still.goals, still.counts.resets]).toEqual([[WHOLE], 0]);

    // 一直在摆着的那一节讲的年月里拖：手不放不报；放手报一次（就是摆着的那一节）
    const inside = rig({ pane: { section: here } });
    inside.control.press(mid(STAY) - 0.2);
    inside.control.drag(mid(STAY));
    inside.control.drag(mid(STAY) + 0.2);
    expect(inside.goals).toEqual([]);
    inside.control.release();
    expect(inside.goals).toEqual([here]);
    // 手已经放了：再来的“放手”“拖到”不算
    inside.control.release();
    inside.control.drag(mid(0));
    expect(inside.goals).toEqual([here]);
    expect(sectionAt(bar, sections, inside.store.get().day)).toBe(here);
  });

  it('按键：头一下走出了沙盘上摆着的那一节讲的年月，马上叫沙盘退到全程（同拖的时候一样）；按住不放，一路上不再叫；停手 350 毫秒以后叫沙盘换到停下的那一节', () => {
    expect(KEYS_REST_MS).toBe(350);
    const here = sectionOfStretch(STAY);
    const t = rig({ pane: { section: here } });
    const edge = bar.stretches[STAY].until;
    // 这一段的最后一个八分之一上
    t.store.set({ day: keyStep(bar, edge, -1) });
    // 还在这一段里走：不报
    t.control.key('ArrowLeft');
    t.advance(30);
    t.control.key('ArrowRight');
    expect(t.goals).toEqual([]);
    // 走出去的头一下：马上报全程
    t.advance(30);
    t.control.key('ArrowRight');
    expect(t.store.get().day).toBe(edge);
    expect(t.goals).toEqual([WHOLE]);
    // 按住不放（每 30 毫秒来一下），一路走过好几段：不再报
    for (let i = 0; i < 60; i++) {
      t.advance(30);
      t.control.key('ArrowRight');
    }
    expect(t.goals).toEqual([WHOLE]);
    expect(t.store.get().rest).toBe(false);
    const stopped = t.store.get().day;
    expect(stopped).toBeGreaterThan(bar.stretches[STAY + 2].until);
    // 停手不到 350 毫秒：还不报
    t.advance(KEYS_REST_MS - 1);
    expect(t.goals).toEqual([WHOLE]);
    expect(t.store.get().rest).toBe(false);
    // 满 350 毫秒：报停下的那一节，算停着
    t.advance(1);
    expect(t.goals).toEqual([WHOLE, sectionAt(bar, sections, stopped)]);
    expect(t.store.get()).toMatchObject({ day: stopped, rest: true });
    // 下一串按键从头算：又走出去，再报一次全程
    t.pane.section = sectionAt(bar, sections, stopped);
    const before = t.goals.length;
    t.control.key('Home');
    expect(t.goals.slice(before)).toEqual(t.pane.section === WHOLE ? [] : [WHOLE]);
    // 摆着的就是全程、读者动过镜头：走进一站讲的年月里的头一下，另按一下“回到全程”
    const moved = rig({ pane: { section: WHOLE, moved: true } });
    moved.store.set({ day: startOf(STAY) - 1 });
    moved.control.key('PageUp');
    expect(sectionAt(bar, sections, moved.store.get().day)).not.toBe(WHOLE);
    expect([moved.goals, moved.counts.resets]).toEqual([[WHOLE], 1]);
  });

  it('左右键走这一段的八分之一；翻页键到下一段、上一段的起头；Home、End 到头尾', () => {
    expect(KEY_STEPS).toBe(8);
    expect([...BAR_KEYS].sort()).toEqual(['ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'End', 'Home', 'PageDown', 'PageUp']);
    // 每一段：从起头按八下右键，正好到下一段的起头；每一下是这一段的八分之一
    bar.stretches.forEach((stretch, i) => {
      const from = startOf(i);
      const eighth = (stretch.until - from) / 8;
      let day = from;
      for (let k = 1; k <= 8; k++) {
        day = keyStep(bar, day, 1);
        expect(day, `${stretch.id} 第 ${k} 下`).toBeCloseTo(k === 8 ? stretch.until : from + k * eighth, 6);
      }
      expect(day, stretch.id).toBe(stretch.until);
      // 再一下一下按回来
      for (let k = 7; k >= 0; k--) {
        day = keyStep(bar, day, -1);
        expect(day, `${stretch.id} 退到第 ${k} 格`).toBeCloseTo(from + k * eighth, 6);
      }
      // 不在格上的地方：往后到下一格，往前到上一格
      expect(keyStep(bar, from + 2.5 * eighth, 1), stretch.id).toBeCloseTo(from + 3 * eighth, 6);
      expect(keyStep(bar, from + 2.5 * eighth, -1), stretch.id).toBeCloseTo(from + 2 * eighth, 6);
      // 翻页键：下一段的起头；上一段的起头
      expect(stretchStep(bar, from + 3 * eighth, 1), stretch.id).toBe(stretch.until);
      expect(stretchStep(bar, from + 3 * eighth, -1), stretch.id).toBe(i === 0 ? 0 : startOf(i - 1));
    });
    // 两头：不出去
    expect(keyStep(bar, 0, -1)).toBe(0);
    expect(keyStep(bar, lastDay, 1)).toBe(lastDay);
    // 接在时间轴上：上下键同右左键；翻页键、Home、End
    const t = rig();
    const from = startOf(STAY);
    const eighth = (bar.stretches[STAY].until - from) / 8;
    t.store.set({ day: from });
    t.control.key('ArrowRight');
    expect(t.store.get().day).toBeCloseTo(from + eighth, 6);
    t.control.key('ArrowUp');
    expect(t.store.get().day).toBeCloseTo(from + 2 * eighth, 6);
    t.control.key('ArrowDown');
    t.control.key('ArrowLeft');
    expect(t.store.get().day).toBeCloseTo(from, 6);
    t.control.key('PageUp');
    expect(t.store.get().day).toBe(bar.stretches[STAY].until);
    t.control.key('PageDown');
    expect(t.store.get().day).toBe(from);
    t.control.key('End');
    expect(t.store.get().day).toBe(lastDay);
    t.control.key('ArrowRight');
    t.control.key('PageUp');
    expect(t.store.get().day).toBe(lastDay);
    t.control.key('Home');
    expect(t.store.get().day).toBe(0);
    t.control.key('ArrowLeft');
    t.control.key('PageDown');
    expect(t.store.get().day).toBe(0);
    // 上一段、下一段（“减少动态效果”时轴两头的两个按钮）：一下就到，到了就停着，报那一节
    const s = rig({ calm: true });
    s.store.set({ day: (from + bar.stretches[STAY].until) / 2 });
    s.control.step(1);
    expect(s.store.get()).toMatchObject({ day: bar.stretches[STAY].until, used: true, rest: true });
    expect(s.goals).toEqual([sectionOfStretch(STAY + 1)]);
    s.control.step(-1);
    expect(s.store.get().day).toBe(from);
    expect(s.goals).toEqual([sectionOfStretch(STAY + 1), sectionOfStretch(STAY)]);
  });

  it('设了“减少动态效果”：从来不订下一帧', () => {
    const t = rig({ calm: true, pane: { section: sectionOfStretch(STAY) } });
    t.store.set({ day: startOf(STAY) });
    t.control.play();
    expect(t.store.get()).toMatchObject({ playing: false, used: false, day: startOf(STAY) });
    t.control.press(units(startOf(STAY)) + 0.5);
    t.control.drag(units(lastDay) - 1);
    t.control.release();
    for (const key of BAR_KEYS) t.control.key(key as Parameters<typeof t.control.key>[0]);
    t.advance(1000, 10);
    t.control.step(1);
    t.control.step(-1);
    t.control.play();
    t.control.paneChanged();
    t.advance(5000, 50);
    expect(t.counts.frames).toBe(0);
    expect(t.store.get().playing).toBe(false);
    // 不设的时候，播放才订
    const moving = rig({ pane: { section: sectionOfStretch(STAY) } });
    moving.store.set({ day: startOf(STAY) });
    moving.control.play();
    expect(moving.counts.frames).toBeGreaterThan(0);
  });

  it('栏拿走再摆上，日子还在；没动过时间轴的，沙盘看的还是全程', () => {
    const key = `测试/${++made}`;
    const first = rig({ key });
    first.control.press(units(startOf(STAY)) + 1);
    first.control.release();
    const kept = first.store.get();
    expect(kept.used).toBe(true);
    first.control.dispose();
    // 再摆上：同一位人物的那一份，日子、动没动过都还在；摆上的时候不报
    const second = rig({ key });
    expect(second.store).toBe(first.store);
    expect(second.store.get()).toEqual(kept);
    second.control.paneChanged();
    expect(second.goals).toEqual([]);
    // 别的人物是另一份
    expect(barStore(`测试/${++made}`).get()).toEqual({ day: 0, used: false, rest: true, playing: false });
    // 没动过的：摆上、沙盘栏变了样、拿走，一次也不报——沙盘栏看的还是它自己的头一节
    const untouched = rig();
    untouched.control.paneChanged();
    untouched.control.stop();
    untouched.advance(5000, 10);
    untouched.control.dispose();
    expect(untouched.goals).toEqual([]);
    expect(untouched.counts.resets).toBe(0);
    expect(untouched.store.get()).toEqual({ day: 0, used: false, rest: true, playing: false });
  });

  it('还没动过时间轴，不向页面报要看哪一节', () => {
    // 地址里指定了从哪一天起（TimeBar.tsx 直接写进那一份里）：不算动过，不报
    const t = rig({ pane: { section: WHOLE } });
    t.store.set({ day: startOf(STAY) + 1, rest: true });
    t.control.paneChanged();
    t.advance(1000, 4);
    expect(t.goals).toEqual([]);
    expect(t.store.get().used).toBe(false);
    // 动了：算动过，放手就报
    t.control.press(units(startOf(STAY)) + 0.5);
    expect(t.store.get().used).toBe(true);
    t.control.release();
    expect(t.goals.at(-1)).toBe(sectionOfStretch(STAY));
  });

  it('停着才算“停在这一天”（小像在路上，题签也让开他）：刚摆上、放了手、最后一下按键过了 350 毫秒、停了播放、到了头；拖着、连着按键、播放着不算', () => {
    const t = rig({ pane: { section: sectionOfStretch(STAY) } });
    expect(t.store.get().rest).toBe(true);
    t.control.press(units(startOf(STAY)) + 0.5);
    expect(t.store.get().rest).toBe(false);
    t.control.drag(units(startOf(STAY)) + 0.7);
    expect(t.store.get().rest).toBe(false);
    t.control.release();
    expect(t.store.get().rest).toBe(true);
    t.control.key('ArrowRight');
    expect(t.store.get().rest).toBe(false);
    t.advance(KEYS_REST_MS - 1);
    expect(t.store.get().rest).toBe(false);
    t.control.key('ArrowRight');
    t.advance(KEYS_REST_MS - 1);
    expect(t.store.get().rest).toBe(false);
    t.advance(1);
    expect(t.store.get().rest).toBe(true);
    t.control.play();
    expect(t.store.get()).toMatchObject({ rest: false, playing: true });
    t.advance(200, 4);
    expect(t.store.get().rest).toBe(false);
    t.control.stop();
    expect(t.store.get()).toMatchObject({ rest: true, playing: false });
    // 播放的时候按在轴上：播放停了，可手还按着，不算停着；放手才算
    t.control.play();
    t.control.press(units(t.store.get().day));
    expect(t.store.get()).toMatchObject({ rest: false, playing: false });
    t.control.release();
    expect(t.store.get().rest).toBe(true);
    // 拖到半截这一条拿走了：算停着（日子留着）
    t.control.press(units(startOf(STAY)) + 0.5);
    t.control.dispose();
    expect(t.store.get().rest).toBe(true);
  });
});
