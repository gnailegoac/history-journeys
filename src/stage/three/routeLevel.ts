// 全程沙盘才用得着的那一块程序。摆全程沙盘时才下载（取它的那一句动态 import 在 src/stage/index.ts），站点沙盘的页面不下载。
// 里面有四样：
//   地面的算法（../ground/route.ts 的几个函数，从这里转出去）；
//   先画好的地面怎么取（routeGroundPaint）——全程沙盘的地面不在页面上现画，只用制作时画好的两张图；
//   两个替身：全程沙盘没有水面，也没有云气，可 view.ts 每一帧都要对水面和云气说话，这里给它两个什么也不画的；
//   路（buildRouteModels，在 ./routeKit.ts 里，从这里转出去）；
//   潜到一站上空的那一趟镜头怎么走（diveEnd、divePath）。
// 查构建结果的测试把这一块连同它静态引入的东西单算一组（tests/content/budgetRules.ts 的 ROUTE_ENTRY）。

import { Group, type IUniform, type Vector2 } from 'three';
import { contentKey } from '../../domain/contentKey';
import type { RouteScene } from '../../domain/scene';
import { routeGroundKey, routeNormals, routePictureSize } from '../ground/route';
import type { RouteGround } from '../ground/route';
import { pieceWhere } from '../pieceWhere';
import type { PiecePlace, RouteTable } from '../types';
import type { FrameCoords } from '../../domain/sceneGeo';
import type { GroundSamplers, Vec3 } from '../ground/types';
import { loadPicture, pictureSize } from './groundPaint';
import type { GroundPaintSource } from './groundPaint';
import type { Mist } from './mist';
import { poseOn } from './rig';
import { mixState, type TableState } from './sequencer';
import type { Water } from './water';
// 这一句只为打包：这一块程序只在沙盘程序已经下载了以后才取。写了这一句，打包的工具就知道沙盘程序那一块一定在，
// 两边共用的东西（three 的核心、取图片的函数、抹平的函数）留在那一块里直接用；不写的话，它们会被另拆成一块，
// 摆站点沙盘也要多下载一个文件、多两千来字节（量过）。
import './engine';

export { buildRouteGround, readRouteDem, routeSamplers } from '../ground/route';
export { buildRouteModels } from './routeKit';
export { buildPiece } from './piece';
export { aroundPiece, PIECE_NAME } from '../overlay/placeAround';

// ---------------------------------------------------------------- 小像站在哪

/**
 * 小像脚下那一点（沙盘里的米）。平面上的位置照 ../pieceWhere.ts；高度和路的线一样：地面（海上是海面）再抬 liftM，
 * 所以他站在画出来的线上。沙盘上没有这个地方（认不得的 id）是 null。
 */
export function pieceFoot(scene: RouteScene, coords: FrameCoords, ground: GroundSamplers, liftM: number, where: PiecePlace): Vec3 | null {
  const at = pieceWhere(scene, coords, where);
  return at && [at[0], coords.y(Math.max(ground.height(at[0], at[1]), scene.water.levels.values.normal ?? -Infinity)) + liftM, at[1]];
}

// ---------------------------------------------------------------- 先画好的地面

/**
 * 全程沙盘先画好的地面是照什么画的，两个记号：场景里管地面的那一部分，地形文件的字节。
 * 做图的工具、查“旧不旧”的测试和这里的核对用的都是这一个函数。
 */
export function routeGroundInputs(scene: RouteScene, terrainBytes: ArrayBuffer): { ground: string; terrain: string } {
  return { ground: routeGroundKey(scene), terrain: contentKey(new Uint8Array(terrainBytes)) };
}

export interface RouteGroundPaintJob {
  /**
   * 地面算好以后叫：等两张图，查大小，算法线。图没有、取不到、大小不对就拒绝（全程沙盘不现画，页面这时候放图片或者一句话）。
   * 图是照旧的场景或者旧的地形文件画的：照样用，在控制台里说一句（这是给改场景的人留的；发布出去的网站走不到，测试先不通过）。
   */
  finish(scene: RouteScene, ground: RouteGround, terrainBytes: ArrayBuffer): Promise<GroundPaintSource>;
}

/** 一开始就叫（地形文件还没取到）：两张图一起开始取。loadImage 可以换成假的（测试用）。 */
export function routeGroundPaint(table: RouteTable, signal: AbortSignal, loadImage?: (url: string) => Promise<TexImageSource>): RouteGroundPaintJob {
  const baked = table.ground;
  const load = (url: string): Promise<TexImageSource> => {
    try {
      return loadImage ? loadImage(url) : loadPicture(url, signal);
    } catch (error) {
      return Promise.reject(error);
    }
  };
  const pictures = baked ? Promise.all([load(baked.colourUrl), load(baked.fieldsUrl)]) : null;
  // 取不到的缘故留到 finish 里再说；这里先接住，免得成了没人管的错误
  pictures?.catch(() => {});

  return {
    async finish(scene, ground, terrainBytes) {
      if (!baked || !pictures) throw new Error('全程沙盘还没有先画好的地面。运行 npm run bake');
      const { w, h } = routePictureSize(ground);
      if (baked.width !== w || baked.height !== h) throw new Error(`全程沙盘先画好的地面，清单里写的图是 ${baked.width} × ${baked.height}，照沙盘的范围应该是 ${w} × ${h}。运行 npm run bake`);
      const now = routeGroundInputs(scene, terrainBytes);
      if (baked.inputs.ground !== now.ground || baked.inputs.terrain !== now.terrain) {
        console.warn('[沙盘] 全程沙盘先画好的地面是旧的，颜色不是照现在的场景画的。运行 npm run bake');
      }
      const [colour, fields] = await pictures;
      for (const image of [colour, fields]) {
        const [pw, ph] = pictureSize(image);
        if (pw !== w || ph !== h) throw new Error(`全程沙盘先画好的地面，图是 ${pw} × ${ph}，应该是 ${w} × ${h}。运行 npm run bake`);
      }
      return { kind: 'baked', colour, fields, w, h, normals: routeNormals(ground) };
    },
  };
}

// ---------------------------------------------------------------- 潜到一站上空

/** 潜到头时，镜头离那一站的地名点多远（沙盘里的米）。朝正北看，倾角用到这一站去的那一节的。 */
export const DIVE_DISTANCE_M = 4500;
/** 到这一站去的那一节没有时用的倾角。 */
const DIVE_PITCH = 45;

/**
 * 潜到头是什么样：镜头对准这一站的地名点（places 里 stops 写着这一站的那一个），离它 DIVE_DISTANCE_M，朝正北；
 * 视角、水位、云气都照 from（现在的样子）不变。沙盘上没有这一站是 null。
 */
export function diveEnd(scene: RouteScene, stop: string, from: TableState, ground: GroundSamplers, coords: FrameCoords): TableState | null {
  const place = scene.places.find((p) => p.stops?.includes(stop));
  if (!place) return null;
  const pitch = scene.sections.find((s) => s.stop === stop)?.camera.pitch ?? DIVE_PITCH;
  const pose = poseOn({ target: place.at, distanceM: DIVE_DISTANCE_M, pitch, bearing: 0, fov: from.fov }, ground, coords);
  return { ...from, position: pose.position, target: pose.target };
}

/** 钟点走到这么多成的时候，镜头已经正对着那一站了（离它还远，接着才凑近）：读者先看见是往哪儿去。 */
export const DIVE_AIM_SHARE = 0.6;

/**
 * 潜的路。返回的函数收钟点走了几成（k，0 到 1），给那一刻的样子。两样东西各走各的：
 * 镜头离对准的那一点多远、从哪一边看：起步慢、越来越快（k 的平方），距离按倍数匀着缩（每走一成缩同样的倍数）；
 * 对准的那一点：缓起缓停地挪到那一站，钟点走到 DIVE_AIM_SHARE 就到了。这样那一站在画面上只往中间靠，画面还清楚的时候它已经在中间。
 */
export function divePath(from: TableState, to: TableState): (k: number) => TableState {
  const off = (s: TableState): number[] => s.position.map((p, i) => p - s.target[i]);
  const a = off(from);
  const b = off(to);
  const ratio = Math.hypot(...b) / Math.max(1, Math.hypot(...a));
  return (k) => {
    const e = k <= 0 ? 0 : k >= 1 ? 1 : k * k;
    // 两头差不多远（比值挨着 1）时除数太小，照直线走
    const z = Math.abs(1 - ratio) < 1e-3 ? e : (1 - ratio ** e) / (1 - ratio);
    const state = mixState(from, to, z);
    if (e <= 0 || e >= 1) return state;
    const u = Math.min(1, k / DIVE_AIM_SHARE);
    const g = u * u * (3 - 2 * u);
    const target = from.target.map((t, i) => t + (to.target[i] - t) * g) as TableState['target'];
    return { ...state, target, position: target.map((t, i) => t + a[i] + (b[i] - a[i]) * z) as TableState['position'] };
  };
}

// ---------------------------------------------------------------- 两个替身

/**
 * 水面的替身：全程沙盘的海和湖是画在地面上的，没有水面。水纹由地面的着色器画，
 * 所以“水纹怎么摆”“画布的像素比”这两句话转给地面的材质（terrainMesh.ts 给出来的 uniforms）；水位和水色不用管。
 */
export function routeWater(uniforms: Record<string, IUniform>): Water {
  return {
    group: new Group(),
    setLevel() {},
    setFlood() {},
    setRipple(dense, turnDeg) {
      const turn = (turnDeg * Math.PI) / 180;
      uniforms.uDense.value = dense;
      (uniforms.uRipRot.value as Vector2).set(Math.cos(turn), Math.sin(turn));
    },
    setPixelRatio(ratio) {
      uniforms.uPx.value = ratio > 0 ? ratio : 1;
    },
    setSheen() {},
    dispose() {},
  };
}

/** 云气的替身：全程沙盘不画云气。 */
export function routeMist(): Mist {
  return { group: new Group(), setFlood() {}, setStrength() {}, setColor() {}, dispose() {} };
}
