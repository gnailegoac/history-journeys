// 沙盘以外的东西：光、环境、座子、落在背景上的影子、云影。
import * as THREE from 'three';
import { TABLE_M, U, SLAB_BOTTOM } from './terrain.js';
import { PAL } from './palette.js';
import { mulberry32, makeNoise } from './util.js';

export const TRAY_H = 1.6;
export const PLINTH_H = 3.2;
export const FLOOR_Y = SLAB_BOTTOM - TRAY_H - PLINTH_H;

/** 太阳方向：az 是光来的方位（0 北，90 东，180 南，270 西），el 是高度角。 */
export function sunVector(azDeg, elDeg) {
  const az = (azDeg * Math.PI) / 180;
  const el = (elDeg * Math.PI) / 180;
  return new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
}

export function makeLights(scene) {
  const sun = new THREE.DirectionalLight('#FFE7CB', 5.6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.02;
  sun.shadow.radius = 1.6;
  sun.shadow.blurSamples = 10;
  scene.add(sun);
  scene.add(sun.target);
  const fill = new THREE.HemisphereLight('#C6DAF5', '#CDBB9E', 0.5);
  scene.add(fill);
  return { sun, fill };
}

/** 把阴影相机对准一块地方。center 是场景坐标，half 是半宽。 */
export function aimSun(sun, dir, center, half, depth = 90, halfV = half) {
  sun.position.copy(center).addScaledVector(dir, depth);
  sun.target.position.copy(center);
  sun.target.updateMatrixWorld();
  const cam = sun.shadow.camera;
  cam.left = -half;
  cam.right = half;
  cam.top = halfV;
  cam.bottom = -halfV;
  cam.near = 1;
  cam.far = depth * 2;
  cam.updateProjectionMatrix();
  sun.shadow.needsUpdate = true;
}

/** 环境光：冷的天、暖的地面反光、太阳一侧的暖晕、对面高处一块柔光。 */
export function makeEnvironment(renderer, sunDir) {
  const envScene = new THREE.Scene();
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: { uSun: { value: sunDir.clone().normalize() } },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      varying vec3 vDir;
      uniform vec3 uSun;
      void main() {
        vec3 d = normalize(vDir);
        float up = d.y;
        vec3 zen = vec3(0.60, 0.76, 1.0) * 1.2;
        vec3 hor = vec3(1.0, 0.96, 0.90) * 1.05;
        vec3 gnd = vec3(0.66, 0.58, 0.48) * 0.5;
        vec3 col = mix(hor, zen, smoothstep(0.0, 0.8, up));
        col = mix(gnd, col, smoothstep(-0.15, 0.05, up));
        float s = max(dot(d, uSun), 0.0);
        col += vec3(1.0, 0.80, 0.55) * (pow(s, 5.0) * 0.8 + pow(s, 48.0) * 5.0);
        vec3 box = normalize(vec3(-uSun.x, 0.9, -uSun.z));
        col += vec3(0.95, 0.98, 1.0) * smoothstep(0.78, 0.97, dot(d, box)) * 1.4;
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  envScene.add(new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), mat));
  const pmrem = new THREE.PMREMGenerator(renderer);
  const rt = pmrem.fromScene(envScene, 0.02);
  pmrem.dispose();
  mat.dispose();
  return rt;
}

function woodTexture() {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = PAL.tray;
  g.fillRect(0, 0, c.width, c.height);
  const rnd = mulberry32(5);
  for (let i = 0; i < 260; i++) {
    const y = rnd() * c.height;
    const a = 0.03 + rnd() * 0.07;
    g.strokeStyle = rnd() < 0.5 ? `rgba(120,86,48,${a})` : `rgba(255,246,226,${a})`;
    g.lineWidth = 0.6 + rnd() * 1.6;
    g.beginPath();
    const ph = rnd() * 6.28;
    const am = 1 + rnd() * 3;
    for (let x = 0; x <= c.width; x += 32) {
      const yy = y + Math.sin(x / 170 + ph) * am;
      if (x === 0) g.moveTo(x, yy);
      else g.lineTo(x, yy);
    }
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

function roundedRectShape(w, d, r) {
  const s = new THREE.Shape();
  const x = -w / 2;
  const y = -d / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.absarc(x + w - r, y + r, r, -Math.PI / 2, 0, false);
  s.lineTo(x + w, y + d - r);
  s.absarc(x + w - r, y + d - r, r, 0, Math.PI / 2, false);
  s.lineTo(x + r, y + d);
  s.absarc(x + r, y + d - r, r, Math.PI / 2, Math.PI, false);
  s.lineTo(x, y + r);
  s.absarc(x + r, y + r, r, Math.PI, Math.PI * 1.5, false);
  return s;
}

/** 座子：浅木托盘 + 缩进去的深色底座，沙盘像是浮在背景上。 */
export function makeStand(patch) {
  const g = new THREE.Group();
  const W = (TABLE_M.maxX - TABLE_M.minX) * U;
  const D = (TABLE_M.maxZ - TABLE_M.minZ) * U;
  const cx = ((TABLE_M.maxX + TABLE_M.minX) / 2) * U;
  const cz = ((TABLE_M.maxZ + TABLE_M.minZ) / 2) * U;
  const margin = 3.2;
  const shape = roundedRectShape(W + margin * 2, D + margin * 2, 2.6);
  const bevel = 0.22;
  const geo = new THREE.ExtrudeGeometry(shape, { depth: TRAY_H - bevel * 2, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 3, curveSegments: 10 });
  geo.rotateX(Math.PI / 2); // 形状的 y → 场景的 z，厚度朝下
  const wood = woodTexture();
  wood.repeat.set(1 / 48, 1 / 12);
  const trayMat = patch(new THREE.MeshStandardMaterial({ map: wood, roughness: 0.62, metalness: 0 }));
  const tray = new THREE.Mesh(geo, trayMat);
  tray.position.set(cx, SLAB_BOTTOM - bevel, cz);
  tray.receiveShadow = true;
  tray.castShadow = true;
  g.add(tray);
  const plinthMat = patch(new THREE.MeshStandardMaterial({ color: PAL.plinth, roughness: 0.8 }));
  const plinth = new THREE.Mesh(new THREE.BoxGeometry(W - 14, PLINTH_H, D - 14), plinthMat);
  plinth.position.set(cx, SLAB_BOTTOM - TRAY_H - PLINTH_H / 2, cz);
  g.add(plinth);
  return { group: g, W, D, cx, cz, margin };
}

/** 落在背景上的影子：一块贴着底座的深影，加一片偏向背光一侧的淡影。画出来的，不占阴影贴图。 */
export function makeFloorShadow(stand) {
  const size = 512;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const g = c.getContext('2d');
  const span = Math.max(stand.W, stand.D) * 2.3; // 画布覆盖的场景宽度
  const s = size / span;
  const tex = new THREE.CanvasTexture(c);
  const mat = new THREE.MeshBasicMaterial({ color: '#2A2620', alphaMap: tex, transparent: true, depthWrite: false, opacity: 1, toneMapped: false });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(span, span), mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(stand.cx, FLOOR_Y + 0.02, stand.cz);
  mesh.renderOrder = -1;
  const update = (sunDir) => {
    g.clearRect(0, 0, size, size);
    g.fillStyle = '#000';
    g.fillRect(0, 0, size, size);
    g.globalCompositeOperation = 'lighter';
    const h = new THREE.Vector2(-sunDir.x, -sunDir.z).normalize();
    const reach = 13 / Math.max(0.35, sunDir.y / Math.hypot(sunDir.x, sunDir.z));
    const cast = Math.min(reach, 30);
    // alphaMap 取绿色通道：用灰度画
    const gray = (a) => `rgba(255,255,255,${a})`;
    const drawG = (w, d, blur, alpha, ox, oz) => {
      g.save();
      g.filter = `blur(${blur * s}px)`;
      g.fillStyle = gray(alpha);
      g.beginPath();
      g.roundRect(size / 2 + (ox - w / 2) * s, size / 2 + (oz - d / 2) * s, w * s, d * s, 3 * s);
      g.fill();
      g.restore();
    };
    drawG(stand.W + 6, stand.D + 6, 22, 0.26, h.x * cast * 0.6, h.y * cast * 0.6);
    drawG(stand.W + 2, stand.D + 2, 10, 0.28, h.x * 6, h.y * 6);
    drawG(stand.W - 4, stand.D - 4, 5, 0.5, h.x * 1.5, h.y * 1.5);
    g.globalCompositeOperation = 'source-over';
    tex.needsUpdate = true;
  };
  return { mesh, update };
}

/** 云影：两三团很淡的影子，按世界坐标投在所有东西上。 */
export function makeCloudUniforms(seed = 3) {
  const size = 256;
  const data = new Uint8Array(size * size);
  const n = makeNoise(seed);
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      // 两大片云影，边很软：一片在西边的平地上，一片在北边远处。小了、边硬了就像污渍。
      const blob = (cx, cy, rx, ry, rot) => {
        const co = Math.cos(rot);
        const si = Math.sin(rot);
        const dx = ((i - cx) * co + (j - cy) * si) / rx;
        const dy = (-(i - cx) * si + (j - cy) * co) / ry;
        const d = Math.sqrt(dx * dx + dy * dy) + (n.fbm(i / 44, j / 44, 3) - 0.5) * 0.5;
        return Math.max(0, Math.min(1, (1.0 - d) / 0.8));
      };
      let c = Math.max(blob(50, 150, 78, 50, -0.25), blob(164, 22, 84, 36, 0.12));
      c = c * c * (3 - 2 * c);
      // 四边淡出，免得云影切在盘边
      const ex = Math.min(i, size - 1 - i) / 22;
      const ez = Math.min(j, size - 1 - j) / 22;
      c *= Math.min(1, ex) * Math.min(1, ez);
      data[j * size + i] = Math.round(c * 255);
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RedFormat, THREE.UnsignedByteType);
  tex.minFilter = tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  const W = (TABLE_M.maxX - TABLE_M.minX) * U;
  const D = (TABLE_M.maxZ - TABLE_M.minZ) * U;
  return {
    uCloudTex: { value: tex },
    // uv = xz * scale + offset
    uCloudXf: { value: new THREE.Vector4(1 / W, 1 / D, -(TABLE_M.minX * U) / W, -(TABLE_M.minZ * U) / D) },
    uCloudAmt: { value: 0.8 },
  };
}

/** 给标准材质加上云影。返回同一个材质。 */
export function makeCloudPatch(cloud) {
  let patchId = 0;
  return function patch(mat, extra) {
    const key = extra ? `cloud-${++patchId}` : "cloud";
    mat.customProgramCacheKey = () => key;
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, cloud);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vCloudUv;\nuniform vec4 uCloudXf;')
        .replace(
          '#include <project_vertex>',
          `#include <project_vertex>
          {
            vec4 cwp = vec4(transformed, 1.0);
            #ifdef USE_INSTANCING
              cwp = instanceMatrix * cwp;
            #endif
            cwp = modelMatrix * cwp;
            vCloudUv = cwp.xz * uCloudXf.xy + uCloudXf.zw;
          }`,
        );
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vCloudUv;\nuniform sampler2D uCloudTex;\nuniform float uCloudAmt;')
        .replace(
          '#include <opaque_fragment>',
          `{
            float cloudK = texture2D(uCloudTex, clamp(vCloudUv, 0.0, 1.0)).r * uCloudAmt;
            outgoingLight *= mix(vec3(1.0), vec3(0.62, 0.70, 0.82), cloudK);
          }
          #include <opaque_fragment>`,
        );
      if (extra) extra(shader);
    };
    return mat;
  };
}
