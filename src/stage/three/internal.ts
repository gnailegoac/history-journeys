// 沙盘程序（src/stage/three/）里面几块之间的约定：画质、灯、时代样式、零件库。页面不看这里。
// 这个文件是几个人共用的接缝，要改先找负责人。
//
// 前一半的三样将就（远近两套模型、按镜头换的灯、只有一档的画质）在第 1 步的后一半都换掉了：
// 模型只有一套，跟着远近在显卡上变（FigureStyle）；一种样式一盏灯（StageStyle.light）；画质两档（Quality）。

import type { Group, WebGLRenderer } from 'three';
import type { SceneMoon, SceneSky, StopScene, ThingKind } from '../../domain/scene';
import type { FrameCoords } from '../../domain/sceneGeo';
import type { BlankEdge } from '../ground/route';
import type { Ground, GroundSamplers, GroundStyle, Vec3 } from '../ground/types';
import type { StageTier } from '../types';
import type { KitFamily } from './kit/families';

/** 画质。所有和画质有关的数都从这里读，不散在各处。两档各一份，在 src/stage/three/quality.ts。 */
export interface Quality {
  /** 哪一档（给读数和测试看）。 */
  tier: StageTier;
  /** 像素比最多到几。 */
  pixelRatioCap: number;
  /** 画布最多多少个像素（宽 × 高 × 像素比的平方）；超了就把像素比往下调，最低到 1。 */
  maxDrawPixels: number;
  /** 开不开抗锯齿。 */
  antialias: boolean;
  /** 影子贴图的边长，像素。 */
  shadowMapSize: number;
  /** 树留几成：1 是全留。按规则留，每条规则至少留一棵。 */
  treeKeep: number;
  /** 成片的民居留几成：1 是全留。用自己的一串随机数，不动屋子摆在哪，也不动“远看留哪几座”。 */
  houseKeep: number;
  /** 雾画几层。 */
  mistLayers: number;
}

/** 一盏太阳光（夜里是月光）加一份天光。一种样式白天只有一盏，夜里一套，不看镜头。影子的虚实和偏移不在这里：由 rig.ts 的 shadowTuning 按影子罩多大一块来定。 */
export interface LightSpec {
  /** 光从哪边来：从沙盘指向太阳的方向，[x, y, z]，不用先归一。 */
  dir: Vec3;
  /** 太阳光的强度和颜色（'#rrggbb'）。 */
  sun: number;
  sunColor: string;
  /** 天光的强度，天的颜色和地的颜色（'#rrggbb'）。 */
  hemi: number;
  sky: string;
  ground: string;
  /**
   * 下面四样夜里才写。fog、mist：远处的雾、山脚的云气各是什么颜色（照足了光时的颜色，用的时候再按光的强弱压暗，见 rig.ts 的 lightDim）；
   * mistStrength：云气淡到几成；sheen：月光直接照到的水面多亮出几倍（已经按月亮的高矮算好，见 rig.ts 的 sheenFor）。
   */
  fog?: string;
  mist?: string;
  mistStrength?: number;
  sheen?: number;
}

/**
 * 模型按“折算过的远近”连续变化时分的类。折算过的远近 D：同样的“一米多少像素”，
 * 在 900 像素高、视角 21 度的画面上要离多远（rig.ts 的 equivalentDistance）。手机的画面小，D 就大。
 */
export type FigureClass =
  | 'wallH' // 城墙、城门的高（只拉竖向）
  | 'tower' // 城门楼、黄楼、立在地上的楼
  | 'wallTop' // 墙顶上的角楼、亭
  | 'yardCity' // 城里的一组院落
  | 'yardOut' // 城外的一组院落
  | 'cityHouse' // 沿巷子排的民居
  | 'village' // 村子里的屋
  | 'boat' // 货船
  | 'smallBoat' // 小船
  | 'rock' // 河里、山上的石头
  | 'tree' // 苔点一样的树
  | 'hut' // 地上单座的屋（连同它旁边的篱笆、果树、小屋）
  | 'shed' // 墙顶上单座的屋
  | 'pavilion'; // 地上的亭（连同亭下的小屋）

export interface FigureRule {
  /** D 到这么远以前是本来的大小；从这里起，它在画面上不再变小。 */
  holdFromM: number;
  /** 最多放大到几倍；到了头，再远就又跟着变小。 */
  maxTimes: number;
  /** 放大到头时留几成（按每样东西自己的次序去掉）。不写是 1：一样不去。有依据说了数目、分组的东西必须是 1。 */
  keepAtMax?: number;
  /** 放大到头时，一群东西从它们共同的那一点摊开几倍。不写是 1。 */
  spreadAtMax?: number;
}

export interface FigureStyle {
  rules: Record<FigureClass, FigureRule>;
  /** 细处（垛口、墙里侧的矮墙、压顶、门缝、门券、长廊、院墙、篱笆、屋后的小屋）从多远起收掉、到多远收完：[近, 远]，D。 */
  detailFadeM: [number, number];
  /** 贴近了看时细做的树，从多远起换回苔点、到多远换完：[近, 远]，D。 */
  closeTreesM: [number, number];
}

/**
 * 一种时代样式里，全程沙盘自己的那一份（站点沙盘不看）。都是沙盘程序用的。
 * 全程沙盘的地面不在页面上现画：给地面上色用的数（河画多宽、地面的几种颜色、山上的分带）不在这里，在做图的工具里，
 * 一种样式一个画法（tests/tools/route/painters.ts）——那些数不随沙盘程序发给读者。数都是定稿的样张（spikes/art-direction/route/）的。
 */
export interface RouteStyle {
  /** 地形板的网格多少米一格（沙盘里的米）。 */
  segmentM: number;
  /** 减配的一档，网格的格子放大几倍。 */
  reducedSegmentTimes: number;
  /** 海和湖上相邻两道水纹隔多少个页面像素。 */
  ripplePx: number;
  /** 留白（路没到的地方）的边怎么收：抹开多宽，打不打散、怎么打散。造地面的时候交给它（src/stage/ground/route.ts 的 buildRouteGround）。 */
  blank: BlankEdge;
  /**
   * 路画成什么线（沙盘程序用，src/stage/three/routeKit.ts）。宽度都是页面上的像素，镜头远近都一样宽。
   * lines 是三种路：ink 墨线（全程那一节的每一趟），now 刚走的（到这一站来的），past 走过的（到前面各站去的）。
   * halo 是垫在笔画下面的浅色线，haloUnder 是哪几种路下面垫它（走过的路不垫：垫了读成一条白线）。dashPx 是虚线一划多长、一空多长。reducedExtraPx：减配的一档没有抗锯齿，线加粗这么多。
   * liftM：线比地面（海上是海面）抬高多少，沙盘里的米。
   */
  roads: {
    lines: Record<'ink' | 'now' | 'past', RouteLineStyle>;
    halo: RouteLineStyle;
    haloUnder: readonly ('ink' | 'now' | 'past')[];
    dashPx: [number, number];
    reducedExtraPx: number;
    liftM: number;
  };
}

/** 一种线：颜色（'#rrggbb'）、透明度、多宽（页面上的像素）。 */
export interface RouteLineStyle {
  colour: string;
  opacity: number;
  widthPx: number;
}

/** 小像（沙盘上标出人物在哪的那个泥人）各段的颜色，'#rrggbb'：底座的面、底座的边、袍子、头、帽子。 */
export interface PieceStyle {
  base: string;
  rim: string;
  robe: string;
  head: string;
  cap: string;
}

/** 造出来的装裱和座子（沙盘四周的一圈边和底下的座）。 */
export interface Stand {
  group: Group;
  /**
   * 给要环境反光的材质配上反光：摆进沙盘的时候叫一次，用这座沙盘的渲染器。返回的函数放掉配反光时造的东西（收场时叫）。
   * 哪种材质要反光、要什么样的，是样式的事；不要反光的样式什么也不做，返回一个空函数。
   */
  reflect(renderer: WebGLRenderer): () => void;
  /** 反光压暗到几成（1 是白天）：反光来自环境贴图，灯暗了它不会跟着暗。 */
  setDim(dim: number): void;
  dispose(): void;
}

/** 一种样式的装裱和座子：长什么样、怎么造都在样式自己的那一块程序里，沙盘程序只知道这三样。 */
export interface StandStyle {
  /**
   * 座子最宽的那一圈比沙盘的边多出多少米。“整块沙盘都要看得见”是连装裱和座子一起算的（rig.ts 的 framePoints），
   * 影子最大罩多大一块也用它（rig.ts 的 shadowBox）。
   */
  reachM: number;
  /** 那一圈的下沿在沙盘里多高（沙盘里的米）。 */
  reachY: number;
  /** 照沙盘的范围造出来；颜色从样式的 palette 里取。 */
  build(coords: FrameCoords, palette: Record<string, string>): Stand;
}

/**
 * 一种时代样式里每一座沙盘都用的那一半：灯、雾、云气的浓淡、装裱和座子，全程沙盘的那一份和小像，和哪一层的沙盘都要的几种颜色。
 * 全程沙盘只取这一半（它不摆小模型，不现画地面）；站点沙盘取整套（StageStyle）。
 */
export interface TableStyle {
  /** 样式的名字：登记表（src/stage/styles.ts）里它那一行的 id，场景文件的 style 写的就是它。 */
  id: string;
  /**
   * 颜色，名字到 '#rrggbb'。名字照样张 config.js 里的 PAL，一个不改；
   * 样张里没有的夯土色（城墙）叫 rammedEarth。零件库的材质只从这里取颜色。
   * 只取了一半的样式里只有哪一层都要的几种（水纹、云气、雾、地形板的侧面、装裱和座子的）；整套里是全部。
   */
  palette: Record<string, string>;
  /** 这种样式的灯。只看天色（夜里再看月亮在哪），不看镜头。 */
  light(sky: SceneSky, moon?: SceneMoon): LightSpec;
  /** 远处的雾从多远开始、到多远全白：[近, 远]，米。 */
  fogFor(distanceM: number): [number, number];
  /** 山脚的云气浓淡：1 是平常，0 是没有。 */
  mistFor(distanceM: number): number;
  /** 全程沙盘自己的那一份。这种样式还摆不了全程沙盘时不写。 */
  route?: RouteStyle;
  /** 装裱和座子。 */
  stand: StandStyle;
  /** 小像的颜色。它是这位人物的东西，颜色跟着时代样式走，不从页面的样式表里取。这种样式还没有小像时不写。 */
  piece?: PieceStyle;
}

/** 一种时代样式，整套：上面那一半，加上站点沙盘才用的——地面怎么上色、模型跟着远近怎么变、题签抬多高。 */
export interface StageStyle extends TableStyle {
  ground: GroundStyle;
  /** 模型跟着镜头远近怎么变。表在这种样式自己的文件夹里（src/stage/three/style/<样式的名字>/figure.ts）。 */
  figure: FigureStyle;
  /**
   * 题签指着一样摆件时，比它脚下的地面抬高多少：沙盘里的米（和 x、z 一个单位，不再乘山高夸大的倍数），
   * 是模型照原来大小时的数；镜头远了模型放大，沙盘把每一段再乘上那一类模型现在放大的倍数。
   * 摆件摆在别的东西上（楼在城门上）时，再加上底下那样东西的数。
   */
  stripLift: Record<ThingKind, number>;
  /**
   * 同一种零件摆的地方不一样、模型也不一样时另写的数，按模型的类写（kit/figure.ts 的 liftClass）：写了就用它，不用上面按零件种类的那个。
   * 墙顶上的棚子也是一种“屋”，可它只有地上的茅屋一半高。
   */
  stripLiftByClass?: Partial<Record<FigureClass, number>>;
}

/** 零件库造模型时拿到的东西。 */
export interface KitContext {
  scene: StopScene;
  ground: Ground;
  samplers: GroundSamplers;
  coords: FrameCoords;
  style: StageStyle;
  quality: Quality;
  /** 这座沙盘用得着的、按家分块的零件（已经取到、并成一份；见 kit/families.ts）。一家也用不着就不写。 */
  kit?: KitFamily;
}

/** 一座沙盘的全部小模型。由零件库的 buildModels(ctx) 造出来（src/stage/three/kit/index.ts）。 */
export interface ModelSet {
  /** 挂进场景的那一组。 */
  readonly group: Group;
  /**
   * 换成某一小节的样子，并按远近定大小。viewDistanceM 是折算过的远近 D（rig.ts 的 equivalentDistance），
   * 镜头移动时每一帧都会调用，传的是这一帧真的数。大小、留几成、摊开多少都在显卡上算，这里只改几个数。
   * 这一节要用的模型还没造（没有先 prepare）时当场造。
   * 返回 true：显出来的东西变了（哪几组显着、船脚下的水位）。大小变了不算——那由 view 在镜头停下来以后补画一次影子。
   * hold：照远近换着显的东西（浮桥的几套），远近落在界线上下的时候留不留着上一帧显的那一套。读者自己在动镜头的时候留
   * （不写也是留）；程序摆的画面——摆好的一节、滑动的一路上——交 false：只照远近挑，同一个画面不管是怎么来的都是同一套。
   */
  apply(section: string, waterLevelM: number, viewDistanceM: number, hold?: boolean): boolean;
  /** 把这几个小节要用的模型先造好，一次造一小块，中间让出时间给页面。 */
  prepare(sections: string[]): Promise<void>;
  /** 现在显出来的模型一共多少个三角形。 */
  triangles(): number;
  /** 把模型和贴图都放掉。 */
  dispose(): void;
}
