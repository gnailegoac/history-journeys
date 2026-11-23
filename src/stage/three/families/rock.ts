// 石和土这一家：崖壁（摆件 cliff），不闭合的矮土墙（earth-wall），单立的小门（small-gate），
// 只在水落时露出来的石头（点缀 rocks 的 type: shore）。
// 按家分块：场景里写到了这两样里的一样，造模型以前才下载这个文件（登记在 src/stage/families.ts，规矩见 ../kit/families.ts）。
// 只算形状，不碰页面。
//
// 崖壁是一个合起来的块，不是一面墙。地形板的网格 59 米一格，陡坎在它上面是一道斜坡：崖脚往山里 35 到 60 米的地方，
// 地形板比真的地面平均低 8 米、最多低 13 米多。只立一面墙，墙后面就是一道沟。所以崖顶从崖面的上沿一直铺到山里，
// 收进地形板下面，把那道斜坡盖住；后面和两头各有一道裙边。量的都是地形板（../meshHeight.ts），不是高程。

import * as THREE from 'three';
import type { SceneDressing, SceneThing } from '../../../domain/scene';
import type { Vec2, Vec3 } from '../../ground/types';
import type { KitContext } from '../internal';
import type { Rock } from '../kit/dressing';
import type { KitFamily } from '../kit/families';
import { FB, T, box, prism, segBox } from '../kit/geo';
import type { Batch } from '../kit/geo';
import { dressingParams, thingParams } from '../kit/params';
import { addRoof } from '../kit/parts';
import { facingRy, groundY, local } from '../kit/pass';
import type { Pass } from '../kit/pass';
import { densify, fbm, hex, lerp, mix3, mulberry32, smoothstep } from '../kit/util';
import { meshHeightAt } from '../meshHeight';
// 这一句只为打包：这一家的程序只在沙盘程序已经下载了以后才取。写了这一句，打包的工具就知道沙盘程序那一块一定在，
// 两边共用的东西（three 的核心、零件库的批次和小工具）留在那一块里直接用；不写的话，它们会被另拆成一块，
// 徐州这样一家也用不着的沙盘也要多下载一个文件、多五千来字节（量过；全程沙盘那一块也是这样写的）。
import '../engine';

// ---------------------------------------------------------------- 崖壁

/** 崖壁的尺寸。横向是米，带 Y 的是沙盘里的高度（已经乘了山高夸大的倍数）。 */
export const CLIFF = {
  /** 沿崖脚的线大约隔多远一列。 */
  stepM: 15,
  /** 哪一边是山：看线两边这么远处的地面。 */
  sideM: 45,
  /** 崖顶的边在崖脚往山里多远；它的高度取山里多远处的地面。 */
  crownInM: 14,
  crownFromM: 60,
  /** 离线的两头这么远以内，崖慢慢矮下去。 */
  taperM: 45,
  /** 崖顶铺到崖脚往山里多远；那里的顶点比地形板低多少；后面的裙边多深。 */
  backInM: 100,
  backUnderY: 3,
  skirtY: 15,
  /** 崖脚埋进地面多深。 */
  footUnderY: 12,
};

/** 崖面从崖脚到崖顶的边分四带，五道横线：各在崖高的几成、离崖脚的线往山里多远（米）、颜色、鼓出凹进多少（成）。 */
const FACE_ROWS: { at: number; inM: number; bulge: number }[] = [
  { at: 0, inM: 0, bulge: 1 },
  { at: 0.22, inM: 3, bulge: 1 },
  { at: 0.55, inM: 6.5, bulge: 0.8 },
  { at: 0.6, inM: 10.5, bulge: 0.5 },
  { at: 1, inM: CLIFF.crownInM, bulge: 0 },
];
/** 崖面鼓出凹进最多多少米。 */
const BULGE_M = 5;
/**
 * 崖面的法线往上抬多少（加上这么多倍的“朝上”再归一）：崖面是风化了的土石坡，不是刀切的墙，照着它的天光算多一些。
 * 崖面背着光（白天、夜里都是），亮不亮全看天光；不抬的话，夜里它是画面上最黑的一块，认不出是石头。
 */
export const FACE_LEAN = 1.2;

/** 崖壁的一列：沿线走了多远，崖脚在哪，山在哪一边，崖脚、崖顶的边、崖顶后沿各在哪。 */
export interface CliffColumn {
  u: number;
  x: number;
  z: number;
  /** 朝山里的方向（长度 1）。 */
  nx: number;
  nz: number;
  /** 这一列的崖是不是足高的（离线的两头都在 taperM 以外）。 */
  full: boolean;
  /** 崖脚的顶点、崖顶的边、崖顶的后沿（沙盘里的 x、y、z）。 */
  foot: Vec3;
  crown: Vec3;
  back: Vec3;
  /** 崖顶的边、后沿那里的海拔（米）：崖顶照这个高度上色。 */
  crownM: number;
  backM: number;
}

/** 崖脚的线（沙盘里的 x、z）摆出来的每一列。造崖壁和查崖壁（tests/stage/huangzhou-figures.test.ts）用的是同一份。 */
export function cliffColumns(ctx: KitContext, line: Vec2[]): CliffColumn[] {
  const { coords, samplers } = ctx;
  const mesh = meshHeightAt(samplers, coords);
  const pts = densify(line, CLIFF.stepM);
  const n = pts.length;
  // 每一点上线的方向（前后两点连起来），左手边的法线
  const normals = pts.map((_, i): Vec2 => {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(n - 1, i + 1)];
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    return [-(b[1] - a[1]) / l, (b[0] - a[0]) / l];
  });
  // 哪一边是山：整条线看一次（两边 45 米处的地面，高的那边）
  let lean = 0;
  pts.forEach(([x, z], i) => {
    const [nx, nz] = normals[i];
    lean += samplers.height(x + nx * CLIFF.sideM, z + nz * CLIFF.sideM) - samplers.height(x - nx * CLIFF.sideM, z - nz * CLIFF.sideM);
  });
  const side = lean >= 0 ? 1 : -1;
  let u = 0;
  const us = pts.map(([x, z], i) => (i === 0 ? 0 : (u += Math.hypot(x - pts[i - 1][0], z - pts[i - 1][1]))));
  const total = u;
  return pts.map(([x, z], i) => {
    const nx = normals[i][0] * side;
    const nz = normals[i][1] * side;
    const end = Math.min(us[i], total - us[i]);
    const k = smoothstep(0, CLIFF.taperM, end);
    const cx = x + nx * CLIFF.crownInM;
    const cz = z + nz * CLIFF.crownInM;
    // 崖顶的边：足高的地方取山里 60 米处的地面；两头矮下去，矮到比地形板高半米
    const low = mesh(cx, cz) + 0.5;
    const crownM = low + (Math.max(samplers.height(x + nx * CLIFF.crownFromM, z + nz * CLIFF.crownFromM), low) - low) * k;
    const bx = x + nx * CLIFF.backInM;
    const bz = z + nz * CLIFF.backInM;
    const backM = mesh(bx, bz);
    return {
      u: us[i],
      x,
      z,
      nx,
      nz,
      full: end >= CLIFF.taperM,
      foot: [x, coords.y(Math.min(samplers.height(x, z), mesh(x, z))) - CLIFF.footUnderY, z],
      crown: [cx, coords.y(crownM), cz],
      back: [bx, coords.y(backM) - CLIFF.backUnderY, bz],
      crownM,
      backM,
    };
  });
}

/** 样式里的一种颜色写成顶点上的数（线性的光，0 到 1）。 */
function vertexColour(rgb: Vec3): Vec3 {
  const c = new THREE.Color().setRGB(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255, THREE.SRGBColorSpace);
  return [c.r, c.g, c.b];
}

/**
 * 这座山在这个高度本来是什么颜色：样式里山上的分带（山脚赭石、山腰石绿），不带随机的那一层。
 * 崖顶照它上色，才和后面先画好的地面接得上。heightM 是海拔。
 */
function hillColour(ctx: KitContext, heightM: number, x: number, z: number): Vec3 {
  const { colours, bands } = ctx.style.ground;
  const r = heightM - ctx.samplers.lift(x, z) - ctx.ground.baseM;
  let col = mix3(hex(colours.tea), hex(colours.ochre), smoothstep(bands.foot[0], bands.foot[1], r) * 0.9);
  col = mix3(col, hex(colours.shilu), smoothstep(bands.green[0], bands.green[1], r));
  return col;
}

/** 一格一格铺出来的一张面：共用顶点，法线平滑，每个顶点自己的颜色。flip 是换一面朝外。 */
function sheet(rows: number, cols: number, at: (r: number, c: number) => { p: Vec3; colour: Vec3 }, flip: boolean): THREE.BufferGeometry {
  const pos: number[] = [];
  const col: number[] = [];
  const index: number[] = [];
  for (let r = 0; r <= rows; r++) {
    for (let c = 0; c <= cols; c++) {
      const v = at(r, c);
      pos.push(...v.p);
      col.push(...vertexColour(v.colour));
    }
  }
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const a = r * (cols + 1) + c;
      const b = a + 1;
      const d = a + cols + 1;
      const e = d + 1;
      if (flip) index.push(a, e, b, a, d, e);
      else index.push(a, b, e, a, e, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}

/** 崖壁。线是崖脚。不归类：不跟着镜头远近放大。 */
function buildCliff(pass: Pass, thing: SceneThing): void {
  const ctx = pass.ctx;
  const line = (thing.line ?? []).map((p) => local(pass, p));
  if (line.length < 2) return;
  const cols = cliffColumns(ctx, line);
  const last = cols.length - 1;
  const palette = ctx.style.palette;
  const rock = hex(palette.cliff);
  const deep = hex(palette.cliffDeep);
  const B = pass.bucket(thing.when).main;
  // 一张面铺出来朝哪边，看中间一列的顶点（两头的崖矮到半米，那里的法线靠不住）：朝外的那一面要对着河（崖面）、对着天（崖顶）
  const middle = last >> 1;
  const outward = (g: THREE.BufferGeometry, want: Vec3, i = middle): boolean => {
    const nrm = g.attributes.normal;
    return nrm.getX(i) * want[0] + nrm.getY(i) * want[1] + nrm.getZ(i) * want[2] >= 0;
  };

  /** 这一列的崖有几成高（两头矮下去的地方不到 1）。 */
  const tall = (c: CliffColumn): number => smoothstep(0, CLIFF.taperM, Math.min(c.u, cols[last].u - c.u));
  /**
   * 崖顶在这一列的颜色：崖顶的边、后沿各一个。两头矮下去的地方，崖顶的边顺着岸斜下来，照山的颜色上是浅色的几块平面，
   * 和岸对不上；那里掺进石头的颜色，看着是崖慢慢收进岸里。
   */
  const crownColours = cols.map((c) => mix3(rock, hillColour(ctx, c.crownM, c.crown[0], c.crown[2]), 0.25 + 0.75 * tall(c)));
  const backColours = cols.map((c) => hillColour(ctx, c.backM, c.back[0], c.back[2]));

  // 崖面：崖脚一带是湿的深色，往上是红褐色的石头，中间一道窄台（台口亮一些），最上面一带风化了，颜色接到崖顶。
  // 几带之间差得多一些，一列一列还有深浅（竖着的石缝）：夜里崖面只有天光，没有明暗，靠这些才看得出是一面石壁
  const facePoint = (r: number, ci: number): { p: Vec3; colour: Vec3 } => {
    const c = cols[ci];
    const row = FACE_ROWS[r];
    const bulge = (fbm(c.u / 60 + r * 3.1, r * 1.7, 2, 31) - 0.5) * 2 * BULGE_M * row.bulge * tall(c);
    const inM = row.inM - bulge;
    const y = c.foot[1] + (c.crown[1] - c.foot[1]) * row.at;
    const joint = 0.8 + 0.4 * fbm(c.u / 26, 3.3, 2, 5);
    const base: Vec3 = r === 0 ? [deep[0] * 0.78, deep[1] * 0.78, deep[2] * 0.78] : r === 1 ? deep : r === 4 ? mix3(rock, crownColours[ci], 0.45) : rock;
    const k = r === 2 ? joint * 0.9 : r === 3 ? joint * 1.15 : r === 4 ? 1 : joint;
    return { p: [c.x + c.nx * inM, y, c.z + c.nz * inM], colour: [base[0] * k, base[1] * k, base[2] * k] };
  };
  let face = sheet(FACE_ROWS.length - 1, last, facePoint, false);
  const mid = cols[middle];
  // 崖面看的是中间一列、中间一排的那个顶点
  if (!outward(face, [-mid.nx, 0.2, -mid.nz], 2 * (last + 1) + middle)) face = sheet(FACE_ROWS.length - 1, last, facePoint, true);
  // 法线往上抬（见 FACE_LEAN）
  const nrm = face.attributes.normal;
  for (let i = 0; i < nrm.count; i++) {
    const n: Vec3 = [nrm.getX(i), nrm.getY(i) + FACE_LEAN, nrm.getZ(i)];
    const l = Math.hypot(...n) || 1;
    nrm.setXYZ(i, n[0] / l, n[1] / l, n[2] / l);
  }
  B.add('cliff', face);

  // 崖顶：从崖顶的边到后沿，一列一格
  const topPoint = (r: number, ci: number): { p: Vec3; colour: Vec3 } => {
    const c = cols[ci];
    return r === 0 ? { p: c.crown, colour: crownColours[ci] } : { p: c.back, colour: backColours[ci] };
  };
  let top = sheet(1, last, topPoint, false);
  if (!outward(top, [0, 1, 0])) top = sheet(1, last, topPoint, true);
  B.add('cliff', top);

  // 后面的裙边和两头的封口：平的面，各自的法线
  const fb = new FB();
  const shade = (c: Vec3, k: number): Vec3 => {
    const v = vertexColour(c);
    return [v[0] * k, v[1] * k, v[2] * k];
  };
  for (let i = 0; i < last; i++) {
    const a = cols[i];
    const b = cols[i + 1];
    const ca = shade(backColours[i], 0.9);
    const cb = shade(backColours[i + 1], 0.9);
    fb.quad(a.back, b.back, [b.back[0], b.back[1] - CLIFF.skirtY, b.back[2]], [a.back[0], a.back[1] - CLIFF.skirtY, a.back[2]], [a.nx, 0, a.nz], null, [ca, cb, cb, ca]);
  }
  for (const [c, next] of [
    [cols[0], cols[1]],
    [cols[last], cols[last - 1]],
  ] as const) {
    const cc = shade(rock, 0.9);
    // 朝外：从挨着的那一列指向这一列（线从哪一头写起都一样）
    const l = Math.hypot(c.x - next.x, c.z - next.z) || 1;
    const out: Vec3 = [(c.x - next.x) / l, 0, (c.z - next.z) / l];
    fb.quad(c.foot, c.crown, c.back, [c.back[0], c.back[1] - CLIFF.skirtY, c.back[2]], out, null, [cc, cc, cc, cc]);
  }
  B.add('cliff', fb.geo());
}

// ---------------------------------------------------------------- 只在水落时露出来的石头

/**
 * 石头的三种颜色：样式里的颜色名。只用石头的颜色（红褐、灰褐、深褐）。《东坡志林》写的是“深浅红黄之色”，
 * 照着上过黄的和浅的：石头在画面上只有十来个像素，那两种看着像花瓣，所以去掉了。
 */
const SHORE_COLOURS = ['shoreRed', 'shoreBrown', 'shoreDark'];
/** 这种石头落在哪一带：地面比最低的水位高出这么多米以上，比平时的水位低这么多米以上。 */
export const SHORE_ABOVE_LOWEST_M = 0.2;
export const SHORE_UNDER_NORMAL_M = 1.5;

/**
 * 崖脚的石头，摆在一个点周围：只留落在那一带里的。水落的小节它们露着，平时和高水时在水下，所以不用写 when。
 * 扁的石头，脚埋在地面和地形板里低的那个下面 1（地形板在这一带有的地方比地面低，石头立在地面上会悬着）。
 */
function layShore(pass: Pass, rule: SceneDressing): Rock[] {
  if (!rule.at) return [];
  const p = dressingParams('rocks', rule.params);
  const { coords, samplers, scene, ground, style } = pass.ctx;
  const levels = scene.water.levels.values;
  const lowest = Math.min(...Object.values(levels));
  const normal = levels.normal ?? ground.baseM;
  const mesh = meshHeightAt(samplers, coords);
  const rnd = mulberry32(p.seed ?? 1092);
  const [bx, bz] = local(pass, rule.at);
  const radius = p.radiusM ?? 240;
  const want = Math.round(p.count ?? 20);
  const pale = vertexColour(hex(style.palette.rockPale));
  const rocks: Rock[] = [];
  for (let tries = 0; tries < want * 40 && rocks.length < want; tries++) {
    const a = rnd() * 6.28;
    const d = radius * Math.sqrt(rnd());
    const x = bx + Math.cos(a) * d;
    const z = bz + Math.sin(a) * d;
    const h = samplers.height(x, z);
    if (h < lowest + SHORE_ABOVE_LOWEST_M || h > normal - SHORE_UNDER_NORMAL_M) continue;
    // 石头的材质是浅色的那一种；四种颜色是在它上面再乘的
    const want3 = vertexColour(hex(style.palette[SHORE_COLOURS[Math.floor(rnd() * SHORE_COLOURS.length)]]));
    rocks.push({
      mat: 'rockPale',
      shape: [rocks.length + 200, 0],
      foot: [x, coords.y(Math.min(h, mesh(x, z))) - 1, z],
      ry: rnd() * 6.28,
      // 半宽、高、半深：宽 16 到 41 米、深 13 到 30 米的扁石头（原来小一半，在画面上只是几个点）
      size: [8 + rnd() * 12.5, 4.5 + rnd() * 3.5, 6.5 + rnd() * 8.5],
      tint: [want3[0] / pale[0], want3[1] / pale[1], want3[2] / pale[2]],
      detail: false,
    });
  }
  return rocks;
}

// ---------------------------------------------------------------- 不闭合的矮土墙，单立的小门

/** 矮土墙的尺寸：脚宽、顶宽（米），高（沙盘里的高度：真的一米八），大约多长一段，脚埋多深。 */
export const EARTH_WALL = { footM: 14, topM: 6, highY: 11, pieceM: 24, underY: 4 };

/** 沿线切出来的一段：两头在哪，是不是篱笆，几成高（0 是塌没了的一段）。 */
export interface WallPiece {
  a: Vec2;
  b: Vec2;
  fence: boolean;
  high: number;
}

/**
 * 一道矮土墙沿线切成的各段（线是沙盘里的 x、z）。ruined：每段三成半到全高，四段里缺一段上下（至少留一段）；
 * fence：中间三分之一是篱笆。造土墙和查土墙（tests/stage/huangzhou-figures.test.ts）用的是同一份。
 */
export function earthWallPieces(line: Vec2[], ruined: boolean, fence: boolean): WallPiece[] {
  const lens = line.slice(1).map((q, i) => Math.hypot(q[0] - line[i][0], q[1] - line[i][1]));
  const total = lens.reduce((sum, l) => sum + l, 0);
  const n = Math.max(1, Math.round(total / EARTH_WALL.pieceM));
  /** 沿线走到 d 米的那一点。 */
  const at = (d: number): Vec2 => {
    let i = 0;
    while (i < lens.length - 1 && d > lens[i]) d -= lens[i++];
    const t = lens[i] > 0 ? Math.min(1, d / lens[i]) : 0;
    return [lerp(line[i][0], line[i + 1][0], t), lerp(line[i][1], line[i + 1][1], t)];
  };
  const rnd = mulberry32(Math.round(Math.abs(line[0][0]) * 7 + Math.abs(line[0][1]) * 13) + 5);
  const out: WallPiece[] = [];
  for (let i = 0; i < n; i++) {
    const mid = (i + 0.5) / n;
    const gone = rnd() < 0.25;
    const part = 0.35 + 0.65 * rnd();
    const isFence = fence && mid > 1 / 3 && mid < 2 / 3;
    out.push({ a: at((i * total) / n), b: at(((i + 1) * total) / n), fence: isFence, high: isFence || !ruined ? 1 : gone ? 0 : part });
  }
  if (out.every((piece) => piece.high === 0)) out[0].high = 0.6;
  return out;
}

/** 一段篱笆：隔十来米一根木桩，桩和桩之间一片编起来的矮篱（和单座的屋四周的那种一样的尺寸）。小东西，算细处：远了收掉。 */
function fenceRun(pass: Pass, B: Batch, a: Vec2, b: Vec2): void {
  const n = Math.max(1, Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]) / 11));
  let prev: Vec3 | null = null;
  for (let i = 0; i <= n; i++) {
    const x = lerp(a[0], b[0], i / n);
    const z = lerp(a[1], b[1], i / n);
    const q: Vec3 = [x, groundY(pass, x, z) - 1, z];
    B.addDetail('plainTimber', box(1.7, 7.4, 1.7), T(q[0], q[1], q[2]));
    if (prev) {
      const from = prev;
      B.detail([(from[0] + q[0]) / 2, (from[1] + q[1]) / 2, (from[2] + q[2]) / 2], () => B.add('thatch', segBox([from[0], from[1] + 3.4, from[2]], [q[0], q[1] + 3.4, q[2]], 1, 5), null, [0.8, 0.7, 0.58]));
    }
    prev = q;
  }
}

/**
 * 不闭合的矮土墙：顺着线一段一段的夯土，每段落在自己脚下的地面上。它不是城墙：不围出一座城，不跟着镜头远近放大。
 */
function buildEarthWall(pass: Pass, thing: SceneThing): void {
  const p = thingParams('earth-wall', thing.params);
  const line = (thing.line ?? []).map((q) => local(pass, q));
  if (line.length < 2) return;
  const B = pass.bucket(thing.when).main;
  const W = EARTH_WALL;
  for (const { a, b, fence, high } of earthWallPieces(line, p.ruined ?? false, p.fence ?? false)) {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 0.5) continue;
    if (fence) {
      fenceRun(pass, B, a, b);
      continue;
    }
    if (high <= 0) continue;
    const mx = (a[0] + b[0]) / 2;
    const mz = (a[1] + b[1]) / 2;
    const mid = groundY(pass, mx, mz);
    // 脚埋到两头和中间最低的地面以下，顶比中间的地面高出这一段的高度
    const base = Math.min(groundY(pass, a[0], a[1]), mid, groundY(pass, b[0], b[1])) - W.underY;
    const top = mid + W.highY * high * (p.low ? 0.5 : 1);
    const sec: Vec2[] = [
      [W.footM / 2, base],
      [W.topM / 2, top],
      [-W.topM / 2, top],
      [-W.footM / 2, base],
    ];
    const shade = (y: number): number => lerp(0.84, 1, smoothstep(base, top, y));
    // 塌了的各段之间留一道口子，整的墙各段接上
    B.add('rammed', prism(sec, len + (p.ruined ? -3 : 1), { shade, topShade: 1.08, uvScale: 30 }), T(mx, 0, mz, Math.atan2(-(b[1] - a[1]), b[0] - a[0])));
  }
}

/** 单立的小门的尺寸：门墩宽、高、深，两个门墩之间的口子多宽。 */
export const SMALL_GATE = { pierW: 9, pierH: 16, pierD: 9, gapM: 14 };

/** 单立的一座小门：两个夯土的门墩，上面一根木过梁、一个小瓦顶。facing 是门朝哪边，路从两个门墩之间过。不靠城墙，不放大。 */
function buildSmallGate(pass: Pass, thing: SceneThing): void {
  if (!thing.at) return;
  const B = pass.bucket(thing.when).main;
  const [x, z] = local(pass, thing.at);
  const G = SMALL_GATE;
  const M = T(x, groundY(pass, x, z) - 2, z, facingRy(thing.facing));
  const across = G.gapM + 2 * G.pierW;
  for (const side of [-1, 1]) B.add('rammed', box(G.pierW, G.pierH + 2, G.pierD), M.clone().multiply(T((side * (G.gapM + G.pierW)) / 2, 0, 0)));
  B.add('plainTimber', box(across + 4, 2.2, 5), M.clone().multiply(T(0, G.pierH + 2, 0)));
  addRoof(B, M.clone().multiply(T(0, G.pierH + 4.2, 0)), { W: across + 10, D: 15, H: 5, ts: 0, nu: 2, nt: 2, fascia: 0 }, { gableMat: 'rammed' });
}

export const family: KitFamily = {
  things: { cliff: buildCliff, 'earth-wall': buildEarthWall, 'small-gate': buildSmallGate },
  rocks: { shore: layShore },
  materials: ['cliff'],
};
