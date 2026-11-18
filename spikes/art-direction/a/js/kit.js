// 小模型的零件：盒子、屋顶、城门洞、船。全部是代码拼出来的几何体。
import * as THREE from 'three';

/** 底面中心在 (x, y, z) 的盒子。 */
export function box(w, h, d, x = 0, y = 0, z = 0, ry = 0) {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(0, h / 2, 0);
  if (ry) g.rotateY(ry);
  g.translate(x, y, z);
  return g;
}

/** 上窄下宽的长条（城墙、堤的断面）：沿 x 方向长 len，底宽 wb，顶宽 wt，高 h，底面在 y = 0。 */
export function taperBox(len, h, wb, wt) {
  const L = len / 2;
  const b = wb / 2;
  const t = wt / 2;
  const P = {
    a: [-L, 0, -b], b: [L, 0, -b], c: [L, 0, b], d: [-L, 0, b],
    e: [-L, h, -t], f: [L, h, -t], g: [L, h, t], h: [-L, h, t],
  };
  const quads = [
    ['e', 'h', 'g', 'f'], // 顶
    ['d', 'c', 'g', 'h'], // +z
    ['b', 'a', 'e', 'f'], // -z
    ['c', 'b', 'f', 'g'], // +x
    ['a', 'd', 'h', 'e'], // -x
  ];
  return fromQuads(quads.map((q) => q.map((k) => P[k])));
}

/** 一组四边形（每个四个点，逆时针朝外）→ 不带索引的几何体，平面法线。 */
export function fromQuads(quads) {
  const pos = [];
  for (const q of quads) {
    const [a, b, c, d] = q;
    pos.push(...a, ...b, ...c, ...a, ...c, ...d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

export function fromTris(tris) {
  const pos = [];
  for (const t of tris) pos.push(...t[0], ...t[1], ...t[2]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

export const TILE = 26; // 屋顶贴图一格的大小（一格里八道瓦垄）

/** 两面坡的屋顶（民居）：屋脊沿 x。w、d 是墙身的长和进深，o 是出檐，h 是脊高。檐口在 y = 0。 */
export function gableRoof(w, d, h, o = 2.5) {
  const L = w / 2 + o;
  const Z = d / 2 + o;
  const e = -h * 0.16; // 檐口比墙顶低一点
  const A = [-L, e, Z];
  const B = [L, e, Z];
  const C = [L, e, -Z];
  const Dd = [-L, e, -Z];
  const R0 = [-L, h, 0];
  const R1 = [L, h, 0];
  const g1 = fromQuads([
    [A, B, R1, R0],
    [C, Dd, R0, R1],
  ]);
  const g2 = fromTris([
    [B, C, R1],
    [Dd, A, R0],
  ]);
  return [g1, g2];
}

/**
 * 四面坡的屋顶，带一点凹曲和翘角（城楼、亭子、大殿）。
 * w、d：檐口的长和进深；h：高；ridge：正脊的长度（0 就是攒尖）；
 * tMax < 1 时只做下面一圈（腰檐）。檐口在 y = 0。
 */
export function hipRoof({ w, d, h, ridge = Math.max(0, w - d), curve = 1.55, lift = h * 0.22, nT = 5, nS = 6, tMax = 1, drop = 2.2 }) {
  const Y = (t, s) => h * Math.pow(t, curve) + lift * (1 - t) * (1 - t) * Math.abs(s) ** 3;
  const hx = (t) => w / 2 + (ridge / 2 - w / 2) * t;
  const hz = (t) => (d / 2) * (1 - t);
  const parts = [];
  for (let side = 0; side < 4; side++) {
    const pos = [];
    const uvs = [];
    const idx = [];
    const pt = (t, s) => {
      if (side === 0) return [s * hx(t), Y(t, s), hz(t)];
      if (side === 1) return [hx(t), Y(t, s), -s * hz(t)];
      if (side === 2) return [-s * hx(t), Y(t, s), -hz(t)];
      return [-hx(t), Y(t, s), s * hz(t)];
    };
    for (let it = 0; it <= nT; it++)
      for (let is = 0; is <= nS; is++) {
        const s = -1 + (2 * is) / nS;
        const q = pt((it / nT) * tMax, s);
        pos.push(...q);
        // 瓦垄顺着坡往上，一道一道是平行的（照实际的位置给，不跟着屋面收窄）
        uvs.push((side % 2 === 0 ? q[0] : q[2]) / TILE, (it / nT) * 2);
      }
    const row = nS + 1;
    for (let it = 0; it < nT; it++)
      for (let is = 0; is < nS; is++) {
        const a = it * row + is;
        const b = a + 1;
        const c = a + row + 1;
        const dd = a + row;
        idx.push(a, b, c, a, c, dd);
      }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    // 朝上
    const n = g.attributes.normal;
    let sy = 0;
    for (let i = 0; i < n.count; i++) sy += n.getY(i);
    if (sy < 0) {
      const id = g.index.array;
      for (let i = 0; i < id.length; i += 3) {
        const tmp = id[i + 1];
        id[i + 1] = id[i + 2];
        id[i + 2] = tmp;
      }
      g.computeVertexNormals();
    }
    const flat = g.toNonIndexed();
    flat.userData.ownUV = true;
    parts.push(flat);
    // 檐口的一道边（让屋顶有厚度）
    const quads = [];
    for (let is = 0; is < nS; is++) {
      const p0 = pt(0, -1 + (2 * is) / nS);
      const p1 = pt(0, -1 + (2 * (is + 1)) / nS);
      quads.push([[p0[0], p0[1] - drop, p0[2]], [p1[0], p1[1] - drop, p1[2]], p1, p0]);
    }
    const fg = fromQuads(quads);
    // 朝外
    const fn = fg.attributes.normal;
    const out = [[0, 0, 1], [1, 0, 0], [0, 0, -1], [-1, 0, 0]][side];
    if (fn.getX(0) * out[0] + fn.getZ(0) * out[2] < 0) {
      const p = fg.attributes.position.array;
      for (let i = 0; i < p.length; i += 9) {
        for (let k = 0; k < 3; k++) {
          const tmp = p[i + 3 + k];
          p[i + 3 + k] = p[i + 6 + k];
          p[i + 6 + k] = tmp;
        }
      }
      fg.computeVertexNormals();
    }
    parts.push(fg);
  }
  return parts;
}

/** 城门的墩台：正面是一块带拱门洞的墙，整个打通。宽 w（沿 x），高 h，厚 depth（沿 z）。底面在 y = 0。 */
export function gateBlock(w, h, depth, archW, archH) {
  const s = new THREE.Shape();
  s.moveTo(-w / 2, 0);
  s.lineTo(-archW / 2, 0);
  const r = archW / 2;
  s.lineTo(-archW / 2, archH - r);
  s.absarc(0, archH - r, r, Math.PI, 0, true);
  s.lineTo(archW / 2, 0);
  s.lineTo(w / 2, 0);
  s.lineTo(w / 2, h);
  s.lineTo(-w / 2, h);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false, curveSegments: 10 });
  g.translate(0, 0, -depth / 2);
  return g;
}

/** 船身：两头尖的平底船。长 L（沿 x，船头朝 +x），宽 B，高 H。 */
export function hull(L, B, H) {
  const s = new THREE.Shape();
  s.moveTo(L / 2, 0);
  s.quadraticCurveTo(L * 0.3, B * 0.52, L * 0.05, B / 2);
  s.lineTo(-L * 0.32, B * 0.46);
  s.lineTo(-L / 2, B * 0.26);
  s.lineTo(-L / 2, -B * 0.26);
  s.lineTo(-L * 0.32, -B * 0.46);
  s.lineTo(L * 0.05, -B / 2);
  s.quadraticCurveTo(L * 0.3, -B * 0.52, L / 2, 0);
  const g = new THREE.ExtrudeGeometry(s, { depth: H, bevelEnabled: false, curveSegments: 5 });
  g.rotateX(-Math.PI / 2); // 竖起来：厚度沿 +y
  return g;
}

/** 船篷：半圆的拱，沿 x 长 len，半径 r。底在 y = 0。 */
export function awning(len, r, seg = 7) {
  const quads = [];
  const tris = [];
  for (let i = 0; i < seg; i++) {
    const a0 = (Math.PI * i) / seg;
    const a1 = (Math.PI * (i + 1)) / seg;
    const p = (x, a) => [x, Math.sin(a) * r * 0.85, Math.cos(a) * r];
    quads.push([p(-len / 2, a0), p(len / 2, a0), p(len / 2, a1), p(-len / 2, a1)]);
    tris.push([[len / 2, 0, 0], p(len / 2, a1), p(len / 2, a0)]);
    tris.push([[-len / 2, 0, 0], p(-len / 2, a0), p(-len / 2, a1)]);
  }
  const g = fromQuads(quads);
  // 篷上一道一道的箍（贴图坐标沿着船长走）
  {
    const p = g.attributes.position;
    const uv = new Float32Array(p.count * 2);
    for (let i = 0; i < p.count; i++) {
      uv[i * 2] = p.getX(i) / 9 + 0.3;
      uv[i * 2 + 1] = 0.5;
    }
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  }
  // 让拱面的法线顺滑
  const pos = g.attributes.position;
  const nor = g.attributes.normal;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i) / 0.85;
    const z = pos.getZ(i);
    const l = Math.hypot(y, z) || 1;
    nor.setXYZ(i, 0, y / l, z / l);
  }
  return [g, fromTris(tris)];
}

/**
 * 把很多零件并成每种材料一张网格。
 * add(key, geometry, matrix?)：key 是材料名。
 */
export class Builder {
  constructor() {
    this.buf = new Map();
    this._v = new THREE.Vector3();
    this._n = new THREE.Matrix3();
  }
  add(key, geo, m) {
    const list = Array.isArray(geo) ? geo : [geo];
    for (const g0 of list) {
      const g = g0.index ? g0.toNonIndexed() : g0;
      if (!g.attributes.normal) g.computeVertexNormals();
      let b = this.buf.get(key);
      if (!b) {
        b = { pos: [], nor: [], uv: [] };
        this.buf.set(key, b);
      }
      const p = g.attributes.position;
      const n = g.attributes.normal;
      const u = g.attributes.uv && g.userData.keepUV !== false && g0.userData.ownUV ? g.attributes.uv : null;
      if (m) this._n.getNormalMatrix(m);
      for (let i = 0; i < p.count; i++) {
        this._v.fromBufferAttribute(p, i);
        if (m) this._v.applyMatrix4(m);
        b.pos.push(this._v.x, this._v.y, this._v.z);
        this._v.fromBufferAttribute(n, i);
        if (m) this._v.applyMatrix3(this._n).normalize();
        b.nor.push(this._v.x, this._v.y, this._v.z);
        if (u) b.uv.push(u.getX(i), u.getY(i));
        else b.uv.push(NaN, NaN);
      }
    }
    return this;
  }
  /** materials：{ key: Material }；uvScale：木纹一格有多大（模型单位）。 */
  build(materials, uvScales = 260) {
    const group = new THREE.Group();
    let tris = 0;
    for (const [key, b] of this.buf) {
      const uvScale = typeof uvScales === 'number' ? uvScales : uvScales[key] || uvScales.default || 260;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(b.nor, 3));
      const uv = new Float32Array((b.pos.length / 3) * 2);
      for (let i = 0; i < b.pos.length / 3; i++) {
        if (!Number.isNaN(b.uv[i * 2])) {
          uv[i * 2] = b.uv[i * 2];
          uv[i * 2 + 1] = b.uv[i * 2 + 1];
          continue;
        }
        const x = b.pos[i * 3];
        const y = b.pos[i * 3 + 1];
        const z = b.pos[i * 3 + 2];
        const nx = Math.abs(b.nor[i * 3]);
        const ny = Math.abs(b.nor[i * 3 + 1]);
        const nz = Math.abs(b.nor[i * 3 + 2]);
        if (ny > 0.6) {
          uv[i * 2] = x / uvScale;
          uv[i * 2 + 1] = z / uvScale;
        } else if (nx > nz) {
          uv[i * 2] = z / uvScale;
          uv[i * 2 + 1] = y / uvScale;
        } else {
          uv[i * 2] = x / uvScale;
          uv[i * 2 + 1] = y / uvScale;
        }
      }
      g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      const mesh = new THREE.Mesh(g, materials[key]);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
      tris += b.pos.length / 9;
    }
    group.userData.tris = tris;
    return group;
  }
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
/** 位置 + 绕 y 的转角 + 缩放 → 矩阵（每次返回新的）。 */
export function place(x, y, z, ry = 0, sx = 1, sy = sx, sz = sx) {
  _q.setFromAxisAngle(_up, ry);
  _p.set(x, y, z);
  _s.set(sx, sy, sz);
  return _m.clone().compose(_p, _q, _s);
}
