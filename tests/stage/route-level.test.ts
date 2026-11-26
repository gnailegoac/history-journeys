// 全程沙盘才用的那一块程序（src/stage/three/routeLevel.ts）和地形板为它添的三样（src/stage/three/terrainMesh.ts）。
// 在 Node 里跑，不要浏览器。数都从真的函数、真的场景文件读，不在这里另写一份。
//   先画好的地面怎么取：记号对得上就用；对不上照样用，在控制台里说一句；没有、取不到、大小不对就拒绝（全程沙盘不现画）。
//   两个替身：水面的替身把“水纹怎么摆”“画布的像素比”转给地面的材质；云气的替身什么也不做；路从这一块里转出去（路自己的测试在 route-kit.test.ts）。
//   地形板：网格的疏密照样式（苏轼的那一座完整 198 × 224，减配粗 1.07 倍）；顶点不取附近的最低值；第二张图标的是水纹，着色器换了一段。
//   站点沙盘的地形板一个字也没有变（不传那三样时）。
// 分两组：content/ 里有几座全程沙盘，“每一座”那一组就查几座，查的是哪一座都该有的事；
// 一座沙盘自己的数（多少格、多少点、多少个三角形）在写着它名字的那一组里（现在只有 su-shi/route）。添一位人物，不许拿他的沙盘去对苏轼的数。

import { Mesh, ShaderLib, UniformsUtils, type IUniform, type Material, type Vector2 } from 'three';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { ROUTE_POINTS_PER_CELL, routeNormals, routePictureSize } from '../../src/stage/ground/route';
import type { GroundPaintSource } from '../../src/stage/three/groundPaint';
import { buildRouteModels as kitRoads } from '../../src/stage/three/routeKit';
import { buildRouteModels, routeGroundInputs, routeGroundPaint, routeMist, routeWater } from '../../src/stage/three/routeLevel';
import { styleFor } from './support/styles';
import { buildTerrainMesh, terrainGrid } from '../../src/stage/three/terrainMesh';
import { rippleGlsl } from '../../src/stage/three/water';
import type { RouteTable } from '../../src/stage/types';
import { readBytes } from '../support/readBytes';
import { fakeDocument } from './support/fakeRenderer';
import { realRouteScene, realScene, realSceneKeys } from './support/realScenes';

const keys = realSceneKeys('route');

beforeAll(() => {
  vi.stubGlobal('document', fakeDocument());
});
afterAll(() => {
  vi.unstubAllGlobals();
});
afterEach(() => {
  vi.restoreAllMocks();
});

/** 地形板上表面的着色器编译以前的样子：照 three 自己的做法，把 Lambert 的那一套交给 onBeforeCompile。 */
function compiled(material: Material): { vertexShader: string; fragmentShader: string; uniforms: Record<string, IUniform> } {
  const lib = ShaderLib.lambert;
  const shader = { name: material.type, uniforms: UniformsUtils.clone(lib.uniforms), vertexShader: lib.vertexShader, fragmentShader: lib.fragmentShader };
  (material.onBeforeCompile as (parameters: unknown, renderer: unknown) => void)(shader, null);
  return shader as { vertexShader: string; fragmentShader: string; uniforms: Record<string, IUniform> };
}

it('content/ 里有一座全程沙盘', () => {
  expect(keys.length).toBeGreaterThan(0);
});

describe.each(keys)('%s', (key) => {
  const R = realRouteScene(key);
  const [figure] = key.split('/');
  const terrainBytes = readBytes(`content/figures/${figure}/scenes/${R.scene.terrain.file}`);
  const size = routePictureSize(R.ground);
  const inputs = routeGroundInputs(R.scene, terrainBytes);
  /** 假的图片：只有大小。 */
  const picture = (w: number, h: number): TexImageSource => ({ width: w, height: h }) as unknown as TexImageSource;
  const table = (ground?: RouteTable['ground']): RouteTable => ({ kind: 'route', key, scene: R.scene, terrainUrl: 'route.terrain.bin', ...(ground ? { ground } : {}) });
  const baked = (change: Partial<NonNullable<RouteTable['ground']>> = {}): NonNullable<RouteTable['ground']> => ({ colourUrl: 'c.jpg', fieldsUrl: 'f.png', width: size.w, height: size.h, inputs, ...change });
  const live = new AbortController().signal;

  describe('先画好的地面', () => {
    it('图多大：地面的一格三个点，两头的格点各占一个点（这一座自己是多少格、多少点，写着名字的那一组查）', () => {
      expect(ROUTE_POINTS_PER_CELL).toBe(3);
      expect(size).toEqual({ w: (R.ground.nx - 1) * ROUTE_POINTS_PER_CELL + 1, h: (R.ground.nz - 1) * ROUTE_POINTS_PER_CELL + 1 });
    });

    it('记号、大小都对得上：用这两张图，法线照地面现算；两张图是一开始就一起取的', async () => {
      const asked: string[] = [];
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const job = routeGroundPaint(table(baked()), live, (url) => {
        asked.push(url);
        return Promise.resolve(picture(size.w, size.h));
      });
      // 还没有叫 finish，两张图已经在取了
      expect(asked).toEqual(['c.jpg', 'f.png']);
      const source = await job.finish(R.scene, R.ground, terrainBytes);
      expect(source.kind).toBe('baked');
      expect([source.w, source.h]).toEqual([size.w, size.h]);
      expect(source.normals).toEqual(routeNormals(R.ground));
      expect(source.normals.length).toBe(R.ground.nx * R.ground.nz * 4);
      expect(warn).not.toHaveBeenCalled();
    });

    it('图是照旧的场景或者旧的地形文件画的：照样用，在控制台里说一句该跑哪条命令', async () => {
      for (const stale of [{ ...inputs, ground: '0000000000000000' }, { ...inputs, terrain: '0000000000000000' }]) {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const job = routeGroundPaint(table(baked({ inputs: stale })), live, () => Promise.resolve(picture(size.w, size.h)));
        expect((await job.finish(R.scene, R.ground, terrainBytes)).kind).toBe('baked');
        expect(warn).toHaveBeenCalledTimes(1);
        expect(String(warn.mock.calls[0][0])).toContain('全程沙盘先画好的地面是旧的');
        expect(String(warn.mock.calls[0][0])).toContain('npm run bake');
        warn.mockRestore();
      }
    });

    it('没有先画好的地面、图取不到、清单写的大小不对、图自己的大小不对：都拒绝，不现画', async () => {
      await expect(routeGroundPaint(table(), live).finish(R.scene, R.ground, terrainBytes)).rejects.toThrow('还没有先画好的地面');
      const gone = routeGroundPaint(table(baked()), live, () => Promise.reject(new Error('图片取不到（c.jpg）')));
      await expect(gone.finish(R.scene, R.ground, terrainBytes)).rejects.toThrow('图片取不到');
      const listed = routeGroundPaint(table(baked({ width: size.w - 1 })), live, () => Promise.resolve(picture(size.w, size.h)));
      await expect(listed.finish(R.scene, R.ground, terrainBytes)).rejects.toThrow(`应该是 ${size.w} × ${size.h}`);
      const wrong = routeGroundPaint(table(baked()), live, (url) => Promise.resolve(url === 'f.png' ? picture(size.w, size.h - 3) : picture(size.w, size.h)));
      await expect(wrong.finish(R.scene, R.ground, terrainBytes)).rejects.toThrow(`图是 ${size.w} × ${size.h - 3}`);
    });

    it('记号：改一句依据、一个镜头、一条路不变；挪一条河、改一个抹成海的圈、换地形文件的一个字节都变（这一座没有自己写了线的河、没有抹成海的圈，就先给它添一条、添一圈再挪）', () => {
      const copy = (): typeof R.scene => JSON.parse(JSON.stringify(R.scene)) as typeof R.scene;
      // 哪一座全程沙盘都有海岸、整理地形的办法、头一节和至少一截路（规矩里要的）；河、自己写了线的河、抹成海的圈，规矩不要求有
      const words = copy();
      words.water.coast.basis = '换了一句依据。';
      for (const first of words.water.rivers.slice(0, 1)) first.basis = '换了一句依据。';
      words.terrain.recipe.note = '换了一句说明。';
      words.sections[0].camera.distanceM += 500;
      words.roads.ways[0].line[0] = [words.roads.ways[0].line[0][0] + 0.01, words.roads.ways[0].line[0][1]];
      expect(routeGroundInputs(words, terrainBytes)).toEqual(inputs);

      // 挪一条自己写了线的河。这一座没有的（河都照今天的数据画，或者一条河也没有），添一条编的：添了，记号变；再挪它一个点，又变
      const [lng, lat] = R.scene.frame.center;
      const river = copy();
      let riverWas = inputs.ground;
      if (!river.water.rivers.some((item) => item.line)) {
        river.water.rivers.push({
          id: 'made-up-river',
          name: '编的一条河',
          kind: 'river',
          weight: 'minor',
          line: [[lng, lat], [lng + 0.2, lat], [lng + 0.4, lat + 0.1]],
          class: 'schematic',
          basis: '编的。',
          sourceIds: [],
        });
        riverWas = routeGroundInputs(river, terrainBytes).ground;
        expect(riverWas, '添了一条河').not.toBe(inputs.ground);
      }
      const written = river.water.rivers.find((item) => item.line);
      if (!written?.line) throw new Error('添了也没有自己写了线的河');
      written.line[1] = [written.line[1][0] + 0.01, written.line[1][1]];
      expect(routeGroundInputs(river, terrainBytes).ground).not.toBe(riverWas);
      expect(routeGroundInputs(river, terrainBytes).ground).not.toBe(inputs.ground);

      // 改一个抹成海的圈。这一座没有的（海岸照今天的画），添一圈编的：添了，记号变；再挪它一个点，又变
      const ring = copy();
      let ringWas = inputs.ground;
      if (ring.terrain.edits.length === 0) {
        ring.terrain.edits.push({
          id: 'made-up-sea',
          name: '编的一圈',
          op: 'sea',
          area: [[lng, lat], [lng + 0.3, lat], [lng + 0.3, lat + 0.3]],
          class: 'schematic',
          basis: '编的。',
          sourceIds: [],
        });
        ringWas = routeGroundInputs(ring, terrainBytes).ground;
        expect(ringWas, '添了一圈').not.toBe(inputs.ground);
      }
      ring.terrain.edits[0].area[0] = [ring.terrain.edits[0].area[0][0] + 0.01, ring.terrain.edits[0].area[0][1]];
      expect(routeGroundInputs(ring, terrainBytes).ground).not.toBe(ringWas);
      expect(routeGroundInputs(ring, terrainBytes).ground).not.toBe(inputs.ground);

      const bytes = terrainBytes.slice(0);
      new Uint8Array(bytes)[10] ^= 1;
      const changed = routeGroundInputs(R.scene, bytes);
      expect(changed.ground).toBe(inputs.ground);
      expect(changed.terrain).not.toBe(inputs.terrain);
    });
  });

  describe('地形板', () => {
    const style = styleFor(R.scene.style);
    const route = style.route;
    if (!route) throw new Error('样式里没有全程沙盘的那一份');
    const blank = (): GroundPaintSource => ({ kind: 'live', colour: new Uint8Array(4), w: 1, h: 1, normals: new Uint8Array(R.ground.nx * R.ground.nz * 4) });
    const build = (tier: 'full' | 'reduced', extra: Partial<Parameters<typeof buildTerrainMesh>[0]> = {}) =>
      buildTerrainMesh({
        samplers: R.samplers,
        paint: blank(),
        nx: R.ground.nx,
        nz: R.ground.nz,
        coords: R.coords,
        style,
        maxAnisotropy: 8,
        marks: 'ripples',
        underWater: false,
        segmentM: route.segmentM * (tier === 'reduced' ? route.reducedSegmentTimes : 1),
        ripplePx: route.ripplePx,
        ...extra,
      });
    const triangles = (mesh: Mesh): number => (mesh.geometry.getIndex()?.count ?? 0) / 3;

    it('网格：两档各照样式里写的疏密分格，上表面一格两个三角形，四边一段四个；减配的三角形少，可少得不到两成（这一座自己分成多少格，写着名字的那一组查）', { timeout: 30_000 }, () => {
      const full = terrainGrid(R.coords, route.segmentM);
      const reduced = terrainGrid(R.coords, route.segmentM * route.reducedSegmentTimes);
      const a = build('full');
      const b = build('reduced');
      const top = [triangles(a.top), triangles(b.top)];
      const sides = [triangles(a.sides), triangles(b.sides)];
      expect(top).toEqual([full.sx * full.sz * 2, reduced.sx * reduced.sz * 2]);
      expect(sides).toEqual([(full.sx + full.sz) * 4, (reduced.sx + reduced.sz) * 4]);
      console.log(`[全程沙盘的地形板] ${key}：完整 ${full.sx} × ${full.sz} 格，${top[0] + sides[0]} 个三角形（上表面 ${top[0]}，四边 ${sides[0]}）；减配 ${reduced.sx} × ${reduced.sz} 格，${top[1] + sides[1]} 个`);
      expect(top[1]).toBeLessThan(top[0]);
      expect(top[1] / top[0]).toBeGreaterThan(0.8);
      a.dispose();
      b.dispose();
    });

    it('顶点就是那一点的地面高，不取附近的最低值：最高的顶点和地面上最高的一格差不到一成', { timeout: 30_000 }, () => {
      const here = build('full');
      const lowered = build('full', { underWater: undefined });
      const topOf = (mesh: Mesh): number => {
        const pos = mesh.geometry.getAttribute('position');
        let top = -Infinity;
        for (let i = 0; i < pos.count; i++) top = Math.max(top, pos.getY(i));
        return top;
      };
      let ground = -Infinity;
      for (const y of R.ground.y) ground = Math.max(ground, y);
      const exact = topOf(here.top);
      // 网格比地面粗，顶点不一定正落在最高的那一格上：差不到一成；取了最低值的那一份矮得多
      expect(exact).toBeLessThanOrEqual(ground + 1e-6);
      expect(exact).toBeGreaterThan(ground * 0.9);
      expect(topOf(lowered.top)).toBeLessThan(exact);
      // 每个顶点的高就是 coords.y(那一点的海拔)。抽四个顶点查；网格小、没有那么多顶点的沙盘上，没有的那一个不查
      const pos = here.top.geometry.getAttribute('position');
      for (const i of [0, 1234, 20_000, pos.count - 1].filter((index) => index < pos.count)) {
        expect(pos.getY(i)).toBeCloseTo(R.coords.y(R.samplers.height(pos.getX(i), pos.getZ(i))), 3);
      }
      here.dispose();
      lowered.dispose();
    });

    it('着色器：第二张图标的是水纹，用的是水面那几个函数；没有田的那一段；四个 uniform 挂在材质上', { timeout: 30_000 }, () => {
      const mesh = build('full');
      const shader = compiled(mesh.top.material as Material);
      expect(shader.fragmentShader).toContain(rippleGlsl(route.ripplePx));
      expect(shader.fragmentShader).toContain('diffuseColor.rgb *= mix(texel.rgb, uFoam, ripples(vWPos.xz) * texture2D(uFields, vMapUv).r * 0.66);');
      expect(shader.fragmentShader).not.toContain('fieldPaint');
      expect(shader.fragmentShader).not.toContain('#include <map_fragment>');
      expect(shader.vertexShader).toContain('vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      // 量像素的两处都乘着画布的像素比，没有不乘的
      const count = (text: string, piece: string): number => text.split(piece).length - 1;
      expect(count(shader.fragmentShader, 'fwidth(')).toBe(3);
      expect(count(shader.fragmentShader, '* uPx;')).toBe(2);
      for (const name of ['uFields', 'uFoam', 'uTime', 'uDense', 'uRipRot', 'uPx']) {
        expect(mesh.uniforms[name], name).toBeDefined();
        expect(shader.uniforms[name], `${name} 交给了着色器`).toBe(mesh.uniforms[name]);
      }
      mesh.dispose();
    });

    it('水面的替身把“水纹怎么摆”“画布的像素比”转给地面的材质；云气的替身什么也不画；路就是 routeKit.ts 的那一个函数', { timeout: 30_000 }, () => {
      const mesh = build('full');
      const water = routeWater(mesh.uniforms);
      expect(mesh.uniforms.uDense.value).toBe(0.5);
      expect(mesh.uniforms.uPx.value).toBe(1);
      water.setRipple(0.3, 90);
      expect(mesh.uniforms.uDense.value).toBe(0.3);
      const rot = mesh.uniforms.uRipRot.value as Vector2;
      expect(rot.x).toBeCloseTo(0, 9);
      expect(rot.y).toBeCloseTo(1, 9);
      water.setPixelRatio(1.5);
      expect(mesh.uniforms.uPx.value).toBe(1.5);
      water.setPixelRatio(0);
      expect(mesh.uniforms.uPx.value).toBe(1);
      water.setLevel(12);
      water.setFlood(1);
      expect(water.group.children).toHaveLength(0);
      const mist = routeMist();
      mist.setFlood(1);
      mist.setStrength(0.4);
      expect(mist.group.children).toHaveLength(0);
      expect(buildRouteModels).toBe(kitRoads);
      mesh.dispose();
    });
  });
});

// ---------------------------------------------------------------- 苏轼的这一座自己的数

describe('su-shi/route：苏轼这一座自己的数', () => {
  const R = realRouteScene('su-shi/route');
  const route = styleFor(R.scene.style).route;
  if (!route) throw new Error('样式里没有全程沙盘的那一份');
  const triangles = (mesh: Mesh): number => (mesh.geometry.getIndex()?.count ?? 0) / 3;
  const build = (tier: 'full' | 'reduced') =>
    buildTerrainMesh({
      samplers: R.samplers,
      paint: { kind: 'live', colour: new Uint8Array(4), w: 1, h: 1, normals: new Uint8Array(R.ground.nx * R.ground.nz * 4) },
      nx: R.ground.nx,
      nz: R.ground.nz,
      coords: R.coords,
      style: styleFor(R.scene.style),
      maxAnisotropy: 8,
      marks: 'ripples',
      underWater: false,
      segmentM: route.segmentM * (tier === 'reduced' ? route.reducedSegmentTimes : 1),
      ripplePx: route.ripplePx,
    });

  it('先画好的地面图多大：586 × 662 格是 1756 × 1984', () => {
    expect([R.ground.nx, R.ground.nz]).toEqual([586, 662]);
    expect(routePictureSize(R.ground)).toEqual({ w: 1756, h: 1984 });
  });

  it('二十一条河里十条是自己写了线的，抹成海的圈有六个：“每一座”那一组里挪一条河、改一个圈的那一项，在这一座上挪的是他自己的河、他自己的圈，不是添进去的', () => {
    expect(R.scene.water.rivers).toHaveLength(21);
    expect(R.scene.water.rivers.filter((river) => river.line)).toHaveLength(10);
    expect(R.scene.terrain.edits).toHaveLength(6);
    // 那一项头一步改的是头一条河的依据、挪的是头一条自己写了线的河的第二个点、改的是头一个圈的第一个点：这三样他都有
    expect(R.scene.water.rivers[0].basis.length).toBeGreaterThan(0);
    expect(R.scene.water.rivers.find((river) => river.line)?.line?.length).toBeGreaterThanOrEqual(2);
    expect(R.scene.terrain.edits[0].area.length).toBeGreaterThanOrEqual(3);
  });

  it('地形板的网格：完整的一档 198 × 224，减配的一档 185 × 210；三角形数是照这两个数算的', { timeout: 30_000 }, () => {
    const full = terrainGrid(R.coords, route.segmentM);
    const reduced = terrainGrid(R.coords, route.segmentM * route.reducedSegmentTimes);
    expect(full).toEqual({ sx: 198, sz: 224 });
    expect(reduced).toEqual({ sx: 185, sz: 210 });
    const a = build('full');
    const b = build('reduced');
    expect([triangles(a.top), triangles(b.top)]).toEqual([198 * 224 * 2, 185 * 210 * 2]);
    expect([triangles(a.sides), triangles(b.sides)]).toEqual([(198 + 224) * 4, (185 + 210) * 4]);
    // 抽查顶点的那一项（上面“每一座”那一组里）在这一座上四个顶点都查得到
    expect(a.top.geometry.getAttribute('position').count).toBeGreaterThan(20_000);
    a.dispose();
    b.dispose();
  });
});

describe('站点沙盘的地形板没有变', () => {
  // 拿黄州的沙盘查（写着名字取，不取“排在最前面的那一座”）：查的是地形板这段程序，哪一座站点沙盘都一样
  it('不传那三样：第二张图还是田，着色器里没有水纹；网格还是 59 米一格', { timeout: 60_000 }, () => {
    const stop = realScene('su-shi/huangzhou');
    const { ground, samplers, coords, scene } = stop;
    const paint: GroundPaintSource = { kind: 'live', colour: new Uint8Array(4), w: 1, h: 1, normals: new Uint8Array(ground.nx * ground.nz * 4) };
    const mesh = buildTerrainMesh({ samplers, paint, nx: ground.nx, nz: ground.nz, coords, style: styleFor(scene.style), maxAnisotropy: 8 });
    const shader = compiled(mesh.top.material as Material);
    expect(shader.fragmentShader).toContain('diffuseColor.rgb *= fieldPaint(texel.rgb, vWPos.xz, texture2D(uFields, vMapUv).r);');
    expect(shader.fragmentShader).not.toContain('ripples(');
    expect(Object.keys(mesh.uniforms)).toEqual(['uFields']);
    expect(terrainGrid(coords)).toEqual(terrainGrid(coords, 59));
    mesh.dispose();
  });
});
