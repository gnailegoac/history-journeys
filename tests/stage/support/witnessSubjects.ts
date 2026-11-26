// 凭证比的那几样东西，现在各从沙盘程序的哪里取、怎么造出来：座子，全程沙盘的地面，路的笔画，画路的程序画出来的线，小像。
// 座子、笔画、画出来的线、小像在沙盘程序的哪个文件里、叫什么名字，写在这个文件里。全程沙盘的场景、范围、地面和取高度的函数
// 不是这里造的：从 ./realScenes.ts 的 realRouteScene 取（场景验收的别的测试也用它），地面是那里叫沙盘程序算出来的；
// 造座子要的假页面在 ./fakeRenderer.ts（凭证的测试自己装上）。以后搬了地方、换了叫法（一种样式自己的东西搬出沙盘程序，
// 座子的造法搬进样式，留白的几个数改成从样式里取，样式改成用到时才取，笔画多带一样东西……），改的是这里的几行引入和调用，
// 和 realScenes.ts 里造地面的那一句；凭证的测试（../su-shi-witness.test.ts）、存着的那一份（../su-shi-witness.json）
// 和怎么比（./witness.ts）不动——那三个文件在改动里原样不动，才看得出造出来的东西没有变。
// 所以这里和 realScenes.ts 里造地面的地方都只许做一件事：把沙盘程序造出来的东西原样交出去。不在这两处补数、换数、挑着给；
// 查一次改动有没有动到凭证，这两个文件（和 fakeRenderer.ts）的改动都要一行一行看。
// 每个函数都是“等一下再给”的写法（async）：样式哪一天改成用到时才取，这里等它，测试不用改。

import type { Object3D } from 'three';
import type { RouteScene, TableScene } from '../../../src/domain/scene';
import type { FrameCoords } from '../../../src/domain/sceneGeo';
import { coordsOf } from '../../../src/domain/sceneGeoRoute';
import type { RouteGround } from '../../../src/stage/ground/route';
import { roadRuns } from '../../../src/stage/roadLines';
import { buildPiece } from '../../../src/stage/three/piece';
import { buildRouteModels } from '../../../src/stage/three/routeKit';
import { styleFor } from './styles';
import type { StageTier } from '../../../src/stage/types';
import { realRouteScene, realSceneFile, realSceneKeys } from './realScenes';
import type { WitnessStroke } from './witness';

/** 造出来的一样东西：它的网格都在 root 底下；用完了叫 dispose。 */
export interface Built {
  root: Object3D;
  dispose(): void;
}

/** key 这座沙盘的场景（“人物/场景文件的名字”，站点沙盘和全程沙盘都行）。 */
function sceneOf(key: string): TableScene {
  return realSceneKeys('route').includes(key) ? realRouteScene(key).scene : realSceneFile(key).scene;
}

/** key 这座沙盘的座子（装裱和座子），照它的场景写的范围和样式造。要先有一个假的 document（贴图是画在画布上的）。 */
export async function standOf(key: string): Promise<Built> {
  const scene = sceneOf(key);
  const style = styleFor(scene.style);
  const stand = style.stand.build(coordsOf(scene), style.palette);
  return { root: stand.group, dispose: () => stand.dispose() };
}

/** key 这座全程沙盘的地面（读它的地形文件，照它的场景算）。 */
export async function routeGroundOf(key: string): Promise<RouteGround> {
  return realRouteScene(key).ground;
}

/** key 这座全程沙盘每一小节的标题，按先后。 */
export async function routeHeadingsOf(key: string): Promise<string[]> {
  return realRouteScene(key).headings;
}

/** key 这座全程沙盘第 section 节（从 0 数起）要画的每一笔，照沙盘程序排的先后：哪一种，实线还是虚线，哪几截路，线上的点。 */
export async function strokesOf(key: string, section: number): Promise<WitnessStroke[]> {
  const R = realRouteScene(key);
  return runsOf(R.scene, R.coords, section);
}

function runsOf(scene: RouteScene, coords: FrameCoords, section: number): WitnessStroke[] {
  return roadRuns(scene, coords, section).map((run) => ({ state: run.state, dotted: run.dotted, ways: run.ways, points: run.points }));
}

/**
 * key 这座全程沙盘的路，在 tier 这一档画质上造出来；show(小节的标题) 把那一节的线摆出来，线都在 root 底下
 * （就是画路的程序交给显卡的那几批）。
 */
export async function roadsOf(key: string, tier: StageTier): Promise<Built & { show(heading: string): void }> {
  const R = realRouteScene(key);
  const route = styleFor(R.scene.style).route;
  if (!route) throw new Error(`${key} 的样式里没有全程沙盘的那一份`);
  const kit = buildRouteModels({ scene: R.scene, coords: R.coords, samplers: R.samplers, style: route, tier });
  return { root: kit.group, show: (heading) => void kit.apply(heading, 0, 50_000), dispose: () => kit.dispose() };
}

/** key 这座全程沙盘的样式里的小像，照白天那盏灯的方向造。 */
export async function pieceOf(key: string): Promise<Built> {
  const style = styleFor(realRouteScene(key).scene.style);
  if (!style.piece) throw new Error(`${key} 的样式里没有小像的颜色`);
  const piece = buildPiece(style.piece, style.light('day').dir);
  return { root: piece.mesh, dispose: () => piece.dispose() };
}
