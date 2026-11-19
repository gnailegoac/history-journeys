// 场景数据的机器可读形式：一座站点沙盘上摆什么，每一小节镜头看哪里。
// 说明见 docs/data-spec.md 的“场景数据”一节；两处不一致时先改文档，再改这里。
// 文件：content/figures/<人物>/scenes/<站>.json，旁边是它的地形文件。由 `npm run validate` 校验。
//
// 三条通用的写法：
//   坐标都是 [经度, 纬度]。
//   高度都写真实的米（海拔），夸大由程序去乘。平地整理以后在 terrain.recipe.plainBaseM 上下，
//   城里的地面、水位、堤顶都比着这个数写。
//   小节用正文里的小节标题来指。
//
// 这里不写像素、灯光和远近两套模型：题签摆在画面的哪里、光从哪来、远看时模型放大多少，都由程序按样式定。

import type { DressingKind, Params, ThingKind } from './sceneKinds';
import type { LngLat } from './types';

// 摆件、点缀有哪几种，各认哪些参数、位置怎么写、能摆在什么上面：那几张表在 ./sceneKinds.ts（只有沙盘程序和校验用，
// 页面不用，所以单放一个文件，不跟着页面的程序下载）。它们的类型从这里也拿得到。
export type { DressingKind, DressingWhere, ParamType, Params, ThingKind } from './sceneKinds';

/** 题签写当时的名字，还是今天的名字。 */
export type NamesMode = 'ancient' | 'modern';

// ---------------------------------------------------------------- 类别和依据

/** 摆上沙盘的东西分五类（见 docs/overall-design.md“分清真的和示意的”）。 */
export const SCENE_CLASSES = ['real', 'today', 'text', 'schematic', 'dressing'] as const;
export type SceneClass = (typeof SCENE_CLASSES)[number];

/** 五类在页面上叫什么。 */
export const SCENE_CLASS_LABEL: Record<SceneClass, string> = {
  /** 山的位置和形状，来自今天的高程数据。 */
  real: '真的',
  /** 今天还找得到的地点，不一定是当时的原处。 */
  today: '今天的位置',
  /** 正文或史料说了在哪，细节说不准。 */
  text: '按正文摆的',
  /** 没有可靠依据。 */
  schematic: '示意的',
  /** 只为让人看出这是城、是村、是岸。 */
  dressing: '点缀',
};

/**
 * 类别和依据。地形、整理的办法、每一处修整、水位、河岸的规矩、每条河、急滩、水漫不进去的地方、
 * 地名点、每样摆件、每条点缀规则、每个远处，都带这一组字段。
 */
export interface Grounds {
  class: SceneClass;
  /** 依据：为什么这样摆，一两句话。是这座沙盘考证记录的摘要。 */
  basis: string;
  /** 出处：这一站 stops/<站>.json 的 sources 里的 id。real、today、text 三类至少一个。 */
  sourceIds: string[];
  /**
   * 其中说不准、只是示意的部分。写成能接在“某某的”后面的话，如“层数、高矮和在东墙的哪一点”。
   * 没有就不写。
   */
  unsure?: string;
  /** 沙盘旁边给读者看的一句说明。小节的 explain 里点到的东西必须写。 */
  note?: string;
}

/**
 * 什么时候有。写的是小节标题；from、until 都含那一节。不写 when 就是一直有。
 * 一样东西前后样子不同（东门后来包了砖石），写成两样东西，when 前后接上。
 */
export type When = { from?: string; until?: string } | { only: string[] };

/** 这几个词在 explain、mustShow 里有专门的意思，不能拿来当 id。 */
export const SCENE_RESERVED_IDS = ['frame', 'terrain', 'recipe', 'levels', 'banks'] as const;

// ---------------------------------------------------------------- 一座站点沙盘

/** 时代样式。添一种样式要改程序，先添在这里。 */
export const SCENE_STYLES = ['song-qinglv'] as const; // 宋代青绿设色
export type SceneStyleId = (typeof SCENE_STYLES)[number];

/** scenes/<站>.json。所有带 id 的东西，id 在整个文件里不重复。 */
export interface StopScene {
  stopId: string;
  style: SceneStyleId;
  /** 用了谁的数据，页面上要写出来。如“地形：Mapzen 地形瓦片（Terrarium），其中的 SRTM、GMTED2010 高程数据由美国地质调查局（USGS）提供”。至少一条。 */
  credits: string[];
  frame: SceneFrame;
  terrain: SceneTerrain;
  water: SceneWater;
  places: ScenePlace[];
  things: SceneThing[];
  dressing: SceneDressing[];
  strips: SceneStrip[];
  far: SceneFarPlace[];
  /** 和正文的小节一一对上，顺序相同。 */
  sections: SceneSection[];
  notDrawn: SceneOmission[];
}

// ---------------------------------------------------------------- 范围

export interface SceneFrame {
  /** 沙盘的原点。程序以它为原点把经纬度换成米：x 向东，z 向南。 */
  center: LngLat;
  /** 从原点到西、东、北、南四条边各多少米。 */
  westM: number;
  eastM: number;
  northM: number;
  southM: number;
  /** 这个海拔（米）是沙盘上平的桌面。一般和 terrain.recipe.plainBaseM 一样。 */
  datumM: number;
  relief: SceneRelief;
}

/**
 * 山的高度怎么夸大。站点沙盘现在只有一种：统一夸大 times 倍。
 * 全程沙盘用的“矮山多夸、高山少夸”到接全程沙盘时再加一种 kind（见 docs/data-spec.md“还没有写进规格的”）。
 */
export type SceneRelief = { kind: 'uniform'; times: number };

// ---------------------------------------------------------------- 地形

/** 地形本身的类别说的是山：一般是 real。 */
export interface SceneTerrain extends Grounds {
  /** 同一个文件夹里的地形文件名。16 位整数（低位在前），单位分米；第 0 行最北，第 0 列最西；逐行存。 */
  file: string;
  cols: number;
  rows: number;
  /** 地形文件盖住的经纬度范围（度）。要盖得住整块沙盘。 */
  west: number;
  east: number;
  south: number;
  north: number;
  recipe: TerrainRecipe;
  /** 一处一处的修整，按写的先后做。 */
  edits: TerrainEdit[];
}

/** 整理的办法：平地抹平（今天低的地方垫高，高的地方压低），山留着，但跟着矮一截。它的 note 必须写（每一节的说明里都有这一句）。 */
export interface TerrainRecipe extends Grounds {
  kind: 'plain-and-hills';
  /** 今天海拔低于这个数的算平地。 */
  plainBelowM: number;
  /** 高于这个数的算山。两个数之间慢慢过渡。山的形状留着，但整座山跟着平地一起降了 plainBelowM − plainBaseM 米，细处抹平了一点。 */
  hillAboveM: number;
  /** 平地压到这个海拔上下。 */
  plainBaseM: number;
  /** 平地的起伏留几成（0.1 是一成）。 */
  plainKeep: number;
  /** 离沙盘边这么多米以内，山收低到平地，切面才齐整。 */
  edgeTaperM: number;
}

export type TerrainEdit = LevelEdit | MoundEdit;

/** 把一块地方压成、垫到或压到一个高度。 */
export interface LevelEdit extends Grounds {
  id: string;
  name: string;
  op: 'level';
  /** 哪一块：一圈闭合的线（最后一点不用重复第一点）。和 inside 二选一。 */
  area?: LngLat[];
  /**
   * 哪一块：一道城墙里面（写城墙的 id）。和 area 二选一。
   * 这样写的修整，程序在别的修整和挖河都做完以后再压一遍，城里才是一块平地。
   */
  inside?: string;
  /** set：整块变成这个高度；raise：低于它的垫上来；lower：高于它的压下去。 */
  mode: 'set' | 'raise' | 'lower';
  /** 海拔（米）。 */
  toM: number;
  /** 往外多少米以内慢慢过渡到原来的地面。 */
  featherM: number;
}

/** 垫一个土丘。 */
export interface MoundEdit extends Grounds {
  id: string;
  name: string;
  op: 'mound';
  at: LngLat;
  /** 中心垫高多少米。 */
  addM: number;
  /** 这个半径以内垫足，到 outerM 减到零。 */
  innerM: number;
  outerM: number;
}

// ---------------------------------------------------------------- 水

export interface SceneWater {
  levels: WaterLevels;
  banks: WaterBanks;
  rivers: SceneRiver[];
  /** 乱石急滩。现在一座沙盘最多写一处。 */
  rapids: SceneRapids[];
  /** 水漫不进去的地方。闭合的城墙里面不用写，程序自己算。 */
  dry: SceneDryArea[];
}

/** 水位。它的 note 必须写。 */
export interface WaterLevels extends Grounds {
  /** 名字到海拔（米）。必须有 normal（平时）。小节用名字来指。 */
  values: Record<string, number>;
}

/** 河岸和河床的规矩，所有的河共用。 */
export interface WaterBanks extends Grounds {
  /** 河两边的岸最高到这个海拔：高出来的压下去，低的不动。修整过的地方（edits）不受它管。 */
  bankM: number;
  /** 河床比平时的水面低多少米。 */
  bedM: number;
  /** 河离城墙的线至少这么多米，河画宽了也不切进城墙。壕不受这一条管。 */
  keepOffWallsM: number;
}

export interface SceneRiver extends Grounds {
  id: string;
  name: string;
  /** river 是河；moat 是壕：窄，只在画的宽度里挖，不压两边的岸。 */
  kind: 'river' | 'moat';
  /** 中线。可以伸到沙盘外面。 */
  line: LngLat[];
  /** 沙盘上画多宽（米）。比实际宽。 */
  drawWidthM: number;
  /** 路或堤从这里跨过去：这里不挖。 */
  crossings?: LngLat[];
}

export interface SceneRapids extends Grounds {
  id: string;
  name: string;
  /** 在哪条河上（河的 id）。 */
  river: string;
  at: LngLat;
  lengthM: number;
}

export interface SceneDryArea extends Grounds {
  id: string;
  name: string;
  /** 一圈闭合的线。 */
  area: LngLat[];
}

// ---------------------------------------------------------------- 地名点

/** 只有名字、没有模型的地方：一座山、一片山坡。题签可以指它。 */
export interface ScenePlace extends Grounds {
  id: string;
  name: string;
  at: LngLat;
}

// ---------------------------------------------------------------- 摆件

/** 一样摆件。有哪几种（kind）、各认哪些参数、位置怎么写，见 ./sceneKinds.ts。 */
export interface SceneThing extends Grounds {
  id: string;
  /** 给读者看的名字，说明和凭据里用，如“东南的堤”。 */
  name: string;
  kind: ThingKind;
  /** 位置是一个点的零件写这个。 */
  at?: LngLat;
  /** 位置是一条线、一圈线的零件写这个。 */
  line?: LngLat[];
  /** 正面朝哪边：0 朝北，顺时针，度。不写由程序定（城门朝城外，别的朝南）。 */
  facing?: number;
  /** 摆在哪样东西上（写它的 id）：城门在城墙上，楼在城门上，棚子在城墙顶上。 */
  on?: string;
  params?: Params;
  when?: When;
}

// ---------------------------------------------------------------- 点缀

/** 点缀：写的是规则，不是一座一座地摆。类别只能是 dressing 或 text。 */
export interface SceneDressing extends Grounds {
  id: string;
  name: string;
  kind: DressingKind;
  /** 在哪。下面四个最多写一个；都不写就是整块沙盘，由程序按样式的规矩摆（树在山上，田在平地）。 */
  inside?: string;
  area?: LngLat[];
  line?: LngLat[];
  at?: LngLat;
  params?: Params;
  when?: When;
}

// ---------------------------------------------------------------- 题签和远处

export interface SceneStrip {
  id: string;
  /** 当时的名字。只能是汉字，一到七个，不带标点、数字和空格。 */
  text: string;
  /** 今天的名字（同样的限制）。当时和今天叫法一样、或者今天没有对应的名字，就不写。 */
  modern?: string;
  /**
   * 指着哪样东西：摆件、点缀、地名点、河、急滩、远处的 id。必须写，类别和依据跟着那样东西走。
   * 指着河或急滩的是水名，字用靛青；指着远处的摆在沙盘边上。
   */
  of: string;
  /** 指在那样东西的哪一点。那样东西只有一个点时不用写；是一条线、一片地方时必须写，而且要落在它上面。 */
  at?: LngLat;
  /** 题签最好摆在那一点的哪一边。不写由程序定。 */
  side?: 'above' | 'below' | 'left' | 'right';
}

/** 正文提到、却在沙盘外面的地方。题签摆在沙盘边上朝着它的那一点，方向和距离由程序按坐标算。 */
export interface SceneFarPlace extends Grounds {
  id: string;
  name: string;
  at: LngLat;
  /** 括注，如“今安徽萧县白土镇”。 */
  gloss?: string;
}

// ---------------------------------------------------------------- 小节

export const SCENE_SKIES = ['day'] as const; // 夜、雨、雪做黄州时再加
export type SceneSky = (typeof SCENE_SKIES)[number];

export interface SceneCamera {
  /** 镜头对准哪。 */
  target: LngLat;
  /** 对准的那一点比那里的地面高多少米（真实的米）。不写是 0。看一座楼时写楼的半腰。 */
  targetUpM?: number;
  /** 镜头离那一点多远（米）。按宽和高差不多的画面定；画面窄了，程序自己退远，退到 mustShow 都看得见为止。 */
  distanceM: number;
  /** 倾角：0 为正俯视（和 CameraPreset 一样）。 */
  pitch: number;
  /** 朝哪边看：0 朝北，顺时针（和 CameraPreset 一样）。 */
  bearing: number;
  /** 视角，度。不写用 21。 */
  fov?: number;
  /** 要看的东西（mustShow）都还看得见时，镜头最多可以靠近到 distanceM 的几成（0.8 是八成）。不写是 1，就是不靠近。 */
  closest?: number;
  /**
   * 画面再窄也要看得见的东西：摆件、点缀、地名点、河、急滩、远处的 id，或 'frame'（整块沙盘，连装裱和座子一起算）。
   * 不写就是这一节的题签指的那些点；写了就只管写的这几样，题签指的东西要保证看得见，也得写进来。
   */
  mustShow?: string[];
}

export interface SceneSection {
  /** 正文里的小节标题。 */
  heading: string;
  /** 这一节是什么时候，如“熙宁十年（1077）九月”。 */
  date: string;
  /** 题记：一句话，说沙盘上这一节看什么。不超过 40 个字。 */
  line: string;
  camera: SceneCamera;
  /** 水位：water.levels.values 里的名字。 */
  water: string;
  /** 天色。不写是白天。 */
  sky?: SceneSky;
  /** 这一节摆哪几条题签（题签的 id），一到六条，要紧的在前；摆不下时从后面去掉。 */
  strips: string[];
  /**
   * 旁边的说明先讲哪几样，最容易看错的在前，至少一样。点到的每一样，它的 note 都印在展开的说明里。
   * 可以写：修整、河、急滩、水漫不进去的地方、地名点、摆件、点缀、远处、没有画的东西的 id；
   * 'levels' 指水位，'banks' 指河岸的规矩，'terrain' 指地形，'recipe' 指地形的整理。
   * 点到的东西都要有 note（没有画的东西用它的 why）。
   */
  explain: string[];
}

/** 史料里有、沙盘上故意不画的东西。 */
export interface SceneOmission {
  id: string;
  name: string;
  /** 为什么不画，给读者看的一句话。 */
  why: string;
  sourceIds: string[];
}

// ---------------------------------------------------------------- 从场景生成的文字
// 沙盘旁边印的字和凭据里“沙盘上的东西”一栏，都由 src/domain/sceneText.ts 从场景数据生成，不另写。

/** 一小节在沙盘旁边要印的字。 */
export interface SectionInfo {
  /** 小节标题。 */
  section: string;
  date: string;
  /** 题记。 */
  line: string;
  /**
   * 如实的说明，三种写法，都一定说到四样：哪些是示意，地形修整了哪里，山高夸大了几倍，模型和河都放大了。
   *   short  沙盘旁边常印着的一句，栏宽时用，最多占两行：示意的最多点三样的名字。
   *   brief  栏窄时用的一句，只占一行：示意的只说一共几样。
   *   lines  完整的几句话，读者点“说明”才展开。
   */
  note: { short: string; brief: string; lines: string[] };
  /** 这一节的题签指到的远处。say 如“往西南约 24 公里（今安徽萧县白土镇）”。 */
  far: { id: string; name: string; say: string }[];
}

/** 凭据里的一项：沙盘上的一样东西。 */
export interface RegisterEntry {
  id: string;
  name: string;
  class: SceneClass;
  basis: string;
  unsure?: string;
  /** 出处的写法（从 sourceIds 对出来）。 */
  cites: string[];
}

/** 凭据里“沙盘上的东西”一栏：按五类分组，加上没有画的东西和用了谁的数据。 */
export interface SceneRegister {
  groups: { class: SceneClass; label: string; entries: RegisterEntry[] }[];
  notDrawn: { id: string; name: string; why: string; cites: string[] }[];
  credits: string[];
}
