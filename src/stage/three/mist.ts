// 从样张搬来，结构没有动（spikes/art-direction/b/scene/water.js 的后一半），只加了类型。
// 原来从 config.js 取的定数改成从场景和地面来：沙盘的范围、平地的海拔、最高的水位；
// “离城多远”原来从沙盘的原点算，现在从每座城的城墙算（见 ground/types.ts 的 CityPlan）。
// 三层水平的薄雾，贴在低处和沙盘四边；山比雾高，就从雾里露出来。
// 样张里留下的一处将就没有动：靠南（平常看过来的一边）不留边上的雾，是按从南边看定的。
// 后来添了一条：立在地上的单座的屋、亭四周不起雾（见 awaySingle）。

import { Color, DataTexture, Group, LinearFilter, Mesh, PlaneGeometry, RedFormat, ShaderMaterial, UnsignedByteType } from 'three';
import type { StopScene } from '../../domain/scene';
import type { FrameCoords } from '../../domain/sceneGeo';
import type { Ground, GroundSamplers } from '../ground/types';
import type { StageStyle } from './internal';
import { clamp, distSeg, fbm, smoothstep } from './kit/util';

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

/** 三层雾：在沙盘里多高（按山高夸大 6 倍时的数）、随机数的种子、浓淡。 */
const LAYERS = [
  { y: 34, seed: 1, op: 0.5 },
  { y: 74, seed: 2, op: 0.42 },
  { y: 126, seed: 3, op: 0.34 },
];

/** 一层雾是一片平面：两个三角形（算一个画面的三角形预算用）。 */
export const MIST_TRIANGLES_PER_LAYER = 2;

export interface MistInput {
  ground: Ground;
  samplers: GroundSamplers;
  coords: FrameCoords;
  scene: StopScene;
  style: StageStyle;
  /** 画几层（画质里的 mistLayers），最多三层。 */
  layers: number;
}

export interface Mist {
  group: Group;
  /** 0 是平时的雾，1 是大水时的雾（水面上也起雾）。 */
  setFlood(flood: number): void;
  /** 浓淡：1 是平常。 */
  setStrength(strength: number): void;
  /** 云气的颜色（'#rrggbb'），再压暗到几成（1 是不压）。云气不受灯照：夜里不压暗，它就是画面上最亮的东西。 */
  setColor(hex: string, dim: number): void;
  dispose(): void;
}

export function buildMist(input: MistInput): Mist {
  const { ground, samplers, coords, scene, style } = input;
  const group = new Group();
  const M = 420; // 雾比沙盘四边多出去的宽度
  const tw = 420;
  const th = Math.round((tw * (coords.z1 - coords.z0 + 2 * M)) / (coords.x1 - coords.x0 + 2 * M));
  // 雾层的高度是按夸大 6 倍定的，倍数不同时跟着缩放
  const ky = scene.frame.relief.times / 6;
  const base = ground.baseM;
  const flood = Math.max(...Object.values(scene.water.levels.values));
  const layers = LAYERS.slice(0, Math.max(0, Math.min(LAYERS.length, input.layers)));

  // 每座城占多大一块：从城的中心往东西、南北各多远
  const cities = ground.cities.map((city) => ({
    cx: city.centre[0],
    cz: city.centre[1],
    hx: Math.max(...city.wall.map((p) => Math.abs(p[0] - city.centre[0]))),
    hz: Math.max(...city.wall.map((p) => Math.abs(p[1] - city.centre[1]))),
  }));
  /** 离最近的一座城的城墙多远（在城里是负数）。 */
  const outsideCity = (x: number, z: number): number => {
    let d = Infinity;
    for (const c of cities) d = Math.min(d, Math.max(Math.abs(x - c.cx) - c.hx, Math.abs(z - c.cz) - c.hz));
    return d;
  };

  // 立在地上的单座的屋、亭（张山人的草屋、放鹤亭）是小节里要讲的小东西，又都在山脚：雾一罩，屋脚在哪、水淹到墙的哪里就看不清了，
  // 旁边的树也被雾面切成上下两截。它们四周一百多米里不起雾，往外慢慢起
  const singles = scene.things.flatMap((t) => ((t.kind === 'house' || t.kind === 'pavilion') && t.at && !t.on ? [coords.toLocal(t.at)] : []));
  // 崖壁也一样（离崖脚那条线多远）：三层云气的高度正好横在崖面上，从低处看过去会把崖拦腰切断
  const cliffs = scene.things.flatMap((t) => (t.kind === 'cliff' && t.line ? [t.line.map((p) => coords.toLocal(p))] : []));
  const awaySingle = (x: number, z: number): number => {
    let d = Infinity;
    for (const [sx, sz] of singles) d = Math.min(d, Math.hypot(x - sx, z - sz));
    for (const line of cliffs) for (let i = 1; i < line.length; i++) d = Math.min(d, distSeg(x, z, line[i - 1][0], line[i - 1][1], line[i][0], line[i][1]));
    return smoothstep(150, 480, d);
  };

  const mats: ShaderMaterial[] = [];
  const textures: DataTexture[] = [];
  for (const L of layers) {
    const y = L.y * ky;
    const a = new Uint8Array(tw * th);
    const b = new Uint8Array(tw * th);
    for (let j = 0; j < th; j++) {
      for (let i = 0; i < tw; i++) {
        const x = coords.x0 - M + (i / (tw - 1)) * (coords.x1 - coords.x0 + 2 * M);
        const z = coords.z0 - M + (j / (th - 1)) * (coords.z1 - coords.z0 + 2 * M);
        const inD = Math.min(x - coords.x0, coords.x1 - x, z - coords.z0, coords.z1 - z);
        // 靠南（平常看过来的一边）不留边上的雾，免得挂在切面上
        const edgeM = inD >= 0 ? (1 - smoothstep(0, 1100, inD)) * smoothstep(0, 160, inD) * smoothstep(300, 1500, coords.z1 - z) : 0;
        const h = samplers.height(x, z);
        const ty = coords.y(h);
        const clear = smoothstep(y - 4 * ky, y - 34 * ky, ty) * (inD >= 0 ? smoothstep(60, 420, coords.z1 - z) : 0); // 地面离雾层够远才有雾
        const hs = samplers.hillSoft(x, z);
        const foot = smoothstep(0.04, 0.22, hs) * (1 - smoothstep(0.3, 0.7, hs));
        const wisp = smoothstep(0.4, 0.7, fbm(x / 2700 + L.seed * 3.1, z / 760 + L.seed * 7.7, 4, 40 + L.seed));
        const wisp2 = smoothstep(0.36, 0.66, fbm(x / 3600 + L.seed * 1.3, z / 1100 - L.seed * 2.9, 4, 70 + L.seed));
        // 城和城外两三百米里不起雾（样张是离城中心 850 到 1700 米之间慢慢起，城的半边长 600）
        const awayCity = smoothstep(250, 1100, outsideCity(x, z));
        const lowland = smoothstep(base + 0.6, base - 1.6, h);
        const wet = inD >= 0 ? smoothstep(flood + 0.9, flood - 1.3, h) : 0;
        const open = awayCity * awaySingle(x, z);
        const vNormal = (edgeM * 0.5 * wisp + foot * 0.95 * wisp + lowland * 0.2 * wisp2) * clear * open;
        const vFlood = (edgeM * 0.55 * wisp + foot * 1.0 * wisp + wet * 0.55 * wisp2 * wisp) * clear * open;
        a[j * tw + i] = clamp(Math.round(vNormal * 255), 0, 255);
        b[j * tw + i] = clamp(Math.round(vFlood * 255), 0, 255);
      }
    }
    const mk = (d: Uint8Array): DataTexture => {
      const t = new DataTexture(d, tw, th, RedFormat, UnsignedByteType);
      t.magFilter = LinearFilter;
      t.minFilter = LinearFilter;
      t.needsUpdate = true;
      textures.push(t);
      return t;
    };
    const mat = new ShaderMaterial({
      uniforms: {
        uA: { value: mk(a) },
        uB: { value: mk(b) },
        uMix: { value: 0 },
        uOpacity: { value: L.op },
        uColor: { value: new Color(style.palette.mist) },
      },
      vertexShader: MIST_VERT,
      fragmentShader: MIST_FRAG,
      transparent: true,
      depthWrite: false,
    });
    const geo = new PlaneGeometry(coords.x1 - coords.x0 + 2 * M, coords.z1 - coords.z0 + 2 * M);
    geo.rotateX(-Math.PI / 2);
    // PlaneGeometry 转平以后 v=1 在北边，这里要 v=0 在北边
    const uvs = geo.attributes.uv;
    for (let i = 0; i < uvs.count; i++) uvs.setY(i, 1 - uvs.getY(i));
    const mesh = new Mesh(geo, mat);
    mesh.position.set((coords.x0 + coords.x1) / 2, y, (coords.z0 + coords.z1) / 2);
    mesh.renderOrder = 3 + L.seed;
    group.add(mesh);
    mats.push(mat);
  }

  return {
    group,
    setFlood(f) {
      for (const m of mats) m.uniforms.uMix.value = f;
    },
    setStrength(s) {
      mats.forEach((m, i) => {
        m.uniforms.uOpacity.value = layers[i].op * s;
      });
    },
    setColor(hex, dim) {
      for (const m of mats) (m.uniforms.uColor.value as Color).set(hex).multiplyScalar(dim);
    },
    dispose() {
      for (const mesh of group.children) if (mesh instanceof Mesh) mesh.geometry.dispose();
      for (const m of mats) m.dispose();
      for (const t of textures) t.dispose();
    },
  };
}
