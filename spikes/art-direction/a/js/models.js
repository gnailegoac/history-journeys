// 沙盘上摆的东西：城墙和城门、城里的屋子、戏马台（土山、台、殿）、黄楼、放鹤亭、堤、船、百步洪的石头、
// 村子、树、田、路、大水、地名的针和牌子。
// 位置里凡是“示意”的都在 shared/scene-data.js 里注明了；这里加的细节（屋子怎么排、村子在哪）都是为了有尺度感，不是考证。
//
// 全景里小模型要放大（真的沙盘也这么做）：setState 的 big 从 0（原样）到 1（最大）。
//   城墙、城楼、城里的屋子只拉高；村子、船、树、戏马台上的殿整个放大。

import * as THREE from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';
import * as K from './kit.js';
import { mulberry32, riverSamples } from './terrain.js';
import * as TX from './textures.js';

const WALL = { h: 62, wb: 40, wt: 30 };
const GATE = { w: 184, h: 68, depth: 62, archW: 28, archH: 42 };

const GROW = {
  cityY: (b) => 1 + 1.15 * b,
  houseY: (b) => 1 + 0.6 * b,
  hamlet: (b) => 1 + 1.5 * b,
  xi: (b) => 1 + 0.9 * b,
  boat: (b) => 1 + 1.7 * b,
  boatFlood: (b) => 1 + 0.55 * b,
  rock: (b) => 1 + 0.9 * b,
  tree: (b) => 1 + 0.8 * b,
};

/** 一组“同一个零件摆很多份”的网格。每一份有自己的位置矩阵和一个锚点，放大的时候绕着锚点放。 */
function instSet(scene, parts, items) {
  const group = new THREE.Group();
  const meshes = [];
  for (const p of parts) {
    const list = p.only ? items.filter(p.only) : items;
    if (!list.length) continue;
    const mesh = new THREE.InstancedMesh(p.geo, p.mat, list.length);
    mesh.castShadow = p.cast !== false;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    mesh.userData.list = list;
    mesh.userData.key = p.key || 'm';
    meshes.push(mesh);
    group.add(mesh);
  }
  const S = new THREE.Matrix4();
  const A = new THREE.Matrix4();
  const B = new THREE.Matrix4();
  const M = new THREE.Matrix4();
  let last = null;
  group.userData.apply = (fn, key) => {
    if (key === last) return;
    last = key;
    for (const mesh of meshes) {
      mesh.userData.list.forEach((it, i) => {
        const r = fn(it);
        const k = r[0];
        S.makeScale(k, k * (r[1] || 1), k);
        A.makeTranslation(it.ax, it.ay + (r[2] || 0), it.az);
        B.makeTranslation(-it.ax, -it.ay, -it.az);
        M.copy(A).multiply(S).multiply(B).multiply(it[mesh.userData.key]);
        mesh.setMatrixAt(i, M);
      });
      mesh.instanceMatrix.needsUpdate = true;
    }
  };
  group.userData.tris = meshes.reduce((s, m) => s + ((m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count) / 3) * m.count, 0);
  scene.add(group);
  return group;
}

export function buildModels({ scene, host, terrain, GEO, COLORS, T, EXTRA, grain, renderer, waterEnv, terrainMats, buildLayerGeometry }) {
  const rnd = mulberry32(20771079);
  const R = (a, b) => a + (b - a) * rnd();
  const PY = T.plainY;
  const C = GEO.city;

  // ---------- 材料 ----------
  const fine = grain.clone();
  fine.needsUpdate = true;
  const paving = TX.brickTexture(17);
  paving.repeat.set(1, 1);
  const mats = {
    wood: new THREE.MeshStandardMaterial({ color: COLORS.wood, roughness: 0.86, map: fine }),
    wall: new THREE.MeshStandardMaterial({ color: COLORS.wallWood, roughness: 0.9, map: TX.brickTexture() }),
    roof: new THREE.MeshStandardMaterial({ color: COLORS.roof, roughness: 0.8, map: TX.tileTexture() }),
    // 黄楼：全场只有它上颜色。墙是黄土，屋顶是梨木本色，柱子和栏杆深一档。
    roofHL: new THREE.MeshStandardMaterial({ color: COLORS.roofHL, roughness: 0.78, map: TX.tileTexture() }),
    post: new THREE.MeshStandardMaterial({ color: COLORS.post, roughness: 0.82 }),
    // 屋檐底下照不到主灯，给一点自发光，让黄土在檐影里还是黄的
    ochre: new THREE.MeshStandardMaterial({ color: COLORS.ochre, roughness: 0.92, map: fine, emissive: COLORS.ochre, emissiveIntensity: 0.08 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x4a3c30, roughness: 0.95 }),
    tree: new THREE.MeshStandardMaterial({ color: COLORS.tree, roughness: 0.9 }),
    rock: new THREE.MeshStandardMaterial({ color: COLORS.rock, roughness: 0.95, flatShading: true }),
    field: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, map: TX.hatchTexture() }),
    dike: new THREE.MeshStandardMaterial({ color: COLORS.dike, roughness: 0.95, map: fine }),
    dikeLine: new THREE.MeshStandardMaterial({ color: COLORS.dikeLine, roughness: 0.95 }),
    quay: new THREE.MeshStandardMaterial({ color: COLORS.quay, roughness: 0.9, map: paving }),
  };

  mats.wall.map.repeat.set(5, 5);
  const groups = {};
  const addGroup = (name, builder, uv = { default: 240, roof: K.TILE, roofHL: K.TILE, quay: 90 }) => {
    const g = builder.build(mats, uv);
    g.name = name;
    groups[name] = g;
    scene.add(g);
    return g;
  };

  // ---------- 城墙 ----------
  const city = new K.Builder(); // 城墙、城门、城楼：全景里拉高
  const houses = new K.Builder(); // 城里和南门外的屋子：也拉高，少一些
  const fixed = new K.Builder(); // 码头的台阶、岸边铺的一条石板：不跟着拉高
  const before = new K.Builder(); // 水来之前：东门上是普通的城楼
  const after = new K.Builder(); // 水退以后：黄楼
  const afterFixed = new K.Builder(); // 水退以后：放鹤亭、木岸
  {
    const lenX = C.x1 - C.x0;
    const lenZ = C.z1 - C.z0;
    const cxm = (C.x0 + C.x1) / 2;
    const czm = (C.z0 + C.z1) / 2;
    // 四面墙身
    const sides = [
      { x: cxm, z: C.z0, ry: 0, len: lenX, out: [0, -1] }, // 北
      { x: cxm, z: C.z1, ry: 0, len: lenX, out: [0, 1] }, // 南
      { x: C.x0, z: czm, ry: Math.PI / 2, len: lenZ, out: [-1, 0] }, // 西
      { x: C.x1, z: czm, ry: Math.PI / 2, len: lenZ, out: [1, 0] }, // 东
    ];
    for (const s of sides) {
      city.add('wall', K.taperBox(s.len, WALL.h, WALL.wb, WALL.wt), K.place(s.x, PY, s.z, s.ry));
      // 垛口：外沿一道矮墙，上面一个一个的垛子
      const ox = s.out[0] * (WALL.wt / 2 - 2.2);
      const oz = s.out[1] * (WALL.wt / 2 - 2.2);
      city.add('wall', K.box(s.len - 40, 4.5, 4.4), K.place(s.x + ox, PY + WALL.h, s.z + oz, s.ry));
      const n = Math.floor((s.len - 60) / 15);
      for (let i = 0; i < n; i++) {
        const t = -((n - 1) / 2) * 15 + i * 15;
        const px = s.x + ox + (s.ry ? 0 : t);
        const pz = s.z + oz + (s.ry ? t : 0);
        if (Math.abs(t) < GATE.w / 2 + 2) continue;
        city.add('wall', K.box(8.5, 6.5, 4.4), K.place(px, PY + WALL.h + 4.5, pz, s.ry));
      }
      // 里沿的矮墙
      city.add('wall', K.box(s.len - 40, 3.2, 3), K.place(s.x - s.out[0] * (WALL.wt / 2 - 1.5), PY + WALL.h, s.z - s.out[1] * (WALL.wt / 2 - 1.5), s.ry));
    }

    // 四座城门：墩台 + 城楼
    const gates = [
      { id: 'n', x: cxm, z: C.z0, ry: 0, out: [0, -1] },
      { id: 's', x: cxm, z: C.z1, ry: 0, out: [0, 1] },
      { id: 'w', x: C.x0, z: czm, ry: Math.PI / 2, out: [-1, 0] },
      { id: 'e', x: C.x1, z: czm, ry: Math.PI / 2, out: [1, 0] },
    ];
    for (const g of gates) {
      const m = K.place(g.x, PY, g.z, g.ry);
      city.add('wall', K.gateBlock(GATE.w, GATE.h, GATE.depth, GATE.archW, GATE.archH), m);
      // 墩台顶上的垛口
      for (const sgn of [-1, 1]) {
        const zz = sgn * (GATE.depth / 2 - 2.4);
        city.add('wall', K.box(GATE.w, 4.5, 4.4, 0, GATE.h, zz), m);
        for (let i = 0; i < 12; i++) city.add('wall', K.box(8.5, 6.5, 4.4, -GATE.w / 2 + 8 + (i * (GATE.w - 16)) / 11, GATE.h + 4.5, zz), m);
      }
      // 门洞上的一道石匾线
      for (const sgn of [-1, 1]) city.add('roof', K.box(GATE.archW + 16, 2.2, 1.2, 0, GATE.archH + 6, sgn * (GATE.depth / 2 + 0.2)), m);
      // 门洞里的两扇门：半开，免得一眼看穿
      for (const sgn of [-1, 1]) city.add('dark', K.box(1.6, GATE.archH - 9, GATE.archW / 2 - 3, sgn * (GATE.archW / 2 - 1.2), 0, -3), m);
      const top = K.place(g.x, PY + GATE.h, g.z, g.ry);
      if (g.id === 'e') {
        gateTower(before, top, 'wood');
        huanglou(after, top);
      } else gateTower(city, top, 'wood');
    }

    // 四个角台和角楼
    for (const [x, z, sx, sz] of [
      [C.x0, C.z0, -1, -1],
      [C.x1, C.z0, 1, -1],
      [C.x0, C.z1, -1, 1],
      [C.x1, C.z1, 1, 1],
    ]) {
      const bx = x + sx * 5;
      const bz = z + sz * 5;
      city.add('wall', K.taperBox(60, WALL.h + 7, 60, 54), K.place(bx, PY, bz));
      const ty = PY + WALL.h + 7;
      for (const [ax, az] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const along = ax !== 0;
        city.add('wall', K.box(along ? 4 : 54, 4.5, along ? 54 : 4, bx + ax * 25, ty, bz + az * 25));
        for (let i = 0; i < 4; i++) {
          const t = -19.5 + i * 13;
          city.add('wall', K.box(along ? 4 : 7.5, 6, along ? 7.5 : 4, bx + ax * 25 + (along ? 0 : t), ty + 4.5, bz + az * 25 + (along ? t : 0)));
        }
      }
      city.add('wood', K.box(34, 3, 34, bx, ty, bz));
      city.add('wood', K.box(20, 13, 20, bx, ty + 3, bz));
      for (const [px, pz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) city.add('roof', K.box(2.2, 13, 2.2, bx + px * 13.5, ty + 3, bz + pz * 13.5));
      city.add('roof', K.hipRoof({ w: 40, d: 40, h: 15, ridge: 0, lift: 4.5 }), K.place(bx, ty + 16, bz));
      city.add('roof', K.box(3, 5, 3, bx, ty + 30, bz));
    }
  }

  function gateTower(b, m, wallMat) {
    b.add('wood', K.box(120, 4, 44, 0, 0, 0), m);
    b.add(wallMat, K.box(84, 19, 24, 0, 4, 0), m);
    for (const sgn of [-1, 1]) for (let i = 0; i < 8; i++) b.add('roof', K.box(2.4, 19, 2.4, -49 + i * 14, 4, sgn * 17), m);
    for (const sgn of [-1, 1]) for (const x of [-14, 0, 14]) b.add('dark', K.box(9, 13, 1, x, 4, sgn * 12.2), m);
    b.add('roof', K.box(104, 1.6, 38, 0, 22.2, 0), m);
    b.add('roof', K.hipRoof({ w: 126, d: 60, h: 19, ridge: 70, lift: 5.5 }), m.clone().multiply(new THREE.Matrix4().makeTranslation(0, 24, 0)));
    b.add('roof', K.box(74, 3, 3.4, 0, 42, 0), m);
    for (const sgn of [-1, 1]) b.add('roof', K.box(4, 6.5, 4, sgn * 36, 42, 0), m);
  }

  // 黄楼：东门上的两层大楼，墙刷了黄土
  function huanglou(b, m) {
    b.add('wood', K.box(132, 5, 52, 0, 0, 0), m);
    b.add('ochre', K.box(96, 22, 30, 0, 5, 0), m);
    for (const sgn of [-1, 1]) for (let i = 0; i < 8; i++) b.add('post', K.box(2.6, 22, 2.6, -49 + i * 14, 5, sgn * 21), m);
    for (const sgn of [-1, 1]) for (let i = 0; i < 2; i++) b.add('post', K.box(2.6, 22, 2.6, sgn * 49, 5, -7 + i * 14), m);
    for (const sgn of [-1, 1]) {
      for (const x of [-14, 0, 14]) b.add('dark', K.box(8, 15, 1, x, 5, sgn * 15.2), m);
      for (const x of [-35, 35]) b.add('dark', K.box(7, 6.5, 1, x, 13.5, sgn * 15.2), m);
    }
    b.add('post', K.box(118, 1.6, 46, 0, 26.4, 0), m);
    // 腰檐
    b.add('roofHL', K.hipRoof({ w: 142, d: 70, h: 26, ridge: 62, lift: 6, tMax: 0.5, curve: 1.3 }), m.clone().multiply(new THREE.Matrix4().makeTranslation(0, 28, 0)));
    // 平座和栏杆
    b.add('wood', K.box(98, 2.4, 38, 0, 38, 0), m);
    for (const sgn of [-1, 1]) {
      b.add('post', K.box(98, 1, 1, 0, 44.5, sgn * 18.5), m);
      b.add('post', K.box(1, 1, 38, sgn * 48.5, 44.5, 0), m);
      for (let i = 0; i < 15; i++) b.add('post', K.box(1, 4.2, 1, -48.5 + i * 6.93, 40.4, sgn * 18.5), m);
      for (let i = 0; i < 5; i++) b.add('post', K.box(1, 4.2, 1, sgn * 48.5, 40.4, -14 + i * 7), m);
    }
    // 上层
    b.add('ochre', K.box(74, 19, 22, 0, 40.4, 0), m);
    for (const sgn of [-1, 1]) for (let i = 0; i < 6; i++) b.add('post', K.box(2.4, 19, 2.4, -35 + i * 14, 40.4, sgn * 14.5), m);
    for (const sgn of [-1, 1]) {
      b.add('dark', K.box(10, 13, 1, 0, 40.4, sgn * 11.2), m);
      for (const x of [-21, 21]) b.add('dark', K.box(7, 6, 1, x, 47, sgn * 11.2), m);
      b.add('dark', K.box(20, 5, 1, 0, 53.4, sgn * 11.9), m); // 檐下的匾
    }
    b.add('post', K.box(92, 1.6, 34, 0, 59, 0), m);
    b.add('roofHL', K.hipRoof({ w: 116, d: 56, h: 22, ridge: 58, lift: 6.5 }), m.clone().multiply(new THREE.Matrix4().makeTranslation(0, 60.4, 0)));
    b.add('roofHL', K.box(62, 3.2, 3.6, 0, 81.4, 0), m);
    for (const sgn of [-1, 1]) b.add('roofHL', K.box(4.4, 7.5, 4.4, sgn * 30, 81.4, 0), m);
  }

  // ---------- 屋子 ----------
  const occupied = []; // 已经摆了东西的圆：[x, z, r]
  const free = (x, z, r) => occupied.every((o) => Math.hypot(o[0] - x, o[1] - z) > o[2] + r);
  function house(b, x, z, ry, w, d, h, rh, y = PY) {
    b.add('wood', K.box(w, h, d), K.place(x, y, z, ry));
    const [slopes, gables] = K.gableRoof(w, d, rh, 2.6);
    b.add('roof', slopes, K.place(x, y + h, z, ry));
    b.add('wood', gables, K.place(x, y + h, z, ry));
  }
  function hall(b, x, z, ry, w, d, h, rh, y = PY) {
    b.add('wood', K.box(w + 8, 2.5, d + 8), K.place(x, y, z, ry));
    b.add('wood', K.box(w, h, d), K.place(x, y + 2.5, z, ry));
    b.add('roof', K.hipRoof({ w: w + 16, d: d + 16, h: rh, ridge: Math.max(4, w - d * 0.7), lift: rh * 0.24 }), K.place(x, y + 2.5 + h, z, ry));
    b.add('roof', K.box(Math.max(4, w - d * 0.7) + 3, 2.2, 2.6), K.place(x, y + 2.5 + h + rh - 0.6, z, ry));
  }
  {
    // 城里：十字大街，街两边一排一排朝南的屋子。西北一块留给州衙。
    const inner = { x0: C.x0 + 62, x1: C.x1 - 62, z0: C.z0 + 62, z1: C.z1 - 62 };
    const street = 26;
    const yamen = { x0: -330, x1: -90, z0: -400, z1: -120 };
    const inYamen = (x, z) => x > yamen.x0 - 14 && x < yamen.x1 + 14 && z > yamen.z0 - 14 && z < yamen.z1 + 14;
    for (let z = inner.z0 + 6; z < inner.z1 - 10; z += 43) {
      if (Math.abs(z) < street + 6) continue;
      const lane = Math.round((z - inner.z0) / 43) % 4 === 3; // 每隔几排空一条横巷
      if (lane) continue;
      let x = inner.x0 + R(0, 14);
      while (x < inner.x1 - 20) {
        const w = R(24, 42);
        const d = R(15, 19);
        const hx = x + w / 2;
        x += w + R(5, 13);
        if (Math.abs(hx) < street + w / 2) continue;
        if (hx + w / 2 > inner.x1) break;
        if (inYamen(hx, z)) continue;
        if (rnd() < 0.1) continue;
        // 偶尔一间竖着的厢房
        if (rnd() < 0.12) house(houses, hx, z + 4, Math.PI / 2, R(22, 30), 13, R(9, 11), R(7, 9));
        else house(houses, hx, z + R(-2.5, 2.5), 0, w, d, R(9.5, 13), R(7.5, 10));
      }
    }
    // 州衙：中轴线上三进大殿，两边厢房，一圈矮墙
    const yx = (yamen.x0 + yamen.x1) / 2;
    hall(houses, yx, -165, 0, 64, 24, 15, 13);
    hall(houses, yx, -250, 0, 78, 30, 18, 16);
    hall(houses, yx, -345, 0, 64, 24, 15, 13);
    for (const sx of [-1, 1]) {
      house(houses, yx + sx * 82, -205, Math.PI / 2, 52, 16, 10, 8);
      house(houses, yx + sx * 82, -305, Math.PI / 2, 52, 16, 10, 8);
    }
    const yw = yamen.x1 - yamen.x0;
    const yd = yamen.z1 - yamen.z0;
    houses.add('wall', K.box(yw, 7, 3, yx, PY, yamen.z0));
    houses.add('wall', K.box(yw / 2 - 16, 7, 3, yx - yw / 4 - 8, PY, yamen.z1));
    houses.add('wall', K.box(yw / 2 - 16, 7, 3, yx + yw / 4 + 8, PY, yamen.z1));
    houses.add('wall', K.box(3, 7, yd, yamen.x0, PY, (yamen.z0 + yamen.z1) / 2));
    houses.add('wall', K.box(3, 7, yd, yamen.x1, PY, (yamen.z0 + yamen.z1) / 2));
    occupied.push([0, 0, 900]);
  }

  // 城南关厢：南门外路两边的几排屋子
  {
    const x0 = (C.x0 + C.x1) / 2;
    for (let z = C.z1 + 78; z < C.z1 + 190; z += 42)
      for (const sx of [-1, 1]) {
        let x = x0 + sx * 34;
        for (let i = 0; i < 4; i++) {
          const w = R(24, 36);
          if (rnd() < 0.85) house(houses, x + (sx * w) / 2, z + R(-3, 3), 0, w, R(15, 18), R(9, 12), R(7, 9));
          x += sx * (w + R(6, 12));
        }
      }
  }

  // ---------- 戏马台：一座小土山，顶上一方台子、一座殿 ----------
  // 土山照别的山的做法，用一摞椴木薄板叠出来；它只高二十来米，所以用半厚的板（一层 4 米），叠六层。
  // 每一层的轮廓比下一层往里收十几到二十几米，收多少是随机的（固定种子）。
  const MOUND = { x: GEO.places.ximatai.x, z: GEO.places.ximatai.z, R: 150, n: 6, t: T.layerT / 2 };
  const moundTop = PY + MOUND.n * MOUND.t;
  const moundR = (th, inset = 0) => (MOUND.R - inset) * (1 + 0.12 * Math.sin(3 * th + 0.7) + 0.06 * Math.sin(5 * th + 2.1));
  {
    const mr = mulberry32(8402);
    const NA = 96;
    const inset = new Float32Array(NA);
    const lv = [];
    for (let k = 0; k < MOUND.n; k++) {
      if (k > 0) {
        const s = 13 + mr() * 8;
        const a = 2 + mr() * 3.5;
        const m = 2 + Math.floor(mr() * 3);
        const ph = mr() * 6.28;
        const a2 = 1 + mr() * 2;
        const m2 = 5 + Math.floor(mr() * 3);
        const ph2 = mr() * 6.28;
        for (let i = 0; i < NA; i++) {
          const th = (i / NA) * Math.PI * 2;
          inset[i] += s + a * Math.sin(m * th + ph) + a2 * Math.sin(m2 * th + ph2);
        }
      }
      const pts = [];
      // 倒着走一圈：这样侧面的法线朝外（同 terrain.js 里等高线的方向）
      for (let i = NA - 1; i >= 0; i--) {
        const th = (i / NA) * Math.PI * 2;
        const r = moundR(th, inset[i]);
        pts.push([MOUND.x + r * Math.cos(th), MOUND.z + (r * Math.sin(th)) / 0.86]);
      }
      lv.push({ k: k + 1, yTop: PY + (k + 1) * MOUND.t, yBot: PY + k * MOUND.t, polys: [{ outer: { pts }, holes: [] }] });
    }
    const g = buildLayerGeometry(lv);
    for (const [geo, mat] of [[g.caps, terrainMats.top], [g.walls, terrainMats.edge]]) {
      const m = new THREE.Mesh(geo, mat);
      m.castShadow = true;
      m.receiveShadow = true;
      scene.add(m);
    }
    occupied.push([MOUND.x, MOUND.z, 260]);
  }
  const xi = new K.Builder();
  {
    // 局部坐标：原点在土山顶面的正中
    xi.add('wall', K.taperBox(88, 10, 88, 80), K.place(0, 0, 0));
    xi.add('wall', K.box(22, 6.5, 12, 0, 0, -49));
    xi.add('wall', K.box(22, 3.2, 10, 0, 0, -59));
    hall(xi, 0, 2, 0, 58, 26, 16, 15, 10);
    for (const sx of [-1, 1]) xi.add('roof', K.box(2, 10, 2, sx * 38, 10, -36));
  }

  // ---------- 放鹤亭（水退以后）：云龙山北头的山顶 ----------
  let fanghe = null;
  {
    const p = GEO.places.fangheting;
    // 在附近找最高的一层
    let best = { k: -1, x: p.x, z: p.z };
    for (let dz = -160; dz <= 160; dz += 20)
      for (let dx = -160; dx <= 160; dx += 20) {
        const k = terrain.levelAt(p.x + dx, p.z + dz);
        const near = Math.hypot(dx, dz);
        if (k > best.k || (k === best.k && near < best.near)) best = { k, x: p.x + dx, z: p.z + dz, near };
      }
    // 往这一层的里面挪一挪，让亭子四个角都在同一层上
    let sx = 0;
    let sz = 0;
    let n = 0;
    for (let dz = -80; dz <= 80; dz += 20)
      for (let dx = -80; dx <= 80; dx += 20)
        if (terrain.levelAt(best.x + dx, best.z + dz) >= best.k) {
          sx += best.x + dx;
          sz += best.z + dz;
          n++;
        }
    if (n) {
      best.x = sx / n;
      best.z = sz / n;
    }
    const y = T.levelY(best.k);
    afterFixed.add('wood', K.box(30, 3, 30, best.x, y, best.z));
    for (const [ax, az] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) afterFixed.add('roof', K.box(2.2, 15, 2.2, best.x + ax * 10.5, y + 3, best.z + az * 10.5));
    afterFixed.add('roof', K.hipRoof({ w: 38, d: 38, h: 15, ridge: 0, lift: 4.5 }), K.place(best.x, y + 18, best.z));
    afterFixed.add('roof', K.box(2.6, 5, 2.6, best.x, y + 32, best.z));
    fanghe = { x: best.x, z: best.z, y: y + 37 };
  }

  // ---------- 堤 ----------
  // 正文：“东南那一道，从戏马台山脚接到城墙。”做成一道夯土的坝：顶宽 25 米，两边是坡，比干地和水面都高，
  // 颜色比椴木深一档，顶上刻一道线。
  const dikes = new K.Builder();
  const DIKE_H = 42;
  const dikeLine = (() => {
    const dx = GEO.dike[1].x - MOUND.x;
    const dz = GEO.dike[1].z - MOUND.z;
    const th = Math.atan2(dz * 0.86, dx);
    const r = moundR(th) * 0.9;
    const start = [MOUND.x + r * Math.cos(th), MOUND.z + (r * Math.sin(th)) / 0.86];
    const pts = [start, [GEO.dike[1].x, GEO.dike[1].z + 6], [C.x1 - 8, C.z1 + 24]];
    const curve = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(p[0], 0, p[1])), false, 'centripetal');
    return curve.getSpacedPoints(36);
  })();
  {
    for (let i = 0; i < dikeLine.length - 1; i++) {
      const a = dikeLine[i];
      const b = dikeLine[i + 1];
      const len = a.distanceTo(b);
      const m = K.place((a.x + b.x) / 2, PY, (a.z + b.z) / 2, -Math.atan2(b.z - a.z, b.x - a.x));
      dikes.add('dike', K.taperBox(len + 7, DIKE_H, 84, 25), m);
      dikes.add('dikeLine', K.box(len + 1, 0.9, 2.6, 0, DIKE_H - 0.2, 0), m);
    }
    // 城里贴着城墙的一道：长九百八十四丈（约 3 公里），高一丈，宽二丈
    const off = WALL.wb / 2 + 9;
    const hIn = 19;
    const add = (x, z, len, ry) => dikes.add('dike', K.taperBox(len, hIn, 20, 13), K.place(x, PY, z, ry));
    add(0, C.z0 + off, C.x1 - C.x0 - 2 * off - 20, 0); // 北
    add(C.x1 - off, 0, C.z1 - C.z0 - 2 * off - 20, Math.PI / 2); // 东
    add(C.x1 / 2, C.z1 - off, (C.x1 - C.x0) / 2 - off - 20 - GATE.w / 2 + 10, 0); // 南边的东半
  }

  // ---------- 百步洪的乱石：八九块灰石片横在河里，中间留一线水路 ----------
  // （河是深靛蓝，石头要是深色就看不见了，所以用比椴木灰一档的浅石色）
  const rockItems = [];
  const rockSite = { x: 0, z: 0 };
  {
    const p = GEO.places.baibuhong;
    const line = riverSamples().si;
    let i0 = 0;
    let best = 1e9;
    line.forEach((s, i) => {
      const d = Math.hypot(s.x - p.x, s.z - p.z);
      if (d < best) {
        best = d;
        i0 = i;
      }
    });
    rockSite.x = line[i0].x;
    rockSite.z = line[i0].z;
    const big = 9;
    for (let n = 0; n < big; n++) {
      const i = i0 - 14 + Math.round((n / (big - 1)) * 28);
      const s = line[i];
      const s2 = line[i + 1];
      const tx = s2.x - s.x;
      const tz = s2.z - s.z;
      const l = Math.hypot(tx, tz);
      const nx = -tz / l;
      const nz = tx / l;
      const side = n % 2 ? 1 : -1;
      const len = R(62, 118);
      // 从一边的岸伸到河心，留十来米的水路
      const gap = R(7, 12);
      const mid = side * (gap + len / 2);
      const ang = Math.atan2(-nz, nx) + R(-0.35, 0.35);
      const m = K.place(s.x + nx * mid + R(-4, 4), -2, s.z + nz * mid + R(-4, 4), ang, len / 2, R(7, 11), R(15, 26));
      rockItems.push({ m, ax: rockSite.x, ay: 0, az: rockSite.z });
    }
    // 边上的小石头
    for (let n = 0; n < 16; n++) {
      const i = i0 - 17 + Math.floor(rnd() * 34);
      const s = line[i];
      const s2 = line[i + 1];
      const l = Math.hypot(s2.x - s.x, s2.z - s.z);
      const nx = -(s2.z - s.z) / l;
      const nz = (s2.x - s.x) / l;
      const off = (rnd() < 0.5 ? -1 : 1) * R(16, s.hw - 8);
      const sc = R(7, 15);
      rockItems.push({ m: K.place(s.x + nx * off, -1, s.z + nz * off, R(0, 6.28), sc * R(0.9, 1.6), sc * R(0.4, 0.7), sc * R(0.8, 1.2)), ax: rockSite.x, ay: 0, az: rockSite.z });
    }
  }
  const rocks = instSet(scene, [{ geo: new THREE.DodecahedronGeometry(1, 0), mat: mats.rock }], rockItems);

  // ---------- 村子、田、树 ----------
  const plainOK = (x, z, r) => {
    const c = T.crop;
    if (x - r < c.x0 + 60 || x + r > c.x1 - 60 || z - r < c.z0 + 60 || z + r > c.z1 - 60) return false;
    for (const [dx, dz] of [[0, 0], [r, 0], [-r, 0], [0, r], [0, -r], [r * 0.7, r * 0.7], [-r * 0.7, r * 0.7], [r * 0.7, -r * 0.7], [-r * 0.7, -r * 0.7]]) {
      if (terrain.levelAt(x + dx, z + dz) !== 0) return false;
      if (terrain.sdfAt(x + dx, z + dz) < 22) return false;
    }
    return true;
  };
  // 预留：堤、码头
  occupied.push([GEO.dike[1].x, GEO.dike[1].z, 190], [C.x1 - 120, C.z1 + 100, 150]);

  // 村子：六到十间屋子凑成一簇。全景里整簇放大两倍半，所以四周要留够地方，也不贴着河。
  const hamlets = [];
  const houseItems = [];
  for (let tries = 0; tries < 6000 && hamlets.length < 30; tries++) {
    const x = R(T.crop.x0 + 380, T.crop.x1 - 380);
    const z = R(T.crop.z0 + 380, T.crop.z1 - 380);
    if (!plainOK(x, z, 300) || !free(x, z, 320)) continue;
    if (terrain.sdfAt(x, z) < 330) continue;
    if (hamlets.some((h) => Math.hypot(h.x - x, h.z - z) < 1050)) continue;
    // 多半靠着河，或者靠着往西去的大路
    const nearWater = terrain.sdfAt(x, z) < 560;
    const nearRoad = x < C.x0 && Math.abs(z) > 330 && Math.abs(z) < 620;
    if (Math.abs(z) < 330 && x < C.x0) continue; // 不压着往西去的路
    if (!nearWater && !nearRoad && rnd() < 0.7) continue;
    const ang = [0, 0, 0.26, -0.3, 0.5][Math.floor(rnd() * 5)];
    hamlets.push({ x, z, ang });
    occupied.push([x, z, 300]);
    const ca = Math.cos(ang);
    const sa = Math.sin(ang);
    const put = (px, pz, turn, w) => {
      const d = R(15, 18);
      const h = R(9, 12);
      const rh = R(7, 9);
      const wx = x + px * ca + pz * sa;
      const wz = z - px * sa + pz * ca;
      houseItems.push({
        m: K.place(wx, PY, wz, ang + turn, w, h, d),
        m2: K.place(wx, PY + h, wz, ang + turn, w, rh, d),
        ax: x, ay: PY, az: z,
      });
    };
    const rows = 2 + Math.floor(rnd() * 2);
    let count = 0;
    const want = 6 + Math.floor(rnd() * 5);
    for (let r = 0; r < rows && count < want; r++) {
      let lx = -R(55, 80);
      const n = Math.min(want - count, r === rows - 1 ? want - count : 3 + Math.floor(rnd() * 2));
      const pz = (r - (rows - 1) / 2) * 44;
      for (let i = 0; i < n && lx < 96; i++) {
        const w = R(24, 36);
        put(lx + w / 2, pz + R(-4, 4), 0, w);
        count++;
        lx += w + R(6, 14);
      }
      // 一头接一间横着的厢房，围出个院子
      if (count < want && rnd() < 0.7) {
        put(lx + 6, pz + 15, Math.PI / 2, R(24, 30));
        count++;
      }
    }
  }
  const houseParts = (() => {
    const wall = new THREE.BoxGeometry(1, 1, 1);
    wall.translate(0, 0.5, 0);
    const [slopes, gables] = K.gableRoof(1, 1, 1, 0.075);
    const uv = new Float32Array((slopes.attributes.position.count) * 2);
    for (let i = 0; i < slopes.attributes.position.count; i++) {
      uv[i * 2] = slopes.attributes.position.getX(i) * (30 / K.TILE);
      uv[i * 2 + 1] = slopes.attributes.position.getZ(i);
    }
    slopes.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    gables.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(gables.attributes.position.count * 2), 2));
    return [
      { geo: wall, mat: mats.wood, key: 'm' },
      { geo: slopes, mat: mats.roof, key: 'm2' },
      { geo: gables, mat: mats.wood, key: 'm2' },
    ];
  })();
  const hamletSet = instSet(scene, houseParts, houseItems);

  // 田：贴在平地上的薄片，浅刻着垄。两种木色：一种同平地一样（只看得见刻线），一种深一档。
  // 沿着河、沿着往西和往南的路，排成长条。
  const fieldGeo = (() => {
    const g = new THREE.BoxGeometry(1, 1, 1);
    g.translate(0, 0.5, 0);
    return g;
  })();
  const fields = [];
  const fieldOK = (x, z, hw, hd, ang) => {
    const ca = Math.cos(ang);
    const sa = Math.sin(ang);
    for (const [u, v] of [[0, 0], [1, 1], [1, -1], [-1, 1], [-1, -1], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const px = x + u * hw * ca + v * hd * sa;
      const pz = z - u * hw * sa + v * hd * ca;
      if (terrain.levelAt(px, pz) !== 0 || terrain.sdfAt(px, pz) < 34) return false;
      const c = T.crop;
      if (px < c.x0 + 40 || px > c.x1 - 40 || pz < c.z0 + 40 || pz > c.z1 - 40) return false;
      if (px > C.x0 - 90 && px < C.x1 + 90 && pz > C.z0 - 90 && pz < C.z1 + 90) return false;
      if (px < C.x0 && Math.abs(pz - 20) < 46) return false; // 往西去的路
    }
    // 不压着屋子
    for (const h of hamlets) if (Math.hypot(h.x - x, h.z - z) < 150 + Math.max(hw, hd) * 0.7) return false;
    if (Math.hypot(x - MOUND.x, z - MOUND.z) < 300) return false;
    if (x > C.x0 && x < C.x1 && z > C.z1 && z < C.z1 + 300 && Math.abs(x) < 190) return false;
    return true;
  };
  // 一条田：沿着一条线（河岸外侧，或者路边），一块接一块
  const stripAlong = (line, side, off0, rows) => {
    for (let i = 6; i < line.length - 8; ) {
      const s = line[i];
      const s2 = line[Math.min(line.length - 1, i + 6)];
      const tx = s2.x - s.x;
      const tz = s2.z - s.z;
      const l = Math.hypot(tx, tz) || 1;
      const nx = -tz / l;
      const nz = tx / l;
      const ang = -Math.atan2(tz, tx);
      const fw = R(150, 240);
      const fd = R(84, 118);
      if (rnd() < 0.2) {
        i += Math.round((fw + 40) / 12);
        continue;
      }
      for (let r = 0; r < rows; r++) {
        if (r > 0 && rnd() < 0.35) continue;
        const off = side * ((s.hw || 0) + off0 + fd / 2 + r * (fd + 9));
        const x = s.x + nx * off;
        const z = s.z + nz * off;
        if (!fieldOK(x, z, fw / 2, fd / 2, ang)) continue;
        if (fields.some((f) => Math.hypot(f.x - x, f.z - z) < (f.r + Math.hypot(fw, fd) / 2) * 0.8)) continue;
        fields.push({ x, z, ang, w: fw, d: fd, r: Math.hypot(fw, fd) / 2, dark: rnd() < 0.62 });
      }
      i += Math.round((fw + 9) / 12);
    }
  };
  {
    const rs = riverSamples();
    for (const side of [-1, 1]) {
      stripAlong(rs.bian, side, 64, 3);
      stripAlong(rs.si, side, 64, 3);
    }
    // 路边：往西的大路、南门外的路
    const road = (pts) => {
      const curve = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(p[0], 0, p[1])), false, 'centripetal');
      return curve.getSpacedPoints(Math.ceil(curve.getLength() / 12)).map((v) => ({ x: v.x, z: v.z, hw: 0 }));
    };
    const west = road([[C.x0 - 120, 20], [-1500, 60], [-2900, -110], [-4400, 30], [T.crop.x0 + 60, -40]]);
    for (const side of [-1, 1]) stripAlong(west, side, 58, 2);
    const south = road([[-40, C.z1 + 320], [-420, 1500], [-300, 2300], [300, 3300], [700, 4700]]);
    for (const side of [-1, 1]) stripAlong(south, side, 60, 2);
  }
  // 另外散着几片
  for (let tries = 0; tries < 1600; tries++) {
    const bx = R(T.crop.x0 + 200, T.crop.x1 - 200);
    const bz = R(T.crop.z0 + 200, T.crop.z1 - 200);
    if (terrain.levelAt(bx, bz) !== 0) continue;
    if (fields.length > 520) break;
    if (fields.some((f) => Math.hypot(f.x - bx, f.z - bz) < 760)) continue;
    const ang = [0, 0.09, -0.14, 0.3, -0.36, 0.52][Math.floor(rnd() * 6)];
    const nu = 3 + Math.floor(rnd() * 4);
    const nv = 2 + Math.floor(rnd() * 3);
    const fw = R(140, 210);
    const fd = R(88, 122);
    const ca = Math.cos(ang);
    const sa = Math.sin(ang);
    for (let u = 0; u < nu; u++)
      for (let v = 0; v < nv; v++) {
        if (rnd() < 0.12) continue;
        const lx = (u - (nu - 1) / 2) * (fw + 9);
        const lz = (v - (nv - 1) / 2) * (fd + 9);
        const x = bx + lx * ca + lz * sa;
        const z = bz - lx * sa + lz * ca;
        if (!fieldOK(x, z, fw / 2, fd / 2, ang)) continue;
        if (fields.some((f) => Math.hypot(f.x - x, f.z - z) < (f.r + Math.hypot(fw, fd) / 2) * 0.8)) continue;
        fields.push({ x, z, ang, w: fw, d: fd, r: Math.hypot(fw, fd) / 2, dark: rnd() < 0.5 });
      }
  }
  const fieldMesh = new THREE.InstancedMesh(fieldGeo, mats.field, fields.length);
  const fc = new THREE.Color();
  const woodC = new THREE.Color(COLORS.wood);
  fields.forEach((f, i) => {
    fieldMesh.setMatrixAt(i, K.place(f.x, PY, f.z, f.ang, f.w, 1.8, f.d));
    // 深的一种：比平地暗百分之七上下，略偏黄
    const t = f.dark ? R(0.8, 0.86) : R(0.97, 1.0);
    fieldMesh.setColorAt(i, fc.copy(woodC).multiply(new THREE.Color(t, t * (f.dark ? 0.965 : 0.995), t * (f.dark ? 0.86 : 0.975))));
  });
  // 垄沟沿着田的长边：每块田大约十来道
  mats.field.map.repeat.set(1, 2.5);
  fieldMesh.receiveShadow = true;
  fieldMesh.castShadow = false;
  scene.add(fieldMesh);

  // 树：小木珠。东门一带（近景里看得见的）用细的球，别处用粗的。
  const treeItems = [];
  function tree(x, z, y = PY, s = R(8.5, 13.5), kind = 'plain') {
    const near = x > 250 && x < 1250 && Math.abs(z) < 430;
    treeItems.push({ m: K.place(x, y, z, R(0, 6), s, s * R(0.96, 1.12), s), s, ax: x, ay: y, az: z, kind, lod: near ? 0 : Math.hypot(x, z) < 2400 ? 1 : 2 });
  }
  // 河边
  for (const line of [riverSamples().bian, riverSamples().si]) {
    for (let i = 4; i < line.length - 4; i += 5) {
      const s = line[i];
      const s2 = line[i + 1];
      const l = Math.hypot(s2.x - s.x, s2.z - s.z);
      const nx = -(s2.z - s.z) / l;
      const nz = (s2.x - s.x) / l;
      for (const side of [-1, 1]) {
        if (rnd() > 0.34) continue;
        const off = side * (s.hw + R(22, 52));
        const x = s.x + nx * off;
        const z = s.z + nz * off;
        if (x > C.x0 - 110 && x < C.x1 + 110 && z > C.z0 - 110 && z < C.z1 + 110) continue;
        if (!plainOK(x, z, 14) || !free(x, z, 12)) continue;
        // 东门对岸留空：近景里镜头就架在那儿
        if (x > 850 && x < 1150 && z > -330 && z < 380) continue;
        tree(x, z);
        if (rnd() < 0.4) tree(x + R(-22, 22), z + R(-22, 22), PY, R(7, 10));
      }
    }
  }
  // 村边：放大以后的村子外面一圈
  for (const h of hamlets) {
    const n = 4 + Math.floor(rnd() * 4);
    for (let i = 0; i < n; i++) {
      const a = R(0, 6.28);
      const d = R(120, 190);
      const x = h.x + Math.cos(a) * d;
      const z = h.z + Math.sin(a) * d;
      const s = R(9, 13);
      if (plainOK(x, z, 14) && !fields.some((f) => Math.hypot(f.x - x, f.z - z) < f.r * 0.6)) treeItems.push({ m: K.place(x, PY, z, R(0, 6), s), s, ax: h.x, ay: PY, az: h.z, kind: 'hamlet', lod: Math.hypot(x, z) < 2400 ? 1 : 2 });
    }
  }
  // 田头和野地
  for (let tries = 0; tries < 1500 && treeItems.length < 430; tries++) {
    const x = R(T.crop.x0 + 120, T.crop.x1 - 120);
    const z = R(T.crop.z0 + 120, T.crop.z1 - 120);
    if (!plainOK(x, z, 16) || !free(x, z, 14)) continue;
    if (fields.some((f) => Math.hypot(f.x - x, f.z - z) < f.r * 0.75)) continue;
    tree(x, z);
    if (rnd() < 0.5) tree(x + R(-30, 30), z + R(-30, 30), PY, R(7, 10.5));
    if (rnd() < 0.25) tree(x + R(-40, 40), z + R(-40, 40), PY, R(7, 10));
  }
  // 山脚和山上：稀稀的几棵（“南山的栗树林”）
  for (let tries = 0; tries < 2400 && treeItems.length < 560; tries++) {
    const x = R(T.crop.x0 + 120, T.crop.x1 - 120);
    const z = R(T.crop.z0 + 120, T.crop.z1 - 120);
    const k = terrain.levelAt(x, z);
    if (k < 1 || k > 3) continue;
    let ok = true;
    for (const [dx, dz] of [[26, 0], [-26, 0], [0, 26], [0, -26]]) if (terrain.levelAt(x + dx, z + dz) !== k) ok = false;
    if (!ok || !free(x, z, 30)) continue;
    tree(x, z, T.levelY(k), R(7.5, 11), 'hill');
  }
  // 城里院子里的树：比屋子矮
  for (let tries = 0; tries < 400 && treeItems.length < 660; tries++) {
    const x = R(C.x0 + 80, C.x1 - 80);
    const z = R(C.z0 + 80, C.z1 - 80);
    const row = Math.round((z - (C.z0 + 68)) / 43);
    const zr = C.z0 + 68 + row * 43 + 21;
    if (Math.abs(zr) < 30 || (x > -350 && x < -70 && zr > -420 && zr < -100)) continue;
    tree(x, zr, PY, R(4.2, 6), 'city');
  }
  const treeParts = (() => {
    const squash = (g) => {
      g.scale(1, 1.08, 1);
      g.translate(0, 1.26, 0);
      return g;
    };
    const fineBall = squash(new THREE.SphereGeometry(1, 24, 16));
    const midBall = squash(new THREE.IcosahedronGeometry(1, 1));
    const coarse = new THREE.IcosahedronGeometry(1, 0);
    // 面数少的球，法线照球面给，免得看出棱角
    for (const g of [midBall, coarse]) {
      const p = g.attributes.position;
      const n = g.attributes.normal;
      for (let i = 0; i < p.count; i++) {
        const v = new THREE.Vector3(p.getX(i), p.getY(i), p.getZ(i));
        if (g === midBall) v.set(v.x, (v.y - 1.26) / 1.08, v.z);
        v.normalize();
        n.setXYZ(i, v.x, v.y, v.z);
      }
    }
    squash(coarse);
    const trunk = new THREE.CylinderGeometry(0.15, 0.2, 0.5, 8);
    trunk.translate(0, 0.25, 0);
    const trunkFar = new THREE.CylinderGeometry(0.15, 0.2, 0.5, 4, 1, true);
    trunkFar.translate(0, 0.25, 0);
    return [
      { geo: fineBall, mat: mats.tree, only: (t) => t.lod === 0 },
      { geo: midBall, mat: mats.tree, only: (t) => t.lod === 1 },
      { geo: coarse, mat: mats.tree, only: (t) => t.lod === 2 },
      { geo: trunk, mat: mats.roofHL, only: (t) => t.lod === 0 },
      { geo: trunkFar, mat: mats.roofHL, only: (t) => t.lod > 0, cast: false },
    ];
  })();
  const treeSet = instSet(scene, treeParts, treeItems);

  // ---------- 路：浅刻的线 ----------
  {
    const mat = new THREE.MeshBasicMaterial({ color: 0x7a5c3c, transparent: true, opacity: 0.42, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    const ribbon = (pts, width) => {
      const curve = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(p[0], 0, p[1])), false, 'centripetal');
      const sp = curve.getSpacedPoints(Math.ceil(curve.getLength() / 30));
      const pos = [];
      for (let i = 0; i < sp.length - 1; i++) {
        const a = sp[i];
        const b = sp[i + 1];
        const l = a.distanceTo(b) || 1;
        const nx = (-(b.z - a.z) / l) * (width / 2);
        const nz = ((b.x - a.x) / l) * (width / 2);
        const y = PY + 0.5;
        pos.push(a.x - nx, y, a.z - nz, a.x + nx, y, a.z + nz, b.x + nx, y, b.z + nz, a.x - nx, y, a.z - nz, b.x + nx, y, b.z + nz, b.x - nx, y, b.z - nz);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      const m = new THREE.Mesh(g, mat);
      m.renderOrder = 3;
      scene.add(m);
    };
    // 南门出来，到戏马台山脚
    ribbon([[0, C.z1 + 34], [-6, C.z1 + 150], [-30, C.z1 + 270]], 9);
    // 西门出来往西：去南京（今商丘）的路
    ribbon([[C.x0 - 34, 0], [-1500, 60], [-2900, -110], [-4400, 30], [T.crop.x0 + 20, -40]], 12);
  }

  // ---------- 船 ----------
  const boatItems = [];
  const boatMat = (x, z, ry, y, len) => K.place(x, y - 1.6, z, ry, len, 1, R(0.92, 1.08));
  function boat(set, x, z, ry, y, withMast, len = R(0.82, 1.22)) {
    boatItems.push({ set, m: boatMat(x, z, ry, y, len), ax: x, ay: y, az: z, mast: withMast, cabin: rnd() < 0.86 });
  }
  {
    // 平时：东门外河边泊着几条，河上走着几条，百步洪的水路里一条
    const si = riverSamples().si;
    const dirAt = (i) => Math.atan2(-(si[i + 1].z - si[i].z), si[i + 1].x - si[i].x);
    const sideAt = (i, off) => {
      const l = Math.hypot(si[i + 1].x - si[i].x, si[i + 1].z - si[i].z);
      return [si[i].x - ((si[i + 1].z - si[i].z) / l) * off, si[i].z + ((si[i + 1].x - si[i].x) / l) * off];
    };
    const nearIdx = (x, z) => {
      let b = 0;
      let bd = 1e9;
      si.forEach((s, i) => {
        const d = Math.hypot(s.x - x, s.z - z);
        if (d < bd && i < si.length - 2) {
          bd = d;
          b = i;
        }
      });
      return b;
    };
    const iGate = nearIdx(C.x1 + 100, 0);
    // 泊在西岸（城这一边）
    for (const [di, off, mast, len] of [[-9, 70, true, 1.12], [-3, 73, false, 0.86], [3, 70, true, 1.2], [9, 74, false, 0.9], [16, 68, true, 1.05], [-17, 72, false, 1]]) {
      const i = iGate + di + (di > 0 ? 5 : -3);
      const [x, z] = sideAt(i, off);
      boat('calm', x, z, dirAt(i) + R(-0.05, 0.05), 0, mast, len);
    }
    // 河上
    for (const [zz, off] of [[-1500, 10], [-420, -24], [520, -30], [1250, 12], [2900, -10], [3700, 20]]) {
      const i = nearIdx(si.reduce((b, s) => (Math.abs(s.z - zz) < Math.abs(b.z - zz) ? s : b)).x, zz);
      const [x, z] = sideAt(i, off);
      boat('calm', x, z, dirAt(i), 0, true);
    }
    const bian = riverSamples().bian;
    for (const xx of [-3600, -1600, -300]) {
      const i = bian.findIndex((s) => s.x > xx);
      boat('calm', bian[i].x, bian[i].z + 8, Math.atan2(-(bian[i + 1].z - bian[i].z), bian[i + 1].x - bian[i].x), 0, true);
    }
    // 百步洪：一条小船正从乱石中间擦过去
    const iB = nearIdx(GEO.places.baibuhong.x, GEO.places.baibuhong.z);
    boat('calm', si[iB].x, si[iB].z, dirAt(iB), 0, false, 0.8);

    // 大水：几百条船分开系在城下，挡一挡浪头（东、北、西三面，每面两排）
    const y = T.floodY;
    const out = WALL.wb / 2;
    const rows = [38, 76];
    for (const [fixedAt, axis, from, to, sgn] of [
      [C.z0, 'x', C.x0 + 40, C.x1 - 40, -1], // 北
      [C.x1, 'z', C.z0 + 40, C.z1 - 60, 1], // 东
      [C.x0, 'z', C.z0 + 40, C.z1 - 150, -1], // 西
    ])
      rows.forEach((d, r) => {
        for (let t = from + (r ? 44 : 0); t < to; t += 88) {
          if (rnd() < 0.06) continue;
          const jitter = R(-5, 5);
          const x = axis === 'x' ? t : fixedAt + sgn * (out + d + jitter);
          const z = axis === 'x' ? fixedAt + sgn * (out + d + jitter) : t;
          boat('flood', x, z, (axis === 'x' ? 0 : Math.PI / 2) + R(-0.07, 0.07), y, rnd() < 0.55);
        }
      });
  }
  const boatParts = (() => {
    const L = 58;
    const B = 15;
    const [arch, caps] = K.awning(20, 6.2);
    for (const g of [arch, caps]) g.translate(-9, 5.5, 0);
    const mast = K.box(1.5, 30, 1.5, 8, 5.5, 0);
    const uv0 = (g) => {
      if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
      return g;
    };
    return (set) => [
      { geo: uv0(K.hull(L, B, 5.5)), mat: mats.wood, only: (b) => b.set === set },
      { geo: uv0(arch), mat: mats.roof, only: (b) => b.set === set && b.cabin },
      { geo: uv0(caps), mat: mats.wood, only: (b) => b.set === set && b.cabin },
      { geo: uv0(mast), mat: mats.roofHL, only: (b) => b.set === set && b.mast },
    ];
  })();
  const boatsCalm = instSet(scene, boatParts('calm'), boatItems);
  const boatsFlood = instSet(scene, boatParts('flood'), boatItems);

  // ---------- 木岸（水退以后）：水冲得最凶的地方，岸边一排木桩 ----------
  {
    const si = riverSamples().si;
    const spans = [[-330, -60], [90, 330], [-900, -700], [620, 800]];
    for (const [za, zb] of spans) {
      for (const s of si) {
        if (s.z < za || s.z > zb) continue;
        const i = si.indexOf(s);
        if (i > si.length - 2) continue;
        const l = Math.hypot(si[i + 1].x - s.x, si[i + 1].z - s.z);
        const nx = -(si[i + 1].z - s.z) / l;
        const nz = (si[i + 1].x - s.x) / l;
        // 西岸
        const side = nx < 0 ? 1 : -1;
        const px = s.x + nx * side * (s.hw - 2.5);
        const pz = s.z + nz * side * (s.hw - 2.5);
        const n2 = si[i + 1];
        const qx = n2.x + nx * side * (n2.hw - 2.5);
        const qz = n2.z + nz * side * (n2.hw - 2.5);
        for (const t of [0, 0.5]) afterFixed.add('roofHL', K.box(2.4, PY + 3, 2.4, px + (qx - px) * t, -2, pz + (qz - pz) * t));
        const ry = Math.atan2(-(qz - pz), qx - px);
        const len = Math.hypot(qx - px, qz - pz) + 1;
        for (const yy of [PY - 5, PY - 13]) afterFixed.add('roofHL', K.box(len, 2, 1.6, (px + qx) / 2 + 1.7, yy, (pz + qz) / 2, ry));
      }
    }
  }

  // ---------- 东门外：岸上铺的一条石板，几级台阶下到水边 ----------
  {
    const si = riverSamples().si;
    const bankX = (z) => {
      const s0 = si.reduce((b, s) => (Math.abs(s.z - z) < Math.abs(b.z - z) ? s : b));
      return s0.x - s0.hw;
    };
    const bank = bankX(12);
    for (let i = 0; i < 5; i++) fixed.add('wall', K.box(7.5, PY - 3 - i * 5, 74 - i * 2, bank + 3 + i * 7.2, -2, 12));
    fixed.add('wall', K.box(10, 3, 86, bank - 6, PY - 1.4, 12));
    // 石板：从城墙根铺到岸边，颜色比椴木深一点
    const sh = new THREE.Shape();
    const zs = [];
    for (let z = C.z0 - 20; z <= C.z1 + 20; z += 40) zs.push(z);
    const inner = C.x1 + WALL.wb / 2 - 2;
    zs.forEach((z, i) => (i ? sh.lineTo(inner, -z) : sh.moveTo(inner, -z)));
    for (let i = zs.length - 1; i >= 0; i--) sh.lineTo(bankX(zs[i]) - 2.5, -zs[i]);
    sh.closePath();
    const g = new THREE.ExtrudeGeometry(sh, { depth: 1.4, bevelEnabled: false });
    g.rotateX(-Math.PI / 2);
    g.translate(0, PY, 0);
    fixed.add('quay', g);
  }

  // ---------- 装上去 ----------
  addGroup('city', city);
  addGroup('houses', houses);
  addGroup('fixed', fixed);
  addGroup('before', before);
  addGroup('after', after);
  addGroup('afterFixed', afterFixed);
  addGroup('dikes', dikes);
  addGroup('xi', xi);
  groups.xi.position.set(MOUND.x, moundTop, MOUND.z);

  // ---------- 大水：一层蓝树脂，漫过平地，被城墙和堤挡在外面 ----------
  // 河和大水是同一种材料：很亮的清漆面，映着屋子里的窗；另有一层淡淡的倒影（城墙、船、岸）。
  // 大水的颜色画在一张图上：平地上是 #36537A，八成不透明；河道上更深；靠近山脚的地方浅一些、透一些。
  const c = T.crop;
  const floodMap = (() => {
    const u = 0.1; // 每米多少像素
    const cv = document.createElement('canvas');
    cv.width = Math.round((c.x1 - c.x0) * u);
    cv.height = Math.round((c.z1 - c.z0) * u);
    const g = cv.getContext('2d');
    const col = new THREE.Color(COLORS.flood);
    const css = (cc, a) => `rgba(${Math.round(cc.r * 255)},${Math.round(cc.g * 255)},${Math.round(cc.b * 255)},${a})`;
    // 颜色按 sRGB 画
    const srgb = (hex) => {
      const k = new THREE.Color(hex);
      return new THREE.Color().setRGB(k.r, k.g, k.b).convertLinearToSRGB();
    };
    const base = srgb(COLORS.flood);
    const deep = srgb(COLORS.resin);
    void col;
    g.fillStyle = css(base, 0.8);
    g.fillRect(0, 0, cv.width, cv.height);
    // 山脚：水浅，底下的木头透上来
    {
      const step = 40;
      const nx = Math.ceil((c.x1 - c.x0) / step) + 1;
      const nz = Math.ceil((c.z1 - c.z0) / step) + 1;
      let f = new Float32Array(nx * nz);
      for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) f[j * nx + i] = terrain.levelAt(c.x0 + i * step, c.z0 + j * step) > 0 ? 1 : 0;
      for (let pass = 0; pass < 3; pass++) {
        const o = new Float32Array(nx * nz);
        for (let j = 0; j < nz; j++)
          for (let i = 0; i < nx; i++) {
            let s = 0;
            let n = 0;
            for (let dj = -2; dj <= 2; dj++)
              for (let di = -2; di <= 2; di++) {
                const ii = i + di;
                const jj = j + dj;
                if (ii < 0 || jj < 0 || ii >= nx || jj >= nz) continue;
                s += f[jj * nx + ii];
                n++;
              }
            o[j * nx + i] = s / n;
          }
        f = o;
      }
      const m = document.createElement('canvas');
      m.width = nx;
      m.height = nz;
      const mg = m.getContext('2d');
      const img = mg.createImageData(nx, nz);
      for (let i = 0; i < nx * nz; i++) {
        img.data[i * 4 + 3] = Math.round(255 * Math.min(1, f[i] * 1.5) * 0.5);
      }
      mg.putImageData(img, 0, 0);
      g.save();
      g.globalCompositeOperation = 'destination-out';
      g.imageSmoothingEnabled = true;
      g.imageSmoothingQuality = 'high';
      g.drawImage(m, 0, 0, nx, nz, 0, 0, (nx - 1) * step * u + step * u, (nz - 1) * step * u + step * u);
      g.restore();
    }
    // 河道：深的靛蓝，边上是软的
    const rs = riverSamples();
    g.lineCap = 'round';
    g.lineJoin = 'round';
    for (const line of [rs.bian, rs.si]) {
      for (let k = 0; k < 6; k++) {
        const grow = 60 - k * 22; // 从宽到窄叠几遍，边就软了
        g.strokeStyle = css(deep, 0.34);
        g.beginPath();
        let started = false;
        let w = 0;
        for (let i = 0; i < line.length; i += 3) {
          const s = line[i];
          const px = (s.x - c.x0) * u;
          const pz = (s.z - c.z0) * u;
          w = Math.max(2, (s.hw * 2 + grow) * u);
          if (!started) {
            g.moveTo(px, pz);
            started = true;
          } else g.lineTo(px, pz);
        }
        g.lineWidth = w;
        g.stroke();
      }
    }
    const t = new THREE.CanvasTexture(cv);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    return t;
  })();
  const gloss = { roughness: 0.12, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.08, envMap: waterEnv, envMapIntensity: 0.3 };
  const matFlood = new THREE.MeshPhysicalMaterial({ color: 0xffffff, map: floodMap, transparent: true, depthWrite: false, ...gloss });
  const matFloodRim = new THREE.MeshPhysicalMaterial({ color: COLORS.resin, ...gloss });
  let flood;
  let mirror;
  {
    const inset = 3;
    const s = new THREE.Shape();
    // Shape 在 (x, y) 平面里画，y 对应 -z
    s.moveTo(c.x0 + inset, -(c.z0 + inset));
    s.lineTo(c.x1 - inset, -(c.z0 + inset));
    s.lineTo(c.x1 - inset, -(c.z1 - inset));
    s.lineTo(c.x0 + inset, -(c.z1 - inset));
    s.closePath();
    // 洞：城 + 城南被堤和高地护住的一块。堤的那一边照着堤的中线走。
    const hole = [[C.x0, C.z0], [C.x1, C.z0], [C.x1, C.z1 + 8]];
    for (let i = dikeLine.length - 1; i >= 0; i -= 3) hole.push([dikeLine[i].x, dikeLine[i].z]);
    hole.push([MOUND.x, MOUND.z], [EXTRA.tongue.a[0], EXTRA.tongue.a[1]], [EXTRA.tongue.b[0], EXTRA.tongue.b[1]], [C.x0 + 150, C.z1], [C.x0, C.z1]);
    const h = new THREE.Path();
    hole.forEach((p, i) => (i ? h.lineTo(p[0], -p[1]) : h.moveTo(p[0], -p[1])));
    h.closePath();
    s.holes.push(h);
    const depth = T.floodY - 1;
    const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false });
    g.rotateX(-Math.PI / 2); // 平放，厚度朝上；(x, y) → (x, -z) 正好还原
    g.translate(0, -depth, 0); // 顶面在 y = 0
    // 贴图坐标照位置给：整张图正好铺满桌面
    const pos = g.attributes.position;
    const uv = g.attributes.uv;
    for (let i = 0; i < pos.count; i++) uv.setXY(i, (pos.getX(i) - c.x0) / (c.x1 - c.x0), 1 - (pos.getZ(i) - c.z0) / (c.z1 - c.z0));
    flood = new THREE.Mesh(g, [matFlood, matFloodRim]);
    flood.receiveShadow = true;
    flood.renderOrder = 5;
    scene.add(flood);

    // 倒影：把水面以上的东西照镜子画一遍（半张图的大小），按视角淡淡地加在水面上。
    // 正着看（俯视）只有百分之几，贴着水面看就多起来，同真的清漆面一样。
    const shader = {
      name: 'ResinMirror',
      uniforms: { color: { value: null }, tDiffuse: { value: null }, textureMatrix: { value: null }, strength: { value: 0.5 } },
      vertexShader: /* glsl */ `
        uniform mat4 textureMatrix;
        varying vec4 vUv;
        varying vec3 vWorld;
        void main() {
          vUv = textureMatrix * vec4( position, 1.0 );
          vec4 w = modelMatrix * vec4( position, 1.0 );
          vWorld = w.xyz;
          gl_Position = projectionMatrix * viewMatrix * w;
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D tDiffuse;
        uniform float strength;
        varying vec4 vUv;
        varying vec3 vWorld;
        void main() {
          vec4 base = texture2DProj( tDiffuse, vUv );
          vec3 v = normalize( cameraPosition - vWorld );
          float f = 0.04 + 0.96 * pow( 1.0 - clamp( v.y, 0.0, 1.0 ), 5.0 );
          gl_FragColor = vec4( base.rgb * base.a * min( 0.34, 0.05 + f * strength ), 1.0 );
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    };
    mirror = new Reflector(new THREE.ShapeGeometry(s), { textureWidth: 1024, textureHeight: 1024, clipBias: 0.002, shader, multisample: 4 });
    mirror.rotation.x = -Math.PI / 2;
    mirror.material.transparent = true;
    mirror.material.blending = THREE.AdditiveBlending;
    mirror.material.depthWrite = false;
    mirror.renderOrder = 7;
    const inner = mirror.onBeforeRender;
    const keepColor = new THREE.Color();
    mirror.onBeforeRender = function (rend, scn, cam) {
      // 照镜子的那一遍：背景留空（不映展厅的墙），水自己不画
      const a = rend.getClearAlpha();
      rend.getClearColor(keepColor);
      rend.setClearColor(0x000000, 0);
      const fv = flood.visible;
      flood.visible = false;
      inner.call(this, rend, scn, cam);
      flood.visible = fv;
      rend.setClearColor(keepColor, a);
    };
    scene.add(mirror);
  }

  // ---------- 地名：针（三维）+ 牌子（网页文字）+ 从针脚刻到地方去的细线 ----------
  const labelLayer = document.createElement('div');
  labelLayer.className = 'pin-layer';
  host.appendChild(labelLayer);
  const leadSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  leadSvg.setAttribute('class', 'pin-leads');
  labelLayer.appendChild(leadSvg);
  const pinMat = new THREE.MeshStandardMaterial({ color: COLORS.ink, roughness: 0.35, metalness: 0.7, envMap: waterEnv, envMapIntensity: 0.5 });
  const pinGeo = new THREE.CylinderGeometry(1, 1, 1, 8);
  pinGeo.translate(0, 0.5, 0);
  const pinGroup = new THREE.Group();
  scene.add(pinGroup);
  let pins = [];

  const st = { big: 0, cityY: 1, xi: 1 };
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const cityTop = (h) => PY + h * st.cityY;
  const yunlong = (() => {
    const p = GEO.places.yunlongshan;
    let best = { k: -1 };
    for (let dz = -300; dz <= 300; dz += 20)
      for (let dx = -300; dx <= 300; dx += 20) {
        const k = terrain.levelAt(p.x + dx, p.z + dz);
        if (k > best.k) best = { k, x: p.x + dx, z: p.z + dz };
      }
    return V(best.x, T.levelY(best.k), best.z);
  })();
  // 城东北那片山的山脚：水面碰到第一层台阶的地方（从城这边找过去）
  const shore = (() => {
    for (let d = 0; d < 3000; d += 20) {
      const x = 1250 + d * 0.8;
      const z = -560 - d * 0.12;
      if (terrain.levelAt(x, z) >= 1) return V(x - 34, T.floodY, z + 6);
    }
    return V(1800, T.floodY, -600);
  })();
  const sites = {
    city: () => V(60, cityTop(20), 40),
    cityWest: () => V(C.x0 - 1300, PY, 170),
    cityWestFar: () => V(C.x0 - 2700, PY, 260),
    bianFar: () => V(-4400, 0, -1455),
    westGate: () => V(C.x0 - 24, PY, 0),
    northGate: () => V(0, cityTop(GATE.h + 46), C.z0),
    westGateTop: () => V(C.x0, cityTop(GATE.h + 46), 0),
    ximatai: () => V(MOUND.x, moundTop + 43 * st.xi, MOUND.z + 2),
    ximataiSW: () => V(MOUND.x - 1500, PY, MOUND.z + 900),
    yunlong: () => yunlong,
    baibuhong: () => V(rockSite.x - 6, 10, rockSite.z + 10),
    bian: () => V(-2600, 0, -1040),
    bianW: () => V(-3220, 0, -1220),
    si: () => V(1335, 0, -3150),
    siNear: () => V(1010, 0, -1750),
    huanglou: () => V(C.x1 + 18, cityTop(GATE.h + 84), 0),
    fanghe: () => V(fanghe.x, fanghe.y, fanghe.z),
    dike: () => {
      const p = dikeLine[Math.round(dikeLine.length * 0.55)];
      return V(p.x, cityTop(DIKE_H), p.z);
    },
    boats: () => V(C.x1 + WALL.wb / 2 + 76, T.floodY + 7, -372),
    shore: () => shore,
    westRoad: () => V(-4300, PY, 20),
  };

  function setLabels(list, camera, size) {
    for (const p of pins) {
      pinGroup.remove(p.mesh);
      p.el.remove();
      if (p.line) p.line.remove();
      if (p.dot) p.dot.remove();
    }
    pins = [];
    for (const l of list || []) {
      const mk = sites[l.pin];
      if (!mk) continue;
      const site = mk();
      const el = document.createElement('div');
      el.className = 'pin-label' + (l.kind ? ' pin-' + l.kind : '');
      el.textContent = l.text;
      labelLayer.appendChild(el);
      const mesh = new THREE.Mesh(pinGeo, pinMat);
      mesh.castShadow = true;
      mesh.position.copy(site);
      pinGroup.add(mesh);
      const p = { ...l, site, el, mesh };
      if (l.lead && sites[l.lead]) {
        p.leadAt = sites[l.lead]();
        p.line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        p.dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        p.dot.setAttribute('r', '2.1');
        leadSvg.append(p.line, p.dot);
      }
      pins.push(p);
    }
    sizePins(camera, size);
  }
  const _v = new THREE.Vector3();
  function sizePins(camera, size) {
    const tv = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    for (const p of pins) {
      _v.copy(p.mesh.position).applyMatrix4(camera.matrixWorldInverse);
      const upp = (2 * -_v.z * tv) / size.h; // 这个距离上一个像素有多大
      const hpx = p.h || 40;
      // 针是立着的，看过去会缩短：除以视线和水平面夹角的余弦，让它在画面上正好是 hpx 高
      const dir = _v.copy(camera.position).sub(p.mesh.position).normalize();
      const fore = Math.max(0.35, Math.sqrt(1 - dir.y * dir.y));
      p.mesh.scale.set(upp * 0.8, (hpx * upp) / fore, upp * 0.8);
      p.top = new THREE.Vector3(p.mesh.position.x, p.mesh.position.y + (hpx * upp) / fore, p.mesh.position.z);
    }
  }
  function layoutLabels(camera, size) {
    leadSvg.setAttribute('viewBox', `0 0 ${size.w} ${size.h}`);
    const px = (v) => {
      _v.copy(v).project(camera);
      return [(_v.x * 0.5 + 0.5) * size.w, (-_v.y * 0.5 + 0.5) * size.h];
    };
    for (const p of pins) {
      const [x, y] = px(p.top);
      p.el.style.transform = `translate(${(x + (p.dx || 0)).toFixed(1)}px, ${(y + (p.dy || 0)).toFixed(1)}px) translate(-50%, -100%)`;
      if (p.line) {
        // 引线从牌子的上沿正中出去
        const [lx, ly] = px(p.leadAt);
        const bx = x + (p.dx || 0);
        const by = y + (p.dy || 0) - (p.el.offsetHeight || 25);
        p.line.setAttribute('x1', bx.toFixed(1));
        p.line.setAttribute('y1', by.toFixed(1));
        p.line.setAttribute('x2', lx.toFixed(1));
        p.line.setAttribute('y2', ly.toFixed(1));
        p.dot.setAttribute('cx', lx.toFixed(1));
        p.dot.setAttribute('cy', ly.toFixed(1));
      }
    }
  }

  let labelKey = null;
  function setState({ water, after: isAfter, big = 0, camera, size, labels }) {
    st.big = big;
    st.cityY = GROW.cityY(big);
    st.xi = GROW.xi(big);
    groups.before.visible = !isAfter;
    groups.after.visible = isAfter;
    groups.afterFixed.visible = isAfter;
    // 堤是水涨起来以后才筑的；水退以后留着
    groups.dikes.visible = water > 0.7 || isAfter;
    // 城墙、城楼、屋子、堤：绕着地面拉高
    for (const g of [groups.city, groups.before, groups.after, groups.dikes]) {
      g.scale.y = st.cityY;
      g.position.y = PY * (1 - st.cityY);
    }
    groups.houses.scale.y = GROW.houseY(big);
    groups.houses.position.y = PY * (1 - GROW.houseY(big));
    groups.xi.scale.setScalar(st.xi);
    const flooded = water > 0.7;
    const bKey = big.toFixed(3) + (flooded ? 'f' : 'c');
    hamletSet.userData.apply(() => [GROW.hamlet(big)], bKey);
    rocks.userData.apply(() => [GROW.rock(big)], bKey);
    boatsCalm.userData.apply(() => [GROW.boat(big)], bKey);
    boatsFlood.userData.apply(() => [GROW.boatFlood(big)], bKey);
    // 树：全景里放大；大水的时候平地上的树拉高，让水没到它三分之一的地方，不像漂在水面上的球
    const tk = GROW.tree(big);
    treeSet.userData.apply((t) => {
      if (t.kind === 'city') return [1 + 0.5 * big, 1];
      if (t.kind === 'hill') return [tk, 1];
      const k = t.kind === 'hamlet' ? GROW.hamlet(big) : flooded ? Math.max(1.5, tk) : tk;
      // 大水：水没过树冠的一半，露出来的是个圆顶（不然像漂在水上的球）
      const sink = flooded ? Math.min(0, T.floodY - PY - 1.2 * t.s * k) : 0;
      return [k, 1, sink];
    }, bKey);

    flood.visible = water > 0.001;
    // 水面：从平地下面一点（只有河道里看得见）涨到大水的水位
    flood.position.y = THREE.MathUtils.lerp(PY - 5, T.floodY, water);
    mirror.position.y = water > 0.001 ? flood.position.y + 0.4 : 0.4;
    boatsCalm.visible = water < 0.3;
    boatsFlood.visible = water > 0.7;
    boatsFlood.position.y = flood.position.y - T.floodY;
    const k = JSON.stringify(labels || []) + '|' + size.w + 'x' + size.h + '|' + bKey + '|' + camera.position.toArray().map((v) => v.toFixed(0)).join(',');
    if (k !== labelKey) {
      labelKey = k;
      setLabels(labels, camera, size);
    }
  }

  const tris =
    Object.values(groups).reduce((s, g) => s + g.userData.tris, 0) + fields.length * 12 + hamletSet.userData.tris + treeSet.userData.tris + rocks.userData.tris + boatsCalm.userData.tris + boatsFlood.userData.tris;
  return { setState, layoutLabels, groups, sites, waterMats: [matFlood, matFloodRim], counts: { tris, hamlets: hamlets.length, houses: houseItems.length, fields: fields.length, trees: treeItems.length } };
}
