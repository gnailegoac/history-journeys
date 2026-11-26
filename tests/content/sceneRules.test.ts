// 场景数据校验规则自己的测试：规则 10 到 18 和场景文件的格式，都用合格的样本（fixtures/good）和出错的样本
// （fixtures/bad）各试一遍，再在合格样本上一次只改坏一处，看是不是正好查出那一处。
// 合格样本里的沙盘是 figures/demo/scenes/river.json；出错样本里 scenes/a.json 格式是对的、规则 10 到 15 条条都错，
// scenes/c.json 错在格式上。
//
// 规则 17、18 查的是工具做出来的文件。合格样本里也带着一套（baked/river.*，stills/river.json 和六张 river-*-*.jpg）：
// 清单是照规格手写的，图片只有文件头（写着是哪一种图片、多宽多高），没有画面，够校验用；清单里的字节数和文件的记号
// 是照这几个小文件算的，“照什么做的”那几个记号是编的（校验不看它们旧不旧）。
// 出错的样本里没有这两条规则的例子：那里的场景本身就不合格，而场景不合格时这两条先不查。
// 所以规则 17、18 每一句的反例，都是在合格样本上改一处（清单、量到的大小、宽高、记号，都在内存里改）。

import { describe, expect, it } from 'vitest';
import type { BakedGroundManifest } from '../../src/domain/bakedGround';
import type { StopScene } from '../../src/domain/scene';
import { farEdgePoint, frameCoords } from '../../src/domain/sceneGeo';
import type { StillManifest } from '../../src/domain/stills';
import { realSceneFile, realSceneKeys } from '../stage/support/realScenes';
import { FIXTURE_HEADINGS, fixtureScene, fixtureSources } from '../support/fixtureScene';
import { fileSize, readBytes } from '../support/readBytes';
import { PICTURE_EDGE_MAX, TABLE_FILES_MAX_BYTES } from './budgetRules';
import { pictureSize, toContentFiles, toFileKeys, toFileSizes, toPictureSizes } from './files';
import { formatViolation, RULE_NAMES, validateContent as validateAll } from './rules';
import type { ContentFiles } from './rules';
import { SHORE_ABOVE_LOWEST_M, SHORE_UNDER_NORMAL_M } from '../../src/stage/three/families/rock';
import type { Source } from '../../src/domain/types';
import { bakedPictureSize, checkBakedGround, checkScene, checkSceneNight, checkSceneShape, checkSceneStrips, checkSectionStills, FAR_STRIP_AT_MAX_M, MADE_FILES_REQUIRED, MOON_ALTITUDE, OUTLINE_SECTIONS, SHORE_ROCKS_NEED_M, STILL_MAX_BYTES, TERRAIN_MAX_BYTES, textWidth, unsureProblem, WORDS_MAX } from './sceneRules';
import type { Measured } from './sceneRules';
import type { FileSizes, Violation } from './shape';

const texts = import.meta.glob<string>('./fixtures/**/*.{json,md}', { query: '?raw', import: 'default', eager: true });
// 两份样本里另有全程沙盘的文件（scenes/route.*）：它们在 routeRules.test.ts 里查。这里不带它们，下面各条数的还是站点沙盘和别的文件。
const paths = Object.keys(import.meta.glob('./fixtures/**/*')).filter((path) => !path.includes('/scenes/route.'));
/**
 * 样本里既然不带全程沙盘，“卡片标了可以点进去的人物要有 scenes/route.json”（规则 16 的后半句）在这里一定报：
 * 这一句在 routeRules.test.ts 里用带着全程沙盘的样本查，这里把它滤掉，别的照旧。
 */
const validateContent = (...args: Parameters<typeof validateAll>): Violation[] =>
  validateAll(...args).filter((v) => !(v.rule === 16 && v.file === 'figures/index.json'));
const fixture = (name: string): ContentFiles => toContentFiles(`./fixtures/${name}/`, paths, texts);

const GOOD = fixture('good');
const BAD = fixture('bad');

const STOP = 'figures/demo/stops/river.json';
const BODY = 'figures/demo/stops/river.md';
const SCENE = 'figures/demo/scenes/river.json';
const TERRAIN = 'figures/demo/scenes/river.terrain.bin';
const BAD_SCENE = 'figures/broken/scenes/a.json';
const BAD_FORMAT = 'figures/broken/scenes/c.json';
/** 这位人物的文件夹，和工具照着他的沙盘做出来的文件。 */
const DIR = 'figures/demo';
const BAKED = 'figures/demo/baked/river.json';
const COLOUR = 'figures/demo/baked/river.colour.jpg';
const FIELDS = 'figures/demo/baked/river.fields.png';
const STILLS = 'figures/demo/stills/river.json';
const shot = (n: number, shape: 'wide' | 'narrow'): string => `figures/demo/stills/river-${n}-${shape}.jpg`;
const SHOTS = [shot(1, 'wide'), shot(2, 'wide'), shot(3, 'wide'), shot(1, 'narrow'), shot(2, 'narrow'), shot(3, 'narrow')];

/** 样本里的文件在磁盘上的路径（相对项目的根目录）。 */
const onDisk = (path: string): string => `tests/content/${path.slice(2)}`;
/** 合格样本里地形文件、先画好的地面和定格图的大小，从磁盘量的。 */
const SIZES = toFileSizes('./fixtures/good/', paths, (path) => fileSize(onDisk(path)));
/** 合格样本里的图片各有多宽多高、是哪一种，和它们的记号，也是从磁盘上的文件里读的。 */
const PICTURES = toPictureSizes('./fixtures/good/', paths, (path) => readBytes(onDisk(path)));
const KEYS = toFileKeys('./fixtures/good/', paths, (path) => readBytes(onDisk(path)));
const MEASURED: Measured = { sizes: SIZES, pictures: PICTURES, keys: KEYS };

/**
 * 全部问题，每处写成“规则号 文件 › 字段”。只给了文件的大小（没有量宽高、没有算记号）；
 * “每座沙盘都要有先画好的地面和定格图”的开关在这里一律当作没开：这些测试看的是场景自己，
 * 开关开没开，在规则 17、18 那两组里另外各试一遍。
 */
function all(files: ContentFiles, sizes: FileSizes = SIZES): string[] {
  return validateContent(files, sizes, {}, {}, false).map((v) => `${v.rule} ${v.file}${v.field === '' ? '' : ` › ${v.field}`}`);
}

/** 某一条规则在某个文件里查出来的地方，每处只写字段。 */
function fields(files: ContentFiles, rule: number, file: string): string[] {
  return validateContent(files, SIZES)
    .filter((v) => v.rule === rule && v.file === file)
    .map((v) => v.field);
}

/** 在合格样本上改一个 JSON 文件。T 写成这一处改动用得着的样子，可以比真的类型松（为了改出类型不许的错）。 */
function edit<T>(path: string, change: (data: T) => void): ContentFiles {
  const data = JSON.parse(GOOD[path]) as T;
  change(data);
  return { ...GOOD, [path]: JSON.stringify(data) };
}
const editScene = (change: (scene: StopScene) => void) => edit<StopScene>(SCENE, change);

/** 合格样本改一处以后，这个场景文件查出来的全部问题，写成“规则号 字段”。别的文件有问题也算进来，写全。 */
function sceneProblems(change: (scene: StopScene) => void): string[] {
  const prefix = `${SCENE} › `;
  return all(editScene(change)).map((line) => line.replace(prefix, ''));
}

/** 同上，改成类型不许的样子。 */
function looseProblems<T>(change: (scene: T) => void): string[] {
  const prefix = `${SCENE} › `;
  return all(edit<T>(SCENE, change)).map((line) => line.replace(prefix, ''));
}

/** 在合格样本上换掉或加上一个文件。 */
const withFile = (path: string, content: string): ContentFiles => ({ ...GOOD, [path]: content });

/** 在合格样本上去掉一个文件。 */
function without(path: string): ContentFiles {
  const files = { ...GOOD };
  delete files[path];
  return files;
}

/** 把工具做出来的那几样（先画好的地面、每一小节的定格图）都拿开：只看场景自己的时候用。 */
function withoutMade(files: ContentFiles = GOOD): ContentFiles {
  const out = { ...files };
  for (const path of [BAKED, COLOUR, FIELDS, STILLS, ...SHOTS]) delete out[path];
  return out;
}

const goodScene = (): StopScene => JSON.parse(GOOD[SCENE]) as StopScene;

/** 合格样本里还没写的一站（pass），和它的场景文件。 */
const OUTLINE_SCENE = 'figures/demo/scenes/pass.json';
const OUTLINE_STOP_STATUS = (JSON.parse(GOOD['figures/demo/figure.json']) as { stops: { id: string; status: string }[] }).stops.find((stop) => stop.id === 'pass')?.status;

/**
 * 合格样本里那座沙盘，挪到还没写的一站（pass）上：这一站没有 stops/pass.json，
 * 出处从 stops/river.json 原样抄进场景文件自己的 sources。change 在这以后再改一处。
 * 这一站有了场景文件，figure.json 里它也就写上 "table": true（2026-11-25 起规则 3 两头都查；不写的话每一条都多报这一处）。
 */
function outlineFiles(change: (scene: StopScene) => void = () => {}): ContentFiles {
  const scene = goodScene();
  scene.stopId = 'pass';
  scene.terrain.file = 'pass.terrain.bin';
  scene.sources = (JSON.parse(GOOD[STOP]) as { sources: Source[] }).sources;
  change(scene);
  const figure = JSON.parse(GOOD['figures/demo/figure.json']) as { stops: { id: string; table?: boolean }[] };
  for (const stop of figure.stops) if (stop.id === 'pass') stop.table = true;
  return { ...GOOD, 'figures/demo/figure.json': JSON.stringify(figure), [OUTLINE_SCENE]: JSON.stringify(scene), 'figures/demo/scenes/pass.terrain.bin': '' };
}

/** 那一站的场景文件查出来的全部问题，写成“规则号 字段”。别的文件有问题也算进来，写全。 */
function outlineProblems(change: (scene: StopScene) => void): string[] {
  const prefix = `${OUTLINE_SCENE} › `;
  return all(outlineFiles(change)).map((line) => line.replace(prefix, ''));
}

describe('两份样本', () => {
  it('合格的样本带着沙盘、定格图和工具做出来的两样，量了文件大小，一处问题也没有', () => {
    expect(GOOD[SCENE]).toContain('"stopId": "river"');
    // stills/ 和 baked/ 里的文件都量了大小（清单也量了，用不着）
    expect(Object.keys(SIZES).sort()).toEqual([TERRAIN, BAKED, COLOUR, FIELDS, STILLS, ...SHOTS].sort());
    expect(SIZES[TERRAIN]).toBe(128);
    expect(all(GOOD)).toEqual([]);
    // 量到的宽高、是哪一种图片、文件的记号都交进去，也一处没有；“每座沙盘都要有这两样”的开关开着也一样
    expect(validateContent(GOOD, SIZES, PICTURES, KEYS, true)).toEqual([]);
    expect(validateContent(GOOD, SIZES, PICTURES, KEYS, false)).toEqual([]);
    // 不给大小，只凭清单和有哪些文件，也一处没有
    expect(validateContent(GOOD)).toEqual([]);
  });

  it('出错的样本里，规则 10 到 15 都查出了问题（规则 16 在 routeRules.test.ts 里查）', () => {
    const rules = new Set(validateContent(BAD).map((v) => v.rule));
    for (const rule of [10, 11, 12, 13, 14, 15]) expect(rules.has(rule), `规则 ${rule} ${RULE_NAMES[rule]}`).toBe(true);
  });

  it('几组测试共用的小沙盘（tests/support/fixtureScene.ts）合乎格式和规则 10 到 15', () => {
    const scene = fixtureScene();
    const file = 'figures/sample/scenes/sample-town.json';
    const terrain = 'figures/sample/scenes/sample-town.terrain.bin';
    const stop = { id: 'sample-town', status: 'complete' as const, headings: [...FIXTURE_HEADINGS], sourceIds: fixtureSources().map((s) => s.id) };
    expect(checkSceneShape(JSON.parse(JSON.stringify(scene)), file)).toEqual([]);
    expect(checkScene(scene, file, stop, { [file]: '', [terrain]: '' }, { [terrain]: 8 * 8 * 2 })).toEqual([]);
  });
});

describe('场景文件的格式：字段齐全、类型对、没有不认识的字段、数字在范围里', () => {
  it('合格的样本通过', () => {
    expect(fields(GOOD, 0, SCENE)).toEqual([]);
  });

  it('出错的样本：坐标写反、数字不在范围里、不认识的字段、op 和 when 写错、缺字段、类型不对', () => {
    expect(fields(BAD, 1, BAD_FORMAT)).toEqual(['frame.center']);
    expect(fields(BAD, 0, BAD_FORMAT)).toEqual([
      'frame.westM',
      'frame.relief.curve',
      'terrain.cols',
      'terrain.recipe.plainKeep',
      'terrain.edits[0].op',
      'water.levels.values.normal',
      'things[0].when.form',
      'dressing[0].when',
      'strips[0].liftM',
      'far',
      'sections[0].camera.pitch',
      'sections[0].camera.fov',
      'sections[0].strips',
    ]);
  });

  it('格式有问题的场景文件，规则 10 到 15 先不查', () => {
    const rules = new Set(validateContent(BAD).filter((v) => v.file === BAD_FORMAT).map((v) => v.rule));
    expect([...rules].sort()).toEqual([0, 1]);
    // 这个文件要是查了规则 12，会报“这一站的 .json 读不出来”以外的好几处。
    const files = edit<{ stopId: string; extra: number }>(SCENE, (scene) => {
      scene.stopId = 'lake';
      scene.extra = 1;
    });
    expect(all(files)).toEqual([`0 ${SCENE} › extra`]);
  });

  it('把 from 错写成 form：不认识这个字段', () => {
    const files = edit<{ things: { when: unknown }[] }>(SCENE, (scene) => (scene.things[2].when = { form: '河上' }));
    expect(validateContent(files, SIZES).map((v) => `${v.rule} ${v.field}｜${v.problem}`)).toEqual(['0 things[2].when.form｜不认识这个字段（这里可以写：from、until）']);
  });

  it('不认识的字段，哪一层都查', () => {
    expect(looseProblems<{ notes: string }>((scene) => (scene.notes = '多出来的'))).toEqual(['0 notes']);
    expect(looseProblems<{ frame: { tilt: number } }>((scene) => (scene.frame.tilt = 3))).toEqual(['0 frame.tilt']);
    expect(looseProblems<{ terrain: { recipe: { blur: number } } }>((scene) => (scene.terrain.recipe.blur = 3))).toEqual(['0 terrain.recipe.blur']);
    expect(looseProblems<{ terrain: { edits: { after: string }[] } }>((scene) => (scene.terrain.edits[0].after = 'water'))).toEqual(['0 terrain.edits[0].after']);
    expect(looseProblems<{ water: { rivers: { bedM: number }[] } }>((scene) => (scene.water.rivers[0].bedM = 3))).toEqual(['0 water.rivers[0].bedM']);
    expect(looseProblems<{ things: { size: string }[] }>((scene) => (scene.things[2].size = 'large'))).toEqual(['0 things[2].size']);
    expect(looseProblems<{ strips: { kind: string; liftM: number }[] }>((scene) => Object.assign(scene.strips[0], { kind: 'place', liftM: 12 }))).toEqual([
      '0 strips[0].kind',
      '0 strips[0].liftM',
    ]);
    expect(looseProblems<{ far: { modern: string }[] }>((scene) => (scene.far[0].modern = '东港市'))).toEqual(['0 far[0].modern']);
    expect(looseProblems<{ sections: { camera: { targetLiftM: number }; light: string }[] }>((scene) => {
      scene.sections[1].camera.targetLiftM = 40;
      scene.sections[1].light = 'west';
    })).toEqual(['0 sections[1].camera.targetLiftM', '0 sections[1].light']);
    expect(looseProblems<{ notDrawn: { note: string }[] }>((scene) => (scene.notDrawn[0].note = '多出来的'))).toEqual(['0 notDrawn[0].note']);
  });

  it('when 只有两种写法：only 不能和 from、until 一起写，也不能是别的样子', () => {
    expect(looseProblems<{ things: { when: unknown }[] }>((scene) => (scene.things[2].when = { only: ['河上'], until: '渡口' }))).toEqual(['0 things[2].when']);
    expect(looseProblems<{ things: { when: unknown }[] }>((scene) => (scene.things[2].when = '河上'))).toEqual(['0 things[2].when']);
    expect(looseProblems<{ things: { when: unknown }[] }>((scene) => (scene.things[2].when = { only: '河上' }))).toEqual(['0 things[2].when.only']);
    expect(looseProblems<{ things: { when: unknown }[] }>((scene) => (scene.things[2].when = { from: 2 }))).toEqual(['0 things[2].when.from']);
  });

  it('修整的 op 只有 level 和 mound；每一种有它自己的字段', () => {
    expect(looseProblems<{ terrain: { edits: { op?: string }[] } }>((scene) => (scene.terrain.edits[2].op = 'cliff'))).toEqual(['0 terrain.edits[2].op']);
    expect(looseProblems<{ terrain: { edits: { op?: string }[] } }>((scene) => delete scene.terrain.edits[2].op)).toEqual(['0 terrain.edits[2].op']);
    // 土丘写成 level：缺 level 的字段，土丘的字段成了不认识的。
    expect(looseProblems<{ terrain: { edits: { op: string }[] } }>((scene) => (scene.terrain.edits[2].op = 'level'))).toEqual([
      '0 terrain.edits[2].mode',
      '0 terrain.edits[2].toM',
      '0 terrain.edits[2].featherM',
      '0 terrain.edits[2].at',
      '0 terrain.edits[2].addM',
      '0 terrain.edits[2].innerM',
      '0 terrain.edits[2].outerM',
    ]);
  });

  it('缺字段、类型不对', () => {
    expect(looseProblems<{ credits?: string[] }>((scene) => delete scene.credits)).toEqual(['0 credits']);
    expect(looseProblems<{ things: { basis?: string }[] }>((scene) => delete scene.things[0].basis)).toEqual(['0 things[0].basis']);
    expect(looseProblems<{ things: { sourceIds: unknown }[] }>((scene) => (scene.things[0].sourceIds = 's1'))).toEqual(['0 things[0].sourceIds']);
    expect(looseProblems<{ things: { params: unknown }[] }>((scene) => (scene.things[0].params = ['earth']))).toEqual(['0 things[0].params']);
    expect(looseProblems<{ water: { levels: { values: unknown } } }>((scene) => (scene.water.levels.values = { normal: 37.6, flood: '43' }))).toEqual([
      '0 water.levels.values.flood',
    ]);
    expect(looseProblems<{ water: { rivers: { kind: string }[] } }>((scene) => (scene.water.rivers[1].kind = 'canal'))).toEqual(['0 water.rivers[1].kind']);
    expect(looseProblems<{ sections: { sky: string }[] }>((scene) => (scene.sections[1].sky = 'dusk'))).toEqual(['0 sections[1].sky']);
    // 月亮写的不是两个数、多写了一样，都是格式不对
    expect(looseProblems<{ sections: { sky: string; moon: unknown }[] }>((scene) => Object.assign(scene.sections[1], { sky: 'night', moon: { azimuth: '103', altitude: 12 } }))).toEqual([
      '0 sections[1].moon.azimuth',
    ]);
    expect(looseProblems<{ sections: { sky: string; moon: unknown }[] }>((scene) => Object.assign(scene.sections[1], { sky: 'night', moon: { azimuth: 103, altitude: 12, phase: 0.9 } }))).toEqual([
      '0 sections[1].moon.phase',
    ]);
    expect(looseProblems<{ strips: { side: string }[] }>((scene) => (scene.strips[1].side = 'east'))).toEqual(['0 strips[1].side']);
    expect(looseProblems<{ terrain: { recipe: { kind: string } } }>((scene) => (scene.terrain.recipe.kind = 'flat'))).toEqual(['0 terrain.recipe.kind']);
    expect(looseProblems<{ terrain: { edits: { mode: string }[] } }>((scene) => (scene.terrain.edits[0].mode = 'fill'))).toEqual(['0 terrain.edits[0].mode']);
  });

  it('数字不在说得通的范围里', () => {
    const cases: [string, (scene: StopScene) => void][] = [
      ['frame.westM', (s) => (s.frame.westM = 0)],
      ['frame.relief.times', (s) => (s.frame.relief.times = 0)],
      ['terrain.cols', (s) => (s.terrain.cols = 8.5)],
      ['terrain.rows', (s) => (s.terrain.rows = 0)],
      ['terrain.recipe.plainKeep', (s) => (s.terrain.recipe.plainKeep = 1.2)],
      ['terrain.recipe.edgeTaperM', (s) => (s.terrain.recipe.edgeTaperM = -1)],
      ['terrain.edits[0].featherM', (s) => ((s.terrain.edits[0] as { featherM: number }).featherM = -5)],
      ['terrain.edits[2].addM', (s) => ((s.terrain.edits[2] as { addM: number }).addM = 0)],
      ['water.banks.bedM', (s) => (s.water.banks.bedM = 0)],
      ['water.banks.keepOffWallsM', (s) => (s.water.banks.keepOffWallsM = -1)],
      ['water.rivers[0].drawWidthM', (s) => (s.water.rivers[0].drawWidthM = 0)],
      ['water.rapids[0].lengthM', (s) => (s.water.rapids[0].lengthM = -200)],
      ['things[4].facing', (s) => (s.things[4].facing = 400)],
      ['sections[0].camera.distanceM', (s) => (s.sections[0].camera.distanceM = 0)],
      ['sections[0].camera.pitch', (s) => (s.sections[0].camera.pitch = 86)],
      ['sections[0].camera.bearing', (s) => (s.sections[0].camera.bearing = -10)],
      ['sections[1].camera.fov', (s) => (s.sections[1].camera.fov = 9)],
      ['sections[1].camera.closest', (s) => (s.sections[1].camera.closest = 0.4)],
      ['sections[1].camera.closest', (s) => (s.sections[1].camera.closest = 1.1)],
      ['sections[1].camera.targetUpM', (s) => (s.sections[1].camera.targetUpM = -1)],
    ];
    for (const [field, change] of cases) expect(sceneProblems(change), field).toEqual([`0 ${field}`]);
  });

  it('范围的边界值算合格', () => {
    const ok = editScene((s) => {
      s.terrain.recipe.plainKeep = 0;
      s.terrain.recipe.edgeTaperM = 0;
      s.water.banks.keepOffWallsM = 0;
      s.sections[0].camera.pitch = 0;
      s.sections[1].camera.pitch = 85;
      s.sections[0].camera.fov = 10;
      s.sections[1].camera.fov = 40;
      s.sections[0].camera.closest = 0.5;
      s.sections[1].camera.closest = 1;
      s.sections[0].camera.bearing = 360;
      s.sections[1].camera.targetUpM = 0;
    });
    expect(all(ok)).toEqual([]);
  });

  it('两处要拿两个数比着看的：算山的海拔要比算平地的高，土丘的外圈要比内圈大', () => {
    expect(sceneProblems((s) => (s.terrain.recipe.hillAboveM = 47))).toEqual(['0 terrain.recipe.hillAboveM']);
    expect(sceneProblems((s) => ((s.terrain.edits[2] as { outerM: number }).outerM = 40))).toEqual(['0 terrain.edits[2].outerM']);
  });

  it('坐标写得不对，算在规则 1 上', () => {
    expect(sceneProblems((s) => (s.things[0].line![1] = [30.002, 110]))).toEqual(['1 things[0].line[1]']);
    expect(looseProblems<{ places: { at: unknown }[] }>((scene) => (scene.places[0].at = [110.01]))).toEqual(['1 places[0].at']);
    expect(sceneProblems((s) => (s.sections[2].camera.target = [200, 30]))).toEqual(['1 sections[2].camera.target']);
  });

  it('场景文件不是合法的 JSON', () => {
    expect(all(withFile(SCENE, '{ "stopId": "river", '))).toEqual([`0 ${SCENE}`]);
  });

  it('scenes/ 里不是 .json 的文件不当成场景', () => {
    expect(all(withFile('figures/demo/scenes/notes.txt', '随手记的'))).toEqual([]);
  });
});

describe('规则 10 场景文件', () => {
  it('合格的样本通过', () => {
    expect(fields(GOOD, 10, SCENE)).toEqual([]);
  });

  it('出错的样本：stopId 和文件名不一样、样式没有、credits 是空的、山高不是统一夸大、地形文件不存在、盖不住沙盘的东边', () => {
    expect(fields(BAD, 10, BAD_SCENE)).toEqual(['stopId', 'style', 'credits', 'frame.relief.kind', 'terrain.file', 'terrain.east']);
  });

  it('stopId 和文件名不一样', () => {
    expect(sceneProblems((s) => (s.stopId = 'lake'))).toEqual(['10 stopId']);
  });

  it('这一站在 figure.json 里没有', () => {
    const scene = goodScene();
    scene.stopId = 'lake';
    scene.terrain.file = 'lake.terrain.bin';
    const unknown = validateContent({ ...GOOD, 'figures/demo/scenes/lake.json': JSON.stringify(scene), 'figures/demo/scenes/lake.terrain.bin': '' }, SIZES);
    expect(unknown.map((v) => `${v.rule} ${v.file}｜${v.problem}`)).toEqual(['10 figures/demo/scenes/lake.json｜figure.json 里没有 id 是“lake”的站，这个场景文件对不上任何一站']);
  });

  it('还是 outline 的站可以有沙盘：沙盘可以比正文先做好（出处写在场景文件自己的 sources 里）', () => {
    expect(OUTLINE_STOP_STATUS).toBe('outline');
    expect(all(outlineFiles())).toEqual([]);
    // 工具做的那两样照旧要有（规则 17、18）：没有的时候，开关开着就报，名字在“还没做出来”的表里就不报
    const required = validateContent(outlineFiles(), SIZES, {}, {}, true).map((v) => `${v.rule} ${v.file}`);
    expect(required).toEqual(['17 figures/demo/baked/pass.json', '18 figures/demo/stills/pass.json']);
    expect(validateAll(outlineFiles(), SIZES, {}, {}, true, ['demo/pass']).filter((v) => v.file.includes('/pass'))).toEqual([]);
  });

  it('style 不是程序里有的样式', () => {
    expect(looseProblems<{ style: string }>((scene) => (scene.style = 'tang-gold'))).toEqual(['10 style']);
  });

  it('credits 一条也没有，或者有一条是空的', () => {
    expect(sceneProblems((s) => (s.credits = []))).toEqual(['10 credits']);
    expect(sceneProblems((s) => s.credits.push('  '))).toEqual(['10 credits[1]']);
  });

  it('站点沙盘的山高只能是统一夸大：矮山多夸的写法通不过', () => {
    const files = edit<{ frame: { relief: unknown } }>(SCENE, (scene) => (scene.frame.relief = { kind: 'low-more', lowTimes: 25, above: 300, power: 0.6 }));
    expect(validateContent(files, SIZES).map((v) => `${v.rule} ${v.field}｜${v.problem}`)).toEqual([
      '10 frame.relief.kind｜站点沙盘的山高只有统一夸大一种写法（kind 写 uniform），现在是“low-more”',
    ]);
  });

  it('地形文件不存在，或者名字不是 <站>.terrain.bin', () => {
    expect(all(without(TERRAIN))).toEqual([`10 ${SCENE} › terrain.file`]);
    expect(sceneProblems((s) => (s.terrain.file = 'river.bin'))).toEqual(['10 terrain.file']);
    expect(sceneProblems((s) => (s.terrain.file = '../images/boat.svg'))).toEqual(['10 terrain.file']);
    // 文件在，名字却不是 <站>.terrain.bin：程序只认这个名字，读不到它，这一站就没有沙盘了。
    const renamed = { ...editScene((s) => (s.terrain.file = 'river.bin')), 'figures/demo/scenes/river.bin': '' };
    const found = validateContent(renamed, SIZES);
    expect(found.map((v) => `${v.rule} ${v.field}｜${v.problem}`)).toEqual(['10 terrain.file｜地形文件应该叫 river.terrain.bin，和场景文件放在一起，现在写的是“river.bin”']);
  });

  it('地形文件的大小不是 行 × 列 × 2 字节', () => {
    const found = validateContent(GOOD, { ...SIZES, [TERRAIN]: 130 });
    expect(found.map((v) => `${v.rule} ${v.field}｜${v.problem}`)).toEqual(['10 terrain.file｜地形文件有 130 字节；按 8 行 × 8 列、每个数 2 字节算，应该正好是 128 字节']);
    expect(sceneProblems((s) => (s.terrain.cols = 9))).toEqual(['10 terrain.file']);
  });

  it('地形文件超过 1.5 MB', () => {
    const files = editScene((s) => {
      s.terrain.cols = 1000;
      s.terrain.rows = 1000;
    });
    const found = validateContent(files, { ...SIZES, [TERRAIN]: 2_000_000 });
    expect(found.map((v) => `${v.rule} ${v.field}｜${v.problem}`)).toEqual(['10 terrain.file｜地形文件有 1.91 MB，不能超过 1.5 MB']);
    // 正好 1.5 MB，规则 10 算合格。（这时候再加上先画好的两张图，三个文件合计就超了：那是规则 17 的事，它报一处。）
    const edge = editScene((s) => {
      s.terrain.cols = 1024;
      s.terrain.rows = 768;
    });
    expect(TERRAIN_MAX_BYTES).toBe(1024 * 768 * 2);
    expect(all(edge, { ...SIZES, [TERRAIN]: 1024 * 768 * 2 })).toEqual([`17 ${BAKED}`]);
    // 还没有先画好的地面的沙盘，地形文件正好 1.5 MB 就是一处问题也没有。
    const alone = { ...edge };
    for (const path of [BAKED, COLOUR, FIELDS]) delete alone[path];
    expect(all(alone, { ...SIZES, [TERRAIN]: 1024 * 768 * 2 })).toEqual([]);
  });

  it('没有给出大小的文件不查大小', () => {
    expect(all(editScene((s) => (s.terrain.cols = 9)), {})).toEqual([]);
  });

  it('地形文件盖不住整块沙盘', () => {
    expect(sceneProblems((s) => (s.terrain.east = 110.01))).toEqual(['10 terrain.east']);
    expect(sceneProblems((s) => (s.terrain.west = 109.99))).toEqual(['10 terrain.west']);
    expect(sceneProblems((s) => (s.terrain.south = 29.99))).toEqual(['10 terrain.south']);
    expect(sceneProblems((s) => (s.terrain.north = 30.01))).toEqual(['10 terrain.north']);
    expect(sceneProblems((s) => (s.frame.eastM = 2500))).toEqual(['10 terrain.east']);
    expect(sceneProblems((s) => (s.terrain.west = 110.03))).toEqual(['10 terrain.west']);
  });
});

describe('规则 11 范围', () => {
  it('合格的样本通过：河的线和路的线伸到了沙盘外面，不算错', () => {
    expect(fields(GOOD, 11, SCENE)).toEqual([]);
    const scene = goodScene();
    expect(scene.water.rivers[0].line[0]).toEqual([110.004, 30.02]);
    expect(scene.dressing[3]).toMatchObject({ kind: 'roads', line: [[109.998, 29.9974], [109.998, 29.98]] });
  });

  it('出错的样本：土丘的中心、一样摆件、镜头对准的点在沙盘外面；远处却在沙盘里面', () => {
    expect(fields(BAD, 11, BAD_SCENE)).toEqual(['terrain.edits[1].at', 'things[6].at', 'sections[0].camera.target', 'far[0].at']);
  });

  it('该在沙盘里面的点，哪一种跑到外面都查得出', () => {
    const outside: [number, number] = [110.02, 30.004];
    const cases: [string, (scene: StopScene) => void][] = [
      ['terrain.edits[1].area[0]', (s) => ((s.terrain.edits[1] as { area: [number, number][] }).area[0] = [109.98, 30.008])],
      ['terrain.edits[2].at', (s) => ((s.terrain.edits[2] as { at: [number, number] }).at = outside)],
      ['water.rivers[1].crossings[0]', (s) => (s.water.rivers[1].crossings = [[109.998, 29.98]])],
      ['water.rapids[0].at', (s) => (s.water.rapids[0].at = [110.0046, 29.985])],
      ['water.dry[0].area[2]', (s) => (s.water.dry[0].area[2] = [110, 29.98])],
      ['places[0].at', (s) => (s.places[0].at = outside)],
      ['things[4].at', (s) => (s.things[4].at = outside)],
      ['things[3].line[1]', (s) => (s.things[3].line![1] = [109.9995, 29.98])],
      ['dressing[2].at', (s) => (s.dressing[2].at = [110.004, 29.98])],
      ['dressing[1].line[0]', (s) => (s.dressing[1].line![0] = [110.003, 30.02])],
      ['strips[1].at', (s) => (s.strips[1].at = [110.004, 30.015])],
      ['sections[2].camera.target', (s) => (s.sections[2].camera.target = outside)],
    ];
    for (const [field, change] of cases) expect(sceneProblems(change), field).toEqual([`11 ${field}`]);
  });

  it('点缀的一块地方跑到外面', () => {
    const files = editScene((s) => {
      delete s.dressing[4].params;
      s.dressing[4].area = [
        [110.008, 30.006],
        [110.02, 30.006],
        [110.012, 30.002],
      ];
    });
    expect(all(files)).toEqual([`11 ${SCENE} › dressing[4].area[1]`]);
  });

  it('树的规则写的“这几圈里不种”（exceptAreas）：圈在沙盘里面的通过；哪一圈的哪一个点跑到外面都查得出', () => {
    /** 样本里一圈在沙盘里面的线（一处修整的范围），抄一份。 */
    const ringOf = (s: StopScene): [number, number][] => {
      const found = s.terrain.edits.find((e) => e.id === 'low-field');
      if (found?.op !== 'level' || !found.area) throw new Error('样本里没有 low-field');
      return found.area.map((p): [number, number] => [p[0], p[1]]);
    };
    /** 加一条树的规则（样本里排第六条），不种的圈是 rings 给的。 */
    const grove = (rings: (s: StopScene) => [number, number][][]) => (s: StopScene): void => {
      s.dressing.push({ id: 'a-grove', name: '一片树', kind: 'trees', at: ringOf(s)[0], exceptAreas: rings(s), class: 'dressing', basis: '只表示有树。', sourceIds: [] });
    };
    const moved = (ring: [number, number][], j: number, to: [number, number]): [number, number][] => ring.map((p, k) => (k === j ? to : p));
    expect(goodScene().dressing).toHaveLength(5);
    // 圈在沙盘里面（一圈、两圈）：通过；紧挨着边（在东北角里面几米）的点也通过，和别的点一样
    expect(sceneProblems(grove((s) => [ringOf(s)]))).toEqual([]);
    expect(sceneProblems(grove((s) => [ringOf(s), ringOf(s)]))).toEqual([]);
    expect(sceneProblems(grove((s) => [moved(ringOf(s), 0, [110.0155, 30.0108])]))).toEqual([]);
    // 第一圈的第二个点写到了沙盘东边外面
    expect(sceneProblems(grove((s) => [moved(ringOf(s), 1, [110.02, 30.004])]))).toEqual(['11 dressing[5].exceptAreas[0][1]']);
    // 第二圈的第一个点，纬度写错了一位数
    expect(sceneProblems(grove((s) => [ringOf(s), moved(ringOf(s), 0, [110.004, 31.004])]))).toEqual(['11 dressing[5].exceptAreas[1][0]']);
    // 整圈都挪到了外面：每个点各报一条，话里说的是哪一条规则的第几圈、第几个点
    const away = validateContent(editScene(grove((s) => [ringOf(s).map((p): [number, number] => [p[0] + 0.05, p[1]])])), SIZES).filter((v) => v.rule === 11);
    expect(away.map((v) => v.field)).toEqual(ringOf(goodScene()).map((_, j) => `dressing[5].exceptAreas[0][${j}]`));
    expect(away[0].problem).toContain('点缀“a-grove”不种的第 1 圈的第 1 个点在沙盘外面');
  });

  it('远处的地点在沙盘里面', () => {
    const found = validateContent(editScene((s) => (s.far[0].at = [110.005, 29.995])), SIZES);
    expect(found.map((v) => `${v.rule} ${v.field}`)).toEqual(['11 far[0].at']);
    expect(found[0].problem).toContain('远处“far-port”在沙盘里面');
  });

  it('说出沙盘的范围，四个数都往里收：照着写的点一定在沙盘里面', () => {
    // 沙盘的东边在经度 110.01556，西边 109.98444，南边在纬度 29.98918，北边 30.01082。
    const found = validateContent(editScene((s) => (s.places[0].at = [110.02, 30.004])), SIZES);
    expect(found[0].problem).toBe('地名点“east-hill”在沙盘外面；沙盘的范围是经度 109.9845 到 110.0155、纬度 29.9892 到 30.0108');
    expect(sceneProblems((s) => (s.places[0].at = [110.0155, 30.0108]))).toEqual([]);
    expect(sceneProblems((s) => (s.places[0].at = [109.9845, 29.9892]))).toEqual([]);
    // 四舍五入出来的 110.0156 已经在东边外面 4 米了。
    expect(sceneProblems((s) => (s.places[0].at = [110.0156, 30.004]))).toEqual(['11 places[0].at']);
    expect(sceneProblems((s) => (s.water.dry[0].area[2] = [110, 29.9891]))).toEqual(['11 water.dry[0].area[2]']);
  });
});

describe('规则 12 类别和依据', () => {
  it('合格的样本通过：示意的和点缀可以不填出处', () => {
    expect(fields(GOOD, 12, SCENE)).toEqual([]);
    const scene = goodScene();
    expect(scene.things[0]).toMatchObject({ class: 'schematic', sourceIds: [] });
    expect(scene.dressing[0]).toMatchObject({ class: 'dressing', sourceIds: [] });
    expect(scene.dressing[2]).toMatchObject({ class: 'text', sourceIds: ['s1'] });
  });

  it('出错的样本：出处找不到、类别写错、没有依据、该有出处的没有、点缀规则归成了示意、recipe 和 levels 没有 note', () => {
    expect(fields(BAD, 12, BAD_SCENE)).toEqual([
      'terrain.sourceIds[0]',
      'water.levels.class',
      'water.levels.basis',
      'water.banks.sourceIds',
      'dressing[0].class',
      'terrain.recipe.note',
      'water.levels.note',
      'notDrawn[0].sourceIds[0]',
    ]);
  });

  it('类别不是五类之一', () => {
    const files = edit<{ things: { class: string }[] }>(SCENE, (scene) => (scene.things[0].class = '示意'));
    const found = validateContent(files, SIZES);
    expect(found.map((v) => `${v.rule} ${v.field}`)).toEqual(['12 things[0].class']);
    expect(found[0].problem).toBe('摆件“wall”的类别是“示意”，只能是 real（真的）、today（今天的位置）、text（按史料摆的）、schematic（示意的）、dressing（点缀）之一');
  });

  it('依据是空的：带类别的十二处，哪一处都查', () => {
    const cases: [string, (scene: StopScene) => void][] = [
      ['terrain', (s) => (s.terrain.basis = '')],
      ['terrain.recipe', (s) => (s.terrain.recipe.basis = '')],
      ['terrain.edits[1]', (s) => (s.terrain.edits[1].basis = '')],
      ['water.levels', (s) => (s.water.levels.basis = '')],
      ['water.banks', (s) => (s.water.banks.basis = '')],
      ['water.rivers[0]', (s) => (s.water.rivers[0].basis = ' ')],
      ['water.rapids[0]', (s) => (s.water.rapids[0].basis = '')],
      ['water.dry[0]', (s) => (s.water.dry[0].basis = '')],
      ['places[0]', (s) => (s.places[0].basis = '')],
      ['things[3]', (s) => (s.things[3].basis = '\n')],
      ['dressing[1]', (s) => (s.dressing[1].basis = '')],
      ['far[0]', (s) => (s.far[0].basis = '')],
    ];
    for (const [path, change] of cases) expect(sceneProblems(change), path).toEqual([`12 ${path}.basis`]);
  });

  it('真的、今天的位置、按史料摆的，没有出处', () => {
    expect(sceneProblems((s) => (s.places[0].sourceIds = []))).toEqual(['12 places[0].sourceIds']);
    expect(sceneProblems((s) => (s.far[0].sourceIds = []))).toEqual(['12 far[0].sourceIds']);
    expect(sceneProblems((s) => (s.things[1].sourceIds = []))).toEqual(['12 things[1].sourceIds']);
    expect(sceneProblems((s) => (s.things[0].class = 'text'))).toEqual(['12 things[0].sourceIds']);
  });

  it('出处在这一站的 sources 里找不到', () => {
    expect(sceneProblems((s) => (s.things[1].sourceIds = ['s1', 's7']))).toEqual(['12 things[1].sourceIds[1]']);
    expect(sceneProblems((s) => (s.notDrawn[0].sourceIds = ['s7']))).toEqual(['12 notDrawn[0].sourceIds[0]']);
  });

  it('这一站的 .json 读不出来时，出处在不在先不查', () => {
    expect(all(withFile(STOP, '{ "stopId": '))).toEqual([`0 ${STOP}`]);
  });

  it('写好了正文的站（complete），场景文件不能再写一份 sources', () => {
    const stopSources = (JSON.parse(GOOD[STOP]) as { sources: Source[] }).sources;
    expect(sceneProblems((s) => (s.sources = stopSources))).toEqual(['12 sources']);
    expect(sceneProblems((s) => (s.sources = []))).toEqual(['12 sources']);
    const found = validateContent(editScene((s) => (s.sources = [])), SIZES);
    expect(found[0].problem).toBe('“river”这一站的正文写好了（figure.json 里是 complete），出处在 stops/river.json 的 sources 里，场景文件不能再写一份：把它们原样挪过去，id 不变');
  });

  it('还没写正文的站（outline），出处在场景文件自己的 sources 里：没写只报这一处；写了就照它查', () => {
    // 没写：只报一处，不把每样东西的出处都报成“找不到”
    expect(outlineProblems((s) => delete s.sources)).toEqual(['12 sources']);
    const found = validateContent(outlineFiles((s) => delete s.sources), SIZES);
    expect(found[0].problem).toBe('“pass”这一站的正文还没写（figure.json 里是 outline），没有 stops/pass.json；沙盘的出处要写在场景文件自己的 sources 里');
    // 写了一份空的：真的、今天的位置、按史料摆的那些出处就都找不到了（样本里不止一处）
    const empty = outlineProblems((s) => (s.sources = []));
    expect(empty.length).toBeGreaterThan(3);
    expect(empty.every((line) => /^12 .+\.sourceIds\[\d+\]$/.test(line)), empty.join('\n')).toBe(true);
    // 一个 id 不在里面
    expect(outlineProblems((s) => (s.things[1].sourceIds = ['s1', 's7']))).toEqual(['12 things[1].sourceIds[1]']);
    expect(outlineProblems((s) => (s.notDrawn[0].sourceIds = ['s7']))).toEqual(['12 notDrawn[0].sourceIds[0]']);
    const missing = validateContent(outlineFiles((s) => (s.things[1].sourceIds = ['s1', 's7'])), SIZES, {}, {}, false);
    expect(missing[0].problem).toBe('摆件“gate-south”的出处“s7”在这个文件的 sources 里找不到');
  });

  it('场景文件自己的 sources：id 不重复、不空，依据是三种之一，出处写了', () => {
    expect(outlineProblems((s) => s.sources?.push({ id: 's1', basis: 'record', cite: '又一条' }))).toEqual(['12 sources[2].id']);
    expect(outlineProblems((s) => s.sources?.push({ id: ' ', basis: 'record', cite: '没有 id 的一条' }))).toEqual(['12 sources[2].id']);
    expect(outlineProblems((s) => s.sources?.push({ id: 's9', basis: 'editor' as Source['basis'], cite: '依据不对的一条' }))).toEqual(['12 sources[2].basis']);
    expect(outlineProblems((s) => s.sources?.push({ id: 's9', basis: 'later', cite: '  ' }))).toEqual(['12 sources[2].cite']);
    // 多写一条没人用的出处不算错
    expect(outlineProblems((s) => s.sources?.push({ id: 's9', basis: 'later', cite: '没人用的一条' }))).toEqual([]);
  });

  it('outline 的站留着一份 stops/<站>.json：规则 3 报那个文件，场景的出处还是只认场景文件自己的', () => {
    const files = { ...outlineFiles((s) => delete s.sources), 'figures/demo/stops/pass.json': GOOD[STOP].replace('"river"', '"pass"') };
    expect(all(files)).toEqual(['3 figures/demo/stops/pass.json', `12 ${OUTLINE_SCENE} › sources`]);
  });

  it('点缀规则的类别只能是点缀或按史料摆的', () => {
    expect(sceneProblems((s) => (s.dressing[0].class = 'schematic'))).toEqual(['12 dressing[0].class']);
    expect(sceneProblems((s) => Object.assign(s.dressing[0], { class: 'real', sourceIds: ['s2'] }))).toEqual(['12 dressing[0].class']);
  });

  it('unsure 要能接在“某某的”后面：不能是半句话，末尾不带标点', () => {
    // 页面把它拼成“南门的〈unsure〉是示意”。
    expect(unsureProblem('位置')).toBeNull();
    expect(unsureProblem('位置（在南墙的哪一点）')).toBeNull();
    expect(unsureProblem('层数、高矮和在东墙的哪一点')).toBeNull();
    expect(unsureProblem('数目和系在哪一面')).toBeNull();
    expect(unsureProblem('  ')).toBeNull();
    for (const bad of ['在南墙的哪一点', '搭在哪一段城墙', '系在哪一面', '从哪里来', '到哪里为止', '山比平地高出多少', '位置。', '位置，']) {
      expect(unsureProblem(bad), bad).not.toBeNull();
      expect(sceneProblems((s) => (s.things[1].unsure = bad)), bad).toEqual(['12 things[1].unsure']);
    }
    expect(sceneProblems((s) => (s.water.rivers[1].unsure = '在哪'))).toEqual(['12 water.rivers[1].unsure']);
    expect(sceneProblems((s) => (s.terrain.edits[0].unsure = '山比平地高出多少'))).toEqual(['12 terrain.edits[0].unsure']);
    const found = validateContent(editScene((s) => (s.things[1].unsure = '在南墙的哪一点')), SIZES);
    expect(found.map((v) => v.problem)).toEqual(['摆件“gate-south”的 unsure 是“在南墙的哪一点”，接在“某某的”后面读不通；写成一个词组，比如“位置（在南墙的哪一点）”']);
  });

  it('recipe 和 levels 必须写 note', () => {
    expect(sceneProblems((s) => delete s.terrain.recipe.note)).toEqual(['12 terrain.recipe.note']);
    // 水位的 note 没了，“河上”那一节的 explain 点到了水位，规则 14 也跟着报。
    expect(sceneProblems((s) => (s.water.levels.note = '  '))).toEqual(['12 water.levels.note', '14 sections[1].explain[0]']);
  });
});

describe('规则 13 零件', () => {
  it('合格的样本通过', () => {
    expect(fields(GOOD, 13, SCENE)).toEqual([]);
  });

  it('出错的样本：id、修整、急滩、参数、位置、on、点缀的位置和 kind，各有各的错', () => {
    expect(fields(BAD, 13, BAD_SCENE)).toEqual([
      'things[7].id',
      'things[8].id',
      'terrain.edits[0]',
      'terrain.edits[0].inside',
      'water.rapids',
      'water.rapids[1].river',
      'things[0].params.face',
      'things[0].params.colour',
      'things[0].line',
      'things[1].on',
      'things[3].on',
      'things[4].params.halls',
      'things[5].on',
      'things[8].kind',
      'dressing[0]',
      'dressing[1]',
      'dressing[2].params.count',
      'dressing[2].area',
      'dressing[3].kind',
    ]);
  });

  it('id 在整个文件里重复，或者用了留用的词', () => {
    const found = validateContent(editScene((s) => (s.dressing[4].id = 'wall')), SIZES);
    expect(found.map((v) => `${v.rule} ${v.field}｜${v.problem}`)).toEqual(['13 dressing[4].id｜id“wall”和 things[0] 重复了；带 id 的东西，id 在整个场景文件里不能重复']);
    expect(sceneProblems((s) => (s.water.dry[0].id = 'knoll'))).toEqual(['13 water.dry[0].id']);
    for (const word of ['frame', 'terrain', 'recipe', 'levels', 'banks']) {
      expect(sceneProblems((s) => (s.dressing[4].id = word)), word).toEqual(['13 dressing[4].id']);
    }
    expect(sceneProblems((s) => (s.dressing[4].id = ''))).toEqual(['13 dressing[4].id']);
  });

  it('带名字的东西名字不能空着；没有画的东西要写为什么不画', () => {
    // 名字印在沙盘旁边的说明和凭据里。
    const cases: [string, (scene: StopScene) => void][] = [
      ['terrain.edits[0].name', (s) => (s.terrain.edits[0].name = '')],
      ['water.rivers[0].name', (s) => (s.water.rivers[0].name = '  ')],
      ['water.rapids[0].name', (s) => (s.water.rapids[0].name = '')],
      ['water.dry[0].name', (s) => (s.water.dry[0].name = '')],
      ['places[0].name', (s) => (s.places[0].name = '')],
      ['things[0].name', (s) => (s.things[0].name = '')],
      ['dressing[0].name', (s) => (s.dressing[0].name = '')],
      ['far[0].name', (s) => (s.far[0].name = ' ')],
      ['notDrawn[0].name', (s) => (s.notDrawn[0].name = '')],
    ];
    for (const [field, change] of cases) expect(sceneProblems(change), field).toEqual([`13 ${field}`]);
    // “渡口”那一节的 explain 点到了这样没有画的东西，规则 14 也跟着报。
    expect(sceneProblems((s) => (s.notDrawn[0].why = '  '))).toEqual(['13 notDrawn[0].why', '14 sections[2].explain[1]']);
    // 没有哪一节点到它，也一样要写。
    expect(
      sceneProblems((s) => {
        s.sections[2].explain = ['far-port'];
        s.notDrawn[0].why = '';
      }),
    ).toEqual(['13 notDrawn[0].why']);
  });

  it('kind 不是零件库里有的', () => {
    expect(looseProblems<{ things: { kind: string }[] }>((scene) => (scene.things[4].kind = 'bridge'))).toEqual(['13 things[4].kind']);
    expect(looseProblems<{ dressing: { kind: string }[] }>((scene) => (scene.dressing[4].kind = 'grass'))).toEqual(['13 dressing[4].kind']);
  });

  it('参数表里没有的参数', () => {
    const found = validateContent(editScene((s) => (s.things[0].params = { face: 'earth', colour: 'red' })), SIZES);
    expect(found.map((v) => `${v.rule} ${v.field}｜${v.problem}`)).toEqual(['13 things[0].params.colour｜wall 这种零件没有“colour”这个参数；可以写的是：face、parapet']);
    expect(sceneProblems((s) => (s.dressing[0].params = { lanes: true, storeys: 2 }))).toEqual(['13 dressing[0].params.storeys']);
    // 名字碰巧和对象自带的东西一样，也不认。
    expect(sceneProblems((s) => (s.things[0].params = { toString: 'x' }))).toEqual(['13 things[0].params.toString']);
  });

  it('参数的类型不对', () => {
    expect(sceneProblems((s) => (s.things[2].params = { storeys: '2' }))).toEqual(['13 things[2].params.storeys']);
    expect(sceneProblems((s) => (s.things[0].params = { parapet: 'yes' }))).toEqual(['13 things[0].params.parapet']);
    expect(sceneProblems((s) => (s.things[0].params = { face: 'stone' }))).toEqual(['13 things[0].params.face']);
    expect(sceneProblems((s) => (s.things[0].params = { face: true }))).toEqual(['13 things[0].params.face']);
    // 竹（bamboo）现在有了；棕榈还没有
    expect(sceneProblems((s) => (s.dressing[1].params = { type: 'palm' }))).toEqual(['13 dressing[1].params.type']);
    expect(sceneProblems((s) => {
      // 样本里这一条树是沿一条线种的；竹要写在一个点周围或者一块地方里（见后面“竹和柏”那一条）
      delete s.dressing[1].line;
      s.dressing[1].at = s.things[4].at;
      s.dressing[1].params = { type: 'bamboo' };
    })).toEqual([]);
    expect(sceneProblems((s) => (s.dressing[2].params = { count: '3' }))).toEqual(['13 dressing[2].params.count']);
  });

  it('“这几处不种”（except）只有树的规则可以写，写的是带着一圈范围的修整的 id', () => {
    // dressing[1] 是树，low-field 是带 area 的 level 修整：可以
    expect(sceneProblems((s) => (s.dressing[1].except = ['low-field']))).toEqual([]);
    // 民居不能写
    expect(sceneProblems((s) => (s.dressing[0].except = ['low-field']))).toEqual(['13 dressing[0].except']);
    // 没有这处修整；城里的地面写的是 inside，没有自己的一圈；垫高的小冈不是 level
    expect(sceneProblems((s) => (s.dressing[1].except = ['nowhere']))).toEqual(['13 dressing[1].except[0]']);
    expect(sceneProblems((s) => (s.dressing[1].except = ['low-field', 'city-ground', 'knoll']))).toEqual(['13 dressing[1].except[1]', '13 dressing[1].except[2]']);
  });

  it('参数可以一个都不写', () => {
    const files = editScene((s) => {
      for (const thing of s.things) delete thing.params;
      for (const rule of s.dressing) delete rule.params;
    });
    expect(all(files)).toEqual([]);
  });

  it('城墙是一圈至少三个点的线，最后一点不重复第一点', () => {
    expect(sceneProblems((s) => (s.things[0].line = s.things[0].line!.slice(0, 2)))).toEqual(['13 things[0].line']);
    expect(sceneProblems((s) => s.things[0].line!.push(s.things[0].line![0]))).toEqual(['13 things[0].line']);
    // 五个角的城墙也行。
    expect(sceneProblems((s) => s.things[0].line!.splice(1, 0, [109.998, 30.0025]))).toEqual([]);
  });

  it('位置是一个点的写了 line，是一条线的写了 at', () => {
    const pointAsLine = editScene((s) => {
      s.things[4].line = [s.things[4].at!, [110.0099, 30.0039]];
      delete s.things[4].at;
    });
    expect(all(pointAsLine)).toEqual([`13 ${SCENE} › things[4].at`, `13 ${SCENE} › things[4].line`]);
    const lineAsPoint = editScene((s) => {
      s.things[3].at = s.things[3].line![0];
      delete s.things[3].line;
    });
    expect(all(lineAsPoint)).toEqual([`13 ${SCENE} › things[3].at`, `13 ${SCENE} › things[3].line`]);
    expect(sceneProblems((s) => (s.things[3].line = [s.things[3].line![0]]))).toEqual(['13 things[3].line']);
  });

  it('城门必须写 on', () => {
    expect(sceneProblems((s) => delete s.things[1].on)).toEqual(['13 things[1].on']);
  });

  it('on 指的东西不存在，或者种类不对', () => {
    expect(sceneProblems((s) => (s.things[2].on = 'gate-north'))).toEqual(['13 things[2].on']);
    expect(sceneProblems((s) => (s.things[2].on = 'pavilion'))).toEqual(['13 things[2].on']);
    expect(sceneProblems((s) => (s.things[1].on = 'gate-tower'))).toEqual(['13 things[1].on']);
    // 城墙只能摆在地上。
    expect(sceneProblems((s) => (s.things[0].on = 'gate-south'))).toEqual(['13 things[0].on']);
    // 楼可以在城门上，也可以直接在城墙上；堤写了 on 是贴在城墙里侧。
    expect(sceneProblems((s) => (s.things[2].on = 'wall'))).toEqual([]);
    expect(sceneProblems((s) => (s.things[3].on = 'wall'))).toEqual([]);
  });

  it('这样东西有的小节里，它摆在上面的东西也要有', () => {
    const found = validateContent(editScene((s) => (s.things[1].when = { from: '渡口' })), SIZES);
    expect(found.map((v) => `${v.rule} ${v.field}｜${v.problem}`)).toEqual([
      '13 things[2].on｜小节“河上”里有摆件“gate-tower”，却没有它摆在上面的“gate-south”；两样东西的 when 要对得上',
    ]);
    // 前后接上的两座门、各带一座楼，是合格的。
    const relay = editScene((s) => {
      s.things[1].when = { until: '上船' };
      s.things.push({ ...s.things[1], id: 'gate-south-new', when: { from: '河上' }, params: { face: 'brick', big: true } });
      s.things[2].on = 'gate-south-new';
    });
    expect(all(relay)).toEqual([]);
  });

  it('点缀的位置最多写一种', () => {
    expect(sceneProblems((s) => (s.dressing[0].at = [109.998, 30]))).toEqual(['13 dressing[0]']);
  });

  it('点缀的位置用了这种点缀不能用的写法', () => {
    const found = validateContent(editScene((s) => delete s.dressing[0].inside), SIZES);
    expect(found.map((v) => `${v.rule} ${v.field}｜${v.problem}`)).toEqual([
      '13 dressing[0]｜点缀“homes”是 houses，不能摆满整块沙盘；位置要写 inside（一道城墙里面），或 area（一块地方）',
    ]);
    const boats = editScene((s) => {
      delete s.dressing[2].at;
      s.dressing[2].inside = 'wall';
    });
    expect(all(boats)).toEqual([`13 ${SCENE} › dressing[2].inside`]);
    const fieldsAlongLine = editScene((s) => {
      s.dressing[4].kind = 'fields';
      delete s.dressing[4].params;
      s.dressing[4].line = [
        [110.008, 30.006],
        [110.012, 30.002],
      ];
    });
    expect(all(fieldsAlongLine)).toEqual([`13 ${SCENE} › dressing[4].line`]);
  });

  it('点缀的 inside 要写一道城墙；一块地方至少三个点；沿着的线至少两个点', () => {
    expect(sceneProblems((s) => (s.dressing[0].inside = 'gate-south'))).toEqual(['13 dressing[0].inside']);
    expect(sceneProblems((s) => (s.dressing[0].inside = 'old-wall'))).toEqual(['13 dressing[0].inside']);
    expect(sceneProblems((s) => (s.dressing[1].line = [s.dressing[1].line![0]]))).toEqual(['13 dressing[1].line']);
    const smallArea = editScene((s) => {
      delete s.dressing[0].inside;
      s.dressing[0].area = [
        [109.997, 30.001],
        [109.999, 30.001],
      ];
    });
    expect(all(smallArea)).toEqual([`13 ${SCENE} › dressing[0].area`]);
  });

  it('修整的 area 和 inside 正好写一个', () => {
    const both = edit<{ terrain: { edits: { area: unknown }[] } }>(SCENE, (scene) => {
      scene.terrain.edits[0].area = [
        [109.997, 30.001],
        [109.999, 30.001],
        [109.999, 29.999],
      ];
    });
    expect(all(both)).toEqual([`13 ${SCENE} › terrain.edits[0]`]);
    const neither = edit<{ terrain: { edits: { inside?: string }[] } }>(SCENE, (scene) => delete scene.terrain.edits[0].inside);
    expect(all(neither)).toEqual([`13 ${SCENE} › terrain.edits[0]`]);
  });

  it('修整的 inside 要写一道城墙；area 至少三个点', () => {
    const notWall = edit<{ terrain: { edits: { inside: string }[] } }>(SCENE, (scene) => (scene.terrain.edits[0].inside = 'gate-south'));
    expect(all(notWall)).toEqual([`13 ${SCENE} › terrain.edits[0].inside`]);
    const twoPoints = edit<{ terrain: { edits: { area: unknown[] }[] } }>(SCENE, (scene) => scene.terrain.edits[1].area.splice(2));
    expect(all(twoPoints)).toEqual([`13 ${SCENE} › terrain.edits[1].area`]);
  });

  it('急滩最多一处，它的 river 是文件里有的河', () => {
    expect(sceneProblems((s) => s.water.rapids.push({ ...s.water.rapids[0], id: 'shoal-2', at: [110.004, 30.004] }))).toEqual(['13 water.rapids']);
    expect(sceneProblems((s) => (s.water.rapids[0].river = 'short-river'))).toEqual(['13 water.rapids[0].river']);
    expect(sceneProblems((s) => (s.water.rapids = []))).toEqual([]);
  });

  it('河的中线至少两个点；水漫不进去的地方至少三个点', () => {
    expect(sceneProblems((s) => (s.water.rivers[1].line = [[109.9954, 30.002]]))).toEqual(['13 water.rivers[1].line']);
    expect(sceneProblems((s) => s.water.dry[0].area.splice(2))).toEqual(['13 water.dry[0].area']);
  });

  it('没有壕的城也合格', () => {
    expect(sceneProblems((s) => s.water.rivers.splice(1, 1))).toEqual([]);
  });
});

describe('规则 14 小节', () => {
  it('合格的样本通过', () => {
    expect(fields(GOOD, 14, SCENE)).toEqual([]);
  });

  it('出错的样本：小节和正文对不上、没有 normal、没有时间、题记太长、水位没有、explain 和 mustShow 写错、when 写错', () => {
    expect(fields(BAD, 14, BAD_SCENE)).toEqual([
      'sections',
      'sections[1].heading',
      'water.levels.values',
      'sections[0].date',
      'sections[0].line',
      'sections[0].water',
      'sections[0].explain',
      'sections[1].explain[0]',
      'sections[1].explain[1]',
      'sections[1].explain[2]',
      'sections[1].camera.mustShow[1]',
      'sections[2].explain[0]',
      'things[6].when',
      'things[7].when',
      'things[8].when.from',
    ]);
  });

  it('还没写正文的站（outline）没有正文可对：三到六个画面，标题不重复；别的各样照查', () => {
    expect(OUTLINE_SECTIONS).toEqual([3, 6]);
    expect(goodScene().sections).toHaveLength(3);
    expect(outlineProblems(() => {})).toEqual([]);
    /** 在后面添几个画面：照头一个抄，名字另起。 */
    const more = (count: number) => (s: StopScene) => {
      for (let i = 0; i < count; i += 1) s.sections.push({ ...s.sections[0], heading: `另一处${i + 1}` });
    };
    expect(outlineProblems(more(3))).toEqual([]);
    expect(outlineProblems(more(4))).toEqual(['14 sections']);
    const seven = validateContent(outlineFiles(more(4)), SIZES, {}, {}, false);
    expect(seven[0].problem).toBe('“pass”这一站的正文还没写，沙盘要有 3 到 6 个画面，现在是 7 个');
    // 两个画面：去掉最后一个（别处提到它的地方跟着报，这里只看“几个画面”这一句）
    const two = validateContent(outlineFiles((s) => s.sections.pop()), SIZES, {}, {}, false).filter((v) => v.rule === 14 && v.field === 'sections');
    expect(two.map((v) => v.problem)).toEqual(['“pass”这一站的正文还没写，沙盘要有 3 到 6 个画面，现在是 2 个']);
    // 写好了正文的站不查这一句：那里小节跟着正文走（样本里正文三节；少一节报的是“正文的小节在场景里没有”，见下一条）
    expect(sceneProblems(() => {})).toEqual([]);
    // 标题重复、题记太长、explain 点到没有的东西：和写好了正文的站一样报
    expect(outlineProblems((s) => (s.sections[2].heading = s.sections[0].heading)).filter((line) => line === '14 sections[2].heading')).toEqual(['14 sections[2].heading']);
    expect(outlineProblems((s) => (s.sections[0].line = '字'.repeat(41)))).toEqual(['14 sections[0].line']);
    expect(outlineProblems((s) => s.sections[0].explain.push('nothing-here'))).toEqual(['14 sections[0].explain[2]']);
    // 留着一份正文（规则 3 报）：场景的小节不拿它来对
    expect(all({ ...outlineFiles(), 'figures/demo/stops/pass.md': '## 山口\n\n还没写完。' })).toEqual(['3 figures/demo/stops/pass.md']);
  });

  it('场景比正文少一节', () => {
    const found = validateContent(editScene((s) => s.sections.pop()), SIZES);
    expect(found.map((v) => `${v.rule} ${v.field}｜${v.problem}`)).toEqual(['14 sections｜正文的小节“渡口”在场景里没有；场景的小节要和正文的小节一一对上']);
  });

  it('场景的小节标题和正文差一个字', () => {
    // 标题对不上以后，“从河上起才有”的楼哪一节都不算有，指着它的题签也跟着报（规则 15）。
    expect(sceneProblems((s) => (s.sections[1].heading = '河 上'))).toEqual(['14 sections', '14 sections[1].heading', '15 sections[1].strips', '15 sections[2].strips']);
  });

  it('小节的先后和正文不一样', () => {
    // 先后一乱，“从河上起才有”的楼在排到前面的“渡口”里就不算有了，所以规则 15 也跟着报一处。
    const found = validateContent(editScene((s) => s.sections.reverse()), SIZES);
    expect(found.map((v) => `${v.rule} ${v.field}｜${v.problem}`)).toEqual([
      '14 sections｜小节的先后和正文不一样；正文是：上船、河上、渡口',
      '15 sections[0].strips｜小节“渡口”摆了题签“s-tower”（门楼），但它指的“gate-tower”这一节沙盘上没有',
    ]);
  });

  it('同一个小节写了两次', () => {
    expect(sceneProblems((s) => s.sections.push({ ...s.sections[0] }))).toEqual(['14 sections[3].heading']);
  });

  it('正文改了小节标题，场景没有跟着改', () => {
    const files = withFile(BODY, GOOD[BODY].replace('## 渡口', '## 码头'));
    expect(all(files).filter((line) => line.includes('/scenes/'))).toEqual([`14 ${SCENE} › sections`, `14 ${SCENE} › sections[2].heading`, `14 ${SCENE} › dressing[2].when.only[1]`]);
  });

  it('正文读不出来时，和正文对不对得上先不查', () => {
    expect(all(withFile(BODY, `# 大标题\n\n${GOOD[BODY]}`))).toEqual([`4 ${BODY}`]);
  });

  it('没有时间、没有题记、题记超过 40 个字', () => {
    expect(sceneProblems((s) => (s.sections[0].date = ' '))).toEqual(['14 sections[0].date']);
    expect(sceneProblems((s) => (s.sections[0].line = ''))).toEqual(['14 sections[0].line']);
    const found = validateContent(editScene((s) => (s.sections[0].line = '字'.repeat(41))), SIZES);
    expect(found.map((v) => `${v.rule} ${v.field}｜${v.problem}`)).toEqual(['14 sections[0].line｜小节“上船”的题记有 41 个字，不能超过 40 个']);
    expect(sceneProblems((s) => (s.sections[0].line = '字'.repeat(40)))).toEqual([]);
  });

  it('题签指到远处的小节：题记连同远处的那句话，窄栏的两行要放得下', () => {
    // 汉字算一个字宽，数字、字母、空格算半个。
    expect(textWidth('往西约 145 公里（今河南商丘）')).toBe(3 + 0.5 + 1.5 + 0.5 + 2 + 7);
    const farPort = '东港：往东南约 465 公里（今东港市）';
    const room = Math.floor(WORDS_MAX - 0.5 - textWidth(farPort));
    expect(room).toBeLessThan(40);
    // “渡口”那一节的题签指着远处：题记正好放得下合格，多一个字就不行。
    expect(sceneProblems((s) => (s.sections[2].line = '渡'.repeat(room)))).toEqual([]);
    const found = validateContent(editScene((s) => (s.sections[2].line = '渡'.repeat(room + 1))), SIZES);
    expect(found.map((v) => `${v.rule} ${v.field}｜${v.problem}`)).toEqual([
      `14 sections[2].line｜小节“渡口”的题记后面还要接远处的那句话（${farPort}），合起来有 ${WORDS_MAX + 1} 个字宽，沙盘栏窄的时候两行放不下；不能超过 ${WORDS_MAX} 个字宽，把题记写短一些`,
    ]);
    // 没有指到远处的小节，题记只管不超过 40 个字。
    expect(sceneProblems((s) => (s.sections[0].line = '船'.repeat(40)))).toEqual([]);
  });

  it('水位的名字在 levels.values 里没有', () => {
    const found = validateContent(editScene((s) => (s.sections[2].water = 'high')), SIZES);
    expect(found.map((v) => `${v.rule} ${v.field}｜${v.problem}`)).toEqual(['14 sections[2].water｜小节“渡口”的水位“high”在 water.levels.values 里没有；有的是：normal、flood']);
  });

  it('levels.values 里没有 normal', () => {
    const files = editScene((s) => {
      s.water.levels.values = { calm: 37.6, flood: 43 };
      s.sections[0].water = 'calm';
      s.sections[2].water = 'calm';
    });
    expect(all(files)).toEqual([`14 ${SCENE} › water.levels.values`]);
  });

  it('when 里写的小节标题不是正文里的', () => {
    expect(sceneProblems((s) => (s.things[4].when = { from: '下船' }))).toEqual(['14 things[4].when.from']);
    expect(sceneProblems((s) => (s.things[4].when = { until: '下船' }))).toEqual(['14 things[4].when.until']);
    expect(sceneProblems((s) => (s.dressing[2].when = { only: ['上船', '下船'] }))).toEqual(['14 dressing[2].when.only[1]']);
  });

  it('from 比 until 晚；同一节起、同一节止是合格的', () => {
    expect(sceneProblems((s) => (s.things[4].when = { from: '渡口', until: '上船' }))).toEqual(['14 things[4].when']);
    expect(sceneProblems((s) => (s.things[4].when = { from: '河上', until: '河上' }))).toEqual([]);
  });

  it('when 是空的', () => {
    expect(sceneProblems((s) => (s.things[4].when = {}))).toEqual(['14 things[4].when']);
    expect(sceneProblems((s) => (s.dressing[2].when = { only: [] }))).toEqual(['14 dressing[2].when.only']);
  });

  it('城墙、路、田不能写 when：地面只算一次、只上一次色，不跟着小节变', () => {
    expect(sceneProblems((s) => (s.dressing[3].when = { from: '河上' }))).toEqual(['14 dressing[3].when']);
    // 城墙晚出来，摆在它上面的城门前两节就没了着落，规则 13 也跟着报。
    expect(sceneProblems((s) => (s.things[0].when = { from: '河上' })).filter((problem) => problem.startsWith('14 '))).toEqual(['14 things[0].when']);
    // 田也是画在地面上的：不写 when 合格，写了不行。
    const paddies = { id: 'paddies', name: '城外的田', kind: 'fields' as const, class: 'dressing' as const, basis: '点缀。', sourceIds: [] };
    expect(sceneProblems((s) => s.dressing.push(paddies))).toEqual([]);
    expect(sceneProblems((s) => s.dressing.push({ ...paddies, when: { from: '河上' } }))).toEqual(['14 dressing[5].when']);
    // 别的点缀（船、树、民居）照常可以写。
    expect(sceneProblems((s) => (s.dressing[1].when = { from: '河上' }))).toEqual([]);
  });

  it('explain 一样也没有，或者写的 id 找不到', () => {
    expect(sceneProblems((s) => (s.sections[0].explain = []))).toEqual(['14 sections[0].explain']);
    expect(sceneProblems((s) => s.sections[0].explain.push('nothing'))).toEqual(['14 sections[0].explain[2]']);
    // 题签自己没有类别和依据，不能点；frame 也不能。
    expect(sceneProblems((s) => (s.sections[0].explain = ['wall', 's-town', 'frame']))).toEqual(['14 sections[0].explain[1]', '14 sections[0].explain[2]']);
  });

  it('explain 里点到的东西没有 note', () => {
    const found = validateContent(editScene((s) => (s.sections[0].explain = ['gate-south'])), SIZES);
    expect(found.map((v) => `${v.rule} ${v.field}｜${v.problem}`)).toEqual(['14 sections[0].explain[0]｜“gate-south”没有写 note；explain 里点到的东西都要有一句给读者看的说明']);
    expect(sceneProblems((s) => (s.things[0].note = ' '))).toEqual(['14 sections[0].explain[0]']);
    // 没有画的东西用它的 why。（why 空着本身也不行，规则 13 先报一处。）
    const why = validateContent(editScene((s) => (s.notDrawn[0].why = '')), SIZES);
    expect(why.map((v) => `${v.rule} ${v.field}｜${v.problem}`)).toEqual([
      '13 notDrawn[0].why｜没有画的“old-lock”没有写为什么不画：凭据里要印这一句',
      '14 sections[2].explain[1]｜“old-lock”没有写 why；explain 里点到的东西都要有一句给读者看的说明',
    ]);
  });

  it('explain 可以写 levels、banks、terrain、recipe 四个词，一样要有 note', () => {
    expect(sceneProblems((s) => (s.sections[0].explain = ['levels', 'recipe']))).toEqual([]);
    expect(sceneProblems((s) => (s.sections[0].explain = ['banks', 'terrain']))).toEqual(['14 sections[0].explain[0]', '14 sections[0].explain[1]']);
    const withNotes = editScene((s) => {
      s.water.banks.note = '河岸的高矮是示意。';
      s.terrain.note = '山的位置是真的。';
      s.sections[0].explain = ['banks', 'terrain'];
    });
    expect(all(withNotes)).toEqual([]);
  });

  it('explain 可以点修整、河、急滩、水漫不进去的地方、地名点、点缀、远处，只要有 note', () => {
    const files = editScene((s) => {
      const note = '给读者看的一句话。';
      s.terrain.edits[1].note = note;
      s.water.rapids[0].note = note;
      s.water.dry[0].note = note;
      s.places[0].note = note;
      s.dressing[2].note = note;
      s.sections[0].explain = ['low-field', 'long-river', 'shoal', 'south-yard', 'east-hill', 'ferry-boats', 'far-port'];
    });
    expect(all(files)).toEqual([]);
  });

  it('mustShow 写的 id 找不到', () => {
    expect(sceneProblems((s) => (s.sections[1].camera.mustShow = ['ghost']))).toEqual(['14 sections[1].camera.mustShow[0]']);
    // 修整、没有画的东西、题签都不是沙盘上看得见的一样东西。
    expect(sceneProblems((s) => (s.sections[1].camera.mustShow = ['frame', 'city-ground', 'old-lock', 's-town']))).toEqual([
      '14 sections[1].camera.mustShow[1]',
      '14 sections[1].camera.mustShow[2]',
      '14 sections[1].camera.mustShow[3]',
    ]);
    expect(sceneProblems((s) => (s.sections[1].camera.mustShow = ['frame', 'wall', 'homes', 'east-hill', 'long-river', 'shoal', 'far-port']))).toEqual([]);
  });
});

describe('规则 15 题签', () => {
  it('合格的样本通过', () => {
    expect(fields(GOOD, 15, SCENE)).toEqual([]);
  });

  it('出错的样本：字里有标点和数字、of 找不到、指着城墙没有写 at、at 太远、指的东西那一节没有、重复、没有这条题签、一条也没有', () => {
    expect(fields(BAD, 15, BAD_SCENE)).toEqual([
      'strips[0].text',
      'strips[1].modern',
      'strips[1].of',
      'strips[2].at',
      'strips[3].at',
      'sections[0].strips',
      'sections[0].strips[1]',
      'sections[0].strips[3]',
      'sections[1].strips',
    ]);
  });

  it('text 和 modern 只能是汉字，一到七个', () => {
    for (const text of ['东门。', 'East', '东 门', '东门2', '', '示例城的老城墙上']) {
      expect(sceneProblems((s) => (s.strips[0].text = text)), `text“${text}”`).toEqual(['15 strips[0].text']);
      expect(sceneProblems((s) => (s.strips[0].modern = text)), `modern“${text}”`).toEqual(['15 strips[0].modern']);
    }
    expect(sceneProblems((s) => (s.strips[0].text = '示例城的老城墙'))).toEqual([]);
    expect(sceneProblems((s) => (s.strips[0].text = '城'))).toEqual([]);
  });

  it('of 指的东西找不到', () => {
    const found = validateContent(editScene((s) => (s.strips[3].of = 'west-hill')), SIZES);
    expect(found.map((v) => `${v.rule} ${v.field}｜${v.problem}`)).toEqual(['15 strips[3].of｜题签“s-hill”指的“west-hill”找不到；这里可以写摆件、点缀、地名点、河、急滩、远处的 id']);
    // 修整、水漫不进去的地方、没有画的东西、别的题签，题签都不能指。
    for (const id of ['city-ground', 'south-yard', 'old-lock', 's-town', 'levels']) {
      expect(sceneProblems((s) => (s.strips[3].of = id)), id).toEqual(['15 strips[3].of']);
    }
  });

  it('缺 of 是格式问题', () => {
    expect(looseProblems<{ strips: { of?: string }[] }>((scene) => delete scene.strips[3].of)).toEqual(['0 strips[3].of']);
  });

  it('指着一圈城墙、一条河、一片点缀时必须写 at', () => {
    const found = validateContent(editScene((s) => delete s.strips[0].at), SIZES);
    expect(found.map((v) => `${v.rule} ${v.field}｜${v.problem}`)).toEqual(['15 strips[0].at｜题签“s-town”指的“wall”是一条线或一片地方，要写 at：指在它的哪一点']);
    expect(sceneProblems((s) => delete s.strips[1].at)).toEqual(['15 strips[1].at']);
    expect(sceneProblems((s) => delete s.strips[4].at)).toEqual(['15 strips[4].at']);
    expect(sceneProblems((s) => (s.strips[3].of = 'dike'))).toEqual(['15 strips[3].at']);
    expect(sceneProblems((s) => (s.strips[3].of = 'woods'))).toEqual(['15 strips[3].at']);
    expect(sceneProblems((s) => (s.strips[3].of = 'willows'))).toEqual(['15 strips[3].at']);
  });

  it('指着只有一个点的东西不用写 at：摆件、地名点、急滩、一个点周围的点缀、远处', () => {
    for (const id of ['gate-south', 'east-hill', 'shoal', 'far-port']) {
      expect(sceneProblems((s) => (s.strips[3].of = id)), id).toEqual([]);
    }
    // 渡口的船只在“上船”和“渡口”两节有，题签也只摆在“渡口”一节。
    const boats = editScene((s) => {
      s.strips[3].of = 'ferry-boats';
      s.sections[1].strips = ['s-river', 's-tower'];
      s.sections[2].strips.push('s-hill');
    });
    // 场景本身合格。两节的题签换过了，照旧题签拍的定格图就对不上了：那是规则 18 的事（宽、窄各两张）。
    expect(all(boats)).toEqual([`18 ${STILLS} › stills[1].anchors`, `18 ${STILLS} › stills[2].anchors`, `18 ${STILLS} › stills[4].anchors`, `18 ${STILLS} › stills[5].anchors`]);
    expect(all(withoutMade(boats))).toEqual([]);
  });

  it('at 离它指的东西超过 300 米', () => {
    // 城墙北边 388 米。
    const wall = validateContent(editScene((s) => (s.strips[0].at = [109.998, 30.0055])), SIZES);
    expect(wall.map((v) => `${v.rule} ${v.field}｜${v.problem}`)).toEqual(['15 strips[0].at｜题签“s-town”的 at 离它指的“wall”有 388 米，不能超过 300 米']);
    // 河西边 386 米。
    expect(sceneProblems((s) => (s.strips[1].at = [110, 30]))).toEqual(['15 strips[1].at']);
    // 只有一个点的东西写了 at，也不能离得太远。
    expect(sceneProblems((s) => (s.strips[2].at = [109.998, 30.003]))).toEqual(['15 strips[2].at']);
    expect(sceneProblems((s) => (s.strips[2].at = [109.998, 29.9985]))).toEqual([]);
    // 城里的民居：在城墙里面哪一点都行，出了城墙 300 米以内也行，再远不行。
    expect(sceneProblems((s) => (s.strips[4].at = [109.9965, 30.0015]))).toEqual([]);
    expect(sceneProblems((s) => (s.strips[4].at = [109.998, 30.003]))).toEqual([]);
    expect(sceneProblems((s) => (s.strips[4].at = [109.998, 30.0055]))).toEqual(['15 strips[4].at']);
    // 摆满整块沙盘的点缀，指在哪里都行。
    const anywhere = editScene((s) => {
      s.strips[3].of = 'woods';
      s.strips[3].at = [109.99, 29.992];
    });
    expect(all(anywhere)).toEqual([]);
  });

  it('指着远处的题签写了 at：要在沙盘边上朝着它的那一点附近', () => {
    // 东港在东南偏东，朝着它走，从沙盘东边上大约 [110.0156, 29.9922] 的地方出去。
    expect(sceneProblems((s) => (s.strips[5].at = [110.015, 29.993]))).toEqual([]);
    expect(sceneProblems((s) => (s.strips[5].at = [109.985, 30.01]))).toEqual(['15 strips[5].at']);
  });

  it('题签指的东西，在用到这条题签的小节里还没有或者已经没有了', () => {
    const found = validateContent(editScene((s) => s.sections[0].strips.push('s-tower')), SIZES);
    expect(found.map((v) => `${v.rule} ${v.field}｜${v.problem}`)).toEqual(['15 sections[0].strips｜小节“上船”摆了题签“s-tower”（门楼），但它指的“gate-tower”这一节沙盘上没有']);
    // 指着点缀的也查：渡口的船“河上”那一节没有。
    const boats = editScene((s) => {
      s.strips[3].of = 'ferry-boats';
    });
    expect(all(boats)).toEqual([`15 ${SCENE} › sections[1].strips`]);
  });

  it('每节一到六条', () => {
    expect(sceneProblems((s) => (s.sections[0].strips = []))).toEqual(['15 sections[0].strips']);
    const seven = editScene((s) => {
      s.strips.push({ id: 's-shoal', text: '乱石滩', of: 'shoal' });
      s.sections[1].strips = ['s-town', 's-river', 's-tower', 's-hill', 's-homes', 's-far', 's-shoal'];
    });
    const found = validateContent(seven, SIZES);
    expect(found.map((v) => `${v.rule} ${v.field}｜${v.problem}`)).toEqual(['15 sections[1].strips｜小节“河上”有 7 条题签，应该是一到 6 条']);
    // 六条合格。（这一节的题签换过了，定格图要重拍，规则 18 另报；这里只看场景自己，所以先把工具做的那几样拿开。）
    const six = withoutMade(editScene((s) => (s.sections[1].strips = ['s-town', 's-river', 's-tower', 's-hill', 's-homes', 's-far'])));
    expect(all(six)).toEqual([]);
  });

  it('一节里同一条题签写了两次，或者写了文件里没有的题签', () => {
    expect(sceneProblems((s) => s.sections[0].strips.push('s-town'))).toEqual(['15 sections[0].strips[3]']);
    expect(sceneProblems((s) => s.sections[0].strips.push('s-ghost'))).toEqual(['15 sections[0].strips[3]']);
  });
});

describe('图片文件的宽高（规则 17、18 对图片用）', () => {
  it('从图片文件的开头读出宽高：PNG 和 JPEG 读得出，别的读不出', () => {
    const bytes = (...values: number[]) => new Uint8Array(values).buffer;
    // PNG：8 个字节的开头，IHDR 的长度和名字，然后是宽 300、高 200。
    const png = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 1, 44, 0, 0, 0, 200);
    expect(pictureSize(png)).toEqual({ width: 300, height: 200, kind: 'png' });
    // JPEG：开头，一段别的（APP0，长 4），然后是写着宽高的一段（SOF0）：高 1171、宽 1404。
    const jpeg = bytes(0xff, 0xd8, 0xff, 0xe0, 0, 4, 1, 2, 0xff, 0xc0, 0, 17, 8, 0x04, 0x93, 0x05, 0x7c, 3, 0, 0);
    expect(pictureSize(jpeg)).toEqual({ width: 1404, height: 1171, kind: 'jpeg' });
    expect(pictureSize(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 90"></svg>').buffer as ArrayBuffer)).toBeNull();
    expect(pictureSize(new ArrayBuffer(0))).toBeNull();
    expect(pictureSize(bytes(0xff, 0xd8, 0x00, 0x00, 0, 0, 0, 0, 0, 0, 0, 0))).toBeNull();
  });
});

/** 一处问题写成“规则号 文件 › 字段”，文件只写人物文件夹后面的一截（baked/river.json）。 */
const where = (v: Violation): string => `${v.rule} ${v.file.slice(DIR.length + 1)}${v.field === '' ? '' : ` › ${v.field}`}`;

/** 量到的三样里改几处（别的照合格样本从磁盘量到的）。 */
function measuredWith(change: { sizes?: FileSizes; pictures?: Measured['pictures']; keys?: Record<string, string> }): Measured {
  return { sizes: { ...SIZES, ...change.sizes }, pictures: { ...PICTURES, ...change.pictures }, keys: { ...KEYS, ...change.keys } };
}

describe('从磁盘量工具做出来的文件', () => {
  it('baked/ 和 stills/ 里的文件都量大小；JPEG、PNG 量宽高、认是哪一种、算记号', () => {
    expect(PICTURES[COLOUR]).toEqual({ width: 301, height: 241, kind: 'jpeg' });
    expect(PICTURES[FIELDS]).toEqual({ width: 301, height: 241, kind: 'png' });
    expect(PICTURES[shot(1, 'wide')]).toEqual({ width: 1800, height: 1350, kind: 'jpeg' });
    expect(PICTURES[shot(3, 'narrow')]).toEqual({ width: 1920, height: 1146, kind: 'jpeg' });
    // 清单和 SVG 读不出宽高，不在里面
    expect(Object.keys(PICTURES).sort()).toEqual([COLOUR, FIELDS, ...SHOTS].sort());
    expect(Object.keys(KEYS).sort()).toEqual([COLOUR, FIELDS, ...SHOTS].sort());
    for (const key of Object.values(KEYS)) expect(key).toMatch(/^[0-9a-f]{16}$/);
    // 六张定格图的字节各不相同，记号也各不相同
    expect(new Set(SHOTS.map((path) => KEYS[path])).size).toBe(6);
    expect(SIZES[COLOUR]).toBe(29);
    expect(SIZES[FIELDS]).toBe(45);
  });

  it('认的是文件里的字节，不是文件名', () => {
    // 把 PNG 的字节放在叫 .jpg 的文件里：量出来还是 PNG
    const swapped = toPictureSizes('./fixtures/good/', paths, (path) => readBytes(onDisk(path.endsWith('river.colour.jpg') ? path.replace('colour.jpg', 'fields.png') : path)));
    expect(swapped[COLOUR]).toEqual({ width: 301, height: 241, kind: 'png' });
    // 字节变了一个，记号就不一样
    const changed = toFileKeys('./fixtures/good/', paths, (path) => {
      const bytes = new Uint8Array(readBytes(onDisk(path)).slice(0));
      if (path.endsWith('river.colour.jpg')) bytes[7] = 9;
      return bytes.buffer;
    });
    expect(changed[COLOUR]).not.toBe(KEYS[COLOUR]);
    expect(changed[FIELDS]).toBe(KEYS[FIELDS]);
  });
});

describe('规则 17 先画好的地面', () => {
  /** 规则 17 查出来的地方。不另说的话：合格的样本，量到的大小、宽高、记号都交进去，“每座沙盘都要有”的开关开着。 */
  const baked = (files: ContentFiles = GOOD, measured: Measured = MEASURED, required = true, scene: StopScene = goodScene()): string[] =>
    checkBakedGround(scene, DIR, files, measured, required).map(where);
  const problems = (files: ContentFiles, measured: Measured = MEASURED): string[] => checkBakedGround(goodScene(), DIR, files, measured, true).map((v) => v.problem);
  const editBaked = (change: (manifest: BakedGroundManifest) => void): ContentFiles => edit<BakedGroundManifest>(BAKED, change);
  const sceneWith = (change: (scene: StopScene) => void): StopScene => {
    const scene = goodScene();
    change(scene);
    return scene;
  };

  it('合格的样本通过：清单和两张图都在，宽高是照沙盘的范围每 10 米一个点算的', () => {
    expect(baked()).toEqual([]);
    expect(baked(GOOD, MEASURED, false)).toEqual([]);
    // 什么都没量，只凭清单和有哪些文件，也通过
    expect(baked(GOOD, {})).toEqual([]);
    // 样本的沙盘东西 3000 米、南北 2400 米
    expect(bakedPictureSize(goodScene())).toEqual({ width: 301, height: 241 });
    const manifest = JSON.parse(GOOD[BAKED]) as BakedGroundManifest;
    expect(manifest.colour).toMatchObject({ file: 'river.colour.jpg', width: 301, height: 241, bytes: SIZES[COLOUR], key: KEYS[COLOUR] });
    expect(manifest.fields).toMatchObject({ file: 'river.fields.png', width: 301, height: 241, bytes: SIZES[FIELDS], key: KEYS[FIELDS] });
  });

  it('还没有清单的沙盘：开关没开算合格，开了就不行', () => {
    const none = withoutMade();
    expect(baked(none, MEASURED, false)).toEqual([]);
    expect(baked(none, MEASURED, true)).toEqual(['17 baked/river.json']);
    expect(problems(none)).toEqual(['没有这个文件：“river”的沙盘还没有先画好的地面；运行 npm run bake，再提交']);
    // 整份内容一起查也一样；不另说的时候照开关现在的样子
    expect(validateContent(none, SIZES, PICTURES, KEYS, true).map(where)).toEqual(['17 baked/river.json', '18 stills/river.json']);
    expect(validateContent(none, SIZES, PICTURES, KEYS, false)).toEqual([]);
    expect(validateContent(none, SIZES, PICTURES, KEYS).map(where)).toEqual(MADE_FILES_REQUIRED ? ['17 baked/river.json', '18 stills/river.json'] : []);
  });

  it('有图没有清单：这两张图对不上', () => {
    expect(baked(without(BAKED), MEASURED, false)).toEqual(['17 baked/river.colour.jpg', '17 baked/river.fields.png']);
    expect(baked(without(BAKED), MEASURED, true)).toEqual(['17 baked/river.json', '17 baked/river.colour.jpg', '17 baked/river.fields.png']);
  });

  it('清单不是合法的 JSON 算格式问题', () => {
    expect(baked(withFile(BAKED, '{ "tool": 1, '))).toEqual(['0 baked/river.json']);
  });

  it('清单里有不认识的字段、缺字段、类型不对、数不在范围里', () => {
    expect(baked(edit<{ note: string }>(BAKED, (m) => (m.note = '手写的一句')))).toEqual(['17 baked/river.json › note']);
    expect(baked(edit<{ colour: { made: string } }>(BAKED, (m) => (m.colour.made = '昨天')))).toEqual(['17 baked/river.json › colour.made']);
    expect(baked(edit<{ colour: { psnr?: number } }>(BAKED, (m) => delete m.colour.psnr))).toEqual(['17 baked/river.json › colour.psnr']);
    expect(baked(edit<{ pixels?: unknown }>(BAKED, (m) => delete m.pixels))).toEqual(['17 baked/river.json › pixels']);
    expect(baked(edit<{ fields: { bytes: unknown } }>(BAKED, (m) => (m.fields.bytes = '45')))).toEqual(['17 baked/river.json › fields.bytes']);
    expect(baked(editBaked((m) => (m.colour.width = 300.5)))).toEqual(['17 baked/river.json › colour.width']);
    // 质量是 0 到 1 之间的数，不是 0 到 100
    expect(baked(editBaked((m) => (m.colour.quality = 95)))).toEqual(['17 baked/river.json › colour.quality']);
    expect(baked(edit<{ tool: number }>(BAKED, (m) => (m.tool = 2)))).toEqual(['17 baked/river.json › tool']);
  });

  it('清单写的一张图不在', () => {
    expect(baked(without(COLOUR))).toEqual(['17 baked/river.json › colour.file']);
    expect(baked(without(FIELDS))).toEqual(['17 baked/river.json › fields.file']);
    expect(problems(without(COLOUR))).toEqual(['颜色那张图 baked/river.colour.jpg 不存在；图片和清单都不手改，运行 npm run bake 重新做']);
  });

  it('图的名字不是 <站>.colour.jpg、<站>.fields.png', () => {
    // 清单写了别的名字：名字不对；而 baked/ 里真的那张图就成了清单里没有的
    expect(baked(editBaked((m) => (m.colour.file = 'river.jpg')))).toEqual(['17 baked/river.json › colour.file', '17 baked/river.colour.jpg']);
    expect(baked(editBaked((m) => (m.fields.file = '../scenes/river.fields.png')))).toEqual(['17 baked/river.json › fields.file', '17 baked/river.fields.png']);
  });

  it('颜色不是 JPEG，田的标记不是 PNG', () => {
    const colourIsPng = measuredWith({ pictures: { [COLOUR]: { width: 301, height: 241, kind: 'png' } } });
    expect(baked(GOOD, colourIsPng)).toEqual(['17 baked/river.json › colour.file']);
    expect(problems(GOOD, colourIsPng)).toEqual(['颜色那张图应该是 JPEG，baked/river.colour.jpg 却是 PNG']);
    expect(baked(GOOD, measuredWith({ pictures: { [FIELDS]: { width: 301, height: 241, kind: 'jpeg' } } }))).toEqual(['17 baked/river.json › fields.file']);
    // 只量了宽高、没认是哪一种的，不对这一样
    expect(baked(GOOD, measuredWith({ pictures: { [COLOUR]: { width: 301, height: 241 } } }))).toEqual([]);
  });

  it('图片文件的宽高和清单里写的不一样', () => {
    const narrower = measuredWith({ pictures: { [COLOUR]: { width: 300, height: 241, kind: 'jpeg' } } });
    expect(baked(GOOD, narrower)).toEqual(['17 baked/river.json › colour.width']);
    expect(problems(GOOD, narrower)).toEqual(['颜色那张图的文件是 300 × 241 像素，清单里写的是 301 × 241']);
    expect(baked(GOOD, measuredWith({ pictures: { [FIELDS]: { width: 301, height: 240, kind: 'png' } } }))).toEqual(['17 baked/river.json › fields.height']);
  });

  it('清单里写的宽高，和沙盘的范围算出来的不一样', () => {
    // 不量图片，只拿清单对沙盘的范围
    const unmeasured: Measured = { sizes: SIZES, keys: KEYS };
    const files = editBaked((m) => (m.colour.width = 300));
    expect(baked(files, unmeasured)).toEqual(['17 baked/river.json › colour.width']);
    expect(problems(files, unmeasured)).toEqual(['颜色那张图写的是 300 × 241 像素；照沙盘的范围每 10 米一个点算，应该是 301 × 241']);
    expect(baked(editBaked((m) => (m.fields.height = 121)), unmeasured)).toEqual(['17 baked/river.json › fields.height']);
    // 沙盘往东放大了 200 米，图还是原来的：两张都对不上（每 10 米一个点，该宽 321）
    const wider = sceneWith((s) => (s.frame.eastM = 1700));
    expect(bakedPictureSize(wider)).toEqual({ width: 321, height: 241 });
    expect(baked(GOOD, MEASURED, true, wider)).toEqual(['17 baked/river.json › colour.width', '17 baked/river.json › fields.width']);
  });

  it('宽或高超过 2048 像素', () => {
    // 东西 21 公里的沙盘，每 10 米一个点就是 2101 个点
    const huge = sceneWith((s) => {
      s.frame.westM = 10500;
      s.frame.eastM = 10500;
    });
    expect(bakedPictureSize(huge).width).toBe(2101);
    const files = editBaked((m) => {
      m.colour.width = 2101;
      m.fields.width = 2101;
    });
    const measured = measuredWith({ pictures: { [COLOUR]: { width: 2101, height: 241, kind: 'jpeg' }, [FIELDS]: { width: 2101, height: 241, kind: 'png' } } });
    const found = checkBakedGround(huge, DIR, files, measured, true);
    expect(found.map(where)).toEqual(['17 baked/river.json › colour.width', '17 baked/river.json › fields.width']);
    expect(found[0].problem).toBe(`颜色那张图有 2101 × 241 像素，宽和高都不能超过 ${PICTURE_EDGE_MAX}`);
    // 东西 20460 米是 2047 个点，合格
    const wide = sceneWith((s) => {
      s.frame.westM = 10230;
      s.frame.eastM = 10230;
    });
    const fits = editBaked((m) => {
      m.colour.width = 2047;
      m.fields.width = 2047;
    });
    expect(checkBakedGround(wide, DIR, fits, { sizes: SIZES, keys: KEYS }, true)).toEqual([]);
  });

  it('字节数、文件的记号和清单里写的不一样', () => {
    const bigger = measuredWith({ sizes: { [COLOUR]: 30 } });
    expect(baked(GOOD, bigger)).toEqual(['17 baked/river.json › colour.bytes']);
    expect(problems(GOOD, bigger)).toEqual(['颜色那张图的文件有 30 字节，清单里写的是 29']);
    expect(baked(editBaked((m) => (m.fields.bytes = 44)))).toEqual(['17 baked/river.json › fields.bytes']);
    const touched = measuredWith({ keys: { [FIELDS]: '0123456789abcdef' } });
    expect(baked(GOOD, touched)).toEqual(['17 baked/river.json › fields.key']);
    expect(problems(GOOD, touched)).toEqual([
      `田的标记那张图的文件不是清单里记的那一份（文件的记号是 0123456789abcdef，清单里写的是 ${KEYS[FIELDS]}）；图片和清单都不手改，运行 npm run bake 重新做`,
    ]);
    expect(baked(editBaked((m) => (m.colour.key = 'ffffffffffffffff')))).toEqual(['17 baked/river.json › colour.key']);
    // 没有量的不对
    expect(baked(editBaked((m) => Object.assign(m.colour, { bytes: 999, key: 'ffffffffffffffff' })), {})).toEqual([]);
  });

  it('地形文件、颜色、田的标记三个文件合计超过 1.5 MB', () => {
    // 地形文件 128 字节，田的标记 45 字节，颜色占满剩下的：正好 1.5 MB 合格，多一个字节不行
    const room = TABLE_FILES_MAX_BYTES - SIZES[TERRAIN] - SIZES[FIELDS];
    const withColour = (bytes: number): [ContentFiles, Measured] => [editBaked((m) => (m.colour.bytes = bytes)), measuredWith({ sizes: { [COLOUR]: bytes } })];
    expect(baked(...withColour(room))).toEqual([]);
    expect(baked(...withColour(room + 1))).toEqual(['17 baked/river.json']);
    expect(problems(...withColour(room + 1))).toEqual(['地形文件、颜色、田的标记三个文件合计 1.50 MB，不能超过 1.5 MB']);
    expect(problems(...withColour(room + 300_000))).toEqual(['地形文件、颜色、田的标记三个文件合计 1.79 MB，不能超过 1.5 MB']);
    // 没有量大小的时候，图片照清单里写的字节数算，地形文件照 行 × 列 × 2 算
    expect(baked(editBaked((m) => (m.colour.bytes = room)), {})).toEqual([]);
    expect(baked(editBaked((m) => (m.colour.bytes = room + 1)), {})).toEqual(['17 baked/river.json']);
    // 地形文件大了也一样算进去
    expect(baked(GOOD, measuredWith({ sizes: { [TERRAIN]: TABLE_FILES_MAX_BYTES } }))).toEqual(['17 baked/river.json']);
  });

  it('颜色那张图的清晰度（psnr）低于 40', () => {
    expect(baked(editBaked((m) => (m.colour.psnr = 39.9)))).toEqual(['17 baked/river.json › colour.psnr']);
    expect(problems(editBaked((m) => (m.colour.psnr = 39.9)))).toEqual(['颜色那张图压得太狠：清晰度（psnr）是 39.9，不能低于 40；用高一点的质量重新做']);
    expect(baked(editBaked((m) => (m.colour.psnr = 40)))).toEqual([]);
  });

  it('baked/ 里以“<站>.”开头的文件都要在清单里', () => {
    expect(baked(withFile('figures/demo/baked/river.normals.png', ''))).toEqual(['17 baked/river.normals.png']);
    expect(baked(withFile('figures/demo/baked/river.colour.png', ''))).toEqual(['17 baked/river.colour.png']);
    // 别的站的、不以“river.”开头的，不归这一站管
    expect(baked({ ...GOOD, 'figures/demo/baked/lake.colour.jpg': '', 'figures/demo/baked/riverside.json': '{}' })).toEqual([]);
  });

  it('场景自己不合格（规则 10 到 15）时，规则 17、18 先不查', () => {
    // 颜色那张图没了、定格图清单也没了；场景的 stopId 又写错了：只报场景的那一处
    const files = editScene((s) => (s.stopId = 'lake'));
    delete files[COLOUR];
    delete files[STILLS];
    expect(validateContent(files, SIZES, PICTURES, KEYS, true).map(where)).toEqual(['10 scenes/river.json › stopId']);
    // 场景改对以后，那两处就报出来了（没有清单的六张定格图，一张一处）
    const fixed = { ...files, [SCENE]: GOOD[SCENE] };
    expect(validateContent(fixed, SIZES, PICTURES, KEYS, true).map(where)).toEqual([
      '17 baked/river.json › colour.file',
      '18 stills/river.json',
      ...[...SHOTS].sort().map((path) => `18 ${path.slice(DIR.length + 1)}`),
    ]);
    // 出错的样本里的两个场景文件都不合格，所以开关开着也没有规则 17、18 的问题
    expect(validateContent(BAD, {}, {}, {}, true).some((v) => v.rule >= 17)).toBe(false);
  });
});

describe('规则 18 每一小节的定格图', () => {
  /** 规则 18 查出来的地方。不另说的话：合格的样本，量到的大小、宽高、记号都交进去，“每座沙盘都要有”的开关开着。 */
  const stills = (files: ContentFiles = GOOD, measured: Measured = MEASURED, required = true, scene: StopScene = goodScene()): string[] =>
    checkSectionStills(scene, DIR, files, measured, required).map(where);
  const problems = (files: ContentFiles, measured: Measured = MEASURED): string[] => checkSectionStills(goodScene(), DIR, files, measured, true).map((v) => v.problem);
  const editStills = (change: (manifest: StillManifest) => void): ContentFiles => edit<StillManifest>(STILLS, change);
  /** 改成类型不许的样子。 */
  const looseStills = <T>(change: (manifest: T) => void): ContentFiles => edit<T>(STILLS, change);
  const goodStills = (): StillManifest => JSON.parse(GOOD[STILLS]) as StillManifest;

  it('合格的样本通过：三个小节，宽、窄各一张，每张记着这一节题签指着的点', () => {
    expect(stills()).toEqual([]);
    expect(stills(GOOD, MEASURED, false)).toEqual([]);
    expect(stills(GOOD, {})).toEqual([]);
    const manifest = goodStills();
    expect(manifest.stills.map((s) => `${s.section} ${s.shape} ${s.file}`)).toEqual([
      '上船 wide river-1-wide.jpg',
      '河上 wide river-2-wide.jpg',
      '渡口 wide river-3-wide.jpg',
      '上船 narrow river-1-narrow.jpg',
      '河上 narrow river-2-narrow.jpg',
      '渡口 narrow river-3-narrow.jpg',
    ]);
    const scene = goodScene();
    for (const still of manifest.stills) {
      expect(still.anchors.map((a) => a.id)).toEqual(scene.sections.find((s) => s.heading === still.section)?.strips);
      expect(still.bytes).toBe(SIZES[`${DIR}/stills/${still.file}`]);
      expect(still.key).toBe(KEYS[`${DIR}/stills/${still.file}`]);
    }
    // 样本里有远处的题签（带 out）、抬高了的题签（带 foot）
    expect(manifest.stills[2].anchors[0]).toMatchObject({ id: 's-far', out: [0.0995, -0.995] });
    expect(manifest.stills[1].anchors[1]).toMatchObject({ id: 's-tower', foot: [0.2136, 0.3812] });
  });

  it('宽、窄两种在清单里怎么穿插都行，只要各自的先后和小节一样', () => {
    const interleaved = editStills((m) => {
      const [w1, w2, w3, n1, n2, n3] = m.stills;
      m.stills = [w1, n1, w2, n2, w3, n3];
    });
    expect(stills(interleaved)).toEqual([]);
  });

  it('还没有清单的沙盘：开关没开算合格，开了就不行', () => {
    const none = withoutMade();
    expect(stills(none, MEASURED, false)).toEqual([]);
    expect(stills(none, MEASURED, true)).toEqual(['18 stills/river.json']);
    expect(problems(none)).toEqual(['没有这个文件：“river”的沙盘还没有每一小节的定格图；运行 STILLS_OUT=content/figures npm run stills（见 README），再提交']);
  });

  it('有图没有清单：这几张图对不上', () => {
    expect(stills(without(STILLS), MEASURED, false)).toEqual([...SHOTS].sort().map((path) => `18 ${path.slice(DIR.length + 1)}`));
  });

  it('清单不是合法的 JSON 算格式问题', () => {
    expect(stills(withFile(STILLS, '{ "tool": 1, '))).toEqual(['0 stills/river.json']);
  });

  it('清单里有不认识的字段、缺字段、类型不对', () => {
    expect(stills(looseStills<{ note: string }>((m) => (m.note = '手写的一句')))).toEqual(['18 stills/river.json › note']);
    expect(stills(looseStills<{ stills: { caption: string }[] }>((m) => (m.stills[0].caption = '图上的字')))).toEqual(['18 stills/river.json › stills[0].caption']);
    expect(stills(looseStills<{ stills: { anchors: { text: string }[] }[] }>((m) => (m.stills[0].anchors[0].text = '示例城')))).toEqual(['18 stills/river.json › stills[0].anchors[0].text']);
    expect(stills(looseStills<{ made: { background?: string } }>((m) => delete m.made.background))).toEqual(['18 stills/river.json › made.background']);
    expect(stills(looseStills<{ madeFrom: { program?: string } }>((m) => delete m.madeFrom.program))).toEqual(['18 stills/river.json › madeFrom.program']);
    expect(stills(looseStills<{ stills: { raw?: string }[] }>((m) => delete m.stills[3].raw))).toEqual(['18 stills/river.json › stills[3].raw']);
    expect(stills(looseStills<{ stills: { shape: string }[] }>((m) => (m.stills[0].shape = 'tall')))).toEqual(['18 stills/river.json › stills[0].shape']);
    expect(stills(looseStills<{ stills: { quality: number }[] }>((m) => (m.stills[0].quality = 101)))).toEqual(['18 stills/river.json › stills[0].quality']);
    // 定格图只用完整的画质拍
    expect(stills(looseStills<{ made: { tier: string } }>((m) => (m.made.tier = 'reduced')))).toEqual(['18 stills/river.json › made.tier']);
    expect(stills(looseStills<{ tool: number }>((m) => (m.tool = 2)))).toEqual(['18 stills/river.json › tool']);
  });

  it('两种形状都要写全：窗口、沙盘栏、四边留的空、左右多拍多少、像素比', () => {
    expect(stills(looseStills<{ shapes: { narrow?: unknown } }>((m) => delete m.shapes.narrow))).toEqual(['18 stills/river.json › shapes.narrow']);
    for (const field of ['window', 'pane', 'insets', 'extra', 'pixelRatio']) {
      expect(stills(looseStills<{ shapes: { wide: Record<string, unknown> } }>((m) => delete m.shapes.wide[field])), field).toEqual([`18 stills/river.json › shapes.wide.${field}`]);
    }
    expect(stills(editStills((m) => (m.shapes.wide.pixelRatio = 0)))).toEqual(['18 stills/river.json › shapes.wide.pixelRatio']);
    expect(stills(editStills((m) => (m.shapes.narrow.extra = -1)))).toEqual(['18 stills/river.json › shapes.narrow.extra']);
    // 窗口、沙盘栏是两个数，四边留的空是四个数
    expect(stills(looseStills<{ shapes: { wide: { window: number[] } } }>((m) => (m.shapes.wide.window = [1440])))).toEqual(['18 stills/river.json › shapes.wide.window']);
    expect(stills(looseStills<{ shapes: { narrow: { pane: number[] } } }>((m) => (m.shapes.narrow.pane = [768, 573, 2])))).toEqual(['18 stills/river.json › shapes.narrow.pane']);
    const twoInsets = looseStills<{ shapes: { narrow: { insets: number[] } } }>((m) => (m.shapes.narrow.insets = [54, 95]));
    expect(stills(twoInsets)).toEqual(['18 stills/river.json › shapes.narrow.insets']);
    expect(problems(twoInsets)).toEqual(['窄的那种，四边留的空（上、右、下、左）要写成四个数，现在是 2 个']);
  });

  it('少了一个小节的、少了一种形状的', () => {
    // 去掉“河上”窄的那一张：清单里缺一张；stills/ 里那张图也成了清单里没有的
    const missing = editStills((m) => m.stills.splice(4, 1));
    expect(stills(missing)).toEqual(['18 stills/river.json › stills', '18 stills/river-2-narrow.jpg']);
    expect(problems(missing)[0]).toBe('小节“河上”没有窄的定格图；每个小节宽、窄各要一张');
    // 场景添了一节，定格图还没重拍：宽、窄各缺一张
    const scene = goodScene();
    scene.sections.push({ ...scene.sections[0], heading: '下船' });
    expect(stills(GOOD, MEASURED, true, scene)).toEqual(['18 stills/river.json › stills', '18 stills/river.json › stills']);
  });

  it('多出一张、同一张写了两次、先后和小节不一样', () => {
    const extra = editStills((m) => m.stills.push({ ...m.stills[0], section: '下船' }));
    expect(stills(extra)).toEqual(['18 stills/river.json › stills[6].section']);
    expect(problems(extra)).toEqual(['清单里多出一张宽的定格图：场景里没有“下船”这个小节']);
    const twice = editStills((m) => m.stills.push({ ...m.stills[3] }));
    expect(stills(twice)).toEqual(['18 stills/river.json › stills[6].section']);
    expect(problems(twice)).toEqual(['小节“上船”窄的定格图写了不止一张']);
    const swapped = editStills((m) => {
      [m.stills[0], m.stills[1]] = [m.stills[1], m.stills[0]];
    });
    expect(stills(swapped)).toEqual(['18 stills/river.json › stills']);
    expect(problems(swapped)).toEqual(['宽的定格图先后和小节不一样；小节是：上船、河上、渡口']);
  });

  it('文件名不是 <站>-<第几节>-wide.jpg、<站>-<第几节>-narrow.jpg', () => {
    // 名字写错的那一张；真的那张图也就成了清单里没有的
    const jpeg = editStills((m) => (m.stills[0].file = 'river-1-wide.jpeg'));
    expect(stills(jpeg)).toEqual(['18 stills/river.json › stills[0].file', '18 stills/river-1-wide.jpg']);
    expect(problems(jpeg)[0]).toBe('小节“上船”宽的定格图应该叫 river-1-wide.jpg（<站>-<第几节>-wide.jpg，不带文件夹），现在写的是“river-1-wide.jpeg”');
    // 带了文件夹
    expect(stills(editStills((m) => (m.stills[4].file = 'stills/river-2-narrow.jpg')))).toEqual(['18 stills/river.json › stills[4].file', '18 stills/river-2-narrow.jpg']);
    // 第几节写错了：“渡口”是第三节
    expect(stills(editStills((m) => (m.stills[2].file = 'river-2-wide.jpg')))).toEqual(['18 stills/river.json › stills[2].file', '18 stills/river-3-wide.jpg']);
    // 宽的写成了窄的名字
    expect(stills(editStills((m) => (m.stills[0].file = 'river-1-narrow.jpg')))).toEqual(['18 stills/river.json › stills[0].file', '18 stills/river-1-wide.jpg']);
  });

  it('stills/ 里以“<站>-”开头的图片都要在清单里', () => {
    expect(stills(withFile('figures/demo/stills/river-4-wide.jpg', ''))).toEqual(['18 stills/river-4-wide.jpg']);
    expect(stills(withFile('figures/demo/stills/river-1-wide.png', ''))).toEqual(['18 stills/river-1-wide.png']);
    // 别的站的、不是图片的，不归这一站管
    expect(stills({ ...GOOD, 'figures/demo/stills/lake-1-wide.jpg': '', 'figures/demo/stills/river-notes.txt': '' })).toEqual([]);
  });

  it('清单写的一张图不在', () => {
    expect(stills(without(shot(2, 'narrow')))).toEqual(['18 stills/river.json › stills[4].file']);
    expect(problems(without(shot(2, 'narrow')))).toEqual(['小节“河上”窄的定格图 stills/river-2-narrow.jpg 不存在；图片和清单都不手改，运行 STILLS_OUT=content/figures npm run stills 重新做（见 README）']);
  });

  it('不是 JPEG', () => {
    const png = measuredWith({ pictures: { [shot(1, 'wide')]: { width: 1800, height: 1350, kind: 'png' } } });
    expect(stills(GOOD, png)).toEqual(['18 stills/river.json › stills[0].file']);
    expect(problems(GOOD, png)).toEqual(['小节“上船”宽的定格图应该是 JPEG，stills/river-1-wide.jpg 却是 PNG']);
  });

  it('超过 300 KB', () => {
    const withBytes = (bytes: number): [ContentFiles, Measured] => [editStills((m) => (m.stills[5].bytes = bytes)), measuredWith({ sizes: { [shot(3, 'narrow')]: bytes } })];
    expect(stills(...withBytes(STILL_MAX_BYTES))).toEqual([]);
    expect(stills(...withBytes(STILL_MAX_BYTES + 1))).toEqual(['18 stills/river.json › stills[5].bytes']);
    expect(problems(...withBytes(STILL_MAX_BYTES + 1))).toEqual(['小节“渡口”窄的定格图有 301 KB，不能超过 300 KB']);
    // 没有量大小的时候照清单里写的字节数查
    expect(stills(editStills((m) => (m.stills[5].bytes = STILL_MAX_BYTES + 1)), {})).toEqual(['18 stills/river.json › stills[5].bytes']);
    // 文件比清单里写的大，而且超了：两处都说
    expect(stills(GOOD, measuredWith({ sizes: { [shot(3, 'narrow')]: 400_000 } }))).toEqual(['18 stills/river.json › stills[5].bytes', '18 stills/river.json › stills[5].bytes']);
  });

  it('宽或高超过 2048 像素', () => {
    const withWidth = (width: number): [ContentFiles, Measured] => [
      editStills((m) => (m.stills[0].width = width)),
      measuredWith({ pictures: { [shot(1, 'wide')]: { width, height: 1350, kind: 'jpeg' } } }),
    ];
    expect(stills(...withWidth(PICTURE_EDGE_MAX))).toEqual([]);
    expect(stills(...withWidth(PICTURE_EDGE_MAX + 1))).toEqual(['18 stills/river.json › stills[0].width']);
    expect(problems(...withWidth(PICTURE_EDGE_MAX + 1))).toEqual(['小节“上船”宽的定格图有 2049 × 1350 像素，宽和高都不能超过 2048']);
    expect(stills(editStills((m) => (m.stills[3].height = 2100)), {})).toEqual(['18 stills/river.json › stills[3].height']);
  });

  it('宽高、字节数、文件的记号和清单里写的不一样', () => {
    const shorter = measuredWith({ pictures: { [shot(1, 'narrow')]: { width: 1920, height: 1144, kind: 'jpeg' } } });
    expect(stills(GOOD, shorter)).toEqual(['18 stills/river.json › stills[3].height']);
    expect(problems(GOOD, shorter)).toEqual(['小节“上船”窄的定格图的文件是 1920 × 1144 像素，清单里写的是 1920 × 1146']);
    expect(stills(editStills((m) => (m.stills[1].width = 1799)))).toEqual(['18 stills/river.json › stills[1].width']);
    expect(stills(GOOD, measuredWith({ sizes: { [shot(2, 'wide')]: 31 } }))).toEqual(['18 stills/river.json › stills[1].bytes']);
    expect(stills(editStills((m) => (m.stills[1].bytes = 28)))).toEqual(['18 stills/river.json › stills[1].bytes']);
    // 两张图调了个儿：各自的记号都对不上清单
    const swappedKeys = measuredWith({ keys: { [shot(1, 'wide')]: KEYS[shot(2, 'wide')], [shot(2, 'wide')]: KEYS[shot(1, 'wide')] } });
    expect(stills(GOOD, swappedKeys)).toEqual(['18 stills/river.json › stills[0].key', '18 stills/river.json › stills[1].key']);
    expect(stills(editStills((m) => (m.stills[2].key = 'ffffffffffffffff')))).toEqual(['18 stills/river.json › stills[2].key']);
    // 没有量的不对
    expect(stills(editStills((m) => Object.assign(m.stills[2], { bytes: 999, key: 'ffffffffffffffff', width: 1700 })), {})).toEqual([]);
  });

  it('anchors 要正好是这一小节的题签，先后相同', () => {
    const fewer = editStills((m) => m.stills[0].anchors.pop());
    expect(stills(fewer)).toEqual(['18 stills/river.json › stills[0].anchors']);
    expect(problems(fewer)).toEqual(['小节“上船”宽的定格图记的题签是 s-town、s-river，这一小节的题签是 s-town、s-river、s-homes；要一条不多、一条不少，先后相同']);
    expect(stills(editStills((m) => m.stills[0].anchors.push({ id: 's-hill', x: 0.7, y: 0.2, visible: true })))).toEqual(['18 stills/river.json › stills[0].anchors']);
    expect(stills(editStills((m) => m.stills[4].anchors.reverse()))).toEqual(['18 stills/river.json › stills[4].anchors']);
    expect(stills(editStills((m) => (m.stills[2].anchors = [])))).toEqual(['18 stills/river.json › stills[2].anchors']);
    // 场景里这一节换了题签，定格图还没重拍
    const scene = goodScene();
    scene.sections[1].strips = ['s-river', 's-tower'];
    expect(stills(GOOD, MEASURED, true, scene)).toEqual(['18 stills/river.json › stills[1].anchors', '18 stills/river.json › stills[4].anchors']);
  });

  it('x、y 是数；看得见的要落在 0 到 1 之间', () => {
    expect(stills(looseStills<{ stills: { anchors: { x: unknown }[] }[] }>((m) => (m.stills[0].anchors[0].x = '0.44')))).toEqual(['18 stills/river.json › stills[0].anchors[0].x']);
    expect(stills(looseStills<{ stills: { anchors: { y?: number }[] }[] }>((m) => delete m.stills[0].anchors[1].y))).toEqual(['18 stills/river.json › stills[0].anchors[1].y']);
    const outside = editStills((m) => (m.stills[0].anchors[0].x = 1.2));
    expect(stills(outside)).toEqual(['18 stills/river.json › stills[0].anchors[0]']);
    expect(problems(outside)).toEqual(['题签“s-town”标着看得见，位置却在图片外面（x 1.2，y 0.3912）；看得见的要落在 0 到 1 之间']);
    expect(stills(editStills((m) => (m.stills[0].anchors[2].y = -0.01)))).toEqual(['18 stills/river.json › stills[0].anchors[2]']);
    // 正好在边上算在里面；看不见的可以在外面
    expect(stills(editStills((m) => Object.assign(m.stills[0].anchors[0], { x: 0, y: 1 })))).toEqual([]);
    expect(stills(editStills((m) => Object.assign(m.stills[0].anchors[0], { x: -0.3, y: 1.4, visible: false })))).toEqual([]);
  });

  it('写了 out 的是长度为 1 的方向，写了 foot 的是两个数', () => {
    expect(stills(editStills((m) => (m.stills[2].anchors[0].out = [0.5, 0.5])))).toEqual(['18 stills/river.json › stills[2].anchors[0].out']);
    expect(stills(editStills((m) => (m.stills[2].anchors[0].out = [3, 4])))).toEqual(['18 stills/river.json › stills[2].anchors[0].out']);
    expect(stills(looseStills<{ stills: { anchors: { out: number[] }[] }[] }>((m) => (m.stills[2].anchors[0].out = [1])))).toEqual(['18 stills/river.json › stills[2].anchors[0].out']);
    expect(stills(looseStills<{ stills: { anchors: { out: unknown }[] }[] }>((m) => (m.stills[2].anchors[0].out = 'south')))).toEqual(['18 stills/river.json › stills[2].anchors[0].out']);
    expect(stills(editStills((m) => (m.stills[2].anchors[0].out = [0, -1])))).toEqual([]);
    expect(stills(editStills((m) => (m.stills[2].anchors[0].out = [0.6, 0.8])))).toEqual([]);
    expect(stills(looseStills<{ stills: { anchors: { foot: number[] }[] }[] }>((m) => (m.stills[1].anchors[1].foot = [0.2136])))).toEqual(['18 stills/river.json › stills[1].anchors[1].foot']);
    expect(stills(looseStills<{ stills: { anchors: { foot: unknown }[] }[] }>((m) => (m.stills[1].anchors[1].foot = { x: 0.2, y: 0.4 })))).toEqual(['18 stills/river.json › stills[1].anchors[1].foot']);
  });

  it('northDeg 在 −180 到 180 之间；pxPerMetre、fit 大于 0；镜头的几个数个数要对', () => {
    expect(stills(editStills((m) => (m.stills[0].northDeg = 180.5)))).toEqual(['18 stills/river.json › stills[0].northDeg']);
    expect(stills(editStills((m) => (m.stills[0].northDeg = -181)))).toEqual(['18 stills/river.json › stills[0].northDeg']);
    expect(stills(editStills((m) => (m.stills[0].northDeg = 180)))).toEqual([]);
    expect(stills(editStills((m) => (m.stills[0].northDeg = -180)))).toEqual([]);
    expect(stills(editStills((m) => (m.stills[3].pxPerMetre = 0)))).toEqual(['18 stills/river.json › stills[3].pxPerMetre']);
    expect(stills(editStills((m) => (m.stills[3].fit = 0)))).toEqual(['18 stills/river.json › stills[3].fit']);
    expect(stills(editStills((m) => (m.stills[3].fit = -1.5)))).toEqual(['18 stills/river.json › stills[3].fit']);
    expect(stills(looseStills<{ stills: { pose: { target: number[] } }[] }>((m) => (m.stills[0].pose.target = [0, 0])))).toEqual(['18 stills/river.json › stills[0].pose.target']);
    expect(stills(looseStills<{ stills: { pose: { position: number[] } }[] }>((m) => m.stills[0].pose.position.push(1)))).toEqual(['18 stills/river.json › stills[0].pose.position']);
    expect(stills(looseStills<{ stills: { reach: number[] }[] }>((m) => (m.stills[0].reach = [400])))).toEqual(['18 stills/river.json › stills[0].reach']);
  });
});

describe('规则 9 没有占位：场景文件里的文字也查', () => {
  it('依据、说明、题记、没有画的原因里留了占位', () => {
    expect(sceneProblems((s) => (s.things[0].basis += '（待核）'))).toEqual(['9 things[0].basis']);
    expect(sceneProblems((s) => (s.water.levels.note = '水位是示意（约数，待核）。'))).toEqual(['9 water.levels.note']);
    expect(sceneProblems((s) => (s.sections[2].line = '（待写）'))).toEqual(['9 sections[2].line']);
    expect(sceneProblems((s) => (s.notDrawn[0].why = '位置（待查）'))).toEqual(['9 notDrawn[0].why']);
    expect(sceneProblems((s) => (s.credits[0] = '地形：（待填）'))).toEqual(['9 credits[0]']);
  });

  it('查不到的事直接写“没有查到”，不算占位', () => {
    expect(sceneProblems((s) => (s.things[0].basis = '城墙的位置没有查到，是自己定的。'))).toEqual([]);
  });
});

describe('规则 21 夜', () => {
  const night = (moon?: { azimuth: number; altitude: number }) => (scene: StopScene) => {
    scene.sections[1].sky = 'night';
    if (moon) scene.sections[1].moon = moon;
  };

  it('夜里的小节写了月亮在哪，方向和高度都在范围里：通过；两头的数也算在范围里', () => {
    expect(sceneProblems(night({ azimuth: 103, altitude: 12 }))).toEqual([]);
    expect(sceneProblems(night({ azimuth: 0, altitude: MOON_ALTITUDE[0] }))).toEqual([]);
    expect(sceneProblems(night({ azimuth: 360, altitude: MOON_ALTITUDE[1] }))).toEqual([]);
    expect(MOON_ALTITUDE).toEqual([5, 85]);
  });

  it('夜里的小节没有写月亮：查出来，说的是哪一节', () => {
    expect(sceneProblems(night())).toEqual(['21 sections[1].moon']);
    const found = checkSceneNight({ ...goodScene(), sections: goodScene().sections.map((s, i) => (i === 1 ? { ...s, sky: 'night' as const } : s)) }, SCENE);
    expect(found).toHaveLength(1);
    expect(found[0].problem).toContain(goodScene().sections[1].heading);
    expect(formatViolation(found[0])).toContain('【规则 21 夜】');
  });

  it('白天的小节（没写 sky，或者写的是 day）写了月亮：查出来', () => {
    expect(sceneProblems((scene) => (scene.sections[0].moon = { azimuth: 103, altitude: 12 }))).toEqual(['21 sections[0].moon']);
    expect(sceneProblems((scene) => Object.assign(scene.sections[2], { sky: 'day', moon: { azimuth: 103, altitude: 12 } }))).toEqual(['21 sections[2].moon']);
  });

  it('月亮的方向不在 0 到 360 之间、高度不在 5 到 85 之间：各查出各的', () => {
    expect(sceneProblems(night({ azimuth: -1, altitude: 12 }))).toEqual(['21 sections[1].moon.azimuth']);
    expect(sceneProblems(night({ azimuth: 361, altitude: 12 }))).toEqual(['21 sections[1].moon.azimuth']);
    expect(sceneProblems(night({ azimuth: 103, altitude: 4.9 }))).toEqual(['21 sections[1].moon.altitude']);
    expect(sceneProblems(night({ azimuth: 103, altitude: 85.1 }))).toEqual(['21 sections[1].moon.altitude']);
    expect(sceneProblems(night({ azimuth: 400, altitude: 90 }))).toEqual(['21 sections[1].moon.azimuth', '21 sections[1].moon.altitude']);
  });

  it('合格的样本和 content/ 里现在的沙盘都没有夜里的小节：这条规则在它们上面什么也不报', () => {
    expect(checkSceneNight(goodScene(), SCENE)).toEqual([]);
  });
});

describe('报告的写法', () => {
  it('规则的名字有二十三个：格式，加上二十二条（19 是随站的字体，不归内容校验查；20 是站的位置；21 是夜；22 是行迹）', () => {
    expect(RULE_NAMES).toHaveLength(23);
    expect(RULE_NAMES.slice(10)).toEqual(['场景文件', '范围', '类别和依据', '零件', '小节', '题签', '全程沙盘', '先画好的地面', '每一小节的定格图', '随站的字体', '站的位置', '夜', '行迹']);
  });

  it('场景的问题也写成一句话：哪条规则、哪个文件、哪个字段、哪里不对', () => {
    expect(formatViolation({ rule: 13, file: 'figures/su-shi/scenes/xuzhou.json', field: 'things[3].on', problem: '城门必须写 on' })).toBe(
      '【规则 13 零件】content/figures/su-shi/scenes/xuzhou.json › things[3].on：城门必须写 on',
    );
    // 工具做出来的文件：说的是清单，或者 baked/、stills/ 里的那个文件
    const none = withoutMade();
    expect(validateContent(none, SIZES, PICTURES, KEYS, true).map(formatViolation)).toEqual([
      '【规则 17 先画好的地面】content/figures/demo/baked/river.json：没有这个文件：“river”的沙盘还没有先画好的地面；运行 npm run bake，再提交',
      '【规则 18 每一小节的定格图】content/figures/demo/stills/river.json：没有这个文件：“river”的沙盘还没有每一小节的定格图；运行 STILLS_OUT=content/figures npm run stills（见 README），再提交',
    ]);
    for (const v of validateContent(BAD).filter((found) => found.rule >= 10)) {
      expect(formatViolation(v)).toMatch(/^【规则 1[0-6] .+】content\/figures\/broken\/.+ › .+：.+$/);
    }
  });
});

describe('黄州的城添的几种写法：青苗的田、浅色的院子、照他的话写的远处、小节的云气', () => {
  /** 合格的样本里一块带范围的修整的那一圈：借来当一块田的范围。 */
  const someArea = (scene: StopScene): [number, number][] => {
    const edit = scene.terrain.edits.find((e) => e.id === 'low-field');
    if (edit?.op !== 'level' || !edit.area) throw new Error('样本里没有 low-field');
    return edit.area;
  };
  const field = (scene: StopScene, withArea: boolean): void => {
    scene.dressing.push({ id: 'crop', name: '青苗的田', kind: 'fields', ...(withArea ? { area: someArea(scene) } : {}), params: { green: true }, class: 'dressing', basis: '只表示有田。', sourceIds: [] });
  };
  const temple = (params: Record<string, boolean>) => (scene: StopScene): void => {
    const at = scene.things[4].at;
    if (!at) throw new Error('样本里的亭没有 at');
    scene.things.push({ id: 'temple', name: '寺', kind: 'hall-group', at, params, class: 'schematic', basis: '只表示有一座寺。', sourceIds: [] });
  };

  it('青苗的田（fields 的 green）要写 area：写了通过，不写查出来（规则 13）', () => {
    expect(sceneProblems((s) => field(s, true))).toEqual([]);
    expect(sceneProblems((s) => field(s, false))).toEqual(['13 dressing[5].params.green']);
    // green 是“是或否”：写成别的算参数不对
    expect(sceneProblems((s) => {
      field(s, true);
      s.dressing[5].params = { green: 'yes' };
    })).toEqual(['13 dressing[5].params.green']);
  });

  it('浅色的院子（hall-group 的 paleYard）：平地上的院落可以写；顺着山坡的（terraced）不能（规则 13）', () => {
    expect(sceneProblems(temple({ paleYard: true }))).toEqual([]);
    expect(sceneProblems(temple({ paleYard: true, terraced: false }))).toEqual([]);
    expect(sceneProblems(temple({ paleYard: true, terraced: true }))).toEqual(['13 things[5].params.paleYard']);
    // 别的零件不认这个参数
    expect(sceneProblems((s) => (s.things[4].params = { paleYard: true }))).toEqual(['13 things[4].params.paleYard']);
  });

  it('浅色的院子画在先画好的地面上，哪一节都在：院落写了 when、或者没有围墙（enclosed: false），都不能写（规则 13）', () => {
    expect(sceneProblems(temple({ paleYard: true, enclosed: true }))).toEqual([]);
    expect(sceneProblems(temple({ paleYard: true, enclosed: false }))).toEqual(['13 things[5].params.paleYard']);
    const later = (params: Record<string, boolean>) => (s: StopScene): void => {
      temple(params)(s);
      s.things[5].when = { from: s.sections[1].heading };
    };
    expect(sceneProblems(later({ paleYard: true }))).toEqual(['13 things[5].params.paleYard']);
    // 不写 paleYard 的院落照旧可以写 when、可以没有围墙
    expect(sceneProblems(later({ enclosed: false }))).toEqual([]);
  });

  it('竹和柏只在“一块地方”和“一个点周围”种得出细高的：沿一条线、摆满整块沙盘的查出来；别的树照旧（规则 13）', () => {
    const grove = (type: string, where: 'area' | 'at' | 'line' | 'all') => (s: StopScene): void => {
      const ring = someArea(s);
      const place = where === 'area' ? { area: ring } : where === 'at' ? { at: ring[0] } : where === 'line' ? { line: ring.slice(0, 2) } : {};
      s.dressing.push({ id: 'grove', name: '一片树', kind: 'trees', ...place, params: { type }, class: 'dressing', basis: '只表示有树。', sourceIds: [] });
    };
    for (const type of ['bamboo', 'cypress']) {
      expect(sceneProblems(grove(type, 'area')), type).toEqual([]);
      expect(sceneProblems(grove(type, 'at')), type).toEqual([]);
      expect(sceneProblems(grove(type, 'line')), type).toEqual(['13 dressing[5].params.type']);
      expect(sceneProblems(grove(type, 'all')), type).toEqual(['13 dressing[5].params.type']);
    }
    expect(sceneProblems(grove('willow', 'line'))).toEqual([]);
    expect(sceneProblems(grove('pine', 'all'))).toEqual([]);
  });

  it('小松树（young）只给松，只写在“一块地方”和“一个点周围”（规则 13）', () => {
    const pines = (type: string, where: 'area' | 'at' | 'line' | 'all', young: unknown = true) => (s: StopScene): void => {
      const ring = someArea(s);
      const place = where === 'area' ? { area: ring } : where === 'at' ? { at: ring[0] } : where === 'line' ? { line: ring.slice(0, 2) } : {};
      s.dressing.push({ id: 'saplings', name: '小松树', kind: 'trees', ...place, params: { type, young } as never, class: 'dressing', basis: '只表示有树。', sourceIds: [] });
    };
    expect(sceneProblems(pines('pine', 'area'))).toEqual([]);
    expect(sceneProblems(pines('pine', 'at'))).toEqual([]);
    expect(sceneProblems(pines('pine', 'line'))).toEqual(['13 dressing[5].params.young']);
    expect(sceneProblems(pines('pine', 'all'))).toEqual(['13 dressing[5].params.young']);
    for (const type of ['mixed', 'willow', 'fruit']) expect(sceneProblems(pines(type, 'area')), type).toEqual(['13 dressing[5].params.young']);
    // 写了 false 就是平常的树，哪种都行；写的不是“是或否”，照参数的样子查出来
    expect(sceneProblems(pines('willow', 'line', false))).toEqual([]);
    expect(sceneProblems(pines('pine', 'area', 'yes'))).toEqual(['13 dressing[5].params.young']);
  });

  it('眉州添的三种零件：浮桥写两个点的一条线，只摆在水位是平时的小节里；池、坟各写一个点，都只能摆在地上（规则 13）', () => {
    const grounds = { class: 'schematic' as const, basis: '只表示有这样东西。', sourceIds: [] };
    /** calm：只摆在水位是平时的那几节里（样本里有大水的小节）；不写 when 就是每一节都在。 */
    /** 跨过样本里那条河的两个桥头：在它中线的两边，各在画的宽度外面 off 米；shift 是两头一起顺着桥线挪多少米。 */
    const across = (s: StopScene, off = 20, shift = 0): [number, number][] => {
      const coords = frameCoords(s.frame);
      const river = s.water.rivers[0];
      const k = Math.floor((river.line.length - 1) / 2);
      const [a, b] = [coords.toLocal(river.line[k]), coords.toLocal(river.line[k + 1])];
      const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const n = [-(b[1] - a[1]) / length, (b[0] - a[0]) / length];
      const mid = [(a[0] + b[0]) / 2 + n[0] * shift, (a[1] + b[1]) / 2 + n[1] * shift];
      const d = river.drawWidthM / 2 + off;
      return [coords.toLngLat(mid[0] - n[0] * d, mid[1] - n[1] * d), coords.toLngLat(mid[0] + n[0] * d, mid[1] + n[1] * d)];
    };
    const bridge = (points: number, calm = true, line?: (s: StopScene) => [number, number][]) => (s: StopScene): void => {
      const two = line ? line(s) : across(s);
      const when = calm ? { when: { only: s.sections.filter((section) => section.water === 'normal').map((section) => section.heading) } } : {};
      s.things.push({ id: 'boats-bridge', name: '浮桥', kind: 'pontoon-bridge', line: points === 3 ? [two[0], someArea(s)[0], two[1]] : two.slice(0, points), ...when, ...grounds });
    };
    const last = (s: StopScene): number => s.things.length;
    const at = (run: (s: StopScene) => void): string[] => {
      let index = 0;
      const found = sceneProblems((s) => {
        index = last(s);
        run(s);
      });
      return found.map((line) => line.replace(`things[${index}]`, 'things[新]'));
    };
    expect(at(bridge(2))).toEqual([]);
    expect(at(bridge(3))).toEqual(['13 things[新].line']);
    expect(at(bridge(1))).toEqual(['13 things[新].line']);
    // 样本里有水位不是平时的小节：浮桥不写 when（每一节都在）就查出来
    expect(at((s) => expect(s.sections.some((section) => section.water !== 'normal')).toBe(true))).toEqual([]);
    expect(at(bridge(2, false))).toEqual(['13 things[新].when']);
    // 两个点是同一个点：什么也摆不出来
    expect(at(bridge(2, true, (s) => [across(s)[0], across(s)[0]]))).toEqual(['13 things[新].line']);
    // 上面那一行只看规则号和字段：“同一个点”这一条不查了，同样的两个点会让“桥头对不上河”那一条报在同一处，分不出来。所以看报出来的那一句话
    const same = validateContent(editScene(bridge(2, true, (s) => [across(s)[0], across(s)[0]])), SIZES).filter((v) => v.rule === 13);
    expect(same).toHaveLength(1);
    expect(same[0].problem).toContain('线的两个点是同一个点');
    expect(same[0].problem).not.toContain('哪一条河也对不上');
    // 反过来，两个不一样的点对不上河的，报的是另一句
    const apart = validateContent(editScene(bridge(2, true, (s) => across(s, 100))), SIZES).filter((v) => v.rule === 13);
    expect(apart.map((v) => v.problem)).toEqual([expect.stringContaining('哪一条河也对不上')]);
    // 两个桥头要各在同一条河的一边、在干地上、离岸不到 60 米（河岸画出来有二三十米的出入，各留 30 米的量）
    expect(at(bridge(2, true, (s) => across(s, 55)))).toEqual([]);
    expect(at(bridge(2, true, (s) => across(s, -25)))).toEqual([]);
    expect(at(bridge(2, true, (s) => across(s, 100)))).toEqual(['13 things[新].line']);
    expect(at(bridge(2, true, (s) => across(s, -40)))).toEqual(['13 things[新].line']);
    // 两头在河的同一边（整座桥挪到岸上去了）
    expect(at(bridge(2, true, (s) => across(s, 20, s.water.rivers[0].drawWidthM + 60)))).toEqual(['13 things[新].line']);
    // 池、坟
    const point = (kind: 'pool' | 'grave-mound', extra: Partial<StopScene['things'][number]> = {}) => (s: StopScene): void => {
      s.things.push({ id: 'small-work', name: '一样小东西', kind, at: someArea(s)[0], ...grounds, ...extra });
    };
    expect(at(point('pool', { params: { size: 'large', stone: true } }))).toEqual([]);
    expect(at(point('grave-mound', { params: { size: 'small' } }))).toEqual([]);
    expect(at(point('pool', { params: { size: 'huge' } }))).toEqual(['13 things[新].params.size']);
    expect(at(point('grave-mound', { params: { stone: true } }))).toEqual(['13 things[新].params.stone']);
    expect(at((s) => point('pool', { on: s.things[0].id })(s))).toEqual(['13 things[新].on']);
    expect(at((s) => point('grave-mound', { at: undefined, line: someArea(s).slice(0, 2) })(s))).toEqual(['13 things[新].at', '13 things[新].line']);
  });

  it('窄的河上不画水纹的门槛（water.calmUnderPx）可以不写；写了要是正数，还要有至少一条河（规则 13）', () => {
    expect(sceneProblems((s) => (s.water.calmUnderPx = 48))).toEqual([]);
    // 一条河也没有：门槛照最宽的一条河算，没有河就是每一节都不画水纹
    const noRivers = (lever: boolean) => (s: StopScene): void => {
      s.water.rivers = [];
      if (lever) s.water.calmUnderPx = 48;
    };
    expect(sceneProblems(noRivers(true))).toContain('13 water.calmUnderPx');
    expect(sceneProblems(noRivers(false))).not.toContain('13 water.calmUnderPx');
    expect(sceneProblems((s) => (s.water.calmUnderPx = 0))).toEqual(['0 water.calmUnderPx']);
    expect(sceneProblems((s) => ((s.water as unknown as { calmUnderPx: unknown }).calmUnderPx = '48'))).toEqual(['0 water.calmUnderPx']);
  });

  it('宽的路（roads 的 wide）只写一条线，不写在城墙里面；“这几圈里不种”（exceptAreas）只有树的规则可以写，每一圈至少三个点（规则 13）', () => {
    const grounds = { class: 'dressing' as const, basis: '只表示有路、有树。', sourceIds: [] };
    const road = (where: 'inside' | 'line', type: 'street' | 'road' | 'wide') => (s: StopScene): void => {
      const wall = s.things.find((t) => t.kind === 'wall');
      if (!wall) throw new Error('样本里没有城墙');
      s.dressing.push({ id: 'a-road', name: '一条路', kind: 'roads', ...(where === 'inside' ? { inside: wall.id } : { line: someArea(s).slice(0, 2) }), params: { type }, ...grounds });
    };
    expect(sceneProblems(road('line', 'wide'))).toEqual([]);
    expect(sceneProblems(road('inside', 'street'))).toEqual([]);
    expect(sceneProblems(road('inside', 'wide'))).toEqual(['13 dressing[5].params.type']);
    const grove = (kind: 'trees' | 'rocks', areas: (s: StopScene) => [number, number][][]) => (s: StopScene): void => {
      s.dressing.push({ id: 'a-grove', name: '一片树或者石头', kind, at: someArea(s)[0], exceptAreas: areas(s), ...grounds });
    };
    expect(sceneProblems(grove('trees', (s) => [someArea(s)]))).toEqual([]);
    expect(sceneProblems(grove('trees', () => []))).toEqual([]);
    expect(sceneProblems(grove('rocks', (s) => [someArea(s)]))).toEqual(['13 dressing[5].exceptAreas']);
    expect(sceneProblems(grove('trees', (s) => [someArea(s), someArea(s).slice(0, 2)]))).toEqual(['13 dressing[5].exceptAreas[1]']);
  });

  it('题签的 lean（往哪一头偏一格）：要同 side 一起写，两样一横一竖；指着远处的题签不能写（规则 15）', () => {
    let index = -1;
    const found = (run: (s: StopScene) => void): string[] => sceneProblems(run).map((line) => line.replace(`strips[${index}]`, '题签'));
    /** 头一条不指着远处的题签写上这两样（不写的那一样去掉）。 */
    const written = (side: StopScene['strips'][number]['side'], lean: StopScene['strips'][number]['lean'], far = false) => (s: StopScene): void => {
      const strip = s.strips.find((t) => s.far.some((f) => f.id === t.of) === far);
      if (!strip) throw new Error('样本里没有这样的题签');
      index = s.strips.indexOf(strip);
      delete strip.side;
      delete strip.lean;
      if (side) strip.side = side;
      if (lean) strip.lean = lean;
    };
    // 一横一竖，四边各两头：都行
    for (const [side, lean] of [['above', 'left'], ['above', 'right'], ['below', 'left'], ['below', 'right'], ['left', 'above'], ['left', 'below'], ['right', 'above'], ['right', 'below']] as const) {
      expect(found(written(side, lean)), `${side} ${lean}`).toEqual([]);
    }
    expect(found(written('above', undefined))).toEqual([]);
    // 没有写 side；两样都是横的、都是竖的、同一个词
    expect(found(written(undefined, 'left'))).toEqual(['15 题签.lean']);
    expect(found(written('above', 'below'))).toEqual(['15 题签.lean']);
    expect(found(written('above', 'above'))).toEqual(['15 题签.lean']);
    expect(found(written('left', 'right'))).toEqual(['15 题签.lean']);
    // 指着远处的题签
    expect(found(written('above', 'left', true))).toEqual(['15 题签.lean']);
    // 句子说得出毛病在哪
    const said = (run: (s: StopScene) => void): string => {
      const copy = structuredClone(goodScene());
      run(copy);
      return checkSceneStrips(copy, 'a.json').map((v) => v.problem).join('\n');
    };
    expect(said(written(undefined, 'left'))).toContain('却没有写 side');
    expect(said(written('above', 'below'))).toContain('side 是 above、below 时 lean 写 left 或 right');
    expect(said(written('above', 'left', true))).toContain('不能写 lean');
  });

  it('指着远处的题签可以不挂在正对着它的那一点上：还在沙盘的边上、离那一点不超过两公里、依据里有一句说为什么，才行（规则 15）', () => {
    let index = -1;
    /** 查出来的毛病里，那条题签的位置换成“题签”两个字（它在样本里排第几不要紧）。 */
    const found = (run: (s: StopScene) => void): string[] => sceneProblems(run).map((line) => line.replace(`strips[${index}]`, '题签'));
    const bad = ['15 题签.at'];
    /** 远镇的题签挪到沿着沙盘的边 along 米、往里 inward 米的地方；why 是依据里添不添那一句。 */
    const moved = (along: number, inward: number, why: boolean) => (s: StopScene): void => {
      const coords = frameCoords(s.frame);
      const far = s.far[0];
      const [x, z] = coords.toLocal(farEdgePoint(s.frame, far.at).point);
      // 正对着它的那一点在哪一条边上：沿着那条边挪，往沙盘里面缩
      const onX = Math.min(Math.abs(x - coords.x0), Math.abs(x - coords.x1)) < 1;
      const into = (v: number, lo: number, hi: number): number => (Math.abs(v - lo) < 1 ? v + inward + 1 : Math.abs(v - hi) < 1 ? v - inward - 1 : v);
      // 往这条边的中间挪（样本里那一点离沙盘的角不远，往外挪就出了沙盘）；贴着边写的数来回一换算会差出一点点，所以再往里缩 1 米
      const toward = (v: number): number => v - Math.sign(v) * along;
      const at = onX ? coords.toLngLat(into(x, coords.x0, coords.x1), toward(z)) : coords.toLngLat(toward(x), into(z, coords.z0, coords.z1));
      const strip = s.strips.find((t) => t.of === far.id);
      if (!strip) throw new Error('样本里没有指着远处的题签');
      index = s.strips.indexOf(strip);
      strip.at = at;
      if (why) far.basis += '沙盘上它的题签挂在路出沙盘的地方。';
    };
    // 三百米以内和别的题签一样，不用说为什么
    expect(found(moved(250, 0, false))).toEqual([]);
    // 一千米：在边上、说了为什么，行；没说，不行；不在边上（往里两百米），不行
    expect(found(moved(1000, 0, true))).toEqual([]);
    expect(found(moved(1000, 0, false))).toEqual(bad);
    expect(found(moved(1000, 200, true))).toEqual(bad);
    // 两公里以外，说了也不行。样本的沙盘小，沿着一条边挪不出两公里；拿眉州真的场景试：嘉州的题签沿着南边再往西挪
    expect(FAR_STRIP_AT_MAX_M).toBe(2000);
    if (realSceneKeys().includes('su-shi/meishan')) {
      const real = (away: number): string[] => {
        const copy = structuredClone(realSceneFile('su-shi/meishan').scene);
        const coords = frameCoords(copy.frame);
        const far = copy.far.find((f) => f.id === 'jiazhou');
        const strip = copy.strips.find((t) => t.of === 'jiazhou');
        if (!far || !strip) throw new Error('眉州的场景里没有嘉州');
        const [x, z] = coords.toLocal(farEdgePoint(copy.frame, far.at).point);
        // 正对着嘉州的那一点在南边上：沿着南边往西挪 away 米（还在沙盘里），往里缩 1 米
        strip.at = coords.toLngLat(x - away, z - 1);
        return checkSceneStrips(copy, 'meishan.json').map((v) => `${v.rule} ${v.field}`);
      };
      expect(real(1662)).toEqual([]);
      expect(real(1990)).toEqual([]);
      expect(real(2100)).toHaveLength(1);
      expect(real(2100)[0]).toMatch(/^15 strips\[\d+\]\.at$/);
    }
    expect(found(moved(1990, 0, true))).toEqual([]);
    // （样本的沙盘小，挪这么远会挪到沙盘外面去，规则 11 另报一条：这里只看规则 15 的那一条在不在）
    expect(found(moved(2100, 0, true))).toContain(bad[0]);
  });

  it('崖脚的石头（rocks 的 shore）要有一个比平时低 1.7 米以上的水位；这个数就是石头那一带的两个门槛加起来（规则 13）', () => {
    expect(SHORE_ROCKS_NEED_M).toBeCloseTo(SHORE_ABOVE_LOWEST_M + SHORE_UNDER_NORMAL_M, 9);
    const stones = (lowBy: number | null) => (s: StopScene): void => {
      s.dressing.push({ id: 'stones', name: '崖脚的石头', kind: 'rocks', at: someArea(s)[0], params: { type: 'shore' }, class: 'dressing', basis: '只表示有石头。', sourceIds: [] });
      if (lowBy !== null) {
        s.water.levels.values.low = s.water.levels.values.normal - lowBy;
        s.sections[0].water = 'low';
      }
    };
    // 样本里最低的水位就是平时的水位：一块也摆不出来
    expect(sceneProblems(stones(null))).toEqual(['13 dressing[5].params.type']);
    expect(sceneProblems(stones(1.6))).toEqual(['13 dressing[5].params.type']);
    expect(sceneProblems(stones(1.7))).toEqual([]);
    expect(sceneProblems(stones(3))).toEqual([]);
  });

  it('每一个水位都有小节在用：留着一个哪一节也不用的水位，查出来（规则 14）', () => {
    expect(sceneProblems((s) => (s.water.levels.values.trial = 10))).toEqual(['14 water.levels.values.trial']);
    expect(sceneProblems((s) => {
      s.water.levels.values.trial = 10;
      s.sections[0].water = 'trial';
    })).toEqual([]);
  });

  it('新添的两种零件：矮土墙写一条线，小门写一个点；矮土墙不能当城门的城墙', () => {
    const wall = (scene: StopScene): void => {
      scene.things.push({ id: 'old-wall', name: '矮土墙', kind: 'earth-wall', line: someArea(scene).slice(0, 2), params: { ruined: true, fence: true }, class: 'schematic', basis: '只表示有一段墙。', sourceIds: [] });
    };
    expect(sceneProblems(wall)).toEqual([]);
    expect(sceneProblems((s) => {
      wall(s);
      s.things[5].params = { ruined: 1 };
    })).toEqual(['13 things[5].params.ruined']);
    const at = goodScene().things[4].at;
    expect(sceneProblems((s) => s.things.push({ id: 'door', name: '小门', kind: 'small-gate', at, facing: 90, class: 'schematic', basis: '只表示有一座门。', sourceIds: [] }))).toEqual([]);
    expect(sceneProblems((s) => s.things.push({ id: 'door', name: '小门', kind: 'small-gate', line: someArea(s).slice(0, 2), class: 'schematic', basis: '只表示有一座门。', sourceIds: [] }))).toEqual(['13 things[5].at', '13 things[5].line']);
    // 城门的 on 写一道矮土墙：不行，城门只能开在城墙上
    expect(sceneProblems((s) => {
      wall(s);
      s.things[1].on = 'old-wall';
    })).toEqual(['13 things[1].on']);
  });

  it('远处照他的话写的那一句（inHisWords）：只能是汉字，2 到 12 个（规则 15）', () => {
    expect(sceneProblems((s) => (s.far[0].inHisWords = '往东南约三十里'))).toEqual([]);
    expect(sceneProblems((s) => (s.far[0].inHisWords = '往东'))).toEqual([]);
    expect(sceneProblems((s) => (s.far[0].inHisWords = '往东南约 30 里'))).toEqual(['15 far[0].inHisWords']);
    expect(sceneProblems((s) => (s.far[0].inHisWords = '里'))).toEqual(['15 far[0].inHisWords']);
    expect(sceneProblems((s) => (s.far[0].inHisWords = '往东南方向走上约莫三十多里路'))).toEqual(['15 far[0].inHisWords']);
    expect(sceneProblems((s) => (s.far[0].inHisWords = '往东南，三十里'))).toEqual(['15 far[0].inHisWords']);
    // 不是字的算格式不对
    expect(looseProblems<{ far: { inHisWords: unknown }[] }>((s) => (s.far[0].inHisWords = 30))).toEqual(['0 far[0].inHisWords']);
  });

  it('只在题记下面说、不立题签的远处（小节的 farLine）：只能是写了 inHisWords 的远处，这一节不能又有它的题签，不能写两遍（规则 14）', () => {
    // 样本里的远处“东港”在“渡口”一节立着题签；“上船”一节没有它的题签
    const inWords = (s: StopScene): void => void (s.far[0].inHisWords = '往东南约三十里');
    expect(sceneProblems((s) => {
      inWords(s);
      s.sections[0].farLine = ['far-port'];
    })).toEqual([]);
    // 坐标确实的远处（没有写 inHisWords）：不行，要立题签
    expect(sceneProblems((s) => (s.sections[0].farLine = ['far-port']))).toEqual(['14 sections[0].farLine[0]']);
    // 不是远处的 id
    expect(sceneProblems((s) => {
      inWords(s);
      s.sections[0].farLine = ['east-hill'];
    })).toEqual(['14 sections[0].farLine[0]']);
    // 这一节已经有它的题签了
    expect(sceneProblems((s) => {
      inWords(s);
      s.sections[2].farLine = ['far-port'];
    })).toEqual(['14 sections[2].farLine[0]']);
    // 写了两遍
    expect(sceneProblems((s) => {
      inWords(s);
      s.sections[0].farLine = ['far-port', 'far-port'];
    })).toEqual(['14 sections[0].farLine[1]']);
    // 不是名单算格式不对
    expect(looseProblems<{ sections: { farLine: unknown }[] }>((s) => (s.sections[0].farLine = 'far-port'))).toEqual(['0 sections[0].farLine']);
  });

  it('矮土墙的 low（只有一半高）：是或者不是；写成别的算规则 13', () => {
    const dike = (s: StopScene): number => s.things.push({ id: 'low-dike', name: '矮土堤', kind: 'earth-wall', line: someArea(s).slice(0, 2), params: { low: true }, class: 'schematic', basis: '只表示有一道堤。', sourceIds: [] }) - 1;
    expect(sceneProblems((s) => void dike(s))).toEqual([]);
    expect(sceneProblems((s) => {
      const i = dike(s);
      (s.things[i].params as Record<string, unknown>).low = 'yes';
    })).toEqual([`13 things[${goodScene().things.length}].params.low`]);
  });

  it('小节的云气几成（mist）：0 到 1 之间的数；出了这个范围、不是数，算格式不对', () => {
    expect(sceneProblems((s) => (s.sections[1].mist = 0))).toEqual([]);
    expect(sceneProblems((s) => (s.sections[1].mist = 0.5))).toEqual([]);
    expect(sceneProblems((s) => (s.sections[1].mist = 1))).toEqual([]);
    expect(sceneProblems((s) => (s.sections[1].mist = 1.2))).toEqual(['0 sections[1].mist']);
    expect(sceneProblems((s) => (s.sections[1].mist = -0.1))).toEqual(['0 sections[1].mist']);
    expect(looseProblems<{ sections: { mist: unknown }[] }>((s) => (s.sections[1].mist = 'none'))).toEqual(['0 sections[1].mist']);
  });
});
