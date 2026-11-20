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

export const STANDARD_PANES: readonly StandardPane[] = [
  { name: '940 × 900', window: { width: 1440, height: 900 }, size: { width: 940, height: 900 }, insets: leave(62, 130) },
  { name: '584 × 768', window: { width: 1024, height: 768 }, size: { width: 584, height: 768 }, insets: leave(62, 130) },
  { name: '768 × 573', window: { width: 768, height: 1024 }, size: { width: 768, height: 573 }, insets: leave(54, 131) },
  { name: '1024 × 765', window: { width: 1024, height: 1366 }, size: { width: 1024, height: 765 }, insets: leave(54, 131) },
];
