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
// 白天的城（第 3 步 U3）添的几样：
//   东坡的田  整块是青苗的草绿，和四周的平地分得开；田上没有整块沙盘那条规则种的树，题签指的那一点不在树冠底下；
//             雪堂那一组放大以后盖不住田（不到一成）。
//   雪堂    “东坡”一节的镜头从堂的正面那一边看（堂边的柳和枣栗都种在两侧和后面）；屋顶在两种屏幕上够大。
//   临皋亭的亭子  跟着屋子摊开，一路上脚下的地面都比最高的水位高。
//   院子    哪一座院落的院子里都没有田；只有承天寺的院子是浅色的，比四周的平地浅，定惠院、安国寺、州衙的不是。
//   土墙和门  五段矮土墙、一座小门造得出来：夯土，不归类；塌了的高高低低，带篱笆的中间是篱笆；它们不围出一座城。
//   夜里的几样  崖面的法线往上抬过；十月那一节不起云气，七月那一节照旧。
// 镜头、题签和题记（第 3 步 U4，对着图片定下来的）在文件的最后：
//   三夜的月亮  是研究记录里那一夜的钟点；样式照月亮的高矮给的月光、天光、水面亮几倍钉在那里，写着各是为了什么。
//   头一节     题记先说从哪边往哪边看。
//   几个镜头   “一天一百五十钱”离临皋亭近；“寒食，沙湖”里夏澳的船不在亭子的正后面；两节赤壁的“大江”挂在点的下面，
//             不站在石滩上；“要走了”里雪堂在近处、汝州在沙盘边上；“承天寺”里寺和江边的临皋亭在一个画面里。
// 这里的数调过以后要重新跑；改了定下来的做法，场景文件里的依据要跟着改。

import { describe, expect, it } from 'vitest';
import { Color, InstancedMesh, Matrix4, Mesh, PerspectiveCamera, Vector3 } from 'three';
import type { BufferGeometry, DataTexture, Object3D, ShaderMaterial } from 'three';
import type { SceneThing } from '../../src/domain/scene';
import { sectionInfo } from '../../src/domain/sceneText';
import { paintColour, yardLayout } from '../../src/stage/ground';
import type { Vec2 } from '../../src/stage/ground/types';
import { CLIFF, EARTH_WALL, FACE_LEAN, SHORE_ABOVE_LOWEST_M, SHORE_UNDER_NORMAL_M, SMALL_GATE, cliffColumns, earthWallPieces, family as rockFamily } from '../../src/stage/three/families/rock';
import type { KitContext, ModelSet } from '../../src/stage/three/internal';
import { buildModels } from '../../src/stage/three/kit';
import { equivalentDistance, figureNow, figureTimes } from '../../src/stage/three/kit/figure';
import { Batch } from '../../src/stage/three/kit/geo';
import type { Pass } from '../../src/stage/three/kit/pass';
import { insidePolygon, surveyWalls } from '../../src/stage/three/kit/site';
import { plantTrees } from '../../src/stage/three/kit/trees';
import { makeMaterials } from '../../src/stage/three/kit/materials';
import { meshHeightAt } from '../../src/stage/three/meshHeight';
import { buildMist } from '../../src/stage/three/mist';
import { FULL_QUALITY, REDUCED_QUALITY } from '../../src/stage/three/quality';
import { centreShift, placeCamera, project } from '../../src/stage/three/rig';
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

  it('崖面的法线往上抬过：每个顶点的法线都朝上 37 度以上（崖面背着光，亮不亮全看天光；不抬，夜里它是一块黑）；崖面的颜色分得出几带', () => {
    const { pass, main } = soloPass(ctxOf());
    const build = rockFamily.things?.cliff;
    if (!thing || !build) throw new Error('没有崖壁');
    build(pass, thing);
    // 头一块是崖面
    const face = (main.parts.get('cliff') ?? [])[0];
    const nor = face.attributes.normal;
    let lowestUp = Infinity;
    for (let i = 0; i < nor.count; i++) {
      expect(Math.hypot(nor.getX(i), nor.getY(i), nor.getZ(i))).toBeCloseTo(1, 5);
      lowestUp = Math.min(lowestUp, nor.getY(i));
    }
    expect(FACE_LEAN).toBeGreaterThanOrEqual(1);
    expect(lowestUp).toBeGreaterThan(0.6);
    // 崖面朝着河：每一个三角形（照顶点的先后算出来的那一面）都背着它那一列的山。法线抬过，上面那一条查不出铺反了的面
    const at = face.attributes.position;
    // 交给零件库以后面是摊开的：每三个顶点一个三角形（有顶点先后表的话照表读）
    const tri = face.index;
    const corner = (k: number): number => (tri ? tri.getX(k) : k);
    const corners = tri ? tri.count : at.count;
    const point = (i: number): [number, number, number] => [at.getX(i), at.getY(i), at.getZ(i)];
    const nearest = (p: [number, number, number]) => cols.reduce((best, c) => (Math.hypot(c.x - p[0], c.z - p[2]) < Math.hypot(best.x - p[0], best.z - p[2]) ? c : best), cols[0]);
    let facing = 0;
    for (let t = 0; t < corners; t += 3) {
      const [a, b, c] = [point(corner(t)), point(corner(t + 1)), point(corner(t + 2))];
      const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
      const col = nearest(a);
      // 两头矮下去的几列不看（崖只有半米高，面几乎是躺着的）
      if (Math.min(col.u, cols[cols.length - 1].u - col.u) < CLIFF.taperM) continue;
      expect(n[0] * -col.nx + n[2] * -col.nz, `第 ${t / 3} 个三角形`).toBeGreaterThan(0);
      facing++;
    }
    expect(facing).toBeGreaterThan(20);
    // 几带：崖脚一带最深，中间那道台口最亮；最亮的一带比最深的一带亮出一半以上（顶点上的颜色，线性的光）
    const pos = face.attributes.position;
    const col = face.attributes.color;
    const lum = (i: number): number => 0.2126 * col.getX(i) + 0.7152 * col.getY(i) + 0.0722 * col.getZ(i);
    let low = Infinity;
    let high = -Infinity;
    for (let i = 0; i < pos.count; i++) {
      low = Math.min(low, pos.getY(i));
      high = Math.max(high, pos.getY(i));
    }
    const band = (from: number, to: number): number => {
      const values: number[] = [];
      for (let i = 0; i < pos.count; i++) {
        const t = (pos.getY(i) - low) / (high - low);
        if (t >= from && t < to) values.push(lum(i));
      }
      return values.reduce((sum, v) => sum + v, 0) / values.length;
    };
    const foot = band(0, 0.1);
    const upper = band(0.45, 0.75);
    console.log(`  崖面：法线最少朝上 ${((Math.asin(lowestUp) * 180) / Math.PI).toFixed(0)} 度；崖脚一带的亮 ${foot.toFixed(3)}，中上一带 ${upper.toFixed(3)}（${(upper / foot).toFixed(2)} 倍）`);
    expect(upper / foot).toBeGreaterThan(1.5);
    // 红褐色：红的比蓝的多得多
    for (let i = 0; i < col.count; i += 7) expect(col.getX(i)).toBeGreaterThan(col.getZ(i) * 2);
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
    // 2026-11-23 看过夜里的样张以后：少一半（20 块上下），大一倍
    expect(rocks.length).toBeGreaterThanOrEqual(12);
    expect(rocks.length).toBeLessThanOrEqual(20);
    for (const rock of rocks) {
      const h = samplers.height(rock.foot[0], rock.foot[2]);
      expect(h).toBeGreaterThanOrEqual(lowest + SHORE_ABOVE_LOWEST_M);
      expect(h).toBeLessThanOrEqual(levels.normal - SHORE_UNDER_NORMAL_M);
    }
  });

  it('石头宽 16 到 41 米；只有石头的三种颜色（红褐、灰褐、深褐），没有黄的和浅的', () => {
    const colour = (name: string): number[] => {
      const c = new Color(style.palette[name]);
      return [c.r, c.g, c.b];
    };
    const pale = colour('rockPale');
    const allowed = ['shoreRed', 'shoreBrown', 'shoreDark'].map(colour);
    expect(Object.keys(style.palette).filter((name) => name.startsWith('shore')).sort()).toEqual(['shoreBrown', 'shoreDark', 'shoreRed']);
    const used = new Set<number>();
    for (const rock of rocks) {
      expect(2 * rock.size[0]).toBeGreaterThanOrEqual(16);
      expect(2 * rock.size[0]).toBeLessThanOrEqual(41);
      // 石头用的是浅色的那种材质，颜色是在它上面乘的：乘回去，是三种里的一种
      const got = (rock.tint ?? [1, 1, 1]).map((k, i) => k * pale[i]);
      const which = allowed.findIndex((c) => c.every((v, i) => Math.abs(v - got[i]) < 1e-6));
      expect(which, `(${got.map((v) => v.toFixed(3)).join(', ')}) 不是三种颜色里的一种`).toBeGreaterThanOrEqual(0);
      used.add(which);
      // 都比平地暗得多（浅的那种是 0.69 上下）：石头在浅色的石滩上看得出来
      expect(0.2126 * got[0] + 0.7152 * got[1] + 0.0722 * got[2]).toBeLessThan(0.2);
    }
    expect(used.size).toBe(3);
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

  it('江里、湖荡、门前的滩、夏澳里和东坡的那块坡地上一棵整块沙盘那条规则的树也没有；整块沙盘上没有哪棵树的脚在最高的水位以下', () => {
    const ctx = ctxOf();
    const trees = plantTrees(ctx, surveyWalls(ctx), makeMaterials(style, R.kit?.materials).treeColours);
    expect(trees.length).toBeGreaterThan(300);
    const rule = scene.dressing.find((d) => d.id === 'trees-hills');
    expect(rule?.except).toEqual(['river-bed', 'east-lake', 'lingao-apron', 'xiaao', 'dongpo-field']);
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

// ---------------------------------------------------------------- 白天的城（第 3 步 U3）

const EAST = '东坡';
/** 地面的颜色：照现在的场景和样式现画一遍（和“先画好的地面”是同一个函数）。一格 10 米。 */
const painted = paintColour(ground, style.ground);
const texelStep = ground.cell / 2;
/** 颜色图上一格的中心在沙盘上的哪里。 */
const texelAt = (i: number, j: number): Vec2 => [ground.x0 + i * texelStep, ground.z0 + j * texelStep];
/** 一圈线里面、离线至少 inside 米的每一格：颜色（0 到 255）和“有没有田”的那一个数。 */
function texelsIn(ring: Vec2[], inside: number): { x: number; z: number; rgb: [number, number, number]; field: number }[] {
  const out: { x: number; z: number; rgb: [number, number, number]; field: number }[] = [];
  const xs = ring.map((p) => p[0]);
  const zs = ring.map((p) => p[1]);
  const i0 = Math.max(0, Math.floor((Math.min(...xs) - ground.x0) / texelStep));
  const i1 = Math.min(painted.w - 1, Math.ceil((Math.max(...xs) - ground.x0) / texelStep));
  const j0 = Math.max(0, Math.floor((Math.min(...zs) - ground.z0) / texelStep));
  const j1 = Math.min(painted.h - 1, Math.ceil((Math.max(...zs) - ground.z0) / texelStep));
  /** 这一点离这圈线最近的一段多远。 */
  const off = (x: number, z: number): number => {
    let d = Infinity;
    for (let k = 0; k < ring.length; k++) {
      const [ax, az] = ring[k];
      const [bx, bz] = ring[(k + 1) % ring.length];
      const t = Math.min(1, Math.max(0, ((x - ax) * (bx - ax) + (z - az) * (bz - az)) / ((bx - ax) ** 2 + (bz - az) ** 2)));
      d = Math.min(d, Math.hypot(x - ax - (bx - ax) * t, z - az - (bz - az) * t));
    }
    return d;
  };
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      const [x, z] = texelAt(i, j);
      if (!insidePolygon(ring, x, z) || off(x, z) < inside) continue;
      const k = (j * painted.w + i) * 4;
      out.push({ x, z, rgb: [painted.colour[k], painted.colour[k + 1], painted.colour[k + 2]], field: painted.colour[k + 3] });
    }
  }
  return out;
}
const mean = (values: number[]): number => values.reduce((sum, v) => sum + v, 0) / values.length;
const lumOf = (rgb: [number, number, number]): number => 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
/** '#rrggbb' 写成三个 0 到 255 的数。 */
const hexRgb = (hex: string): [number, number, number] => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
/** 一组院落围墙的那一圈（沙盘里的 x、z）。这里只管朝南的院落（不写朝向就是朝南）。 */
function yardRing(thing: SceneThing): Vec2[] {
  if (!thing.at) throw new Error(`${thing.id} 没有写 at`);
  if ((thing.facing ?? 180) !== 180) throw new Error(`${thing.id} 不是朝南的`);
  const [cx, cz] = coords.toLocal(thing.at);
  const yard = yardLayout(typeof thing.params?.halls === 'number' ? thing.params.halls : 2);
  return [
    [cx - yard.halfWidth, cz + yard.back],
    [cx + yard.halfWidth, cz + yard.back],
    [cx + yard.halfWidth, cz + yard.front],
    [cx - yard.halfWidth, cz + yard.front],
  ];
}
/** 一圈方的线往外放大 by 米。 */
const grown = (ring: Vec2[], by: number): Vec2[] => [
  [ring[0][0] - by, ring[0][1] - by],
  [ring[1][0] + by, ring[1][1] - by],
  [ring[2][0] + by, ring[2][1] + by],
  [ring[3][0] - by, ring[3][1] + by],
];
const thingOf = (id: string): SceneThing => {
  const thing = scene.things.find((t) => t.id === id);
  if (!thing) throw new Error(`场景里没有 ${id}`);
  return thing;
};
/** 一个点离一条折线多远。 */
function offLine(x: number, z: number, line: Vec2[]): number {
  let d = Infinity;
  for (let i = 1; i < line.length; i++) {
    const [ax, az] = line[i - 1];
    const [bx, bz] = line[i];
    const t = Math.min(1, Math.max(0, ((x - ax) * (bx - ax) + (z - az) * (bz - az)) / ((bx - ax) ** 2 + (bz - az) ** 2)));
    d = Math.min(d, Math.hypot(x - ax - (bx - ax) * t, z - az - (bz - az) * t));
  }
  return d;
}

describe('黄州：东坡的田和雪堂', () => {
  const rule = scene.dressing.find((d) => d.id === 'fields-dongpo');
  if (!rule?.area) throw new Error('没有东坡的田');
  const ring = rule.area.map((p) => coords.toLocal(p));
  const core = texelsIn(ring, 25);
  const hall = thingOf('xuetang');
  const [hx, hz] = coords.toLocal(hall.at as [number, number]);
  const section = scene.sections.find((s) => s.heading === EAST);
  if (!section) throw new Error('没有“东坡”这一节');
  const allTrees = () => {
    const ctx = ctxOf();
    return plantTrees(ctx, surveyWalls(ctx), makeMaterials(style, R.kit?.materials).treeColours);
  };

  it('田是青苗的草绿（正文：“地里一片青”）：田心每一格都偏绿，四周茶色的平地不偏绿，两样分得开', () => {
    expect(rule.params?.green).toBe(true);
    expect(core.length).toBeGreaterThan(150);
    // 偏绿：绿比红多。样式里的草绿是 (169, 191, 126)，平地的茶色是 (230, 217, 184)
    const green = core.map((t) => t.rgb[1] - t.rgb[0]);
    expect(Math.min(...green)).toBeGreaterThan(0);
    expect(mean(green)).toBeGreaterThan(12);
    // 田的标记（近看的田垄）也在
    expect(mean(core.map((t) => t.field))).toBeGreaterThan(140);
    // 四周的平地：田南头再往南 120 到 320 米、东西各 150 米的一块（压平了的缓坡，上面没有山的颜色）
    const south = Math.max(...ring.map((p) => p[1]));
    const midX = mean(ring.map((p) => p[0]));
    const plain = texelsIn(
      [
        [midX - 150, south + 120],
        [midX + 150, south + 120],
        [midX + 150, south + 320],
        [midX - 150, south + 320],
      ],
      0,
    );
    expect(plain.length).toBeGreaterThan(400);
    const plainGreen = mean(plain.map((t) => t.rgb[1] - t.rgb[0]));
    console.log(`  东坡的田：田心 ${core.length} 格，绿比红多 ${mean(green).toFixed(1)}（最少 ${Math.min(...green)}），亮 ${mean(core.map((t) => lumOf(t.rgb))).toFixed(0)}；南面的平地绿比红多 ${plainGreen.toFixed(1)}，亮 ${mean(plain.map((t) => lumOf(t.rgb))).toFixed(0)}`);
    expect(plainGreen).toBeLessThan(-5);
    // 也比平地暗一些：不光是颜色不一样
    expect(mean(core.map((t) => lumOf(t.rgb)))).toBeLessThan(mean(plain.map((t) => lumOf(t.rgb))) - 15);
  });

  it('题签“东坡”指的那一点在田里，不在哪棵树的树冠底下', () => {
    const strip = scene.strips.find((s) => s.id === 't-dongpo');
    if (!strip?.at) throw new Error('没有“东坡”这条题签');
    const [px, pz] = coords.toLocal(strip.at);
    expect(insidePolygon(ring, px, pz)).toBe(true);
    // 树冠：苔点的半径就是它的大小；细做的一棵（大小是倍数）算 14 米
    const over = allTrees().filter((t) => Math.hypot(t.x - px, t.z - pz) < (t.sy === undefined ? 14 * t.s : t.s) + 8);
    expect(over.map((t) => `${scene.dressing[t.rule].id} (${t.x.toFixed(0)}, ${t.z.toFixed(0)})`)).toEqual([]);
  });

  it('“东坡”一节的镜头从雪堂的正面那一边看：堂边的柳和枣栗都种在两侧和后面，正面左右各 70 度空着，镜头在这一块里', () => {
    // 堂朝南（facing 180）：正面是 +z
    expect(hall.facing).toBe(180);
    const trees = allTrees();
    /** 从堂看过去，这个方向偏离正面多少度。 */
    const offFront = (dx: number, dz: number): number => (Math.acos(dz / Math.hypot(dx, dz)) * 180) / Math.PI;
    for (const id of ['xuetang-willow', 'dongpo-fruit']) {
      const index = scene.dressing.findIndex((d) => d.id === id);
      const mine = trees.filter((t) => t.rule === index);
      expect(mine.length, id).toBeGreaterThanOrEqual(3);
      for (const t of mine) expect(offFront(t.x - hx, t.z - hz), `${id} (${t.x.toFixed(0)}, ${t.z.toFixed(0)})`).toBeGreaterThanOrEqual(69);
    }
    // 镜头朝 bearing 那边看，它自己在反过来的那一边：bearing 0 是朝北看，镜头在南
    const b = (section.camera.bearing * Math.PI) / 180;
    const camera = offFront(-Math.sin(b), Math.cos(b));
    console.log(`  “东坡”一节：镜头在雪堂正面偏 ${camera.toFixed(0)} 度的方向上`);
    expect(camera).toBeLessThanOrEqual(50);
  });

  it.each([STANDARD_PANES[0], STANDARD_PANES[2]])('$name：“东坡”一节雪堂的屋顶够大，放大以后的篱笆那一圈盖不住田（不到一成）', (pane) => {
    const placed = placeCamera(section, scene, samplers, coords, style, pane.size, pane.insets);
    const D = equivalentDistance(placed.distanceM, section.camera.fov ?? 21, pane.size.height);
    const times = figureTimes(style, 'hut', D);
    // 折算过的远近上，一米合多少像素（900 像素高、21 度的画面：2428 ÷ D）
    const roofPx = (29 * times * 2428) / D;
    // 篱笆那一圈：屋外 14 米，宽 52、深 56 米（kit/figure.ts 的 plotOf），绕着屋脚放大
    const covered = core.filter((t) => Math.abs(t.x - hx) <= 26 * times && Math.abs(t.z - hz) <= 28 * times).length / core.length;
    console.log(`  ${pane.name}：“东坡”一节折算过的远近 ${D.toFixed(0)}，雪堂放大 ${times.toFixed(2)} 倍，屋顶宽 ${roofPx.toFixed(1)} 像素；篱笆那一圈盖住田心的 ${(covered * 100).toFixed(1)}%`);
    expect(roofPx).toBeGreaterThanOrEqual(15);
    expect(covered).toBeLessThan(0.1);
  });
});

describe('黄州：临皋亭的亭子', () => {
  it('跟着屋子摊开，从本来的地方到摊开到头，一路上脚下的地面都比最高的水位高', () => {
    const [hx, hz] = coords.toLocal(thingOf('lingao').at as [number, number]);
    const [px, pz] = coords.toLocal(thingOf('lingao-pavilion').at as [number, number]);
    const max = style.figure.rules.hut.spreadAtMax ?? 1;
    expect(max).toBeGreaterThan(1);
    let low = Infinity;
    for (let step = 0; step <= 20; step++) {
      const spread = 1 + ((max - 1) * step) / 20;
      const h = samplers.height(hx + (px - hx) * spread, hz + (pz - hz) * spread);
      low = Math.min(low, h);
      expect(h, `摊开 ${spread.toFixed(2)} 倍`).toBeGreaterThan(highest);
    }
    // 摊开几倍照样式里这一类的规矩算（figureNow）：近处是 1，远了到头
    expect(figureNow(style.figure.rules.hut, 1000).spread).toBeCloseTo(1, 3);
    expect(figureNow(style.figure.rules.hut, 1e6).spread).toBeCloseTo(max, 3);
    console.log(`  临皋亭的亭子：摊开 1 到 ${max} 倍，脚下的地面最低 ${low.toFixed(1)} 米（最高的水位 ${highest}）`);
  });
});

describe('黄州：院子', () => {
  const yards = scene.things.filter((t) => t.kind === 'hall-group');
  // 州衙顺着山坡（朝向也不是正南），院子不是一块平地：下面只看平地上的三座寺
  const temples = yards.filter((t) => t.params?.terraced !== true);

  it('三座寺的院子里都没有田', () => {
    expect(yards.map((t) => t.id).sort()).toEqual(['anguo', 'chengtian', 'dinghui', 'yamen']);
    expect(temples.map((t) => t.id).sort()).toEqual(['anguo', 'chengtian', 'dinghui']);
    for (const yard of temples) {
      const inside = texelsIn(yardRing(yard), 0);
      expect(inside.length, yard.id).toBeGreaterThan(200);
      expect(Math.max(...inside.map((t) => t.field)), `${yard.name}的院子里有田`).toBeLessThan(40);
    }
  });

  it('只有承天寺的院子是浅色的（“庭下如积水空明”）：围墙里面比墙外的平地浅，颜色不漫到墙外；别的院子不是', () => {
    expect(yards.filter((t) => t.params?.paleYard === true).map((t) => t.id)).toEqual(['chengtian']);
    expect(ground.courts).toHaveLength(1);
    const ring = yardRing(thingOf('chengtian'));
    // 地面那一边算的那一圈，和这里照院落的排法算的是同一圈
    ground.courts[0].forEach((p, i) => {
      expect(p[0]).toBeCloseTo(ring[i][0], 6);
      expect(p[1]).toBeCloseTo(ring[i][1], 6);
    });
    const court = lumOf(hexRgb(style.ground.colours.court));
    const inside = texelsIn(ring, 14).map((t) => lumOf(t.rgb));
    // 墙外一圈：围墙往外 30 到 90 米
    const near = grown(ring, 30);
    const outside = texelsIn(grown(ring, 90), 0)
      .filter((t) => !insidePolygon(near, t.x, t.z))
      .map((t) => lumOf(t.rgb));
    console.log(`  承天寺的院子：里面 ${inside.length} 格，亮 ${mean(inside).toFixed(1)}（最暗 ${Math.min(...inside).toFixed(0)}；样式里的浅色是 ${court.toFixed(1)}）；墙外一圈 ${outside.length} 格，亮 ${mean(outside).toFixed(1)}`);
    expect(inside.length).toBeGreaterThan(150);
    // 里面就是样式里的那种浅色（差的只是手工上色的那一点不匀）
    expect(Math.abs(mean(inside) - court)).toBeLessThan(4);
    expect(Math.min(...inside)).toBeGreaterThan(mean(outside) + 8);
    expect(mean(inside)).toBeGreaterThan(mean(outside) + 15);
    // 颜色不漫到墙外：墙外 12 米以外的格子没有哪一格是那种浅色
    const beyond = grown(ring, 12);
    const just = texelsIn(grown(ring, 40), 0)
      .filter((t) => !insidePolygon(beyond, t.x, t.z))
      .map((t) => lumOf(t.rgb));
    expect(Math.max(...just)).toBeLessThan(court - 6);
    // 墙外紧挨着的这一圈和远一点的那一圈一样亮（差不到 3）：浅色没有淡淡地晕出去
    expect(Math.abs(mean(just) - mean(outside))).toBeLessThan(3);
    // 徐州没有写浅色的院子，也没有青苗的田：地面那一边这两样都是空的（它先画好的地面一个点也不变）
    const xuzhou = realScene('su-shi/xuzhou').ground;
    expect(xuzhou.courts).toEqual([]);
    expect(xuzhou.fields.some((f) => f.green)).toBe(false);
    // 别的两座寺的院子：不是浅色
    for (const other of temples.filter((t) => t.id !== 'chengtian')) {
      const mine = texelsIn(yardRing(other), 14).map((t) => lumOf(t.rgb));
      expect(mean(mine), other.name).toBeLessThan(court - 12);
    }
  });
});

describe('黄州：矮土墙和东门', () => {
  const walls = scene.things.filter((t) => t.kind === 'earth-wall');
  const gate = thingOf('east-gate');
  const lineOf = (thing: SceneThing): Vec2[] => (thing.line ?? []).map((p) => coords.toLocal(p));

  it('场景里有五段矮土墙和夏澳边的一道矮土堤，一座小门；它们不是城墙：不围出一座城', () => {
    expect(walls.map((t) => t.id).sort()).toEqual(['camp-ruin-east', 'camp-ruin-south', 'wall-east-north', 'wall-east-south', 'wall-south', 'xiaao-dike']);
    // 只有夏澳边的那道土堤是半高的
    expect(walls.filter((t) => t.params?.low === true).map((t) => t.id)).toEqual(['xiaao-dike']);
    expect(gate.kind).toBe('small-gate');
    expect(scene.things.some((t) => t.kind === 'wall')).toBe(false);
    expect(ground.cities).toEqual([]);
  });

  it('切成的各段：大约 24 米一段；塌了的高高低低、至少立着一段；带篱笆的中间三分之一是篱笆、两头是墙', () => {
    for (const wall of walls) {
      const line = lineOf(wall);
      const total = line.slice(1).reduce((sum, p, i) => sum + Math.hypot(p[0] - line[i][0], p[1] - line[i][1]), 0);
      const pieces = earthWallPieces(line, wall.params?.ruined === true, wall.params?.fence === true);
      expect(pieces.length, wall.id).toBe(Math.max(1, Math.round(total / EARTH_WALL.pieceM)));
      for (const p of pieces) {
        const l = Math.hypot(p.b[0] - p.a[0], p.b[1] - p.a[1]);
        expect(l, wall.id).toBeGreaterThan(12);
        expect(l, wall.id).toBeLessThan(40);
        expect(p.high).toBeGreaterThanOrEqual(0);
        expect(p.high).toBeLessThanOrEqual(1);
      }
      // 头尾接在线的两头
      const last = pieces[pieces.length - 1];
      expect(Math.hypot(pieces[0].a[0] - line[0][0], pieces[0].a[1] - line[0][1])).toBeLessThan(1e-6);
      expect(Math.hypot(last.b[0] - line[line.length - 1][0], last.b[1] - line[line.length - 1][1])).toBeLessThan(1e-6);
      expect(pieces.filter((p) => !p.fence && p.high > 0).length, wall.id).toBeGreaterThanOrEqual(1);
      if (wall.params?.ruined !== true) for (const p of pieces) expect(p.high).toBe(1);
      if (wall.params?.fence === true) {
        pieces.forEach((p, i) => expect(p.fence, `${wall.id} 第 ${i} 段`).toBe((i + 0.5) / pieces.length > 1 / 3 && (i + 0.5) / pieces.length < 2 / 3));
        expect(pieces.some((p) => p.fence)).toBe(true);
        expect(pieces[0].fence || last.fence).toBe(false);
      } else expect(pieces.some((p) => p.fence)).toBe(false);
    }
    // 塌了的那几段合起来：有矮下去的；立着的最矮也有三成半
    const ruined = walls.filter((w) => w.params?.ruined === true).flatMap((w) => earthWallPieces(lineOf(w), true, w.params?.fence === true).filter((p) => !p.fence));
    expect(ruined.length).toBeGreaterThan(10);
    expect(ruined.filter((p) => p.high < 0.7).length).toBeGreaterThanOrEqual(3);
    expect(Math.min(...ruined.filter((p) => p.high > 0).map((p) => p.high))).toBeGreaterThanOrEqual(0.35);
  });

  it('造得出来：夯土的墙身（带篱笆的还有木桩和编的篱），顶比脚下的地面高出不到 11；不归类；一共不到 1500 个三角形', () => {
    const build = rockFamily.things?.['earth-wall'];
    if (!build) throw new Error('这一家没有矮土墙的造法');
    let all = 0;
    for (const wall of walls) {
      const { pass, main } = soloPass(ctxOf());
      build(pass, wall);
      expect([...main.parts.keys()].sort(), wall.id).toEqual(wall.params?.fence === true ? ['plainTimber', 'rammed', 'thatch'] : ['rammed']);
      all += main.tris;
      const bodies: BufferGeometry[] = main.parts.get('rammed') ?? [];
      for (const g of bodies) {
        const pos = g.attributes.position;
        let top = -Infinity;
        let cx = 0;
        let cz = 0;
        for (let i = 0; i < pos.count; i++) {
          top = Math.max(top, pos.getY(i));
          cx += pos.getX(i) / pos.count;
          cz += pos.getZ(i) / pos.count;
          expect(Number.isFinite(pos.getX(i) + pos.getY(i) + pos.getZ(i))).toBe(true);
        }
        // 这一段的顶比它中间脚下的地面高出不到墙高，也不埋在地面以下
        const over = top - coords.y(samplers.height(cx, cz));
        expect(over, wall.id).toBeLessThanOrEqual(EARTH_WALL.highY + 0.5);
        expect(over, wall.id).toBeGreaterThan(EARTH_WALL.highY * 0.3);
        // 写了 low 的只有一半高（夏澳边的土堤：原来在近看的一节里立得同屋子一般高）
        if (wall.params?.low === true) expect(over, wall.id).toBeLessThanOrEqual(EARTH_WALL.highY * 0.5 + 0.5);
        else if (wall.params?.ruined !== true) expect(over, wall.id).toBeGreaterThan(EARTH_WALL.highY * 0.9);
        // 不归类：不跟着远近放大
        const fig = g.attributes.aFig;
        for (let i = 0; i < fig.count; i++) expect(fig.getX(i)).toBe(0);
      }
      console.log(`  ${wall.name}：${bodies.length} 段墙身，${main.tris} 个三角形`);
    }
    expect(all).toBeLessThan(1500);
  });

  it('东门：两个夯土的门墩、一根木过梁、一个小瓦顶；门朝东，两个门墩一南一北，出东门的路从中间过；不到 300 个三角形', () => {
    const build = rockFamily.things?.['small-gate'];
    if (!build) throw new Error('这一家没有小门的造法');
    const { pass, main } = soloPass(ctxOf());
    build(pass, gate);
    expect(gate.facing).toBe(90);
    expect([...main.parts.keys()].sort()).toEqual(['plainTimber', 'rammed', 'tile']);
    expect(main.tris).toBeLessThan(300);
    const [gx, gz] = coords.toLocal(gate.at as [number, number]);
    // 夯土的有三块：两个门墩，和瓦顶两头的山面（并在一块里）
    const piers = (main.parts.get('rammed') ?? []).slice(0, 2);
    const centres = piers.map((g) => {
      g.computeBoundingBox();
      const box = g.boundingBox;
      if (!box) throw new Error('没有范围');
      return { x: (box.min.x + box.max.x) / 2, z: (box.min.z + box.max.z) / 2, top: box.max.y };
    });
    // 一南一北，各离门的那一点半个口子加半个门墩；东西方向上都在那一点上
    const half = (SMALL_GATE.gapM + SMALL_GATE.pierW) / 2;
    const offs = centres.map((c) => c.z - gz).sort((a, b) => a - b);
    expect(offs[0]).toBeCloseTo(-half, 3);
    expect(offs[1]).toBeCloseTo(half, 3);
    for (const c of centres) expect(Math.abs(c.x - gx)).toBeLessThan(0.01);
    // 门墩露出地面 16
    for (const c of centres) expect(c.top - coords.y(samplers.height(gx, gz))).toBeCloseTo(SMALL_GATE.pierH, 3);
    // 出东门的路从两个门墩之间穿过去
    const road = scene.dressing.find((d) => d.id === 'road-east');
    const nearest = offLine(gx, gz, (road?.line ?? []).map((p) => coords.toLocal(p)));
    console.log(`  东门：${main.tris} 个三角形；出东门的路离门的那一点 ${nearest.toFixed(1)} 米（口子宽 ${SMALL_GATE.gapM} 米）`);
    expect(nearest).toBeLessThan(SMALL_GATE.gapM / 2);
  });
});

describe('黄州：三夜里各节自己写的几样', () => {
  it('“十月，再到赤壁”不起云气（那一夜没有雾，水落下去，云气横在干的滩上）；七月的江上照旧；承天寺一节有临皋亭的题签', () => {
    const of = (heading: string) => scene.sections.find((s) => s.heading === heading);
    expect(of(OCTOBER)?.mist).toBe(0);
    expect(of(JULY)?.mist).toBeUndefined();
    expect(of('承天寺')?.mist).toBeUndefined();
    expect(of('承天寺')?.strips).toEqual(['t-chengtian', 't-lingao']);
    // 白天的各节都不写
    for (const section of scene.sections.filter((s) => s.sky !== 'night')) expect(section.mist, section.heading).toBeUndefined();
  });
});

// ---------------------------------------------------------------- 镜头、题签和题记（第 3 步 U4）
// 图片看过、定下来以后记在这里的数。镜头是照图片定的：这里的每一项后面写着它是为了让读者看见什么；
// 要改镜头，先看图片，再改这里的数。

/** 这一节在这种沙盘栏上摆好以后的镜头：把沙盘里的一点投到栏里的像素上（和 scene-cameras.test.ts 的 placed 是同一种做法）。 */
function screenOf(heading: string, pane: (typeof STANDARD_PANES)[number]) {
  const section = scene.sections.find((s) => s.heading === heading);
  if (!section) throw new Error(`没有这一节：${heading}`);
  const { pose, distanceM, fit } = placeCamera(section, scene, samplers, coords, style, pane.size, pane.insets);
  const camera = new PerspectiveCamera(pose.fov, pane.size.width / pane.size.height, Math.max(60, distanceM * 0.1), distanceM * 3 + 30000);
  camera.position.set(...pose.position);
  camera.lookAt(...pose.target);
  const [shiftX, shiftY] = centreShift(pane.insets);
  if (shiftX || shiftY) camera.setViewOffset(pane.size.width, pane.size.height, -shiftX, -shiftY, pane.size.width, pane.size.height);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
  const D = equivalentDistance(distanceM, pose.fov, pane.size.height);
  /** 地面上的一点（经纬度）落在栏里的哪里。 */
  const at = (lngLat: [number, number]): { x: number; y: number; visible: boolean } => {
    const [x, z] = coords.toLocal(lngLat);
    return project([x, samplers.height(x, z), z], camera, pane.size);
  };
  return { section, fit, D, at, pose };
}

describe('黄州：镜头、题签和题记（第 3 步 U4，对着图片定下来的）', () => {
  const sectionOf = (heading: string) => {
    const section = scene.sections.find((s) => s.heading === heading);
    if (!section) throw new Error(`没有这一节：${heading}`);
    return section;
  };
  const atOf = (id: string): [number, number] => {
    const at = scene.things.find((t) => t.id === id)?.at;
    if (!at) throw new Error(`${id} 没有位置`);
    return at as [number, number];
  };
  const THREE_PANES = STANDARD_PANES.slice(0, 3);

  it('三夜的月亮是研究记录里那一夜的钟点，样式照月亮的高矮给的灯也钉在这里：七月九点（月亮已经升到东边的山上），水面亮五倍上下；十月十点、承天寺九点月亮都高，水面不另外加亮', () => {
    // 每一夜：月亮的方位、高度（docs/research/huangzhou-scene.md 第八节的表），照到的月光、天光有多强，水面亮几倍
    const nights = [
      { heading: JULY, moon: { azimuth: 111, altitude: 24 }, sun: 1.405, hemi: 1.238, sheen: 5.15 },
      { heading: OCTOBER, moon: { azimuth: 130, altitude: 68 }, sun: 1.17, hemi: 0.96, sheen: 0 },
      { heading: '承天寺', moon: { azimuth: 141, altitude: 69 }, sun: 1.17, hemi: 0.96, sheen: 0 },
    ];
    expect(scene.sections.filter((s) => s.sky === 'night').map((s) => s.heading)).toEqual(nights.map((n) => n.heading));
    for (const night of nights) {
      const section = sectionOf(night.heading);
      expect(section.moon, night.heading).toEqual(night.moon);
      const light = style.light('night', night.moon);
      expect(light.sun, `${night.heading} 的月光`).toBeCloseTo(night.sun, 2);
      expect(light.hemi, `${night.heading} 的天光`).toBeCloseTo(night.hemi, 2);
      expect(light.sheen, `${night.heading} 水面亮几倍`).toBeCloseTo(night.sheen, 2);
    }
    // 这些数是为了什么：
    // 七月那一夜正文是“月出于东山之上”“水光接天”——月亮在东边偏南（不到正南），还低，所以水面要亮：亮 5 倍上下。
    //   取的是九点而不是月亮刚出来的八点（12 度）：八点时崖和山的影子盖住三四成的江面，船在影子里，和“水光接天”对不上。
    expect(nights[0].moon.azimuth).toBeGreaterThan(90);
    expect(nights[0].moon.azimuth).toBeLessThan(135);
    expect(style.light('night', nights[0].moon).sheen ?? 0).toBeGreaterThan(5);
    // 十月和承天寺两夜月亮在 68 度以上：水面不加亮，月光用高的那一头的数（平地才不会比七月那一夜亮出一截）
    for (const night of nights.slice(1)) expect(night.moon.altitude).toBeGreaterThanOrEqual(68);
    // 题记里说的和这一夜的月亮对得上：七月那一节说月光从东边的山上照过来（月亮已经升起来了，不说“刚出来”）。
    // 说月光，不说月亮：沙盘上不画月亮，说“月亮在东边的山上”，孩子会去找（第 3 步收尾时改的）
    expect(sectionOf(JULY).line).toContain('月光从东边的山上照过来');
    expect(sectionOf(JULY).line).not.toMatch(/刚|正在|月亮/);
    for (const night of nights) expect(sectionOf(night.heading).line, night.heading).not.toContain('月亮');
  });

  it('头一节的题记先说从哪边往哪边看：这座沙盘是从北往南看的，城在画面里大江的这一边，和正文“黄州在大江北岸”、和全程沙盘“上北下南”都反着', () => {
    const first = scene.sections[0];
    expect(first.camera.bearing).toBe(195);
    expect(first.line.startsWith('从城的北边往南看：')).toBe(true);
    expect(first.line).toContain('大江北岸');
  });

  it.each(THREE_PANES)('$name：“一天一百五十钱”离临皋亭够近（一米合的像素比原来多一半以上），亭子在留出来的那一块的中间一带', (pane) => {
    const view = screenOf('一天一百五十钱', pane);
    const lingao = view.at(atOf('lingao'));
    const free = { top: pane.insets.top, bottom: pane.size.height - pane.insets.bottom };
    const pxPerMetre = 2428 / view.D;
    console.log(`  ${pane.name}：“一天一百五十钱”折算过的远近 ${view.D.toFixed(0)}，对准的那一点上一米合 ${pxPerMetre.toFixed(3)} 像素；临皋亭在 (${lingao.x.toFixed(0)}, ${lingao.y.toFixed(0)})`);
    // 原来写的是 4,500 米：亭子只有栏宽的二十分之一，前景是州衙的山和竹林。现在 2,500 米
    expect(view.fit).toBeCloseTo(1, 3);
    expect(view.section.camera.distanceM).toBeLessThanOrEqual(2600);
    // 亭子在留出来的那一块里，上下都在中间的一半
    const height = free.bottom - free.top;
    expect(lingao.y).toBeGreaterThan(free.top + height * 0.25);
    expect(lingao.y).toBeLessThan(free.top + height * 0.75);
    expect(Math.abs(lingao.x - pane.size.width / 2)).toBeLessThan(pane.size.width * 0.2);
    // 收尾时又拉近了（1,500 米）：这一节写的是 1080 年，东坡的田（1081 年才有）哪一种栏上都不在画面里；
    // 承天寺那座白院子不在电脑和横着拿的平板的画面里（竖着拿的平板上只在左边露一个角）
    expect(view.section.camera.distanceM).toBe(1500);
    const plot = scene.dressing.find((d) => d.id === 'fields-dongpo')?.area as [number, number][];
    for (const corner of plot) {
      const p = view.at(corner);
      expect(p.x < 0 || p.x > pane.size.width || p.y > pane.size.height || p.y < 0, `田的一角在画面里：${p.x.toFixed(0)}, ${p.y.toFixed(0)}`).toBe(true);
    }
    const temple = view.at(atOf('chengtian'));
    expect(temple.x, '承天寺的正中').toBeLessThan(pane.name === '768 × 573' ? 0 : -150);
  });

  it('“寒食，沙湖”一节和“一天一百五十钱”是同一个镜头（三种标准的栏上一模一样）：两节一比，看得出水涨到了亭子脚下；沙湖只在题记下面说，沙盘上不立题签', () => {
    const spring = sectionOf('寒食，沙湖');
    const winter = sectionOf('一天一百五十钱');
    // 镜头：对准的点、远近、倾角、朝向都一样（要看的点多一样门外的船：两节里船都在）
    const { mustShow: springShows, ...springCamera } = spring.camera;
    const { mustShow: winterShows, ...winterCamera } = winter.camera;
    expect(springCamera).toEqual(winterCamera);
    expect(winterShows).toEqual(['lingao']);
    expect(springShows).toEqual(['lingao', 'boats-lingao']);
    for (const pane of THREE_PANES) {
      const a = placeCamera(winter, scene, samplers, coords, style, pane.size, pane.insets);
      const b = placeCamera(spring, scene, samplers, coords, style, pane.size, pane.insets);
      expect(b.fit, pane.name).toBe(a.fit);
      expect(b.pose, pane.name).toEqual(a.pose);
    }
    // 水一高一平：门前的滩冬天是干的，寒食前后在水下（huangzhou-ground.test.ts 查着哪一档有水）
    expect(levels[winter.water]).toBe(levels.normal);
    expect(levels[spring.water]).toBe(highest);
    // 沙湖：只在题记下面那一行说（farLine），这一节没有它的题签，场景里也不再有这条题签；题记下面印的还是他的那句话
    expect(spring.farLine).toEqual(['shahu']);
    expect(spring.strips).toEqual(['t-lingao', 't-dajiang-lingao']);
    expect(scene.strips.some((strip) => strip.of === 'shahu')).toBe(false);
    expect(sectionInfo(scene, spring.heading).far).toEqual([{ id: 'shahu', name: '沙湖', say: '往东南约三十里（今天是哪里没有查到）' }]);
  });

  it('船：夏澳里的三条在近看临皋亭的两节里不摆（在画面边上切掉一半，或者同亭子的屋顶叠在一起）；临皋亭下的两条在水落的两节里不摆（从屋后看过去认不出是船）；别的小节都在', { timeout: 30_000 }, async () => {
    const models = buildModels(ctxOf());
    await models.prepare(R.headings);
    const shown = (heading: string, rule: string): number => {
      const section = sectionOf(heading);
      models.apply(section.heading, levels[section.water], section.camera.distanceM);
      models.group.updateMatrixWorld(true);
      return instancesOf(models.group, 'boats').filter((b) => b.rule === rule && b.visible).length;
    };
    for (const heading of R.headings) {
      const near = heading === '一天一百五十钱' || heading === '寒食，沙湖';
      const low = levels[sectionOf(heading).water] === lowest;
      expect(shown(heading, 'boats-xiaao'), `${heading}：夏澳里的船`).toBe(near ? 0 : 3);
      expect(shown(heading, 'boats-lingao'), `${heading}：临皋亭下的船`).toBe(low ? 0 : 2);
    }
  });

  it('七月那一夜崖下的船在崖的影子外面：离崖脚的线比崖和山的影子长，又不出崖自己那么长的一段（还算“在赤壁下”）', { timeout: 30_000 }, async () => {
    const july = sectionOf(JULY);
    const models = buildModels(ctxOf());
    await models.prepare(R.headings);
    models.apply(july.heading, levels[july.water], july.camera.distanceM);
    models.group.updateMatrixWorld(true);
    const boats = instancesOf(models.group, 'boats').filter((b) => b.rule === 'boat-chibi' && b.visible);
    expect(boats).toHaveLength(1);
    const foot = (thingOf('chibi').line ?? []).map((p) => coords.toLocal(p));
    let cliffLong = 0;
    for (let i = 1; i < foot.length; i++) cliffLong += Math.hypot(foot[i][0] - foot[i - 1][0], foot[i][1] - foot[i - 1][1]);
    const off = Math.min(...foot.map((p) => Math.hypot(p[0] - boats[0].at.x, p[1] - boats[0].at.z)));
    // 影子多长：赤壁所在的山顶到水面的高（沙盘里的高度，夸大过的）除以月亮高度的正切；山顶在崖脚的线往里一百来米，这里不减，留作余量
    const mound = scene.terrain.edits.find((e) => e.id === 'cliff-hill');
    if (mound?.op !== 'mound') throw new Error('没有赤壁所在的山');
    const [mx, mz] = coords.toLocal(mound.at);
    const over = (samplers.height(mx, mz) - levels[july.water]) * scene.frame.relief.times;
    const shadow = over / Math.tan(((july.moon?.altitude ?? 90) * Math.PI) / 180) - Math.min(...foot.map((p) => Math.hypot(p[0] - mx, p[1] - mz)));
    console.log(`  “赤壁”：船离崖脚的线 ${off.toFixed(0)} 米；山顶比水面高 ${over.toFixed(0)}（沙盘里的高度），影子伸出崖脚的线 ${shadow.toFixed(0)} 米；崖长 ${cliffLong.toFixed(0)} 米`);
    // 原来船离崖脚 120 来米，整条在影子里：船身 44、影子里的水 73，要找才看得见
    expect(off).toBeGreaterThan(shadow);
    expect(off).toBeLessThan(cliffLong);
  });

  it.each(THREE_PANES)('$name：两节赤壁里“大江”的题签挂在它那一点的下面，那一点比崖脚的石滩低（更靠近镜头）：题签不站在石滩和石头上', (pane) => {
    const strip = scene.strips.find((s) => s.id === 't-dajiang-town');
    expect(strip?.side).toBe('below');
    const view = screenOf(OCTOBER, pane);
    const shelf = scene.terrain.edits.find((e) => e.id === 'cliff-shelf');
    if (shelf?.op !== 'level' || !shelf.area) throw new Error('没有崖脚的石滩');
    const lowestShelf = Math.max(...shelf.area.map((p) => view.at(p as [number, number]).y));
    const dot = view.at(strip?.at as [number, number]);
    console.log(`  ${pane.name}：“大江”那一点在 y ${dot.y.toFixed(0)}，石滩最低的一点在 y ${lowestShelf.toFixed(0)}`);
    // 原来题签立在那一点的上面：竖着拿的平板上它盖住石滩右边的三分之一和上面的石头
    expect(dot.y).toBeGreaterThan(lowestShelf);
  });

  it.each(THREE_PANES)('$name：“要走了”一节雪堂在近处——在留出来的那一块的下半边，离镜头比对准的那一点近；汝州的题签指着的沙盘边在上半边', (pane) => {
    const view = screenOf('要走了', pane);
    const hall = view.at(atOf('xuetang'));
    const free = { top: pane.insets.top, bottom: pane.size.height - pane.insets.bottom };
    const middle = (free.top + free.bottom) / 2;
    // 镜头站在雪堂的东南，贴着地面往西北看（倾角 74 度，和两节赤壁差不多）：近处的东西大，远处的沙盘边小
    expect(view.section.camera.pitch).toBeGreaterThanOrEqual(70);
    expect(view.fit).toBeCloseTo(1, 3);
    expect(hall.visible).toBe(true);
    expect(hall.y).toBeGreaterThan(middle);
    expect(hall.y).toBeLessThan(free.bottom - 20);
    // 雪堂离镜头比对准的那一点近
    const [hx, hz] = coords.toLocal(atOf('xuetang'));
    const toHall = Math.hypot(hx - view.pose.position[0], hz - view.pose.position[2]);
    const toTarget = Math.hypot(view.pose.target[0] - view.pose.position[0], view.pose.target[2] - view.pose.position[2]);
    expect(toHall).toBeLessThan(toTarget * 0.8);
    // 屋顶有多宽：照雪堂自己到镜头的距离算（900 像素高、21 度的画面上，一米合 2428 ÷ 距离 像素，别的高矮照比例）
    const eye = Math.hypot(toHall, view.pose.position[1] - samplers.height(hx, hz));
    const times = figureTimes(style, 'hut', view.D);
    const roofPx = (29 * times * 2428 * (pane.size.height / 900)) / eye;
    console.log(`  ${pane.name}：“要走了”雪堂在 (${hall.x.toFixed(0)}, ${hall.y.toFixed(0)})，离镜头 ${eye.toFixed(0)} 米（对准的那一点 ${toTarget.toFixed(0)} 米），放大 ${times.toFixed(2)} 倍，屋顶宽 ${roofPx.toFixed(1)} 像素`);
    // 原来（11,000 米，倾角 55 度）雪堂连柳一共 55 像素，屋顶十来个像素
    expect(roofPx).toBeGreaterThanOrEqual(20);
  });

  it('“东坡”一节只立“东坡”“雪堂”两条题签，比原来近（2,400 米）；竖着拿的平板上赤壁的红崖不在画面里，横着拿的平板上州衙整个在画面外', () => {
    const section = sectionOf('东坡');
    expect(section.camera.distanceM).toBe(2400);
    expect(section.strips).toEqual(['t-dongpo', 't-xuetang']);
    expect(section.camera.mustShow).toEqual(['fields-dongpo', 'xuetang']);
    const [upright, sideways] = [THREE_PANES[2], THREE_PANES[1]];
    // 崖脚的线上每个点，和它往里（往东）60 米的地方，都在竖着拿的平板的画面左边以外 20 像素
    const cliffView = screenOf('东坡', upright);
    for (const p of thingOf('chibi').line ?? []) {
      for (const eastM of [0, 60]) {
        const at = cliffView.at([p[0] + eastM / 96000, p[1]]);
        expect(at.x, `崖脚的线往里 ${eastM} 米`).toBeLessThan(-20);
      }
    }
    // 州衙：正中和东墙都在横着拿的平板的画面左边以外
    const yamenView = screenOf('东坡', sideways);
    const yamen = atOf('yamen');
    expect(yamenView.at([yamen[0] + 55 / 96000, yamen[1]]).x).toBeLessThan(-60);
  });

  it('“黄州”的题签指着州衙（这座城没有城墙可指），愿意摆在它的右边；“承天寺”的题签愿意摆在寺的右边，不往上站到临皋亭上', () => {
    const town = scene.strips.find((s) => s.id === 't-huangzhou');
    expect(town?.of).toBe('yamen');
    expect(town?.side).toBe('right');
    expect(scene.strips.find((s) => s.id === 't-chengtian')?.side).toBe('right');
    // 立着“黄州”的小节里州衙都在（它没有写 when）
    expect(thingOf('yamen').when).toBeUndefined();
    expect(scene.sections.filter((s) => s.strips.includes('t-huangzhou')).map((s) => s.heading)).toEqual(['到黄州', '这个地方', '要走了']);
    // 它指着州衙那座殿的东头（离正中二十来米，还在殿上）：“要走了”一节从殿的背后近看，题签挂在右边，不压殿的屋顶；
    // 远看的两节里这二十来米不到四个像素
    if (!town?.at) throw new Error('“黄州”的题签没有写 at');
    const yamen = atOf('yamen');
    const [ax, az] = coords.toLocal(town.at);
    const [yx, yz] = coords.toLocal(yamen);
    expect(Math.hypot(ax - yx, az - yz)).toBeLessThan(30);
    for (const pane of THREE_PANES) {
      const near = screenOf('要走了', pane);
      expect(near.at(town.at).x - near.at(yamen).x, pane.name).toBeGreaterThan(8);
      for (const heading of ['到黄州', '这个地方']) {
        const far = screenOf(heading, pane);
        expect(Math.hypot(far.at(town.at).x - far.at(yamen).x, far.at(town.at).y - far.at(yamen).y), `${heading} ${pane.name}`).toBeLessThan(4);
      }
    }
  });

  it('“承天寺”的题签指着寺的北头（还在院墙里面），挂在右边：三种栏上那一点都在殿的正中右边 25 个像素以外，题签不压殿的屋顶', () => {
    const strip = scene.strips.find((s) => s.id === 't-chengtian');
    if (!strip?.at) throw new Error('“承天寺”的题签没有写 at');
    expect(strip.side).toBe('right');
    // 指着的那一点在寺的院墙里面：引线的头落在寺上，不落在墙外的空地上
    const [px, pz] = coords.toLocal(strip.at);
    const ring = yardRing(thingOf('chengtian'));
    const insideRing = ring.reduce((inside, a, i) => {
      const b = ring[(i + 1) % ring.length];
      return (a[1] > pz) !== (b[1] > pz) && px < ((b[0] - a[0]) * (pz - a[1])) / (b[1] - a[1]) + a[0] ? !inside : inside;
    }, false);
    expect(insideRing).toBe(true);
    for (const pane of THREE_PANES) {
      const view = screenOf('承天寺', pane);
      const hall = view.at(atOf('chengtian'));
      const dot = view.at(strip.at);
      console.log(`  ${pane.name}：“承天寺”题签指的点在殿正中的右边 ${(dot.x - hall.x).toFixed(0)} 像素，高低差 ${(dot.y - hall.y).toFixed(0)}`);
      expect(dot.x - hall.x, pane.name).toBeGreaterThan(25);
      expect(Math.abs(dot.y - hall.y), pane.name).toBeLessThan(12);
    }
  });

  it('“寒食，沙湖”一节“大江”的题签指着敞开的江面，不指在门外那两条船上：三种栏上离船的那条线都在 40 个像素以外', () => {
    const strip = scene.strips.find((s) => s.id === 't-dajiang-lingao');
    const boats = scene.dressing.find((d) => d.id === 'boats-lingao');
    if (!strip?.at || !boats?.line) throw new Error('没有“大江”的题签或者门外的船');
    for (const pane of THREE_PANES) {
      const view = screenOf('寒食，沙湖', pane);
      const dot = view.at(strip.at);
      // 船摆在那条线上：线的两头和正中
      const [a, b] = boats.line;
      const along: [number, number][] = [a, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], b];
      const nearest = Math.min(...along.map((p) => Math.hypot(view.at(p).x - dot.x, view.at(p).y - dot.y)));
      console.log(`  ${pane.name}：“大江”题签指的点离门外的船最近 ${nearest.toFixed(0)} 像素；在画面的 ${dot.x.toFixed(0)}, ${dot.y.toFixed(0)}`);
      expect(nearest, pane.name).toBeGreaterThan(40);
      // 还在画面里，右边留得下题签的一半宽
      expect(dot.x, pane.name).toBeLessThan(pane.size.width - 16);
      expect(dot.x, pane.name).toBeGreaterThan(0);
    }
  });

  it('“承天寺”一节院子、寺和江边的临皋亭在一个画面里，两条题签各指各的', () => {
    const night = sectionOf('承天寺');
    expect(night.camera.mustShow).toEqual(['chengtian', 'lingao']);
    expect(night.strips).toEqual(['t-chengtian', 't-lingao']);
    expect(night.line).toContain('临皋亭');
    for (const pane of THREE_PANES) {
      const view = screenOf('承天寺', pane);
      const temple = view.at(atOf('chengtian'));
      const house = view.at(atOf('lingao'));
      // 临皋亭在寺的后面（画面里更高），两样都在留出来的那一块里
      expect(house.y, pane.name).toBeLessThan(temple.y);
      for (const p of [temple, house]) {
        expect(p.y, pane.name).toBeGreaterThan(pane.insets.top);
        expect(p.y, pane.name).toBeLessThan(pane.size.height - pane.insets.bottom);
      }
    }
  });
});
