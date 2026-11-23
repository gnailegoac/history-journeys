// 场景数据的校验规则：docs/data-spec.md 的规则 10 到 18，加上场景文件的“格式”（比别的文件查得严：不认识的字段通不过）。
// 规则 10 到 15 查手写的场景文件，规则 17、18 查工具做出来的文件（先画好的地面、每一小节的定格图）。规则 16（可以点进去的人物要有全程沙盘）在 rules.ts。
// 全是纯函数：输入是读进内存的场景和它那一站的几样东西，输出是不合规格的地方。不读磁盘，也不依赖测试框架。
//
// 零件认哪些参数、位置怎么写、能摆在什么上面，都照 src/domain/sceneKinds.ts 里的几张表查，这里不另写一份；
// 经纬度换成米只用 src/domain/sceneGeo.ts；一样东西某一节有没有，用的是程序自己用的 existsAt；
// 大小的上限都在 budgetRules.ts，这里只管照着它查、把话说清楚。

import type { BakedGroundManifest } from '../../src/domain/bakedGround';
import { SCENE_CLASSES, SCENE_CLASS_LABEL, SCENE_RESERVED_IDS, SCENE_SKIES, SCENE_STYLES } from '../../src/domain/scene';
import type { DressingKind, DressingWhere, Grounds, ParamType, Params, SceneClass, SceneDressing, SceneThing, StopScene, TableScene, ThingKind, When } from '../../src/domain/scene';
import { farEdgePoint, frameCoords } from '../../src/domain/sceneGeo';
import { coordsOf } from '../../src/domain/sceneGeoRoute';
import { DRESSING_KINDS, DRESSING_PARAMS, DRESSING_WHERE, THING_HOSTS, THING_KINDS, THING_PARAMS, THING_PLACING } from '../../src/domain/sceneKinds';
import type { FrameCoords } from '../../src/domain/sceneGeo';
import { existsAt, sectionInfo } from '../../src/domain/sceneText';
import type { StillManifest, StillShape } from '../../src/domain/stills';
import type { LngLat } from '../../src/domain/types';
import { gridOf } from '../../src/stage/ground/grid';
import { COLOUR_PSNR_MIN, COLOUR_PSNR_MIN_ROUTE, PICTURE_EDGE_MAX, STILL_MAX_BYTES, TABLE_FILES_MAX_BYTES, edgeTooLong, kilobytes, megabytes, psnrTooLow, stillTooBig, tableFiles } from './budgetRules';
import { anything, bool, checkShape, has, list, lngLat, number, numberIn, object, oneOf, optional, readJson, record, strict, tagged, text, union, violation } from './shape';
import type { ContentFiles, FileSizes, Shape, Violation } from './shape';

/**
 * 地形文件最大多少字节（规则 10）：1.5 MB。和“一座沙盘的文件合计”（规则 17）是同一个数：
 * 地形文件自己不能超过它，连同先画好的两张图加起来也不能超过它。
 */
export const TERRAIN_MAX_BYTES = TABLE_FILES_MAX_BYTES;
// 一张定格图最大多少字节（规则 18）：300 KB。这个数写在 budgetRules.ts（各处共用一份），这里照旧给出来。
export { STILL_MAX_BYTES };
/** 题记最多多少个字（规则 14）。 */
export const LINE_MAX = 40;
/**
 * 题签指到远处的小节，题记连同后面远处的那句话，最多多少个字宽（规则 14）；汉字算一个，数字、字母、空格算半个。
 * 沙盘栏窄的时候这两样接在一起排，只给两行：360 像素宽的手机上两行放得下 52 个字宽，留两个字的余量。
 */
export const WORDS_MAX = 50;
/** 题签的 at 离它指的那样东西最远多少米（规则 15）。 */
export const STRIP_AT_MAX_M = 300;
/** 一节最多摆几条题签（规则 15）。 */
export const STRIPS_MAX = 6;

/** 场景文件对着的那一站：校验场景要用到的几样。 */
export interface SceneStop {
  /** 文件名里的站 id（scenes/<站>.json）。 */
  id: string;
  /** figure.json 里这一站标的状态；figure.json 里没有这一站时不写。 */
  status?: 'complete' | 'outline';
  /** 正文的小节标题，按先后；正文不在或读不出来时为 null（规则 4 另报）。 */
  headings: string[] | null;
  /** 这一站 sources 里的 id；.json 不在或读不出来时为 null（格式和规则 3 另报）。 */
  sourceIds: string[] | null;
}

// ---------------------------------------------------------------- 格式

const positive = numberIn({ above: 0 });
const notNegative = numberIn({ min: 0 });
const degrees = numberIn({ min: 0, max: 360 });
const count = numberIn({ above: 0, whole: true });

/** 类别和依据的那一组字段。class 是不是五类之一、basis 是不是空的，归规则 12 查。 */
export const GROUNDS = { class: text, basis: text, sourceIds: list(text), unsure: optional(text), note: optional(text) };

/** 山高怎么夸大。别的 kind 这里放过去，由规则 10 说“站点沙盘只有统一夸大一种”。 */
const RELIEF = union((fields) => (fields.kind === 'uniform' ? strict({ kind: text, times: positive }) : object({ kind: text })));

/** 什么时候有：{ from, until } 或 { only }，两种不能混着写。标题对不对、是不是空的，归规则 14 查。 */
const WHEN = union((fields) => {
  if (!Object.hasOwn(fields, 'only')) return strict({ from: optional(text), until: optional(text) });
  if (Object.hasOwn(fields, 'from') || Object.hasOwn(fields, 'until')) return { field: '', problem: 'only 不能和 from、until 一起写：要么写从哪一节到哪一节，要么写只在哪几节' };
  return strict({ only: list(text) });
});

const EDIT = tagged('op', {
  level: strict({ ...GROUNDS, id: text, name: text, op: text, area: optional(list(lngLat)), inside: optional(text), mode: oneOf(['set', 'raise', 'lower']), toM: number, featherM: notNegative }),
  mound: strict({ ...GROUNDS, id: text, name: text, op: text, at: lngLat, addM: positive, innerM: notNegative, outerM: positive }),
});

const CAMERA = strict({
  target: lngLat,
  targetUpM: optional(notNegative),
  distanceM: positive,
  pitch: numberIn({ min: 0, max: 85 }),
  bearing: degrees,
  fov: optional(numberIn({ min: 10, max: 40 })),
  closest: optional(numberIn({ min: 0.5, max: 1 })),
  mustShow: optional(list(text)),
});

/** 场景文件的样子。零件和点缀的 kind、参数另由规则 13 对着表查，这里只看是不是文字、是不是一组字段。 */
const SCENE: Shape = strict({
  // 站点沙盘可以不写 level；写了只能是 stop（写 route 的是全程沙盘，rules.ts 把它交给 routeRules.ts，到不了这里）
  level: optional(oneOf(['stop'])),
  stopId: text,
  style: text,
  credits: list(text),
  frame: strict({ center: lngLat, westM: positive, eastM: positive, northM: positive, southM: positive, datumM: number, relief: RELIEF }),
  terrain: strict({
    ...GROUNDS,
    file: text,
    cols: count,
    rows: count,
    west: number,
    east: number,
    south: number,
    north: number,
    recipe: strict({
      ...GROUNDS,
      kind: oneOf(['plain-and-hills']),
      plainBelowM: number,
      hillAboveM: number,
      plainBaseM: number,
      plainKeep: numberIn({ min: 0, max: 1 }),
      edgeTaperM: notNegative,
    }),
    edits: list(EDIT),
  }),
  water: strict({
    levels: strict({ ...GROUNDS, values: record(number) }),
    banks: strict({ ...GROUNDS, bankM: number, bedM: positive, keepOffWallsM: notNegative }),
    rivers: list(strict({ ...GROUNDS, id: text, name: text, kind: oneOf(['river', 'moat']), line: list(lngLat), drawWidthM: positive, crossings: optional(list(lngLat)) })),
    rapids: list(strict({ ...GROUNDS, id: text, name: text, river: text, at: lngLat, lengthM: positive })),
    dry: list(strict({ ...GROUNDS, id: text, name: text, area: list(lngLat) })),
  }),
  places: list(strict({ ...GROUNDS, id: text, name: text, at: lngLat })),
  things: list(
    strict({ ...GROUNDS, id: text, name: text, kind: text, at: optional(lngLat), line: optional(list(lngLat)), facing: optional(degrees), on: optional(text), params: optional(record(anything)), when: optional(WHEN) }),
  ),
  dressing: list(
    strict({
      ...GROUNDS,
      id: text,
      name: text,
      kind: text,
      inside: optional(text),
      area: optional(list(lngLat)),
      line: optional(list(lngLat)),
      at: optional(lngLat),
      params: optional(record(anything)),
      when: optional(WHEN),
    }),
  ),
  strips: list(strict({ id: text, text, modern: optional(text), of: text, at: optional(lngLat), side: optional(oneOf(['above', 'below', 'left', 'right'])) })),
  far: list(strict({ ...GROUNDS, id: text, name: text, at: lngLat, gloss: optional(text) })),
  sections: list(strict({ heading: text, date: text, line: text, camera: CAMERA, water: text, sky: optional(oneOf(SCENE_SKIES)), moon: optional(strict({ azimuth: number, altitude: number })), strips: list(text), explain: list(text) })),
  notDrawn: list(strict({ id: text, name: text, why: text, sourceIds: list(text) })),
});

/**
 * 场景文件的格式：字段齐全、类型对、没有不认识的字段、数字在说得通的范围里；坐标不对的算在规则 1 上。
 * 这里有问题时，这个文件的规则 10 到 15 先不查。
 */
export function checkSceneShape(data: unknown, file: string): Violation[] {
  return checkShape(data, SCENE, file);
}

/** 格式通过以后，一个场景文件的规则 10 到 15，外加两处要拿两个数比着看的格式。 */
export function checkScene(scene: StopScene, file: string, stop: SceneStop, files: ContentFiles, sizes: FileSizes = {}): Violation[] {
  return [
    ...checkSceneNumbers(scene, file),
    ...checkSceneFile(scene, file, stop, files, sizes),
    ...checkSceneExtent(scene, file),
    ...checkSceneGrounds(scene, file, stop.sourceIds),
    ...checkSceneParts(scene, file),
    ...checkSceneSections(scene, file, stop.headings),
    ...checkSceneStrips(scene, file),
    ...checkSceneNight(scene, file),
  ];
}

/** 夜里的月亮最低、最高可以写多少度：再低，影子长得没有边；再高，就在头顶上了。 */
export const MOON_ALTITUDE = [5, 85] as const;

/**
 * 规则 21 夜：sky 是 night 的小节必须写 moon，azimuth 在 0 到 360 之间，altitude 在 5 到 85 之间；
 * sky 不是 night 的小节不能写 moon。
 */
export function checkSceneNight(scene: StopScene, file: string): Violation[] {
  const out: Violation[] = [];
  const bad = (field: string, problem: string) => out.push(violation(21, file, field, problem));
  const [low, high] = MOON_ALTITUDE;
  scene.sections.forEach((section, i) => {
    const moon = section.moon;
    if (section.sky !== 'night') {
      if (moon) bad(`sections[${i}].moon`, `小节“${section.heading}”不是夜里（sky 没有写 night），不能写月亮在哪`);
      return;
    }
    if (!moon) {
      bad(`sections[${i}].moon`, `小节“${section.heading}”是夜里，要写月亮在哪个方向、离地平线多高（moon 的 azimuth 和 altitude）`);
      return;
    }
    if (!(moon.azimuth >= 0 && moon.azimuth <= 360)) bad(`sections[${i}].moon.azimuth`, `月亮的方向要在 0 到 360 度之间（0 是正北，顺时针），现在是 ${moon.azimuth}`);
    if (!(moon.altitude >= low && moon.altitude <= high)) bad(`sections[${i}].moon.altitude`, `月亮离地平线的高度要在 ${low} 到 ${high} 度之间，现在是 ${moon.altitude}`);
  });
  return out;
}

/** 格式里要拿两个数比着看的两处：算山的海拔要比算平地的高，土丘的外圈要比内圈大。 */
export function checkSceneNumbers(scene: StopScene, file: string): Violation[] {
  const out: Violation[] = [];
  const recipe = scene.terrain.recipe;
  if (recipe.hillAboveM <= recipe.plainBelowM) {
    out.push(violation(0, file, 'terrain.recipe.hillAboveM', `算山的海拔（${recipe.hillAboveM}）要比算平地的海拔（plainBelowM，${recipe.plainBelowM}）高，两个数之间才有地方过渡`));
  }
  scene.terrain.edits.forEach((edit, i) => {
    if (edit.op === 'mound' && edit.outerM <= edit.innerM) {
      out.push(violation(0, file, `terrain.edits[${i}].outerM`, `土丘“${edit.id}”的外圈（${edit.outerM} 米）要比内圈（innerM，${edit.innerM} 米）大`));
    }
  });
  return out;
}

// ---------------------------------------------------------------- 规则 10 场景文件

/**
 * 规则 10 场景文件：文件名和 stopId 一样；这一站在 figure.json 里有，而且是 complete；style 是程序里有的样式；
 * credits 至少一条；relief 是统一夸大；地形文件存在，大小正好是 行 × 列 × 2 字节，不超过 1.5 MB；地形文件盖得住整块沙盘。
 */
export function checkSceneFile(scene: StopScene, file: string, stop: SceneStop, files: ContentFiles, sizes: FileSizes = {}): Violation[] {
  const out: Violation[] = [];
  const bad = (field: string, problem: string) => out.push(violation(10, file, field, problem));

  if (scene.stopId !== stop.id) bad('stopId', `应该和文件名一样（${stop.id}），现在是“${scene.stopId}”`);
  if (stop.status === undefined) bad('', `figure.json 里没有 id 是“${stop.id}”的站，这个场景文件对不上任何一站`);
  else if (stop.status !== 'complete') bad('', `“${stop.id}”这一站在 figure.json 里标的还是 outline；正文写好、标成 complete 以后才能有沙盘`);

  if (!(SCENE_STYLES as readonly string[]).includes(scene.style)) bad('style', `样式“${scene.style}”程序里没有；有的是：${SCENE_STYLES.join('、')}`);

  if (scene.credits.length === 0) bad('credits', '至少要写一条：地形用了谁的高程数据，借了谁的河道线');
  scene.credits.forEach((credit, i) => {
    if (credit.trim() === '') bad(`credits[${i}]`, '这一条是空的');
  });

  const reliefKind: string = scene.frame.relief.kind;
  if (reliefKind !== 'uniform') bad('frame.relief.kind', `站点沙盘的山高只有统一夸大一种写法（kind 写 uniform），现在是“${reliefKind}”`);

  const terrain = scene.terrain;
  const expectedName = `${stop.id}.terrain.bin`;
  const path = `${file.slice(0, file.lastIndexOf('/') + 1)}${terrain.file}`;
  if (terrain.file !== expectedName) {
    bad('terrain.file', `地形文件应该叫 ${expectedName}，和场景文件放在一起，现在写的是“${terrain.file}”`);
  } else if (!has(files, path)) {
    bad('terrain.file', `地形文件 scenes/${terrain.file} 不存在`);
  } else if (sizes[path] !== undefined) {
    const size = sizes[path];
    const expected = terrain.rows * terrain.cols * 2;
    if (size !== expected) bad('terrain.file', `地形文件有 ${size} 字节；按 ${terrain.rows} 行 × ${terrain.cols} 列、每个数 2 字节算，应该正好是 ${expected} 字节`);
    if (size > TERRAIN_MAX_BYTES) bad('terrain.file', `地形文件有 ${megabytes(size)}，不能超过 1.5 MB`);
  }

  if (terrain.west >= terrain.east) bad('terrain.west', `west（${terrain.west}）应该比 east（${terrain.east}）小`);
  else if (terrain.south >= terrain.north) bad('terrain.south', `south（${terrain.south}）应该比 north（${terrain.north}）小`);
  else {
    const edges = frameEdges(frameCoords(scene.frame));
    if (edges.west < terrain.west) bad('terrain.west', `地形文件盖不住沙盘的西边：沙盘到经度 ${degreesText(edges.west)}，地形文件从 ${terrain.west} 才开始`);
    if (edges.east > terrain.east) bad('terrain.east', `地形文件盖不住沙盘的东边：沙盘到经度 ${degreesText(edges.east)}，地形文件只到 ${terrain.east}`);
    if (edges.south < terrain.south) bad('terrain.south', `地形文件盖不住沙盘的南边：沙盘到纬度 ${degreesText(edges.south)}，地形文件从 ${terrain.south} 才开始`);
    if (edges.north > terrain.north) bad('terrain.north', `地形文件盖不住沙盘的北边：沙盘到纬度 ${degreesText(edges.north)}，地形文件只到 ${terrain.north}`);
  }
  return out;
}

/** 沙盘四条边的经纬度。 */
function frameEdges(coords: FrameCoords): { west: number; east: number; south: number; north: number } {
  const [west, north] = coords.toLngLat(coords.x0, coords.z0);
  const [east, south] = coords.toLngLat(coords.x1, coords.z1);
  return { west, east, south, north };
}

const degreesText = (value: number): string => value.toFixed(4);
const inward = (value: number, round: (n: number) => number): string => (round(value * 1e4) / 1e4).toFixed(4);

// ---------------------------------------------------------------- 规则 11 范围

/**
 * 规则 11 范围：摆件、点缀、地名点、题签指的点、修整的范围和土丘的中心、水漫不进去的地方、急滩、河上过路的地方、
 * 镜头对准的点，都在沙盘里面（压在边上也算）。河的线和路的线可以伸出去。远处的地点在沙盘外面。
 */
export function checkSceneExtent(scene: StopScene, file: string): Violation[] {
  const out: Violation[] = [];
  const coords = frameCoords(scene.frame);
  const edges = frameEdges(coords);
  // 报出来的范围往里收到小数点后四位：照着这四个数写的点一定在沙盘里面（四舍五入的话可能差出去几米）。
  const range = `经度 ${inward(edges.west, Math.ceil)} 到 ${inward(edges.east, Math.floor)}、纬度 ${inward(edges.south, Math.ceil)} 到 ${inward(edges.north, Math.floor)}`;
  const point = (p: LngLat | undefined, field: string, what: string) => {
    if (p && !coords.inside(p)) out.push(violation(11, file, field, `${what}在沙盘外面；沙盘的范围是${range}`));
  };
  const points = (line: LngLat[] | undefined, field: string, what: string) => line?.forEach((p, j) => point(p, `${field}[${j}]`, `${what}的第 ${j + 1} 个点`));

  scene.terrain.edits.forEach((edit, i) => {
    if (edit.op === 'level') points(edit.area, `terrain.edits[${i}].area`, `修整“${edit.id}”的范围`);
    else point(edit.at, `terrain.edits[${i}].at`, `土丘“${edit.id}”的中心`);
  });
  scene.water.rivers.forEach((river, i) => points(river.crossings, `water.rivers[${i}].crossings`, `“${river.id}”上过路的地方`));
  scene.water.rapids.forEach((rapids, i) => point(rapids.at, `water.rapids[${i}].at`, `急滩“${rapids.id}”`));
  scene.water.dry.forEach((dry, i) => points(dry.area, `water.dry[${i}].area`, `水漫不进去的地方“${dry.id}”`));
  scene.places.forEach((place, i) => point(place.at, `places[${i}].at`, `地名点“${place.id}”`));
  scene.things.forEach((thing, i) => {
    point(thing.at, `things[${i}].at`, `摆件“${thing.id}”`);
    points(thing.line, `things[${i}].line`, `摆件“${thing.id}”`);
  });
  scene.dressing.forEach((rule, i) => {
    point(rule.at, `dressing[${i}].at`, `点缀“${rule.id}”`);
    points(rule.area, `dressing[${i}].area`, `点缀“${rule.id}”的范围`);
    // 路的线可以伸到沙盘外面；别的点缀沿着的线不行。
    if (rule.kind !== 'roads') points(rule.line, `dressing[${i}].line`, `点缀“${rule.id}”沿着的线`);
  });
  scene.strips.forEach((strip, i) => point(strip.at, `strips[${i}].at`, `题签“${strip.id}”指的点`));
  scene.sections.forEach((section, i) => point(section.camera.target, `sections[${i}].camera.target`, `小节“${section.heading}”的镜头对准的点`));
  scene.far.forEach((far, i) => {
    if (coords.inside(far.at)) out.push(violation(11, file, `far[${i}].at`, `远处“${far.id}”在沙盘里面；远处写的是沙盘外面的地方，里面的地方登记成地名点或摆件`));
  });
  return out;
}

// ---------------------------------------------------------------- 规则 12 类别和依据

export const CLASS_LIST = SCENE_CLASSES.map((cls) => `${cls}（${SCENE_CLASS_LABEL[cls]}）`).join('、');
export const NEEDS_SOURCE: readonly string[] = ['real', 'today', 'text'] satisfies SceneClass[];
const DRESSING_CLASSES: readonly string[] = ['dressing', 'text'] satisfies SceneClass[];

/** 场景里带类别和依据的全部东西：在文件的哪里，是什么。 */
function grounded(scene: StopScene): { path: string; what: string; grounds: Grounds }[] {
  const { terrain, water } = scene;
  const each = <T extends Grounds & { id: string }>(items: T[], path: string, kind: string) =>
    items.map((item, i) => ({ path: `${path}[${i}]`, what: `${kind}“${item.id}”`, grounds: item }));
  return [
    { path: 'terrain', what: '地形', grounds: terrain },
    { path: 'terrain.recipe', what: '地形的整理', grounds: terrain.recipe },
    ...each(terrain.edits, 'terrain.edits', '修整'),
    { path: 'water.levels', what: '水位', grounds: water.levels },
    { path: 'water.banks', what: '河岸的规矩', grounds: water.banks },
    ...each(water.rivers, 'water.rivers', '河'),
    ...each(water.rapids, 'water.rapids', '急滩'),
    ...each(water.dry, 'water.dry', '水漫不进去的地方'),
    ...each(scene.places, 'places', '地名点'),
    ...each(scene.things, 'things', '摆件'),
    ...each(scene.dressing, 'dressing', '点缀'),
    ...each(scene.far, 'far', '远处'),
  ];
}

/**
 * 规则 12 类别和依据：class 是五类之一；basis 写了；真的、今天的位置、按正文摆的，至少有一个出处；
 * 出处都在这一站的 sources 里；点缀规则的类别只能是点缀或按正文摆的；recipe 和 levels 写了 note；
 * unsure 写成能接在“某某的”后面的一个词组（见 unsureProblem）。
 * knownSources 是这一站 sources 的 id；这一站的 .json 读不出来时给 null，出处在不在就先不查。
 */
export function checkSceneGrounds(scene: StopScene, file: string, knownSources: string[] | null): Violation[] {
  const out: Violation[] = [];
  const sources = (ids: string[], path: string, what: string) => {
    if (!knownSources) return;
    ids.forEach((id, j) => {
      if (!knownSources.includes(id)) out.push(violation(12, file, `${path}.sourceIds[${j}]`, `${what}的出处“${id}”在这一站的 sources 里找不到`));
    });
  };

  for (const { path, what, grounds } of grounded(scene)) {
    const cls: string = grounds.class;
    const known = (SCENE_CLASSES as readonly string[]).includes(cls);
    if (!known) out.push(violation(12, file, `${path}.class`, `${what}的类别是“${cls}”，只能是 ${CLASS_LIST}之一`));
    if (grounds.basis.trim() === '') out.push(violation(12, file, `${path}.basis`, `${what}没有写依据：为什么这样摆，一两句话`));
    if (NEEDS_SOURCE.includes(cls) && grounds.sourceIds.length === 0) {
      out.push(violation(12, file, `${path}.sourceIds`, `${what}的类别是“${SCENE_CLASS_LABEL[cls as SceneClass]}”，至少要填一个出处`));
    }
    sources(grounds.sourceIds, path, what);
    if (known && path.startsWith('dressing[') && !DRESSING_CLASSES.includes(cls)) {
      out.push(violation(12, file, `${path}.class`, `${what}是点缀规则，类别只能是 dressing（点缀）或 text（按正文摆的），现在是“${cls}”`));
    }
    const unsure = grounds.unsure === undefined ? null : unsureProblem(grounds.unsure);
    if (unsure) out.push(violation(12, file, `${path}.unsure`, `${what}的 unsure ${unsure}`));
  }
  if (!scene.terrain.recipe.note?.trim()) out.push(violation(12, file, 'terrain.recipe.note', '地形的整理必须写 note：每一节的说明里都有这一句'));
  if (!scene.water.levels.note?.trim()) out.push(violation(12, file, 'water.levels.note', '水位必须写 note：沙盘旁边给读者看的一句话'));
  scene.notDrawn.forEach((omission, i) => sources(omission.sourceIds, `notDrawn[${i}]`, `没有画的“${omission.id}”`));
  return out;
}

/** unsure 开头是这些字，多半是一句话，不是一个词组：“在哪一点”“搭在哪一段”“山比平地高多少”。 */
const UNSURE_BAD_START = /^(在|搭|系|从|到|山比)/;
/** unsure 后面要接“是示意”，自己不带收尾的标点。 */
const UNSURE_BAD_END = /[。，、；：！？,.;:!?]$/;

/**
 * unsure 哪里不对；没问题时返回 null。
 * 页面把它拼成“某某的〈unsure〉是示意”，所以它要是能接在“的”后面的一个词组，如“位置”“层数和高矮”
 * “位置（在南墙的哪一点）”，不能是“在南墙的哪一点”“搭在哪一段城墙”这样的半句话。
 */
export function unsureProblem(unsure: string): string | null {
  const written = unsure.trim();
  if (written === '') return null;
  if (UNSURE_BAD_START.test(written)) {
    return `是“${written}”，接在“某某的”后面读不通；写成一个词组，比如“位置（${written}）”`;
  }
  if (UNSURE_BAD_END.test(written)) return `是“${written}”，末尾不要带标点：它后面要接“是示意”`;
  return null;
}

// ---------------------------------------------------------------- 带 id 的东西

type IdKind = 'edit' | 'river' | 'rapids' | 'dry' | 'place' | 'thing' | 'dressing' | 'strip' | 'far' | 'notDrawn';

/** 一样带 id 的东西：是哪一种，在文件的哪里，叫什么（题签没有名字），旁边要说的那句话（没有画的东西是它的 why）。 */
interface IdEntry {
  kind: IdKind;
  path: string;
  id: string;
  name?: string;
  note?: string;
}

/** 场景文件里所有带 id 的东西，按写的先后。 */
function idEntries(scene: StopScene): IdEntry[] {
  const each = <T extends { id: string; name?: string }>(items: T[], kind: IdKind, path: string, note: (item: T) => string | undefined) =>
    items.map((item, i): IdEntry => ({ kind, path: `${path}[${i}]`, id: item.id, name: item.name, note: note(item) }));
  const ofGrounds = (item: Grounds) => item.note;
  return [
    ...each(scene.terrain.edits, 'edit', 'terrain.edits', ofGrounds),
    ...each(scene.water.rivers, 'river', 'water.rivers', ofGrounds),
    ...each(scene.water.rapids, 'rapids', 'water.rapids', ofGrounds),
    ...each(scene.water.dry, 'dry', 'water.dry', ofGrounds),
    ...each(scene.places, 'place', 'places', ofGrounds),
    ...each(scene.things, 'thing', 'things', ofGrounds),
    ...each(scene.dressing, 'dressing', 'dressing', ofGrounds),
    ...each(scene.strips, 'strip', 'strips', () => undefined),
    ...each(scene.far, 'far', 'far', ofGrounds),
    ...each(scene.notDrawn, 'notDrawn', 'notDrawn', (item) => item.why),
  ];
}

/** 题签的 of、镜头的 mustShow 可以指的东西：沙盘上有个地方的那几种。 */
const POINTABLE: readonly IdKind[] = ['thing', 'dressing', 'place', 'river', 'rapids', 'far'];
const POINTABLE_TEXT = '摆件、点缀、地名点、河、急滩、远处';

// ---------------------------------------------------------------- 规则 13 零件

/**
 * 规则 13 零件：id 在整个文件里不重复，也没有用那五个留用的词；带名字的东西名字都填了，没有画的东西填了为什么；
 * 摆件和点缀的 kind 是零件库里有的；
 * 参数都在这种零件的参数表里，类型对；位置按这种零件的写法写了；城门写了 on；on 指的东西存在、种类对，
 * 并且在这样东西有的小节里都有；点缀的位置最多写一种，是这种点缀可以用的写法；
 * 修整的 area 和 inside 正好写一个，inside 指的是一道城墙；急滩最多一处，它的 river 是文件里有的河。
 */
export function checkSceneParts(scene: StopScene, file: string): Violation[] {
  const out: Violation[] = [];
  const bad = (field: string, problem: string) => out.push(violation(13, file, field, problem));
  const headings = scene.sections.map((section) => section.heading);
  const wallProblem = (id: string): string | null => {
    const wall = scene.things.find((thing) => thing.id === id);
    if (!wall) return `场景里没有 id 是“${id}”的摆件`;
    return wall.kind === 'wall' ? null : `“${id}”不是城墙（它的 kind 是 ${wall.kind}）`;
  };

  // id
  const entries = idEntries(scene);
  entries.forEach((entry, i) => {
    const first = entries.findIndex((other) => other.id === entry.id);
    if (entry.id.trim() === '') bad(`${entry.path}.id`, '没有填 id');
    else if ((SCENE_RESERVED_IDS as readonly string[]).includes(entry.id)) bad(`${entry.path}.id`, `“${entry.id}”这个词另有用处，不能当 id（留用的词：${SCENE_RESERVED_IDS.join('、')}）`);
    else if (first < i) bad(`${entry.path}.id`, `id“${entry.id}”和 ${entries[first].path} 重复了；带 id 的东西，id 在整个场景文件里不能重复`);
    // 名字印在沙盘旁边的说明和凭据里：空着的话，读者看到的是“的……是示意”和一行空白。
    if (entry.name !== undefined && entry.name.trim() === '') bad(`${entry.path}.name`, `“${entry.id}”没有填名字：说明和凭据里要用它`);
    if (entry.kind === 'notDrawn' && !entry.note?.trim()) bad(`${entry.path}.why`, `没有画的“${entry.id}”没有写为什么不画：凭据里要印这一句`);
  });

  // 修整
  scene.terrain.edits.forEach((edit, i) => {
    if (edit.op !== 'level') return;
    const at = `terrain.edits[${i}]`;
    if (edit.area !== undefined && edit.inside !== undefined) bad(at, `修整“${edit.id}”的 area 和 inside 都写了，只能写一个`);
    else if (edit.area === undefined && edit.inside === undefined) bad(at, `修整“${edit.id}”没有写在哪一块：area（一圈闭合的线）和 inside（一道城墙的 id）要写一个`);
    if (edit.area !== undefined) ring(edit.area, `${at}.area`, `修整“${edit.id}”的范围`);
    if (edit.inside !== undefined) {
      const problem = wallProblem(edit.inside);
      if (problem) bad(`${at}.inside`, `修整“${edit.id}”的 inside 要写一道城墙的 id；${problem}`);
    }
  });

  // 水
  scene.water.rivers.forEach((river, i) => {
    if (river.line.length < 2) bad(`water.rivers[${i}].line`, `“${river.id}”的中线至少要有两个点`);
  });
  if (scene.water.rapids.length > 1) bad('water.rapids', `现在一座沙盘最多写一处急滩，这里写了 ${scene.water.rapids.length} 处`);
  scene.water.rapids.forEach((rapids, i) => {
    if (!scene.water.rivers.some((river) => river.id === rapids.river)) bad(`water.rapids[${i}].river`, `急滩“${rapids.id}”写的河“${rapids.river}”在 water.rivers 里找不到`);
  });
  scene.water.dry.forEach((dry, i) => ring(dry.area, `water.dry[${i}].area`, `水漫不进去的地方“${dry.id}”`));

  // 摆件
  scene.things.forEach((thing, i) => {
    const at = `things[${i}]`;
    const what = `摆件“${thing.id}”`;
    if (!isThingKind(thing.kind)) {
      bad(`${at}.kind`, `${what}的 kind 是“${String(thing.kind)}”，零件库里没有这一种；有的是：${THING_KINDS.join('、')}`);
      return;
    }
    params(thing.params, THING_PARAMS[thing.kind], `${at}.params`, `${thing.kind} 这种零件`);

    const placing = THING_PLACING[thing.kind];
    if (placing === 'point') {
      if (thing.at === undefined) bad(`${at}.at`, `${what}是 ${thing.kind}，位置是一个点，要写 at`);
      if (thing.line !== undefined) bad(`${at}.line`, `${what}是 ${thing.kind}，位置是一个点，只写 at，不写 line`);
    } else {
      if (thing.at !== undefined) bad(`${at}.at`, `${what}是 ${thing.kind}，位置是一${placing === 'ring' ? '圈' : '条'}线，只写 line，不写 at`);
      if (thing.line === undefined) bad(`${at}.line`, `${what}是 ${thing.kind}，位置是一${placing === 'ring' ? '圈闭合的' : '条'}线，要写 line`);
      else if (placing === 'ring') ring(thing.line, `${at}.line`, what);
      else if (thing.line.length < 2) bad(`${at}.line`, `${what}的线至少要有两个点`);
    }

    const hosts = THING_HOSTS[thing.kind];
    if (thing.on === undefined) {
      if (thing.kind === 'gate') bad(`${at}.on`, `${what}是城门，必须写 on：它开在哪一道城墙上`);
      return;
    }
    if (hosts.length === 0) {
      bad(`${at}.on`, `${what}是 ${thing.kind}，只能摆在地上，不能写 on`);
      return;
    }
    const host = scene.things.find((other) => other.id === thing.on);
    if (!host) bad(`${at}.on`, `${what}写的 on 是“${thing.on}”，场景里没有 id 是它的摆件`);
    else if (!(hosts as readonly string[]).includes(host.kind)) bad(`${at}.on`, `${what}是 ${thing.kind}，只能摆在 ${hosts.join('、')} 上，“${thing.on}”是 ${host.kind}`);
    else {
      const alone = headings.find((heading) => existsAt(thing.when, heading, headings) && !existsAt(host.when, heading, headings));
      if (alone !== undefined) bad(`${at}.on`, `小节“${alone}”里有${what}，却没有它摆在上面的“${thing.on}”；两样东西的 when 要对得上`);
    }
  });

  // 点缀
  scene.dressing.forEach((rule, i) => {
    const at = `dressing[${i}]`;
    const what = `点缀“${rule.id}”`;
    if (!isDressingKind(rule.kind)) {
      bad(`${at}.kind`, `${what}的 kind 是“${String(rule.kind)}”，没有这种点缀；有的是：${DRESSING_KINDS.join('、')}`);
      return;
    }
    params(rule.params, DRESSING_PARAMS[rule.kind], `${at}.params`, `${rule.kind} 这种点缀`);

    const written = (['inside', 'area', 'line', 'at'] as const).filter((key) => rule[key] !== undefined);
    const allowed = DRESSING_WHERE[rule.kind];
    if (written.length > 1) {
      bad(at, `${what}的位置写了 ${written.join('、')} ${written.length} 种，最多写一种`);
      return;
    }
    const where: DressingWhere = written.length === 0 ? 'all' : written[0];
    if (!allowed.includes(where)) {
      const can = allowed.map((way) => WHERE_TEXT[way]).join('，或');
      if (where === 'all') bad(at, `${what}是 ${rule.kind}，不能摆满整块沙盘；位置要写${can}`);
      else bad(`${at}.${where}`, `${what}是 ${rule.kind}，位置不能用 ${where} 这种写法；可以写${can}`);
    }
    if (rule.inside !== undefined) {
      const problem = wallProblem(rule.inside);
      if (problem) bad(`${at}.inside`, `${what}的 inside 要写一道城墙的 id；${problem}`);
    }
    if (rule.area !== undefined) ring(rule.area, `${at}.area`, `${what}的范围`);
    if (rule.line !== undefined && rule.line.length < 2) bad(`${at}.line`, `${what}沿着的线至少要有两个点`);
  });
  return out;

  /** 一圈闭合的线：至少三个点，最后一点不重复第一点。 */
  function ring(points: LngLat[], field: string, what: string): void {
    if (points.length < 3) bad(field, `${what}是一圈闭合的线，至少要有三个点，现在是 ${points.length} 个`);
    else if (samePoint(points[0], points[points.length - 1])) bad(field, `${what}的最后一点和第一点一样；闭合的线不用把第一点再写一遍，去掉最后这一点`);
  }

  /** 参数对着这种零件的参数表查：名字在表里，类型对。 */
  function params(written: Params | undefined, table: Record<string, ParamType>, field: string, kind: string): void {
    for (const [name, value] of Object.entries(written ?? {})) {
      if (!Object.hasOwn(table, name)) {
        const names = Object.keys(table);
        bad(`${field}.${name}`, `${kind}没有“${name}”这个参数；${names.length > 0 ? `可以写的是：${names.join('、')}` : '它没有参数'}`);
        continue;
      }
      const type = table[name];
      if (type === 'number') {
        if (typeof value !== 'number' || !Number.isFinite(value)) bad(`${field}.${name}`, '应该是一个数');
      } else if (type === 'boolean') {
        if (typeof value !== 'boolean') bad(`${field}.${name}`, '应该是 true 或 false');
      } else if (typeof value !== 'string' || !type.includes(value)) {
        bad(`${field}.${name}`, `只能是 ${type.join(' 或 ')}`);
      }
    }
  }
}

/** 一句话有多少个字宽：汉字和全角的标点算一个，数字、字母、空格算半个。 */
export function textWidth(text: string): number {
  let width = 0;
  for (const char of text) width += char.charCodeAt(0) < 0x2e80 ? 0.5 : 1;
  return width;
}

const WHERE_TEXT: Record<DressingWhere, string> = {
  inside: ' inside（一道城墙里面）',
  area: ' area（一块地方）',
  line: ' line（沿一条线）',
  at: ' at（一个点周围）',
  all: '都不写（整块沙盘）',
};

function isThingKind(kind: string): kind is ThingKind {
  return (THING_KINDS as readonly string[]).includes(kind);
}

function isDressingKind(kind: string): kind is DressingKind {
  return (DRESSING_KINDS as readonly string[]).includes(kind);
}

export function samePoint(a: LngLat, b: LngLat): boolean {
  return a[0] === b[0] && a[1] === b[1];
}

// ---------------------------------------------------------------- 规则 14 小节

/**
 * 规则 14 小节：场景的小节和正文的小节一一对上，顺序相同；每节有时间、题记（不超过 40 个字）、镜头、水位；
 * 题签指到远处的小节，题记连同远处的那句话不超过 50 个字宽；
 * 水位的名字在 levels.values 里有，values 里有 normal；when 里写的小节标题都是正文里有的，from 不晚于 until，
 * when 不是空的，城墙、路、田不写 when；explain 至少一样，写的 id 都找得到，点到的东西都有 note；mustShow 写的 id 都找得到。
 * textHeadings 是正文的小节标题；正文读不出来时给 null，对正文的那几处就先不查。
 */
export function checkSceneSections(scene: StopScene, file: string, textHeadings: string[] | null): Violation[] {
  const out: Violation[] = [];
  const bad = (field: string, problem: string) => out.push(violation(14, file, field, problem));
  const own = scene.sections.map((section) => section.heading);
  const entries = idEntries(scene);
  const levels = scene.water.levels.values;

  // 和正文对上
  const repeated = own.some((heading, i) => own.indexOf(heading) < i);
  own.forEach((heading, i) => {
    if (own.indexOf(heading) < i) bad(`sections[${i}].heading`, `小节“${heading}”在场景里写了不止一次`);
  });
  if (textHeadings) {
    const missing = textHeadings.filter((heading) => !own.includes(heading));
    const extra = own.filter((heading) => !textHeadings.includes(heading));
    for (const heading of missing) bad('sections', `正文的小节“${heading}”在场景里没有；场景的小节要和正文的小节一一对上`);
    own.forEach((heading, i) => {
      if (!textHeadings.includes(heading)) bad(`sections[${i}].heading`, `正文里没有“${heading}”这个小节标题`);
    });
    if (missing.length === 0 && extra.length === 0 && !repeated && own.join('\n') !== textHeadings.join('\n')) {
      bad('sections', `小节的先后和正文不一样；正文是：${textHeadings.join('、')}`);
    }
  }

  // 水位
  if (!Object.hasOwn(levels, 'normal')) bad('water.levels.values', '必须有 normal（平时的水位）');

  // 每一节
  scene.sections.forEach((section, i) => {
    const at = `sections[${i}]`;
    if (section.date.trim() === '') bad(`${at}.date`, `小节“${section.heading}”没有写时间`);
    const length = [...section.line.trim()].length;
    if (length === 0) bad(`${at}.line`, `小节“${section.heading}”没有写题记`);
    else if (length > LINE_MAX) bad(`${at}.line`, `小节“${section.heading}”的题记有 ${length} 个字，不能超过 ${LINE_MAX} 个`);
    else {
      const far = farWords(section.heading);
      const width = textWidth(section.line.trim()) + far.reduce((sum, words) => sum + 0.5 + textWidth(words), 0);
      if (far.length > 0 && width > WORDS_MAX) {
        bad(
          `${at}.line`,
          `小节“${section.heading}”的题记后面还要接远处的那句话（${far.join('；')}），合起来有 ${Math.ceil(width)} 个字宽，沙盘栏窄的时候两行放不下；不能超过 ${WORDS_MAX} 个字宽，把题记写短一些`,
        );
      }
    }
    if (!Object.hasOwn(levels, section.water)) {
      bad(`${at}.water`, `小节“${section.heading}”的水位“${section.water}”在 water.levels.values 里没有；有的是：${Object.keys(levels).join('、')}`);
    }

    if (section.explain.length === 0) bad(`${at}.explain`, `小节“${section.heading}”的 explain 是空的：旁边的说明先讲哪几样，至少写一样`);
    section.explain.forEach((id, j) => {
      const note = explained(id);
      if (note === null) {
        bad(`${at}.explain[${j}]`, `“${id}”找不到；这里可以写修整、河、急滩、水漫不进去的地方、地名点、摆件、点缀、远处、没有画的东西的 id，或者 levels、banks、terrain、recipe`);
      } else if (!note?.trim()) {
        bad(`${at}.explain[${j}]`, `“${id}”没有写 ${entries.some((e) => e.id === id && e.kind === 'notDrawn') ? 'why' : 'note'}；explain 里点到的东西都要有一句给读者看的说明`);
      }
    });

    section.camera.mustShow?.forEach((id, j) => {
      if (id !== 'frame' && !entries.some((entry) => entry.id === id && POINTABLE.includes(entry.kind))) {
        bad(`${at}.camera.mustShow[${j}]`, `“${id}”找不到；这里可以写${POINTABLE_TEXT}的 id，或者 frame（整块沙盘）`);
      }
    });
  });

  // 什么时候有
  const known = textHeadings ?? own;
  scene.things.forEach((thing, i) => {
    // 城里的地面、水漫不进去的范围、街巷都跟着城墙算，地面只算一次，不跟着小节变
    if (thing.when !== undefined && thing.kind === 'wall') {
      bad(`things[${i}].when`, `城墙“${thing.id}”不能写 when：城里的地面、水漫不进去的范围都跟着城墙算，地面只算一次，不跟着小节变`);
    }
    checkWhen(thing, `things[${i}].when`, `摆件“${thing.id}”`);
  });
  scene.dressing.forEach((rule, i) => {
    // 路和田是画在地面上的，地面只上一次色
    if (rule.when !== undefined && (rule.kind === 'roads' || rule.kind === 'fields')) {
      bad(`dressing[${i}].when`, `点缀“${rule.id}”不能写 when：路和田是画在地面上的，地面只上一次色，不跟着小节变`);
    }
    checkWhen(rule, `dressing[${i}].when`, `点缀“${rule.id}”`);
  });
  return out;

  /** 这一节的题签指到的远处，在沙盘旁边各印成什么字（“白土镇：往西南约 24 公里（今安徽萧县白土镇）”）。拼不出来就当没有，别的规则会报。 */
  function farWords(heading: string): string[] {
    try {
      return sectionInfo(scene, heading).far.map((far) => `${far.name}：${far.say}`);
    } catch {
      return [];
    }
  }

  /** explain 里的一个 id 指的那样东西的 note；找不到这样东西时是 null。 */
  function explained(id: string): string | undefined | null {
    if (id === 'terrain') return scene.terrain.note;
    if (id === 'recipe') return scene.terrain.recipe.note;
    if (id === 'levels') return scene.water.levels.note;
    if (id === 'banks') return scene.water.banks.note;
    const entry = entries.find((e) => e.id === id && e.kind !== 'strip');
    return entry ? entry.note : null;
  }

  function checkWhen(item: SceneThing | SceneDressing, field: string, what: string): void {
    const written: When | undefined = item.when;
    if (written === undefined) return;
    const unknown = (heading: string, sub: string) => bad(`${field}.${sub}`, `${what}的 when 写的“${heading}”不是正文里的小节标题`);
    if ('only' in written) {
      if (written.only.length === 0) bad(`${field}.only`, `${what}的 only 是空的：只在哪几节有，至少写一节`);
      written.only.forEach((heading, j) => {
        if (!known.includes(heading)) unknown(heading, `only[${j}]`);
      });
      return;
    }
    const { from, until } = written;
    if (from === undefined && until === undefined) {
      bad(field, `${what}的 when 是空的；一直都有就不写 when，写了就要有 from、until 或 only`);
      return;
    }
    if (from !== undefined && !known.includes(from)) unknown(from, 'from');
    if (until !== undefined && !known.includes(until)) unknown(until, 'until');
    if (from !== undefined && until !== undefined && known.includes(from) && known.includes(until) && known.indexOf(from) > known.indexOf(until)) {
      bad(field, `${what}的 from（“${from}”）比 until（“${until}”）晚`);
    }
  }
}

// ---------------------------------------------------------------- 规则 15 题签

/** 只能是汉字，一到七个。 */
export const HAN = /^\p{Script=Han}{1,7}$/u;

/** 题签指的那样东西在沙盘上占的地方：一个点，一条线（closed 是首尾相接的一圈），一片地方，或者哪里都行。 */
type Place = { is: 'point'; at: LngLat } | { is: 'line'; line: LngLat[]; closed: boolean } | { is: 'area'; ring: LngLat[] } | { is: 'anywhere' };

/**
 * 规则 15 题签：text 和 modern 只能是汉字，一到七个；of 指的东西存在，并且在用到这条题签的小节里都有；
 * 指着一条线、一片地方时写了 at，at 离那样东西不超过 300 米；每节一到六条，不重复，写的都是文件里有的题签。
 */
export function checkSceneStrips(scene: StopScene, file: string): Violation[] {
  const out: Violation[] = [];
  const bad = (field: string, problem: string) => out.push(violation(15, file, field, problem));
  const coords = frameCoords(scene.frame);
  const headings = scene.sections.map((section) => section.heading);
  const entries = idEntries(scene);

  scene.strips.forEach((strip, i) => {
    const at = `strips[${i}]`;
    const what = `题签“${strip.id}”`;
    if (!HAN.test(strip.text)) bad(`${at}.text`, `${what}的字是“${strip.text}”；只能是汉字，一到七个，不带标点、数字和空格`);
    if (strip.modern !== undefined && !HAN.test(strip.modern)) bad(`${at}.modern`, `${what}今天的名字是“${strip.modern}”；只能是汉字，一到七个，不带标点、数字和空格`);

    const target = entries.find((entry) => entry.id === strip.of && POINTABLE.includes(entry.kind));
    if (!target) {
      bad(`${at}.of`, `${what}指的“${strip.of}”找不到；这里可以写${POINTABLE_TEXT}的 id`);
      return;
    }

    const place = placeOf(scene, target);
    if (strip.at === undefined) {
      if (place && place.is !== 'point') bad(`${at}.at`, `${what}指的“${strip.of}”是一条线或一片地方，要写 at：指在它的哪一点`);
    } else if (place) {
      const away = distance(coords.toLocal(strip.at), place, coords);
      if (away > STRIP_AT_MAX_M) bad(`${at}.at`, `${what}的 at 离它指的“${strip.of}”有 ${Math.round(away)} 米，不能超过 ${STRIP_AT_MAX_M} 米`);
    }

    const targetWhen = target.kind === 'thing' ? scene.things.find((t) => t.id === strip.of)?.when : target.kind === 'dressing' ? scene.dressing.find((d) => d.id === strip.of)?.when : undefined;
    scene.sections.forEach((section, j) => {
      if (section.strips.includes(strip.id) && !existsAt(targetWhen, section.heading, headings)) {
        bad(`sections[${j}].strips`, `小节“${section.heading}”摆了${what}（${strip.text}），但它指的“${strip.of}”这一节沙盘上没有`);
      }
    });
  });

  scene.sections.forEach((section, i) => {
    const at = `sections[${i}].strips`;
    if (section.strips.length < 1 || section.strips.length > STRIPS_MAX) bad(at, `小节“${section.heading}”有 ${section.strips.length} 条题签，应该是一到 ${STRIPS_MAX} 条`);
    section.strips.forEach((id, j) => {
      if (section.strips.indexOf(id) < j) bad(`${at}[${j}]`, `题签“${id}”在小节“${section.heading}”里写了不止一次`);
      else if (!scene.strips.some((strip) => strip.id === id)) bad(`${at}[${j}]`, `场景里没有 id 是“${id}”的题签`);
    });
  });
  return out;
}

/** 一样东西在沙盘上占的地方。它自己的位置没写对时（规则 13 另报）给 null。 */
function placeOf(scene: StopScene, entry: IdEntry): Place | null {
  const point = (at: LngLat | undefined): Place | null => (at ? { is: 'point', at } : null);
  const wallRing = (id: string): Place | null => {
    const line = scene.things.find((thing) => thing.id === id)?.line;
    return line && line.length >= 3 ? { is: 'area', ring: line } : null;
  };
  switch (entry.kind) {
    case 'thing': {
      const thing = scene.things.find((t) => t.id === entry.id);
      if (!thing || !isThingKind(thing.kind)) return null;
      const placing = THING_PLACING[thing.kind];
      if (placing === 'point') return point(thing.at);
      return thing.line && thing.line.length >= 2 ? { is: 'line', line: thing.line, closed: placing === 'ring' } : null;
    }
    case 'dressing': {
      const rule = scene.dressing.find((d) => d.id === entry.id);
      if (!rule) return null;
      if (rule.at) return point(rule.at);
      if (rule.line) return rule.line.length >= 2 ? { is: 'line', line: rule.line, closed: false } : null;
      if (rule.area) return rule.area.length >= 3 ? { is: 'area', ring: rule.area } : null;
      if (rule.inside !== undefined) return wallRing(rule.inside);
      return { is: 'anywhere' };
    }
    case 'place':
      return point(scene.places.find((p) => p.id === entry.id)?.at);
    case 'rapids':
      return point(scene.water.rapids.find((r) => r.id === entry.id)?.at);
    case 'river': {
      const line = scene.water.rivers.find((r) => r.id === entry.id)?.line;
      return line && line.length >= 2 ? { is: 'line', line, closed: false } : null;
    }
    case 'far': {
      // 远处的题签摆在沙盘边上朝着它的那一点。
      const far = scene.far.find((f) => f.id === entry.id);
      return far ? { is: 'point', at: farEdgePoint(scene.frame, far.at).point } : null;
    }
    default:
      return null;
  }
}

export type XZ = [number, number];

/** 沙盘里的一点 p 离一样东西多远（米）。在一片地方里面算 0。 */
function distance(p: XZ, place: Place, coords: FrameCoords): number {
  switch (place.is) {
    case 'anywhere':
      return 0;
    case 'point':
      return Math.hypot(...minus(p, coords.toLocal(place.at)));
    case 'line':
      return toLine(p, place.line.map(coords.toLocal), place.closed);
    case 'area': {
      const ring = place.ring.map(coords.toLocal);
      return insideRing(p, ring) ? 0 : toLine(p, ring, true);
    }
  }
}

const minus = (a: XZ, b: XZ): XZ => [a[0] - b[0], a[1] - b[1]];

export function toLine(p: XZ, line: XZ[], closed: boolean): number {
  let best = Infinity;
  const last = closed ? line.length : line.length - 1;
  for (let i = 0; i < last; i += 1) best = Math.min(best, toSegment(p, line[i], line[(i + 1) % line.length]));
  return best;
}

function toSegment(p: XZ, a: XZ, b: XZ): number {
  const [dx, dz] = minus(b, a);
  const lengthSq = dx * dx + dz * dz;
  const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / lengthSq));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dz));
}

export function insideRing(p: XZ, ring: XZ[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, zi] = ring[i];
    const [xj, zj] = ring[j];
    if (zi > p[1] !== zj > p[1] && p[0] < ((xj - xi) * (p[1] - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

// ---------------------------------------------------------------- 工具做出来的文件：规则 17、18 共用的

/**
 * 开关：是不是每个场景文件都必须有先画好的地面和每一小节的定格图（规则 17、18 各自的第一句）。
 * 现在是 true：徐州的两样都做好、放进 content/ 了（2026-11-19）。哪座沙盘缺了这两样，npm run validate 就通不过：
 * 新加一座沙盘，要先跑 npm run bake，再跑 STILLS_OUT=content/figures npm run stills，把做出来的文件一起提交。
 * （是 false 的时候，还没有做这两样的沙盘算合格，做了的照规则查。）
 */
export const MADE_FILES_REQUIRED = true;

/** 图片文件是哪一种（从文件开头认出来的，见 files.ts 的 pictureSize）。 */
export type PictureKind = 'jpeg' | 'png';

/**
 * 量好的图片：相对 content/ 的路径 → 宽、高，和它是哪一种图片。规则 17、18 要对“是不是 JPEG、是不是 PNG”；
 * kind 没有给的不对这一样。（只有宽高的 PictureSizes 也可以直接交进来。）
 */
export type MeasuredPictures = Record<string, { width: number; height: number; kind?: PictureKind }>;

/**
 * 文件的记号：相对 content/ 的路径 → 照这个文件的字节算出来的 16 个字符（src/domain/contentKey.ts）。
 * 规则 17、18 拿它和清单里写的比：对不上，就是图片在清单写好以后被人动过，或者清单被人改过。
 */
export type FileKeys = Record<string, string>;

/** 调用的人从磁盘量好的三样。规则自己不读磁盘；哪一样没有给、哪个文件不在里面，那一样就不对。 */
export interface Measured {
  sizes?: FileSizes;
  pictures?: MeasuredPictures;
  keys?: FileKeys;
}

const KIND_NAME: Record<PictureKind, string> = { jpeg: 'JPEG', png: 'PNG' };

const toolProblem = (written: number): string => `清单格式的版本只认 1，现在是 ${written}；这份清单不是现在的工具做的，重新做一遍`;

/** 清单的格式问题算在这条规则上（“清单里没有不认识的字段”是规则 17、18 自己的话）。 */
const asRule = (rule: number, found: Violation[]): Violation[] => found.map((v) => ({ ...v, rule }));

/** 路径的最后两截，说给人听用：figures/su-shi/baked/xuzhou.colour.jpg → baked/xuzhou.colour.jpg。 */
const lastTwo = (path: string): string => path.split('/').slice(-2).join('/');

/** 清单里记着的一张图。 */
interface ListedPicture {
  width: number;
  height: number;
  bytes: number;
  key: string;
}

/**
 * 清单里写的一张图，对着磁盘上量到的查：文件在不在，是不是该有的那种图片，宽高、字节数、记号和清单里写的一样不一样。
 * manifest 是清单的路径，field 是这张图在清单里的哪里，what 是怎么称呼它，redo 是对不上时该怎么办。
 */
function checkListedPicture(
  rule: number,
  manifest: string,
  field: string,
  what: string,
  path: string,
  listed: ListedPicture,
  kind: PictureKind,
  redo: string,
  files: ContentFiles,
  measured: Measured,
): Violation[] {
  const out: Violation[] = [];
  const bad = (sub: string, problem: string) => out.push(violation(rule, manifest, `${field}.${sub}`, problem));
  if (!has(files, path)) {
    bad('file', `${what} ${lastTwo(path)} 不存在；${redo}`);
    return out;
  }
  const picture = measured.pictures?.[path];
  if (picture?.kind !== undefined && picture.kind !== kind) bad('file', `${what}应该是 ${KIND_NAME[kind]}，${lastTwo(path)} 却是 ${KIND_NAME[picture.kind]}`);
  if (picture && (picture.width !== listed.width || picture.height !== listed.height)) {
    bad(picture.width !== listed.width ? 'width' : 'height', `${what}的文件是 ${picture.width} × ${picture.height} 像素，清单里写的是 ${listed.width} × ${listed.height}`);
  }
  const size = measured.sizes?.[path];
  if (size !== undefined && size !== listed.bytes) bad('bytes', `${what}的文件有 ${size} 字节，清单里写的是 ${listed.bytes}`);
  const key = measured.keys?.[path];
  if (key !== undefined && key !== listed.key) bad('key', `${what}的文件不是清单里记的那一份（文件的记号是 ${key}，清单里写的是 ${listed.key}）；${redo}`);
  return out;
}

// ---------------------------------------------------------------- 规则 17 先画好的地面

const BAKED_PICTURE = { file: text, width: count, height: count, bytes: count, key: text };

/** 先画好的地面的清单的样子（src/domain/bakedGround.ts 的 BakedGroundManifest）。 */
const BAKED: Shape = strict({
  tool: number,
  inputs: strict({ ground: text, terrain: text }),
  pixels: strict({ colour: text, fields: text }),
  colour: strict({ ...BAKED_PICTURE, quality: numberIn({ above: 0, max: 1 }), psnr: number }),
  fields: strict(BAKED_PICTURE),
});

/** 先画好的图，地面的一格画几个点：站点沙盘两个，全程沙盘三个。 */
export const BAKED_POINTS_PER_CELL = { stop: 2, route: 3 } as const;

/**
 * 先画好的两张图该多宽、多高。地面的网格每 20 米（沙盘里的米）一格（src/stage/ground/grid.ts）。
 * 站点沙盘上色时一格画两个点（src/stage/ground/paint.ts），就是每 10 米一个点；
 * 全程沙盘一格画三个点：它的一格是地上的三公里多，两个点画不出海岸和河。
 */
export function bakedPictureSize(scene: TableScene): { width: number; height: number } {
  const grid = gridOf(coordsOf(scene));
  const points = BAKED_POINTS_PER_CELL[scene.level === 'route' ? 'route' : 'stop'];
  return { width: (grid.nx - 1) * points + 1, height: (grid.nz - 1) * points + 1 };
}

/**
 * 规则 17 先画好的地面：场景文件在 baked/ 里有一份清单（<站>.json）和它写的两张图（<站>.colour.jpg、<站>.fields.png）；
 * 清单里没有不认识的字段；两张图都在，颜色是 JPEG，田的标记是 PNG；两张图的宽高和清单里写的一样，
 * 也和沙盘的范围算出来的一样（每 10 米一个点），都不超过 2048 像素；字节数、文件的记号和清单里写的一样；
 * 地形文件、颜色、田的标记三个文件合计不超过 1.5 MB；颜色那张图的清晰度（psnr）不低于 40；
 * baked/ 里以“<站>.”开头的文件都在清单里。
 * dir 是这位人物的文件夹，如 figures/su-shi。required 是 false 时，没有清单的沙盘算合格（见 MADE_FILES_REQUIRED）。
 * 只查文件齐不齐、对不对得上清单；图是不是比做它的东西旧，由 npm test 里的 baked-fresh 查。
 */
export function checkBakedGround(scene: TableScene, dir: string, files: ContentFiles, measured: Measured = {}, required: boolean = MADE_FILES_REQUIRED): Violation[] {
  const stop = scene.stopId;
  const folder = `${dir}/baked/`;
  const file = `${folder}${stop}.json`;
  const redo = '图片和清单都不手改，运行 npm run bake 重新做';
  const out: Violation[] = [];
  /** baked/ 里这一站的文件（清单自己不算）。 */
  const own = Object.keys(files)
    .filter((path) => path.startsWith(`${folder}${stop}.`) && path !== file)
    .sort();

  if (!has(files, file)) {
    if (required) out.push(violation(17, file, '', `没有这个文件：“${stop}”的沙盘还没有先画好的地面；运行 npm run bake，再提交`));
    for (const path of own) out.push(violation(17, path, '', `baked/ 里没有这一站的清单（${stop}.json），这个文件对不上；${redo}，或者删掉它`));
    return out;
  }
  const read = readJson(files, file);
  if (read.data === undefined) return read.violations;
  const shape = asRule(17, checkShape(read.data, BAKED, file));
  if (shape.length > 0) return shape;
  const manifest = read.data as BakedGroundManifest;
  const bad = (field: string, problem: string) => out.push(violation(17, file, field, problem));

  if (manifest.tool !== 1) bad('tool', toolProblem(manifest.tool));

  const expected = bakedPictureSize(scene);
  const pictures: { field: 'colour' | 'fields'; what: string; name: string; kind: PictureKind }[] = [
    { field: 'colour', what: '颜色那张图', name: `${stop}.colour.jpg`, kind: 'jpeg' },
    { field: 'fields', what: '田的标记那张图', name: `${stop}.fields.png`, kind: 'png' },
  ];
  const listed: string[] = [];
  for (const { field, what, name, kind } of pictures) {
    const entry = manifest[field];
    if (entry.file !== name) bad(`${field}.file`, `${what}应该叫 ${name}，现在写的是“${entry.file}”`);
    else {
      listed.push(`${folder}${name}`);
      out.push(...checkListedPicture(17, file, field, what, `${folder}${name}`, entry, kind, redo, files, measured));
    }
    if (entry.width !== expected.width || entry.height !== expected.height) {
      bad(
        `${field}.${entry.width !== expected.width ? 'width' : 'height'}`,
        `${what}写的是 ${entry.width} × ${entry.height} 像素；照沙盘的范围${scene.level === 'route' ? '一格三个点' : '每 10 米一个点'}算，应该是 ${expected.width} × ${expected.height}`,
      );
    }
    if (edgeTooLong(entry.width, entry.height)) {
      bad(`${field}.${entry.width > PICTURE_EDGE_MAX ? 'width' : 'height'}`, `${what}有 ${entry.width} × ${entry.height} 像素，宽和高都不能超过 ${PICTURE_EDGE_MAX}`);
    }
  }

  // 三个文件合计：量到了的用量到的；没有量的，图片用清单里写的字节数，地形文件用 行 × 列 × 2（规则 10 管它对不对）
  const sizeOf = (path: string, otherwise: number): number => measured.sizes?.[path] ?? otherwise;
  const sum = tableFiles({
    terrain: sizeOf(`${dir}/scenes/${scene.terrain.file}`, scene.terrain.rows * scene.terrain.cols * 2),
    colour: sizeOf(`${folder}${stop}.colour.jpg`, manifest.colour.bytes),
    fields: sizeOf(`${folder}${stop}.fields.png`, manifest.fields.bytes),
  });
  if (sum.verdict === 'fail') bad('', `地形文件、颜色、田的标记三个文件合计 ${megabytes(sum.total)}，不能超过 1.5 MB`);

  // 全程沙盘的那一张另有一个数（见 budgetRules.ts）
  const psnrMin = scene.level === 'route' ? COLOUR_PSNR_MIN_ROUTE : COLOUR_PSNR_MIN;
  if (psnrTooLow(manifest.colour.psnr, psnrMin)) {
    bad('colour.psnr', `颜色那张图压得太狠：清晰度（psnr）是 ${manifest.colour.psnr}，不能低于 ${psnrMin}；用高一点的质量重新做`);
  }

  for (const path of own) {
    if (!listed.includes(path)) out.push(violation(17, path, '', `这个文件不在清单（baked/${stop}.json）里；baked/ 里只放清单写着的文件：${redo}，或者删掉它`));
  }
  return out;
}

// ---------------------------------------------------------------- 规则 18 每一小节的定格图

const STILL_SHAPES: readonly StillShape[] = ['wide', 'narrow'];
const SHAPE_NAME: Record<StillShape, string> = { wide: '宽', narrow: '窄' };
/** stills/ 里算“图片”的文件。 */
const PICTURE_FILE = /\.(jpe?g|png|webp|gif|avif)$/i;

const NUMBERS = list(number);
const STILL_SPEC = strict({ window: NUMBERS, pane: NUMBERS, insets: NUMBERS, extra: notNegative, pixelRatio: positive });
const STILL_ANCHOR = strict({ id: text, x: number, y: number, visible: bool, out: optional(NUMBERS), foot: optional(NUMBERS) });

/** 定格图清单的样子（src/domain/stills.ts 的 StillManifest）。几个数是几个一组的，另在规则里数。 */
const STILLS: Shape = strict({
  tool: number,
  made: strict({ tier: oneOf(['full']), three: text, background: text, fitMarginPx: notNegative, maxFit: positive }),
  madeFrom: strict({ scene: text, terrain: text, ground: text, program: text }),
  shapes: strict({ wide: STILL_SPEC, narrow: STILL_SPEC }),
  stills: list(
    strict({
      section: text,
      shape: oneOf(STILL_SHAPES),
      file: text,
      width: count,
      height: count,
      bytes: count,
      quality: numberIn({ min: 0, max: 100 }),
      key: text,
      raw: text,
      pose: strict({ target: NUMBERS, position: NUMBERS, fov: positive }),
      fit: positive,
      reach: NUMBERS,
      northDeg: numberIn({ min: -180, max: 180 }),
      pxPerMetre: positive,
      anchors: list(STILL_ANCHOR),
    }),
  ),
});

const HOW_MANY = ['', '一', '两', '三', '四'];

/**
 * 规则 18 每一小节的定格图：场景文件在 stills/ 里有一份清单（<站>.json）；清单里没有不认识的字段；
 * 场景的每个小节，宽、窄两种各有一张，不多不少，先后和小节一样；文件名是 <站>-<第几节>-wide.jpg、<站>-<第几节>-narrow.jpg，
 * 不带文件夹；stills/ 里以“<站>-”开头的图片都在清单里；每张图都在，是 JPEG，不超过 300 KB，宽、高都不超过 2048 像素，
 * 宽高、字节数、文件的记号和清单里写的一样；每张图的 anchors 正好是这一小节的题签，先后相同，x、y 是数，
 * 看得见的落在 0 到 1 之间，写了 out 的是长度为 1 的方向，写了 foot 的是两个数；northDeg 在 −180 到 180 之间；
 * pxPerMetre、fit 大于 0；两种形状都写了窗口、沙盘栏、四边留的空、左右多拍多少、像素比。
 * dir 是这位人物的文件夹。required 是 false 时，没有清单的沙盘算合格（见 MADE_FILES_REQUIRED）。
 * 只查文件齐不齐、对不对得上清单；图是不是比做它的东西旧，由 npm test 里的 stills-fresh 查。
 */
export function checkSectionStills(scene: TableScene, dir: string, files: ContentFiles, measured: Measured = {}, required: boolean = MADE_FILES_REQUIRED): Violation[] {
  const stop = scene.stopId;
  const folder = `${dir}/stills/`;
  const file = `${folder}${stop}.json`;
  // 命令要写全：不带 STILLS_OUT 的 npm run stills 只是试拍，不动仓库里的图。
  const redo = '图片和清单都不手改，运行 STILLS_OUT=content/figures npm run stills 重新做（见 README）';
  const out: Violation[] = [];
  /** stills/ 里这一站的图片。 */
  const own = Object.keys(files)
    .filter((path) => path.startsWith(`${folder}${stop}-`) && PICTURE_FILE.test(path))
    .sort();

  if (!has(files, file)) {
    if (required) out.push(violation(18, file, '', `没有这个文件：“${stop}”的沙盘还没有每一小节的定格图；运行 STILLS_OUT=content/figures npm run stills（见 README），再提交`));
    for (const path of own) out.push(violation(18, path, '', `stills/ 里没有这一站的清单（${stop}.json），这张图对不上；${redo}，或者删掉它`));
    return out;
  }
  const read = readJson(files, file);
  if (read.data === undefined) return read.violations;
  const shape = asRule(18, checkShape(read.data, STILLS, file));
  if (shape.length > 0) return shape;
  const manifest = read.data as StillManifest;
  const bad = (field: string, problem: string) => out.push(violation(18, file, field, problem));
  /** 几个一组的数：个数要对。 */
  const group = (values: number[], n: number, field: string, what: string): void => {
    if (values.length !== n) bad(field, `${what}要写成${HOW_MANY[n]}个数，现在是 ${values.length} 个`);
  };

  if (manifest.tool !== 1) bad('tool', toolProblem(manifest.tool));

  // 两种形状各是照什么画面拍的
  for (const name of STILL_SHAPES) {
    const spec = manifest.shapes[name];
    group(spec.window, 2, `shapes.${name}.window`, `${SHAPE_NAME[name]}的那种，窗口的宽和高`);
    group(spec.pane, 2, `shapes.${name}.pane`, `${SHAPE_NAME[name]}的那种，沙盘栏的宽和高`);
    group(spec.insets, 4, `shapes.${name}.insets`, `${SHAPE_NAME[name]}的那种，四边留的空（上、右、下、左）`);
  }

  // 每个小节，两种各一张，不多不少，先后和小节一样
  const headings = scene.sections.map((section) => section.heading);
  for (const name of STILL_SHAPES) {
    const shots = manifest.stills.map((shot, i) => ({ shot, i })).filter((entry) => entry.shot.shape === name);
    const sections = shots.map((entry) => entry.shot.section);
    let complete = true;
    for (const heading of headings) {
      if (sections.includes(heading)) continue;
      bad('stills', `小节“${heading}”没有${SHAPE_NAME[name]}的定格图；每个小节宽、窄各要一张`);
      complete = false;
    }
    shots.forEach(({ shot, i }, n) => {
      if (!headings.includes(shot.section)) bad(`stills[${i}].section`, `清单里多出一张${SHAPE_NAME[name]}的定格图：场景里没有“${shot.section}”这个小节`);
      else if (sections.indexOf(shot.section) < n) bad(`stills[${i}].section`, `小节“${shot.section}”${SHAPE_NAME[name]}的定格图写了不止一张`);
      else return;
      complete = false;
    });
    if (complete && sections.join('\n') !== headings.join('\n')) bad('stills', `${SHAPE_NAME[name]}的定格图先后和小节不一样；小节是：${headings.join('、')}`);
  }

  // 每一张
  const listed: string[] = [];
  manifest.stills.forEach((shot, i) => {
    const at = `stills[${i}]`;
    if (!/[\\/]/.test(shot.file)) listed.push(`${folder}${shot.file}`);
    group(shot.pose.target, 3, `${at}.pose.target`, '镜头对准的那一点');
    group(shot.pose.position, 3, `${at}.pose.position`, '镜头在哪');
    group(shot.reach, 2, `${at}.reach`, '要看的点离中心最远多少像素（横、竖）');

    const n = headings.indexOf(shot.section) + 1;
    // 小节对不上的，上面说过了
    if (n === 0) return;
    const what = `小节“${shot.section}”${SHAPE_NAME[shot.shape]}的定格图`;
    const name = `${stop}-${n}-${shot.shape}.jpg`;
    const path = `${folder}${name}`;
    if (shot.file !== name) {
      bad(`${at}.file`, `${what}应该叫 ${name}（<站>-<第几节>-${shot.shape}.jpg，不带文件夹），现在写的是“${shot.file}”`);
    } else {
      out.push(...checkListedPicture(18, file, at, what, path, shot, 'jpeg', redo, files, measured));
      const size = has(files, path) ? (measured.sizes?.[path] ?? shot.bytes) : shot.bytes;
      if (stillTooBig(size)) bad(`${at}.bytes`, `${what}有 ${kilobytes(size)}，不能超过 300 KB`);
    }
    if (edgeTooLong(shot.width, shot.height)) {
      bad(`${at}.${shot.width > PICTURE_EDGE_MAX ? 'width' : 'height'}`, `${what}有 ${shot.width} × ${shot.height} 像素，宽和高都不能超过 ${PICTURE_EDGE_MAX}`);
    }

    // 题签指着的点：正好是这一小节的题签，先后相同
    const want = scene.sections[n - 1].strips;
    const got = shot.anchors.map((anchor) => anchor.id);
    if (want.join('\n') !== got.join('\n')) {
      bad(`${at}.anchors`, `${what}记的题签是 ${got.join('、') || '（一条也没有）'}，这一小节的题签是 ${want.join('、')}；要一条不多、一条不少，先后相同`);
    }
    shot.anchors.forEach((anchor, j) => {
      const inside = anchor.x >= 0 && anchor.x <= 1 && anchor.y >= 0 && anchor.y <= 1;
      if (anchor.visible && !inside) {
        bad(`${at}.anchors[${j}]`, `题签“${anchor.id}”标着看得见，位置却在图片外面（x ${anchor.x}，y ${anchor.y}）；看得见的要落在 0 到 1 之间`);
      }
      if (anchor.out !== undefined && !(anchor.out.length === 2 && Math.abs(Math.hypot(anchor.out[0], anchor.out[1]) - 1) <= 0.01)) {
        bad(`${at}.anchors[${j}].out`, `题签“${anchor.id}”的 out 要写成一个方向：两个数，合起来长度是 1`);
      }
      if (anchor.foot !== undefined && anchor.foot.length !== 2) bad(`${at}.anchors[${j}].foot`, `题签“${anchor.id}”的 foot 要写成两个数，现在是 ${anchor.foot.length} 个`);
    });
  });

  for (const path of own) {
    if (!listed.includes(path)) out.push(violation(18, path, '', `这张图不在清单（stills/${stop}.json）里；这一站的定格图只放清单写着的：${redo}，或者删掉它`));
  }
  return out;
}
