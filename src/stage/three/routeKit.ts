// 全程沙盘上的路：粗细按页面像素算的线（three 的 LineSegments2 一族），只有这个文件引它们。
// 在全程沙盘才下载的那一块程序里（routeLevel.ts 把它转出去）。线怎么走、哪几趟画成哪一种、排成几笔，都是 ../roadLines.ts 算的；
// 这里只做三件事：把线抬到地面上，按状态配颜色和宽度，镜头远近变了把虚线的长短跟上。
//
// 怎么画：
//   不比深浅（depthTest 关着），排在地形板后面画：山后面的路也看得见，线不会被起伏的地面吃掉半截。
//   墨线和刚走的路，每一笔下面垫一道浅色的线，合成一份线段表（一批）；走过的路不垫（样式里的 haloUnder）。
//   一种状态的实线合成一份线段表（一批）；一种状态的虚线也合成一份（一批），线上的距离这里自己写：
//   每一笔从头量起，一划一空在一笔里一路排下去、不在接头上重来，换了一笔从头排。一个画面的路最多十来批，路再多也是这几批。
//   样式另写了线型的（roads.patterns：水路的两种虚线，垫底的浅色线跟着虚线断开）：一种状态、一种线型一批，一种要断开的垫底线一批。
//   样式写了粗细跟着画面的比例的（roads.fit）：每一帧把造着的几种线交给它，怎么调是它自己带的函数，不在这里。
//   这两样样式不写的时候，画出来的和只有实线、一种虚线的时候一个数不差。
//   宽度是页面上的像素，镜头远近都一样；减配的一档没有抗锯齿，加粗一点。
//   虚线的一划一空在页面上总是那么长：每一帧把“沙盘里的一米合多少像素”告诉虚线的材质（dashScale），不重造线。
//   换了小节才重造（几百到两千段线），不是每一帧。
// 一段线是六个三角形（three 的 LineSegmentsGeometry：一段一份，八个顶点）；triangles() 照这个数。

import { Group, InstancedInterleavedBuffer, InterleavedBufferAttribute } from 'three';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import type { RouteScene } from '../../domain/scene';
import type { FrameCoords } from '../../domain/sceneGeo';
import type { GroundSamplers } from '../ground/types';
import { ROAD_STATES, roadRuns, segmentCount, segmentsOf } from '../roadLines';
import type { RoadRun, RoadState } from '../roadLines';
import type { StageTier } from '../types';
import type { ModelSet, RoadLineNow, RoadPattern, RouteStyle } from './internal';
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

  /** 线型：样式写了就用它的；不写是两种——第 0 种实线，第 1 种虚线（一划一空是样式的 dashPx）。 */
  const patterns: readonly RoadPattern[] = look.patterns?.list ?? [{}, { dashPx: look.dashPx }];
  /** 造过的每一种线：一种状态、一种线型一份材质，垫底的浅色线另算（不断的那一道记成第 -1 种）。用到才造。 */
  const made = new Map<string, RoadLineNow & { material: LineMaterial }>();
  function materialFor(state: RoadState | 'halo', pattern: number): LineMaterial {
    const key = state + pattern;
    let item = made.get(key);
    if (!item) {
      const under = state === 'halo';
      const line = under ? look.halo : look.lines[state];
      const spec = patterns[pattern] ?? {};
      // 垫底的浅色线：这种线型写了 under 就跟着它断开，不写是不断的一道
      const dash = under ? spec.under?.dashPx : spec.dashPx;
      const widthPx = line.widthPx * ((!under && spec.widthTimes) || 1) + extra;
      const material = new LineMaterial({
        color: line.colour,
        linewidth: widthPx,
        opacity: line.opacity,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        dashed: !!dash,
        dashSize: (dash ?? look.dashPx)[0],
        gapSize: (dash ?? look.dashPx)[1],
        dashOffset: (under && spec.under?.offsetPx) || 0,
      });
      made.set(key, (item = { state, pattern, widthPx, opacity: line.opacity, material }));
    }
    return item.material;
  }

  /** 现在画着的是哪一小节的路；还没画过是 null。 */
  let shown: string | null = null;
  let lines: LineSegments2[] = [];
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

  function add(line: LineSegments2, order: number): void {
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

  /**
   * 几笔虚线合成一份线段表，线上的距离这里自己写：每一笔都从 0 量起，一划一空在一笔里一路排下去，换了一笔从头排
   * （交给 three 去量，它会接着上一笔的往下量，后面每一笔的头一划都不在笔头上）。
   * 每一笔照它自己的点抬到地面上（不经 pairs：那边先把 x、z 取成 32 位再量高度，末一位会差）；距离照 three 自己量的办法，
   * 用取成 32 位以后的点一段一段加上去。
   */
  function dashes(runs: RoadRun[]): LineSegmentsGeometry {
    const count = segmentCount(runs);
    const positions = new Float32Array(count * 6);
    const distances = new Float32Array(count * 2);
    let k = 0;
    for (const run of runs) {
      const flat = new Float32Array(run.points.length * 3);
      run.points.forEach(([x, z], i) => flat.set([x, yAt(x, z), z], i * 3));
      for (let i = 0; i + 1 < run.points.length; i++, k++) {
        positions.set(flat.subarray(i * 3, i * 3 + 6), k * 6);
        const dx = flat[i * 3] - flat[i * 3 + 3];
        const dy = flat[i * 3 + 1] - flat[i * 3 + 4];
        const dz = flat[i * 3 + 2] - flat[i * 3 + 5];
        distances[k * 2] = i === 0 ? 0 : distances[k * 2 - 1];
        distances[k * 2 + 1] = distances[k * 2] + Math.sqrt(dx * dx + dy * dy + dz * dz);
      }
    }
    const geometry = new LineSegmentsGeometry().setPositions(positions);
    const buffer = new InstancedInterleavedBuffer(distances, 2, 1);
    geometry.setAttribute('instanceDistanceStart', new InterleavedBufferAttribute(buffer, 1, 0));
    geometry.setAttribute('instanceDistanceEnd', new InterleavedBufferAttribute(buffer, 1, 1));
    return geometry;
  }

  /** 几笔合成一批：这一种材质是虚线的就照虚线的办法合（自己写距离），实线的照实线的办法。一笔也没有就不添。 */
  function batch(runs: RoadRun[], state: RoadState | 'halo', pattern: number): void {
    if (runs.length === 0) return;
    const material = materialFor(state, pattern);
    add(new LineSegments2(material.dashed ? dashes(runs) : new LineSegmentsGeometry().setPositions(pairs(runs)), material), ORDER[state]);
  }

  /** 现在画着的这一节是不是没有写 stop 的那一节（全程）：样式的 fit 只在这一节里跟着画面的比例调粗细。 */
  let whole = false;

  function show(heading: string): void {
    clear();
    const index = scene.sections.findIndex((section) => section.heading === heading);
    if (index < 0) return;
    whole = scene.sections[index].stop === undefined;
    const runs = roadRuns(scene, coords, index, look.patterns?.of);
    if (runs.length === 0) return;
    // 垫底的浅色线：只垫样式里说要垫的那几种。不跟着虚线断开的合成一批；线型里写了要跟着断开的，一种线型另成一批
    const under = runs.filter((run) => look.haloUnder.includes(run.state));
    batch(under.filter((run) => !patterns[run.pattern].under), 'halo', -1);
    patterns.forEach((spec, pattern) => spec.under && batch(under.filter((run) => run.pattern === pattern), 'halo', pattern));
    // 一种状态、一种线型一批
    for (const state of ROAD_STATES) patterns.forEach((_, pattern) => batch(runs.filter((run) => run.state === state && run.pattern === pattern), state, pattern));
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
      // 虚线的一划一空在页面上总是那么长：线上的距离是沙盘里的米，乘上“一米合多少像素”（实线的材质不看这个数）
      const pxPerMetre = REFERENCE_FOCAL_PX / Math.max(1, viewDistanceM);
      for (const item of made.values()) item.material.dashScale = pxPerMetre;
      // 样式写了“粗细跟着画面的比例”的，叫它调（它自己带的函数）；看一站的小节交 null
      look.fit?.([...made.values()], whole ? (pxPerMetre * 1e5) / scene.frame.scale : null);
      // 线不投影子
      return false;
    },
    prepare: () => Promise.resolve(),
    triangles: () => segments * ROAD_SEGMENT_TRIANGLES,
    dispose() {
      clear();
      for (const item of made.values()) item.material.dispose();
    },
  };
}
