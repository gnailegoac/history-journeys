// 小像：立在沙盘上的一个泥人，标出“这一天他在这里”。它是记号，不是当时的东西；比真人大得多。
// 现在只有全程沙盘摆它，所以跟着全程沙盘那一块程序下载（routeLevel.ts 把它转出去）；这个文件自己不碰路、不碰全程沙盘的东西，
// 以后站点沙盘也摆它的时候，挪到哪一块都行。
//
// 怎么做的：
//   一圈一圈转出来的形状（底座、袍子、头、高帽），合成一个网格，一批画完，二百五十来个三角形。绕着竖轴转一圈都一样，所以没有朝向，不用知道他往哪边走。
//   颜色写在顶点上，明暗也先算好乘进去（光从样式里白天的那盏灯的方向来）：材质不受灯照，不投影子，和路的线一样。
//   不比深浅（depthTest 关着），排在路的后面画（renderOrder 14，路是 10 到 13）：山挡不住他，他总站在画出来的线上面。
//   路的线是当成“透明的东西”画的（three 先画不透明的、再画透明的），所以这个材质也标成透明的，才排得到线的后面；不然线会画在他身上。
//   各段照从下到上的先后画、背着镜头的面不画：镜头总在地平线上面（最斜 80 度），这个先后就是对的。
//   大小在画面上不变：每一帧照折算过的远近（rig.ts 的 equivalentDistance）定，和虚线的一划一空是同一个办法。

import { BufferGeometry, Color, Float32BufferAttribute, Mesh, MeshBasicMaterial } from 'three';
import type { Vec3 } from '../ground/types';
import type { PieceStyle } from './internal';

/** 平着看时从脚到帽顶多少像素。斜着看矮一些：全程那一节（倾角 40 度）32 像素，凑近的几节（46 度）36 像素。 */
export const PIECE_PX = 49.9;
/** 折算过的远近是 1 米时，沙盘里的 1 米合多少像素（kit/figure.ts 里的那个数）。 */
const FOCAL_PX = 2428;
/** 背光的面留几成亮。 */
const SHADE = 0.7;

/** 一圈：[半径, 高]。模型从脚到帽顶高 1。 */
type Ring = [number, number];

/** 头：球心在 0.79、半径 0.09 的球，从下到上六圈（比脖子那一圈大出一截：画面上只有三十来像素高的时候，头和袍子分得开）。 */
const HEAD: Ring[] = [0, 1, 2, 3, 4, 5].map((i): Ring => [0.09 * Math.sin((i * Math.PI) / 5), 0.79 - 0.09 * Math.cos((i * Math.PI) / 5)]);

/** 各段：哪种颜色、一圈分几段、从下到上的几圈。 */
const PARTS: [keyof PieceStyle, number, Ring[]][] = [
  ['rim', 12, [[0.2, 0], [0.2, 0.06]]],
  ['base', 12, [[0.2, 0.06], [0.15, 0.06]]],
  ['robe', 12, [[0.15, 0.06], [0.13, 0.35], [0.09, 0.58], [0.1, 0.63], [0.04, 0.7]]],
  ['head', 8, HEAD],
  ['cap', 8, [[0.05, 0.87], [0.055, 1], [0, 1]]],
];

export interface Piece {
  mesh: Mesh;
  /** 照折算过的远近 D 定大小：在画面上总是那么高。 */
  size(viewDistanceM: number): void;
  dispose(): void;
}

/** 造一个小像。colours 是样式里的那几种颜色；light 是光从哪边来（从沙盘指向太阳，不用先归一）。先不显。 */
export function buildPiece(colours: PieceStyle, light: Vec3): Piece {
  const length = Math.hypot(...light) || 1;
  const position: number[] = [];
  const colour: number[] = [];
  const index: number[] = [];
  for (const [name, sides, rings] of PARTS) {
    const c = new Color(colours[name]);
    for (let i = 1; i < rings.length; i++) {
      const [r0, y0] = rings[i - 1];
      const [r1, y1] = rings[i];
      // 这一圈面朝外的方向（在“半径、高”的平面里）
      const slope = Math.hypot(r1 - r0, y1 - y0) || 1;
      const out = (y1 - y0) / slope;
      const up = (r0 - r1) / slope;
      const first = position.length / 3;
      for (let k = 0; k < sides; k++) {
        const turn = (k / sides) * Math.PI * 2;
        const x = Math.cos(turn);
        const z = Math.sin(turn);
        const lit = SHADE + (1 - SHADE) * Math.max(0, (out * x * light[0] + up * light[1] + out * z * light[2]) / length);
        position.push(r0 * x, y0, r0 * z, r1 * x, y1, r1 * z);
        colour.push(c.r * lit, c.g * lit, c.b * lit, c.r * lit, c.g * lit, c.b * lit);
        const a = first + k * 2;
        const b = first + ((k + 1) % sides) * 2;
        index.push(a, a + 1, b + 1, a, b + 1, b);
      }
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(position, 3));
  geometry.setAttribute('color', new Float32BufferAttribute(colour, 3));
  geometry.setIndex(index);
  const material = new MeshBasicMaterial({ vertexColors: true, transparent: true, depthTest: false, depthWrite: false });
  const mesh = new Mesh(geometry, material);
  mesh.renderOrder = 14;
  mesh.visible = false;
  return {
    mesh,
    size(viewDistanceM) {
      mesh.scale.setScalar((PIECE_PX * Math.max(1, viewDistanceM)) / FOCAL_PX);
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
