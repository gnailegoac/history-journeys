// 九种摆件各怎么造。每种一个函数，按 kind 收在 THING_BUILDERS 里：domain 的表里添了一种零件，这里不添就编译不过。
// 尺寸、做法照样张（spikes/art-direction/b/scene/models.js 的 buildCity、buildBerm、buildDike、buildXimatai），
// 改成了照场景数据摆：城墙是任意一圈线，城门落在离它最近的那一面墙上，参数只从 domain 的表里读。
// 只算形状，不碰页面。
//
// 只造一遍：近看的样子、本来的大小和位置。每样东西造的时候在批次上写一个记号（geo.ts 的 FigureTag）：
// 它的脚在哪、哪一类、是不是立在城墙上、站的地方水漫不漫得到；远了放大多少由显卡照记号算（figureMaterial.ts）。
// 前一半“远看的一套”省掉的细处（垛口、墙里侧的矮墙、压顶的条石、门缝、券石、长廊、门屋和院墙、篱笆、木桩）
// 都还在，各带“细处”的记号：远了先矮下去，再收成一个点，不是一下子没有的。
// 城墙的墙身、城台、堤、土坡不归类：墙和城门那一组远了整体拔高（总装时改那一组的竖向倍数），别的不变。

import * as THREE from 'three';
import type { SceneThing, ThingKind } from '../../../domain/scene';
import type { FamilyThingKind } from '../../../domain/sceneKinds';
import { plotHalfM, yardLayout } from '../../ground';
import type { Vec2, Vec3 } from '../../ground/types';
import type { FigureClass, KitContext } from '../internal';
import { Batch, FB, T, box, cyl, prism, segBox } from './geo';
import type { MatName } from './materials';
import { thingParams } from './params';
import { addCottage, addHouse, addPavilion, addShed, addTower } from './parts';
import type { TowerSpec } from './parts';
import { facingRy, footOf, groupPoint, groundY, joinedTo, local, wetAt } from './pass';
import type { Joined, Pass } from './pass';
import { WALL_BASE_HALF, WALL_TOP_HALF, cornerOffset, insideRing, nearestOnRing, offsetPoint, onWallTop, ringDistance, snapLineToRing } from './site';
import type { Ring, RingPos, WallSite } from './site';
import { clamp, lerp, smoothstep } from './util';

export type ThingBuilder = (pass: Pass, thing: SceneThing) => void;

/** 砖的贴图一张管 48 米：一皮砖高 1.5 米 */
const UVB = 48;
/** 门洞多宽（一半） */
const ARCH_W = 22;
/** 角台：从墙角那一点往外 7 米为中心，四面各出去 46 米（直角的墙角上就是一座 92 米见方的墩子）。 */
export const CORNER_OUT = 7;
export const CORNER_HALF = 46;
/** 贴在城墙外侧的土坡：平台从墙线铺到墙外这么多米，再斜到这么多米的地方下到河床。 */
const BANK_FLAT_M = 82;
const BANK_FOOT_M = 106;

/** 城墙的明暗：墙脚那四分之一深两成、偏冷一点（潮气），往上是墙的本色。g 是城里的地面。 */
const wallShade =
  (g: number) =>
  (y: number): Vec3 => {
    const k = smoothstep(g - 4, g + 22, y);
    const s = lerp(0.78, 1.0, k);
    return [s * lerp(0.95, 1, k), s * lerp(0.985, 1, k), s * lerp(1.035, 1, k)];
  };

/** 垛口：隔多远一个，宽、高、厚，米（样张近看的数）。 */
const MERLON = { step: 20, w: 11, h: 9, d: 6 };

/** 一排垛口。每一个是一处细处：远了各自矮下去、收掉。 */
function addMerlons(b: Batch, mat: MatName, M: THREE.Matrix4, len: number, zEdge: number, y: number, step = MERLON.step): void {
  const n = Math.max(1, Math.floor(len / step));
  for (let i = 0; i < n; i++) {
    const x = -len / 2 + (i + 0.5) * (len / n);
    b.addDetail(mat, box(MERLON.w, MERLON.h, MERLON.d), M.clone().multiply(T(x, y, zEdge)), [1.06, 1.06, 1.06]);
  }
}

/** 一条折线的每一段：两头、中点、多长、顺着它摆的零件要转多少。 */
function eachSegment(line: Vec2[], fn: (a: Vec2, b: Vec2, mid: Vec2, len: number, ry: number) => void): void {
  for (let i = 0; i < line.length - 1; i++) {
    const a = line[i];
    const b = line[i + 1];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 0.5) continue;
    fn(a, b, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], len, Math.atan2(-(b[1] - a[1]), b[0] - a[0]));
  }
}

const linePoints = (pass: Pass, thing: SceneThing): Vec2[] => (thing.line ?? []).map((p) => local(pass, p));

// ---------------------------------------------------------------- 城墙

/** 城墙：沿着一圈线，每一面一段墙身，城门那里让开；墙顶一排垛口；每个墙角一座角台。 */
function buildWall(pass: Pass, thing: SceneThing): void {
  const site = pass.survey.walls.get(thing.id);
  if (!site) return;
  const ml = MERLON;
  const B = pass.bucket(thing.when).raised;
  const g = site.groundY;
  const top = site.topY;
  const shade = wallShade(g);
  const halfAt = (y: number): number => lerp(WALL_BASE_HALF, WALL_TOP_HALF, (y - (g - 16)) / (top - (g - 16)));
  const yMid = g + 20;
  const section: Vec2[] = [
    [WALL_BASE_HALF, g - 16],
    [halfAt(yMid), yMid],
    [WALL_TOP_HALF, top],
    [-WALL_TOP_HALF, top],
    [-halfAt(yMid), yMid],
    [-WALL_BASE_HALF, g - 16],
  ];
  /** 从 lo 到 hi，去掉城门占的几段（每座城门左右各让开 clear(o) 米）以后剩下的几段。 */
  const spansOf = (lo: number, hi: number, gates: WallSite['openings'], clear: (o: WallSite['openings'][number]) => number): Vec2[] => {
    const out: Vec2[] = [];
    for (const o of gates) {
      if (o.u - clear(o) > lo) out.push([lo, o.u - clear(o)]);
      lo = Math.max(lo, o.u + clear(o));
    }
    if (hi > lo) out.push([lo, hi]);
    return out;
  };
  site.ring.sides.forEach((s, i) => {
    const gates = site.openings.filter((o) => o.side === i).sort((a, b) => a.u - b.u);
    // 墙身：两头各伸出 15 米压进角台里；城门那里是通的
    for (const [a, b] of spansOf(-s.len / 2 - 15, s.len / 2 + 15, gates, (o) => o.clear)) {
      B.add(site.mat, prism(section, b - a, { shade, topShade: 1.18, uvScale: UVB }), s.M.clone().multiply(T((a + b) / 2, 0, 0)));
    }
    if (site.parapet) {
      // 垛口：城门的城台上另有一排，这里让开
      for (const [a, b] of spansOf(-s.len / 2 - 10, s.len / 2 + 10, gates, (o) => o.clear + 16)) {
        addMerlons(B, site.mat, s.M.clone().multiply(T((a + b) / 2, 0, 0)), b - a, WALL_TOP_HALF - ml.d / 2, top);
      }
      // 城里一侧的矮墙
      B.addDetail(site.mat, box(s.len + 20, 4.5, 2.6), s.M.clone().multiply(T(0, top, -WALL_TOP_HALF + 1.4)), [1.06, 1.06, 1.06]);
    }
    // 包砖的城墙，墙顶下面有一道压顶的条石
    if (site.mat === 'brick') B.addDetail('stone', box(s.len + 24, 3.2, 3), s.M.clone().multiply(T(0, top - 4.2, WALL_TOP_HALF + 0.9)), [1.1, 1.08, 1.04]);
  });
  // 角台：每个墙角一座，把两面墙接头的地方盖住；角楼、亭子摆在它上面
  const n = site.ring.sides.length;
  site.ring.pts.forEach((corner, i) => {
    const cur = site.ring.sides[i];
    const prev = site.ring.sides[(i - 1 + n) % n];
    const [px, pz] = cornerOffset(site.ring, i, CORNER_OUT);
    const bh = site.gateTopY - g + 16;
    // 两面墙不是直角相接：角台做成一个斜的墩子，四个面各和一面墙平行，垛口摆在它朝外的两条边上
    const turn = prev.out[0] * cur.out[1] - prev.out[1] * cur.out[0];
    const square = Math.abs(prev.out[0] * cur.out[0] + prev.out[1] * cur.out[1]) < 1e-6;
    if (!square && Math.abs(turn) > 0.2) {
      /** 离前一面墙的线 s1 米、离这一面墙的线 s2 米（朝外为正）的那一点。 */
      const at = (s1: number, s2: number): Vec2 => [
        corner[0] + (s1 * cur.out[1] - s2 * prev.out[1]) / turn,
        corner[1] + (-s1 * cur.out[0] + s2 * prev.out[0]) / turn,
      ];
      const hi = CORNER_OUT + CORNER_HALF;
      const lo = CORNER_OUT - CORNER_HALF;
      const foot: Vec2[] = [at(hi, hi), at(hi, lo), at(lo, lo), at(lo, hi)];
      const faces: Vec2[] = [prev.out, [-cur.out[0], -cur.out[1]], [-prev.out[0], -prev.out[1]], cur.out];
      const y0 = g - 16;
      const y1 = site.gateTopY;
      const fb = new FB();
      let acc = 0;
      foot.forEach((a, k) => {
        const b = foot[(k + 1) % 4];
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
        fb.quad(
          [a[0], y0, a[1]],
          [b[0], y0, b[1]],
          [b[0], y1, b[1]],
          [a[0], y1, a[1]],
          [faces[k][0], 0, faces[k][1]],
          [
            [acc / UVB, 0],
            [(acc + len) / UVB, 0],
            [(acc + len) / UVB, bh / UVB],
            [acc / UVB, bh / UVB],
          ],
          [shade(y0), shade(y0), shade(y1), shade(y1)],
        );
        acc += len;
      });
      for (const [y, ny, s] of [
        [y1, 1, 1.18],
        [y0, -1, 0.78],
      ]) {
        fb.quad(
          [foot[0][0], y, foot[0][1]],
          [foot[1][0], y, foot[1][1]],
          [foot[2][0], y, foot[2][1]],
          [foot[3][0], y, foot[3][1]],
          [0, ny, 0],
          foot.map((q): Vec2 => [q[0] / UVB, q[1] / UVB]),
          [s, s, s, s],
        );
      }
      B.add(site.mat, fb.geo());
      if (site.parapet) {
        // 朝外的两条边：foot[0]—foot[1] 和前一面墙平行，foot[3]—foot[0] 和这一面墙平行
        const rows: [WallSite['ring']['sides'][number], Vec2, Vec2][] = [
          [prev, foot[0], foot[1]],
          [cur, foot[3], foot[0]],
        ];
        for (const [s, a, b] of rows) {
          const mx = (a[0] + b[0]) / 2 - s.out[0] * (ml.d / 2 + 0.4);
          const mz = (a[1] + b[1]) / 2 - s.out[1] * (ml.d / 2 + 0.4);
          addMerlons(B, site.mat, T(mx, 0, mz, s.ry), Math.hypot(b[0] - a[0], b[1] - a[1]), 0, site.gateTopY, 18.4);
        }
      }
      return;
    }
    const geo = box(92, bh, 92);
    const pos = geo.attributes.position;
    const nor = geo.attributes.normal;
    const uv = geo.attributes.uv;
    const col = new Float32Array(pos.count * 3);
    for (let k = 0; k < pos.count; k++) {
      const yy = pos.getY(k) + g - 16;
      const sh: Vec3 = nor.getY(k) > 0.9 ? [1.18, 1.18, 1.18] : shade(yy);
      col[k * 3] = sh[0];
      col[k * 3 + 1] = sh[1];
      col[k * 3 + 2] = sh[2];
      uv.setXY(k, (uv.getX(k) * 92) / UVB, (uv.getY(k) * bh) / UVB);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    B.add(site.mat, geo, T(px, g - 16, pz, cur.ry));
    if (site.parapet) {
      for (const s of [cur, prev]) addMerlons(B, site.mat, T(px + s.out[0] * 42.6, 0, pz + s.out[1] * 42.6, s.ry), 92, 0, site.gateTopY, 18.4);
    }
  });
}

// ---------------------------------------------------------------- 城门

function archPath(target: THREE.Path, halfW: number, g: number): void {
  const spring = g + 30;
  target.moveTo(-halfW, g - 1);
  target.lineTo(halfW, g - 1);
  target.lineTo(halfW, spring);
  target.absarc(0, spring, halfW, 0, Math.PI, false);
  target.lineTo(-halfW, g - 1);
}

/** 门洞口的一圈券石 */
function archRing(g: number): THREE.BufferGeometry {
  const s = new THREE.Shape();
  archPath(s, ARCH_W + 5, g);
  const hole = new THREE.Path();
  archPath(hole, ARCH_W, g);
  s.holes.push(hole);
  const geo = new THREE.ExtrudeGeometry(s, { depth: 3, bevelEnabled: false, curveSegments: 12 });
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / UVB, uv.getY(i) / UVB);
  return geo;
}

/** 城台：一个梯形的大墩子，当中掏出门洞 */
function gatePlatform(halfW: number, depth: number, g: number, top: number): THREE.BufferGeometry {
  const s = new THREE.Shape();
  s.moveTo(-halfW - 4, g - 16);
  s.lineTo(halfW + 4, g - 16);
  s.lineTo(halfW, top);
  s.lineTo(-halfW, top);
  s.closePath();
  const hole = new THREE.Path();
  archPath(hole, ARCH_W, g);
  s.holes.push(hole);
  const geo = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false, curveSegments: 12 });
  geo.translate(0, 0, -depth / 2);
  const gn = geo.index ? geo.toNonIndexed() : geo;
  const pos = gn.attributes.position;
  const nor = gn.attributes.normal;
  const uv = gn.attributes.uv;
  const col = new Float32Array(pos.count * 3);
  const shade = wallShade(g);
  const spring = g + 30;
  for (let i = 0; i < pos.count; i++) {
    const up = nor.getY(i) > 0.9;
    const inside = Math.abs(pos.getX(i)) < ARCH_W + 0.5 && pos.getY(i) < spring + ARCH_W + 1 && Math.abs(nor.getZ(i)) < 0.5;
    const sh: Vec3 = up ? [1.16, 1.16, 1.16] : inside ? [0.42, 0.42, 0.42] : shade(pos.getY(i));
    col[i * 3] = sh[0];
    col[i * 3 + 1] = sh[1];
    col[i * 3 + 2] = sh[2];
    uv.setXY(i, uv.getX(i) / UVB, uv.getY(i) / UVB);
  }
  gn.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return gn;
}

/** 城门：城台、门洞、门扇，城台上的垛口。落在城墙上离它最近的那一点，朝城外。 */
function buildGate(pass: Pass, thing: SceneThing): void {
  const gate = pass.survey.gates.get(thing.id);
  if (!gate) return;
  const wall = gate.wall;
  const p = thingParams('gate', thing.params);
  const mat: MatName = p.face === undefined ? wall.mat : p.face === 'brick' ? 'brick' : 'rammed';
  const B = pass.bucket(thing.when).raised;
  const g = wall.groundY;
  const top = wall.gateTopY;
  const { M, halfW, depth } = gate;
  const m = (x: number, y: number, z: number): THREE.Matrix4 => M.clone().multiply(T(x, y, z));
  B.add(mat, gatePlatform(halfW, depth, g, top), M);
  B.add('vermilion', box(2 * ARCH_W - 0.6, 52, 3), m(0, g - 1, depth / 2 - 20), [0.5, 0.4, 0.38]);
  // 下面都是细处。两扇门当中的缝
  B.addDetail('timber', box(0.9, 52, 3.6), m(0, g - 1, depth / 2 - 20), [0.58, 0.66, 0.68]);
  // 门洞口的一圈：包砖的城门是券石，夯土的是深一点的土。它的脚在门洞口的地上
  const ringMat: MatName = mat === 'brick' ? 'stone' : mat;
  const ringTint: Vec3 = mat === 'brick' ? [1.12, 1.1, 1.06] : [0.9, 0.9, 0.9];
  B.addDetail(ringMat, archRing(g), m(0, 0, depth / 2 - 1.4), ringTint, [0, g - 1, 1.5]);
  B.addDetail(ringMat, archRing(g), m(0, 0, -depth / 2 - 1.6), ringTint, [0, g - 1, 1.5]);
  if (!wall.parapet) return;
  addMerlons(B, mat, M, 2 * halfW - 2, depth / 2 - 3.4, top, 18.75);
  B.addDetail(mat, box(2 * halfW - 2, 4.5, 2.6), m(0, top, -depth / 2 + 1.6), [1.06, 1.06, 1.06]);
  for (const sx of [-1, 1]) for (let k = 0; k < 2; k++) B.addDetail(mat, box(6, 9, 11), m(sx * (halfW - 3.4), top, depth / 2 - 16 - k * 19), [1.06, 1.06, 1.06]);
}

// ---------------------------------------------------------------- 楼

// 小的一种是样张里普通的城楼（重檐一层），大的一种是样张里的黄楼（两层带平坐）。
const TOWER_SMALL = { W: 92, D: 38, H1: 17, nxc: 6, nzc: 3, ov1: 12, rise1: 7.5, W2: 78, D2: 24, ov2: 13, roofH: 21, lift: 4 };
const TOWER_LARGE = { W: 112, D: 50, H1: 22, nxc: 8, nzc: 4, ov1: 14, rise1: 8, W2: 92, D2: 30, nxc2: 6, nzc2: 3, ov2: 16, roofH: 27, doorN: 1, winN: 1, lift: 4.2 };

/**
 * 楼。摆在城门上的是城楼；摆在城墙上的是角楼（方的，攒尖顶）；不写 on 的立在地上。
 * 现在只有一层（重檐）和两层两种：storeys 写 2 以上都按两层做。
 */
function buildTower(pass: Pass, thing: SceneThing): void {
  const p = thingParams('tower', thing.params);
  const B = pass.bucket(thing.when).main;
  const large = p.size === 'large';
  const two = (p.storeys ?? (large ? 2 : 1)) >= 2;
  const wall: MatName = p.walls === 'yellow-wash' ? 'yellow' : 'plaster';
  const col: MatName = p.timber === 'plain' ? 'plainTimber' : 'vermilion';
  const spec: TowerSpec = { ...(large ? TOWER_LARGE : TOWER_SMALL), H2: two ? (large ? 19 : 15) : large ? 8 : 7, balcony: two, wall, col };

  const gate = thing.on ? pass.survey.gates.get(thing.on) : undefined;
  if (gate) {
    // 城楼：脚在城台顶上，城台拔高它跟着升
    const M = gate.M.clone().multiply(T(0, gate.wall.gateTopY, 0));
    const foot = new THREE.Vector3().setFromMatrixPosition(M);
    B.tagged({ pivot: [foot.x, foot.y, foot.z], cls: 'tower', onWall: true }, () => addTower(B, M, spec));
    return;
  }
  if (!thing.at) return;
  const [x, z] = local(pass, thing.at);
  const host = thing.on ? pass.survey.walls.get(thing.on) : undefined;
  if (host) {
    const at = onWallTop(host, x, z);
    B.tagged({ pivot: [at.x, at.y, at.z], cls: 'wallTop', onWall: true }, () =>
      addPavilion(B, T(at.x, at.y, at.z, at.ry), large ? { S: 44, H: 19, roofH: 21, ov: 10, wall, col } : { S: 34, H: 15, roofH: 17, ov: 9, wall, col }),
    );
    return;
  }
  const y = groundY(pass, x, z) - 1;
  B.tagged(standing(pass, thing, [x, y, z], 'tower'), () => addTower(B, T(x, y, z, facingRy(thing.facing)), spec));
}

// ---------------------------------------------------------------- 亭

/** 亭：四面空的攒尖顶小亭。摆在城墙上的落在墙顶（离墙角近的落在角台上）。 */
function buildPavilion(pass: Pass, thing: SceneThing): void {
  if (!thing.at) return;
  const p = thingParams('pavilion', thing.params);
  const B = pass.bucket(thing.when).main;
  const roofMat: MatName = p.roof === 'thatch' ? 'thatch' : 'tile';
  const [x, z] = local(pass, thing.at);
  const host = thing.on ? pass.survey.walls.get(thing.on) : undefined;
  if (host) {
    const at = onWallTop(host, x, z);
    B.tagged({ pivot: [at.x, at.y, at.z], cls: 'wallTop', onWall: true }, () => addPavilion(B, T(at.x, at.y, at.z, at.ry), { S: 34, H: 15, roofH: 17, ov: 9, roofMat }));
    return;
  }
  const foot = footOf(pass, thing) ?? [x, groundY(pass, x, z) - 2, z];
  B.tagged(standing(pass, thing, foot, 'pavilion'), () => addPavilion(B, T(foot[0], foot[1], foot[2], facingRy(thing.facing)), { S: 26, H: 13, roofH: 15, ov: 8, roofMat }));
}

/**
 * 立在地上的单座的东西（屋、亭、楼）的记号：脚在 foot。
 * 挨着前面一座小建筑的，跟着那一座整组放大（类用那一组的，从那一座的脚摊开）；不挨着谁的用 own 这一类，绕着自己的脚放大。
 */
function standing(pass: Pass, thing: SceneThing, foot: Vec3, own: FigureClass, sink = 1): { pivot: Vec3; group: Vec3; cls: FigureClass; wet: boolean } {
  const joined = joinedTo(pass, thing.id);
  // 跟着别人的：横竖从主角的脚摊开，高度跟着地面走（见 groupPoint），不埋进坡里、也不悬空。sink 是它的脚比地面低多少
  return { pivot: foot, group: joined && !joined.main ? groupPoint(pass, joined, foot, sink) : foot, cls: joined ? joined.cls : own, wet: wetAt(pass, foot[0], foot[2]) };
}

// ---------------------------------------------------------------- 一组院落

const HALL_MAIN: TowerSpec = { W: 84, D: 34, H1: 16, nxc: 6, nzc: 3, ov1: 11, roofH: 19, wall: 'plaster', lift: 4 };
const HALL_NEXT: TowerSpec = { W: 66, D: 26, H1: 13, nxc: 5, nzc: 3, ov1: 9, roofH: 15, wall: 'plaster', lift: 3 };
/** 一座殿脚下看地面高低的五个点：正中和四个角。 */
const FOOTPRINT: Vec2[] = [
  [0, 0],
  [-1, -1],
  [1, -1],
  [1, 1],
  [-1, 1],
];

/**
 * 一组院落：官署、寺。几进殿从后往前排在中轴上（最后面一座最大），两边是长廊，四面围墙，前面一座门屋。
 * 不写参数就是样张里的州衙：两进，有廊，有围墙，平地上。
 * terraced：每座殿各自落在它脚下的地面上，下面垫一个石台，顺着山坡一级一级下来。
 * 整组是一样东西：脚在院子正中（写的那一点）的地上，远了整组绕着它放大。长廊、门屋、围墙是细处，远了收掉，只剩几座殿。
 */
function buildHallGroup(pass: Pass, thing: SceneThing): void {
  if (!thing.at) return;
  const p = thingParams('hall-group', thing.params);
  const n = clamp(Math.round(p.halls ?? 2), 1, 5);
  const galleries = p.galleries ?? true;
  const enclosed = p.enclosed ?? true;
  const terraced = p.terraced ?? false;
  const B = pass.bucket(thing.when).main;
  const [cx, cz] = local(pass, thing.at);
  const ry0 = facingRy(thing.facing);
  const city = [...pass.survey.walls.values()].find((w) => insideRing(w.ring, cx, cz));
  // 哪一类：城里的、城外的各是一类；要是挨着前面一座小建筑，就跟着那一组（类用那一组的，从那一座的脚摊开）
  const joined = joinedTo(pass, thing.id);
  const host = joined && !joined.main ? joined : null;
  const cls: FigureClass = host ? host.cls : city ? 'yardCity' : 'yardOut';
  const cos = Math.cos(ry0);
  const sin = Math.sin(ry0);
  /** 院落自己的坐标（正面是 +z）换成沙盘上的一点。 */
  const world = (dx: number, dz: number): Vec2 => [cx + dx * cos + dz * sin, cz + -dx * sin + dz * cos];
  const flatY = city ? city.groundY : groundY(pass, cx, cz) - 1;
  const outer = B.tag;
  B.tag = { pivot: [cx, flatY, cz], group: host ? host.foot : [cx, flatY, cz], cls, wet: wetAt(pass, cx, cz) };
  const yAt = (dx: number, dz: number): number => {
    if (!terraced) return flatY;
    const [x, z] = world(dx, dz);
    return groundY(pass, x, z);
  };

  // 几进殿：从最后面一座起，隔 72 米一座。怎么排、围墙在哪由地面那一边定（大街要让开这一块）
  const layout = yardLayout(n);
  const zs = layout.zs;
  zs.forEach((dz, i) => {
    const spec = i === 0 ? HALL_MAIN : HALL_NEXT;
    const [x, z] = world(0, dz);
    let y = flatY;
    if (terraced) {
      // 石台：顶面比殿脚下最高的地面高一点，往下一直接到最低的地面以下，免得悬空
      let lo = Infinity;
      let hi = -Infinity;
      for (const [ex, ez] of FOOTPRINT) {
        const [wx, wz] = world(ex * (spec.W / 2 + 14), dz + ez * (spec.D / 2 + 12));
        const h = groundY(pass, wx, wz);
        lo = Math.min(lo, h);
        hi = Math.max(hi, h);
      }
      const bottom = lo - 6;
      y = hi + 2;
      B.add('stone', box(spec.W + 28, y - bottom, spec.D + 24), T(x, bottom, z, ry0), [1.0, 0.97, 0.9]);
    }
    addTower(B, T(x, y, z, ry0), spec);
  });

  const zN = layout.back;
  const zFront = layout.gate;
  const zS = layout.front;
  const [yx, yz] = world(0, (zN + zS) / 2);
  // 院子占的地。远了整组放大到几倍，民居挑“远了留哪几座”时要让开放大以后的那一块
  pass.yards.push({ cx: yx, cz: yz, ry: ry0, hx: 130, hz: (zS - zN) / 2 + 12, grow: Math.max(1, pass.ctx.style.figure.rules[cls].maxTimes), about: host ? [host.foot[0], host.foot[2]] : [cx, cz] });
  if (city) {
    // 院子里留三处种树
    const spots: Vec2[] = [
      [-60, zs[0] + 40],
      [58, zs[0] + 46],
      [-30, zs[n - 1] + 34],
    ];
    // 这三处的树跟着院落一起放大、摊开
    const about: Vec2 = host ? [host.foot[0], host.foot[2]] : [cx, cz];
    for (const [dx, dz] of spots) {
      const [x, z] = world(dx, dz);
      pass.lots.push({ x, z, y: city.groundY, follow: { cls, group: about, rank: 0 } });
    }
  }

  // 下面都是细处：长廊、门屋、围墙
  if (galleries) {
    const len = n >= 2 ? (n - 1) * 72 + 12 : 40;
    const zc = (zs[0] + zs[n - 1]) / 2 + 8;
    for (const sx of [-1, 1]) {
      const [x, z] = world(sx * 84, zc);
      const y = yAt(sx * 84, zc);
      B.detail([x, y, z], () => addHouse(B, x, y, z, ry0 + Math.PI / 2, len, 20, 11, 9, [1, 1, 1], [1, 1, 1], false));
    }
  }
  if (enclosed) {
    const [fx, fz] = world(0, zFront);
    const fy = yAt(0, zFront);
    B.detail([fx, fy, fz], () => addHouse(B, fx, fy, fz, ry0, 46, 18, 11, 9, [1, 1, 1], [1, 1, 1], false));
    /** 一段围墙。顺着山坡的院落把它切成短的几截，每截落在自己脚下的地面上。 */
    const wallRun = (x0: number, z0: number, x1: number, z1: number): void => {
      const len = Math.hypot(x1 - x0, z1 - z0);
      const pieces = terraced ? Math.max(1, Math.ceil(len / 40)) : 1;
      const alongX = z0 === z1;
      for (let k = 0; k < pieces; k++) {
        const t = (k + 0.5) / pieces;
        const dx = lerp(x0, x1, t);
        const dz = lerp(z0, z1, t);
        const [x, z] = world(dx, dz);
        const l = len / pieces + (terraced ? 1 : 0);
        const y = terraced ? yAt(dx, dz) - 6 : flatY;
        B.addDetail('plaster', alongX ? box(l, terraced ? 14 : 8, 3) : box(3, terraced ? 14 : 8, l), T(x, y, z, ry0), [0.93, 0.9, 0.84]);
      }
    };
    const hw = layout.halfWidth;
    wallRun(-hw - 1, zN, hw + 1, zN);
    wallRun(-hw, zN - 0.5, -hw, zS + 0.5);
    wallRun(hw, zN - 0.5, hw, zS + 0.5);
    wallRun(-hw, zS, -25, zS);
    wallRun(25, zS, hw, zS);
  }
  B.tag = outer;
}

// ---------------------------------------------------------------- 单座的屋

/**
 * 地上单座的茅屋的尺寸：正面（山墙）宽 24、进深 28，顶比屋身宽 5、长 4（29 × 32）；篱笆在屋外 14 米。
 * figure.ts 的 plotOf 里照着写了一遍，这里改了那边要跟着改。
 * 门高 10、台基 3.3：屋脚比地面低 1，大水的水面比徐州那座草屋的屋脚高 8.3，正好到门的一半（“水及其半扉”）。
 */
const COTTAGE = { W: 24, D: 28, wallH: 12.5, roofH: 9.5, doorW: 6.5, doorH: 10, plinth: 3.3 };
/** 跟着一座亭子的小屋（亭下的小屋）是配角，小一号，不和亭子抢。 */
const COTTAGE_SMALL = { W: 17, D: 20, wallH: 9, roofH: 7, doorW: 4.6, doorH: 7, plinth: 2.2 };
/** 篱笆在屋外多远。 */
const FENCE_OUT = 14;
/** 墙顶的棚子：顺着墙 30 米，进深 9 米（顶 34 × 13.5），比墙顶（36 米）窄得多。 */
const SHED = { L: 30, D: 9, postH: 7, roofH: 6 };
/** 屋子脚下的坡比这陡（沙盘里的高度，每米升多少），又没有写朝哪边，就让它背靠着山、正面朝下坡。篱笆也不上比这陡的坡。 */
const STEEP = 0.3;

/**
 * 没写朝向的屋子朝哪边：平地上朝南（零件一贯的规矩）；坡地上顺着等高线盖、正面朝下坡——
 * 不然屋子的一头埋进山里、一头悬着，远看是歪的一块。返回绕竖轴转多少。
 */
export function houseRy(ctx: KitContext, thing: SceneThing, x: number, z: number): number {
  if (thing.facing !== undefined) return facingRy(thing.facing);
  const reach = 20;
  const h = (px: number, pz: number): number => ctx.coords.y(ctx.samplers.height(px, pz));
  const gx = (h(x + reach, z) - h(x - reach, z)) / (2 * reach);
  const gz = (h(x, z + reach) - h(x, z - reach)) / (2 * reach);
  const slope = Math.hypot(gx, gz);
  if (slope < STEEP) return facingRy(undefined);
  // 零件自己的正面是 +z，转 ry 以后朝 (sin ry, cos ry)：让它朝下坡
  return Math.atan2(-gx / slope, -gz / slope);
}

/**
 * 单座的屋。摆在城墙上的是墙顶的棚子，顺着墙摆；摆在地上的是一座茅屋，可以带一圈篱笆。不写 roof 是茅草顶。
 * 这两样是小节里要讲的东西，远了放大好几倍，所以各有自己的样子（parts.ts 的 addShed、addCottage）；瓦顶的还是普通的民房。
 */
function buildHouse(pass: Pass, thing: SceneThing): void {
  if (!thing.at) return;
  const p = thingParams('house', thing.params);
  const B = pass.bucket(thing.when).main;
  const thatch = p.roof !== 'tile';
  const [x, z] = local(pass, thing.at);
  const host = thing.on ? pass.survey.walls.get(thing.on) : undefined;
  if (host) {
    const at = onWallTop(host, x, z);
    B.tagged({ pivot: [at.x, at.y, at.z], cls: 'shed', onWall: true }, () => {
      if (thatch) addShed(B, at.x, at.y, at.z, at.ry, SHED.L, SHED.D, SHED.postH, SHED.roofH);
      else addHouse(B, at.x, at.y, at.z, at.ry, 22, 12, 7, 6, [1, 0.98, 0.92], [1, 1, 1], false);
    });
    return;
  }
  const ry = houseRy(pass.ctx, thing, x, z);
  const y = groundY(pass, x, z) - 1;
  // 城里一户带篱笆的人家：它那一块地民居让开（大街、小巷由地面那一边让开，是同一个数）
  const half = plotHalfM(thing);
  if (half && [...pass.survey.walls.values()].some((w) => insideRing(w.ring, x, z))) pass.yards.push({ cx: x, cz: z, ry, hx: half, hz: half });
  const joined = joinedTo(pass, thing.id);
  const cottage = joined && !joined.main ? COTTAGE_SMALL : COTTAGE;
  const { W, D } = cottage;
  const cos = Math.cos(ry);
  const sin = Math.sin(ry);
  /** 屋子自己的坐标（正面是 +z）里的一点，在沙盘上的哪里、地面多高（埋 1）。 */
  const post = (lx: number, lz: number): Vec3 => {
    const wx = x + lx * cos + lz * sin;
    const wz = z - lx * sin + lz * cos;
    return [wx, groundY(pass, wx, wz) - 1, wz];
  };
  const outer = B.tag;
  const house = standing(pass, thing, [x, y, z], 'hut');
  B.tag = house;
  if (thatch) {
    // 台基往下埋到四个角里最低的地面以下
    let low = y;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) low = Math.min(low, post((sx * (W + 3)) / 2, (sz * (D + 3)) / 2)[1]);
    addCottage(B, x, y, z, ry, { ...cottage, below: y - low + 2 });
  } else {
    addHouse(B, x, y, z, ry, 32, 18, 9, 9, [1, 1, 1], [1, 1, 1], false);
  }
  if (p.fence) {
    // 篱笆：屋子四周一圈编起来的矮篱，隔十来米一根桩，正面留一个口。每根桩落在自己脚下的地面上，山坡上也不会埋进土里。
    // 每根桩、每段篱各是一处细处，跟着屋子一起放大，远了收掉。做成一片一片的（不是几根细杆）：放大以后才看得出是篱笆，不是一圈细线
    // 篱笆只围在屋子四周的平地上：屋子背靠着山，上了坡的那几段不做。篱笆跟着屋子摊开，摊开到头时落在山坡上的也不做——
    // 不然近看它埋进坡里，远看它一级一级爬到半山上，像屋边伸出去的一条胳膊
    const hx = W / 2 + FENCE_OUT;
    const hz = D / 2 + FENCE_OUT;
    const lead: Joined = { cls: house.cls, foot: joined && !joined.main ? joined.foot : [x, y, z], main: true };
    const reach = pass.ctx.style.figure.rules[house.cls].spreadAtMax ?? 1;
    /** 从屋脚下走到这一处，再走到它摊开到头的地方，一路上的地面都是缓的（没有上山、下坎）。 */
    const level = (at: Vec3): boolean => {
      const steps = 5;
      let px = lead.foot[0];
      let pz = lead.foot[2];
      let before = groundY(pass, px, pz);
      for (let i = 0; i <= steps; i++) {
        const k = 1 + ((reach - 1) * i) / steps;
        const qx = lead.foot[0] + (at[0] - lead.foot[0]) * k;
        const qz = lead.foot[2] + (at[2] - lead.foot[2]) * k;
        const h = groundY(pass, qx, qz);
        if (Math.abs(h - before) > STEEP * Math.hypot(qx - px, qz - pz)) return false;
        px = qx;
        pz = qz;
        before = h;
      }
      return true;
    };
    /** 篱笆的一处（一根桩、一段篱）：跟着屋子摊开，高度跟着它脚下的地面走（见 groupPoint），远了不埋进坡里、也不悬在水面上。 */
    const piece = (at: Vec3, fn: () => void): void => B.tagged({ ...house, group: groupPoint(pass, lead, at, 1) }, () => B.detail(at, fn));
    const rail = (ax: number, az: number, bx: number, bz: number): void => {
      const posts = Math.max(1, Math.round(Math.hypot(bx - ax, bz - az) / 11));
      // 这一边能围的那一段：从头一根立得住的桩起，到上坡为止。后面再有一小段平地也不接着围；
      // 一共不到三根桩的也不围，免得山坡边上孤零零剩一截
      const run: Vec3[] = [];
      for (let i = 0; i <= posts; i++) {
        const q = post(lerp(ax, bx, i / posts), lerp(az, bz, i / posts));
        if (level(q)) run.push(q);
        else if (run.length > 0) break;
      }
      if (run.length < 3) return;
      run.forEach((q, i) => {
        piece(q, () => B.add('plainTimber', box(1.7, 7.4, 1.7), T(q[0], q[1], q[2], ry)));
        if (i === 0) return;
        const from = run[i - 1];
        piece([(from[0] + q[0]) / 2, (from[1] + q[1]) / 2, (from[2] + q[2]) / 2], () => B.add('thatch', segBox([from[0], from[1] + 3.4, from[2]], [q[0], q[1] + 3.4, q[2]], 1, 5), null, [0.8, 0.7, 0.58]));
      });
    };
    rail(-hx, -hz, hx, -hz);
    rail(-hx, -hz, -hx, hz);
    rail(hx, -hz, hx, hz);
    rail(-hx, hz, -9, hz);
    rail(9, hz, hx, hz);
  }
  B.tag = outer;
}

// ---------------------------------------------------------------- 堤、土坡、木岸

/**
 * 堤。不写 on 是一道独立的土堤：梯形的截面，顶到 topM。
 * 写了 on（一道城墙）是贴在城墙里侧的土坡：线只说贴着哪几面墙，离墙多远由这里按城墙模型的厚薄定。
 */
function buildDike(pass: Pass, thing: SceneThing): void {
  const p = thingParams('dike', thing.params);
  const { coords, samplers } = pass.ctx;
  const B = pass.bucket(thing.when).main;
  const line = linePoints(pass, thing);
  if (line.length < 2) return;
  const host = thing.on ? pass.survey.walls.get(thing.on) : undefined;
  if (host) {
    const g = host.groundY;
    const top = p.topM === undefined ? g + 15 : Math.max(g + 4, coords.y(p.topM));
    const inner: Vec2[] = [
      [15, g - 2],
      [6, top],
      [-6, top],
      [-15, g - 2],
    ];
    const shade = (y: number): number => lerp(0.86, 1.0, smoothstep(g, top, y));
    const path = snapLineToRing(host.ring, line).map((pos) => offsetPoint(host.ring, pos, -(WALL_BASE_HALF + 15)));
    eachSegment(path, (_a, _b, mid, len, ry) => B.add('earth', prism(inner, len + 12, { shade, topShade: 1.1 }), T(mid[0], 0, mid[1], ry)));
    return;
  }
  const heights = line.map(([x, z]) => samplers.height(x, z));
  const top = coords.y(p.topM ?? Math.max(...heights) + 4);
  const base = coords.y(Math.min(...heights)) - 14;
  const sec: Vec2[] = [
    [34, base],
    [8, top],
    [-8, top],
    [-34, base],
  ];
  const shade = (y: number): number => lerp(0.82, 1.02, smoothstep(base + 4, top, y));
  eachSegment(line, (_a, _b, mid, len, ry) => B.add('earth', prism(sec, len + 26, { shade, topShade: 1.12, uvScale: 30 }), T(mid[0], 0, mid[1], ry)));
}

/** 圈上相邻的两个位置之间是哪一面墙。 */
function sideBetween(ring: Ring, a: RingPos, b: RingPos): number {
  if (a.corner === null) return a.side;
  if (b.corner === null) return b.side;
  const n = ring.sides.length;
  if (b.corner === (a.corner + 1) % n) return a.corner;
  if (a.corner === (b.corner + 1) % n) return b.corner;
  return a.corner;
}

/**
 * 墙脚到水边的土坡。贴在城墙外侧（写了 on）：墙脚下一条平台，再斜着下到水里；线只说贴着哪几面墙。
 * 不写 on 是顺着线的一道矮土埂。
 */
function buildBank(pass: Pass, thing: SceneThing): void {
  const { coords, scene, samplers } = pass.ctx;
  const B = pass.bucket(thing.when).main;
  const line = linePoints(pass, thing);
  if (line.length < 2) return;
  const host = thing.on ? pass.survey.walls.get(thing.on) : undefined;
  if (!host) {
    const heights = line.map(([x, z]) => samplers.height(x, z));
    const base = coords.y(Math.min(...heights)) - 8;
    const top = coords.y(Math.max(...heights)) + 6;
    const sec: Vec2[] = [
      [22, base],
      [6, top],
      [-6, top],
      [-22, base],
    ];
    const shade = (y: number): number => lerp(0.82, 1.02, smoothstep(base + 2, top, y));
    eachSegment(line, (_a, _b, mid, len, ry) => B.add('earth', prism(sec, len + 12, { shade, topShade: 1.1, uvScale: 30 }), T(mid[0], 0, mid[1], ry)));
    return;
  }
  const ring = host.ring;
  const yT = host.groundY + 1.6;
  const normal = scene.water.levels.values.normal ?? pass.ctx.ground.baseM;
  const yB = coords.y(normal - scene.water.banks.bedM - 0.2);
  // 平台从墙身里面（墙的中线往里 10 米）铺到墙外 82 米，再斜到 106 米
  const o1 = BANK_FLAT_M;
  const o2 = BANK_FOOT_M;
  const path = snapLineToRing(ring, line);
  if (path.length < 2) return;
  const last = path.length - 1;
  /** 这条线往外挪 d 米。中间的墙角绕着角走；两头落在墙角上时齐着墙角收住，不绕到另一面墙去。 */
  const offset = (d: number): Vec2[] =>
    path.map((pos, k) => {
      if (pos.corner === null || (k > 0 && k < last)) return offsetPoint(ring, pos, d);
      const out = ring.sides[sideBetween(ring, pos, path[k === 0 ? 1 : last - 1])].out;
      const v = ring.pts[pos.corner];
      return [v[0] + out[0] * d, v[1] + out[1] * d];
    });
  const ins = offset(-10);
  const tops = offset(o1);
  const feet = offset(o2);
  const P = (q: Vec2, y: number): Vec3 => [q[0], y, q[1]];
  const U = 48;
  const nl = Math.hypot(yT - yB, o2 - o1);
  const fb = new FB();
  let acc = 0;
  for (let k = 0; k < path.length - 1; k++) {
    const out = ring.sides[sideBetween(ring, path[k], path[k + 1])].out;
    const len = Math.hypot(tops[k + 1][0] - tops[k][0], tops[k + 1][1] - tops[k][1]);
    // 顶面：贴图按 x、z 铺
    const flat = [ins[k], ins[k + 1], tops[k + 1], tops[k]];
    fb.quad(P(flat[0], yT), P(flat[1], yT), P(flat[2], yT), P(flat[3], yT), [0, 1, 0], flat.map((q): Vec2 => [q[0] / U, q[1] / U]), [1, 1, 1, 1]);
    // 斜面：越靠水越深；贴图顺着岸铺
    fb.quad(
      P(tops[k], yT),
      P(tops[k + 1], yT),
      P(feet[k + 1], yB),
      P(feet[k], yB),
      [(out[0] * (yT - yB)) / nl, (o2 - o1) / nl, (out[1] * (yT - yB)) / nl],
      [
        [acc / U, nl / U],
        [(acc + len) / U, nl / U],
        [(acc + len) / U, 0],
        [acc / U, 0],
      ],
      [0.92, 0.92, 0.72, 0.72],
    );
    acc += len;
  }
  // 两头各封一个口
  const ends: Vec2[] = [
    [0, 1],
    [last, last - 1],
  ];
  for (const [e, f] of ends) {
    const dx = tops[e][0] - tops[f][0];
    const dz = tops[e][1] - tops[f][1];
    const l = Math.hypot(dx, dz) || 1;
    fb.quad(P(tops[e], yT), P(feet[e], yB), P(ins[e], yB), P(ins[e], yT), [dx / l, 0, dz / l], null, [0.92, 0.72, 0.72, 0.92]);
  }
  // 墙脚的土坡是旧土，不是新筑的堤：颜色在平地和夯土城墙之间
  B.add('bank', fb.geo());
}

/**
 * 贴在城墙外侧的土坡（kind 是 bank，写了 on）盖在这一点上有多高（沙盘里的高度）；这一点不在哪一道土坡上是 null。
 * 木桩护岸这样摆在坡上的小东西靠它知道脚下是什么。墙角那里按“离墙角多远”算，和模型差一点，够用。
 */
export function bankSurfaceY(pass: Pass, x: number, z: number): number | null {
  const { coords, scene } = pass.ctx;
  let best: number | null = null;
  for (const thing of scene.things) {
    if (thing.kind !== 'bank' || !thing.on || !thing.line || thing.line.length < 2) continue;
    const host = pass.survey.walls.get(thing.on);
    if (!host) continue;
    const ring = host.ring;
    const d = ringDistance(ring, x, z);
    if (d < -10 || d > BANK_FOOT_M) continue;
    // 这道土坡贴着哪几面墙
    const path = snapLineToRing(ring, linePoints(pass, thing));
    const covered = new Set<number>();
    for (let k = 0; k < path.length - 1; k++) covered.add(sideBetween(ring, path[k], path[k + 1]));
    const pos = nearestOnRing(ring, x, z);
    if (!covered.has(pos.side)) continue;
    // 越过这一面墙的一头：那一头接着的那面墙也有土坡才算（土坡绕过墙角）；没有就是出了土坡的尽头
    const s = ring.sides[pos.side];
    const u = (x - s.mid[0]) * s.ax[0] + (z - s.mid[1]) * s.ax[1];
    if (Math.abs(u) > s.len / 2) {
      const n = ring.sides.length;
      const next = Math.abs(u - s.ua) < Math.abs(u - s.ub) ? (pos.side - 1 + n) % n : (pos.side + 1) % n;
      if (!covered.has(next)) continue;
    }
    const yT = host.groundY + 1.6;
    const normal = scene.water.levels.values.normal ?? pass.ctx.ground.baseM;
    const yB = coords.y(normal - scene.water.banks.bedM - 0.2);
    const y = d <= BANK_FLAT_M ? yT : lerp(yT, yB, (d - BANK_FLAT_M) / (BANK_FOOT_M - BANK_FLAT_M));
    if (best === null || y > best) best = y;
  }
  return best;
}

/**
 * 这一点离贴着城墙的土坡的坡脚还有多远（米；在坡脚外面是正数，在土坡上是负数）；不挨着哪一道土坡是无穷大。
 * 墙角那里照模型算：模型的土坡在墙角是方的（两面的坡各自直着伸出去，接成一个尖角），不是绕着墙角的圆弧。
 * 往水里摆船的时候用：地面的水边在墙角是圆的，方角多伸出去的那一块底下也是水，光看水边会把船摆进土坡里。
 */
export function bankFootGap(pass: Pass, x: number, z: number): number {
  let best = Infinity;
  for (const thing of pass.ctx.scene.things) {
    if (thing.kind !== 'bank' || !thing.on || !thing.line || thing.line.length < 2) continue;
    const host = pass.survey.walls.get(thing.on);
    if (!host) continue;
    const ring = host.ring;
    const path = snapLineToRing(ring, linePoints(pass, thing));
    const covered = new Set<number>();
    for (let k = 0; k < path.length - 1; k++) covered.add(sideBetween(ring, path[k], path[k + 1]));
    // 在哪几面墙的外面：都有土坡才算挨着这道土坡（土坡到了头是齐着墙角收住的）；离得最远的那一面说了算（方角）
    let out = -Infinity;
    let beside = true;
    ring.sides.forEach((s, i) => {
      const d = (x - s.mid[0]) * s.out[0] + (z - s.mid[1]) * s.out[1];
      if (d <= 0) return;
      if (covered.has(i)) out = Math.max(out, d);
      else beside = false;
    });
    if (beside && out > -Infinity) best = Math.min(best, out - BANK_FOOT_M);
  }
  return best;
}

/** 木桩护岸的桩：露出脚下七米，下面打进去四米；两道横木各比脚下高这么多。 */
export const PILE_ABOVE = 7;
const PILE_BELOW = 4;
const PILE_RAILS = [1.5, 5];

/**
 * 木桩护岸：顺着线一排木桩，两道横木，一根桩一根桩地接过去。小东西，都算细处：远了收掉。
 * 每根桩落在自己脚下：地面、盖在地面上的土坡、平时的水面，三样里最高的那个（桩不会埋进土坡里，也不会整根没在水里）。
 */
function buildTimberBank(pass: Pass, thing: SceneThing): void {
  const { coords, scene } = pass.ctx;
  const B = pass.bucket(thing.when).main;
  const line = linePoints(pass, thing);
  const waterY = coords.y(scene.water.levels.values.normal ?? pass.ctx.ground.baseM);
  const footY = (x: number, z: number): number => Math.max(groundY(pass, x, z), bankSurfaceY(pass, x, z) ?? -Infinity, waterY);
  eachSegment(line, (a, b, _mid, len) => {
    const n = Math.max(1, Math.round(len / 7));
    let prev: Vec3 | null = null;
    for (let i = 0; i <= n; i++) {
      const x = lerp(a[0], b[0], i / n);
      const z = lerp(a[1], b[1], i / n);
      const y = footY(x, z);
      B.addDetail('plainTimber', cyl(1.3, PILE_ABOVE + PILE_BELOW, 6), T(x, y - PILE_BELOW, z), [0.9, 0.9, 0.9]);
      if (prev) {
        const from = prev;
        B.detail([(from[0] + x) / 2, (from[1] + y) / 2, (from[2] + z) / 2], () => {
          for (const up of PILE_RAILS) B.add('plainTimber', segBox([from[0], from[1] + up, from[2]], [x, y + up, z], 1.1, 1.1));
        });
      }
      prev = [x, y, z];
    }
  });
}

/** 九种摆件，一种一个造法。按家分块的那几种（崖壁……）不在这里：它们的造法跟着那一家的程序来（见 families.ts）。 */
export const THING_BUILDERS: Record<Exclude<ThingKind, FamilyThingKind>, ThingBuilder> = {
  wall: buildWall,
  gate: buildGate,
  tower: buildTower,
  pavilion: buildPavilion,
  'hall-group': buildHallGroup,
  house: buildHouse,
  dike: buildDike,
  bank: buildBank,
  'timber-bank': buildTimberBank,
};
