// 读者正读到哪一小节。沙盘的镜头跟着它走。
//
// 办法：看得见正文的那一块（窄屏上沙盘钉在顶上，要从沙盘的下边算起）里，从上往下 42% 的地方有一条“阅读线”；
// 标题已经过了这条线的最后一个小节，就是正在读的。页面快滚到底时，这条线跟着往下挪到底边，
// 最后几个短的小节才轮得到。整页短得不用滚的时候没有这回事，就是第一节。
// 一个小节要连着当上 150 毫秒才往上报：滚得快、一掠而过的小节不报，沙盘不用跟着乱转（见 dwellReporter）。
// 滚动、窗口大小变了、正文自己的高矮变了（点开小注、原文，图片晚到）都重新看一遍。
// 版面换了排法（平板转了个方向，窗口拉过了宽窄的分界）：正文按另一种栏宽重排，原来滚到的位置落到了别的小节上。
// 这时把正文挪一下，让阅读线回到刚才报上去的那一小节里（挪得最少：带回来的是那一小节的头或者尾），沙盘还摆着它。
// 页面快滚到底的那一截里，阅读线自己跟着滚动在挪：要挪多少，是把阅读线的这一挪也算进去的。
// 重排以后读者还在那一小节里就不动；同一种排法里窗口变大变小也不这样做。

import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';
import { WIDE_SCREEN } from './StagePane';

/** 阅读线在看得见正文的那一块里，从上往下的几成。 */
export const READING_LINE = 0.42;
/** 一个小节要连着当上这么久（毫秒）才往上报。 */
export const READING_DWELL_MS = 150;

/**
 * 版面换了排法、把一小节带回阅读线上的时候，它的头摆在阅读线上面多远、或者它的尾摆在阅读线下面多远（像素）。
 * 页面快滚到底、阅读线跟着滚动在挪的那一截里，多滚的这一小截阅读线也跟着挪，隔着的是它的一倍到两倍。
 */
const BRING_BACK_GAP_PX = 16;

/** 沙盘栏的类名：窄屏上它在正文上面，看得见正文的那一块从它的下边算起。 */
const PANE_SELECTOR = '.stage-pane';
/** 文字栏和沙盘栏外面的那一层：它的高矮变了，就是正文或者沙盘栏的高矮变了。 */
const LAYOUT_SELECTOR = '.figure-layout';

/**
 * 阅读线在窗口里的高度（从窗口上边量，像素）。
 * viewportHeight 是窗口多高；textTop 是看得见正文的那一块从哪开始；
 * remainingScroll 是页面往下还能滚多少，不写就是还远。滚到只剩最后一截时，线从 42% 的地方匀着挪到窗口底边。
 */
export function readingLine(viewportHeight: number, textTop: number, remainingScroll = Infinity): number {
  const base = textTop + (viewportHeight - textTop) * READING_LINE;
  return Math.max(base, viewportHeight - Math.max(0, remainingScroll));
}

/**
 * 页面往下还能滚多少（给 readingLine 用）。pageHeight 是整页多高，scrollY 是已经滚了多少。
 * 整页短得不用滚的时候算“还远”：没有“快滚到底”这回事，阅读线留在 42% 的地方
 * （不然线贴着窗口的底边，一上来就成了最后一节）。
 */
export function remainingScroll(pageHeight: number, viewportHeight: number, scrollY: number): number {
  return pageHeight <= viewportHeight ? Infinity : pageHeight - viewportHeight - scrollY;
}

/** 定时的两样东西：过 ms 毫秒做一件事，和取消它。浏览器里就是 setTimeout、clearTimeout；测试里给假的。 */
export interface DwellTimers<Id> {
  set(run: () => void, ms: number): Id;
  clear(id: Id): void;
}

/**
 * 一个小节要连着当上 dwellMs 毫秒才往上报。
 * see(section) 告诉它现在阅读线上是哪一小节（每看一次说一次，没变也可以说）；连着是同一节、够了时间，才调用 report。
 * 中途换成别的小节，前一节就不报了；已经报过的那一节又回到线上，不重报。stop() 之后什么也不再报。
 */
export function dwellReporter<Id>(report: (section: string) => void, timers: DwellTimers<Id>, dwellMs: number = READING_DWELL_MS): { see(section: string | null): void; stop(): void } {
  // 现在排在阅读线上的小节，和已经报上去的小节。
  let candidate: string | null = null;
  let told: string | null = null;
  let timer: Id | undefined;
  const cancel = () => {
    if (timer !== undefined) timers.clear(timer);
    timer = undefined;
  };
  return {
    see(next) {
      if (next === candidate) return;
      candidate = next;
      cancel();
      if (next === null || next === told) return;
      timer = timers.set(() => {
        timer = undefined;
        told = next;
        report(next);
      }, dwellMs);
    },
    stop: cancel,
  };
}

/**
 * 正在读哪一小节。marks 是各小节的标题现在在窗口里的高度（从窗口上边量），按正文的先后；line 是阅读线。
 * 标题在阅读线上面的最后一个小节就是；一个都还没过线时是第一节；一个小节也没有时是 null。
 */
export function pickSection(marks: readonly { section: string; top: number }[], line: number): string | null {
  if (marks.length === 0) return null;
  let current = marks[0].section;
  for (const mark of marks) {
    if (mark.top < line) current = mark.section;
  }
  return current;
}

/**
 * 盯着 root 里带 data-section 的小节，读到另一小节时调用 onSection（小节标题）。
 * active 为 false 时不盯（正文还没出来，或者这一站没有沙盘）。
 * 版面换了排法、阅读线上换成了别的小节的时候，把刚才报上去的那一小节带回阅读线上（见下面 reshaped）；没有在盯的页面不动。
 */
export function useReadingSection(root: RefObject<HTMLElement | null>, active: boolean, onSection: (section: string) => void): void {
  const report = useRef(onSection);
  useEffect(() => {
    report.current = onSection;
  }, [onSection]);

  useEffect(() => {
    if (!active) return;
    let frame = 0;
    // 刚才报上去的是哪一小节：版面换排法的时候要把它带回眼前。
    let last: string | null = null;
    const dwell = dwellReporter<number>(
      (section) => {
        last = section;
        report.current(section);
      },
      {
        set: (run, ms) => window.setTimeout(run, ms),
        clear: (id) => window.clearTimeout(id),
      },
    );

    /** 正文里的各小节，按先后。 */
    const nodes = (el: HTMLElement): HTMLElement[] => Array.from(el.querySelectorAll<HTMLElement>('[data-section]'));
    /** 照现在的版面、现在滚到的地方，阅读线在窗口里多高。 */
    const lineAt = (el: HTMLElement): number => readingLine(window.innerHeight, visibleTextTop(el), remainingScroll(document.documentElement.scrollHeight, window.innerHeight, window.scrollY));
    /** 照现在的版面、现在滚到的地方，阅读线上是哪一小节。 */
    const now = (el: HTMLElement): string | null =>
      pickSection(
        nodes(el).map((node) => ({ section: node.dataset.section ?? '', top: node.getBoundingClientRect().top })),
        lineAt(el),
      );

    const pick = () => {
      frame = 0;
      const el = root.current;
      if (el) dwell.see(now(el));
    };

    // 滚动时一帧最多看一次。
    const schedule = () => {
      if (frame === 0) frame = requestAnimationFrame(pick);
    };

    schedule();
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    // 版面换了排法：正文按另一种栏宽重排，同一个滚动的位置多半落到了前后一两节上。把正文挪一下，让阅读线回到刚才那一小节里，
    // 沙盘就还摆着它。挪得最少：那一小节的头已经在阅读线上面（重排以后落到了后面的小节上，读者刚才快读完它了），
    // 把它的尾摆到阅读线下面一小截——不把它的开头拉回来，那样读者眼前的东西全换了，要倒回去一整节；
    // 它的头还在阅读线下面（落到了前面的小节上，读者刚才刚读到它），把头摆到阅读线上面一小截。
    // 短的小节也留得住：这样摆，后面那一节的标题还在阅读线下面（把头摆到那一块的最上面的话，后面那一节的标题也过了阅读线，沙盘就换走了）。
    // 只在换排法的时候做：同一种排法里拉一拉窗口，不动读者读到的地方。
    // 要滚多少是这里自己量的，不叫浏览器“把它滚到看得见的地方”：那样靠的是 layout.css 给整页留的那一截，
    // 焦点在沙盘栏里的时候那一截不算数（刚按过栏里的按钮就是这样），不认 :has() 的浏览器上那一截根本没有，标题都会落到钉着的栏底下。
    // 重排以后阅读线上还是刚才那一小节（读者还在那一节里）也不动：页面在最上面的时候就是这样，不把这一站的标题和抬头滚走。
    // 页面快滚到底的那一截里，阅读线自己是跟着滚动挪的（见 readingLine）：正文往上滚多少，它就往下挪多少。
    // 要滚多少是把它这一挪也算进去的（见下面 reach），滚完以后阅读线还在刚才那一小节里；
    // 最后多滚的那一小截阅读线也跟着挪，所以在这一截里，头或者尾离阅读线是一小截到两小截（16 到 32 像素上下：浏览器按整像素滚，会差出一个像素）。
    const shape = window.matchMedia(WIDE_SCREEN);
    const reshaped = (): void => {
      const el = root.current;
      if (!el || now(el) === last) return;
      // 还没有报过哪一小节（last 是 null）、或者那一小节已经不在正文里：找不到，什么也不动。
      const box = nodes(el)
        .find((item) => item.dataset.section === last)
        ?.getBoundingClientRect();
      if (box) {
        const high = window.innerHeight;
        // 把窗口里 at 这个高度的地方摆到阅读线上要滚多少：离页面的底还远，阅读线不动；快到底了，阅读线自己也跟着挪，两头各走一半。
        const reach = (at: number): number => Math.min(at - readingLine(high, visibleTextTop(el)), (at - high + remainingScroll(document.documentElement.scrollHeight, high, window.scrollY)) / 2);
        const head = reach(box.top);
        window.scrollBy(0, head < 0 ? reach(box.bottom) - BRING_BACK_GAP_PX : head + BRING_BACK_GAP_PX);
      }
      schedule();
    };
    shape.addEventListener('change', reshaped);
    // 版面自己的高矮变了（点开小注或原文、图片晚到、窄屏上沙盘栏收起或展开把正文顶上顶下），标题的位置跟着变，也重新看一遍。
    const watcher = typeof ResizeObserver === 'function' ? new ResizeObserver(schedule) : null;
    const watched = watcher ? (root.current?.closest(LAYOUT_SELECTOR) ?? root.current) : null;
    if (watcher && watched) watcher.observe(watched);
    return () => {
      cancelAnimationFrame(frame);
      dwell.stop();
      watcher?.disconnect();
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      shape.removeEventListener('change', reshaped);
    };
  }, [active, root]);
}

/** 看得见正文的那一块从窗口的哪里开始：沙盘栏在正文上面时是它的下边，在正文旁边（宽屏）时是 0。 */
function visibleTextTop(text: HTMLElement): number {
  const pane = document.querySelector(PANE_SELECTOR);
  if (!pane) return 0;
  const paneBox = pane.getBoundingClientRect();
  const textBox = text.getBoundingClientRect();
  const above = paneBox.left < textBox.right && paneBox.right > textBox.left;
  return above ? Math.max(0, Math.min(paneBox.bottom, window.innerHeight)) : 0;
}
