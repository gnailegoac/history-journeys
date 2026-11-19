// 沙盘栏带着每一小节的图片（定格图）时，浏览器测试共用的小工具（pane-stills.spec.ts 和 shots.spec.ts 用）。
// 沙盘和图片用的都是替身：?stage=fake… 是沙盘的替身，?sectionstills=fake… 是定格图的替身
//（各个开关的意思见 src/ui/stageEngineSource.ts、src/ui/dev/fakeStage.ts、src/ui/dev/fakeStill.ts）。

import { expect } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { stagePane } from './helpers';

/** 设计里定下来的几句话和按钮上的字，照原样抄在这里：src/ui/text.ts 里的字被改动了，测试要红。 */
export const PANE_SAYS = {
  loading: '沙盘正在摆出来，要等一会儿…',
  unsupported: '这个浏览器画不出立体的沙盘，这里放的是图片。',
  slow: '立体的沙盘在这台设备上太慢，这里放的是图片。',
  only: '这里放的是沙盘的图片，不能转动。',
  lost: '沙盘的画面断了，这里先放图片。',
  failed: '沙盘没能摆出来，这里先放图片。',
  asked: '设备慢的话，可以换回图片。',
  tryTable: '试试立体的沙盘',
  back: '换回图片',
  rebuild: '重新摆出来',
  retry: '再试一次',
  reset: '回到这一节',
  tooOld: '这个浏览器太旧，打不开这个网站。换一个新一点的浏览器再来看。',
  /** 页面的程序没取到（网络的事，不是浏览器旧）。 */
  cut: '网页没有加载完整，刷新一下再试。',
} as const;

/** 沙盘栏的几种状态在替身上怎么打开：地址里“?”后面的那一串。states 3 到 6 是设计里那张表的编号。 */
export const PANE_QUERIES = {
  /** 状态 1：图片先出来，沙盘隔 4 秒才报告摆好（留出工夫看图片垫着的时候是什么样）。 */
  stillFirst: 'stage=fake&sectionstills=fake&readygap=4000',
  /** 状态 3：浏览器画不了。 */
  unsupported: 'stage=fake-unsupported&sectionstills=fake',
  /** 状态 4：这台设备太慢（头两座替身都还没摆好就说慢）。 */
  slow: 'stage=fake&slow=start2&sectionstills=fake',
  /** 状态 4c：地址里指定了只放图片。 */
  only: 'stage=fake&tier=still&sectionstills=fake',
  /** 状态 5 的起点：摆好的沙盘，再在页面里按“断掉画面”。 */
  ready: 'stage=fake&sectionstills=fake',
  /** 状态 6：沙盘没摆出来。 */
  failed: 'stage=fake-fail&sectionstills=fake',
} as const;

/** 一站的地址，带着地址里的开关。 */
export function stopUrl(query: string, figureId: string, stopId: string): string {
  return `/?${query}#/${figureId}/${stopId}`;
}

/** 定格图的替身（下面那一层里的）。 */
export function fakeStill(page: Page): Locator {
  return page.locator('.stage-still-host .fake-still');
}

/** 按钮下面的那一行话。 */
export function notice(page: Page): Locator {
  return page.locator('.stage-says .stage-notice');
}

/** 等沙盘栏到这一种状态，并且放着这一种画面（table 立体的沙盘，still 图片，none 都没有）。 */
export async function expectPane(page: Page, state: string, picture: 'table' | 'still' | 'none'): Promise<void> {
  await expect(stagePane(page)).toHaveAttribute('data-stage-state', state);
  await expect(stagePane(page)).toHaveAttribute('data-stage-picture', picture);
}

/** 图片上现在挂着的题签：id 和字，按挂的先后。 */
export async function stripsOnStill(page: Page): Promise<{ id: string; text: string }[]> {
  return page.locator('.stage-still-host .strip').evaluateAll((strips) => strips.map((strip) => ({ id: strip.getAttribute('data-strip-id') ?? '', text: strip.textContent ?? '' })));
}

/** 那一排按钮里看得见的几个，各自的字和上边的位置。 */
export async function controlRows(page: Page): Promise<{ text: string; top: number }[]> {
  return page.locator('.stage-controls button').evaluateAll((buttons) =>
    buttons
      .filter((button) => button.getClientRects().length > 0)
      .map((button) => ({ text: button.textContent ?? '', top: Math.round(button.getBoundingClientRect().top) })),
  );
}

/**
 * 这几个按钮是不是排在一行里：上边差不到半个按钮的高（古名今名在一个带边的框里，比旁边的按钮低一个像素，不算折行；
 * 真折到第二行，上边要差出一整个按钮的高）。
 */
export function inOneRow(buttons: { top: number }[]): boolean {
  const tops = buttons.map((button) => button.top);
  return tops.length > 0 && Math.max(...tops) - Math.min(...tops) < 22;
}

/**
 * 沙盘栏里现在的几个尺寸（像素）：栏多高；那一行话多高、下边在哪（从栏的上边量）；
 * 页面告诉图片上下各留出多少；留出来的中间那一块（放画面的地方）多高；那一行话有没有被截掉。
 */
export async function paneMeasures(page: Page): Promise<{ paneHeight: number; noticeHeight: number; noticeBottom: number; insetTop: number; insetBottom: number; free: number; noticeCut: boolean }> {
  return page.evaluate(() => {
    const pane = document.querySelector('.stage-pane');
    const line = document.querySelector('.stage-notice');
    const words = document.querySelector('.stage-notice p');
    const still = document.querySelector('.fake-still');
    if (!pane || !line || !words || !still) throw new Error('沙盘栏里没有那一行话，或者没有图片');
    const paneBox = pane.getBoundingClientRect();
    const lineBox = line.getBoundingClientRect();
    const insets = (still.getAttribute('data-fake-still-insets') ?? '').split(' ').map(Number);
    return {
      paneHeight: paneBox.height,
      noticeHeight: lineBox.height,
      noticeBottom: Math.round(lineBox.bottom - paneBox.top),
      insetTop: insets[0],
      insetBottom: insets[2],
      free: paneBox.height - insets[0] - insets[2],
      noticeCut: words.scrollWidth > words.clientWidth + 1,
    };
  });
}

/**
 * 从现在起，放画面的那一块每挂上一次“沙盘正盖着图片显出来”的类，就当场记一笔：
 * 这时候图片上的题签是不是藏着，沙盘那一层是不是在慢慢显（有没有过渡的时间）。用 handOvers 取回来。
 * 要在沙盘摆好之前叫。
 */
export async function watchHandOver(page: Page): Promise<void> {
  await page.evaluate(() => {
    const canvas = document.querySelector('.stage-canvas');
    if (!canvas) throw new Error('页面上没有放画面的那一块');
    const seen: HandOver[] = [];
    const target = window as Window & { __handOvers?: HandOver[] };
    target.__handOvers = seen;
    let on = false;
    new MutationObserver(() => {
      const now = canvas.classList.contains('is-handing-over');
      if (now && !on) {
        const strips = canvas.querySelector('.stage-still-host .strips');
        const host = canvas.querySelector('.stage-host');
        seen.push({
          stillStrips: strips ? getComputedStyle(strips).visibility : 'none',
          fade: host ? getComputedStyle(host).transitionDuration : '',
          picture: document.querySelector('.stage-pane')?.getAttribute('data-stage-picture') ?? '',
        });
      }
      on = now;
    }).observe(canvas, { attributes: true, attributeFilter: ['class'] });
  });
}

/** watchHandOver 记下的一笔。 */
export interface HandOver {
  /** 图片上题签那一层的 visibility（没有那一层是 none）。 */
  stillStrips: string;
  /** 沙盘那一层的 transition-duration。 */
  fade: string;
  /** 这一刻沙盘栏说自己放着的是什么。 */
  picture: string;
}

export async function handOvers(page: Page): Promise<HandOver[]> {
  return page.evaluate(() => (window as Window & { __handOvers?: HandOver[] }).__handOvers ?? []);
}
