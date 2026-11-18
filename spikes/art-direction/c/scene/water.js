// 水：一整张平的水面，在着色器里按“水位减地面高度”决定哪里有水、有多深。
// 这样岸线是逐像素算的，水和地不会打架；水位一变，水就漫开或退回去。
import * as THREE from 'three';
import { TABLE_M, U } from './terrain.js';
import { PAL } from './palette.js';
import { makeNoise } from './util.js';

function rippleNormalTexture() {
  const size = 256;
  const n = makeNoise(41);
  const h = new Float32Array(size * size);
  // 可平铺的细波纹
  const tile = (x, y) => {
    const u = x / size;
    const v = y / size;
    const a = n.fbm(x / 22, y / 22, 3);
    const b = n.fbm((x - size) / 22, y / 22, 3);
    const c = n.fbm(x / 22, (y - size) / 22, 3);
    const d = n.fbm((x - size) / 22, (y - size) / 22, 3);
    return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
  };
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) h[y * size + x] = tile(x, y);
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const l = h[y * size + ((x + size - 1) % size)];
      const r = h[y * size + ((x + 1) % size)];
      const u = h[((y + size - 1) % size) * size + x];
      const d = h[((y + 1) % size) * size + x];
      let nx = (l - r) * 3.0;
      let ny = (u - d) * 3.0;
      const len = Math.hypot(nx, ny, 1);
      nx /= len;
      ny /= len;
      const i = (y * size + x) * 4;
      data[i] = Math.round((nx * 0.5 + 0.5) * 255);
      data[i + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      data[i + 2] = Math.round((1 / len) * 0.5 * 255 + 127.5);
      data[i + 3] = 255;
    }
  }
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 4;
  t.needsUpdate = true;
  return t;
}

export function makeWater(td, heightTex, patch) {
  const T = TABLE_M;
  const W = (T.maxX - T.minX) * U;
  const D = (T.maxZ - T.minZ) * U;
  const uniforms = {
    uHeightTex: { value: heightTex },
    uLevel: { value: 0.3 },
    uClarity: { value: 8.0 },
    uShallow: { value: new THREE.Color(PAL.waterShallow) },
    uDeep: { value: new THREE.Color(PAL.waterDeep) },
    // 水深到多少算“深水”：河里窄，一点深度就该是深青；大水漫在田上，要深得多才算
    uDeepRange: { value: new THREE.Vector2(0.02, 0.25) },
    uTexXf: { value: new THREE.Vector4((td.NX - 1) / td.NX, (td.NZ - 1) / td.NZ, 0.5 / td.NX, 0.5 / td.NZ) },
  };
  const ripple = rippleNormalTexture();
  ripple.repeat.set(W / 2.6, D / 2.6);
  const mat = patch(
    new THREE.MeshStandardMaterial({
      color: '#ffffff',
      roughness: 0.16,
      metalness: 0,
      transparent: true,
      depthWrite: false,
      normalMap: ripple,
      normalScale: new THREE.Vector2(0.06, 0.06),
      envMapIntensity: 3.2,
    }),
    (shader) => {
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vTerrUv;')
        .replace('#include <uv_vertex>', '#include <uv_vertex>\nvTerrUv = uv;');
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
          varying vec2 vTerrUv;
          uniform sampler2D uHeightTex;
          uniform float uLevel;
          uniform float uClarity;
          uniform vec3 uShallow;
          uniform vec3 uDeep;
          uniform vec2 uDeepRange;
          uniform vec4 uTexXf;`,
        )
        .replace(
          '#include <map_fragment>',
          `{
            vec2 hm = texture2D(uHeightTex, vTerrUv * uTexXf.xy + uTexXf.zw).rg;
            float wDepth = uLevel - hm.r;
            float body = 1.0 - exp(-max(wDepth, 0.0) * uClarity);
            float a = mix(0.30, 0.95, body) * smoothstep(0.0, 0.03, wDepth) * (1.0 - smoothstep(0.3, 0.7, hm.g));
            if (a < 0.004) discard;
            diffuseColor.rgb = mix(uShallow, uDeep, smoothstep(uDeepRange.x, uDeepRange.y, wDepth));
            diffuseColor.a = a;
          }`,
        );
    },
  );
  const geo = new THREE.PlaneGeometry(W, D, 1, 1);
  geo.rotateX(-Math.PI / 2);
  // 平面转过来以后 v 方向和 z 相反，这里把 uv 改成直接按 x、z 算
  const pos = geo.attributes.position;
  const uv = geo.attributes.uv;
  for (let i = 0; i < pos.count; i++) {
    uv.setXY(i, pos.getX(i) / W + 0.5, pos.getZ(i) / D + 0.5);
  }
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(((T.maxX + T.minX) / 2) * U, 0.3, ((T.maxZ + T.minZ) / 2) * U);
  mesh.receiveShadow = true;
  // 这种软阴影会把“接影子的东西”也画进阴影图里。水面要是画进去，就成了一块挡住水下田地的板，
  // 浅水的地方会出一道道斜纹。所以给水面一个什么都不画的深度材质：它只接影子，不挡光。
  const noDepth = new THREE.MeshDepthMaterial();
  noDepth.onBeforeCompile = (shader) => {
    // 把所有顶点挪到画面外的同一个点上：一个像素也不画
    shader.vertexShader = shader.vertexShader.replace('vHighPrecisionZW = gl_Position.zw;', 'gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vHighPrecisionZW = gl_Position.zw;');
  };
  mesh.customDepthMaterial = noDepth;
  mesh.renderOrder = 5;
  mesh.name = 'water';

  return {
    mesh,
    uniforms,
    setLevel(y, clarity) {
      uniforms.uLevel.value = y;
      mesh.position.y = y;
      if (clarity !== undefined) uniforms.uClarity.value = clarity;
    },
  };
}

/** 盘边上水的切面：像浇进去的树脂，从地面到水位。 */
export function makeWaterEdge(wgeo, waterUniforms, patch) {
  const mat = patch(
    new THREE.MeshStandardMaterial({ color: PAL.waterDeep, roughness: 0.25, metalness: 0, transparent: true, opacity: 0.86, depthWrite: false }),
    (shader) => {
      shader.uniforms.uLevel = waterUniforms.uLevel;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float aGround;\nattribute float aTop;\nuniform float uLevel;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed.y = mix(aGround, max(aGround, uLevel), aTop);');
    },
  );
  const mesh = new THREE.Mesh(wgeo, mat);
  mesh.renderOrder = 6;
  mesh.frustumCulled = false;
  return mesh;
}
