// 时代样式，在 Node 里跑的测试和做图的工具怎么拿到：页面上是摆写着它的沙盘时才下载（src/stage/three/view.ts），
// 这里一开头就照登记表（src/stage/styles.ts）把每一种都取来，styleFor 不用等就给。
// 取的就是登记表里那一行的那一份：和页面上沙盘拿到的是同一个东西，不另抄一张表。
// 要摆沙盘的测试（造 ThreeStopView 的）另要把登记表交给沙盘程序：provideStyles(STYLES)，和页面那一边做的一样（src/stage/index.ts）。

import type { BlankEdge } from '../../../src/stage/ground/route';
import { STYLES } from '../../../src/stage/styles';
import type { StageStyle } from '../../../src/stage/three/internal';

const loaded = new Map<string, StageStyle>();
for (const entry of STYLES) loaded.set(entry.id, (await entry.load()).style);

/** 登记表里有哪几种样式（名字），照表里的先后。 */
export const STYLE_IDS: readonly string[] = STYLES.map((entry) => entry.id);

/** id 这种样式。登记表里没有的，说一句就停。 */
export function styleFor(id: string): StageStyle {
  const style = loaded.get(id);
  if (!style) throw new Error(`样式“${id}”登记表里没有（src/stage/styles.ts）；有的是：${STYLE_IDS.join('、')}`);
  return style;
}

/**
 * id 这种样式里留白的边怎么收（全程沙盘才有）：造全程沙盘的地面要交给它（src/stage/ground/route.ts 的 buildRouteGround），
 * 沙盘程序摆的时候交的就是这一份（src/stage/three/view.ts 的 buildRouteParts）。这种样式摆不了全程沙盘的，说一句就停。
 */
export function blankEdgeFor(id: string): BlankEdge {
  const edge = styleFor(id).route?.blank;
  if (!edge) throw new Error(`样式“${id}”里没有全程沙盘的那一份`);
  return edge;
}
