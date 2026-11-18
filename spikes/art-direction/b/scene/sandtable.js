// 把沙盘装起来：地形、水、雾、小模型、座子、灯、镜头。
// 页面只用 createSandTable(canvas) 返回的几样：setShot、render、project、onAfterRender。

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { loadDem } from '../../shared/scene-data.js';
import { EX, LEVEL, PLACE, WALLRECT, yOf, DIKE_PTS, riverPoint } from './config.js';
import { buildTerrainData } from './terrain-data.js';
import { buildTerrain } from './terrain.js';
import { buildWater, buildMist } from './water.js';
import { buildModels, WALL_TOP } from './models.js';
import { buildTable } from './table.js';
import { lerp, smoothstep } from './util.js';

const W = WALLRECT;
const CITY_Y = yOf(41.2);
const FAR_WALL_TOP = WALL_TOP * 1.55;
const bianAt = (x) => riverPoint('bian', 'x', x);
const siAt = (z) => riverPoint('si', 'z', z);
const joinedAt = (z) => riverPoint('joined', 'z', z);

/**
 * 镜头。az：镜头在目标的哪一边（0 是正南，90 是正东），el：俯角，dist：远近（米）。
 * fit / fitMin：dist 是按宽高比 fit 的画面定的；画面更宽就靠近些（最多靠近到 fitMin 倍），更窄就退远些。
 * sets：这个镜头摆哪几套模型（见 models.js：near 是近看的一套，far 是看整块沙盘用的放大的一套）。
 * light：这个镜头的灯（不写就用默认的西北来光）。
 * labels：题签。at 是它指的地方，dx dy 是题签中心离那一点多少像素（按 880 宽的画面定，窄了按比例缩）。
 */
export const SHOTS = {
  arrive: {
    section: '到徐州',
    when: '熙宁十年（1077）四月',
    caption: '徐州三面是山，只有西边是几百里平地。',
    target: [-450, -100, -470],
    az: 0,
    el: 42,
    dist: 52000,
    fov: 18,
    fit: 0.978,
    fitMin: 0.8,
    view: [0, -0.1],
    fog: [40000, 140000],
    level: LEVEL.normal,
    flood: 0,
    mist: 0.4,
    sets: ['far', 'earlyFar', 'calmFar', 'dots'],
    shadow: { c: [-500, -300], half: 8300 },
    labels: [
      { text: '徐州', at: [0, FAR_WALL_TOP + 215, W.z0], dx: 0, dy: -58 },
      { text: '戏马台', at: [PLACE.ximatai[0] + 175, 80, PLACE.ximatai[1] + 30], dx: 140, dy: 62 },
      { text: '汴水', at: [bianAt(-3600)[0], 0, bianAt(-3600)[1]], dx: 0, dy: 62, kind: 'water' },
      { text: '泗水', at: [siAt(-3500)[0], 0, siAt(-3500)[1]], dx: 52, dy: -8, kind: 'water' },
      { text: '云龙山', at: [PLACE.yunlongshan[0], 330, PLACE.yunlongshan[1]], dx: -86, dy: 6, wideOnly: true },
    ],
  },
  flood: {
    section: '住在城墙上',
    when: '熙宁十年（1077）九月',
    caption: '东、西、北三面，水一直漫到山脚。',
    target: [120, 0, 300],
    az: 7,
    el: 29,
    dist: 9600,
    fov: 21,
    fog: [12000, 60000],
    level: LEVEL.flood,
    flood: 1,
    sets: ['near', 'early', 'dike', 'flood', 'treesFlood'],
    shadow: { c: [100, -300], half: 5200 },
    labels: [
      { text: '徐州', at: [W.x0, WALL_TOP + 60, W.z0], dx: -40, dy: -70 },
      { text: '戏马台', at: [PLACE.ximatai[0] - 30, 150, PLACE.ximatai[1]], dx: -84, dy: 30 },
      { text: '新筑的堤', at: [(DIKE_PTS[1][0] + DIKE_PTS[2][0]) / 2, 30, (DIKE_PTS[1][1] + DIKE_PTS[2][1]) / 2], dx: 90, dy: 84 },
      { text: '系在城下的船', at: [W.x1 + 70, 22, -300], dx: 112, dy: -40 },
      { text: '泗水', at: [siAt(-2600)[0], 20, siAt(-2600)[1]], dx: 50, dy: -30, kind: 'water' },
    ],
  },
  close: {
    section: '水退以后',
    when: '元丰元年（1078）重阳',
    caption: '我在东门上盖了一座大楼，墙上刷了黄土，叫它黄楼。',
    target: [W.x1 - 10, 40, 0],
    az: 104,
    el: 14,
    dist: 1150,
    fov: 22,
    fit: 0.978,
    fitMin: 0.8,
    fog: [3000, 30000],
    ripple: 0.3,
    rip: 90,
    level: LEVEL.normal,
    flood: 0,
    sets: ['near', 'after', 'dike', 'calm', 'treesClose'],
    shadow: { c: [W.x1 - 100, 0], half: 1250 },
    light: { dir: [0.5, 0.48, 0.72], sun: 3.3, sunColor: '#ffe8c2', hemi: 1.15, sky: '#eef3f6', ground: '#cbb48a', radius: 3, bias: -0.0002, nb: 0.6 },
    mist: 1.0,
    labels: [
      { text: '黄楼', at: [W.x1 + 4, WALL_TOP + 84, 46], dx: -96, dy: -74 },
      { text: '东门', at: [W.x1 + 44, CITY_Y + 58, 0], dx: -190, dy: 30 },
    ],
  },
  rising: {
    section: '水来了',
    when: '熙宁十年（1077）八月',
    caption: '八月二十一日，水到了城下。',
    target: [0, 0, 80],
    az: -14,
    el: 33,
    dist: 10800,
    fov: 21,
    level: 41.3,
    flood: 0.5,
    sets: ['near', 'early', 'treesRising'],
    shadow: { c: [0, -400], half: 5600 },
    fog: [14000, 60000],
    labels: [
      { text: '徐州', at: [W.x1, WALL_TOP + 60, W.z0], dx: 44, dy: -70 },
      { text: '汴水', at: [bianAt(-2600)[0], 10, bianAt(-2600)[1]], dx: -20, dy: -56, kind: 'water' },
      { text: '泗水', at: [siAt(-3050)[0], 10, siAt(-3050)[1]], dx: 46, dy: -30, kind: 'water' },
    ],
  },
  south: {
    section: '云龙山和百步洪',
    when: '元丰元年（1078）',
    caption: '城东南的泗水上有一段乱石滩，叫百步洪。',
    target: [330, 20, 2330],
    az: 80,
    el: 24,
    dist: 5900,
    fov: 21,
    rip: 90,
    level: LEVEL.normal,
    flood: 0,
    sets: ['near', 'after', 'dike', 'calm', 'trees'],
    shadow: { c: [0, 2200], half: 3600 },
    light: { dir: [0.5, 0.56, 0.66], sun: 3.0, sunColor: '#fff0d6', hemi: 1.25, sky: '#f4f4ee', ground: '#c9b48e' },
    fog: [7000, 34000],
    labels: [
      { text: '百步洪', at: [PLACE.baibuhong[0] - 30, 10, PLACE.baibuhong[1] - 120], dx: 96, dy: -78, kind: 'water' },
      { text: '云龙山', at: [PLACE.yunlongshan[0], 470, PLACE.yunlongshan[1]], dx: -60, dy: -52 },
      { text: '放鹤亭', at: [PLACE.fangheting[0], 330, PLACE.fangheting[1]], dx: 44, dy: -74 },
      { text: '戏马台', at: [PLACE.ximatai[0], 150, PLACE.ximatai[1]], dx: 60, dy: -60 },
      { text: '泗水', at: [joinedAt(1350)[0], 0, joinedAt(1350)[1]], dx: 40, dy: -70, kind: 'water' },
    ],
  },
  home: {
    section: '',
    caption: '',
    target: [-450, -100, -470],
    az: 0,
    el: 44,
    dist: 56500,
    fov: 18,
    fit: 0.889,
    fitMin: 0.8,
    view: [0, -0.05],
    level: LEVEL.flood,
    flood: 1,
    mist: 0.7,
    sets: ['far', 'earlyFar', 'dike', 'floodFar', 'dotsFlood'],
    shadow: { c: [-500, -300], half: 8300 },
    labels: [
      { text: '徐州', at: [0, FAR_WALL_TOP + 215, W.z0], dx: 0, dy: -58 },
      { text: '云龙山', at: [PLACE.yunlongshan[0], 330, PLACE.yunlongshan[1]], dx: -70, dy: 20 },
    ],
  },
};
const FAR_SHOT = (s) => s.sets.includes('far');
const LIGHT0 = { dir: [-0.66, 0.6, -0.42], sun: 2.6, sunColor: '#fff4e2', hemi: 1.55, sky: '#fffaf0', ground: '#c4b494', radius: 2.2, bias: -0.0006, nb: 1.6 };

export async function createSandTable(canvas, { shot = 'arrive', sharedBase = '../shared/', interactive = true } = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setClearColor(0x000000, 0);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog('#ece3cf', 40000, 140000);
  const camera = new THREE.PerspectiveCamera(26, 1, 400, 90000);

  const dem = await loadDem(sharedBase);
  const td = buildTerrainData(dem);
  const terrain = buildTerrain(td, renderer);
  const water = buildWater(td);
  const mist = buildMist(td);
  const models = buildModels(td);
  const table = buildTable();
  scene.add(terrain.group, water.mesh, mist.group, models.group, table.group);

  // 紫檀要一点环境反光；别的材质都是不反光的
  const pmrem = new THREE.PMREMGenerator(renderer);
  table.wood.envMap = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();

  // 灯：一盏从西北上方来的暖光（唯一投影的灯），加天光补亮
  const hemi = new THREE.HemisphereLight(LIGHT0.sky, LIGHT0.ground, LIGHT0.hemi);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(LIGHT0.sunColor, LIGHT0.sun);
  const sunDir = new THREE.Vector3();
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  scene.add(sun, sun.target);

  let current = null;
  const state = { level: LEVEL.normal, flood: 0 };

  function applySets(names) {
    for (const [k, g] of Object.entries(models.sets)) g.visible = k === 'base' || names.includes(k);
  }
  function fitShadow(s) {
    const L = { ...LIGHT0, ...(s.light || {}) };
    sunDir.set(...L.dir).normalize();
    sun.color.set(L.sunColor);
    sun.intensity = L.sun;
    hemi.color.set(L.sky);
    hemi.groundColor.set(L.ground);
    hemi.intensity = L.hemi;
    sun.shadow.radius = L.radius;
    const c = new THREE.Vector3(s.shadow.c[0], 0, s.shadow.c[1]);
    sun.target.position.copy(c);
    sun.position.copy(c).addScaledVector(sunDir, 26000);
    const cam = sun.shadow.camera;
    cam.left = -s.shadow.half;
    cam.right = s.shadow.half;
    cam.top = s.shadow.half;
    cam.bottom = -s.shadow.half;
    cam.near = 4000;
    cam.far = 46000;
    cam.updateProjectionMatrix();
    const texel = (2 * s.shadow.half) / 2048;
    sun.shadow.bias = L.bias;
    sun.shadow.normalBias = texel * L.nb;
  }
  // 把画面整体往右、往下挪一点（首页上沙盘摆在右边）
  let viewNow = [0, 0];
  function applyView(s, v = (s && s.view) || [0, 0]) {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    viewNow = v;
    if (v[0] || v[1]) camera.setViewOffset(w, h, -v[0] * w, -v[1] * h, w, h);
    else camera.clearViewOffset();
  }
  // 画面比设计时宽就靠近些，窄就退远些，让要看的东西还在画面里
  function distFor(s) {
    const asp = canvas.clientWidth / Math.max(1, canvas.clientHeight);
    return s.dist * (s.fit ? Math.max(s.fitMin ?? 1, s.fit / asp) : 1);
  }
  function placeCamera(s) {
    const az = THREE.MathUtils.degToRad(s.az);
    const el = THREE.MathUtils.degToRad(s.el);
    const t = new THREE.Vector3(...s.target);
    // 画布比设计时窄，就退远一点，让整块沙盘还在画面里
    const d = distFor(s);
    camera.position.set(t.x + d * Math.sin(az) * Math.cos(el), t.y + d * Math.sin(el), t.z + d * Math.cos(az) * Math.cos(el));
    camera.fov = s.fov;
    camera.near = Math.max(60, d * 0.1);
    camera.far = d * 3 + 30000;
    camera.lookAt(t);
    applyView(s);
    camera.updateProjectionMatrix();
    if (controls) {
      controls.target.copy(t);
      controls.update();
    }
  }

  let controls = null;
  if (interactive) {
    controls = new OrbitControls(camera, canvas);
    controls.enableDamping = false;
    controls.maxPolarAngle = THREE.MathUtils.degToRad(80);
    controls.minDistance = 900;
    controls.maxDistance = 90000;
    controls.addEventListener('change', () => api.render());
  }

  function resize() {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h) return;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    if (current) applyView(null, viewNow);
    camera.updateProjectionMatrix();
  }

  const afterRender = new Set();
  let raf = 0;
  const api = {
    renderer,
    scene,
    camera,
    td,
    info: models.info,
    get shot() {
      return current;
    },
    /** 拖动镜头用的控制器（没开拖动时是 null）。测速转一圈要用它眼下看的那一点。 */
    get controls() {
      return controls;
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
    /** 场景里的一点落在画布的哪个像素上（CSS 像素） */
    project(x, y, z) {
      const v = new THREE.Vector3(x, y, z).project(camera);
      return { x: (v.x * 0.5 + 0.5) * canvas.clientWidth, y: (-v.y * 0.5 + 0.5) * canvas.clientHeight, behind: v.z > 1 };
    },
    /** 镜头朝向：正上方是北时为 0，顺时针为正（度） */
    heading() {
      const d = new THREE.Vector3();
      camera.getWorldDirection(d);
      return THREE.MathUtils.radToDeg(Math.atan2(d.x, -d.z));
    },
    /** 画面中心附近，地面上 meters 米在屏幕上有多少像素 */
    pxPer(meters, at) {
      const t = at || (controls ? controls.target : new THREE.Vector3(...SHOTS[current].target));
      const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
      const a = api.project(t.x - (right.x * meters) / 2, t.y, t.z - (right.z * meters) / 2);
      const b = api.project(t.x + (right.x * meters) / 2, t.y, t.z + (right.z * meters) / 2);
      return Math.hypot(b.x - a.x, b.y - a.y);
    },
    setShot(name, { animate = false, onDone = null } = {}) {
      const s = SHOTS[name] || SHOTS.arrive;
      const from = current ? { pos: camera.position.clone(), tgt: controls ? controls.target.clone() : new THREE.Vector3(...SHOTS[current].target), level: state.level, flood: state.flood, fov: camera.fov, view: viewNow, mist: SHOTS[current].mist ?? 1 } : null;
      current = SHOTS[name] ? name : 'arrive';
      cancelAnimationFrame(raf);
      const finish = () => {
        state.level = s.level;
        state.flood = s.flood;
        water.setLevel(s.level);
        mist.setFlood(s.flood);
        mist.setStrength(s.mist ?? 1);
        water.uniforms.uFlood.value = s.flood;
        water.uniforms.uDense.value = s.ripple ?? 0.5;
        water.uniforms.uRipRot.value.set(Math.cos(((s.rip || 0) * Math.PI) / 180), Math.sin(((s.rip || 0) * Math.PI) / 180));
        applySets(s.sets);
        fitShadow(s);
        scene.fog.near = (s.fog || [40000, 140000])[0];
        scene.fog.far = (s.fog || [40000, 140000])[1];
        placeCamera(s);
        api.render();
        if (onDone) onDone();
      };
      if (!animate || !from) {
        finish();
        return;
      }
      // 换镜头：镜头滑过去，水位跟着涨落
      const to = new THREE.Vector3();
      const az = THREE.MathUtils.degToRad(s.az);
      const el = THREE.MathUtils.degToRad(s.el);
      const tt = new THREE.Vector3(...s.target);
      const dd = distFor(s);
      to.set(tt.x + dd * Math.sin(az) * Math.cos(el), tt.y + dd * Math.sin(el), tt.z + dd * Math.cos(az) * Math.cos(el));
      const t0 = performance.now();
      const dur = 2200;
      fitShadow(s);
      const toView = s.view || [0, 0];
      // 往近处走，一开始就换成近看的一套模型；往远处退，到了再换
      if (!FAR_SHOT(s)) applySets(s.sets);
      const step = () => {
        const k = Math.min(1, (performance.now() - t0) / dur);
        const e = smoothstep(0, 1, k);
        camera.position.lerpVectors(from.pos, to, e);
        const tg = from.tgt.clone().lerp(tt, e);
        camera.fov = lerp(from.fov, s.fov, e);
        camera.near = Math.max(60, camera.position.distanceTo(tg) * 0.1);
        camera.far = camera.position.distanceTo(tg) * 3 + 30000;
        camera.lookAt(tg);
        applyView(null, [lerp(from.view[0], toView[0], e), lerp(from.view[1], toView[1], e)]);
        camera.updateProjectionMatrix();
        mist.setStrength(lerp(from.mist, s.mist ?? 1, e));
        state.level = lerp(from.level, s.level, e);
        state.flood = lerp(from.flood, s.flood, e);
        water.setLevel(state.level);
        mist.setFlood(state.flood);
        water.uniforms.uFlood.value = state.flood;
        api.render();
        if (k < 1) raf = requestAnimationFrame(step);
        else finish();
      };
      raf = requestAnimationFrame(step);
    },
  };

  resize();
  api.setShot(shot);
  // 第一帧要编译着色器、上传贴图、画影子；再画一帧保证是完整的
  api.render();
  return api;
}

export { EX };
