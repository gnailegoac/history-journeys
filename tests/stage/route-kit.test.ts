// 全程沙盘上的路（src/stage/three/routeKit.ts）。在 Node 里跑，不要浏览器：线是照真的场景真造出来的，只是不画。
// 数都从真的函数、真的场景文件、真的样式读（../../src/stage/roadLines.ts 算出来的笔画、样式里路的那一份），不在这里另写一份。
// 查这几件：
//   头一节（全程）每一趟路都是墨线；看路的小节，到这一站的是印泥红、到前面各站的是淡墨，后面的不画；
//   每一笔下面垫着一道浅色的线，全部的笔画合成一批；一种状态的实线合成一批；虚线一笔一条、一路排下去；
//   线不比深浅，排在地形板后面画；比地面（海上是海面）抬高样式里写的那么多；
//   宽度是样式里写的页面像素，减配的一档加粗一点；虚线的一划一空跟着镜头的远近，在页面上总是那么长；
//   triangles() 报的和显出来的网格数出来的一样（一段线六个三角形）；一个画面里路最多画 14 批；
//   换了小节才重造，同一节再叫只改虚线的长短；dispose 以后什么也不剩。

import { describe, expect, it } from 'vitest';
import type { Mesh } from 'three';
import { Line2 } from 'three/addons/lines/Line2.js';
import type { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { ROAD_STATES, roadRuns, segmentCount } from '../../src/stage/roadLines';
import type { RoadState } from '../../src/stage/roadLines';
import { equivalentDistance } from '../../src/stage/three/rig';
import { ROAD_SEGMENT_TRIANGLES, buildRouteModels } from '../../src/stage/three/routeKit';
import { styleFor } from '../../src/stage/three/style';
import type { StageTier } from '../../src/stage/types';
import { drawn } from './support/budgets';
import { realRouteScene, realSceneKeys } from './support/realScenes';

/** 一个画面里路最多画几批（设计上是“十四批上下”）。 */
const ROAD_CALLS_MAX = 14;

describe.each(realSceneKeys('route'))('%s 的路', (key) => {
  const R = realRouteScene(key);
  const route = styleFor(R.scene.style).route;
  if (!route) throw new Error('样式里没有全程沙盘的那一份');
  const look = route.roads;
  const build = (tier: StageTier = 'full') => buildRouteModels({ scene: R.scene, coords: R.coords, samplers: R.samplers, style: route, tier });
  const lines = (kit: ReturnType<typeof build>): (Line2 | LineSegments2)[] => kit.group.children as (Line2 | LineSegments2)[];
  const material = (line: Mesh): LineMaterial => line.material as LineMaterial;
  const hex = (colour: string): number => Number.parseInt(colour.slice(1), 16);
  /** 这条线是哪一种：照颜色认（样式里四种线四个颜色）。 */
  const kindOf = (line: Mesh): RoadState | 'halo' => {
    const colour = material(line).color.getHex();
    if (colour === hex(look.halo.colour)) return 'halo';
    const state = ROAD_STATES.find((item) => hex(look.lines[item].colour) === colour);
    if (!state) throw new Error(`线的颜色 #${colour.toString(16)} 不是样式里写的哪一种`);
    return state;
  };
  const segmentsIn = (line: Mesh): number => (line.geometry as unknown as { instanceCount: number }).instanceCount;

  it('样式里四种线的颜色各不相同（这里照颜色认线）', () => {
    const colours = [look.halo.colour, ...ROAD_STATES.map((state) => look.lines[state].colour)];
    expect(new Set(colours).size).toBe(4);
  });

  it('每一节：画的就是 roadRuns 排出来的那几笔——垫底的一批是全部的笔画，每种状态的实线一批，虚线一笔一条', () => {
    const kit = build();
    const report: string[] = [];
    R.headings.forEach((heading, index) => {
      kit.apply(heading, 0, 50_000);
      const runs = roadRuns(R.scene, R.coords, index);
      const all = lines(kit);
      // 垫底的：一批，全部的笔画
      const halos = all.filter((line) => kindOf(line) === 'halo');
      expect(halos.length, heading).toBe(1);
      expect(halos[0]).toBeInstanceOf(LineSegments2);
      expect(halos[0]).not.toBeInstanceOf(Line2);
      expect(segmentsIn(halos[0]), heading).toBe(segmentCount(runs));
      for (const state of ROAD_STATES) {
        const mine = runs.filter((run) => run.state === state);
        const drawnHere = all.filter((line) => kindOf(line) === state);
        const solid = drawnHere.filter((line) => !(line instanceof Line2));
        const dotted = drawnHere.filter((line) => line instanceof Line2);
        // 实线：这一种有实线就正好一批，段数是这一种所有实线的段数
        const whole = mine.filter((run) => !run.dotted);
        expect(solid.length, `${heading} ${state} 的实线`).toBe(whole.length > 0 ? 1 : 0);
        if (solid[0]) {
          expect(segmentsIn(solid[0]), `${heading} ${state} 的实线`).toBe(segmentCount(whole));
          expect(material(solid[0]).dashed).toBe(false);
        }
        // 虚线：一笔一条，段数是那一笔的；材质是虚线的，线上的每一点都量过离起头多远（最后一点就是这一笔的长）
        const dashes = mine.filter((run) => run.dotted);
        expect(dotted.map(segmentsIn), `${heading} ${state} 的虚线`).toEqual(dashes.map((run) => run.points.length - 1));
        dotted.forEach((line, i) => {
          expect(material(line).dashed).toBe(true);
          const far = line.geometry.getAttribute('instanceDistanceEnd');
          expect(far, '虚线没有量过线上的距离').toBeDefined();
          // 线上的距离是抬到地面上以后量的，比平着量的长一点点，不会短
          expect(far.getX(far.count - 1)).toBeGreaterThanOrEqual(dashes[i].lengthM - 1e-3);
          expect(far.getX(far.count - 1)).toBeLessThan(dashes[i].lengthM * 1.05);
        });
      }
      const states = new Set(runs.map((run) => run.state));
      if (index === 0) expect([...states]).toEqual(['ink']);
      else expect(states.has('ink')).toBe(false);
      // 报的三角形数和显出来的网格数出来的一样；路画的批数有上限
      const counted = drawn(kit.group);
      expect(kit.triangles(), heading).toBe(counted.triangles);
      expect(kit.triangles(), heading).toBe(segmentCount(runs) * 2 * ROAD_SEGMENT_TRIANGLES);
      expect(counted.calls, `${heading} 的路画 ${counted.calls} 批`).toBeLessThanOrEqual(ROAD_CALLS_MAX);
      report.push(`  ${heading}：${runs.length} 笔（虚线 ${runs.filter((run) => run.dotted).length} 笔），${segmentCount(runs)} 段，连垫底的 ${counted.triangles} 个三角形，${counted.calls} 批`);
    });
    console.log(`${key} 的路，每一节画什么\n${report.join('\n')}`);
    kit.dispose();
  });

  it('线不比深浅、不写深浅，排在地形板后面画，不照包围球裁；颜色、透明度是样式里写的', () => {
    const kit = build();
    for (const heading of [R.headings[0], R.headings[1]]) {
      kit.apply(heading, 0, 30_000);
      const orders: Partial<Record<RoadState | 'halo', number>> = {};
      for (const line of lines(kit)) {
        const m = material(line);
        expect(m.depthTest).toBe(false);
        expect(m.depthWrite).toBe(false);
        expect(m.transparent).toBe(true);
        expect(line.frustumCulled).toBe(false);
        expect(line.renderOrder).toBeGreaterThan(0);
        const kind = kindOf(line);
        orders[kind] = line.renderOrder;
        expect(m.opacity).toBe(kind === 'halo' ? look.halo.opacity : look.lines[kind].opacity);
      }
      // 垫底的在最下面；走过的在刚走的下面
      for (const state of ROAD_STATES) if (orders[state] !== undefined) expect(orders.halo).toBeLessThan(orders[state] as number);
      if (orders.past !== undefined && orders.now !== undefined) expect(orders.past).toBeLessThan(orders.now);
    }
    kit.dispose();
  });

  it(`线上的每一点比地面（海上是海面）高出样式里写的 ${look.liftM} 米`, () => {
    const kit = build();
    kit.apply(R.headings[0], 0, 60_000);
    const sea = R.scene.water.levels.values.normal;
    let checked = 0;
    for (const line of lines(kit)) {
      for (const name of ['instanceStart', 'instanceEnd']) {
        const at = line.geometry.getAttribute(name);
        for (let i = 0; i < at.count; i += 7) {
          const h = R.samplers.height(at.getX(i), at.getZ(i));
          expect(at.getY(i)).toBeCloseTo(R.coords.y(Math.max(h, sea)) + look.liftM, 2);
          checked += 1;
        }
      }
    }
    expect(checked).toBeGreaterThan(500);
    kit.dispose();
  });

  it(`宽度是样式里写的页面像素；减配的一档每一种加粗 ${look.reducedExtraPx} 像素`, () => {
    for (const tier of ['full', 'reduced'] as const) {
      const kit = build(tier);
      const extra = tier === 'reduced' ? look.reducedExtraPx : 0;
      for (const heading of [R.headings[0], R.headings.at(-1) as string]) {
        kit.apply(heading, 0, 40_000);
        for (const line of lines(kit)) {
          const kind = kindOf(line);
          expect(material(line).linewidth).toBeCloseTo((kind === 'halo' ? look.halo.widthPx : look.lines[kind].widthPx) + extra, 9);
          // 宽度按页面的像素算，不按沙盘里的米
          expect(material(line).worldUnits).toBe(false);
        }
      }
      kit.dispose();
    }
  });

  it(`虚线：一划 ${look.dashPx[0]} 像素、一空 ${look.dashPx[1]} 像素，镜头远近变了，在页面上还是那么长`, () => {
    const kit = build();
    kit.apply(R.headings[0], 0, 62_800);
    const dotted = lines(kit).filter((line) => line instanceof Line2);
    expect(dotted.length).toBeGreaterThan(0);
    for (const D of [15_000, 30_000, 62_800, 120_000]) {
      kit.apply(R.headings[0], 0, D);
      // 折算过的远近是 D 时，沙盘里的一米合多少像素：900 像素高、视角 21 度的画面上离 D 米
      // （equivalentDistance 就是照这个画面折算的：在这个画面上离 D 米，折算过来还是 D）
      expect(equivalentDistance(D, 21, 900) / D).toBeCloseTo(1, 3);
      const pxPerMetre = 900 / (2 * D * Math.tan((21 * Math.PI) / 360));
      for (const line of dotted) {
        const m = material(line);
        expect(m.dashSize).toBe(look.dashPx[0]);
        expect(m.gapSize).toBe(look.dashPx[1]);
        // 线上的距离（沙盘里的米）乘上 dashScale 就是页面上的像素
        expect(m.dashScale / pxPerMetre).toBeCloseTo(1, 3);
      }
    }
    kit.dispose();
  });

  it('换了小节才重造；同一节再叫，线还是原来那几条；不投影子（apply 总是答 false）；dispose 以后一条不剩', () => {
    const kit = build();
    expect(kit.group.children).toHaveLength(0);
    expect(kit.triangles()).toBe(0);
    expect(kit.apply(R.headings[0], 0, 60_000)).toBe(false);
    const first = [...kit.group.children];
    expect(first.length).toBeGreaterThan(0);
    expect(kit.apply(R.headings[0], 0, 20_000)).toBe(false);
    expect(kit.group.children).toEqual(first);
    kit.group.children.forEach((line, i) => expect(line).toBe(first[i]));
    kit.apply(R.headings[1], 0, 20_000);
    for (const line of kit.group.children) expect(first).not.toContain(line);
    // 场景里没有的小节：什么也不画
    kit.apply('没有这一节', 0, 20_000);
    expect(kit.group.children).toHaveLength(0);
    expect(kit.triangles()).toBe(0);
    kit.apply(R.headings[2], 0, 20_000);
    expect(kit.group.children.length).toBeGreaterThan(0);
    kit.dispose();
    expect(kit.group.children).toHaveLength(0);
    expect(kit.triangles()).toBe(0);
  });
});
