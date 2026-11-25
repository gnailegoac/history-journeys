// 时间轴怎么动：拖、按、按键、播放的时候，圆钮到哪一天；什么时候叫沙盘栏换小节；什么时候算“停着”。
// 只算数，不碰页面：日子记在 ./barStore.ts 的那一份里；钟、下一帧、定时器、沙盘栏现在摆着什么、叫沙盘栏做什么，都是交进来的
//（真的页面上由 TimeBar.tsx 交真的，测试里交假的）。
//
// 镜头的规矩（时间轴从不直接同沙盘说话，只向沙盘栏报“该看哪一节”）：
//   一段落在哪一站讲的年月里，就看全程沙盘上那一站的那一节；不在哪一站里的看头一节（全程）。
//   全程沙盘的一节只画到这一站为止的路；全程那一节画着所有的路。所以圆钮走出了摆着的那一节讲的年月，先叫沙盘退到全程，
//   不让小像走在一条这一节没有画的路上；停下来以后再换到停下的那一节。
//   拖：走出去的头一下报一次全程（摆着的就是全程、读者又自己动过镜头的，另按一下“回到全程”）；手不放不再报；放手报一次停下的那一节。
//   按键：同拖一样，头一下走出去马上报全程；连着按不再报；最后一下以后 350 毫秒报停下的那一节。
//   播放：走到要换一节的地方先报那一节，钟停下来等沙盘栏摆好；等了 3 秒还没好，摆着的是全程、或者沙盘上本来没有小像，接着走，
//   不然停下。读者一碰（stop）就停，停了不自己再播。
// 没动过时间轴的不报：页面打开的时候同原来一模一样。

import type { ItineraryBar } from '../domain/itinerary';
import { barScale, dayAt, unitsAt } from './barScale';
import type { BarScale } from './barScale';
import type { BarStore } from './barStore';
import { stretchIndexAt, stretchStart } from './barWhere';

/** 播放的时候圆钮每秒走几个单位。 */
export const PLAY_UNITS_A_SECOND = 1.25;
/** 最后一下按键以后过这么久（毫秒），算停了手。 */
export const KEYS_REST_MS = 350;
/** 播放到要换一节的地方，最多等沙盘栏这么久（毫秒）。 */
export const HOLD_MAX_MS = 3000;
/** 左右键一下走这一段的几分之一。 */
export const KEY_STEPS = 8;

/** 沙盘栏现在的样子（TimeBar.tsx 从栏上的属性读的）。 */
export interface PaneReport {
  /** 上面那一张画面现在摆着的小节；还没有是 null。 */
  section: string | null;
  /** 沙盘上摆得出小像：立体的沙盘摆好了、显出来了。放着图片、还没摆好的时候是 false。 */
  figure: boolean;
  /** 读者自己动过镜头（中间那个“回到……”的按钮点得了）。 */
  moved: boolean;
}

/** 交进来的东西。 */
export interface BarEnv {
  /** 钟：现在是第几毫秒。 */
  now(): number;
  /** 约下一帧；返回的号可以拿去取消。 */
  frame(run: () => void): number;
  cancelFrame(id: number): void;
  /** 过 ms 毫秒以后叫 run。 */
  later(run: () => void, ms: number): number;
  cancelLater(id: number): void;
  /** 系统设了“减少动态效果”：不播放，从不约下一帧。 */
  calm: boolean;
  /** 沙盘栏现在的样子。 */
  pane(): PaneReport;
  /** 向沙盘栏报：全程沙盘该看这一节。 */
  goal(heading: string): void;
  /** 按一下沙盘栏中间的“回到……”。 */
  reset(): void;
}

/** 时间轴能听的按键。 */
export type BarKey = 'ArrowRight' | 'ArrowUp' | 'ArrowLeft' | 'ArrowDown' | 'PageUp' | 'PageDown' | 'Home' | 'End';
export const BAR_KEYS: readonly string[] = ['ArrowRight', 'ArrowUp', 'ArrowLeft', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End'];

export interface BarControl {
  scale: BarScale;
  /** 手指按在轴上的第 units 个单位（也是拖的开头）。 */
  press(units: number): void;
  /** 手指拖到了第 units 个单位。 */
  drag(units: number): void;
  /** 手指放开了。 */
  release(): void;
  /** 按了一下键。 */
  key(key: BarKey): void;
  /** 上一段、下一段的起头（“减少动态效果”时轴两头的两个按钮）。 */
  step(direction: 1 | -1): void;
  /** 开始播放（停在最后一天的从头播）。“减少动态效果”时什么也不做。 */
  play(): void;
  /** 停下播放（读者碰了别的东西、网页转到后台、栏收起来、沙盘画面断了……）。没在播放的时候什么也不做。 */
  stop(): void;
  /** 沙盘栏变了样（每一回重画以后叫一下）：播放等着的那一节摆好了就接着走。 */
  paneChanged(): void;
  /** 这一条拿走了：手上的定时器、约好的下一帧都取消；日子留在那一份里。 */
  dispose(): void;
}

/** 一节的标题，和它讲的是哪一站（头一节“全程”没有）。 */
export interface BarSection {
  heading: string;
  stop?: string;
}

/** 第 day 天落在行迹的哪一段，这一段该看全程沙盘的哪一节（标题）。 */
export function sectionAt(bar: ItineraryBar, sections: readonly BarSection[], day: number): string {
  const group = bar.stretches[stretchIndexAt(bar, day)].group;
  return (sections.find((section) => group !== undefined && section.stop === group) ?? sections[0]).heading;
}

/** 左右键走一下以后是第几天：这一段的八分之一；走到这一段的头，再走就是下一段（上一段）的八分之一。direction 是 1（往后）、-1（往前）。 */
export function keyStep(bar: ItineraryBar, day: number, direction: 1 | -1): number {
  const last = bar.stretches[bar.stretches.length - 1].until;
  const i = stretchIndexAt(bar, day);
  const from = stretchStart(bar, i);
  const eighth = (bar.stretches[i].until - from) / KEY_STEPS;
  // 现在在这一段的第几个八分之一上（不正好在格上的，往前走到下一格，往后走到上一格）
  const at = (day - from) / eighth;
  if (direction > 0) {
    const k = Math.floor(at + 1e-9) + 1;
    return Math.min(last, k >= KEY_STEPS ? bar.stretches[i].until : from + k * eighth);
  }
  const k = Math.ceil(at - 1e-9) - 1;
  if (k >= 0) return from + k * eighth;
  if (i === 0) return 0;
  const before = stretchStart(bar, i - 1);
  return before + ((KEY_STEPS - 1) * (from - before)) / KEY_STEPS;
}

/** 下一段（direction 是 1）、上一段（-1）的起头是第几天。已经在最后一段的，往后是最后一天；在头一段的，往前是第 0 天。 */
export function stretchStep(bar: ItineraryBar, day: number, direction: 1 | -1): number {
  const i = stretchIndexAt(bar, day);
  if (direction > 0) return bar.stretches[i].until;
  return i === 0 ? 0 : stretchStart(bar, i - 1);
}

/** 接上一条时间轴。sections 是全程沙盘的各节（头一节是全程）；store 是记着日子的那一份。 */
export function barControl(bar: ItineraryBar, sections: readonly BarSection[], store: BarStore, env: BarEnv): BarControl {
  const scale = barScale(bar);
  const whole = sections[0].heading;
  const sectionOf = (day: number): string => sectionAt(bar, sections, day);

  /** 这一回拖（这一串按键）里，已经叫沙盘退到过全程了。 */
  let backedOut = false;
  let dragging = false;
  let keyTimer: number | null = null;
  /** 播放：从第几个单位、哪一刻播起；一路上停下来等沙盘栏一共等了多久；现在等着的那一节和从哪一刻等起（没在等是 null）；上一回报的是哪一节。 */
  let play: { from: number; started: number; held: number; hold: { section: string; since: number } | null; told: string; frame: number | null } | null = null;

  /** 圆钮走出了摆着的那一节讲的年月：叫沙盘退到全程（一回只叫一次）。 */
  const backOut = (day: number): void => {
    if (backedOut) return;
    const { section, moved } = env.pane();
    if (sectionOf(day) === section) return;
    backedOut = true;
    env.goal(whole);
    // 摆着的就是全程，可读者自己动过镜头：报“全程”沙盘栏不会动，替读者按一下“回到全程”
    if (section === whole && moved) env.reset();
  };

  const endKeys = (): void => {
    if (keyTimer !== null) env.cancelLater(keyTimer);
    keyTimer = null;
  };

  /** 停下播放；rest 是停下以后算不算停着（接着就要拖、要按键的时候不算）。 */
  const halt = (rest: boolean): void => {
    if (!play) return;
    if (play.frame !== null) env.cancelFrame(play.frame);
    play = null;
    store.set({ playing: false, rest });
  };

  /** 读者自己动了圆钮：先把播放停下，把一串按键收掉。 */
  const take = (): void => {
    halt(false);
    endKeys();
  };

  const moveTo = (day: number): void => {
    const to = Math.min(Math.max(day, 0), scale.lastDay);
    backOut(to);
    store.set({ day: to, used: true, rest: false });
  };

  /** 播放的一帧：照钟算圆钮该在哪。 */
  const tick = (): void => {
    if (!play) return;
    play.frame = null;
    const now = env.now();
    if (play.hold) {
      const { section, figure } = env.pane();
      if (section === play.hold.section) {
        // 那一节摆好了：接着走，等的这一阵不算
        play.held += now - play.hold.since;
        play.hold = null;
      } else if (now - play.hold.since >= HOLD_MAX_MS) {
        // 等够了还没好：摆着的是全程（每一趟路都画着），或者沙盘上本来没有小像，接着走；不然停下
        if (section !== whole && figure) {
          halt(true);
          return;
        }
        play.held += now - play.hold.since;
        play.hold = null;
      }
    }
    if (!play.hold) {
      const units = play.from + (PLAY_UNITS_A_SECOND * (now - play.started - play.held)) / 1000;
      if (units >= scale.total) {
        store.set({ day: scale.lastDay });
        halt(true);
        return;
      }
      let day = dayAt(scale, units);
      const wanted = sectionOf(day);
      if (wanted !== play.told) {
        // 走进了要换一节的一段：报那一节，等沙盘栏摆好
        play.told = wanted;
        env.goal(wanted);
        if (env.pane().section !== wanted) {
          // 等的时候圆钮停在这一段的起头（刚按“播放”就要换的，停在原处）；钟拨回到那里，摆好了从那里接着走
          const wait = Math.max(stretchStart(bar, stretchIndexAt(bar, day)), Math.min(store.get().day, day));
          play.held += ((unitsAt(scale, day) - unitsAt(scale, wait)) * 1000) / PLAY_UNITS_A_SECOND;
          day = wait;
          play.hold = { section: wanted, since: now };
        }
      }
      store.set({ day });
    }
    play.frame = env.frame(tick);
  };

  return {
    scale,
    press(units) {
      take();
      dragging = true;
      backedOut = false;
      moveTo(dayAt(scale, units));
    },
    drag(units) {
      if (dragging) moveTo(dayAt(scale, units));
    },
    release() {
      if (!dragging) return;
      dragging = false;
      backedOut = false;
      env.goal(sectionOf(store.get().day));
      store.set({ rest: true });
    },
    key(key) {
      // 一串按键的头一下（上一串已经停了手）：这一串里还没有叫沙盘退过
      if (keyTimer === null) backedOut = false;
      take();
      const day = store.get().day;
      const forward = key === 'ArrowRight' || key === 'ArrowUp';
      moveTo(key === 'Home' ? 0 : key === 'End' ? scale.lastDay : key === 'PageUp' || key === 'PageDown' ? stretchStep(bar, day, key === 'PageUp' ? 1 : -1) : keyStep(bar, day, forward ? 1 : -1));
      keyTimer = env.later(() => {
        keyTimer = null;
        backedOut = false;
        env.goal(sectionOf(store.get().day));
        store.set({ rest: true });
      }, KEYS_REST_MS);
    },
    step(direction) {
      take();
      backedOut = false;
      const day = Math.min(Math.max(stretchStep(bar, store.get().day, direction), 0), scale.lastDay);
      // 一下就到，到了就停着：直接报那一节
      store.set({ day, used: true, rest: true });
      env.goal(sectionOf(day));
    },
    play() {
      if (env.calm || play) return;
      endKeys();
      dragging = false;
      const day = store.get().day >= scale.lastDay ? 0 : store.get().day;
      const now = env.now();
      // 摆着的那一节算已经报过：这一段就该看它的，不再报
      play = { from: unitsAt(scale, day), started: now, held: 0, hold: null, told: env.pane().section ?? '', frame: null };
      store.set({ day, used: true, rest: false, playing: true });
      tick();
    },
    stop() {
      halt(true);
    },
    paneChanged() {
      if (play?.hold && env.pane().section === play.hold.section) {
        if (play.frame !== null) env.cancelFrame(play.frame);
        tick();
      }
    },
    dispose() {
      halt(true);
      endKeys();
      if (dragging) store.set({ rest: true });
      dragging = false;
    },
  };
}
