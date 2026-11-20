// 从样张搬来，结构没有动（spikes/art-direction/b/scene/water.js 的前一半），只加了类型。改了四处：
//   桌面的海拔和山高夸大的倍数原来写死在着色器里，现在是两个 uniform；
//   急滩的位置、长短和水流的方向从场景的 rapids 和那条河的中线来（没有急滩就不画白浪）；
//   水漫不进去的地方（闭合的城墙里面和 water.dry）不再靠把地面抬到 70 米，而是单有一张标记：
//     水位高过平时，这些地方不画水；
//   这些地方里面要是有壕，大水时另用一片停在平时水位的水面画出来（dry 那一片）；
//   壕这样窄的水道（几个像素宽）平时不画水纹，岸边的白也淡：细细一条上面再画白线，远看像一格一格的窗棂。
// 后来对着图片又改了一处：急滩的白浪画得宽一点、白一点（原来的在一节的画面上看不出来）。
// 再后来改了一处：水纹和白浪照页面上的像素算，不照画布的像素算（uPx，见 setPixelRatio）。
//   原来像素比不同的屏幕上水纹落在不同的地方，立体的沙盘接替定格图（宽的照 1.5 拍、窄的照 2 拍）的那一下，白线会跳。
// 水是一整片平面，哪里有水由“水位 − 地面高”决定，所以水位一抬，河就漫成一片。
// 颜色是淡花青，上面有细的白色水纹；岸边留一道白。

import {
  BufferGeometry,
  Color,
  DataTexture,
  DataUtils,
  Float32BufferAttribute,
  Group,
  HalfFloatType,
  LinearFilter,
  Mesh,
  MeshLambertMaterial,
  RGBAFormat,
  Vector2,
  Vector3,
  Vector4,
  type IUniform,
} from 'three';
import type { StopScene } from '../../domain/scene';
import type { FrameCoords } from '../../domain/sceneGeo';
import type { Ground, Vec2, Vec3 } from '../ground/types';
import type { StageStyle } from './internal';
import { clamp, distSeg } from './kit/util';

/** 水面的三角形数：顶面和四边垂下来的一圈。大水时 dry 那一片再加 DRY_WATER_TRIANGLES。 */
export const WATER_TRIANGLES = 10;
export const DRY_WATER_TRIANGLES = 2;

const WATER_GLSL = /* glsl */ `
varying vec3 vWPos;
uniform sampler2D uH;
uniform float uLevel;
uniform float uDatum;
uniform float uEx;
uniform vec2 uDry;
uniform vec4 uCrop;
uniform vec3 uShallow;
uniform vec3 uDeep;
uniform vec3 uShallowCalm;
uniform vec3 uDeepCalm;
uniform vec3 uFoam;
uniform vec3 uRapids;
uniform vec2 uRapidsDir;
uniform float uTime;
uniform float uFlood;
uniform float uDense;
uniform vec2 uRipRot;
uniform float uPx;
float whash(vec2 p){ p = fract(p * vec2(127.1, 311.7)); p += dot(p, p + 34.5); return fract(p.x * p.y); }
float wnoise(vec2 p){
  vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(whash(i), whash(i + vec2(1.0, 0.0)), u.x), mix(whash(i + vec2(0.0, 1.0)), whash(i + vec2(1.0, 1.0)), u.x), u.y);
}
// 一组水纹：东西向的细波线，断断续续
float rippleOct(vec2 p, float s){
  float w = p.y / s + 0.26 * sin(p.x / (s * 2.6) + 1.1 * sin(p.y / (s * 5.1)) + uTime) + 0.07 * sin(p.x / (s * 0.95) + p.y / (s * 3.0));
  float f = abs(fract(w) - 0.5) * 2.0;
  // 线的粗细也按页面上的像素算（uPx 是一个页面像素合几个画布像素）：像素比高的屏幕上线一样粗，只是更清楚
  float fw = fwidth(w) * 2.0 * uPx;
  float line = 1.0 - smoothstep(0.04, 0.05 + fw, f);
  float seg = sin(p.x / (s * 2.1) + floor(w) * 2.4) + 0.5 * sin(p.x / (s * 0.83) + floor(w) * 5.1);
  return line * smoothstep(0.15, 0.7, seg);
}
// 水纹的疏密跟着镜头远近变：屏幕上总是差不多一样密
float ripples(vec2 p0){
  // 水纹顺着画面横着走：镜头从东边看过来时把它转九十度
  vec2 p = vec2(uRipRot.x * p0.x - uRipRot.y * p0.y, uRipRot.y * p0.x + uRipRot.x * p0.y);
  // 一个页面像素（不是画布像素）合地上多少米：同一个画面在像素比 1、1.5、2 的屏幕上，水纹落在同样的地方
  float px = max(fwidth(p.x), fwidth(p.y)) * uPx;
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

const WATER_FRAGMENT = /* glsl */ `
        vec2 huv = clamp((vWPos.xz - uCrop.xy) * uCrop.zw, 0.0, 1.0);
        vec4 hTex = texture2D(uH, huv);
        float ground = hTex.r + uDatum;
        // 水漫不进去的地方：uDry.x 是平时的水位。主水面（uDry.y 是 0）在水位高过平时以后不画这些地方；
        // dry 那一片（uDry.y 是 1）反过来，只画这些地方。
        float dryHere = step(0.5, hTex.g);
        // 窄的水道（壕）：水位在平时上下才算，水漫开以后和别处一样
        float narrow = hTex.b * (1.0 - smoothstep(uDry.x + 0.3, uDry.x + 1.2, uLevel));
        float noWater = uDry.y > 0.5 ? 1.0 - dryHere : dryHere * step(uDry.x + 0.01, uLevel);
        if (noWater > 0.5) discard;
        float depth = uLevel - ground;
        float a = smoothstep(-0.05, 0.5, depth);
        if (a < 0.004) discard;
        float surfY = (uLevel - uDatum) * uEx;
        float isSide = step(vWPos.y, surfY - 0.05);
        if (vWPos.y < (ground - uDatum) * uEx) discard;
        float dk = 1.0 - exp(-max(depth, 0.0) * 0.42);
        // 平时的河用深一点的花青，大水是一大片淡的
        vec3 wc = mix(mix(uShallowCalm, uShallow, uFlood), mix(uDeepCalm, uDeep, uFlood), dk);
        float fringe = (1.0 - smoothstep(0.15, 1.25, depth)) * (1.0 - 0.75 * narrow);
        wc = mix(wc, uFoam, fringe * 0.62);
        float rp = ripples(vWPos.xz) * (1.0 - isSide) * (1.0 - narrow);
        // 急滩：乱石滩上白浪多
        vec2 fdir = uRapidsDir;
        vec2 rd = vWPos.xz - uRapids.xy;
        float rap = uRapids.z > 0.0 ? 1.0 - smoothstep(0.45, 1.0, length(vec2(dot(rd, vec2(fdir.y, -fdir.x)) * 1.5, dot(rd, fdir))) / uRapids.z) : 0.0;
        float px = max(fwidth(vWPos.x), fwidth(vWPos.z)) * uPx;
        vec2 rq = vec2(dot(vWPos.xz, vec2(fdir.y, -fdir.x)) / 11.0, dot(vWPos.xz, fdir) / 58.0);
        // 白浪比平常的水纹宽、白：乱石中间一道一道的，看得出水在这里是急的；镜头远了连成淡淡的一片白
        float blur = smoothstep(7.0, 18.0, px);
        float streak = smoothstep(0.38, 0.6, wnoise(rq)) * (1.0 - blur);
        float white = rap * (streak * 0.95 + 0.45 * blur) * (1.0 - isSide) * (1.0 - uFlood);
        wc = mix(wc, uFoam, max(rp * (0.66 - 0.25 * fringe), white * 0.86));
        float sheen = pow(1.0 - abs(dot(normalize(vViewPosition), normalize(vNormal))), 4.0) * (1.0 - isSide);
        wc = mix(wc, uFoam, sheen * 0.22);
        wc = mix(wc, uDeep * 0.9, isSide * 0.5);
        diffuseColor.rgb = wc;
        diffuseColor.a = a * mix(0.8, 0.95, dk);
        `;

/**
 * 水纹怎么摆。水纹要顺着画面横着走：镜头朝东或朝西看（朝向离正东、正西不到 45 度）时转九十度。
 * 贴近了看（不到 3000 米）水纹密一点。这是样张各个镜头的数归出来的规矩。
 */
export function rippleFor(bearingDeg: number, distanceM: number): { dense: number; turnDeg: number } {
  const b = ((bearingDeg % 180) + 180) % 180;
  return { dense: distanceM < 3000 ? 0.3 : 0.5, turnDeg: b >= 45 && b <= 135 ? 90 : 0 };
}

/**
 * 这一格是不是窄的水道：0 不是，1 是。half 是最近的那条河或壕画的宽度的一半，edge 是到它的岸多远（水里是负数）。
 * 宽窄的分界和上色时一样（半宽 40 米以下算窄，100 米以上算河）；只算水道里面和岸外一格以内。
 */
export function narrowChannel(half: number, edge: number): number {
  if (!(half > 0) || edge > 20) return 0;
  const t = clamp((half - 40) / 60, 0, 1);
  return 1 - t * t * (3 - 2 * t);
}

export interface WaterInput {
  ground: Ground;
  coords: FrameCoords;
  scene: StopScene;
  style: StageStyle;
}

export interface Water {
  /** 挂进场景的那一组：主水面，加上大水时才显出来的 dry 那一片。 */
  group: Group;
  /** 换水位（海拔，米）。 */
  setLevel(levelM: number): void;
  /** 水的颜色偏向大水多少：0 是平时，1 是最高的水位。 */
  setFlood(flood: number): void;
  /** 水纹的疏密和转多少度（见 rippleFor）。 */
  setRipple(dense: number, turnDeg: number): void;
  /**
   * 画布的像素比（一个页面像素合几个画布像素）。水纹和白浪的疏密、粗细照页面像素算：
   * 不说的话着色器里量出来的是画布像素，像素比 2 的屏幕上水纹就密一倍，落的地方也和定格图上的不一样。
   * 像素比是 1 的时候画面和不说一样。
   */
  setPixelRatio(ratio: number): void;
  dispose(): void;
}

/** 急滩在哪、多长、水往哪边流。没有急滩时长度是 0，着色器就不画白浪。 */
function rapidsOf(scene: StopScene, ground: Ground, coords: FrameCoords): { at: Vec3; dir: Vec2 } {
  const rapids = scene.water.rapids[0];
  if (!rapids) return { at: [0, 0, 0], dir: [0, 1] };
  const [x, z] = coords.toLocal(rapids.at);
  // 水流的方向：河的中线上离急滩最近的那一段
  const line = ground.rivers[rapids.river] ?? [];
  let dir: Vec2 = [0, 1];
  let best = Infinity;
  for (let i = 0; i < line.length - 1; i++) {
    const [ax, az] = line[i];
    const [bx, bz] = line[i + 1];
    const len = Math.hypot(bx - ax, bz - az);
    if (len === 0) continue;
    const d = distSeg(x, z, ax, az, bx, bz);
    if (d < best) {
      best = d;
      dir = [(bx - ax) / len, (bz - az) / len];
    }
  }
  return { at: [x, z, rapids.lengthM], dir };
}

export function buildWater(input: WaterInput): Water {
  const { ground, coords, scene, style } = input;
  const { nx, nz } = ground;
  const PAL = style.palette;
  const levels = scene.water.levels.values;
  const normal = levels.normal;
  const datum = scene.frame.datumM;
  const ex = scene.frame.relief.times;

  // 一张图三样：水看到的地面比桌面高多少，这里水漫不漫得进去，这里是不是窄的水道（壕）
  const data = new Uint16Array(nx * nz * 4);
  const one = DataUtils.toHalfFloat(1);
  let anyDry = false;
  for (let k = 0; k < nx * nz; k++) {
    data[k * 4] = DataUtils.toHalfFloat(clamp(ground.waterH[k] - datum, -12, 40));
    data[k * 4 + 1] = DataUtils.toHalfFloat(ground.dry[k] ? 1 : 0);
    data[k * 4 + 2] = DataUtils.toHalfFloat(narrowChannel(ground.bankHalf[k], ground.edge[k]));
    data[k * 4 + 3] = one;
    if (ground.dry[k]) anyDry = true;
  }
  const tex = new DataTexture(data, nx, nz, RGBAFormat, HalfFloatType);
  tex.magFilter = LinearFilter;
  tex.minFilter = LinearFilter;
  tex.needsUpdate = true;

  const W = coords.x1 - coords.x0;
  const D = coords.z1 - coords.z0;
  const rapids = rapidsOf(scene, ground, coords);
  const makeUniforms = (onlyDry: boolean): Record<string, IUniform> => ({
    uH: { value: tex },
    uLevel: { value: normal },
    uDatum: { value: datum },
    uEx: { value: ex },
    uDry: { value: new Vector2(normal, onlyDry ? 1 : 0) },
    uCrop: { value: new Vector4(coords.x0, coords.z0, 1 / W, 1 / D) },
    uShallow: { value: new Color(PAL.water) },
    uDeep: { value: new Color(PAL.waterDeep) },
    uShallowCalm: { value: new Color(PAL.waterCalm) },
    uDeepCalm: { value: new Color(PAL.waterCalmDeep) },
    uFoam: { value: new Color(PAL.ripple) },
    uRapids: { value: new Vector3(rapids.at[0], rapids.at[1], rapids.at[2]) },
    uRapidsDir: { value: new Vector2(rapids.dir[0], rapids.dir[1]) },
    uTime: { value: 0 },
    uFlood: { value: 0 },
    uDense: { value: 0.5 },
    uRipRot: { value: new Vector2(1, 0) },
    uPx: { value: 1 },
  });
  const uniforms = makeUniforms(false);
  const dryUniforms = makeUniforms(true);

  // 顶面 + 四边垂下来的一圈（沙盘边上看得见水的切面）
  const pos: number[] = [];
  const nor: number[] = [];
  const idx: number[] = [];
  const quad = (a: Vec3, b: Vec3, c: Vec3, d: Vec3, n: Vec3): void => {
    const base = pos.length / 3;
    pos.push(...a, ...b, ...c, ...d);
    for (let i = 0; i < 4; i++) nor.push(...n);
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };
  const o = 1.5;
  const x0 = coords.x0 - o;
  const x1 = coords.x1 + o;
  const z0 = coords.z0 - o;
  const z1 = coords.z1 + o;
  const dn = -60;
  quad([x0, 0, z0], [x0, 0, z1], [x1, 0, z1], [x1, 0, z0], [0, 1, 0]);
  const topOnly = { pos: [...pos], nor: [...nor], idx: [...idx] };
  quad([x0, 0, z1], [x0, dn, z1], [x1, dn, z1], [x1, 0, z1], [0, 0, 1]);
  quad([x1, 0, z1], [x1, dn, z1], [x1, dn, z0], [x1, 0, z0], [1, 0, 0]);
  quad([x1, 0, z0], [x1, dn, z0], [x0, dn, z0], [x0, 0, z0], [0, 0, -1]);
  quad([x0, 0, z0], [x0, dn, z0], [x0, dn, z1], [x0, 0, z1], [-1, 0, 0]);
  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new Float32BufferAttribute(nor, 3));
  geo.setIndex(idx);

  const makeMaterial = (u: Record<string, IUniform>): MeshLambertMaterial => {
    const mat = new MeshLambertMaterial({ transparent: true, depthWrite: false });
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, u);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\n' + WATER_GLSL)
        .replace('#include <map_fragment>', WATER_FRAGMENT);
    };
    return mat;
  };

  const group = new Group();
  const mat = makeMaterial(uniforms);
  const mesh = new Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.renderOrder = 2;
  mesh.position.y = coords.y(normal);
  group.add(mesh);

  // 水漫不进去的地方里面的水（壕）：大水时主水面不画这些地方，这一片停在平时的水位上把它们画出来
  const dryGeo = new BufferGeometry();
  dryGeo.setAttribute('position', new Float32BufferAttribute(topOnly.pos, 3));
  dryGeo.setAttribute('normal', new Float32BufferAttribute(topOnly.nor, 3));
  dryGeo.setIndex(topOnly.idx);
  const dryMat = makeMaterial(dryUniforms);
  const dryMesh = new Mesh(dryGeo, dryMat);
  dryMesh.receiveShadow = true;
  dryMesh.renderOrder = 2;
  dryMesh.position.y = coords.y(normal);
  dryMesh.visible = false;
  group.add(dryMesh);

  return {
    group,
    setLevel(levelM) {
      uniforms.uLevel.value = levelM;
      mesh.position.y = coords.y(levelM);
      dryMesh.visible = anyDry && levelM > normal + 0.01;
    },
    setFlood(flood) {
      uniforms.uFlood.value = flood;
    },
    setRipple(dense, turnDeg) {
      const turn = (turnDeg * Math.PI) / 180;
      for (const u of [uniforms, dryUniforms]) {
        u.uDense.value = dense;
        (u.uRipRot.value as Vector2).set(Math.cos(turn), Math.sin(turn));
      }
    },
    setPixelRatio(ratio) {
      const px = ratio > 0 ? ratio : 1;
      uniforms.uPx.value = px;
      dryUniforms.uPx.value = px;
    },
    dispose() {
      geo.dispose();
      dryGeo.dispose();
      mat.dispose();
      dryMat.dispose();
      tex.dispose();
    },
  };
}
