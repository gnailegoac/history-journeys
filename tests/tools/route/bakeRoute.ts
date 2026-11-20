// content/ 里的一座全程沙盘，做“先画好的地面”要用的几样：照什么画的两个记号，图多大，怎么画。
// 做图的工具（npm run bake，tests/tools/bake-ground.test.ts）和查“旧不旧”的测试（tests/stage/baked-fresh.test.ts）
// 用的都是这一个函数：两边画法不一样，就比不出旧不旧了。

import { routePictureSize } from '../../../src/stage/ground/route';
import { routeGroundInputs } from '../../../src/stage/three/routeLevel';
import { styleFor } from '../../../src/stage/three/style';
import { readToday } from '../../content/routeRules';
import { realRouteScene } from '../../stage/support/realScenes';
import { readBytes } from '../../support/readBytes';
import { paintRoute } from './paint';

export interface RouteBakeParts {
  /** 地形文件叫什么、它的字节。 */
  terrainFile: string;
  terrainBytes: ArrayBuffer;
  /** 照什么画的两个记号：场景里管地面的那一部分，地形文件。 */
  inputs: { ground: string; terrain: string };
  /** 两张图多大（照沙盘的范围算的）。 */
  size: { w: number; h: number };
  /** 画一遍：颜色（一个点三个字节）和水纹的标记（一个点一个字节）。三百多万个点，几秒钟。 */
  paint(): { w: number; h: number; rgb: Uint8Array; mask: Uint8Array };
}

/** key 是“人物/route”，从 realSceneKeys('route') 来。 */
export function routeBakeParts(key: string): RouteBakeParts {
  const R = realRouteScene(key);
  const [figure] = key.split('/');
  const terrainBytes = readBytes(`content/figures/${figure}/scenes/${R.scene.terrain.file}`);
  const today = readToday({ today: new TextDecoder().decode(readBytes(R.todayPath)) }, 'today');
  if (!today || 'problem' in today) throw new Error(`${R.todayPath} 读不出来${today ? `：${today.problem}` : ''}`);
  const { features } = today;
  return {
    terrainFile: R.scene.terrain.file,
    terrainBytes,
    inputs: routeGroundInputs(R.scene, terrainBytes),
    size: routePictureSize(R.ground),
    paint: () => {
      const painted = paintRoute({ scene: R.scene, coords: R.coords, ground: R.ground, features, style: styleFor(R.scene.style) });
      return { w: painted.w, h: painted.h, rgb: painted.colour, mask: painted.marks };
    },
  };
}
