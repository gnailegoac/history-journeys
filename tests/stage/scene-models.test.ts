// 场景验收（四）：每一座真的站点沙盘，小模型造得出来，一个画面的三角形数不超过预算。
// 在 Node 里跑：地面是真的，小模型用零件库照场景造（没有页面，材质不带贴图，形状一点不差），不要浏览器。
// content/ 里有几座沙盘就查几座。
//
// 一个画面的三角形数 = 这一节显出来的小模型 + 地形板 + 水面 + 云气 + 座子。
//   小模型  零件库自己数的（ModelSet.triangles()）。
//   地形板  按公式：上表面 横格 × 竖格 × 2，四边的切面（横格 + 竖格）× 4（src/stage/three/terrainMesh.ts）。
//   水面    定数（src/stage/three/water.ts）；水位高过平时、又有水漫不进去的地方时，多一片。
//   云气    一层一片，两个三角形（src/stage/three/mist.ts）。
//   座子    绫边 2 + 紫檀框 11 段 × 4 边 × 2 + 嵌线 4 × 2 + 四只脚 4 × 12 + 案上的影子 2 = 148
//           （src/stage/three/style/song-qinglv/stand.ts 自己照形状算的数；tests/stage/view.test.ts 拿造出来的座子核对过）。
// 模型只有一套，镜头远了近了只是大小变；交给显卡的三角形数只在两处跟着远近变：远了成批摆的苔点只画次序在前面的，
// 镜头贴近才有的那几棵细做的树不贴近时不画（收掉的细处、缩没了的民居照样交给显卡，照样算数）。
// 所以每一节把折算过的远近 D 从 1 公里到 130 公里每次远 5% 扫一遍（哪种画面、读者怎么拉镜头都在这里面），
// 完整的一档和减配的一档各扫一遍，哪一处都不能超过预算（正好等于预算算过）。数出来的数印在测试的输出里：
// 运行 npx vitest run tests/stage/scene-models.test.ts --silent=false

import type { InstancedMesh, Mesh, Object3D } from 'three';
import { describe, expect, it } from 'vitest';
import type { ModelSet, Quality } from '../../src/stage/three/internal';
import { buildModels } from '../../src/stage/three/kit';
import { equivalentDistance } from '../../src/stage/three/kit/figure';
import { Batch } from '../../src/stage/three/kit/geo';
import type { Pass } from '../../src/stage/three/kit/pass';
import { surveyWalls } from '../../src/stage/three/kit/site';
import { PILE_ABOVE, THING_BUILDERS, bankSurfaceY } from '../../src/stage/three/kit/things';
import { meshHeightAt } from '../../src/stage/three/meshHeight';
import { MIST_TRIANGLES_PER_LAYER } from '../../src/stage/three/mist';
import { FULL_QUALITY, REDUCED_QUALITY } from '../../src/stage/three/quality';
import { styleFor } from './support/styles';
import { STAND_TRIANGLES } from '../../src/stage/three/style/song-qinglv/stand';
import { terrainGrid } from '../../src/stage/three/terrainMesh';
import { DRY_WATER_TRIANGLES, WATER_TRIANGLES } from '../../src/stage/three/water';
import { TRIANGLES_MAX, TRIANGLES_WARN, sweepDistances } from './support/budgets';
import { realScene, realSceneKeys } from './support/realScenes';
import type { RealScene } from './support/realScenes';

// 预算（最多多少个三角形、过了多少提醒一声）和 D 扫哪些数，都只在 tests/stage/support/budgets.ts 写一次。
// 正好等于预算算过，多一个就不过。

/** 现在真的在画的网格有几个（成批摆的、一个实例也不画的不算）：一个网格画一批。 */
function drawnMeshes(root: Object3D): number {
  let n = 0;
  const visit = (o: Object3D): void => {
    if (!o.visible) return;
    const mesh = o as InstancedMesh;
    if ((o as Mesh).isMesh && (!mesh.isInstancedMesh || mesh.count > 0)) n++;
    for (const child of o.children) visit(child);
  };
  visit(root);
  return n;
}

const fmt = (n: number): string => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

/** 现在显出来的模型里，有没有坏掉的数（NaN、无穷大）。返回坏掉的网格的名字。 */
function brokenMeshes(root: Object3D): string[] {
  const bad: string[] = [];
  const visit = (o: Object3D, path: string): void => {
    if (!o.visible) return;
    const here = `${path}/${o.name || o.type}`;
    const mesh = o as Mesh;
    if (mesh.isMesh) {
      const position = mesh.geometry.getAttribute('position');
      const values = position.array as ArrayLike<number>;
      for (let i = 0; i < values.length; i++) {
        if (!Number.isFinite(values[i])) {
          bad.push(here);
          break;
        }
      }
      const instanced = o as InstancedMesh;
      if (instanced.isInstancedMesh) {
        const m = instanced.instanceMatrix.array as ArrayLike<number>;
        for (let i = 0; i < instanced.count * 16; i++) {
          if (!Number.isFinite(m[i])) {
            bad.push(`${here}（摆放的位置）`);
            break;
          }
        }
      }
    }
    for (const child of o.children) visit(child, here);
  };
  visit(root, '');
  return bad;
}

describe.each(realSceneKeys())('%s 的小模型', (key) => {
  // 一座沙盘每一档画质只造一次模型，几条测试共用
  const made = new Map<string, { R: RealScene; models: ModelSet }>();
  const table = (quality: Quality = FULL_QUALITY): { R: RealScene; models: ModelSet } => {
    let have = made.get(quality.tier);
    if (!have) {
      const R = realScene(key);
      const { scene, ground, samplers, coords } = R;
      have = { R, models: buildModels({ scene, ground, samplers, coords, style: styleFor(scene.style), quality, kit: R.kit }) };
      made.set(quality.tier, have);
    }
    return have;
  };

  /** 小模型以外的三角形：地形板、水面、云气、座子。 */
  const fixed = (R: RealScene, levelM: number, quality: Quality): number => {
    const { sx, sz } = terrainGrid(R.coords);
    const terrain = sx * sz * 2 + (sx + sz) * 4;
    const normal = R.scene.water.levels.values.normal;
    const dryPlane = levelM > normal + 0.01 && R.ground.dry.some((v) => v === 1) ? DRY_WATER_TRIANGLES : 0;
    return terrain + WATER_TRIANGLES + dryPlane + quality.mistLayers * MIST_TRIANGLES_PER_LAYER + STAND_TRIANGLES;
  };

  it.each([FULL_QUALITY, REDUCED_QUALITY])('$tier：每一节的模型都造得出来，镜头远远近近都没有坏掉的数', { timeout: 30_000 }, async (quality) => {
    // 这一项在发布流程的机器上要比默认的 5 秒久（这台机器上 2 秒左右）：给它自己的时限，不把要走的步数减少。
    const { R, models } = table(quality);
    // 和页面上一样：先备好，再一节一节换着显
    await models.prepare(R.headings);
    for (const section of R.scene.sections) {
      const levelM = R.scene.water.levels.values[section.water];
      for (const D of [1000, section.camera.distanceM, 60000]) {
        models.apply(section.heading, levelM, D);
        expect(models.triangles(), `${section.heading} 一个模型也没有显出来`).toBeGreaterThan(0);
        expect(brokenMeshes(models.group), `${section.heading} 有坏掉的模型`).toEqual([]);
      }
    }
  });

  it('浮桥：两个桥头都在干地上，离岸不到 60 米；两头中间有水（没有浮桥的沙盘算通过）', () => {
    const { R } = table();
    const { scene, samplers, coords } = R;
    const normal = scene.water.levels.values.normal;
    const mesh = meshHeightAt(samplers, coords);
    for (const bridge of scene.things.filter((t) => t.kind === 'pontoon-bridge')) {
      const line = (bridge.line ?? []).map((p) => coords.toLocal(p));
      expect(line, bridge.id).toHaveLength(2);
      for (const [name, [x, z]] of [['头一个桥头', line[0]], ['第二个桥头', line[1]]] as const) {
        // 干地：地面比平时的水面高半米以上，地形板上那里也画不出水
        expect(samplers.height(x, z), `${bridge.id} ${name}的地面`).toBeGreaterThan(normal + 0.5);
        expect(mesh(x, z) < normal && samplers.waterH(x, z) < normal - 0.25, `${bridge.id} ${name}在水里`).toBe(false);
        // 离岸：在岸的外面，不到 60 米
        expect(samplers.edge(x, z), `${bridge.id} ${name}离岸`).toBeGreaterThan(0);
        expect(samplers.edge(x, z), `${bridge.id} ${name}离岸`).toBeLessThan(60);
      }
      // 两头中间有画得出来的水
      let wet = 0;
      for (let i = 1; i < 50; i++) {
        const x = line[0][0] + ((line[1][0] - line[0][0]) * i) / 50;
        const z = line[0][1] + ((line[1][1] - line[0][1]) * i) / 50;
        if (mesh(x, z) < normal && samplers.waterH(x, z) < normal - 0.25) wet += 1;
      }
      expect(wet, `${bridge.id} 两头中间有水的地方`).toBeGreaterThan(10);
    }
  });

  it('木桩护岸：每根桩的顶都露在地面、盖在上面的土坡和平时的水面以上', () => {
    const { R } = table();
    const { scene, ground, samplers, coords } = R;
    const style = styleFor(scene.style);
    const ctx = { scene, ground, samplers, coords, style, quality: FULL_QUALITY };
    const waterY = coords.y(scene.water.levels.values.normal);
    for (const thing of scene.things.filter((t) => t.kind === 'timber-bank')) {
      const batch = new Batch();
      const pass: Pass = { ctx, survey: surveyWalls(ctx), yards: [], lots: [], bucket: () => ({ main: batch, raised: new Batch(), boats: [] }) };
      THING_BUILDERS['timber-bank'](pass, thing);
      // 桩是六棱的柱子，72 个顶点；横木是盒子，36 个
      const piles = (batch.parts.get('plainTimber') ?? []).filter((g) => g.attributes.position.count === 72);
      expect(piles.length, `${thing.name} 一根桩也没有`).toBeGreaterThan(5);
      const buried: string[] = [];
      for (const g of piles) {
        g.computeBoundingBox();
        const b = g.boundingBox;
        if (!b) throw new Error('量不出范围');
        const x = (b.min.x + b.max.x) / 2;
        const z = (b.min.z + b.max.z) / 2;
        const cover = Math.max(coords.y(samplers.height(x, z)), bankSurfaceY(pass, x, z) ?? -Infinity, waterY);
        // 桩露出来的一截至少有设计的八成
        if (b.max.y < cover + PILE_ABOVE * 0.8) buried.push(`(${x.toFixed(0)}, ${z.toFixed(0)}) 桩顶 ${b.max.y.toFixed(1)}，盖住它的东西到 ${cover.toFixed(1)}`);
        // 也不该立在水面上老高的地方：桩脚下就是岸或水
        expect(b.min.y).toBeLessThan(cover);
      }
      expect(buried, `${thing.name} 有 ${buried.length} 根桩埋在土里或水里`).toEqual([]);
    }
  });

  it(`每一节、镜头从 1 公里到 130 公里、两档画质：一个画面的三角形数都不超过 ${fmt(TRIANGLES_MAX)}`, async () => {
    const lines: string[] = [];
    const over: string[] = [];
    let worst = { total: 0, where: '' };
    for (const quality of [FULL_QUALITY, REDUCED_QUALITY]) {
      const { R, models } = table(quality);
      const { scene, coords } = R;
      await models.prepare(R.headings);
      const { sx, sz } = terrainGrid(coords);
      lines.push(
        `${key}（${quality.tier === 'full' ? '完整的一档' : '减配的一档'}）一个画面的三角形数`,
        `  地形板 ${fmt(sx * sz * 2 + (sx + sz) * 4)}（${sx} × ${sz} 格），水面 ${WATER_TRIANGLES}（大水时多 ${DRY_WATER_TRIANGLES}），云气 ${quality.mistLayers * MIST_TRIANGLES_PER_LAYER}，座子 ${STAND_TRIANGLES}`,
      );
      for (const section of scene.sections) {
        const cam = section.camera;
        const levelM = scene.water.levels.values[section.water];
        const rest = fixed(R, levelM, quality);
        // 场景里写的距离，在 900 像素高的画面上
        const authoredD = equivalentDistance(cam.distanceM, cam.fov ?? 21, 900);
        models.apply(section.heading, levelM, authoredD);
        const authored = models.triangles();
        const meshes = drawnMeshes(models.group);
        let most = 0;
        let mostAt = 0;
        let least = Infinity;
        let mostMeshes = 0;
        for (const D of sweepDistances()) {
          models.apply(section.heading, levelM, D);
          const n = models.triangles();
          if (n > most) {
            most = n;
            mostAt = D;
          }
          least = Math.min(least, n);
          mostMeshes = Math.max(mostMeshes, drawnMeshes(models.group));
        }
        const flag = most + rest > TRIANGLES_WARN ? '  ← 过了 180,000' : '';
        lines.push(
          `  ${section.heading}：照场景里写的距离（D ${fmt(authoredD)}）小模型 ${fmt(authored)}，合计 ${fmt(authored + rest)}，小模型画 ${meshes} 批；` +
            `最多是 D ${fmt(mostAt)} 时小模型 ${fmt(most)}，合计 ${fmt(most + rest)}；最少 ${fmt(least + rest)}；最多画 ${mostMeshes} 批${flag}`,
        );
        if (most + rest > TRIANGLES_MAX) over.push(`${section.heading}（${quality.tier}）：${fmt(most + rest)}`);
        if (most + rest > worst.total) worst = { total: most + rest, where: `${section.heading}，${quality.tier}，D ${fmt(mostAt)}` };
      }
    }
    lines.push(`${key} 最多的一处：${fmt(worst.total)}（${worst.where}），预算 ${fmt(TRIANGLES_MAX)}`);
    console.log(lines.join('\n'));
    expect(over).toEqual([]);
    expect(worst.total).toBeGreaterThan(0);
  });

  it('减配的一档比完整的一档少：每一节、同样的远近，小模型的三角形都少', async () => {
    const full = table(FULL_QUALITY);
    const reduced = table(REDUCED_QUALITY);
    await full.models.prepare(full.R.headings);
    await reduced.models.prepare(reduced.R.headings);
    for (const section of full.R.scene.sections) {
      const levelM = full.R.scene.water.levels.values[section.water];
      for (const D of [1000, 5000, 10000, 20000]) {
        full.models.apply(section.heading, levelM, D);
        reduced.models.apply(section.heading, levelM, D);
        expect(reduced.models.triangles(), `${section.heading}，D = ${D}`).toBeLessThan(full.models.triangles());
      }
      // 远到头：树留的都是次序在前面的三成多，两档留的是同一批；少的只是民居
      full.models.apply(section.heading, levelM, 120000);
      reduced.models.apply(section.heading, levelM, 120000);
      expect(reduced.models.triangles()).toBeLessThanOrEqual(full.models.triangles());
    }
  });
});
