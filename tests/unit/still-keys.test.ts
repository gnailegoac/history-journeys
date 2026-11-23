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
import type { RouteScene, StopScene, TableScene } from '../../src/domain/scene';
import type { StillManifest } from '../../src/domain/stills';
import { groundKey } from '../../src/stage/ground/key';
import { FIT_MARGIN_PX, MAX_FIT } from '../../src/stage/three/rig';
import type { StageShot } from '../../src/stage/types';
import { STILL_MAX_BYTES as BUDGET_STILL_MAX_BYTES } from '../content/budgetRules';
import { fixtureScene } from '../support/fixtureScene';
import { pictureKey, pictureParts } from '../support/pictureKey';
import { decodePng } from '../support/png';
import { PROGRAM_FILES, PROGRAM_FOLDERS, isProgramPath, programKey } from '../support/programKey';
import { fixtureStills } from '../support/stills-fixture';
import {
  SHAPE_PLANS,
  SHOT_CAMERA,
  STILL_MAX_BYTES,
  checkShot,
  flatColour,
  groundKeyOf,
  hexColour,
  keepStill,
  keepWithin,
  manifestText,
  paneColour,
  pixelSum,
  programVersions,
  rawKey,
  readProgramFiles,
  relativePath,
  reviewPage,
  reviewWord,
  shapeSpec,
  shotInsets,
  shotViewport,
  stillFile,
  stillFromShot,
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

  it('哪些文件算在里面', () => {
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
    ]) {
      expect(isProgramPath(path), path).toBe(false);
    }
    expect(PROGRAM_FOLDERS).toEqual(['src/stage/three/', 'src/stage/ground/', 'src/stage/dev/']);
    expect(PROGRAM_FILES).toEqual(['src/stage/scale.ts', 'src/stage/roadLines.ts', 'stage-dev.html', 'tests/tools/make-stills.spec.ts', 'tests/support/stillsTool.ts', 'playwright.stills.config.ts']);
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
    expect(hexColour('rgb(235, 227, 211)')).toBe('#ebe3d3');
    expect(hexColour('rgb(0,0,5)')).toBe('#000005');
    expect(hexColour('rgba(235, 227, 211, 0.5)')).toBeNull();
    expect(hexColour('transparent')).toBeNull();
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
