// 场景验收（预算）：每一座真的站点沙盘，一个画面要画的东西在不在预算里。上限都在 ./support/budgets.ts。
// 在 Node 里跑，不要浏览器：地面是真的，地形板、小模型、水面、云气、座子都是照场景真造出来的，只是不画。
// content/ 里有几座沙盘就查几座。
//
// 查三件事：
//   减配的一档   每一节，折算过的远近 D 从 1 公里扫到 130 公里（一步 5%），一个画面的三角形数不超过上限，
//               而且比完整的一档少；少得不到一成，提醒一句。（完整的一档自己超没超，由 scene-models.test.ts 查。）
//   画几批       两档、每一节、每一个 D，显出来的网格数（一个网格一批）不超过上限。
//   贴图的边长   沙盘程序现做的每一张贴图，宽和高都不超过上限；编译前才塞进着色器的也算；两档的影子贴图也算。
//
// 一个画面 = 地形板 + 这一节显出来的小模型 + 水面 + 云气 + 座子，就是沙盘程序挂进场景的那五样（src/stage/three/view.ts）。
// 都是数造出来的东西：数法照 three 自己画的时候的规矩（见 ./support/budgets.ts 的 drawn），不按视野裁掉，所以是往多里数的；
// 在浏览器里量到的（tests/e2e/real-table.spec.ts）不会比这里按同一个远近数出来的多。
// 地形板的颜色不在这里画（要两秒，而预算不看颜色）：给它一份空白的，大小是真的。数出来的数印在测试的输出里。

import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DataTexture,
  Group,
  InstancedBufferGeometry,
  InstancedMesh,
  Mesh,
  MeshBasicMaterial,
  MeshDepthMaterial,
  MeshLambertMaterial,
  ShaderLib,
  ShaderMaterial,
  Texture,
  UniformsUtils,
} from 'three';
import type { Material } from 'three';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ModelSet, Quality } from '../../src/stage/three/internal';
import { buildModels } from '../../src/stage/three/kit';
import { MIST_TRIANGLES_PER_LAYER, buildMist } from '../../src/stage/three/mist';
import type { Mist } from '../../src/stage/three/mist';
import { groundPictureSize } from '../../src/stage/three/groundPaint';
import type { GroundPaintSource } from '../../src/stage/three/groundPaint';
import { FULL_QUALITY, REDUCED_QUALITY } from '../../src/stage/three/quality';
import { styleFor } from '../../src/stage/three/style';
import { STAND_TRIANGLES, buildTable } from '../../src/stage/three/table';
import type { Stand } from '../../src/stage/three/table';
import { buildTerrainMesh, terrainGrid } from '../../src/stage/three/terrainMesh';
import type { TerrainMesh } from '../../src/stage/three/terrainMesh';
import { DRY_WATER_TRIANGLES, WATER_TRIANGLES, buildWater } from '../../src/stage/three/water';
import type { Water } from '../../src/stage/three/water';
import type { StageTier } from '../../src/stage/types';
import { withCommas } from '../content/budgetRules';
import {
  DRAW_CALLS_MAX,
  DRAW_CALLS_WARN,
  REDUCED_SAVES_WARN,
  TEXTURE_EDGE_MAX,
  TRIANGLES_MAX,
  TRIANGLES_WARN,
  checkDrawCalls,
  checkReduced,
  checkTextures,
  checkTriangles,
  drawn,
  sweepDistances,
  texturesOf,
} from './support/budgets';
import type { FoundTexture } from './support/budgets';
import { fakeDocument } from './support/fakeRenderer';
import { buildRouteModels } from '../../src/stage/three/routeKit';
import { realRouteScene, realScene, realSceneKeys } from './support/realScenes';
import type { RealScene } from './support/realScenes';

const TIERS: readonly StageTier[] = ['full', 'reduced'];
const QUALITY: Record<StageTier, Quality> = { full: FULL_QUALITY, reduced: REDUCED_QUALITY };
const TIER_NAME: Record<StageTier, string> = { full: '完整', reduced: '减配' };

const km = (metres: number): string => `${(metres / 1000).toFixed(1)} 公里`;

/** three 编译哪种材质用哪一套着色器（three 0.187，src/renderers/webgl/WebGLPrograms.js 的 shaderIDs）。 */
const SHADER_OF: Record<string, keyof typeof ShaderLib> = {
  MeshDepthMaterial: 'depth',
  MeshDistanceMaterial: 'distance',
  MeshBasicMaterial: 'basic',
  MeshLambertMaterial: 'lambert',
  MeshPhongMaterial: 'phong',
  MeshStandardMaterial: 'physical',
  MeshPhysicalMaterial: 'physical',
};

/**
 * 一种材质在编译前才塞进着色器的 uniforms。照 three 自己的做法（WebGLRenderer.js 的 getProgram）：
 * 拿这种材质那一套着色器的 uniforms 抄一份，连同着色器的文字交给 material.onBeforeCompile，它往里塞什么，这里就看得到什么。
 * 自己写着色器的材质（ShaderMaterial）的 uniforms 就在材质上，不用这一步。
 */
function compiledUniforms(material: Material): Record<string, { value: unknown }> {
  const id = SHADER_OF[material.type];
  if (!id) return {};
  const lib = ShaderLib[id];
  const shader = { name: material.type, uniforms: UniformsUtils.clone(lib.uniforms), vertexShader: lib.vertexShader, fragmentShader: lib.fragmentShader };
  (material.onBeforeCompile as (parameters: unknown, renderer: unknown) => void)(shader, null);
  return shader.uniforms as Record<string, { value: unknown }>;
}

beforeAll(() => {
  // 贴图是画在页面的画布上的：给一个假的页面，贴图才做得出来（大小是真的，只是没有画面）
  vi.stubGlobal('document', fakeDocument());
});

afterAll(() => {
  vi.unstubAllGlobals();
});

describe.each(realSceneKeys())('%s 的预算', (key) => {
  /** 一座沙盘造一次，几条测试共用：两档各一套小模型、各一份云气；地形板、水面和座子两档一样。 */
  interface Table {
    R: RealScene;
    terrain: TerrainMesh;
    models: Record<StageTier, ModelSet>;
    mists: Record<StageTier, Mist>;
    water: Water;
    stand: Stand;
  }
  let made: Promise<Table> | null = null;
  const table = (): Promise<Table> => {
    made ??= (async () => {
      const R = realScene(key);
      const { scene, ground, samplers, coords } = R;
      const style = styleFor(scene.style);
      const build = (tier: StageTier): ModelSet => buildModels({ scene, ground, samplers, coords, style, quality: QUALITY[tier], kit: R.kit });
      const mist = (tier: StageTier): Mist => buildMist({ ground, samplers, coords, scene, style, layers: QUALITY[tier].mistLayers });
      const models = { full: build('full'), reduced: build('reduced') };
      // 和页面上一样：先把每一节要用的备好
      for (const tier of TIERS) await models[tier].prepare(R.headings);
      // 地形板：颜色是空白的，大小照页面自己认的那个数（每 10 米一个点；先画好的图不是这么大，页面不用）；法线一格一个点
      const { w, h } = groundPictureSize(ground);
      const blank: GroundPaintSource = { kind: 'live', colour: new Uint8Array(w * h * 4), w, h, normals: new Uint8Array(ground.nx * ground.nz * 4) };
      return {
        R,
        terrain: buildTerrainMesh({ samplers, paint: blank, nx: ground.nx, nz: ground.nz, coords, style, maxAnisotropy: 8 }),
        models,
        mists: { full: mist('full'), reduced: mist('reduced') },
        water: buildWater({ ground, coords, scene, style }),
        stand: buildTable(coords, style.palette),
      };
    })();
    return made;
  };

  afterAll(async () => {
    if (!made) return;
    const t = await made;
    for (const tier of TIERS) {
      t.models[tier].dispose();
      t.mists[tier].dispose();
    }
    t.terrain.dispose();
    t.water.dispose();
    t.stand.dispose();
  });

  /** 这一档、这一节、这么远的时候，一个画面画几批、多少个三角形；kit 是其中小模型的，counted 是零件库自己报的三角形数。 */
  const frame = (t: Table, tier: StageTier, heading: string, levelM: number, D: number): { calls: number; triangles: number; kit: number; counted: number } => {
    const models = t.models[tier];
    models.apply(heading, levelM, D);
    t.water.setLevel(levelM);
    const kit = drawn(models.group);
    const rest = [t.terrain.group, t.water.group, t.mists[tier].group, t.stand.group].map((group) => drawn(group));
    return {
      calls: kit.calls + rest.reduce((sum, part) => sum + part.calls, 0),
      triangles: kit.triangles + rest.reduce((sum, part) => sum + part.triangles, 0),
      kit: kit.triangles,
      counted: models.triangles(),
    };
  };

  it('地形板、水面、云气、座子数出来的三角形数，和算预算用的公式、定数一样', { timeout: 120_000 }, async () => {
    const t = await table();
    const levels = t.R.scene.water.levels.values;
    // 地形板：上表面 横格 × 竖格 × 2，四边的切面（横格 + 竖格）× 4；两个网格
    const { sx, sz } = terrainGrid(t.R.coords);
    expect(drawn(t.terrain.group)).toEqual({ calls: 2, triangles: sx * sz * 2 + (sx + sz) * 4 });
    expect(drawn(t.stand.group).triangles).toBe(STAND_TRIANGLES);
    for (const tier of TIERS) {
      expect(drawn(t.mists[tier].group)).toEqual({ calls: QUALITY[tier].mistLayers, triangles: QUALITY[tier].mistLayers * MIST_TRIANGLES_PER_LAYER });
    }
    t.water.setLevel(levels.normal);
    expect(drawn(t.water.group)).toEqual({ calls: 1, triangles: WATER_TRIANGLES });
    // 水位高过平时、又有水漫不进去的地方时，多一片
    const top = Math.max(...Object.values(levels));
    if (top > levels.normal + 0.01 && t.R.ground.dry.some((v) => v === 1)) {
      t.water.setLevel(top);
      expect(drawn(t.water.group)).toEqual({ calls: 2, triangles: WATER_TRIANGLES + DRY_WATER_TRIANGLES });
    }
  });

  // 水面的着色器是拿 three 的 Lambert 那一套、照五处“#include”的位置改出来的（src/stage/three/water.ts）。
  // 哪一处在 three 里换了名字，改就落空，而且不出错：声明加进去了、正文没换上，编译照样过，水面成了一张白板。
  // 第五处是做夜里的小节时添的（lights_fragment_end：灯都算完以后，把月光直接照到的那一份乘亮）：它落空的话夜里的水面不亮，也不出错。
  // 模型和地形板的着色器各有各的查法（kit.test.ts、ground-paint.test.ts），这一项查水面的。
  it('水面的着色器：three 的那五处接口都在，五处都改上了', { timeout: 120_000 }, async () => {
    const t = await table();
    const materials: Material[] = [];
    t.water.group.traverse((object) => {
      if (object instanceof Mesh) materials.push(object.material as Material);
    });
    // 主水面，和大水时停在平时水位上的那一片
    expect(materials).toHaveLength(2);
    const lib = ShaderLib.lambert;
    const count = (text: string, piece: string): number => text.split(piece).length - 1;
    expect(count(lib.vertexShader, '#include <common>')).toBe(1);
    expect(count(lib.vertexShader, '#include <begin_vertex>')).toBe(1);
    expect(count(lib.fragmentShader, '#include <common>')).toBe(1);
    expect(count(lib.fragmentShader, '#include <map_fragment>')).toBe(1);
    expect(count(lib.fragmentShader, '#include <lights_fragment_end>')).toBe(1);
    // 乘的是 three 记“灯直接照到的那一份”的那个数：它在 Lambert 的着色器里还叫这个名字，而且是在第五处后面才加进最后的颜色里
    expect(lib.fragmentShader.indexOf('reflectedLight.directDiffuse +')).toBeGreaterThan(lib.fragmentShader.indexOf('#include <lights_fragment_end>'));
    for (const material of materials) {
      expect(material.type).toBe('MeshLambertMaterial');
      const shader = { name: material.type, uniforms: UniformsUtils.clone(lib.uniforms), vertexShader: lib.vertexShader, fragmentShader: lib.fragmentShader };
      (material.onBeforeCompile as (parameters: unknown, renderer: unknown) => void)(shader, null);
      // 顶点：多了一个传给片元的位置，并且真的算了
      expect(shader.vertexShader).toContain('varying vec3 vWPos;');
      expect(shader.vertexShader).toContain('vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      // 片元：声明加上了，原来读贴图的那一处换成了水面自己的正文
      expect(shader.fragmentShader).toContain('uniform sampler2D uH;');
      expect(shader.fragmentShader).toContain('diffuseColor.a = a * mix(');
      expect(shader.fragmentShader).not.toContain('#include <map_fragment>');
      // 水面的正文用到 Lambert 自己声明的两样（少了会编译不过，那是响的；这里顺手对一下）
      expect(shader.fragmentShader).toContain('#include <normal_pars_fragment>');
      expect(shader.uniforms.uH, '着色器拿到了水面自己的贴图').toBeDefined();
      // 水纹照页面上的像素算：量“一个像素合地上多少米”的三处都乘上了像素比，别处没有不乘的 fwidth
      expect(shader.fragmentShader).toContain('uniform float uPx;');
      expect(shader.fragmentShader).toContain('float px = max(fwidth(p.x), fwidth(p.y)) * uPx;');
      expect(shader.fragmentShader).toContain('float px = max(fwidth(vWPos.x), fwidth(vWPos.z)) * uPx;');
      expect(shader.fragmentShader).toContain('float fw = fwidth(w) * 2.0 * uPx;');
      const water = shader.fragmentShader.slice(shader.fragmentShader.indexOf('float whash('), shader.fragmentShader.indexOf('diffuseColor.a = a * mix('));
      expect(count(water, 'fwidth('), '水面的着色器里量像素的地方多了或者少了：新添的也要乘 uPx').toBe(5);
      expect(count(water, '* uPx;')).toBe(3);
      // 夜里添的：声明在水纹的函数后面；水纹和“是不是切面”记下来的那两句紧跟在水面的正文后面（还在它那一对花括号里，rp、isSide 认得）；
      // 乘亮的那一句紧跟在 three 把灯算完的地方后面，那一处的 #include 还留着（只留一次）
      const source = shader.fragmentShader;
      expect(source).toContain('uniform float uSheen;\nfloat wRipple;\nfloat wSide;\n');
      expect(source.indexOf('uniform float uSheen;')).toBeGreaterThan(source.indexOf('float ripples('));
      expect(source).toMatch(/diffuseColor\.a = a \* mix\(0\.8, 0\.95, dk\);\s+wRipple = rp;\s+wSide = isSide;/);
      expect(count(source, '#include <lights_fragment_end>')).toBe(1);
      expect(source).toMatch(/#include <lights_fragment_end>\s+reflectedLight\.directDiffuse \*= 1\.0 \+ uSheen \* \(0\.55 \+ 0\.45 \* wRipple\) \* \(1\.0 - wSide\);/);
      expect(count(source, 'uSheen')).toBe(2);
    }
    // 月光照到的水面多亮出几倍：不说是 0（白天：乘的正好是 1，画面不变）；说了，两片水面都跟着
    const sheens = (): number[] => materials.map((material) => {
      const shader = { name: material.type, uniforms: UniformsUtils.clone(lib.uniforms), vertexShader: lib.vertexShader, fragmentShader: lib.fragmentShader };
      (material.onBeforeCompile as (parameters: unknown, renderer: unknown) => void)(shader, null);
      return (shader.uniforms as Record<string, { value: unknown }>).uSheen.value as number;
    });
    expect(sheens()).toEqual([0, 0]);
    t.water.setSheen(4.8);
    expect(sheens()).toEqual([4.8, 4.8]);
    t.water.setSheen(0);
    expect(sheens()).toEqual([0, 0]);
    // 不说像素比是 1（像素比 1 的屏幕上画面和以前一样）；说了，两片水面都跟着；说 0 或者不是数，当 1
    const ratios = (): number[] => materials.map((material) => {
      const shader = { name: material.type, uniforms: UniformsUtils.clone(lib.uniforms), vertexShader: lib.vertexShader, fragmentShader: lib.fragmentShader };
      (material.onBeforeCompile as (parameters: unknown, renderer: unknown) => void)(shader, null);
      return (shader.uniforms as Record<string, { value: unknown }>).uPx.value as number;
    });
    expect(ratios()).toEqual([1, 1]);
    t.water.setPixelRatio(1.5);
    expect(ratios()).toEqual([1.5, 1.5]);
    t.water.setPixelRatio(2);
    expect(ratios()).toEqual([2, 2]);
    t.water.setPixelRatio(0);
    expect(ratios()).toEqual([1, 1]);
    t.water.setPixelRatio(Number.NaN);
    expect(ratios()).toEqual([1, 1]);
  });

  // 云气和座子木头上的反光都不受灯照：夜里要有人把它们压暗（view.ts 的 applyLight 照 rig.ts 的 lightDim 给的几成来压）。
  it('云气换颜色、压暗：每一层都跟着，压的是线性的光；压到 1 就是原来的颜色。座子的木头：反光跟着压，压到 1 是白天的 0.55', { timeout: 120_000 }, async () => {
    const t = await table();
    const style = styleFor(t.R.scene.style);
    for (const tier of TIERS) {
      const colours = (): Color[] => {
        const found: Color[] = [];
        t.mists[tier].group.traverse((object) => {
          if (object instanceof Mesh) found.push((object.material as ShaderMaterial).uniforms.uColor.value as Color);
        });
        return found;
      };
      expect(colours()).toHaveLength(QUALITY[tier].mistLayers);
      const usual = new Color(style.palette.mist);
      for (const colour of colours()) expect(colour.equals(usual)).toBe(true);
      t.mists[tier].setColor('#dfe6ee', 0.25);
      const night = new Color('#dfe6ee');
      for (const colour of colours()) {
        expect(colour.r).toBeCloseTo(night.r * 0.25, 6);
        expect(colour.g).toBeCloseTo(night.g * 0.25, 6);
        expect(colour.b).toBeCloseTo(night.b * 0.25, 6);
      }
      t.mists[tier].setColor(style.palette.mist, 1);
      for (const colour of colours()) expect(colour.equals(usual)).toBe(true);
    }
    expect(t.stand.wood.envMapIntensity).toBe(0.55);
    t.stand.setDim(0.26);
    expect(t.stand.wood.envMapIntensity).toBeCloseTo(0.143, 6);
    t.stand.setDim(1);
    expect(t.stand.wood.envMapIntensity).toBe(0.55);
  });

  it(`减配的一档：每一节、从近到远，一个画面的三角形数不超过 ${withCommas(TRIANGLES_MAX)}，而且比完整的一档少`, { timeout: 120_000 }, async () => {
    const t = await table();
    const { scene } = t.R;
    const fails: string[] = [];
    const warns: string[] = [];
    const miscounted: string[] = [];
    const lines: string[] = [`${key} 一个画面的三角形数，D 从 ${km(sweepDistances()[0])} 扫到 ${km(sweepDistances().at(-1) ?? 0)}（其中地形板 ${withCommas(drawn(t.terrain.group).triangles)}）`];
    for (const section of scene.sections) {
      const levelM = scene.water.levels.values[section.water];
      let mostFull = { triangles: 0, D: 0 };
      let mostReduced = { triangles: 0, D: 0 };
      let leastSaved = { share: Infinity, D: 0 };
      for (const D of sweepDistances()) {
        const full = frame(t, 'full', section.heading, levelM, D);
        const reduced = frame(t, 'reduced', section.heading, levelM, D);
        const what = `${section.heading}，D ${km(D)}`;
        for (const [tier, f] of [['full', full], ['reduced', reduced]] as const) {
          if (f.kit !== f.counted) miscounted.push(`${what}（${TIER_NAME[tier]}）：显出来的小模型数出来是 ${withCommas(f.kit)} 个三角形，零件库自己报的是 ${withCommas(f.counted)}`);
        }
        const found = checkReduced(what, full.triangles, reduced.triangles);
        if (found.fail) fails.push(found.fail);
        if (found.warn) warns.push(found.warn);
        if (full.triangles > mostFull.triangles) mostFull = { triangles: full.triangles, D };
        if (reduced.triangles > mostReduced.triangles) mostReduced = { triangles: reduced.triangles, D };
        const share = (full.triangles - reduced.triangles) / full.triangles;
        if (share < leastSaved.share) leastSaved = { share, D };
      }
      // 完整的一档超没超由 scene-models.test.ts 管，这里只在快到上限时跟着提醒
      const fullFinding = checkTriangles(`${section.heading}（完整），D ${km(mostFull.D)}`, mostFull.triangles);
      if (fullFinding.warn ?? fullFinding.fail) warns.push((fullFinding.warn ?? fullFinding.fail) as string);
      const authored = frame(t, 'full', section.heading, levelM, section.camera.distanceM);
      const authoredReduced = frame(t, 'reduced', section.heading, levelM, section.camera.distanceM);
      lines.push(
        `  ${section.heading}：完整最多 ${withCommas(mostFull.triangles)}（D ${km(mostFull.D)}），减配最多 ${withCommas(mostReduced.triangles)}（D ${km(mostReduced.D)}），` +
          `最少省 ${(leastSaved.share * 100).toFixed(1)}%（D ${km(leastSaved.D)}）；照场景里写的距离 ${km(section.camera.distanceM)}：完整 ${withCommas(authored.triangles)}，减配 ${withCommas(authoredReduced.triangles)}`,
      );
    }
    console.log(lines.join('\n'));
    // 同一节里每一步都提醒就太多了：只印头几句和一共多少句
    if (warns.length > 0) console.warn(`[预算] ${key} 的三角形数有 ${warns.length} 处要留意（减配省得不到 ${REDUCED_SAVES_WARN * 100}%，或者快到上限）：\n${warns.slice(0, 8).join('\n')}`);
    expect(miscounted.slice(0, 5), '零件库报的三角形数和显出来的网格对不上').toEqual([]);
    expect(fails.slice(0, 10), `一共 ${fails.length} 处`).toEqual([]);
  });

  it(`画一帧几批：两档、每一节、从近到远，都不超过 ${DRAW_CALLS_MAX}`, { timeout: 120_000 }, async () => {
    const t = await table();
    const { scene } = t.R;
    const fails: string[] = [];
    const warns: string[] = [];
    const lines: string[] = [`${key} 画一帧几批（显出来的网格数；其中地形板 ${drawn(t.terrain.group).calls}，水面 1 到 2，云气一层一批，座子 ${drawn(t.stand.group).calls}）`];
    for (const section of scene.sections) {
      const levelM = scene.water.levels.values[section.water];
      const parts: string[] = [];
      for (const tier of TIERS) {
        let most = { calls: 0, D: 0 };
        for (const D of sweepDistances()) {
          const calls = frame(t, tier, section.heading, levelM, D).calls;
          if (calls > most.calls) most = { calls, D };
        }
        const found = checkDrawCalls(`${section.heading}（${TIER_NAME[tier]}），D ${km(most.D)}`, most.calls);
        if (found.fail) fails.push(found.fail);
        if (found.warn) warns.push(found.warn);
        const authored = frame(t, tier, section.heading, levelM, section.camera.distanceM).calls;
        parts.push(`${TIER_NAME[tier]}最多 ${most.calls}（D ${km(most.D)}），照场景里写的距离 ${authored}`);
      }
      lines.push(`  ${section.heading}：${parts.join('；')}`);
    }
    console.log(lines.join('\n'));
    for (const warn of warns) console.warn(`[预算] 快到上限了：${warn}`);
    expect(fails).toEqual([]);
  });

  it(`现做的贴图，宽和高都不超过 ${TEXTURE_EDGE_MAX} 像素（编译前才塞进着色器的也算）；影子贴图两档都不超过`, { timeout: 120_000 }, async () => {
    const t = await table();
    const { scene, ground } = t.R;
    const picture = groundPictureSize(ground);
    // 每一节在近处、远处各显一遍，用到才造的模型就都造出来了
    for (const tier of TIERS) {
      for (const section of scene.sections) {
        for (const D of [sweepDistances()[0], section.camera.distanceM, sweepDistances().at(-1) ?? 0]) {
          t.models[tier].apply(section.heading, scene.water.levels.values[section.water], D);
        }
      }
    }
    const roots = [
      { name: '地形板', root: t.terrain.group },
      { name: '小模型（完整）', root: t.models.full.group },
      { name: '小模型（减配）', root: t.models.reduced.group },
      { name: '水面', root: t.water.group },
      { name: '云气（完整）', root: t.mists.full.group },
      { name: '云气（减配）', root: t.mists.reduced.group },
      { name: '座子', root: t.stand.group },
    ];
    const found: FoundTexture[] = texturesOf(roots, compiledUniforms);
    // 影子贴图不挂在哪种材质上，是照画质里的数现开的：两档各算一张
    for (const tier of TIERS) found.push({ where: `影子贴图（${TIER_NAME[tier]}）`, width: QUALITY[tier].shadowMapSize, height: QUALITY[tier].shadowMapSize });

    console.log([`${key} 现做的贴图 ${found.length} 张`, ...found.map((texture) => `  ${texture.width} × ${texture.height}　${texture.where}`)].join('\n'));
    expect(checkTextures(found)).toEqual([]);
    // 地形板的三张都找到了：颜色和田的标记每 10 米一个点，法线一格（20 米）一个点
    const terrain = found.filter((texture) => texture.where.startsWith('地形板：'));
    const sizes = terrain.map((texture) => `${texture.width} × ${texture.height}`);
    expect(sizes.filter((size) => size === `${picture.w} × ${picture.h}`).length, '地形板的颜色和田的标记').toBe(2);
    expect(sizes.filter((size) => size === `${ground.nx} × ${ground.nz}`).length, '地形板的法线').toBe(1);
    // 真的找到了东西：水面那张是编译前才塞进去的，云气的在自己写的着色器的 uniforms 里，零件库和座子的在材质的字段上
    const places = found.map((texture) => texture.where);
    expect(places.some((where) => where.startsWith('水面：') && where.includes('编译前塞进去的 uniform'))).toBe(true);
    expect(places.filter((where) => where.startsWith('云气') && where.includes(' 的 uniform ')).length).toBe((FULL_QUALITY.mistLayers + REDUCED_QUALITY.mistLayers) * 2);
    expect(places.filter((where) => where.startsWith('小模型（完整）')).length).toBeGreaterThanOrEqual(1);
    expect(places.filter((where) => where.startsWith('小模型（减配）')).length).toBeGreaterThanOrEqual(1);
    expect(places.filter((where) => where.startsWith('座子：')).length).toBeGreaterThanOrEqual(3);
  });
});

// 全程沙盘的一个画面 = 地形板 + 路 + 座子（没有水面、没有云气：海和湖画在地面上，view.ts 给的是两个空的替身）。
// 路是照真的场景真造出来的（src/stage/three/routeKit.ts），数法还是 drawn()：一段线一份、六个三角形。
// 路的多少不跟着镜头的远近变，所以不用从近到远扫，每一节数一次。
describe.each(realSceneKeys('route'))('%s 的预算（全程沙盘）', (key) => {
  const R = realRouteScene(key);
  const style = styleFor(R.scene.style);
  const route = style.route;
  if (!route) throw new Error('样式里没有全程沙盘的那一份');
  const blank = (): GroundPaintSource => ({ kind: 'live', colour: new Uint8Array(4), w: 1, h: 1, normals: new Uint8Array(R.ground.nx * R.ground.nz * 4) });
  const parts = (tier: StageTier) => ({
    terrain: buildTerrainMesh({
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
    }),
    roads: buildRouteModels({ scene: R.scene, coords: R.coords, samplers: R.samplers, style: route, tier }),
    stand: buildTable(R.coords, style.palette),
  });

  it(`每一节、两档：一个画面的三角形数不超过 ${withCommas(TRIANGLES_MAX)}、不超过 ${DRAW_CALLS_MAX} 批，减配的比完整的少`, { timeout: 120_000 }, () => {
    const made = { full: parts('full'), reduced: parts('reduced') };
    const frame = (tier: StageTier, heading: string): { calls: number; triangles: number; roads: { calls: number; triangles: number } } => {
      const t = made[tier];
      t.roads.apply(heading, 0, 50_000);
      const roads = drawn(t.roads.group);
      const rest = [drawn(t.terrain.group), drawn(t.stand.group)];
      return { calls: roads.calls + rest[0].calls + rest[1].calls, triangles: roads.triangles + rest[0].triangles + rest[1].triangles, roads };
    };
    const fails: string[] = [];
    const warns: string[] = [];
    const lines: string[] = [
      `${key} 一个画面（地形板 + 路 + 座子）：地形板完整 ${withCommas(drawn(made.full.terrain.group).triangles)}、减配 ${withCommas(drawn(made.reduced.terrain.group).triangles)} 个三角形，${drawn(made.full.terrain.group).calls} 批；座子 ${withCommas(drawn(made.full.stand.group).triangles)} 个，${drawn(made.full.stand.group).calls} 批`,
    ];
    let heaviest = { heading: '', triangles: 0 };
    for (const heading of R.headings) {
      const full = frame('full', heading);
      const reduced = frame('reduced', heading);
      // 路报的数和显出来的网格数出来的一样（两档的路一样多，只是减配的粗一点）
      expect(made.full.roads.triangles(), heading).toBe(full.roads.triangles);
      expect(reduced.roads.triangles, heading).toBe(full.roads.triangles);
      for (const [tier, f] of [['full', full], ['reduced', reduced]] as const) {
        const what = `${heading}（${TIER_NAME[tier]}）`;
        for (const found of [checkTriangles(what, f.triangles), checkDrawCalls(what, f.calls)]) {
          if (found.fail) fails.push(found.fail);
          if (found.warn) warns.push(found.warn);
        }
      }
      const found = checkReduced(heading, full.triangles, reduced.triangles);
      if (found.fail) fails.push(found.fail);
      if (found.warn) warns.push(found.warn);
      if (full.triangles > heaviest.triangles) heaviest = { heading, triangles: full.triangles };
      lines.push(
        `  ${heading}：完整 ${withCommas(full.triangles)} 个三角形、${full.calls} 批，减配 ${withCommas(reduced.triangles)} 个、${reduced.calls} 批（省 ${(((full.triangles - reduced.triangles) / full.triangles) * 100).toFixed(1)}%）；其中路 ${withCommas(full.roads.triangles)} 个、${full.roads.calls} 批`,
      );
    }
    lines.push(`  最重的一节是“${heaviest.heading}”`);
    console.log(lines.join('\n'));
    if (warns.length > 0) console.warn(`[预算] ${key} 有 ${warns.length} 处要留意（减配省得不到 ${REDUCED_SAVES_WARN * 100}%，或者快到上限）：\n${warns.slice(0, 8).join('\n')}`);
    expect(fails).toEqual([]);
    // 看整块沙盘的一节每一趟路都画，是最重的
    expect(heaviest.heading).toBe(R.headings[0]);
    for (const tier of TIERS) {
      made[tier].terrain.dispose();
      made[tier].roads.dispose();
      made[tier].stand.dispose();
    }
  });
});

describe('预算自己查得出毛病（编出来的数和编出来的模型）', () => {
  it('三角形数：正好等于上限合格，多一个不行；过了提醒的线提醒', () => {
    expect(checkTriangles('某一节', TRIANGLES_MAX)).toEqual({ warn: '某一节：200,000 个三角形，快到上限 200,000 了' });
    expect(checkTriangles('某一节', TRIANGLES_MAX + 1)).toEqual({ fail: '某一节：200,001 个三角形，超过了 200,000' });
    expect(checkTriangles('某一节', TRIANGLES_WARN)).toEqual({});
    expect(checkTriangles('某一节', TRIANGLES_WARN + 1).warn).toBeDefined();
    expect(checkTriangles('某一节', 131_336)).toEqual({});
  });

  it('减配的一档：超了不行；没有比完整的少不行；少得不到一成提醒', () => {
    expect(checkReduced('某一节', 210_000, 200_001).fail).toBe('某一节（减配）：200,001 个三角形，超过了 200,000');
    expect(checkReduced('某一节', 150_000, 150_000).fail).toBe('某一节：减配的一档有 150,000 个三角形，没有比完整的一档（150,000）少');
    expect(checkReduced('某一节', 150_000, 150_004).fail).toBeDefined();
    expect(checkReduced('某一节', 150_000, 149_996)).toEqual({ warn: '某一节：减配的一档 149,996 个三角形，只比完整的一档（150,000）少 0.0%' });
    expect(checkReduced('某一节', 150_000, 135_001).warn).toBeDefined();
    // 正好少一成不提醒；量到过的数（166,720 对 135,604，少 18.7%）合格
    expect(checkReduced('某一节', 150_000, 135_000)).toEqual({});
    expect(checkReduced('某一节', 166_720, 135_604)).toEqual({});
    // 减配的自己快到上限，照样提醒
    expect(checkReduced('某一节', 230_000, 190_000).warn).toBe('某一节（减配）：190,000 个三角形，快到上限 200,000 了');
  });

  it('画几批：100 批合格，101 批不行；过了 70 批提醒', () => {
    expect(checkDrawCalls('某一节', DRAW_CALLS_MAX).fail).toBeUndefined();
    expect(checkDrawCalls('某一节', DRAW_CALLS_MAX + 1)).toEqual({ fail: '某一节：101 批，超过了 100' });
    expect(checkDrawCalls('某一节', DRAW_CALLS_WARN)).toEqual({});
    expect(checkDrawCalls('某一节', DRAW_CALLS_WARN + 1)).toEqual({ warn: '某一节：71 批，快到上限 100 了' });
  });

  it('贴图：2048 合格，2049 不行；读不出大小的也不放过', () => {
    expect(checkTextures([{ where: '甲', width: 2048, height: 2048 }, { where: '乙', width: 1171, height: 971 }])).toEqual([]);
    expect(checkTextures([{ where: '甲', width: 2049, height: 16 }])).toEqual(['甲：2049 × 16 像素，宽和高都不能超过 2048']);
    expect(checkTextures([{ where: '甲', width: 16, height: 4096 }])).toEqual(['甲：16 × 4096 像素，宽和高都不能超过 2048']);
    expect(checkTextures([{ where: '甲', width: null, height: null }])).toEqual(['甲：读不出这张贴图多大']);
  });

  it('扫远近：从 1 公里到 130 公里，一步 5%，两头都在', () => {
    const all = sweepDistances();
    expect(all[0]).toBe(1000);
    expect(all.at(-1)).toBe(130_000);
    for (let i = 1; i < all.length; i++) expect(all[i] / all[i - 1]).toBeLessThanOrEqual(1.05 + 1e-9);
    expect(all.length).toBeGreaterThan(95);
  });

  it('数一棵编出来的模型树：藏起来的不算，成批摆的一个网格一批、摆了 0 个不画，几种材质的一种一批', () => {
    const triangle = (n: number): BufferGeometry => new BufferGeometry().setAttribute('position', new BufferAttribute(new Float32Array(n * 9), 3));
    const plain = new MeshBasicMaterial();
    const root = new Group();
    // 一个 10 个三角形的网格
    root.add(new Mesh(triangle(10), plain));
    // 一组藏起来的：里面的 100 个三角形不算
    const hidden = new Group();
    hidden.visible = false;
    hidden.add(new Mesh(triangle(100), plain));
    root.add(hidden);
    // 成批摆的：4 个三角形的形状摆 5 个，一批，20 个三角形；摆 0 个的不画
    const five = new InstancedMesh(triangle(4), plain, 8);
    five.count = 5;
    const none = new InstancedMesh(triangle(4), plain, 8);
    none.count = 0;
    root.add(five, none);
    // 一个网格两种材质：两批；其中一种材质藏起来了就只有一批
    const two = triangle(6);
    two.addGroup(0, 9, 0);
    two.addGroup(9, 9, 1);
    root.add(new Mesh(two, [plain, plain]));
    const unseen = new MeshBasicMaterial();
    unseen.visible = false;
    root.add(new Mesh(two, [plain, unseen]));
    // 只画一段的：12 个三角形里画 3 个
    const part = triangle(12);
    part.setDrawRange(9, 9);
    root.add(new Mesh(part, plain));
    // 材质藏起来的网格不画
    root.add(new Mesh(triangle(50), unseen));
    expect(drawn(root)).toEqual({ calls: 1 + 1 + 2 + 1 + 1, triangles: 10 + 20 + 6 + 3 + 3 });

    // 编出来的 101 个网格：超了
    const many = new Group();
    for (let i = 0; i < DRAW_CALLS_MAX + 1; i++) many.add(new Mesh(triangle(1), plain));
    expect(checkDrawCalls('编出来的', drawn(many).calls).fail).toBe('编出来的：101 批，超过了 100');
  });

  it('数粗线（全程沙盘的路）：一个网格一批，一段线六个三角形；一段也没有的不画；份数没写明的成批形状按一份算', () => {
    // 两段线：three 的粗线是一个普通的网格，形状是成批的——八个顶点、六个三角形的一小块，一段线一份
    const two = new LineSegments2(new LineSegmentsGeometry().setPositions([0, 0, 0, 1, 0, 0, 1, 0, 0, 2, 0, 0]), new LineMaterial());
    expect(two.geometry.index?.count).toBe(18);
    expect(two.geometry.instanceCount).toBe(2);
    expect(drawn(two)).toEqual({ calls: 1, triangles: 12 });
    // 和别的东西在一棵树里：照样各算各的
    const root = new Group();
    root.add(two, new Mesh(new BufferGeometry().setAttribute('position', new BufferAttribute(new Float32Array(27), 3)), new MeshBasicMaterial()));
    expect(drawn(root)).toEqual({ calls: 2, triangles: 12 + 3 });
    // 一段也没有的粗线：不画
    const none = new LineSegments2(new LineSegmentsGeometry().setPositions([]), new LineMaterial());
    expect(none.geometry.instanceCount).toBe(0);
    expect(drawn(none)).toEqual({ calls: 0, triangles: 0 });
    // 成批的形状没有写明几份（还是无穷大）：按一份算，不会数出无穷大来
    const open = new InstancedBufferGeometry().setAttribute('position', new BufferAttribute(new Float32Array(18), 3));
    expect(open.instanceCount).toBe(Infinity);
    expect(drawn(new Mesh(open, new MeshBasicMaterial()))).toEqual({ calls: 1, triangles: 2 });
  });

  it('找一棵编出来的模型树上的贴图：字段上的、自己写的着色器里的、编译前塞进去的、投影子用的材质上的；同一张只记一次', () => {
    const data = (w: number, h: number): DataTexture => new DataTexture(new Uint8Array(w * h * 4), w, h);
    const shared = data(64, 32);
    const big = data(4096, 8);
    const lambert = new MeshLambertMaterial({ map: shared });
    lambert.onBeforeCompile = (shader) => {
      shader.uniforms.uBig = { value: big };
    };
    const own = new ShaderMaterial({ uniforms: { uA: { value: data(420, 353) }, uSame: { value: shared }, uNumber: { value: 3 } } });
    const mesh = new Mesh(new BufferGeometry(), lambert);
    mesh.customDepthMaterial = new MeshDepthMaterial({ alphaMap: data(16, 16) });
    const blank = new Mesh(new BufferGeometry(), new MeshBasicMaterial({ map: new Texture() }));
    const root = new Group().add(mesh, new Mesh(new BufferGeometry(), own), blank);

    const found = texturesOf([{ name: '编出来的', root }], compiledUniforms);
    expect(found).toEqual([
      { where: '编出来的：MeshLambertMaterial.map', width: 64, height: 32 },
      { where: '编出来的：MeshLambertMaterial 编译前塞进去的 uniform uBig', width: 4096, height: 8 },
      { where: '编出来的（投影子用的）：MeshDepthMaterial.alphaMap', width: 16, height: 16 },
      { where: '编出来的：ShaderMaterial 的 uniform uA', width: 420, height: 353 },
      { where: '编出来的：MeshBasicMaterial.map', width: null, height: null },
    ]);
    expect(checkTextures(found)).toEqual(['编出来的：MeshLambertMaterial 编译前塞进去的 uniform uBig：4096 × 8 像素，宽和高都不能超过 2048', '编出来的：MeshBasicMaterial.map：读不出这张贴图多大']);
    // 不帮着看编译前塞进去的，就找不到那一张
    expect(texturesOf([{ name: '编出来的', root }]).map((texture) => texture.where)).not.toContain('编出来的：MeshLambertMaterial 编译前塞进去的 uniform uBig');
  });
});
