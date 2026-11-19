// 模型在显卡上变大变小：往零件库的材质里补一小段顶点着色器。整套模型只造一遍（近看的样子、本来的大小和位置），
// 镜头远了近了，只改这里的十几个数，每个顶点自己算出它现在该画在哪：
//   绕着自己的脚放大（按“它是哪一类”取倍数）；一群东西从共同的那一点摊开；排在后面的缩成一个点（留几成）；
//   细处先矮下去、再收成一个点；立在城墙上的跟着墙一起拔高；站在水会漫到的地方的，绕着水面那一条线放大；
//   站在水会漫到的地方的细处（篱笆、院墙），水漫过它的脚就收掉；
//   树的脚下水深了就缩没；镜头贴近时细做的树和苔点此消彼长。
// 画进画面的材质和画影子的材质补的是同一段，所以影子跟着模型一起变；不用为了放大把一样东西拆成单独的网格，画的批数不变。
// 这里不碰页面，在 Node 里也能跑（只是没有显卡，着色器不会真的编译）。同一套算术在下面用 TypeScript 又写了一遍
// （figureMove、figureShow），测试靠它在没有显卡的机器上查“每个顶点现在在哪”：两处要一起改。
//
// 顶点上要带的三样（并网格的时候写进去，和 position 在同一套坐标里；成批摆的船和树是一个实例带一份）：
//   aPivot  vec3  这样东西的脚：绕着这一点放大
//   aGroup  vec3  这一群东西共同的那一点：脚从这一点往外摊开。单独的一样东西写它自己的脚
//   aFig    vec4  x 哪一类（FIGURE_SLOT 里的号，0 是不归类）；y 次序（0 到 1，小的留到最后）；
//                 z 哪一种（FIG_PLAIN、FIG_DETAIL、三种树）；w 平常是两个开关（FIG_ON_WALL、FIG_WET 相加），树是“水面到多高它开始缩”
// 用了补过的材质的网格都要带这三样。不带的话 three 不给它们接数据，按 WebGL 的规矩读到的是 (0,0,0) 和 (0,0,0,1)：
// 0 号、倍数 1，但 w 是 1（会被当成“立在城墙上”），所以不要靠它。
//
// 在徐州的沙盘上试过一次最简单的情形（只把放鹤亭定成 3 倍，那时这一段只有“绕着脚放大”一句）：
// 和直接把形状造成 3 倍大拍出来的画面只差两个像素，影子一样；倍数在画面摆着的时候改，下一帧就管用；
// 倍数是 1 时和没补的画面一个像素不差；画的批数不变。后来加的这些（摊开、留几成、细处、水面、成批摆的船和树）
// 在整座沙盘的图片上看过：近看的一节（水退以后）和没有这一段时一个像素不差。
//
// three 0.187 里要知道的几件事（都对着 node_modules/three/src 看过，换了版本要重看）：
//   · Lambert 和画影子用的 depth 两种顶点着色器里都有 <common> 和 <begin_vertex>：前一处后面加声明，后一处后面改 transformed。
//     画进画面时，改过的 transformed 接着流进 project_vertex、worldpos_vertex、shadowmap_vertex，
//     所以它身上接到的影子也按变过以后的位置查；画影子时改的是同一处，它投出去的影子就是变过以后的样子。
//     改 transformed 是在实例的矩阵和网格自己的矩阵之前：脚要写在和 position 同一套坐标里
//     （成批摆的就是实例自己的坐标；整段算术只是几个点按比例相加，隔着实例的矩阵算出来是一样的）。
//   · 细处矮下去不是各个方向一样的缩，法线要跟着改，不然斜面（小屋的顶）的明暗不对：Lambert 里在 <beginnormal_vertex> 后面改
//     objectNormal。画影子的着色器不用法线。
//   · customProgramCacheKey 要自己写。three 按“着色器的记号”共用编译好的程序（WebGLPrograms.js 的 getProgramCacheKey），
//     补丁改了着色器，就得在记号里说出来。不写时 three 拿 onBeforeCompile 的源码当记号：
//     源码一样、只是外面带进来的数不一样的两个补丁会撞在一起，后来的那个拿到前一个的程序。
//     onBeforeCompile 是每种材质各叫一次（程序可以共用，那几个数却要一种材质一种材质地接上），所以接数的那几句不能省。
//   · 画影子：网格上有 customDepthMaterial 时 three 直接用它（WebGLShadowMap.js 的 getDepthMaterial），
//     而且每画一个网格都把那个网格的材质的 side、map、alphaTest 这些抄到它身上——three 自己共用的那一份也是这样。
//     所以整套模型用一份就够；它要用 MeshDepthMaterial 的默认设置（影子贴图现在是深度贴图，不要另设 depthPacking）。
//     成批摆的网格和并出来的网格用的是同一份：three 按网格是不是成批摆的各编一个程序。

import { MeshDepthMaterial, Vector2 } from 'three';
import type { IUniform, Material } from 'three';
import type { Vec3 } from '../../ground/types';
import type { FigureClass, StageStyle } from '../internal';
import { closeTrees, detailGone, figureNow } from './figure';
import { smoothstep } from './util';

/** 每一类在着色器的那几排数里排第几。0 号不给哪一类：没有归类的东西读到的就是它，永远是 1 倍、全留、不摊开。 */
export const FIGURE_SLOT: Record<FigureClass, number> = {
  wallH: 1,
  tower: 2,
  wallTop: 3,
  yardCity: 4,
  yardOut: 5,
  cityHouse: 6,
  village: 7,
  boat: 8,
  smallBoat: 9,
  rock: 10,
  tree: 11,
  hut: 12,
  shed: 13,
  pavilion: 14,
};

/** 那几排数各多少个：十四类，加上 0 号。 */
export const FIGURE_SLOTS = 15;

const FIGURE_CLASSES = Object.keys(FIGURE_SLOT) as FigureClass[];

/** aFig.z：这一份顶点是哪一种。 */
export const FIG_PLAIN = 0;
/** 细处：远了先矮下去，再收成一个点（绕着它自己的脚）。 */
export const FIG_DETAIL = 1;
/** 树：水深了缩没。 */
export const FIG_TREE = 2;
/** 镜头贴近时要让给细做的树的那几粒苔点。 */
export const FIG_TREE_DOT = 3;
/** 镜头贴近时才长出来的那几棵细做的树。 */
export const FIG_TREE_FINE = 4;

/** aFig.w 里的两个开关（相加）。树不用开关，那一格写的是水面的高度。 */
export const FIG_ON_WALL = 1;
export const FIG_WET = 2;

/**
 * 次序排到“留几成”那条线以后的东西不是一下子没有的：从线上起缩小，到线的 1 ÷ 0.85 倍那里缩成一个点。
 * 所以“留几成”说的是原样留着的有几成；全留（1）的时候一样也不缩。
 */
export const KEEP_FRINGE = 0.85;

/** 细处收到几成以前只是矮下去，平面不动（围墙的四个角一直是合着的）；过了这里，剩下的那一片才收成一个点。 */
const DETAIL_SHRINK_FROM = 0.6;

/** 所有补过的材质共用的一份数。改这里的数，下一帧画进画面的和画影子的都跟着变，不用重新编译。 */
export interface FigureUniforms {
  /** 每一类现在放大几倍、留几成、摊开几倍，按 FIGURE_SLOT 的号排。0 号要一直是 1。 */
  uFigTimes: IUniform<Float32Array>;
  uFigKeep: IUniform<Float32Array>;
  uFigSpread: IUniform<Float32Array>;
  /** 细处现在的样子：x 是高还剩几成，y 是平面还剩几成。 */
  uFigDetail: IUniform<Vector2>;
  /** 水：x 是现在的水面在沙盘里多高，y 是一米深的水合沙盘里多高。 */
  uFigWater: IUniform<Vector2>;
  /** 细做的树现在占几成（1 是全在，0 是都换回了苔点）。 */
  uFigClose: IUniform<number>;
}

/** 一份“什么都不变”的数：补上以后和没补一样。 */
export function makeFigureUniforms(): FigureUniforms {
  return {
    uFigTimes: { value: new Float32Array(FIGURE_SLOTS).fill(1) },
    uFigKeep: { value: new Float32Array(FIGURE_SLOTS).fill(1) },
    uFigSpread: { value: new Float32Array(FIGURE_SLOTS).fill(1) },
    uFigDetail: { value: new Vector2(1, 1) },
    uFigWater: { value: new Vector2(-1e6, 1) },
    uFigClose: { value: 1 },
  };
}

/**
 * 按现在的远近和水位把那一份数写好。D 是折算过的远近；waterY 是水面在沙盘里的高度；metreY 是一米深的水合沙盘里多高。
 * 每一类的倍数、留几成、摊开几倍，细处收了多少，细做的树还剩多少，都从 figure.ts 取（镜头那一边取的也是它）。
 */
export function setFigure(uniforms: FigureUniforms, style: StageStyle, D: number, waterY: number, metreY: number): void {
  // 远近不是个正常的数（画面还没有大小的那一帧）时当作贴在跟前：什么都不变，不把坏数交给显卡
  if (!(D > 0) || !Number.isFinite(D)) D = 1;
  for (const cls of FIGURE_CLASSES) {
    const now = figureNow(style.figure.rules[cls], D);
    const slot = FIGURE_SLOT[cls];
    uniforms.uFigTimes.value[slot] = now.times;
    uniforms.uFigKeep.value[slot] = now.keep;
    uniforms.uFigSpread.value[slot] = now.spread;
  }
  const gone = detailGone(style, D);
  uniforms.uFigDetail.value.set(1 - gone, 1 - smoothstep(DETAIL_SHRINK_FROM, 1, gone));
  uniforms.uFigWater.value.set(waterY, Math.max(metreY, 1e-3));
  uniforms.uFigClose.value = closeTrees(style, D);
}

// ---------------------------------------------------------------- 着色器里的那一段

const DECLARE = /* glsl */ `
attribute vec3 aPivot;
attribute vec3 aGroup;
attribute vec4 aFig;
uniform float uFigTimes[${FIGURE_SLOTS}];
uniform float uFigKeep[${FIGURE_SLOTS}];
uniform float uFigSpread[${FIGURE_SLOTS}];
uniform vec2 uFigDetail;
uniform vec2 uFigWater;
uniform float uFigClose;
`;

// 细处矮下去以后斜面变平，法线跟着往上转（高缩成 a、平面缩成 b 时，法线的横向乘 a、竖向乘 b）。
// 加的那一点点是防着两个数都到了 0：那时这个面已经缩没了，给它一条朝上的法线，不出坏数。
const NORMAL = /* glsl */ `
if ( aFig.z > 0.5 && aFig.z < 1.5 ) {
	objectNormal = normalize( vec3( objectNormal.x * uFigDetail.x, objectNormal.y * uFigDetail.y, objectNormal.z * uFigDetail.x ) + vec3( 0.0, 0.00001, 0.0 ) );
}
`;

// 号是写在顶点上的小数，先夹在这一排数的范围里再取整，写错了号也不会读到别处去。
// 下面每一句在 figureShow、figureMove 里都有一句一样的。
const MOVE = /* glsl */ `
int figSlot = int( clamp( aFig.x, 0.0, ${FIGURE_SLOTS - 1}.0 ) + 0.5 );
float figKeep = max( uFigKeep[ figSlot ], 0.0001 );
float figShow = 1.0 - smoothstep( figKeep, figKeep / ${KEEP_FRINGE}, aFig.y );
vec3 figOff = transformed - aPivot;
vec3 figAt = aGroup + ( aPivot - aGroup ) * uFigSpread[ figSlot ];
if ( aFig.z > 1.5 ) {
	figShow *= 1.0 - smoothstep( aFig.w, aFig.w + uFigWater.y, uFigWater.x );
	if ( aFig.z > 3.5 ) figShow *= uFigClose;
	else if ( aFig.z > 2.5 ) figShow *= 1.0 - uFigClose;
} else {
	if ( aFig.z > 0.5 ) {
		figOff.y *= uFigDetail.x;
		figOff.xz *= uFigDetail.y;
		if ( aFig.w > 1.5 ) figShow *= 1.0 - smoothstep( figAt.y - 0.5 * uFigWater.y, figAt.y + 0.5 * uFigWater.y, uFigWater.x );
	}
	if ( aFig.w > 1.5 ) {
		float figUp = max( uFigWater.x - aPivot.y, 0.0 );
		figOff.y -= figUp;
		figAt.y += figUp;
	}
	if ( mod( aFig.w, 2.0 ) > 0.5 ) figAt.y *= uFigTimes[ ${FIGURE_SLOT.wallH} ];
}
transformed = figAt + figOff * ( uFigTimes[ figSlot ] * figShow );
`;

/** 补丁的记号。补的这一段一改（或者那几排数的个数一改）就要换，不然会拿到旧的程序。 */
const FIGURE_KEY = `figure:4:${FIGURE_SLOTS}`;

/**
 * 把 three 的一段顶点着色器补上这一段。lit 是画进画面的（要改法线），不写或 false 是画影子的。
 * 落脚的地方要是找不到（three 换了版本），当场报错，不悄悄地不变。
 */
export function figureVertex(source: string, lit = false): string {
  const anchors = ['#include <common>', '#include <begin_vertex>'];
  if (lit) anchors.push('#include <beginnormal_vertex>');
  for (const anchor of anchors) {
    if (!source.includes(anchor)) throw new Error(`顶点着色器里没有 ${anchor}，模型变大变小的那一段补不进去`);
  }
  let out = source.replace('#include <common>', '#include <common>\n' + DECLARE).replace('#include <begin_vertex>', '#include <begin_vertex>\n' + MOVE);
  if (lit) out = out.replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\n' + NORMAL);
  return out;
}

/** 给一种材质补上这一段。uniforms 是大家共用的那一份。返回的还是这种材质。 */
export function patchFigure<M extends Material>(material: M, uniforms: FigureUniforms): M {
  const lit = (material as { isMeshDepthMaterial?: boolean }).isMeshDepthMaterial !== true;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uFigTimes = uniforms.uFigTimes;
    shader.uniforms.uFigKeep = uniforms.uFigKeep;
    shader.uniforms.uFigSpread = uniforms.uFigSpread;
    shader.uniforms.uFigDetail = uniforms.uFigDetail;
    shader.uniforms.uFigWater = uniforms.uFigWater;
    shader.uniforms.uFigClose = uniforms.uFigClose;
    shader.vertexShader = figureVertex(shader.vertexShader, lit);
  };
  material.customProgramCacheKey = () => `${FIGURE_KEY}:${lit ? 'lit' : 'depth'}`;
  return material;
}

/** 画影子用的材质，补的是同一段。整套模型共用一份，挂在每个网格的 customDepthMaterial 上；用完要 dispose。 */
export function makeFigureDepth(uniforms: FigureUniforms): MeshDepthMaterial {
  return patchFigure(new MeshDepthMaterial(), uniforms);
}

// ---------------------------------------------------------------- 同一套算术，在这里再写一遍（测试用）

/** 一个顶点（或一个实例）带的三样。 */
export interface FigureMarks {
  pivot: Vec3;
  group: Vec3;
  fig: [number, number, number, number];
}

const slotOf = (fig: FigureMarks['fig']): number => Math.floor(Math.min(Math.max(fig[0], 0), FIGURE_SLOTS - 1) + 0.5);

/**
 * 带着这三样的东西现在画出来是本来的几成大（不算它那一类的倍数）：1 是原样，0 是缩没了。
 * 和着色器里的 figShow 一样，只差一处：站在水里的细处被水漫过脚要收掉，那一处要知道脚在哪，算在 figureMove 里（drowned）。
 */
export function figureShow(fig: FigureMarks['fig'], uniforms: FigureUniforms): number {
  const keep = Math.max(uniforms.uFigKeep.value[slotOf(fig)], 0.0001);
  let show = 1 - smoothstep(keep, keep / KEEP_FRINGE, fig[1]);
  if (fig[2] > 1.5) {
    const water = uniforms.uFigWater.value;
    show *= 1 - smoothstep(fig[3], fig[3] + water.y, water.x);
    if (fig[2] > 3.5) show *= uniforms.uFigClose.value;
    else if (fig[2] > 2.5) show *= 1 - uniforms.uFigClose.value;
  }
  return show;
}

/**
 * 带着这三样的一个顶点 p 现在画在哪（还在 position 那一套坐标里，没有乘实例和网格的矩阵）。
 * 和着色器里 MOVE 那一段是同一套算术，一句对一句。
 */
export function figureMove(p: Vec3, marks: FigureMarks, uniforms: FigureUniforms): Vec3 {
  const { pivot, group, fig } = marks;
  const slot = slotOf(fig);
  const show = figureShow(fig, uniforms);
  const off: Vec3 = [p[0] - pivot[0], p[1] - pivot[1], p[2] - pivot[2]];
  const spread = uniforms.uFigSpread.value[slot];
  const at: Vec3 = [group[0] + (pivot[0] - group[0]) * spread, group[1] + (pivot[1] - group[1]) * spread, group[2] + (pivot[2] - group[2]) * spread];
  let left = 1;
  if (!(fig[2] > 1.5)) {
    if (fig[2] > 0.5) {
      const detail = uniforms.uFigDetail.value;
      off[1] *= detail.x;
      off[0] *= detail.y;
      off[2] *= detail.y;
      left = 1 - drowned(marks, uniforms);
    }
    if (fig[3] > 1.5) {
      const up = Math.max(uniforms.uFigWater.value.x - pivot[1], 0);
      off[1] -= up;
      at[1] += up;
    }
    if (fig[3] % 2 > 0.5) at[1] *= uniforms.uFigTimes.value[FIGURE_SLOT.wallH];
  }
  const k = uniforms.uFigTimes.value[slot] * show * left;
  return [at[0] + off[0] * k, at[1] + off[1] * k, at[2] + off[2] * k];
}

/**
 * 站在水会漫到的地方的一处细处（篱笆的一根桩、一段院墙）被水收掉了几成：水面离它的脚（摊开以后的）还差半米深的水那么多就开始收，
 * 没过它的脚半米就收完了。别的东西都是 0。和着色器里细处那一句一样。
 * 院落放大以后比它站的土丘还大，四角的院墙伸到水面上；篱笆整个没在水里：这些不该浮在水面上留一圈白线。
 */
export function drowned(marks: FigureMarks, uniforms: FigureUniforms): number {
  const { pivot, group, fig } = marks;
  if (!(fig[2] > 0.5 && fig[2] < 1.5) || !(fig[3] > 1.5)) return 0;
  const footY = group[1] + (pivot[1] - group[1]) * uniforms.uFigSpread.value[slotOf(fig)];
  const water = uniforms.uFigWater.value;
  return smoothstep(footY - 0.5 * water.y, footY + 0.5 * water.y, water.x);
}
