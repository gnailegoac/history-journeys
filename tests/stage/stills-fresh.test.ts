// 每一小节的定格图是不是比做它的东西旧（content/figures/<人物>/stills/<站>.json）。在 Node 里跑，不要浏览器，随 npm test 跑。
// 定格图没法在这里重拍（要浏览器，而且各台机器画出来差一点），所以比的是“照什么拍的”：清单里记着四个记号——
// 场景文件里决定画面的部分、地形文件、先画好的地面、沙盘程序和拍照的工具——再加上沙盘栏的底色（按人物读）。
// 照磁盘上现在的文件各算一遍，和清单比；有一样对不上就不通过，并且说出是哪一样变了、该跑哪条命令。
// 沙盘程序的那一个记号是一座沙盘一个，只算这座沙盘用得着的文件（共用的，它的样式的，它用到的那几家零件的；全程沙盘另加它才用的那一块，
// 见 tests/support/programKey.ts）：别的样式、它没用到的零件改了，这座沙盘不算旧。
//
// 这座沙盘还没有定格图（没有清单）时算通过：“每座沙盘都得有”是校验规则 18 的事（npm run validate）。
// 图片文件齐不齐、和清单对不对得上也是规则 18 的事。版面（沙盘栏多大、四边留多少）变没变要浏览器量，
// 在 tests/e2e/still-layout.spec.ts。
//
// “旧在哪里”是一个只算数的函数（tests/support/stillsTool.ts 的 staleStills），先在编出来的清单上查它，
// 再照磁盘上真的文件走一遍，最后拿它查 content/ 里真的清单。

import { describe, expect, it } from 'vitest';
import { contentKey } from '../../src/domain/contentKey';
import type { TableScene } from '../../src/domain/scene';
import type { StillManifest } from '../../src/domain/stills';
import type { Figure } from '../../src/domain/types';
import { FAMILIES } from '../../src/stage/families';
import { isPending } from '../support/pendingTables';
import { pictureKey } from '../support/pictureKey';
import { FAMILY_FOLDER, LEFT_OUT_FILES, ROUTE_LEVEL_FILES, STYLE_FILES, programKey, styleFilesIn, tableFiles } from '../support/programKey';
import { fixtureStills } from '../support/stills-fixture';
import { madeFromNow, programVersions, readFile, readProgramFiles, readTableFiles, staleStills, tableUse, type MadeFromNow } from '../support/stillsTool';

const sceneFiles = import.meta.glob('/content/figures/*/scenes/*.json');
const manifests = import.meta.glob<StillManifest>('/content/figures/*/stills/*.json', { import: 'default', eager: true });
const figures = import.meta.glob<Figure>('/content/figures/*/figure.json', { import: 'default', eager: true });

const COMMAND = '运行 STILLS_OUT=content/figures npm run stills（见 README），再提交。';

/**
 * content/ 里每一座沙盘：“人物/场景文件的名字”。定格图还没有做出来的那几座（tests/support/pendingTables.ts 的表）不在里面：
 * 没有图，就没有旧不旧；从表里拿掉的那一天起这里就查它。
 */
const tables = Object.keys(sceneFiles)
  .map((path) => /^\/content\/figures\/([^/]+)\/scenes\/([^/]+)\.json$/.exec(path))
  .filter((m): m is RegExpExecArray => m !== null)
  .filter((m) => !isPending(`${m[1]}/${m[2]}`))
  .map((m) => ({ figureId: m[1], stopId: m[2] }))
  .sort((a, b) => `${a.figureId}/${a.stopId}`.localeCompare(`${b.figureId}/${b.stopId}`));

/** 这一站给人看的名字：人物资料里这一站的短名；找不到就用“人物/站”。 */
function stopName(figureId: string, stopId: string): string {
  const figure = figures[`/content/figures/${figureId}/figure.json`];
  return figure?.stops.find((stop) => stop.id === stopId)?.shortTitle ?? `${figureId}/${stopId}`;
}

// ---------------------------------------------------------------- 在编出来的清单上查这个函数

describe('旧在哪里（staleStills），在编出来的清单上', () => {
  const NOW: MadeFromNow = {
    madeFrom: { scene: 'aaaaaaaaaaaaaaaa', terrain: 'bbbbbbbbbbbbbbbb', ground: 'cccccccccccccccc', program: 'dddddddddddddddd' },
    background: '#ebe3d3',
  };
  /** 一份和现在对得上的清单（别的字段照假清单的）。 */
  const fresh = (): StillManifest => {
    const manifest = fixtureStills().manifest;
    manifest.madeFrom = { ...NOW.madeFrom };
    manifest.made.background = '#ebe3d3';
    return manifest;
  };
  const withKey = (key: keyof StillManifest['madeFrom']): StillManifest => {
    const manifest = fresh();
    manifest.madeFrom[key] = '0000000000000000';
    return manifest;
  };

  it('没有清单：不算旧', () => {
    expect(staleStills('样镇', null, NOW)).toEqual([]);
  });

  it('四个记号和底色都对得上：不旧', () => {
    expect(staleStills('样镇', fresh(), NOW)).toEqual([]);
    // 底色的大小写不要紧
    const upper = fresh();
    upper.made.background = '#EBE3D3';
    expect(staleStills('样镇', upper, NOW)).toEqual([]);
  });

  it('场景里决定画面的部分改过了：说是场景，说跑哪条命令（带着 STILLS_OUT 的那一条，不是试拍）', () => {
    expect(staleStills('样镇', withKey('scene'), NOW)).toEqual([`样镇的定格图是旧的：场景文件里决定画面的部分改过了（镜头、题签指的点、范围、地形、水、摆件、点缀）。${COMMAND}`]);
  });

  it('地形文件换过了：说是地形文件', () => {
    expect(staleStills('样镇', withKey('terrain'), NOW)).toEqual([`样镇的定格图是旧的：地形文件换过了。${COMMAND}`]);
  });

  it('先画好的地面重做过了：说是先画好的地面', () => {
    expect(staleStills('样镇', withKey('ground'), NOW)).toEqual([`样镇的定格图是旧的：先画好的地面重做过了。${COMMAND}`]);
  });

  it('沙盘程序改过了：就是数据规格里写的那一句，说出这座沙盘的记号里算了哪几样；全程沙盘说它才用的那一块，不说零件', () => {
    const reasons = staleStills('徐州', withKey('program'), NOW);
    expect(reasons).toHaveLength(1);
    expect(reasons[0]).toMatch(/^徐州的定格图是旧的：沙盘程序改过了（.+）。运行 STILLS_OUT=content\/figures npm run stills（见 README），再提交。$/);
    for (const part of ['各座沙盘共用的部分', '这座沙盘用的样式', '它用到的那几家零件', '拍照的工具', 'three、Playwright 的版本']) expect(reasons[0]).toContain(part);
    expect(reasons[0]).not.toContain('全程沙盘才用的那一块');
    // 没有说是不是全程沙盘的，照站点沙盘说
    expect(staleStills('徐州', withKey('program'), { ...NOW, route: false })).toEqual(reasons);
    const route = staleStills('全程', withKey('program'), { ...NOW, route: true });
    expect(route).toHaveLength(1);
    expect(route[0]).toMatch(/^全程的定格图是旧的：沙盘程序改过了（.+）。运行 STILLS_OUT=content\/figures npm run stills（见 README），再提交。$/);
    for (const part of ['各座沙盘共用的部分', '这座沙盘用的样式', '全程沙盘才用的那一块', '拍照的工具', 'three、Playwright 的版本']) expect(route[0]).toContain(part);
    expect(route[0]).not.toContain('零件');
    // 别的四句不分哪一层的沙盘
    for (const key of ['scene', 'terrain', 'ground'] as const) expect(staleStills('全程', withKey(key), { ...NOW, route: true })).toEqual(staleStills('全程', withKey(key), NOW));
  });

  it('沙盘栏的底色改了：说是底色，说它写在哪', () => {
    const repainted = fresh();
    repainted.made.background = '#ffffff';
    expect(staleStills('样镇', repainted, NOW)).toEqual([`样镇的定格图是旧的：沙盘栏的底色改了（src/styles/tokens.css 里的 --color-paper-sunk）。${COMMAND}`]);
    // tokens.css 里找不到那个颜色了，也算对不上
    expect(staleStills('样镇', fresh(), { ...NOW, background: null })).toHaveLength(1);
  });

  it('几样一起变了：一样一句，都说出来', () => {
    const old = fresh();
    old.madeFrom = { scene: '0', terrain: '1', ground: '2', program: '3' };
    old.made.background = '#000000';
    const reasons = staleStills('样镇', old, NOW);
    expect(reasons).toHaveLength(5);
    expect(reasons[0]).toContain('场景文件里决定画面的部分');
    expect(reasons[1]).toContain('地形文件换过了');
    expect(reasons[2]).toContain('先画好的地面重做过了');
    expect(reasons[3]).toContain('沙盘程序改过了');
    expect(reasons[4]).toContain('沙盘栏的底色改了');
    for (const reason of reasons) expect(reason).toMatch(/^样镇的定格图是旧的：.+。运行 STILLS_OUT=content\/figures npm run stills（见 README），再提交。$/);
  });

  it('清单少了一块：说清单不完整，不说成别的', () => {
    expect(staleStills('样镇', { made: { background: '#ebe3d3' } }, NOW)).toEqual([`样镇的定格图的清单不完整（少了 madeFrom 或 made）。${COMMAND}`]);
    expect(staleStills('样镇', {}, NOW)).toHaveLength(1);
    // madeFrom 里少一个记号：那一个算对不上
    expect(staleStills('样镇', { madeFrom: { scene: NOW.madeFrom.scene, terrain: NOW.madeFrom.terrain, ground: NOW.madeFrom.ground }, made: { background: '#ebe3d3' } }, NOW)).toEqual([
      expect.stringContaining('沙盘程序改过了'),
    ]);
  });
});

// ---------------------------------------------------------------- 照磁盘上真的文件走一遍

describe.each(tables)('$figureId/$stopId：照磁盘上现在的文件算“照什么拍的”', ({ figureId, stopId }) => {
  const dir = `content/figures/${figureId}`;
  const sceneText = (): string => new TextDecoder().decode(readFile(`${dir}/scenes/${stopId}.json`));

  // 四个记号要把程序和场景的文件都读一遍、算一遍：整套测试一起跑的时候要五到七秒，单给一个时限（下一条也是）
  it('四个记号都算得出来，底色读得到；算两遍一样', { timeout: 60_000 }, () => {
    const now = madeFromNow(figureId, stopId);
    for (const key of ['scene', 'terrain', 'ground', 'program'] as const) expect(now.madeFrom[key], key).toMatch(/^[0-9a-f]{16}$/);
    expect(now.background).toMatch(/^#[0-9a-f]{6}$/);
    expect(madeFromNow(figureId, stopId)).toEqual(now);
    // 各是照什么算的
    const scene = JSON.parse(sceneText()) as TableScene;
    expect(now.madeFrom.scene).toBe(pictureKey(scene));
    expect(now.madeFrom.terrain).toBe(contentKey(readFile(`${dir}/scenes/${scene.terrain.file}`)));
    // 程序的记号是这座沙盘自己的：只算它用得着的文件（共用的，它的样式的，它用到的那几家零件的；全程沙盘另加它才用的那一块）
    expect(now.madeFrom.program).toBe(programKey(readTableFiles(scene), programVersions()));
    expect(now.madeFrom.program).toBe(programKey(tableFiles(readProgramFiles(), tableUse(scene)), programVersions()));
    expect(now.route).toBe(scene.level === 'route');
  });

  it('刚拍好的清单不旧；场景里改一个镜头的数、程序里改一个字节、换一个库的版本，各说各的', { timeout: 60_000 }, () => {
    const name = stopName(figureId, stopId);
    const now = madeFromNow(figureId, stopId);
    const manifest = { madeFrom: { ...now.madeFrom }, made: { background: now.background ?? '' } };
    expect(staleStills(name, manifest, now)).toEqual([]);

    // 场景：挪一个镜头的数
    const scene = JSON.parse(sceneText()) as { sections: { camera: { distanceM: number } }[] };
    scene.sections[0].camera.distanceM += 1;
    expect(staleStills(name, manifest, { ...now, madeFrom: { ...now.madeFrom, scene: pictureKey(scene) } })).toEqual([expect.stringContaining('场景文件里决定画面的部分改过了')]);

    // 程序：这座沙盘用得着的一个文件（各座沙盘共用的）末尾多一个空格
    const files = readTableFiles(JSON.parse(sceneText()) as TableScene);
    const touched = { ...files, 'src/stage/three/view.ts': new Uint8Array([...files['src/stage/three/view.ts'], 0x20]) };
    const programTouched = programKey(touched, programVersions());
    expect(staleStills(name, manifest, { ...now, madeFrom: { ...now.madeFrom, program: programTouched } })).toEqual([expect.stringContaining('沙盘程序改过了')]);

    // 库的版本
    const upgraded = programKey(files, { ...programVersions(), three: '9.9.9' });
    expect(staleStills(name, manifest, { ...now, madeFrom: { ...now.madeFrom, program: upgraded } })).toEqual([expect.stringContaining('沙盘程序改过了')]);

    // 地形文件：改一个字节
    const terrain = readFile(`${dir}/scenes/${(JSON.parse(sceneText()) as { terrain: { file: string } }).terrain.file}`).slice();
    terrain[0] ^= 1;
    expect(staleStills(name, manifest, { ...now, madeFrom: { ...now.madeFrom, terrain: contentKey(terrain) } })).toEqual([expect.stringContaining('地形文件换过了')]);
  });

  it('程序的记号只算这座沙盘用得着的：共用的、它的样式的、它用到的零件的、（全程沙盘）它才用的那一块，改一个字节就旧；别的样式的、没用到的零件的、小像的、读内容的程序改了不旧', { timeout: 60_000 }, () => {
    const name = stopName(figureId, stopId);
    const scene = JSON.parse(sceneText()) as TableScene;
    const use = tableUse(scene);
    const versions = programVersions();
    const all = readProgramFiles();
    const now = madeFromNow(figureId, stopId);
    const manifest = { madeFrom: { ...now.madeFrom }, made: { background: now.background ?? '' } };
    /** 把磁盘上那一批文件换成 files 以后，这座沙盘旧不旧（旧了说的就是“沙盘程序改过了”那一句）。styles 不写用程序里那张表（认得哪几种样式）。 */
    const stale = (files: Record<string, Uint8Array | string>, styles: Readonly<Record<string, readonly string[]>> = STYLE_FILES): boolean => {
      const reasons = staleStills(name, manifest, { ...now, madeFrom: { ...now.madeFrom, program: programKey(tableFiles(files, use, styles), versions) } });
      if (reasons.length > 0) expect(reasons).toEqual([expect.stringContaining('沙盘程序改过了')]);
      return reasons.length > 0;
    };
    /** 一个文件末尾多一个空格（不在那一批里的，从磁盘上读来再添进去）。 */
    const touch = (path: string): Record<string, Uint8Array> => ({ ...all, [path]: new Uint8Array([...(path in all ? all[path] : readFile(path)), 0x20]) });
    expect(stale(all)).toBe(false);

    // 各座沙盘共用的：旧
    for (const path of ['src/stage/three/view.ts', 'src/stage/three/internal.ts', 'src/stage/three/style/index.ts', 'src/stage/ground/paint.ts', 'src/domain/scene.ts', 'src/domain/sceneKinds.ts', 'stage-dev.html', 'tests/support/stillsTool.ts']) expect(stale(touch(path)), path).toBe(true);
    // 它的样式的每一个文件：旧。是哪些文件，照磁盘上的文件和算记号的那条规矩问（表里点了名的，和以样式的名字命名的子文件夹里的），至少有一个
    const styleFiles = styleFilesIn(Object.keys(all), scene.style);
    expect(styleFiles.length, `磁盘上没有找到“${scene.style}”这种样式自己的文件`).toBeGreaterThan(0);
    for (const path of styleFiles) expect(stale(touch(path)), path).toBe(true);
    // 零件：场景里写到了的那几家旧，没写到的不旧（哪几家是照场景文件和登记表算的，和沙盘程序一样）
    for (const family of FAMILIES) expect(stale(touch(`${FAMILY_FOLDER}${family.name}.ts`)), family.name).toBe(use.families.includes(family.name));
    // 全程沙盘才用的那一块：只有全程沙盘旧
    for (const path of ROUTE_LEVEL_FILES) expect(stale(touch(path)), path).toBe(use.route);
    // 小像的程序、读内容的程序：不在记号里，不旧
    for (const path of LEFT_OUT_FILES) expect(stale(touch(path)), path).toBe(false);
    // 添一种别的样式的文件（认得这种样式：表里有它那一行，文件在以它的名字命名的子文件夹里）、添一家没用到的零件：不旧；添一个共用的文件：旧
    const withAnother = { ...STYLE_FILES, 'another-style': [] };
    expect(stale({ ...all, 'src/stage/three/style/another-style/look.ts': 'export const look = 1;\n' }, withAnother)).toBe(false);
    expect(stale(all, withAnother)).toBe(false);
    expect(stale({ ...all, [`${FAMILY_FOLDER}another-family.ts`]: 'export const family = {};\n' })).toBe(false);
    expect(stale({ ...all, 'src/stage/three/another.ts': '' })).toBe(true);
    // 样式的文件夹里一个子文件夹，名字不是哪一种认得的样式（几种样式合用的小东西，或者名字写错了）：里面的文件当共用的算，旧
    expect(stale({ ...all, 'src/stage/three/style/zz-not-a-style/tint.ts': "export const TINT = '#000000';\n" })).toBe(true);
    expect(stale({ ...all, 'src/stage/three/style/another-style/look.ts': 'export const look = 1;\n' })).toBe(true);
  });

  it('场景里只改依据、题记、题签上的字：不算旧', () => {
    const now = madeFromNow(figureId, stopId);
    const scene = JSON.parse(sceneText()) as { things?: { basis: string }[]; roads?: { journeys: { parts: { basis: string }[] }[] }; sections: { line: string }[]; strips: { text: string }[] };
    // 改一句依据：站点沙盘上是头一样摆件的，全程沙盘上（没有摆件）是头一趟路头一截的
    const grounded = scene.things?.[0] ?? scene.roads?.journeys[0]?.parts[0];
    expect(grounded, `${figureId}/${stopId}：场景里要有一样带依据的东西`).toBeDefined();
    grounded!.basis += '（补一句）';
    scene.sections[0].line += '！';
    scene.strips[0].text = '改';
    // 最外面添上（或者改了）凭据里印的小像的那几句话：小像不在定格图里
    (scene as { piece?: { name: string; basis: string; note: string } }).piece = { name: '小像', basis: '只标出他在哪', note: '示意的' };
    expect(pictureKey(scene)).toBe(now.madeFrom.scene);
  });
});

// ---------------------------------------------------------------- 苏轼的四座沙盘：改了哪一块，旧的正好是哪几座

describe('su-shi 的四座沙盘：程序里改了哪一块，旧的正好是哪几座', () => {
  /** 他的四座沙盘。写着名字取：哪一座用哪几家零件是他的场景文件里的事。 */
  const HIS = ['su-shi/huangzhou', 'su-shi/meishan', 'su-shi/route', 'su-shi/xuzhou'];
  const scenes = Object.fromEntries(HIS.map((key) => [key, JSON.parse(new TextDecoder().decode(readFile(`content/figures/${key.replace('/', '/scenes/')}.json`))) as TableScene]));
  /** 把磁盘上那一批文件换成 files 以后，他的哪几座沙盘的记号变了。styles 不写用程序里那张表（认得哪几种样式）。 */
  const staleAfter = (files: Record<string, Uint8Array | string>, styles: Readonly<Record<string, readonly string[]>> = STYLE_FILES): string[] => {
    const all = readProgramFiles();
    const versions = programVersions();
    return HIS.filter((key) => programKey(tableFiles(files, tableUse(scenes[key]), styles), versions) !== programKey(tableFiles(all, tableUse(scenes[key])), versions));
  };
  const touched = (path: string): Record<string, Uint8Array> => {
    const all = readProgramFiles();
    return { ...all, [path]: new Uint8Array([...(path in all ? all[path] : readFile(path)), 0x20]) };
  };

  it('四座都在要查的沙盘里；各用哪几家零件：黄州用石和土、草木，眉州用草木、小工程，徐州和全程沙盘一家不用', () => {
    for (const key of HIS) expect(tables.map((table) => `${table.figureId}/${table.stopId}`), key).toContain(key);
    expect(Object.fromEntries(HIS.map((key) => [key, tableUse(scenes[key]).families]))).toEqual({ 'su-shi/huangzhou': ['rock', 'plants'], 'su-shi/meishan': ['plants', 'works'], 'su-shi/route': [], 'su-shi/xuzhou': [] });
    for (const key of HIS) expect(tableUse(scenes[key]).style, key).toBe('song-qinglv');
    expect(HIS.filter((key) => tableUse(scenes[key]).route)).toEqual(['su-shi/route']);
  });

  it('一个共用的文件、他的样式的一个文件改一个字节：四座都旧', { timeout: 60_000 }, () => {
    expect(staleAfter(touched('src/stage/three/view.ts'))).toEqual(HIS);
    expect(staleAfter(touched('tests/tools/make-stills.spec.ts'))).toEqual(HIS);
    // 他的样式的文件：照磁盘上的文件和算记号的那条规矩问，至少有一个（搬进以样式的名字命名的子文件夹以后也查得到）
    const his = styleFilesIn(Object.keys(readProgramFiles()), 'song-qinglv');
    expect(his.length, '磁盘上没有找到 song-qinglv 这种样式自己的文件').toBeGreaterThan(0);
    for (const path of his) expect(staleAfter(touched(path)), path).toEqual(HIS);
  });

  it('一家零件的文件改一个字节：旧的正好是用到它的那几座——石和土只有黄州，草木是黄州和眉州，小工程只有眉州', { timeout: 60_000 }, () => {
    expect(staleAfter(touched(`${FAMILY_FOLDER}rock.ts`))).toEqual(['su-shi/huangzhou']);
    expect(staleAfter(touched(`${FAMILY_FOLDER}plants.ts`))).toEqual(['su-shi/huangzhou', 'su-shi/meishan']);
    expect(staleAfter(touched(`${FAMILY_FOLDER}works.ts`))).toEqual(['su-shi/meishan']);
  });

  it('全程沙盘才用的那一块改一个字节：只有全程沙盘旧；小像的程序、读内容的程序改了，一座也不旧', { timeout: 60_000 }, () => {
    for (const path of ROUTE_LEVEL_FILES) expect(staleAfter(touched(path)), path).toEqual(['su-shi/route']);
    for (const path of LEFT_OUT_FILES) expect(staleAfter(touched(path)), path).toEqual([]);
  });

  it('添一种别的样式的文件、添一家他没用到的零件的文件：一座也不旧', { timeout: 60_000 }, () => {
    const all = readProgramFiles();
    // 别的样式：认得它（表里有它那一行），文件在以它的名字命名的子文件夹里
    const withAnother = { ...STYLE_FILES, 'another-style': [] };
    expect(staleAfter({ ...all, 'src/stage/three/style/another-style/look.ts': 'export const look = 1;\n', 'src/stage/three/style/another-style/figure.ts': 'export const figure = 1;\n' }, withAnother)).toEqual([]);
    expect(staleAfter({ ...all, [`${FAMILY_FOLDER}another-family.ts`]: 'export const family = {};\n' })).toEqual([]);
  });

  it('样式的文件夹里添一个子文件夹，名字不是哪一种认得的样式（几种样式合用的小东西，或者把样式的名字写错了一个字）：里面的文件当共用的算，四座都旧；再改它，四座的记号又变', { timeout: 60_000 }, () => {
    const all = readProgramFiles();
    const versions = programVersions();
    for (const path of ['src/stage/three/style/zz-not-a-style/tint.ts', 'src/stage/three/style/song-qinlv/look.ts', 'src/stage/three/style/another-style/look.ts']) {
      const planted = { ...all, [path]: "export const TINT = '#000000';\n" };
      expect(staleAfter(planted), path).toEqual(HIS);
      const changed = { ...planted, [path]: "export const TINT = '#ffffff';\n" };
      expect(HIS.filter((key) => programKey(tableFiles(changed, tableUse(scenes[key])), versions) !== programKey(tableFiles(planted, tableUse(scenes[key])), versions)), path).toEqual(HIS);
    }
  });
});

// ---------------------------------------------------------------- 算记号的文件都是 LF 换行

describe('算记号的文件', () => {
  // 每一座沙盘算的文件都要读一遍：整套测试一起跑的时候不止一秒半，单给一个时限
  it('都是 LF 换行，没有回车符：记号是照文件原样的字节算的，仓库里统一存成 LF，带着回车符算出来的记号到别的机器上就对不上', { timeout: 60_000 }, () => {
    const withCr: string[] = [];
    const check = (path: string, bytes: Uint8Array): void => {
      if (bytes.includes(0x0d)) withCr.push(path);
    };
    // 各座沙盘的并在一起：共用的，每一种样式的，每一家零件的（哪一座都没用到的也查），全程沙盘才用的
    const union = readProgramFiles();
    for (const { figureId, stopId } of tables) {
      const scene = JSON.parse(new TextDecoder().decode(readFile(`content/figures/${figureId}/scenes/${stopId}.json`))) as TableScene;
      for (const path of Object.keys(readTableFiles(scene))) expect(union[path], `${figureId}/${stopId} 的记号里的 ${path} 不在要查换行的那一批里`).toBeDefined();
    }
    for (const [path, bytes] of Object.entries(union)) check(path, bytes);
    for (const { figureId, stopId } of tables) check(`content/figures/${figureId}/scenes/${stopId}.json`, readFile(`content/figures/${figureId}/scenes/${stopId}.json`));
    check('src/styles/tokens.css', readFile('src/styles/tokens.css'));
    expect(withCr).toEqual([]);
  });
});

// ---------------------------------------------------------------- content/ 里真的清单

describe('content/ 里的定格图是不是旧的', () => {
  it('找得到要查的沙盘', () => {
    expect(tables.length).toBeGreaterThan(0);
  });

  it.each(tables)('$figureId/$stopId：定格图不比做它的东西旧（还没有定格图也算通过）', ({ figureId, stopId }) => {
    const manifest = manifests[`/content/figures/${figureId}/stills/${stopId}.json`] ?? null;
    const reasons = staleStills(stopName(figureId, stopId), manifest, madeFromNow(figureId, stopId));
    // 不通过时，印出来的就是这几句话
    expect(reasons.join('\n')).toBe('');
  });
});
