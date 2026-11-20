// 场景验收（五）：模型跟着镜头远近变的时候，依据里说了数目、分组的东西一样不少、不挤成一团，题签不指着空地。
// 在 Node 里跑：地面是真的，模型用零件库照场景造；没有显卡，每个顶点现在在哪用和着色器同一套算术算
// （src/stage/three/kit/figureMaterial.ts 的 figureMove、figureShow）。画出来什么样仍然要看图片。
// 运行：npx vitest run tests/stage/scene-figures.test.ts（要看印出来的数，后面加 --silent=false）
//
// 前一半（content/ 里有几座沙盘就查几座）：
//   依据是“文字里写了”的点缀、数目不超过五的点缀：镜头从 1 公里到 130 公里，两档画质，造了几样就画几样，都是原样大小的那一份；
//   远了去掉一些的时候，每条点缀规则至少还剩一样；有题签指着的点缀，题签那一点旁边总有一样；
//   放大到头时留着的民居谁也不压着谁。
// 后一半（徐州）：
//   船和石头不去掉，所以它们最多能放大几倍要看场景容不容得下：系在城下的船一组一组分得开、不叠、不压着岸，
//   船身不进城墙的墙身（城墙算岸）；按本来的大小，船身也不进墙角的角台、城门的城台，不压在墙脚土坡的模型上；
//   百步洪的两条小船不叠；乱石西边留得出一线水路、不连成一片；大水淹到草屋的几成，放大以后还是几成。
//   样式里写的倍数超过了场景容得下的数，这里就不过；容得下的最大的数印在输出里。

import type { BufferGeometry, InstancedMesh, Object3D } from 'three';
import { describe, expect, it } from 'vitest';
import type { DressingKind, SceneDressing, SceneSection } from '../../src/domain/scene';
import { dressingParams } from '../../src/domain/sceneParams';
import { stripPoint } from '../../src/domain/sceneStripPoint';
import { existsAt } from '../../src/domain/sceneText';
import type { Vec2, Vec3 } from '../../src/stage/ground/types';
import type { FigureClass, FigureStyle, KitContext, Quality, StageStyle } from '../../src/stage/three/internal';
import { buildModels } from '../../src/stage/three/kit';
import { DRESSING_BUILDERS } from '../../src/stage/three/kit/dressing';
import { equivalentDistance } from '../../src/stage/three/kit/figure';
import { FIGURE_SLOT, FIG_DETAIL, FIG_TREE_DOT, drowned, figureMove, figureShow, makeFigureUniforms, setFigure } from '../../src/stage/three/kit/figureMaterial';
import type { FigureMarks, FigureUniforms } from '../../src/stage/three/kit/figureMaterial';
import { Batch } from '../../src/stage/three/kit/geo';
import type { Bucket, Pass } from '../../src/stage/three/kit/pass';
import { boatGeo } from '../../src/stage/three/kit/shapes';
import type { Instance } from '../../src/stage/three/kit/shapes';
import { WALL_BASE_HALF, cornerOffset, ringDistance, surveyWalls } from '../../src/stage/three/kit/site';
import { CORNER_HALF, CORNER_OUT, THING_BUILDERS, bankSurfaceY } from '../../src/stage/three/kit/things';
import { FULL_QUALITY, REDUCED_QUALITY } from '../../src/stage/three/quality';
import { placeCamera } from '../../src/stage/three/rig';
import { styleFor } from '../../src/stage/three/style';
import type { StageInsets } from '../../src/stage/types';
import { realScene, realSceneKeys } from './support/realScenes';
import type { RealScene } from './support/realScenes';

// ---------------------------------------------------------------- 造、量

const QUALITIES: Quality[] = [FULL_QUALITY, REDUCED_QUALITY];
/** 造模型的那几种点缀（路和田画在地面上）。 */
const BUILT_KINDS: DressingKind[] = ['houses', 'villages', 'boats', 'rocks', 'trees'];

function ctxOf(R: RealScene, quality: Quality = FULL_QUALITY, style: StageStyle = styleFor(R.scene.style)): KitContext {
  const { scene, ground, samplers, coords } = R;
  return { scene, ground, samplers, coords, style, quality };
}

/** 镜头从 1 公里到 130 公里，每次远 5%。 */
function sweep(): number[] {
  const out: number[] = [];
  for (let D = 1000; D <= 130_000; D *= 1.05) out.push(D);
  out.push(130_000);
  return out;
}

/** 镜头在 D 这么远、水面在 levelM 时交给显卡的那一份数。 */
function figureAt(ctx: KitContext, D: number, levelM: number): FigureUniforms {
  const u = makeFigureUniforms();
  setFigure(u, ctx.style, D, ctx.coords.y(levelM), ctx.coords.y(levelM + 1) - ctx.coords.y(levelM));
  return u;
}

/** 一条点缀规则单独造出来的东西：并进网格的零件（石头、屋）和成批摆的实例（船）。 */
function soloRule(ctx: KitContext, rule: SceneDressing): { pass: Pass; parts: BufferGeometry[]; boats: Instance[] } {
  const bucket: Bucket = { main: new Batch(), raised: new Batch(), boats: [] };
  const pass: Pass = { ctx, survey: surveyWalls(ctx), yards: [], lots: [], bucket: () => bucket };
  // 民居要让开院落：先把院落摆上（它们占的地记在 pass.yards 里），再把它们的零件扔掉
  if (rule.kind === 'houses') {
    for (const thing of ctx.scene.things) if (thing.kind === 'hall-group') THING_BUILDERS['hall-group'](pass, thing);
    bucket.main = new Batch();
  }
  DRESSING_BUILDERS[rule.kind](pass, rule);
  return { pass, parts: [...bucket.main.parts.values()].flat(), boats: bucket.boats };
}

function marksOf(g: BufferGeometry, i = 0): FigureMarks {
  const p = g.attributes.aPivot;
  const q = g.attributes.aGroup;
  const f = g.attributes.aFig;
  return { pivot: [p.getX(i), p.getY(i), p.getZ(i)], group: [q.getX(i), q.getY(i), q.getZ(i)], fig: [f.getX(i), f.getY(i), f.getZ(i), f.getW(i)] };
}

/** 一个零件在这一份数下，每个顶点落在沙盘的哪里（x、z），连同它的高度。 */
function movedPoints(g: BufferGeometry, u: FigureUniforms): Vec3[] {
  const pos = g.attributes.position;
  const out: Vec3[] = [];
  for (let i = 0; i < pos.count; i++) out.push(figureMove([pos.getX(i), pos.getY(i), pos.getZ(i)], marksOf(g, i), u));
  return out;
}

/** 一组里现在真的在画的成批摆的网格。 */
function shownFlocks(root: Object3D): InstancedMesh[] {
  const out: InstancedMesh[] = [];
  const visit = (o: Object3D): void => {
    if (!o.visible) return;
    if ((o as InstancedMesh).isInstancedMesh) out.push(o as InstancedMesh);
    for (const child of o.children) visit(child);
  };
  visit(root);
  return out;
}

// ---------------------------------------------------------------- 平面上的算术：凸多边形

/** 一堆点的凸包（逆时针或顺时针一圈）。 */
function hull(points: Vec2[]): Vec2[] {
  const pts = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (pts.length < 3) return pts;
  const cross = (o: Vec2, a: Vec2, b: Vec2): number => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: Vec2[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: Vec2[] = [];
  for (const p of pts.reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

function insideConvex(poly: Vec2[], p: Vec2): boolean {
  let sign = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const c = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
    if (Math.abs(c) < 1e-9) continue;
    if (sign === 0) sign = Math.sign(c);
    else if (Math.sign(c) !== sign) return false;
  }
  return true;
}

function segmentDistance(a: Vec2, b: Vec2, c: Vec2, d: Vec2): number {
  const point = (p: Vec2, s: Vec2, e: Vec2): number => {
    const dx = e[0] - s[0];
    const dz = e[1] - s[1];
    const t = Math.min(1, Math.max(0, ((p[0] - s[0]) * dx + (p[1] - s[1]) * dz) / (dx * dx + dz * dz || 1)));
    return Math.hypot(p[0] - s[0] - dx * t, p[1] - s[1] - dz * t);
  };
  const side = (p: Vec2, q: Vec2, r: Vec2): number => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
  if (side(a, b, c) !== side(a, b, d) && side(c, d, a) !== side(c, d, b)) return 0;
  return Math.min(point(a, c, d), point(b, c, d), point(c, a, b), point(d, a, b));
}

/** 两个凸多边形隔多远；叠着是 0。 */
function gap(p: Vec2[], q: Vec2[]): number {
  if (insideConvex(p, q[0]) || insideConvex(q, p[0])) return 0;
  let best = Infinity;
  for (let i = 0; i < p.length; i++) for (let j = 0; j < q.length; j++) best = Math.min(best, segmentDistance(p[i], p[(i + 1) % p.length], q[j], q[(j + 1) % q.length]));
  return best;
}

/** 船身从上面看的轮廓（船自己的坐标，x 顺着船身），照船的形状量出来。 */
const HULL: Vec2[] = (() => {
  const g = boatGeo();
  const pos = g.attributes.position;
  const points: Vec2[] = [];
  for (let i = 0; i < pos.count; i++) points.push([pos.getX(i), pos.getZ(i)]);
  g.dispose();
  return hull(points);
})();
/** 船身多长（一半）。 */
const HULL_HALF = Math.max(...HULL.map((p) => Math.abs(p[0])));
/**
 * 船底比吃水的那条线低多少（船自己的坐标）：船身当中最深（2.2），往两头翘起来，船头船尾是悬在水面上的。
 * 照船的形状（kit/shapes.ts 的 boatGeo）：船底在原点下 1.6、两头升 2.6，吃水线在原点上 0.6。
 */
const draftAt = (lx: number): number => Math.max(0, 2.2 - 2.6 * Math.abs(lx / HULL_HALF) ** 3);

/** 船自己的坐标里的一点，放大 times 倍以后在沙盘上的哪里。船绕着船身正中放大，不挪地方。 */
function placed(boat: Instance, times: number, [lx, lz]: Vec2): Vec2 {
  const k = (boat.s ?? 1) * times;
  const cos = Math.cos(boat.ry ?? 0);
  const sin = Math.sin(boat.ry ?? 0);
  return [boat.x + (lx * cos + lz * sin) * k, boat.z + (-lx * sin + lz * cos) * k];
}

/** 一条船放大 times 倍以后，船身的轮廓在沙盘上的哪里。 */
function hullOf(boat: Instance, times: number): Vec2[] {
  return HULL.map((p) => placed(boat, times, p));
}

/** 轮廓上多取几个点（每条边中间再加三个），还在船自己的坐标里。 */
const HULL_OUTLINE: Vec2[] = (() => {
  const out: Vec2[] = [];
  for (let i = 0; i < HULL.length; i++) {
    const a = HULL[i];
    const b = HULL[(i + 1) % HULL.length];
    for (let k = 0; k < 4; k++) out.push([a[0] + ((b[0] - a[0]) * k) / 4, a[1] + ((b[1] - a[1]) * k) / 4]);
  }
  return out;
})();

/**
 * 这一点进了城墙的墙身多深（米）：墙线两边各 26 米以内；没进是 0。
 * 按模型最宽的那一圈（墙脚）算；墙身是往上收的，水面那里比墙脚薄几米。尺寸是零件库里的数（kit/site.ts）。
 */
function intoWallBody(pass: Pass, x: number, z: number): number {
  let deepest = 0;
  for (const wall of pass.survey.walls.values()) deepest = Math.max(deepest, WALL_BASE_HALF - ringDistance(wall.ring, x, z));
  return deepest;
}

/** 这一点进了城墙的模型多深（米）：墙身，再加墙角的角台（kit/things.ts）；没进是 0。 */
function intoWall(pass: Pass, x: number, z: number): number {
  let deepest = intoWallBody(pass, x, z);
  for (const wall of pass.survey.walls.values()) {
    for (let i = 0; i < wall.ring.sides.length; i++) {
      const [cx, cz] = cornerOffset(wall.ring, i, CORNER_OUT);
      const side = wall.ring.sides[i];
      const along = (x - cx) * side.ax[0] + (z - cz) * side.ax[1];
      const out = (x - cx) * side.out[0] + (z - cz) * side.out[1];
      deepest = Math.max(deepest, Math.min(CORNER_HALF - Math.abs(along), CORNER_HALF - Math.abs(out)));
    }
  }
  return deepest;
}

/** 这一点进了 heading 这一节在场的哪一座城门的城台多深（米，按城台的墙脚算）；没进是 0。 */
function intoGate(pass: Pass, heading: string, x: number, z: number): number {
  const { scene } = pass.ctx;
  const headings = scene.sections.map((s) => s.heading);
  let deepest = 0;
  for (const gate of pass.survey.gates.values()) {
    // 改筑以后的东门比原来的大，只在后面几节有
    if (!existsAt(scene.things.find((t) => t.id === gate.id)?.when, heading, headings)) continue;
    const side = gate.wall.ring.sides[gate.side];
    const cx = side.mid[0] + side.ax[0] * gate.u;
    const cz = side.mid[1] + side.ax[1] * gate.u;
    const along = (x - cx) * side.ax[0] + (z - cz) * side.ax[1];
    const out = (x - cx) * side.out[0] + (z - cz) * side.out[1];
    // 城台的墙脚比台顶左右各宽 4 米
    deepest = Math.max(deepest, Math.min(gate.halfW + 4 - Math.abs(along), gate.depth / 2 - Math.abs(out)));
  }
  return deepest;
}

/** 在 1 到 hi 之间找“ok 还成立”的最大的数（ok 是越大越难成立的）。1 都不成立时返回 0。 */
function largest(ok: (v: number) => boolean, hi: number): number {
  if (!ok(1)) return 0;
  if (ok(hi)) return hi;
  let lo = 1;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (ok(mid)) lo = mid;
    else hi = mid;
  }
  return lo;
}

// ---------------------------------------------------------------- 每一座沙盘

describe.each(realSceneKeys())('%s：模型跟着远近变的时候', (key) => {
  const R = realScene(key);
  const { scene, coords } = R;
  const headings = scene.sections.map((s) => s.heading);
  const presentSections = (rule: SceneDressing): SceneSection[] => scene.sections.filter((s) => existsAt(rule.when, s.heading, headings));
  const counted = scene.dressing.filter((rule) => {
    if (!BUILT_KINDS.includes(rule.kind)) return false;
    const count = (rule.params as { count?: unknown } | undefined)?.count;
    return rule.class === 'text' || (typeof count === 'number' && count <= 5);
  });

  it('依据里说了数目、分组的点缀（依据是文字的，或者数目不超过五的），再远也一样不少，都是原样的那一份；两档画质造的一样多', () => {
    const lines: string[] = [`${key}：一样也不去掉的点缀`];
    const builtBy = new Map<string, number[]>();
    for (const quality of QUALITIES) {
      const ctx = ctxOf(R, quality);
      for (const rule of counted) {
        const { parts, boats } = soloRule(ctx, rule);
        const figs: FigureMarks['fig'][] = [...parts.filter((g) => marksOf(g).fig[2] !== FIG_DETAIL).map((g) => marksOf(g).fig), ...boats.map((b): FigureMarks['fig'] => [b.figure?.cls ? FIGURE_SLOT[b.figure.cls] : 0, b.figure?.rank ?? 0, 0, 0])];
        if (rule.kind === 'trees') continue;
        expect(figs.length, `${rule.name} 一样也没有造出来`).toBeGreaterThan(0);
        builtBy.set(rule.id, [...(builtBy.get(rule.id) ?? []), figs.length]);
        for (const D of sweep()) {
          const u = figureAt(ctx, D, scene.water.levels.values.normal);
          const shrunk = figs.filter((fig) => figureShow(fig, u) !== 1).length;
          expect(shrunk, `${rule.name}（${quality.tier}）在 D = ${Math.round(D)} 时有 ${shrunk} 样缩小或者去掉了`).toBe(0);
        }
      }
    }
    for (const rule of counted) {
      const built = builtBy.get(rule.id);
      if (!built) continue;
      expect(built[0], `${rule.name} 两档画质造的不一样多`).toBe(built[1]);
      lines.push(`  ${rule.name}（${rule.id}）：${built[0]} 样`);
    }
    console.log(lines.join('\n'));
  });

  it('整套模型里也一样：这些点缀成批摆的那几条（船），每一节、每个远近画的实例数都是造的数', async () => {
    for (const quality of QUALITIES) {
      const models = buildModels(ctxOf(R, quality));
      await models.prepare(headings);
      for (const section of scene.sections) {
        const levelM = scene.water.levels.values[section.water];
        const wanted = counted.filter((rule) => rule.kind === 'boats' && presentSections(rule).includes(section));
        if (wanted.length === 0) continue;
        const expected = new Map(wanted.map((rule) => [rule.id, soloRule(ctxOf(R, quality), rule).boats.length]));
        for (const D of sweep()) {
          models.apply(section.heading, levelM, D);
          const u = figureAt(ctxOf(R, quality), D, levelM);
          const drawn = new Map<string, number>();
          for (const mesh of shownFlocks(models.group)) {
            const rules = mesh.userData.rules as string[];
            for (let i = 0; i < mesh.count; i++) {
              if (!expected.has(rules[i])) continue;
              if (figureShow(marksOf(mesh.geometry, i).fig, u) === 1) drawn.set(rules[i], (drawn.get(rules[i]) ?? 0) + 1);
            }
          }
          for (const [id, n] of expected) expect(drawn.get(id) ?? 0, `${section.heading}，D = ${Math.round(D)}，${quality.tier}：${id} 画了 ${drawn.get(id) ?? 0} 条，造了 ${n} 条`).toBe(n);
        }
      }
      models.dispose();
    }
  });

  it('远了去掉一些的时候，每条点缀规则至少还剩一样原样的；有题签指着的点缀，题签那一点旁边总有一样', async () => {
    const lines: string[] = [`${key}：放大到头时各条点缀规则还剩几样（完整的一档 / 减配的一档）`];
    const left = new Map<string, number[]>();
    for (const quality of QUALITIES) {
      const ctx = ctxOf(R, quality);
      const models = buildModels(ctx);
      await models.prepare(headings);
      const treeRules = new Map<string, FigureMarks['fig'][]>();
      // 树：从整套模型里按规则数（每一组都造好了，不管显没显）。镜头贴近才有的那几棵和对应的苔点是同一棵，不重复数
      models.group.traverse((o) => {
        const mesh = o as InstancedMesh;
        if (!mesh.isInstancedMesh || !mesh.name.startsWith('trees:') || mesh.name === 'trees:close') return;
        (mesh.userData.rules as string[]).forEach((id, i) => treeRules.set(id, [...(treeRules.get(id) ?? []), marksOf(mesh.geometry, i).fig]));
      });
      models.dispose();
      for (const rule of scene.dressing) {
        if (!BUILT_KINDS.includes(rule.kind)) continue;
        const { parts, boats } = soloRule(ctx, rule);
        const things: { fig: FigureMarks['fig']; at: (u: FigureUniforms) => Vec2; size: number }[] =
          rule.kind === 'trees'
            ? (treeRules.get(rule.id) ?? []).map((fig) => ({ fig, at: (): Vec2 => [0, 0], size: 0 }))
            : [
                ...parts
                  .filter((g) => marksOf(g).fig[2] !== FIG_DETAIL)
                  .map((g) => {
                    const m = marksOf(g);
                    g.computeBoundingBox();
                    const b = g.boundingBox;
                    const size = b ? Math.max(b.max.x - b.min.x, b.max.z - b.min.z) : 0;
                    return { fig: m.fig, at: (u: FigureUniforms): Vec2 => { const p = figureMove(m.pivot, m, u); return [p[0], p[2]]; }, size };
                  }),
                ...boats.map((b) => ({ fig: [b.figure?.cls ? FIGURE_SLOT[b.figure.cls] : 0, b.figure?.rank ?? 0, 0, 0] as FigureMarks['fig'], at: (): Vec2 => [b.x, b.z], size: 58 * (b.s ?? 1) })),
              ];
        expect(things.length, `${rule.name}（${quality.tier}）一样也没有造出来`).toBeGreaterThan(0);
        // 水位取在什么也淹不着的地方：这里查的是“远了去掉”，不是“水淹了”
        const dryLevel = scene.water.levels.values.normal - 50;
        let fewest = Infinity;
        for (const D of sweep()) {
          const u = figureAt(ctx, D, dryLevel);
          const whole = things.filter((t) => figureShow(t.fig, u) === 1);
          fewest = Math.min(fewest, whole.length);
          expect(whole.length, `${rule.name}（${quality.tier}）在 D = ${Math.round(D)} 时一样原样的都不剩`).toBeGreaterThan(0);
          // 指着这条规则的题签：离它最近的那一样（原样留着的）就在旁边，不出它自己画出来的大小的一倍半
          const strip = rule.kind === 'trees' ? undefined : scene.strips.find((s) => s.of === rule.id);
          if (!strip) continue;
          const to = coords.toLocal(stripPoint(scene, strip));
          const times = u.uFigTimes.value[whole[0].fig[0]];
          const near = whole.some((t) => {
            const at = t.at(u);
            return Math.hypot(at[0] - to[0], at[1] - to[1]) <= 1.5 * t.size * times;
          });
          expect(near, `题签“${strip.text}”在 D = ${Math.round(D)} 时指着的地方旁边没有${rule.name}`).toBe(true);
        }
        left.set(rule.id, [...(left.get(rule.id) ?? []), things.length, fewest]);
      }
    }
    for (const rule of scene.dressing) {
      const n = left.get(rule.id);
      if (n) lines.push(`  ${rule.name}：${n[0]} 样里剩 ${n[1]} / ${n[2]} 样里剩 ${n[3]}`);
    }
    console.log(lines.join('\n'));
  });

  it('镜头贴近时每个顶点都在它本来的地方，一样也不缩（被大水没过了脚的篱笆、院墙除外）：近看就是只造的那一套本来的样子', async () => {
    const ctx = ctxOf(R);
    const models = buildModels(ctx);
    await models.prepare(headings);
    let checked = 0;
    let sunk = 0;
    for (const section of scene.sections) {
      const levelM = scene.water.levels.values[section.water];
      const D = 800;
      models.apply(section.heading, levelM, D);
      // 水位取在什么也淹不着的地方：水淹了树是另一回事
      const u = figureAt(ctx, D, scene.water.levels.values.normal - 50);
      const flood = figureAt(ctx, D, levelM);
      const visit = (o: Object3D): void => {
        if (!o.visible) return;
        const mesh = o as InstancedMesh;
        if ((o as { isMesh?: boolean }).isMesh) {
          const pos = mesh.geometry.attributes.position;
          if (mesh.isInstancedMesh) {
            for (let i = 0; i < mesh.count; i++) {
              const m = marksOf(mesh.geometry, i);
              // 细做的树和它对应的苔点此消彼长：贴近时细做的在，苔点不在
              const twinDot = m.fig[2] === FIG_TREE_DOT;
              expect(figureShow(m.fig, u), `${mesh.name} 第 ${i} 个贴近时不是原样`).toBe(twinDot ? 0 : 1);
              if (twinDot) continue;
              const moved = figureMove([1, 1, 1], m, u);
              expect(Math.hypot(moved[0] - 1, moved[1] - 1, moved[2] - 1)).toBeLessThan(5e-3);
              checked++;
            }
          } else {
            // 并出来的网格：隔几个顶点查一个。站在水里的东西照这一节真的水位算（倍数是 1，绕着哪里放大都一样）。
            // 站在水里、被水没过了脚的细处（大水那一节草屋的篱笆）是收掉了的，不在这里查
            for (let i = 0; i < pos.count; i += 7) {
              const p: Vec3 = [pos.getX(i), pos.getY(i), pos.getZ(i)];
              if (drowned(marksOf(mesh.geometry, i), flood) > 0) {
                sunk++;
                continue;
              }
              const moved = figureMove(p, marksOf(mesh.geometry, i), flood);
              expect(Math.hypot(moved[0] - p[0], moved[1] - p[1], moved[2] - p[2]), `${section.heading}：有一个顶点贴近时挪了地方`).toBeLessThan(5e-3);
              checked++;
            }
          }
        }
        for (const child of o.children) visit(child);
      };
      visit(models.group);
    }
    expect(checked).toBeGreaterThan(10000);
    // 收掉的只是很少的几样（篱笆、水边的一小段院墙），不是成片的东西
    expect(sunk).toBeLessThan(checked * 0.01);
    models.dispose();
  });

  it('放大到头时留着的民居，放大、摊开以后谁也不压着谁，也不压着院落；每条巷子近看时都有屋，减配的一档也是', () => {
    for (const quality of QUALITIES) {
      const ctx = ctxOf(R, quality);
      for (const rule of scene.dressing.filter((d) => d.kind === 'houses')) {
        const { parts } = soloRule(ctx, rule);
        const roofs = parts.filter((g) => marksOf(g).fig[2] !== FIG_DETAIL && marksOf(g).fig[0] === FIGURE_SLOT.cityHouse);
        // 一座屋有墙、顶、两片山墙几个零件：脚一样的是同一座
        const houses = new Map<string, BufferGeometry[]>();
        for (const g of roofs) {
          const k = marksOf(g).pivot.map((v) => v.toFixed(2)).join(',');
          houses.set(k, [...(houses.get(k) ?? []), g]);
        }
        expect(houses.size, `${rule.name}（${quality.tier}）一座屋也没有`).toBeGreaterThan(0);
        const far = figureAt(ctx, 1_000_000, scene.water.levels.values.normal);
        const kept: { x0: number; x1: number; z0: number; z1: number }[] = [];
        for (const list of houses.values()) {
          const fig = marksOf(list[0]).fig;
          const show = figureShow(fig, far);
          // 放大到头时：要么原样留着，要么一点不剩（没有缩到一半的）
          expect(show === 1 || show < 1e-6, `${rule.name} 有一座屋放大到头时缩成了 ${show.toFixed(3)}`).toBe(true);
          if (show !== 1) continue;
          const box = { x0: Infinity, x1: -Infinity, z0: Infinity, z1: -Infinity };
          for (const g of list) {
            for (const [x, , z] of movedPoints(g, far)) {
              box.x0 = Math.min(box.x0, x);
              box.x1 = Math.max(box.x1, x);
              box.z0 = Math.min(box.z0, z);
              box.z1 = Math.max(box.z1, z);
            }
          }
          kept.push(box);
        }
        expect(kept.length, `${rule.name}（${quality.tier}）放大到头时一座也不剩`).toBeGreaterThan(0);
        // 屋脊都顺着巷子（巷子是平行的）：把每座屋占的那一块转到巷子的方向上比
        const lanes = ctx.ground.cities.flatMap((c) => c.lanes).filter((l) => l.length >= 2);
        const dir: Vec2 = lanes.length ? [lanes[0][lanes[0].length - 1][0] - lanes[0][0][0], lanes[0][lanes[0].length - 1][1] - lanes[0][0][1]] : [1, 0];
        const straight = Math.abs(dir[0]) < 1e-6 || Math.abs(dir[1]) < 1e-6;
        if (straight) {
          for (let a = 0; a < kept.length; a++) {
            for (let b = a + 1; b < kept.length; b++) {
              const overlap = kept[a].x0 < kept[b].x1 && kept[b].x0 < kept[a].x1 && kept[a].z0 < kept[b].z1 && kept[b].z0 < kept[a].z1;
              expect(overlap, `${rule.name}（${quality.tier}）放大到头时有两座屋压在一起：(${kept[a].x0.toFixed(0)}, ${kept[a].z0.toFixed(0)}) 和 (${kept[b].x0.toFixed(0)}, ${kept[b].z0.toFixed(0)})`).toBe(false);
            }
          }
        }
        // 近看时每条巷子上都有屋（减配的一档去掉一半，也不会整条巷子空了）
        for (const city of ctx.ground.cities) {
          for (const lane of city.lanes.filter((l) => l.length >= 2)) {
            const on = [...houses.values()].some((list) => {
              const m = marksOf(list[0]);
              const [ax, az] = lane[0];
              const [bx, bz] = lane[lane.length - 1];
              const len = Math.hypot(bx - ax, bz - az) || 1;
              const off = Math.abs(((m.group[0] - ax) * (bz - az) - (m.group[2] - az) * (bx - ax)) / len);
              return off < 1;
            });
            expect(on, `${rule.name}（${quality.tier}）有一条巷子上一座屋也没有`).toBe(true);
          }
        }
      }
    }
  });
});

// ---------------------------------------------------------------- 徐州：船、石头、草屋

const KEY = 'su-shi/xuzhou';

interface Pane {
  name: string;
  size: { width: number; height: number };
  insets: StageInsets;
}
/** 电脑上的沙盘栏和竖着拿的平板上的沙盘栏，连同页面上真的留的空。 */
const WIDE: Pane = { name: '940 × 900', size: { width: 940, height: 900 }, insets: { top: 62, right: 0, bottom: 130, left: 0 } };
const UPRIGHT: Pane = { name: '768 × 573', size: { width: 768, height: 573 }, insets: { top: 54, right: 0, bottom: 131, left: 0 } };
/** 三种标准的画面。 */
const PANES: Pane[] = [WIDE, { name: '584 × 768', size: { width: 584, height: 768 }, insets: { top: 62, right: 0, bottom: 130, left: 0 } }, UPRIGHT];

describe.runIf(realSceneKeys().includes(KEY))('徐州：船和石头不去掉，放大几倍要场景容得下；草屋半淹在水里', () => {
  const R = realScene(KEY);
  const { scene, coords, samplers, ground } = R;
  const headings = scene.sections.map((s) => s.heading);
  const style = styleFor(scene.style);
  const ctx = ctxOf(R);
  const rule = (id: string): SceneDressing => {
    const d = scene.dressing.find((x) => x.id === id);
    if (!d) throw new Error(`场景里没有 ${id}`);
    return d;
  };
  const section = (heading: string): SceneSection => {
    const s = scene.sections.find((x) => x.heading === heading);
    if (!s) throw new Error(`场景里没有“${heading}”这一节`);
    return s;
  };
  /** 这一节的镜头在这种画面上：折算过的远近，和沙盘里一点那里一米是多少像素。 */
  const lookAt = (s: SceneSection, pane: Pane): { D: number; pxPerMetre: (p: Vec3) => number } => {
    const placed = placeCamera(s, scene, samplers, coords, style, pane.size, pane.insets);
    const { position, target, fov } = placed.pose;
    const forward: Vec3 = [target[0] - position[0], target[1] - position[1], target[2] - position[2]];
    const length = Math.hypot(...forward);
    const focal = pane.size.height / 2 / Math.tan((fov * Math.PI) / 360);
    return {
      D: equivalentDistance(placed.distanceM, fov, pane.size.height),
      pxPerMetre: (p) => focal / (((p[0] - position[0]) * forward[0] + (p[1] - position[1]) * forward[1] + (p[2] - position[2]) * forward[2]) / length),
    };
  };
  /** 把样式里某一类“最多放大几倍”换成 maxTimes，别的不动。 */
  const styleWith = (cls: FigureClass, maxTimes: number): StageStyle => {
    const figure: FigureStyle = { ...style.figure, rules: { ...style.figure.rules, [cls]: { ...style.figure.rules[cls], maxTimes } } };
    return { ...style, figure };
  };

  // ---- 船

  const cargo = scene.dressing.filter((d) => d.kind === 'boats' && dressingParams('boats', d.params).type !== 'small');
  const small = scene.dressing.filter((d) => d.kind === 'boats' && dressingParams('boats', d.params).type === 'small');
  const fleets = new Map(scene.dressing.filter((d) => d.kind === 'boats').map((d) => [d.id, soloRule(ctx, d)]));

  /** 这条规则的船放大 times 倍时，有没有两条叠在一起的（不同组的还要至少隔 apart 米）：返回头一处的说明；没有是 null。 */
  const boatsTouch = (d: SceneDressing, times: number, apart = 0): string | null => {
    const fleet = fleets.get(d.id);
    if (!fleet) return `${d.name} 没有造出来`;
    const hulls = fleet.boats.map((b) => ({ b, poly: hullOf(b, times) }));
    for (let i = 0; i < hulls.length; i++) {
      for (let j = i + 1; j < hulls.length; j++) {
        const between = gap(hulls[i].poly, hulls[j].poly);
        const same = hulls[i].b.cluster === hulls[j].b.cluster;
        if (same && between <= 0) return `${d.name}：有两条船叠在一起，在 (${hulls[i].b.x.toFixed(0)}, ${hulls[i].b.z.toFixed(0)}) 和 (${hulls[j].b.x.toFixed(0)}, ${hulls[j].b.z.toFixed(0)})`;
        if (!same && between < apart) return `${d.name}：第 ${hulls[i].b.cluster} 组和第 ${hulls[j].b.cluster} 组只隔 ${between.toFixed(1)} 米`;
      }
    }
    return null;
  };

  /**
   * 这条规则的船放大 times 倍时，船身压没压着地：返回头一处的说明；没有是 null。
   * 这条规则在场的每一节，照那一节的水位，船身轮廓上的每一点脚下都要有水（水比那里的船底深），
   * 不在水漫不进去的地方（城墙里面），不搁在墙脚的土坡上（土坡在墙角那里按“离墙角多远”算，和模型差一点）。
   * 城墙的墙身另有一条（boatsInWall）。墙角的角台、城门的城台只查本来的大小；放大以后进了多深量出来，印给看图的人（wallDepth）。
   */
  const boatsAground = (d: SceneDressing, times: number): string | null => {
    const fleet = fleets.get(d.id);
    if (!fleet) return `${d.name} 没有造出来`;
    const normalM = scene.water.levels.values.normal;
    for (const s of scene.sections.filter((x) => existsAt(d.when, x.heading, headings))) {
      const levelM = scene.water.levels.values[s.water];
      const waterY = coords.y(levelM);
      for (const b of fleet.boats) {
        for (const local of HULL_OUTLINE) {
          const [x, z] = placed(b, times, local);
          // 这一点的船底有多低：船身当中吃水深，两头悬在水面上（那里只要脚下有水）
          const bottom = waterY - draftAt(local[0]) * (b.s ?? 1) * times;
          const where = `${d.name}（${s.heading}）有一条船的船身在 (${x.toFixed(0)}, ${z.toFixed(0)})`;
          const i = Math.round((x - ground.x0) / ground.cell);
          const j = Math.round((z - ground.z0) / ground.cell);
          if (i < 0 || i >= ground.nx || j < 0 || j >= ground.nz) return `${where}，出了沙盘`;
          if (levelM > normalM + 0.01 && ground.dry[j * ground.nx + i] === 1) return `${where}，那里水漫不进去`;
          if (coords.y(samplers.waterH(x, z)) > bottom) return `${where}，那里的水不够深（或者是岸上）`;
          const bank = bankSurfaceY(fleet.pass, x, z);
          if (bank !== null && bank > bottom) return `${where}，搁在墙脚的土坡上`;
        }
      }
    }
    return null;
  };

  /**
   * 这条规则的船放大 times 倍时，船身进没进城墙的墙身：返回头一处的说明；没有是 null。
   * 城墙算岸：船是系在墙下的，船头可以挨着墙，不能扎进墙里。
   */
  const boatsInWall = (d: SceneDressing, times: number): string | null => {
    const fleet = fleets.get(d.id);
    if (!fleet) return `${d.name} 没有造出来`;
    for (const b of fleet.boats) {
      for (const local of HULL_OUTLINE) {
        const [x, z] = placed(b, times, local);
        const deep = intoWallBody(fleet.pass, x, z);
        if (deep > 0) return `${d.name}：有一条船的船身在 (${x.toFixed(0)}, ${z.toFixed(0)})，进了城墙的墙身 ${deep.toFixed(1)} 米`;
      }
    }
    return null;
  };

  /** 贴着城墙的土坡，照模型：每个三角形的三个顶点。墙角那里模型是方的，比地面的水边多伸出去一块。 */
  const bankFaces: Vec3[][] = (() => {
    const bucket: Bucket = { main: new Batch(), raised: new Batch(), boats: [] };
    const pass: Pass = { ctx, survey: surveyWalls(ctx), yards: [], lots: [], bucket: () => bucket };
    for (const thing of scene.things) if (thing.kind === 'bank') THING_BUILDERS.bank(pass, thing);
    const faces: Vec3[][] = [];
    for (const g of [...bucket.main.parts.values(), ...bucket.raised.parts.values()].flat()) {
      const pos = g.attributes.position;
      const at = (i: number): Vec3 => [pos.getX(i), pos.getY(i), pos.getZ(i)];
      const index = g.index;
      const count = index ? index.count : pos.count;
      for (let i = 0; i + 2 < count; i += 3) faces.push(index ? [at(index.getX(i)), at(index.getX(i + 1)), at(index.getX(i + 2))] : [at(i), at(i + 1), at(i + 2)]);
    }
    return faces;
  })();
  /** 这一点上土坡的模型有多高（沙盘里的高度）；这一点上没有土坡是 null。 */
  const bankModelY = (x: number, z: number): number | null => {
    let best: number | null = null;
    for (const [a, b, c] of bankFaces) {
      const det = (b[2] - c[2]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[2] - c[2]);
      if (Math.abs(det) < 1e-9) continue;
      const u = ((b[2] - c[2]) * (x - c[0]) + (c[0] - b[0]) * (z - c[2])) / det;
      const v = ((c[2] - a[2]) * (x - c[0]) + (a[0] - c[0]) * (z - c[2])) / det;
      if (u < 0 || v < 0 || u + v > 1) continue;
      const y = u * a[1] + v * b[1] + (1 - u - v) * c[1];
      if (best === null || y > best) best = y;
    }
    return best;
  };
  /** 这条规则的船按本来的大小，船身压没压在土坡的模型上（那一点的坡面比船底高）：返回头一处的说明；没有是 null。 */
  const boatsOnBankModel = (d: SceneDressing): string | null => {
    const fleet = fleets.get(d.id);
    if (!fleet) return `${d.name} 没有造出来`;
    for (const s of scene.sections.filter((x) => existsAt(d.when, x.heading, headings))) {
      const waterY = coords.y(scene.water.levels.values[s.water]);
      for (const b of fleet.boats) {
        for (const local of HULL_OUTLINE) {
          const [x, z] = placed(b, 1, local);
          const bank = bankModelY(x, z);
          if (bank !== null && bank > waterY - draftAt(local[0]) * (b.s ?? 1)) return `${d.name}（${s.heading}）有一条船的船身在 (${x.toFixed(0)}, ${z.toFixed(0)})，压在墙脚土坡的模型上`;
        }
      }
    }
    return null;
  };

  /** 这条规则的船放大 times 倍时，船身进城墙的模型最深多少米：[墙身的墙脚或者角台, 城门的城台]。 */
  const wallDepth = (d: SceneDressing, times: number): [number, number] => {
    const fleet = fleets.get(d.id);
    let wall = 0;
    let gate = 0;
    if (!fleet) return [0, 0];
    for (const s of scene.sections.filter((x) => existsAt(d.when, x.heading, headings))) {
      for (const b of fleet.boats) {
        for (const local of HULL_OUTLINE) {
          const [x, z] = placed(b, times, local);
          wall = Math.max(wall, intoWall(fleet.pass, x, z));
          gate = Math.max(gate, intoGate(fleet.pass, s.heading, x, z));
        }
      }
    }
    return [wall, gate];
  };

  /**
   * 这条规则的船放大 times 倍时哪里不对：返回头一处不对的说明；都对是 null。
   *   沿一条线系着的（依据说“三到六条一组，一组一组分开系”）：同一组里的船不叠，不同组的船身至少隔 30 米，船身不压着地，不进城墙的墙身；
   *   小船（依据说“两条小船”）：不叠，船身不压着地。
   * 一个点四周散着摆的货船（东门下、城角的那几条）是点缀，依据里没有说它们怎么摆：这里不管，量出来的数只印给看图的人。
   */
  const boatsWrong = (d: SceneDressing, times: number): string | null => {
    if (d.line) return boatsTouch(d, times, 30) ?? boatsAground(d, times) ?? boatsInWall(d, times);
    if (dressingParams('boats', d.params).type === 'small') return boatsTouch(d, times) ?? boatsAground(d, times);
    return null;
  };

  it('场景容得下的倍数：货船、小船、石头各最多能放大到几倍（印出来，给调样式的人）', { timeout: 30_000 }, () => {
    // 这一项在发布流程的机器上要比默认的 5 秒久（这台机器上 2 秒左右）：给它自己的时限，不把要走的步数减少。
    const boat = largest((k) => cargo.every((d) => boatsWrong(d, k) === null), 8);
    const smallBoat = largest((k) => small.every((d) => boatsWrong(d, k) === null), 8);
    const lines = [
      '徐州：船、石头一样也不去掉，最多能放大到几倍要场景容得下（样式里的数不能比它大）',
      `  货船（boat）：${boat.toFixed(2)} 倍。再大：${cargo.map((d) => boatsWrong(d, boat + 0.02)).find((w) => w !== null) ?? '（没有量到别的毛病）'}`,
      `  小船（smallBoat）：${smallBoat >= 8 ? '8 倍以上' : `${smallBoat.toFixed(2)} 倍`}。${smallBoat >= 8 ? '' : `再大：${small.map((d) => boatsWrong(d, smallBoat + 0.02)).find((w) => w !== null)}`}`,
      `  石头（rock）：${rockLimit().toFixed(2)} 倍。再大：${rocksWrong(rockLimit() + 0.02) ?? '（没有量到别的毛病）'}`,
      `  样式里现在写的：boat ${style.figure.rules.boat.maxTimes}，smallBoat ${style.figure.rules.smallBoat.maxTimes}，rock ${style.figure.rules.rock.maxTimes}`,
      '  （上面的数管的是墙身；角台和城台只管本来的大小。给看图的人）系在城下的船放大以后，船头进了城墙的模型多深（按模型的墙脚算；墙身在水面那里比墙脚薄 4 米上下）：',
      ...[1, 1.2, 1.4, style.figure.rules.boat.maxTimes, boat].map((k) => {
        const [wall, gate] = wallDepth(rule('boats-flood'), k);
        return `    放大 ${k.toFixed(2)} 倍：墙身的墙脚或角台 ${wall.toFixed(1)} 米，城门的城台 ${gate.toFixed(1)} 米`;
      }),
      '  （不算在上面的数里，给看图的人）一个点四周散着摆的货船是点缀，放大到这么多倍就有两条碰在一起、有一条压着岸：',
      ...cargo.filter((d) => !d.line).map((d) => `    ${d.name}：碰在一起 ${largest((k) => boatsTouch(d, k) === null, 8).toFixed(2)} 倍，压着岸 ${largest((k) => boatsAground(d, k) === null, 8).toFixed(2)} 倍`),
    ];
    console.log(lines.join('\n'));
    expect(boat).toBeGreaterThanOrEqual(1);
    expect(smallBoat).toBeGreaterThanOrEqual(1);
    expect(rockLimit()).toBeGreaterThanOrEqual(1);
  });

  it('系在城下的船（和别的货船）放大到头：还是一组一组分开的，组和组至少隔 30 米，同一组里不叠，船身不压着岸、不进城墙的墙身', () => {
    const times = style.figure.rules.boat.maxTimes;
    // 系在城下的那一条规则：照依据是三到六条一组，分开系
    const flood = fleets.get('boats-flood');
    expect(flood).toBeDefined();
    if (!flood) return;
    const groups = new Map<number, number>();
    for (const b of flood.boats) groups.set(b.cluster ?? -1, (groups.get(b.cluster ?? -1) ?? 0) + 1);
    expect(groups.size).toBeGreaterThanOrEqual(3);
    for (const n of groups.values()) {
      expect(n).toBeGreaterThanOrEqual(3);
      expect(n).toBeLessThanOrEqual(6);
    }
    expect(flood.boats.length).toBeGreaterThan(20);
    for (const d of cargo) expect(boatsWrong(d, 1), '按本来的大小就不对').toBeNull();
    // 一个点四周散着摆的那几条怎么摆，依据里没有说；但按本来的大小，哪两条船身都不该叠在一起
    for (const d of cargo) expect(boatsTouch(d, 1), '按本来的大小就有船叠在一起').toBeNull();
    // 按本来的大小：船身不进城墙的模型（墙身、墙角的角台、城门的城台）；货船不压在墙脚土坡的模型上（墙角那里模型是方的）
    expect(wallDepth(rule('boats-flood'), 1)).toEqual([0, 0]);
    for (const d of cargo) expect(boatsOnBankModel(d)).toBeNull();
    for (const d of cargo) expect(boatsWrong(d, times), `样式里货船最多放大 ${times} 倍，场景容不下`).toBeNull();
  });

  it('百步洪的小船是两条，放大到头不叠，也不压着岸', () => {
    const times = style.figure.rules.smallBoat.maxTimes;
    const rapids = fleets.get('boats-rapids');
    expect(rapids?.boats).toHaveLength(2);
    for (const d of small) expect(boatsWrong(d, 1), '按本来的大小就不对').toBeNull();
    for (const d of small) expect(boatsWrong(d, times), `样式里小船最多放大 ${times} 倍，场景容不下`).toBeNull();
  });

  // ---- 石头

  const rocks = soloRule(ctx, rule('rocks-rapids'));
  /** 河里的乱石（两岸的那几块是细处，不算）。 */
  const inRiver = rocks.parts.filter((g) => marksOf(g).fig[2] !== FIG_DETAIL);
  const rapidsAt = coords.toLocal(rule('rocks-rapids').at ?? [0, 0]);
  const radius = dressingParams('rocks', rule('rocks-rapids').params).radiusM ?? 260;
  const s5 = section('云龙山和百步洪');
  const normalY = coords.y(scene.water.levels.values.normal);

  /**
   * 石头这一类最多放大 maxTimes 倍时哪里不对；都对是 null。
   *   “西边留出一线水路”：在 云龙山和百步洪 这一节，电脑上最西边那块石头（露出水面的部分）以西还有至少 8 像素的水，
   *   竖着拿的平板上至少 5.1 像素（两个数说的是同一段水：二十九米上下；平板上的沙盘栏高 573，是电脑上 900 的六成多）；
   *   乱石不连成一片：放大到头时，石头（露出水面的部分）盖住的水面不超过它们那一片（那一圈里的河面）的七成。
   */
  function rocksWrong(maxTimes: number): string | null {
    const withRocks = ctxOf(R, FULL_QUALITY, styleWith('rock', maxTimes));
    for (const [pane, least] of [
      [WIDE, 8],
      [UPRIGHT, 5.1],
    ] as const) {
      const look = lookAt(s5, pane);
      const u = figureAt(withRocks, look.D, scene.water.levels.values.normal);
      let west: Vec3 | null = null;
      for (const g of inRiver) for (const p of movedPoints(g, u)) if (p[1] >= normalY && (west === null || p[0] < west[0])) west = p;
      if (!west) return '河里没有露出水面的石头';
      // 从那一点往西走到岸：离河岸多远（河里是负数）
      let bank = west[0];
      while (bank > coords.x0 && samplers.edge(bank, west[2]) < 0) bank -= 1;
      const px = (west[0] - bank) * look.pxPerMetre([west[0], normalY, west[2]]);
      if (px < least) return `${pane.name} 上最西边的石头以西只剩 ${px.toFixed(1)} 像素的水（${(west[0] - bank).toFixed(0)} 米），要 ${least} 像素`;
    }
    const far = figureAt(withRocks, 1_000_000, scene.water.levels.values.normal);
    const hulls = inRiver
      .map((g) => hull(movedPoints(g, far).filter((p) => p[1] >= normalY).map((p): Vec2 => [p[0], p[2]])))
      .filter((poly) => poly.length >= 3);
    let patch = 0;
    let covered = 0;
    for (let x = rapidsAt[0] - radius; x <= rapidsAt[0] + radius; x += 4) {
      for (let z = rapidsAt[1] - radius; z <= rapidsAt[1] + radius; z += 4) {
        if (Math.hypot(x - rapidsAt[0], z - rapidsAt[1]) > radius || samplers.edge(x, z) >= 0) continue;
        patch++;
        if (hulls.some((poly) => insideConvex(poly, [x, z]))) covered++;
      }
    }
    if (covered > 0.7 * patch) return `放大到头时石头盖住了那一片河面的 ${((100 * covered) / patch).toFixed(0)}%，连成一片了（最多七成）`;
    return null;
  }
  let limit: number | null = null;
  function rockLimit(): number {
    limit ??= largest((m) => rocksWrong(m) === null, 8);
    return limit;
  }

  it('百步洪的乱石放大到头：西边留得出一线水路（电脑上至少 8 像素，竖着拿的平板上至少 5.1 像素），石头不连成一片', () => {
    expect(inRiver.length).toBeGreaterThan(20);
    expect(rocksWrong(1.0001), '按本来的大小就不对').toBeNull();
    const times = style.figure.rules.rock.maxTimes;
    expect(rocksWrong(times), `样式里石头最多放大 ${times} 倍，场景容不下`).toBeNull();
  });

  // ---- 草屋

  it('水及其半扉：大水正好淹到张山人的草屋那扇门的一半上下，在哪种画面上、镜头多远都是（它绕着水面那一条线放大）；篱笆大半没在水里', () => {
    const hutThing = scene.things.find((t) => t.id === 'old-hut');
    expect(hutThing).toBeDefined();
    if (!hutThing) return;
    const bucket: Bucket = { main: new Batch(), raised: new Batch(), boats: [] };
    const pass: Pass = { ctx, survey: surveyWalls(ctx), yards: [], lots: [], bucket: () => bucket };
    THING_BUILDERS.house(pass, hutThing);
    // 屋身、屋顶、台基、门（篱笆是细处，另算）
    const body = [...bucket.main.parts.values()].flat().filter((g) => marksOf(g).fig[2] !== FIG_DETAIL);
    const fence = [...bucket.main.parts.values()].flat().filter((g) => marksOf(g).fig[2] === FIG_DETAIL);
    expect(body.length).toBeGreaterThanOrEqual(5);
    expect(fence.length).toBeGreaterThan(20);
    // 门：屋身上唯一一块深色木头
    const doors = (bucket.main.parts.get('timber') ?? []).filter((g) => marksOf(g).fig[2] !== FIG_DETAIL);
    expect(doors).toHaveLength(1);
    const s3 = section('住在城墙上');
    const floodM = scene.water.levels.values[s3.water];
    const waterY = coords.y(floodM);
    /** 一批零件在这一份数下最低、最高到哪。 */
    const span = (parts: BufferGeometry[], u: FigureUniforms): [number, number] => {
      let lo = Infinity;
      let hi = -Infinity;
      for (const g of parts) {
        for (const p of movedPoints(g, u)) {
          lo = Math.min(lo, p[1]);
          hi = Math.max(hi, p[1]);
        }
      }
      return [lo, hi];
    };
    /** 水淹到门的几成；屋（墙脚到屋脊）露在水面上的有多高。 */
    const flooded = (D: number, levelM: number): { door: number; above: number } => {
      const u = figureAt(ctx, D, levelM);
      const [lo, hi] = span(doors, u);
      return { door: (coords.y(levelM) - lo) / (hi - lo), above: span(body, u)[1] - coords.y(levelM) };
    };
    const trueSize = flooded(100, floodM);
    // 依据说“水及其半扉”：水到门的一半上下
    expect(trueSize.door).toBeGreaterThan(0.35);
    expect(trueSize.door).toBeLessThan(0.65);
    const lines = [`徐州：大水淹到草屋那扇门的 ${(trueSize.door * 100).toFixed(1)}%（本来的大小；屋露在水面上 ${trueSize.above.toFixed(1)}）`];
    for (const pane of PANES) {
      const look = lookAt(s3, pane);
      const now = flooded(look.D, floodM);
      lines.push(`  ${pane.name}：D ${Math.round(look.D)}，屋放大 ${(now.above / trueSize.above).toFixed(2)} 倍，淹到门的 ${(now.door * 100).toFixed(1)}%`);
      expect(Math.abs(now.door - trueSize.door)).toBeLessThan(0.05 * trueSize.door);
      expect(now.above).toBeGreaterThan(trueSize.above * 1.5);
    }
    for (const D of sweep()) expect(Math.abs(flooded(D, floodM).door - trueSize.door), `D = ${Math.round(D)} 时淹到门的成数变了`).toBeLessThan(0.05 * trueSize.door);
    console.log(lines.join('\n'));
    // 对照：要是绕着屋脚放大（不带“站在水里”的记号），放大到头时水只淹到门脚——这正是要避免的
    const u = figureAt(ctx, 1_000_000, floodM);
    let lo = Infinity;
    let hi = -Infinity;
    for (const g of doors) {
      const pos = g.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const m = marksOf(g, i);
        const p = figureMove([pos.getX(i), pos.getY(i), pos.getZ(i)], { ...m, fig: [m.fig[0], m.fig[1], m.fig[2], 0] }, u);
        lo = Math.min(lo, p[1]);
        hi = Math.max(hi, p[1]);
      }
    }
    expect((waterY - lo) / (hi - lo)).toBeLessThan(0.2);
    // 水退了以后（平时的水位在屋脚下面），它绕着屋脚放大，脚不动
    const dry = figureAt(ctx, 1_000_000, scene.water.levels.values.normal);
    const foot = marksOf(body[0]).pivot;
    expect(figureMove(foot, marksOf(body[0]), dry)).toEqual(foot);
    // 篱笆：大水那一节大半圈没在水里，水没过脚一米的收掉了，不在水面上留一圈线（靠山的那一边地势高，还在）；“水来了”那一节水还没到，一根不少
    for (const D of [800, lookAt(s3, WIDE).D, 1_000_000]) {
      const flood = figureAt(ctx, D, floodM);
      expect(fence.filter((g) => drowned(marksOf(g), flood) === 1).length).toBeGreaterThan(fence.length / 3);
      expect(fence.filter((g) => drowned(marksOf(g), flood) > 0).length).toBeGreaterThan(fence.length / 2);
      const rising = figureAt(ctx, D, scene.water.levels.values.rising);
      for (const g of fence) expect(drowned(marksOf(g), rising)).toBe(0);
    }
  });

  it('草屋、放鹤亭、台头寺各带着挨着它的东西整组放大：果树、亭下的小屋、松树都从主角的脚摊开', async () => {
    const models = buildModels(ctx);
    await models.prepare(headings);
    const fine: { rule: string; marks: FigureMarks; world: Vec3; scaleY: number }[] = [];
    models.group.traverse((o) => {
      const mesh = o as InstancedMesh;
      if (!mesh.isInstancedMesh || mesh.name !== 'trees:fine') return;
      (mesh.userData.rules as string[]).forEach((id, i) => {
        const e = mesh.instanceMatrix.array;
        fine.push({ rule: id, marks: marksOf(mesh.geometry, i), world: [e[i * 16 + 12], e[i * 16 + 13], e[i * 16 + 14]], scaleY: e[i * 16 + 5] });
      });
    });
    models.dispose();
    const expectJoined = (ruleId: string, cls: FigureClass, mainId: string): void => {
      const trees = fine.filter((t) => t.rule === ruleId);
      expect(trees.length, `${ruleId} 没有树`).toBeGreaterThan(2);
      const main = scene.things.find((t) => t.id === mainId);
      if (!main?.at) throw new Error(`场景里没有 ${mainId}`);
      const [mx, mz] = coords.toLocal(main.at);
      for (const t of trees) {
        expect(t.marks.fig[0]).toBe(FIGURE_SLOT[cls]);
        // 共同的那一点写在树自己的坐标里；换回沙盘的坐标就是主角的脚
        expect(Math.hypot(t.world[0] - mx, t.world[2] - mz)).toBeGreaterThan(30);
        expect(Math.hypot(t.marks.group[0], t.marks.group[2])).toBeGreaterThan(1);
      }
    };
    expectJoined('fruit-trees', 'hut', 'old-hut');
    expectJoined('pines-temple', 'yardOut', 'taitousi');
    // 亭下的小屋：类跟着放鹤亭，横竖从放鹤亭的脚摊开；高度跟着地面走：摊开到头时它的脚正好在那里的地面下 1
    const house = scene.things.find((t) => t.id === 'fangheting-house');
    const pavilion = scene.things.find((t) => t.id === 'fangheting');
    if (!house || !pavilion?.at) throw new Error('场景里没有放鹤亭和亭下的小屋');
    const bucket: Bucket = { main: new Batch(), raised: new Batch(), boats: [] };
    const pass: Pass = { ctx, survey: surveyWalls(ctx), yards: [], lots: [], bucket: () => bucket };
    THING_BUILDERS.house(pass, house);
    const [px, pz] = coords.toLocal(pavilion.at);
    const spreadOut = figureAt(ctx, 1_000_000, scene.water.levels.values.normal);
    for (const g of [...bucket.main.parts.values()].flat()) {
      const m = marksOf(g);
      expect(m.fig[0]).toBe(FIGURE_SLOT.pavilion);
      expect(m.group[0]).toBeCloseTo(px, 1);
      expect(m.group[2]).toBeCloseTo(pz, 1);
      const landed = figureMove(m.pivot, m, spreadOut);
      expect(Math.hypot(landed[0] - px, landed[2] - pz)).toBeGreaterThan(Math.hypot(m.pivot[0] - px, m.pivot[2] - pz) * 2);
      expect(landed[1]).toBeCloseTo(coords.y(samplers.height(landed[0], landed[2])) - 1, 1);
    }
    // 果树也一样：摊开到头时，每棵的脚在它到了的那个地方的地面下 1
    const fruit = fine.filter((t) => t.rule === 'fruit-trees');
    for (const t of fruit) {
      // 记号写在树自己的坐标里：共同的那一点比树的脚高出多少，换回沙盘里要乘这棵树竖向的大小
      const spread = style.figure.rules.hut.spreadAtMax ?? 1;
      const main = scene.things.find((x) => x.id === 'old-hut');
      if (!main?.at) throw new Error('场景里没有草屋');
      const [mx, mz] = coords.toLocal(main.at);
      const x = mx + (t.world[0] - mx) * spread;
      const z = mz + (t.world[2] - mz) * spread;
      const landedY = t.world[1] + t.marks.group[1] * t.scaleY * (1 - spread);
      expect(landedY, `果树 (${t.world[0].toFixed(0)}, ${t.world[2].toFixed(0)})`).toBeCloseTo(coords.y(samplers.height(x, z)) - 1, 0);
    }
  });
});
