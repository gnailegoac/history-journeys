// 全程沙盘的一小节里，哪几趟路画、算哪一种。只有这一处算：画线的程序（src/stage/roadLines.ts 的 journeyStates）
// 和沙盘旁边“哪些是示意”那句话里“这一节没有画的路”（./sceneText.ts 的 notShown）用的都是它，别处不另定。
// 规矩在 docs/data-spec.md“哪一节画哪些路”。照的是 roads.journeys 里写的先后（写的先后就是走的先后），不是站的先后：
// 一站分两段讲、中间去过别的站的时候，“这一站排在前面”说不出哪几趟已经走过了。

import type { RouteScene } from './scene';

/**
 * 一趟路在一小节里算哪一种：whole 是没有写 stop 的小节（全程）里的每一趟；own 是这一站自己的（这一趟的 stop 就是这一节的 stop）；
 * before 是走过的（写在这一站自己的最后一趟前面，又不是这一站自己的）。
 */
export type JourneyShown = 'whole' | 'own' | 'before';

/** 第 section 节（从 0 数起）里每一趟路算哪一种，照 roads.journeys 的先后一趟一个；这一节不画的是 undefined。 */
export function journeysShown(scene: RouteScene, section: number): (JourneyShown | undefined)[] {
  const stops = scene.roads.journeys.map((journey) => journey.stop);
  const stop = scene.sections[section]?.stop;
  if (stop === undefined) return stops.map(() => 'whole');
  const last = stops.lastIndexOf(stop);
  return stops.map((written, i) => (written === stop ? 'own' : i < last ? 'before' : undefined));
}
