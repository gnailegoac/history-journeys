// content/ 里每一座真的站点沙盘：场景文件、地形文件和照它们算出来的地面。
// 场景验收的几组测试（scene-ground、scene-cameras、scene-models、xuzhou-ground）共用，在 Node 里跑，不要浏览器。
// 以后添一站的沙盘（黄州），前三组测试自己就会把它也查一遍。
//
// scenes/ 里还可以有一座全程沙盘（route.json，写着 "level": "route"）。它的地面是另一种算法：这里的 realSceneFile、
// realScene 只管站点沙盘；realSceneKeys() 不写参数给的也只是站点沙盘，要全程沙盘写 realSceneKeys('route')。

import type { RouteScene, StopScene, TableScene } from '../../../src/domain/scene';
import { frameCoords } from '../../../src/domain/sceneGeo';
import type { FrameCoords } from '../../../src/domain/sceneGeo';
import { coordsOf } from '../../../src/domain/sceneGeoRoute';
import { buildFields, readDem, samplers } from '../../../src/stage/ground';
import { buildRouteGround, readRouteDem, routeSamplers } from '../../../src/stage/ground/route';
import type { RouteGround } from '../../../src/stage/ground/route';
import type { Dem, Ground, GroundSamplers, Vec2 } from '../../../src/stage/ground/types';
import type { KitFamily } from '../../../src/stage/three/kit/families';
import type { Figure } from '../../../src/domain/types';
import { kitFor } from './kitFamilies';
import { readBytes } from '../../support/readBytes';

/** 一位人物的资料（content/figures/<人物>/figure.json），照磁盘上的文件：哪几站有自己的沙盘写在里面。 */
export function realFigure(figureId: string): Figure {
  return JSON.parse(new TextDecoder().decode(readBytes(`content/figures/${figureId}/figure.json`))) as Figure;
}

/** 场景文件只用 import.meta.glob 读（和 src/domain/sceneContent.ts 一样），不直接 import 那个 JSON。两层的沙盘都在里面。 */
const sceneFiles = import.meta.glob<TableScene>('/content/figures/*/scenes/*.json', { import: 'default', eager: true });

export interface RealScene {
  /** “人物/站”，如 su-shi/xuzhou。 */
  key: string;
  scene: StopScene;
  coords: FrameCoords;
  /** 小节标题，按先后。 */
  headings: string[];
  ground: Ground;
  samplers: GroundSamplers;
  /** 这座沙盘用得着的、按家分块的零件（见 ./kitFamilies.ts）；一家也用不着是 undefined。造模型时交给零件库（KitContext.kit）。 */
  kit: KitFamily | undefined;
}

/** 一座沙盘的地面只算一次（半秒上下），同一个测试文件里反复用。 */
const built = new Map<string, RealScene>();

/**
 * content/ 里每一座沙盘的名字（“人物/场景文件的名字”，如 su-shi/xuzhou、su-shi/route），按名字排好。
 * level 不写是站点沙盘；写 'route' 是全程沙盘。两层从不混在一起给：照站点沙盘写的测试不会碰到全程沙盘。
 */
export function realSceneKeys(level: 'stop' | 'route' = 'stop'): string[] {
  return Object.keys(sceneFiles)
    .filter((path) => (sceneFiles[path].level === 'route') === (level === 'route'))
    .map((path) => {
      const m = /^\/content\/figures\/([^/]+)\/scenes\/([^/]+)\.json$/.exec(path);
      if (!m) throw new Error(`场景文件的路径不对：${path}`);
      return `${m[1]}/${m[2]}`;
    })
    .sort();
}

/** 只取场景文件（不算地面）。terrainPath 是它的地形文件相对项目根目录的路径。 */
export function realSceneFile(key: string): { scene: StopScene; terrainPath: string } {
  const [figure, stop] = key.split('/');
  const dir = `content/figures/${figure}/scenes`;
  const scene = sceneFiles[`/${dir}/${stop}.json`];
  if (!scene) throw new Error(`没有这座沙盘：${key}`);
  if (scene.level === 'route') throw new Error(`${key} 是全程沙盘：这里只取站点沙盘`);
  return { scene, terrainPath: `${dir}/${scene.terrain.file}` };
}

/** 取一座沙盘：读场景和地形文件，算出地面。 */
export function realScene(key: string): RealScene {
  const have = built.get(key);
  if (have) return have;
  const { scene, terrainPath } = realSceneFile(key);
  const coords = frameCoords(scene.frame);
  const ground = buildFields(scene, readDem(scene.terrain, readBytes(terrainPath)));
  const made: RealScene = { key, scene, coords, headings: scene.sections.map((s) => s.heading), ground, samplers: samplers(ground), kit: kitFor(scene) };
  built.set(key, made);
  return made;
}

/** content/ 里的一座全程沙盘：场景文件、地形文件和照它们算出来的地面。 */
export interface RealRouteScene {
  /** “人物/route”，如 su-shi/route。 */
  key: string;
  scene: RouteScene;
  coords: FrameCoords;
  /** 小节标题，按先后。 */
  headings: string[];
  /** 读进来的地形文件。 */
  dem: Dem;
  ground: RouteGround;
  samplers: GroundSamplers;
  /** “今天的海岸、湖、河”那个文件相对项目根目录的路径。 */
  todayPath: string;
}

const builtRoutes = new Map<string, RealRouteScene>();

/**
 * 取一座全程沙盘：读场景和地形文件，算出地面（只算一次，不到一秒）。key 从 realSceneKeys('route') 来。
 * 凭证的测试（../su-shi-witness.test.ts，经 ./witnessSubjects.ts）比的地面、路要的范围和取高度的函数就是从这里拿的：
 * 这里只把沙盘程序算出来的东西原样交出去，不补数、不换数。造地面的办法换了叫法、多要几个数（比如留白的几个数改成从样式里取），
 * 改的是下面那一句调用，交给它的要是沙盘程序自己用的那几个数。
 */
export function realRouteScene(key: string): RealRouteScene {
  const have = builtRoutes.get(key);
  if (have) return have;
  const [figure, name] = key.split('/');
  const dir = `content/figures/${figure}/scenes`;
  const scene = sceneFiles[`/${dir}/${name}.json`];
  if (!scene) throw new Error(`没有这座沙盘：${key}`);
  if (scene.level !== 'route') throw new Error(`${key} 是站点沙盘：这里只取全程沙盘`);
  const coords = coordsOf(scene);
  const dem = readRouteDem(scene.terrain, readBytes(`${dir}/${scene.terrain.file}`));
  const ground = buildRouteGround(scene, dem, coords);
  const made: RealRouteScene = { key, scene, coords, headings: scene.sections.map((s) => s.heading), dem, ground, samplers: routeSamplers(ground), todayPath: `${dir}/${scene.water.todayFile}` };
  builtRoutes.set(key, made);
  return made;
}

/**
 * 这一格在这个水位上有没有水。和画水的着色器（src/stage/three/water.ts）、零件库摆树（kit/trees.ts）是同一条规矩：
 * 水位高过平时，水漫不进去的地方（dry 是 1）没有水；别处，水看到的地面（waterH）比水位低就有水。
 */
export function wetCell(ground: Ground, k: number, levelM: number, normalM: number): boolean {
  if (levelM > normalM + 0.01 && ground.dry[k] === 1) return false;
  return ground.waterH[k] < levelM;
}

/** 第 k 格在沙盘里的位置（米）。 */
export function cellAt(ground: Ground, k: number): Vec2 {
  return [ground.x0 + (k % ground.nx) * ground.cell, ground.z0 + Math.floor(k / ground.nx) * ground.cell];
}

/** 一圈经纬度的线换成沙盘里的米；写的时候最后一点重复了第一点的，去掉。 */
export function localRing(points: [number, number][], coords: FrameCoords): Vec2[] {
  const ring = points.map((p): Vec2 => coords.toLocal(p));
  const n = ring.length;
  if (n > 1 && ring[0][0] === ring[n - 1][0] && ring[0][1] === ring[n - 1][1]) ring.pop();
  return ring;
}
