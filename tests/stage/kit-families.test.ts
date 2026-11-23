// 按家分块的零件（src/stage/families.ts 的登记表，src/stage/three/kit/families.ts 的规矩）和地形板的高度（src/stage/three/meshHeight.ts）。
// 查的是：登记表里每一家管的东西在零件的表里都有、它的程序里也真的有；场景里写到了哪一家才取哪一家，一样也没写到的沙盘（徐州）一家也不取；
// 那一家没有取到的时候，造模型会说清楚缺的是哪一种，不是悄悄造错；地形板的高度和地形板自己的顶点是同一个数。
// 构建出来各块多大、哪座沙盘下载哪几块，在 tests/build/dist-size.test.ts。

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { DRESSING_PARAMS, FAMILY_THING_KINDS, THING_KINDS } from '../../src/domain/sceneKinds';
import type { StopScene } from '../../src/domain/scene';
import { FAMILIES } from '../../src/stage/families';
import { groundPictureSize } from '../../src/stage/three/groundPaint';
import type { GroundPaintSource } from '../../src/stage/three/groundPaint';
import type { KitContext } from '../../src/stage/three/internal';
import { buildModels } from '../../src/stage/three/kit';
import { familiesOf, loadFamilies, provideFamilies } from '../../src/stage/three/kit/families';
import type { FamilyEntry } from '../../src/stage/three/kit/families';
import { THING_BUILDERS } from '../../src/stage/three/kit/things';
import { meshHeightAt, terrainGrid, vertexHeightM } from '../../src/stage/three/meshHeight';
import { FULL_QUALITY } from '../../src/stage/three/quality';
import { styleFor } from '../../src/stage/three/style';
import { buildTerrainMesh } from '../../src/stage/three/terrainMesh';
import { fakeDocument } from './support/fakeRenderer';
import { familyNamesFor } from './support/kitFamilies';
import { realScene, realSceneKeys } from './support/realScenes';

describe('按家分块的零件：登记表', () => {
  it('每一家管的东西在零件的表里都有；一样东西只归一家；摆件里按家分块的那几种正好是登记表里的', () => {
    const held = FAMILIES.flatMap((family) => family.holds);
    expect(new Set(held).size).toBe(held.length);
    expect(new Set(FAMILIES.map((family) => family.name)).size).toBe(FAMILIES.length);
    const things = held.filter((name) => !name.includes(':'));
    expect(things.sort()).toEqual([...FAMILY_THING_KINDS].sort());
    for (const kind of things) expect(THING_KINDS as readonly string[]).toContain(kind);
    for (const name of held.filter((n) => n.includes(':'))) {
      const [kind, type] = name.split(':');
      expect(['trees', 'rocks']).toContain(kind);
      expect(DRESSING_PARAMS[kind as 'trees' | 'rocks'].type as readonly string[]).toContain(type);
    }
    // 沙盘程序自己带着的造法里没有它们
    for (const kind of things) expect(Object.keys(THING_BUILDERS)).not.toContain(kind);
  });

  it('每一家的程序里真的有登记表说它管的每一样，不多也不少', async () => {
    for (const entry of FAMILIES) {
      const { family } = await entry.load();
      const has = [...Object.keys(family.things ?? {}), ...Object.keys(family.trees ?? {}).map((type) => `trees:${type}`), ...Object.keys(family.rocks ?? {}).map((type) => `rocks:${type}`)];
      expect(has.sort(), entry.name).toEqual([...entry.holds].sort());
    }
  });

  it('现在是两家：石和土（崖壁、崖脚的石头），草木（竹、柏）', () => {
    expect(FAMILIES.map((family) => [family.name, [...family.holds]])).toEqual([
      ['rock', ['cliff', 'rocks:shore']],
      ['plants', ['trees:bamboo', 'trees:cypress']],
    ]);
  });
});

describe('按家分块的零件：哪座沙盘取哪几家', () => {
  it('徐州一家也不取；黄州取两家', () => {
    expect(familyNamesFor(realScene('su-shi/xuzhou').scene)).toEqual([]);
    expect(familyNamesFor(realScene('su-shi/huangzhou').scene)).toEqual(['rock', 'plants']);
    // content/ 里别的站点沙盘，登记表里没有的家一概不会冒出来
    for (const key of realSceneKeys()) for (const name of familyNamesFor(realScene(key).scene)) expect(FAMILIES.map((f) => f.name)).toContain(name);
  });

  it('场景里没写到的那一家，它的程序一次也不取（数取的次数）', async () => {
    const calls: string[] = [];
    const counted: FamilyEntry[] = FAMILIES.map((entry) => ({
      ...entry,
      load: () => {
        calls.push(entry.name);
        return entry.load();
      },
    }));
    const xuzhou = realScene('su-shi/xuzhou').scene;
    expect(familiesOf(xuzhou, counted)).toEqual([]);
    await loadFamilies(familiesOf(xuzhou, counted));
    expect(calls).toEqual([]);
    // 只写了竹的沙盘：只取草木那一家
    const onlyBamboo: StopScene = { ...xuzhou, dressing: [...xuzhou.dressing, { id: 'b', name: '竹', kind: 'trees', at: xuzhou.sections[0].camera.target, params: { type: 'bamboo' }, class: 'dressing', basis: '测试里添的。', sourceIds: [] }] };
    const kit = await loadFamilies(familiesOf(onlyBamboo, counted));
    expect(calls).toEqual(['plants']);
    expect(Object.keys(kit.trees ?? {})).toEqual(['bamboo', 'cypress']);
    expect(kit.things).toEqual({});
    // 交进去的登记表（页面上是 src/stage/index.ts 交的）就是不写 list 时用的那一张
    provideFamilies(counted);
    expect(familiesOf(onlyBamboo).map((f) => f.name)).toEqual(['plants']);
    provideFamilies([]);
    expect(familiesOf(onlyBamboo)).toEqual([]);
  });

  it('那一家没有取到（kit 没有交）：造黄州的模型会说缺的是哪一种，不是悄悄造错', () => {
    const R = realScene('su-shi/huangzhou');
    const { scene, ground, samplers, coords } = R;
    const ctx: KitContext = { scene, ground, samplers, coords, style: styleFor(scene.style), quality: FULL_QUALITY };
    const models = buildModels(ctx);
    expect(() => models.apply(R.headings[0], scene.water.levels.values.normal, 9000)).toThrow(/cliff|bamboo|cypress|shore/);
    models.dispose();
    // 交了就造得出来
    const made = buildModels({ ...ctx, kit: R.kit });
    made.apply(R.headings[0], scene.water.levels.values.normal, 9000);
    expect(made.triangles()).toBeGreaterThan(1000);
    made.dispose();
  });
});

describe('地形板的高度（meshHeight.ts）', () => {
  beforeAll(() => {
    // 地形板四边切面的贴图是画在页面的画布上的：给一个假的页面
    vi.stubGlobal('document', fakeDocument());
  });
  afterAll(() => {
    vi.unstubAllGlobals();
  });

  it.each(['su-shi/xuzhou', 'su-shi/huangzhou'])('%s：在每个顶点上就是地形板那个顶点的高度；在别处落在它那个三角形三个顶点的高度之间', (key) => {
    const R = realScene(key);
    const { coords, samplers } = R;
    const { sx, sz } = terrainGrid(coords);
    const W = coords.x1 - coords.x0;
    const D = coords.z1 - coords.z0;
    const at = meshHeightAt(samplers, coords);
    // 顶点
    let worst = 0;
    for (let j = 0; j <= sz; j += 3) {
      for (let i = 0; i <= sx; i += 3) {
        const x = coords.x0 + (i / sx) * W;
        const z = coords.z0 + (j / sz) * D;
        worst = Math.max(worst, Math.abs(at(x, z) - vertexHeightM(samplers, x, z)));
      }
    }
    expect(worst).toBeLessThan(1e-6);
    // 别处：200 个点（固定的一串数）
    let seed = 12345;
    const rnd = (): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    for (let n = 0; n < 200; n++) {
      const fx = rnd() * sx;
      const fz = rnd() * sz;
      const i = Math.min(sx - 1, Math.floor(fx));
      const j = Math.min(sz - 1, Math.floor(fz));
      const corner = (di: number, dj: number): number => vertexHeightM(samplers, coords.x0 + ((i + di) / sx) * W, coords.z0 + ((j + dj) / sz) * D);
      const upper = fx - i + (fz - j) <= 1;
      const three = upper ? [corner(0, 0), corner(1, 0), corner(0, 1)] : [corner(1, 1), corner(1, 0), corner(0, 1)];
      const h = at(coords.x0 + (fx / sx) * W, coords.z0 + (fz / sz) * D);
      expect(h).toBeGreaterThanOrEqual(Math.min(...three) - 1e-9);
      expect(h).toBeLessThanOrEqual(Math.max(...three) + 1e-9);
    }
  });

  it('徐州：地形板自己的顶点就是这里算的数（地形板从这里取，一个不差）', () => {
    const R = realScene('su-shi/xuzhou');
    const { coords, samplers, ground, scene } = R;
    const style = styleFor(scene.style);
    const { w, h } = groundPictureSize(ground);
    const paint: GroundPaintSource = { kind: 'live', colour: new Uint8Array(w * h * 4), w, h, normals: new Uint8Array(ground.nx * ground.nz * 4) };
    const terrain = buildTerrainMesh({ samplers, paint, nx: ground.nx, nz: ground.nz, coords, style, maxAnisotropy: 1 });
    const { sx, sz } = terrainGrid(coords);
    let top: Float32Array | null = null;
    terrain.group.traverse((o) => {
      const m = o as { isMesh?: boolean; geometry?: { attributes: { position: { array: Float32Array; count: number } } } };
      if (m.isMesh && m.geometry && m.geometry.attributes.position.count === (sx + 1) * (sz + 1)) top = m.geometry.attributes.position.array;
    });
    if (!top) throw new Error('没有找到地形板的上表面');
    const pos: Float32Array = top;
    const W = coords.x1 - coords.x0;
    const D = coords.z1 - coords.z0;
    for (let j = 0; j <= sz; j += 5) {
      for (let i = 0; i <= sx; i += 5) {
        const k = j * (sx + 1) + i;
        const x = coords.x0 + (i / sx) * W;
        const z = coords.z0 + (j / sz) * D;
        expect(pos[k * 3 + 1]).toBe(Math.fround(coords.y(vertexHeightM(samplers, x, z))));
      }
    }
    terrain.dispose();
  });
});
