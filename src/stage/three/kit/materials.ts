// 零件库的材质。颜色只从时代样式的 palette 里取；代码画的贴图只在这里做。
// 没有页面的地方（Node 里跑测试、数三角形）贴图不画，材质只有颜色，形状一点不差。
// 每种材质都补了“模型在显卡上变大变小”的那一段（figureMaterial.ts），共用一份数；画影子的材质也在这里，整套模型共用一份。

import * as THREE from 'three';
import type { StageStyle } from '../internal';
import { makeFigureDepth, makeFigureUniforms, patchFigure } from './figureMaterial';
import type { FigureUniforms } from './figureMaterial';
import { brickTexture, rammedTexture, stoneTexture, strawTexture, tileTexture, washTexture } from './textures';

/** 材质的名字。零件往批次里放东西时写的就是这些名字。 */
export const MATERIAL_NAMES = [
  /** 灰瓦 */
  'tile',
  /** 茅草顶 */
  'thatch',
  /** 白墙 */
  'plaster',
  /** 刷了黄土的墙 */
  'yellow',
  /** 上了红漆的木头：柱子、栏杆 */
  'vermilion',
  /** 深色的木头：额枋、门窗 */
  'timber',
  /** 不上漆的木头 */
  'plainTimber',
  /** 斗拱 */
  'bracket',
  /** 城砖 */
  'brick',
  /** 条石 */
  'stone',
  /** 新筑的土：堤、茅屋的土墙 */
  'earth',
  /** 墙脚到水边的旧土坡 */
  'bank',
  /** 夯土的城墙 */
  'rammed',
  /** 河里的青石 */
  'rock',
  /** 山冈上的白石头 */
  'rockPale',
] as const;
export type MatName = (typeof MATERIAL_NAMES)[number];

export interface KitMaterials {
  /** 并成一个网格的零件用的材质，按名字取。 */
  named: Record<MatName, THREE.MeshLambertMaterial>;
  /** 船（一条船一个实例）。 */
  boat: THREE.MeshLambertMaterial;
  /** 树（一棵树一个实例，颜色写在实例上）。 */
  tree: THREE.MeshLambertMaterial;
  /** 上面这些材质和画影子的材质共用的一份数：模型现在放大几倍、留几成、水面多高……总装时每一帧改它。 */
  figure: FigureUniforms;
  /** 画影子用的材质，补的是同一段。每个网格的 customDepthMaterial 都是它。 */
  depth: THREE.MeshDepthMaterial;
  /** 树的几种颜色。 */
  treeColours: TreeColours;
  /** 把材质和贴图都放掉。 */
  dispose(): void;
}

export interface TreeColours {
  tree: string;
  treeBlue: string;
  treeOlive: string;
  willow: string;
}

export function makeMaterials(style: StageStyle): KitMaterials {
  const colour = (name: string): string => {
    const v = style.palette[name];
    if (!v) throw new Error(`样式 ${style.id} 的颜色里没有 ${name}`);
    return v;
  };
  // 贴图要在页面上的 canvas 里画；没有页面就不画
  const canDraw = typeof document !== 'undefined';
  const textures: THREE.Texture[] = [];
  const draw = (make: () => THREE.Texture): THREE.Texture | null => {
    if (!canDraw) return null;
    const t = make();
    textures.push(t);
    return t;
  };
  const figure = makeFigureUniforms();
  const L = (color: string, map: THREE.Texture | null = null): THREE.MeshLambertMaterial => patchFigure(new THREE.MeshLambertMaterial({ vertexColors: true, color, map }), figure);

  const straw = draw(strawTexture);
  const named: Record<MatName, THREE.MeshLambertMaterial> = {
    tile: L(colour('tile'), draw(tileTexture)),
    thatch: L(colour('thatch'), straw),
    plaster: L(colour('plaster')),
    yellow: L(colour('earthYellow'), draw(washTexture)),
    vermilion: L(colour('vermilion')),
    timber: L(colour('timber')),
    // 不上漆的木头：样式里没有单给颜色，用船的木色
    plainTimber: L(colour('boat')),
    bracket: L(colour('shiluDeep')),
    brick: L(colour('brick'), draw(brickTexture)),
    stone: L(colour('stone'), draw(stoneTexture)),
    earth: L(colour('earth')),
    bank: L(colour('bankEarth')),
    rammed: L(colour('rammedEarth'), draw(rammedTexture)),
    rock: L(colour('rock')),
    rockPale: L(colour('rockPale')),
  };
  const boat = L(colour('boat'));
  const tree = L('#ffffff');

  // 树远了近了都是自己的颜色（前一半远看的一套另用淡一点的苔点色，现在只有一套，不换颜色）
  const treeColours: TreeColours = { tree: colour('tree'), treeBlue: colour('treeBlue'), treeOlive: colour('treeOlive'), willow: colour('willow') };

  const depth = makeFigureDepth(figure);

  return {
    named,
    boat,
    tree,
    figure,
    depth,
    treeColours,
    dispose() {
      for (const m of Object.values(named)) m.dispose();
      boat.dispose();
      tree.dispose();
      depth.dispose();
      for (const t of textures) t.dispose();
    },
  };
}
