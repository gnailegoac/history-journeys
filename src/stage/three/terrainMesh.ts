// 从样张搬来，结构没有动（spikes/art-direction/b/scene/terrain.js），只加了类型；
// 原来从 config.js 取的定数（范围、夸大的倍数、颜色）改成从场景和样式传进来，地面的颜色和法线改成用 ground 上好的。
// 沙盘的地面：一块有厚度的地形板。上表面是整理过的真实地形，四边是切面。
//
// 和样张不一样的一处：“这里有没有田”不再跟着颜色走（颜色那张图的第四个字节），单独是一张贴图（uFields）。
// 制作时先画好的地面是两张图片（颜色是 JPEG，带不了第四个字节）；沙盘打开时现画的，也拆成两张贴图。
// 所以着色器只有一种读法，两条路画出来的是同一种东西。
//
// 全程沙盘也用这一块板，三处不一样，都是传进来的（不传就是站点沙盘原来的样子）：
//   marks 写 ripples：第二张图标的不是田，是“这里画不画水纹、画多重”（海和湖是画在地面上的，水纹由着色器现画）；
//   underWater 写 false：顶点不取附近的最低值（那是为了不顶破水面；全程沙盘没有水面，取了反倒把每条山脊削掉一格）；
//   segmentM：网格多少米一格。

import {
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  DataTexture,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  LinearFilter,
  LinearMipmapLinearFilter,
  Mesh,
  MeshLambertMaterial,
  ObjectSpaceNormalMap,
  RGBAFormat,
  RedFormat,
  RepeatWrapping,
  SRGBColorSpace,
  Texture,
  UnsignedByteType,
  Vector2,
  type IUniform,
} from 'three';
import type { FrameCoords } from '../../domain/sceneGeo';
import type { GroundPaint, GroundSamplers } from '../ground/types';
import { fieldBytes } from './groundPaint';
import { terrainGrid, vertexHeightM } from './meshHeight';
import type { GroundPaintSource } from './groundPaint';
import { disposeTree } from './host';
import type { TableStyle } from './internal';
import { rippleGlsl } from './water';

/** 地形板的底面在沙盘里的高度。 */
export const BLOCK_BASE_Y = -170;

// 网格分多少格、一个顶点多高，在 ./meshHeight.ts：贴着地形板摆的模型也要问那里。
export { terrainGrid };

const FIELD_GLSL = /* glsl */ `
varying vec3 vWPos;
// 哪里是田、田有多重：和颜色那张图一样大，只用红的那一路
uniform sampler2D uFields;
float fhash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float fnoise(vec2 p){
  vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(fhash(i), fhash(i + vec2(1.0, 0.0)), u.x), mix(fhash(i + vec2(0.0, 1.0)), fhash(i + vec2(1.0, 1.0)), u.x), u.y);
}
// 田：一块一块错开的长方格，每块颜色略有不同，近看有田垄和田埂
vec3 fieldPaint(vec3 base, vec2 w, float mask){
  if (mask < 0.004) return base;
  // 一片一片的田朝向不同
  float region = floor(fnoise(w / 1500.0 + 7.3) * 3.0);
  float ang = 0.2 + region * 0.62;
  float cs = cos(ang), sn = sin(ang);
  vec2 q = vec2(cs * w.x - sn * w.y, sn * w.x + cs * w.y);
  q += 46.0 * vec2(sin(q.y / 410.0 + region), sin(q.x / 350.0)) + 90.0 * vec2(fnoise(w / 900.0), fnoise(w / 900.0 + 31.0));
  vec2 cell = vec2(230.0 + 60.0 * region, 130.0 + 20.0 * region);
  vec2 g = q / cell;
  float row = floor(g.y);
  g.x += fhash(vec2(row, 7.0)) * 0.67;
  vec2 id = floor(g);
  vec2 f = fract(g);
  float r1 = fhash(id);
  float r2 = fhash(id + 31.7);
  vec3 tint = vec3(1.0);
  tint = mix(tint, vec3(1.05, 1.05, 0.86), smoothstep(0.0, 0.26, r1) * (1.0 - smoothstep(0.3, 0.34, r1)));   // 藤黄
  tint = mix(tint, vec3(0.91, 0.87, 0.80), smoothstep(0.34, 0.56, r1) * (1.0 - smoothstep(0.6, 0.64, r1)));   // 赭
  tint = mix(tint, vec3(0.84, 0.97, 0.86), smoothstep(0.64, 0.76, r1) * (1.0 - smoothstep(0.8, 0.84, r1)));
  tint = mix(tint, vec3(0.78, 0.90, 0.78), smoothstep(0.84, 0.9, r1) * (1.0 - smoothstep(0.95, 0.99, r1)));  // 淡石绿（水田）
  // 田埂
  vec2 de = min(f, 1.0 - f) * cell;
  float ed = min(de.x, de.y);
  float aw = max(fwidth(q.x), 0.001);
  float ridge = 1.0 - smoothstep(1.2, 1.2 + aw * 1.6, ed);
  ridge *= 1.0 - smoothstep(1.6, 5.0, aw);
  // 田垄
  float fr = (r2 < 0.5 ? q.x : q.y) / 8.0;
  float fwv = fwidth(fr);
  float fur = (1.0 - smoothstep(0.16, 0.16 + fwv * 1.5, abs(fract(fr) - 0.5))) * (1.0 - smoothstep(0.25, 0.7, fwv));
  // 大田块的颜色已经画在底色里了；这里只在近看时把一块大田再分成小块，加田垄和田埂
  float farK = 1.0 - smoothstep(2.0, 6.0, aw);
  vec3 c = base * mix(vec3(1.0), tint, 0.5 * farK);
  c *= 1.0 - 0.10 * fur;
  c *= 1.0 - 0.20 * ridge;
  return mix(base, c, mask);
}
`;

/**
 * 全程沙盘的地面用的那一段着色器：第二张图（还叫 uFields）标的是“这里画不画水纹、画多重”，
 * 水纹用水面的那几个函数现画，盖在画好的颜色上。spacingPx 是相邻两道水纹隔多少个页面像素。
 */
function rippleMarkGlsl(spacingPx: number): string {
  return /* glsl */ `
varying vec3 vWPos;
uniform sampler2D uFields;
uniform vec3 uFoam;
uniform float uTime;
uniform float uDense;
uniform vec2 uRipRot;
uniform float uPx;
${rippleGlsl(spacingPx)}`;
}

/** 水纹最重的地方盖上去几成（定稿的样张是 0.66）。 */
const RIPPLE_STRENGTH = '0.66';

export interface TerrainMeshInput {
  /** 取地面高度用。 */
  samplers: GroundSamplers;
  /**
   * 上好色的地面：颜色、田的标记和法线图。可以是现画的（一份字节，四个字节一个点），
   * 也可以是制作时先画好的两张图片（groundPaint.ts 的 GroundPaintSource，kind 是 baked）。
   */
  paint: GroundPaint | GroundPaintSource;
  /** 法线图的大小：地面网格的列数、行数。 */
  nx: number;
  nz: number;
  coords: FrameCoords;
  style: TableStyle;
  /** 显卡最多支持几倍的各向异性过滤（renderer.capabilities.getMaxAnisotropy()）。 */
  maxAnisotropy: number;
  /** 第二张图标的是什么：fields 是田（不写就是它），ripples 是水纹（全程沙盘）。 */
  marks?: 'fields' | 'ripples';
  /** 顶点要不要取附近的最低值，好不顶破水面。不写是要；全程沙盘没有水面，写 false。 */
  underWater?: boolean;
  /** 网格大约多少米一格。不写是 59。 */
  segmentM?: number;
  /** marks 是 ripples 时：相邻两道水纹隔多少个页面像素。不写是 8。 */
  ripplePx?: number;
}

export interface TerrainMesh {
  group: Group;
  top: Mesh;
  sides: Mesh;
  /** 上表面的材质另挂的 uniform。marks 是 ripples 时里面有水纹的四样（uDense、uRipRot、uPx、uTime）。 */
  uniforms: Record<string, IUniform>;
  /** 把形状、材质和贴图都放掉。 */
  dispose(): void;
}

/**
 * 地面的两张贴图：颜色，田的标记。
 * 先画好的：两张图片各做一张贴图。图片的第 0 行最北，和现画的字节一样，所以不上下颠倒。
 * 现画的：颜色用原来那份字节（第四个字节着色器不读），田的标记从第四个字节拆出来，一个点一个字节。
 * 两张的过滤一样（田的标记以前就是跟着颜色一起过滤的）。
 */
export function groundTextures(paint: GroundPaint | GroundPaintSource, maxAnisotropy: number): { map: Texture; fields: Texture } {
  let map: Texture;
  let fields: Texture;
  if ('kind' in paint && paint.kind === 'baked') {
    map = new Texture(paint.colour);
    fields = new Texture(paint.fields);
    map.flipY = false;
    fields.flipY = false;
    fields.format = RedFormat;
  } else {
    map = new DataTexture(paint.colour, paint.w, paint.h, RGBAFormat, UnsignedByteType);
    fields = new DataTexture(fieldBytes(paint.colour), paint.w, paint.h, RedFormat, UnsignedByteType);
  }
  map.colorSpace = SRGBColorSpace;
  for (const texture of [map, fields]) {
    texture.magFilter = LinearFilter;
    texture.minFilter = LinearMipmapLinearFilter;
    texture.generateMipmaps = true;
    texture.anisotropy = Math.min(8, maxAnisotropy);
    texture.needsUpdate = true;
  }
  return { map, fields };
}

export function buildTerrainMesh(input: TerrainMeshInput): TerrainMesh {
  const { samplers, paint, coords, style } = input;
  const group = new Group();
  const { sx: SX, sz: SZ } = terrainGrid(coords, input.segmentM);
  const ripples = input.marks === 'ripples';
  const W = coords.x1 - coords.x0;
  const D = coords.z1 - coords.z0;

  // 网格比高程粗，取附近的最低值，保证水面不会被网格顶破（meshHeight.ts 的 vertexHeightM）
  const heightAtVertex = (x: number, z: number): number => (input.underWater === false ? samplers.height(x, z) : vertexHeightM(samplers, x, z));

  const nv = (SX + 1) * (SZ + 1);
  const pos = new Float32Array(nv * 3);
  const uv = new Float32Array(nv * 2);
  const nor = new Float32Array(nv * 3);
  const topY = new Float32Array(nv);
  for (let j = 0; j <= SZ; j++) {
    for (let i = 0; i <= SX; i++) {
      const k = j * (SX + 1) + i;
      const x = coords.x0 + (i / SX) * W;
      const z = coords.z0 + (j / SZ) * D;
      const y = coords.y(heightAtVertex(x, z));
      topY[k] = y;
      pos[k * 3] = x;
      pos[k * 3 + 1] = y;
      pos[k * 3 + 2] = z;
      uv[k * 2] = i / SX;
      uv[k * 2 + 1] = j / SZ;
      nor[k * 3 + 1] = 1;
    }
  }
  const idx = new Uint32Array(SX * SZ * 6);
  let t = 0;
  for (let j = 0; j < SZ; j++) {
    for (let i = 0; i < SX; i++) {
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
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(pos, 3));
  geo.setAttribute('uv', new BufferAttribute(uv, 2));
  geo.setAttribute('normal', new BufferAttribute(nor, 3));
  geo.setIndex(new BufferAttribute(idx, 1));

  const { map, fields } = groundTextures(paint, input.maxAnisotropy);

  const nrm = new DataTexture(paint.normals, input.nx, input.nz, RGBAFormat, UnsignedByteType);
  nrm.magFilter = LinearFilter;
  nrm.minFilter = LinearFilter;
  nrm.needsUpdate = true;

  // 田的标记不是这种材质自己认得的贴图，另挂在材质的 uniforms 上：
  // 放掉材质时（host.ts 的 disposeMaterial）、数贴图有多大时，都从这里找得到它。
  const uniforms: Record<string, IUniform> = { uFields: { value: fields } };
  if (ripples) {
    uniforms.uFoam = { value: new Color(style.palette.ripple) };
    uniforms.uTime = { value: 0 };
    uniforms.uDense = { value: 0.5 };
    uniforms.uRipRot = { value: new Vector2(1, 0) };
    uniforms.uPx = { value: 1 };
  }
  const mat = Object.assign(new MeshLambertMaterial({ map, normalMap: nrm, normalMapType: ObjectSpaceNormalMap }), { uniforms });
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n' + (ripples ? rippleMarkGlsl(input.ripplePx ?? 8) : FIELD_GLSL))
      .replace(
        '#include <map_fragment>',
        ripples
          ? /* glsl */ `
        vec4 texel = texture2D(map, vMapUv);
        diffuseColor.rgb *= mix(texel.rgb, uFoam, ripples(vWPos.xz) * texture2D(uFields, vMapUv).r * ${RIPPLE_STRENGTH});
        `
          : /* glsl */ `
        vec4 texel = texture2D(map, vMapUv);
        diffuseColor.rgb *= fieldPaint(texel.rgb, vWPos.xz, texture2D(uFields, vMapUv).r);
        `,
      );
  };
  const top = new Mesh(geo, mat);
  top.receiveShadow = true;
  top.castShadow = true;
  group.add(top);

  // 四边的切面：像一叠裱起来的纸板
  const sidePos: number[] = [];
  const sideUv: number[] = [];
  const sideNor: number[] = [];
  const sideIdx: number[] = [];
  let acc = 0;
  const addEdge = (ks: number[], nx: number, nz: number): void => {
    for (let s = 0; s < ks.length; s++) {
      const k = ks[s];
      const x = pos[k * 3];
      const z = pos[k * 3 + 2];
      const y = topY[k];
      if (s > 0) {
        const kp = ks[s - 1];
        acc += Math.hypot(x - pos[kp * 3], z - pos[kp * 3 + 2]);
      }
      const base = sidePos.length / 3;
      sidePos.push(x, y, z, x, BLOCK_BASE_Y, z);
      sideUv.push(acc / 300, y / 60, acc / 300, BLOCK_BASE_Y / 60);
      sideNor.push(nx, 0, nz, nx, 0, nz);
      if (s > 0) sideIdx.push(base - 2, base - 1, base, base, base - 1, base + 1);
    }
  };
  const south: number[] = [];
  const north: number[] = [];
  const west: number[] = [];
  const east: number[] = [];
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
  const sideGeo = new BufferGeometry();
  sideGeo.setAttribute('position', new Float32BufferAttribute(sidePos, 3));
  sideGeo.setAttribute('uv', new Float32BufferAttribute(sideUv, 2));
  sideGeo.setAttribute('normal', new Float32BufferAttribute(sideNor, 3));
  sideGeo.setIndex(sideIdx);
  const sideMat = new MeshLambertMaterial({ color: style.palette.blockSide, map: layerTexture(), side: DoubleSide });
  const sides = new Mesh(sideGeo, sideMat);
  sides.receiveShadow = true;
  sides.castShadow = true;
  group.add(sides);

  return { group, top, sides, uniforms, dispose: () => disposeTree(group) };
}

function layerTexture(): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 8;
  c.height = 64;
  const g = c.getContext('2d');
  if (g) {
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, 8, 64);
    for (let y = 0; y < 64; y += 8) {
      g.fillStyle = 'rgba(120,96,60,0.20)';
      g.fillRect(0, y, 8, 1);
      g.fillStyle = 'rgba(255,255,255,0.35)';
      g.fillRect(0, y + 1, 8, 1);
    }
  }
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.wrapS = t.wrapT = RepeatWrapping;
  t.anisotropy = 4;
  return t;
}
