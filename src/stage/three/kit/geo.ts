// 从样张搬来，结构没有动（spikes/art-direction/b/scene/geo.js），只加了类型；代码画的贴图搬到了 textures.ts。
// 搭小模型用的几样零件：按材质归拢的批次、屋顶（带举折和翼角）、棱柱。
// 这里只算形状，不碰页面（document、window），在 Node 里也能跑。
// tests/stage/kit-parity.test.ts 拿这里算出来的数和样张的 geo.js 逐个对过。
// 后来加的一样：批次里的每个零件带上“它是哪样东西的”记号（FigureTag），显卡照它把模型放大、摊开、收掉细处。

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Vec2, Vec3 } from '../../ground/types';
import type { FigureClass } from '../internal';
import { FIGURE_SLOT, FIG_DETAIL, FIG_ON_WALL, FIG_PLAIN, FIG_WET } from './figureMaterial';
import { lerp } from './util';

export function T(x = 0, y = 0, z = 0, ry = 0, sx = 1, sy = sx, sz = sx): THREE.Matrix4 {
  const m = new THREE.Matrix4();
  m.compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), ry), new THREE.Vector3(sx, sy, sz));
  return m;
}

/**
 * 一样东西的记号：它的每个顶点都带着，显卡照它算这样东西现在多大、在哪（见 figureMaterial.ts）。
 * 造一样东西以前写在批次的 tag 上，造完清掉（Batch.tagged 管这件事）。
 */
export interface FigureTag {
  /** 这样东西的脚（和形状在同一套坐标里）：绕着这一点放大。 */
  pivot: Vec3;
  /** 这一群东西共同的那一点：脚从这一点往外摊开。不写就是它自己的脚（不摊开）。 */
  group?: Vec3;
  /** 哪一类。不写是不归类：不放大，也不去掉。 */
  cls?: FigureClass | null;
  /** 次序，0 到 1（不含 1）：远了去掉一些的时候，小的留到最后。不写是 0。 */
  rank?: number;
  /** 是细处：远了先矮下去，再收成一个点。 */
  detail?: boolean;
  /** 立在城墙、城门上：脚的高度跟着城墙一起拔高。 */
  onWall?: boolean;
  /** 站在水会漫到的地方：水高过它的脚时，绕着水面那一条线放大（水淹到它的几成，放大以后还是几成）。 */
  wet?: boolean;
}

/** 一个零件的每个顶点上要带的三样（aPivot、aGroup、aFig），照记号写出来。没有记号的都是 0：原样画。 */
export function writeFigure(g: THREE.BufferGeometry, tag: FigureTag | null): void {
  const n = g.attributes.position.count;
  const pivots = new Float32Array(n * 3);
  const groups = new Float32Array(n * 3);
  const figs = new Float32Array(n * 4);
  if (tag) {
    const group = tag.group ?? tag.pivot;
    const slot = tag.cls ? FIGURE_SLOT[tag.cls] : 0;
    const kind = tag.detail ? FIG_DETAIL : FIG_PLAIN;
    const flags = (tag.onWall ? FIG_ON_WALL : 0) + (tag.wet ? FIG_WET : 0);
    for (let i = 0; i < n; i++) {
      pivots.set(tag.pivot, i * 3);
      groups.set(group, i * 3);
      figs[i * 4] = slot;
      figs[i * 4 + 1] = tag.rank ?? 0;
      figs[i * 4 + 2] = kind;
      figs[i * 4 + 3] = flags;
    }
  }
  g.setAttribute('aPivot', new THREE.BufferAttribute(pivots, 3));
  g.setAttribute('aGroup', new THREE.BufferAttribute(groups, 3));
  g.setAttribute('aFig', new THREE.BufferAttribute(figs, 4));
}

/** 同一种材质的零件攒在一起，最后并成一个网格 */
export class Batch {
  parts: Map<string, THREE.BufferGeometry[]>;
  tris: number;
  /** 接下来放进来的零件是哪一样东西的（见 FigureTag）。null 是不归类的东西：城墙的墙身、堤、土坡。 */
  tag: FigureTag | null;
  constructor() {
    this.parts = new Map();
    this.tris = 0;
    this.tag = null;
  }
  /** 造一样东西：fn 里放进来的零件都带上 tag 这个记号，造完换回原来的。 */
  tagged<R>(tag: FigureTag | null, fn: () => R): R {
    const outer = this.tag;
    this.tag = tag;
    try {
      return fn();
    } finally {
      this.tag = outer;
    }
  }
  /**
   * 造一处细处（垛口、篱笆的一根桩、屋后的小屋）：fn 里放进来的零件算一处，脚在 at，远了绕着这一点收掉。
   * 它属于哪样东西（哪一类、次序、站不站在水里）照外面那一层的记号；外面那样东西的脚就是它跟着摊开的那一点。
   */
  detail<R>(at: Vec3, fn: () => R): R {
    const outer = this.tag;
    return this.tagged({ pivot: at, group: outer ? (outer.group ?? outer.pivot) : at, cls: outer?.cls, rank: outer?.rank, wet: outer?.wet, onWall: outer?.onWall, detail: true }, fn);
  }
  /** 放进一个零件，它自己算一处细处：脚是 matrix 把 at（不写是零件自己的原点）搬到的那一点。 */
  addDetail(mat: string, geo: THREE.BufferGeometry, matrix?: THREE.Matrix4 | null, tint?: Vec3 | null, at: Vec3 = [0, 0, 0]): this {
    const q = new THREE.Vector3(at[0], at[1], at[2]);
    if (matrix) q.applyMatrix4(matrix);
    this.detail([q.x, q.y, q.z], () => this.add(mat, geo, matrix, tint));
    return this;
  }
  add(mat: string, geo: THREE.BufferGeometry, matrix?: THREE.Matrix4 | null, tint?: Vec3 | null): this {
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    if (matrix) g.applyMatrix4(matrix);
    if (!g.attributes.normal) g.computeVertexNormals();
    const n = g.attributes.position.count;
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
    if (!g.attributes.color) g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3).fill(1), 3));
    if (tint) {
      const c = g.attributes.color.array;
      for (let i = 0; i < n; i++) {
        c[i * 3] *= tint[0];
        c[i * 3 + 1] *= tint[1];
        c[i * 3 + 2] *= tint[2];
      }
    }
    for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(name)) g.deleteAttribute(name);
    // 每个零件都写（没有记号的写 0）：并网格的时候，一种材质下面的零件要带一样的几种数据
    writeFigure(g, this.tag);
    let list = this.parts.get(mat);
    if (!list) {
      list = [];
      this.parts.set(mat, list);
    }
    list.push(g);
    this.tris += n / 3;
    return this;
  }
  build(materials: Record<string, THREE.Material | undefined>): THREE.Group {
    const group = new THREE.Group();
    for (const [name, list] of this.parts) {
      const merged = mergeGeometries(list, false);
      const mesh = new THREE.Mesh(merged, materials[name]);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      // 模型在显卡上放大、摊开，three 按没放大的大小算出来的范围不作数：不让它按那个范围把网格整个剔掉
      mesh.frustumCulled = false;
      group.add(mesh);
    }
    return group;
  }
}

/** 曲面上的一点：x、y、z，后面可以跟贴图的 u、v */
export type GridPoint = [number, number, number, number?, number?];

/** 一格一格铺出来的曲面（共用顶点，法线平滑） */
export class GB {
  p: number[];
  uv: number[];
  i: number[];
  constructor() {
    this.p = [];
    this.uv = [];
    this.i = [];
  }
  grid(P: (r: number, c: number) => GridPoint, rows: number, cols: number, flip: boolean): void {
    const base = this.p.length / 3;
    for (let r = 0; r <= rows; r++) {
      for (let c = 0; c <= cols; c++) {
        const q = P(r, c);
        this.p.push(q[0], q[1], q[2]);
        this.uv.push(q[3] ?? 0, q[4] ?? 0);
      }
    }
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const a = base + r * (cols + 1) + c;
        const b = a + 1;
        const d = a + cols + 1;
        const e = d + 1;
        if (flip) this.i.push(a, e, b, a, d, e);
        else this.i.push(a, b, e, a, e, d);
      }
    }
  }
  get empty(): boolean {
    return this.i.length === 0;
  }
  geo(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setIndex(this.i);
    g.computeVertexNormals();
    return g;
  }
}

/** 一个顶点的明暗：一个数，或者红、绿、蓝各一个数 */
export type Shade = number | Vec3;

/** 平面拼的硬边零件（每个面自己的法线） */
export class FB {
  p: number[];
  n: number[];
  uv: number[];
  c: number[];
  constructor() {
    this.p = [];
    this.n = [];
    this.uv = [];
    this.c = [];
  }
  /** a b c d 依次绕一圈；n 是朝外的法线，绕向自动对齐 */
  quad(a: Vec3, b: Vec3, c: Vec3, d: Vec3, n: Vec3, uvs?: Vec2[] | null, cols?: Shade[] | null): void {
    const ux = b[0] - a[0];
    const uy = b[1] - a[1];
    const uz = b[2] - a[2];
    const vx = c[0] - a[0];
    const vy = c[1] - a[1];
    const vz = c[2] - a[2];
    const cx = uy * vz - uz * vy;
    const cy = uz * vx - ux * vz;
    const cz = ux * vy - uy * vx;
    const same = cx * n[0] + cy * n[1] + cz * n[2] >= 0;
    const order = same ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2];
    const pts = [a, b, c, d];
    const uu: Vec2[] = uvs || [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ];
    for (const k of order) {
      this.p.push(...pts[k]);
      this.n.push(...n);
      this.uv.push(...uu[k]);
      const col = cols ? cols[k] : 1;
      if (Array.isArray(col)) this.c.push(...col);
      else this.c.push(col, col, col);
    }
  }
  tri(a: Vec3, b: Vec3, c: Vec3, n: Vec3, shade = 1): void {
    this.quad(
      a,
      b,
      c,
      c,
      n,
      [
        [0, 0],
        [1, 0],
        [0.5, 1],
        [0.5, 1],
      ],
      [shade, shade, shade, shade],
    );
  }
  geo(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    return g;
  }
}

/** 底面在 y=0 的盒子 */
export function box(w: number, h: number, d: number): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(0, h / 2, 0);
  return g;
}
export function cyl(r: number, h: number, seg = 8, rTop = r): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(rTop, r, h, seg, 1, false);
  g.translate(0, h / 2, 0);
  return g;
}
/** 两点之间的一根方条 */
export function segBox(a: Vec3, b: Vec3, w: number, h: number): THREE.BufferGeometry {
  const va = new THREE.Vector3(...a);
  const vb = new THREE.Vector3(...b);
  const len = va.distanceTo(vb);
  const g = new THREE.BoxGeometry(len, h, w);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), vb.clone().sub(va).normalize());
  const m = new THREE.Matrix4().compose(va.clone().add(vb).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1));
  g.applyMatrix4(m);
  return g;
}

export interface PrismOptions {
  /** 顶点的明暗，按高度给（墙脚深一点） */
  shade?: (y: number) => Shade;
  /** 朝上的面的明暗 */
  topShade?: number;
  /** 贴图一张管多少米 */
  uvScale?: number;
}

/**
 * 棱柱：截面是 (z, y) 上的凸多边形，沿 x 拉长 L。
 * shade(y) 给顶点明暗（墙脚深一点）；topShade 给朝上的面的明暗。
 */
export function prism(section: Vec2[], L: number, { shade = () => 1, topShade = 1, uvScale = 40 }: PrismOptions = {}): THREE.BufferGeometry {
  const fb = new FB();
  const n = section.length;
  let cz = 0;
  let cy = 0;
  for (const [z, y] of section) {
    cz += z / n;
    cy += y / n;
  }
  let acc = 0;
  for (let i = 0; i < n; i++) {
    const [z0, y0] = section[i];
    const [z1, y1] = section[(i + 1) % n];
    const dz = z1 - z0;
    const dy = y1 - y0;
    const len = Math.hypot(dz, dy);
    let nz = dy / len;
    let ny = -dz / len;
    if (nz * ((z0 + z1) / 2 - cz) + ny * ((y0 + y1) / 2 - cy) < 0) {
      nz = -nz;
      ny = -ny;
    }
    const s0 = ny > 0.9 ? topShade : shade(y0);
    const s1 = ny > 0.9 ? topShade : shade(y1);
    fb.quad(
      [-L / 2, y0, z0],
      [L / 2, y0, z0],
      [L / 2, y1, z1],
      [-L / 2, y1, z1],
      [0, ny, nz],
      [
        [-L / 2 / uvScale, acc / uvScale],
        [L / 2 / uvScale, acc / uvScale],
        [L / 2 / uvScale, (acc + len) / uvScale],
        [-L / 2 / uvScale, (acc + len) / uvScale],
      ],
      [s0, s0, s1, s1],
    );
    acc += len;
  }
  for (const sx of [-1, 1]) {
    for (let i = 1; i < n - 1; i++) {
      const a = section[0];
      const b = section[i];
      const c = section[i + 1];
      fb.quad(
        [(sx * L) / 2, a[1], a[0]],
        [(sx * L) / 2, b[1], b[0]],
        [(sx * L) / 2, c[1], c[0]],
        [(sx * L) / 2, c[1], c[0]],
        [sx, 0, 0],
        [
          [a[0] / uvScale, a[1] / uvScale],
          [b[0] / uvScale, b[1] / uvScale],
          [c[0] / uvScale, c[1] / uvScale],
          [c[0] / uvScale, c[1] / uvScale],
        ],
        [shade(a[1]), shade(b[1]), shade(c[1]), shade(c[1])],
      );
    }
  }
  return fb.geo();
}

export interface RoofOptions {
  /** 面阔方向的檐口长 */
  W: number;
  /** 进深方向的檐口宽 */
  D: number;
  /** 正脊比檐口高多少 */
  H: number;
  /** 戗脊走到哪里换成山面：1 是庑殿，0 是两坡顶，中间是歇山 */
  ts?: number;
  /** 只做到多高（腰檐用，小于 1） */
  t1?: number;
  /** 翼角起翘 */
  lift?: number;
  /** 檐口方向、坡面方向各分几格 */
  nu?: number;
  nt?: number;
  /** 举折：越大越凹 */
  sag?: number;
  /** 一条瓦垄多宽 */
  tile?: number;
  /** 檐口下面的封檐板多高，0 是不做 */
  fascia?: number;
  /** 山面往里收多少 */
  gableInset?: number;
  /** 翼角从离角多远开始翘；不写按进深算 */
  liftLen?: number | null;
}

/** 一段脊：从 a 到 b 的一根方条 */
export interface Ridge {
  a: Vec3;
  b: Vec3;
  w: number;
  h: number;
}

export interface RoofParts {
  roof: THREE.BufferGeometry;
  fascia: THREE.BufferGeometry | null;
  gable: THREE.BufferGeometry | null;
  ridges: Ridge[];
  /** 坡面的剖面：走到几成（0 到 1）时有多高 */
  prof: (t: number) => number;
}

/**
 * 屋顶。W 是面阔方向的檐口长，D 是进深方向的檐口宽，檐口在 y=0，正脊在 y=H。
 * ts：戗脊走到哪里换成山面（1 是庑殿，0 是两坡顶，中间是歇山）。
 * t1：只做到多高（腰檐用，<1）。lift：翼角起翘。sag：举折（越大越凹）。
 * 返回 { roof, fascia, gable, ridges }。
 */
export function roofParts({ W, D, H, ts = 1, t1 = 1, lift = 0, nu = 6, nt = 5, sag = 0.55, tile = 3.2, fascia = 1.5, gableInset = 0, liftLen = null }: RoofOptions): RoofParts {
  const prof = (t: number): number => H * ((1 - sag) * t + sag * t * t);
  const hd = D / 2;
  const tEnd = Math.min(t1, 1);
  const span = (t: number): number => W / 2 - Math.min(t, ts) * hd;
  // 翼角只在离角一小段里翘起来（面阔、进深两边一样长），中间的檐口是平的
  const curl = lift > 0 && ts > 0;
  const Lc = liftLen ?? Math.max(5, Math.min(0.2 * D, 16));
  const cOf = (u: number, L0: number): number => (curl ? Math.max(0, 1 - (Math.min(u, 1 - u) * L0) / Lc) : 0);
  const yv = (t: number, c: number): number => prof(t) + lift * c * c * (1 - t) * (1 - t);
  // 檐口上的分格：角上分细一点，曲线才圆
  const cols = (L0: number, n: number): number[] => {
    if (!curl) return Array.from({ length: n + 1 }, (_, i) => i / n);
    const a = Math.min(0.45, Lc / L0);
    const mid = Math.max(1, n - 6);
    const us = [0, a / 3, (2 * a) / 3, a];
    for (let k = 1; k <= mid; k++) us.push(a + ((1 - 2 * a) * k) / mid);
    us.push(1 - (2 * a) / 3, 1 - a / 3, 1);
    return us;
  };
  const usW = cols(W, nu);
  const roof = new GB();
  const fas = new GB();
  const gab = new GB();
  for (const sgn of [1, -1]) {
    const P = (r: number, c: number): GridPoint => {
      const t = (r / nt) * tEnd;
      const u = usW[c];
      const x = lerp(-span(t), span(t), u);
      return [x, yv(t, cOf(u, W)), sgn * hd * (1 - t), x / tile, t * 2];
    };
    roof.grid(P, nt, usW.length - 1, sgn < 0);
    if (fascia > 0)
      fas.grid(
        (r, c) => {
          const q = P(0, c);
          return [q[0], q[1] - r * fascia, q[2], q[0] / tile, r];
        },
        1,
        usW.length - 1,
        sgn > 0,
      );
  }
  const tS = Math.min(tEnd, ts);
  if (tS > 0) {
    const usD = cols(D, Math.max(2, Math.round((nu * D) / W)));
    const ns = Math.max(1, Math.round(nt * (tS / tEnd)));
    for (const sgn of [1, -1]) {
      const P = (r: number, c: number): GridPoint => {
        const t = (r / ns) * tS;
        const u = usD[c];
        const z = lerp(hd * (1 - t), -hd * (1 - t), u);
        return [sgn * (W / 2 - t * hd), yv(t, cOf(u, D)), z, z / tile, t * 2];
      };
      roof.grid(P, ns, usD.length - 1, sgn < 0);
      if (fascia > 0)
        fas.grid(
          (r, c) => {
            const q = P(0, c);
            return [q[0], q[1] - r * fascia, q[2], q[2] / tile, r];
          },
          1,
          usD.length - 1,
          sgn > 0,
        );
    }
  }
  if (ts < 1 && tEnd > ts) {
    const ng = 3;
    for (const sgn of [1, -1]) {
      const x = sgn * (span(1) - gableInset);
      gab.grid(
        (r, c) => {
          const t = lerp(ts, tEnd, r / ng);
          return [x, prof(t) - 0.25, lerp(hd * (1 - t), -hd * (1 - t), c), c, r / ng];
        },
        ng,
        1,
        sgn < 0,
      );
    }
  }
  // 脊
  const ridges: Ridge[] = [];
  if (tEnd >= 1) {
    const s = span(1);
    if (s > 0.5) {
      ridges.push({ a: [-s - 1.2, H + 0.7, 0], b: [s + 1.2, H + 0.7, 0], w: 2.4, h: 2.6 });
      ridges.push({ a: [-s - 1.2, H + 1.2, 0], b: [-s - 3.6, H + 4.6, 0], w: 2.4, h: 2.4 });
      ridges.push({ a: [s + 1.2, H + 1.2, 0], b: [s + 3.6, H + 4.6, 0], w: 2.4, h: 2.4 });
    }
    if (ts < 1) {
      for (const sx of [-1, 1])
        for (const sz of [-1, 1]) {
          const N = 3;
          for (let k = 0; k < N; k++) {
            const ta = lerp(ts, 1, k / N);
            const tb = lerp(ts, 1, (k + 1) / N);
            ridges.push({ a: [sx * s, prof(ta) + 0.6, sz * hd * (1 - ta)], b: [sx * s, prof(tb) + 0.6, sz * hd * (1 - tb)], w: 1.8, h: 1.8 });
          }
        }
    }
  }
  if (tS > 0) {
    for (const sx of [-1, 1])
      for (const sz of [-1, 1]) {
        const N = 4;
        for (let k = 0; k < N; k++) {
          const ta = (k / N) * tS;
          const tb = ((k + 1) / N) * tS;
          ridges.push({
            a: [sx * (W / 2 - ta * hd), yv(ta, 1) + 0.6, sz * hd * (1 - ta)],
            b: [sx * (W / 2 - tb * hd), yv(tb, 1) + 0.6, sz * hd * (1 - tb)],
            w: 1.8,
            h: 1.8,
          });
        }
      }
  }
  return { roof: roof.geo(), fascia: fas.empty ? null : fas.geo(), gable: gab.empty ? null : gab.geo(), ridges, prof };
}
