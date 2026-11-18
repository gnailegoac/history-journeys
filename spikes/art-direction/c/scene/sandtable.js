// 沙盘：把地、水、城、小模型、座子、光装在一起，按“镜头”摆好再出图。
import * as THREE from 'three';
import { loadDem } from '../../shared/scene-data.js';
import { buildTerrainData, makeHeightTexture, makeNormalTexture, makeAlbedoTexture, buildTerrainMesh, buildSkirt, TABLE_M, U, EXAG, LEVELS_M, yOf, SLAB_BOTTOM, placeM } from './terrain.js';
import { makeLights, aimSun, sunVector, makeEnvironment, makeStand, makeFloorShadow, makeCloudUniforms, makeCloudPatch, TRAY_H } from './stage.js';
import { makeWater, makeWaterEdge } from './water.js';
import { buildCity, GATES, CITY_Y } from './city.js';
import { buildScatter } from './scatter.js';
import { tileTexture, brickTexture, earthTexture } from './kit.js';
import { makePost } from './post.js';
import { PAL } from './palette.js';
import { mulberry32, makeNoise, clamp } from './util.js';

export { EXAG };

const TONE = {
  aces: THREE.ACESFilmicToneMapping,
  neutral: THREE.NeutralToneMapping,
  agx: THREE.AgXToneMapping,
};

function strataTexture() {
  const W = 1024;
  const H = 512;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d');
  const img = g.createImageData(W, H);
  const n = makeNoise(21);
  const rnd = mulberry32(22);
  const cols = [PAL.soilA, PAL.soilB, PAL.soilC, PAL.soilD].map((h) => new THREE.Color(h).convertLinearToSRGB());
  const span = 12.2;
  for (let j = 0; j < H; j++) {
    const y = SLAB_BOTTOM + (1 - j / H) * span;
    for (let i = 0; i < W; i++) {
      // 横向可平铺的起伏
      const a = (i / W) * Math.PI * 2;
      const wob = Math.sin(a * 2 + 1.3) * 0.22 + Math.sin(a * 5 + 0.4) * 0.1 + Math.sin(a * 11) * 0.04;
      const yy = y + wob;
      const k = yy > -1.5 ? 0 : yy > -3.3 ? 1 : yy > -5.0 ? 2 : 3;
      const col = cols[k];
      // 细纹：每层里一道道更深的线
      const band = 0.5 + 0.5 * Math.sin(yy * (k === 3 ? 9 : 16) + Math.sin(a * 7) * 1.5);
      const grain = n(i / 3.1, j / 3.1);
      const shade = 0.9 + band * 0.1 + (grain - 0.5) * 0.12;
      const o = (j * W + i) * 4;
      img.data[o] = clamp(col.r * 255 * shade, 0, 255);
      img.data[o + 1] = clamp(col.g * 255 * shade, 0, 255);
      img.data[o + 2] = clamp(col.b * 255 * shade, 0, 255);
      img.data[o + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  // 砂石层里的小石子
  for (let s = 0; s < 420; s++) {
    const x = rnd() * W;
    const yv = -3.4 - rnd() * 1.5;
    const j = (1 - (yv - SLAB_BOTTOM) / span) * H;
    const r = 1 + rnd() * 2.6;
    g.fillStyle = rnd() < 0.5 ? 'rgba(120,108,92,0.55)' : 'rgba(238,226,200,0.6)';
    g.beginPath();
    g.ellipse(x, j, r * 1.5, r, 0, 0, Math.PI * 2);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.ClampToEdgeWrapping;
  t.repeat.set(1 / 46, 1 / span);
  t.offset.set(0, -SLAB_BOTTOM / span);
  t.anisotropy = 8;
  return t;
}

/**
 * 镜头。az：相机在目标的哪一边（0 正南，90 正东）；el：俯角；frame：要装进画面的宽高（场景单位）。
 * landmark：门楼、角楼、戏马台放大多少（'auto' 是按画面里一个单位有多少像素来定，整张沙盘的镜头里才用）。
 * sun：[方位, 高度角, 强度]；cloud：云影的浓淡。
 */
export const SHOTS = {
  arrive: {
    section: '到徐州',
    target: [-2, 0.4, -4.5],
    az: -9,
    el: 45,
    fov: 22,
    fit: 'table',
    pad: (w) => (w <= 900 ? [4, 8, 8, 8] : [8, 14, 80, 6]),
    sun: [238, 16, 8.2],
    fill: 0.62,
    cloud: 0.36,
    water: 'river',
    era: 'before',
    landmark: 'auto',
    dof: { dead: 0.2, range: 0.55, blur: 2.6 },
    shadow: { center: [-2, 0, -4.5], half: 78, halfV: 42, radius: 0.8 },
  },
  hero: {
    section: '到徐州',
    target: [-2, 0.4, -4.5],
    az: -30,
    el: 27,
    fov: 22,
    fit: 'table',
    pad: [0, 0, 0, 0],
    sun: [243, 16, 8.2],
    fill: 0.62,
    cloud: 0.36,
    water: 'river',
    era: 'before',
    landmark: 'auto',
    dof: { dead: 0.1, range: 0.4, blur: 3.6 },
    shadow: { center: [-2, 0, -4.5], half: 78, halfV: 42, radius: 0.8 },
  },
  // 首页苏轼那张卡片上的小图：城和河湾
  thumb: {
    section: '到徐州',
    target: [1.6, 0.5, 1.7],
    az: -24,
    el: 36,
    fov: 22,
    frame: [28, 15.7],
    sun: [243, 19, 7.4],
    fill: 0.62,
    cloud: 0,
    water: 'river',
    era: 'before',
    landmark: 1.5,
    dof: { dead: 0.3, range: 0.6, blur: 1.2 },
    shadow: { center: [1, 0, 0], half: 30, radius: 1.0 },
  },
  flood: {
    section: '住在城墙上',
    target: [1.4, 0.6, 1.2],
    az: 34,
    el: 26,
    fov: 24,
    frame: [47, 26],
    topPoint: [-20, 0.8, -55],
    topPad: 120,
    sun: [224, 26, 5.2],
    fill: 0.62,
    cloud: 0.62,
    water: 'flood',
    era: 'flood',
    dof: { dead: 0.14, range: 0.45, blur: 3.4 },
    shadow: { center: [0, 0, 0], half: 46, radius: 1.6 },
  },
  close: {
    section: '水退以后',
    target: [6.25, 1.3, 0.1],
    // 相机在东门外偏南一点，朝西偏北看：远处正对着西边那个没有山的缺口
    az: 83,
    el: 12.5,
    fov: 26,
    frame: [5.7, 5.2],
    // 沙盘西边的盘沿摆到站名下面：画面顶上露出盘沿和背景，看得出这是一座模型
    topPoint: [-60, 0.5, -8],
    topPad: 66,
    // 早晨的太阳，从东北斜着照过来：东门这一面是亮的，屋檐和马面的影子落在墙上
    sun: [46, 26, 5.8],
    fill: 0.5,
    cloud: 0,
    water: 'river',
    era: 'after',
    ripple: 0.3,
    dof: { dead: 0.06, range: 0.5, blur: 5.0 },
    shadow: { center: [5.2, 0.8, 0], half: 10, radius: 1.8 },
  },
};

export async function createSandTable({ canvas, labelLayer, getFreeRect, tone = 'neutral', maxPixelRatio = 2 }) {
  // 临时改画面大小时用（给首页卡片出小图）：{ w, h }
  let override = null;
  const viewW = () => (override ? override.w : canvas.clientWidth);
  const viewH = () => (override ? override.h : canvas.clientHeight);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, maxPixelRatio));
  renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.VSMShadowMap;
  renderer.shadowMap.autoUpdate = false;
  renderer.toneMapping = TONE[tone] ?? THREE.NeutralToneMapping;
  renderer.toneMappingExposure = tone === 'aces' ? 1.25 : 1.0;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(PAL.backdrop);
  const camera = new THREE.PerspectiveCamera(24, 1, 1, 2000);

  const dem = await loadDem('../shared/');
  const td = buildTerrainData(dem);
  const heightTex = makeHeightTexture(td);
  const normalTex = makeNormalTexture(td);

  const cloud = makeCloudUniforms();
  const patch = makeCloudPatch(cloud);

  // 小模型的材质
  const tileTex = tileTexture();
  const brickTex = brickTexture();
  const mats = {
    brick: patch(new THREE.MeshStandardMaterial({ map: brickTex, vertexColors: true, roughness: 0.92, metalness: 0, envMapIntensity: 0.6 })),
    body: patch(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0, envMapIntensity: 0.6 })),
    roof: patch(new THREE.MeshStandardMaterial({ map: tileTex, vertexColors: true, roughness: 0.6, metalness: 0, envMapIntensity: 0.9 })),
    // 刷了黄土的墙、夯土的台子：粗、不反光
    earth: patch(new THREE.MeshStandardMaterial({ map: earthTexture(), vertexColors: true, roughness: 0.96, metalness: 0, envMapIntensity: 0.35 })),
    plain: (opts) => patch(new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0, envMapIntensity: 0.6, ...opts })),
  };
  mats.flag = mats.body;

  const city = buildCity(mats);
  city.group.name = "city";
  scene.add(city.group);

  const scatter = buildScatter({ td, mats, patch, cityTreeSpots: city.treeSpots });
  scatter.group.name = "scatter";
  scene.add(scatter.group);

  const albedoTex = makeAlbedoTexture(td, [...city.footprints, ...scatter.footprints]);
  albedoTex.anisotropy = renderer.capabilities.getMaxAnisotropy();

  // 地
  const groundU = {
    uLevel: { value: 0.3 },
    uWet: { value: 1.0 },
    uUnderBlur: { value: 1.5 },
    uHeightTex: { value: heightTex },
    uTexXf: { value: new THREE.Vector4((td.NX - 1) / td.NX, (td.NZ - 1) / td.NZ, 0.5 / td.NX, 0.5 / td.NZ) },
    uCityHalf: { value: new THREE.Vector2(GATES.east.x, GATES.south.z) },
  };
  const terrainMat = patch(
    new THREE.MeshStandardMaterial({
      map: albedoTex,
      normalMap: normalTex,
      normalMapType: THREE.ObjectSpaceNormalMap,
      roughness: 0.94,
      metalness: 0,
      envMapIntensity: 0.55,
    }),
    (shader) => {
      Object.assign(shader.uniforms, groundU);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vGroundPos;')
        .replace('#include <project_vertex>', '#include <project_vertex>\nvGroundPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
          varying vec3 vGroundPos;
          uniform float uLevel;
          uniform float uWet;
          uniform float uUnderBlur;
          uniform sampler2D uHeightTex;
          uniform vec4 uTexXf;
          uniform vec2 uCityHalf;
          float sdBox2(vec2 p, vec2 b) {
            vec2 e = abs(p) - b;
            return length(max(e, 0.0)) + min(max(e.x, e.y), 0.0);
          }`,
        )
        .replace(
          '#include <map_fragment>',
          `{
            // 地表的颜色。水面以下的地方取模糊一些的那一级：隔着水看，田垄的细线是化开的
            float protK0 = texture2D(uHeightTex, vMapUv * uTexXf.xy + uTexXf.zw).g;
            float under = smoothstep(0.0, 0.09, uLevel - vGroundPos.y) * (1.0 - step(0.3, protK0));
            diffuseColor *= texture2D(map, vMapUv, under * uUnderBlur);
          }
          {
            // 城墙、马面、城台、角台脚下压一圈暗：模型是“坐”在地上的
            vec2 q = abs(vGroundPos.xz);
            vec2 H = uCityHalf;
            float d = sdBox2(q, H + 0.30);
            d = min(d, sdBox2(q - vec2(2.55, H.y + 0.33), vec2(0.34, 0.25)));
            d = min(d, sdBox2(q - vec2(4.25, H.y + 0.33), vec2(0.34, 0.25)));
            d = min(d, sdBox2(q - vec2(H.x + 0.33, 2.55), vec2(0.25, 0.34)));
            d = min(d, sdBox2(q - vec2(H.x + 0.33, 4.25), vec2(0.25, 0.34)));
            d = min(d, sdBox2(q - vec2(0.0, H.y + 0.1), vec2(1.2, 0.54)));
            d = min(d, sdBox2(q - vec2(H.x + 0.1, 0.0), vec2(0.54, 1.2)));
            d = min(d, sdBox2(q - (H + 0.08), vec2(0.5)));
            float outer = (1.0 - smoothstep(0.0, 0.46, d)) * step(-0.3, d);
            float di = min(H.x - q.x, H.y - q.y) - 0.27;
            float inner = (1.0 - smoothstep(0.0, 0.3, di)) * step(0.0, di);
            diffuseColor.rgb *= 1.0 - 0.36 * max(outer * outer, inner * 0.7);
            // 水边一道湿印
            float protK = texture2D(uHeightTex, vMapUv * uTexXf.xy + uTexXf.zw).g;
            float dy = vGroundPos.y - uLevel;
            float wet = smoothstep(-0.03, 0.0, dy) * (1.0 - smoothstep(0.012, 0.06, dy)) * (1.0 - step(0.3, protK)) * uWet;
            diffuseColor.rgb *= mix(vec3(1.0), vec3(0.72, 0.75, 0.73), wet);
          }`,
        );
    },
  );
  const terrain = buildTerrainMesh(td, terrainMat);
  scene.add(terrain.mesh);

  // 四边的土层切面
  const skirt = buildSkirt(td, terrain.xs, terrain.zs);
  // 土层的切面整体压暗、去一点火气：低太阳正照着的那一面不会变成一片橙色
  const skirtMat = patch(new THREE.MeshStandardMaterial({ map: strataTexture(), color: '#C2BCB6', roughness: 0.95, metalness: 0, envMapIntensity: 0.5 }), (shader) => {
    shader.uniforms.uTopsoil = { value: new THREE.Color(PAL.soilTop) };
    shader.uniforms.uLip = { value: new THREE.Color('#7E9A55') };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aDepth;\nvarying float vDepth;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvDepth = aDepth;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vDepth;\nuniform vec3 uTopsoil;\nuniform vec3 uLip;')
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        diffuseColor.rgb = mix(uTopsoil, diffuseColor.rgb, smoothstep(0.26, 0.40, vDepth + 0.05 * sin(vMapUv.x * 90.0)));
        diffuseColor.rgb = mix(uLip, diffuseColor.rgb, smoothstep(0.04, 0.06, vDepth));`,
      );
  });
  const skirtMesh = new THREE.Mesh(skirt.geo, skirtMat);
  skirtMesh.castShadow = true;
  skirtMesh.receiveShadow = true;
  scene.add(skirtMesh);

  // 水
  const water = makeWater(td, heightTex, patch);
  scene.add(water.mesh);
  scene.add(makeWaterEdge(skirt.wgeo, water.uniforms, patch));

  // 座子、背景上的影子
  const stand = makeStand(patch);
  stand.group.name = "stand";
  scene.add(stand.group);
  const floorShadow = makeFloorShadow(stand);
  scene.add(floorShadow.mesh);

  // 光
  const { sun, fill } = makeLights(scene);
  let envRT = null;

  const post = makePost(renderer);

  // 地名
  const labels = [];
  function addLabel(id, text, pos, kind = 'place') {
    const el = document.createElement('div');
    el.className = `st-label st-${kind}`;
    el.innerHTML = `<span class="st-tag">${text}</span><span class="st-stem"></span><span class="st-dot"></span>`;
    el.style.display = 'none';
    labelLayer?.appendChild(el);
    const l = { id, el, pos: new THREE.Vector3(...pos), kind };
    labels.push(l);
    return l;
  }
  const groundAt = (xm, zm, lift = 0) => [xm * U, td.yAtM(xm, zm) + lift, zm * U];
  const pm = (id) => placeM(id);
  addLabel('city', '徐州', [0, CITY_Y + 0.5, -0.6]);
  const ximataiLabel = addLabel('ximatai', '戏马台', groundAt(...pm('ximatai'), 0.75));
  const ximataiBaseY = scatter.ximatai.position.y;
  addLabel('yunlong', '云龙山', groundAt(...pm('yunlongshan'), 0.25));
  addLabel('baibuhong', '百步洪', [scatter.rapids[0], yOf(LEVELS_M.river) + 0.1, scatter.rapids[1]]);
  addLabel('huanglou', '黄楼', [GATES.east.x + 0.1, CITY_Y + 2.0, 0]);
  addLabel('fanghe', '放鹤亭', groundAt(...pm('fangheting'), 0.6));
  addLabel('bian', '汴水', scatter.riverPoint('bian', -3300), 'water');
  addLabel('si', '泗水', scatter.riverPoint('si', -3600), 'water');
  addLabel('sijoin', '泗水', scatter.riverPoint('joined', 260), 'water');
  addLabel('dike', '东南长堤', scatter.dikeMid, 'place');
  addLabel('eastgate', '东门', [GATES.east.x + 0.1, CITY_Y + 1.6, 0]);
  addLabel('southgate', '南门', [0, CITY_Y + 1.6, GATES.south.z + 0.1]);

  let current = null;
  let shotName = 'arrive';
  const state = { labelSpec: {} };

  // 整张沙盘（连座子）的八个角，用来把它正好装进画面
  const boxPts = (() => {
    const m = stand.margin;
    const x0 = TABLE_M.minX * U;
    const x1 = TABLE_M.maxX * U;
    const z0 = TABLE_M.minZ * U;
    const z1 = TABLE_M.maxZ * U;
    const yb = SLAB_BOTTOM - TRAY_H;
    const pts = [];
    for (const [x, z] of [
      [x0, z0],
      [x1, z0],
      [x1, z1],
      [x0, z1],
    ]) {
      pts.push(new THREE.Vector3(x, 2.2, z));
      pts.push(new THREE.Vector3(x + Math.sign(x) * m, yb, z + Math.sign(z) * m));
    }
    return pts;
  })();

  function placeCamera(shot, dist) {
    const az = (shot.az * Math.PI) / 180;
    const el = (shot.el * Math.PI) / 180;
    const t = new THREE.Vector3(...shot.target);
    camera.position.set(t.x + Math.sin(az) * Math.cos(el) * dist, t.y + Math.sin(el) * dist, t.z + Math.cos(az) * Math.cos(el) * dist);
    camera.near = Math.max(0.5, dist * 0.25);
    camera.far = dist * 2.4 + 260;
    camera.lookAt(t);
    camera.clearViewOffset();
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
  }

  function fitCamera(shot) {
    const w = viewW();
    const h = viewH();
    const free = getFreeRect && !override ? getFreeRect() : { x0: 0, y0: 0, x1: w, y1: h };
    const fw = Math.max(50, free.x1 - free.x0);
    const fh = Math.max(50, free.y1 - free.y0);
    camera.fov = shot.fov;
    camera.aspect = w / h;
    let dist;
    let cx = (free.x0 + free.x1) / 2;
    let cy = (free.y0 + free.y1) / 2;
    let shiftX = 0;
    let shiftY = 0;
    if (shot.fit === 'table') {
      // 找一个距离，让整张沙盘正好装进空出来的那一块
      const pad = (typeof shot.pad === 'function' ? shot.pad(w, h) : shot.pad) ?? [10, 10, 10, 10]; // 上右下左
      const aw = fw - pad[1] - pad[3];
      const ah = fh - pad[0] - pad[2];
      const v = new THREE.Vector3();
      const measure = (d) => {
        placeCamera(shot, d);
        let minX = Infinity;
        let maxX = -Infinity;
        let minY = Infinity;
        let maxY = -Infinity;
        for (const p of boxPts) {
          v.copy(p).project(camera);
          const px = (v.x * w) / 2;
          const py = (-v.y * h) / 2;
          minX = Math.min(minX, px);
          maxX = Math.max(maxX, px);
          minY = Math.min(minY, py);
          maxY = Math.max(maxY, py);
        }
        return { minX, maxX, minY, maxY };
      };
      let lo = 20;
      let hi = 3000;
      for (let i = 0; i < 28; i++) {
        const mid = (lo + hi) / 2;
        const bb = measure(mid);
        if (bb.maxX - bb.minX <= aw && bb.maxY - bb.minY <= ah) hi = mid;
        else lo = mid;
      }
      dist = hi;
      const bb = measure(dist);
      cx = free.x0 + pad[3] + aw / 2;
      cy = free.y0 + pad[0] + ah / 2;
      shiftX = (bb.minX + bb.maxX) / 2;
      shiftY = (bb.minY + bb.maxY) / 2;
    } else {
      const tanV = Math.tan((shot.fov * Math.PI) / 360);
      const dW = shot.frame[0] / 2 / ((fw / h) * tanV);
      const dH = shot.frame[1] / 2 / ((fh / h) * tanV);
      dist = Math.max(dW, dH);
      placeCamera(shot, dist);
      if (shot.topPoint) {
        // 把远处的一个点（比如北边的山顶）摆到空出来那一块的顶上
        const v = new THREE.Vector3(...shot.topPoint).project(camera);
        shiftY = (-v.y * h) / 2;
        cy = free.y0 + (shot.topPad ?? 20);
      }
    }
    camera.setViewOffset(w, h, Math.round(w / 2 - cx + shiftX), Math.round(h / 2 - cy + shiftY), w, h);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    const pr = renderer.getPixelRatio();
    post.uniforms.uFocus.value = dist;
    post.uniforms.uDead.value = dist * shot.dof.dead;
    post.uniforms.uRange.value = dist * shot.dof.range;
    post.uniforms.uMaxBlur.value = shot.dof.blur * pr * (h / 900);
    post.uniforms.uCenter.value.set(cx / w, 1 - cy / h);
    return dist;
  }

  function setShot(name, labelSpec) {
    const shot = SHOTS[name] ?? SHOTS.arrive;
    shotName = SHOTS[name] ? name : 'arrive';
    current = shot;
    if (labelSpec) state.labelSpec = labelSpec;
    // 光
    const dir = sunVector(shot.sun[0], shot.sun[1]);
    sun.position.copy(dir);
    sun.intensity = shot.sun[2] ?? 5.6;
    fill.intensity = shot.fill ?? 0.5;
    cloud.uCloudAmt.value = shot.cloud ?? 0;
    aimSun(sun, dir, new THREE.Vector3(...shot.shadow.center), shot.shadow.half, Math.max(60, shot.shadow.half * 1.6), shot.shadow.halfV ?? shot.shadow.half);
    sun.shadow.radius = shot.shadow.radius;
    if (envRT) envRT.dispose();
    envRT = makeEnvironment(renderer, dir);
    scene.environment = envRT.texture;
    scene.environmentIntensity = 0.3;
    floorShadow.update(dir);
    // 水
    const flood = shot.water === 'flood';
    water.setLevel(yOf(flood ? LEVELS_M.flood : LEVELS_M.river), flood ? 6.6 : 8.0);
    water.uniforms.uShallow.value.set(flood ? PAL.floodShallow : PAL.waterShallow);
    if (flood) water.uniforms.uDeepRange.value.set(0.05, 0.55);
    else water.uniforms.uDeepRange.value.set(0.02, 0.25);
    groundU.uLevel.value = water.uniforms.uLevel.value;
    groundU.uWet.value = flood ? 0.45 : 1.0;
    groundU.uUnderBlur.value = flood ? 1.3 : 1.2;
    const rip = shot.ripple ?? 0.05;
    water.mesh.material.normalScale.set(rip, rip);
    // 哪些东西在场
    city.eastTower.visible = shot.era !== 'after';
    city.huanglou.visible = shot.era === 'after';
    scatter.setEra(shot.era, flood);
    fitCamera(shot);
    scaleLandmarks(shot);
    renderer.shadowMap.needsUpdate = true;
  }

  /** 整张沙盘的镜头里，门楼、角楼和戏马台绕着各自的底座放大，不然只是几个点。 */
  function scaleLandmarks(shot) {
    let k = shot.landmark ?? 1;
    if (k === 'auto') {
      // 一座门楼长 1.3 个单位；让它在画面上有 17 个像素左右
      const ppu = kmInPixels() / 10;
      k = clamp(17 / (1.3 * ppu), 1, 2.6);
    }
    for (const g of city.landmarks) g.scale.setScalar(k);
    scatter.ximatai.scale.setScalar(k);
    city.pennants.visible = k < 1.05;
    ximataiLabel.pos.y = ximataiBaseY + 0.78 * k;
  }

  function placeLabels() {
    if (!labelLayer || override) return;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    const v = new THREE.Vector3();
    for (const l of labels) {
      const spec = state.labelSpec[l.id];
      if (!spec) {
        l.el.style.display = 'none';
        continue;
      }
      v.copy(l.pos).project(camera);
      const x = (v.x * 0.5 + 0.5) * w;
      const y = (-v.y * 0.5 + 0.5) * h;
      l.el.style.display = '';
      l.el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
      const stem = spec.stem ?? 26;
      const dx = spec.dx ?? 0;
      l.el.style.setProperty('--stem', `${stem}px`);
      l.el.style.setProperty('--dx', `${dx}px`);
      l.el.classList.toggle('below', !!spec.below);
      // 引线：从点连到牌子底边的中间，可以是斜的
      const line = l.el.children[1];
      const len = Math.hypot(dx, stem);
      const ang = (Math.atan2(dx, stem) * 180) / Math.PI;
      line.style.height = `${Math.max(0, len - 3)}px`;
      if (spec.below) {
        line.style.top = '3px';
        line.style.transformOrigin = '50% -3px';
        line.style.transform = `rotate(${-ang}deg)`;
      } else {
        line.style.top = `${-len}px`;
        line.style.transformOrigin = `50% ${len}px`;
        line.style.transform = `rotate(${ang}deg)`;
      }
      if (spec.text && l.el.firstChild.textContent !== spec.text) l.el.firstChild.textContent = spec.text;
    }
  }

  function render() {
    post.render(scene, camera);
    placeLabels();
  }

  function resize() {
    renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
    post.setSize();
    if (current) {
      fitCamera(current);
      scaleLandmarks(current);
      renderer.shadowMap.needsUpdate = true;
    }
  }

  /** 用另一个镜头出一张小图（返回图片地址），再把原来的画面换回来。 */
  function snapshot(name, w, h, pr = 2) {
    const prev = shotName;
    const oldPr = renderer.getPixelRatio();
    override = { w, h };
    renderer.setPixelRatio(pr);
    renderer.setSize(w, h, false);
    post.setSize();
    setShot(name);
    const v0 = post.uniforms.uVignette.value;
    post.uniforms.uVignette.value = 0;
    post.render(scene, camera);
    const url = canvas.toDataURL('image/jpeg', 0.92);
    post.uniforms.uVignette.value = v0;
    override = null;
    renderer.setPixelRatio(oldPr);
    renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
    post.setSize();
    setShot(prev);
    return url;
  }

  /** 画面中心附近 1 公里在屏幕上有多长（像素），给比例尺用。 */
  function kmInPixels() {
    const t = new THREE.Vector3(...current.target);
    const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
    const a = t.clone().project(camera);
    const b = t.clone().addScaledVector(right, 10).project(camera);
    return (Math.abs(b.x - a.x) * viewW()) / 2;
  }

  /** 北在屏幕上朝哪边（度，0 朝上，顺时针）。 */
  function northAngle() {
    const t = new THREE.Vector3(...current.target);
    const a = t.clone().project(camera);
    const b = t.clone().add(new THREE.Vector3(0, 0, -5)).project(camera);
    const dx = (b.x - a.x) * canvas.clientWidth;
    const dy = -(b.y - a.y) * canvas.clientHeight;
    return (Math.atan2(dx, -dy) * 180) / Math.PI;
  }

  const info = () => {
    let tris = 0;
    const by = {};
    scene.traverse((o) => {
      if (!o.isMesh || !o.visible) return;
      let vis = true;
      let top = o;
      for (let p = o.parent; p; p = p.parent) {
        if (!p.visible) vis = false;
        if (p.parent) top = p;
      }
      if (!vis) return;
      const g = o.geometry;
      const n = ((g.index ? g.index.count : g.attributes.position.count) / 3) * (o.isInstancedMesh ? o.count : 1);
      tris += n;
      const key = o.name || top.name || 'other';
      by[key] = Math.round((by[key] || 0) + n);
    });
    return { triangles: Math.round(tris), shot: shotName, by, scatter: scatter.counts };
  };

  return { renderer, scene, camera, cloud, setShot, render, resize, snapshot, kmInPixels, northAngle, info };
}
