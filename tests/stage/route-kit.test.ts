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
// 分两组：content/ 里有几座全程沙盘，“每一座”那一组就查几座；一座沙盘自己的数（线上抽得到多少个点、头一节里有没有虚线，
// 样式另写了线型、写了粗细跟着画面比例的那一座：几种线型、每一节几批、各多宽）在写着它名字的那一组里（su-shi/route、goethe/route）。
// “每一座”那一组里有三条照样式分两种查法：样式没有另写线型、没有写粗细跟着比例的，照“一种状态一个宽度、一种虚线”查；写了的照它的线型表查。

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
        // 样式写了粗细跟着画面比例的（roads.fit）：全程那一节垫底的浅色线多透是它自己调的，照它自己的数在写着这座沙盘名字的那一组里查；
        // 别的线、别的小节照旧是样式里写的那个数
        if (kind === 'halo' && look.fit && heading === R.headings[0]) {
          expect(m.opacity).toBeGreaterThan(0);
          expect(m.opacity).toBeLessThanOrEqual(1);
        } else expect(m.opacity).toBe(kind === 'halo' ? look.halo.opacity : look.lines[kind].opacity);
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
    // 两种样式两种查法，照样式自己写没写线型（roads.patterns）、写没写粗细跟着画面比例（roads.fit）分：
    //   都没写的（一种状态一个宽度）：全程那一节和末一节，每一条线的宽度就是样式里那一种状态的数，垫底的是垫底线的数；
    //   写了的：看一站的小节里（末一节），每一种状态的线是它的数乘上这一种线型的倍数（线型里的 widthTimes，没写是 1）；
    //     全程那一节的宽度、垫底线的宽度是样式的 fit 调的，照它自己的数在写着这座沙盘名字的那一组里查。
    // 哪一种都查：宽度按页面的像素算，不按沙盘里的米；减配的一档加粗。
    const patterns = look.patterns?.list;
    for (const tier of ['full', 'reduced'] as const) {
      const kit = build(tier);
      const extra = tier === 'reduced' ? look.reducedExtraPx : 0;
      for (const heading of [R.headings[0], R.headings.at(-1) as string]) {
        kit.apply(heading, 0, 40_000);
        for (const line of lines(kit)) {
          const kind = kindOf(line);
          const m = material(line);
          expect(m.worldUnits).toBe(false);
          if (!patterns && !look.fit) expect(m.linewidth).toBeCloseTo((kind === 'halo' ? look.halo.widthPx : look.lines[kind].widthPx) + extra, 9);
          else if (kind !== 'halo' && heading !== R.headings[0]) {
            // 这一批是第几种线型：照材质上的一划一空认
            const spec = (patterns ?? [{}, { dashPx: look.dashPx }]).find((item) => (item.dashPx ? m.dashed && m.dashSize === item.dashPx[0] && m.gapSize === item.dashPx[1] : !m.dashed));
            expect(spec, `${heading} ${kind} 的一批不是样式里哪一种线型`).toBeDefined();
            expect(m.linewidth, `${heading} ${kind}`).toBeCloseTo(look.lines[kind].widthPx * (spec?.widthTimes ?? 1) + extra, 9);
          } else expect(m.linewidth).toBeGreaterThan(0);
        }
      }
      kit.dispose();
    }
  });

  it(look.patterns ? '虚线：样式的线型表里写的每一种一划一空，镜头远近变了，在页面上还是那么长' : `虚线：一划 ${look.dashPx[0]} 像素、一空 ${look.dashPx[1]} 像素，镜头远近变了，在页面上还是那么长`, () => {
    // 样式另写了线型的，虚线不止一种一划一空：每一批虚线是线型表里的一种（垫底的照线型里写的垫底线的一划一空）；
    // 没另写的只有一种，就是样式里的 dashPx
    const dashes: readonly (readonly number[])[] = look.patterns ? look.patterns.list.flatMap((spec) => [spec.dashPx, spec.under?.dashPx].filter((dash): dash is [number, number] => dash !== undefined)) : [look.dashPx];
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
        expect(dashes.some((dash) => m.dashSize === dash[0] && m.gapSize === dash[1]), `一划 ${m.dashSize}、一空 ${m.gapSize} 不是样式里写的哪一种`).toBe(true);
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

// ---------------------------------------------------------------- 歌德的这一座自己的数

describe('goethe/route 的路：歌德这一座自己的数', () => {
  const key = 'goethe/route';
  /** 一个画面里，沙盘里的一米合多少像素 × 远近（和 src/stage/three/routeKit.ts 交给样式的那个数是同一个算法）。 */
  const focal = equivalentDistance(1, 90, 2);

  it('三种线型：陆路有记载的是实线，陆路记载太少的是虚线（一划 7、一空 5.5），水路和海路是细点线（一划 3.4、一空 3，陆路的 0.68 倍宽）——水路不分虚实；垫底的浅色线跟着虚线断开', () => {
    const { look } = roadsOf(key);
    const list = look.patterns?.list ?? [];
    expect(list).toHaveLength(3);
    expect(list[0]).toEqual({});
    expect(list[1].dashPx).toEqual([7, 5.5]);
    expect(list[1].widthTimes).toBeUndefined();
    expect(list[2].dashPx).toEqual([3.4, 3]);
    expect(list[2].widthTimes).toBe(0.68);
    // 垫底线每一划两头各宽出一点（陆路 1.2 像素，水路 0.6 像素），空着的地方露出地面
    expect(list[1].under).toEqual({ dashPx: [7 + 2.4, 5.5 - 2.4], offsetPx: 1.2 });
    expect(list[2].under?.offsetPx).toBeCloseTo(0.6, 12);
    expect(list[2].under?.dashPx[0]).toBeCloseTo(4.6, 12);
    expect(list[2].under?.dashPx[1]).toBeCloseTo(1.8, 12);
    const of = look.patterns?.of;
    if (!of) throw new Error('样式没有写一笔用哪一种线型');
    expect([of(false, 'land'), of(true, 'land'), of(false, 'water'), of(true, 'water'), of(false, 'sea'), of(true, 'sea')]).toEqual([0, 1, 2, 2, 2, 2]);
    expect(look.dashPx).toEqual([7, 5.5]);
    expect(look.haloUnder).toEqual(['ink', 'now']);
  });

  it('每一节的路画几批：6、8、6、9、5、7、7、7、9（完整的一档和减配的一档一样）', () => {
    const { R, build } = roadsOf(key);
    for (const tier of ['full', 'reduced'] as const) {
      const kit = build(tier);
      const calls = R.headings.map((heading) => {
        kit.apply(heading, 0, 50_000);
        return drawn(kit.group).calls;
      });
      expect(calls, tier).toEqual([6, 8, 6, 9, 5, 7, 7, 7, 9]);
      kit.dispose();
    }
  });

  it('线比地面（海上是海面）抬高 4 米；头一节（全程）的线上抽着查高度的点有两千个以上', () => {
    expect(roadsOf(key).look.liftM).toBe(4);
    expect(liftedPointsChecked(key)).toBeGreaterThan(2000);
  });

  it('看一站的小节，照样式里写的数：墨线 1.8、这一站那几年走的 2.4、早先走过的 1.4 像素（八成透明度），垫底线 4.5 像素、六成二；水路的线是 0.68 倍宽，垫在它下面的那一道窄 1.26 像素；减配的一档各加 0.3', () => {
    const { R, look, build, kindOf } = roadsOf(key);
    expect([look.lines.ink.widthPx, look.lines.now.widthPx, look.lines.past.widthPx, look.halo.widthPx]).toEqual([1.8, 2.4, 1.4, 4.5]);
    expect([look.lines.ink.opacity, look.lines.now.opacity, look.lines.past.opacity, look.halo.opacity]).toEqual([0.92, 1, 0.8, 0.62]);
    expect(look.reducedExtraPx).toBe(0.3);
    const list = look.patterns?.list ?? [];
    for (const tier of ['full', 'reduced'] as const) {
      const kit = build(tier);
      const extra = tier === 'reduced' ? 0.3 : 0;
      let water = 0;
      for (const heading of R.headings.slice(1)) {
        kit.apply(heading, 0, 40_000);
        for (const line of lines(kit)) {
          const kind = kindOf(line);
          const m = material(line);
          const pattern = list.findIndex((spec) => {
            const dash = kind === 'halo' ? spec.under?.dashPx : spec.dashPx;
            return dash ? m.dashed && m.dashSize === dash[0] && m.gapSize === dash[1] : !m.dashed;
          });
          expect(pattern, `${heading} ${kind}`).toBeGreaterThanOrEqual(0);
          if (pattern === 2) water += 1;
          if (kind === 'halo') {
            expect(m.linewidth, `${heading} 垫底 第 ${pattern} 种`).toBeCloseTo(4.5 + extra - (pattern === 2 ? 1.26 : 0), 9);
            expect(m.opacity).toBe(0.62);
          } else {
            expect(m.linewidth, `${heading} ${kind} 第 ${pattern} 种`).toBeCloseTo(look.lines[kind].widthPx * (pattern === 2 ? 0.68 : 1) + extra, 9);
            expect(m.opacity).toBe(look.lines[kind].opacity);
          }
        }
      }
      // 八节里真有水路的线可查
      expect(water).toBeGreaterThan(0);
      kit.dispose();
    }
  });

  it('全程那一节，线的粗细跟着画面的比例：倍数 = 100 公里合多少像素 ÷ 72.5，夹在 0.6 和 1 之间；垫底线是墨线两边各加 1 像素、四成透明；水路的线不细过 1 像素', () => {
    const { R, look, build, kindOf } = roadsOf(key);
    const list = look.patterns?.list ?? [];
    for (const tier of ['full', 'reduced'] as const) {
      const kit = build(tier);
      const extra = tier === 'reduced' ? 0.3 : 0;
      const factors: number[] = [];
      for (const D of [15_000, 30_000, 70_000]) {
        kit.apply(R.headings[0], 0, D);
        const pxPer100Km = ((focal / D) * 1e5) / R.scene.frame.scale;
        const factor = Math.min(1, Math.max(0.6, pxPer100Km / 72.5));
        factors.push(Number(factor.toFixed(3)));
        for (const line of lines(kit)) {
          const kind = kindOf(line);
          const m = material(line);
          const pattern = list.findIndex((spec) => {
            const dash = kind === 'halo' ? spec.under?.dashPx : spec.dashPx;
            return dash ? m.dashed && m.dashSize === dash[0] && m.gapSize === dash[1] : !m.dashed;
          });
          const inkNow = Math.max(pattern === 2 ? 1 : 0, (1.8 * (pattern === 2 ? 0.68 : 1) + extra) * factor);
          if (kind === 'halo') {
            expect(m.linewidth, `${D} 垫底 第 ${pattern} 种`).toBeCloseTo(inkNow + 2, 9);
            expect(m.opacity).toBe(0.4);
          } else {
            // 全程那一节每一趟路都是墨线
            expect(kind).toBe('ink');
            expect(m.linewidth, `${D} 墨线 第 ${pattern} 种`).toBeCloseTo(inkNow, 9);
            expect(m.opacity).toBe(0.92);
          }
        }
      }
      // 三个远近：近的夹在 1，中间的在 0.6 和 1 之间，远的夹在 0.6
      expect(factors[0]).toBe(1);
      expect(factors[1]).toBeGreaterThan(0.6);
      expect(factors[1]).toBeLessThan(1);
      expect(factors[2]).toBe(0.6);
      kit.dispose();
    }
    // 远的那一个画面上水路的线到了 1 像素的底（0.68 × 1.8 × 0.6 不到 1）
    expect(1.8 * 0.68 * 0.6).toBeLessThan(1);
  });
});
