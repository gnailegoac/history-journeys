// 沙盘的地面：一块有厚度的地形板。上表面是整理过的真实地形，四边是切面。

import * as THREE from 'three';
import { CROP, EX, yOf, PAL } from './config.js';
import { paintMacro, bakeNormals } from './terrain-data.js';

export const BLOCK_BASE_Y = -170;

const FIELD_GLSL = /* glsl */ `
varying vec3 vWPos;
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

export function buildTerrain(td, renderer) {
  const group = new THREE.Group();
  const SX = 200;
  const SZ = 164;
  const W = CROP.x1 - CROP.x0;
  const D = CROP.z1 - CROP.z0;

  // 网格比高程粗，取附近的最低值，保证水面不会被网格顶破
  const heightAtVertex = (x, z) => {
    let m = td.sample(x, z);
    const o = 22;
    for (const [dx, dz] of [[o, 0], [-o, 0], [0, o], [0, -o], [o, o], [-o, o], [o, -o], [-o, -o]]) m = Math.min(m, td.sample(x + dx, z + dz));
    return m;
  };

  const nv = (SX + 1) * (SZ + 1);
  const pos = new Float32Array(nv * 3);
  const uv = new Float32Array(nv * 2);
  const nor = new Float32Array(nv * 3);
  const topY = new Float32Array(nv);
  for (let j = 0; j <= SZ; j++) {
    for (let i = 0; i <= SX; i++) {
      const k = j * (SX + 1) + i;
      const x = CROP.x0 + (i / SX) * W;
      const z = CROP.z0 + (j / SZ) * D;
      const y = yOf(heightAtVertex(x, z));
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
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));

  const macro = paintMacro(td);
  const map = new THREE.DataTexture(macro.data, macro.w, macro.h, THREE.RGBAFormat, THREE.UnsignedByteType);
  map.colorSpace = THREE.SRGBColorSpace;
  map.magFilter = THREE.LinearFilter;
  map.minFilter = THREE.LinearMipmapLinearFilter;
  map.generateMipmaps = true;
  map.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  map.needsUpdate = true;

  const nrm = new THREE.DataTexture(bakeNormals(td, EX), td.nx, td.nz, THREE.RGBAFormat, THREE.UnsignedByteType);
  nrm.magFilter = THREE.LinearFilter;
  nrm.minFilter = THREE.LinearFilter;
  nrm.needsUpdate = true;

  const mat = new THREE.MeshLambertMaterial({ map, normalMap: nrm, normalMapType: THREE.ObjectSpaceNormalMap });
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n' + FIELD_GLSL)
      .replace(
        '#include <map_fragment>',
        /* glsl */ `
        vec4 texel = texture2D(map, vMapUv);
        diffuseColor.rgb *= fieldPaint(texel.rgb, vWPos.xz, texel.a);
        `,
      );
  };
  const top = new THREE.Mesh(geo, mat);
  top.receiveShadow = true;
  top.castShadow = true;
  group.add(top);

  // 四边的切面：像一叠裱起来的纸板
  const sidePos = [];
  const sideUv = [];
  const sideNor = [];
  const sideIdx = [];
  let acc = 0;
  const addEdge = (ks, nx, nz) => {
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
  sideGeo.setIndex(sideIdx);
  const sideMat = new THREE.MeshLambertMaterial({ color: PAL.blockSide, map: layerTexture(), side: THREE.DoubleSide });
  const sides = new THREE.Mesh(sideGeo, sideMat);
  sides.receiveShadow = true;
  sides.castShadow = true;
  group.add(sides);

  return { group, top, sides };
}

function layerTexture() {
  const c = document.createElement('canvas');
  c.width = 8;
  c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, 8, 64);
  for (let y = 0; y < 64; y += 8) {
    g.fillStyle = 'rgba(120,96,60,0.20)';
    g.fillRect(0, y, 8, 1);
    g.fillStyle = 'rgba(255,255,255,0.35)';
    g.fillRect(0, y + 1, 8, 1);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}
