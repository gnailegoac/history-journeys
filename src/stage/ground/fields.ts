// 把今天的高程整理成沙盘用的地面。先后是（docs/data-spec.md 的“地形”一节也是这样写的）：
//   1 整理：平地抹平（今天低的地方垫高，高的地方压低），山留着，但也跟着矮一截；
//   2 修整：按场景里写的先后，一处一处做；
//   3 沙盘四边：山收低到平地；
//   4 河和壕：算每一格离河岸多远，压河岸，挖河床；
//   5 写了 inside 的修整再压一遍，城里才是一块平地；
//     修整把地面压到平时的水位以下的地方也是水（openWater）：让“离河岸多远”认得它；
//   6 水看到的地面，水漫不进去的地方；
//   7 给上色、摆树用的几样：哪里算山、凸凹；
//   8 从场景带过来的：城的平面、村子、要画在地面上的路和田。
// 这里只算数，不碰 three，也不碰页面。同样的输入每次算出一样的结果。
//
// 整理和挖河的算法是从样张搬来的（spikes/art-direction/b/scene/terrain-data.js 的 buildTerrainData），
// 样张里写死的徐州的数都改成了从场景里读；河岸、壕、城墙外留空这几条规矩是照设计新写的。

import type { LevelEdit, MoundEdit, StopScene, TerrainRecipe } from '../../domain/scene';
import { frameCoords } from '../../domain/sceneGeo';
import type { FrameCoords } from '../../domain/sceneGeo';
import { gauss } from './blur';
import { cityPlans, paleCourts, wallRings } from './cityPlan';
import type { WallRing } from './cityPlan';
import { demSampler } from './dem';
import { paintedFields, paintedRoads, pickVillages } from './dressing';
import { bilinear, cellsIn, gridOf } from './grid';
import type { Grid } from './grid';
import { asRing, boxOf, distSeg, ringSigned, smoothLine, subdivide } from './lines';
import { fbm, lerp, smoothstep } from './num';
import type { Dem, Ground, Vec2 } from './types';

/** 河、壕的中线加密到大约这么多米一个点。 */
const LINE_STEP_M = 60;
/** 离河岸超过这么多米的地方不算“河边”，edge 里记一个很大的数。 */
const BANK_REACH_M = 620;
const FAR_AWAY = 1e6;
/** 河岸不是一条直边：宽窄有这么多米的出入（窄的河按河宽减小）。 */
const BANK_WOBBLE_M = 40;
/** 河床：从岸边起先是一段浅滩，浅滩占整个深度的这么多（样张是 3.4 米里的 1.4 米）。 */
const SHELF_SHARE = 1.4 / 3.4;
/** 河床：离岸这么远挖到底（窄的河是河宽一半的六成）；浅滩占其中的这么多。 */
const BED_FULL_M = 95;
const SHELF_REACH = 40 / 95;
/** 水边到岸顶的斜坡宽这么多米。 */
const BANK_SLOPE_M = 18;
/** 壕：画的宽度外面，这么多米以内是岸坡，从水边斜到原来的地面。 */
const MOAT_SHOULDER_M = 15;
/** 路或堤跨过河、壕的地方：留出一个圆不挖，半径是河宽的一半加这么多米。 */
const CROSSING_PAD_M = 25;
/** 写了 inside 的修整最后再压一遍时，城墙的线外面这么多米以内过渡（城墙的墙身压在这一圈上）。 */
const WALL_FOOT_M = 22;
/**
 * 贴在城墙外侧的土坡（bank）：从“河离城墙至少多远”那条线往墙这边 48 米、往河那边 35 米，水看到的地面压到河床，
 * 水面才一直接到坡脚下（样张的数）。往墙这边最多压到离墙 20 米，不压进墙身；土坡两头各多压 30 米。
 */
const BANK_UNDER_M = 48;
const BANK_BEYOND_M = 35;
const BANK_OFF_WALL_M = 20;
const BANK_END_SLACK_M = 30;
/**
 * 修整压出来的宽水面（openWater）什么时候才算有：至少有一格地面比平时的水位低这么多米以上，
 * 而且在每条画出来的河的岸外这么多米以外。程序挖河时岸坡正好斜到平时的水位，差一丝的格子不能算。
 */
export const OPEN_SEED_BELOW_M = 0.25;
export const OPEN_SEED_OUTSIDE_M = 20;
/** 宽水面的岸照这么宽的河上色（不照壕那样只留一道细边）。 */
const OPEN_HALF_M = 200;

/** 算出整理好的地面。 */
export function buildGround(scene: StopScene, dem: Dem): Ground {
  const coords = frameCoords(scene.frame);
  const grid = gridOf(coords);
  const walls = wallRings(scene, coords);
  const recipe = scene.terrain.recipe;
  const base = recipe.plainBaseM;
  const N = grid.nx * grid.nz;

  // 1 整理
  const h = reshape(grid, demSampler(dem, coords), recipe);

  // 2 修整。cover 记每一格被修整盖住几成（0 到 1）：盖住的地方，后面压河岸时不动它。
  // lift 记每一格被“垫高一块地方”的修整（level，写了 area，mode 是 raise）垫高了多少米：
  // 这一截是垫出来的平地，不是山，上色、种树时不算（土丘 mound 不记：它就是要看着像一座小山）。
  const cover = new Float32Array(N);
  const lift = new Float32Array(N);
  for (const edit of scene.terrain.edits) {
    if (edit.op === 'mound') {
      applyMound(h, cover, grid, coords, edit);
      continue;
    }
    const before = edit.mode === 'raise' && edit.inside === undefined ? Float32Array.from(h) : null;
    applyLevel(h, cover, grid, editRing(edit, walls, coords), edit, edit.featherM);
    if (before) for (let k = 0; k < N; k++) if (h[k] > before[k]) lift[k] += h[k] - before[k];
  }

  // 3 沙盘四边：山收低到平地，切面齐整
  taperEdges(h, grid, coords, base + 0.3, recipe.edgeTaperM);

  // 4 河和壕
  const { edge, bankHalf, lines, beforeMoat } = carveWater(h, cover, grid, scene, coords, walls);

  // 5 写了 inside 的修整再压一遍
  for (const edit of scene.terrain.edits) {
    if (edit.op === 'level' && edit.inside !== undefined) applyLevel(h, null, grid, editRing(edit, walls, coords), edit, WALL_FOOT_M);
  }

  // 修整压出来的宽水面：没有的时候（徐州）什么也不动
  const normal = scene.water.levels.values.normal;
  const openSeeds = openWater(h, edge, bankHalf, grid, normal);
  const lowest = Math.min(...Object.values(scene.water.levels.values));

  // 6 水看到的地面，水漫不进去的地方
  const waterH = waterView(h, grid, scene, coords, walls);
  const dry = dryMask(grid, scene, coords, walls);

  // 7 给上色、摆树用的几样：山的多少、凸凹
  const hill = new Float32Array(N);
  for (let k = 0; k < N; k++) hill[k] = smoothstep(base + 2.6, base + 10, h[k] - lift[k]) * smoothstep(60, 200, edge[k]);
  // 凸凹是给山上色用的（山脊提亮，沟里压深）：垫出来的平地和壕这样的窄沟不算凸凹，
  // 不然它们四周的平地会被当成山脚，上不了田的颜色。所以比的是“没有挖壕、没有垫高”的地面
  const shape = new Float32Array(N);
  for (let k = 0; k < N; k++) shape[k] = beforeMoat[k] - lift[k];
  const shapeBlur = gauss(shape, grid.nx, grid.nz, 5);
  const curv = new Float32Array(N);
  for (let k = 0; k < N; k++) curv[k] = shape[k] - shapeBlur[k];
  const hillSoft = gauss(hill, grid.nx, grid.nz, 14);

  // 8 从场景带过来的
  const height = bilinear(h, grid);
  const lookups = { height, edge: bilinear(edge, grid), hillSoft: bilinear(hillSoft, grid) };

  return {
    nx: grid.nx,
    nz: grid.nz,
    cell: grid.cell,
    x0: grid.x0,
    z0: grid.z0,
    h,
    waterH,
    dry,
    edge,
    bankHalf,
    openSeeds,
    lowWaterM: lowest < normal - 0.01 ? lowest : null,
    lift,
    hill,
    hillSoft,
    curv,
    rivers: lines,
    villages: pickVillages(scene, coords, lookups, walls),
    cities: cityPlans(scene, coords, walls, height),
    baseM: base,
    reliefTimes: scene.frame.relief.times,
    roads: paintedRoads(scene, coords),
    fields: paintedFields(scene, coords),
    courts: paleCourts(scene, coords),
  };
}

// ---------------------------------------------------------------- 1 整理

const softplus = (t: number, w: number): number => (t / w > 20 ? t : w * Math.log(1 + Math.exp(t / w)));

/** 抹平：山上留细一点，平地抹得狠一点；再把平地的起伏压到原来的几成（recipe.plainKeep）。 */
function reshape(grid: Grid, today: (x: number, z: number) => number, recipe: TerrainRecipe): Float32Array {
  const { nx, nz, cell, x0, z0 } = grid;
  const N = nx * nz;
  const raw = new Float32Array(N);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) raw[j * nx + i] = today(x0 + i * cell, z0 + j * cell);

  const A = gauss(raw, nx, nz, 2.2);
  const B = gauss(raw, nx, nz, 12);
  const M = gauss(raw, nx, nz, 6);
  const h = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const k = smoothstep(recipe.plainBelowM, recipe.hillAboveM, M[i]);
    const t = lerp(B[i], A[i], k) - recipe.plainBelowM;
    h[i] = recipe.plainBaseM + recipe.plainKeep * t + (1 - recipe.plainKeep) * softplus(t, 3.5);
  }
  return h;
}

// ---------------------------------------------------------------- 2 修整

/** 一处 level 修整管的那一圈线：自己写的 area，或者 inside 指的那道城墙。 */
function editRing(edit: LevelEdit, walls: WallRing[], coords: FrameCoords): Vec2[] {
  if (edit.inside !== undefined) {
    const wall = walls.find((w) => w.id === edit.inside);
    if (!wall) throw new Error(`修整“${edit.name}”（${edit.id}）写的 inside 是 ${edit.inside}，场景里没有这道城墙`);
    return wall.ring;
  }
  if (!edit.area || edit.area.length < 3) throw new Error(`修整“${edit.name}”（${edit.id}）没有写 area，也没有写 inside`);
  return asRing(edit.area.map((p): Vec2 => coords.toLocal(p)));
}

/**
 * 把一圈线里面压成、垫到或压到 edit.toM；线外面 feather 米以内慢慢过渡到原来的地面。
 * cover 不是 null 时，记下每一格被盖住几成。
 */
function applyLevel(h: Float32Array, cover: Float32Array | null, grid: Grid, ring: Vec2[], edit: LevelEdit, feather: number): void {
  const cells = cellsIn(grid, boxOf(ring, feather));
  if (!cells) return;
  const { nx, cell, x0, z0 } = grid;
  for (let j = cells.j0; j <= cells.j1; j++) {
    for (let i = cells.i0; i <= cells.i1; i++) {
      const sd = ringSigned(x0 + i * cell, z0 + j * cell, ring);
      if (sd > 0 && sd >= feather) continue;
      const w = sd <= 0 ? 1 : 1 - smoothstep(0, feather, sd);
      const k = j * nx + i;
      const v = h[k];
      const applies = edit.mode === 'set' || (edit.mode === 'raise' && v < edit.toM) || (edit.mode === 'lower' && v > edit.toM);
      if (applies) h[k] = w >= 1 ? edit.toM : lerp(v, edit.toM, w);
      if (cover && w > cover[k]) cover[k] = w;
    }
  }
}

/** 垫一个土丘：innerM 以内垫足 addM，到 outerM 减到零。 */
function applyMound(h: Float32Array, cover: Float32Array, grid: Grid, coords: FrameCoords, edit: MoundEdit): void {
  const [cx, cz] = coords.toLocal(edit.at);
  const reach = Math.max(edit.innerM, edit.outerM);
  const cells = cellsIn(grid, { x0: cx - reach, x1: cx + reach, z0: cz - reach, z1: cz + reach });
  if (!cells) return;
  const { nx, cell, x0, z0 } = grid;
  for (let j = cells.j0; j <= cells.j1; j++) {
    for (let i = cells.i0; i <= cells.i1; i++) {
      const d = Math.hypot(x0 + i * cell - cx, z0 + j * cell - cz);
      const w = edit.outerM > edit.innerM ? 1 - smoothstep(edit.innerM, edit.outerM, d) : d <= edit.innerM ? 1 : 0;
      if (w <= 0) continue;
      const k = j * nx + i;
      h[k] += edit.addM * w;
      if (w > cover[k]) cover[k] = w;
    }
  }
}

// ---------------------------------------------------------------- 3 沙盘四边

/** 离沙盘边 taperM 米以内，高过 floorM 的部分慢慢收低，到边上正好是 floorM。 */
function taperEdges(h: Float32Array, grid: Grid, coords: FrameCoords, floorM: number, taperM: number): void {
  if (!(taperM > 0)) return;
  const { nx, nz, cell, x0, z0 } = grid;
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      if (h[k] <= floorM) continue;
      const x = x0 + i * cell;
      const z = z0 + j * cell;
      const edgeD = Math.min(x - coords.x0, coords.x1 - x, z - coords.z0, coords.z1 - z);
      if (edgeD < taperM) h[k] = floorM + (h[k] - floorM) * smoothstep(0, taperM, edgeD);
    }
  }
}

// ---------------------------------------------------------------- 4 河和壕

/** 一条河或一道壕：加密以后的中线、画的宽度的一半、跨过去的地方。 */
interface Channel {
  line: Vec2[];
  half: number;
  crossings: Vec2[];
}

/**
 * 每一格到最近的河岸多远（河里为负），和那条河画的宽度的一半。
 * 跨过去的地方留出一个圆算岸上。没有河的时候全是 FAR_AWAY。
 */
function bankDistance(grid: Grid, channels: Channel[]): { edge: Float32Array; half: Float32Array } {
  const { nx, cell, x0, z0 } = grid;
  const edge = new Float32Array(nx * grid.nz).fill(FAR_AWAY);
  const half = new Float32Array(nx * grid.nz);
  for (const ch of channels) {
    const reach = BANK_REACH_M + ch.half;
    for (let s = 0; s < ch.line.length - 1; s++) {
      const [ax, az] = ch.line[s];
      const [bx, bz] = ch.line[s + 1];
      const cells = cellsIn(grid, boxOf([ch.line[s], ch.line[s + 1]], reach));
      if (!cells) continue;
      for (let j = cells.j0; j <= cells.j1; j++) {
        for (let i = cells.i0; i <= cells.i1; i++) {
          const x = x0 + i * cell;
          const z = z0 + j * cell;
          let d = distSeg(x, z, ax, az, bx, bz) - ch.half;
          if (d > BANK_REACH_M) continue;
          for (const [cx, cz] of ch.crossings) d = Math.max(d, ch.half + CROSSING_PAD_M - Math.hypot(x - cx, z - cz));
          const k = j * nx + i;
          if (d < edge[k]) {
            edge[k] = d;
            half[k] = ch.half;
          }
        }
      }
    }
  }
  return { edge, half };
}

/**
 * 挖河。返回每一格到最近的河岸（河或壕）多远、那条河或壕画的宽度的一半，每条河、每道壕加密以后的中线，
 * 和挖壕以前的地面（河已经挖了）。
 *
 * 河（kind: river）：河岸只往下压，最高到 banks.bankM，低的不动；被修整盖住的地方不压。
 * 河离城墙的线至少 banks.keepOffWallsM，画宽了也不切进城墙。河床最深处比平时的水面低 banks.bedM。
 * 壕（kind: moat）：只在画的宽度里挖，从水边往中线慢慢深下去，到中线才有河床那么深（一道窄沟，岸是缓的）；
 * 外面 15 米过渡；不压两边的岸，不受“离城墙至少多远”管。
 * 路或堤跨过去的地方（crossings）不挖。
 */
function carveWater(
  h: Float32Array,
  cover: Float32Array,
  grid: Grid,
  scene: StopScene,
  coords: FrameCoords,
  walls: WallRing[],
): { edge: Float32Array; bankHalf: Float32Array; lines: Record<string, Vec2[]>; beforeMoat: Float32Array } {
  const { nx, nz, cell, x0, z0 } = grid;
  const N = nx * nz;
  const { banks, levels } = scene.water;
  const base = scene.terrain.recipe.plainBaseM;
  const normal = levels.values.normal;
  if (typeof normal !== 'number') throw new Error('水位里没有 normal（平时的水位）');
  const bed = normal - banks.bedM;

  const lines: Record<string, Vec2[]> = {};
  const riverChannels: Channel[] = [];
  const moatChannels: Channel[] = [];
  for (const r of scene.water.rivers) {
    const local = r.line.map((p): Vec2 => coords.toLocal(p));
    // 河的中线顺一顺；壕是人挖的，照写的折线走，拐角不抹圆。
    const line = r.kind === 'moat' ? subdivide(local, LINE_STEP_M) : smoothLine(local, LINE_STEP_M);
    lines[r.id] = line;
    const channel: Channel = { line, half: r.drawWidthM / 2, crossings: (r.crossings ?? []).map((p): Vec2 => coords.toLocal(p)) };
    (r.kind === 'moat' ? moatChannels : riverChannels).push(channel);
  }

  // 河：到河岸的距离
  const river = bankDistance(grid, riverChannels);
  // 河岸不是一条直边：宽窄略有出入
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      if (river.edge[k] < 300) {
        river.edge[k] += (fbm((x0 + i * cell) / 240, (z0 + j * cell) / 240, 2, 55) - 0.5) * Math.min(BANK_WOBBLE_M, 0.6 * river.half[k]);
      }
    }
  }
  // 河画宽了，但不让它切进城墙：离城墙的线不到 keepOffWallsM 的地方算岸上，
  // 再往外，“到河岸多远”从这条线量起（河床才从这条线开始往下斜，不是一下子到底）
  if (riverChannels.length > 0 && banks.keepOffWallsM > 0) {
    const widest = Math.max(...riverChannels.map((ch) => ch.half));
    for (const wall of walls) {
      const cells = cellsIn(grid, boxOf(wall.ring, banks.keepOffWallsM + widest + BANK_WOBBLE_M));
      if (!cells) continue;
      for (let j = cells.j0; j <= cells.j1; j++) {
        for (let i = cells.i0; i <= cells.i1; i++) {
          const k = j * nx + i;
          const keep = banks.keepOffWallsM - ringSigned(x0 + i * cell, z0 + j * cell, wall.ring);
          if (keep > river.edge[k]) river.edge[k] = keep;
        }
      }
    }
  }

  // 河：压河岸，挖河床
  const shelf = banks.bedM * SHELF_SHARE;
  for (let k = 0; k < N; k++) {
    const e = river.edge[k];
    if (e > 500) continue;
    let v = h[k];
    if (v > banks.bankM) {
      const hk = smoothstep(base + 3.5, base + 12, v);
      const w = Math.max((1 - smoothstep(100, 480, e)) * (1 - hk), 1 - smoothstep(20, 110, e)) * (1 - cover[k]);
      v = lerp(v, banks.bankM, w);
    }
    if (e <= 0) {
      const full = Math.min(BED_FULL_M, 0.6 * river.half[k]);
      const shelfEnd = full * SHELF_REACH;
      const d = -e;
      const p = d < shelfEnd ? normal - shelf * (d / shelfEnd) : normal - shelf - (banks.bedM - shelf) * smoothstep(shelfEnd, full, d);
      if (p < v) v = p;
    } else if (e < BANK_SLOPE_M && v > normal) {
      v = lerp(normal, v, smoothstep(0, BANK_SLOPE_M, e));
    }
    h[k] = v;
  }

  // 壕：画的宽度里从水边往中线慢慢深下去，到中线才是河床那么深；外面一小段是岸坡，从水边斜到原来的地面
  const beforeMoat = Float32Array.from(h);
  const moat = bankDistance(grid, moatChannels);
  for (let k = 0; k < N; k++) {
    const e = moat.edge[k];
    if (e >= MOAT_SHOULDER_M) continue;
    if (e <= 0) {
      const p = Math.max(bed, normal - banks.bedM * smoothstep(0, moat.half[k], -e));
      if (h[k] > p) h[k] = p;
    } else if (h[k] > normal) {
      h[k] = lerp(normal, h[k], smoothstep(0, MOAT_SHOULDER_M, e));
    }
  }

  const edge = river.edge;
  const bankHalf = river.half;
  for (let k = 0; k < N; k++) {
    if (moat.edge[k] < edge[k]) {
      edge[k] = moat.edge[k];
      bankHalf[k] = moat.half[k];
    }
  }
  return { edge, bankHalf, lines, beforeMoat };
}

// ---------------------------------------------------------------- 修整压出来的宽水面

/**
 * 修整把地面压到平时的水位以下的地方也是水：让 edge 认得它。返回“种子”有几格（见 OPEN_SEED_BELOW_M）；
 * 一格也没有时什么也不动。有的时候：比平时的水位低的格子是水，岸在地面和水位相交的地方；
 * 每一格到岸多远（水里是负数）比原来的 edge 小就换上，换了的地方照宽的河上色。
 */
export function openWater(h: Float32Array, edge: Float32Array, bankHalf: Float32Array, grid: { nx: number; nz: number; cell: number }, normalM: number): number {
  const { nx, nz, cell } = grid;
  const N = nx * nz;
  let seeds = 0;
  for (let k = 0; k < N; k++) if (h[k] < normalM - OPEN_SEED_BELOW_M && edge[k] > OPEN_SEED_OUTSIDE_M) seeds++;
  if (seeds === 0) return 0;

  // 岸两边的格子：到“地面正好是水位”的那一点多远
  const d = new Float32Array(N).fill(FAR_AWAY);
  const pair = (k: number, q: number): void => {
    if (h[k] < normalM === h[q] < normalM) return;
    const f = cell * Math.min(1, Math.abs(normalM - h[k]) / (Math.abs(h[q] - h[k]) || 1e-6));
    if (f < d[k]) d[k] = f;
    if (cell - f < d[q]) d[q] = cell - f;
  };
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      if (i < nx - 1) pair(k, k + 1);
      if (j < nz - 1) pair(k, k + nx);
    }
  }
  // 往外量：来回各扫一遍（横竖一格，斜着一格半不到）
  const diag = cell * Math.SQRT2;
  const relax = (k: number, q: number, w: number): void => {
    if (d[q] + w < d[k]) d[k] = d[q] + w;
  };
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      if (i > 0) relax(k, k - 1, cell);
      if (j > 0) {
        relax(k, k - nx, cell);
        if (i > 0) relax(k, k - nx - 1, diag);
        if (i < nx - 1) relax(k, k - nx + 1, diag);
      }
    }
  }
  for (let j = nz - 1; j >= 0; j--) {
    for (let i = nx - 1; i >= 0; i--) {
      const k = j * nx + i;
      if (i < nx - 1) relax(k, k + 1, cell);
      if (j < nz - 1) {
        relax(k, k + nx, cell);
        if (i < nx - 1) relax(k, k + nx + 1, diag);
        if (i > 0) relax(k, k + nx - 1, diag);
      }
    }
  }
  for (let k = 0; k < N; k++) {
    const wet = h[k] < normalM;
    // 离哪条岸都远的干地照旧；水里再远也是水
    if (!wet && d[k] > BANK_REACH_M) continue;
    const signed = wet ? -Math.min(d[k], BANK_REACH_M) : d[k];
    if (signed < edge[k]) {
      edge[k] = signed;
      if (bankHalf[k] < OPEN_HALF_M) bankHalf[k] = OPEN_HALF_M;
    }
  }
  return seeds;
}

// ---------------------------------------------------------------- 6 水看到的地面，水漫不进去的地方

/**
 * 水看到的地面。和地面一样，只有一处不同：贴在城墙外侧的土坡（kind: bank，写了 on）脚下压到河床，
 * 水面才一直接到坡脚，中间不露出一条干的地面。
 */
function waterView(h: Float32Array, grid: Grid, scene: StopScene, coords: FrameCoords, walls: WallRing[]): Float32Array {
  const waterH = new Float32Array(h);
  const { banks, levels } = scene.water;
  const bed = levels.values.normal - banks.bedM;
  const lo = Math.max(banks.keepOffWallsM - BANK_UNDER_M, BANK_OFF_WALL_M);
  const hi = banks.keepOffWallsM + BANK_BEYOND_M;
  const { nx, cell, x0, z0 } = grid;

  for (const thing of scene.things) {
    if (thing.kind !== 'bank' || thing.on === undefined || !thing.line || thing.line.length < 2) continue;
    const wall = walls.find((w) => w.id === thing.on);
    if (!wall) continue;
    const line = thing.line.map((p): Vec2 => coords.toLocal(p));
    // 土坡的线离城墙的线有多远（写在墙线上是 0，写在坡脚是几十米）：往外找格子时要算上。
    let off = 0;
    for (const [x, z] of line) off = Math.max(off, Math.abs(ringSigned(x, z, wall.ring)));
    const reach = hi + off;
    const cells = cellsIn(grid, boxOf(line, reach));
    if (!cells) continue;
    for (let j = cells.j0; j <= cells.j1; j++) {
      for (let i = cells.i0; i <= cells.i1; i++) {
        const k = j * nx + i;
        if (waterH[k] <= bed) continue;
        const x = x0 + i * cell;
        const z = z0 + j * cell;
        const sd = ringSigned(x, z, wall.ring);
        if (sd < lo || sd > hi) continue;
        if (alongside(x, z, line, reach)) waterH[k] = bed;
      }
    }
  }
  return waterH;
}

/** 这一点是不是在一条线的旁边：离线不超过 reach，而且没有越过线的两头太多。 */
function alongside(px: number, pz: number, line: Vec2[], reach: number): boolean {
  let best = Infinity;
  let overshoot = 0;
  const last = line.length - 2;
  for (let s = 0; s <= last; s++) {
    const [ax, az] = line[s];
    const [bx, bz] = line[s + 1];
    const d = distSeg(px, pz, ax, az, bx, bz);
    if (d > best) continue;
    const len = Math.hypot(bx - ax, bz - az) || 1;
    const along = ((px - ax) * (bx - ax) + (pz - az) * (bz - az)) / len;
    // 越过整条线的起点或终点多少米；在线的中间是 0。
    const over = s === 0 && along < 0 ? -along : s === last && along > len ? along - len : 0;
    if (d < best || over < overshoot) overshoot = over;
    best = d;
  }
  return best <= reach && overshoot <= BANK_END_SLACK_M;
}

/** 水漫不进去的地方：闭合的城墙里面（压在墙线上也算），和 water.dry 里写的那几块。 */
function dryMask(grid: Grid, scene: StopScene, coords: FrameCoords, walls: WallRing[]): Uint8Array {
  const { nx, cell, x0, z0 } = grid;
  const dry = new Uint8Array(nx * grid.nz);
  const rings = walls.map((w) => w.ring);
  for (const area of scene.water.dry) rings.push(asRing(area.area.map((p): Vec2 => coords.toLocal(p))));
  for (const ring of rings) {
    if (ring.length < 3) continue;
    const cells = cellsIn(grid, boxOf(ring));
    if (!cells) continue;
    for (let j = cells.j0; j <= cells.j1; j++) {
      for (let i = cells.i0; i <= cells.i1; i++) {
        if (ringSigned(x0 + i * cell, z0 + j * cell, ring) <= 0) dry[j * nx + i] = 1;
      }
    }
  }
  return dry;
}
