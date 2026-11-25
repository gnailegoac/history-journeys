// 全程沙盘校验规则自己的测试（routeRules.ts）：格式，规则 10 到 15 在全程沙盘上的读法，规则 20（站的位置），
// 规则 2 添的半句（站的 id 不能叫 route），规则 17 在全程沙盘上的图片大小，“这两样还没做出来的沙盘”那张表。
// 和别的规则一样：合格的样本（fixtures/good/figures/demo/scenes/route.json，连它的地形文件和“今天的海岸、湖、河”）
// 一处问题也没有；出错的样本（fixtures/bad/figures/broken/scenes/route.json）格式是对的、规则 10 到 15 条条都错；
// 再在合格样本上一次只改坏一处，看是不是正好查出那一处。

import { describe, expect, it } from 'vitest';
import type { BakedGroundManifest } from '../../src/domain/bakedGround';
import type { RouteScene, StopScene } from '../../src/domain/scene';
import { routeCoords } from '../../src/domain/sceneGeoRoute';
import { sectionInfo } from '../../src/domain/sceneText';
import type { Figure, LngLat } from '../../src/domain/types';
import { MADE_FILES_PENDING, includePendingFrom, isPending, tablesToMake } from '../support/pendingTables';
import { fileSize, readBytes } from '../support/readBytes';
import { toContentFiles, toFileKeys, toFileSizes, toPictureSizes } from './files';
import {
  FAR_STRIP_MAX_KM,
  RIVER_STRIP_MAX_KM,
  ROUTE_STRIPS_MAX,
  STOP_PLACE_MAX_DEG,
  TODAY_MAX_BYTES,
  checkRouteShape,
  greatCircle,
  isRouteLevel,
  pickedLines,
  readToday,
  routeFarWords,
  routeFrameBox,
} from './routeRules';
import { RULE_NAMES, RULES_CHECKED_ELSEWHERE, formatViolation, validateContent } from './rules';

/** 表里的这几座沙盘里，先画好的地面的清单和定格图的清单都已经在 content/ 里的。key 是“人物/场景文件的名字”。 */
function madeButStillPending(keys: readonly string[]): string[] {
  const there = (path: string): boolean => {
    try {
      return fileSize(path) > 0;
    } catch {
      return false;
    }
  };
  return keys.filter((key) => {
    const [figure, name] = key.split('/');
    return there(`content/figures/${figure}/baked/${name}.json`) && there(`content/figures/${figure}/stills/${name}.json`);
  });
}
import type { ContentFiles } from './rules';
import { bakedPictureSize, checkBakedGround, TERRAIN_MAX_BYTES } from './sceneRules';
import type { FileSizes } from './shape';

const texts = import.meta.glob<string>('./fixtures/**/*.{json,md,geojson}', { query: '?raw', import: 'default', eager: true });
const paths = Object.keys(import.meta.glob('./fixtures/**/*'));
const fixture = (name: string): ContentFiles => toContentFiles(`./fixtures/${name}/`, paths, texts);

const GOOD = fixture('good');
const BAD = fixture('bad');

const FIGURE = 'figures/demo/figure.json';
const ROUTE = 'figures/demo/scenes/route.json';
const TERRAIN = 'figures/demo/scenes/route.terrain.bin';
const TODAY = 'figures/demo/scenes/route.today.geojson';
const STOP_SCENE = 'figures/demo/scenes/river.json';
const BAD_ROUTE = 'figures/broken/scenes/route.json';
const BAD_FIGURE = 'figures/broken/figure.json';
/** 合格样本里的全程沙盘没有带工具做的那两样：测试里把它写进“还没做出来”的表。 */
const PENDING = ['demo/route'];

const onDisk = (path: string): string => `tests/content/${path.slice(2)}`;
const SIZES = toFileSizes('./fixtures/good/', paths, (path) => fileSize(onDisk(path)));
const PICTURES = toPictureSizes('./fixtures/good/', paths, (path) => readBytes(onDisk(path)));
const KEYS = toFileKeys('./fixtures/good/', paths, (path) => readBytes(onDisk(path)));

/** 全部问题，每处写成“规则号 文件 › 字段”。不要求有工具做的那两样。 */
function all(files: ContentFiles, sizes: FileSizes = SIZES): string[] {
  return validateContent(files, sizes, {}, {}, false).map((v) => `${v.rule} ${v.file}${v.field === '' ? '' : ` › ${v.field}`}`);
}

/** 某一条规则在某个文件里查出来的地方，每处只写字段。 */
function fields(files: ContentFiles, rule: number, file: string): string[] {
  return validateContent(files, SIZES, {}, {}, false)
    .filter((v) => v.rule === rule && v.file === file)
    .map((v) => v.field);
}

function edit<T>(path: string, change: (data: T) => void, from: ContentFiles = GOOD): ContentFiles {
  const data = JSON.parse(from[path]) as T;
  change(data);
  return { ...from, [path]: JSON.stringify(data) };
}

/** 合格样本的全程沙盘改一处以后查出来的全部问题，写成“规则号 字段”；别的文件的问题写全。 */
function routeProblems(change: (scene: RouteScene) => void, sizes: FileSizes = SIZES): string[] {
  const prefix = `${ROUTE} › `;
  return all(edit<RouteScene>(ROUTE, change), sizes).map((line) => line.replace(prefix, '').replace(new RegExp(` ${ROUTE}$`), ' （整个文件）'));
}

/** 同上，改成类型不许的样子。 */
function looseProblems<T>(change: (scene: T) => void): string[] {
  const prefix = `${ROUTE} › `;
  return all(edit<T>(ROUTE, change)).map((line) => line.replace(prefix, ''));
}

/** 改“今天的海岸、湖、河”那个文件。 */
function todayProblems(change: (geo: { features: { properties: { kind: string; name: string }; geometry: { type: string; coordinates: unknown } }[] }) => void): string[] {
  const prefix = `${ROUTE} › `;
  return all(edit(TODAY, change)).map((line) => line.replace(prefix, ''));
}

const goodRoute = (): RouteScene => JSON.parse(GOOD[ROUTE]) as RouteScene;
const without = (path: string): ContentFiles => {
  const files = { ...GOOD };
  delete files[path];
  return files;
};

describe('两份样本', () => {
  it('合格的样本带着一座全程沙盘、它的地形文件和“今天的海岸、湖、河”，量了大小，一处问题也没有', () => {
    expect(isRouteLevel(JSON.parse(GOOD[ROUTE]))).toBe(true);
    expect(SIZES[TERRAIN]).toBe(288);
    expect(SIZES[TODAY]).toBe(fileSize('tests/content/fixtures/good/figures/demo/scenes/route.today.geojson'));
    expect(GOOD[TODAY]).toContain('FeatureCollection');
    expect(all(GOOD)).toEqual([]);
    // 不给大小，只凭有哪些文件，也一处没有（全程沙盘那两样还没做，写在表里）
    expect(validateContent(GOOD, {}, {}, {}, true, PENDING)).toEqual([]);
  });

  it('工具做的那两样：写在“还没做出来”的表里就不要求有；不在表里、又要求有，就各报一处', () => {
    expect(validateContent(GOOD, SIZES, PICTURES, KEYS, true, PENDING)).toEqual([]);
    const strict = validateContent(GOOD, SIZES, PICTURES, KEYS, true, []).map((v) => `${v.rule} ${v.file}`);
    expect(strict).toEqual(['17 figures/demo/baked/route.json', '18 figures/demo/stills/route.json']);
    // 表里写的是别的沙盘：不顶用
    expect(validateContent(GOOD, SIZES, PICTURES, KEYS, true, ['other/route', 'demo/river'])).toHaveLength(2);
    // 站点沙盘写进表里：它的那两样在，照旧一处问题也没有；拿走了也不报
    expect(validateContent(GOOD, SIZES, PICTURES, KEYS, true, [...PENDING, 'demo/river'])).toEqual([]);
    const noStills = without('figures/demo/stills/river.json');
    for (const path of Object.keys(noStills)) if (/\/stills\/river-/.test(path)) delete noStills[path];
    expect(validateContent(noStills, SIZES, PICTURES, KEYS, true, PENDING).map((v) => `${v.rule} ${v.file}`)).toEqual(['18 figures/demo/stills/river.json']);
    expect(validateContent(noStills, SIZES, PICTURES, KEYS, true, [...PENDING, 'demo/river'])).toEqual([]);
  });

  it('规则 16：卡片标了可以点进去的人物要有 scenes/route.json；没标的不要求', () => {
    expect(all(GOOD).filter((line) => line.startsWith('16 '))).toEqual([]);
    // 拿掉全程沙盘的场景文件：正好报这一处（地形文件和“今天的海岸、湖、河”还在，没有人读它们）
    expect(all(without(ROUTE))).toEqual(['16 figures/index.json › [0].available']);
    expect(formatViolation(validateContent(without(ROUTE), SIZES, {}, {}, false)[0])).toBe(
      '【规则 16 全程沙盘】content/figures/index.json › [0].available：“示例先生”标了可以点进去，但没有全程沙盘的场景文件 figures/demo/scenes/route.json',
    );
    // 第二张卡片没有标可以点进去，它什么文件也没有：不报
    expect(JSON.parse(GOOD['figures/index.json'])[1].available).toBe(false);
    // 连 figure.json 都没有的，只报格式的那一处，不再报这一处
    expect(validateContent(BAD).filter((v) => v.file === 'figures/index.json' && v.field === '[1].available').map((v) => v.rule)).toEqual([0]);
  });

  it('表平时是空的：发布出去的网站上每座沙盘那两样都得有', () => {
    // 做一座新沙盘的那几天里这张表里有它的名字；做完要拿掉。这一条在表不空的时候提醒一句，不算不通过。
    if (MADE_FILES_PENDING.length > 0) console.warn(`[内容校验] 这几座沙盘的先画好的地面和定格图还没有做：${MADE_FILES_PENDING.join('、')}`);
    for (const key of MADE_FILES_PENDING) expect(key).toMatch(/^[^/]+\/[^/]+$/);
  });

  it('表里的沙盘，那两样不能都已经做好了放在 content/ 里：都做好了就得把名字拿掉', () => {
    // 名字留在表里的话，“定格图旧不旧”那一项不再查它，做地面、拍定格图的两个工具也跳过它，校验又不报——改了镜头也没有东西会红。
    expect(madeButStillPending(['su-shi/route']), 'content/ 里苏轼的全程沙盘那两样都在：这一条才查得到东西').toEqual(['su-shi/route']);
    expect(madeButStillPending(['su-shi/no-such-table'])).toEqual([]);
    expect(madeButStillPending(MADE_FILES_PENDING), '这几座沙盘先画好的地面和定格图都已经在 content/ 里了，把它们从 tests/support/pendingTables.ts 的表里拿掉').toEqual([]);
  });

  it('出错的样本里，规则 10 到 15 和规则 20 在全程沙盘上都查出了问题；每一处都说得出是哪条规则、哪个字段', () => {
    const found = validateContent(BAD).filter((v) => v.file === BAD_ROUTE);
    for (const rule of [10, 11, 12, 13, 14, 15]) expect(found.some((v) => v.rule === rule), `规则 ${rule} ${RULE_NAMES[rule]}`).toBe(true);
    expect(found.some((v) => v.rule === 0)).toBe(false);
    for (const v of found) expect(formatViolation(v)).toMatch(/^【规则 1[0-5] .+】content\/figures\/broken\/scenes\/route\.json/);
    expect(fields(BAD, 20, BAD_FIGURE)).toEqual(['stops[1].place.lngLat', 'stops[2].place.lngLat']);
    expect(formatViolation(validateContent(BAD).find((v) => v.rule === 20)!)).toContain('【规则 20 站的位置】');
  });

  it('规则的名字：19 是随站的字体（不归内容校验查），20 是站的位置', () => {
    expect(RULE_NAMES[19]).toBe('随站的字体');
    expect(RULE_NAMES[20]).toBe('站的位置');
    // 后面还有两条：21 是夜（站点沙盘的，tests/content/sceneRules.test.ts），22 是行迹（tests/content/itineraryRules.test.ts）
    expect(RULE_NAMES).toHaveLength(23);
    expect(RULES_CHECKED_ELSEWHERE).toEqual([19]);
  });
});

describe('格式：全程沙盘和站点沙盘各有各的样子', () => {
  it('照站点沙盘的习惯写上的字段，在全程沙盘里通不过', () => {
    expect(looseProblems<{ things: unknown[] }>((s) => (s.things = []))).toEqual(['0 things']);
    expect(looseProblems<{ dressing: unknown[] }>((s) => (s.dressing = []))).toEqual(['0 dressing']);
    expect(looseProblems<{ water: Record<string, unknown> }>((s) => (s.water.banks = {}))).toEqual(['0 water.banks']);
    expect(looseProblems<{ water: Record<string, unknown> }>((s) => (s.water.rapids = []))).toEqual(['0 water.rapids']);
    expect(looseProblems<{ water: Record<string, unknown> }>((s) => (s.water.dry = []))).toEqual(['0 water.dry']);
    expect(looseProblems<{ places: Record<string, unknown>[] }>((s) => (s.places[0].when = { from: '全程' }))).toEqual(['0 places[0].when']);
    expect(looseProblems<{ sections: { camera: Record<string, unknown> }[] }>((s) => (s.sections[1].camera.targetUpM = 5))).toEqual(['0 sections[1].camera.targetUpM']);
    expect(looseProblems<{ sections: Record<string, unknown>[] }>((s) => (s.sections[0].sky = 'day'))).toEqual(['0 sections[0].sky']);
    expect(looseProblems<{ sections: Record<string, unknown>[] }>((s) => (s.sections[0].water = 'normal'))).toEqual(['0 sections[0].water']);
    expect(looseProblems<{ water: { rivers: Record<string, unknown>[] } }>((s) => (s.water.rivers[1].drawWidthM = 300))).toEqual(['0 water.rivers[1].drawWidthM']);
    expect(looseProblems<{ frame: { relief: Record<string, unknown> } }>((s) => (s.frame.relief.times = 6))).toEqual(['0 frame.relief.times']);
  });

  it('缺了字段、类型不对、坐标不对：说在哪', () => {
    expect(looseProblems<{ roads?: unknown }>((s) => delete s.roads)).toEqual(['0 roads']);
    expect(looseProblems<{ sources?: unknown }>((s) => delete s.sources)).toEqual(['0 sources']);
    expect(looseProblems<{ frame: { scale: unknown } }>((s) => (s.frame.scale = '171'))).toEqual(['0 frame.scale']);
    expect(looseProblems<{ frame: { scale: unknown } }>((s) => (s.frame.scale = 0))).toEqual(['0 frame.scale']);
    expect(looseProblems<{ roads: { ways: { by: string }[] } }>((s) => (s.roads.ways[0].by = 'air'))).toEqual(['0 roads.ways[0].by']);
    expect(looseProblems<{ water: { rivers: { weight: string }[] } }>((s) => (s.water.rivers[0].weight = 'huge'))).toEqual(['0 water.rivers[0].weight']);
    expect(looseProblems<{ terrain: { edits: { op: string }[] } }>((s) => (s.terrain.edits[0].op = 'level'))).toEqual(['0 terrain.edits[0].op']);
    expect(looseProblems<{ terrain: { recipe: { kind: string } } }>((s) => (s.terrain.recipe.kind = 'plain-and-hills'))).toEqual(['0 terrain.recipe.kind']);
    expect(looseProblems<{ roads: { ways: { line: unknown[] }[] } }>((s) => (s.roads.ways[0].line[1] = [30.5, 111]))).toEqual(['1 roads.ways[0].line[1]']);
    // 格式有问题的时候，别的规则先不查
    expect(looseProblems<{ stopId: string; roads?: unknown }>((s) => ((s.stopId = 'whole'), delete s.roads))).toEqual(['0 roads']);
  });

  it('两个数要比着看的两处：算山地的海拔比算平原的高；rippleM 是两个数，前小后大', () => {
    expect(routeProblems((s) => (s.terrain.recipe.hillAboveM = 100))).toEqual(['0 terrain.recipe.hillAboveM']);
    expect(looseProblems<{ terrain: { recipe: { rippleM: number[] } } }>((s) => (s.terrain.recipe.rippleM = [15]))).toEqual(['0 terrain.recipe.rippleM']);
    expect(routeProblems((s) => (s.terrain.recipe.rippleM = [40, 15]))).toEqual(['0 terrain.recipe.rippleM']);
  });

  it('站点沙盘里写全程沙盘的字段通不过；level 可以不写，写了只能是 stop', () => {
    const stop = (change: (scene: Record<string, unknown>) => void): string[] => all(edit<Record<string, unknown>>(STOP_SCENE, change)).map((line) => line.replace(`${STOP_SCENE} › `, ''));
    expect(stop((s) => (s.level = 'stop'))).toEqual([]);
    expect(stop((s) => (s.level = 'table'))).toEqual(['0 level']);
    expect(stop((s) => (s.roads = { ways: [], journeys: [] }))).toEqual(['0 roads']);
    expect(stop((s) => ((s.frame as Record<string, unknown>).scale = 171))).toEqual(['0 frame.scale']);
    expect(stop((s) => ((s.frame as Record<string, unknown>).projection = { kind: 'lambert-conic', lat1: 22, lat2: 35 }))).toEqual(['0 frame.projection']);
    expect(stop((s) => ((s.water as Record<string, unknown>).lakes = []))).toEqual(['0 water.lakes']);
    // 站点沙盘的文件里写了 "level": "route"：当全程沙盘查，头一样就是字段对不上
    const asRoute = stop((s) => (s.level = 'route'));
    expect(asRoute.length).toBeGreaterThan(5);
    expect(asRoute.every((line) => line.startsWith('0 '))).toBe(true);
    expect(checkRouteShape(JSON.parse(GOOD[STOP_SCENE]), STOP_SCENE).some((v) => v.field === 'level')).toBe(true);
  });
});

describe('规则 10 场景文件（全程沙盘）', () => {
  it('出错的样本', () => {
    expect(fields(BAD, 10, BAD_ROUTE)).toEqual(['stopId', 'credits', 'frame.scale', 'frame.relief.highTimes', 'terrain.file', 'terrain.heightUnit', 'water.todayFile']);
  });

  it('文件要叫 route.json，stopId 写 route', () => {
    const moved = without(ROUTE);
    moved['figures/demo/scenes/whole.json'] = GOOD[ROUTE];
    // 改了名字，route.json 就没有了：规则 16 的后半句也报一处
    expect(all(moved)).toEqual(['16 figures/index.json › [0].available', '10 figures/demo/scenes/whole.json']);
    expect(routeProblems((s) => ((s as { stopId: string }).stopId = 'river'))).toEqual(['10 stopId']);
  });

  it('样式、用了谁的数据', () => {
    expect(looseProblems<{ style: string }>((s) => (s.style = 'tang'))).toEqual(['10 style']);
    expect(routeProblems((s) => s.credits.pop())).toEqual(['10 credits']);
    expect(routeProblems((s) => (s.credits[1] = ' '))).toEqual(['10 credits[1]']);
  });

  it('投影、比例、山高', () => {
    expect(looseProblems<{ frame: { projection: { kind: string } } }>((s) => (s.frame.projection.kind = 'mercator'))).toEqual(['10 frame.projection.kind']);
    expect(routeProblems((s) => (s.frame.projection.lat2 = 27))).toEqual(['10 frame.projection.lat1']);
    expect(routeProblems((s) => (s.frame.projection.lat2 = 95))).toEqual(['10 frame.projection.lat1']);
    expect(routeProblems((s) => (s.frame.projection.lat1 = -31))).toEqual(['10 frame.projection.lat1']);
    expect(routeProblems((s) => (s.frame.scale = 49))).toEqual(['10 frame.scale']);
    expect(routeProblems((s) => (s.frame.scale = 1001))).toEqual(['10 frame.scale']);
    expect(routeProblems((s) => (s.frame.scale = 1000))).toEqual([]);
    expect(looseProblems<{ frame: { relief: { kind: string } } }>((s) => (s.frame.relief.kind = 'uniform'))).toEqual(['10 frame.relief.kind']);
    expect(routeProblems((s) => (s.frame.relief.lowBelowM = 0))).toEqual(['10 frame.relief.lowBelowM']);
    expect(routeProblems((s) => (s.frame.relief.lowTimes = 0.5))).toEqual(['10 frame.relief.lowTimes', '10 frame.relief.highTimes']);
    expect(routeProblems((s) => (s.frame.relief.power = 0))).toEqual(['10 frame.relief.power']);
    expect(routeProblems((s) => (s.frame.relief.power = 1.2))).toEqual(['10 frame.relief.power']);
    expect(routeProblems((s) => (s.frame.relief.highTimes = 8.35))).toEqual(['10 frame.relief.highTimes']);
    expect(routeProblems((s) => (s.frame.relief.highTimes = 26))).toEqual(['10 frame.relief.highTimes']);
    expect(routeProblems((s) => (s.frame.relief.highTimes = 25))).toEqual([]);
  });

  it('地形文件：叫 route.terrain.bin，存在，大小对得上，不超过 1.5 MB，一个数是 1 米', () => {
    expect(routeProblems((s) => (s.terrain.file = 'demo.terrain.bin'))).toEqual(['10 terrain.file']);
    expect(all(without(TERRAIN))).toEqual([`10 ${ROUTE} › terrain.file`]);
    expect(routeProblems((s) => (s.terrain.cols = 13))).toEqual(['10 terrain.file']);
    // 1024 列 × 769 行是 1,574,912 字节，比 1.5 MB 多 2,048 字节
    expect(1024 * 769 * 2).toBeGreaterThan(TERRAIN_MAX_BYTES);
    const huge = { ...SIZES, [TERRAIN]: 1024 * 769 * 2 };
    expect(routeProblems((s) => ((s.terrain.cols = 1024), (s.terrain.rows = 769)), huge)).toEqual(['10 terrain.file']);
    expect(routeProblems((s) => ((s.terrain.cols = 1024), (s.terrain.rows = 768)), { ...SIZES, [TERRAIN]: 1024 * 768 * 2 })).toEqual([]);
    expect(looseProblems<{ terrain: { heightUnit: string } }>((s) => (s.terrain.heightUnit = 'dm'))).toEqual(['10 terrain.heightUnit']);
  });

  it('地形文件要盖得住整块沙盘：四条边都算，不只看四个角', () => {
    const scene = goodRoute();
    const coords = routeCoords(scene.frame);
    const box = routeFrameBox(scene, coords);
    const corner = coords.toLngLat(coords.x0, coords.z0)[1];
    // 北边的正中比两个角更靠北
    expect(box.north).toBeGreaterThan(corner + 0.01);
    const between = (corner + box.north) / 2;
    expect(routeProblems((s) => (s.terrain.north = between))).toEqual(['10 terrain.north']);
    expect(routeProblems((s) => (s.terrain.north = box.north + 0.001))).toEqual([]);
    expect(routeProblems((s) => (s.terrain.west = 109.5))).toEqual(['10 terrain.west']);
    expect(routeProblems((s) => (s.terrain.east = 114.9))).toEqual(['10 terrain.east']);
    expect(routeProblems((s) => (s.terrain.south = 27.5))).toEqual(['10 terrain.south']);
    expect(routeProblems((s) => (s.terrain.west = 116))).toEqual(['10 terrain.west']);
    expect(routeProblems((s) => (s.terrain.south = 32))).toEqual(['10 terrain.south']);
  });

  it('苏轼全程沙盘的范围：沿四条边量出来的经纬度，和样张的程序算的一样', () => {
    const scene = goodRoute();
    scene.frame = { ...scene.frame, center: [112.25, 28.25], projection: { kind: 'lambert-conic', lat1: 22, lat2: 35 }, scale: 171, westM: 1_000_500, eastM: 1_000_500, northM: 1_131_000, southM: 1_131_000 };
    const box = routeFrameBox(scene, routeCoords(scene.frame));
    expect(box.west).toBeCloseTo(100.8996, 4);
    expect(box.east).toBeCloseTo(123.6004, 4);
    expect(box.south).toBeCloseTo(17.7229, 4);
    // 北边最靠北的是正中（38.4367 度）；每 50 公里取一个点，不一定正好取到正中，量出来最多矮万分之三度（三十米上下）
    expect(box.north).toBeGreaterThan(38.4367 - 0.0003);
    expect(box.north).toBeLessThanOrEqual(38.4367 + 0.00005);
    // 设计里定的地形文件（东经 100.86 到 123.62，北纬 17.70 到 38.46）盖得住
    expect(box.west).toBeGreaterThan(100.86);
    expect(box.east).toBeLessThan(123.62);
    expect(box.south).toBeGreaterThan(17.7);
    expect(box.north).toBeLessThan(38.46);
  });

  it('今天的海岸、湖、河：文件在同一个文件夹里，后缀是 .geojson，读得出来，不超过 300 KB', () => {
    expect(all(without(TODAY))).toEqual([`10 ${ROUTE} › water.todayFile`]);
    expect(routeProblems((s) => (s.water.todayFile = 'today.json'))).toEqual(['10 water.todayFile']);
    expect(routeProblems((s) => (s.water.todayFile = '../route.today.geojson'))).toEqual(['10 water.todayFile']);
    expect(all({ ...GOOD, [TODAY]: '{ 不是 JSON' })).toEqual([`10 ${ROUTE} › water.todayFile`]);
    expect(all({ ...GOOD, [TODAY]: '{"type":"Feature"}' })).toEqual([`10 ${ROUTE} › water.todayFile`]);
    expect(todayProblems((geo) => (geo.features[0].properties.kind = 'coast'))).toEqual(['10 water.todayFile']);
    expect(todayProblems((geo) => (geo.features[1].properties.name = ''))).toEqual(['10 water.todayFile']);
    expect(todayProblems((geo) => (geo.features[1].geometry.type = 'Polygon'))).toEqual(['10 water.todayFile']);
    expect(all(GOOD, { ...SIZES, [TODAY]: TODAY_MAX_BYTES + 1 })).toEqual([`10 ${ROUTE} › water.todayFile`]);
    expect(all(GOOD, { ...SIZES, [TODAY]: TODAY_MAX_BYTES })).toEqual([]);
  });

  it('每条取法里的每个名字都要在那个文件里找得到：河找河，湖找湖；写的范围里要取得到线', () => {
    expect(routeProblems((s) => (s.water.rivers[0].today![0].names = ['Long', 'Short']))).toEqual(['10 water.rivers[0].today[0].names[1]']);
    expect(routeProblems((s) => (s.water.lakes[0].today[0].names = ['Long']))).toEqual(['10 water.lakes[0].today[0].names[0]', '15 strips[5].at']);
    expect(routeProblems((s) => (s.water.rivers[0].today![0].names = ['Mirror Hu']))).toEqual(['10 water.rivers[0].today[0].names[0]']);
    expect(routeProblems((s) => (s.water.rivers[0].today![0].east = 109))).toEqual(['10 water.rivers[0].today[0]']);
    // 名字在文件里改了，场景里没跟着改
    expect(todayProblems((geo) => (geo.features[1].properties.name = 'Chang'))).toEqual(['10 water.rivers[0].today[0].names[0]']);
  });

  it('读“今天的海岸、湖、河”：线、面、几条取法合起来', () => {
    const today = readToday(GOOD, TODAY);
    if (!today || !('features' in today)) throw new Error('合格样本的 geojson 读不出来');
    expect(today.features.map((feature) => `${feature.kind} ${feature.name} ${feature.lines.length} ${feature.polygons.length}`)).toEqual(['land mainland 0 1', 'river Long 1 0', 'lake Mirror Hu 0 1']);
    expect(pickedLines(today.features, [{ names: ['Long'] }])[0]).toHaveLength(6);
    // 只取东经 114.4 度以西的点
    expect(pickedLines(today.features, [{ names: ['Long'], east: 114.4 }])[0]).toHaveLength(4);
    // 范围把线从中间切开：分成两条
    const cut = pickedLines(today.features, [{ names: ['Long'], east: 110.5 }, { names: ['Long'], west: 112 }]);
    expect(cut.map((line) => line.length)).toEqual([2, 3]);
    expect(readToday(GOOD, 'figures/demo/scenes/nothing.geojson')).toBeNull();
  });
});

describe('规则 11 范围（全程沙盘）', () => {
  it('出错的样本', () => {
    expect(fields(BAD, 11, BAD_ROUTE)).toEqual(['places[1].at', 'sections[1].camera.target', 'far[0].at']);
  });

  it('地名点、题签指的点、只染水色的水、从湖面里裁掉的圈、路、镜头对准的点，都要在沙盘里面', () => {
    const out: LngLat = [116.5, 29];
    expect(routeProblems((s) => (s.places[3].at = out))).toEqual(['11 places[3].at']);
    expect(routeProblems((s) => (s.strips[7].at = out))).toEqual(['11 strips[7].at']);
    expect(routeProblems((s) => (s.water.washes[0].areas[0][1] = out))).toEqual(['11 water.washes[0].areas[0][1]']);
    expect(routeProblems((s) => (s.water.lakes[0].except!.area[1] = out))).toEqual(['11 water.lakes[0].except.area[1]']);
    expect(routeProblems((s) => s.roads.ways[3].line.push(out))).toEqual(['11 roads.ways[3].line[3]']);
    expect(routeProblems((s) => (s.sections[2].camera.target = out))).toEqual(['11 sections[2].camera.target']);
  });

  it('抹成海的圈、留白的圈、河的线可以伸到外面；远处要在外面', () => {
    const out: LngLat = [116.5, 29];
    expect(routeProblems((s) => s.terrain.edits[0].area.splice(2, 0, out))).toEqual([]);
    expect(routeProblems((s) => s.terrain.recipe.blank[0].push([107, 27.4]))).toEqual([]);
    expect(routeProblems((s) => s.water.rivers[1].line!.push(out))).toEqual([]);
    expect(routeProblems((s) => (s.far[0].at = [112, 30.7]))).toEqual(['11 far[0].at']);
  });

  it('边是弯的：北边正中的里面一点算在里面，同一个纬度到了角上就在外面', () => {
    const scene = goodRoute();
    const coords = routeCoords(scene.frame);
    const midNorth = coords.toLngLat(0, coords.z0)[1];
    const inside: LngLat = [112, midNorth - 0.01];
    expect(routeProblems((s) => (s.places[3].at = inside))).toEqual([]);
    const [west] = coords.toLngLat(coords.x0, coords.z0);
    expect(routeProblems((s) => (s.places[3].at = [west + 0.05, midNorth - 0.01]))).toEqual(['11 places[3].at']);
  });
});

describe('规则 12 类别和依据（全程沙盘）', () => {
  it('出错的样本', () => {
    expect(fields(BAD, 12, BAD_ROUTE)).toEqual([
      'water.washes[0].class',
      'places[2].sourceIds[0]',
      'far[0].basis',
      'roads.journeys[0].parts[0].class',
      'terrain.recipe.note',
      'notDrawn[0].sourceIds[0]',
    ]);
  });

  it('类别是四类之一；全程沙盘上没有点缀', () => {
    expect(looseProblems<{ places: { class: string }[] }>((s) => (s.places[0].class = 'guess'))).toEqual(['12 places[0].class']);
    expect(routeProblems((s) => (s.places[3].class = 'dressing'))).toEqual(['12 places[3].class']);
    expect(routeProblems((s) => (s.water.coast.class = 'dressing'))).toEqual(['12 water.coast.class']);
  });

  it('只染水色的水、抹成海的地方、从湖面里裁掉的角，只能是示意的', () => {
    expect(routeProblems((s) => (s.water.washes[0].class = 'text'))).toEqual(['12 water.washes[0].class']);
    expect(routeProblems((s) => ((s.terrain.edits[0].class = 'today'), (s.terrain.edits[0].sourceIds = ['r2'])))).toEqual(['12 terrain.edits[0].class']);
    expect(routeProblems((s) => (s.water.lakes[0].except!.class = 'today'))).toEqual(['12 water.lakes[0].except.class']);
  });

  it('一趟路的每一截只能是按史料摆的（实线）或示意的（虚线）', () => {
    expect(routeProblems((s) => ((s.roads.journeys[1].parts[0].class = 'today'), (s.roads.journeys[1].parts[0].sourceIds = ['r2'])))).toEqual(['12 roads.journeys[1].parts[0].class']);
    expect(routeProblems((s) => ((s.roads.journeys[1].parts[0].class = 'text'), (s.roads.journeys[1].parts[0].sourceIds = ['r1'])))).toEqual([]);
  });

  it('依据写了；真的、今天的位置、按史料摆的，至少一个出处；出处都在这个文件自己的 sources 里', () => {
    expect(routeProblems((s) => (s.water.coast.basis = ' '))).toEqual(['12 water.coast.basis']);
    expect(routeProblems((s) => (s.roads.journeys[2].parts[0].basis = ''))).toEqual(['12 roads.journeys[2].parts[0].basis']);
    expect(routeProblems((s) => (s.terrain.sourceIds = []))).toEqual(['12 terrain.sourceIds']);
    expect(routeProblems((s) => (s.roads.journeys[0].parts[0].sourceIds = []))).toEqual(['12 roads.journeys[0].parts[0].sourceIds']);
    expect(routeProblems((s) => (s.water.lakes[0].sourceIds = ['s1']))).toEqual(['12 water.lakes[0].sourceIds[0]']);
    expect(routeProblems((s) => s.notDrawn[0].sourceIds.push('r3'))).toEqual(['12 notDrawn[0].sourceIds[1]']);
    // 示意的可以不写出处
    expect(routeProblems((s) => (s.water.rivers[1].sourceIds = []))).toEqual([]);
  });

  it('sources 自己：id 不重复，依据是三种之一，写了出处', () => {
    expect(routeProblems((s) => (s.sources[1].id = 'r1'))).toContain('12 sources[1].id');
    expect(looseProblems<{ sources: { basis: string }[] }>((s) => (s.sources[0].basis = 'editor'))).toEqual(['12 sources[0].basis']);
    expect(routeProblems((s) => (s.sources[0].cite = ''))).toEqual(['12 sources[0].cite']);
  });

  it('recipe 和 levels 必须写 note；unsure 的写法和站点沙盘一样', () => {
    expect(routeProblems((s) => delete s.terrain.recipe.note)).toEqual(['12 terrain.recipe.note', '14 sections[0].explain[0]']);
    expect(routeProblems((s) => (s.water.levels.note = ''))).toEqual(['12 water.levels.note', '14 sections[2].explain[1]']);
    expect(routeProblems((s) => (s.roads.journeys[2].parts[1].unsure = '在哪里上岸'))).toEqual(['12 roads.journeys[2].parts[1].unsure']);
    expect(routeProblems((s) => (s.places[0].unsure = '位置。'))).toEqual(['12 places[0].unsure']);
  });
});

describe('规则 13 零件（全程沙盘）', () => {
  it('出错的样本', () => {
    expect(fields(BAD, 13, BAD_ROUTE)).toEqual([
      'places[0].id',
      'notDrawn[0].name',
      'notDrawn[0].why',
      'water.rivers[0]',
      'water.rivers[1].weight',
      'places[2].stops[1]',
      'roads.ways[0].along',
      'roads.journeys[0].parts[0].ways[1]',
      'roads.journeys[1].date',
      'roads.journeys[1].stop',
      'roads.journeys[1].parts[0].name',
      'roads.journeys[1].parts[0].ways[0]',
      'roads.ways[2]',
      'roads.journeys',
      'roads.journeys',
    ]);
  });

  it('id 在整个文件里不重复，不用留用的词，不带“/”，路的 id 不以“-”开头', () => {
    expect(routeProblems((s) => (s.roads.ways[0].id = 'long'))).toContain('13 roads.ways[0].id');
    expect(routeProblems((s) => (s.water.lakes[0].except!.id = 'marsh'))).toContain('13 water.washes[0].id');
    for (const word of ['frame', 'terrain', 'recipe', 'levels', 'coast']) expect(routeProblems((s) => (s.places[3].id = word))).toContain('13 places[3].id');
    // banks 在全程沙盘里不是留用的词
    expect(routeProblems((s) => ((s.places[3].id = 'banks'), (s.strips[8].of = 'banks'), (s.sections[3].camera.mustShow![4] = 'banks')))).toEqual([]);
    expect(routeProblems((s) => (s.notDrawn[0].id = 'j-port/2'))).toContain('13 notDrawn[0].id');
    expect(routeProblems((s) => ((s.roads.ways[0].id = '-w-north'), (s.roads.journeys[0].parts[0].ways = ['-w-north'])))).toContain('13 roads.ways[0].id');
    expect(routeProblems((s) => (s.strips[0].id = ''))).toContain('13 strips[0].id');
  });

  it('名字都填了：一趟路的每一截也要有名字；没有画的东西要写为什么', () => {
    expect(routeProblems((s) => (s.water.lakes[0].except!.name = ''))).toEqual(['13 water.lakes[0].except.name']);
    expect(routeProblems((s) => (s.roads.journeys[2].name = ' '))).toEqual(['13 roads.journeys[2].name']);
    expect(routeProblems((s) => (s.roads.journeys[2].parts[1].name = ''))).toEqual(['13 roads.journeys[2].parts[1].name']);
    expect(routeProblems((s) => (s.water.coast.name = ''))).toEqual(['13 water.coast.name']);
    expect(routeProblems((s) => (s.notDrawn[0].why = ''))).toEqual(['13 notDrawn[0].why', '14 sections[3].explain[3]']);
  });

  it('河：line 和 today 正好写一个；河写 weight，运河不写', () => {
    expect(routeProblems((s) => (s.water.rivers[0].line = [[110, 30], [111.2, 30.2]]))).toEqual(['13 water.rivers[0]']);
    expect(routeProblems((s) => delete s.water.rivers[1].line)).toEqual(['13 water.rivers[1]']);
    expect(routeProblems((s) => (s.water.rivers[2].line = [[110, 30]]))).toEqual(['13 water.rivers[2].line']);
    expect(routeProblems((s) => delete s.water.rivers[1].weight)).toEqual(['13 water.rivers[1].weight']);
    expect(routeProblems((s) => (s.water.rivers[2].weight = 'minor'))).toEqual(['13 water.rivers[2].weight']);
    expect(routeProblems((s) => (s.water.rivers[0].today = []))).toEqual(['13 water.rivers[0].today']);
    expect(routeProblems((s) => (s.water.rivers[0].today![0].names = []))).toEqual(['13 water.rivers[0].today[0].names']);
    expect(routeProblems((s) => (s.water.rivers[0].today![0].west = 115))).toContain('13 water.rivers[0].today[0].west');
    expect(routeProblems((s) => ((s.water.lakes[0].today[0].south = 29), (s.water.lakes[0].today[0].north = 28)))).toEqual(['13 water.lakes[0].today[0].south']);
  });

  it('一圈线至少三个点，最后一点不重复第一点', () => {
    expect(routeProblems((s) => s.terrain.edits[0].area.splice(2))).toEqual(['13 terrain.edits[0].area']);
    expect(routeProblems((s) => s.terrain.recipe.blank[0].push([108.9, 27.2]))).toEqual(['13 terrain.recipe.blank[0]']);
    expect(routeProblems((s) => s.water.lakes[0].except!.area.pop())).toEqual(['13 water.lakes[0].except.area']);
    expect(routeProblems((s) => s.water.washes[0].areas[0].push([113.2, 29.9]))).toEqual(['13 water.washes[0].areas[0]']);
    expect(routeProblems((s) => (s.water.washes[0].areas = []))).toEqual(['13 water.washes[0].areas', '15 strips[6].at']);
  });

  it('路：至少两个点；along 指的是场景里的河或湖；每一截路都有哪一趟走到', () => {
    expect(routeProblems((s) => s.roads.ways[2].line.pop())).toEqual(['13 roads.ways[2].line']);
    expect(routeProblems((s) => (s.roads.ways[1].along = 'marsh'))).toEqual(['13 roads.ways[1].along']);
    expect(routeProblems((s) => (s.roads.ways[1].along = 'mirror'))).toEqual([]);
    expect(routeProblems((s) => s.roads.ways.push({ id: 'w-spare', by: 'sea', line: [[114.6, 28], [114.8, 28.2]] }))).toEqual(['13 roads.ways[4]']);
  });

  it('一趟路首尾相接：后一截的头接着前一截的尾，差不到 1 公里；倒着走的要加“-”', () => {
    // 倒着走的那一截去掉“-”：它从溪口到南山口，接不上后面从溪口出发的水路
    expect(routeProblems((s) => (s.roads.journeys[2].parts[0].ways = ['w-lake-pass']))).toEqual(['13 roads.journeys[2].parts[1].ways[0]']);
    // 挪开 5 公里：断了
    expect(routeProblems((s) => (s.roads.ways[3].line[0] = [112.05, 28.3]))).toEqual(['13 roads.journeys[2].parts[1].ways[0]']);
    // 挪开不到 1 公里：算接着
    expect(routeProblems((s) => (s.roads.ways[3].line[0] = [112.008, 28.3]))).toEqual([]);
    // 写的路找不到
    expect(routeProblems((s) => (s.roads.journeys[1].parts[0].ways = ['w-canal']))).toEqual(['13 roads.journeys[1].parts[0].ways[0]', '13 roads.ways[1]']);
    expect(routeProblems((s) => (s.roads.journeys[1].parts[0].ways = []))).toEqual(['13 roads.journeys[1].parts[0].ways', '13 roads.ways[1]']);
  });

  it('每一趟路到的站是 figure.json 里有的；每一站至少有一趟路；地名点的 stops 写的也是', () => {
    expect(routeProblems((s) => (s.roads.journeys[1].stop = 'nowhere'))).toEqual(['13 roads.journeys[1].stop', '13 roads.journeys']);
    expect(routeProblems((s) => (s.roads.journeys[1].stop = 'port'))).toEqual(['13 roads.journeys']);
    expect(routeProblems((s) => (s.roads.journeys[1].date = ''))).toEqual(['13 roads.journeys[1].date']);
    expect(routeProblems((s) => (s.roads.journeys[1].parts = []))).toEqual(['13 roads.journeys[1].parts', '13 roads.ways[1]', '14 sections[2].explain[0]']);
    expect(routeProblems((s) => s.places[3].stops = ['hill'])).toEqual(['13 places[3].stops[0]']);
    expect(routeProblems((s) => s.places[0].stops!.push('river'))).toEqual(['13 places[0].stops[1]']);
  });
});

describe('规则 14 小节（全程沙盘）', () => {
  it('出错的样本', () => {
    expect(fields(BAD, 14, BAD_ROUTE)).toEqual([
      'sections[0].stop',
      'sections[3].stop',
      'sections',
      'sections[0].explain[0]',
      'sections[0].explain[1]',
      'sections[0].camera.mustShow[1]',
      'sections[1].heading',
      'sections[1].date',
      'sections[1].line',
      'sections[1].explain[0]',
      'sections[2].explain',
      'sections[3].heading',
      'sections[3].line',
    ]);
  });

  it('头一节看全程，不写 stop；后面每一站正好一节，先后和 figure.json 里的站一样', () => {
    expect(routeProblems((s) => (s.sections[0].stop = 'river'))).toEqual(['14 sections[0].stop']);
    expect(routeProblems((s) => delete s.sections[2].stop)).toEqual(['14 sections[2]', '14 sections']);
    expect(routeProblems((s) => (s.sections[2].stop = 'bridge'))).toEqual(['14 sections[2].stop', '14 sections']);
    expect(routeProblems((s) => s.sections.pop())).toEqual(['14 sections']);
    expect(routeProblems((s) => s.sections.splice(1, 2, s.sections[2], s.sections[1]))).toEqual(['14 sections']);
    expect(routeProblems((s) => (s.sections[3].stop = 'pass'))).toEqual(['14 sections[3].stop', '14 sections']);
  });

  it('figure.json 里添了一站，场景没跟上：小节、路、地名点各报一处', () => {
    const files = edit<Figure>(FIGURE, (figure) => {
      figure.stops.push({ ...figure.stops[2], id: 'island', place: { ...figure.stops[2].place, id: 'island' } });
      figure.legs.push({ from: 'port', to: 'island', via: [] });
    });
    expect(all(files)).toEqual([`13 ${ROUTE} › roads.journeys`, `14 ${ROUTE} › sections`, `15 ${ROUTE} › places`]);
  });

  it('小节的名字不重复，最多七个字；有时间；题记不超过 40 个字', () => {
    expect(routeProblems((s) => (s.sections[2].heading = '到示例城'))).toEqual(['14 sections[2].heading']);
    expect(routeProblems((s) => (s.sections[2].heading = '到南山口的那条路'))).toEqual(['14 sections[2].heading']);
    expect(routeProblems((s) => (s.sections[2].heading = '到南山口的水路'))).toEqual([]);
    expect(routeProblems((s) => (s.sections[2].heading = ' '))).toEqual(['14 sections[2].heading']);
    expect(routeProblems((s) => (s.sections[2].date = ''))).toEqual(['14 sections[2].date']);
    expect(routeProblems((s) => (s.sections[2].line = ''))).toEqual(['14 sections[2].line']);
    expect(routeProblems((s) => (s.sections[2].line = '字'.repeat(41)))).toEqual(['14 sections[2].line']);
    expect(routeProblems((s) => (s.sections[2].line = '字'.repeat(40)))).toEqual([]);
  });

  it('题签指到远处的小节，题记连同远处的那句话不超过 50 个字宽；那句话从题签指的那一点量起', () => {
    const scene = goodRoute();
    const far = scene.far[0];
    const strip = scene.strips.find((item) => item.of === far.id)!;
    // 从路出沙盘的那一点到北都：往北 80 公里
    expect(routeFarWords(far, strip.at!)).toBe('北都：往北约 80 公里（今北都市）');
    // 校验量的就是页面印在沙盘旁边的那一句（sectionInfo 给的），不是另拼的；另算的一遍（greatCircle）和它对得上
    expect(sectionInfo(scene, scene.sections[1].heading).far).toEqual([{ id: far.id, name: far.name, say: '往北约 80 公里（今北都市）' }]);
    expect(Math.round(greatCircle(strip.at!, far.at).km)).toBe(80);
    // 这句话 16 个字宽（数字和空格算半个），前面还要空半个字：题记最多 33 个字
    expect(routeProblems((s) => (s.sections[1].line = '字'.repeat(34)))).toEqual(['14 sections[1].line']);
    expect(routeProblems((s) => (s.sections[1].line = '字'.repeat(33)))).toEqual([]);
    // 这一节不立那条题签，就只管 40 个字
    expect(routeProblems((s) => ((s.sections[1].line = '字'.repeat(40)), s.sections[1].strips.shift(), (s.sections[1].camera.mustShow = ['p-river'])))).toEqual([]);
  });

  it('苏轼全程沙盘上定州的那一句：从路进沙盘的那一点量，往北约 14 公里', () => {
    const from: LngLat = [114.946, 38.395];
    const dingzhou: LngLat = [115.0, 38.51];
    const { km, bearingDeg } = greatCircle(from, dingzhou);
    expect(km).toBeCloseTo(13.6, 1);
    expect(bearingDeg).toBeCloseTo(20, 0);
    expect(routeFarWords({ name: '定州', at: dingzhou, gloss: '今河北定州' }, from)).toBe('定州：往北约 14 公里（今河北定州）');
    // 100 公里以上取最近的 5 公里；没有括注就不带括号
    expect(routeFarWords({ name: '汴京', at: [114.35, 34.8] }, [117.185, 34.262])).toBe('汴京：往西约 265 公里');
  });

  it('explain 至少一样，写的 id 都找得到，点到的东西都有 note；可以点一趟路、从湖面里裁掉的角、coast', () => {
    expect(routeProblems((s) => (s.sections[1].explain = []))).toEqual(['14 sections[1].explain']);
    expect(routeProblems((s) => s.sections[1].explain.push('w-north'))).toEqual(['14 sections[1].explain[2]']);
    expect(routeProblems((s) => s.sections[1].explain.push('s-river'))).toEqual(['14 sections[1].explain[2]']);
    expect(routeProblems((s) => s.sections[1].explain.push('banks'))).toEqual(['14 sections[1].explain[2]']);
    expect(routeProblems((s) => s.sections[1].explain.push('long'))).toEqual(['14 sections[1].explain[2]']);
    expect(routeProblems((s) => delete s.water.coast.note)).toEqual(['14 sections[0].explain[1]']);
    expect(routeProblems((s) => delete s.water.lakes[0].except!.note)).toEqual(['14 sections[3].explain[1]']);
    // 一趟路：它的各截里至少一截写了 note 就行
    expect(routeProblems((s) => delete s.roads.journeys[2].parts[1].note)).toEqual(['14 sections[3].explain[0]']);
    expect(routeProblems((s) => ((s.roads.journeys[2].parts[0].note = '翻山的一段是照《行记》画的。'), delete s.roads.journeys[2].parts[1].note))).toEqual([]);
  });

  it('mustShow 可以写地名点、河、湖、只染水色的水、远处、一趟路，或者 frame', () => {
    expect(routeProblems((s) => s.sections[3].camera.mustShow!.push('w-stream'))).toEqual(['14 sections[3].camera.mustShow[5]']);
    expect(routeProblems((s) => s.sections[3].camera.mustShow!.push('mirror-sw'))).toEqual(['14 sections[3].camera.mustShow[5]']);
    expect(routeProblems((s) => s.sections[3].camera.mustShow!.push('coast'))).toEqual(['14 sections[3].camera.mustShow[5]']);
    expect(routeProblems((s) => s.sections[3].camera.mustShow!.push('frame', 'j-pass', 'long', 'far-north'))).toEqual([]);
  });
});

describe('规则 15 题签（全程沙盘）', () => {
  it('出错的样本', () => {
    // 头一条和最后一条的 at：它们指的“p-a”和一条河重了 id（规则 13 报了），被当成指着那条河，河要写 at
    expect(fields(BAD, 15, BAD_ROUTE)).toEqual([
      'strips[0].at',
      'strips[3].of',
      'strips[4].at',
      'strips[5].at',
      'strips[6].at',
      'strips[7].text',
      'strips[7].at',
      'sections[0].strips[2]',
      'sections[0].strips[3]',
      'sections[2].strips',
      'sections',
    ]);
  });

  it('题签上只能是汉字，一到七个；of 指的东西找得到', () => {
    expect(routeProblems((s) => (s.strips[0].text = '示例城1'))).toEqual(['15 strips[0].text']);
    expect(routeProblems((s) => (s.strips[0].modern = '示例市（今）'))).toEqual(['15 strips[0].modern']);
    expect(routeProblems((s) => (s.strips[8].of = 'p-hill'))).toEqual(['15 strips[8].of']);
    expect(routeProblems((s) => (s.strips[8].of = 'mirror-sw'))).toEqual(['15 strips[8].of']);
    expect(routeProblems((s) => (s.strips[8].of = 'j-port'))).toEqual(['15 strips[8].of']);
  });

  it(`指着河的要写 at，离河的线不超过 ${RIVER_STRIP_MAX_KM} 公里：自己写线的河照写的线量，照今天画的河照取到的线量`, () => {
    expect(routeProblems((s) => delete s.strips[4].at)).toEqual(['15 strips[4].at']);
    // 南溪在 [112.9, 28.0] 拐弯；往北挪 0.1 度约 11 公里
    expect(routeProblems((s) => (s.strips[4].at = [112.9, 28.1]))).toEqual(['15 strips[4].at']);
    expect(routeProblems((s) => (s.strips[4].at = [112.9, 28.04]))).toEqual([]);
    // 长河是照今天画的：线在 geojson 里
    expect(routeProblems((s) => (s.strips[3].at = [111.2, 30.3]))).toEqual(['15 strips[3].at']);
    expect(routeProblems((s) => (s.strips[3].at = [111.2, 30.24]))).toEqual([]);
    // 取法写了范围，范围外面的那一段不算：长河只取到东经 114.4 度
    expect(routeProblems((s) => (s.strips[3].at = [114.8, 29.5]))).toEqual(['15 strips[3].at']);
    expect(routeProblems((s) => (delete s.water.rivers[0].today![0].east, (s.strips[3].at = [114.8, 29.5])))).toEqual([]);
  });

  it('指着湖、只染水色的水的要写 at，落在它里面', () => {
    expect(routeProblems((s) => delete s.strips[5].at)).toEqual(['15 strips[5].at']);
    expect(routeProblems((s) => (s.strips[5].at = [113.0, 28.7]))).toEqual(['15 strips[5].at']);
    expect(routeProblems((s) => (s.strips[6].at = [113.7, 29.75]))).toEqual(['15 strips[6].at']);
  });

  it('指着海的要写 at，落在海里：今天的陆地外面，或者一处抹成海的圈里面', () => {
    expect(routeProblems((s) => delete s.strips[7].at)).toEqual(['15 strips[7].at']);
    expect(routeProblems((s) => (s.strips[7].at = [113.9, 28.3]))).toEqual(['15 strips[7].at']);
    // [114.35, 28.3] 在今天的陆地上，但在“东边的海岸”那一圈里面：算海
    expect(routeProblems((s) => (s.strips[7].at = [114.35, 28.3]))).toEqual([]);
    expect(routeProblems((s) => ((s.strips[7].at = [114.35, 28.3]), (s.terrain.edits = []), (s.sections[3].explain = ['j-port'])))).toEqual(['15 strips[7].at']);
  });

  it(`指着远处的要写 at（路出沙盘的那一点），离沙盘的边不超过 ${FAR_STRIP_MAX_KM} 公里`, () => {
    expect(routeProblems((s) => delete s.strips[9].at)).toEqual(['15 strips[9].at']);
    // 往南挪 0.1 度：离北边 13 公里
    expect(routeProblems((s) => ((s.strips[9].at = [112.0, 30.68]), (s.roads.ways[0].line[0] = [112.0, 30.68])))).toEqual(['15 strips[9].at']);
    expect(routeProblems((s) => ((s.strips[9].at = [112.0, 30.76]), (s.roads.ways[0].line[0] = [112.0, 30.76])))).toEqual([]);
  });

  it(`每节一到 ${ROUTE_STRIPS_MAX} 条，不重复，写的都是文件里有的`, () => {
    expect(routeProblems((s) => (s.sections[2].strips = []))).toEqual(['15 sections[2].strips', '15 sections']);
    expect(routeProblems((s) => s.sections[3].strips.push('s-pass'))).toEqual(['15 sections[3].strips[7]']);
    expect(routeProblems((s) => s.sections[3].strips.push('s-gone'))).toEqual(['15 sections[3].strips[7]']);
    const more = (n: number) => (s: RouteScene) => {
      for (let i = 0; i < n; i++) {
        s.strips.push({ id: `s-more-${i}`, text: '南岭', of: 'p-ridge' });
        s.sections[3].strips.push(`s-more-${i}`);
      }
    };
    // 这一节本来七条：再添五条是十二条，添六条就多了
    expect(routeProblems(more(5))).toEqual([]);
    expect(routeProblems(more(6))).toEqual(['15 sections[3].strips']);
  });

  it('每一站都有一个地名点是它，这个地名点的题签在头一节和它自己的那一节里都摆着', () => {
    expect(routeProblems((s) => delete s.places[1].stops)).toEqual(['15 places']);
    expect(routeProblems((s) => s.sections[0].strips.splice(1, 1))).toEqual(['15 sections']);
    expect(routeProblems((s) => s.sections[2].strips.pop())).toEqual(['15 sections']);
    // 一站有两个地名点（惠州和昌化军都是第八站）：有一个的题签两处都在就行
    expect(routeProblems((s) => (s.places[3].stops = ['port']))).toEqual([]);
    expect(routeProblems((s) => ((s.places[3].stops = ['port']), s.sections[0].strips.splice(2, 1, 's-ridge')))).toEqual([]);
    expect(routeProblems((s) => ((s.places[3].stops = ['port']), s.sections[0].strips.splice(2, 1)))).toEqual(['15 sections']);
  });
});

describe('规则 20 站的位置', () => {
  const moved = (dLng: number, dLat: number): string[] =>
    all(
      edit<Figure>(FIGURE, (figure) => {
        const [lng, lat] = figure.stops[1].place.lngLat;
        figure.stops[1].place.lngLat = [lng + dLng, lat + dLat];
      }),
    );

  it(`figure.json 里一站的位置，和全程沙盘上这一站的地名点，经度、纬度各差不到 ${STOP_PLACE_MAX_DEG} 度`, () => {
    expect(moved(0.03, 0)).toEqual([`20 ${FIGURE} › stops[1].place.lngLat`]);
    expect(moved(0, -0.021)).toEqual([`20 ${FIGURE} › stops[1].place.lngLat`]);
    expect(moved(0.02, -0.02)).toEqual([]);
    expect(moved(0.019, 0.019)).toEqual([]);
    // 眉州原来差的就是这么多：纬度 0.036 度（约 4 公里）
    expect(moved(0, 0.036)).toHaveLength(1);
  });

  it('改的是沙盘上的地名点，也一样查得出来；说的是哪一站、差了多少', () => {
    const files = edit<RouteScene>(ROUTE, (s) => (s.places[2].at = [114.25, 27.9]));
    const found = validateContent(files, SIZES, {}, {}, false);
    expect(found.map((v) => `${v.rule} ${v.file} › ${v.field}`)).toEqual([`20 ${FIGURE} › stops[2].place.lngLat`]);
    expect(found[0].problem).toContain('“海边”这一站写在 [114.2, 27.9]');
    expect(found[0].problem).toContain('“p-port”在 [114.25, 27.9]，差了 0.050 度');
  });

  it('一站有两个地名点：离哪一个近算哪一个', () => {
    expect(routeProblems((s) => (s.places[3].stops = ['port']))).toEqual([]);
    expect(routeProblems((s) => ((s.places[3].stops = ['port']), (s.places[2].at = [114.0, 27.5]), (s.strips[2].of = 'p-ridge'), (s.strips[8].of = 'p-port'), (s.roads.ways[3].line[2] = [114.0, 27.5])))).toEqual([
      `20 ${FIGURE} › stops[2].place.lngLat`,
    ]);
  });

  it('没有全程沙盘的人物没有可比的；站的位置自己写错了归规则 1', () => {
    // 规则 20 没有可比的，不报；报的是规则 16 的后半句（可以点进去的人物要有全程沙盘）
    expect(all(without(ROUTE))).toEqual(['16 figures/index.json › [0].available']);
    const swapped = all(edit<Figure>(FIGURE, (figure) => (figure.stops[0].place.lngLat = [30, 110])));
    expect(swapped).toEqual([`1 ${FIGURE} › stops[0].place.lngLat`]);
  });
});

describe('规则 2：站的 id 不能叫 route', () => {
  it('route 是全程沙盘的文件名', () => {
    const files = edit<Figure>(FIGURE, (figure) => {
      figure.stops[1].id = 'route';
      figure.legs[0].to = 'route';
      figure.legs[1].from = 'route';
    });
    const found = all(files).filter((line) => line.startsWith('2 '));
    expect(found).toEqual([`2 ${FIGURE} › stops[1].id`]);
  });
});

describe('规则 17 在全程沙盘上：先画好的图一格三个点', () => {
  it('图片该多大：站点沙盘一格两个点，全程沙盘三个', () => {
    const route = goodRoute();
    // 600 × 400 公里，比例 60：沙盘 10,000 × 6,667 米，网格 501 × 334
    expect(bakedPictureSize(route)).toEqual({ width: 500 * 3 + 1, height: 333 * 3 + 1 });
    const real = { ...route, frame: { ...route.frame, center: [112.25, 28.25] as LngLat, projection: { kind: 'lambert-conic' as const, lat1: 22, lat2: 35 }, scale: 171, westM: 1_000_500, eastM: 1_000_500, northM: 1_131_000, southM: 1_131_000 } };
    // 苏轼的全程沙盘：网格 586 × 662，图片 1756 × 1984
    expect(bakedPictureSize(real)).toEqual({ width: 1756, height: 1984 });
    const stop = JSON.parse(GOOD[STOP_SCENE]) as StopScene;
    expect(bakedPictureSize(stop)).toEqual({ width: 301, height: 241 });
    expect(bakedPictureSize({ ...stop, level: 'stop' })).toEqual({ width: 301, height: 241 });
  });

  it('清单里写的大小要和它一样：照站点沙盘的算法写的（一格两个点）通不过', () => {
    const route = goodRoute();
    const manifest = (width: number, height: number): BakedGroundManifest => ({
      tool: 1,
      inputs: { ground: '0000000000000000', terrain: '1111111111111111' },
      pixels: { colour: '2222222222222222', fields: '3333333333333333' },
      colour: { file: 'route.colour.jpg', width, height, bytes: 1000, key: '4444444444444444', quality: 0.9, psnr: 41 },
      fields: { file: 'route.fields.png', width, height, bytes: 500, key: '5555555555555555' },
    });
    const withBaked = (width: number, height: number): ContentFiles => ({
      ...GOOD,
      'figures/demo/baked/route.json': JSON.stringify(manifest(width, height)),
      'figures/demo/baked/route.colour.jpg': '',
      'figures/demo/baked/route.fields.png': '',
    });
    const check = (width: number, height: number) => checkBakedGround(route, 'figures/demo', withBaked(width, height), {}, true).map((v) => `${v.rule} ${v.field}`);
    expect(check(1501, 1000)).toEqual([]);
    expect(check(1001, 667)).toEqual(['17 colour.width', '17 fields.width']);
    expect(check(1501, 999)).toEqual(['17 colour.height', '17 fields.height']);
    // 走总的入口也一样：全程沙盘的场景合格，就接着查它先画好的地面
    const found = validateContent(withBaked(1001, 667), SIZES, {}, {}, false).map((v) => `${v.rule} ${v.file} › ${v.field}`);
    expect(found).toEqual(['17 figures/demo/baked/route.json › colour.width', '17 figures/demo/baked/route.json › fields.width']);
  });

  it('颜色那张图的清晰度：全程沙盘另有一个下限（36 分贝），不是站点沙盘的 40', () => {
    const route = goodRoute();
    const withPsnr = (psnr: number): ContentFiles => ({
      ...GOOD,
      'figures/demo/baked/route.json': JSON.stringify({
        tool: 1,
        inputs: { ground: '0000000000000000', terrain: '1111111111111111' },
        pixels: { colour: '2222222222222222', fields: '3333333333333333' },
        colour: { file: 'route.colour.jpg', width: 1501, height: 1000, bytes: 1000, key: '4444444444444444', quality: 0.9, psnr },
        fields: { file: 'route.fields.png', width: 1501, height: 1000, bytes: 500, key: '5555555555555555' },
      } satisfies BakedGroundManifest),
      'figures/demo/baked/route.colour.jpg': '',
      'figures/demo/baked/route.fields.png': '',
    });
    const check = (psnr: number) => checkBakedGround(route, 'figures/demo', withPsnr(psnr), {}, true).map((v) => `${v.rule} ${v.field}：${v.problem}`);
    expect(check(37.05)).toEqual([]);
    expect(check(36)).toEqual([]);
    expect(check(35.99)).toEqual(['17 colour.psnr：颜色那张图压得太狠：清晰度（psnr）是 35.99，不能低于 36；用高一点的质量重新做']);
  });
});

describe('这两样还没做出来的沙盘（tests/support/pendingTables.ts）', () => {
  it('工具跳过表里的沙盘，带着 INCLUDE_PENDING=1 才做', () => {
    const keys = ['su-shi/route', 'su-shi/xuzhou'];
    expect(tablesToMake(keys, false, ['su-shi/route'])).toEqual({ make: ['su-shi/xuzhou'], skipped: ['su-shi/route'] });
    expect(tablesToMake(keys, true, ['su-shi/route'])).toEqual({ make: keys, skipped: [] });
    expect(tablesToMake(keys, false, [])).toEqual({ make: keys, skipped: [] });
    // 不写第三个参数用的是那张表
    expect(tablesToMake(keys, false)).toEqual({ make: keys.filter((key) => !MADE_FILES_PENDING.includes(key)), skipped: keys.filter((key) => MADE_FILES_PENDING.includes(key)) });
    expect(isPending('su-shi/route', ['su-shi/route'])).toBe(true);
    expect(isPending('su-shi/xuzhou', ['su-shi/route'])).toBe(false);
  });

  it('INCLUDE_PENDING 只认 1', () => {
    expect(includePendingFrom({ INCLUDE_PENDING: '1' })).toBe(true);
    expect(includePendingFrom({ INCLUDE_PENDING: '0' })).toBe(false);
    expect(includePendingFrom({ INCLUDE_PENDING: 'true' })).toBe(false);
    expect(includePendingFrom({})).toBe(false);
  });
});

describe('数据规格里全程沙盘的那个最小的例子', () => {
  it('自己合乎格式和规则 10 到 15（配上它说的地形文件、一份有大江的“今天的海岸、湖、河”和两站的人物资料）', () => {
    const spec = new TextDecoder().decode(readBytes('docs/data-spec.md'));
    const section = spec.slice(spec.indexOf('\n## 全程沙盘的场景数据\n'));
    const found = /### 一个最小的例子[\s\S]*?```json\n([\s\S]*?)\n```/.exec(section);
    if (!found) throw new Error('数据规格的“全程沙盘的场景数据”一节里没有找到那个例子');
    const scene = JSON.parse(found[1]) as RouteScene;
    expect(checkRouteShape(scene, 'figures/sample/scenes/route.json')).toEqual([]);

    const stop = (id: string, lngLat: LngLat) => ({ ...(JSON.parse(GOOD[FIGURE]) as Figure).stops[1], id, place: { id, ancient: id, modern: id, lngLat } });
    const figure: Figure = { ...(JSON.parse(GOOD[FIGURE]) as Figure), id: 'sample', stops: [stop('mizhou', [119.4, 36.0]), stop('xuzhou', [117.185, 34.262])], legs: [{ from: 'mizhou', to: 'xuzhou', via: [] }] };
    const today = {
      type: 'FeatureCollection',
      features: [{ type: 'Feature', properties: { kind: 'river', name: 'Chang Jiang' }, geometry: { type: 'LineString', coordinates: [[116.0, 29.8], [117.5, 30.8], [118.8, 32.1]] } }, { type: 'Feature', properties: { kind: 'river', name: 'Yangtze' }, geometry: { type: 'LineString', coordinates: [[118.8, 32.1], [121.0, 31.8]] } }],
    };
    const files: ContentFiles = {
      'figures/index.json': JSON.stringify([{ ...(JSON.parse(GOOD['figures/index.json']) as unknown[])[0] as object, id: 'sample' }]),
      'figures/sample/figure.json': JSON.stringify(figure),
      'figures/sample/scenes/route.json': JSON.stringify(scene),
      'figures/sample/scenes/route.terrain.bin': '',
      'figures/sample/scenes/route.today.geojson': JSON.stringify(today),
    };
    const sizes = { 'figures/sample/scenes/route.terrain.bin': 570 * 520 * 2 };
    expect(validateContent(files, sizes, {}, {}, false).map((v) => formatViolation(v))).toEqual([]);
    // 例子里的地形文件是设计里定的那一份：570 × 520，592,800 字节
    expect(scene.terrain.cols * scene.terrain.rows * 2).toBe(592_800);
  });
});
