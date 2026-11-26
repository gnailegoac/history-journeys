// 拍定格图的工具里不靠浏览器的部分（tests/support/pictureKey.ts、programKey.ts、stillsTool.ts）。在 Node 里跑。
//
// 查这几样：
//   场景的记号（pictureKey）：改依据、说明、题记、名字、题签上的字，记号不变；改镜头、题签指的点、摆件、水位，记号变。
//   程序的记号（programKey）：哪个文件差一个字节、哪个库换了版本，记号就变；工具和测试读的是同一批文件。
//   画面变没变：截图差一小块（30 × 30 像素），像素的记号就不一样，这张图算“变了”；一模一样而且文件还在，才留着不动。
//   两种形状各照什么拍；从沙盘的读数做出清单里的一项；工具自己的几项检查；清单写成什么样；给人看的那一页。

import { deflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import packageJson from '../../package.json';
import { contentKey } from '../../src/domain/contentKey';
import { SCENE_STYLES } from '../../src/domain/scene';
import type { RouteScene, StopScene, TableScene } from '../../src/domain/scene';
import { loadStopTable } from '../../src/domain/sceneContent';
import type { StillManifest } from '../../src/domain/stills';
import { FAMILIES } from '../../src/stage/families';
import { groundKey } from '../../src/stage/ground/key';
import { FIT_MARGIN_PX, MAX_FIT } from '../../src/stage/three/rig';
import type { StageShot } from '../../src/stage/types';
import { STILL_MAX_BYTES as BUDGET_STILL_MAX_BYTES } from '../content/budgetRules';
import { fixtureScene } from '../support/fixtureScene';
import { pictureKey, pictureParts } from '../support/pictureKey';
import { decodePng } from '../support/png';
import {
  FAMILY_FOLDER,
  LEFT_OUT_FILES,
  PROGRAM_FILES,
  PROGRAM_FOLDERS,
  ROUTE_LEVEL_FILES,
  STYLE_FILES,
  STYLE_FOLDER,
  STYLE_SHARED_FILES,
  inTableKey,
  isProgramPath,
  programKey,
  programPart,
  styleFilesIn,
  stylesClaiming,
  tableFiles,
  type TableUse,
} from '../support/programKey';
import { namesIn } from '../support/readBytes';
import { fixtureStills } from '../support/stills-fixture';
import {
  SHAPE_PLANS,
  SHOT_CAMERA,
  STILL_MAX_BYTES,
  checkShot,
  fileExists,
  flatColour,
  groundKeyOf,
  hexColour,
  keepStill,
  keepWithin,
  madeFromNow,
  manifestText,
  paneColour,
  pixelSum,
  programVersions,
  rawKey,
  readFile,
  readProgramFiles,
  readTableFiles,
  relativePath,
  reviewPage,
  reviewWord,
  shapeSpec,
  shotInsets,
  shotViewport,
  stillFile,
  stillFromShot,
  tableUse,
  worstTileOf,
  type RawPicture,
} from '../support/stillsTool';

const realScenes = import.meta.glob<TableScene>('/content/figures/*/scenes/*.json', { import: 'default', eager: true });

const KEY = /^[0-9a-f]{16}$/;

// ---------------------------------------------------------------- 场景的记号

describe('场景里决定画面的那一部分的记号（pictureKey）', () => {
  const base = pictureKey(fixtureScene());
  /** 改一处以后的记号。 */
  const after = (change: (scene: StopScene) => void): string => {
    const scene = fixtureScene();
    change(scene);
    return pictureKey(scene);
  };

  it('是 16 个十六进制字符；同一份场景每次算出来一样', () => {
    expect(base).toMatch(KEY);
    expect(pictureKey(fixtureScene())).toBe(base);
    // 从文件读出来的（JSON）和程序里拼出来的一样
    expect(pictureKey(JSON.parse(JSON.stringify(fixtureScene())))).toBe(base);
  });

  it.each<[string, (scene: StopScene) => void]>([
    ['依据（basis）', (s) => void (s.things[0].basis = '另一句依据')],
    ['地形的依据', (s) => void (s.terrain.basis = '另一句')],
    ['说明（note）', (s) => void (s.things[0].note = '另一句说明')],
    ['说不准的部分（unsure）', (s) => void (s.things[1].unsure = '别的')],
    ['出处（sourceIds）', (s) => void (s.things[1].sourceIds = ['f2'])],
    ['用了谁的数据（credits）', (s) => void s.credits.push('再加一条')],
    ['没有画的东西（notDrawn）', (s) => void (s.notDrawn = [])],
    ['小节的时间（date）', (s) => void (s.sections[0].date = '某年冬')],
    ['题记（小节的 line）', (s) => void (s.sections[0].line = '另一句题记。')],
    ['说明先讲哪几样（explain）', (s) => void (s.sections[1].explain = ['levels'])],
    ['摆件的名字（name）', (s) => void (s.things[0].name = '外城')],
    ['河的名字', (s) => void (s.water.rivers[0].name = '别的水')],
    ['远处的括注（gloss）', (s) => void (s.far[0].gloss = '今别处')],
    ['题签上的字（text）', (s) => void (s.strips[0].text = '别城')],
    ['题签上今天的名字（modern）', (s) => void (s.strips[0].modern = '别市')],
    ['添上今天的名字', (s) => void (s.strips[1].modern = '样河')],
  ])('改%s：记号不变', (_what, change) => {
    expect(after(change)).toBe(base);
  });

  it.each<[string, (scene: StopScene) => void]>([
    ['镜头的距离', (s) => void (s.sections[0].camera.distanceM += 1)],
    ['镜头的倾角', (s) => void (s.sections[1].camera.pitch -= 1)],
    ['镜头对准的点', (s) => void (s.sections[1].camera.target = [117.001, 34.001])],
    ['镜头的 closest', (s) => void (s.sections[1].camera.closest = 0.7)],
    ['一定要看得见的东西（mustShow）', (s) => void (s.sections[0].camera.mustShow = ['wall'])],
    ['题签指在哪一点（at）', (s) => void (s.strips[0].at = [117.0001, 34.0001])],
    ['题签指着哪样东西（of）', (s) => void (s.strips[0].of = 'gate-south')],
    ['题签最好摆在哪一边（side）', (s) => void (s.strips[0].side = 'left')],
    ['这一节摆哪几条题签', (s) => void (s.sections[0].strips = ['s-town'])],
    ['摆件的位置', (s) => void (s.things[1].at = [117.0002, 34.0002])],
    ['摆件的参数', (s) => void (s.things[0].params = { face: 'brick', parapet: true })],
    ['摆件什么时候有（when）', (s) => void (s.things[2].when = undefined)],
    ['少一样摆件', (s) => void s.things.pop()],
    ['摆件的类别（class）', (s) => void (s.things[0].class = 'text')],
    ['城墙的一个点（摆件的 line）', (s) => void (s.things[0].line![0] = [117.00001, 34.00001])],
    ['河的一个点（河的 line）', (s) => void (s.water.rivers[0].line[1] = [117.0003, 34.0003])],
    ['河画多宽', (s) => void (s.water.rivers[0].drawWidthM += 10)],
    ['一个水位', (s) => void (s.water.levels.values.flood += 0.5)],
    ['这一节用哪个水位', (s) => void (s.sections[1].water = 'normal')],
    ['点缀的参数', (s) => void (s.dressing[0].params = { lanes: true, seed: 8 })],
    ['地名点的位置', (s) => void (s.places[0].at = [117.01, 34.01])],
    ['远处的位置', (s) => void (s.far[0].at = [116.5, 33.5])],
    ['沙盘的范围', (s) => void (s.frame.eastM += 100)],
    ['山高夸大几倍', (s) => void (s.frame.relief = { kind: 'uniform', times: 5 })],
    ['地形整理的一个数', (s) => void (s.terrain.recipe.plainBaseM += 1)],
    ['一处修整的高度', (s) => void ((s.terrain.edits[0] as { toM: number }).toM += 1)],
    ['小节的标题', (s) => void (s.sections[0].heading = '最初')],
    ['样式', (s) => void ((s as { style: string }).style = 'another-style')],
  ])('改%s：记号变了', (_what, change) => {
    expect(after(change)).not.toBe(base);
  });

  it('天色和月亮：定格图的记号变，地面的记号不变（夜里的小节要拍定格图，不用另外画地面）', () => {
    const night = (s: StopScene): void => {
      s.sections[1].sky = 'night';
      s.sections[1].moon = { azimuth: 103, altitude: 12 };
    };
    expect(after(night)).not.toBe(base);
    // 同是夜里，月亮换了地方，画面也不一样
    const moved = after((s) => {
      night(s);
      s.sections[1].moon = { azimuth: 130, altitude: 68 };
    });
    expect(moved).not.toBe(after(night));
    expect(moved).not.toBe(base);
    const scene = fixtureScene();
    const ground = groundKey(scene);
    night(scene);
    expect(groundKey(scene)).toBe(ground);
  });

  it('水位的名字、零件参数的名字是作者起的：叫 name、note 也照样算', () => {
    expect(after((s) => void (s.water.levels.values.name = 50))).not.toBe(base);
    const withNote = after((s) => void (s.water.levels.values.note = 50));
    expect(withNote).not.toBe(base);
    expect(after((s) => void (s.water.levels.values.note = 51))).not.toBe(withNote);
  });

  it('去掉的只是那几种字段：坐标、镜头、题签指着哪样东西都还在', () => {
    const parts = pictureParts(fixtureScene()) as StopScene;
    const text = JSON.stringify(parts);
    for (const dropped of ['basis', 'sourceIds', 'unsure', 'note', 'credits', 'notDrawn', 'date', 'explain', 'gloss', 'modern']) {
      expect(text, dropped).not.toContain(`"${dropped}":`);
    }
    expect(text).not.toContain('"name":');
    expect(text).not.toContain('"text":');
    // 远处照当时人的话写的那一句（inHisWords）只印在题记下面：改它，记号不变；它的坐标变了，记号变
    const words = (said: string) => (s: StopScene): void => void (s.far[0].inHisWords = said);
    expect(after(words('往东南约三十里'))).toBe(base);
    expect(after(words('往东'))).toBe(base);
    expect(after((s) => void (s.far[0].at = [s.far[0].at[0] + 0.01, s.far[0].at[1]]))).not.toBe(base);
    expect(parts.things[0].line).toHaveLength(4);
    expect(parts.water.rivers[0].line).toHaveLength(3);
    expect(parts.sections[0]).toEqual({ heading: '起初', camera: fixtureScene().sections[0].camera, water: 'normal', strips: ['s-town', 's-river'] });
    expect(parts.strips[0]).toEqual({ id: 's-town', of: 'wall', at: fixtureScene().strips[0].at });
    expect(parts.water.levels.values).toEqual(fixtureScene().water.levels.values);
  });

  it('content/ 里真的场景文件：算得出记号，改一个镜头的数就变，改一句依据不变', () => {
    // 两层的沙盘都查（全程沙盘写着 "level": "route"）：记号是同一个函数算的，去掉的也是同样那几种字段。
    // 这里只管“算得出、该变的变、不该变的不变”；两座沙盘的清单新不新由 stills-fresh 查。
    const paths = Object.keys(realScenes);
    expect(paths.filter((path) => realScenes[path].level === 'route').length).toBeGreaterThan(0);
    expect(paths.filter((path) => realScenes[path].level !== 'route').length).toBeGreaterThan(0);
    for (const path of paths) {
      const scene = realScenes[path];
      const key = pictureKey(scene);
      expect(key, path).toMatch(KEY);
      const moved = JSON.parse(JSON.stringify(scene)) as TableScene;
      moved.sections[0].camera.bearing += 1;
      expect(pictureKey(moved), path).not.toBe(key);
      const reworded = JSON.parse(JSON.stringify(scene)) as TableScene;
      // 改一句依据（站点沙盘上是头一样摆件的，全程沙盘上是头一趟路头一截的）、一句题记、一条题签上的字
      if (reworded.level === 'route') {
        reworded.roads.journeys[0].parts[0].basis += '（补一句）';
        reworded.roads.journeys[0].parts[0].note = '改一句说明';
        reworded.roads.journeys[0].name += '改';
        reworded.strips[0].modern = '改';
        // 全程沙盘自己的出处和“用了谁的数据”：改一条的写法、添一条，十八张图都不该算成旧的
        reworded.sources[0].cite += '（改了写法）';
        reworded.credits.push('再加一条');
      } else reworded.things[0].basis += '（补一句）';
      reworded.sections[0].line += '！';
      reworded.strips[0].text = '改';
      expect(pictureKey(reworded), path).toBe(key);
      // 全程沙盘：一截路换一种画法（实线、虚线看它的类别）、一条路挪一个点，画面就变
      if (scene.level === 'route') {
        const redrawn = JSON.parse(JSON.stringify(scene)) as RouteScene;
        redrawn.roads.journeys[0].parts[0].class = redrawn.roads.journeys[0].parts[0].class === 'text' ? 'schematic' : 'text';
        expect(pictureKey(redrawn), path).not.toBe(key);
        const rerouted = JSON.parse(JSON.stringify(scene)) as RouteScene;
        rerouted.roads.ways[0].line[0][0] += 0.01;
        expect(pictureKey(rerouted), path).not.toBe(key);
      }
    }
  });
});

// ---------------------------------------------------------------- 程序的记号

describe('沙盘程序和拍照工具的记号（programKey）', () => {
  const versions = { three: '0.187.0', playwright: '1.65.0' };
  const files = { 'src/stage/three/view.ts': 'const a = 1;\n', 'src/stage/ground/paint.ts': 'const b = 2;\n', 'stage-dev.html': '<html></html>\n' };
  const base = programKey(files, versions);

  it('是 16 个十六进制字符；文件传进来的先后不要紧；字节和原样的字算出来一样', () => {
    expect(base).toMatch(KEY);
    const reordered = { 'stage-dev.html': files['stage-dev.html'], 'src/stage/ground/paint.ts': files['src/stage/ground/paint.ts'], 'src/stage/three/view.ts': files['src/stage/three/view.ts'] };
    expect(programKey(reordered, versions)).toBe(base);
    const encoder = new TextEncoder();
    const asBytes = Object.fromEntries(Object.entries(files).map(([path, text]) => [path, encoder.encode(text)]));
    expect(programKey(asBytes, versions)).toBe(base);
  });

  it('一个文件差一个字节（哪怕是注释里的、哪怕只是一个换行）：记号变了', () => {
    for (const path of Object.keys(files) as (keyof typeof files)[]) {
      expect(programKey({ ...files, [path]: `${files[path]} ` }, versions), path).not.toBe(base);
      expect(programKey({ ...files, [path]: files[path].replace('\n', '\r\n') }, versions), path).not.toBe(base);
    }
    expect(programKey({ ...files, 'src/stage/three/view.ts': 'const a = 1; // 注释\n' }, versions)).not.toBe(base);
    expect(programKey({ ...files, 'src/stage/three/view.ts': 'const a = 2;\n' }, versions)).not.toBe(base);
  });

  it('多一个文件、少一个文件、文件换了名字：记号变了', () => {
    expect(programKey({ ...files, 'src/stage/three/new.ts': '' }, versions)).not.toBe(base);
    const { 'stage-dev.html': _dropped, ...fewer } = files;
    expect(programKey(fewer, versions)).not.toBe(base);
    const { 'src/stage/ground/paint.ts': moved, ...rest } = files;
    expect(programKey({ ...rest, 'src/stage/ground/colour.ts': moved }, versions)).not.toBe(base);
    // 两个文件的内容对调
    expect(programKey({ ...files, 'src/stage/three/view.ts': files['src/stage/ground/paint.ts'], 'src/stage/ground/paint.ts': files['src/stage/three/view.ts'] }, versions)).not.toBe(base);
  });

  it('three 或者 Playwright 换了版本：记号变了', () => {
    expect(programKey(files, { ...versions, three: '0.188.0' })).not.toBe(base);
    expect(programKey(files, { ...versions, playwright: '1.66.0' })).not.toBe(base);
    // 两个版本对调也不一样
    expect(programKey(files, { three: versions.playwright, playwright: versions.three })).not.toBe(base);
  });

  it('哪些文件算在里面，各归哪一类：各座沙盘共用的，一种样式自己的，一家零件自己的，全程沙盘才用的；小像和读内容的程序不算', () => {
    // 算在记号里的（至少算进一座沙盘的）
    for (const path of [
      'src/stage/three/view.ts',
      'src/stage/three/kit/things.ts',
      'src/stage/three/style/songQinglv.ts',
      'src/stage/ground/paint.ts',
      'src/stage/dev/harness.ts',
      'src/stage/scale.ts',
      'src/stage/roadLines.ts',
      'src/stage/three/routeKit.ts',
      'src/domain/scene.ts',
      'src/domain/sceneGeo.ts',
      'src/domain/sceneText.ts',
      'stage-dev.html',
      'tests/tools/make-stills.spec.ts',
      'tests/support/stillsTool.ts',
      'playwright.stills.config.ts',
    ]) {
      expect(isProgramPath(path), path).toBe(true);
    }
    // 哪一座沙盘的记号里都不算的
    for (const path of [
      'src/stage/still/engine.ts',
      'src/stage/overlay/strips.ts',
      'src/stage/types.ts',
      'src/stage/index.ts',
      'src/domain/stills.ts',
      'src/domain/contentKey.ts',
      'src/domain/sub/scene.ts',
      'src/ui/StagePane.tsx',
      'src/styles/stage.css',
      'tests/support/programKey.ts',
      'playwright.config.ts',
      'index.html',
      // 名字合得上、点了名不算的两个
      'src/stage/three/piece.ts',
      'src/domain/sceneContent.ts',
      // 登记零件的那张表、算小像站在哪的、内容的清单：都不在那几个文件夹里，名字也不以 scene 打头
      'src/stage/families.ts',
      'src/stage/pieceWhere.ts',
      'src/domain/contentLists.ts',
    ]) {
      expect(isProgramPath(path), path).toBe(false);
      expect(programPart(path), path).toEqual({ part: 'out' });
    }
    // 各归哪一类
    for (const path of [
      'src/stage/three/view.ts',
      'src/stage/three/internal.ts',
      'src/stage/three/table.ts',
      'src/stage/three/kit/things.ts',
      'src/stage/three/kit/families.ts',
      'src/stage/three/style/index.ts',
      'src/stage/ground/paint.ts',
      'src/stage/dev/harness.ts',
      'src/stage/scale.ts',
      'src/domain/scene.ts',
      'src/domain/sceneGeo.ts',
      'src/domain/sceneGeoRoute.ts',
      'src/domain/sceneKinds.ts',
      'src/domain/sceneParams.ts',
      'src/domain/sceneStripPoint.ts',
      'src/domain/sceneText.ts',
      'stage-dev.html',
      'tests/tools/make-stills.spec.ts',
      'tests/support/stillsTool.ts',
      'playwright.stills.config.ts',
    ]) {
      expect(programPart(path), path).toEqual({ part: 'shared' });
    }
    expect(programPart('src/stage/three/style/songQinglv.ts')).toEqual({ part: 'style', style: 'song-qinglv' });
    expect(programPart('src/stage/three/style/songQinglvFigure.ts')).toEqual({ part: 'style', style: 'song-qinglv' });
    for (const family of ['rock', 'plants', 'works']) expect(programPart(`src/stage/three/families/${family}.ts`), family).toEqual({ part: 'family', family });
    for (const path of ['src/stage/ground/route.ts', 'src/stage/roadLines.ts', 'src/stage/three/routeKit.ts', 'src/stage/three/routeLevel.ts']) expect(programPart(path), path).toEqual({ part: 'route' });
    // 几张单子，一个字不差
    expect(PROGRAM_FOLDERS).toEqual(['src/stage/three/', 'src/stage/ground/', 'src/stage/dev/']);
    expect(PROGRAM_FILES).toEqual(['src/stage/scale.ts', 'stage-dev.html', 'tests/tools/make-stills.spec.ts', 'tests/support/stillsTool.ts', 'playwright.stills.config.ts']);
    expect(ROUTE_LEVEL_FILES).toEqual(['src/stage/ground/route.ts', 'src/stage/roadLines.ts', 'src/stage/three/routeKit.ts', 'src/stage/three/routeLevel.ts']);
    expect(LEFT_OUT_FILES).toEqual(['src/stage/three/piece.ts', 'src/domain/sceneContent.ts']);
    expect(STYLE_FOLDER).toBe('src/stage/three/style/');
    expect(STYLE_SHARED_FILES).toEqual(['src/stage/three/style/index.ts']);
    expect(STYLE_FILES).toEqual({ 'song-qinglv': ['src/stage/three/style/songQinglv.ts', 'src/stage/three/style/songQinglvFigure.ts'] });
    expect(FAMILY_FOLDER).toBe('src/stage/three/families/');
  });

  it('工具和测试读的是磁盘上同一批文件：都在单子里，路径用“/”，版本就是 package.json 里写的', () => {
    const disk = readProgramFiles();
    const paths = Object.keys(disk);
    for (const path of paths) {
      expect(isProgramPath(path), path).toBe(true);
      expect(path).not.toContain('\\');
    }
    expect(paths).toEqual(
      expect.arrayContaining([
        'src/stage/three/view.ts',
        'src/stage/three/rig.ts',
        'src/stage/three/kit/figure.ts',
        'src/stage/three/style/songQinglv.ts',
        'src/stage/ground/paint.ts',
        'src/stage/dev/harness.ts',
        'src/stage/scale.ts',
        'src/domain/scene.ts',
        'src/domain/sceneGeo.ts',
        'stage-dev.html',
        'tests/tools/make-stills.spec.ts',
        'tests/support/stillsTool.ts',
        'playwright.stills.config.ts',
      ]),
    );
    expect(new Set(paths).size).toBe(paths.length);
    const now = programVersions();
    expect(now).toEqual({ three: packageJson.dependencies.three, playwright: packageJson.devDependencies['@playwright/test'] });
    // 读两遍算出来一样；把其中一个文件改一个字节就不一样
    const key = programKey(disk, now);
    expect(programKey(readProgramFiles(), programVersions())).toBe(key);
    const touched = { ...disk, 'src/stage/scale.ts': new Uint8Array([...disk['src/stage/scale.ts'], 0x20]) };
    expect(programKey(touched, now)).not.toBe(key);
  });
});

// ---------------------------------------------------------------- 一座沙盘的记号里算哪些文件

describe('一座沙盘的记号里算哪些文件（inTableKey、tableFiles），在编出来的文件单子上', () => {
  const versions = { three: '0.187.0', playwright: '1.65.0' };
  /** 编出来的两种样式：甲的文件直接放在样式的文件夹里（表里点名），乙的放在以它的名字命名的子文件夹里（照文件夹认；表里它那一行是空的，有这一行才认得它）。 */
  const styles: Record<string, string[]> = { 'style-a': ['src/stage/three/style/styleA.ts', 'src/stage/three/style/styleAFigure.ts'], 'style-b': [] };
  const files: Record<string, string> = {
    'src/stage/three/view.ts': 'view\n',
    'src/stage/three/style/index.ts': 'registry\n',
    'src/stage/three/style/styleA.ts': 'a\n',
    'src/stage/three/style/styleAFigure.ts': 'a figure\n',
    'src/stage/three/families/rock.ts': 'rock\n',
    'src/stage/three/families/plants.ts': 'plants\n',
    'src/stage/three/families/works.ts': 'works\n',
    'src/stage/ground/paint.ts': 'paint\n',
    'src/stage/ground/route.ts': 'route ground\n',
    'src/stage/roadLines.ts': 'road lines\n',
    'src/stage/three/routeKit.ts': 'route kit\n',
    'src/stage/three/routeLevel.ts': 'route level\n',
    'src/domain/scene.ts': 'scene\n',
    'tests/support/stillsTool.ts': 'tool\n',
  };
  /** 四座编出来的沙盘，都用甲这种样式：两座各用两家零件，一座一家不用，一座是全程沙盘。 */
  const tables: Record<string, TableUse> = {
    cliff: { style: 'style-a', families: ['rock', 'plants'], route: false },
    garden: { style: 'style-a', families: ['plants', 'works'], route: false },
    plain: { style: 'style-a', families: [], route: false },
    route: { style: 'style-a', families: [], route: true },
  };
  const names = Object.keys(tables);
  const keys = (from: Record<string, string>): Record<string, string> => Object.fromEntries(names.map((name) => [name, programKey(tableFiles(from, tables[name], styles), versions)]));
  const base = keys(files);
  /** 改了这批文件以后，哪几座沙盘的记号变了。 */
  const stale = (from: Record<string, string>): string[] => names.filter((name) => keys(from)[name] !== base[name]);
  const touch = (path: string): Record<string, string> => ({ ...files, [path]: `${files[path] ?? ''} ` });

  it('各座沙盘的记号里各有哪些文件', () => {
    const shared = ['src/domain/scene.ts', 'src/stage/ground/paint.ts', 'src/stage/three/style/index.ts', 'src/stage/three/style/styleA.ts', 'src/stage/three/style/styleAFigure.ts', 'src/stage/three/view.ts', 'tests/support/stillsTool.ts'];
    const listed = (name: string): string[] => Object.keys(tableFiles(files, tables[name], styles)).sort();
    expect(listed('plain')).toEqual(shared);
    expect(listed('cliff')).toEqual([...shared, 'src/stage/three/families/plants.ts', 'src/stage/three/families/rock.ts'].sort());
    expect(listed('garden')).toEqual([...shared, 'src/stage/three/families/plants.ts', 'src/stage/three/families/works.ts'].sort());
    expect(listed('route')).toEqual([...shared, 'src/stage/ground/route.ts', 'src/stage/roadLines.ts', 'src/stage/three/routeKit.ts', 'src/stage/three/routeLevel.ts'].sort());
    // 四座沙盘算的文件各不一样，记号也各不一样
    expect(new Set(Object.values(base)).size).toBe(4);
  });

  it('共用的文件改一个字节：四座都旧', () => {
    for (const path of ['src/stage/three/view.ts', 'src/stage/three/style/index.ts', 'src/stage/ground/paint.ts', 'src/domain/scene.ts', 'tests/support/stillsTool.ts']) expect(stale(touch(path)), path).toEqual(names);
    // 添一个共用的文件也是
    expect(stale({ ...files, 'src/stage/three/new.ts': '' })).toEqual(names);
    // 库换了版本也是
    expect(names.filter((name) => programKey(tableFiles(files, tables[name], styles), { ...versions, three: '0.188.0' }) !== base[name])).toEqual(names);
  });

  it('这种样式自己的文件改一个字节：用这种样式的都旧（这里是四座）', () => {
    expect(stale(touch('src/stage/three/style/styleA.ts'))).toEqual(names);
    expect(stale(touch('src/stage/three/style/styleAFigure.ts'))).toEqual(names);
  });

  it('另一种样式的文件——添进来、改它、再删掉——哪一座都不旧：放在以它的名字命名的子文件夹里的，和在表里点了名的，都一样', () => {
    const inFolder = { ...files, 'src/stage/three/style/style-b/look.ts': 'b\n', 'src/stage/three/style/style-b/figure.ts': 'b figure\n' };
    expect(stale(inFolder)).toEqual([]);
    expect(stale({ ...inFolder, 'src/stage/three/style/style-b/look.ts': 'b changed\n' })).toEqual([]);
    const both = { ...styles, 'style-b': ['src/stage/three/style/styleB.ts'] };
    const named = { ...files, 'src/stage/three/style/styleB.ts': 'b\n' };
    expect(names.filter((name) => programKey(tableFiles(named, tables[name], both), versions) !== base[name])).toEqual([]);
    // 用乙这种样式的沙盘才算它：记号里有乙的文件，没有甲的
    const other: TableUse = { style: 'style-b', families: [], route: false };
    expect(Object.keys(tableFiles(inFolder, other, styles)).filter((path) => path.startsWith(STYLE_FOLDER)).sort()).toEqual(['src/stage/three/style/index.ts', 'src/stage/three/style/style-b/figure.ts', 'src/stage/three/style/style-b/look.ts']);
    expect(programKey(tableFiles({ ...inFolder, 'src/stage/three/style/style-b/look.ts': 'b changed\n' }, other, styles), versions)).not.toBe(programKey(tableFiles(inFolder, other, styles), versions));
    expect(programKey(tableFiles(touch('src/stage/three/style/styleA.ts'), other, styles), versions)).toBe(programKey(tableFiles(files, other, styles), versions));
  });

  it('样式的文件夹里一个没有哪一种样式认的文件（忘了在表里点名）：先当共用的算，四座都旧', () => {
    expect(programPart('src/stage/three/style/styleC.ts', styles)).toEqual({ part: 'shared' });
    expect(stale({ ...files, 'src/stage/three/style/styleC.ts': 'c\n' })).toEqual(names);
    // 两种样式都认的也是
    const twice = { 'style-a': ['src/stage/three/style/styleA.ts'], 'style-b': ['src/stage/three/style/styleA.ts'] };
    expect(stylesClaiming('src/stage/three/style/styleA.ts', twice)).toEqual(['style-a', 'style-b']);
    expect(programPart('src/stage/three/style/styleA.ts', twice)).toEqual({ part: 'shared' });
  });

  it('样式的文件夹里一个子文件夹，名字不是哪一种认得的样式（几种样式合用的小东西；把样式的名字写错了一个字）：里面的文件没有谁认，当共用的算——添进来四座都旧，再改它四座的记号又变', () => {
    for (const path of ['src/stage/three/style/common/tint.ts', 'src/stage/three/style/style-bb/look.ts', 'src/stage/three/style/common/deep/tint.ts']) {
      expect(stylesClaiming(path, styles), path).toEqual([]);
      expect(programPart(path, styles), path).toEqual({ part: 'shared' });
      for (const name of names) expect(inTableKey(path, tables[name], styles), `${path} ${name}`).toBe(true);
      const planted = { ...files, [path]: 'tint\n' };
      expect(stale(planted), path).toEqual(names);
      const before = keys(planted);
      const after = keys({ ...planted, [path]: 'tint changed\n' });
      expect(names.filter((name) => after[name] !== before[name]), path).toEqual(names);
    }
    // 用另一种样式的沙盘也算它
    const other: TableUse = { style: 'style-b', families: [], route: false };
    expect(inTableKey('src/stage/three/style/common/tint.ts', other, styles)).toBe(true);
    // 认不认得，看的是表里有没有这一行：同一个文件夹，表里添了它那一行就归它，别的沙盘不算它
    const known = { ...styles, common: [] };
    expect(stylesClaiming('src/stage/three/style/common/tint.ts', known)).toEqual(['common']);
    expect(programPart('src/stage/three/style/common/tint.ts', known)).toEqual({ part: 'style', style: 'common' });
    expect(names.filter((name) => inTableKey('src/stage/three/style/common/tint.ts', tables[name], known))).toEqual([]);
    // 一种样式的文件有哪些，照这条规矩问（表里点了名的，和以它的名字命名的子文件夹里的）；没有谁认的不在哪一种里
    const paths = [...Object.keys(files), 'src/stage/three/style/style-b/look.ts', 'src/stage/three/style/common/tint.ts'];
    expect(styleFilesIn(paths, 'style-a', styles)).toEqual(['src/stage/three/style/styleA.ts', 'src/stage/three/style/styleAFigure.ts']);
    expect(styleFilesIn(paths, 'style-b', styles)).toEqual(['src/stage/three/style/style-b/look.ts']);
    expect(styleFilesIn(paths, 'common', styles)).toEqual([]);
    expect(styleFilesIn(paths, 'style-c', styles)).toEqual([]);
  });

  it('一家零件的文件改一个字节：旧的正好是用到这一家的那几座', () => {
    expect(stale(touch('src/stage/three/families/rock.ts'))).toEqual(['cliff']);
    expect(stale(touch('src/stage/three/families/plants.ts'))).toEqual(['cliff', 'garden']);
    expect(stale(touch('src/stage/three/families/works.ts'))).toEqual(['garden']);
  });

  it('一家哪一座都没用到的零件——添进来、改它——哪一座都不旧；一家的文件放在以它的名字命名的子文件夹里也认', () => {
    expect(stale({ ...files, 'src/stage/three/families/town.ts': 'town\n' })).toEqual([]);
    expect(stale({ ...files, 'src/stage/three/families/town.ts': 'town changed\n' })).toEqual([]);
    expect(programPart('src/stage/three/families/town/gate.ts')).toEqual({ part: 'family', family: 'town' });
    expect(stale({ ...files, 'src/stage/three/families/rock/cliff.ts': 'cliff\n' })).toEqual(['cliff']);
  });

  it('全程沙盘才用的那一块改一个字节：旧的只有全程沙盘', () => {
    for (const path of ROUTE_LEVEL_FILES) expect(stale(touch(path)), path).toEqual(['route']);
  });

  it('小像、读内容的程序改了：哪一座都不旧（它们不在记号里）', () => {
    for (const path of LEFT_OUT_FILES) {
      expect(stale({ ...files, [path]: 'something\n' }), path).toEqual([]);
      expect(stale({ ...files, [path]: 'something else\n' }), path).toEqual([]);
      for (const name of names) expect(inTableKey(path, tables[name], styles), `${path} ${name}`).toBe(false);
    }
  });
});

describe('磁盘上的文件各归哪一类：样式、零件、全程沙盘才用的那一块', () => {
  const text = (path: string): string => new TextDecoder().decode(readFile(path));
  /** 一个文件夹里所有的文件（连子文件夹），路径相对项目的根目录。名字里没有点的当作子文件夹（这两个文件夹里的文件都带扩展名）。 */
  const under = (folder: string): string[] => namesIn(folder).flatMap((name) => (name.includes('.') ? [`${folder}${name}`] : under(`${folder}${name}/`)));

  it('样式的文件夹里的每一个文件，要么在共用的单子里，要么正好归一种样式；表里点了名的文件都在；场景里能写的每一种样式都有自己的文件', () => {
    const problems: string[] = [];
    for (const path of under(STYLE_FOLDER)) {
      const claimed = stylesClaiming(path);
      const shared = (STYLE_SHARED_FILES as readonly string[]).includes(path);
      if (shared && claimed.length > 0) problems.push(`${path} 在共用的单子里，又有样式认它（${claimed.join('、')}）：只能是一样`);
      if (!shared && claimed.length === 0) {
        problems.push(
          `${path} 既不在共用的单子里（STYLE_SHARED_FILES），也没有哪一种样式认它，现在是当各座沙盘共用的算的：` +
            '几种样式合用的，写进 tests/support/programKey.ts 的 STYLE_SHARED_FILES；一种样式自己的，在 STYLE_FILES 里它那种样式的一行添上它，' +
            `或者把它放进以那种样式的名字命名的子文件夹（认得的样式是：${Object.keys(STYLE_FILES).join('、')}；子文件夹叫别的名字的不算哪一种样式的）`,
        );
      }
      if (claimed.length > 1) problems.push(`${path} 有两种以上的样式认它（${claimed.join('、')}）：一个文件只能归一种样式；几种样式共用的写进 STYLE_SHARED_FILES`);
    }
    for (const path of [...STYLE_SHARED_FILES, ...Object.values(STYLE_FILES).flat()]) if (!fileExists(path)) problems.push(`单子里写着 ${path}，这个文件不在`);
    expect(problems).toEqual([]);
    // 表里有哪几行，就是认得哪几种样式：正好是场景里能写的那几种
    expect(Object.keys(STYLE_FILES).sort()).toEqual([...SCENE_STYLES].sort());
    const onDisk = under(STYLE_FOLDER);
    for (const id of SCENE_STYLES) {
      expect(styleFilesIn(onDisk, id).length, `样式“${id}”自己的文件一个也没有找到：它的文件要在 STYLE_FILES 里它那一行点名，或者放在 ${STYLE_FOLDER}${id}/ 里（文件夹的名字要一个字不差）`).toBeGreaterThan(0);
      expect(onDisk.filter((path) => stylesClaiming(path).includes(id))).toEqual(styleFilesIn(onDisk, id));
      // 以它的名字命名的子文件夹里的文件归它
      expect(stylesClaiming(`${STYLE_FOLDER}${id}/look.ts`), id).toEqual([id]);
      expect(programPart(`${STYLE_FOLDER}${id}/look.ts`), id).toEqual({ part: 'style', style: id });
    }
    // 这个查法认得出来：添一个没人认的文件，添一个子文件夹、名字不是哪一种认得的样式——都没有谁认，当共用的算；表里添了那一行才认
    expect(stylesClaiming('src/stage/three/style/planted.ts')).toEqual([]);
    expect(stylesClaiming('src/stage/three/style/another-style/look.ts')).toEqual([]);
    expect(stylesClaiming('src/stage/three/style/common/tint.ts')).toEqual([]);
    expect(programPart('src/stage/three/style/common/tint.ts')).toEqual({ part: 'shared' });
    expect(stylesClaiming('src/stage/three/style/another-style/look.ts', { ...STYLE_FILES, 'another-style': [] })).toEqual(['another-style']);
  });

  it('零件的文件夹里的每一个文件都是登记表里的一家（名字就是那一家的名字）；登记表里的每一家都有它的文件', () => {
    const registered = FAMILIES.map((family) => family.name);
    const onDisk = under(FAMILY_FOLDER);
    for (const path of onDisk) {
      const part = programPart(path);
      expect(part.part, path).toBe('family');
      if (part.part === 'family') expect(registered, `${path}：登记表（src/stage/families.ts）里没有“${part.family}”这一家，它不会算进哪一座沙盘的记号`).toContain(part.family);
    }
    for (const name of registered) expect(onDisk.some((path) => path === `${FAMILY_FOLDER}${name}.ts` || path.startsWith(`${FAMILY_FOLDER}${name}/`)), name).toBe(true);
  });

  /** 一个文件里运行时真的引进来的东西（只取类型的不算，typeof import(…) 也不算）：从哪里引的。转出去的（export … from）和动态的 import() 也算。 */
  const staticImports = (source: string): string[] => [
    ...[...source.matchAll(/(?:^|\n)\s*(?:import|export)\s+(type\s+)?[^;'"]*?from\s*['"]([^'"]+)['"]/g)].filter((m) => !m[1]).map((m) => m[2]),
    ...[...source.matchAll(/(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g)].map((m) => m[1]),
  ];
  /** 用到时才取的那一种（import(…)）。 */
  const dynamicImports = (source: string): string[] => [...source.matchAll(/(?<!typeof\s)\bimport\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1]);
  const runtimeImports = (source: string): string[] => [...staticImports(source), ...dynamicImports(source)];
  /** 从 file 里引 spec，引的是哪个文件（不带扩展名，相对项目的根目录）。不是相对路径的（库）是 null。 */
  const resolved = (file: string, spec: string): string | null => (spec.startsWith('.') ? new URL(spec, `file:///${file}`).pathname.slice(1) : null);
  /** 这些文件里，谁在运行时引了 banned 里的文件。 */
  const importers = (sources: Record<string, string>, banned: readonly string[]): string[] => {
    const stems = banned.map((path) => path.replace(/\.ts$/, ''));
    return Object.keys(sources)
      .filter((file) => /\.tsx?$/.test(file))
      .filter((file) => runtimeImports(sources[file]).some((spec) => stems.includes(resolved(file, spec) ?? '')))
      .sort();
  };

  // 要把算记号的文件都读一遍、一个一个找引入的句子：整套测试一起跑的时候不止一秒半，单给一个时限
  it('站点沙盘的记号里算的文件（共用的，样式的，零件的）没有一个在运行时引全程沙盘才用的那一块，也没有一个引小像的程序：所以那几个文件可以只算进全程沙盘的记号、小像可以不算', { timeout: 60_000 }, () => {
    const disk = readProgramFiles();
    const sources: Record<string, string> = {};
    for (const [path, bytes] of Object.entries(disk)) if (programPart(path).part !== 'route') sources[path] = new TextDecoder().decode(bytes);
    for (const path of ROUTE_LEVEL_FILES) expect(fileExists(path), path).toBe(true);
    expect(importers(sources, [...ROUTE_LEVEL_FILES, 'src/stage/three/piece.ts'])).toEqual([]);
    // 这个查法认得出来：真的引了、转出去了、动态引了都查得到；只取类型的、typeof import(…) 的不算
    expect(runtimeImports("import { a } from './a';\nimport type { B } from './b';\nexport { c } from './c';\nexport type { D } from './d';\nimport './e';\nconst f = await import('./f');\ntype G = typeof import('./g');")).toEqual(['./a', './c', './e', './f']);
    expect(importers({ ...sources, 'src/stage/three/planted.ts': "import { roadRuns } from '../roadLines';" }, ROUTE_LEVEL_FILES)).toEqual(['src/stage/three/planted.ts']);
    expect(importers({ 'src/stage/three/view.ts': "export { buildRouteModels } from './routeKit';", 'src/stage/three/water.ts': "const level = await import('./routeLevel');" }, ROUTE_LEVEL_FILES)).toEqual(['src/stage/three/view.ts', 'src/stage/three/water.ts']);
    expect(importers({ 'src/stage/three/view.ts': "import type { Piece } from './piece';\nexport type RouteLevel = typeof import('./routeLevel');" }, [...ROUTE_LEVEL_FILES, 'src/stage/three/piece.ts'])).toEqual([]);
    // 现在的沙盘程序里，小像只有这两处提到：全程沙盘那一块把它转出去，沙盘程序只取它的类型
    expect(text('src/stage/three/view.ts')).toContain("import type { Piece } from './piece';");
    expect(importers({ 'src/stage/three/routeLevel.ts': text('src/stage/three/routeLevel.ts') }, ['src/stage/three/piece.ts'])).toEqual(['src/stage/three/routeLevel.ts']);
  });

  it('小像不在定格图里：拍照的那一页和拍照的工具从不叫沙盘摆小像（placePiece）——所以小像的程序不算在记号里', () => {
    for (const path of ['src/stage/dev/harness.ts', 'stage-dev.html', 'tests/tools/make-stills.spec.ts']) expect(text(path), path).not.toContain('placePiece');
    // 沙盘程序里这个方法就叫这个名字（改了名字，上面那一条要跟着改）
    expect(text('src/stage/three/view.ts')).toContain('placePiece(');
  });

  /** 拍照的那一页（stage-dev.html）装的头一个程序文件。 */
  const SHOT_PAGE_ENTRY = 'src/stage/dev/harness.ts';

  /**
   * 拍照的那一页运行时装得进来、却不在哪一座沙盘的记号里的文件，一个一个写在这里：读内容的，挑哪一家零件、哪一层沙盘的，
   * 题签，定格图那一种沙盘。除了 sceneContent.ts（见 LEFT_OUT_FILES），它们从有这个记号起就不在里面。
   * 往这里添一个文件，就是说“改它不用重拍定格图”：要说得出为什么，写在提交里。
   */
  const OUTSIDE_EVERY_TABLE = [
    'src/domain/body.ts',
    'src/domain/content.ts',
    'src/domain/contentKey.ts',
    'src/domain/contentLists.ts',
    'src/domain/sceneContent.ts',
    'src/domain/stopMarks.ts',
    'src/stage/families.ts',
    'src/stage/index.ts',
    'src/stage/overlay/index.ts',
    'src/stage/overlay/placeStrips.ts',
    'src/stage/overlay/strips.ts',
    'src/stage/still/engine.ts',
    'src/stage/still/fit.ts',
    'src/stage/still/index.ts',
    'src/stage/support.ts',
    'src/styles/still.css',
  ];
  /** 全程沙盘另外装进来的三个：题签绕着摆的办法，算小像站在哪的，小像的程序（见 LEFT_OUT_FILES）。 */
  const OUTSIDE_ROUTE_TABLE = ['src/stage/overlay/placeAround.ts', 'src/stage/pieceWhere.ts', 'src/stage/three/piece.ts'];

  /**
   * 从拍照的那一页装的头一个文件起，顺着运行时的引入一个一个找下去：use 这座沙盘的画面会装进哪些文件（只找项目里的，库不算）。
   * 写在文件头上的引入都跟；用到时才取的（import(…)），取的要是一家零件、全程沙盘才用的那一块、一种样式的文件，
   * 只有这座沙盘用得着才跟——沙盘程序就是这样取的（哪几家照 familiesOf，全程沙盘那一块只有全程沙盘取）。
   * extra 是“假如磁盘上还有这些文件、这些文件是这样写的”（路径 → 内容）。找不到的引入记在 missing 里。
   */
  const shotPageLoads = (use: TableUse, extra: Record<string, string> = {}): { reached: string[]; missing: string[] } => {
    const has = (path: string): boolean => path in extra || fileExists(path);
    const fileOf = (file: string, spec: string): string | null => {
      if (!spec.startsWith('.')) return null;
      const stem = resolved(file, spec.replace(/\?.*$/, '')) ?? '';
      return [`${stem}.ts`, `${stem}.tsx`, `${stem}/index.ts`, ...(/\.[a-z]+$/.test(stem) ? [stem] : [])].find(has) ?? `?${stem}`;
    };
    const taken = (path: string): boolean => {
      const part = programPart(path);
      if (part.part === 'family') return use.families.includes(part.family);
      if (part.part === 'route') return use.route;
      if (part.part === 'style') return part.style === use.style;
      return true;
    };
    const seen = new Set<string>();
    const missing: string[] = [];
    const todo = [SHOT_PAGE_ENTRY];
    while (todo.length > 0) {
      const file = todo.pop() as string;
      if (seen.has(file)) continue;
      seen.add(file);
      if (!/\.tsx?$/.test(file)) continue;
      const source = extra[file] ?? text(file);
      const follow = (spec: string, dynamic: boolean): void => {
        const next = fileOf(file, spec);
        if (next === null) return;
        if (next.startsWith('?')) missing.push(`${file} 引的 ${spec}`);
        else if (!dynamic || taken(next)) todo.push(next);
      };
      for (const spec of staticImports(source)) follow(spec, false);
      for (const spec of dynamicImports(source)) follow(spec, true);
    }
    return { reached: [...seen].sort(), missing };
  };

  // 四座沙盘各找一遍，每一遍要读七八十个文件：整套测试一起跑的时候不止一秒半，单给一个时限
  it('拍照的那一页运行时装进来的每一个文件，要么在这座沙盘的记号里，要么在写明“不算”的单子上：隔着一个不在记号里的文件引进来的也找得到', { timeout: 60_000 }, () => {
    expect(text('stage-dev.html')).toContain(`src="/${SHOT_PAGE_ENTRY}"`);
    const outside = (use: TableUse, extra: Record<string, string> = {}): string[] => shotPageLoads(use, extra).reached.filter((path) => !inTableKey(path, use));
    const allowed = (use: TableUse): string[] => [...OUTSIDE_EVERY_TABLE, ...(use.route ? OUTSIDE_ROUTE_TABLE : [])].sort();
    const keys = Object.keys(realScenes).sort();
    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) {
      const use = tableUse(realScenes[key]);
      const { reached, missing } = shotPageLoads(use);
      expect(missing, key).toEqual([]);
      // 找得到沙盘程序、这座沙盘的样式、它用到的那几家零件；全程沙盘才用的那一块只有全程沙盘装
      expect(reached, key).toEqual(expect.arrayContaining(['src/stage/three/view.ts', 'src/stage/three/engine.ts', 'src/domain/scene.ts', ...use.families.map((family) => `${FAMILY_FOLDER}${family}.ts`)]));
      expect(styleFilesIn(reached, use.style).length, key).toBeGreaterThan(0);
      expect(reached.filter((path) => programPart(path).part === 'family').length, key).toBe(use.families.length);
      expect(ROUTE_LEVEL_FILES.filter((path) => reached.includes(path)), key).toEqual(use.route ? [...ROUTE_LEVEL_FILES] : []);
      expect(
        outside(use),
        `${key}：拍照的那一页装进来、却不在这座沙盘的记号里的文件，要正好是单子上的那几个。多出来的那个：改它会改画面，就把它放进记号算的文件夹（或者在 tests/support/programKey.ts 里点名）；` +
          '真的不决定画面，才写进这条测试上面的单子，并说明为什么。少了的那个：从单子上拿掉。',
      ).toEqual(allowed(use));
    }

    // 这个查法认得出来（在一座编出来的站点沙盘上，一家零件不用）：
    const stop: TableUse = { style: 'song-qinglv', families: [], route: false };
    expect(outside(stop)).toEqual(allowed(stop));
    expect(shotPageLoads(stop).reached.filter((path) => programPart(path).part === 'family')).toEqual([]);
    // 一个共用的文件隔着记号外面的文件引了全程沙盘才用的那一块：找得到中间那个文件，也找得到那一块
    const through = outside(stop, { 'src/stage/three/mist.ts': `import '../pieceWhere';\n${text('src/stage/three/mist.ts')}` });
    expect(through).toEqual(expect.arrayContaining(['src/stage/pieceWhere.ts', 'src/stage/roadLines.ts']));
    // 一个共用的文件引了记号外面一个新文件，那个文件把路的笔画和小像转出去：三个都找得到
    const helper = outside(stop, {
      'src/stage/helpers/roads.ts': "export { roadRuns } from '../roadLines';\nexport { buildPiece } from '../three/piece';\n",
      'src/stage/three/water.ts': `import { roadRuns, buildPiece } from '../helpers/roads';\n${text('src/stage/three/water.ts')}`,
    });
    expect(helper).toEqual(expect.arrayContaining(['src/stage/helpers/roads.ts', 'src/stage/roadLines.ts', 'src/stage/three/piece.ts']));
    // 样式引了一个合用的小文件：放在样式的文件夹里（哪怕子文件夹的名字不是哪一种样式）就在记号里；放在记号算的文件夹外面就找出来
    const style = styleFilesIn(shotPageLoads(stop).reached, 'song-qinglv')[0];
    /** 从这个样式文件所在的文件夹回到项目的根目录。 */
    const up = '../'.repeat(style.split('/').length - 1);
    const inside = { [`${STYLE_FOLDER}common/tint.ts`]: "export const TINT = '#000000';\n", [style]: `import { TINT } from '${up}${STYLE_FOLDER}common/tint';\nvoid TINT;\n${text(style)}` };
    expect(shotPageLoads(stop, inside).reached).toContain(`${STYLE_FOLDER}common/tint.ts`);
    expect(outside(stop, inside)).toEqual(allowed(stop));
    const elsewhere = { 'src/stage/helpers/tint.ts': "export const TINT = '#000000';\n", [style]: `import { TINT } from '${up}src/stage/helpers/tint';\nvoid TINT;\n${text(style)}` };
    expect(outside(stop, elsewhere)).toContain('src/stage/helpers/tint.ts');
    // 引了一个不存在的文件：说出来，不当没看见
    expect(shotPageLoads(stop, { 'src/stage/three/mist.ts': `import '../nowhere';\n${text('src/stage/three/mist.ts')}` }).missing).toEqual(['src/stage/three/mist.ts 引的 ../nowhere']);
  });
});

describe('content/ 里每一座沙盘：它的记号里算的文件，和读内容的程序交给沙盘的东西', () => {
  const tables = Object.keys(realScenes)
    .map((path) => /^\/content\/figures\/([^/]+)\/scenes\/([^/]+)\.json$/.exec(path))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => ({ figureId: m[1], stopId: m[2], scene: realScenes[m[0]] }));

  it('找得到沙盘', () => {
    expect(tables.length).toBeGreaterThan(0);
  });

  it.each(tables)('$figureId/$stopId：用哪种样式、哪几家零件、是不是全程沙盘，是照场景文件说的；记号里的文件都是磁盘上那一批里的，样式的文件在里面', { timeout: 60_000 }, ({ scene }) => {
    const use = tableUse(scene);
    expect(use.style).toBe(scene.style);
    expect(use.route).toBe(scene.level === 'route');
    const registered = FAMILIES.map((family) => family.name);
    for (const family of use.families) expect(registered).toContain(family);
    if (scene.level === 'route') expect(use.families).toEqual([]);
    const all = readProgramFiles();
    const mine = readTableFiles(scene);
    for (const path of Object.keys(mine)) {
      expect(all[path], path).toBeDefined();
      expect(inTableKey(path, use), path).toBe(true);
    }
    for (const path of Object.keys(all)) if (!(path in mine)) expect(inTableKey(path, use), path).toBe(false);
    // 它的样式的文件：照磁盘上的文件和算记号的那条规矩问（表里点了名的，和以样式的名字命名的子文件夹里的），至少有一个，都在它的记号里
    const styleFiles = styleFilesIn(Object.keys(all), scene.style);
    expect(styleFiles.length, `磁盘上没有找到“${scene.style}”这种样式自己的文件`).toBeGreaterThan(0);
    for (const path of styleFiles) expect(mine[path], path).toBeDefined();
    for (const path of ROUTE_LEVEL_FILES) expect(path in mine, path).toBe(use.route);
    for (const path of LEFT_OUT_FILES) expect(path in mine, path).toBe(false);
    for (const path of ['src/stage/three/view.ts', 'src/stage/scale.ts', 'src/domain/scene.ts', 'stage-dev.html', 'tests/tools/make-stills.spec.ts', 'tests/support/stillsTool.ts', 'playwright.stills.config.ts']) expect(mine[path], path).toBeDefined();
    // 读两遍算出来一样；把其中一个共用的文件改一个字节就不一样
    const now = programVersions();
    const key = programKey(mine, now);
    expect(programKey(readTableFiles(scene), programVersions())).toBe(key);
    expect(programKey({ ...mine, 'src/stage/scale.ts': new Uint8Array([...mine['src/stage/scale.ts'], 0x20]) }, now)).not.toBe(key);
  });

  it.each(tables)('$figureId/$stopId：场景里的样式要是换成一种算记号的程序不认得的，不悄悄算出一个没有样式文件的记号：停下来，说是哪座沙盘、哪种样式、文件该放在哪', { timeout: 60_000 }, ({ figureId, stopId, scene }) => {
    const unknown = { ...scene, style: 'zz-unknown' } as unknown as TableScene;
    expect(() => readTableFiles(unknown, `${figureId}/${stopId}`)).toThrow(`${figureId}/${stopId}的场景文件里写的样式是“zz-unknown”，算记号的时候没有找到这种样式自己的文件，记号算不出来。`);
    expect(() => readTableFiles(unknown)).toThrow(/^这座沙盘的场景文件里写的样式是“zz-unknown”.+src\/stage\/three\/style\/.+tests\/support\/programKey\.ts 的 STYLE_FILES.+npm run validate 会说。$/);
    // 真的那一份照常算得出来
    expect(Object.keys(readTableFiles(scene, `${figureId}/${stopId}`)).length).toBeGreaterThan(0);
  });

  it.each(tables)('$figureId/$stopId：读内容的程序（sceneContent.ts，不在记号里）交给沙盘的只有四样，前三样各有自己的记号', { timeout: 60_000 }, async ({ figureId, stopId }) => {
    const table = await loadStopTable(figureId, stopId);
    expect(table).not.toBeNull();
    if (!table) return;
    expect(Object.keys(table).filter((name) => !['scene', 'terrainUrl', 'ground', 'stills'].includes(name))).toEqual([]);
    const now = madeFromNow(figureId, stopId).madeFrom;
    // 场景：交出去的就是场景文件，决定画面的那一部分的记号是 madeFrom.scene
    expect(pictureKey(table.scene)).toBe(now.scene);
    // 地形文件：交出去的网址指的是场景里写的那个文件，它的字节的记号是 madeFrom.terrain
    expect(table.terrainUrl).toContain(table.scene.terrain.file.replace(/\.[^.]+$/, ''));
    expect(now.terrain).toBe(contentKey(readFile(`content/figures/${figureId}/scenes/${table.scene.terrain.file}`)));
    // 先画好的地面：交出去的是清单里写的两张图和几个数，清单里两份像素的记号合起来是 madeFrom.ground
    const bakedPath = `content/figures/${figureId}/baked/${stopId}.json`;
    if (fileExists(bakedPath)) {
      const baked = JSON.parse(new TextDecoder().decode(readFile(bakedPath))) as { inputs: unknown; pixels: { colour: string; fields: string }; colour: { file: string }; fields: { file: string } };
      expect(Object.keys(table.ground ?? {}).sort()).toEqual(['colourUrl', 'fieldsUrl', 'height', 'inputs', 'width']);
      expect(table.ground?.colourUrl).toContain(baked.colour.file.replace(/\.[^.]+$/, ''));
      expect(table.ground?.fieldsUrl).toContain(baked.fields.file.replace(/\.[^.]+$/, ''));
      expect(table.ground?.inputs).toEqual(baked.inputs);
      expect(now.ground).toBe(groundKeyOf(baked));
    } else expect(now.ground).toBe(groundKeyOf(null));
  });
});

// ---------------------------------------------------------------- 画面变没变

/** 编一张截图：底色一样，上面有一条斜的亮带（不是一种颜色）。channels 是 4 时带一个不透明的字节。 */
function madeUpPicture(width: number, height: number, channels: 3 | 4 = 4): RawPicture {
  const pixels = new Uint8Array(width * height * channels);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const at = (y * width + x) * channels;
      const band = Math.abs(x - y) < 12 ? 40 : 0;
      pixels[at] = 235 - band;
      pixels[at + 1] = 227 - band;
      pixels[at + 2] = 211 - band;
      if (channels === 4) pixels[at + 3] = 255;
    }
  }
  return { width, height, channels, pixels };
}

/** 在一张截图上改一小块：从 (x0, y0) 起 size × size 个点，每个点红的一级加 by。 */
function patched(picture: RawPicture, x0: number, y0: number, size: number, by: number): RawPicture {
  const pixels = picture.pixels.slice();
  for (let y = y0; y < y0 + size; y++) {
    for (let x = x0; x < x0 + size; x++) pixels[(y * picture.width + x) * picture.channels] += by;
  }
  return { ...picture, pixels };
}

describe('截图的像素的记号，和“画面变没变”', () => {
  const picture = madeUpPicture(240, 160);
  const raw = rawKey(picture);

  it('同样的像素记号一样；带不带“透明”那一个字节不要紧', () => {
    expect(raw).toMatch(KEY);
    expect(rawKey(madeUpPicture(240, 160))).toBe(raw);
    expect(rawKey(madeUpPicture(240, 160, 3))).toBe(raw);
  });

  it('差一小块（30 × 30 像素，冒出来一座小屋那么大）：记号不一样，这张图算变了', () => {
    const changed = rawKey(patched(picture, 100, 60, 30, 25));
    expect(changed).not.toBe(raw);
    const old = { raw, key: 'aaaaaaaaaaaaaaaa' };
    expect(keepStill(old, changed, 'aaaaaaaaaaaaaaaa')).toBe(false);
  });

  it('只差一个点、只差一级，也算变了；像素一样而宽高不同也不一样', () => {
    expect(rawKey(patched(picture, 3, 3, 1, 1))).not.toBe(raw);
    expect(keepStill({ raw, key: 'aaaaaaaaaaaaaaaa' }, rawKey(patched(picture, 239, 159, 1, 1)), 'aaaaaaaaaaaaaaaa')).toBe(false);
    const flat = new Uint8Array(240 * 160 * 3).fill(200);
    expect(rawKey({ width: 240, height: 160, channels: 3, pixels: flat })).not.toBe(rawKey({ width: 160, height: 240, channels: 3, pixels: flat }));
  });

  it('只有三样都对才留着原来的文件：清单里有它，像素的记号没变，文件还在而且就是清单里记的那一份', () => {
    const old = { raw, key: 'aaaaaaaaaaaaaaaa' };
    expect(keepStill(old, raw, 'aaaaaaaaaaaaaaaa')).toBe(true);
    // 清单里没有这一张（新添的小节）
    expect(keepStill(undefined, raw, 'aaaaaaaaaaaaaaaa')).toBe(false);
    // 文件不在了
    expect(keepStill(old, raw, null)).toBe(false);
    // 文件被换过（不是工具写的那一份）
    expect(keepStill(old, raw, 'bbbbbbbbbbbbbbbb')).toBe(false);
    // 像素变了
    expect(keepStill(old, 'cccccccccccccccc', 'aaaaaaaaaaaaaaaa')).toBe(false);
  });

  it('备用的办法平时关着：不管差多少都不留；打开以后，差得最多的一小块不超过那个数才留', () => {
    // 平时（没有上限）
    expect(keepWithin(0, null)).toBe(false);
    expect(keepWithin(0.3, null)).toBe(false);
    // 打开以后
    expect(keepWithin(0.3, 1.5)).toBe(true);
    expect(keepWithin(1.5, 1.5)).toBe(true);
    expect(keepWithin(1.6, 1.5)).toBe(false);
    // 比不了（原来没有这张图、两张大小不一样）：不留
    expect(keepWithin(null, 1.5)).toBe(false);
  });

  it('新旧两张图一小块一小块地比（worstTileOf）：一样是 0；差在哪一块就看那一块；大小不一样比不了', () => {
    /** 一张每个点 4 个字节的图，全是一个数。 */
    const flat = (width: number, height: number, value: number) => ({ width, height, data: new Uint8Array(width * height * 4).fill(value) });
    const a = flat(100, 70, 100);
    expect(worstTileOf(a, flat(100, 70, 100))).toBe(0);
    // 整张都差 3 级
    expect(worstTileOf(a, flat(100, 70, 103))).toBe(3);
    // 只有一个点的红差了 96 级：它在的那一块（32 × 32）平均差 96 ÷ (32 × 32 × 3)
    const dot = flat(100, 70, 100);
    dot.data[(40 * 100 + 40) * 4] = 196;
    expect(worstTileOf(a, dot)).toBeCloseTo(96 / (32 * 32 * 3), 10);
    // 透明那一个字节不算
    const alpha = flat(100, 70, 100);
    alpha.data[3] = 0;
    expect(worstTileOf(a, alpha)).toBe(0);
    // 右下角那一块不满 32 × 32（这里是 4 × 6）：按它自己有的点数平均
    const corner = flat(100, 70, 100);
    corner.data[(69 * 100 + 99) * 4 + 1] = 148;
    expect(worstTileOf(a, corner)).toBeCloseTo(48 / (4 * 6 * 3), 10);
    // 一小块差得多、别处差得少：取差得最多的那一块
    const both = flat(100, 70, 101);
    for (let y = 0; y < 32; y++) for (let x = 32; x < 64; x++) both.data[(y * 100 + x) * 4 + 2] = 110;
    expect(worstTileOf(a, both)).toBeCloseTo((1 + 1 + 10) / 3, 10);
    expect(worstTileOf(a, flat(70, 100, 100))).toBeNull();
    expect(worstTileOf(a, flat(100, 71, 100))).toBeNull();
  });

  it('worstTileOf 原样的字拿到别处也跑得起来（工具就是这样把它交给浏览器的）', () => {
    const rebuilt = new Function(`return (${worstTileOf.toString()})`)() as typeof worstTileOf;
    const a = { width: 40, height: 40, data: new Uint8Array(40 * 40 * 4).fill(10) };
    const b = { width: 40, height: 40, data: new Uint8Array(40 * 40 * 4).fill(14) };
    expect(rebuilt(a, b)).toBe(4);
    expect(rebuilt(a, { ...b, width: 41 })).toBeNull();
  });

  it('一张图这一次怎么样了，说成一句话', () => {
    expect(reviewWord({ changed: false, worstTile: null })).toBe('没有变');
    expect(reviewWord({ changed: true, worstTile: null })).toBe('变了：新拍的，原来没有这一张');
    expect(reviewWord({ changed: true, worstTile: 3.456 })).toBe('变了：和原来那一张比，差得最多的一小块平均差 3.5 级');
    expect(reviewWord({ changed: false, worstTile: 0.42 })).toBe('留着原来那一张：这一次拍的和它比，差得最多的一小块平均只差 0.4 级');
  });

  it('从 PNG 文件读出来的截图，和直接拿像素算，记号一样', () => {
    const small = madeUpPicture(37, 23);
    const png = encodeRgbaPng(small);
    const decoded = decodePng(png);
    expect(decoded).toMatchObject({ width: 37, height: 23, channels: 4 });
    expect(rawKey(decoded)).toBe(rawKey(small));
    expect(pixelSum(decoded)).toBe(pixelSum(small));
    expect(rawKey(decodePng(encodeRgbaPng(patched(small, 5, 5, 3, 9))))).not.toBe(rawKey(small));
  });

  it('核对用的那个数（pixelSum）：像素一样就一样，差一点就不一样', () => {
    expect(pixelSum(picture)).toBe(pixelSum(madeUpPicture(240, 160, 3)));
    expect(pixelSum(patched(picture, 0, 0, 1, 1))).not.toBe(pixelSum(picture));
    // 就是“乘 31 再加”这个算法（工具在浏览器里也照这样算一遍）
    expect(pixelSum({ width: 1, height: 1, channels: 4, pixels: new Uint8Array([1, 2, 3, 255]) })).toBe((1 * 31 + 2) * 31 + 3);
  });

  it('整张图是不是一种颜色：只剩底色算是；有东西就不算', () => {
    const flat: RawPicture = { width: 50, height: 40, channels: 4, pixels: new Uint8Array(50 * 40 * 4).fill(222) };
    expect(flatColour(flat)).toBe(true);
    // 差一两级（压缩、抖动）还算一种颜色
    expect(flatColour(patched(flat, 10, 10, 5, 2))).toBe(true);
    expect(flatColour(patched(flat, 10, 10, 5, 3))).toBe(false);
    expect(flatColour(picture)).toBe(false);
  });

  it('不是彩色的截图、像素数不对：说清楚，不硬算', () => {
    expect(() => rawKey({ width: 2, height: 2, channels: 1, pixels: new Uint8Array(4) })).toThrow('彩色');
    expect(() => rawKey({ width: 2, height: 2, channels: 3, pixels: new Uint8Array(11) })).toThrow('像素数不对');
  });
});

/** 测试自己写一张彩色带透明的 PNG（每一行用不同的滤法里最简单的两种），用来查“从文件读出来”这一步。 */
function encodeRgbaPng(picture: RawPicture): Uint8Array {
  const { width, height, pixels } = picture;
  const row = width * 4;
  const raw = new Uint8Array((row + 1) * height);
  for (let y = 0; y < height; y++) {
    const from = y * row;
    const to = y * (row + 1);
    // 偶数行原样存（滤法 0），奇数行存“和左边那个点的差”（滤法 1）
    raw[to] = y % 2;
    for (let x = 0; x < row; x++) raw[to + 1 + x] = y % 2 === 0 ? pixels[from + x] : (pixels[from + x] - (x >= 4 ? pixels[from + x - 4] : 0)) & 0xff;
  }
  const header = new Uint8Array(13);
  const head = new DataView(header.buffer);
  head.setUint32(0, width);
  head.setUint32(4, height);
  header.set([8, 6, 0, 0, 0], 8);
  const chunk = (type: string, body: Uint8Array): Uint8Array => {
    const out = new Uint8Array(12 + body.length);
    const view = new DataView(out.buffer);
    view.setUint32(0, body.length);
    for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
    out.set(body, 8);
    view.setUint32(8 + body.length, crc32(out.subarray(4, 8 + body.length)));
    return out;
  };
  const parts = [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', new Uint8Array(0))];
  const file = new Uint8Array(parts.reduce((n, part) => n + part.length, 0));
  let at = 0;
  for (const part of parts) {
    file.set(part, at);
    at += part.length;
  }
  return file;
}

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of bytes) {
    c ^= byte;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return (c ^ 0xffffffff) >>> 0;
}

// ---------------------------------------------------------------- 两种形状各照什么拍

describe('两种形状各照什么拍', () => {
  it('宽的 1800 × 1350，窄的 1920 × 1146，都不超过 2048；每张最多 300 KB，和校验规则用的是同一个数', () => {
    const wide = shapeSpec('wide', { pane: [940, 900], insets: [62, 0, 130, 0] });
    expect(wide).toEqual({ window: [1440, 900], pane: [940, 900], insets: [62, 0, 130, 0], extra: 130, pixelRatio: 1.5 });
    expect(shotViewport(wide)).toEqual({ width: 1200, height: 900 });
    expect(shotInsets(wide)).toEqual({ top: 62, right: 130, bottom: 130, left: 130 });
    // 窄的照竖着拿的 768 × 1024 平板：沙盘栏占屏幕高的 56%，768 × 573，左右各多拍 96
    const narrow = shapeSpec('narrow', { pane: [768, 573], insets: [54, 0, 131, 0] });
    expect(narrow).toEqual({ window: [768, 1024], pane: [768, 573], insets: [54, 0, 131, 0], extra: 96, pixelRatio: 2 });
    expect(shotViewport(narrow)).toEqual({ width: 960, height: 573 });
    expect(shotInsets(narrow)).toEqual({ top: 54, right: 96, bottom: 131, left: 96 });
    for (const spec of [wide, narrow]) {
      const { width, height } = shotViewport(spec);
      expect(width * spec.pixelRatio).toBeLessThanOrEqual(2048);
      expect(height * spec.pixelRatio).toBeLessThanOrEqual(2048);
    }
    expect([1200 * 1.5, 900 * 1.5, 960 * 2, 573 * 2]).toEqual([1800, 1350, 1920, 1146]);
    expect(STILL_MAX_BYTES).toBe(BUDGET_STILL_MAX_BYTES);
    expect(STILL_MAX_BYTES).toBe(307_200);
    expect(SHAPE_PLANS.wide.qualities).toEqual([82, 78, 74, 70, 66]);
    expect(SHAPE_PLANS.narrow.qualities).toEqual([86, 82, 78, 74, 70]);
  });

  it('沙盘的容器比沙盘栏窄一个像素、矮一个像素（栏的边线）：左右各多拍半个像素，图片文件还是整数个像素宽；页面上量到的就是这样', () => {
    const wide = shapeSpec('wide', { pane: [939, 900], insets: [62, 0, 130, 0] });
    expect(wide.extra).toBe(130.5);
    expect(shotViewport(wide)).toEqual({ width: 1200, height: 900 });
    expect(shotInsets(wide)).toEqual({ top: 62, right: 130.5, bottom: 130, left: 130.5 });
    // 竖着拿的平板上，栏的边线在下边：栏高 573.44（1024 的 56%），容器量到的是 768 × 572，图片是 1920 × 1144
    const upright = shapeSpec('narrow', { pane: [768, 572], insets: [54, 0, 131, 0] });
    expect(upright.extra).toBe(96);
    expect(shotViewport(upright)).toEqual({ width: 960, height: 572 });
    expect([960 * upright.pixelRatio, 572 * upright.pixelRatio]).toEqual([1920, 1144]);
    // 沙盘栏的左右也留了空：一起算进去
    expect(shotInsets(shapeSpec('narrow', { pane: [768, 573], insets: [54, 6, 131, 4] }))).toEqual({ top: 54, right: 102, bottom: 131, left: 100 });
  });

  it('拍的时候镜头用的两个数，就是 rig.ts 里的那两个', () => {
    expect(SHOT_CAMERA).toEqual({ fitMarginPx: FIT_MARGIN_PX, maxFit: MAX_FIT });
  });

  it('文件名：<站>-<第几节>-wide.jpg、<站>-<第几节>-narrow.jpg', () => {
    expect(stillFile('xuzhou', 1, 'wide')).toBe('xuzhou-1-wide.jpg');
    expect(stillFile('xuzhou', 7, 'narrow')).toBe('xuzhou-7-narrow.jpg');
  });
});

// ---------------------------------------------------------------- 从沙盘的读数做出清单里的一项，工具自己的检查

const WIDE = shapeSpec('wide', { pane: [940, 900], insets: [62, 0, 130, 0] });

/** 一份编出来的读数：宽的那种形状，1200 × 900 的画面。 */
function madeUpShot(): StageShot {
  return {
    section: '后来',
    size: { width: 1200, height: 900 },
    insets: { top: 62, right: 130, bottom: 130, left: 130 },
    pose: { target: [-400.04, 7.249, 260.06], position: [-1210.123456, 2085.5, 2486.049], fov: 22 },
    fit: 1.2345678,
    reach: [412.3456, 207.9876],
    pxPerMetre: 0.123456789,
    northDeg: -19.96,
    anchors: [
      { id: 's-town', x: 600, y: 315.3333, visible: true, foot: { x: 600, y: 360.7 } },
      { id: 's-far', x: 150.123, y: 700, visible: true, out: [-0.60000049, 0.79999963] },
    ],
  };
}

describe('从沙盘的读数做出清单里的一项（stillFromShot）', () => {
  it('题签指着的点换成占整张图的几成；数都取到够用的几位', () => {
    expect(stillFromShot(madeUpShot(), 'wide')).toEqual({
      section: '后来',
      shape: 'wide',
      pose: { target: [-400, 7.2, 260.1], position: [-1210.1, 2085.5, 2486], fov: 22 },
      fit: 1.2346,
      reach: [412.3, 208],
      northDeg: -20,
      pxPerMetre: 0.123457,
      anchors: [
        { id: 's-town', x: 0.5, y: 0.35037, visible: true, foot: [0.5, 0.40078] },
        { id: 's-far', x: 0.1251, y: 0.77778, visible: true, out: [-0.6, 0.8] },
      ],
    });
  });

  it('写进 JSON 再读回来还是它（没有 −0，没有不是数的）', () => {
    const shot = madeUpShot();
    shot.northDeg = -0.01;
    shot.anchors[0].x = -0.000001;
    const still = stillFromShot(shot, 'narrow');
    expect(JSON.parse(JSON.stringify(still))).toEqual(still);
    expect(Object.is(still.northDeg, 0)).toBe(true);
    expect(Object.is(still.anchors[0].x, 0)).toBe(true);
  });

  it('朝外的方向取整以后长度还是 1（差不到百万分之一）', () => {
    for (const degrees of [0, 17.3, 45, 123.456, 200.2, 359.9]) {
      const shot = madeUpShot();
      const angle = (degrees * Math.PI) / 180;
      shot.anchors[1].out = [Math.cos(angle), Math.sin(angle)];
      const out = stillFromShot(shot, 'wide').anchors[1].out!;
      expect(Math.abs(Math.hypot(out[0], out[1]) - 1), `${degrees} 度`).toBeLessThan(1e-6);
    }
  });
});

describe('工具自己的检查（checkShot）', () => {
  const strips = ['s-town', 's-far'];

  it('读数是对的：没有话说', () => {
    expect(checkShot(madeUpShot(), '后来', strips, WIDE)).toEqual([]);
  });

  it('摆着的不是这一节', () => {
    expect(checkShot(madeUpShot(), '起初', strips, WIDE)).toEqual(['沙盘摆着的是“后来”，不是“起初”']);
  });

  it('画面的大小不是照着拍的那么大', () => {
    const shot = madeUpShot();
    shot.size = { width: 940, height: 900 };
    expect(checkShot(shot, '后来', strips, WIDE)).toEqual(['画面是 940 × 900，该是 1200 × 900']);
  });

  it('四边留的空不是工具交代的那几个数（沙盘测试页没有照网址里写的留）', () => {
    const shot = madeUpShot();
    shot.insets = { top: 44, right: 0, bottom: 28, left: 0 };
    expect(checkShot(shot, '后来', strips, WIDE)).toEqual(['四边留的空是 44、0、28、0（上、右、下、左），该是 62、130、130、130']);
  });

  it('题签指着的点和这一节的题签对不上：少一条、多一条、先后不同', () => {
    const expected = '这一节的题签是 [s-town、s-far]：要一条一个，先后相同';
    const fewer = madeUpShot();
    fewer.anchors.pop();
    expect(checkShot(fewer, '后来', strips, WIDE)).toEqual([`题签指着的点是 [s-town]，${expected}`]);
    const swapped = madeUpShot();
    swapped.anchors.reverse();
    expect(checkShot(swapped, '后来', strips, WIDE)[0]).toBe(`题签指着的点是 [s-far、s-town]，${expected}`);
    expect(checkShot(madeUpShot(), '后来', ['s-town', 's-far', 's-river'], WIDE)).toHaveLength(1);
  });

  it('第一条题签指着的点不在留出来的那一块里（落在多拍的那一截里、压在题记底下、看不见）', () => {
    const beside = madeUpShot();
    beside.anchors[0].x = 100;
    expect(checkShot(beside, '后来', strips, WIDE)).toEqual(['第一条题签“s-town”指着的点（100, 315）不在画面留出来的那一块里']);
    const under = madeUpShot();
    under.anchors[0].y = 800;
    expect(checkShot(under, '后来', strips, WIDE)).toHaveLength(1);
    const unseen = madeUpShot();
    unseen.anchors[0].visible = false;
    expect(checkShot(unseen, '后来', strips, WIDE)).toHaveLength(1);
    // 后面的题签可以在那一块外面（远处的题签摆在沙盘边上）
    const far = madeUpShot();
    far.anchors[1].y = 880;
    expect(checkShot(far, '后来', strips, WIDE)).toEqual([]);
  });

  it('数不对：fit、pxPerMetre 要大于 0，题签指着的点要是数', () => {
    const zero = madeUpShot();
    zero.fit = 0;
    expect(checkShot(zero, '后来', strips, WIDE)).toEqual(['fit（0）和 pxPerMetre（0.123456789）都要大于 0']);
    const nan = madeUpShot();
    nan.anchors[1].x = Number.NaN;
    expect(checkShot(nan, '后来', strips, WIDE)).toEqual(['题签“s-far”指着的点不是数']);
  });
});

// ---------------------------------------------------------------- 清单写成什么样，给人看的那一页

describe('清单写进文件的字（manifestText）', () => {
  const manifest = fixtureStills().manifest;
  const text = manifestText(manifest);

  it('读回来就是这份清单；缩进两格，LF 换行，末尾一个换行；同样的清单每次写出同样的字', () => {
    expect(JSON.parse(text)).toEqual(manifest);
    expect(text.endsWith('}\n')).toBe(true);
    expect(text.endsWith('\n\n')).toBe(false);
    expect(text).not.toContain('\r');
    expect(text.split('\n')[1]).toBe('  "tool": 1,');
    expect(manifestText(fixtureStills().manifest)).toBe(text);
  });

  it('字段的先后是固定的，不管传进来的东西是怎么拼的', () => {
    const scrambled = JSON.parse(JSON.stringify(manifest)) as StillManifest;
    const reversed = <T extends object>(value: T): T => Object.fromEntries(Object.entries(value).reverse()) as T;
    const shuffled: StillManifest = {
      ...reversed(scrambled),
      made: reversed(scrambled.made),
      madeFrom: reversed(scrambled.madeFrom),
      shapes: { narrow: reversed(scrambled.shapes.narrow), wide: reversed(scrambled.shapes.wide) },
      stills: scrambled.stills.map((still) => ({ ...reversed(still), pose: reversed(still.pose), anchors: still.anchors.map(reversed) })),
    };
    expect(manifestText(shuffled)).toBe(text);
    expect(Object.keys(JSON.parse(text) as object)).toEqual(['tool', 'made', 'madeFrom', 'shapes', 'stills']);
    expect(Object.keys((JSON.parse(text) as StillManifest).stills[0])).toEqual([
      'section',
      'shape',
      'file',
      'width',
      'height',
      'bytes',
      'quality',
      'key',
      'raw',
      'pose',
      'fit',
      'reach',
      'northDeg',
      'pxPerMetre',
      'anchors',
    ]);
  });

  it('多出来的字段不写进去', () => {
    const extra = JSON.parse(JSON.stringify(manifest)) as StillManifest & { note?: string };
    extra.note = '不该有';
    (extra.stills[0] as { changed?: boolean }).changed = true;
    expect(manifestText(extra)).toBe(text);
  });
});

describe('几样小东西', () => {
  it('先画好的地面的记号：两份像素的记号接起来再算；没有先画好的地面时是另一个固定的记号', () => {
    const key = groundKeyOf({ pixels: { colour: 'aaaaaaaaaaaaaaaa', fields: 'bbbbbbbbbbbbbbbb' } });
    expect(key).toBe(contentKey('aaaaaaaaaaaaaaaabbbbbbbbbbbbbbbb'));
    expect(groundKeyOf({ pixels: { colour: 'aaaaaaaaaaaaaaaa', fields: 'cccccccccccccccc' } })).not.toBe(key);
    expect(groundKeyOf(null)).toBe(contentKey(''));
    expect(groundKeyOf(null)).toMatch(KEY);
    expect(groundKeyOf(null)).not.toBe(key);
  });

  it('沙盘栏的底色：从 tokens.css 里读，从浏览器给的写法换过来', () => {
    expect(paneColour(':root {\n  --color-paper: #f5efe3;\n  --color-paper-sunk: #EBE3D3;\n}\n')).toBe('#ebe3d3');
    expect(paneColour(':root { --color-paper: #f5efe3; }')).toBeNull();
    // 写了人物也一样读得到：文件里没有他自己的一块，读的是头一处
    expect(paneColour(':root {\n  --color-paper: #f5efe3;\n  --color-paper-sunk: #EBE3D3;\n}\n', 'someone')).toBe('#ebe3d3');
    expect(paneColour(':root { --color-paper: #f5efe3; }', 'someone')).toBeNull();
    expect(hexColour('rgb(235, 227, 211)')).toBe('#ebe3d3');
    expect(hexColour('rgb(0,0,5)')).toBe('#000005');
    expect(hexColour('rgba(235, 227, 211, 0.5)')).toBeNull();
    expect(hexColour('transparent')).toBeNull();
  });

  it('沙盘栏的底色按人物读：他自己有一块的读他那一块，没有的读头一处；注释里的字、别人的一块、不落在沙盘栏上的一块都不算', () => {
    const css = [
      "/* 再添一位人物：选择符写成 [data-figure='…'] .stage-pane */",
      '.stage-pane {',
      '  --color-paper-sunk: #C5B189; /* 头一处 */',
      '  --figure-ink: #28231f;',
      '}',
      "/* 比如 [data-figure='second'] .stage-pane { --color-paper-sunk: #000000; } */",
      "[data-figure='second'] .stage-pane {",
      '  --color-paper-sunk: #BFC1B6;',
      '}',
      '[data-figure="third"] .stage-pane,',
      "[data-figure='fourth'] .stage-pane {",
      '  --figure-ink: #111111;',
      '  --color-paper-sunk: #abcdef;',
      '}',
      "[data-figure='fifth'] .stage-pane { --figure-ink: #222222; }",
      "[data-figure='sixth'] .reading { --color-paper-sunk: #123456; }",
      "[data-figure='seventh'] .stage-pane-note { --color-paper-sunk: #654321; }",
      '',
    ].join('\n');
    // 不写人物：头一处，和原来一样
    expect(paneColour(css)).toBe('#c5b189');
    // 文件里没有这位人物的一块：头一处
    expect(paneColour(css, 'first')).toBe('#c5b189');
    // 有自己的一块：读他的；单引号、双引号都认，几个选择符写在一起的也认
    expect(paneColour(css, 'second')).toBe('#bfc1b6');
    expect(paneColour(css, 'third')).toBe('#abcdef');
    expect(paneColour(css, 'fourth')).toBe('#abcdef');
    // 他那一块里没有写底色，或者那一块不落在沙盘栏上（.stage-pane）：头一处
    expect(paneColour(css, 'fifth')).toBe('#c5b189');
    expect(paneColour(css, 'sixth')).toBe('#c5b189');
    expect(paneColour(css, 'seventh')).toBe('#c5b189');
    // 名字只对上一半的不算
    expect(paneColour(css, 'sec')).toBe('#c5b189');
    // 注释里举的例子不算：把真的那一块去掉，读到的是头一处，不是注释里的 #000000
    expect(paneColour(css.replace("[data-figure='second'] .stage-pane {\n  --color-paper-sunk: #BFC1B6;\n}\n", ''), 'second')).toBe('#c5b189');
  });

  it('沙盘栏的底色，头一处不认写着人物的一块：别的人物的一块写在前面，没有自己一块的人物读到的还是没写人物的那一处；写在沙盘栏里面的东西上的一块不是栏的底色；注释里的字不算', () => {
    const unnamed = '.stage-pane {\n  --color-paper-sunk: #C5B189;\n  --figure-ink: #28231f;\n}\n';
    const second = "[data-figure='second'] .stage-pane {\n  --color-paper-sunk: #112233;\n}\n";
    // 别的人物的一块写在前面
    const before = `${second}${unnamed}`;
    expect(paneColour(before)).toBe('#c5b189');
    expect(paneColour(before, 'first')).toBe('#c5b189');
    expect(paneColour(before, 'second')).toBe('#112233');
    // 写在后面也一样
    expect(paneColour(`${unnamed}${second}`, 'first')).toBe('#c5b189');
    expect(paneColour(`${unnamed}${second}`, 'second')).toBe('#112233');
    // 几位人物合写的一块、写在沙盘栏自己身上的（.stage-pane[data-figure=…]）、双引号的，都是写着人物的一块，头一处不认
    for (const block of ["[data-figure='second'] .stage-pane,\n[data-figure=\"third\"] .stage-pane { --color-paper-sunk: #112233; }\n", '.stage-pane[data-figure="second"] { --color-paper-sunk: #112233; }\n']) {
      expect(paneColour(`${block}${unnamed}`), block).toBe('#c5b189');
      expect(paneColour(`${block}${unnamed}`, 'first'), block).toBe('#c5b189');
      expect(paneColour(`${block}${unnamed}`, 'second'), block).toBe('#112233');
    }
    // 只有写着人物的一块，没有别的：没有自己一块的人物读不到颜色
    expect(paneColour(second)).toBeNull();
    expect(paneColour(second, 'first')).toBeNull();
    // 有一个选择符没写人物的一块，是大家的：算头一处
    expect(paneColour(".stage-pane,\n[data-figure='second'] .stage-pane { --color-paper-sunk: #445566; }\n", 'first')).toBe('#445566');
    // 写在沙盘栏里面的东西上的一块（.stage-pane .strip、.stage-pane > .strip）：不是栏的底色，不当他的读；它写着人物，头一处也不认
    for (const inner of ["[data-figure='second'] .stage-pane .strip {\n  --color-paper-sunk: #445566;\n}\n", "[data-figure='second'] .stage-pane > .strip { --color-paper-sunk: #445566; }\n", "[data-figure='second'] .stage-pane-note { --color-paper-sunk: #445566; }\n"]) {
      expect(paneColour(`${unnamed}${inner}`, 'second'), inner).toBe('#c5b189');
      expect(paneColour(`${inner}${unnamed}`, 'second'), inner).toBe('#c5b189');
      expect(paneColour(`${inner}${unnamed}`), inner).toBe('#c5b189');
    }
    // 注释里的字不算：注释里举着一处完整的写法、举着写着人物的选择符，都不当真
    const commented = `/* 比如 --color-paper-sunk: #000000; 再添一位人物写成 [data-figure='…'] .stage-pane */\n${unnamed}`;
    expect(paneColour(commented)).toBe('#c5b189');
    expect(paneColour(commented, 'second')).toBe('#c5b189');
    expect(paneColour(`.stage-pane {\n  /* --color-paper-sunk: #000000; */\n  --color-paper-sunk: #C5B189; /* 头一处 */\n}\n`)).toBe('#c5b189');
  });

  it('src/styles/tokens.css 里，su-shi 读到的沙盘栏的底色就是头一处的那一个：他的那一块没有写人物，按人物读和原来读到的是同一个颜色', { timeout: 60_000 }, () => {
    const tokens = new TextDecoder().decode(readFile('src/styles/tokens.css'));
    const first = paneColour(tokens);
    expect(first).toMatch(/^#[0-9a-f]{6}$/);
    expect(paneColour(tokens, 'su-shi')).toBe(first);
    expect(tokens.replace(/\/\*[\s\S]*?\*\//g, '')).not.toMatch(/\[data-figure=['"]su-shi['"]\]/);
    expect(madeFromNow('su-shi', 'route').background).toBe(first);
    // 它就是他四座沙盘的清单里记着的、拍的时候到页面上量到的那个底色
    for (const stop of ['huangzhou', 'meishan', 'route', 'xuzhou']) {
      const manifest = JSON.parse(new TextDecoder().decode(readFile(`content/figures/su-shi/stills/${stop}.json`))) as StillManifest;
      expect(manifest.made.background.toLowerCase(), stop).toBe(first);
    }
    // 另一位人物的一块不管添在他的前面还是后面，他读到的都不变，那一位读到的是自己的
    const another = "[data-figure='another-figure'] .stage-pane {\n  --color-paper-sunk: #112233;\n}\n";
    for (const sheet of [`${another}${tokens}`, `${tokens}${another}`]) {
      expect(paneColour(sheet, 'su-shi')).toBe(first);
      expect(paneColour(sheet)).toBe(first);
      expect(paneColour(sheet, 'another-figure')).toBe('#112233');
    }
  });

  it('从给人看的那一页到图片文件的相对路径', () => {
    expect(relativePath('tests/shots/stills', 'tests/shots/stills-trial/su-shi/stills/xuzhou-1-wide.jpg')).toBe('../stills-trial/su-shi/stills/xuzhou-1-wide.jpg');
    expect(relativePath('tests/shots/stills', 'content/figures/su-shi/stills/xuzhou-1-wide.jpg')).toBe('../../../content/figures/su-shi/stills/xuzhou-1-wide.jpg');
    expect(relativePath('tests/shots/stills', 'tests/shots/stills/a.jpg')).toBe('a.jpg');
  });

  it('给人看的那一页：每张图一块，变了的标出来，题签上的字写在点的旁边；字里的尖括号不会变成标签', () => {
    const stills = fixtureStills().manifest.stills;
    const page = reviewPage('样<镇>', '#ebe3d3', [
      { still: stills[0], src: '../a/1-wide.jpg', changed: false, worstTile: null, labels: ['样城', '样水'] },
      { still: stills[1], src: '../a/1-narrow.jpg', changed: true, worstTile: 3.456, labels: ['样城', '样水'] },
      { still: stills[2], src: '../a/2-wide.jpg', changed: true, worstTile: null, labels: ['样城', '远<镇>'] },
    ]);
    expect(page.startsWith('<!doctype html>')).toBe(true);
    expect(page).not.toContain('\r');
    expect(page).toContain('<title>样&lt;镇&gt;的定格图</title>');
    expect(page).toContain('一共 3 张，这一次画面变了的 2 张');
    expect(page.match(/<figure class="changed">/g)).toHaveLength(2);
    expect(page.match(/<figure class="same">/g)).toHaveLength(1);
    expect(page).toContain('src="../a/1-narrow.jpg"');
    expect(page).toContain('没有变。');
    expect(page).toContain('变了：和原来那一张比，差得最多的一小块平均差 3.5 级。');
    expect(page).toContain('变了：新拍的，原来没有这一张。');
    expect(page).toContain('style="left:42.00%;top:44.00%"><i>样城</i>');
    expect(page).toContain('<i>远&lt;镇&gt;</i>');
    expect(page).not.toContain('远<镇>');
  });
});
