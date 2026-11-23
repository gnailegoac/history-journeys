// 从样张搬来，结构没有动（spikes/art-direction/b/scene/table.js），只加了类型；沙盘的范围和颜色改成传进来。
// 样张里这个文件从 geo.js 借了三样：拼硬边面的 FB、绫边和紫檀两张贴图。这两张贴图只有座子用，
// 就一起搬到这里来了（零件库里面的东西，沙盘程序别的部分不去拿）；FB 只留了座子用得着的那一点（下面的 Quads）。
// 装裱和座子：地形板四周一圈浅色绫边，外面是紫檀的框和须弥座式的矮座。
// 样张里留下的一处将就没有动：座子落在案上的影子是按西北来的光画死的。

import {
  BoxGeometry,
  BufferGeometry,
  CanvasTexture,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  RepeatWrapping,
  SRGBColorSpace,
} from 'three';
import type { FrameCoords } from '../../domain/sceneGeo';
import type { Vec2, Vec3 } from '../ground/types';
import { disposeTree } from './host';
import { mulberry32 } from './kit/util';
import { BLOCK_BASE_Y } from './terrainMesh';

export const BORDER = 620;
export const STAND_OUT = 880;
export const FLOOR_Y = BLOCK_BASE_Y - 600;
/**
 * 座子最宽的那一圈：比沙盘的边多出多少米，下沿在沙盘里多高（和下面座子的截面是同一组数）。
 * “整块沙盘都要看得见”是连装裱和座子一起算的，rig.ts 的 showPoints 用这两个数。
 */
export const STAND_REACH = BORDER + 356;
export const STAND_REACH_Y = BLOCK_BASE_Y - 440;

/** 紫檀框和座的截面：离沙盘的边多远、多高，从里到外一圈。 */
const PROFILE: Vec2[] = [
  [BORDER, BLOCK_BASE_Y],
  [BORDER, BLOCK_BASE_Y + 64],
  [BORDER + 34, BLOCK_BASE_Y + 88],
  [BORDER + 250, BLOCK_BASE_Y + 88],
  [BORDER + 284, BLOCK_BASE_Y + 64],
  [BORDER + 284, BLOCK_BASE_Y - 70],
  [BORDER + 224, BLOCK_BASE_Y - 70],
  [BORDER + 224, BLOCK_BASE_Y - 250],
  [BORDER + 330, BLOCK_BASE_Y - 250],
  [BORDER + 356, BLOCK_BASE_Y - 282],
  [BORDER + 356, BLOCK_BASE_Y - 440],
  [BORDER + 322, BLOCK_BASE_Y - 482],
];

/**
 * 装裱和座子一共多少个三角形（算一个画面的三角形预算用，tests/stage/view.test.ts 拿造出来的东西核对过）：
 * 绫边 2，紫檀框和座每段截面 × 四边 × 2，嵌线四边 × 2，四只脚各 12，案上的影子 2。
 */
export const STAND_TRIANGLES = 2 + (PROFILE.length - 1) * 4 * 2 + 4 * 2 + 4 * 12 + 2;

/** 平面拼的硬边零件（每个面自己的法线）。样张 geo.js 里 FB 的一部分。 */
class Quads {
  private readonly p: number[] = [];
  private readonly n: number[] = [];
  private readonly uv: number[] = [];

  /** a b c d 依次绕一圈；n 是朝外的法线，绕向自动对齐 */
  quad(a: Vec3, b: Vec3, c: Vec3, d: Vec3, n: Vec3, uvs?: [Vec2, Vec2, Vec2, Vec2]): void {
    const ux = b[0] - a[0];
    const uy = b[1] - a[1];
    const uz = b[2] - a[2];
    const vx = c[0] - a[0];
    const vy = c[1] - a[1];
    const vz = c[2] - a[2];
    const cx = uy * vz - uz * vy;
    const cy = uz * vx - ux * vz;
    const cz = ux * vy - uy * vx;
    const same = cx * n[0] + cy * n[1] + cz * n[2] >= 0;
    const order = same ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2];
    const pts: Vec3[] = [a, b, c, d];
    const uu: Vec2[] = uvs || [[0, 0], [1, 0], [1, 1], [0, 1]];
    for (const k of order) {
      this.p.push(...pts[k]);
      this.n.push(...n);
      this.uv.push(...uu[k]);
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

// ---------- 贴图（都是代码画的） ----------
function tex(canvas: HTMLCanvasElement): CanvasTexture {
  const t = new CanvasTexture(canvas);
  t.colorSpace = SRGBColorSpace;
  t.wrapS = t.wrapT = RepeatWrapping;
  t.anisotropy = 4;
  return t;
}
function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  if (!g) throw new Error('这个浏览器画不了贴图');
  return [c, g];
}

/** 绫边：浅底上很淡的菱格小花 */
function brocadeTexture(base: string, fig: string): CanvasTexture {
  const [c, g] = canvas(128, 128);
  g.fillStyle = base;
  g.fillRect(0, 0, 128, 128);
  g.strokeStyle = fig;
  g.lineWidth = 1.6;
  g.globalAlpha = 0.8;
  const spots: Vec2[] = [[0, 0], [64, 64], [-64, 64], [64, -64], [0, 128], [128, 0], [128, 128]];
  for (const [ox, oy] of spots) {
    g.beginPath();
    g.moveTo(ox + 32, oy);
    g.lineTo(ox + 64, oy + 32);
    g.lineTo(ox + 32, oy + 64);
    g.lineTo(ox, oy + 32);
    g.closePath();
    g.stroke();
    g.beginPath();
    g.arc(ox + 32, oy + 32, 7, 0, Math.PI * 2);
    g.stroke();
  }
  g.globalAlpha = 0.07;
  g.fillStyle = '#6b5530';
  for (let y = 0; y < 128; y += 2) g.fillRect(0, y, 128, 1);
  g.fillStyle = '#ffffff';
  for (let x = 0; x < 128; x += 2) g.fillRect(x, 0, 1, 128);
  return tex(c);
}
/** 紫檀：顺长的木纹 */
function woodTexture(): CanvasTexture {
  const [c, g] = canvas(512, 64);
  const rnd = mulberry32(11);
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, 512, 64);
  for (let i = 0; i < 90; i++) {
    const y = rnd() * 64;
    const v = rnd();
    g.strokeStyle = v < 0.6 ? `rgba(0,0,0,${0.05 + rnd() * 0.16})` : `rgba(255,220,190,${0.04 + rnd() * 0.08})`;
    g.lineWidth = 0.5 + rnd() * 1.6;
    g.beginPath();
    g.moveTo(0, y);
    const amp = rnd() * 3;
    for (let x = 0; x <= 512; x += 32) g.lineTo(x, y + Math.sin(x / 80 + i) * amp);
    g.stroke();
  }
  return tex(c);
}

/** 紫檀木头上的环境反光，白天的强弱。 */
const WOOD_SHINE = 0.55;

export interface Stand {
  group: Group;
  /** 紫檀的材质：要一点环境反光，由 view.ts 给它配环境贴图。 */
  wood: MeshStandardMaterial;
  /** 木头上的反光压暗到几成（1 是白天）：反光来自环境贴图，灯暗了它不会跟着暗。 */
  setDim(dim: number): void;
  dispose(): void;
}

export function buildTable(coords: FrameCoords, palette: Record<string, string>): Stand {
  const group = new Group();
  const B = BLOCK_BASE_Y;
  const cx = (coords.x0 + coords.x1) / 2;
  const cz = (coords.z0 + coords.z1) / 2;
  const hx = (coords.x1 - coords.x0) / 2;
  const hz = (coords.z1 - coords.z0) / 2;

  // 绫边
  const bro = brocadeTexture(palette.brocade, palette.brocadeFig);
  const bw = 2 * (hx + BORDER + 4);
  const bd = 2 * (hz + BORDER + 4);
  const bgeo = new PlaneGeometry(bw, bd);
  bgeo.rotateX(-Math.PI / 2);
  const buv = bgeo.attributes.uv;
  for (let i = 0; i < buv.count; i++) buv.setXY(i, (buv.getX(i) * bw) / 300, (buv.getY(i) * bd) / 300);
  const border = new Mesh(bgeo, new MeshLambertMaterial({ map: bro }));
  border.position.set(cx, B + 0.5, cz);
  border.receiveShadow = true;
  group.add(border);

  // 紫檀框和座：一圈截面
  const prof = PROFILE;
  const fb = new Quads();
  const sides: { o: Vec2; a: Vec2; ho: number; ha: number }[] = [
    { o: [0, 1], a: [1, 0], ho: hz, ha: hx },
    { o: [1, 0], a: [0, -1], ho: hx, ha: hz },
    { o: [0, -1], a: [-1, 0], ho: hz, ha: hx },
    { o: [-1, 0], a: [0, 1], ho: hx, ha: hz },
  ];
  let acc = 0;
  for (let i = 0; i < prof.length - 1; i++) {
    const [d0, y0] = prof[i];
    const [d1, y1] = prof[i + 1];
    const dd = d1 - d0;
    const dy = y1 - y0;
    const len = Math.hypot(dd, dy);
    const nd = -dy / len;
    const ny = dd / len;
    for (const s of sides) {
      const P = (d: number, y: number, e: number): Vec3 => [cx + s.o[0] * (s.ho + d) + s.a[0] * e * (s.ha + d), y, cz + s.o[1] * (s.ho + d) + s.a[1] * e * (s.ha + d)];
      const L0 = 2 * (s.ha + d0);
      const L1 = 2 * (s.ha + d1);
      fb.quad(
        P(d0, y0, -1),
        P(d0, y0, 1),
        P(d1, y1, 1),
        P(d1, y1, -1),
        [s.o[0] * nd, ny, s.o[1] * nd],
        [[-L0 / 2 / 900, acc / 900], [L0 / 2 / 900, acc / 900], [L1 / 2 / 900, (acc + len) / 900], [-L1 / 2 / 900, (acc + len) / 900]],
      );
    }
    acc += len;
  }
  const wood = new MeshStandardMaterial({ color: palette.sandal, map: woodTexture(), roughness: 0.5, metalness: 0.0, envMapIntensity: WOOD_SHINE });
  const frame = new Mesh(fb.geo(), wood);
  frame.castShadow = true;
  frame.receiveShadow = true;
  group.add(frame);

  // 框面上嵌一道黄杨木细线
  const line = new Quads();
  for (const s of sides) {
    const P = (d: number, e: number): Vec3 => [cx + s.o[0] * (s.ho + d) + s.a[0] * e * (s.ha + d), B + 88.8, cz + s.o[1] * (s.ho + d) + s.a[1] * e * (s.ha + d)];
    line.quad(P(BORDER + 96, -1), P(BORDER + 96, 1), P(BORDER + 124, 1), P(BORDER + 124, -1), [0, 1, 0]);
  }
  const inlay = new Mesh(line.geo(), new MeshLambertMaterial({ color: '#b3925c' }));
  inlay.receiveShadow = true;
  group.add(inlay);

  // 四只矮脚
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    // 底面在 y=0 的盒子，再挪到位
    const g = new BoxGeometry(620, 120, 620);
    g.translate(cx + sx * (hx + BORDER + 20), B - 600 + 60, cz + sz * (hz + BORDER + 20));
    const m = new Mesh(g, wood);
    m.castShadow = true;
    group.add(m);
  }

  // 座子落在案上的影子：一块柔和的暗影。案面就是沙盘栏的底（绢色，#c5b189），影子是半透明地盖在它上面的：
  // 颜色取深一些的绢色（不是原来近乎黑的深褐），最浓的地方也只有三成多，落在绢上是一圈淡淡的暗，不是一块褐色的斑。
  const [c, g2] = canvas(256, 256);
  const sw = hx + STAND_OUT;
  const sd = hz + STAND_OUT;
  const pad = 2600;
  const fw = 2 * (sw + pad);
  const fd = 2 * (sd + pad);
  const img = g2.createImageData(256, 256);
  for (let j = 0; j < 256; j++) {
    for (let i = 0; i < 256; i++) {
      const x = (i / 255 - 0.5) * fw;
      const z = (j / 255 - 0.5) * fd;
      const dx = Math.max(Math.abs(x) - sw, 0);
      const dz = Math.max(Math.abs(z) - sd, 0);
      const d = Math.hypot(dx, dz);
      const a = Math.pow(Math.max(0, 1 - d / pad), 2.4) * 0.34;
      const k = (j * 256 + i) * 4;
      img.data[k] = 64;
      img.data[k + 1] = 46;
      img.data[k + 2] = 24;
      img.data[k + 3] = Math.round(a * 255);
    }
  }
  g2.putImageData(img, 0, 0);
  const st = new CanvasTexture(c);
  st.colorSpace = SRGBColorSpace;
  const sgeo = new PlaneGeometry(fw, fd);
  sgeo.rotateX(-Math.PI / 2);
  const shadow = new Mesh(sgeo, new MeshBasicMaterial({ map: st, transparent: true, depthWrite: false }));
  shadow.position.set(cx + 500, FLOOR_Y, cz + 420);
  shadow.renderOrder = -1;
  group.add(shadow);

  // 环境贴图是 view.ts 配的，也由它放掉；这里先摘下来，免得跟着材质被放掉两次
  return {
    group,
    wood,
    setDim(dim) {
      wood.envMapIntensity = WOOD_SHINE * dim;
    },
    dispose() {
      wood.envMap = null;
      disposeTree(group);
    },
  };
}
