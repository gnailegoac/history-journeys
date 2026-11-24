// 地面的入口：把今天的高程整理成沙盘用的地面（压平平地、一处一处修整、挖河），再上色。
// 分成两步，是为了测试和以后“制作时先画好”可以跳过上色：buildFields 只算地面，paintGround 只上色。
//
// 沙盘程序别的部分只用这里的四个函数和 types.ts 里的类型；四个函数的名字、参数和返回值要改先找负责人。
// 另外给出两样只看场景、不看地面的算法，零件库和镜头要用：城门落在哪一点（gateSeats），一组院落怎么排（yardLayout）。
// 还有三样是给“制作时先画好地面”用的：只上色（paintColour）、只算法线（groundNormals）、
// 场景里管地面的那一部分的记号（groundKey）。
// 整个文件夹只算数：不碰 three，也不碰页面，在 Node 里也能跑。

import type { SceneTerrain, StopScene } from '../../domain/scene';
import { readDemBytes } from './dem';
import { buildGround } from './fields';

export { GATE_BIG_EXTRA_M, GATE_HALF_M, POOL_RADIUS_M, gateSeat, gateSeats, plotHalfM, yardLayout } from './cityPlan';
export { groundKey } from './key';
import { bilinear } from './grid';
import { bakeNormals } from './normals';
import { paintColour } from './paint';
import type { Dem, Ground, GroundPaint, GroundSamplers, GroundStyle } from './types';

export { paintColour };

/** 只算法线图（见 GroundPaint.normals）。有先画好的颜色时法线也是现算的（十几毫秒），不存成文件。 */
export function groundNormals(ground: Ground): Uint8Array {
  return bakeNormals(ground);
}

/** 把地形文件的字节读成高程网格。bytes 的大小不对（不是 行 × 列 × 2 字节）时抛出错误。 */
export function readDem(terrain: SceneTerrain, bytes: ArrayBuffer): Dem {
  return readDemBytes(terrain, bytes);
}

/**
 * 算出整理好的地面：高度、水看到的地面、水漫不进去的地方、离河岸多远、哪里是山、村子、城的平面。
 * 先后是：整理，按先后做修整，挖河，最后把写了 inside 的那一处再压一遍。同样的输入每次算出一样的结果。
 */
export function buildFields(scene: StopScene, dem: Dem): Ground {
  return buildGround(scene, dem);
}

/** 给地面上色，并算出法线图。页面上的沙盘不再直接用它（走 src/stage/three/groundPaint.ts：有先画好的文件就读文件）；地面的测试还用。 */
export function paintGround(ground: Ground, style: GroundStyle): GroundPaint {
  const { colour, w, h } = paintColour(ground, style);
  return { colour, w, h, normals: bakeNormals(ground) };
}

/** 在任意一点取地面的数（格子之间按远近匀开；出了沙盘取边上的值）。 */
export function samplers(ground: Ground): GroundSamplers {
  return {
    height: bilinear(ground.h, ground),
    waterH: bilinear(ground.waterH, ground),
    edge: bilinear(ground.edge, ground),
    lift: bilinear(ground.lift, ground),
    hill: bilinear(ground.hill, ground),
    hillSoft: bilinear(ground.hillSoft, ground),
  };
}
