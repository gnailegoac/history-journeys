// 时代样式，在 Node 里跑的测试和做图的工具怎么拿到：页面上是摆写着它的沙盘时才下载（src/stage/three/view.ts），
// 这里一开头就照登记表（src/stage/styles.ts）把每一种都取来，styleFor 不用等就给。
// 取的就是登记表里那一行的那一份：和页面上沙盘拿到的是同一个东西，不另抄一张表。
// 要摆沙盘的测试（造 ThreeStopView 的）另要把登记表交给沙盘程序：provideStyles(STYLES)，和页面那一边做的一样（src/stage/index.ts）。
//
// 登记表里的一行可以没有 load（只有全程沙盘用的样式，它只有每一座沙盘都用的那一半）：这样的一行取的是它仅有的那一半。
// 写着它的只会是全程沙盘（校验的规则 10 不让站点沙盘写它），全程沙盘的测试读的都是两半都有的东西（灯、雾、座子、route）。
// styleFor 交出来的类型都是整套的（一百来处站点沙盘的测试照整套用它）；拿那一半去读站点沙盘才有的东西（ground、figure、stripLift），
// 读到的是 undefined——要分清的地方先问 WHOLE_STYLE_IDS。

import type { BlankEdge } from '../../../src/stage/ground/route';
import { STYLES } from '../../../src/stage/styles';
import type { StageStyle } from '../../../src/stage/three/internal';
import type { StyleEntry } from '../../../src/stage/three/style';

/**
 * rows 这张表里每一种样式，测试拿到的那一份：有 load 的取整套；没有 load 的取它仅有的那一半（见文件开头）。
 * 哪一行都不叫它没有的取法：一行没有 load 不是错，不会在这里停下。
 */
export async function loadStyles(rows: readonly StyleEntry[]): Promise<Map<string, StageStyle>> {
  const out = new Map<string, StageStyle>();
  for (const row of rows) out.set(row.id, row.load ? (await row.load()).style : ((await row.loadRoute()).style as StageStyle));
  return out;
}

const loaded = await loadStyles(STYLES);

/** 登记表里有哪几种样式（名字），照表里的先后。 */
export const STYLE_IDS: readonly string[] = STYLES.map((entry) => entry.id);

/** 登记表里整套的样式（那一行有 load，站点沙盘能写的那几种），照表里的先后。 */
export const WHOLE_STYLE_IDS: readonly string[] = STYLES.filter((entry) => entry.load).map((entry) => entry.id);

/** id 这种样式。登记表里没有的，说一句就停。只有全程沙盘用的样式，交出来的是它仅有的那一半（见文件开头）。 */
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
