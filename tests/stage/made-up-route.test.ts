// 编出来的那一座全程沙盘（./support/madeUpRoute.ts）和它的编出来的样式（./support/madeUpStyle.ts）：
// 另一位人物的全程沙盘会用到、苏轼的那一座用不到的每一条新路，在他的文件进来以前都在这里真的跑一遍。在 Node 里跑，不要浏览器。
// 沙盘、样式都不在读者的构建里（不在 content/，不在样式的登记表里）；人名、地名都是编的。
// 查这几件，每一件都有“改坏一处就查得出来”的一条：
//   校验：这座编出来的沙盘通得过全程沙盘的规则（样式的名字交给规则，不进登记表）；
//   哪一节画哪些路照写的先后（一站分两段讲）；
//   一笔在线型变的地方断开；水路的两种线型；垫底的浅色线跟着虚线断开；走过的水路不垫；一种状态一种线型一批，一个画面不超过 14 批；
//   线的粗细跟着画面的比例（只在全程那一节）；
//   看一站的小节画的是这一站那几年走的路（roads.stopShows 写 stop-years）：explain、mustShow、路出不出画面各问什么；
//   船走在水上（roads.boats 写 on）：水路在它的河上、湖里，没有写走哪条水的另数，短得两头一让就量不到的也另数；做岸线的工具一条线也不做；
//   地面照量到的样子（recipe 是 as-measured）：前四步的结果一米不动，旁边印的话；
//   留白的圈离路、离地名点至少 60 公里；roads 里那两个字段不算进定格图的记号。

import { describe, expect, it } from 'vitest';
import type { Mesh } from 'three';
import type { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import type { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import type { PlainSmoothed, RouteScene } from '../../src/domain/scene';
import { journeysShown } from '../../src/domain/sceneRoads';
import { sectionInfo } from '../../src/domain/sceneText';
import { BLANK_KEEP, routeHeights } from '../../src/stage/ground/route';
import { ROAD_STATES, journeyStates, roadRuns, segmentCount } from '../../src/stage/roadLines';
import type { RoadRun, RoadState } from '../../src/stage/roadLines';
import { equivalentDistance } from '../../src/stage/three/rig';
import { ROAD_SEGMENT_TRIANGLES, buildRouteModels } from '../../src/stage/three/routeKit';
import { loadStyle } from '../../src/stage/three/style';
import type { StageTier } from '../../src/stage/types';
import { BLANK_CLEAR_KM, blankClearance, checkRouteScene, checkRouteShape } from '../content/routeRules';
import { STYLE_IDS } from '../content/sceneRules';
import { pictureKey } from '../support/pictureKey';
import { bankWays } from '../tools/route/bankTool';
import { routeRiversFor } from '../tools/route/painters';
import { drawn } from './support/budgets';
import { MADE_UP_PAINTERS, MADE_UP_ROUTE_STYLE, MADE_UP_STOPS, madeUpFiles, madeUpRoute, madeUpRouteOf, madeUpScene } from './support/madeUpRoute';
import { FIT_MIN, FIT_REFERENCE_PX, FIT_UNDER_OPACITY, FIT_UNDER_SIDE_PX, FIT_WATER_MIN_PX, MADE_UP_PATTERNS, MADE_UP_STYLES, MADE_UP_STYLE_ID, madeUpPatternOf, style } from './support/madeUpStyle';
import { boatsOnWater, ownJourneysTold, ownRoadsHeldInPane } from './support/routeFacts';
import type { BoatLimits } from './support/routeFacts';

/** 一个画面里路最多画几批（和 tests/stage/route-kit.test.ts 的是同一个数）。 */
const ROAD_CALLS_MAX = 14;
/** 这座编出来的沙盘上船走在水上：沿河的水路离画出来的河最多 3 公里，两头各让出 6 公里（它自己定的数）。 */
const LIMITS: BoatLimits = { riverKm: 3, landingKm: 6 };

type Kit = ReturnType<typeof buildRouteModels>;
const lines = (kit: Kit): LineSegments2[] => kit.group.children as LineSegments2[];
const material = (line: Mesh): LineMaterial => line.material as LineMaterial;
const segmentsIn = (line: Mesh): number => (line.geometry as unknown as { instanceCount: number }).instanceCount;
/** 哪一层是哪一种：和 src/stage/three/routeKit.ts 里画的先后一样。 */
const LAYER: Record<number, RoadState | 'halo'> = { 10: 'halo', 11: 'past', 12: 'ink', 13: 'now' };
const look = MADE_UP_ROUTE_STYLE.roads;

/** 校验这座沙盘（改过一处的也行）：每处问题写成“规则号 字段”。styleIds 不写就是这种编出来的样式。 */
function problems(change: (scene: RouteScene) => void = () => {}, styleIds: readonly string[] = [MADE_UP_STYLE_ID]): string[] {
  const scene = madeUpScene();
  change(scene);
  const { file, files, sizes } = madeUpFiles(scene);
  const shape = checkRouteShape(JSON.parse(JSON.stringify(scene)), file);
  const found = shape.length > 0 ? shape : checkRouteScene(scene, file, { stops: [...MADE_UP_STOPS] }, files, sizes, styleIds);
  return found.map((v) => `${v.rule} ${v.field}`);
}
/** 同上，要的是说的话。 */
function words(change: (scene: RouteScene) => void): string[] {
  const scene = madeUpScene();
  change(scene);
  const { file, files, sizes } = madeUpFiles(scene);
  const shape = checkRouteShape(JSON.parse(JSON.stringify(scene)), file);
  return (shape.length > 0 ? shape : checkRouteScene(scene, file, { stops: [...MADE_UP_STOPS] }, files, sizes, [MADE_UP_STYLE_ID])).map((v) => v.problem);
}

/** 一笔写成一句：哪一种、第几种线型、哪几截路。 */
const say = (run: RoadRun): string => `${run.state} ${run.pattern} ${run.ways.join('+')}`;
const strokes = (section: number): RoadRun[] => {
  const R = madeUpRoute();
  return roadRuns(R.scene, R.coords, section, madeUpPatternOf);
};
const build = (tier: StageTier = 'full', scene?: RouteScene): Kit => {
  const R = scene ? madeUpRouteOf(scene) : madeUpRoute();
  return buildRouteModels({ scene: R.scene, coords: R.coords, samplers: R.samplers, style: MADE_UP_ROUTE_STYLE, tier });
};
/** 一批写成一句：哪一种，第几种线型（照一划一空认），几段。 */
function batchSay(line: LineSegments2): string {
  const m = material(line);
  const kind = LAYER[line.renderOrder];
  const dash = m.dashed ? `虚 ${m.dashSize}/${m.gapSize}${m.dashOffset ? ` 起 ${m.dashOffset}` : ''}` : '实';
  return `${kind} ${dash} ${segmentsIn(line)} 段`;
}

describe('编出来的那一座全程沙盘：校验', () => {
  it('通得过全程沙盘的格式和规则 10 到 15；它的样式不在登记表里，规则认得它是因为名字是交进去的——不交，规则 10 说“程序里没有”', () => {
    expect(problems()).toEqual([]);
    // 交的是登记表里的那几种（规则平常用的就是它）：这种编出来的样式不在里面
    expect(STYLE_IDS).not.toContain(MADE_UP_STYLE_ID);
    expect(problems(() => {}, STYLE_IDS)).toEqual(['10 style']);
    expect(style.id).toBe(MADE_UP_STYLE_ID);
  });

  it('roads.stopShows 只能写 way-there 或 stop-years，roads.boats 只能写 beside 或 on；都可以不写', () => {
    expect(madeUpScene().roads.stopShows).toBe('stop-years');
    expect(madeUpScene().roads.boats).toBe('on');
    expect(problems((s) => ((s.roads as { stopShows?: string }).stopShows = 'both'))).toEqual(['0 roads.stopShows']);
    expect(problems((s) => ((s.roads as { boats?: string }).boats = 'under'))).toEqual(['0 roads.boats']);
    expect(problems((s) => (s.roads.stopShows = 'way-there'))).toEqual([]);
    expect(problems((s) => (s.roads.boats = 'beside'))).toEqual([]);
    expect(
      problems((s) => {
        delete s.roads.stopShows;
        delete s.roads.boats;
      }),
    ).toEqual([]);
  });

  it('地面照量到的样子（recipe 的 kind 写 as-measured）：没有抹平原的那几个数，写了通不过；kind 写别的通不过；改回 plain-smoothed 就得把那几个数写全', () => {
    expect(madeUpScene().terrain.recipe.kind).toBe('as-measured');
    expect(problems((s) => ((s.terrain.recipe as unknown as { smoothM: number }).smoothM = 45000))).toEqual(['0 terrain.recipe.smoothM']);
    expect(problems((s) => ((s.terrain.recipe as { kind: string }).kind = 'untouched'))).toEqual(['0 terrain.recipe.kind']);
    expect(problems((s) => ((s.terrain.recipe as { kind: string }).kind = 'plain-smoothed'))).toEqual([
      '0 terrain.recipe.plainBelowM',
      '0 terrain.recipe.hillAboveM',
      '0 terrain.recipe.smoothM',
      '0 terrain.recipe.plainKeep',
      '0 terrain.recipe.rippleM',
    ]);
  });

  it(`留白的圈离画出来的每一截路、每一个地名点至少 ${BLANK_CLEAR_KM} 公里：这一座最近的也在 ${BLANK_CLEAR_KM} 公里以外；圈挪到离辛集 59 公里就通不过，说是哪一圈、离什么多远；60 公里多一点通得过`, () => {
    const R = madeUpRoute();
    const nearest = blankClearance(R.scene).reduce((best, near) => (near.km < best.km ? near : best));
    console.log(`编出来的那一座：留白的圈离得最近的是${nearest.what}，${nearest.km.toFixed(1)} 公里`);
    expect(nearest.km).toBeGreaterThanOrEqual(BLANK_CLEAR_KM);
    // 一圈尖朝东的三角，尖离辛集（地名点 p-xin，路 w-ferry 的尾）正好 km 公里
    const xin = R.scene.places.find((place) => place.id === 'p-xin');
    if (!xin) throw new Error('编出来的沙盘里没有 p-xin');
    const [x, z] = R.coords.toLocal(xin.at);
    const m = (km: number): number => (km * 1000) / R.scene.frame.scale;
    const ringAt = (km: number) => (s: RouteScene): void => {
      s.terrain.recipe.blank = [[R.coords.toLngLat(x - m(km), z), R.coords.toLngLat(x - m(km + 40), z + m(20)), R.coords.toLngLat(x - m(km + 40), z - m(20))]];
    };
    expect(problems(ringAt(59.5))).toEqual(['11 terrain.recipe.blank[0]', '11 terrain.recipe.blank[0]']);
    expect(words(ringAt(59.5))).toEqual([
      '留白的第 1 圈离路“w-ferry”只有 59 公里；留白的每一圈离画出来的路、地名点至少要有 60 公里（留白的边是抹开的，离得近的路和地名会落在收平、淡掉的那一条里），把圈挪开',
      '留白的第 1 圈离地名点“p-xin”只有 59 公里；留白的每一圈离画出来的路、地名点至少要有 60 公里（留白的边是抹开的，离得近的路和地名会落在收平、淡掉的那一条里），把圈挪开',
    ]);
    expect(problems(ringAt(60.5))).toEqual([]);
    // 圈把地名点圈在里面：说的是“圈在里面了”
    expect(words(ringAt(-10))).toContainEqual(expect.stringContaining('把地名点“p-xin”圈在里面了'));
    // 圈的尖对着一截长直路的正中间（w-ridge 从乙渡往西北的头一段，一百五十公里上下），这一段两头写的点都远：
    // 路是沿线一路量过去的，不是只量写的那几个点——只量写的点，这一圈就漏过去了
    const ridge = R.scene.roads.ways.find((way) => way.id === 'w-ridge');
    if (!ridge) throw new Error('编出来的沙盘里没有 w-ridge');
    const [ax, az] = R.coords.toLocal(ridge.line[0]);
    const [bx, bz] = R.coords.toLocal(ridge.line[1]);
    const long = Math.hypot(bx - ax, bz - az);
    const [tx, tz] = [(bx - ax) / long, (bz - az) / long];
    const [mx, mz] = [(ax + bx) / 2, (az + bz) / 2];
    // 圈摆在这一段朝沙盘外面的那一边（东北边）：那一边没有别的路，也没有地名点
    const side = -tz * mx + tx * mz > 0 ? 1 : -1;
    const [nx, nz] = [-tz * side, tx * side];
    const ringMid = (km: number) => (s: RouteScene): void => {
      const [fx, fz] = [mx + nx * m(km + 40), mz + nz * m(km + 40)];
      s.terrain.recipe.blank = [[R.coords.toLngLat(mx + nx * m(km), mz + nz * m(km)), R.coords.toLngLat(fx + tx * m(20), fz + tz * m(20)), R.coords.toLngLat(fx - tx * m(20), fz - tz * m(20))]];
    };
    // 这一段有一百四十公里以上；圈的尖离它两头写的点都在 90 公里以外，离正中间 59 公里半
    expect((long * R.scene.frame.scale) / 1000).toBeGreaterThan(140);
    expect((Math.hypot(m(59.5), long / 2) * R.scene.frame.scale) / 1000).toBeGreaterThan(90);
    expect(words(ringMid(59.5))).toEqual([
      '留白的第 1 圈离路“w-ridge”只有 59 公里；留白的每一圈离画出来的路、地名点至少要有 60 公里（留白的边是抹开的，离得近的路和地名会落在收平、淡掉的那一条里），把圈挪开',
    ]);
    expect(problems(ringMid(60.5))).toEqual([]);
  });
});

describe('编出来的那一座全程沙盘：哪一节画哪些路，排成几笔', () => {
  it('一站分两段讲（甲城：头一回到，去了丙港，又回来）：甲城那一节里丙港的两趟是走过的；丙港那一节里甲城后一段的路不画；丁镇那一节里前面的都是走过的', () => {
    const R = madeUpRoute();
    expect(R.scene.roads.journeys.map((journey) => `${journey.id}:${journey.stop}`)).toEqual(['j-arrive:jia', 'j-down:bing', 'j-island:bing', 'j-return:jia', 'j-lake:ding']);
    expect(journeysShown(R.scene, 0)).toEqual(['whole', 'whole', 'whole', 'whole', 'whole']);
    expect(journeysShown(R.scene, 1)).toEqual(['own', 'before', 'before', 'own', undefined]);
    expect(journeysShown(R.scene, 2)).toEqual(['before', 'own', 'own', undefined, undefined]);
    expect(journeysShown(R.scene, 3)).toEqual(['before', 'before', 'before', 'before', 'own']);
    expect([...journeyStates(R.scene, 2)]).toEqual([['j-arrive', 'past'], ['j-down', 'now'], ['j-island', 'now']]);
    // 旁边“几样是示意”那一句用的是同一处：丙港那一节里不画的 j-return（示意的一截）不算，全程那一节里算
    const count = (heading: string): number => Number(/^(\d+) 样是示意/.exec(sectionInfo(R.scene, heading).note.brief)?.[1]);
    expect(count(R.headings[0]) - count(R.headings[2])).toBe(1);
  });

  it('一笔在线型变的地方断开：一趟路里从陆路换成水路（类别一样）换一笔；线型不变的两截（过湖、接着坐船）连成一笔；样式不写线型的时候它们是一笔', () => {
    expect(strokes(0).map(say)).toEqual(['ink 0 w-west', 'ink 2 w-zi-up', 'ink 3 w-zi-down', 'ink 3 w-sea', 'ink 1 w-ridge', 'ink 0 w-south', 'ink 2 w-lake+w-ferry']);
    // 不交线型（只有实线和一种虚线）：到丁镇、过午湖、再坐船的三截类别一样，连成一笔——断开的那一处是线型断的
    const R = madeUpRoute();
    expect(roadRuns(R.scene, R.coords, 0).map(say)).toEqual(['ink 0 w-west', 'ink 0 w-zi-up', 'ink 1 w-zi-down', 'ink 1 w-sea', 'ink 1 w-ridge', 'ink 0 w-south+w-lake+w-ferry']);
    // 看一站的小节：刚走的在前，走过的在后；走过的水路照样用它的线型
    expect(strokes(1).map(say)).toEqual(['now 0 w-west', 'now 1 w-ridge', 'past 2 w-zi-up', 'past 3 w-zi-down', 'past 3 w-sea']);
    expect(strokes(2).map(say)).toEqual(['now 2 w-zi-up', 'now 3 w-zi-down', 'now 3 w-sea', 'past 0 w-west']);
    // 线型：陆路照虚实是 0、1；水路、海路照虚实是 2、3（海路用水路的线型）
    expect([madeUpPatternOf(false, 'land'), madeUpPatternOf(true, 'land'), madeUpPatternOf(false, 'water'), madeUpPatternOf(true, 'water'), madeUpPatternOf(false, 'sea'), madeUpPatternOf(true, 'sea')]).toEqual([0, 1, 2, 3, 2, 3]);
  });
});

describe.each(['full', 'reduced'] as const)('编出来的那一座全程沙盘：画出来的线（%s 这一档）', (tier) => {
  const extra = tier === 'reduced' ? look.reducedExtraPx : 0;

  it(`每一节：一种状态、一种线型一批，垫底的浅色线不断的一批、跟着虚线断开的一种线型一批；一个画面不超过 ${ROAD_CALLS_MAX} 批（这一座是 8、6、5、8 批）`, () => {
    const R = madeUpRoute();
    const kit = build(tier);
    const counts: number[] = [];
    const report: string[] = [];
    R.headings.forEach((heading, index) => {
      kit.apply(heading, 0, 50_000);
      const runs = strokes(index);
      const all = lines(kit);
      const under = runs.filter((run) => look.haloUnder.includes(run.state));
      // 垫底的：不断的一批垫在实线（第 0 种）下面；三种虚线各有一批跟着断开的
      const halos = all.filter((line) => LAYER[line.renderOrder] === 'halo');
      const solidUnder = under.filter((run) => run.pattern === 0);
      expect(halos.filter((line) => !material(line).dashed).map(segmentsIn), heading).toEqual(solidUnder.length > 0 ? [segmentCount(solidUnder)] : []);
      for (const pattern of [1, 2, 3]) {
        const mine = under.filter((run) => run.pattern === pattern);
        const spec = MADE_UP_PATTERNS[pattern].under;
        if (!spec) throw new Error('编出来的样式里三种虚线都写了 under');
        const cut = halos.filter((line) => material(line).dashed && material(line).dashSize === spec.dashPx[0] && material(line).gapSize === spec.dashPx[1]);
        expect(cut.map(segmentsIn), `${heading} 第 ${pattern} 种线型的垫底线`).toEqual(mine.length > 0 ? [segmentCount(mine)] : []);
        for (const line of cut) expect(material(line).dashOffset).toBe(spec.offsetPx);
      }
      // 垫底的一共垫了这么多段：走过的路（连走过的水路）下面一段也没有
      expect(halos.reduce((sum, line) => sum + segmentsIn(line), 0), heading).toBe(segmentCount(under));
      expect(under.some((run) => run.state === 'past')).toBe(false);
      // 线：一种状态、一种线型一批
      for (const state of ROAD_STATES) {
        MADE_UP_PATTERNS.forEach((spec, pattern) => {
          const mine = runs.filter((run) => run.state === state && run.pattern === pattern);
          const here = all.filter((line) => LAYER[line.renderOrder] === state && (spec.dashPx ? material(line).dashed && material(line).dashSize === spec.dashPx[0] && material(line).gapSize === spec.dashPx[1] : !material(line).dashed));
          expect(here.map(segmentsIn), `${heading} ${state} 第 ${pattern} 种线型`).toEqual(mine.length > 0 ? [segmentCount(mine)] : []);
          for (const line of here) {
            // 看一站的小节照样式里写的宽度（全程那一节跟着画面的比例，另一条查）
            if (index > 0) expect(material(line).linewidth).toBeCloseTo(look.lines[state].widthPx * (spec.widthTimes ?? 1) + extra, 9);
            expect(material(line).dashOffset).toBe(0);
            expect(material(line).color.getHexString()).toBe(look.lines[state].colour.slice(1));
          }
        });
      }
      const counted = drawn(kit.group);
      expect(all.length, heading).toBe(counted.calls);
      expect(counted.calls, `${heading} 的路画 ${counted.calls} 批`).toBeLessThanOrEqual(ROAD_CALLS_MAX);
      expect(kit.triangles(), heading).toBe((segmentCount(runs) + segmentCount(under)) * ROAD_SEGMENT_TRIANGLES);
      counts.push(counted.calls);
      report.push(`  ${heading}：${runs.length} 笔，${counted.calls} 批——${all.map(batchSay).join('；')}`);
    });
    console.log(`编出来的那一座的路（${tier}），每一节分几批\n${report.join('\n')}`);
    expect(counts).toEqual([8, 6, 5, 8]);
    kit.dispose();
  });

  it('水路的两种线型：有记载的一划 3.4、一空 3；只知道两头的把空拉长一倍（3.4、6）；都是陆路的 0.68 倍宽；垫底线每一划两头各宽出一点、空的地方不垫', () => {
    const [, land, record, endsOnly] = MADE_UP_PATTERNS;
    expect(record.dashPx).toEqual([3.4, 3]);
    expect(endsOnly.dashPx).toEqual([3.4, 6]);
    expect((endsOnly.dashPx as number[])[1]).toBe(2 * (record.dashPx as number[])[1]);
    expect([record.widthTimes, endsOnly.widthTimes]).toEqual([0.68, 0.68]);
    // 垫底线：一划加两头各 e，一空减两头各 e，头一划往前挪 e；e 不超过 1.2，也不超过空的一半减 0.9
    for (const spec of [land, record, endsOnly]) {
      const [dash, gap] = spec.dashPx as [number, number];
      const e = Math.min(1.2, gap / 2 - 0.9);
      expect(spec.under).toEqual({ dashPx: [dash + 2 * e, gap - 2 * e], offsetPx: e });
      expect((spec.under?.dashPx[0] ?? 0) + (spec.under?.dashPx[1] ?? 0)).toBeCloseTo(dash + gap, 12);
    }
    // 丙港那一节：刚走的两种水路各一批，材质上的数就是表里的
    const R = madeUpRoute();
    const kit = build(tier);
    kit.apply(R.headings[2], 0, 40_000);
    const now = lines(kit).filter((line) => LAYER[line.renderOrder] === 'now');
    expect(now.map((line) => [material(line).dashSize, material(line).gapSize])).toEqual([[3.4, 3], [3.4, 6]]);
    for (const line of now) expect(material(line).linewidth).toBeCloseTo(look.lines.now.widthPx * 0.68 + extra, 9);
    // 虚线上的距离每一笔从头量起；垫底线的距离和它上面那一批的一个数不差（一划对着一划）
    const sea = now[1];
    const from = sea.geometry.getAttribute('instanceDistanceStart');
    const far = sea.geometry.getAttribute('instanceDistanceEnd');
    let k = 0;
    for (const run of strokes(2).filter((item) => item.state === 'now' && item.pattern === 3)) {
      expect(from.getX(k)).toBe(0);
      k += run.points.length - 1;
      expect(far.getX(k - 1)).toBeGreaterThanOrEqual(run.lengthM - 1e-3);
    }
    expect(k).toBe(segmentsIn(sea));
    const underSea = lines(kit).filter((line) => LAYER[line.renderOrder] === 'halo' && material(line).gapSize === (endsOnly.under?.dashPx[1] ?? -1))[0];
    expect([...(underSea.geometry.getAttribute('instanceDistanceEnd').array as Float32Array)]).toEqual([...(far.array as Float32Array)]);
    kit.dispose();
  });

  it('线的粗细跟着画面的比例，只在全程那一节：倍数 = 100 公里合多少像素 ÷ 72.5，夹在 0.6 和 1 之间；垫底线是线两边各加 1 像素、四成透明；水路不细过 1 像素；看一站的小节是样式里写的宽度', () => {
    const R = madeUpRoute();
    const kit = build(tier);
    const focal = equivalentDistance(1, 90, 2);
    const factors: number[] = [];
    for (const D of [30_000, 70_000, 120_000]) {
      kit.apply(R.headings[0], 0, D);
      const pxPer100Km = ((focal / D) * 1e5) / R.scene.frame.scale;
      const factor = Math.min(1, Math.max(FIT_MIN, pxPer100Km / FIT_REFERENCE_PX));
      factors.push(Number(factor.toFixed(3)));
      for (const line of lines(kit)) {
        const m = material(line);
        const kind = LAYER[line.renderOrder];
        // 照一划一空认是第几种线型（垫底的照它自己的一划一空）
        const pattern = MADE_UP_PATTERNS.findIndex((spec) => {
          const dash = kind === 'halo' ? spec.under?.dashPx : spec.dashPx;
          return dash ? m.dashed && m.dashSize === dash[0] && m.gapSize === dash[1] : !m.dashed;
        });
        const water = pattern >= 2;
        const inkNow = Math.max(water ? FIT_WATER_MIN_PX : 0, (look.lines.ink.widthPx * (MADE_UP_PATTERNS[pattern].widthTimes ?? 1) + extra) * factor);
        if (kind === 'halo') {
          expect(m.linewidth, `${D} 垫底 第 ${pattern} 种`).toBeCloseTo(inkNow + 2 * FIT_UNDER_SIDE_PX, 9);
          expect(m.opacity).toBe(FIT_UNDER_OPACITY);
        } else {
          expect(kind).toBe('ink');
          expect(m.linewidth, `${D} 墨线 第 ${pattern} 种`).toBeCloseTo(inkNow, 9);
          expect(m.opacity).toBe(look.lines.ink.opacity);
        }
      }
    }
    // 三个远近：近的夹在 1，中间的在 0.6 和 1 之间，远的夹在 0.6
    expect(factors[0]).toBe(1);
    expect(factors[1]).toBeGreaterThan(FIT_MIN);
    expect(factors[1]).toBeLessThan(1);
    expect(factors[2]).toBe(FIT_MIN);
    // 远的那一个画面上水路的线到了 1 像素的底（0.68 × 1.8 × 0.6 不到 1）
    expect(look.lines.ink.widthPx * 0.68 * FIT_MIN).toBeLessThan(FIT_WATER_MIN_PX);
    // 换到看一站的小节：不管多远，都是样式里写的宽度和透明度
    kit.apply(R.headings[1], 0, 120_000);
    for (const line of lines(kit)) {
      const m = material(line);
      const kind = LAYER[line.renderOrder];
      if (kind === 'halo') {
        expect(m.linewidth).toBeCloseTo(look.halo.widthPx + extra, 9);
        expect(m.opacity).toBe(look.halo.opacity);
      } else {
        expect(m.opacity).toBe(look.lines[kind].opacity);
        expect([look.lines[kind].widthPx + extra, look.lines[kind].widthPx * 0.68 + extra].some((w) => Math.abs(w - m.linewidth) < 1e-9)).toBe(true);
      }
    }
    kit.dispose();
  });
});

describe('编出来的样式交给沙盘程序的办法', () => {
  it('不在登记表里：照交进去的单子取，取到的就是这一份；只有全程沙盘用的那一半，取整套的拒绝', async () => {
    expect(await loadStyle(MADE_UP_STYLE_ID, 'route', MADE_UP_STYLES)).toBe(style);
    await expect(loadStyle(MADE_UP_STYLE_ID, 'stop', MADE_UP_STYLES)).rejects.toThrow('只有全程沙盘用的那一半');
    await expect(loadStyle(MADE_UP_STYLE_ID, 'route', [])).rejects.toThrow('没有登记');
  });
});

describe('编出来的那一座全程沙盘：roads 里它自己说的两件事', () => {
  it('看一站的小节画的是这一站那几年走的路（stopShows 写 stop-years）：explain 里至少有一趟这一站自己的路，mustShow 不管路，路可以走出画面；改回看来路就要每一趟都在', () => {
    const scene = madeUpScene();
    expect(ownJourneysTold(scene)).toEqual([]);
    expect(ownRoadsHeldInPane(scene)).toBe(false);
    // explain 里把这一站自己的路去掉：查得出来，说的是哪一节
    const untold = madeUpScene();
    untold.sections[1].explain = ['levels'];
    expect(ownJourneysTold(untold)).toEqual(['甲城那几年 的 explain 里一趟这一站自己的路也没有（有 j-arrive、j-return）']);
    // explain 里只点到别的站的一趟路（j-down 算在丙港名下）：不算数，说的还是那一句——要的是这一站自己的路，不是随便哪一趟
    const others = madeUpScene();
    expect(others.roads.journeys.find((journey) => journey.id === 'j-down')?.stop).toBe('bing');
    expect(others.sections[1].stop).toBe('jia');
    others.sections[1].explain = ['j-down'];
    expect(ownJourneysTold(others)).toEqual(['甲城那几年 的 explain 里一趟这一站自己的路也没有（有 j-arrive、j-return）']);
    // 同一份场景当成看来路的沙盘：到这一站的每一趟都要在 explain 和 mustShow 里，路要落在画面里
    const wayThere = madeUpScene();
    delete wayThere.roads.stopShows;
    expect(ownRoadsHeldInPane(wayThere)).toBe(true);
    expect(ownJourneysTold(wayThere)).toEqual([
      '甲城那几年 的 mustShow 里没有 j-arrive',
      '甲城那几年 的 explain 里没有 j-return',
      '甲城那几年 的 mustShow 里没有 j-return',
      '丙港那几年 的 mustShow 里没有 j-down',
      '丙港那几年 的 explain 里没有 j-island',
      '丙港那几年 的 mustShow 里没有 j-island',
      '丁镇那几年 的 mustShow 里没有 j-lake',
    ]);
  });

  it('船走在水上（boats 写 on）：沿子河的两条水路离画出来的河不超过 3 公里，过午湖的一条在湖里；没有写走哪条水的一条另数；一点挪出水就查得出来', () => {
    const R = madeUpRoute();
    const rivers = (scene: RouteScene) => routeRiversFor(scene.style, MADE_UP_PAINTERS)(scene, R.features, R.coords);
    const good = boatsOnWater(R.scene, R.coords, R.features, rivers(R.scene), LIMITS);
    console.log(`编出来的那一座的船走在水上：\n${good.lines.join('\n')}\n  没有写走的是哪条水的水路：${good.nameless.join('、')}\n  两头一让就一个点也不剩的水路：${good.unmeasured.join('、') || '没有'}`);
    expect(good.off).toEqual([]);
    expect(good.lines).toHaveLength(3);
    expect(good.nameless).toEqual(['w-ferry']);
    expect(good.unmeasured).toEqual([]);
    // 沿河的一条：中间的一个点往北挪 0.2 度（二十多公里）
    const offRiver = madeUpScene();
    const up = offRiver.roads.ways.find((way) => way.id === 'w-zi-up');
    if (!up) throw new Error('编出来的沙盘里没有 w-zi-up');
    up.line[2] = [up.line[2][0], up.line[2][1] + 0.2];
    const bad = boatsOnWater(offRiver, R.coords, R.features, rivers(offRiver), LIMITS);
    expect(bad.off).toHaveLength(1);
    expect(bad.off[0]).toMatch(/^w-zi-up：第 \d+ 公里（东经 159\.\d+、北纬 21\.\d+）离它走的河 zi 有 2\d\.\d 公里，不能超过 3 公里$/);
    // 过湖的一条：中间的一个点挪到湖的东岸外面
    const offLake = madeUpScene();
    const lake = offLake.roads.ways.find((way) => way.id === 'w-lake');
    if (!lake) throw new Error('编出来的沙盘里没有 w-lake');
    lake.line[1] = [160.3, lake.line[1][1]];
    const dry = boatsOnWater(offLake, R.coords, R.features, rivers(offLake), LIMITS);
    expect(dry.off).toHaveLength(1);
    expect(dry.off[0]).toMatch(/^w-lake：\d+ 个点不在它走的湖 wu 里/);
    // 做岸线的工具：船走在水上的沙盘一条线也不做；同一份场景改成画在河边，沿河的两条都要做
    expect(bankWays(R.scene)).toEqual([]);
    const beside = madeUpScene();
    delete beside.roads.boats;
    expect(bankWays(beside).map((way) => way.id)).toEqual(['w-zi-up', 'w-zi-down']);
  });

  it('船走在水上：短得两头一让就一个点也不剩的水路另数、印出来——它没有不合，也没有量过（挪出了水也查不出来）；这一座照它自己的两个数，三条都量到了', () => {
    const R = madeUpRoute();
    const rivers = (scene: RouteScene) => routeRiversFor(scene.style, MADE_UP_PAINTERS)(scene, R.features, R.coords);
    // 照这一座自己的数（两头各让出 6 公里）：写了走哪条水的三条都有点量到
    const own = boatsOnWater(R.scene, R.coords, R.features, rivers(R.scene), LIMITS);
    expect(own.unmeasured).toEqual([]);
    expect(own.lines.filter((line) => line.includes('没有量'))).toEqual([]);
    // 两头各让出 35 公里：过午湖的一条一共六十来公里，一个点也不剩——另数，印出来的那一行说“没有量”，不算不合；沿河的两条照样量
    const short = boatsOnWater(R.scene, R.coords, R.features, rivers(R.scene), { ...LIMITS, landingKm: 35 });
    expect(short.unmeasured).toEqual(['w-lake']);
    expect(short.off).toEqual([]);
    expect(short.nameless).toEqual(['w-ferry']);
    expect(short.lines).toHaveLength(3);
    expect(short.lines.filter((line) => line.includes('没有量'))).toEqual([expect.stringMatching(/^ {2}w-lake 走 wu（湖）：6\d 公里，两头各让出 35 公里以后一个点也不剩　← 没有量$/)]);
    // 为什么要另数：过湖的那一条中间挪到了湖的东岸外面，两头让出的一长（90 公里，比它的一半还长），就查不出来了——单子上有它
    const offLake = madeUpScene();
    const lake = offLake.roads.ways.find((way) => way.id === 'w-lake');
    if (!lake) throw new Error('编出来的沙盘里没有 w-lake');
    lake.line[1] = [160.3, lake.line[1][1]];
    expect(boatsOnWater(offLake, R.coords, R.features, rivers(offLake), LIMITS).off).toHaveLength(1);
    const blind = boatsOnWater(offLake, R.coords, R.features, rivers(offLake), { ...LIMITS, landingKm: 90 });
    expect(blind.off).toEqual([]);
    expect(blind.unmeasured).toEqual(['w-zi-down', 'w-lake']);
  });

  it('这两个字段不算进定格图的记号：写不写、写哪一种，记号一样；挪一条路的一个点，记号就变', () => {
    const key = pictureKey(madeUpScene());
    const other = madeUpScene();
    delete other.roads.stopShows;
    other.roads.boats = 'beside';
    expect(pictureKey(other)).toBe(key);
    const moved = madeUpScene();
    moved.roads.ways[0].line[1][0] += 0.01;
    expect(pictureKey(moved)).not.toBe(key);
  });
});

describe('编出来的那一座全程沙盘：地面照量到的样子（recipe 是 as-measured）', () => {
  it('平原不抹：没有留白的时候，做出来的海拔就是前四步（取样、抹成海的圈、四边收低、轻轻抹半格）的结果，一格不差；同一份地形改成抹平原的办法，平原上就不一样了', { timeout: 60_000 }, () => {
    const open = madeUpScene();
    open.terrain.recipe.blank = [];
    const R = madeUpRouteOf(open);
    const before = routeHeights(R.scene, R.dem, R.coords);
    // 一格一格比，数不一样的有几格（不把十几万个数整个交给 expect 去比：对不上的时候它要把两份全印出来）
    let differ = 0;
    for (let k = 0; k < before.h.length; k++) if (R.ground.h[k] !== before.h[k]) differ++;
    expect(R.ground.h).toHaveLength(before.h.length);
    expect(differ).toBe(0);
    // 山高照样过“矮山多夸”的曲线
    const peak = R.ground.h.reduce((best, h, k) => (h > R.ground.h[best] ? k : best), 0);
    expect(R.ground.y[peak]).toBe(Math.fround(R.coords.y(R.ground.h[peak])));
    expect(R.ground.h[peak]).toBeGreaterThan(400);
    // 改成抹平原的办法（数是编的）：平原上有的地方动了 5 米以上
    const smoothed = madeUpScene();
    const recipe: PlainSmoothed = { ...smoothed.terrain.recipe, kind: 'plain-smoothed', plainBelowM: 100, hillAboveM: 200, smoothM: 45_000, plainKeep: 0.1, rippleM: [15, 40], blank: [] };
    smoothed.terrain.recipe = recipe;
    const S = madeUpRouteOf(smoothed);
    let moved = 0;
    for (let k = 0; k < S.ground.h.length; k++) moved = Math.max(moved, Math.abs(S.ground.h[k] - before.h[k]));
    expect(moved).toBeGreaterThan(5);
  });

  it('留白照样压：这一座的留白里有压到底的陆地（高度只留百分之三）；四边照样收到零', { timeout: 60_000 }, () => {
    const R = madeUpRoute();
    const { nx, nz, h, y, land, blank } = R.ground;
    const before = routeHeights(R.scene, R.dem, R.coords);
    let pressed = 0;
    for (let k = 0; k < blank.length; k++) {
      // 边线以里（抹开以后不到 0.5）：压到底
      if (!land[k] || blank[k] >= 0.5 || before.h[k] < 20) continue;
      pressed++;
      expect(y[k]).toBeCloseTo(R.coords.y(before.h[k]) * BLANK_KEEP, 3);
    }
    expect(pressed).toBeGreaterThan(100);
    for (let i = 0; i < nx; i++) expect(h[i]).toBe(0);
    for (let j = 0; j < nz; j++) expect(h[j * nx]).toBe(0);
  });

  it('旁边印的话：常印着的一句里是“地面没有抹平”；展开的几句里印场景写的那一句，没有写的时候是“地面照今天的样子，没有抹平。”', () => {
    const scene = madeUpScene();
    const info = sectionInfo(scene, scene.sections[0].heading);
    expect(info.note.short.split('；')).toContain('地面没有抹平');
    expect(info.note.brief.split('；')).toContain('地面没有抹平');
    expect(info.note.lines[1]).toBe(scene.terrain.recipe.note);
    delete scene.terrain.recipe.note;
    expect(sectionInfo(scene, scene.sections[0].heading).note.lines[1]).toBe('地面照今天的样子，没有抹平。');
  });
});
