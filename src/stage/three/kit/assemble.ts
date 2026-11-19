// 总装：把场景里的摆件和点缀造成一座沙盘的全部小模型，并且按小节、水位、镜头远近让它们变。
//
// 模型只有一套，只造一遍：近看的样子、本来的大小和位置。镜头远了近了不换模型，也不重造：
//   每样东西的顶点上带着记号（脚在哪、哪一类、次序……），apply() 每一帧只把十几个数交给显卡
//   （每一类现在放大几倍、留几成、摊开几倍，细处收了多少，水面多高，见 figureMaterial.ts），大小是显卡算的。
//   在这里（不在显卡上）改的只有四样：城墙、城门那一组竖向的倍数；船那一组跟着水位升降；
//   成批摆的苔点只画次序在前面的那些（后面的已经缩成一个点了）；镜头贴近才有的那几棵细做的树，不贴近时不画。
//   看得见的东西没有哪一样是一下子换掉的：一个网格只在它里面的东西都缩成了一个点的时候才不画。
// 怎么分组：
//   每样东西照它的 when 算出“哪几个小节有”，同一些小节里有的东西并成一组（一种材质一个网格，船、树各是成批摆的网格），
//   换小节只是开关几组。
// 什么时候造：buildModels 本身只量城墙、备好材质，不造模型。prepare() 一小块一小块地造：先把所有东西摆好（算出形状），
// 再把要用的那几组一组一组并成网格，中间让出时间给页面。apply() 发现要显的一组还没造，就当场造
// （这只是兜底，正常应当先 prepare）。
// 这里不碰页面（document、window），在 Node 里也能跑。

import * as THREE from 'three';
import { DRESSING_KINDS, THING_KINDS } from '../../../domain/sceneKinds';
import type { When } from '../../../domain/scene';
import { existsAt } from '../../../domain/sceneText';
import type { Vec2 } from '../../ground/types';
import type { KitContext, ModelSet } from '../internal';
import { DRESSING_BUILDERS } from './dressing';
import { FIGURE_SLOT, FIG_WET, KEEP_FRINGE, setFigure } from './figureMaterial';
import { Batch } from './geo';
import { makeMaterials } from './materials';
import { dressingParams } from './params';
import { groupPoint, joinedTo } from './pass';
import type { Bucket, Pass } from './pass';
import { boatGeo, instanced } from './shapes';
import type { Instance } from './shapes';
import { surveyWalls } from './site';
import { THING_BUILDERS } from './things';
import { cityTreeRule, cityTrees, keptTree, metreOfWater, plantTrees, rankTrees, treeLists, treeShapes } from './trees';
import type { RankedTree, TreeShapes, TreeSorting } from './trees';

/**
 * 写了这个 when 的东西，在各个小节里有没有（headings 是全部小节标题，按先后）。
 * 有没有只照 src/domain/sceneText.ts 的 existsAt 算，和页面上的说明、凭据是同一个规矩。
 */
export function presentIn(when: When | undefined, headings: string[]): boolean[] {
  return headings.map((heading) => existsAt(when, heading, headings));
}

const signature = (present: boolean[]): string => present.map((v) => (v ? '1' : '0')).join('');

/** 一个形状有多少个三角形。 */
function triangleCount(geo: THREE.BufferGeometry): number {
  return (geo.index ? geo.index.count : geo.attributes.position.count) / 3;
}

/** 让出一小会儿给页面，再接着造。 */
function pause(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestIdleCallback === 'function') requestIdleCallback(() => resolve(), { timeout: 200 });
    else setTimeout(resolve, 0);
  });
}

/** 按次序从小到大排好的一批里，次序比 limit 小的有几个。 */
function countBelow(ranks: Float32Array, limit: number): number {
  let lo = 0;
  let hi = ranks.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (ranks[mid] < limit) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** 摆好了、还没有并成网格的一组：同一些小节里有的东西。 */
interface Laid {
  sig: string;
  /** 各个小节里有没有。 */
  present: boolean[];
  bucket: Bucket;
  trees: RankedTree[];
}

/** 一个成批摆的网格（船，或者一种形状的树）。 */
interface Flock {
  mesh: THREE.InstancedMesh;
  /** 一个实例多少个三角形，一共多少个实例。 */
  each: number;
  total: number;
  /**
   * 这一批是同一类、按次序排好的时候：各个实例的次序。远了只画次序在“留几成”那条线以内的前几个
   * （线以外的已经缩成一个点了）。不是的话是 null，全画。
   */
  ranks: Float32Array | null;
  /** 这一批是哪一类（figureMaterial.ts 的号）。 */
  slot: number;
  /** 镜头贴近时才长出来的那几棵细做的树：它们占的成数是 0 的时候整个不画。 */
  close: boolean;
}

/** 造好的一组。 */
interface Part {
  object: THREE.Group;
  present: boolean[];
  /** 并出来的网格一共多少个三角形（收掉的细处也算：它们照样交给显卡）。 */
  merged: number;
  /** 城墙、城门那一组：远了整体拔高。没有是 null。 */
  raised: THREE.Group | null;
  /** 这一组里的船：整组跟着水位升降。没有船是 null。 */
  floats: THREE.Group | null;
  flocks: Flock[];
  /** 水面高过这里（沙盘里的高度），这一组里就有东西跟着水变：树脚下的水够深了，或者站在水里的屋。没有这样的东西是无穷大。 */
  waterFrom: number;
}

/** 造模型。 */
export function buildModels(ctx: KitContext): ModelSet {
  const { scene, style, coords, quality, ground } = ctx;
  const headings = scene.sections.map((s) => s.heading);
  const group = new THREE.Group();
  const materials = makeMaterials(style);
  const survey = surveyWalls(ctx);
  const cityCentre: Vec2 = ground.cities.length ? ground.cities[0].centre : [0, 0];

  let laid: Laid[] | null = null;
  let sorting: TreeSorting | null = null;
  const parts: (Part | undefined)[] = [];
  let boat: THREE.BufferGeometry | null = null;
  let shapes: TreeShapes | null = null;
  let disposed = false;
  /** 上一次 apply 显出来的是什么（用来看变没变）和一共多少个三角形。 */
  let shownKey = '';
  let shownTriangles = 0;

  /**
   * 把所有东西摆好：各种零件按固定的先后造（城墙、城门、楼……然后是成片的民居、村子、船、石头），形状放进各自的那一组；
   * 再种树，排好次序，分到各组。这一步只算形状，不做网格。
   */
  function lay(): Laid[] {
    if (laid) return laid;
    const buckets = new Map<string, Laid>();
    const entry = (when: When | undefined): Laid => {
      const present = presentIn(when, headings);
      const sig = signature(present);
      let e = buckets.get(sig);
      if (!e) {
        e = { sig, present, bucket: { main: new Batch(), raised: new Batch(), boats: [] }, trees: [] };
        buckets.set(sig, e);
      }
      return e;
    };
    const pass: Pass = { ctx, survey, yards: [], lots: [], bucket: (when) => entry(when).bucket };
    for (const kind of THING_KINDS) for (const thing of scene.things) if (thing.kind === kind) THING_BUILDERS[kind](pass, thing);
    for (const kind of DRESSING_KINDS) for (const rule of scene.dressing) if (rule.kind === kind) DRESSING_BUILDERS[kind](pass, rule);

    // 树：照规则种下去的，加上城里空地上的（空地是摆民居时留出来的）
    const planted = plantTrees(ctx, survey, materials.treeColours);
    const cityRule = cityTreeRule(scene.dressing);
    const rule = cityRule >= 0 ? scene.dressing[cityRule] : null;
    const p = rule ? dressingParams('trees', rule.params) : {};
    const inCity = rule ? cityTrees(pass.lots, cityRule, p.type ?? 'mixed', materials.treeColours, p.seed ?? 1037) : [];
    // 画质里不留的不造；每条规则至少留一棵
    for (const t of rankTrees(ctx, planted.concat(inCity))) if (keptTree(t, quality.treeKeep)) entry(scene.dressing[t.rule].when).trees.push(t);

    sorting = {
      ctx,
      centre: cityCentre,
      // 镜头贴近的那几节各对准哪一点：那一点四周的苔点另有一棵细做的
      closeSpots: scene.sections.filter((s) => s.camera.distanceM < style.figure.closeTreesM[0]).map((s) => coords.toLocal(s.camera.target)),
      joined: (index, foot, sink) => {
        const joined = joinedTo(pass, scene.dressing[index].id);
        return joined ? { cls: joined.cls, group: groupPoint(pass, joined, foot, sink) } : null;
      },
    };
    laid = [...buckets.values()];
    return laid;
  }

  /** 把摆好的一组并成网格，挂进场景（先不显）。造过了就直接给。 */
  function finish(i: number): Part {
    const have = parts[i];
    if (have) return have;
    const { sig, present, bucket, trees } = lay()[i];
    const object = new THREE.Group();
    object.name = `set:${sig}`;
    object.visible = false;

    const named: Record<string, THREE.Material | undefined> = materials.named;
    let waterFrom = Infinity;
    const merge = (batch: Batch): THREE.Group => {
      for (const [name, list] of batch.parts) {
        if (!named[name]) throw new Error(`零件库里没有 ${name} 这种材质`);
        // 站在水会漫到的地方的东西：水高过它的脚，它就跟着水变
        for (const g of list) if (g.attributes.aFig.getZ(0) < 1.5 && g.attributes.aFig.getW(0) >= FIG_WET) waterFrom = Math.min(waterFrom, g.attributes.aPivot.getY(0));
      }
      const merged = batch.build(named);
      // 影子要跟着模型一起变：每个网格画影子用的都是补过的那一份材质
      for (const o of merged.children) (o as THREE.Mesh).customDepthMaterial = materials.depth;
      return merged;
    };
    const mergedTriangles = bucket.main.tris + bucket.raised.tris;
    if (bucket.main.parts.size) object.add(merge(bucket.main));
    let raised: THREE.Group | null = null;
    if (bucket.raised.parts.size) {
      raised = merge(bucket.raised);
      object.add(raised);
    }

    const flocks: Flock[] = [];
    const flock = (shape: THREE.BufferGeometry, material: THREE.Material, list: Instance[], name: string, close = false): THREE.InstancedMesh | null => {
      if (list.length === 0) return null;
      const mesh = instanced(shape, material, list);
      mesh.name = name;
      mesh.customDepthMaterial = materials.depth;
      // 每个实例属于哪一条点缀规则：模型用不着，数数的时候用（测试、查错）
      mesh.userData.rules = list.map((it) => it.rule ?? '');
      const cls = list[0].figure?.cls ?? null;
      const rank = (it: Instance): number => it.figure?.rank ?? 0;
      const sorted = list.every((it, k) => (it.figure?.cls ?? null) === cls && (k === 0 || rank(list[k - 1]) <= rank(it)));
      flocks.push({ mesh, each: triangleCount(shape), total: list.length, ranks: sorted ? Float32Array.from(list.map(rank)) : null, slot: cls ? FIGURE_SLOT[cls] : 0, close });
      return mesh;
    };

    let floats: THREE.Group | null = null;
    if (bucket.boats.length) {
      boat ??= boatGeo();
      const mesh = flock(boat, materials.boat, bucket.boats, 'boats');
      if (mesh) {
        floats = new THREE.Group();
        floats.add(mesh);
        object.add(floats);
      }
    }
    if (trees.length && sorting) {
      shapes ??= treeShapes();
      const lists = treeLists(trees, sorting);
      for (const list of [lists.round, lists.plain, lists.city, lists.fine, lists.close]) for (const it of list) waterFrom = Math.min(waterFrom, it.figure?.mark ?? Infinity);
      for (const mesh of [
        flock(shapes.blob1, materials.tree, lists.round, 'trees:round'),
        flock(shapes.blob0, materials.tree, lists.plain, 'trees:plain'),
        flock(shapes.blob1, materials.tree, lists.city, 'trees:city'),
        flock(shapes.clump, materials.tree, lists.fine, 'trees:fine'),
        flock(shapes.clump, materials.tree, lists.close, 'trees:close', true),
      ]) {
        if (mesh) object.add(mesh);
      }
    }
    // 并好了，摆的时候攒的那些形状用不着了
    bucket.main.parts.clear();
    bucket.raised.parts.clear();

    group.add(object);
    const part: Part = { object, present, merged: mergedTriangles, raised, floats, flocks, waterFrom };
    parts[i] = part;
    return part;
  }

  return {
    group,

    apply(section, waterLevelM, viewDistanceM) {
      if (disposed) return false;
      const si = headings.indexOf(section);
      if (si < 0) return false;
      const waterY = coords.y(waterLevelM);
      // 大小、留几成、摊开多少、细处、水面：都只是这一份数，显卡照它算
      setFigure(materials.figure, style, viewDistanceM, waterY, metreOfWater(ctx, waterLevelM));
      const figure = materials.figure;
      const wallTimes = figure.uFigTimes.value[FIGURE_SLOT.wallH];
      const closeUp = figure.uFigClose.value > 0;

      let key = '';
      let triangles = 0;
      let watery = false;
      lay().forEach((entry, i) => {
        if (!entry.present[si]) {
          const hidden = parts[i];
          if (hidden) hidden.object.visible = false;
          return;
        }
        const p = finish(i);
        p.object.visible = true;
        key += `,${i}`;
        triangles += p.merged;
        if (p.raised) p.raised.scale.y = wallTimes;
        if (p.floats) {
          p.floats.position.y = waterY;
          watery = true;
        }
        if (waterY > p.waterFrom) watery = true;
        for (const f of p.flocks) {
          f.mesh.visible = !f.close || closeUp;
          f.mesh.count = f.ranks ? countBelow(f.ranks, figure.uFigKeep.value[f.slot] / KEEP_FRINGE) : f.total;
          if (f.mesh.visible) triangles += f.each * f.mesh.count;
        }
      });
      // 有船的时候水位一动船就跟着动；树脚下进了水、屋子站在水里的时候，水位一动它们也变：影子要重画
      if (watery) key += `|${waterY.toFixed(2)}`;
      const changed = key !== shownKey;
      shownKey = key;
      shownTriangles = triangles;
      return changed;
    },

    async prepare(sections) {
      for (const heading of sections) {
        const si = headings.indexOf(heading);
        if (si < 0) continue;
        if (!laid) {
          await pause();
          if (disposed) return;
          lay();
        }
        const entries = lay();
        for (let i = 0; i < entries.length; i++) {
          if (!entries[i].present[si] || parts[i]) continue;
          await pause();
          if (disposed) return;
          finish(i);
        }
      }
    },

    triangles() {
      return disposed ? 0 : shownTriangles;
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      group.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) m.geometry.dispose();
        const im = o as THREE.InstancedMesh;
        if (im.isInstancedMesh) im.dispose();
      });
      group.clear();
      boat?.dispose();
      if (shapes) for (const g of Object.values(shapes)) g.dispose();
      materials.dispose();
      laid = null;
      sorting = null;
      parts.length = 0;
      shownTriangles = 0;
    },
  };
}
