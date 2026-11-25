// 四种标准的画面：电脑、横着拿的平板、竖着拿的平板、竖着拿的大平板（docs/data-spec.md“题签摆在哪”）。
// 竖着拿的大平板（1024 × 1366，12.9 英寸的 iPad）有 960 像素以上宽，可它是竖着的，版面照竖着拿的平板排：沙盘在上，占屏幕高度的 56%。
// 每一种写四样：浏览器的窗口多大；这时沙盘栏多大；页面让沙盘上、下各留出多少（上面是一排按钮，下面是题记）。
// 后三个数是在浏览器里量出来的，只在这里写一次，两头都从这里取：
//   tests/stage/scene-strips.test.ts   在 Node 里照这几个数摆题签，一条也不能少；
//   tests/e2e/pane-boxes.spec.ts       到真的页面上再量一遍，量到的要和这里一样。
// 页面的样式动了这几个数（按钮高了、题记高了、栏宽变了），后一项就通不过：那时先想清楚是不是有意的，
// 有意的才改这里，然后题签的测试、定格图（STILLS_OUT=content/figures npm run stills）都要跟着重来。

import type { StageInsets } from '../../../src/stage/types';

export interface StandardPane {
  /** 名字就是沙盘栏的大小，印在测试的标题里。 */
  name: string;
  /** 浏览器的窗口（CSS 像素）。 */
  window: { width: number; height: number };
  /** 这时的沙盘栏（.stage-pane，连它的一像素边线）。 */
  size: { width: number; height: number };
  /** 页面让沙盘四边各留出多少。 */
  insets: StageInsets;
}

const leave = (top: number, bottom: number): StageInsets => ({ top, right: 0, bottom, left: 0 });

/**
 * 按钮下面多一行话的时候（放的是图片的那一档；写好了正文、还没有自己的沙盘的一站），上面要多留出那一行：
 * 沙盘栏的名字 → 上面留多少。四种标准的沙盘栏和下面 UPRIGHT_PANES 的几种都有。
 * tests/e2e/pane-boxes.spec.ts 到页面上量的也要是这几个数。
 */
export const NOTICE_ROW_TOP: Readonly<Record<string, number>> = {
  '940 × 900': 96,
  '584 × 768': 96,
  '768 × 573': 84,
  '1024 × 765': 84,
  '744 × 634': 84,
  '800 × 717': 84,
  '810 × 605': 84,
  '820 × 661': 84,
  '834 × 669': 84,
};

export const STANDARD_PANES: readonly StandardPane[] = [
  { name: '940 × 900', window: { width: 1440, height: 900 }, size: { width: 940, height: 900 }, insets: leave(62, 130) },
  { name: '584 × 768', window: { width: 1024, height: 768 }, size: { width: 584, height: 768 }, insets: leave(62, 130) },
  { name: '768 × 573', window: { width: 768, height: 1024 }, size: { width: 768, height: 573 }, insets: leave(54, 131) },
  { name: '1024 × 765', window: { width: 1024, height: 1366 }, size: { width: 1024, height: 765 }, insets: leave(54, 131) },
];

/**
 * 首页的沙盘栏，同样四种窗口上。首页摆的是人物页的那一栏、那一座全程沙盘，看的是头一节（全程）。
 * 宽屏上首页的文字栏比人物页的宽（窗口的 46%，最窄 464、最宽 640 像素），沙盘栏就窄一些：电脑上 800 × 900，
 * 横着拿的平板上 553 × 768（栏不到 584 像素宽，题记是窄的那一种，下面留的空就少；题签也是小的那一种）。沙盘在上的两种窗口上和人物页一模一样。
 * 这几个数也是在浏览器里量出来的：tests/e2e/pane-boxes.spec.ts 到首页上再量一遍；
 * tests/stage/route-views.test.ts 照它们查“全程”那一节的题签在首页上也都摆得下。
 */
export const HOME_PANES: readonly StandardPane[] = [
  { name: '800 × 900', window: { width: 1440, height: 900 }, size: { width: 800, height: 900 }, insets: leave(62, 130) },
  { name: '553 × 768', window: { width: 1024, height: 768 }, size: { width: 553, height: 768 }, insets: leave(62, 94) },
  STANDARD_PANES[2],
  STANDARD_PANES[3],
];

/**
 * 别的竖着拿的平板（不到 960 像素宽的几种常见的：7.9、10、10.2、10.9、11 英寸）。沙盘在上，占屏幕高度的 56%，上下留的空和 768 × 573 那一种一样；
 * 屏幕越扁，留给沙盘的那一块越矮，“全程”那一节的沙盘就越小，题签最挤——768 × 573 不是最挤的一种（最挤的是 810 × 605 上面多一行话的时候）。
 * tests/stage/route-views.test.ts 照它们查“全程”那一节的题签：一条不少，引线不超过 48 像素，站名不站到别的站那一边去；
 * tests/e2e/pane-boxes.spec.ts 到人物页上再量一遍这几个数。
 */
export const UPRIGHT_PANES: readonly StandardPane[] = [
  { name: '744 × 634', window: { width: 744, height: 1133 }, size: { width: 744, height: 634 }, insets: leave(54, 131) },
  { name: '800 × 717', window: { width: 800, height: 1280 }, size: { width: 800, height: 717 }, insets: leave(54, 131) },
  { name: '810 × 605', window: { width: 810, height: 1080 }, size: { width: 810, height: 605 }, insets: leave(54, 131) },
  { name: '820 × 661', window: { width: 820, height: 1180 }, size: { width: 820, height: 661 }, insets: leave(54, 131) },
  { name: '834 × 669', window: { width: 834, height: 1194 }, size: { width: 834, height: 669 }, insets: leave(54, 131) },
];

// ---------------------------------------------------------------- 带着时间轴的栏（人物页、首页）
//
// 人物页和首页的沙盘栏摆的是全程沙盘，题记上面多一条时间轴（96 像素，tokens.css 的 --stage-bar-h）。量到的样子：
//   左右排的版面（电脑、横着拿的平板）：栏还是那么大，下面多留 96 像素——沙盘的那一块矮了 96 像素；
//   沙盘在上的版面（竖着拿的平板）：栏高出 96 像素（屏幕的 56% 再加一条时间轴），下面也多留 96 像素——沙盘的那一块和没有时间轴时一样大。
// 所以下面的几组就是上面各组加上这一条。上面的各组一个数不动：一站自己的沙盘、还没有自己的沙盘的一站的页面（摆的是全程沙盘，没有时间轴）照它们查。
// tests/e2e/pane-boxes.spec.ts 到人物页、首页上量的要和这里一样；全程沙盘的定格图也是照这几种栏拍的（tests/e2e/still-layout.spec.ts）。

/** 时间轴那一条的高（像素）。 */
export const BAR_BAND_PX = 96;

/**
 * 读者在只放图片的时候点了“试试立体的沙盘”，按钮下面那一行话留着（“设备慢的话，可以换回图片”）。带着时间轴的栏上，这时候上面再多留这么多像素：
 * 小像（三十来像素高）站在最北边的那一处，整个都在这一行话的下面（stage.css 的 --notice-head）。
 */
export const NOTICE_HEAD_PX = 36;

/** 一种栏带上时间轴以后的样子。名字后面加“，带时间轴”（沙盘在上的那几种，名字里的高也是加高以后的）。 */
function withBar(pane: StandardPane): StandardPane {
  const wide = pane.window.width >= 960 && pane.window.width > pane.window.height;
  const size = wide ? pane.size : { width: pane.size.width, height: pane.size.height + BAR_BAND_PX };
  return { name: `${size.width} × ${size.height}，带时间轴`, window: pane.window, size, insets: leave(pane.insets.top, pane.insets.bottom + BAR_BAND_PX) };
}

/** 人物页的沙盘栏，四种标准的窗口上。 */
export const ROUTE_PANES: readonly StandardPane[] = STANDARD_PANES.map(withBar);
/** 首页的沙盘栏，同样四种窗口上（沙盘在上的两种和人物页的一模一样）。 */
export const ROUTE_HOME_PANES: readonly StandardPane[] = [withBar(HOME_PANES[0]), withBar(HOME_PANES[1]), ROUTE_PANES[2], ROUTE_PANES[3]];
/** 别的竖着拿的平板上人物页的沙盘栏。 */
export const ROUTE_UPRIGHT_PANES: readonly StandardPane[] = UPRIGHT_PANES.map(withBar);

/** 带着时间轴的栏，按钮下面多一行话的时候上面留多少：和不带时间轴的那一种一样（栏的名字 → 上面留多少）。 */
export const ROUTE_NOTICE_ROW_TOP: Readonly<Record<string, number>> = Object.fromEntries(
  [...STANDARD_PANES, ...UPRIGHT_PANES].map((pane) => [withBar(pane).name, NOTICE_ROW_TOP[pane.name]] as const),
);
