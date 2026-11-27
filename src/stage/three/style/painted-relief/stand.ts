// 彩绘地形模型（'painted-relief'）这一种样式的匣子：一只直边的素胡桃木匣。
// 地形板四周一圈浅色的衬条，外面是木框——框面是平的，里外两面都直上直下，没有线脚、没有矮脚、没有花纹；
// 地形板的边上一道细线；匣子落在案上的影子偏在西南（光从东北来）。
// 数是从定稿的样张换算来的：样张里一公里合 5.85 个单位，这座沙盘上一公里合 1000 ÷ 145 = 6.9 米，所以样张的数都乘了 1.18。
// 交给沙盘程序的是最下面的 STAND：匣子最宽的那一圈伸出去多远、多高，和怎么造。

import {
  BufferGeometry,
  CanvasTexture,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  MeshStandardMaterial,
  PMREMGenerator,
  PlaneGeometry,
  RepeatWrapping,
  SRGBColorSpace,
  type WebGLRenderer,
} from 'three';
import type { FrameCoords } from '../../../../domain/sceneGeo';
import type { Vec3 } from '../../../ground/types';
import { disposeTree, roomScene } from '../../host';
import type { Stand, StandStyle } from '../../internal';
import { mulberry32 } from '../../kit/util';

/** 衬条多宽（样张 84 个单位，合地上 14 公里）。 */
export const BAND = 99;
/** 衬条的面在沙盘里多高：比海面低一点（样张 −26）。地形板的切面比它深，深下去的那一截压在衬条底下，看不见。 */
export const BAND_Y = -31;
/** 木框的面多宽（样张 270）、比衬条高出多少（样张 92）、匣子从衬条到案面多深（样张 430）。 */
export const FRAME_W = 318;
export const FRAME_UP = 108;
export const CASE_DEPTH = 507;
/**
 * 匣子最外面的一圈：比沙盘的边多出多少，落在案上的那一道边多高，木框的面多高。
 * 这一圈有两道边都要看得见：木框的面（比海面高）和落在案上的边。两个高度都交给镜头（最下面的 STAND 的 reachY、reachTopY），
 * 看整块沙盘时整只匣子都在画面里（定稿的样张看整块沙盘时匣子是完整的）。
 */
export const STAND_REACH = BAND + FRAME_W;
export const FLOOR_Y = BAND_Y - CASE_DEPTH;
export const FRAME_TOP_Y = BAND_Y + FRAME_UP;
/** 地形板边上那道细线多宽（沙盘里的米）：看整块沙盘时在电脑的沙盘栏上约一个像素（样张是一像素的线）。 */
export const RIM_W = 12;
/** 匣子一共多少个三角形：衬条 2，木框三段 × 四边 × 2，细线四边 × 2，案上的影子 2。 */
export const STAND_TRIANGLES = 2 + 3 * 4 * 2 + 4 * 2 + 2;

/** 木头上的环境反光，白天的强弱（样张的数）。 */
const WOOD_SHINE = 0.4;
/** 木纹的贴图顺长多少米一轮（样张 900 个单位）。 */
const GRAIN_M = 1061;

/** 四边形拼的硬边零件：每个面自己的法线。 */
class Quads {
  private readonly p: number[] = [];
  private readonly n: number[] = [];
  private readonly uv: number[] = [];

  /** a b c d 依次绕一圈；n 是朝外的法线，绕向照它对齐；uvs 不写就不贴图。 */
  quad(a: Vec3, b: Vec3, c: Vec3, d: Vec3, n: Vec3, uvs: [number, number][] = [[0, 0], [1, 0], [1, 1], [0, 1]]): void {
    const cx = (b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]);
    const cy = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]);
    const cz = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    const pts = [a, b, c, d];
    for (const k of cx * n[0] + cy * n[1] + cz * n[2] >= 0 ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2]) {
      this.p.push(...pts[k]);
      this.n.push(...n);
      this.uv.push(...uvs[k]);
    }
  }

  geo(): BufferGeometry {
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new Float32BufferAttribute(this.uv, 2));
    return g;
  }
}

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  if (!g) throw new Error('这个浏览器画不了贴图');
  return [c, g];
}

/** 胡桃木：顺长的木纹，很淡。 */
function woodTexture(): CanvasTexture {
  const [c, g] = canvas(512, 64);
  const rnd = mulberry32(23);
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, 512, 64);
  for (let i = 0; i < 70; i++) {
    const y = rnd() * 64;
    const v = rnd();
    g.strokeStyle = v < 0.65 ? `rgba(0,0,0,${0.04 + rnd() * 0.12})` : `rgba(255,232,205,${0.03 + rnd() * 0.06})`;
    g.lineWidth = 0.5 + rnd() * 1.4;
    const amp = rnd() * 2.4;
    // 一轮贴图正好一整个波：贴图顺着框一轮一轮接下去，接头的地方木纹对得上，不跳
    const wave = (x: number): number => y + Math.sin((x / 512) * 2 * Math.PI + i) * amp;
    g.beginPath();
    g.moveTo(0, wave(0));
    for (let x = 32; x <= 512; x += 32) g.lineTo(x, wave(x));
    g.stroke();
  }
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.wrapS = t.wrapT = RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

/** 这种样式的匣子：沙盘程序要的那几样（见 ../../internal.ts 的 Stand），加上木头的材质（测试看它的反光）。 */
export interface PlainCase extends Stand {
  wood: MeshStandardMaterial;
}

/** 照沙盘的范围造匣子。颜色从样式的 palette 里取：band 衬条，walnut 木框，rim 地形板边上的细线。 */
export function buildCase(coords: FrameCoords, palette: Record<string, string>): PlainCase {
  const group = new Group();
  const cx = (coords.x0 + coords.x1) / 2;
  const cz = (coords.z0 + coords.z1) / 2;
  const hx = (coords.x1 - coords.x0) / 2;
  const hz = (coords.z1 - coords.z0) / 2;
  /** 四条边：o 是朝外的方向，a 是顺着边的方向；ho、ha 是沙盘在这两个方向上的半宽。 */
  const sides: { o: [number, number]; a: [number, number]; ho: number; ha: number }[] = [
    { o: [0, 1], a: [1, 0], ho: hz, ha: hx },
    { o: [1, 0], a: [0, -1], ho: hx, ha: hz },
    { o: [0, -1], a: [-1, 0], ho: hz, ha: hx },
    { o: [-1, 0], a: [0, 1], ho: hx, ha: hz },
  ];
  /** 一条边上，离沙盘的边 d 米、高 y 的一点；e 是 −1、1：这条边的哪一头。 */
  const at = (s: (typeof sides)[number], d: number, y: number, e: number): Vec3 => [cx + s.o[0] * (s.ho + d) + s.a[0] * e * (s.ha + d), y, cz + s.o[1] * (s.ho + d) + s.a[1] * e * (s.ha + d)];

  // 衬条：地形板外面一圈浅色（整块铺在地形板底下，露出来的是四周的一圈）
  const bgeo = new PlaneGeometry(2 * (hx + BAND + 2), 2 * (hz + BAND + 2));
  bgeo.rotateX(-Math.PI / 2);
  const band = new Mesh(bgeo, new MeshLambertMaterial({ color: palette.band }));
  band.position.set(cx, BAND_Y, cz);
  band.receiveShadow = true;
  group.add(band);

  // 木框：里面直上去，平的框面，外面直下到案上
  const profile: [number, number][] = [
    [BAND, BAND_Y],
    [BAND, FRAME_TOP_Y],
    [STAND_REACH, FRAME_TOP_Y],
    [STAND_REACH, FLOOR_Y],
  ];
  const fb = new Quads();
  let acc = 0;
  for (let i = 0; i < profile.length - 1; i++) {
    const [d0, y0] = profile[i];
    const [d1, y1] = profile[i + 1];
    const len = Math.hypot(d1 - d0, y1 - y0);
    const nd = -(y1 - y0) / len;
    const ny = (d1 - d0) / len;
    for (const s of sides) {
      const u0 = (s.ha + d0) / GRAIN_M;
      const u1 = (s.ha + d1) / GRAIN_M;
      fb.quad(at(s, d0, y0, -1), at(s, d0, y0, 1), at(s, d1, y1, 1), at(s, d1, y1, -1), [s.o[0] * nd, ny, s.o[1] * nd], [[-u0, acc / GRAIN_M], [u0, acc / GRAIN_M], [u1, (acc + len) / GRAIN_M], [-u1, (acc + len) / GRAIN_M]]);
    }
    acc += len;
  }
  const wood = new MeshStandardMaterial({ color: palette.walnut, map: woodTexture(), roughness: 0.62, metalness: 0, envMapIntensity: WOOD_SHINE });
  const frame = new Mesh(fb.geo(), wood);
  frame.castShadow = true;
  frame.receiveShadow = true;
  group.add(frame);

  // 地形板的边：一道细线，画完的地面同衬条才分得开（留白的陆地和衬条都是浅色）。
  // 样张是一像素宽的线；这里是贴着边、平铺在海面上一点点的一圈窄条（沙盘程序那一块里没有按像素算粗细的线，不为它另添）。
  const rim = new Quads();
  for (const s of sides) rim.quad(at(s, -RIM_W, 1, -1), at(s, -RIM_W, 1, 1), at(s, 0, 1, 1), at(s, 0, 1, -1), [0, 1, 0]);
  const line = new Mesh(rim.geo(), new MeshBasicMaterial({ color: palette.rim, transparent: true, opacity: 0.8, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }));
  group.add(line);

  // 匣子落在案上的影子：一块柔和的暗影，偏在西南
  const [c, pen] = canvas(256, 256);
  const sw = hx + STAND_REACH;
  const sd = hz + STAND_REACH;
  const pad = 2830;
  const fw = 2 * (sw + pad);
  const fd = 2 * (sd + pad);
  const img = pen.createImageData(256, 256);
  for (let j = 0; j < 256; j++) {
    for (let i = 0; i < 256; i++) {
      const dx = Math.max(Math.abs((i / 255 - 0.5) * fw) - sw, 0);
      const dz = Math.max(Math.abs((j / 255 - 0.5) * fd) - sd, 0);
      const k = (j * 256 + i) * 4;
      img.data[k] = 44;
      img.data[k + 1] = 46;
      img.data[k + 2] = 40;
      img.data[k + 3] = Math.round(Math.pow(Math.max(0, 1 - Math.hypot(dx, dz) / pad), 2.4) * 0.5 * 255);
    }
  }
  pen.putImageData(img, 0, 0);
  const st = new CanvasTexture(c);
  st.colorSpace = SRGBColorSpace;
  const sgeo = new PlaneGeometry(fw, fd);
  sgeo.rotateX(-Math.PI / 2);
  const shadow = new Mesh(sgeo, new MeshBasicMaterial({ map: st, transparent: true, depthWrite: false }));
  shadow.position.set(cx - 542, FLOOR_Y, cz + 472);
  shadow.renderOrder = -1;
  group.add(shadow);

  return {
    group,
    wood,
    // 木头要一点环境反光，别的材质都不反光。那间“屋子”向沙盘程序要（../../host.ts 的 roomScene）
    reflect(renderer: WebGLRenderer) {
      const pmrem = new PMREMGenerator(renderer);
      const room = roomScene();
      const environment = pmrem.fromScene(room, 0.04);
      wood.envMap = environment.texture;
      pmrem.dispose();
      room.dispose();
      return () => environment.dispose();
    },
    setDim(dim) {
      wood.envMapIntensity = WOOD_SHINE * dim;
    },
    dispose() {
      // 环境贴图由 reflect 交回去的那个函数放掉：这里先摘下来，免得跟着材质被放掉两次
      wood.envMap = null;
      disposeTree(group);
    },
  };
}

/** 这种样式的匣子，交给沙盘程序的那一份（样式的 stand）。“整块沙盘都要看得见”连木框的面和落在案上的那一道边一起算：下沿是案上的边，上沿是木框的面。 */
export const STAND: StandStyle = { reachM: STAND_REACH, reachY: FLOOR_Y, reachTopY: FRAME_TOP_Y, build: buildCase };
