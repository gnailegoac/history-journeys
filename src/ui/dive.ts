// 从全程沙盘到一站自己的沙盘：先潜下去，再换页。
// 读者在摆着全程沙盘的页面上（首页、人物页、没有自己的沙盘的一站）点了一个通到“有自己的沙盘的一站”的站内链接，
// 镜头先从现在的地方潜到那一站的上空（沙盘程序的 dive），最后一小段画面淡进栏的底色里（stage.css），潜完才把地址换成链接上写的那一个。
// 别的情形一概照旧：一点就换。规矩在 diveStop；先后（到点了一定放行、点第二下、点别的链接、按返回）在 watchDives。
// 这里不碰沙盘栏的组件，窗口也是交进来的：在 Node 里就能查（tests/unit/dive.test.ts）。

import { parseHash } from '../app/router';
import { hasStopTable, loadStopTable } from '../domain';
import { DIVE_GUARD_MS, DIVE_MS } from './diveClock';

export { DIVE_GUARD_MS, DIVE_MS };
/** 地址换过去以后过了这么久（毫秒），这一栏居然还在：把它恢复原样。 */
const DIVE_RECOVER_MS = 600;

/** 点下去的那一刻，沙盘栏是什么样。 */
export interface DivePane {
  /** 栏里摆着一座活的、摆好了的全程沙盘（立体的，不是图片），而且它会潜。 */
  ready: boolean;
  /** 窄屏上收起来了。 */
  tucked: boolean;
  /** 系统设置了“减少动态效果”。 */
  calm: boolean;
  /** 开关开着（?dive=none 是关；沙盘的替身要 ?dive=1 才开）。 */
  on: boolean;
}

/** 点的那一下，只用到这几样。 */
export type DiveClick = Pick<MouseEvent, 'defaultPrevented' | 'button' | 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey' | 'target'>;

/** 这一下点在哪个站内链接上：返回它的地址（“#/…”）。不是站内链接、或者写了要在别处打开，是 null。 */
export function linkHash(event: DiveClick): string | null {
  const link = (event.target as Element | null)?.closest?.('a[href^="#"]');
  return link && !link.getAttribute('target') ? link.getAttribute('href') : null;
}

/** 平常的一点：左键或者手指、回车，没按着别的键，也没有被别人拦下。 */
const plain = (event: DiveClick): boolean => !(event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey);

/**
 * 这一下要不要潜：要就返回潜到哪一站、链接上的地址。
 * 要潜的只有一种：平常的一点（左键或者手指、回车，没按着别的键），点在通到同一位人物、有自己的沙盘的一站的站内链接上，
 * 而且栏里的全程沙盘摆好了、没收起来、系统没说要少动、开关开着。
 */
export function diveStop(event: DiveClick, figureId: string, pane: DivePane): { stop: string; hash: string } | null {
  if (!pane.on || !pane.ready || pane.tucked || pane.calm) return null;
  if (!plain(event)) return null;
  const hash = linkHash(event);
  if (hash === null) return null;
  const to = parseHash(hash);
  return to.page === 'stop' && to.figureId === figureId && hasStopTable(figureId, to.stopId) ? { stop: to.stopId, hash } : null;
}

/** 沙盘栏那一边要做的几样。 */
export interface DiveHost {
  pane(): DivePane;
  /** 叫沙盘潜到这一站上空；栏里没有会潜的沙盘是 null。 */
  dive(stop: string, ms: number): Promise<boolean> | null;
  /** 正在往哪一站潜（写在栏的 data-stage-dive 上）；null 是不潜了。 */
  mark(stop: string | null): void;
  /** 那一站的场景、图片的清单和头一张图片，现在就去取。 */
  preload(stop: string): void;
  /** 没有换到那一站就不潜了（读者按了返回、点了别的链接）：沙盘回到原来的小节。 */
  back(): void;
}

/** watchDives 用到的窗口上的几样。 */
export type DiveWindow = Pick<Window, 'addEventListener' | 'removeEventListener' | 'setTimeout' | 'clearTimeout'> & { location: { hash: string } };

/** 最近一次潜完换过去的是哪一座沙盘、什么时候：那一站的头一张图片据此淡着出来。 */
const arrival = { key: '', at: 0 };

/** 读者是不是刚从全程沙盘潜到这一座沙盘（三秒以内）。 */
export function cameByDive(key: string): boolean {
  return arrival.key === key && Date.now() - arrival.at < 3000;
}

/**
 * 听这位人物的页面上的点击，该潜的就潜。返回两样：end() 收掉监听和定时器（沙盘栏拿走时叫；正在潜的话马上放行）；
 * hurry() 是沙盘中途不行了（嫌慢），正在潜的话马上放行。
 * 先后：点下去 → 不让浏览器换地址，叫沙盘潜，栏上写 data-stage-dive，那一站的东西开始取 → 潜完（或者沙盘半路停了、到点了还没回话）→ 换地址。
 * 正在潜的时候：同一个链接再点，什么也不变；点别的链接，不潜了，照那个链接走；地址自己变了（返回、前进），不潜了，不再去动地址
 *（放行之前再看一眼地址还是不是点下去时的那一个）。
 */
export function watchDives(figureId: string, host: DiveHost, win: DiveWindow = window): { end(): void; hurry(): void } {
  let run: { hash: string; from: string; timer: number } | null = null;
  let recover = 0;

  /** 不潜了，地址不动。 */
  const drop = (): void => {
    if (!run) return;
    win.clearTimeout(run.timer);
    run = null;
    host.mark(null);
    host.back();
  };

  /** 放行：把地址换成链接上写的。栏上的记号留着（画面已经淡掉了，拿掉它画面会闪回来），栏随后就被换掉。 */
  const go = (mine: { hash: string; from: string; timer: number; stop: string }): void => {
    if (run !== mine) return;
    // 地址已经不是点下去时的那一个（读者按了返回）：听他的。这一句不能只靠下面的 hashchange——
    // 页面换页的那一边先收到通知、先叫沙盘去别的小节，沙盘“潜的那一趟被顶掉了”的回话会抢在这里收到通知之前到
    if (win.location.hash !== mine.from) return drop();
    win.clearTimeout(mine.timer);
    run = null;
    arrival.key = `${figureId}/${mine.stop}`;
    arrival.at = Date.now();
    win.location.hash = mine.hash;
    recover = win.setTimeout(() => {
      host.mark(null);
      host.back();
    }, DIVE_RECOVER_MS);
  };

  let hurry = (): void => {};

  const onClick = (event: MouseEvent): void => {
    if (run) {
      // 按着别的键点的（要在新标签页里打开）：这一页哪儿也不去，照旧潜
      if (!plain(event)) return;
      const hash = linkHash(event);
      if (hash === run.hash) event.preventDefault();
      else if (hash !== null) drop();
      return;
    }
    const to = diveStop(event, figureId, host.pane());
    const done = to && host.dive(to.stop, DIVE_MS);
    if (!to || !done) return;
    event.preventDefault();
    win.clearTimeout(recover);
    const mine = { ...to, from: win.location.hash, timer: win.setTimeout(() => go(mine), DIVE_GUARD_MS) };
    run = mine;
    hurry = () => go(mine);
    host.mark(to.stop);
    host.preload(to.stop);
    done.then(hurry, hurry);
  };

  win.addEventListener('click', onClick);
  win.addEventListener('hashchange', drop);
  // 读者离开了这个网站（按返回退到别的网站去了）：不潜了。浏览器可能把这一页原样存着，
  // 他再按前进回来的时候，不该被一个还没走完的定时器送到那一站去
  win.addEventListener('pagehide', drop);
  return {
    end() {
      win.removeEventListener('click', onClick);
      win.removeEventListener('hashchange', drop);
      win.removeEventListener('pagehide', drop);
      win.clearTimeout(recover);
      const left = run;
      run = null;
      if (!left) return;
      win.clearTimeout(left.timer);
      // 还在潜，栏就被拿走了，地址却没有变（现在的页面上读者做不出这件事：把沙盘收起来、转屏都不拿走这一栏，
      // 照旧潜完才换；留着是为了以后栏因为别的缘故被换掉时不把读者卡住）：那一下点击已经被拦下，读者要去的地方照样去。
      // 地址已经不是点下去时的那一个（页面正在换页）：不动
      if (win.location.hash === left.from) win.location.hash = left.hash;
    },
    hurry: () => hurry(),
  };
}

/**
 * 读者正往一站去：那一站的场景、图片的清单先取来，再把头一节的那一张图片取来，栏换过去的时候图片已经在了。
 * shape 是现在的排法（宽的还是窄的，沙盘栏上的 --stage-shape）；没说就取清单里头一节的头一张。取不到不算事。
 */
export function preloadStop(figureId: string, stop: string, shape: string): void {
  loadStopTable(figureId, stop)
    .then((found) => {
      const first = found?.scene.sections[0]?.heading;
      const stills = found?.stills;
      const file = stills?.manifest.stills.find((s) => s.section === first && (!shape || s.shape === shape))?.file;
      const url = file && stills?.urls[file];
      if (url && typeof Image === 'function') new Image().src = url;
    })
    .catch(() => {});
}
