// 读取场景的单元测试：hasStopTable、loadStopTable、loadRouteStill，对着真实的 content/ 目录。
// 这里只管“读得对不对”；场景本身合不合规格由 npm run validate 管。
// 工具做出来的两样（先画好的地面 baked/、每一小节的定格图 stills/）磁盘上可以还没有：
// 有就查带没带上、带得对不对，没有就查没带；“在、不在、清单在而图不齐”这几种情形另用编出来的几张表测。

import { describe, expect, it, vi } from 'vitest';
import type { BakedGroundManifest } from '../../src/domain/bakedGround';
import type { StopScene } from '../../src/domain/scene';
import { hasStopTable, loadRouteStill, loadStopTable, pickStopTable } from '../../src/domain/sceneContent';
import type { MadeFiles } from '../../src/domain/sceneContent';
import type { StillManifest, StillShape, StillShot } from '../../src/domain/stills';
import type { Figure } from '../../src/domain/types';

const ROOT = '/content/figures';

// 直接从磁盘读到的文字，用来和读取函数的结果对照。
const texts = import.meta.glob<string>('/content/figures/**/*.json', { query: '?raw', import: 'default', eager: true });
// 目录里有哪些文件（含地形文件和图片），只用路径，不读内容。
const paths = new Set(Object.keys(import.meta.glob('/content/figures/**/*')));

function json<T>(path: string): T {
  return JSON.parse(texts[path].replace(/^\uFEFF/, '')) as T;
}

/** 磁盘上的人物。 */
const figuresOnDisk = Object.keys(texts)
  .filter((path) => /^\/content\/figures\/[^/]+\/figure\.json$/.test(path))
  .map((path) => json<Figure>(path));

/** 磁盘上的场景文件：哪位人物的哪一站。 */
const scenesOnDisk = [...paths].flatMap((path) => {
  const match = /^\/content\/figures\/([^/]+)\/scenes\/([^/]+)\.json$/.exec(path);
  return match ? [{ figureId: match[1], stopId: match[2], path }] : [];
});

describe('hasStopTable', () => {
  it('不用等就知道一站有没有场景文件：磁盘上有的说有，没有的说没有', () => {
    expect(hasStopTable('su-shi', 'xuzhou')).toBe(true);
    let without = 0;
    for (const figure of figuresOnDisk) {
      for (const stop of figure.stops) {
        const there = paths.has(`${ROOT}/${figure.id}/scenes/${stop.id}.json`);
        expect(hasStopTable(figure.id, stop.id), `${figure.id}/${stop.id}`).toBe(there);
        if (!there) without += 1;
      }
    }
    expect(without, '至少要有一站还没有沙盘，这一条才测得到').toBeGreaterThan(0);
  });

  it('没有这位人物、没有这一站、地形文件，都不算', () => {
    expect(hasStopTable('no-such-figure', 'xuzhou')).toBe(false);
    expect(hasStopTable('su-shi', 'no-such-stop')).toBe(false);
    expect(hasStopTable('su-shi', 'xuzhou.terrain')).toBe(false);
  });

  it('说有的站，loadStopTable 读得出来（地形文件也在）', async () => {
    for (const { figureId, stopId } of scenesOnDisk) {
      expect(hasStopTable(figureId, stopId)).toBe(true);
      expect(await loadStopTable(figureId, stopId), `${figureId}/${stopId}`).not.toBeNull();
    }
  });
});

describe('loadStopTable', () => {
  it('徐州的沙盘读得出来：场景，和地形文件的网址', async () => {
    const table = await loadStopTable('su-shi', 'xuzhou');
    expect(table).not.toBeNull();
    expect(table?.scene.stopId).toBe('xuzhou');
    expect(table?.scene.sections.length).toBeGreaterThan(0);
    expect(table?.terrainUrl).toContain('xuzhou.terrain');
  });

  it('有场景文件的站，读出来的场景和文件里的一样，地形文件的网址不是空的', async () => {
    expect(scenesOnDisk.length).toBeGreaterThan(0);
    for (const { figureId, stopId, path } of scenesOnDisk) {
      const onDisk = json<StopScene>(path);
      const table = await loadStopTable(figureId, stopId);
      const terrainThere = paths.has(`${ROOT}/${figureId}/scenes/${onDisk.terrain.file}`);
      expect(table !== null, `${figureId}/${stopId}`).toBe(terrainThere);
      if (!table) continue;
      expect(table.scene).toEqual(onDisk);
      expect(typeof table.terrainUrl).toBe('string');
      expect(table.terrainUrl).not.toBe('');
    }
  });

  it('坐标读出来是两个数的数组', async () => {
    const table = await loadStopTable('su-shi', 'xuzhou');
    const center = table?.scene.frame.center;
    expect(center).toHaveLength(2);
    expect(center?.every((n) => typeof n === 'number')).toBe(true);
  });

  it('还没有场景文件的站返回 null', async () => {
    let without = 0;
    for (const figure of figuresOnDisk) {
      for (const stop of figure.stops) {
        if (paths.has(`${ROOT}/${figure.id}/scenes/${stop.id}.json`)) continue;
        expect(await loadStopTable(figure.id, stop.id), `${figure.id}/${stop.id}`).toBeNull();
        without += 1;
      }
    }
    expect(without, '至少要有一站还没有沙盘，这一条才测得到').toBeGreaterThan(0);
  });

  it('没有这位人物或没有这一站时返回 null', async () => {
    expect(await loadStopTable('no-such-figure', 'xuzhou')).toBeNull();
    expect(await loadStopTable('su-shi', 'no-such-stop')).toBeNull();
    // 地形文件不是场景。
    expect(await loadStopTable('su-shi', 'xuzhou.terrain')).toBeNull();
  });

  it('先画好的地面：磁盘上清单和两张图都在的沙盘带着 ground，和清单里写的一样；不齐的、还没做的不带', async () => {
    for (const { figureId, stopId } of scenesOnDisk) {
      const table = await loadStopTable(figureId, stopId);
      if (!table) continue;
      const dir = `${ROOT}/${figureId}/baked`;
      const manifest = paths.has(`${dir}/${stopId}.json`) ? json<BakedGroundManifest>(`${dir}/${stopId}.json`) : null;
      const there = manifest !== null && paths.has(`${dir}/${manifest.colour.file}`) && paths.has(`${dir}/${manifest.fields.file}`);
      expect(table.ground !== undefined, `${figureId}/${stopId}`).toBe(there);
      if (!table.ground || !manifest) continue;
      expect(table.ground).toEqual({ colourUrl: table.ground.colourUrl, fieldsUrl: table.ground.fieldsUrl, width: manifest.colour.width, height: manifest.colour.height, inputs: manifest.inputs });
      expect(table.ground.colourUrl).toContain(`${stopId}.colour`);
      expect(table.ground.fieldsUrl).toContain(`${stopId}.fields`);
    }
  });

  it('每一小节的定格图：磁盘上清单和它写的图都在的沙盘带着 stills，每张图一个网址；不齐的、还没做的不带', async () => {
    for (const { figureId, stopId } of scenesOnDisk) {
      const table = await loadStopTable(figureId, stopId);
      if (!table) continue;
      const dir = `${ROOT}/${figureId}/stills`;
      const manifest = paths.has(`${dir}/${stopId}.json`) ? json<StillManifest>(`${dir}/${stopId}.json`) : null;
      const there = manifest !== null && manifest.stills.length > 0 && manifest.stills.every((still) => paths.has(`${dir}/${still.file}`));
      expect(table.stills !== undefined, `${figureId}/${stopId}`).toBe(there);
      if (!table.stills || !manifest) continue;
      expect(table.stills.manifest).toEqual(manifest);
      expect(Object.keys(table.stills.urls).sort()).toEqual(manifest.stills.map((still) => still.file).sort());
      for (const [file, url] of Object.entries(table.stills.urls)) expect(url, file).toContain(file.replace(/\.[^.]+$/, ''));
    }
  });
});

describe('pickStopTable：地形文件不在时，这一站当作没有沙盘', () => {
  const scene = json<StopScene>(`${ROOT}/su-shi/scenes/xuzhou.json`);
  const scenes = { [`${ROOT}/su-shi/scenes/xuzhou.json`]: async () => scene };
  const terrains = { [`${ROOT}/su-shi/scenes/${scene.terrain.file}`]: async () => '/assets/xuzhou.terrain.bin' };

  it('场景和地形文件都在：读得出来', async () => {
    expect(await pickStopTable(scenes, terrains, 'su-shi', 'xuzhou')).toEqual({ scene, terrainUrl: '/assets/xuzhou.terrain.bin' });
  });

  it('场景在，它写的地形文件不在（没有这个文件，或者放在了别的名字、别的人物下面）：null', async () => {
    expect(await pickStopTable(scenes, {}, 'su-shi', 'xuzhou')).toBeNull();
    expect(await pickStopTable(scenes, { [`${ROOT}/su-shi/scenes/river.bin`]: async () => '/assets/river.bin' }, 'su-shi', 'xuzhou')).toBeNull();
    expect(await pickStopTable(scenes, { [`${ROOT}/other/scenes/${scene.terrain.file}`]: async () => '/assets/x.bin' }, 'su-shi', 'xuzhou')).toBeNull();
  });

  it('没有场景文件：null，地形文件在也不算', async () => {
    expect(await pickStopTable({}, terrains, 'su-shi', 'xuzhou')).toBeNull();
    expect(await pickStopTable(scenes, terrains, 'su-shi', 'huangzhou')).toBeNull();
  });
});

describe('pickStopTable：工具做出来的两样，在、不在、清单在而图不齐', () => {
  const scene = json<StopScene>(`${ROOT}/su-shi/scenes/xuzhou.json`);
  const scenes = { [`${ROOT}/su-shi/scenes/xuzhou.json`]: async () => scene };
  const terrains = { [`${ROOT}/su-shi/scenes/${scene.terrain.file}`]: async () => '/assets/xuzhou.terrain.bin' };
  const pick = (made?: MadeFiles) => pickStopTable(scenes, terrains, 'su-shi', 'xuzhou', made);

  // 先画好的地面：一份清单，两张图
  const BAKED = `${ROOT}/su-shi/baked`;
  const baked = (): BakedGroundManifest => ({
    tool: 1,
    inputs: { ground: '1111111111111111', terrain: '2222222222222222' },
    pixels: { colour: '3333333333333333', fields: '4444444444444444' },
    colour: { file: 'xuzhou.colour.jpg', width: 1171, height: 971, bytes: 279_735, key: '5555555555555555', quality: 0.95, psnr: 41.4 },
    fields: { file: 'xuzhou.fields.png', width: 1171, height: 971, bytes: 254_181, key: '6666666666666666' },
  });
  const bakedManifests = (manifest: BakedGroundManifest = baked()) => ({ [`${BAKED}/xuzhou.json`]: async () => manifest });
  const bakedUrls = { [`${BAKED}/xuzhou.colour.jpg`]: '/assets/xuzhou.colour-a1.jpg', [`${BAKED}/xuzhou.fields.png`]: '/assets/xuzhou.fields-b2.png' };
  const ground = { colourUrl: '/assets/xuzhou.colour-a1.jpg', fieldsUrl: '/assets/xuzhou.fields-b2.png', width: 1171, height: 971, inputs: { ground: '1111111111111111', terrain: '2222222222222222' } };

  // 每一小节的定格图：一份清单，这里只写两节、宽窄各一张
  const STILLS = `${ROOT}/su-shi/stills`;
  const still = (n: number, shape: StillShape): StillShot => ({
    section: scene.sections[n - 1].heading,
    shape,
    file: `xuzhou-${n}-${shape}.jpg`,
    width: shape === 'wide' ? 1800 : 1920,
    height: shape === 'wide' ? 1350 : 1146,
    bytes: 200_000,
    quality: 82,
    key: '7777777777777777',
    raw: '8888888888888888',
    pose: { target: [0, 0, 0], position: [0, 9000, 9000], fov: 21 },
    fit: 1,
    reach: [400, 300],
    northDeg: 0,
    pxPerMetre: 0.2,
    anchors: scene.sections[n - 1].strips.map((id, i) => ({ id, x: 0.3 + i * 0.05, y: 0.4, visible: true })),
  });
  const stills = (shots: StillShot[] = [still(1, 'wide'), still(2, 'wide'), still(1, 'narrow'), still(2, 'narrow')]): StillManifest => ({
    tool: 1,
    made: { tier: 'full', three: '0.187.0', background: '#e7dfcc', fitMarginPx: 24, maxFit: 2.5 },
    madeFrom: { scene: '9999999999999999', terrain: '2222222222222222', ground: 'aaaaaaaaaaaaaaaa', program: 'bbbbbbbbbbbbbbbb' },
    shapes: {
      wide: { window: [1440, 900], pane: [940, 900], insets: [62, 0, 130, 0], extra: 130, pixelRatio: 1.5 },
      narrow: { window: [768, 1024], pane: [768, 573], insets: [54, 0, 131, 0], extra: 96, pixelRatio: 2 },
    },
    stills: shots,
  });
  const stillManifests = (manifest: StillManifest = stills()) => ({ [`${STILLS}/xuzhou.json`]: async () => manifest });
  const stillUrls: Record<string, string> = {
    [`${STILLS}/xuzhou-1-wide.jpg`]: '/assets/xuzhou-1-wide-c3.jpg',
    [`${STILLS}/xuzhou-2-wide.jpg`]: '/assets/xuzhou-2-wide-d4.jpg',
    [`${STILLS}/xuzhou-1-narrow.jpg`]: '/assets/xuzhou-1-narrow-e5.jpg',
    [`${STILLS}/xuzhou-2-narrow.jpg`]: '/assets/xuzhou-2-narrow-f6.jpg',
    // 人物页的那一张也在同一张表里，不相干
    [`${STILLS}/route.jpg`]: '/assets/route-g7.jpg',
  };
  /** 去掉一项。 */
  const without = <T>(table: Record<string, T>, path: string): Record<string, T> => Object.fromEntries(Object.entries(table).filter(([key]) => key !== path));

  it('两样都没有：只有场景和地形文件的网址，没有 ground、stills 这两个字段', async () => {
    const table = await pick();
    expect(table).toEqual({ scene, terrainUrl: '/assets/xuzhou.terrain.bin' });
    expect(Object.keys(table ?? {}).sort()).toEqual(['scene', 'terrainUrl']);
    // 给了空的几张表也一样
    expect(Object.keys((await pick({ bakedManifests: {}, bakedUrls: {}, stillManifests: {}, stillUrls: {} })) ?? {}).sort()).toEqual(['scene', 'terrainUrl']);
  });

  it('先画好的地面在：带上两张图的网址、宽高，和这两张图是照什么画的', async () => {
    const table = await pick({ bakedManifests: bakedManifests(), bakedUrls });
    expect(table?.ground).toEqual(ground);
    expect(table?.stills).toBeUndefined();
    expect(table?.scene).toBe(scene);
  });

  it('清单在，它写的图不在（一张不在、两张都不在、放在了别的人物下面）：不带 ground', async () => {
    expect((await pick({ bakedManifests: bakedManifests(), bakedUrls: without(bakedUrls, `${BAKED}/xuzhou.colour.jpg`) }))?.ground).toBeUndefined();
    expect((await pick({ bakedManifests: bakedManifests(), bakedUrls: without(bakedUrls, `${BAKED}/xuzhou.fields.png`) }))?.ground).toBeUndefined();
    expect((await pick({ bakedManifests: bakedManifests(), bakedUrls: {} }))?.ground).toBeUndefined();
    expect((await pick({ bakedManifests: bakedManifests() }))?.ground).toBeUndefined();
    const elsewhere = { [`${ROOT}/other/baked/xuzhou.colour.jpg`]: '/assets/c.jpg', [`${ROOT}/other/baked/xuzhou.fields.png`]: '/assets/f.png' };
    expect((await pick({ bakedManifests: bakedManifests(), bakedUrls: elsewhere }))?.ground).toBeUndefined();
  });

  it('图在，清单不在（或者是别的站的清单）：不带 ground', async () => {
    expect((await pick({ bakedUrls }))?.ground).toBeUndefined();
    expect((await pick({ bakedManifests: { [`${BAKED}/huangzhou.json`]: async () => baked() }, bakedUrls }))?.ground).toBeUndefined();
  });

  it('清单里两张图不一样大：不带 ground', async () => {
    const manifest = baked();
    manifest.fields.width = 586;
    expect((await pick({ bakedManifests: bakedManifests(manifest), bakedUrls }))?.ground).toBeUndefined();
  });

  it('清单读不出来：当作没有，沙盘照样读得出来，只在控制台里说一句', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const broken = { [`${BAKED}/xuzhou.json`]: async (): Promise<BakedGroundManifest> => Promise.reject(new Error('读不出来')) };
      const table = await pick({ bakedManifests: broken, bakedUrls, stillManifests: stillManifests(), stillUrls });
      expect(table?.scene).toBe(scene);
      expect(table?.ground).toBeUndefined();
      expect(table?.stills).toBeDefined();
      expect(warn).toHaveBeenCalledTimes(1);
      // 清单的样子不对（缺了一块）也一样
      const halfWritten = { [`${BAKED}/xuzhou.json`]: async () => ({ tool: 1 }) as unknown as BakedGroundManifest };
      expect((await pick({ bakedManifests: halfWritten, bakedUrls }))?.ground).toBeUndefined();
      const badStills = { [`${STILLS}/xuzhou.json`]: async (): Promise<StillManifest> => Promise.reject(new Error('读不出来')) };
      const other = await pick({ bakedManifests: bakedManifests(), bakedUrls, stillManifests: badStills, stillUrls });
      expect(other?.ground).toEqual(ground);
      expect(other?.stills).toBeUndefined();
      expect(warn).toHaveBeenCalledTimes(3);
    } finally {
      warn.mockRestore();
    }
  });

  it('定格图在：带上清单，和清单里每一张图的网址（键是清单里的文件名）', async () => {
    const manifest = stills();
    const table = await pick({ stillManifests: stillManifests(manifest), stillUrls });
    expect(table?.stills?.manifest).toBe(manifest);
    expect(table?.stills?.urls).toEqual({
      'xuzhou-1-wide.jpg': '/assets/xuzhou-1-wide-c3.jpg',
      'xuzhou-2-wide.jpg': '/assets/xuzhou-2-wide-d4.jpg',
      'xuzhou-1-narrow.jpg': '/assets/xuzhou-1-narrow-e5.jpg',
      'xuzhou-2-narrow.jpg': '/assets/xuzhou-2-narrow-f6.jpg',
    });
    expect(table?.ground).toBeUndefined();
  });

  it('两样都在：都带上', async () => {
    const table = await pick({ bakedManifests: bakedManifests(), bakedUrls, stillManifests: stillManifests(), stillUrls });
    expect(table?.ground).toEqual(ground);
    expect(Object.keys(table?.stills?.urls ?? {})).toHaveLength(4);
    expect(Object.keys(table ?? {}).sort()).toEqual(['ground', 'scene', 'stills', 'terrainUrl']);
  });

  it('清单在，少一张图：整座沙盘当作没有定格图（不拿半套去用）', async () => {
    expect((await pick({ stillManifests: stillManifests(), stillUrls: without(stillUrls, `${STILLS}/xuzhou-2-narrow.jpg`) }))?.stills).toBeUndefined();
    expect((await pick({ stillManifests: stillManifests(), stillUrls: {} }))?.stills).toBeUndefined();
    expect((await pick({ stillManifests: stillManifests() }))?.stills).toBeUndefined();
    // 清单里的文件名带了文件夹，对不上 stills/ 里的图
    const moved = stills();
    moved.stills[0].file = '../images/xuzhou-1-wide.jpg';
    expect((await pick({ stillManifests: stillManifests(moved), stillUrls }))?.stills).toBeUndefined();
  });

  it('图在，清单不在；清单里一张图也没有：不带 stills', async () => {
    expect((await pick({ stillUrls }))?.stills).toBeUndefined();
    expect((await pick({ stillManifests: stillManifests(stills([])), stillUrls }))?.stills).toBeUndefined();
    expect((await pick({ stillManifests: { [`${STILLS}/huangzhou.json`]: async () => stills() }, stillUrls }))?.stills).toBeUndefined();
  });

  it('场景或地形文件不在时还是 null，工具做的两样在也不算', async () => {
    const made = { bakedManifests: bakedManifests(), bakedUrls, stillManifests: stillManifests(), stillUrls };
    expect(await pickStopTable({}, terrains, 'su-shi', 'xuzhou', made)).toBeNull();
    expect(await pickStopTable(scenes, {}, 'su-shi', 'xuzhou', made)).toBeNull();
  });
});

describe('loadRouteStill', () => {
  /** 一位只有抬头的人物，routeStill 另给。 */
  const figureWith = (id: string, routeStill?: Figure['routeStill']): Figure => ({
    id,
    name: '某人',
    era: '某代',
    years: '1000–1060',
    tagline: '',
    intro: [],
    overview: { center: [110, 30], distanceKm: 1000 },
    stops: [],
    legs: [],
    ...(routeStill ? { routeStill } : {}),
  });
  const words = { width: 1404, height: 1171, alt: '一句给看不见图的人的话', caption: '图下面的题记', note: '如实的说明', credit: '用了谁的数据' };

  it('figure.json 没有写 routeStill 时返回 null', async () => {
    expect(await loadRouteStill(figureWith('su-shi'))).toBeNull();
  });

  it('写了 routeStill、图片文件却不在 stills/ 里时返回 null', async () => {
    expect(await loadRouteStill(figureWith('su-shi', { file: 'no-such-picture.jpg', ...words }))).toBeNull();
    expect(await loadRouteStill(figureWith('no-such-figure', { file: 'route.jpg', ...words }))).toBeNull();
    // 别的文件夹里的图不算。
    expect(await loadRouteStill(figureWith('su-shi', { file: '../images/no-such-picture.jpg', ...words }))).toBeNull();
  });

  it('磁盘上的每位人物：写了 routeStill 而且图片在，就读得出网址和图旁边的字；不然是 null', async () => {
    expect(figuresOnDisk.length).toBeGreaterThan(0);
    for (const figure of figuresOnDisk) {
      const still = await loadRouteStill(figure);
      const written = figure.routeStill;
      const there = written !== undefined && paths.has(`${ROOT}/${figure.id}/stills/${written.file}`);
      expect(still !== null, figure.id).toBe(there);
      if (!still || !written) continue;
      expect(still.url).not.toBe('');
      expect(still).toEqual({ url: still.url, width: written.width, height: written.height, alt: written.alt, caption: written.caption, note: written.note, credit: written.credit });
      expect(still.width).toBeGreaterThan(0);
      expect(still.height).toBeGreaterThan(0);
    }
  });

  it('stills/ 里有的图片都读得出网址，图旁边的字原样带出来；每一站定格图的清单不是图片，读不出来', async () => {
    // 现在 stills/ 里要是还没有图片，这一条就只是空转；有了图片以后它才真的在查。
    let pictures = 0;
    for (const path of paths) {
      const match = /^\/content\/figures\/([^/]+)\/stills\/([^/]+)$/.exec(path);
      if (!match) continue;
      const still = await loadRouteStill(figureWith(match[1], { file: match[2], ...words }));
      if (/\.json$/.test(match[2])) {
        expect(still, path).toBeNull();
        continue;
      }
      pictures += 1;
      expect(still, path).not.toBeNull();
      expect(still?.url).toContain(match[2].replace(/\.[^.]+$/, ''));
      expect(still).toMatchObject(words);
    }
    expect(pictures, '苏轼的 stills/ 里至少有人物页的那一张').toBeGreaterThan(0);
  });
});
