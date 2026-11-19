// 从样张搬来，结构没有动（spikes/art-direction/b/scene/models.js 里石头、船、树的形状），只加了类型。
// 这几样都是“一个形状摆很多个”：石头并进批次，船和树各用一个带实例的网格。只算形状，不碰页面。

import * as THREE from 'three';
import type { Vec2, Vec3 } from '../../ground/types';
import type { FigureClass } from '../internal';
import { FIGURE_SLOT, FIG_PLAIN } from './figureMaterial';
import { Batch, FB, cyl } from './geo';
import { fbm, lerp, smoothstep } from './util';

/** 一个顶点一份的那几样数据。成批摆的形状只带这几样：脚、共同的那一点、哪一类是一个实例带一份（见 instanced）。 */
const SHAPE_ATTRIBUTES = ['position', 'normal', 'uv', 'color'];

/** 把一个批次里的零件并成一个形状（批次里只放了一种材质时用）。 */
function mergedGeometry(b: Batch): THREE.BufferGeometry {
  const g = (b.build({}).children[0] as THREE.Mesh).geometry;
  for (const name of Object.keys(g.attributes)) if (!SHAPE_ATTRIBUTES.includes(name)) g.deleteAttribute(name);
  return g;
}

export function rockGeo(seed: number, detail: number): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(1, detail);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    const k = 0.72 + 0.56 * fbm(x * 1.3 + seed * 3.7, z * 1.3 + y * 1.1 - seed, 2, seed);
    p.setXYZ(i, x * k, Math.max(-0.25, y) * k * 0.72, z * k);
  }
  const col = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const s = lerp(0.72, 1.22, smoothstep(-0.2, 0.7, p.getY(i)));
    col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = s;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const nr = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const l = Math.hypot(p.getX(i), p.getY(i) * 1.6, p.getZ(i)) || 1;
    nr[i * 3] = p.getX(i) / l;
    nr[i * 3 + 1] = (p.getY(i) * 1.6) / l;
    nr[i * 3 + 2] = p.getZ(i) / l;
  }
  g.setAttribute('normal', new THREE.BufferAttribute(nr, 3));
  return g;
}

// ---------- 船 ----------
/** 船身多长、多宽（米）。摆船的时候要知道船头伸到哪里、两条船会不会叠在一起（dressing.ts）。 */
export const BOAT_LENGTH_M = 58;
export const BOAT_BEAM_M = 15.2;

export function boatGeo(): THREE.BufferGeometry {
  const fb = new FB();
  const L = BOAT_LENGTH_M;
  const B = BOAT_BEAM_M / 2;
  const NS = 8;
  const hull: Vec3 = [0.52, 0.52, 0.52];
  const rail: Vec3 = [1.05, 1.0, 0.95];
  const deck: Vec3 = [1.5, 1.38, 1.2];
  const st = (i: number): { x: number; b: number; d: number; y0: number } => {
    const s = -1 + (2 * i) / NS;
    const a = Math.abs(s);
    const b = B * (1 - 0.5 * Math.pow(a, 2.4));
    const d = 3.4 + 3.0 * Math.pow(a, 2.6);
    const y0 = -1.6 + 2.6 * Math.pow(a, 3);
    return { x: (s * L) / 2, b, d, y0 };
  };
  for (let i = 0; i < NS; i++) {
    const a = st(i);
    const b = st(i + 1);
    for (const sg of [-1, 1]) {
      fb.quad([a.x, a.y0, sg * a.b * 0.7], [b.x, b.y0, sg * b.b * 0.7], [b.x, b.d, sg * b.b], [a.x, a.d, sg * a.b], [0, -0.3, sg], null, [hull, hull, rail, rail]);
    }
    fb.quad([a.x, a.d - 1.0, -a.b * 0.94], [b.x, b.d - 1.0, -b.b * 0.94], [b.x, b.d - 1.0, b.b * 0.94], [a.x, a.d - 1.0, a.b * 0.94], [0, 1, 0], null, [deck, deck, deck, deck]);
    fb.quad([a.x, a.y0, -a.b * 0.7], [b.x, b.y0, -b.b * 0.7], [b.x, b.y0, b.b * 0.7], [a.x, a.y0, a.b * 0.7], [0, -1, 0], null, [hull, hull, hull, hull]);
  }
  for (const i of [0, NS]) {
    const a = st(i);
    const sg = i === 0 ? -1 : 1;
    fb.quad([a.x, a.y0, -a.b * 0.7], [a.x, a.y0, a.b * 0.7], [a.x, a.d, a.b], [a.x, a.d, -a.b], [sg, 0, 0], null, [hull, hull, rail, rail]);
  }
  // 篷：半圆的席篷
  const matc: Vec3 = [1.9, 1.62, 1.15];
  const mat2: Vec3 = [1.55, 1.3, 0.92];
  const R = B * 0.86;
  const x0 = -L * 0.2;
  const x1 = L * 0.19;
  const NA = 6;
  const ends: Vec2[] = [
    [x0, -1],
    [x1, 1],
  ];
  for (let k = 0; k < NA; k++) {
    const a0 = (k / NA) * Math.PI;
    const a1 = ((k + 1) / NA) * Math.PI;
    const p = (x: number, a: number): Vec3 => [x, 2.6 + Math.sin(a) * R * 0.95, Math.cos(a) * R];
    const am = (a0 + a1) / 2;
    fb.quad(p(x0, a0), p(x1, a0), p(x1, a1), p(x0, a1), [0, Math.sin(am), Math.cos(am)], null, [matc, matc, matc, matc]);
    for (const [x, sg] of ends) fb.quad([x, 2.6, 0], p(x, a0), p(x, a1), p(x, a1), [sg, 0, 0], null, [mat2, mat2, mat2, mat2]);
  }
  const g = fb.geo();
  // 桅杆
  const mast = cyl(0.6, 34, 5).toNonIndexed();
  mast.translate(L * 0.3, 2, 0);
  const mc = new Float32Array(mast.attributes.position.count * 3).fill(0.75);
  mast.setAttribute('color', new THREE.BufferAttribute(mc, 3));
  const merged = new Batch();
  merged.add('boat', g);
  merged.add('boat', mast);
  return mergedGeometry(merged);
}

/** 一个实例的记号：和并进网格的东西带的是同一套（见 geo.ts 的 FigureTag），只是一个实例带一份。 */
export interface InstanceFigure {
  /** 哪一类。不写是不归类。 */
  cls?: FigureClass | null;
  /** 次序，0 到 1（不含 1）。不写是 0。 */
  rank?: number;
  /** 哪一种（figureMaterial.ts 的 FIG_PLAIN、三种树）。不写是 FIG_PLAIN。 */
  kind?: number;
  /** aFig 的第四格：平常是 0；树写“水面到多高它开始缩”（沙盘里的高度）。 */
  mark?: number;
  /** 绕着哪一点放大，写在这个实例自己的坐标里（没有乘它的位置、朝向和大小）。不写是它的原点。 */
  pivot?: Vec3;
  /** 这一群东西共同的那一点，写在这一个网格的坐标里（和实例的 x、y、z 一套）。不写是它自己的脚：不摊开。 */
  group?: Vec3;
}

/** 一个实例：摆在哪、转多少、放多大、什么颜色 */
export interface Instance {
  x: number;
  y: number;
  z: number;
  ry?: number;
  /** 三个方向一样的倍数；sx、sy、sz 是各个方向自己的 */
  s?: number;
  sx?: number;
  sy?: number;
  sz?: number;
  color?: string;
  /** 远了近了怎么变。不写是原样画。 */
  figure?: InstanceFigure;
  /** 属于哪一条点缀规则（规则的 id）、是那条规则里的第几组。模型用不着，测试数数用。 */
  rule?: string;
  cluster?: number;
}

/**
 * 一个形状摆很多个。每个网格有自己的一份形状：一个顶点一份的数据（position 这些）和 geo 共用，
 * 一个实例一份的数据（aPivot、aGroup、aFig）是它自己的。用完这一份也要 dispose（geo 另外放）。
 */
export function instanced(geo: THREE.BufferGeometry, material: THREE.Material, list: Instance[]): THREE.InstancedMesh {
  const n = Math.max(1, list.length);
  const own = new THREE.BufferGeometry();
  for (const name of SHAPE_ATTRIBUTES) if (geo.attributes[name]) own.setAttribute(name, geo.attributes[name]);
  if (geo.index) own.setIndex(geo.index);
  const pivots = new Float32Array(n * 3);
  const groups = new Float32Array(n * 3);
  const figs = new Float32Array(n * 4);

  const mesh = new THREE.InstancedMesh(own, material, n);
  mesh.count = list.length;
  const m = new THREE.Matrix4();
  const inverse = new THREE.Matrix4();
  const c = new THREE.Color();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const v = new THREE.Vector3();
  list.forEach((it, i) => {
    m.compose(new THREE.Vector3(it.x, it.y, it.z), q.setFromAxisAngle(up, it.ry || 0), new THREE.Vector3(it.sx ?? it.s ?? 1, it.sy ?? it.s ?? 1, it.sz ?? it.s ?? 1));
    mesh.setMatrixAt(i, m);
    if (it.color) mesh.setColorAt(i, c.set(it.color));
    const f = it.figure;
    const pivot = f?.pivot ?? [0, 0, 0];
    pivots.set(pivot, i * 3);
    if (f?.group) {
      // 共同的那一点换到这个实例自己的坐标里：显卡是在乘实例的矩阵以前算的
      v.set(f.group[0], f.group[1], f.group[2]).applyMatrix4(inverse.copy(m).invert());
      groups.set([v.x, v.y, v.z], i * 3);
    } else {
      groups.set(pivot, i * 3);
    }
    figs[i * 4] = f?.cls ? FIGURE_SLOT[f.cls] : 0;
    figs[i * 4 + 1] = f?.rank ?? 0;
    figs[i * 4 + 2] = f?.kind ?? FIG_PLAIN;
    figs[i * 4 + 3] = f?.mark ?? 0;
  });
  own.setAttribute('aPivot', new THREE.InstancedBufferAttribute(pivots, 3));
  own.setAttribute('aGroup', new THREE.InstancedBufferAttribute(groups, 3));
  own.setAttribute('aFig', new THREE.InstancedBufferAttribute(figs, 4));
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  // 实例在显卡上放大、摊开，three 按没放大的大小算出来的范围不作数
  mesh.frustumCulled = false;
  return mesh;
}

// ---------- 树 ----------
// 树是一丛一丛的，像画里的点苔：下面深、上面亮（颜色的深浅写在顶点上，树自己的颜色乘上去）。
const RAMP_LO: Vec3 = [0.6, 0.66, 0.76];
const RAMP_HI: Vec3 = [1.32, 1.27, 1.06];

/** 一团叶子：细分过的二十面体，略微不圆，法线是平滑的 */
function lobe(detail: number, seed: number, r: number, ry: number, x: number, y: number, z: number, yLo: number, yHi: number): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(1, detail);
  const p = g.attributes.position;
  const n = new Float32Array(p.count * 3);
  const col = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    let px = p.getX(i);
    let py = p.getY(i);
    let pz = p.getZ(i);
    const k = 0.86 + 0.28 * fbm(px * 1.7 + seed * 5.3, pz * 1.7 + py * 1.3 - seed * 2.1, 2, seed);
    px *= k;
    py *= k;
    pz *= k;
    const l = Math.hypot(px, py * 1.25, pz) || 1;
    n[i * 3] = px / l;
    n[i * 3 + 1] = (py * 1.25) / l;
    n[i * 3 + 2] = pz / l;
    const wy = y + py * ry;
    const t = smoothstep(yLo, yHi, wy) * (0.82 + 0.18 * (py * 0.5 + 0.5));
    col[i * 3] = lerp(RAMP_LO[0], RAMP_HI[0], t);
    col[i * 3 + 1] = lerp(RAMP_LO[1], RAMP_HI[1], t);
    col[i * 3 + 2] = lerp(RAMP_LO[2], RAMP_HI[2], t);
    p.setXYZ(i, x + px * r, wy, z + pz * r);
  }
  g.setAttribute('normal', new THREE.BufferAttribute(n, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

/** 近看的树：五团叶子一根干。detail 是叶团分得多细（最近的几棵分细一档，轮廓才圆） */
export function clumpGeo(detail = 1): THREE.BufferGeometry {
  const b = new Batch();
  // 每团叶子：x、y、z，半径，竖向的半径
  const lobes: [number, number, number, number, number][] = [
    [0, 17, 0, 12.5, 10.5],
    [9.5, 11, 4, 9.5, 8],
    [-8.5, 10.5, -5.5, 10, 8],
    [1.5, 10, -9, 8.5, 7],
    [-2.5, 9.5, 8.5, 8.5, 7],
  ];
  lobes.forEach(([x, y, z, r, ry], i) => b.add('m', lobe(detail, i + 1, r, ry, x, y, z, 3, 27)));
  const trunk = cyl(1.7, 9, 5, 1.2).toNonIndexed();
  const tc = new Float32Array(trunk.attributes.position.count * 3);
  for (let i = 0; i < tc.length; i += 3) {
    tc[i] = 1.05;
    tc[i + 1] = 0.55;
    tc[i + 2] = 0.42;
  }
  trunk.setAttribute('color', new THREE.BufferAttribute(tc, 3));
  b.add('m', trunk);
  return mergedGeometry(b);
}
/** 稍远的树只是一粒“苔点”：压扁的一团 */
export function blobGeo(detail: number): THREE.BufferGeometry {
  return lobe(detail, 7, 1, 0.8, 0, 0.62, 0, -0.1, 1.3);
}
