// 先画好的地面是不是比做它的东西旧（content/figures/<人物>/baked/）。在 Node 里跑，不要浏览器，随 npm test 跑。
// 做它的东西有四样：场景文件里管地面的部分、地形文件、地面上色的程序、样式里地面的颜色。
// 前两样比记号（清单的 inputs；页面也是照这两个记号决定用不用这两张图的）；
// 后两样没法比记号，就照现在的场景和程序把地面重画一遍，比画出来的像素（清单的 pixels）。一座沙盘两三秒。
// 旧了就不通过，并且说出是哪一样变了、该跑哪条命令。
//
// 这座沙盘还没有先画好的地面（没有清单）时算通过：“每座沙盘都得有”是校验规则 17 的事（npm run validate）。
// 图片文件齐不齐、和清单对不对得上也是规则 17 的事；这里只多查一样规则 17 查不了的：
// 田的标记那张图读回来，是不是清单里记的那份像素。（颜色那张是 JPEG，在 Node 里读不回来。）
//
// “旧在哪里”是一个只算数的函数（staleReasons），先在几份编出来的清单上查它，再拿它查 content/ 里真的。

import { describe, expect, it } from 'vitest';
import type { BakedGroundManifest } from '../../src/domain/bakedGround';
import { contentKey } from '../../src/domain/contentKey';
import type { StopScene } from '../../src/domain/scene';
import type { Figure } from '../../src/domain/types';
import { buildFields, paintColour, readDem } from '../../src/stage/ground';
import type { Ground } from '../../src/stage/ground/types';
import { colourBytes, fieldBytes, groundInputs } from '../../src/stage/three/groundPaint';
import { styleFor } from '../../src/stage/three/style';
import { fixtureScene, fixtureTerrainBytes } from '../support/fixtureScene';
import { decodePng } from '../support/png';
import { readBytes } from '../support/readBytes';
import { realScene, realSceneFile, realSceneKeys } from './support/realScenes';

const manifests = import.meta.glob<BakedGroundManifest>('/content/figures/*/baked/*.json', { import: 'default', eager: true });
const figures = import.meta.glob<Figure>('/content/figures/*/figure.json', { import: 'default', eager: true });

const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};

/**
 * 发布流程的机器上（设了 CI）要不要也重画一遍来比。现在是要。
 * 重画靠的是两台机器算出一模一样的字节。要是这一组测试在开发机上通过、在发布流程里只有“重画出来和存着的不一样”
 * 这一条不过，那就是两边算出来的数最后一位不一样：把这里改成 false，发布流程里就只比场景和地形文件两个记号，
 * 重画这一项留在开发机上查。
 */
const REPAINT_ON_CI = true;
const repaint = !env.CI || REPAINT_ON_CI;

const COMMAND = '运行 npm run bake，再提交。';

/** 现在算出来的记号。pixels 是 null：这一次没有重画，像素不比。 */
interface KeysNow {
  inputs: { ground: string; terrain: string };
  pixels: { colour: string; fields: string } | null;
}

/**
 * 存着的地面旧在哪里：一样一句话，说出是什么变了、该跑哪条命令。空的就是不旧。
 * name 是这一站的名字（如“徐州”）。manifest 是 null（还没有先画好的地面）时不算旧。
 */
function staleReasons(name: string, manifest: Partial<Pick<BakedGroundManifest, 'inputs' | 'pixels'>> | null, now: KeysNow): string[] {
  if (!manifest) return [];
  const head = `${name}先画好的地面是旧的：`;
  if (!manifest.inputs || !manifest.pixels) return [`${name}先画好的地面的清单不完整（少了 inputs 或 pixels）。${COMMAND}`];

  const reasons: string[] = [];
  if (manifest.inputs.ground !== now.inputs.ground) reasons.push(`${head}场景文件里管地面的部分（样式、范围、地形、水、摆件、点缀）改过了。${COMMAND}`);
  if (manifest.inputs.terrain !== now.inputs.terrain) reasons.push(`${head}地形文件换过了。${COMMAND}`);
  if (now.pixels) {
    const colour = manifest.pixels.colour !== now.pixels.colour;
    const fields = manifest.pixels.fields !== now.pixels.fields;
    const what = colour && fields ? '颜色、田的标记都和存着的不一样' : colour ? '颜色和存着的不一样' : fields ? '田的标记和存着的不一样' : '';
    if (what) reasons.push(`${head}照现在的场景和程序重画，${what}。${COMMAND}`);
  }
  return reasons;
}

/** 照现在的场景、地形文件和程序算四个记号：和 npm run bake（tests/tools/bake-ground.test.ts）是同一种算法。 */
function keysNow(scene: StopScene, terrain: ArrayBuffer, ground: Ground, withPixels: boolean): KeysNow {
  const inputs = groundInputs(scene, terrain);
  if (!withPixels) return { inputs, pixels: null };
  const { colour } = paintColour(ground, styleFor(scene.style).ground);
  return { inputs, pixels: { colour: contentKey(colourBytes(colour)), fields: contentKey(fieldBytes(colour)) } };
}

/** 这一站给人看的名字：人物资料里这一站的短名；找不到就用“人物/站”。 */
function stopName(key: string): string {
  const [figureId, stopId] = key.split('/');
  const figure = figures[`/content/figures/${figureId}/figure.json`];
  return figure?.stops.find((stop) => stop.id === stopId)?.shortTitle ?? key;
}

// ---------------------------------------------------------------- 在编出来的清单上查这个函数

describe('旧在哪里（staleReasons），在编出来的清单上', () => {
  const NOW: KeysNow = { inputs: { ground: 'aaaaaaaaaaaaaaaa', terrain: 'bbbbbbbbbbbbbbbb' }, pixels: { colour: 'cccccccccccccccc', fields: 'dddddddddddddddd' } };
  const fresh = { inputs: { ...NOW.inputs }, pixels: { colour: 'cccccccccccccccc', fields: 'dddddddddddddddd' } };

  it('没有清单：不算旧', () => {
    expect(staleReasons('样镇', null, NOW)).toEqual([]);
  });

  it('四个记号都对得上：不旧', () => {
    expect(staleReasons('样镇', fresh, NOW)).toEqual([]);
  });

  it('场景里管地面的部分改过了：说是场景，说跑 npm run bake', () => {
    const reasons = staleReasons('样镇', { ...fresh, inputs: { ...fresh.inputs, ground: '0000000000000000' } }, NOW);
    expect(reasons).toEqual(['样镇先画好的地面是旧的：场景文件里管地面的部分（样式、范围、地形、水、摆件、点缀）改过了。运行 npm run bake，再提交。']);
  });

  it('地形文件换过了：说是地形文件', () => {
    const reasons = staleReasons('样镇', { ...fresh, inputs: { ...fresh.inputs, terrain: '0000000000000000' } }, NOW);
    expect(reasons).toEqual(['样镇先画好的地面是旧的：地形文件换过了。运行 npm run bake，再提交。']);
  });

  it('重画出来颜色不一样（程序或样式的颜色改过了）：就是数据规格里写的那一句', () => {
    const reasons = staleReasons('徐州', { ...fresh, pixels: { ...fresh.pixels, colour: '0000000000000000' } }, NOW);
    expect(reasons).toEqual(['徐州先画好的地面是旧的：照现在的场景和程序重画，颜色和存着的不一样。运行 npm run bake，再提交。']);
  });

  it('重画出来田的标记不一样、两样都不一样：各说各的', () => {
    expect(staleReasons('样镇', { ...fresh, pixels: { ...fresh.pixels, fields: '0000000000000000' } }, NOW)).toEqual([
      '样镇先画好的地面是旧的：照现在的场景和程序重画，田的标记和存着的不一样。运行 npm run bake，再提交。',
    ]);
    expect(staleReasons('样镇', { ...fresh, pixels: { colour: '0000000000000000', fields: '1111111111111111' } }, NOW)).toEqual([
      '样镇先画好的地面是旧的：照现在的场景和程序重画，颜色、田的标记都和存着的不一样。运行 npm run bake，再提交。',
    ]);
  });

  it('几样一起变了：一样一句，都说出来', () => {
    const reasons = staleReasons('样镇', { inputs: { ground: '0', terrain: '1' }, pixels: { colour: '2', fields: '3' } }, NOW);
    expect(reasons).toHaveLength(3);
    expect(reasons[0]).toContain('场景文件里管地面的部分');
    expect(reasons[1]).toContain('地形文件换过了');
    expect(reasons[2]).toContain('颜色、田的标记都和存着的不一样');
    for (const reason of reasons) expect(reason).toMatch(/^样镇先画好的地面是旧的：.+。运行 npm run bake，再提交。$/);
  });

  it('这一次没有重画（pixels 是 null）：只比两个记号，像素不同也不说', () => {
    const inputsOnly: KeysNow = { inputs: NOW.inputs, pixels: null };
    expect(staleReasons('样镇', { ...fresh, pixels: { colour: '0', fields: '1' } }, inputsOnly)).toEqual([]);
    expect(staleReasons('样镇', { ...fresh, inputs: { ...fresh.inputs, terrain: '0' } }, inputsOnly)).toHaveLength(1);
  });

  it('清单少了一块：说清单不完整，不说成别的', () => {
    expect(staleReasons('样镇', { inputs: fresh.inputs }, NOW)).toEqual(['样镇先画好的地面的清单不完整（少了 inputs 或 pixels）。运行 npm run bake，再提交。']);
    expect(staleReasons('样镇', {}, NOW)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------- 在一座小沙盘上从头走一遍：真的重画，真的算记号

describe('旧在哪里，在测试用的小沙盘上真的重画一遍', () => {
  const build = (change?: (scene: StopScene) => void, terrain: ArrayBuffer = fixtureTerrainBytes()) => {
    const scene = fixtureScene();
    change?.(scene);
    return { scene, terrain, ground: buildFields(scene, readDem(scene.terrain, terrain)) };
  };
  const base = build();
  /** “做图的时候”记下的四个记号。 */
  const baked = keysNow(base.scene, base.terrain, base.ground, true);
  const manifest = { inputs: baked.inputs, pixels: baked.pixels ?? undefined };

  it('什么都没改：重画出来和存着的一样，不旧；记号是 16 个十六进制字符', () => {
    const again = build();
    expect(staleReasons('样镇', manifest, keysNow(again.scene, again.terrain, again.ground, true))).toEqual([]);
    for (const key of [baked.inputs.ground, baked.inputs.terrain, baked.pixels?.colour, baked.pixels?.fields]) expect(key).toMatch(/^[0-9a-f]{16}$/);
    // 颜色和田的标记是两份不同的字节
    expect(baked.pixels?.colour).not.toBe(baked.pixels?.fields);
  });

  it('只改了镜头、题记、依据：不旧', () => {
    const edited = build((s) => {
      s.sections[0].camera.distanceM += 800;
      s.sections[1].line = '换了一句题记。';
      s.things[0].basis = '换了一句依据。';
      s.water.rivers[0].note = '换了一句说明。';
    });
    expect(staleReasons('样镇', manifest, keysNow(edited.scene, edited.terrain, edited.ground, true))).toEqual([]);
  });

  it('挪了河的一个点：场景的记号变了，重画出来的颜色也变了', () => {
    const moved = build((s) => {
      const [lng, lat] = s.water.rivers[0].line[1];
      s.water.rivers[0].line[1] = [lng + 0.003, lat];
    });
    const reasons = staleReasons('样镇', manifest, keysNow(moved.scene, moved.terrain, moved.ground, true));
    expect(reasons.some((r) => r.includes('场景文件里管地面的部分'))).toBe(true);
    expect(reasons.some((r) => r.includes('照现在的场景和程序重画') && r.includes('颜色'))).toBe(true);
    expect(reasons.some((r) => r.includes('地形文件'))).toBe(false);
  });

  it('地形文件换了一个数：地形文件的记号变了，场景的没变', () => {
    const bytes = fixtureTerrainBytes();
    const view = new DataView(bytes);
    // 把山顶附近的一格抬高 30 米（文件里的单位是分米）
    const at = (3 * 8 + 5) * 2;
    view.setInt16(at, view.getInt16(at, true) + 300, true);
    const changed = build(undefined, bytes);
    const reasons = staleReasons('样镇', manifest, keysNow(changed.scene, changed.terrain, changed.ground, true));
    expect(reasons.some((r) => r.includes('地形文件换过了'))).toBe(true);
    expect(reasons.some((r) => r.includes('场景文件里管地面的部分'))).toBe(false);
  });

  it('场景和地形文件都没动，上色的结果变了（程序或样式改了）：只说重画出来不一样', () => {
    // 假装上色的程序改了：把“做图的时候”记下的像素记号换成别的
    const older = { inputs: baked.inputs, pixels: { colour: contentKey('旧程序画的颜色'), fields: baked.pixels?.fields ?? '' } };
    const reasons = staleReasons('样镇', older, keysNow(base.scene, base.terrain, base.ground, true));
    expect(reasons).toEqual(['样镇先画好的地面是旧的：照现在的场景和程序重画，颜色和存着的不一样。运行 npm run bake，再提交。']);
  });
});

// ---------------------------------------------------------------- content/ 里真的

const keys = realSceneKeys();

it('content/ 里至少有一座站点沙盘', () => {
  expect(keys.length).toBeGreaterThan(0);
});

describe.each(keys)('%s 先画好的地面', (key) => {
  const [figureId, stopId] = key.split('/');
  const dir = `content/figures/${figureId}/baked`;
  const manifest = manifests[`/${dir}/${stopId}.json`] ?? null;

  it('不比做它的东西旧（没有清单时算通过）', { timeout: 60_000 }, () => {
    if (!manifest) return;
    const { scene, terrainPath } = realSceneFile(key);
    const reasons = staleReasons(stopName(key), manifest, keysNow(scene, readBytes(terrainPath), realScene(key).ground, repaint));
    expect(reasons, reasons.join('\n')).toEqual([]);
  });

  it('田的标记那张图读回来，就是清单里记的那份像素（没有清单时算通过）', () => {
    if (!manifest?.fields || !manifest.pixels) return;
    const name = stopName(key);
    let file: Uint8Array;
    try {
      file = new Uint8Array(readBytes(`${dir}/${manifest.fields.file}`));
    } catch {
      throw new Error(`${name}先画好的地面少了一张图：${dir}/${manifest.fields.file} 不在。${COMMAND}`);
    }
    const picture = decodePng(file);
    expect([picture.width, picture.height, picture.channels], `${name}田的标记那张图的大小、种类和清单里写的不一样。${COMMAND}`).toEqual([manifest.fields.width, manifest.fields.height, 1]);
    expect(contentKey(picture.pixels), `${name}田的标记那张图读回来，和清单里记的像素不一样（图被改过，或者不是这份清单的）。${COMMAND}`).toBe(manifest.pixels.fields);
  });
});
