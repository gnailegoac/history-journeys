// 全程沙盘上的路（src/stage/three/routeKit.ts）。在 Node 里跑，不要浏览器：线是照真的场景真造出来的，只是不画。
// 数都从真的函数、真的场景文件、真的样式读（../../src/stage/roadLines.ts 算出来的笔画、样式里路的那一份），不在这里另写一份。
// 查这几件：
//   头一节（全程）每一趟路都是墨线；看路的小节，到这一站的是印泥红、到前面各站的是淡墨，后面的不画；
//   墨线和刚走的路下面垫着一道浅色的线，合成一批；走过的路下面不垫（样式里的 haloUnder）；一种状态的实线合成一批；
//   一种状态的虚线也合成一批，线上的距离每一笔从头量起、一路排下去；
//   线不比深浅，排在地形板后面画；比地面（海上是海面）抬高样式里写的那么多；
//   宽度是样式里写的页面像素，减配的一档加粗一点；虚线的一划一空跟着镜头的远近，在页面上总是那么长；
//   triangles() 报的和显出来的网格数出来的一样（一段线六个三角形）；一个画面里路最多画 14 批；
//   换了小节才重造，同一节再叫只改虚线的长短；dispose 以后什么也不剩。
// 分两组：content/ 里有几座全程沙盘，“每一座”那一组就查几座；一座沙盘自己的数（线上抽得到多少个点、头一节里有没有虚线）
// 在写着它名字的那一组里（现在只有 su-shi/route）。

import { describe, expect, it } from 'vitest';
import type { Mesh } from 'three';
import type { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { ROAD_STATES, roadRuns, segmentCount } from '../../src/stage/roadLines';
import type { RoadState } from '../../src/stage/roadLines';
import { equivalentDistance } from '../../src/stage/three/rig';
import { ROAD_SEGMENT_TRIANGLES, buildRouteModels } from '../../src/stage/three/routeKit';
import { styleFor } from './support/styles';
import type { StageTier } from '../../src/stage/types';
import { drawn } from './support/budgets';
import { realRouteScene, realSceneKeys } from './support/realScenes';

/** 一个画面里路最多画几批（设计上是“十四批上下”）。 */
const ROAD_CALLS_MAX = 14;

type Kit = ReturnType<typeof buildRouteModels>;
const material = (line: Mesh): LineMaterial => line.material as LineMaterial;
const hex = (colour: string): number => Number.parseInt(colour.slice(1), 16);
const segmentsIn = (line: Mesh): number => (line.geometry as unknown as { instanceCount: number }).instanceCount;
const lines = (kit: Kit): LineSegments2[] => kit.group.children as LineSegments2[];

/** 一座全程沙盘的场景、样式里路的那一份，和照它造路的函数。“每一座”那一组和写着名字的那一组都从这里拿。 */
function roadsOf(key: string) {
  const R = realRouteScene(key);
  const route = styleFor(R.scene.style).route;
  if (!route) throw new Error('样式里没有全程沙盘的那一份');
  const look = route.roads;
  const build = (tier: StageTier = 'full'): Kit => buildRouteModels({ scene: R.scene, coords: R.coords, samplers: R.samplers, style: route, tier });
  /** 这条线是哪一种：照颜色认（样式里四种线四个颜色）。 */
  const kindOf = (line: Mesh): RoadState | 'halo' => {
    const colour = material(line).color.getHex();
    if (colour === hex(look.halo.colour)) return 'halo';
    const state = ROAD_STATES.find((item) => hex(look.lines[item].colour) === colour);
    if (!state) throw new Error(`线的颜色 #${colour.toString(16)} 不是样式里写的哪一种`);
    return state;
  };
  return { R, look, build, kindOf };
}

/**
 * 头一节（全程）的线上每七个点抽一个：它比地面（海上是海面）高出样式里写的那么多。返回抽着查了几个点
 *（查了多少个是一座沙盘自己的数：路有多长就有多少点）。
 */
function liftedPointsChecked(key: string): number {
  const { R, look, build } = roadsOf(key);
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
  kit.dispose();
  return checked;
}

describe.each(realSceneKeys('route'))('%s 的路', (key) => {
  const { R, look, build, kindOf } = roadsOf(key);

  it('样式里四种线的颜色各不相同（这里照颜色认线）', () => {
    const colours = [look.halo.colour, ...ROAD_STATES.map((state) => look.lines[state].colour)];
    expect(new Set(colours).size).toBe(4);
  });

  it('每一节：画的就是 roadRuns 排出来的那几笔——垫底的浅色线只垫样式里说要垫的那几种；一种状态、一种线型一批（样式不另写线型的：实线一批，虚线一批）；虚线上的距离每一笔从头量起', () => {
    const kit = build();
    const report: string[] = [];
    // 线型：样式写了就是它的；不写是两种，第 0 种实线、第 1 种虚线（和 src/stage/three/routeKit.ts 一样）
    const patterns = look.patterns?.list ?? [{}, { dashPx: look.dashPx }];
    /** 这一批是不是这一种线型的：照材质上的一划一空认（垫底的照线型里写的垫底线的一划一空）。 */
    const isPattern = (line: Mesh, dash: readonly number[] | undefined): boolean => (dash ? material(line).dashed && material(line).dashSize === dash[0] && material(line).gapSize === dash[1] : !material(line).dashed);
    R.headings.forEach((heading, index) => {
      kit.apply(heading, 0, 50_000);
      const runs = roadRuns(R.scene, R.coords, index, look.patterns?.of);
      const all = lines(kit);
      // 每一条都是一份线段表，没有一笔一条的线（three 的 Line2）
      for (const line of all) {
        expect(line).toBeInstanceOf(LineSegments2);
        expect((line as { isLine2?: boolean }).isLine2, heading).toBeUndefined();
      }
      // 垫底的：样式里说要垫的那几种路的笔画（走过的路不垫）。不跟着虚线断开的合成一批；线型里写了要跟着断开的，一种线型一批
      const under = runs.filter((run) => look.haloUnder.includes(run.state));
      expect(under.length, heading).toBeGreaterThan(0);
      expect(under.some((run) => run.state === 'past'), '走过的路下面垫了浅色线').toBe(false);
      const halos = all.filter((line) => kindOf(line) === 'halo');
      const unbroken = under.filter((run) => !patterns[run.pattern].under);
      expect(halos.filter((line) => !material(line).dashed).map(segmentsIn), `${heading} 不断的垫底线`).toEqual(unbroken.length > 0 ? [segmentCount(unbroken)] : []);
      patterns.forEach((spec, pattern) => {
        if (!spec.under) return;
        const mine = under.filter((run) => run.pattern === pattern);
        expect(halos.filter((line) => isPattern(line, spec.under?.dashPx)).map(segmentsIn), `${heading} 第 ${pattern} 种线型的垫底线`).toEqual(mine.length > 0 ? [segmentCount(mine)] : []);
      });
      expect(halos.reduce((sum, line) => sum + segmentsIn(line), 0), heading).toBe(segmentCount(under));
      for (const state of ROAD_STATES) {
        const drawnHere = all.filter((line) => kindOf(line) === state);
        let batches = 0;
        patterns.forEach((spec, pattern) => {
          // 这一种状态、这一种线型有笔画就正好一批，段数是它们的段数
          const mine = runs.filter((run) => run.state === state && run.pattern === pattern);
          const here = drawnHere.filter((line) => isPattern(line, spec.dashPx));
          expect(here.map(segmentsIn), `${heading} ${state} 第 ${pattern} 种线型`).toEqual(mine.length > 0 ? [segmentCount(mine)] : []);
          batches += here.length;
          if (!spec.dashPx || !here[0]) return;
          // 虚线：线上的距离每一笔从头量起，一段接一段，一笔的最后一段量到的就是这一笔的长
          const from = here[0].geometry.getAttribute('instanceDistanceStart');
          const far = here[0].geometry.getAttribute('instanceDistanceEnd');
          expect(from && far, '虚线没有量过线上的距离').toBeDefined();
          let k = 0;
          for (const run of mine) {
            const count = run.points.length - 1;
            expect(from.getX(k), `${heading} ${run.ways.join('+')} 的头一段不是从 0 量起的`).toBe(0);
            for (let i = 1; i < count; i++) expect(from.getX(k + i)).toBe(far.getX(k + i - 1));
            // 线上的距离是抬到地面上以后量的，比平着量的长一点点，不会短
            expect(far.getX(k + count - 1)).toBeGreaterThanOrEqual(run.lengthM - 1e-3);
            expect(far.getX(k + count - 1)).toBeLessThan(run.lengthM * 1.05);
            k += count;
          }
        });
        // 这一种状态画的每一批都认得出是哪一种线型：没有多出来的
        expect(batches, `${heading} ${state}`).toBe(drawnHere.length);
      }
      // 样式不另写线型的：线型就是虚实（第 0 种实线，第 1 种虚线）
      if (!look.patterns) for (const run of runs) expect(run.pattern, run.ways.join('+')).toBe(run.dotted ? 1 : 0);
      const states = new Set(runs.map((run) => run.state));
      if (index === 0) expect([...states]).toEqual(['ink']);
      else expect(states.has('ink')).toBe(false);
      // 报的三角形数和显出来的网格数出来的一样；路画的批数有上限
      const counted = drawn(kit.group);
      expect(kit.triangles(), heading).toBe(counted.triangles);
      expect(kit.triangles(), heading).toBe((segmentCount(runs) + segmentCount(under)) * ROAD_SEGMENT_TRIANGLES);
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
    // 抽着查的点一个也没有，这一项就什么也没查到；一座沙盘上抽得到多少个是它自己的数，写着名字的那一组查
    expect(liftedPointsChecked(key)).toBeGreaterThan(0);
  });

  it(`宽度是样式里写的页面像素；减配的一档每一种加粗 ${look.reducedExtraPx} 像素`, () => {
    // 样式另写了线型（水路细一些）、写了粗细跟着画面比例的，宽度不是这一个数：那样的样式照它自己的数查
    // （编出来的那一种在 tests/stage/made-up-route.test.ts）。登记表里的样式哪一天写了这两样，这一条要跟着它的数重写，不是跳过去
    expect(look.patterns ?? look.fit, `${key} 的样式另写了线型或者粗细跟着比例：这一条照“一种状态一个宽度”查不了它`).toBeUndefined();
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
    // 样式另写了线型的，虚线不止这一种一划一空：照它自己的表查（见上一条的话）
    expect(look.patterns, `${key} 的样式另写了线型：这一条照“只有一种虚线”查不了它`).toBeUndefined();
    const kit = build();
    kit.apply(R.headings[0], 0, 62_800);
    const dotted = lines(kit).filter((line) => material(line).dashed);
    // 头一节有虚线的笔画，画出来就有虚线的一批；一笔虚线也没有的沙盘（每一截路都有出处）下面没有线可查。
    // 这一座有没有虚线是它自己的事，写着名字的那一组查
    expect(dotted.length > 0).toBe(roadRuns(R.scene, R.coords, 0).some((run) => run.dotted));
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

// ---------------------------------------------------------------- 苏轼的这一座自己的数

describe('su-shi/route 的路：苏轼这一座自己的数', () => {
  const key = 'su-shi/route';

  it('头一节（全程）的线上，抽着查高度的点有五百个以上（“每一座”那一组里查的是抽到的每一个点都抬高了那么多）', () => {
    expect(liftedPointsChecked(key)).toBeGreaterThan(500);
  });

  it('头一节（全程）里有虚线：“每一座”那一组里“虚线在页面上总是那么长”的那一项，在这一座上有线可查', () => {
    const { R, build } = roadsOf(key);
    const kit = build();
    kit.apply(R.headings[0], 0, 62_800);
    expect(lines(kit).filter((line) => material(line).dashed).length).toBeGreaterThan(0);
    kit.dispose();
  });
});
