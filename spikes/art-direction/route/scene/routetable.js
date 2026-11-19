// 全程沙盘：把地形、水、路线、座子、灯、镜头装起来。
// 页面只用 createRouteTable(canvas, …) 返回的几样：setShot、render、project、heading、pxPer、onAfterRender。

import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { TABLE, toKm } from './proj.js';
import { prepare, build, RELIEF, TEX, U } from './fields.js';
import { buildLegs, strokes } from './route.js';
import { buildTable, layerTexture, BLOCK_BASE_Y } from './table.js';
import { PAL } from './palette.js';
import { clamp, hex } from './util.js';

const HX = (TABLE.w / 2) * U;
const HZ = (TABLE.h / 2) * U;
/** 经纬度 -> 场景里的 [x, z] */
export const sceneXZ = (lng, lat) => {
  const [x, y] = toKm(lng, lat);
  return [x * U, -y * U];
};

/**
 * 镜头。az：镜头在目标的哪一边（0 是正南），el：俯角，dist：远近（场景单位）。
 * at：看着哪里（经纬度）。fit / fitMin：画面比设计时窄就退远些。view：整个画面往下挪多少（占画面高的几分之几），viewNarrow 是手机上的。
 * line：线比整张图上粗多少倍。corner：路线拐角抹圆的半径（公里）。
 */
export const SHOTS = {
  whole: { at: [112.25, 28.25], az: 0, el: 50, dist: 58000, fov: 18, fit: 0.978, fitMin: 0.8, view: [0, -0.112], ripple: 0.5, line: 1 },
  leg: { at: [117.95, 34.1], az: 0, el: 44, dist: 23000, fov: 18, fit: 0.978, fitMin: 0.8, view: [0, -0.172], ripple: 0.5, line: 1.45, corner: 9 },
  relief: { at: [108.4, 30.9], az: 10, el: 25, dist: 12400, fov: 22, fit: 1.6, fitMin: 0.9, view: [0, -0.05], ripple: 0.45, line: 1.5 },
  top: { at: [112.25, 28.25], az: 0, el: 89.6, dist: 300000, fov: 3.5, fit: 1.6, fitMin: 1, view: [0, 0], ripple: 0.62, line: 1 },
};
const LIGHT0 = { dir: [-0.66, 0.6, -0.42], sun: 2.6, sunColor: '#fff4e2', hemi: 1.55, sky: '#fffaf0', ground: '#c4b494', radius: 2.2, bias: -0.0006, nb: 1.6 };

const WATER_GLSL = /* glsl */ `
varying vec3 vWPos;
uniform vec3 uShallow;
uniform vec3 uDeep;
uniform vec3 uFoam;
uniform float uDense;
float whash(vec2 p){ p = fract(p * vec2(127.1, 311.7)); p += dot(p, p + 34.5); return fract(p.x * p.y); }
float wnoise(vec2 p){
  vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(whash(i), whash(i + vec2(1.0, 0.0)), u.x), mix(whash(i + vec2(0.0, 1.0)), whash(i + vec2(1.0, 1.0)), u.x), u.y);
}
// 一组水纹：东西向的细波线，断断续续（同站点沙盘的水一样）
float rippleOct(vec2 p, float s){
  float w = p.y / s + 0.26 * sin(p.x / (s * 2.6) + 1.1 * sin(p.y / (s * 5.1))) + 0.07 * sin(p.x / (s * 0.95) + p.y / (s * 3.0));
  float f = abs(fract(w) - 0.5) * 2.0;
  float fw = fwidth(w) * 2.0;
  float line = 1.0 - smoothstep(0.04, 0.05 + fw, f);
  float seg = sin(p.x / (s * 2.1) + floor(w) * 2.4) + 0.5 * sin(p.x / (s * 0.83) + floor(w) * 5.1);
  return line * smoothstep(0.15, 0.7, seg);
}
// 水纹的疏密跟着镜头远近变：屏幕上总是差不多一样密
float ripples(vec2 p){
  float px = max(fwidth(p.x), fwidth(p.y));
  float target = max(px * 8.0, 4.0);
  float l = log2(target / 4.0);
  float l0 = floor(l);
  float fr = l - l0;
  float s0 = 4.0 * exp2(l0);
  float a = rippleOct(p, s0);
  float b = rippleOct(p + 37.0, s0 * 2.0);
  float clump = smoothstep(uDense, uDense + 0.22, wnoise(p / (target * 20.0) + 3.1));
  return mix(a, b, smoothstep(0.0, 1.0, fr)) * clump;
}
`;

export async function createRouteTable(canvas, { shot = 'whole', relief = 'a', dataBase = './data/' } = {}) {
  const t0 = performance.now();
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setClearColor(0x000000, 0);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(18, 1, 400, 90000);

  const [demBuf, water, song, fig] = await Promise.all([
    fetch(dataBase + 'dem.bin').then((r) => r.arrayBuffer()),
    fetch(dataBase + 'water.json').then((r) => r.json()),
    fetch(dataBase + 'song-overlay.json').then((r) => r.json()),
    fetch(dataBase + 'figure.json').then((r) => r.json()),
  ]);
  const tLoaded = performance.now();
  const rel = RELIEF[relief] || RELIEF.a;
  const prep = prepare(new Int16Array(demBuf), water, song);
  const td = build(prep, rel);
  const tBuilt = performance.now();
  const yAt = (x, z) => td.heightAt(x / U, -z / U);

  // ---------- 地形板 ----------
  const SX = 286;
  const SZ = 323;
  const nv = (SX + 1) * (SZ + 1);
  const pos = new Float32Array(nv * 3);
  const uv = new Float32Array(nv * 2);
  const nor = new Float32Array(nv * 3);
  for (let j = 0; j <= SZ; j++) for (let i = 0; i <= SX; i++) {
    const k = j * (SX + 1) + i;
    const x = -HX + (i / SX) * 2 * HX;
    const z = -HZ + (j / SZ) * 2 * HZ;
    pos[k * 3] = x;
    pos[k * 3 + 1] = yAt(x, z);
    pos[k * 3 + 2] = z;
    uv[k * 2] = i / SX;
    uv[k * 2 + 1] = j / SZ;
    nor[k * 3 + 1] = 1;
  }
  const idx = new Uint32Array(SX * SZ * 6);
  let t = 0;
  for (let j = 0; j < SZ; j++) for (let i = 0; i < SX; i++) {
    const a = j * (SX + 1) + i;
    const b = a + 1;
    const c = a + SX + 1;
    const d = c + 1;
    idx[t++] = a;
    idx[t++] = c;
    idx[t++] = b;
    idx[t++] = b;
    idx[t++] = c;
    idx[t++] = d;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));

  const map = new THREE.DataTexture(td.color, TEX.w, TEX.h, THREE.RGBAFormat, THREE.UnsignedByteType);
  map.colorSpace = THREE.SRGBColorSpace;
  map.magFilter = THREE.LinearFilter;
  map.minFilter = THREE.LinearMipmapLinearFilter;
  map.generateMipmaps = true;
  map.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  map.needsUpdate = true;
  const nrm = new THREE.DataTexture(td.normal, td.cols, td.rows, THREE.RGBAFormat, THREE.UnsignedByteType);
  nrm.magFilter = THREE.LinearFilter;
  nrm.minFilter = THREE.LinearFilter;
  nrm.needsUpdate = true;
  const uniforms = {
    uShallow: { value: new THREE.Color(PAL.water) },
    uDeep: { value: new THREE.Color(PAL.waterDeep) },
    uFoam: { value: new THREE.Color(PAL.ripple) },
    uDense: { value: 0.5 },
  };
  const mat = new THREE.MeshLambertMaterial({ map, normalMap: nrm, normalMapType: THREE.ObjectSpaceNormalMap });
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n' + WATER_GLSL)
      .replace(
        '#include <map_fragment>',
        /* glsl */ `
        // 海和湖：贴图的 A 是“是不是水”的软边，法线图的 A 是离岸远近（湖里一律算够远）。水是一个平面，淡花青，岸边留白，上面有细水纹。
        vec4 texel = texture2D(map, vMapUv);
        float aw = max(fwidth(texel.a) * 0.9, 0.012);
        float wat = smoothstep(0.5 - aw, 0.5 + aw, texel.a);
        float off = texture2D(normalMap, vNormalMapUv).a;
        vec3 wc = mix(uShallow, uDeep, smoothstep(0.84, 1.0, off));
        float fringe = 1.0 - smoothstep(0.5, 0.7, off);
        // 湖里（off 定在 0.8 以上）没有上面那道几公里宽的白，只按贴图的软边留一道不到一公里的细白
        fringe = max(fringe, (1.0 - smoothstep(0.5, 0.72, texel.a)) * 0.8);
        wc = mix(wc, uFoam, fringe * 0.6);
        float rp = ripples(vWPos.xz) * smoothstep(0.52, 0.8, off);
        wc = mix(wc, uFoam, rp * (0.66 - 0.25 * fringe));
        diffuseColor.rgb *= mix(texel.rgb, wc, wat);
        `,
      );
  };
  const top = new THREE.Mesh(geo, mat);
  top.receiveShadow = true;
  top.castShadow = true;
  scene.add(top);

  // 四边的切面
  {
    const sidePos = [];
    const sideUv = [];
    const sideNor = [];
    const sideCol = [];
    const sideIdx = [];
    const wcol = hex(PAL.waterDeep).map((v) => Math.pow(v / 255, 2.2));
    let acc = 0;
    const addEdge = (ks, nx, nz) => {
      for (let s = 0; s < ks.length; s++) {
        const k = ks[s];
        const x = pos[k * 3];
        const z = pos[k * 3 + 2];
        const y = pos[k * 3 + 1];
        if (s > 0) {
          const kp = ks[s - 1];
          acc += Math.hypot(x - pos[kp * 3], z - pos[kp * 3 + 2]);
        }
        const tx = clamp(Math.round(((x + HX) / (2 * HX)) * TEX.w), 0, TEX.w - 1);
        const ty = clamp(Math.round(((z + HZ) / (2 * HZ)) * TEX.h), 0, TEX.h - 1);
        const w = clamp((prep.sdf[ty * TEX.w + tx] - 0.4) * 5, 0, 1);
        const cc = [1 + (wcol[0] * 1.5 - 1) * w, 1 + (wcol[1] * 1.6 - 1) * w, 1 + (wcol[2] * 1.9 - 1) * w];
        const base = sidePos.length / 3;
        sidePos.push(x, y, z, x, BLOCK_BASE_Y, z);
        sideUv.push(acc / 300, y / 60, acc / 300, BLOCK_BASE_Y / 60);
        sideNor.push(nx, 0, nz, nx, 0, nz);
        sideCol.push(...cc, ...cc);
        if (s > 0) sideIdx.push(base - 2, base - 1, base, base, base - 1, base + 1);
      }
    };
    const south = [];
    const north = [];
    const west = [];
    const east = [];
    for (let i = 0; i <= SX; i++) {
      south.push(SZ * (SX + 1) + i);
      north.push(SX - i);
    }
    for (let j = 0; j <= SZ; j++) {
      east.push((SZ - j) * (SX + 1) + SX);
      west.push(j * (SX + 1));
    }
    addEdge(south, 0, 1);
    addEdge(east, 1, 0);
    addEdge(north, 0, -1);
    addEdge(west, -1, 0);
    const sideGeo = new THREE.BufferGeometry();
    sideGeo.setAttribute('position', new THREE.Float32BufferAttribute(sidePos, 3));
    sideGeo.setAttribute('uv', new THREE.Float32BufferAttribute(sideUv, 2));
    sideGeo.setAttribute('normal', new THREE.Float32BufferAttribute(sideNor, 3));
    sideGeo.setAttribute('color', new THREE.Float32BufferAttribute(sideCol, 3));
    sideGeo.setIndex(sideIdx);
    const sides = new THREE.Mesh(sideGeo, new THREE.MeshLambertMaterial({ color: PAL.blockSide, map: layerTexture(), side: THREE.DoubleSide, vertexColors: true }));
    sides.receiveShadow = true;
    sides.castShadow = true;
    scene.add(sides);
  }

  // ---------- 座子 ----------
  const table = buildTable(HX, HZ);
  scene.add(table.group);
  const pmrem = new THREE.PMREMGenerator(renderer);
  table.wood.envMap = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();

  // ---------- 路线：墨线，底下垫一道留白 ----------
  const { legs, problems } = buildLegs(fig, prep.rivers, prep.songLines, prep.waterAt);
  if (problems.length) console.error('路线从水上穿过去了：' + JSON.stringify(problems));
  const strokeGroup = new THREE.Group();
  scene.add(strokeGroup);
  let legStates = null;
  // 线的粗细是 880 宽的画面上的像素；画面窄了跟着细（手机上不显得更重）
  const STYLE = {
    ink: { color: PAL.ink, op: 0.92, w: 1.45, halo: 3.3, haloOp: 0.62, order: 11 },
    now: { color: PAL.seal, op: 1, w: 1.75, halo: 3.6, haloOp: 0.8, order: 13 },
    faded: { color: PAL.inkFaded, op: 0.9, w: 0.95, halo: 2.0, haloOp: 0.45, order: 9 },
  };
  /** 把要画的笔画重新排一遍、画出来（镜头或画面大小变了也要重排：线宽和虚线的长短是按屏幕定的） */
  function drawStrokes() {
    for (const c of [...strokeGroup.children]) {
      strokeGroup.remove(c);
      c.geometry.dispose();
      c.material.dispose();
    }
    if (!legStates || !current) return;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    const shotNow = SHOTS[current];
    const k = clamp(w / 880, 0.6, 1) * (shotNow.line ?? 1);
    const upp = (100 * U) / Math.max(1, api.pxPer(100)); // 屏幕上 1 像素是场景里多少单位
    const list = strokes(legs, legStates, shotNow.corner ?? 16);
    api.dashed = list.some((s) => s.dash);
    for (const st of list) {
      const S = STYLE[st.state];
      const flat = [];
      for (const [x, y] of st.pts) flat.push(x * U, yAt(x * U, -y * U) + 14, -y * U);
      const add = (color, width, opacity, order, dash) => {
        const g = new LineGeometry();
        g.setPositions(flat);
        const m = new LineMaterial({ color, linewidth: width, depthTest: false, depthWrite: false, transparent: true, opacity, dashed: dash });
        if (dash) {
          m.dashSize = 7 * upp;
          m.gapSize = 5.5 * upp;
        }
        m.resolution.set(w, h);
        const l = new Line2(g, m);
        if (dash) l.computeLineDistances();
        l.renderOrder = order;
        l.frustumCulled = false;
        strokeGroup.add(l);
      };
      if (st.dash) {
        add(PAL.halo, S.halo * k, S.haloOp * 0.9, S.order - 1, false);
        add(S.color, S.w * k, st.state === 'now' ? 0.95 : 0.8, S.order, true);
      } else {
        add(PAL.halo, S.halo * k, S.haloOp, S.order - 1, false);
        add(S.color, S.w * k, S.op, S.order, false);
      }
    }
  }
  /** 每段怎么画：'ink' 墨线，'now' 印泥红（刚走的一段），'faded' 淡墨（早先走过的），'off' 不画 */
  function setLegs(states) {
    legStates = states.slice();
    drawStrokes();
  }

  // ---------- 灯 ----------
  const hemi = new THREE.HemisphereLight(LIGHT0.sky, LIGHT0.ground, LIGHT0.hemi);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(LIGHT0.sunColor, LIGHT0.sun);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.radius = LIGHT0.radius;
  scene.add(sun, sun.target);
  {
    const dir = new THREE.Vector3(...LIGHT0.dir).normalize();
    const half = 9800;
    sun.target.position.set(0, 0, 0);
    sun.position.copy(dir).multiplyScalar(26000);
    const cam = sun.shadow.camera;
    cam.left = -half;
    cam.right = half;
    cam.top = half;
    cam.bottom = -half;
    cam.near = 4000;
    cam.far = 46000;
    cam.updateProjectionMatrix();
    sun.shadow.bias = LIGHT0.bias;
    sun.shadow.normalBias = ((2 * half) / 2048) * LIGHT0.nb;
  }

  let current = null;
  let viewNow = [0, 0];
  function applyView(v) {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    viewNow = v;
    if (v[0] || v[1]) camera.setViewOffset(w, h, -v[0] * w, -v[1] * h, w, h);
    else camera.clearViewOffset();
  }
  function placeCamera(s) {
    const az = THREE.MathUtils.degToRad(s.az);
    const el = THREE.MathUtils.degToRad(s.el);
    const [tx, tz] = sceneXZ(...s.at);
    const tgt = new THREE.Vector3(tx, 0, tz);
    const asp = canvas.clientWidth / Math.max(1, canvas.clientHeight);
    const d = s.dist * (s.fit ? Math.max(s.fitMin ?? 1, s.fit / asp) : 1);
    camera.position.set(tgt.x + d * Math.sin(az) * Math.cos(el), tgt.y + d * Math.sin(el), tgt.z + d * Math.cos(az) * Math.cos(el));
    camera.fov = s.fov;
    camera.near = Math.max(60, d * 0.1);
    camera.far = d * 3 + 30000;
    camera.up.set(0, 1, 0);
    camera.lookAt(tgt);
    applyView((canvas.clientWidth < 700 && s.viewNarrow) || s.view || [0, 0]);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    api.target = tgt;
    drawStrokes();
  }
  function resize() {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h) return;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    if (current) placeCamera(SHOTS[current]);
  }

  const afterRender = new Set();
  const api = {
    renderer,
    scene,
    camera,
    fig,
    water,
    song,
    legs,
    problems,
    rivers: prep.rivers,
    dashed: false,
    relief: rel,
    target: new THREE.Vector3(),
    yAt,
    info: {
      triangles: idx.length / 3 + 4 * (SX + SZ),
      colorTex: [TEX.w, TEX.h],
      normalTex: [td.cols, td.rows],
      ms: { load: Math.round(tLoaded - t0), build: Math.round(tBuilt - tLoaded) },
    },
    get shot() {
      return current;
    },
    onAfterRender(fn) {
      afterRender.add(fn);
    },
    render() {
      renderer.render(scene, camera);
      for (const fn of afterRender) fn();
    },
    resize() {
      resize();
      api.render();
    },
    setLegs(states) {
      setLegs(states);
    },
    /** 经纬度上的一点落在画布的哪个像素上（CSS 像素）；lift 是离地面多高 */
    project(lng, lat, lift = 0) {
      const [x, z] = sceneXZ(lng, lat);
      const v = new THREE.Vector3(x, yAt(x, z) + lift, z).project(camera);
      return { x: (v.x * 0.5 + 0.5) * canvas.clientWidth, y: (-v.y * 0.5 + 0.5) * canvas.clientHeight, behind: v.z > 1 };
    },
    /** 镜头朝向：正上方是北时为 0，顺时针为正（度）。桌面正中的经线朝上才是正北，两边略有偏，圆锥投影就是这样。 */
    heading() {
      const d = new THREE.Vector3();
      camera.getWorldDirection(d);
      if (Math.hypot(d.x, d.z) < 0.02) return 0;
      return THREE.MathUtils.radToDeg(Math.atan2(d.x, -d.z));
    },
    /** 画面上看着的那一点附近，东西向 km 公里在屏幕上有多少像素 */
    pxPer(km) {
      const tg = api.target;
      const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
      const m = (km * U) / 2;
      const P = (x, z) => {
        const v = new THREE.Vector3(x, 0, z).project(camera);
        return [(v.x * 0.5 + 0.5) * canvas.clientWidth, (-v.y * 0.5 + 0.5) * canvas.clientHeight];
      };
      const a = P(tg.x - right.x * m, tg.z - right.z * m);
      const b = P(tg.x + right.x * m, tg.z + right.z * m);
      return Math.hypot(b[0] - a[0], b[1] - a[1]);
    },
    setShot(name) {
      current = SHOTS[name] ? name : 'whole';
      uniforms.uDense.value = SHOTS[current].ripple ?? 0.5;
      placeCamera(SHOTS[current]);
      api.render();
    },
  };
  resize();
  setLegs(legs.map(() => 'ink'));
  api.setShot(shot);
  api.render();
  api.info.ms.first = Math.round(performance.now() - tBuilt);
  return api;
}
