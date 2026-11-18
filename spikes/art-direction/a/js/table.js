// 素模沙盘：把地形、水、城、小模型、底座和灯光装到一起。
//
// 颜色（写在前面，全场只用这些）：
//   椴木（卡纸顶面）  #E7E1D3     切口            #D9CBB0
//   城墙（砖）        #C6BCA9     岸上的石板      #D6C8AE
//   屋顶（梨木退淡）  #BCA98D     黄楼的屋顶      #AE9676（梨木本色）
//   靛蓝树脂（河）    #14294A     大水            #2C4668（八成不透明，盖在椴木上）
//   黄土（黄楼的墙）  #DCB968     黄楼的柱子栏杆  #6B4A2A
//   堤（夯土）        #C9B38C     百步洪的石头    #A89E8E
//   胡桃木（底座）    #3B291E     展厅暖灰        #CAC3B7 → #DDD7CC（顶光照到的地方）
//   针和门窗          #2A2622 / #4A3C30
//
// 灯：一盏投影的主灯（暖白，离台面 35 度上下，每个镜头从侧后方打过来），
//     一盏不投影的补光（跟着镜头走，冷一点），一层很弱的天光。

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { loadDem, toLocal, CITY, PLACES, DIKE } from '../../shared/scene-data.js';
import { T, buildTerrain, buildLayerGeometry } from './terrain.js';
import * as TX from './textures.js';
import { buildModels } from './models.js';

export const COLORS = {
  wood: 0xe7e1d3,
  wallWood: 0xc6bca9,
  edge: 0xd9cbb0,
  roof: 0xbca98d,
  roofHL: 0xae9676,
  post: 0x6b4a2a,
  tree: 0xcfc2a6,
  rock: 0xa89e8e,
  resin: 0x14294a,
  flood: 0x2c4668,
  ochre: 0xdcb968,
  dike: 0xc9b38c,
  dikeLine: 0x9a8562,
  quay: 0xd6c8ae,
  walnut: 0x3b291e,
  room: 0xcac3b7,
  roomLight: 0xddd7cc,
  ink: 0x2a2622,
};

const loc = (lng, lat) => toLocal(lng, lat);
const nw = loc(CITY.west, CITY.north);
const se = loc(CITY.east, CITY.south);
export const GEO = {
  city: { x0: nw.x, x1: se.x, z0: nw.z, z1: se.z },
  places: Object.fromEntries(PLACES.map((p) => [p.id, loc(p.lng, p.lat)])),
  dike: DIKE.map(([lng, lat]) => loc(lng, lat)),
};
// 对地形的一处改动（在返回的说明里交代了）：
//   tongue：城西南角到戏马台之间垫高的一条地，为的是让城南是干地（正文：“只有城南走得了车马”）。示意。
// 戏马台的土山不在高程里补，单做成一摞薄板（见 models.js）。
const EXTRA = {
  cityRect: { x0: GEO.city.x0 + 17, x1: GEO.city.x1 - 17, z0: GEO.city.z0 + 17, z1: GEO.city.z1 - 17 },
  mound: null,
  tongue: { a: [GEO.places.ximatai.x - 70, GEO.places.ximatai.z - 30], b: [GEO.city.x0 + 150, GEO.city.z1 + 40], reach: 82, topM: 51 },
};

// 镜头：az 是镜头在目标的哪一边，从正南起算，往东为正（-90 就是从西边看过去）；el 是俯角。
// fit: 'table' 时自动退到整张沙盘（连底座）都在画面里，pad 是四边留的空（上右下左，占画面的比例）；
// 否则用 halfW / halfH：画面里要装下的半宽、半高（模型单位）。
// sun：主灯在哪一边（同 az 的算法）和离台面多高。exposure：这一张的曝光（不写就是 1）。
// gloss：树脂面上映的那间屋子转多少度、多亮。
// big：小模型放大多少（0 是原样，1 是全景里用的最大一档；真的沙盘也这么做，不然全景里只剩几个点）。
// water：0 平时，1 大水；after：水退以后（有黄楼、放鹤亭、木岸）。
// 牌子：pin 是针插在哪，h 是针在画面上多高（像素），lead 是从针脚刻到哪去的一道细线。
export const SHOTS = {
  // 到徐州：从西边的缺口往里看。北在左手，三面的山围着城，两条河在城东北角合流。
  arrive: {
    fit: 'table', pad: [0.1, 0.03, 0.07, 0.03], padNarrow: [0.17, 0.04, 0.06, 0.04], az: -90, el: 37, fov: 21, sun: [146, 34], gloss: [52, 0.1], exposure: 1.1, big: 1, water: 0, after: false, plate: true,
    labels: [
      { pin: 'cityWest', lead: 'westGate', text: '徐州', h: 20 },
      { pin: 'ximataiSW', lead: 'ximatai', text: '戏马台', h: 20 },
      { pin: 'yunlong', text: '云龙山', h: 30 },
      { pin: 'baibuhong', text: '百步洪', h: 50, dx: 16 },
      { pin: 'bianW', text: '汴水', kind: 'water', h: 30 },
      { pin: 'si', text: '泗水', kind: 'water', h: 30 },
    ],
    labelsNarrow: [
      { pin: 'cityWestFar', lead: 'westGate', text: '徐州', h: 14 },
      { pin: 'yunlong', text: '云龙山', h: 22 },
      { pin: 'bianFar', text: '汴水', kind: 'water', h: 20 },
      { pin: 'si', text: '泗水', kind: 'water', h: 22 },
    ],
  },
  // 水来了：水刚漫上平地，到了城下。
  rise: {
    target: [0, 0, -260], az: 12, el: 33, halfW: 2500, halfH: 1700, fov: 25, sun: [-120, 34], big: 0.6, shadow: 5200, shadowAt: [0, 0, -900], water: 0.42, after: false,
    labels: [
      { pin: 'city', text: '徐州', h: 56 },
      { pin: 'bian', text: '汴水', kind: 'water', h: 32 },
      { pin: 'siNear', text: '泗水', kind: 'water', h: 32 },
    ],
  },
  // 住在城墙上：从戏马台上头往北偏东看。大水漫到山脚，城在墙和堤后面是干的，船系在城下。
  flood: {
    target: [560, 0, -600], az: -24, el: 35, halfW: 1830, halfH: 1830, fov: 27, sun: [-136, 34], gloss: [-4, 0.22], exposure: 1.05, big: 0.42, shadow: 3700, shadowAt: [700, 0, -900], water: 1, after: false,
    labels: [
      { pin: 'ximatai', text: '戏马台', h: 34 },
      { pin: 'dike', text: '堤', h: 30 },
      { pin: 'boats', text: '系在城下的船', h: 40 },
      { pin: 'shore', text: '水到山脚', h: 34 },
    ],
    labelsNarrow: [
      { pin: 'ximatai', text: '戏马台', h: 24 },
      { pin: 'dike', text: '堤', h: 22 },
      { pin: 'shore', text: '水到山脚', h: 24 },
    ],
  },
  // 水退以后：东门上的黄楼，楼下是泗水。
  close: {
    target: [640, 92, 26], az: 62, el: 20.5, halfW: 196, halfH: 118, fov: 24, sun: [121, 31], gloss: [-92, 0.16], big: 0, shadow: 620, shadowAt: [430, 0, 0], shadowTop: 190, water: 0, after: true,
    tilt: { top: 0.15, bottom: 0 },
    labels: [{ pin: 'huanglou', text: '黄楼', h: 30 }],
  },
  // 云龙山和百步洪：从城这边往南看。
  hills: {
    target: [120, 40, 1900], az: 168, el: 21, halfW: 1650, halfH: 1050, fov: 26, sun: [70, 33], gloss: [24, 0.14], big: 0.5, shadow: 3400, shadowAt: [0, 0, 2400], shadowTop: 520, water: 0, after: true,
    labels: [
      { pin: 'yunlong', text: '云龙山', h: 40 },
      { pin: 'fanghe', text: '放鹤亭', h: 34 },
      { pin: 'baibuhong', text: '百步洪', h: 46 },
      { pin: 'ximatai', text: '戏马台', h: 36 },
    ],
  },
  // 石炭：往西南看。白土镇在二十多公里外，不在这块沙盘里。
  coal: {
    target: [-2300, 0, 2000], az: 132, el: 30, halfW: 4300, halfH: 2700, fov: 24, sun: [40, 34], gloss: [-14, 0.14], big: 1, shadow: 8200, shadowAt: [-1500, 0, 1200], shadowTop: 800, water: 0, after: true,
    labels: [{ pin: 'city', text: '徐州', h: 50 }],
  },
  // 要走了：出西门往西，是去南京的路。
  leave: {
    target: [-2100, 0, -60], az: 86, el: 23, halfW: 2500, halfH: 1500, fov: 26, sun: [-30, 33], big: 0.7, shadow: 6400, shadowAt: [-2400, 0, 0], shadowTop: 500, water: 0, after: true,
    labels: [
      { pin: 'city', text: '徐州', h: 44 },
      { pin: 'westRoad', text: '去南京的路', h: 40 },
    ],
  },
};

function makeEnvironment(renderer) {
  // 一间暖灰的屋子，头顶一块大柔光板：只给胡桃木底座一点软的高光
  const s = new THREE.Scene();
  const room = new THREE.Mesh(new THREE.BoxGeometry(60, 30, 60), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.42, 0.4, 0.37), side: THREE.BackSide }));
  room.position.y = 10;
  s.add(room);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.5, 0.47, 0.43) }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -4.9;
  s.add(floor);
  const panel = new THREE.Mesh(new THREE.PlaneGeometry(30, 20), new THREE.MeshBasicMaterial({ color: new THREE.Color(7.2, 7.0, 6.7) }));
  panel.rotation.x = Math.PI / 2;
  panel.position.set(-6, 24, -6);
  s.add(panel);
  const pm = new THREE.PMREMGenerator(renderer);
  const tex = pm.fromScene(s, 0.035).texture;
  pm.dispose();
  return tex;
}

function makeWaterEnvironment(renderer) {
  // 树脂面上映出来的屋子：three 自带的 RoomEnvironment（几扇亮的窗和灯板）。只给水用。
  const pm = new THREE.PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  const tex = pm.fromScene(room, 0.03).texture;
  room.dispose();
  pm.dispose();
  return tex;
}

const rad = THREE.MathUtils.degToRad;
const dirOf = (az, el, out = new THREE.Vector3()) => out.set(Math.sin(rad(az)) * Math.cos(rad(el)), Math.sin(rad(el)), Math.cos(rad(az)) * Math.cos(rad(el)));

export async function createTable(host, opts = {}) {
  const canvas = document.createElement('canvas');
  canvas.className = 'table-canvas';
  host.appendChild(canvas);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, opts.maxPixelRatio || 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.setClearColor(COLORS.room, 1);

  const scene = new THREE.Scene();
  const plinthEnv = makeEnvironment(renderer);
  const waterEnv = makeWaterEnvironment(renderer);

  const camera = new THREE.PerspectiveCamera(22, 1, 100, 120000);

  // 天光：比原来弱一半，偏冷；地面反上来的光偏暖
  const hemi = new THREE.HemisphereLight(0xc9ced6, 0xa8997f, 2.0);
  scene.add(hemi);
  // 主灯：唯一投影的一盏
  const key = new THREE.DirectionalLight(0xfff3e2, 4.0);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  scene.add(key, key.target);
  // 补光：跟着镜头，不投影
  const fill = new THREE.DirectionalLight(0xe4e8ee, 1.0);
  scene.add(fill, fill.target);

  // ---------- 地形 ----------
  const dem = await loadDem(opts.sharedBase || '../shared/');
  const terrain = buildTerrain(dem, EXTRA);
  const layerGeo = buildLayerGeometry(terrain.levels);
  const c = T.crop;
  const W = c.x1 - c.x0;
  const D = c.z1 - c.z0;
  const cx = (c.x0 + c.x1) / 2;
  const cz = (c.z0 + c.z1) / 2;

  const grain = TX.grainTexture(1);
  const aoTex = TX.dataTexture(terrain.ao.data, terrain.ao.w, terrain.ao.h);
  aoTex.channel = 1;
  const matTop = new THREE.MeshStandardMaterial({ color: COLORS.wood, roughness: 0.86, metalness: 0, map: grain, aoMap: aoTex, aoMapIntensity: 1, vertexColors: true });
  const matEdge = new THREE.MeshStandardMaterial({ color: COLORS.edge, roughness: 0.95, metalness: 0, map: TX.edgeTexture(), vertexColors: true });
  const caps = new THREE.Mesh(layerGeo.caps, matTop);
  const walls = new THREE.Mesh(layerGeo.walls, matEdge);
  // 桌子边上的切面：同样的切口颜色，加一点自发光，背着主灯也看得出是一层一层的板
  const edgeTex = matEdge.map;
  const matRim = new THREE.MeshStandardMaterial({ color: COLORS.edge, roughness: 0.95, metalness: 0, map: edgeTex, vertexColors: true, emissive: COLORS.edge, emissiveMap: edgeTex, emissiveIntensity: 0.3 });
  const rimWalls = new THREE.Mesh(layerGeo.rim, matRim);
  for (const m of [caps, walls, rimWalls]) {
    m.castShadow = true;
    m.receiveShadow = true;
    scene.add(m);
  }

  // ---------- 河：平地下面垫着的一整张靛蓝树脂板，从切开的河道里露出来 ----------
  const matResin = new THREE.MeshPhysicalMaterial({ color: COLORS.resin, roughness: 0.12, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.08, envMap: waterEnv, envMapIntensity: 0.3 });
  const sheetT = 14;
  const resin = new THREE.Mesh(new THREE.BoxGeometry(W, sheetT, D), matResin);
  resin.position.set(cx, -sheetT / 2, cz);
  resin.receiveShadow = true;
  scene.add(resin);

  // ---------- 底板（多层板）和胡桃木底座 ----------
  const boardT = 84;
  const ply = TX.plyTexture();
  ply.repeat.set(10, 1);
  const board = new THREE.Mesh(new THREE.BoxGeometry(W, boardT, D), new THREE.MeshStandardMaterial({ color: 0xf2e9d6, roughness: 0.9, map: ply }));
  board.position.set(cx, -sheetT - boardT / 2, cz);
  board.castShadow = true;
  board.receiveShadow = true;
  scene.add(board);

  const margin = 590;
  const plinthT = 560;
  const plinthTop = -sheetT - boardT;
  const walnut = TX.walnutTexture();
  walnut.repeat.set(3, 1.2);
  const matWalnut = new THREE.MeshPhysicalMaterial({ color: 0x8a7868, roughness: 0.5, metalness: 0, map: walnut, clearcoat: 0.35, clearcoatRoughness: 0.45, envMap: plinthEnv, envMapIntensity: 0.3 });
  const plinth = new THREE.Mesh(new RoundedBoxGeometry(W + margin * 2, plinthT, D + margin * 2, 4, 26), matWalnut);
  plinth.position.set(cx, plinthTop - plinthT / 2, cz);
  plinth.castShadow = true;
  plinth.receiveShadow = true;
  scene.add(plinth);
  // 底座前沿（西边）嵌的一块象牙色小牌：指北和比例尺。放在前沿的正中，桌角的山影落不到它上面。
  let plate;
  {
    const pw = 4300;
    const pd = 340;
    const u = 0.5; // 每个模型单位多少像素
    const cv = document.createElement('canvas');
    cv.width = pw * u;
    cv.height = pd * u;
    const g = cv.getContext('2d');
    g.fillStyle = '#efe7d6';
    g.fillRect(0, 0, cv.width, cv.height);
    g.strokeStyle = 'rgba(70,50,30,0.5)';
    g.lineWidth = 2;
    g.strokeRect(5, 5, cv.width - 10, cv.height - 10);
    const ink = '#3a2c20';
    g.fillStyle = ink;
    g.strokeStyle = ink;
    const mid = cv.height / 2;
    // 指北：牌子朝西摆，北在左手
    g.lineWidth = 5;
    g.beginPath();
    g.moveTo(170 * u, mid);
    g.lineTo(620 * u, mid);
    g.stroke();
    g.beginPath();
    g.moveTo(100 * u, mid);
    g.lineTo(280 * u, mid - 60 * u);
    g.lineTo(230 * u, mid);
    g.lineTo(280 * u, mid + 60 * u);
    g.closePath();
    g.fill();
    g.font = `600 ${Math.round(215 * u)}px "Noto Serif SC", "Songti SC", serif`;
    g.textBaseline = 'middle';
    g.textAlign = 'left';
    g.fillText('北', 690 * u, mid + 6);
    // 比例尺：两公里，每五百米一格
    const x0 = 1420 * u;
    const km = 1000 * u;
    const bh = 44 * u;
    g.lineWidth = 3;
    g.strokeRect(x0, mid + 62 * u, 2 * km, bh);
    g.fillRect(x0, mid + 62 * u, km / 2, bh);
    g.fillRect(x0 + km, mid + 62 * u, km / 2, bh);
    g.font = `600 ${Math.round(176 * u)}px "Noto Serif SC", "Songti SC", serif`;
    g.textBaseline = 'alphabetic';
    g.textAlign = 'center';
    g.fillText('0', x0, mid + 30 * u);
    g.fillText('1', x0 + km, mid + 30 * u);
    g.fillText('2', x0 + 2 * km, mid + 30 * u);
    g.textAlign = 'left';
    g.fillText('公里', x0 + 2 * km + 130 * u, mid + 104 * u);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    plate = new THREE.Mesh(new THREE.BoxGeometry(pw, 6, pd), [
      ...[0, 1].map(() => new THREE.MeshStandardMaterial({ color: 0xe6dcc6, roughness: 0.7 })),
      new THREE.MeshStandardMaterial({ map: tex, roughness: 0.62 }),
      ...[3, 4, 5].map(() => new THREE.MeshStandardMaterial({ color: 0xe6dcc6, roughness: 0.7 })),
    ]);
    // 画布的“右”对着南（+z），“上”对着东（+x）：从西边看过去是正的
    plate.rotation.y = -Math.PI / 2;
    plate.position.set(c.x0 - margin / 2 - 40, plinthTop + 1.5, cz - 500);
    plate.receiveShadow = true;
    scene.add(plate);
  }
  const kickT = 70;
  const kick = new THREE.Mesh(new THREE.BoxGeometry(W + margin * 2 - 240, kickT, D + margin * 2 - 240), new THREE.MeshStandardMaterial({ color: 0x17110d, roughness: 0.9 }));
  kick.position.set(cx, plinthTop - plinthT - kickT / 2, cz);
  scene.add(kick);
  const floorY = plinthTop - plinthT - kickT;

  // ---------- 展厅台面 ----------
  const pool = new THREE.Mesh(
    new THREE.CircleGeometry(52000, 64),
    new THREE.MeshBasicMaterial({ map: TX.poolTexture('#ddd7cc', '#cac3b7'), toneMapped: false }),
  );
  pool.rotation.x = -Math.PI / 2;
  pool.position.set(cx, floorY, cz);
  scene.add(pool);
  const blob = new THREE.Mesh(
    new THREE.PlaneGeometry((W + margin * 2) * 1.5, (D + margin * 2) * 1.62),
    new THREE.MeshBasicMaterial({ map: TX.blobTexture(), transparent: true, depthWrite: false, toneMapped: false, opacity: 0.9 }),
  );
  blob.rotation.x = -Math.PI / 2;
  blob.position.set(cx, floorY + 2, cz);
  blob.renderOrder = 1;
  scene.add(blob);
  const shadowFloor = new THREE.Mesh(new THREE.PlaneGeometry(60000, 60000), new THREE.ShadowMaterial({ opacity: 0.22, depthWrite: false }));
  shadowFloor.rotation.x = -Math.PI / 2;
  shadowFloor.position.set(cx, floorY + 4, cz);
  shadowFloor.receiveShadow = true;
  shadowFloor.renderOrder = 2;
  scene.add(shadowFloor);

  // ---------- 城、楼、船、树、田、针 ----------
  const models = buildModels({ scene, host, terrain, GEO, COLORS, T, EXTRA, grain, renderer, waterEnv, terrainMats: { top: matTop, edge: matEdge }, buildLayerGeometry });

  // ---------- 镜头 ----------
  let size = { w: 1, h: 1 };
  function resize() {
    const w = host.clientWidth || 1;
    const h = host.clientHeight || 1;
    size = { w, h };
    renderer.setSize(w, h, false);
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  // 沙盘（连底座）的八个角：自动取景用
  const corners = [];
  for (const x of [c.x0 - margin, c.x1 + margin])
    for (const z of [c.z0 - margin, c.z1 + margin]) for (const y of [plinthTop - plinthT, 420]) corners.push(new THREE.Vector3(x, y, z));
  const _p = new THREE.Vector3();
  const _q = new THREE.Vector3();
  /** 按一个“姿势”摆镜头：{ target, az, el, dist, fov } */
  function aim(p) {
    const az = rad(p.az);
    const el = rad(p.el);
    camera.fov = p.fov;
    camera.aspect = size.w / size.h;
    camera.position.set(p.target.x + p.dist * Math.sin(az) * Math.cos(el), p.target.y + p.dist * Math.sin(el), p.target.z + p.dist * Math.cos(az) * Math.cos(el));
    camera.near = Math.max(10, p.dist * 0.25);
    camera.far = p.dist * 4 + 60000;
    camera.lookAt(p.target);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
  }
  /** 一个镜头在当前画幅下的姿势（自动取景的要迭代几次）。 */
  function poseOf(s) {
    const tv = Math.tan(rad(s.fov / 2));
    const aspect = size.w / size.h;
    const gl = s.gloss || [0, 0.16];
    const p = { az: s.az, el: s.el, fov: s.fov, water: s.water, big: s.big || 0, gloss: gl[0], glossK: gl[1], exposure: s.exposure || 1, sunAz: s.sun[0], sunEl: s.sun[1], table: s.fit === 'table', reach: s.shadow || 0, top: s.shadowTop || 300 };
    if (s.fit === 'table') {
      const pad = (size.w < 520 && s.padNarrow) || s.pad || [0.06, 0.06, 0.06, 0.06];
      p.target = new THREE.Vector3(cx, 0, cz);
      p.dist = 30000;
      // 反复两件事：调远近到刚好装下，再把沙盘挪到留空以后的正中
      for (let it = 0; it < 14; it++) {
        aim(p);
        let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
        for (const cnr of corners) {
          _p.copy(cnr).project(camera);
          x0 = Math.min(x0, _p.x); x1 = Math.max(x1, _p.x); y0 = Math.min(y0, _p.y); y1 = Math.max(y1, _p.y);
        }
        const k = Math.max((x1 - x0) / (2 * (1 - pad[1] - pad[3])), (y1 - y0) / (2 * (1 - pad[0] - pad[2])));
        p.dist *= k;
        const offX = (x0 + x1) / 2 / k - (pad[3] - pad[1]);
        const offY = (y0 + y1) / 2 / k - (pad[2] - pad[0]);
        const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
        const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
        p.target.addScaledVector(right, offX * p.dist * tv * aspect).addScaledVector(up, offY * p.dist * tv);
      }
      p.shadowAt = new THREE.Vector3(cx, 0, cz);
    } else {
      p.target = new THREE.Vector3(...s.target);
      p.dist = Math.max(s.halfW / (tv * aspect), s.halfH / tv);
      p.shadowAt = new THREE.Vector3(...(s.shadowAt || s.target));
    }
    return p;
  }

  // ---------- 灯跟着镜头摆；影子只算画面里用得着的那一块 ----------
  const lightCam = new THREE.PerspectiveCamera();
  const sunDir = new THREE.Vector3();
  const volume = [];
  for (const x of [c.x0 - margin - 1100, c.x1 + margin + 1100])
    for (const z of [c.z0 - margin - 1100, c.z1 + margin + 1100]) for (const y of [floorY - 10, 860]) volume.push(new THREE.Vector3(x, y, z));
  function aimLights(p) {
    dirOf(p.sunAz, p.sunEl, sunDir);
    key.target.position.copy(p.shadowAt);
    key.position.copy(p.shadowAt).addScaledVector(sunDir, 30000);
    // 补光从镜头这一边来，抬到 30 度以上
    dirOf(p.az, Math.max(30, p.el), _q);
    fill.target.position.copy(p.target);
    fill.position.copy(p.target).addScaledVector(_q, 30000);

    // 影子相机的朝向同 three 里算的一样（看向 target，up 取 y）
    lightCam.position.copy(key.position);
    lightCam.up.set(0, 1, 0);
    lightCam.lookAt(key.target.position);
    lightCam.updateMatrixWorld();
    const inv = lightCam.matrixWorldInverse;
    let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9, d0 = 1e9, d1 = -1e9;
    const take = (v) => {
      _p.copy(v).applyMatrix4(inv);
      x0 = Math.min(x0, _p.x); x1 = Math.max(x1, _p.x); y0 = Math.min(y0, _p.y); y1 = Math.max(y1, _p.y);
    };
    if (p.table) {
      for (const v of volume) take(v);
    } else {
      // 画面里看得见的地面（和它上面一截高度），离 shadowAt 太远的不算
      const o = camera.position;
      for (let iy = 0; iy <= 6; iy++)
        for (let ix = 0; ix <= 6; ix++) {
          _q.set(-1 + ix / 3, -1 + iy / 3, 0.5).unproject(camera).sub(o).normalize();
          for (const h of [0, p.top]) {
            let t = _q.y < -1e-4 ? (h - o.y) / _q.y : 1e6;
            if (t < 0) t = 1e6;
            let px = o.x + _q.x * t;
            let pz = o.z + _q.z * t;
            const dx = px - p.shadowAt.x;
            const dz = pz - p.shadowAt.z;
            const d = Math.hypot(dx, dz);
            if (d > p.reach) {
              px = p.shadowAt.x + (dx / d) * p.reach;
              pz = p.shadowAt.z + (dz / d) * p.reach;
            }
            take(_p.set(px, h, pz).clone());
          }
        }
    }
    for (const v of volume) {
      _p.copy(v).applyMatrix4(inv);
      d0 = Math.min(d0, -_p.z); d1 = Math.max(d1, -_p.z);
    }
    const sc = key.shadow.camera;
    const padXY = (Math.max(x1 - x0, y1 - y0) / 2048) * 6;
    sc.left = x0 - padXY;
    sc.right = x1 + padXY;
    sc.bottom = y0 - padXY;
    sc.top = y1 + padXY;
    sc.near = Math.max(10, d0 - 200);
    sc.far = d1 + 200;
    sc.updateProjectionMatrix();
    // 偏移按一个影子像素有多大来给：不然贴着墙根的影子会漏光，斜面上会起纹
    const texel = Math.max(sc.right - sc.left, sc.top - sc.bottom) / 2048;
    key.shadow.bias = -(texel * 1.4) / (sc.far - sc.near);
    key.shadow.normalBias = texel * 1.2;
    key.shadow.radius = texel < 1.2 ? 3.2 : 2.4;
  }

  // 树脂面上映的那间屋子转到哪个角度、多亮：每个镜头挑一个角度，让一扇窗的柔光斜着落在水面上（或者不落）
  function setGloss(deg, k) {
    for (const m of [matResin, ...models.waterMats]) {
      m.envMapRotation.y = rad(deg);
      m.envMapIntensity = k;
    }
  }

  // 景深：上下两条虚化带（网页的 backdrop-filter），只在近景里用
  const tiltTop = document.createElement('div');
  tiltTop.className = 'tilt tilt-top';
  const tiltBottom = document.createElement('div');
  tiltBottom.className = 'tilt tilt-bottom';
  host.append(tiltTop, tiltBottom);

  let current = null; // 当前的镜头（设定）
  let pose = null; // 当前的姿势
  let raf = 0;
  const listeners = new Set();
  function render() {
    renderer.render(scene, camera);
    models.layoutLabels(camera, size);
    for (const fn of listeners) fn(api);
  }
  const labelsOf = (s) => (size.w < 520 && s.labelsNarrow ? s.labelsNarrow : s.labels);
  function settle(s, p, { silent = false } = {}) {
    current = s;
    pose = p;
    aim(p);
    aimLights(p);
    tiltTop.style.height = ((s.tilt && s.tilt.top) || 0) * 100 + '%';
    tiltBottom.style.height = ((s.tilt && s.tilt.bottom) || 0) * 100 + '%';
    plate.visible = s.plate !== false;
    setGloss(p.gloss, p.glossK);
    renderer.toneMappingExposure = p.exposure;
    models.setState({ water: s.water, after: s.after, big: p.big, labels: silent ? [] : labelsOf(s), camera, size });
    if (!silent) render();
  }
  const ease = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
  const turn = (a, b) => ((b - a + 540) % 360) - 180;
  function tweenTo(s, ms) {
    cancelAnimationFrame(raf);
    const from = pose;
    const to = poseOf(s);
    const fromAfter = current.after;
    const dAz = turn(from.az, to.az);
    const dSun = turn(from.sunAz, to.sunAz);
    const t0 = performance.now();
    tiltTop.style.height = tiltBottom.style.height = '0%';
    models.setState({ water: from.water, after: fromAfter, big: from.big, labels: [], camera, size });
    const step = (now) => {
      const x = Math.min(1, (now - t0) / ms);
      const e = ease(x);
      if (x >= 1) {
        to.az = ((to.az + 540) % 360) - 180;
        settle(s, to);
        return;
      }
      const mix = (a, b) => a + (b - a) * e;
      const p = {
        target: from.target.clone().lerp(to.target, e),
        az: from.az + dAz * e,
        el: mix(from.el, to.el),
        dist: Math.exp(mix(Math.log(from.dist), Math.log(to.dist))),
        fov: mix(from.fov, to.fov),
        water: mix(from.water, to.water),
        big: mix(from.big, to.big),
        sunAz: from.sunAz + dSun * e,
        sunEl: mix(from.sunEl, to.sunEl),
        gloss: to.gloss,
        glossK: mix(from.glossK, to.glossK),
        exposure: mix(from.exposure, to.exposure),
        // 飞的时候影子按整张桌子算，省得一路上抖
        table: true,
        shadowAt: from.shadowAt.clone().lerp(to.shadowAt, e),
      };
      aim(p);
      aimLights(p);
      setGloss(p.gloss, p.glossK);
      renderer.toneMappingExposure = p.exposure;
      models.setState({ water: p.water, after: e > 0.5 ? s.after : fromAfter, big: p.big, labels: [], camera, size });
      render();
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
  }

  const api = {
    renderer,
    scene,
    camera,
    terrain,
    models,
    shots: SHOTS,
    lights: { key, fill, hemi },
    get shot() {
      return current && current.name;
    },
    stats: () => ({ tris: renderer.info.render.triangles, calls: renderer.info.render.calls }),
    /** 画面上“北”朝哪边：从正上方顺时针的角度（度）。 */
    northAngle() {
      const a = pose.target.clone().project(camera);
      const b = pose.target.clone().add(new THREE.Vector3(0, 0, -200)).project(camera);
      return (Math.atan2((b.x - a.x) * size.w, (b.y - a.y) * size.h) * 180) / Math.PI;
    },
    /** 画面正中的地面上，一米是多少像素（横着量）。 */
    pxPerMeter() {
      // 画面正中的视线落在地面上的那一点
      const o = camera.position;
      const d = _q.set(0, 0, 0.5).unproject(camera).sub(o).normalize();
      const t = d.y < -1e-4 ? (T.plainY - o.y) / d.y : pose.dist;
      const a = new THREE.Vector3(o.x + d.x * t, T.plainY, o.z + d.z * t);
      const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
      const b = a.clone().addScaledVector(right, 100);
      a.project(camera);
      b.project(camera);
      return (Math.hypot((b.x - a.x) * size.w, (b.y - a.y) * size.h) / 2) / 100;
    },
    /** 底座上嵌的指北和比例尺是不是在画面里、看得清。 */
    plateReadable() {
      return !!(current && current.fit === 'table' && current.plate !== false && Math.abs(((current.az + 540) % 360) - 180 + 90) < 20 && size.w >= 700);
    },
    onRender(fn) {
      listeners.add(fn);
    },
    /** 换镜头。animate 为真时飞过去（网页上跟着正文走的时候用），否则直接到位。 */
    setShot(name, { animate = false, custom } = {}) {
      const s = { ...(SHOTS[name] || SHOTS.arrive), ...(custom || {}), name };
      if (animate && pose && !matchMedia('(prefers-reduced-motion: reduce)').matches) tweenTo(s, 1700);
      else {
        cancelAnimationFrame(raf);
        settle(s, poseOf(s));
      }
    },
    /** 另拍一张小图（首页人物卡片上用）：临时换尺寸和镜头，画到一张普通画布上，再换回来。 */
    snapshot(name, w, h, custom) {
      cancelAnimationFrame(raf);
      const keep = current;
      size = { w, h };
      renderer.setSize(w, h, false);
      const s = { ...(SHOTS[name] || SHOTS.arrive), ...(custom || {}), name };
      settle(s, poseOf(s), { silent: true });
      renderer.render(scene, camera);
      const out = document.createElement('canvas');
      out.width = canvas.width;
      out.height = canvas.height;
      out.getContext('2d').drawImage(canvas, 0, 0);
      resize();
      if (keep) settle(keep, poseOf(keep));
      return out;
    },
    render,
    resize() {
      resize();
      if (current) {
        cancelAnimationFrame(raf);
        settle(current, poseOf(current));
      }
    },
  };
  resize();
  api.setShot(opts.shot || 'arrive', { custom: opts.custom });
  if (typeof ResizeObserver !== 'undefined') {
    let first = true;
    new ResizeObserver(() => {
      if (first) {
        first = false;
        return;
      }
      api.resize();
    }).observe(host);
  }
  return api;
}
