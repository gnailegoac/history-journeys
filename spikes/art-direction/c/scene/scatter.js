// 城外的东西：树、村子、戏马台、百步洪的石头、船、堤、木岸、放鹤亭。
import * as THREE from 'three';
import { TABLE_M, U, LEVELS_M, yOf, CITY_M, DIKE_M, ROADS_M, forestDensity, placeM } from './terrain.js';
import { CITY_Y, WALL, GATES } from './city.js';
import { PAL } from './palette.js';
import { box, shadedBox, taper, chineseRoof, gableRoof, houseBody, merge, moved, paint } from './kit.js';
import { mulberry32, makeNoise, smoothstep, distPolyline, smoothLine, clamp } from './util.js';

const RIVER_Y = yOf(LEVELS_M.river);
const FLOOD_Y = yOf(LEVELS_M.flood);

/** 一团树冠：球心在原点的疙瘩球。下半边的顶点色压暗，球才有底、有体积。 */
function blobGeo(detail, seed, lumps = 0.16, tone = 1) {
  const g = new THREE.IcosahedronGeometry(1, detail);
  const n = makeNoise(seed);
  const p = g.attributes.position;
  const nor = new Float32Array(p.count * 3);
  const col = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    const k = 1 + (n.fbm(x * 1.7 + 5, y * 1.7 + z * 1.3, 2) - 0.5) * 2 * lumps;
    p.setXYZ(i, x * k, y * k * 0.86, z * k);
    nor[i * 3] = x;
    nor[i * 3 + 1] = y * 1.1;
    nor[i * 3 + 2] = z;
    const sh = (0.6 + 0.46 * smoothstep(-0.6, 0.5, y)) * tone;
    col[i * 3] = sh;
    col[i * 3 + 1] = sh;
    col[i * 3 + 2] = sh;
  }
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.normalizeNormals();
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

const placed = (g, sc, x, y, z) => {
  g.scale(sc, sc, sc);
  g.translate(x, y, z);
  return g;
};

/**
 * 圆树。tier 0 是远处的（两团，40 个面），1 是城附近的（三团加树干），2 是近景的（三团，更圆）。
 * 树冠抬高一点，底下露出一小截树干。
 */
function roundTreeGeo(tier, seed) {
  const trunk = (sides) => {
    const t = new THREE.CylinderGeometry(0.085, 0.13, 0.7, sides, 1, true);
    t.translate(0, 0.35, 0);
    return paint(t, PAL.trunk);
  };
  if (tier === 0) {
    return merge([placed(blobGeo(0, seed), 1, 0, 1.1, 0), placed(blobGeo(0, seed + 3, 0.16, 0.92), 0.62, 0.56, 0.8, 0.22)]);
  }
  if (tier === 1) {
    return merge([placed(blobGeo(1, seed), 1, 0, 1.2, 0), placed(blobGeo(0, seed + 3, 0.16, 0.92), 0.62, 0.6, 0.9, 0.24), trunk(5)]);
  }
  return merge([
    placed(blobGeo(2, seed, 0.2), 1, 0, 1.22, 0),
    placed(blobGeo(2, seed + 3, 0.2, 0.92), 0.64, 0.62, 0.92, 0.26),
    placed(blobGeo(1, seed + 5, 0.2, 0.86), 0.52, -0.5, 0.84, -0.38),
    trunk(7),
  ]);
}

function pineGeo() {
  const a = new THREE.ConeGeometry(0.62, 1.5, 7);
  a.translate(0, 1.0, 0);
  const b = new THREE.ConeGeometry(0.45, 1.2, 7);
  b.translate(0, 1.75, 0);
  return merge([paint(a, '#ffffff'), paint(b, '#ffffff')]);
}

function rockGeo(seed) {
  const g = new THREE.IcosahedronGeometry(1, 1);
  const p = g.attributes.position;
  // 同一位置的顶点要挪同样多：按位置算随机
  const n = makeNoise(seed);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    const k = 0.72 + n(x * 2.3 + 9, y * 2.3 + z * 1.9 + 4) * 0.56;
    p.setXYZ(i, x * k, Math.max(-0.25, y * k * 0.7), z * k);
  }
  g.computeVertexNormals(); // 不共用顶点，出来就是一块一块的石头面
  return paint(g, '#ffffff');
}

function boatGeo(covered) {
  const L = 0.34;
  const B = 0.085;
  const N = 8;
  const pos = [];
  const col = [];
  const hull = new THREE.Color(PAL.hull);
  const deck = new THREE.Color(PAL.deck);
  const sec = (i) => {
    const t = -1 + (2 * i) / N;
    const w = B * Math.pow(1 - Math.pow(Math.abs(t), 2.4), 0.8);
    const sheer = 0.05 + 0.045 * t * t;
    const keel = -0.03 + 0.05 * t * t;
    return { z: t * L, w, sheer, keel };
  };
  const tri = (a, b, c, color) => {
    pos.push(...a, ...b, ...c);
    for (let k = 0; k < 3; k++) col.push(color.r, color.g, color.b);
  };
  for (let i = 0; i < N; i++) {
    const a = sec(i);
    const b = sec(i + 1);
    for (const s of [1, -1]) {
      const a0 = [s * a.w * 0.55, a.keel, a.z];
      const a1 = [s * a.w, a.sheer, a.z];
      const b0 = [s * b.w * 0.55, b.keel, b.z];
      const b1 = [s * b.w, b.sheer, b.z];
      if (s > 0) {
        tri(a0, b0, b1, hull);
        tri(a0, b1, a1, hull);
      } else {
        tri(a0, b1, b0, hull);
        tri(a0, a1, b1, hull);
      }
    }
    // 舱面
    const da = a.sheer - 0.018;
    const db = b.sheer - 0.018;
    tri([-a.w * 0.92, da, a.z], [a.w * 0.92, da, a.z], [b.w * 0.92, db, b.z], deck);
    tri([-a.w * 0.92, da, a.z], [b.w * 0.92, db, b.z], [-b.w * 0.92, db, b.z], deck);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  const parts = [g];
  if (covered) {
    const aw = new THREE.CylinderGeometry(B * 0.86, B * 0.86, L * 0.72, 8, 1, true, -Math.PI / 2, Math.PI);
    aw.rotateX(-Math.PI / 2);
    aw.translate(0, 0.045, 0.03);
    parts.push(paint(aw, PAL.awning));
    parts.push(box(0.012, 0.22, 0.012, PAL.timberDark, 0, 0.04, -L * 0.52));
  }
  return merge(parts);
}

function ribbon(path, profile, hex, yBaseAt) {
  // path: [[x,z]...] 场景单位；profile: [[横向偏移, 高度]...]，高度为负表示贴到地面
  const pos = [];
  const m = profile.length;
  const rows = path.map((p, i) => {
    const a = path[Math.max(0, i - 1)];
    const b = path[Math.min(path.length - 1, i + 1)];
    let tx = b[0] - a[0];
    let tz = b[1] - a[1];
    const l = Math.hypot(tx, tz) || 1;
    tx /= l;
    tz /= l;
    return profile.map(([o, y]) => {
      const x = p[0] - tz * o;
      const z = p[1] + tx * o;
      return [x, y === null ? yBaseAt(x, z) : y, z];
    });
  });
  for (let i = 0; i < rows.length - 1; i++) {
    for (let k = 0; k < m - 1; k++) {
      const a = rows[i][k];
      const b = rows[i][k + 1];
      const c = rows[i + 1][k + 1];
      const d = rows[i + 1][k];
      pos.push(...a, ...d, ...c, ...a, ...c, ...b);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  // 保证朝上
  const nrm = g.attributes.normal;
  let up = 0;
  for (let i = 0; i < nrm.count; i++) up += nrm.getY(i);
  if (up < 0) {
    const p = g.attributes.position.array;
    for (let i = 0; i < p.length; i += 9) {
      for (let k = 0; k < 3; k++) {
        const t = p[i + 3 + k];
        p[i + 3 + k] = p[i + 6 + k];
        p[i + 6 + k] = t;
      }
    }
    g.computeVertexNormals();
  }
  return paint(g, hex);
}

export function buildScatter({ td, mats, patch, cityTreeSpots }) {
  const group = new THREE.Group();
  const rnd = mulberry32(90210);
  const groveNoise = makeNoise(314);
  const T = TABLE_M;
  const yAt = (x, z) => td.yAtM(x / U, z / U); // 场景单位进，场景单位出
  const roadsU = ROADS_M;

  const bodyParts = [];
  const roofParts = [];
  const footprints = [{ x: placeM('ximatai')[0] * U, z: placeM('ximatai')[1] * U, w: 1.5, d: 1.24, ry: 0 }];

  // —— 戏马台：土山上一座夯土的台子，台上一座红柱子的殿。单独成组，全景里绕着底座放大 ——
  const [xmx, xmz] = placeM('ximatai');
  const XM = [xmx * U, xmz * U];
  const ximatai = new THREE.Group();
  {
    const eb = [];
    const bb = [];
    const rb = [];
    // 台身往下多做一截，放大以后也不会悬在坡上
    eb.push(taper(1.62, 1.36, 1.34, 1.08, 1.02, PAL.dike, 0, -0.6, 0, 1.6));
    const top = 0.42;
    // 台面压一圈石头边，四周矮栏杆
    bb.push(box(1.38, 0.03, 1.12, PAL.stone, 0, top - 0.005, 0));
    for (const s2 of [1, -1]) {
      bb.push(box(1.32, 0.05, 0.03, PAL.stone, 0, top + 0.02, s2 * 0.52));
      bb.push(box(0.03, 0.05, 1.06, PAL.stone, s2 * 0.65, top + 0.02, 0));
    }
    // 北面的台阶（朝城里）
    for (let i = 0; i < 5; i++) bb.push(box(0.4, 0.44 - i * 0.09, 0.1, PAL.stone, 0, 0, -0.62 - 0.05 - i * 0.1));
    bb.push(box(0.92, 0.04, 0.56, PAL.stone, 0, top + 0.02, 0.06));
    // 殿：红墙红柱
    bb.push(shadedBox(0.78, 0.2, 0.4, '#A8573F', 0, top + 0.06, 0.06, 0.36, 0.6));
    for (let i = 0; i <= 4; i++) for (const s2 of [1, -1]) bb.push(shadedBox(0.034, 0.2, 0.034, PAL.timberDeep, -0.4 + i * 0.2, top + 0.06, 0.06 + s2 * 0.21, 0.36, 0.6));
    for (let i = 0; i < 4; i++) for (const s2 of [1, -1]) bb.push(box(0.12, 0.12, 0.012, PAL.window, -0.3 + i * 0.2, top + 0.09, 0.06 + s2 * 0.2));
    const r = chineseRoof(0.84, 0.44, 0.27, { style: 'xieshan', over: 0.15, up: 0.07, rings: 5, seg: 6, gable: PAL.tileDark });
    rb.push(moved(r.roof, 0, top + 0.26, 0.06));
    bb.push(moved(r.trim, 0, top + 0.26, 0.06));
    for (const [parts, mat] of [
      [eb, mats.earth],
      [bb, mats.body],
      [rb, mats.roof],
    ]) {
      const m = new THREE.Mesh(merge(parts), mat);
      m.castShadow = true;
      m.receiveShadow = true;
      ximatai.add(m);
    }
    ximatai.position.set(XM[0], yAt(XM[0], XM[1]) - 0.1, XM[1]);
    ximatai.name = 'ximatai';
    group.add(ximatai);
  }

  // —— 村子 ——
  const hamlets = [];
  const hamletTrees = [];
  {
    let tries = 0;
    while (hamlets.length < 17 && tries < 600) {
      tries++;
      const x = T.minX + 300 + rnd() * (T.maxX - T.minX - 600);
      const z = T.minZ + 300 + rnd() * (T.maxZ - T.minZ - 600);
      if (td.hAtM(x, z) > 40.6) continue;
      if (td.riverSD(x, z) < 130) continue;
      if (td.citySD(x, z) < 500) continue;
      if (x > 700 && x < 2000 && z > -500 && z < 1000) continue;
      if (hamlets.some((h) => Math.hypot(h[0] - x, h[1] - z) < 1300)) continue;
      hamlets.push([x, z]);
      const n = 4 + Math.floor(rnd() * 4);
      const base = rnd() * Math.PI;
      for (let i = 0; i < n; i++) {
        const a = rnd() * Math.PI * 2;
        const r = 30 + rnd() * 105;
        const hx = (x + Math.cos(a) * r) * U;
        const hz = (z + Math.sin(a) * r * 0.7) * U;
        const w = 0.34 + rnd() * 0.16;
        const ry = base + (rnd() < 0.3 ? Math.PI / 2 : 0) + (rnd() - 0.5) * 0.3;
        const y = yAt(hx, hz) - 0.01;
        footprints.push({ x: hx, z: hz, w, d: 0.23, ry });
        bodyParts.push(moved(houseBody(w, 0.23, 0.1, 0.1, '#E0D2B6'), hx, y, hz, ry));
        roofParts.push(moved(gableRoof(w, 0.23, 0.1, 0.035, rnd() < 0.25 ? PAL.tile : PAL.thatch), hx, y + 0.1, hz, ry));
      }
      for (let i = 0; i < 4; i++) {
        const a = rnd() * Math.PI * 2;
        const r = 60 + rnd() * 120;
        hamletTrees.push([(x + Math.cos(a) * r) * U, (z + Math.sin(a) * r) * U]);
      }
    }
  }

  // —— 张山人的草屋：云龙山西脚，大水淹到门扇的一半 ——
  let hut = null;
  {
    const [yx, yz] = placeM('yunlongshan');
    let x = yx;
    const z = yz - 250;
    while (x > yx - 1500 && td.yAtM(x, z) > FLOOD_Y - 0.065) x -= 10;
    hut = [x * U, z * U];
    const y = yAt(hut[0], hut[1]);
    bodyParts.push(moved(houseBody(0.36, 0.24, 0.12, 0.11, '#DCCDB0'), hut[0], y, hut[1], 0.3));
    bodyParts.push(moved(box(0.07, 0.09, 0.012, PAL.timberDark, 0, 0, 0.121), hut[0], y, hut[1], 0.3));
    roofParts.push(moved(gableRoof(0.36, 0.24, 0.11, 0.045, PAL.thatch), hut[0], y + 0.12, hut[1], 0.3));
  }

  // —— 放鹤亭（水退以后才有） ——
  const fanghe = new THREE.Group();
  {
    const [fx, fz] = placeM('fangheting');
    const x = fx * U;
    const z = fz * U;
    const y = yAt(x, z) - 0.03;
    const b = [box(0.5, 0.05, 0.5, PAL.stone, x, y, z)];
    for (const sx of [1, -1]) for (const sz of [1, -1]) b.push(box(0.035, 0.24, 0.035, PAL.timber, x + sx * 0.17, y + 0.05, z + sz * 0.17));
    const r = chineseRoof(0.4, 0.4, 0.22, { style: 'pyramid', over: 0.13, up: 0.07, rings: 4, seg: 4 });
    b.push(moved(r.trim, x, y + 0.29, z));
    const m1 = new THREE.Mesh(merge(b), mats.body);
    const m2 = new THREE.Mesh(moved(r.roof, x, y + 0.29, z), mats.roof);
    fanghe.add(m1, m2);
  }

  // —— 树 ——
  const trees = { r0: [], r1: [], r2: [], pine: [] };
  const eg = GATES.east;
  const pushTree = (x, z, kind, scale, tone) => {
    const y = yAt(x, z);
    const dGate = Math.hypot(x - eg.x, z - eg.z);
    const dCity = Math.hypot(x, z);
    const item = { x, y, z, s: scale, tone, r: rnd() * Math.PI * 2 };
    if (kind === 'pine') trees.pine.push(item);
    else if (dGate < 6.5) trees.r2.push(item);
    else if (dCity < 20) trees.r1.push(item);
    else trees.r0.push(item);
  };
  const greens = [PAL.treeDeep, PAL.treeMid, PAL.treeMid, PAL.treeLight];
  const step = 62;
  for (let zc = T.minZ + 60; zc < T.maxZ - 60; zc += step) {
    for (let xc = T.minX + 60; xc < T.maxX - 60; xc += step) {
      const x = xc + (rnd() - 0.5) * step * 0.9;
      const z = zc + (rnd() - 0.5) * step * 0.9;
      const u = rnd();
      const sdC = td.citySD(x, z);
      if (sdC < 70) continue;
      // 东门对岸留一块空地：近景镜头的相机就架在这里
      if (x > 900 && x < 2500 && z > -450 && z < 850) continue;
      const sdR = td.riverSD(x, z);
      if (sdR < 28) continue;
      if (distPolyline(x, z, roadsU[0]) < 38 || distPolyline(x, z, roadsU[1]) < 38) continue;
      if (Math.hypot(x - xmx, z - xmz) < 175) continue;
      const h = td.hAtM(x, z);
      const hill = smoothstep(41.0, 43.4, h);
      const sl = td.slopeAtM(x, z);
      let p;
      let kind = 'round';
      let tone;
      if (hill > 0.5) {
        const f = forestDensity(x, z);
        p = smoothstep(0.48, 0.6, f) * 0.4 * (1 - smoothstep(0.26, 0.46, sl) * 0.8) + 0.018;
        kind = rnd() < 0.6 ? 'pine' : 'round';
        tone = kind === 'pine' ? PAL.pine : rnd() < 0.6 ? PAL.treeDeep : PAL.treeMid;
      } else if (sdR < 120) {
        p = 0.1; // 河边的柳树
        tone = rnd() < 0.7 ? PAL.treeLight : PAL.treeMid;
      } else {
        const g = groveNoise.fbm(x / 380, z / 380, 2);
        p = 0.0012 + 0.4 * smoothstep(0.71, 0.77, g) + 0.03 * hill;
        tone = greens[Math.floor(rnd() * greens.length)];
      }
      if (u > p) continue;
      const s = kind === 'pine' ? 0.19 + rnd() * 0.11 : 0.2 + rnd() * 0.13;
      pushTree(x * U, z * U, kind, s, tone);
    }
  }
  // 路边一行树
  for (const road of roadsU) {
    for (let i = 4; i < road.length - 1; i += 2) {
      const a = road[i - 1];
      const b = road[i + 1];
      const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      const side = (i / 2) % 2 ? 1 : -1;
      const x = road[i][0] - ((b[1] - a[1]) / l) * 48 * side;
      const z = road[i][1] + ((b[0] - a[0]) / l) * 48 * side;
      if (rnd() < 0.3) continue;
      if (x < T.minX + 80 || x > T.maxX - 80 || z < T.minZ + 80 || z > T.maxZ - 80) continue;
      if (td.citySD(x, z) < 80 || td.riverSD(x, z) < 30 || Math.hypot(x - xmx, z - xmz) < 185) continue;
      pushTree(x * U, z * U, 'round', 0.22 + rnd() * 0.1, rnd() < 0.5 ? PAL.treeMid : PAL.treeLight);
    }
  }
  for (const [x, z] of hamletTrees) pushTree(x, z, 'round', 0.2 + rnd() * 0.1, greens[Math.floor(rnd() * 4)]);
  // 城里的树矮一点，树梢不高过屋脊
  for (const [x, z] of cityTreeSpots) pushTree(x, z, 'round', 0.105 + rnd() * 0.04, rnd() < 0.5 ? PAL.treeMid : PAL.treeLight);
  // 戏马台旁边几棵松
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2 + 0.4;
    const r = 1.95 + rnd() * 0.45;
    const kind = rnd() < 0.6 ? 'pine' : 'round';
    pushTree(XM[0] + Math.cos(a) * r, XM[1] + Math.sin(a) * r * 0.92, kind, 0.2 + rnd() * 0.08, kind === 'pine' ? PAL.pine : PAL.treeDeep);
  }
  const treeMat = mats.plain({ vertexColors: true, roughness: 0.9, envMapIntensity: 0.45 });
  const dummy = new THREE.Object3D();
  const color = new THREE.Color();
  const makeInst = (geo, list, yScale = 1) => {
    const im = new THREE.InstancedMesh(geo, treeMat, Math.max(1, list.length));
    im.count = list.length;
    list.forEach((t, i) => {
      dummy.position.set(t.x, t.y - 0.02, t.z);
      dummy.rotation.set(0, t.r, 0);
      dummy.scale.set(t.s, t.s * yScale * (0.9 + (i % 5) * 0.05), t.s);
      dummy.updateMatrix();
      im.setMatrixAt(i, dummy.matrix);
      color.set(t.tone);
      const k = 0.92 + ((i * 37) % 17) / 100;
      color.multiplyScalar(k);
      im.setColorAt(i, color);
    });
    im.castShadow = true;
    im.receiveShadow = true;
    im.frustumCulled = false;
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
    return im;
  };
  group.add(makeInst(roundTreeGeo(0, 1), trees.r0));
  group.add(makeInst(roundTreeGeo(1, 2), trees.r1));
  group.add(makeInst(roundTreeGeo(2, 3), trees.r2));
  group.add(makeInst(pineGeo(), trees.pine));

  // —— 百步洪：河心的乱石和白水 ——
  const joined = td.rivers.joined.pts;
  const [bx, bz] = placeM('baibuhong');
  let bi = 0;
  let bd = Infinity;
  joined.forEach((p, i) => {
    const d = Math.hypot(p[0] - bx, p[1] - bz);
    if (d < bd) {
      bd = d;
      bi = i;
    }
  });
  const rapids = [joined[bi][0] * U, joined[bi][1] * U];
  const rocks = [];
  const foam = [];
  {
    const dir = [joined[bi + 3][0] - joined[bi - 3][0], joined[bi + 3][1] - joined[bi - 3][1]];
    const dl = Math.hypot(dir[0], dir[1]);
    dir[0] /= dl;
    dir[1] /= dl;
    for (let i = 0; i < 26; i++) {
      const along = (rnd() - 0.5) * 5.2;
      const across = (rnd() - 0.5) * 2.0 * (1 - Math.abs(along) / 4.5);
      const x = rapids[0] + dir[0] * along - dir[1] * across;
      const z = rapids[1] + dir[1] * along + dir[0] * across;
      const s = 0.09 + rnd() * 0.17;
      rocks.push({ x, y: RIVER_Y - 0.02, z, s, r: rnd() * 6.28, tone: rnd() < 0.5 ? '#6F7B80' : '#59646A', sy: 0.7 + rnd() * 0.5 });
      foam.push({ x: x + dir[0] * s * 1.6, z: z + dir[1] * s * 1.6, s: s * (1.1 + rnd() * 0.6), r: Math.atan2(dir[0], dir[1]) });
    }
    // 云龙山黄茅冈上的乱石，“如群羊”
    const [yx, yz] = placeM('yunlongshan');
    for (let i = 0; i < 120; i++) {
      const xm = yx + (rnd() - 0.5) * 520 + (rnd() - 0.5) * 300;
      const zm = yz - 150 + (rnd() - 0.5) * 1500;
      const s = 0.06 + rnd() * 0.09;
      if (td.hAtM(xm, zm) < 50) continue; // 只摆在山上
      const x = xm * U;
      const z = zm * U;
      rocks.push({ x, y: yAt(x, z) - 0.01, z, s, r: rnd() * 6.28, tone: rnd() < 0.5 ? '#D8D2C6' : '#C4BDB0', sy: 0.8 });
    }
  }
  const rockMat = mats.plain({ vertexColors: true, roughness: 0.8, flatShading: true });
  const rockIM = new THREE.InstancedMesh(rockGeo(8), rockMat, rocks.length);
  rocks.forEach((t, i) => {
    dummy.position.set(t.x, t.y, t.z);
    dummy.rotation.set(0, t.r, 0);
    dummy.scale.set(t.s, t.s * t.sy, t.s * 0.8);
    dummy.updateMatrix();
    rockIM.setMatrixAt(i, dummy.matrix);
    rockIM.setColorAt(i, color.set(t.tone));
  });
  rockIM.castShadow = true;
  rockIM.receiveShadow = true;
  rockIM.frustumCulled = false;
  group.add(rockIM);
  const foamMat = new THREE.MeshBasicMaterial({ color: '#F6FBF8', transparent: true, opacity: 0.8, depthWrite: false });
  const foamGeo = new THREE.CircleGeometry(1, 14);
  foamGeo.rotateX(-Math.PI / 2);
  const foamIM = new THREE.InstancedMesh(foamGeo, foamMat, foam.length);
  foam.forEach((t, i) => {
    dummy.position.set(t.x, RIVER_Y + 0.006, t.z);
    dummy.rotation.set(0, t.r, 0);
    dummy.scale.set(t.s * 0.55, 1, t.s * 1.5);
    dummy.updateMatrix();
    foamIM.setMatrixAt(i, dummy.matrix);
  });
  foamIM.renderOrder = 7;
  foamIM.frustumCulled = false;
  group.add(foamIM);

  // —— 堤 ——
  const dikeGroup = new THREE.Group();
  const dikePath = smoothLine(
    DIKE_M.map(([x, z]) => [x * U, z * U]),
    0.25,
  );
  // 两头接进戏马台的坡脚和城墙
  const crest = FLOOD_Y + 0.4;
  const dikeBase = (x, z) => Math.min(crest - 0.02, yAt(x, z) - 0.06);
  const dikeGeo = merge([
    ribbon(
      dikePath,
      [
        [-0.5, null],
        [-0.17, crest],
      ],
      PAL.dikeSide,
      dikeBase,
    ),
    ribbon(
      dikePath,
      [
        [-0.17, crest],
        [0.17, crest],
      ],
      PAL.dikeTop,
      dikeBase,
    ),
    ribbon(
      dikePath,
      [
        [0.17, crest],
        [0.5, null],
      ],
      PAL.dikeSide,
      dikeBase,
    ),
  ]);
  // 城里贴着城墙的一道
  const inner = 5.98 - 0.5;
  const innerPath = [];
  const addSeg = (ax, az, bx2, bz2) => {
    const n = Math.round(Math.hypot(bx2 - ax, bz2 - az) / 0.5);
    for (let i = 0; i < n; i++) innerPath.push([ax + ((bx2 - ax) * i) / n, az + ((bz2 - az) * i) / n]);
  };
  addSeg(-inner, 2.5, -inner, -inner + 0.25);
  addSeg(-inner + 0.25, -inner, inner - 0.25, -inner);
  addSeg(inner, -inner + 0.25, inner, inner - 0.25);
  addSeg(inner - 0.25, inner, 1.2, inner);
  innerPath.push([1.2, inner]);
  const innerGeo = ribbon(
    innerPath,
    [
      [-0.2, CITY_Y - 0.01],
      [-0.085, CITY_Y + 0.2],
      [0.085, CITY_Y + 0.2],
      [0.2, CITY_Y - 0.01],
    ],
    PAL.dike,
    () => CITY_Y,
  );
  const dikeMat = mats.plain({ vertexColors: true, roughness: 0.95, side: THREE.DoubleSide });
  const dikeMesh = new THREE.Mesh(merge([dikeGeo, innerGeo]), dikeMat);
  dikeMesh.castShadow = true;
  dikeMesh.receiveShadow = true;
  dikeGroup.add(dikeMesh);
  group.add(dikeGroup);
  const dm = dikePath[Math.floor(dikePath.length * 0.5)];
  const dikeMid = [dm[0], crest, dm[1]];

  // —— 船 ——
  const boatMat = mats.plain({ vertexColors: true, roughness: 0.75, side: THREE.DoubleSide });
  const boatsNormal = [];
  const boatsFlood = [];
  const B = (list, x, z, r, covered, s = 1) => list.push({ x, z, r: r + (rnd() - 0.5) * 0.14, covered, s: s * (0.92 + rnd() * 0.16) });
  // 平时：东门外河边泊着一排，北门外几条，河上零星几条
  {
    const bankX = (z) => {
      // 泗水西岸：从城墙往外找水边
      let x = GATES.east.x + WALL.baseHalf;
      while (x < GATES.east.x + 4 && yAt(x, z) > RIVER_Y - 0.02) x += 0.02;
      return x;
    };
    for (const z of [-2.7, -2.1, -1.5, 1.2, 1.75, 2.35, 3.0]) B(boatsNormal, bankX(z) + 0.12 + rnd() * 0.05, z, 0, rnd() < 0.6);
    B(boatsNormal, bankX(0) + 0.56, 0.3, 0.25, true, 1.1);
    B(boatsNormal, bankX(0) + 0.5, -0.36, -0.1, false, 1.0);
    B(boatsNormal, bankX(-0.9) + 0.14, -0.9, 0.0, false);
    const river = (key, idx, off, r, cov) => {
      const p = td.rivers[key].pts;
      const i = clamp(idx, 1, p.length - 2);
      const tx = p[i + 1][0] - p[i - 1][0];
      const tz = p[i + 1][1] - p[i - 1][1];
      const l = Math.hypot(tx, tz);
      B(boatsNormal, (p[i][0] - (tz / l) * off) * U, (p[i][1] + (tx / l) * off) * U, Math.atan2(tx, tz) + r, cov);
    };
    const nb = td.rivers.bian.pts.length;
    for (const [k, off, cov] of [
      [nb - 8, 30, true],
      [nb - 14, -25, false],
      [nb - 22, 35, true],
      [nb - 40, 10, false],
      [nb - 70, -20, true],
      [nb - 110, 15, true],
    ])
      river('bian', k, off, 0, cov);
    const ns = td.rivers.si.pts.length;
    for (const [k, off, cov] of [
      [ns - 12, 30, true],
      [ns - 30, -30, false],
      [ns - 62, 20, true],
    ])
      river('si', k, off, 0, cov);
    for (const [k, off, cov] of [
      [bi - 18, 40, true],
      [bi - 12, -50, false],
      [bi + 22, 20, true],
      [bi + 40, -30, true],
      [bi + 75, 10, false],
    ])
      river('joined', k, off, 0, cov);
  }
  // 大水时：几百条船分开系在城下，一排一排
  {
    const X1 = GATES.east.x;
    const Z0 = GATES.north.z;
    const X0 = GATES.west.x;
    for (let row = 0; row < 3; row++) {
      const o = 0.86 + row * 0.44;
      for (let t = -5.5 + (row % 2) * 0.5; t <= 5.5; t += 1.04) {
        if (Math.abs(t) < 0.95 && row === 0) continue;
        B(boatsFlood, X1 + o, t, 0, (row + Math.round(t * 3)) % 3 !== 0, 1.4); // 东墙外
        B(boatsFlood, t, Z0 - o, Math.PI / 2, (row + Math.round(t * 5)) % 3 !== 0, 1.4); // 北墙外
        if (row < 2 && t < 4.4) B(boatsFlood, X0 - o, t, 0, (row + Math.round(t * 7)) % 3 !== 0, 1.4); // 西墙外
      }
    }
  }
  const mkBoats = (list) => {
    const g = new THREE.Group();
    for (const cov of [true, false]) {
      const sub = list.filter((b) => b.covered === cov);
      const im = new THREE.InstancedMesh(boatGeo(cov), boatMat, Math.max(1, sub.length));
      im.count = sub.length;
      sub.forEach((b, i) => {
        dummy.position.set(b.x, 0, b.z);
        dummy.rotation.set(0, b.r, 0);
        dummy.scale.setScalar(b.s);
        dummy.updateMatrix();
        im.setMatrixAt(i, dummy.matrix);
      });
      im.castShadow = true;
      im.receiveShadow = true;
      im.frustumCulled = false;
      g.add(im);
    }
    return g;
  };
  const boatsA = mkBoats(boatsNormal);
  boatsA.position.y = RIVER_Y - 0.008;
  const boatsB = mkBoats(boatsFlood);
  boatsB.position.y = FLOOD_Y - 0.008;
  group.add(boatsA, boatsB);

  // —— 木岸和小码头（水退以后）：东门外水冲得最凶的一段 ——
  const revet = new THREE.Group();
  {
    const parts = [];
    const edgeX = (z) => {
      let x = GATES.east.x + WALL.baseHalf;
      while (x < GATES.east.x + 4 && yAt(x, z) > RIVER_Y - 0.004) x += 0.01;
      return x;
    };
    let prev = null;
    for (let z = -2.3; z <= 2.3001; z += 0.075) {
      const x = edgeX(z) - 0.01;
      const hgt = 0.17 + ((Math.round(z * 40) % 3) - 1) * 0.008;
      parts.push(box(0.045, hgt, 0.045, '#8B6B4C', x, RIVER_Y - 0.09, z));
      if (prev) parts.push(box(0.03, 0.03, 0.08, '#7A5B40', (x + prev) / 2 - 0.03, RIVER_Y + 0.03, z - 0.0375));
      prev = x;
    }
    // 小码头
    const jx = edgeX(0);
    parts.push(box(0.5, 0.02, 0.26, PAL.deck, jx + 0.2, RIVER_Y + 0.075, 0));
    for (const dx of [0.0, 0.2, 0.42]) for (const dz of [-0.11, 0.11]) parts.push(box(0.03, 0.2, 0.03, '#7A5B40', jx + dx, RIVER_Y - 0.1, dz));
    const m = new THREE.Mesh(merge(parts), mats.body);
    m.castShadow = true;
    m.receiveShadow = true;
    revet.add(m);
  }
  group.add(revet);

  // —— 东门外到河边的石板路 ——
  {
    let xe = GATES.east.x + 0.5;
    while (xe < GATES.east.x + 4 && yAt(xe, 0) > RIVER_Y + 0.05) xe += 0.02;
    const path = [];
    for (let x = GATES.east.x + 0.5; x <= xe + 0.001; x += 0.05) path.push([x, 0]);
    if (path.length > 1) {
      bodyParts.push(
        ribbon(
          path,
          [
            [-0.21, null],
            [0.21, null],
          ],
          '#CFC8B8',
          (x, z) => yAt(x, z) + 0.014,
        ),
      );
    }
  }

  const body = new THREE.Mesh(merge(bodyParts), mats.body);
  const roofs = new THREE.Mesh(merge(roofParts), mats.roof);
  for (const m of [body, roofs, ...fanghe.children]) {
    m.castShadow = true;
    m.receiveShadow = true;
  }
  group.add(body, roofs, fanghe);

  const riverPoint = (key, coord) => {
    const pts = td.rivers[key].pts;
    const axis = key === 'bian' ? 0 : 1;
    let best = pts[0];
    let d = Infinity;
    for (const p of pts) {
      const v = Math.abs(p[axis] - coord);
      if (v < d) {
        d = v;
        best = p;
      }
    }
    return [best[0] * U, RIVER_Y + 0.02, best[1] * U];
  };

  function setEra(era, flood) {
    fanghe.visible = era === 'after';
    dikeGroup.visible = era !== 'before';
    dikeMat.color.set(era === 'after' ? '#C9C6B4' : '#FFFFFF');
    revet.visible = era === 'after';
    boatsA.visible = !flood;
    boatsB.visible = flood;
    foamIM.visible = !flood;
  }

  return { group, rapids, riverPoint, dikeMid, setEra, hut, footprints, ximatai, counts: { trees: trees.r0.length + trees.r1.length + trees.r2.length + trees.pine.length, r0: trees.r0.length, r1: trees.r1.length, r2: trees.r2.length, pine: trees.pine.length, hamlets: hamlets.length, boatsFlood: boatsFlood.length } };
}
