// 做全程沙盘要用的几个文件的工具。一个模式做一样（<人物> 是人物的文件夹名）：
//   npm run route:terrain   地形文件      content/figures/<人物>/scenes/route.terrain.bin
//   npm run route:today     今天的岸线、湖、河   content/figures/<人物>/scenes/route.today.geojson
//   npm run route:map       检查图（不进仓库）  tests/shots/route-check/map.png、map.txt：从正上方看，场景里的每一条线、每一圈、每一条路
//   npm run route:bank      走水路的路贴着河岸走的线：只印出来，人看过以后贴进 scenes/route.json（做法见 tests/tools/route/bankTool.ts 的开头）
// 做好以后放进仓库，随场景文件一起走；发布的流程不重新做。两个文件都不手改。
// 文件是什么样子、怎么做的，写在 tests/tools/route/terrainTool.ts 和 tests/tools/route/todayTool.ts 的开头。
//
// 给哪一位人物做：环境变量 ROUTE_FIGURE=<人物>，四个模式都认它（如 ROUTE_FIGURE=su-shi npm run route:terrain）。
// 做全程沙盘的那张表（tests/tools/route/figures.ts，一位人物一行）里只有一位的时候可以不写，做的就是他；有两位以上不写，工具停下来说表里有谁。
// 这位人物自己的东西从两处来，没有哪一样是写死在这里的：
//   那张表里他的一行：源数据在哪，岸线文件裁到哪个方框，源数据里哪个湖要放回原来的大小，沿着河走的每条路离河多远、在哪一边；
//   他的场景文件（content/figures/<人物>/scenes/route.json）：地形文件的格子（terrain 的 cols、rows、west、east、north、south）、
//   地形文件叫什么（terrain.file）、岸线文件叫什么（water.todayFile）。
//
// 它是一个测试文件，因为这个项目是靠 vitest 在 Node 里跑 TypeScript 的（和 npm run bake 一样，见 tests/tools/bake-ground.test.ts）。
// 最下面“工具自己”那一组随 npm test 跑（package.json 的 test 里列着这个文件），用的是编出来的小数据，什么也不写；
// 上面真的做文件的两组，只有用它自己的模式跑才做（vitest --mode terrain、--mode today）。直接跑这个文件和 npm test 一样，只跑最下面那一组。
// 要是哪一版的 vitest 不把 --mode 交到 import.meta.env.MODE 里，设环境变量 ROUTE_MODE=terrain（或者 today）也算。
//
// 两个文件都只照表里写的源数据做（苏轼的是样张的文件：spikes/art-direction/route/data/ 里的 dem.json、dem.bin、water.json），不连任何外面的服务：
// 没有“去取瓦片、去取 Natural Earth”的做法。所以 ROUTE_FROM_TRIAL 这个环境变量设不设都一样。
// 另一个环境变量：
//   ROUTE_OUT   做出来的文件放到这个文件夹（相对项目的根目录，或者一个完整的路径），不动 content/。试做的时候用。
//
// 每个模式的步骤：读样张的文件 → 算 → 对一遍（大小、读回来一样、合不合文件的规矩）→ 印出量到的数 →
// 和磁盘上的那一份比，字节一样就说“已经是新的”，什么也不写；不一样才写。
//
// 检查图那一个模式读的是 content/ 里的场景文件、地形文件和 route.today.geojson，不读样张；ROUTE_OUT 对它也管用（如 tests/shots/e-u1）。
// 岸线那一个模式读的也是 content/ 里的场景文件和 route.today.geojson。它另认一个环境变量：
//   WAY         只做这一条路（路的 id，如 w-min）；不设就把写了 along、沿着一条河走的路都做一遍。
// 设了 ROUTE_OUT 的话，另把做出来的线写成 banks.json 放进那个文件夹（给贴线的人用；不设就只印）。

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { contentKey } from '../../src/domain/contentKey';
import type { RouteScene } from '../../src/domain/scene';
import { routeCoords } from '../../src/domain/sceneGeoRoute';
import { buildRouteGround, readRouteDem } from '../../src/stage/ground/route';
import { styleFor } from '../../src/stage/three/style';
import { readToday } from '../content/routeRules';
import { decodePng, encodeRgbPng } from '../support/png';
import { BANK_TAPER_KM, bankLine, bankOfWay, chaikin, dense, lineText, simplify, stitch } from './route/bankTool';
import type { Km } from './route/bankTool';
import { ROUTE_SCENE_FILE, ROUTE_TOOL_FIGURES, routeToolFigure, scenesFolder } from './route/figures';
import type { RouteToolFigure } from './route/figures';
import { MAP_POINTS_PER_CELL, drawRouteMap, lineKm, waySolid } from './route/mapTool';
import { riverPaths } from './route/paint';
import { gridOf, insideTrial, lambertConic, landMask, latOf, lngOf, readTerrain, readTrialDem, resampleTerrain, terrainBytes, trialHeightAt } from './route/terrainTool';
import type { LatLngGrid, LngLat } from './route/terrainTool';
import { THIN_KM, bytesByKind, clipLineToBox, closeRing, insideRing, landRings, positionName, restoreShrunk, ringCentre, signedArea, thin, todayFeatures, todayProblems, todayText } from './route/todayTool';
import type { TodayFeature, TrialWater } from './route/todayTool';

const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};

/** 这一次要做哪一样；不是来做文件的（比如随 npm test 跑）就是 null。 */
const MODE = (['terrain', 'today', 'map', 'bank'] as const).find((mode) => import.meta.env.MODE === mode || env.ROUTE_MODE === mode) ?? null;

/** 项目的根目录：这个文件在 tests/tools/ 里，往上两层。 */
const ROOT = new URL('../../', import.meta.url);

/** 磁盘上这位人物的全程沙盘的场景文件。 */
function readRouteScene(figureId: string): RouteScene {
  return JSON.parse(new TextDecoder().decode(readFileSync(new URL(`${scenesFolder(figureId)}${ROUTE_SCENE_FILE}`, ROOT)))) as RouteScene;
}

/**
 * 这一次给哪一位人物做，和做的时候要用的他的那几样。只有真的来做文件的时候才问（随 npm test 跑的时候不问：
 * 那时候谁也没说给哪一位做，表里有两位以上的话问了就要停下来）。
 *   scenes       他的场景文件所在的文件夹，做出来的文件平常也放在这里；
 *   grid         地形文件的格子，照他的场景里 terrain 那一块；
 *   terrainFile、todayFile  两个文件叫什么，照他的场景里写的。
 */
interface Making {
  id: string;
  figure: RouteToolFigure;
  scenes: string;
  scene: RouteScene;
  grid: LatLngGrid;
  terrainFile: string;
  todayFile: string;
}
let making: Making | null = null;
function makingFor(): Making {
  if (making) return making;
  const { id, figure } = routeToolFigure(env.ROUTE_FIGURE);
  const scene = readRouteScene(id);
  making = { id, figure, scenes: scenesFolder(id), scene, grid: gridOf(scene.terrain), terrainFile: scene.terrain.file, todayFile: scene.water.todayFile };
  return making;
}

/**
 * 用自己的模式来做文件的这一次，做的是哪一位人物的文件夹名；随 npm test 跑（不是来做文件的）是 null。
 * 说不出是哪一位（没写 ROUTE_FIGURE 而表里不止一位，或者写的不在表里）也是 null：做文件的那一项自己会停下来说。
 */
const MAKING_ID: string | null = (() => {
  if (MODE === null) return null;
  try {
    return routeToolFigure(env.ROUTE_FIGURE).id;
  } catch {
    return null;
  }
})();

/**
 * “一位人物查一遍”的那几组，这一次查不查这一位：随 npm test 跑，每一位都查（答 false）；
 * 来做文件的时候只查正在做的那一位，别的人物答 true（跳过）——一位人物还没写全的一行，不该让另一位的工具以失败收场。
 */
const notThisTime = (figureId: string): boolean => MODE !== null && figureId !== MAKING_ID;

const withCommas = (n: number): string => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

// ---------------------------------------------------------------- 写文件

/** 读写一个文件夹里的文件。真的做时是磁盘；查这个工具时换成假的。 */
interface FileIo {
  /** 文件的字节；没有这个文件是 null。 */
  read(file: string): Uint8Array | null;
  write(file: string, bytes: Uint8Array): void;
}

/** fresh：磁盘上的那一份字节一样，什么也没写。created：以前没有，写了。replaced：不一样，换掉了。 */
type WriteOutcome = 'fresh' | 'created' | 'replaced';

/** 字节和磁盘上的不一样才写。 */
function writeIfDifferent(io: FileIo, file: string, bytes: Uint8Array): WriteOutcome {
  const old = io.read(file);
  if (old && old.length === bytes.length && old.every((byte, i) => byte === bytes[i])) return 'fresh';
  io.write(file, bytes);
  return old ? 'replaced' : 'created';
}

/** 做出来的文件放进哪个文件夹（以“/”结尾的地址）。out 是 ROUTE_OUT 的值：没设就是 content/ 里平常的地方（scenes：这位人物的场景文件所在的文件夹）。 */
function outFolder(out: string | undefined, scenes: string): URL {
  if (!out) return new URL(scenes, ROOT);
  const path = out.split('\\').join('/').replace(/\/*$/, '/');
  return /^[A-Za-z]:\//.test(path) ? new URL(`file:///${path}`) : new URL(path, ROOT);
}

function diskIo(dir: URL): FileIo {
  return {
    read: (file) => (existsSync(new URL(file, dir)) ? readFileSync(new URL(file, dir)) : null),
    write: (file, bytes) => {
      mkdirSync(dir, { recursive: true });
      writeFileSync(new URL(file, dir), bytes);
    },
  };
}

const OUTCOME_WORDS: Record<WriteOutcome, string> = { fresh: '已经是新的，什么也没写', created: '写好了（以前没有）', replaced: '写好了（换掉了旧的）' };

/** 印出来的话里文件夹怎么写：content/ 里平常的地方照写；ROUTE_OUT 指的地方只说是它，不印完整的路径。 */
const outWords = (scenes: string): string => (env.ROUTE_OUT ? 'ROUTE_OUT 指的文件夹里的 ' : scenes);

// ---------------------------------------------------------------- 读源数据的文件（这位人物在那张表里写的文件夹）

const sourceBytes = (figure: RouteToolFigure, file: string): Uint8Array => readFileSync(new URL(`${figure.source.folder}${file}`, ROOT));
const sourceText = (figure: RouteToolFigure, file: string): string => new TextDecoder().decode(sourceBytes(figure, file));

/** 一个数组里最大的数（数组很长，不能摊开交给 Math.max）。 */
function largest(values: Int16Array): number {
  let max = -Infinity;
  for (let i = 0; i < values.length; i++) if (values[i] > max) max = values[i];
  return max;
}

// ---------------------------------------------------------------- npm run route:terrain

describe.skipIf(MODE !== 'terrain')('做全程沙盘的地形文件（npm run route:terrain）', () => {
  // 30 万格、每格 9 个点，这台机器上一两秒；发布流程的机器慢一倍，给足时间。
  it('这位人物的 scenes/ 里的地形文件（ROUTE_FIGURE 说是哪一位；叫什么照他的场景）', { timeout: 120_000 }, () => {
    const tag = '[全程沙盘·地形]';
    const say = (line: string): void => console.log(line);
    const { id, figure, scenes, grid, terrainFile } = makingFor();
    const { source } = figure;
    const trial = readTrialDem(sourceText(figure, source.dem), sourceBytes(figure, source.demBytes));
    const water = JSON.parse(sourceText(figure, source.water)) as TrialWater;
    expect(largest(trial.heights), `${source.folder}${source.dem} 里写的最高一格，和 ${source.demBytes} 里数出来的不一样`).toBe(trial.maxM);

    // 陆地照“今天的岸线”那个文件里的圈分（同一个函数做出来的，所以和岸线文件里的是同一批圈）
    const rings = landRings(todayFeatures(water, trial.conic.toKm, figure.todayBox, figure.shrunkLakes).features);
    const mask = landMask(grid, rings);
    const { heights, report } = resampleTerrain(grid, trialHeightAt(trial), mask, insideTrial(trial));
    const bytes = terrainBytes(heights);

    // 对一遍
    const { cols, rows } = grid;
    expect(bytes.length).toBe(cols * rows * 2);
    expect([...readTerrain(grid, bytes)]).toEqual([...heights]);
    let zeros = 0;
    for (let k = 0; k < heights.length; k++) {
      if (heights[k] === 0) zeros += 1;
      if ((mask[k] === 1) !== (heights[k] >= 1)) expect.fail(`第 ${k} 格：陆地的标记是 ${mask[k]}，存的高却是 ${heights[k]}`);
    }
    expect(zeros).toBe(report.sea);
    expect(report.land + report.sea).toBe(cols * rows);
    // 几个点的平均不会比原来最高的一格还高
    expect(report.highest.m).toBeGreaterThan(0);
    expect(report.highest.m).toBeLessThanOrEqual(trial.maxM);

    const step = (grid.east - grid.west) / (cols - 1);
    say(`${tag} 给 ${id} 做，格子照 ${scenes}${ROUTE_SCENE_FILE} 里 terrain 写的`);
    say(`${tag} 照样张的 ${source.folder}${source.demBytes} 重新取样：${trial.cols} × ${trial.rows} 格，每格 ${trial.cellKm} 公里，最高的一格 ${withCommas(trial.maxM)} 米`);
    say(`  做出来　　${cols} 列 × ${rows} 行，每格 ${step.toFixed(4)} 度；西 ${grid.west}、东 ${grid.east}、北 ${grid.north}、南 ${grid.south}；整米，低位在前，第 0 行最北`);
    say(`  最高的一格 ${withCommas(report.highest.m)} 米，在东经 ${report.highest.lng.toFixed(2)}、北纬 ${report.highest.lat.toFixed(2)}`);
    say(`  四个角　　西北 ${report.corners.nw}、东北 ${report.corners.ne}、西南 ${report.corners.sw}、东南 ${report.corners.se} 米`);
    say(`  陆地 ${withCommas(report.land)} 格，不是陆地（存 0）${withCommas(report.sea)} 格；陆地照 ${rings.length} 圈岸线分`);
    say(`  陆地上取样出来不到 1 米、存成 1 的 ${withCommas(report.raised)} 格；不在陆地上、取样出来不是 0、存成 0 的 ${withCommas(report.zeroed)} 格`);
    say(`  格点在样张的桌面以外的 ${withCommas(report.outside)} 格（样张没有量过那里，取的是最近的桌边上的高；沙盘用不到这些格子）`);
    say(`  文件 ${withCommas(bytes.length)} 字节，记号 ${contentKey(bytes)}`);

    const outcome = writeIfDifferent(diskIo(outFolder(env.ROUTE_OUT, scenes)), terrainFile, bytes);
    say(`${tag} ${outWords(scenes)}${terrainFile}：${OUTCOME_WORDS[outcome]}。`);
  });
});

// ---------------------------------------------------------------- npm run route:today

describe.skipIf(MODE !== 'today')('做今天的岸线、湖、河（npm run route:today）', () => {
  // 这台机器上不到一秒；和上面一样给足时间。
  it('这位人物的 scenes/ 里的岸线文件（ROUTE_FIGURE 说是哪一位；叫什么照他的场景）', { timeout: 120_000 }, () => {
    const tag = '[全程沙盘·今天的岸线、湖、河]';
    const say = (line: string): void => console.log(line);
    const { id, figure, scenes, todayFile } = makingFor();
    const { source, todayBox } = figure;
    const trial = readTrialDem(sourceText(figure, source.dem), sourceBytes(figure, source.demBytes));
    const water = JSON.parse(sourceText(figure, source.water)) as TrialWater;
    const { features, report } = todayFeatures(water, trial.conic.toKm, todayBox, figure.shrunkLakes);

    // 对一遍：每一项都合文件的规矩；写出来再读回来是同样的东西
    expect(todayProblems(features, todayBox)).toEqual([]);
    const text = todayText(features);
    expect(JSON.parse(text)).toEqual({ type: 'FeatureCollection', features });
    expect(text.includes('\r')).toBe(false);
    const bytes = new TextEncoder().encode(text);
    const kinds = bytesByKind(features);
    const { land, lakes, rivers } = report;

    say(`${tag} 给 ${id} 做，方框照 tests/tools/route/figures.ts 里他那一行写的`);
    say(`${tag} 照样张的 ${source.folder}${source.water} 做：裁到东经 ${todayBox.west} 到 ${todayBox.east}、北纬 ${todayBox.south} 到 ${todayBox.north}，按 ${THIN_KM} 公里抽稀，三位小数`);
    say(`  陆地　样张里 ${land.ringsIn} 圈 ${withCommas(land.pointsIn)} 个点；一模一样的重复的 ${land.duplicates} 圈、不成面的 ${land.degenerate.length} 圈去掉以后 ${land.ringsOut} 圈 ${withCommas(land.pointsUnique)} 个点；`);
    say(`  　　　抽稀以后 ${withCommas(land.pointsOut)} 个点（其中 ${land.keptWhole} 圈一抽就不成面，原样留着），${withCommas(kinds.land)} 字节`);
    for (const p of land.degenerate) say(`  　　　不成面、去掉的一圈在东经 ${p[0]}、北纬 ${p[1]}（方框边上裁剩下的）`);
    say(`  湖　　${lakes.ringsIn} 圈 ${withCommas(lakes.pointsIn)} 个点，抽稀以后 ${withCommas(lakes.pointsOut)} 个点，${withCommas(kinds.lake)} 字节${lakes.restored.length > 0 ? `；样张缩小过、这里放回原来大小的：${lakes.restored.join('、')}` : ''}`);
    say(`  河　　${rivers.linesIn} 条 ${withCommas(rivers.pointsIn)} 个点，裁到方框、抽稀以后 ${rivers.linesOut} 条 ${withCommas(rivers.pointsOut)} 个点，${withCommas(kinds.river)} 字节`);
    for (const c of rivers.clipped) say(`  　　　出了方框、裁过的：${c.name}（裁成 ${c.pieces} 段）`);
    say(`  工具起了名字的 ${report.named.length} 项：${report.named.map((n) => (n.zh ? `${n.name}（样张认作${n.zh}）` : n.name)).join('、')}`);
    say(`  样张做数据时已经去掉、所以这个文件里没有的 ${water.removed.length} 样（另有不到 40 平方公里的湖，样张没有记）：`);
    for (const r of water.removed) say(`  　　　${r.kind} ${r.name}：${r.why}`);
    say(`  一共 ${features.length} 项，文件 ${withCommas(bytes.length)} 字节，记号 ${contentKey(bytes)}`);

    const outcome = writeIfDifferent(diskIo(outFolder(env.ROUTE_OUT, scenes)), todayFile, bytes);
    say(`${tag} ${outWords(scenes)}${todayFile}：${OUTCOME_WORDS[outcome]}。`);
  });
});

// ---------------------------------------------------------------- npm run route:map

/** 检查图平常放在哪（相对项目的根目录；tests/shots/ 不进仓库）。每跑一次换掉旧的。 */
const MAP_FOLDER = 'tests/shots/route-check/';

/** 读一座全程沙盘，算出地面，画检查图。dir 是场景文件所在的文件夹（相对项目的根目录，以“/”结尾）。 */
function routeMapOf(dir: string): { map: ReturnType<typeof drawRouteMap>; scene: RouteScene } {
  const read = (file: string): Uint8Array => readFileSync(new URL(`${dir}${file}`, ROOT));
  const scene = JSON.parse(new TextDecoder().decode(read(ROUTE_SCENE_FILE))) as RouteScene;
  const today = readToday({ today: new TextDecoder().decode(read(scene.water.todayFile)) }, 'today');
  if (!today || 'problem' in today) throw new Error(`${dir}${scene.water.todayFile} 读不出来${today ? `：${today.problem}` : ''}`);
  const coords = routeCoords(scene.frame);
  const bytes = read(scene.terrain.file);
  const dem = readRouteDem(scene.terrain, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
  return { map: drawRouteMap(scene, today.features, coords, buildRouteGround(scene, dem, coords)), scene };
}

describe.skipIf(MODE !== 'map')('全程沙盘的检查图（npm run route:map）', () => {
  it(`${MAP_FOLDER}map.png、map.txt`, { timeout: 120_000 }, () => {
    const tag = '[全程沙盘·检查图]';
    const { id, scenes } = makingFor();
    console.log(`${tag} 画的是 ${id} 的全程沙盘（${scenes}${ROUTE_SCENE_FILE}）`);
    const { map, scene } = routeMapOf(scenes);
    const png = encodeRgbPng(map.pixels, map.width, map.height);
    const head = `全程沙盘的检查图：${map.width} × ${map.height}，一个点约 ${((scene.frame.scale * 20) / MAP_POINTS_PER_CELL / 1000).toFixed(2)} 公里。黑号是路，红号是地名点，蓝号是水，紫号是抹成海的圈。`;
    const text = `${[head, ...map.legend].join('\n')}\n`;
    const io = diskIo(env.ROUTE_OUT ? outFolder(env.ROUTE_OUT, scenes) : new URL(MAP_FOLDER, ROOT));
    io.write('map.png', png);
    io.write('map.txt', new TextEncoder().encode(text));
    console.log(`${tag} ${env.ROUTE_OUT ? 'ROUTE_OUT 指的文件夹里的 ' : MAP_FOLDER}map.png（${map.width} × ${map.height}，${withCommas(png.length)} 字节）和 map.txt（${map.legend.length} 行）写好了。`);
    console.log(`  路 ${scene.roads.ways.length} 条，地名点 ${scene.places.length} 个，河 ${scene.water.rivers.length} 条，湖 ${scene.water.lakes.length} 个，只染水色的水 ${scene.water.washes.length} 片，抹成海的圈 ${scene.terrain.edits.length} 个`);
    for (const line of map.legend.filter((l) => l.startsWith('没挑中的'))) console.log(`  ${line}`);
    expect(map.legend.length).toBeGreaterThan(scene.roads.ways.length);
  });
});

// ---------------------------------------------------------------- npm run route:bank

describe.skipIf(MODE !== 'bank')('走水路的路贴着河岸走的线（npm run route:bank）', () => {
  it('印出每一条线（WAY=<路的 id> 只做一条）', { timeout: 120_000 }, () => {
    const tag = '[全程沙盘·岸线]';
    const { id, figure, scenes, scene } = makingFor();
    const read = (file: string): string => new TextDecoder().decode(readFileSync(new URL(`${scenes}${file}`, ROOT)));
    const today = readToday({ today: read(scene.water.todayFile) }, 'today');
    if (!today || 'problem' in today) throw new Error(`${scenes}${scene.water.todayFile} 读不出来`);
    const coords = routeCoords(scene.frame);
    const paths = riverPaths(scene, today.features, coords, styleFor(scene.style));
    const rivers = new Set(scene.water.rivers.map((river) => river.id));
    const asked = env.WAY;
    if (asked && !scene.roads.ways.some((way) => way.id === asked)) throw new Error(`WAY 写的“${asked}”不是场景里的一条路`);
    const ways = scene.roads.ways.filter((way) => (asked ? way.id === asked : way.along !== undefined && rivers.has(way.along)));
    const out: Record<string, [number, number][]> = {};
    console.log(`${tag} 给 ${id} 做，每条路离河多远、在哪一边照 tests/tools/route/figures.ts 里他那一行写的`);
    console.log(`${tag} ${ways.length} 条路。每条印三行：怎么做的，做出来的线（贴进 ${scenes}${ROUTE_SCENE_FILE} 里这条路的 line），和场景里现在写的一样不一样。`);
    for (const way of ways) {
      const made = bankOfWay(scene, today.features, coords, paths, way, figure.banks[way.id]);
      const side = made.spec.side === 1 ? '左手边' : '右手边';
      const end = (i: 0 | 1): string => `离河心 ${made.ends.km[i].toFixed(1)} 公里，${made.ends.tapered[i] ? '收回到城里' : '从岸上直着连过去'}`;
      const { pulled, wet, tight, folded, skippedKm } = made.made;
      const skipped = Math.max(...skippedKm);
      console.log(
        `${made.way} 沿 ${made.river}：离河心 ${made.spec.offKm} 公里，${side}（${made.spec.why}）。头${end(0)}；尾${end(1)}。` +
          `${made.line.length} 个点，${made.km.toFixed(0)} 公里（场景里现在的线是 ${lineKm(scene, coords, way.line).toFixed(0)} 公里）；` +
          `离画出来的河最远 ${made.farKm.toFixed(1)} 公里，收回到城里的两截以外最近 ${Number.isFinite(made.nearKm) ? made.nearKm.toFixed(1) : '—'} 公里；` +
          `河的线接成 ${made.chains} 条，用的一条 ${made.chainKm.toFixed(0)} 公里` +
          `${skipped > 0 ? `；直着连到城里要过水，从河上往前让了 ${skipped.toFixed(0)} 公里` : ''}` +
          `${pulled > 0 ? `；为了躲开水往河这边收过的有 ${pulled} 个点` : ''}${wet > 0 ? `；还落在水里的有 ${wet} 个点（换另一边）` : ''}` +
          `${tight > 0 ? `；离河不够远的有 ${tight} 个点（河在这里绕得密）` : ''}${folded > 0 ? `；线折回去、去掉了 ${folded} 个点` : ''}${made.spec.paste === false ? '；这一条不贴进场景' : ''}`,
      );
      console.log(`  ${lineText(made.line)}`);
      console.log(`  ${lineText(made.line) === lineText(way.line) ? '和场景里现在写的线一样。' : '和场景里现在写的线不一样。'}`);
      expect(made.line.length).toBeGreaterThanOrEqual(2);
      expect(made.line[0]).toEqual(way.line[0]);
      expect(made.line[made.line.length - 1]).toEqual(way.line[way.line.length - 1]);
      if (made.spec.paste !== false) out[way.id] = made.line;
    }
    if (env.ROUTE_OUT) {
      diskIo(outFolder(env.ROUTE_OUT, scenes)).write('banks.json', new TextEncoder().encode(`${JSON.stringify(out)}\n`));
      console.log(`${tag} ROUTE_OUT 指的文件夹里的 banks.json 写好了（${Object.keys(out).length} 条要贴的线）。`);
    }
    // 点了一条路（WAY），或者这位人物的表里写着沿河的路：得真的做出线来。两样都没有的人物（没有沿着河走的路）只说一句
    if (asked || Object.keys(figure.banks).length > 0) expect(ways.length).toBeGreaterThan(0);
    else if (ways.length === 0) console.log(`${tag} ${id} 的全程沙盘上没有沿着一条河走的路，表里也没有写：没有线要做。`);
  });
});

// ---------------------------------------------------------------- 工具自己（随 npm test 跑，不动 content/）

describe('做全程沙盘的文件的工具自己（用编出来的小数据，什么也不写）', () => {
  /** 样张的投影的那几个数（dem.json 里写的）。 */
  const PARAMS = { lat1: 22, lat2: 35, lng0: 112.25, lat0: 28.25, R: 6371 };
  /** 测试里用的“投影”：一度当 100 公里，量起来方便。 */
  const flat = (lng: number, lat: number): [number, number] => [lng * 100, lat * 100];

  it('只有用自己的模式跑（--mode terrain、--mode today、--mode map、--mode bank，或者 ROUTE_MODE）才真的做', () => {
    expect(typeof import.meta.env.MODE).toBe('string');
    // 两头各查一句（不照抄 MODE 的那一行，那样永远不会红）：随 npm test 跑的时候一定不做；用哪个模式跑就做哪一样。
    const asked = [import.meta.env.MODE, env.ROUTE_MODE];
    if (!asked.includes('terrain') && !asked.includes('today') && !asked.includes('map') && !asked.includes('bank')) expect(MODE).toBeNull();
    if (import.meta.env.MODE === 'terrain') expect(MODE).toBe('terrain');
    if (import.meta.env.MODE === 'today') expect(MODE).toBe('today');
    if (import.meta.env.MODE === 'map') expect(MODE).toBe('map');
    if (import.meta.env.MODE === 'bank') expect(MODE).toBe('bank');
  });

  describe('检查图', () => {
    // 用校验器的合格样本里那座小的全程沙盘（600 × 400 公里，四条路）
    const FIXTURE = 'tests/content/fixtures/good/figures/demo/scenes/';

    // 这两项各要把样本的全程沙盘算一遍、画一张图：这台机器上单跑 1.4 秒，同别的测试一起跑 3.5 秒；发布流程的机器慢一倍，所以各给 30 秒。
    it('图的大小是地面的一格三个点；每条路、每个地名点、每样水、每个抹成海的圈各有一行；彩色的 PNG 读回来一个字节不差', { timeout: 30_000 }, () => {
      const { map, scene } = routeMapOf(FIXTURE);
      const coords = routeCoords(scene.frame);
      const nx = Math.round((coords.x1 - coords.x0) / 20) + 1;
      const nz = Math.round((coords.z1 - coords.z0) / 20) + 1;
      expect([map.width, map.height]).toEqual([(nx - 1) * MAP_POINTS_PER_CELL + 1, (nz - 1) * MAP_POINTS_PER_CELL + 1]);
      expect(map.pixels.length).toBe(map.width * map.height * 3);
      const count = (start: string): number => map.legend.filter((line) => line.startsWith(start)).length;
      expect(count('路 ')).toBe(scene.roads.ways.length);
      expect(count('点 ')).toBe(scene.places.length);
      expect(count('水 ')).toBe(scene.water.rivers.length + scene.water.lakes.length + scene.water.washes.length);
      expect(count('圈 ')).toBe(scene.terrain.edits.length);
      expect(count('没挑中的')).toBe(2);
      // 图上画着路：陆路的黑、水路的深红各有不少点（样本里两条陆路、两条水路，各有一百多公里）
      const count3 = (r: number, g: number, b: number): number => {
        let n = 0;
        for (let k = 0; k < map.pixels.length; k += 3) if (map.pixels[k] === r && map.pixels[k + 1] === g && map.pixels[k + 2] === b) n++;
        return n;
      };
      expect(count3(20, 20, 20)).toBeGreaterThan(300);
      expect(count3(150, 30, 20)).toBeGreaterThan(300);
      const back = decodePng(encodeRgbPng(map.pixels, map.width, map.height));
      expect([back.width, back.height, back.channels]).toEqual([map.width, map.height, 3]);
      expect(back.pixels).toEqual(map.pixels);
    });

    it('一条路画实线还是虚线：有“按史料摆的”一截走到它（正着、倒着都算）就是实线；路有多少公里照沙盘的投影量', { timeout: 30_000 }, () => {
      const { scene } = routeMapOf(FIXTURE);
      expect(scene.roads.ways.map((way) => waySolid(scene, way.id))).toEqual([true, false, true, false]);
      const coords = routeCoords(scene.frame);
      // 第一条路从 [112, 30.78] 经 [111, 30.5] 到 [110, 30]：一段约 100 公里，一段约 110 公里
      const km = lineKm(scene, coords, scene.roads.ways[0].line);
      expect(km).toBeGreaterThan(190);
      expect(km).toBeLessThan(230);
    });
  });

  describe('投影', () => {
    const conic = lambertConic(PARAMS);

    it('和样张自己的投影算出来的数一样（下面的数是用样张的 scene/proj.js 算好抄来的）', () => {
      const km: [LngLat, [number, number]][] = [
        [[117.185, 34.262], [452.7566374467093, 674.5833407095688]],
        [[100.86, 38.46], [-999.2314570068355, 1181.138663820897]],
        [[123.62, 17.7], [1216.002731030266, -1114.9077794582063]],
        [[109.58, 19.52], [-281.41049469371274, -965.4465786640212]],
      ];
      for (const [[lng, lat], [x, y]] of km) {
        const got = conic.toKm(lng, lat);
        expect(got[0]).toBeCloseTo(x, 8);
        expect(got[1]).toBeCloseTo(y, 8);
      }
      // 桌面的四个角和上下两边的正中
      const back: [[number, number], LngLat][] = [
        [[-1000.5, 1131], [100.89960430895641, 38.013775759521664]],
        [[1000.5, 1131], [123.60039569104359, 38.013775759521664]],
        [[-1000.5, -1131], [102.89767867422279, 17.72294937666291]],
        [[0, 1131], [112.25, 38.43674573427668]],
        [[0, -1131], [112.25, 18.070634135984076]],
      ];
      for (const [[x, y], [lng, lat]] of back) {
        const got = conic.toLngLat(x, y);
        expect(got[0]).toBeCloseTo(lng, 10);
        expect(got[1]).toBeCloseTo(lat, 10);
      }
    });

    it('正中是原点；换过去再换回来是原来的点', () => {
      const centre = conic.toKm(112.25, 28.25);
      expect(Math.abs(centre[0]) + Math.abs(centre[1])).toBeLessThan(1e-9);
      for (const [lng, lat] of [[101.2, 37.9], [112.25, 28.25], [120.16, 30.24], [109.5, 18.3]] as LngLat[]) {
        const [x, y] = conic.toKm(lng, lat);
        const again = conic.toLngLat(x, y);
        expect(again[0]).toBeCloseTo(lng, 9);
        expect(again[1]).toBeCloseTo(lat, 9);
      }
    });
  });

  describe('样张的高程格子', () => {
    /** 3 列 × 2 行、每格 100 公里的小格子：北边一行 10、20、30，南边一行 40、50、60。 */
    const smallJson = (change: Record<string, unknown> = {}): string =>
      JSON.stringify({ projection: { kind: '编的', ...PARAMS }, cols: 3, rows: 2, cellKm: 100, widthKm: 200, heightKm: 100, maxM: 60, ...change });
    const smallBytes = terrainBytes(Int16Array.of(10, 20, 30, 40, 50, 60));
    const small = readTrialDem(smallJson(), smallBytes);
    /** 桌面上的一点（公里）现在多高、在不在桌面里。 */
    const at = (x: number, y: number): { m: number; inside: boolean } => {
      const [lng, lat] = small.conic.toLngLat(x, y);
      return { m: trialHeightAt(small)(lng, lat), inside: insideTrial(small)(lng, lat) };
    };

    it('格点上是格点的值：第 0 行在北边，第 0 列在西边', () => {
      expect(at(-100, 50).m).toBeCloseTo(10, 6);
      expect(at(100, 50).m).toBeCloseTo(30, 6);
      expect(at(-100, -50).m).toBeCloseTo(40, 6);
      expect(at(100, -50).m).toBeCloseTo(60, 6);
      // 正好在桌边上的点，来回换算差一点点就说不准，所以往里挪一公里再问
      expect(at(0, 49).inside && at(99, -49).inside && at(-99, 0).inside).toBe(true);
    });

    it('格子之间按远近匀开', () => {
      expect(at(-50, 0).m).toBeCloseTo((10 + 20 + 40 + 50) / 4, 6);
      expect(at(50, 25).m).toBeCloseTo(25 * 0.75 + 55 * 0.25, 6);
    });

    it('出了桌面取最近的边上的值，而且说得出“在桌面以外”', () => {
      expect(at(-500, 0)).toEqual({ m: expect.closeTo(25, 6), inside: false });
      expect(at(500, 300)).toEqual({ m: expect.closeTo(30, 6), inside: false });
      expect(at(0, -400)).toEqual({ m: expect.closeTo(50, 6), inside: false });
    });

    it('两个文件对不上就停下来说', () => {
      expect(() => readTrialDem(smallJson(), smallBytes.subarray(2))).toThrow('应该是 12 字节');
      expect(() => readTrialDem(smallJson({ widthKm: 300 }), smallBytes)).toThrow('对不上');
      expect(() => readTrialDem(smallJson({ projection: { lat1: 22 } }), smallBytes)).toThrow('不全');
    });
  });

  describe('地形文件的格子', () => {
    /** 4 列 × 3 行、每格 0.04 度的小格子。 */
    const GRID: LatLngGrid = { cols: 4, rows: 3, west: 100, east: 100.12, north: 30.08, south: 30 };
    const all = (value: number): Uint8Array => new Uint8Array(GRID.cols * GRID.rows).fill(value);

    it('格子照场景的 terrain 那一块：六个数原样取来，两头正好在格点上；写得不成样子的不认（苏轼那一座是多少，写着名字的那一组查）', () => {
      const block = { class: 'real', file: 'route.terrain.bin', heightUnit: 'm', cols: 4, rows: 3, west: 100, east: 100.12, north: 30.08, south: 30 };
      const grid = gridOf(block);
      expect(grid).toEqual(GRID);
      expect(lngOf(grid, 0)).toBe(100);
      expect(lngOf(grid, 3)).toBe(100.12);
      expect(latOf(grid, 0)).toBe(30.08);
      expect(latOf(grid, 2)).toBe(30);
      expect(lngOf(grid, 1) - lngOf(grid, 0)).toBeCloseTo(0.04, 12);
      expect(latOf(grid, 0) - latOf(grid, 1)).toBeCloseTo(0.04, 12);
      expect(() => gridOf({ ...block, cols: 1 })).toThrow('不成样子');
      expect(() => gridOf({ ...block, rows: 2.5 })).toThrow('不成样子');
      expect(() => gridOf({ ...block, east: 100 })).toThrow('不成样子');
      expect(() => gridOf({ ...block, north: 29 })).toThrow('不成样子');
      expect(() => gridOf({ ...block, west: Number.NaN })).toThrow('不成样子');
    });

    it('每格取的是横竖各 3 个点，匀在这一格里；存的是它们的平均，不是正中那一个点', () => {
      const asked: LngLat[] = [];
      const spike = (lng: number, lat: number): number => {
        asked.push([lng, lat]);
        // 只有第 1 行第 1 列的格点正中那一个点是 900 米，别处都是 0
        return Math.abs(lng - lngOf(GRID, 1)) < 1e-9 && Math.abs(lat - latOf(GRID, 1)) < 1e-9 ? 900 : 0;
      };
      const { heights } = resampleTerrain(GRID, spike, all(1));
      expect(asked).toHaveLength(GRID.cols * GRID.rows * 9);
      const first = asked.slice(0, 9);
      const offsets = [-0.04 / 3, 0, 0.04 / 3];
      const want = offsets.flatMap((dLat) => offsets.map((dLng): LngLat => [100 + dLng, 30.08 + dLat]));
      first.forEach((p, k) => {
        expect(p[0]).toBeCloseTo(want[k][0], 12);
        expect(p[1]).toBeCloseTo(want[k][1], 12);
      });
      expect(heights[1 * GRID.cols + 1]).toBe(100);
      // 旁边的格子取的点不到它那里：这是陆地，所以是 1，不是 0
      expect(heights[1 * GRID.cols + 2]).toBe(1);
    });

    it('第 0 行在北边、第 0 列在西边；四舍五入成整米', () => {
      // 往东每格高 40 米，往北每格高 4 米，另加 0.4 米
      const slope = (lng: number, lat: number): number => (lng - 100) * 1000 + (lat - 30) * 100 + 0.4;
      const { heights, report } = resampleTerrain(GRID, slope, all(1));
      expect([...heights]).toEqual([8, 48, 88, 128, 4, 44, 84, 124, 1, 40, 80, 120]);
      expect(report.corners).toEqual({ nw: 8, ne: 128, sw: 1, se: 120 });
      expect(report.highest.m).toBe(128);
      expect(report.highest.lng).toBe(100.12);
      expect(report.highest.lat).toBe(30.08);
    });

    it('不在陆地上的格子存 0；陆地上的最小存 1；各有多少格数得对', () => {
      const land = all(1);
      land[0] = 0; // 西北角不是陆地，那里取样出来是 8 米
      const slope = (lng: number, lat: number): number => (lng - 100) * 1000 + (lat - 30) * 100;
      const known = (lng: number): boolean => lng < 100.1; // 最东一列在“原来的数据”以外
      const { heights, report } = resampleTerrain(GRID, slope, land, known);
      expect(heights[0]).toBe(0);
      expect(heights[2 * GRID.cols]).toBe(1); // 西南角：陆地，取样出来是 0 米
      expect(report).toMatchObject({ land: 11, sea: 1, raised: 1, zeroed: 1, outside: 3 });
      expect(() => resampleTerrain(GRID, slope, new Uint8Array(5))).toThrow('应该是 12 格');
      expect(() => resampleTerrain(GRID, () => 40_000, land)).toThrow('存不进 16 位整数');
    });

    it('写成字节：每格两个字节，低位在前；读回来一样；大小不对的不读', () => {
      const heights = Int16Array.of(1, 258, 6292, 0, 0, 0, 0, 0, 0, 0, 0, 32767);
      const bytes = terrainBytes(heights);
      expect([...bytes.subarray(0, 6)]).toEqual([1, 0, 2, 1, 0x94, 0x18]);
      expect([...bytes.subarray(22)]).toEqual([0xff, 0x7f]);
      expect([...readTerrain(GRID, bytes)]).toEqual([...heights]);
      expect(() => readTerrain(GRID, bytes.subarray(1))).toThrow('应该是 24 字节');
    });

    describe('哪些格子是陆地', () => {
      /** 把东经 100.03 到 100.09、北纬 30.02 到 30.06 围起来的一圈：只有中间一行的中间两格的格点在里面。 */
      const square: LngLat[] = [[100.03, 30.02], [100.09, 30.02], [100.09, 30.06], [100.03, 30.06]];
      const middle = [0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0];

      it('格点落在圈里面的算陆地；圈合没合上、顺时针还是逆时针都一样', () => {
        expect([...landMask(GRID, [square])]).toEqual(middle);
        expect([...landMask(GRID, [closeRing(square)])]).toEqual(middle);
        expect([...landMask(GRID, [square.slice().reverse()])]).toEqual(middle);
        expect([...landMask(GRID, [])]).toEqual([...all(0)]);
      });

      it('几圈是合起来算的：同一圈重复了两遍还是陆地（样张的岸线里就有重复的岛）', () => {
        expect([...landMask(GRID, [square, square])]).toEqual(middle);
        const east: LngLat[] = [[100.07, 30.02], [100.2, 30.02], [100.2, 30.06], [100.07, 30.06]];
        expect([...landMask(GRID, [square, east])]).toEqual([0, 0, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0]);
      });

      it('正好压在格点上的边：西边、南边的算在里面，东边、北边的不算', () => {
        // 格点都是整数的格子（小数的格点差一点点就分不清在边的哪一侧）
        const whole: LatLngGrid = { cols: 4, rows: 3, west: 100, east: 103, north: 32, south: 30 };
        const onNodes: LngLat[] = [[101, 30], [102, 30], [102, 31], [101, 31]];
        expect([...landMask(whole, [onNodes])]).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0]);
      });
    });
  });

  describe('今天的岸线、湖、河', () => {
    it('没有名字的照位置起名字：两位小数，末位是 5 的往上进（设计里举的例子就是这一个湖）', () => {
      expect(positionName('lake', [116.885, 32.386])).toBe('lake@116.89,32.39');
      expect(positionName('river', [120.8, 31])).toBe('river@120.80,31.00');
      expect(positionName('land', [109.7441, 19.2])).toBe('land@109.74,19.20');
      // 位置先取三位小数（样张记湖的中心就是三位），再取两位
      expect(positionName('land', [109.7449, 22.385])).toBe('land@109.75,22.39');
    });

    it('一圈的面积带正负（逆时针是正的），中心，合上，点在不在里面', () => {
      const square: LngLat[] = [[0, 0], [2, 0], [2, 2], [0, 2]];
      expect(signedArea(square)).toBe(4);
      expect(signedArea(square.slice().reverse())).toBe(-4);
      expect(signedArea(closeRing(square))).toBe(4);
      expect(ringCentre(square)).toEqual([1, 1]);
      expect(ringCentre(closeRing(square).reverse())).toEqual([1, 1]);
      expect(ringCentre([[1, 1], [3, 1], [1, 1]])).toEqual([5 / 3, 1]); // 不成面：取各点的平均
      expect(closeRing(square)).toHaveLength(5);
      expect(closeRing(closeRing(square))).toHaveLength(5);
      expect(insideRing([1, 1], square)).toBe(true);
      expect(insideRing([3, 1], square)).toBe(false);
    });

    it('抽稀：离连线不到 0.6 公里的点去掉，超过的留着；头尾不动', () => {
      const line = (bumpKm: number): LngLat[] => [[0, 0], [0.5, bumpKm / 100], [1, 0]];
      expect(thin(line(0.5), 0.6, flat)).toEqual([[0, 0], [1, 0]]);
      expect(thin(line(0.7), 0.6, flat)).toEqual(line(0.7));
      // 一个点留下了，它两边的再各自量
      // （两边的两个点离头尾的连线 2.4 公里，离“头—中间那个点—尾”的折线只有 0.1 公里）
      const zigzag: LngLat[] = [[0, 0], [0.25, 0.024], [0.5, 0.05], [0.75, 0.024], [1, 0]];
      expect(thin(zigzag, 0.6, flat)).toEqual([[0, 0], [0.5, 0.05], [1, 0]]);
      expect(thin([[0, 0], [1, 1]], 0.6, flat)).toEqual([[0, 0], [1, 1]]);
      // 头尾是同一个点的圈：四个角都留着，边上多出来的点去掉
      const ring: LngLat[] = [[0, 0], [0.05, 0], [0.1, 0], [0.1, 0.1], [0, 0.1], [0, 0.05], [0, 0]];
      expect(thin(ring, 0.6, flat)).toEqual([[0, 0], [0.1, 0], [0.1, 0.1], [0, 0.1], [0, 0]]);
    });

    it('把线裁到方框里：进出的地方添上框边上的点；出去又回来的裁成几段', () => {
      const box = { west: 100, east: 110, south: 20, north: 30 };
      const inside: LngLat[] = [[101, 21], [105, 25], [109, 29]];
      expect(clipLineToBox(inside, box)).toEqual([inside]);
      expect(clipLineToBox([[98, 25], [102, 25], [104, 25]], box)).toEqual([[[100, 25], [102, 25], [104, 25]]]);
      // 从北边出去，绕一圈再回来
      const loop: LngLat[] = [[101, 28], [103, 32], [105, 34], [107, 32], [108, 28]];
      expect(clipLineToBox(loop, box)).toEqual([
        [[101, 28], [102, 30]],
        [[107.5, 30], [108, 28]],
      ]);
      // 一段线从框外穿过框再出去：留中间的一截
      expect(clipLineToBox([[95, 25], [115, 25]], box)).toEqual([[[100, 25], [110, 25]]]);
      expect(clipLineToBox([[90, 10], [95, 15]], box)).toEqual([]);
      expect(clipLineToBox([[90, 40], [95, 35], [120, 35]], box)).toEqual([]);
    });

    it('样张按中心缩小过的一圈，放得回原来的大小（差不到 0.0015 度）', () => {
      const centre: LngLat = [119.2437, 32.9051];
      const real: LngLat[] = [[119.012, 32.733], [119.401, 32.781], [119.377, 33.099], [119.105, 33.02], [119.012, 32.733]];
      // 照样张的做法缩：按没取整的中心缩到六成，取三位小数；它记下的中心也是三位小数
      const r = (v: number): number => Math.round(v * 1000) / 1000;
      const shrunk = real.map((p): LngLat => [r(centre[0] + (p[0] - centre[0]) * 0.6), r(centre[1] + (p[1] - centre[1]) * 0.6)]);
      const back = restoreShrunk(shrunk, [r(centre[0]), r(centre[1])], 0.6);
      back.forEach((p, k) => {
        expect(Math.abs(p[0] - real[k][0])).toBeLessThan(0.0015);
        expect(Math.abs(p[1] - real[k][1])).toBeLessThan(0.0015);
      });
      expect(Math.abs(shrunk[1][0] - real[1][0])).toBeGreaterThan(0.05);
    });

    describe('从样张的文件做出每一项', () => {
      const BOX = { west: 100, east: 110, south: 20, north: 30 };
      /** 交给工具的“源数据里缩小过的湖”：下面编的数据里有一个。 */
      const SHRUNK = [{ name: 'Gaoyou Hu', factor: 0.6 }];
      /** 一大块陆地：顺时针走，没有合上，一条边上多一个点。 */
      const mainland: LngLat[] = [[101, 21], [101, 25], [101, 29], [109, 29], [109, 21]];
      /** 两百米宽的小岛（顺时针走）：一抽稀就不成面。 */
      const islet: LngLat[] = [[105, 20.5], [105, 20.502], [105.002, 20.502], [105.002, 20.5], [105, 20.5]];
      /** 方框边上裁剩下的一圈：只有两个不同的点。 */
      const sliver: LngLat[] = [[110, 25.774], [109.998, 25.774], [110, 25.774]];
      const lakeRing = (cx: number, cy: number, half: number): LngLat[] => [[cx - half, cy - half], [cx - half, cy + half], [cx + half, cy + half], [cx + half, cy - half], [cx - half, cy - half]];
      const water = (): TrialWater => ({
        land: [mainland, islet, mainland, sliver],
        lakes: [
          { name: 'Tai Hu', zh: '太湖', at: [104, 24], km2: 2500, ring: lakeRing(104, 24, 0.2) },
          { name: null, zh: null, at: [106.885, 22.386], km2: 100, ring: lakeRing(106.885, 22.386, 0.05) },
          // 样张缩到六成的湖：原来的半边长 0.2 度，缩了以后 0.12 度
          { name: 'Gaoyou Hu', zh: '高邮湖', at: [103, 27], km2: 800, note: '示意：缩小到六成', ring: lakeRing(103, 27, 0.12) },
        ],
        rivers: [
          { name: 'Huang', zh: '黄河', rank: 3, line: [[101, 28], [103, 32], [105, 34], [107, 32], [108, 28]] },
          { name: null, zh: '编的水道', rank: 8, line: [[102.345, 22], [102.5, 22.001], [103, 22]] },
        ],
        removed: [],
      });

      it('先陆地、再湖、再河；重复的、不成面的圈去掉；圈都合上、逆时针走；抽稀；起名字；缩过的湖放回去；出框的河裁开', () => {
        const { features, report } = todayFeatures(water(), flat, BOX, SHRUNK);
        expect(features.map((f) => `${f.properties.kind} ${f.properties.name}`)).toEqual([
          'land land@105.00,25.00',
          'land land@105.00,20.50',
          'lake Tai Hu',
          'lake lake@106.89,22.39',
          'lake Gaoyou Hu',
          'river Huang',
          'river Huang',
          'river river@102.35,22.00',
        ]);
        expect(todayProblems(features, BOX)).toEqual([]);
        // 大陆：边上多出来的那个点抽掉了，合上了，反过来走了
        expect(features[0].geometry.coordinates).toEqual([[[101, 21], [109, 21], [109, 29], [101, 29], [101, 21]]]);
        // 小岛：原样留着（只是反过来走）
        expect(features[1].geometry.coordinates).toEqual([islet.slice().reverse()]);
        // 缩过的湖：半边长放回 0.2 度
        expect(features[4].geometry.coordinates).toEqual([[[102.8, 26.8], [103.2, 26.8], [103.2, 27.2], [102.8, 27.2], [102.8, 26.8]]]);
        // 河：从北边出框又回来，成了两项，名字一样
        expect(features[5].geometry.coordinates).toEqual([[101, 28], [102, 30]]);
        expect(features[6].geometry.coordinates).toEqual([[107.5, 30], [108, 28]]);
        // 没名字的河：中间那个点离连线 0.1 公里，抽掉了
        expect(features[7].geometry.coordinates).toEqual([[102.345, 22], [103, 22]]);

        expect(report.land).toEqual({ ringsIn: 4, pointsIn: 18, duplicates: 1, degenerate: [[110, 25.774]], pointsUnique: 10, ringsOut: 2, pointsOut: 10, keptWhole: 1 });
        expect(report.lakes).toEqual({ ringsIn: 3, pointsIn: 15, ringsOut: 3, pointsOut: 15, restored: ['Gaoyou Hu'] });
        expect(report.rivers).toEqual({ linesIn: 2, pointsIn: 8, linesOut: 3, pointsOut: 6, clipped: [{ name: 'Huang', pieces: 2 }] });
        expect(report.named).toEqual([
          { name: 'lake@106.89,22.39', zh: null },
          { name: 'river@102.35,22.00', zh: '编的水道' },
        ]);
        expect(landRings(features)).toEqual([features[0].geometry.coordinates[0], features[1].geometry.coordinates[0]]);
      });

      it('样张的文件不是认得的样子：停下来说，不硬做', () => {
        const edit = (change: (w: TrialWater) => void): TrialWater => {
          const w = water();
          change(w);
          return w;
        };
        expect(() => todayFeatures(edit((w) => (w.lakes[0].note = '改过')), flat, BOX, SHRUNK)).toThrow('不知道这一处改动');
        expect(() => todayFeatures(edit((w) => delete w.lakes[2].note), flat, BOX, SHRUNK)).toThrow('没有带着“缩小过”的说明');
        expect(() => todayFeatures(edit((w) => w.land.push(lakeRing(105, 25, 1))), flat, BOX, SHRUNK)).toThrow('在另一圈里面');
        expect(() => todayFeatures(edit((w) => w.land.push(lakeRing(110, 25, 1))), flat, BOX, SHRUNK)).toThrow('出了方框');
        expect(() => todayFeatures(edit((w) => (w.lakes[0].ring = lakeRing(109.9, 24, 0.2))), flat, BOX, SHRUNK)).toThrow('出了方框');
        // 哪个湖缩小过是交进来的，不是工具自己记着的：没交那张单子，源数据里带着说明的湖就是“不知道的改动”
        expect(() => todayFeatures(water(), flat, BOX, [])).toThrow('不知道这一处改动');
      });

      it('写成文件：一项一行，行尾 LF，最后一个换行；读回来是同样的东西；同样的内容写出同样的字节', () => {
        const { features } = todayFeatures(water(), flat, BOX, SHRUNK);
        const text = todayText(features);
        expect(text.startsWith('{"type":"FeatureCollection","features":[\n{"type":"Feature","properties":{"kind":"land","name":"land@105.00,25.00"},"geometry":{"type":"Polygon","coordinates":[[[101,21],')).toBe(true);
        expect(text.endsWith(']}}\n]}\n')).toBe(true);
        expect(text.includes('\r')).toBe(false);
        expect(text.split('\n')).toHaveLength(features.length + 3);
        expect(JSON.parse(text)).toEqual({ type: 'FeatureCollection', features });
        expect(todayText(todayFeatures(water(), flat, BOX, SHRUNK).features)).toBe(text);
        const sizes = bytesByKind(features);
        expect(sizes.land + sizes.lake + sizes.river).toBe(new TextEncoder().encode(text).length - '{"type":"FeatureCollection","features":[\n'.length - ']}\n'.length - features.length * 2 + 1);
      });

      it('不合文件规矩的一项，查得出来', () => {
        const good = (): TodayFeature[] => todayFeatures(water(), flat, BOX, SHRUNK).features;
        const problems = (change: (features: TodayFeature[]) => void): string[] => {
          const features = good();
          change(features);
          return todayProblems(features, BOX);
        };
        const ringOf = (f: TodayFeature): LngLat[] => (f.geometry.type === 'Polygon' ? f.geometry.coordinates[0] : []);
        const lineOf = (f: TodayFeature): LngLat[] => (f.geometry.type === 'LineString' ? f.geometry.coordinates : []);
        expect(problems(() => undefined)).toEqual([]);
        expect(problems((f) => ringOf(f[0]).reverse())).toEqual(['第 0 项（land land@105.00,25.00）的一圈不是逆时针走的']);
        expect(problems((f) => ringOf(f[0]).pop())).toEqual(['第 0 项（land land@105.00,25.00）的一圈头尾不是同一个点']);
        expect(problems((f) => ringOf(f[2]).splice(1, 2))).toEqual(['第 2 项（lake Tai Hu）的一圈只有 3 个点，不成一个面']);
        expect(problems((f) => (ringOf(f[2])[1] = [104.2001, 23.8]))).toEqual(['第 2 项（lake Tai Hu）有不是三位小数的坐标']);
        expect(problems((f) => (lineOf(f[5])[1] = [102, 30.5]))).toEqual(['第 5 项（river Huang）有出了方框的点']);
        expect(problems((f) => (f[7].properties.name = ''))).toEqual(['第 7 项（river ）没有名字']);
        expect(problems((f) => (f[7].properties.kind = 'lake'))).toEqual(['第 7 项（lake river@102.35,22.00）不是河，却是一条线']);
        expect(problems((f) => (f[5].geometry = { type: 'LineString', coordinates: [[101, 28]] }))).toEqual(['第 5 项（river Huang）的线不到两个点']);
      });
    });
  });

  describe('岸线', () => {
    /** 一条从 [0, 0] 往东 200 公里的直河，2 公里一个点。 */
    const straight: Km[] = Array.from({ length: 101 }, (_v, i): Km => [i * 2, 0]);
    const dry = (): boolean => false;
    /** 线上每一点离一条河（一串点）最近多少公里。 */
    const fromRiver = (p: Km, river: Km[]): number => Math.min(...river.map((q) => Math.hypot(p[0] - q[0], p[1] - q[1])));

    it('化简：离连线不到给的数的点去掉；削角：两头不动，一段变两点', () => {
      expect(simplify([[0, 0], [50, 3], [100, 0]], 9)).toEqual([[0, 0], [100, 0]]);
      expect(simplify([[0, 0], [50, 12], [100, 0]], 9)).toEqual([[0, 0], [50, 12], [100, 0]]);
      expect(chaikin([[0, 0], [100, 0], [100, 100]], 1)).toEqual([[0, 0], [25, 0], [75, 0], [100, 25], [100, 75], [100, 100]]);
      expect(chaikin([[0, 0], [10, 0]], 2)).toEqual([[0, 0], [10, 0]]);
    });

    it('把一条河的几段接成一条：头尾挨着的接上，要倒过来的倒过来；离得远的另算一条', () => {
      const chains = stitch([
        [[100, 0], [150, 0]],
        [[0, 0], [40, 0], [95, 0]],
        // 这一段是倒着写的（尾在 [155, 0]），也是最长的一段：接出来的那一条照它的方向走
        [[260, 0], [200, 0], [155, 0]],
        [[400, 50], [420, 50]],
      ]);
      expect(chains).toHaveLength(2);
      expect(chains[0].map((p) => p[0])).toEqual([260, 200, 155, 150, 100, 95, 40, 0]);
      expect(chains[1]).toEqual([[400, 50], [420, 50]]);
      // 相距 12 公里以上的不接
      expect(stitch([[[0, 0], [10, 0]], [[23, 0], [40, 0]]])).toHaveLength(2);
    });

    it('直河：线在写的那一边、离河心正好那么远；两头在 34 公里里慢慢收回到城里；头尾就是给的两点', () => {
      const a: Km = [0, 0];
      const b: Km = [200, 0];
      const left = bankLine({ centre: straight, a, b, off: 6, side: 1, inWater: dry }).line;
      expect(left[0]).toBe(a);
      expect(left[left.length - 1]).toBe(b);
      // 往东走的左手边是北边
      for (const p of left) {
        if (p[0] >= BANK_TAPER_KM && p[0] <= 200 - BANK_TAPER_KM) expect(p[1]).toBeCloseTo(6, 6);
        else expect(p[1]).toBeLessThan(6);
        expect(p[1]).toBeGreaterThanOrEqual(0);
      }
      // 收回的那一截里越走越靠岸
      const head = left.filter((p) => p[0] < BANK_TAPER_KM);
      for (let i = 1; i < head.length; i++) expect(head[i][1]).toBeGreaterThan(head[i - 1][1]);
      const right = bankLine({ centre: straight, a, b, off: 6, side: -1, inWater: dry }).line;
      expect(right[Math.floor(right.length / 2)][1]).toBeCloseTo(-6, 6);
      // 倒着走（从东头到西头）的左手边是南边
      const back = bankLine({ centre: straight, a: b, b: a, off: 6, side: 1, inWater: dry }).line;
      expect(back[0]).toBe(b);
      expect(back[Math.floor(back.length / 2)][1]).toBeCloseTo(-6, 6);
    });

    it('城在岸上几公里：线从城里出来，不先回河心；城不在河边：不收，从岸上直着连过去', () => {
      const near = bankLine({ centre: straight, a: [0, 4], b: [200, 0], off: 6, side: 1, inWater: dry }).line;
      expect(near[0]).toEqual([0, 4]);
      for (const p of near.filter((q) => q[0] < BANK_TAPER_KM)) expect(p[1]).toBeGreaterThanOrEqual(4 - 1e-9);
      const far = bankLine({ centre: straight, a: [0, 30], b: [200, 0], off: 6, side: 1, inWater: dry, taperA: false }).line;
      expect(far[0]).toEqual([0, 30]);
      // 第二个点已经在岸上了
      expect(far[1][0]).toBeCloseTo(0, 6);
      expect(far[1][1]).toBeCloseTo(6, 6);
    });

    it('弯弯曲曲的河：线只会比写的数离河远，不会近（两头收回的一截以外）', () => {
      // 左右摆 5 公里、40 公里一个来回的河：引线把这些弯都抹平了
      const winding: Km[] = Array.from({ length: 151 }, (_v, i): Km => [i * 2, 5 * Math.sin((i * 2 * Math.PI) / 20)]);
      const fine = dense(winding, 0.25);
      const made = bankLine({ centre: winding, a: winding[0], b: winding[150], off: 6, side: 1, inWater: dry });
      const middle = made.line.filter((p) => p[0] > BANK_TAPER_KM + 5 && p[0] < 300 - BANK_TAPER_KM - 5);
      expect(middle.length).toBeGreaterThan(50);
      const away = middle.map((p) => fromRiver(p, fine));
      expect(Math.min(...away)).toBeGreaterThan(5.7);
      expect(Math.max(...away)).toBeLessThan(15);
      expect(made.tight).toBe(0);
    });

    it('挪过去落进水里的点往河这边收，最多收到离河 2.5 公里；收到头还在水里的数得出来；直着连到城里要过水就从河上往前让', () => {
      // 北岸 4 公里以外、东西 20 公里宽的一片湖
      const lake = (p: Km): boolean => p[0] > 90 && p[0] < 110 && p[1] > 4 && p[1] < 30;
      const made = bankLine({ centre: straight, a: [0, 0], b: [200, 0], off: 6, side: 1, inWater: lake });
      expect(made.pulled).toBeGreaterThan(0);
      expect(made.wet).toBe(0);
      for (const p of made.line) expect(lake(p)).toBe(false);
      const beside = made.line.filter((p) => p[0] > 92 && p[0] < 108);
      for (const p of beside) {
        expect(p[1]).toBeLessThanOrEqual(4);
        expect(p[1]).toBeGreaterThanOrEqual(2.5 - 1e-9);
      }
      // 湖一直伸到离河 1 公里：收到头还在水里
      const deep = (p: Km): boolean => p[0] > 90 && p[0] < 110 && p[1] > 1 && p[1] < 30;
      expect(bankLine({ centre: straight, a: [0, 0], b: [200, 0], off: 6, side: 1, inWater: deep }).wet).toBeGreaterThan(0);
      // 城在北边 30 公里，城和河口之间隔着一片海湾（x 不到 20 的地方、y 在 3 到 20 之间）
      const bay = (p: Km): boolean => p[0] < 20 && p[1] > 3 && p[1] < 20;
      const far = bankLine({ centre: straight, a: [40, 30], b: [200, 0], off: 6, side: 1, inWater: bay, taperA: false, meetA: [0, 0] });
      expect(far.skippedKm[0]).toBeGreaterThanOrEqual(20);
      expect(far.line[0]).toEqual([40, 30]);
      expect(far.line[1][0]).toBeGreaterThanOrEqual(20);
    });

  });

  describe('给哪一位人物做（ROUTE_FIGURE 和那张表）', () => {
    /** 编的一行：只为了数得出表里有几位。 */
    const row = (folder: string): RouteToolFigure => ({ source: { folder, dem: 'dem.json', demBytes: 'dem.bin', water: 'water.json' }, todayBox: { west: 0, east: 1, south: 0, north: 1 }, shrunkLakes: [], banks: {} });

    it('写了 ROUTE_FIGURE：就是表里的那一位；写的不在表里，停下来说表里有谁', () => {
      const table = { first: row('a/'), second: row('b/') };
      expect(routeToolFigure('second', table)).toEqual({ id: 'second', figure: table.second });
      expect(routeToolFigure('first', table).figure.source.folder).toBe('a/');
      expect(() => routeToolFigure('third', table)).toThrow('“third”不在做全程沙盘的那张表里');
      expect(() => routeToolFigure('third', table)).toThrow('first、second');
      // 表的原型上的名字不算表里的人物
      expect(() => routeToolFigure('toString', table)).toThrow('不在做全程沙盘的那张表里');
    });

    it('没写：表里只有一位就是他；有两位以上、一位也没有，都停下来说，不悄悄挑一位', () => {
      const one = { only: row('a/') };
      expect(routeToolFigure(undefined, one)).toEqual({ id: 'only', figure: one.only });
      expect(routeToolFigure('', one).id).toBe('only');
      const two = { first: row('a/'), second: row('b/') };
      expect(() => routeToolFigure(undefined, two)).toThrow('ROUTE_FIGURE=<人物的文件夹名>');
      expect(() => routeToolFigure(undefined, two)).toThrow('first、second');
      expect(() => routeToolFigure('', two)).toThrow('要说给哪一位人物做');
      expect(() => routeToolFigure(undefined, {})).toThrow('一位也没有');
    });

    it('场景文件在这位人物的 scenes/ 里，叫 route.json；真的那张表里每一行的源数据都写着文件夹和三个文件', () => {
      expect(scenesFolder('some-one')).toBe('content/figures/some-one/scenes/');
      expect(ROUTE_SCENE_FILE).toBe('route.json');
      expect(Object.keys(ROUTE_TOOL_FIGURES).length).toBeGreaterThan(0);
      for (const [id, figure] of Object.entries(ROUTE_TOOL_FIGURES)) {
        expect(figure.source.folder.endsWith('/'), id).toBe(true);
        for (const file of [figure.source.dem, figure.source.demBytes, figure.source.water]) expect(file.length, id).toBeGreaterThan(0);
        expect(figure.todayBox.east, id).toBeGreaterThan(figure.todayBox.west);
        expect(figure.todayBox.north, id).toBeGreaterThan(figure.todayBox.south);
        for (const lake of figure.shrunkLakes) {
          expect(lake.factor, `${id} ${lake.name}`).toBeGreaterThan(0);
          expect(lake.factor, `${id} ${lake.name}`).toBeLessThan(1);
        }
      }
    });
  });

  // ---------------------------------------------------------------- 表里的每一位人物；content/ 里的每一座全程沙盘
  // 这几组一位人物查一遍。随 npm test 跑，每一位都查：表里的一行要写全了才提交。
  // 用自己的模式来做文件的时候只查正在做的那一位（notThisTime）：别的人物那一行还没写全、文件还没做齐，
  // 不该让这一位的工具做完了却以失败收场。正在做的那一位自己的一行没写全（比如 banks 里还缺路），他的工具照做、照印，末了这里说对不上。

  describe.each(Object.keys(ROUTE_TOOL_FIGURES))('那张表里的 %s', (figureId) => {
    const figure = ROUTE_TOOL_FIGURES[figureId];

    it.skipIf(notThisTime(figureId))('他有全程沙盘的场景文件；场景里写了 along、沿着一条河走的路，在他那一行的 banks 里都有，banks 里也没有场景里没有的路', () => {
      const scene = readRouteScene(figureId);
      expect(scene.level).toBe('route');
      const rivers = new Set(scene.water.rivers.map((river) => river.id));
      const along = scene.roads.ways.filter((way) => way.along !== undefined && rivers.has(way.along)).map((way) => way.id);
      expect(Object.keys(figure.banks).sort()).toEqual(along.slice().sort());
    });

    it.skipIf(notThisTime(figureId))('地形文件的格子（场景里写的）整个落在裁岸线的方框里面：格子上每一点是不是陆地，岸线文件都说得出', () => {
      const grid = gridOf(readRouteScene(figureId).terrain);
      const box = figure.todayBox;
      expect(grid.west).toBeGreaterThanOrEqual(box.west);
      expect(grid.east).toBeLessThanOrEqual(box.east);
      expect(grid.south).toBeGreaterThanOrEqual(box.south);
      expect(grid.north).toBeLessThanOrEqual(box.north);
    });
  });

  /** content/ 里有全程沙盘的场景文件的人物（文件夹名，排好的）。 */
  const routeFigures = readdirSync(new URL('content/figures/', ROOT), { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(new URL(`${scenesFolder(entry.name)}${ROUTE_SCENE_FILE}`, ROOT)))
    .map((entry) => entry.name)
    .sort();

  it('content/ 里有全程沙盘', () => {
    expect(routeFigures.length).toBeGreaterThan(0);
  });

  describe.each(routeFigures)('content/ 里 %s 做好的两个文件', (figureId) => {
    const scenes = scenesFolder(figureId);
    const scene = readRouteScene(figureId);
    const terrainUrl = new URL(`${scenes}${scene.terrain.file}`, ROOT);
    const todayUrl = new URL(`${scenes}${scene.water.todayFile}`, ROOT);
    const have = existsSync(terrainUrl) && existsSync(todayUrl);

    // 两个文件是一起做的：页面靠地形文件里“是不是 0”分陆地和海，上色的工具靠岸线文件，两边要是同一条岸。
    // 只读这两个文件和场景里写的格子，不读源数据；哪一个还没有放进 content/ 就不查。
    it.skipIf(!have || notThisTime(figureId))('对得上：地形文件大小是场景里写的格子的大小；它里面不是 0 的格子，正好是格点落在岸线文件的陆地里的那些', () => {
      const grid = gridOf(scene.terrain);
      const bytes = readFileSync(terrainUrl);
      const text = new TextDecoder().decode(readFileSync(todayUrl));
      expect(bytes.length).toBe(grid.cols * grid.rows * 2);
      expect(text.includes('\r')).toBe(false);
      const heights = readTerrain(grid, bytes);
      const features = (JSON.parse(text) as { features: TodayFeature[] }).features;
      // 合不合文件的规矩要知道裁到哪个方框，方框写在那张表里他的一行。两个文件都在、表里却没有他：不悄悄跳过这一句，说出来
      const row = Object.hasOwn(ROUTE_TOOL_FIGURES, figureId) ? ROUTE_TOOL_FIGURES[figureId] : undefined;
      if (!row) {
        throw new Error(
          `content/ 里有 ${figureId} 做好的地形文件和岸线文件，做全程沙盘的那张表（tests/tools/route/figures.ts）里却没有他的一行：` +
            '岸线文件裁到哪个方框不知道，它合不合文件的规矩查不了。这两个文件是照表里的一行做的，把他的一行添上',
        );
      }
      expect(todayProblems(features, row.todayBox)).toEqual([]);
      const mask = landMask(grid, landRings(features));
      let wrong = 0;
      let negative = 0;
      for (let k = 0; k < heights.length; k++) {
        if ((mask[k] === 1) !== (heights[k] !== 0)) wrong += 1;
        if (heights[k] < 0) negative += 1;
      }
      expect(wrong, '地形文件里“是不是陆地”和岸线文件对不上的格子：两个文件要一起重做（npm run route:today，再 npm run route:terrain）').toBe(0);
      expect(negative).toBe(0);
    });
  });

  // ---------------------------------------------------------------- 苏轼的这一座自己的数和路名

  describe.skipIf(notThisTime('su-shi'))('苏轼的全程沙盘（su-shi）自己的数和路名', () => {
    const figure = ROUTE_TOOL_FIGURES['su-shi'];
    const grid = (): LatLngGrid => gridOf(readRouteScene('su-shi').terrain);

    it('地形文件的格子：570 × 520，每格 0.04 度，两头正好在格点上', () => {
      const ROUTE_GRID = grid();
      expect([ROUTE_GRID.cols, ROUTE_GRID.rows]).toEqual([570, 520]);
      expect(lngOf(ROUTE_GRID, 0)).toBe(100.86);
      expect(lngOf(ROUTE_GRID, 569)).toBe(123.62);
      expect(latOf(ROUTE_GRID, 0)).toBe(38.46);
      expect(latOf(ROUTE_GRID, 519)).toBe(17.7);
      expect(lngOf(ROUTE_GRID, 1) - lngOf(ROUTE_GRID, 0)).toBeCloseTo(0.04, 12);
      expect(latOf(ROUTE_GRID, 0) - latOf(ROUTE_GRID, 1)).toBeCloseTo(0.04, 12);
      expect(ROUTE_GRID.cols * ROUTE_GRID.rows * 2).toBe(592_800);
    });

    it('源数据是样张的三个文件；岸线裁到东经 100.3 到 124.3、北纬 16.8 到 39.3；放回原来大小的湖是高邮湖（缩到过六成）', () => {
      expect(figure.source).toEqual({ folder: 'spikes/art-direction/route/data/', dem: 'dem.json', demBytes: 'dem.bin', water: 'water.json' });
      expect(figure.todayBox).toEqual({ west: 100.3, east: 124.3, south: 16.8, north: 39.3 });
      expect(figure.shrunkLakes).toEqual([{ name: 'Gaoyou Hu', factor: 0.6 }]);
    });

    it('写了 along、沿着一条河走的路，在他那一行的 banks 里都有；大江以南的两段运河写着不贴', () => {
      const BANKS = figure.banks;
      const scene = readRouteScene('su-shi');
      const rivers = new Set(scene.water.rivers.map((river) => river.id));
      const along = scene.roads.ways.filter((way) => way.along !== undefined && rivers.has(way.along)).map((way) => way.id);
      expect(Object.keys(BANKS).sort()).toEqual(along.slice().sort());
      expect(Object.keys(BANKS).filter((id) => BANKS[id].paste === false)).toEqual(['w-canal-s1', 'w-canal-s2']);
      for (const spec of Object.values(BANKS)) {
        expect(spec.offKm).toBeGreaterThanOrEqual(5);
        expect(spec.offKm).toBeLessThanOrEqual(9);
      }
    });

    it('content/ 里他的地形文件是 592,800 字节，叫 route.terrain.bin；岸线文件叫 route.today.geojson', () => {
      const scene = readRouteScene('su-shi');
      expect([scene.terrain.file, scene.water.todayFile]).toEqual(['route.terrain.bin', 'route.today.geojson']);
      expect(readFileSync(new URL(`${scenesFolder('su-shi')}${scene.terrain.file}`, ROOT)).length).toBe(592_800);
    });
  });

  describe('写文件', () => {
    /** 假的文件夹：记下写了几次。 */
    function fakeIo(have: Record<string, Uint8Array> = {}): { io: FileIo; files: Record<string, Uint8Array>; writes: string[] } {
      const files = { ...have };
      const writes: string[] = [];
      return { io: { read: (file) => files[file] ?? null, write: (file, bytes) => { files[file] = bytes; writes.push(file); } }, files, writes };
    }

    it('以前没有：写；字节一样：不写；不一样（哪怕只差一个字节、只是长短不同）：换掉', () => {
      const bytes = Uint8Array.of(1, 2, 3, 4);
      const fresh = fakeIo();
      expect(writeIfDifferent(fresh.io, 'a.bin', bytes)).toBe('created');
      expect(fresh.writes).toEqual(['a.bin']);
      expect(writeIfDifferent(fresh.io, 'a.bin', Uint8Array.of(1, 2, 3, 4))).toBe('fresh');
      expect(fresh.writes).toEqual(['a.bin']);
      expect(writeIfDifferent(fresh.io, 'a.bin', Uint8Array.of(1, 2, 3, 5))).toBe('replaced');
      expect(writeIfDifferent(fresh.io, 'a.bin', Uint8Array.of(1, 2, 3))).toBe('replaced');
      expect(writeIfDifferent(fresh.io, 'a.bin', Uint8Array.of(1, 2, 3, 0))).toBe('replaced');
      expect(fresh.writes).toHaveLength(4);
      expect([...fresh.files['a.bin']]).toEqual([1, 2, 3, 0]);
    });

    it('做出来的文件放在哪：平常是 content/ 里这位人物的 scenes/；ROUTE_OUT 可以是相对项目根目录的文件夹，也可以是完整的路径', () => {
      const scenes = scenesFolder('su-shi');
      expect(outFolder(undefined, scenes).href).toBe(new URL('content/figures/su-shi/scenes/', ROOT).href);
      expect(outFolder('', scenes).href).toBe(new URL('content/figures/su-shi/scenes/', ROOT).href);
      // 换一位人物，平常的地方跟着换
      expect(outFolder(undefined, scenesFolder('some-one')).href).toBe(new URL('content/figures/some-one/scenes/', ROOT).href);
      expect(outFolder('tests/shots/e-trial', scenes).href).toBe(new URL('tests/shots/e-trial/', ROOT).href);
      expect(outFolder('tests/shots/e-trial/', scenes).href).toBe(new URL('tests/shots/e-trial/', ROOT).href);
      expect(outFolder('D:\\made\\route out', scenes).href).toBe('file:///D:/made/route%20out/');
      expect(outFolder('D:/made/out/', scenes).href).toBe('file:///D:/made/out/');
    });
  });
});
