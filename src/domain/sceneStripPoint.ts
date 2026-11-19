// 一条题签指着的那一点。只有沙盘程序用（摆镜头、摆模型时），页面不用，所以单放一个文件，
// 不放在 ./sceneText.ts 里（页面要引那个文件），也不从 ./index.ts 转出去。只算数，不改传进来的场景。

import type { SceneStrip, StopScene } from './scene';
import { farEdgePoint } from './sceneGeo';
import type { LngLat } from './types';

/** 一条题签指着的那一点：写了 at 就是 at；没写，是它指的那样东西的位置；指着远处时，是沙盘边上朝着它的那一点。 */
export function stripPoint(scene: StopScene, strip: SceneStrip): LngLat {
  if (strip.at) return [strip.at[0], strip.at[1]];
  const far = scene.far.find((f) => f.id === strip.of);
  if (far) return farEdgePoint(scene.frame, far.at).point;
  const isTarget = (item: { id: string }) => item.id === strip.of;
  const at = scene.things.find(isTarget)?.at ?? scene.places.find(isTarget)?.at ?? scene.water.rapids.find(isTarget)?.at ?? scene.dressing.find(isTarget)?.at;
  if (!at) throw new Error(`题签“${strip.id}”没有写 at，它指的“${strip.of}”也不是只有一个点的东西，不知道该指在哪`);
  return [at[0], at[1]];
}
