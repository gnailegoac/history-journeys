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
import { PerspectiveCamera } from 'three';
import type { Mesh } from 'three';
import type { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import type { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import type { PlainSmoothed, RouteScene } from '../../src/domain/scene';
import { journeysShown } from '../../src/domain/sceneRoads';
import { sectionInfo } from '../../src/domain/sceneText';
import { BLANK_KEEP, routeHeights } from '../../src/stage/ground/route';
import { ROAD_STATES, journeyStates, roadRuns, segmentCount } from '../../src/stage/roadLines';
import type { RoadRun, RoadState } from '../../src/stage/roadLines';
import type { TableStyle } from '../../src/stage/three/internal';
import { centreShift, equivalentDistance, framePoints, placeCamera, project, showPoints } from '../../src/stage/three/rig';
import { ROAD_SEGMENT_TRIANGLES, buildRouteModels } from '../../src/stage/three/routeKit';
import { loadStyle } from '../../src/stage/three/style';
import type { StageInsets, StageTier } from '../../src/stage/types';
import { BLANK_CLEAR_KM, blankClearance, checkRouteScene, checkRouteShape } from '../content/routeRules';
import { STYLE_IDS } from '../content/sceneRules';
import { pictureKey } from '../support/pictureKey';
import { bankWays } from '../tools/route/bankTool';
import { routeRiversFor } from '../tools/route/painters';
import { drawn } from './support/budgets';
import { MADE_UP_KEY, MADE_UP_PAINTERS, MADE_UP_ROUTE_STYLE, MADE_UP_STOPS, madeUpFiles, madeUpRoute, madeUpRouteOf, madeUpScene } from './support/madeUpRoute';
import { FIT_MIN, FIT_REFERENCE_PX, FIT_UNDER_OPACITY, FIT_UNDER_SIDE_PX, FIT_WATER_MIN_PX, MADE_UP_PATTERNS, MADE_UP_STYLES, MADE_UP_STYLE_ID, RAIL_TOP_Y, madeUpPatternOf, style, styleWithRail } from './support/madeUpStyle';
import { ROUTE_CAMERA_NEAREST_DEFAULT_M, ROUTE_CAMERA_NEAREST_M, boatsOnWater, camerasTooNear, journeysWithNotesPrinted, ownJourneysTold, ownRoadsHeldInPane, routeCameraNearestM, schematicWherePointed } from './support/routeFacts';
import { ROUTE_PANES, STANDARD_PANES } from './support/standardPanes';
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

  // 2026-11-26 以前常印着的那一句里是“地面没有抹平”（这一条的名字里也是）：栏窄时的那一句只有一行，示意的数到了两位数、山高的两个倍数一个一位一个两位（像“8 到 25 倍”）的沙盘上多出一个字，
  // 所以这个短的说法改成“地面没抹平”，宽栏、窄栏都用它；展开的那一句没有动。
  it('旁边印的话：常印着的一句、栏窄时的一句里都是“地面没抹平”（原来的“地面没有抹平”不印了）；展开的几句里印场景写的那一句，没有写的时候是“地面照今天的样子，没有抹平。”', () => {
    const scene = madeUpScene();
    const info = sectionInfo(scene, scene.sections[0].heading);
    expect(info.note.short.split('；')).toContain('地面没抹平');
    expect(info.note.brief.split('；')).toContain('地面没抹平');
    for (const section of scene.sections) {
      const { short, brief } = sectionInfo(scene, section.heading).note;
      expect(`${short}${brief}`.includes('地面没有抹平'), section.heading).toBe(false);
      expect(short.split('；')[1], section.heading).toBe('地面没抹平');
      expect(brief.split('；')[1], section.heading).toBe('地面没抹平');
    }
    expect(info.note.lines[1]).toBe(scene.terrain.recipe.note);
    delete scene.terrain.recipe.note;
    expect(sectionInfo(scene, scene.sections[0].heading).note.lines[1]).toBe('地面照今天的样子，没有抹平。');
  });
});

describe('编出来的那一座全程沙盘：座子写了上沿多高（样式的 stand.reachTopY），看整块沙盘的一节把整只匣子放进画面', () => {
  const PANES = [...STANDARD_PANES, ...ROUTE_PANES];
  /** 头一节（看整块沙盘）在一种沙盘栏上照 tableStyle 摆好：镜头离多远，交给镜头的那几个点落在画面的哪里。 */
  const seen = (tableStyle: TableStyle, pane: { size: { width: number; height: number }; insets: StageInsets }) => {
    const { scene, coords, samplers } = madeUpRoute();
    const view = placeCamera(scene.sections[0], scene, samplers, coords, tableStyle, pane.size, pane.insets);
    const camera = new PerspectiveCamera(view.pose.fov, pane.size.width / pane.size.height, Math.max(60, view.distanceM * 0.1), view.distanceM * 3 + 30000);
    camera.position.set(...view.pose.position);
    camera.lookAt(...view.pose.target);
    const [shiftX, shiftY] = centreShift(pane.insets);
    if (shiftX || shiftY) camera.setViewOffset(pane.size.width, pane.size.height, -shiftX, -shiftY, pane.size.width, pane.size.height);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);
    const at = (points: [number, number, number][]) => points.map((p) => project(p, camera, pane.size));
    /** 这几个点在画面上占的那一块，四边各离留出来的那一块的边多少像素。 */
    const margins = (points: [number, number, number][]) => {
      const on = at(points);
      return {
        left: Math.min(...on.map((p) => p.x)) - pane.insets.left,
        right: pane.size.width - pane.insets.right - Math.max(...on.map((p) => p.x)),
        top: Math.min(...on.map((p) => p.y)) - pane.insets.top,
        bottom: pane.size.height - pane.insets.bottom - Math.max(...on.map((p) => p.y)),
      };
    };
    return { distanceM: view.distanceM, margins };
  };

  it('交给镜头的点：没写上沿的是八个（沙盘的四个角、下沿那一圈的四个角）；写了的多四个，是上沿那一圈的四个角，排在最后——前八个一个数不差', () => {
    const { coords } = madeUpRoute();
    const plain = framePoints(coords, style.stand);
    const railed = framePoints(coords, styleWithRail.stand);
    expect(style.stand.reachTopY).toBeUndefined();
    expect(styleWithRail.stand.reachTopY).toBe(RAIL_TOP_Y);
    expect(plain).toHaveLength(8);
    expect(railed).toHaveLength(12);
    expect(railed.slice(0, 8)).toEqual(plain);
    const r = style.stand.reachM;
    expect(railed.slice(8)).toEqual([
      [coords.x0 - r, RAIL_TOP_Y, coords.z0 - r],
      [coords.x1 + r, RAIL_TOP_Y, coords.z0 - r],
      [coords.x1 + r, RAIL_TOP_Y, coords.z1 + r],
      [coords.x0 - r, RAIL_TOP_Y, coords.z1 + r],
    ]);
    // 下沿那一圈在桌面以下，上沿那一圈在桌面以上
    expect(plain.slice(4).every((p) => p[1] === style.stand.reachY && p[1] < 0)).toBe(true);
    expect(railed.slice(8).every((p) => p[1] > 0)).toBe(true);
    // 上沿写的是 0（和桌面一样高）也是写了：十二个点，后四个的高度是 0——“写没写”看的是有没有这个数，不是它是不是 0
    const flush = framePoints(coords, { ...style.stand, reachTopY: 0 });
    expect(flush).toHaveLength(12);
    expect(flush.slice(0, 8)).toEqual(plain);
    expect(flush.slice(8)).toEqual([
      [coords.x0 - r, 0, coords.z0 - r],
      [coords.x1 + r, 0, coords.z0 - r],
      [coords.x1 + r, 0, coords.z1 + r],
      [coords.x0 - r, 0, coords.z1 + r],
    ]);
    // 沙盘程序摆头一节用的就是这十二个点
    const { scene, samplers } = madeUpRoute();
    expect(showPoints(scene.sections[0], scene, samplers, coords, styleWithRail)).toEqual(railed);
    expect(showPoints(scene.sections[0], scene, samplers, coords, style)).toEqual(plain);
  });

  it('八种标准的沙盘栏上：写了上沿的，十二个点都在留出来的那一块里，上下的空一样、左右的空一样；没写的时候，照下沿摆出来的画面里上沿那一圈要高出去一截——镜头因此退远了一点', () => {
    const { coords } = madeUpRoute();
    const railed = framePoints(coords, styleWithRail.stand);
    const lines: string[] = [];
    for (const pane of PANES) {
      const without = seen(style, pane);
      const withRail = seen(styleWithRail, pane);
      const held = withRail.margins(railed);
      expect(Math.abs(held.top - held.bottom), `${pane.name}：上 ${held.top.toFixed(1)}、下 ${held.bottom.toFixed(1)}`).toBeLessThanOrEqual(2);
      expect(Math.abs(held.left - held.right), `${pane.name}：左 ${held.left.toFixed(1)}、右 ${held.right.toFixed(1)}`).toBeLessThanOrEqual(2);
      expect(Math.min(held.left, held.right, held.top, held.bottom), pane.name).toBeGreaterThanOrEqual(8);
      // 没写上沿的那一份：它自己的八个点居中；同一个画面里上沿那一圈（它不知道）比那八个点高
      const eight = without.margins(railed.slice(0, 8));
      const rail = without.margins(railed.slice(8));
      expect(Math.abs(eight.top - eight.bottom), pane.name).toBeLessThanOrEqual(2);
      expect(rail.top, `${pane.name}：上沿那一圈离上边 ${rail.top.toFixed(1)}，那八个点离上边 ${eight.top.toFixed(1)}`).toBeLessThan(eight.top);
      // 把上沿算进去，镜头不比原来近
      expect(withRail.distanceM, pane.name).toBeGreaterThanOrEqual(without.distanceM);
      lines.push(`  ${pane.name}：不写上沿 ${without.distanceM.toFixed(0)} 米（上沿那一圈离上边 ${rail.top.toFixed(1)} 像素），写了 ${withRail.distanceM.toFixed(0)} 米（十二个点上 ${held.top.toFixed(1)}、下 ${held.bottom.toFixed(1)}）`);
    }
    // 至少有一种栏上镜头真的退远了（上沿那一圈在管事）
    expect(PANES.some((pane) => seen(styleWithRail, pane).distanceM > seen(style, pane).distanceM + 1)).toBe(true);
    console.log(`编出来的沙盘，头一节，座子写了上沿 ${RAIL_TOP_Y} 米：\n${lines.join('\n')}`);
  });

  it('看一站的小节不看座子：写不写上沿，镜头一个数不差', () => {
    const { scene, coords, samplers } = madeUpRoute();
    for (const section of scene.sections.slice(1)) {
      for (const pane of PANES) {
        const a = placeCamera(section, scene, samplers, coords, style, pane.size, pane.insets);
        const b = placeCamera(section, scene, samplers, coords, styleWithRail, pane.size, pane.insets);
        expect(b.pose, `${section.heading} ${pane.name}`).toEqual(a.pose);
        expect(b.distanceM).toBe(a.distanceM);
      }
    }
  });
});

describe('编出来的那一座全程沙盘：镜头最近多近是一座沙盘一个数；看一站的小节印哪几趟路的话', () => {
  it('镜头最近多近：表里有这座沙盘就用表里的数，没有照 15000 米；比那个数近的小节一句一句列出来，看整块沙盘的一节不查', () => {
    const scene = madeUpScene();
    // 这座编出来的沙盘不在表里：照默认的 15,000；它看一站的三节写的是 17000、16000、16000，头一节（看整块沙盘）不查
    expect(MADE_UP_KEY in ROUTE_CAMERA_NEAREST_M).toBe(false);
    expect(routeCameraNearestM(MADE_UP_KEY)).toBe(ROUTE_CAMERA_NEAREST_DEFAULT_M);
    expect(ROUTE_CAMERA_NEAREST_DEFAULT_M).toBe(15_000);
    expect(scene.sections.map((section) => section.camera.distanceM)).toEqual([40000, 17000, 16000, 16000]);
    expect(camerasTooNear(scene, routeCameraNearestM(MADE_UP_KEY))).toEqual([]);
    // 表里给它写一个数：用的就是那个数。写 16,500：近的两节列出来；写 4,000：一节也不近
    const strict = { [MADE_UP_KEY]: 16_500 };
    expect(routeCameraNearestM(MADE_UP_KEY, strict)).toBe(16_500);
    expect(camerasTooNear(scene, routeCameraNearestM(MADE_UP_KEY, strict))).toEqual(['丙港那几年：distanceM 写的是 16000，这座沙盘最近 16500', '丁镇那几年：distanceM 写的是 16000，这座沙盘最近 16500']);
    const loose = { [MADE_UP_KEY]: 4_000 };
    scene.sections[1].camera.distanceM = 6_000;
    expect(camerasTooNear(scene, routeCameraNearestM(MADE_UP_KEY, loose))).toEqual([]);
    // 同一座沙盘照默认的数查：6,000 米的那一节近了
    expect(camerasTooNear(scene, routeCameraNearestM(MADE_UP_KEY))).toEqual(['甲城那几年：distanceM 写的是 6000，这座沙盘最近 15000']);
    // 别的沙盘的那一行不管它；苏轼的那一行是 15,000
    expect(routeCameraNearestM(MADE_UP_KEY, { 'someone/route': 9_000 })).toBe(15_000);
    expect(ROUTE_CAMERA_NEAREST_M['su-shi/route']).toBe(15_000);
    // 看整块沙盘的一节再近也不列
    scene.sections[0].camera.distanceM = 100;
    expect(camerasTooNear(scene, 15_000).some((line) => line.startsWith('全程'))).toBe(false);
  });

  it('看“这一站那几年走的路”的沙盘：一节里一定印着的是这一站自己的路里 explain 点到的那几趟；没有点到的那一趟的话不印在这一节；改成看来路的沙盘，这一站的每一趟都要印', () => {
    const scene = madeUpScene();
    const jia = scene.sections[1];
    // 甲城有两趟自己的路（头一回到，后来回来），这一节的 explain 只点了头一趟
    expect(scene.roads.journeys.filter((journey) => journey.stop === 'jia').map((journey) => journey.id)).toEqual(['j-arrive', 'j-return']);
    expect(jia.explain).toEqual(['j-arrive']);
    expect(journeysWithNotesPrinted(scene, jia).map((journey) => journey.id)).toEqual(['j-arrive']);
    const lines = sectionInfo(scene, jia.heading).note.lines;
    expect(lines).toContain('从西边到甲城的路是照《行记》画的。');
    expect(lines).not.toContain('回甲城的路只知道两头，画成虚线。');
    // 每一节：要印的那几趟，每一截写了的话都印着
    for (const section of scene.sections.slice(1)) {
      const printed = sectionInfo(scene, section.heading).note.lines;
      const wanted = journeysWithNotesPrinted(scene, section);
      expect(wanted.length, section.heading).toBeGreaterThan(0);
      for (const journey of wanted) for (const part of journey.parts) if (part.note) expect(printed, `${section.heading}：${part.name}`).toContain(part.note);
    }
    // 头一节不看哪一站：一趟也不要
    expect(journeysWithNotesPrinted(scene, scene.sections[0])).toEqual([]);
    // 同一座沙盘改成看来路的（不写 stopShows）：这一站的每一趟都要印——甲城那一节就差“回来”的那一趟
    delete scene.roads.stopShows;
    expect(journeysWithNotesPrinted(scene, jia).map((journey) => journey.id)).toEqual(['j-arrive', 'j-return']);
  });
});

describe('编出来的那一座全程沙盘：凭据开头的几条总的说明（general）', () => {
  it('文件里写着两条，通得过校验；不写也通得过；多一个不认识的字段、id 不是字，格式通不过', () => {
    const scene = madeUpScene();
    expect(scene.general?.map((line) => line.id)).toEqual(['records', 'made-up-names']);
    for (const line of scene.general ?? []) expect(line.text.trim().length).toBeGreaterThan(10);
    expect(problems()).toEqual([]);
    expect(problems((s) => delete s.general)).toEqual([]);
    expect(problems((s) => (s.general = []))).toEqual([]);
    expect(problems((s) => ((s.general?.[0] as unknown as { heading: string }).heading = '标题'))).toEqual(['0 general[0].heading']);
    expect(problems((s) => ((s.general?.[1] as unknown as { id: number }).id = 2))).toEqual(['0 general[1].id']);
    expect(problems((s) => ((s as unknown as { general: unknown }).general = { records: '一句话' }))).toEqual(['0 general']);
  });

  it('id 在这一组里不重复、要填，每一条的话不是空的（规则 13）；它的 id 和别的东西重名不要紧（不进整个文件的那张单子）', () => {
    expect(problems((s) => s.general?.push({ id: 'records', text: '又写了一遍。' }))).toEqual(['13 general[2].id']);
    expect(words((s) => s.general?.push({ id: 'records', text: '又写了一遍。' }))).toEqual(['id“records”在 general 里写了不止一次；这一组里 id 不能重复']);
    expect(problems((s) => s.general?.push({ id: '  ', text: '有话。' }))).toEqual(['13 general[2].id']);
    expect(problems((s) => ((s.general ?? [])[1].text = '  '))).toEqual(['13 general[1].text']);
    expect(words((s) => ((s.general ?? [])[1].text = ''))).toEqual(['总的说明“made-up-names”是空的：凭据的开头要印这一段话，没有话就把这一条删掉']);
    // 和一个地名点同名：这一组自己认自己的 id，不算重复
    expect(problems((s) => s.general?.push({ id: 'p-jia', text: '和甲城的地名点同名。' }))).toEqual([]);
  });

  it('小节的 explain 点不到它：点了，规则 14 说它只印在凭据的开头', () => {
    const point = (s: RouteScene): void => void s.sections[1].explain.push('records');
    expect(problems(point)).toEqual(['14 sections[1].explain[1]']);
    expect(words(point)).toEqual(['“records”是 general 里的一条总的说明：它只印在凭据的开头，小节的 explain 不能点它；要在这一节说的话，写进这一节点到的东西的 note']);
    // 沙盘旁边印的字里也没有它：哪一节展开的说明里都找不到这两段话
    const scene = madeUpScene();
    for (const section of scene.sections) for (const line of scene.general ?? []) expect(sectionInfo(scene, section.heading).note.lines, section.heading).not.toContain(line.text);
  });

  it('不算进定格图的记号：改一条的话、添一条、整组去掉，记号都不变；改的是画面上有的东西（一个地名点挪了）记号才变', () => {
    const key = pictureKey(madeUpScene());
    const changed = (change: (scene: RouteScene) => void): string => {
      const scene = madeUpScene();
      change(scene);
      return pictureKey(scene);
    };
    expect(changed((s) => ((s.general ?? [])[0].text = '换了一句话。'))).toBe(key);
    expect(changed((s) => s.general?.push({ id: 'third', text: '添的一条。' }))).toBe(key);
    expect(changed((s) => delete s.general)).toBe(key);
    expect(changed((s) => (s.places[0].at = [158.1, 21.05]))).not.toBe(key);
  });
});

describe('编出来的那一座全程沙盘：名字没有点的地方（地名点写了 area）算不算在“几样是示意”里', () => {
  /** 各节那一句里“几样是示意”的数，照小节的先后。 */
  const counts = (scene: RouteScene): number[] => scene.sections.map((section) => Number(/^(\d+) 样是示意/.exec(sectionInfo(scene, section.heading).note.brief)?.[1]));
  /** 西岭（文件里它的类别是 today，名字没有点）改成示意的一类。 */
  const schematic = (scene: RouteScene): RouteScene => {
    const massif = scene.places.find((place) => place.id === 'p-massif');
    if (!massif) throw new Error('编出来的沙盘里没有西岭');
    Object.assign(massif, { class: 'schematic', sourceIds: [] });
    return scene;
  };

  it('文件里：西岭写了 area，不是示意的，哪一节都不算；它的纸条立在头一节和丁镇那一节', () => {
    const scene = madeUpScene();
    const massif = scene.places.find((place) => place.id === 'p-massif');
    expect([massif?.area, massif?.class]).toEqual([true, 'today']);
    expect(scene.sections.map((section) => section.strips.includes('s-massif'))).toEqual([true, false, false, true]);
    expect(counts(scene).every((n) => n > 0)).toBe(true);
  });

  it('是示意的、名字没有点：只在立了它的纸条的那两节各多算一样，另两节不算；常印着的那一句、展开的头一句用的是同一个数', () => {
    const before = counts(madeUpScene());
    const scene = schematic(madeUpScene());
    const after = counts(scene);
    expect(after.map((n, i) => n - before[i])).toEqual([1, 0, 0, 1]);
    // 展开的头一句：立了纸条的一节里说得到它的名字（总数不到六样时逐样列着）；没有立的一节里找不到
    const first = (heading: string): string => sectionInfo(scene, heading).note.lines[0];
    expect(first(scene.sections[3].heading)).toContain('西岭');
    expect(first(scene.sections[1].heading)).not.toContain('西岭');
    expect(first(scene.sections[2].heading)).not.toContain('西岭');
    // 每一座全程沙盘的测试另数各节的数时减掉的那一样（./support/routeFacts.ts 的 schematicWherePointed）：也是立了纸条的那两节各多一样
    expect(scene.sections.map((section, i) => schematicWherePointed(scene, section) - schematicWherePointed(madeUpScene(), madeUpScene().sections[i]))).toEqual([1, 0, 0, 1]);
  });

  it('是示意的、有点的地名点（把 area 去掉）：和原来一样，每一节都算，立没立题签都算', () => {
    const before = counts(madeUpScene());
    const scene = schematic(madeUpScene());
    delete scene.places.find((place) => place.id === 'p-massif')?.area;
    expect(counts(scene).map((n, i) => n - before[i])).toEqual([1, 1, 1, 1]);
    // 有点的地名点不在“题签指到才算”的那几样里：另数的时候哪一节都不减它
    expect(scene.sections.map((section, i) => schematicWherePointed(scene, section) - schematicWherePointed(madeUpScene(), madeUpScene().sections[i]))).toEqual([0, 0, 0, 0]);
  });

  it('把它的纸条从丁镇那一节拿掉：那一节不再算它；添到甲城那一节：那一节算上', () => {
    const before = counts(madeUpScene());
    const moved = schematic(madeUpScene());
    moved.sections[3].strips = moved.sections[3].strips.filter((id) => id !== 's-massif');
    moved.sections[1].strips.push('s-massif');
    expect(counts(moved).map((n, i) => n - before[i])).toEqual([1, 1, 0, 0]);
  });
});
