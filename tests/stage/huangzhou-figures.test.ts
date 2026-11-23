// 场景验收：黄州这座沙盘上的模型，照建造设计和正文该有的样子查一遍。在 Node 里跑，不要浏览器。
// 各座沙盘都要查的那些（预算、每一节造不造得出来、船不搁在岸上、民居不压着）在 scene-budgets、scene-models、scene-figures 里；
// 这里只查黄州自己的。这一步（三夜要用的东西）先有的几样：
//   崖壁    是一个合起来的块，对着地形板量：崖脚在最低的水位以下；足高的地方崖顶比最高的水位高出 30 以上；崖面在朝江的一边；
//           崖顶盖住地形板上的那道斜坡（地形板哪里都不高出崖顶 1 以上），后沿收在地形板下面；三角形不超过 500 个。
//   云气    崖脚的线四周 150 米以内不起云气（云气的高度正好横在崖面上）。
//   崖脚的石头  只在水落才露出来的那一带里；放大到头，顶也在平时的水面以下。
//   两节赤壁  同一个地方、同一个角度：三种标准的画面上镜头一模一样（船只在七月那一节有，可两节都把它的线算进要看的点）。
//   船      崖下的小船七月那一夜浮在敞开的水上，不在崖里，也不在石滩上。
//   树      江里（长洲、水落才露的滩）、湖荡、门前的滩上一棵也没有：高水时那里是水。承天寺院里有柏有竹，减配的一档也有。
// 以后的几步（城、镜头和题签）往这里添。这里的数调过以后要重新跑；改了定下来的做法，场景文件里的依据要跟着改。

import { describe, expect, it } from 'vitest';
import { InstancedMesh, Matrix4, Mesh, Vector3 } from 'three';
import type { DataTexture, Object3D, ShaderMaterial } from 'three';
import { CLIFF, SHORE_ABOVE_LOWEST_M, SHORE_UNDER_NORMAL_M, cliffColumns, family as rockFamily } from '../../src/stage/three/families/rock';
import type { KitContext, ModelSet } from '../../src/stage/three/internal';
import { buildModels } from '../../src/stage/three/kit';
import { Batch } from '../../src/stage/three/kit/geo';
import type { Pass } from '../../src/stage/three/kit/pass';
import { insidePolygon, surveyWalls } from '../../src/stage/three/kit/site';
import { plantTrees } from '../../src/stage/three/kit/trees';
import { makeMaterials } from '../../src/stage/three/kit/materials';
import { meshHeightAt } from '../../src/stage/three/meshHeight';
import { buildMist } from '../../src/stage/three/mist';
import { FULL_QUALITY, REDUCED_QUALITY } from '../../src/stage/three/quality';
import { placeCamera } from '../../src/stage/three/rig';
import { styleFor } from '../../src/stage/three/style';
import type { Quality } from '../../src/stage/three/internal';
import { realScene } from './support/realScenes';
import { STANDARD_PANES } from './support/standardPanes';

const KEY = 'su-shi/huangzhou';
const R = realScene(KEY);
const { scene, coords, samplers, ground } = R;
const style = styleFor(scene.style);
const levels = scene.water.levels.values;
const lowest = Math.min(...Object.values(levels));
const highest = Math.max(...Object.values(levels));
const ctxOf = (quality: Quality = FULL_QUALITY): KitContext => ({ scene, ground, samplers, coords, style, quality, kit: R.kit });
const mesh = meshHeightAt(samplers, coords);

const JULY = '赤壁';
const OCTOBER = '十月，再到赤壁';

/** 只造一样东西用的那一趟：零件拿到的东西和总装时一样，形状都放进同一个批次。 */
function soloPass(ctx: KitContext): { pass: Pass; main: Batch } {
  const main = new Batch();
  const bucket = { main, raised: new Batch(), boats: [] };
  return { pass: { ctx, survey: surveyWalls(ctx), yards: [], lots: [], bucket: () => bucket }, main };
}

/** 一组模型里叫这个名字的成批的网格：每个实例属于哪条规则、在哪。 */
function instancesOf(root: Object3D, name: string): { rule: string; at: Vector3; visible: boolean }[] {
  const out: { rule: string; at: Vector3; visible: boolean }[] = [];
  root.traverse((o) => {
    if (!(o instanceof InstancedMesh) || !o.name.startsWith(name)) return;
    let shown = true;
    for (let p: Object3D | null = o; p; p = p.parent) shown &&= p.visible;
    const rules = o.userData.rules as string[];
    const m = new Matrix4();
    for (let i = 0; i < rules.length; i++) {
      o.getMatrixAt(i, m);
      out.push({ rule: rules[i], at: new Vector3().setFromMatrixPosition(m).applyMatrix4(o.matrixWorld), visible: shown });
    }
  });
  return out;
}

describe('黄州的崖壁（赤壁）', () => {
  const thing = scene.things.find((t) => t.id === 'chibi');
  const line = (thing?.line ?? []).map((p) => coords.toLocal(p));
  const cols = cliffColumns(ctxOf(), line);
  const full = cols.filter((c) => c.full);

  it('场景里是一样摆件，种类是崖壁；题签“赤壁”指着它', () => {
    expect(thing?.kind).toBe('cliff');
    expect(scene.places.some((p) => p.id === 'chibi'), '临时的那个地名点还在').toBe(false);
    expect(scene.strips.find((s) => s.id === 't-chibi')?.of).toBe('chibi');
    // 线大约 480 米，15 米上下一列
    const length = cols[cols.length - 1].u;
    expect(length).toBeGreaterThan(420);
    expect(length).toBeLessThan(540);
    expect(cols.length - 1).toBeGreaterThanOrEqual(28);
    expect(full.length).toBeGreaterThanOrEqual(20);
  });

  it('崖脚的每个顶点都在最低的水位以下：水落的两节崖脚也埋着，不露一道缝', () => {
    const waterY = coords.y(lowest);
    for (const c of cols) expect(c.foot[1], `沿线 ${c.u.toFixed(0)} 米处`).toBeLessThan(waterY);
    // 也在那里的地形板以下
    for (const c of cols) expect(c.foot[1]).toBeLessThan(coords.y(mesh(c.x, c.z)));
  });

  it('足高的地方，崖顶的边比最高的水位高出 30 以上（沙盘里的高度）；崖高 60 到 150', () => {
    const waterY = coords.y(highest);
    const above = full.map((c) => c.crown[1] - waterY);
    const tall = full.map((c) => c.crown[1] - c.foot[1]);
    console.log(`  崖壁：${cols.length - 1} 列，线长 ${cols[cols.length - 1].u.toFixed(0)} 米；足高处崖顶海拔 ${Math.min(...full.map((c) => c.crownM)).toFixed(1)} 到 ${Math.max(...full.map((c) => c.crownM)).toFixed(1)} 米，比最高的水位高 ${Math.min(...above).toFixed(0)} 到 ${Math.max(...above).toFixed(0)}，崖面高 ${Math.min(...tall).toFixed(0)} 到 ${Math.max(...tall).toFixed(0)}`);
    expect(Math.min(...above)).toBeGreaterThanOrEqual(30);
    expect(Math.min(...tall)).toBeGreaterThanOrEqual(60);
    expect(Math.max(...tall)).toBeLessThanOrEqual(150);
  });

  it('崖面在朝江的一边：每一列上，山都在崖顶往里的那一边', () => {
    for (const c of cols) {
      const hill = samplers.height(c.x + c.nx * CLIFF.sideM, c.z + c.nz * CLIFF.sideM);
      const river = samplers.height(c.x - c.nx * CLIFF.sideM, c.z - c.nz * CLIFF.sideM);
      expect(hill, `沿线 ${c.u.toFixed(0)} 米处`).toBeGreaterThan(river);
    }
    // 赤壁在城西：崖面朝西，山在东边
    const mean = cols.reduce((sum, c) => sum + c.nx, 0) / cols.length;
    expect(mean).toBeGreaterThan(0.7);
  });

  it('崖顶盖住了地形板上的那道斜坡：从崖顶的边到往里九成的地方，地形板哪里都不高出崖顶 1 以上；后沿不比地形板高出裙边那么多', () => {
    let poke = 0;
    let lip = -Infinity;
    let cover = 0;
    for (let i = 0; i < cols.length - 1; i++) {
      const a = cols[i];
      const b = cols[i + 1];
      for (let s = 0; s <= 1.0001; s += 0.25) {
        for (let t = 0; t <= 1.0001; t += 0.04) {
          const at = (k: 0 | 1 | 2): number => {
            const crown = a.crown[k] + (b.crown[k] - a.crown[k]) * s;
            const back = a.back[k] + (b.back[k] - a.back[k]) * s;
            return crown + (back - crown) * t;
          };
          const over = coords.y(mesh(at(0), at(2))) - at(1);
          if (t < 0.9) poke = Math.max(poke, over);
          if (t > 0.999) lip = Math.max(lip, -over);
          cover = Math.max(cover, -over);
        }
      }
    }
    console.log(`  崖顶对着地形板：地形板最多高出崖顶 ${poke.toFixed(2)}；崖顶最多高出地形板 ${cover.toFixed(0)}（它盖住的那道斜坡）；后沿比地形板高 ${lip.toFixed(2)}（负的是在地形板下面）`);
    expect(poke).toBeLessThanOrEqual(1);
    expect(lip).toBeLessThanOrEqual(CLIFF.skirtY);
    // 真的盖住了一道斜坡：不是摆在平地上的
    expect(cover).toBeGreaterThan(60);
  });

  it('两头的封口朝外：崖脚的线从哪一头写起都一样', () => {
    const build = rockFamily.things?.cliff;
    if (!thing?.line || !build) throw new Error('没有崖壁');
    for (const points of [thing.line, [...thing.line].reverse()]) {
      const { pass, main } = soloPass(ctxOf());
      build(pass, { ...thing, line: points });
      // 崖壁放进批次的是三块：崖面、崖顶、平的几面（后面的裙边，最后是两头的封口，各一块四边形、六个顶点）
      const flat = (main.parts.get('cliff') ?? [])[2];
      const pos = flat.attributes.position;
      const nor = flat.attributes.normal;
      const cx = line.reduce((sum, p) => sum + p[0], 0) / line.length;
      const cz = line.reduce((sum, p) => sum + p[1], 0) / line.length;
      for (let i = pos.count - 12; i < pos.count; i++) {
        // 封口在线的两头：它的法线背着线的中间
        const away = (pos.getX(i) - cx) * nor.getX(i) + (pos.getZ(i) - cz) * nor.getZ(i);
        expect(away, `第 ${i} 个顶点`).toBeGreaterThan(0);
      }
    }
  });

  it('造出来不超过 500 个三角形，用的是它自己的一种材质；不归类（不跟着远近放大）', () => {
    const { pass, main } = soloPass(ctxOf());
    const build = rockFamily.things?.cliff;
    if (!thing || !build) throw new Error('没有崖壁');
    build(pass, thing);
    expect([...main.parts.keys()]).toEqual(['cliff']);
    console.log(`  崖壁 ${main.tris} 个三角形`);
    expect(main.tris).toBeLessThanOrEqual(500);
    expect(main.tris).toBeGreaterThan(300);
    for (const g of main.parts.get('cliff') ?? []) {
      const fig = g.attributes.aFig;
      for (let i = 0; i < fig.count; i++) expect(fig.getX(i)).toBe(0);
      const pos = g.attributes.position;
      for (let i = 0; i < pos.count * 3; i++) expect(Number.isFinite(pos.array[i])).toBe(true);
    }
    // 这种材质零件库里有（跟着这一家来的）
    expect(Object.keys(makeMaterials(style, R.kit?.materials).named)).toContain('cliff');
  });
});

describe('黄州崖壁四周的云气', () => {
  it('崖脚的线四周 150 米以内，三层云气平时、涨水时都是空的；远处（山脚）还有云气', () => {
    const mist = buildMist({ ground, samplers, coords, scene, style, layers: 3 });
    const line = (scene.things.find((t) => t.id === 'chibi')?.line ?? []).map((p) => coords.toLocal(p));
    const away = (x: number, z: number): number => {
      let d = Infinity;
      for (let i = 1; i < line.length; i++) {
        const [ax, az] = line[i - 1];
        const [bx, bz] = line[i];
        const t = Math.min(1, Math.max(0, ((x - ax) * (bx - ax) + (z - az) * (bz - az)) / ((bx - ax) ** 2 + (bz - az) ** 2)));
        d = Math.min(d, Math.hypot(x - ax - (bx - ax) * t, z - az - (bz - az) * t));
      }
      return d;
    };
    const M = 420;
    let near = 0;
    let nearMax = 0;
    let farMax = 0;
    for (const mesh of mist.group.children) {
      if (!(mesh instanceof Mesh)) continue;
      const uniforms = (mesh.material as ShaderMaterial).uniforms;
      for (const key of ['uA', 'uB']) {
        const texture = uniforms[key].value as DataTexture;
        const { data, width, height } = texture.image as { data: Uint8Array; width: number; height: number };
        for (let j = 0; j < height; j++) {
          for (let i = 0; i < width; i++) {
            const x = coords.x0 - M + (i / (width - 1)) * (coords.x1 - coords.x0 + 2 * M);
            const z = coords.z0 - M + (j / (height - 1)) * (coords.z1 - coords.z0 + 2 * M);
            const d = away(x, z);
            const v = data[j * width + i];
            if (d < 150) {
              near++;
              nearMax = Math.max(nearMax, v);
            } else if (d > 600) farMax = Math.max(farMax, v);
          }
        }
      }
    }
    mist.dispose();
    expect(near).toBeGreaterThan(100);
    expect(nearMax).toBe(0);
    expect(farMax).toBeGreaterThan(40);
  });
});

describe('黄州崖脚的石头', () => {
  const rule = scene.dressing.find((d) => d.id === 'rocks-chibi');
  const lay = rockFamily.rocks?.shore;
  if (!rule || !lay) throw new Error('没有崖脚的石头');
  const rocks = lay(soloPass(ctxOf()).pass, rule);

  it('摆得出来；都落在水落才露出来的那一带里：比最低的水位高、比平时的水位低 1.5 米以上', () => {
    expect(rocks.length).toBeGreaterThanOrEqual(25);
    expect(rocks.length).toBeLessThanOrEqual(40);
    for (const rock of rocks) {
      const h = samplers.height(rock.foot[0], rock.foot[2]);
      expect(h).toBeGreaterThanOrEqual(lowest + SHORE_ABOVE_LOWEST_M);
      expect(h).toBeLessThanOrEqual(levels.normal - SHORE_UNDER_NORMAL_M);
    }
  });

  it('放大到头（这一类最多放大的倍数），每块石头的顶也在平时的水面以下；脚不悬在地形板上面', () => {
    const grow = style.figure.rules.rock.maxTimes;
    const normalY = coords.y(levels.normal);
    let top = -Infinity;
    for (const rock of rocks) {
      // 石头的形状最高到它竖向大小的 0.92 倍（shapes.ts 的 rockGeo：0.72 × 1.28）
      const peak = rock.foot[1] + rock.size[1] * 0.92 * grow;
      top = Math.max(top, peak - normalY);
      expect(peak).toBeLessThan(normalY);
      expect(rock.foot[1]).toBeLessThan(coords.y(mesh(rock.foot[0], rock.foot[2])));
    }
    console.log(`  崖脚的石头 ${rocks.length} 块；放大到 ${grow} 倍时最高的一块顶在平时的水面以下 ${(-top).toFixed(1)}`);
  });
});

describe('黄州的两节赤壁', () => {
  const july = scene.sections.find((s) => s.heading === JULY);
  const october = scene.sections.find((s) => s.heading === OCTOBER);
  if (!july || !october) throw new Error('没有这两节');

  it('要看的点是同一份：崖、崖脚的石头、崖下的船（船只在七月那一节有）', () => {
    expect(july.camera.mustShow).toEqual(['chibi', 'rocks-chibi', 'boat-chibi']);
    expect(october.camera).toEqual(july.camera);
  });

  it.each(STANDARD_PANES.slice(0, 3))('$name 上两节的镜头一模一样', (pane) => {
    const a = placeCamera(july, scene, samplers, coords, style, pane.size, pane.insets);
    const b = placeCamera(october, scene, samplers, coords, style, pane.size, pane.insets);
    expect(b.fit).toBe(a.fit);
    expect(b.reach).toEqual(a.reach);
    expect(b.points).toEqual(a.points);
  });

  it('七月是夜里，月亮在东南偏东、24 度高（那一夜九点上下）；十月也是夜里，月亮高；水一高一低', () => {
    expect(july.sky).toBe('night');
    expect(july.moon).toEqual({ azimuth: 111, altitude: 24 });
    expect(october.sky).toBe('night');
    expect(october.moon?.altitude).toBeGreaterThan(60);
    expect(levels[july.water]).toBe(highest);
    expect(levels[october.water]).toBe(lowest);
  });
});

describe('黄州的船和树', () => {
  const tables = new Map<string, ModelSet>();
  const table = async (quality: Quality): Promise<ModelSet> => {
    let models = tables.get(quality.tier);
    if (!models) {
      models = buildModels(ctxOf(quality));
      await models.prepare(R.headings);
      tables.set(quality.tier, models);
    }
    return models;
  };

  it('崖下的小船七月那一夜浮在敞开的水上：脚下的水至少 2 米深，离崖脚的线 60 米以上，不在石滩上', { timeout: 30_000 }, async () => {
    const models = await table(FULL_QUALITY);
    models.apply(JULY, highest, 3800);
    models.group.updateMatrixWorld(true);
    const boats = instancesOf(models.group, 'boats').filter((b) => b.rule === 'boat-chibi' && b.visible);
    expect(boats).toHaveLength(1);
    const cliff = (scene.things.find((t) => t.id === 'chibi')?.line ?? []).map((p) => coords.toLocal(p));
    for (const boat of boats) {
      const depth = highest - samplers.height(boat.at.x, boat.at.z);
      expect(depth).toBeGreaterThanOrEqual(2);
      let d = Infinity;
      for (let i = 1; i < cliff.length; i++) {
        const [ax, az] = cliff[i - 1];
        const [bx, bz] = cliff[i];
        const t = Math.min(1, Math.max(0, ((boat.at.x - ax) * (bx - ax) + (boat.at.z - az) * (bz - az)) / ((bx - ax) ** 2 + (bz - az) ** 2)));
        d = Math.min(d, Math.hypot(boat.at.x - ax - (bx - ax) * t, boat.at.z - az - (bz - az) * t));
      }
      console.log(`  崖下的小船：脚下水深 ${depth.toFixed(1)} 米，离崖脚的线 ${d.toFixed(0)} 米`);
      expect(d).toBeGreaterThan(60);
    }
    // 十月那一节没有这条船
    models.apply(OCTOBER, lowest, 3800);
    expect(instancesOf(models.group, 'boats').filter((b) => b.rule === 'boat-chibi' && b.visible)).toHaveLength(0);
  });

  it('江里、湖荡、门前的滩和夏澳里一棵树也没有；整块沙盘上没有哪棵树的脚在最高的水位以下', () => {
    const ctx = ctxOf();
    const trees = plantTrees(ctx, surveyWalls(ctx), makeMaterials(style, R.kit?.materials).treeColours);
    expect(trees.length).toBeGreaterThan(300);
    const rule = scene.dressing.find((d) => d.id === 'trees-hills');
    expect(rule?.except).toEqual(['river-bed', 'east-lake', 'lingao-apron', 'xiaao']);
    for (const id of rule?.except ?? []) {
      const edit = scene.terrain.edits.find((e) => e.id === id);
      if (edit?.op !== 'level' || !edit.area) throw new Error(`${id} 没有范围`);
      const area = edit.area.map((p) => coords.toLocal(p));
      const index = scene.dressing.indexOf(rule as NonNullable<typeof rule>);
      expect(trees.filter((t) => t.rule === index && insidePolygon(area, t.x, t.z)), `${edit.name}里有树`).toHaveLength(0);
    }
    // 不管哪条规则种的：高水时脚下是水的树一棵也没有（长洲、敞开的水面上都没有）
    const drowned = trees.filter((t) => t.wet < highest);
    expect(drowned.map((t) => `${scene.dressing[t.rule].id} (${t.x.toFixed(0)}, ${t.z.toFixed(0)}) 地面 ${t.wet.toFixed(1)} 米`)).toEqual([]);
  });

  it.each([FULL_QUALITY, REDUCED_QUALITY])('$tier：承天寺院里有柏有竹，都是细高的苔点，在院子里；山坡上有成丛的竹', { timeout: 30_000 }, async (quality) => {
    const models = await table(quality);
    models.apply('承天寺', lowest, 2400);
    models.group.updateMatrixWorld(true);
    const dots = instancesOf(models.group, 'trees:').filter((t) => t.visible);
    const count = (id: string): number => dots.filter((t) => t.rule === id).length;
    const full = quality.tier === 'full';
    console.log(`  ${quality.tier}：院里的柏 ${count('chengtian-cypress')} 棵，竹 ${count('chengtian-bamboo')} 竿，山坡上的竹 ${count('bamboo-hills')} 竿`);
    expect(count('chengtian-cypress')).toBeGreaterThanOrEqual(full ? 3 : 1);
    expect(count('chengtian-bamboo')).toBeGreaterThanOrEqual(full ? 9 : 3);
    expect(count('bamboo-hills')).toBeGreaterThanOrEqual(full ? 150 : 60);
    // 都在寺的院子里：离寺的中心不到 80 米
    const temple = scene.things.find((t) => t.id === 'chengtian');
    if (!temple?.at) throw new Error('没有承天寺');
    const [tx, tz] = coords.toLocal(temple.at);
    for (const t of dots.filter((d) => d.rule === 'chengtian-cypress' || d.rule === 'chengtian-bamboo')) expect(Math.hypot(t.at.x - tx, t.at.z - tz)).toBeLessThan(80);
  });
});
