// 水和雾。水是一整片平面，哪里有水由“水位 − 地面高”决定，所以水位一抬，河就漫成一片。
// 颜色是淡花青，上面有细的白色水纹；岸边留一道白。

import * as THREE from 'three';
import { CROP, CELL, DATUM, EX, yOf, PAL, LEVEL, PLACE, WALLRECT } from './config.js';
import { clamp, smoothstep, fbm } from './util.js';

const WATER_GLSL = /* glsl */ `
varying vec3 vWPos;
uniform sampler2D uH;
uniform float uLevel;
uniform vec4 uCrop;
uniform vec3 uShallow;
uniform vec3 uDeep;
uniform vec3 uShallowCalm;
uniform vec3 uDeepCalm;
uniform vec3 uFoam;
uniform vec3 uRapids;
uniform float uTime;
uniform float uFlood;
uniform float uDense;
uniform vec2 uRipRot;
float whash(vec2 p){ p = fract(p * vec2(127.1, 311.7)); p += dot(p, p + 34.5); return fract(p.x * p.y); }
float wnoise(vec2 p){
  vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(whash(i), whash(i + vec2(1.0, 0.0)), u.x), mix(whash(i + vec2(0.0, 1.0)), whash(i + vec2(1.0, 1.0)), u.x), u.y);
}
// 一组水纹：东西向的细波线，断断续续
float rippleOct(vec2 p, float s){
  float w = p.y / s + 0.26 * sin(p.x / (s * 2.6) + 1.1 * sin(p.y / (s * 5.1)) + uTime) + 0.07 * sin(p.x / (s * 0.95) + p.y / (s * 3.0));
  float f = abs(fract(w) - 0.5) * 2.0;
  float fw = fwidth(w) * 2.0;
  float line = 1.0 - smoothstep(0.04, 0.05 + fw, f);
  float seg = sin(p.x / (s * 2.1) + floor(w) * 2.4) + 0.5 * sin(p.x / (s * 0.83) + floor(w) * 5.1);
  return line * smoothstep(0.15, 0.7, seg);
}
// 水纹的疏密跟着镜头远近变：屏幕上总是差不多一样密
float ripples(vec2 p0){
  // 水纹顺着画面横着走：镜头从东边看过来时把它转九十度
  vec2 p = vec2(uRipRot.x * p0.x - uRipRot.y * p0.y, uRipRot.y * p0.x + uRipRot.x * p0.y);
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

export function buildWater(td) {
  const { nx, nz } = td;
  const data = new Uint16Array(nx * nz);
  for (let k = 0; k < nx * nz; k++) data[k] = THREE.DataUtils.toHalfFloat(clamp(td.hw[k] - DATUM, -12, 40));
  const tex = new THREE.DataTexture(data, nx, nz, THREE.RedFormat, THREE.HalfFloatType);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;

  const W = CROP.x1 - CROP.x0;
  const D = CROP.z1 - CROP.z0;
  const uniforms = {
    uH: { value: tex },
    uLevel: { value: LEVEL.normal },
    uCrop: { value: new THREE.Vector4(CROP.x0, CROP.z0, 1 / W, 1 / D) },
    uShallow: { value: new THREE.Color(PAL.water) },
    uDeep: { value: new THREE.Color(PAL.waterDeep) },
    uShallowCalm: { value: new THREE.Color(PAL.waterCalm) },
    uDeepCalm: { value: new THREE.Color(PAL.waterCalmDeep) },
    uFoam: { value: new THREE.Color(PAL.ripple) },
    uRapids: { value: new THREE.Vector3(PLACE.baibuhong[0], PLACE.baibuhong[1], 330) },
    uTime: { value: 0 },
    uFlood: { value: 0 },
    uDense: { value: 0.5 },
    uRipRot: { value: new THREE.Vector2(1, 0) },
  };

  // 顶面 + 四边垂下来的一圈（沙盘边上看得见水的切面）
  const pos = [];
  const nor = [];
  const idx = [];
  const quad = (a, b, c, d, n) => {
    const base = pos.length / 3;
    pos.push(...a, ...b, ...c, ...d);
    for (let i = 0; i < 4; i++) nor.push(...n);
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };
  const o = 1.5;
  const x0 = CROP.x0 - o;
  const x1 = CROP.x1 + o;
  const z0 = CROP.z0 - o;
  const z1 = CROP.z1 + o;
  const dn = -60;
  quad([x0, 0, z0], [x0, 0, z1], [x1, 0, z1], [x1, 0, z0], [0, 1, 0]);
  quad([x0, 0, z1], [x0, dn, z1], [x1, dn, z1], [x1, 0, z1], [0, 0, 1]);
  quad([x1, 0, z1], [x1, dn, z1], [x1, dn, z0], [x1, 0, z0], [1, 0, 0]);
  quad([x1, 0, z0], [x1, dn, z0], [x0, dn, z0], [x0, 0, z0], [0, 0, -1]);
  quad([x0, 0, z0], [x0, dn, z0], [x0, dn, z1], [x0, 0, z1], [-1, 0, 0]);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setIndex(idx);

  const mat = new THREE.MeshLambertMaterial({ transparent: true, depthWrite: false });
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
        vec2 huv = clamp((vWPos.xz - uCrop.xy) * uCrop.zw, 0.0, 1.0);
        float ground = texture2D(uH, huv).r + ${DATUM.toFixed(1)};
        float depth = uLevel - ground;
        float a = smoothstep(-0.05, 0.5, depth);
        if (a < 0.004) discard;
        float surfY = (uLevel - ${DATUM.toFixed(1)}) * ${EX.toFixed(1)};
        float isSide = step(vWPos.y, surfY - 0.05);
        if (vWPos.y < (ground - ${DATUM.toFixed(1)}) * ${EX.toFixed(1)}) discard;
        float dk = 1.0 - exp(-max(depth, 0.0) * 0.42);
        // 平时的河用深一点的花青，大水是一大片淡的
        vec3 wc = mix(mix(uShallowCalm, uShallow, uFlood), mix(uDeepCalm, uDeep, uFlood), dk);
        float fringe = 1.0 - smoothstep(0.15, 1.25, depth);
        wc = mix(wc, uFoam, fringe * 0.62);
        float rp = ripples(vWPos.xz) * (1.0 - isSide);
        // 百步洪：乱石滩上白浪多
        vec2 fdir = vec2(0.3, 0.954);
        vec2 rd = vWPos.xz - uRapids.xy;
        float rap = 1.0 - smoothstep(0.45, 1.0, length(vec2(dot(rd, vec2(fdir.y, -fdir.x)) * 1.5, dot(rd, fdir))) / uRapids.z);
        float px = max(fwidth(vWPos.x), fwidth(vWPos.z));
        vec2 rq = vec2(dot(vWPos.xz, vec2(fdir.y, -fdir.x)) / 11.0, dot(vWPos.xz, fdir) / 58.0);
        float streak = smoothstep(0.5, 0.74, wnoise(rq)) * (1.0 - smoothstep(3.0, 9.0, px));
        rp = max(rp, rap * (streak * 0.9 + 0.3 * smoothstep(3.0, 9.0, px)) * (1.0 - isSide) * (1.0 - uFlood));
        wc = mix(wc, uFoam, rp * (0.66 - 0.25 * fringe));
        float sheen = pow(1.0 - abs(dot(normalize(vViewPosition), normalize(vNormal))), 4.0) * (1.0 - isSide);
        wc = mix(wc, uFoam, sheen * 0.22);
        wc = mix(wc, uDeep * 0.9, isSide * 0.5);
        diffuseColor.rgb = wc;
        diffuseColor.a = a * mix(0.8, 0.95, dk);
        `,
      );
  };
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.renderOrder = 2;
  mesh.position.y = yOf(LEVEL.normal);
  const setLevel = (lv) => {
    uniforms.uLevel.value = lv;
    mesh.position.y = yOf(lv);
  };
  return { mesh, uniforms, setLevel };
}

// ---------- 雾 ----------
// 三层水平的薄雾，贴在低处和沙盘四边；山比雾高，就从雾里露出来。

const MIST_FRAG = /* glsl */ `
uniform sampler2D uA;
uniform sampler2D uB;
uniform float uMix;
uniform float uOpacity;
uniform vec3 uColor;
varying vec2 vUv;
void main(){
  float a = mix(texture2D(uA, vUv).r, texture2D(uB, vUv).r, uMix) * uOpacity;
  if (a < 0.004) discard;
  gl_FragColor = vec4(uColor, a);
  #include <colorspace_fragment>
}
`;
const MIST_VERT = /* glsl */ `
varying vec2 vUv;
void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;

export function buildMist(td) {
  const group = new THREE.Group();
  const M = 420; // 雾比沙盘四边多出去的宽度
  const tw = 420;
  const th = Math.round((tw * (CROP.z1 - CROP.z0 + 2 * M)) / (CROP.x1 - CROP.x0 + 2 * M));
  const layers = [
    { y: 34, seed: 1, op: 0.5 },
    { y: 74, seed: 2, op: 0.42 },
    { y: 126, seed: 3, op: 0.34 },
  ];
  const mats = [];
  const W = WALLRECT;
  for (const L of layers) {
    const a = new Uint8Array(tw * th);
    const b = new Uint8Array(tw * th);
    for (let j = 0; j < th; j++) {
      for (let i = 0; i < tw; i++) {
        const x = CROP.x0 - M + (i / (tw - 1)) * (CROP.x1 - CROP.x0 + 2 * M);
        const z = CROP.z0 - M + (j / (th - 1)) * (CROP.z1 - CROP.z0 + 2 * M);
        const inD = Math.min(x - CROP.x0, CROP.x1 - x, z - CROP.z0, CROP.z1 - z);
        // 靠南（平常看过来的一边）不留边上的雾，免得挂在切面上
        const edgeM = inD >= 0 ? (1 - smoothstep(0, 1100, inD)) * smoothstep(0, 160, inD) * smoothstep(300, 1500, CROP.z1 - z) : 0;
        const ty = yOf(td.sample(x, z));
        const clear = smoothstep(L.y - 4, L.y - 34, ty) * (inD >= 0 ? smoothstep(60, 420, CROP.z1 - z) : 0); // 地面离雾层够远才有雾
        const hs = td.sampleHillSoft(x, z);
        const foot = smoothstep(0.04, 0.22, hs) * (1 - smoothstep(0.3, 0.7, hs));
        const wisp = smoothstep(0.4, 0.7, fbm(x / 2700 + L.seed * 3.1, z / 760 + L.seed * 7.7, 4, 40 + L.seed));
        const wisp2 = smoothstep(0.36, 0.66, fbm(x / 3600 + L.seed * 1.3, z / 1100 - L.seed * 2.9, 4, 70 + L.seed));
        const dc = Math.max(Math.abs(x - (W.x0 + W.x1) / 2), Math.abs(z - (W.z0 + W.z1) / 2));
        const awayCity = smoothstep(850, 1700, dc);
        const lowland = smoothstep(40.6, 38.4, td.sample(x, z));
        const wet = inD >= 0 ? smoothstep(44.6, 42.4, td.sample(x, z)) : 0;
        const vNormal = (edgeM * 0.5 * wisp + foot * 0.95 * wisp + lowland * 0.2 * wisp2) * clear * awayCity;
        const vFlood = (edgeM * 0.55 * wisp + foot * 1.0 * wisp + wet * 0.55 * wisp2 * wisp) * clear * awayCity;
        a[j * tw + i] = clamp(Math.round(vNormal * 255), 0, 255);
        b[j * tw + i] = clamp(Math.round(vFlood * 255), 0, 255);
      }
    }
    const mk = (d) => {
      const t = new THREE.DataTexture(d, tw, th, THREE.RedFormat, THREE.UnsignedByteType);
      t.magFilter = THREE.LinearFilter;
      t.minFilter = THREE.LinearFilter;
      t.needsUpdate = true;
      return t;
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uA: { value: mk(a) },
        uB: { value: mk(b) },
        uMix: { value: 0 },
        uOpacity: { value: L.op },
        uColor: { value: new THREE.Color(PAL.mist) },
      },
      vertexShader: MIST_VERT,
      fragmentShader: MIST_FRAG,
      transparent: true,
      depthWrite: false,
    });
    const geo = new THREE.PlaneGeometry(CROP.x1 - CROP.x0 + 2 * M, CROP.z1 - CROP.z0 + 2 * M);
    geo.rotateX(-Math.PI / 2);
    // PlaneGeometry 转平以后 v=1 在北边，这里要 v=0 在北边
    const uvs = geo.attributes.uv;
    for (let i = 0; i < uvs.count; i++) uvs.setY(i, 1 - uvs.getY(i));
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set((CROP.x0 + CROP.x1) / 2, L.y, (CROP.z0 + CROP.z1) / 2);
    mesh.renderOrder = 3 + L.seed;
    group.add(mesh);
    mats.push(mat);
  }
  const setFlood = (f) => mats.forEach((m) => (m.uniforms.uMix.value = f));
  const setStrength = (s) => mats.forEach((m, i) => (m.uniforms.uOpacity.value = layers[i].op * s));
  return { group, setFlood, setStrength };
}
