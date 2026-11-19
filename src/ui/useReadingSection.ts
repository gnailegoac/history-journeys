// 读者正读到哪一小节。沙盘的镜头跟着它走。
//
// 办法：看得见正文的那一块（窄屏上沙盘钉在顶上，要从沙盘的下边算起）里，从上往下 42% 的地方有一条“阅读线”；
// 标题已经过了这条线的最后一个小节，就是正在读的。页面快滚到底时，这条线跟着往下挪到底边，
// 最后几个短的小节才轮得到。整页短得不用滚的时候没有这回事，就是第一节。
// 一个小节要连着当上 150 毫秒才往上报：滚得快、一掠而过的小节不报，沙盘不用跟着乱转（见 dwellReporter）。
// 滚动、窗口大小变了、正文自己的高矮变了（点开小注、原文，图片晚到）都重新看一遍。

import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';

/** 阅读线在看得见正文的那一块里，从上往下的几成。 */
export const READING_LINE = 0.42;
/** 一个小节要连着当上这么久（毫秒）才往上报。 */
export const READING_DWELL_MS = 150;

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
 */
export function useReadingSection(root: RefObject<HTMLElement | null>, active: boolean, onSection: (section: string) => void): void {
  const report = useRef(onSection);
  useEffect(() => {
    report.current = onSection;
  }, [onSection]);

  useEffect(() => {
    if (!active) return;
    let frame = 0;
    const dwell = dwellReporter<number>((section) => report.current(section), {
      set: (run, ms) => window.setTimeout(run, ms),
      clear: (id) => window.clearTimeout(id),
    });

    const pick = () => {
      frame = 0;
      const el = root.current;
      if (!el) return;
      const marks = Array.from(el.querySelectorAll<HTMLElement>('[data-section]'), (node) => ({
        section: node.dataset.section ?? '',
        top: node.getBoundingClientRect().top,
      }));
      const remaining = remainingScroll(document.documentElement.scrollHeight, window.innerHeight, window.scrollY);
      dwell.see(pickSection(marks, readingLine(window.innerHeight, visibleTextTop(el), remaining)));
    };

    // 滚动时一帧最多看一次。
    const schedule = () => {
      if (frame === 0) frame = requestAnimationFrame(pick);
    };

    schedule();
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
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
