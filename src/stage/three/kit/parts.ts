// 从样张搬来，结构没有动（spikes/art-direction/b/scene/models.js 的“殿、楼”一段），只加了类型。
// 改了三处小的：柱子、栏杆用什么木色可以选（col，不写是红漆）；亭子的顶可以是茅草（roofMat）；楼上的匾去掉了（没有出处）。
// 殿、楼、亭、民房这几样通用的零件。只算形状，不碰页面。
// 后来添了两样单座的小屋（addCottage、addShed）：它们是小节要讲的东西，远了要放大好几倍给人看，
// 光是一个草色的盒子认不出是屋，所以各有自己的样子：茅屋把山墙和门朝着正面，棚子的顶比城墙深。

import * as THREE from 'three';
import type { Vec3 } from '../../ground/types';
import { Batch, T, box, cyl, roofParts, segBox } from './geo';
import type { RoofOptions, RoofParts } from './geo';
import type { MatName } from './materials';
import { lerp, smoothstep } from './util';

export interface RoofLook {
  /** 做不做脊 */
  ridges?: boolean;
  /** 山面用什么材质 */
  gableMat?: MatName;
  roofMat?: MatName;
  tint?: Vec3;
}

export function addRoof(b: Batch, M: THREE.Matrix4, opts: RoofOptions, { ridges = true, gableMat = 'plaster', roofMat = 'tile', tint }: RoofLook = {}): RoofParts {
  const r = roofParts(opts);
  b.add(roofMat, r.roof, M, tint);
  if (r.fascia) b.add('timber', r.fascia, M);
  if (r.gable) b.add(gableMat, r.gable, M);
  if (ridges) for (const s of r.ridges) b.add(roofMat, segBox(s.a, s.b, s.w, s.h), M, [0.86, 0.86, 0.86]);
  return r;
}

/** 檐下暗一点：顶上的顶点压暗 */
function shadeTop(g: THREE.BufferGeometry, H: number, k: number): THREE.BufferGeometry {
  const p = g.attributes.position;
  const c = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const s = lerp(1.04, k, smoothstep(H * 0.35, H, p.getY(i)));
    c[i * 3] = c[i * 3 + 1] = c[i * 3 + 2] = s;
  }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return g;
}

export interface BodySpec {
  W: number;
  D: number;
  H: number;
  /** 面阔、进深方向各几根柱子 */
  nxc?: number;
  nzc?: number;
  wall?: MatName;
  colR?: number;
  /** 台基多高，0 是没有 */
  base?: number;
  doors?: boolean;
  /** 当中几间开门，门两边各几间开窗 */
  doorN?: number;
  winN?: number;
  /** 柱子的木色 */
  col?: MatName;
}

/** 一层殿身：台基、柱、墙、额枋、斗拱一圈。返回顶上的高度。 */
export function addBody(b: Batch, M: THREE.Matrix4, { W, D, H, nxc = 6, nzc = 3, wall = 'plaster', colR = 1.7, base = 2.4, doors = true, doorN = 3, winN = 99, col = 'vermilion' }: BodySpec): number {
  const m = (x: number, y: number, z: number): THREE.Matrix4 => M.clone().multiply(T(x, y, z));
  if (base > 0) b.add('stone', box(W + 9, base, D + 9), m(0, 0, 0));
  const y0 = base;
  b.add(wall, shadeTop(box(W - 2.6, H - 1.6, D - 2.6), H - 1.6, 0.74), m(0, y0, 0));
  for (let i = 0; i < nxc; i++) {
    const x = lerp(-W / 2, W / 2, i / (nxc - 1));
    for (const sz of [-1, 1]) b.add(col, shadeTop(cyl(colR, H, 8), H, 0.76), m(x, y0, (sz * D) / 2));
  }
  for (let j = 1; j < nzc - 1; j++) {
    const z = lerp(-D / 2, D / 2, j / (nzc - 1));
    for (const sx of [-1, 1]) b.add(col, shadeTop(cyl(colR, H, 8), H, 0.76), m((sx * W) / 2, y0, z));
  }
  if (doors) {
    const bay = W / (nxc - 1);
    for (let i = 0; i < nxc - 1; i++) {
      const x = -W / 2 + bay * (i + 0.5);
      const k = Math.abs(i - (nxc - 2) / 2);
      const isDoor = k < doorN / 2;
      const isWin = !isDoor && k < doorN / 2 + winN;
      for (const sz of [-1, 1]) {
        if (isDoor) b.add('timber', box(bay - colR * 2 - 1.2, H * 0.66, 0.9), m(x, y0, sz * (D / 2 - 1.0)));
        else if (isWin) b.add('timber', box(bay - colR * 2 - 3.4, H * 0.3, 0.9), m(x, y0 + H * 0.36, sz * (D / 2 - 1.0)));
      }
    }
  }
  // 檐下一道深色的额枋，再上面是斗拱
  b.add('timber', box(W + 1.6, 2.6, D + 1.6), m(0, y0 + H - 2.6, 0));
  b.add('bracket', box(W + 3.6, 1.7, D + 3.6), m(0, y0 + H, 0));
  return y0 + H + 1.7;
}

/** 栏杆一圈 */
function addRailing(b: Batch, M: THREE.Matrix4, W: number, D: number, y: number, h = 3.4, col: MatName = 'vermilion'): void {
  const m = (x: number, yy: number, z: number): THREE.Matrix4 => M.clone().multiply(T(x, yy, z));
  for (const sz of [-1, 1]) {
    b.add(col, box(W, 0.7, 0.7), m(0, y + h, (sz * D) / 2));
    b.add(col, box(W, 0.5, 0.5), m(0, y + h * 0.5, (sz * D) / 2));
  }
  for (const sx of [-1, 1]) {
    b.add(col, box(0.7, 0.7, D), m((sx * W) / 2, y + h, 0));
    b.add(col, box(0.5, 0.5, D), m((sx * W) / 2, y + h * 0.5, 0));
  }
  const nx = Math.round(W / 9);
  const nz = Math.round(D / 9);
  for (let i = 0; i <= nx; i++) for (const sz of [-1, 1]) b.add(col, box(0.9, h + 0.8, 0.9), m(lerp(-W / 2, W / 2, i / nx), y, (sz * D) / 2));
  for (let j = 1; j < nz; j++) for (const sx of [-1, 1]) b.add(col, box(0.9, h + 0.8, 0.9), m((sx * W) / 2, y, lerp(-D / 2, D / 2, j / nz)));
}

/** 一座楼的尺寸。写了 W2 是两层（下层殿身、腰檐、上层殿身）；不写是一层一个顶。 */
export interface TowerSpec {
  W: number;
  D: number;
  H1: number;
  nxc?: number;
  nzc?: number;
  /** 下层的檐伸出多少 */
  ov1: number;
  /** 腰檐升起多高 */
  rise1?: number;
  W2?: number;
  D2?: number;
  H2?: number;
  nxc2?: number;
  nzc2?: number;
  ov2?: number;
  roofH: number;
  wall: MatName;
  base?: number;
  doorN?: number;
  winN?: number;
  doorN2?: number;
  winN2?: number;
  /** 上层有没有平坐栏杆 */
  balcony?: boolean;
  lift?: number;
  ts?: number;
  /** 柱子、栏杆、山面的木色 */
  col?: MatName;
}

/**
 * 一座楼：下层殿身 + 腰檐 +（平坐栏杆）+ 上层殿身 + 歇山顶。
 * 黄楼用黄土墙、两层带平坐；普通城楼是重檐一层。
 */
export function addTower(b: Batch, M: THREE.Matrix4, s: TowerSpec): number {
  const sag = 0.55;
  const col = s.col ?? 'vermilion';
  const m = (y: number): THREE.Matrix4 => M.clone().multiply(T(0, y, 0));
  let y = addBody(b, M, { W: s.W, D: s.D, H: s.H1, nxc: s.nxc, nzc: s.nzc, wall: s.wall, base: s.base ?? 2.4, doorN: s.doorN, winN: s.winN, col });
  if (s.W2 !== undefined && s.D2 !== undefined && s.H2 !== undefined && s.ov2 !== undefined && s.rise1 !== undefined) {
    const eW = s.W + 2 * s.ov1;
    const eD = s.D + 2 * s.ov1;
    const t1 = (eD - (s.D2 - 2)) / eD;
    const Hs = s.rise1 / ((1 - sag) * t1 + sag * t1 * t1);
    addRoof(b, m(y - 1.2), { W: eW, D: eD, H: Hs, ts: 1, t1, lift: s.lift ?? 5, nu: 10, nt: 4, sag }, {});
    y = y - 1.2 + s.rise1;
    if (s.balcony) {
      b.add('timber', box(s.W2 + 13, 1.3, s.D2 + 13), m(y - 0.4));
      addRailing(b, m(y + 0.9), s.W2 + 12, s.D2 + 12, 0, 3.4, col);
      y += 0.9;
    }
    const top = addBody(b, m(y), { W: s.W2, D: s.D2, H: s.H2, nxc: s.nxc2 ?? s.nxc, nzc: s.nzc2 ?? s.nzc, wall: s.wall, base: 0, doors: s.H2 > 9, doorN: s.doorN2 ?? 1, winN: s.winN2 ?? 1, col });
    y += top;
    addRoof(b, m(y - 1.2), { W: s.W2 + 2 * s.ov2, D: s.D2 + 2 * s.ov2, H: s.roofH, ts: s.ts ?? 0.52, lift: s.lift ?? 5, nu: 12, nt: 6, sag }, { gableMat: col });
    return y - 1.2 + s.roofH;
  }
  addRoof(b, m(y - 1.2), { W: s.W + 2 * s.ov1, D: s.D + 2 * s.ov1, H: s.roofH, ts: s.ts ?? 0.52, lift: s.lift ?? 4, nu: 10, nt: 6, sag }, { gableMat: col });
  return y - 1.2 + s.roofH;
}

export interface PavilionSpec {
  /** 一边多长 */
  S?: number;
  H?: number;
  roofH?: number;
  /** 檐伸出多少 */
  ov?: number;
  /** 四面有墙就写墙的材质（角楼）；不写是四面空的亭子 */
  wall?: MatName | null;
  lift?: number;
  roofMat?: MatName;
  col?: MatName;
}

/** 攒尖顶的小亭、角楼 */
export function addPavilion(b: Batch, M: THREE.Matrix4, { S = 30, H = 14, roofH = 16, ov = 8, wall = null, lift = 4, roofMat = 'tile', col = 'vermilion' }: PavilionSpec): void {
  const m = (x: number, y: number, z: number): THREE.Matrix4 => M.clone().multiply(T(x, y, z));
  b.add('stone', box(S + 8, 2.2, S + 8), m(0, 0, 0));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.add(col, cyl(1.5, H, 8), m((sx * S) / 2, 2.2, (sz * S) / 2));
  if (wall) b.add(wall, box(S - 2.4, H - 1.5, S - 2.4), m(0, 2.2, 0));
  b.add('timber', box(S + 1.2, 1.8, S + 1.2), m(0, 2.2 + H - 1.8, 0));
  b.add('bracket', box(S + 3, 1.5, S + 3), m(0, 2.2 + H, 0));
  addRoof(b, m(0, 2.2 + H + 0.4, 0), { W: S + 2 * ov, D: S + 2 * ov, H: roofH, ts: 1, lift, nu: 8, nt: 6, sag: 0.6 }, { roofMat });
  b.add(roofMat, cyl(1.6, 4.5, 6, 0.4), m(0, 2.2 + H + 0.4 + roofH - 0.6, 0), [0.8, 0.8, 0.8]);
}

/** 两坡顶的民房。thatch 为真是茅草顶。 */
export function addHouse(b: Batch, x: number, y: number, z: number, ry: number, L: number, Dp: number, wallH: number, roofH: number, wallTint: Vec3, roofTint: Vec3, thatch: boolean): void {
  const M = T(x, y, z, ry);
  b.add(thatch ? 'earth' : 'plaster', box(L, wallH, Dp), M, wallTint);
  const r = roofParts({ W: L + 5, D: Dp + 7, H: roofH, ts: 0, nu: 1, nt: 3, sag: thatch ? 0.15 : 0.4, fascia: 0, gableInset: 2.5, tile: thatch ? 5 : 3.2 });
  const MR = M.clone().multiply(T(0, wallH - 0.6, 0));
  b.add(thatch ? 'thatch' : 'tile', r.roof, MR, roofTint);
  if (r.gable) b.add(thatch ? 'earth' : 'plaster', r.gable, MR, wallTint);
}

// ---------------------------------------------------------------- 单座的小屋

/** 茅草顶：比成片的村屋亮一点、黄一点（新铺的草），剪齐的边深。 */
const THATCH_TOP: Vec3 = [1.4, 1.34, 1.14];
const THATCH_EDGE: Vec3 = [0.7, 0.64, 0.54];
/** 抹了泥的墙：浅的土白色。门是深的，草顶的边是深的，墙夹在中间一眼看得出是一面墙。 */
const MUD_WALL: Vec3 = [0.97, 0.9, 0.76];
/** 台基：石头砌的，比四周的地面灰一点、深一点。山坡上低的一头露出来一截，看着是一道护坡，不是一个土黄的盒子。 */
const PLINTH: Vec3 = [0.84, 0.82, 0.78];
/** 棚子顶上盖的旧草、旧席：比夯土的墙顶深得多，在墙上一眼找得到。 */
const SHED_ROOF: Vec3 = [0.4, 0.39, 0.4];
const SHED_EDGE: Vec3 = [0.27, 0.26, 0.27];
/** 棚子围的席子：浅的草黄色。 */
const SHED_MAT: Vec3 = [1.04, 1.0, 0.92];

export interface CottageSpec {
  /** 正面（山墙那一面）多宽，屋身往后多深。 */
  W: number;
  D: number;
  wallH: number;
  roofH: number;
  /** 门多宽、多高（从台基面算起）。 */
  doorW: number;
  doorH: number;
  /** 台基比脚高多少；往下埋多深（山坡上低的一头不悬空）。 */
  plinth: number;
  below: number;
}

/**
 * 地上单座的茅屋：一个土台基，抹了泥的浅色墙，两坡的茅草顶。山墙朝着正面（自己的 +z），门开在山墙当中，屋脊顺着进深走。
 * 这样摆是为了从斜上方看得见墙：檐口伸出去会把檐下的墙挡住，山墙上面没有檐，从墙脚到屋脊一整面都露着，
 * 门、水淹到门的哪里都看得见。脚在 (x, y, z)。
 * 台基垫多高是有讲究的：张山人的草屋“水及其半扉”，大水的水面比屋脚高一米多，由摆它的人照水位定台基和门的高。
 */
export function addCottage(b: Batch, x: number, y: number, z: number, ry: number, { W, D, wallH, roofH, doorW, doorH, plinth, below }: CottageSpec): void {
  const M = T(x, y, z, ry);
  const m = (dx: number, dy: number, dz: number): THREE.Matrix4 => M.clone().multiply(T(dx, dy, dz));
  b.add('stone', box(W + 3, plinth + below, D + 3), m(0, -below, 0), PLINTH);
  b.add('plaster', box(W, wallH, D), m(0, plinth, 0), MUD_WALL);
  b.add('timber', box(doorW, doorH, 1), m(0, plinth, D / 2 + 0.1), [1.1, 1.0, 0.95]);
  // 顶：两边的檐各伸出 2.5，前后各伸出 2。roofParts 的面阔是屋脊的方向，所以转九十度
  const eave = W + 5;
  const len = D + 4;
  const y0 = plinth + wallH - 0.6;
  const r = roofParts({ W: len, D: eave, H: roofH, ts: 0, nu: 1, nt: 3, sag: 0.12, fascia: 2, gableInset: 2, tile: 5 });
  const MR = M.clone().multiply(T(0, y0, 0, Math.PI / 2));
  b.add('thatch', r.roof, MR, THATCH_TOP);
  if (r.fascia) b.add('thatch', r.fascia, MR, THATCH_EDGE);
  if (r.gable) b.add('plaster', r.gable, MR, MUD_WALL);
  // 前后两头，草顶剪齐的厚边：正面看是一个深色的“人”字，把浅色的山墙框出来
  for (const sz of [-1, 1]) {
    for (const sx of [-1, 1]) b.add('thatch', segBox([(sx * eave) / 2, y0 - 0.4, (sz * len) / 2], [0, y0 + roofH - 0.2, (sz * len) / 2], 1.6, 2.4), M, THATCH_EDGE);
  }
  // 顶上压一道脊
  b.add('thatch', box(3.2, 1.6, len + 0.8), m(0, y0 + roofH - 0.5, 0), THATCH_EDGE);
}

/**
 * 城墙顶上的棚子：四根木柱，朝城外的一面和两头围着席子，朝城里的一面敞着，上面一个两坡的顶，盖的是旧草旧席。
 * 顺着墙摆（长的一边是自己的 x），脚在墙顶；进深比墙顶窄得多，放大到头也还在墙上。
 * 顶的颜色比墙顶的夯土深：草色的顶在土色的墙上分不出来。
 */
export function addShed(b: Batch, x: number, y: number, z: number, ry: number, L: number, D: number, postH: number, roofH: number): void {
  const M = T(x, y, z, ry);
  const m = (dx: number, dy: number, dz: number): THREE.Matrix4 => M.clone().multiply(T(dx, dy, dz));
  for (const sx of [-1, 0, 1]) for (const sz of [-1, 1]) b.add('plainTimber', box(1.3, postH, 1.3), m((sx * L) / 2, 0, (sz * D) / 2));
  // 席子：背面一整面，两头各一面
  b.add('earth', box(L, postH - 0.6, 0.8), m(0, 0, D / 2), SHED_MAT);
  for (const sx of [-1, 1]) b.add('earth', box(0.8, postH - 0.6, D), m((sx * L) / 2, 0, 0), SHED_MAT);
  const r = roofParts({ W: L + 4, D: D + 4.5, H: roofH, ts: 0, nu: 1, nt: 2, sag: 0.1, fascia: 1.6, gableInset: 2, tile: 5 });
  const MR = m(0, postH - 0.5, 0);
  b.add('thatch', r.roof, MR, SHED_ROOF);
  if (r.fascia) b.add('thatch', r.fascia, MR, SHED_EDGE);
  if (r.gable) b.add('earth', r.gable, MR, SHED_MAT);
}
