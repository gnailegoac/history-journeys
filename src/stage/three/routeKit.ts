// 全程沙盘上的路：粗细按页面像素算的线（three 的 Line2 一族），只有这个文件引它们。
// 在全程沙盘才下载的那一块程序里（routeLevel.ts 把它转出去）。线怎么走、哪几趟画成哪一种、排成几笔，都是 ../roadLines.ts 算的；
// 这里只做三件事：把线抬到地面上，按状态配颜色和宽度，镜头远近变了把虚线的长短跟上。
//
// 怎么画：
//   不比深浅（depthTest 关着），排在地形板后面画：山后面的路也看得见，线不会被起伏的地面吃掉半截。
//   墨线和刚走的路，每一笔下面垫一道浅色的线，合成一份线段表（一批）；走过的路不垫（样式里的 haloUnder）。
//   一种状态的实线合成一份线段表（一批）；虚线一笔一条线（一划一空要一路排下去，不能在接头上重来）。
//   宽度是页面上的像素，镜头远近都一样；减配的一档没有抗锯齿，加粗一点。
//   虚线的一划一空在页面上总是那么长：每一帧把“沙盘里的一米合多少像素”告诉虚线的材质（dashScale），不重造线。
//   换了小节才重造（几百到两千段线），不是每一帧。
// 一段线是六个三角形（three 的 LineSegmentsGeometry：一段一份，八个顶点）；triangles() 照这个数。

import { Group } from 'three';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import type { RouteScene } from '../../domain/scene';
import type { FrameCoords } from '../../domain/sceneGeo';
import type { GroundSamplers } from '../ground/types';
import { ROAD_STATES, roadRuns, segmentCount, segmentsOf } from '../roadLines';
import type { RoadRun, RoadState } from '../roadLines';
import type { StageTier } from '../types';
import type { ModelSet, RouteLineStyle, RouteStyle } from './internal';
import { equivalentDistance } from './rig';

/** 一段线几个三角形。 */
export const ROAD_SEGMENT_TRIANGLES = 6;

/** 画的先后（数大的后画，压在上面）：垫底的浅色线，走过的，墨线，刚走的。都在地形板后面。 */
const ORDER: Record<RoadState | 'halo', number> = { halo: 10, past: 11, ink: 12, now: 13 };

/**
 * 折算过的远近是 1 米时，沙盘里的 1 米合多少像素（就是 kit/figure.ts 里那个 2428）：
 * 焦距 1 像素的画面（高 2 像素、视角 90 度）上离 1 米，折算过来正好是这个数。
 */
const REFERENCE_FOCAL_PX = equivalentDistance(1, 90, 2);

/** 画路要拿到的东西。 */
export interface RouteKitContext {
  scene: RouteScene;
  coords: FrameCoords;
  samplers: GroundSamplers;
  /** 这种时代样式里全程沙盘的那一份。 */
  style: RouteStyle;
  tier: StageTier;
}

/** 全程沙盘上的路。 */
export function buildRouteModels(ctx: RouteKitContext): ModelSet {
  const { scene, coords, samplers } = ctx;
  const look = ctx.style.roads;
  const extra = ctx.tier === 'reduced' ? look.reducedExtraPx : 0;
  const group = new Group();
  const sea = scene.water.levels.values.normal ?? -Infinity;
  /** 沙盘里 [x, z] 这一点上线画多高：地面（海上是海面）再抬一点。 */
  const yAt = (x: number, z: number): number => coords.y(Math.max(samplers.height(x, z), sea)) + look.liftM;

  const material = (line: RouteLineStyle, dashed: boolean): LineMaterial =>
    new LineMaterial({
      color: line.colour,
      linewidth: line.widthPx + extra,
      opacity: line.opacity,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      dashed,
      dashSize: look.dashPx[0],
      gapSize: look.dashPx[1],
    });
  const halo = material(look.halo, false);
  const solid = new Map<RoadState, LineMaterial>();
  const dotted = new Map<RoadState, LineMaterial>();
  for (const state of ROAD_STATES) {
    solid.set(state, material(look.lines[state], false));
    dotted.set(state, material(look.lines[state], true));
  }

  /** 现在画着的是哪一小节的路；还没画过是 null。 */
  let shown: string | null = null;
  let lines: (Line2 | LineSegments2)[] = [];
  /** 现在画着多少段线（垫底的也算）。 */
  let segments = 0;

  function clear(): void {
    for (const line of lines) {
      group.remove(line);
      line.geometry.dispose();
    }
    lines = [];
    segments = 0;
  }

  function add(line: Line2 | LineSegments2, order: number): void {
    line.renderOrder = order;
    // 线的宽度是在画面上算的，照包围球裁会把贴着画面边的线裁掉
    line.frustumCulled = false;
    group.add(line);
    lines.push(line);
  }

  /** 几笔合成一份线段表：每段六个数（两头的 x、y、z）。 */
  function pairs(runs: RoadRun[]): Float32Array {
    const flat = segmentsOf(runs);
    const out = new Float32Array((flat.length / 4) * 6);
    for (let i = 0, k = 0; i < flat.length; i += 4) {
      out[k++] = flat[i];
      out[k++] = yAt(flat[i], flat[i + 1]);
      out[k++] = flat[i + 1];
      out[k++] = flat[i + 2];
      out[k++] = yAt(flat[i + 2], flat[i + 3]);
      out[k++] = flat[i + 3];
    }
    return out;
  }

  function show(heading: string): void {
    clear();
    const index = scene.sections.findIndex((section) => section.heading === heading);
    if (index < 0) return;
    const runs = roadRuns(scene, coords, index);
    if (runs.length === 0) return;
    // 垫底的浅色线：只垫样式里说要垫的那几种
    const under = runs.filter((run) => look.haloUnder.includes(run.state));
    if (under.length > 0) add(new LineSegments2(new LineSegmentsGeometry().setPositions(pairs(under)), halo), ORDER.halo);
    for (const state of ROAD_STATES) {
      const mine = runs.filter((run) => run.state === state);
      const whole = mine.filter((run) => !run.dotted);
      if (whole.length > 0) add(new LineSegments2(new LineSegmentsGeometry().setPositions(pairs(whole)), solid.get(state)), ORDER[state]);
      for (const run of mine) {
        if (!run.dotted) continue;
        const flat = new Float32Array(run.points.length * 3);
        run.points.forEach(([x, z], i) => flat.set([x, yAt(x, z), z], i * 3));
        const line = new Line2(new LineGeometry().setPositions(flat), dotted.get(state));
        // 虚线要知道每一点离这一笔的起头多远
        line.computeLineDistances();
        add(line, ORDER[state]);
      }
    }
    // 垫了底的画两遍：垫底的一遍，上面的一遍
    segments = segmentCount(runs) + segmentCount(under);
  }

  return {
    group,
    apply(section, _waterLevelM, viewDistanceM) {
      if (section !== shown) {
        shown = section;
        show(section);
      }
      // 虚线的一划一空在页面上总是那么长：线上的距离是沙盘里的米，乘上“一米合多少像素”
      const pxPerMetre = REFERENCE_FOCAL_PX / Math.max(1, viewDistanceM);
      for (const item of dotted.values()) item.dashScale = pxPerMetre;
      // 线不投影子
      return false;
    },
    prepare: () => Promise.resolve(),
    triangles: () => segments * ROAD_SEGMENT_TRIANGLES,
    dispose() {
      clear();
      for (const item of [halo, ...solid.values(), ...dotted.values()]) item.dispose();
    },
  };
}
