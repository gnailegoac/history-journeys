// 场景数据的机器可读形式：一座站点沙盘上摆什么，每一小节镜头看哪里。
// 说明见 docs/data-spec.md 的“场景数据”一节；两处不一致时先改文档，再改这里。
// 文件：content/figures/<人物>/scenes/<站>.json，旁边是它的地形文件。由 `npm run validate` 校验。
//
// 沙盘有两层：每一站一座站点沙盘（StopScene），每位人物一座全程沙盘（RouteScene，scenes/route.json，
// 说明见 docs/data-spec.md 的“全程沙盘的场景数据”一节）。两层共用的几样（类别和依据、地名点、题签、远处、镜头、没有画的）
// 只有一份；全程沙盘自己的类型在这个文件的后半截，站点沙盘的类型没有哪个字段因为它改过。
//
// 三条通用的写法：
//   坐标都是 [经度, 纬度]。
//   高度都写真实的米（海拔），夸大由程序去乘。平地整理以后在 terrain.recipe.plainBaseM 上下，
//   城里的地面、水位、堤顶都比着这个数写。
//   小节用正文里的小节标题来指。
//
// 这里不写像素、灯光和远近两套模型：题签摆在画面的哪里、光从哪来、远看时模型放大多少，都由程序按样式定。

import type { DressingKind, Params, ThingKind } from './sceneKinds';
import type { LngLat, Source } from './types';

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

/** 全程沙盘里留用的词：没有 banks（它没有河岸的规矩），多一个 coast（照今天画的海岸）。 */
export const ROUTE_RESERVED_IDS = ['frame', 'terrain', 'recipe', 'levels', 'coast'] as const;

/** 全程沙盘的场景文件叫 route.json，它的 stopId 也写这个词：所以这个词不能当站的 id。 */
export const ROUTE_SCENE_ID = 'route';

// ---------------------------------------------------------------- 一座站点沙盘

/** 时代样式。添一种样式要改程序，先添在这里。 */
export const SCENE_STYLES = ['song-qinglv'] as const; // 宋代青绿设色
export type SceneStyleId = (typeof SCENE_STYLES)[number];

/** scenes/<站>.json。所有带 id 的东西，id 在整个文件里不重复。 */
export interface StopScene {
  /** 哪一层的沙盘。站点沙盘可以不写；全程沙盘（RouteScene）必须写 'route'。 */
  level?: 'stop';
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
  /** 只有树的规则可以写：这几处修整（terrain.edits 里 level 一类的 id）的范围里不种。 */
  except?: string[];
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

export const SCENE_SKIES = ['day', 'night'] as const; // 雨、雪没有做
export type SceneSky = (typeof SCENE_SKIES)[number];

/** 夜里的小节，月亮在天上的哪里。 */
export interface SceneMoon {
  /** 月亮在哪个方向：0 是正北，顺时针，度。 */
  azimuth: number;
  /** 离地平线多高，度。 */
  altitude: number;
}

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
  /** 月亮在哪。夜里的小节必须写；白天的不能写。 */
  moon?: SceneMoon;
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

// ---------------------------------------------------------------- 全程沙盘
// 一位人物一座：各站和站与站之间的路。和站点沙盘是同一种文件，小节是一个一个的画面：头一节看全程，
// 后面每一站一节，看到这一站去的那段来路。说明见 docs/data-spec.md 的“全程沙盘的场景数据”一节。
//
// 和站点沙盘不一样的几处：
//   范围是一个投影（兰勃特等角圆锥）加一个比例（沙盘上的 1 米是地上的多少米）；山高照一条曲线夸大（矮山多夸）。
//   地形文件里一个数是 1 米（不是 1 分米）；0 是海。
//   没有水面，也不挖河：海、湖、河都是画在地面上的。今天的海岸、湖、河放在另一个文件里（water.todayFile），
//   场景照名字去取。
//   没有摆件、点缀、急滩、河岸的规矩、水漫不进去的地方、什么时候有（when）、天色：这些字段不写，写了通不过校验。
//   多一样：路（roads）。
//
// 文件里的高度、长度都是真实的米，只有一样例外：镜头的 distanceM 两层都是沙盘里的米
// （站点沙盘上两样是一回事）。它是摆镜头用的数，不是地理上的数。

/** scenes/route.json：一位人物的全程沙盘。所有带 id 的东西，id 在整个文件里不重复。 */
export interface RouteScene {
  level: 'route';
  /** 写 'route'。这个词不能当站的 id。 */
  stopId: 'route';
  style: SceneStyleId;
  /** 用了谁的数据，至少两条：地形一条，今天的海岸、河、湖一条。 */
  credits: string[];
  /** 依据里的 sourceIds 指的出处（站点沙盘的出处在那一站的 stops/<站>.json 里，全程沙盘没有那个文件）。 */
  sources: Source[];
  frame: RouteFrame;
  terrain: RouteTerrain;
  water: RouteWater;
  places: RoutePlace[];
  /** 题签。of 还可以写 'coast'：指着海。 */
  strips: SceneStrip[];
  far: SceneFarPlace[];
  roads: SceneRoads;
  /** 头一节是全程；后面每一站一节，先后和 figure.json 里的站一样。 */
  sections: RouteSection[];
  notDrawn: SceneOmission[];
}

/** 一座沙盘的场景：站点沙盘或者全程沙盘。看 level 分。 */
export type TableScene = StopScene | RouteScene;

export interface RouteFrame {
  /** 投影的原点，也是沙盘的原点。 */
  center: LngLat;
  /** 兰勃特等角圆锥，原点是 center；lat1、lat2 是两条标准纬线。 */
  projection: { kind: 'lambert-conic'; lat1: number; lat2: number };
  /** 沙盘上的 1 米是地上的多少米。 */
  scale: number;
  /** 从原点到西、东、北、南四条边各多少米（真实的米，在投影出来的平面上量）。 */
  westM: number;
  eastM: number;
  northM: number;
  southM: number;
  /** 这个海拔（米）是沙盘上平的桌面。全程沙盘写 0（海面）。 */
  datumM: number;
  relief: RouteRelief;
}

/**
 * 矮山多夸：海拔 lowBelowM 以下夸大 lowTimes 倍；再往上，夸大以后的高度 = lowTimes × lowBelowM ×（海拔 ÷ lowBelowM）的 power 次方。
 * highTimes 是做出来的地面上最高的山夸大了大约几倍（整数），说明里印“约 highTimes 到 lowTimes 倍”；对不对由测试照做出来的地面核。
 */
export interface RouteRelief {
  kind: 'low-hills-more';
  lowBelowM: number;
  lowTimes: number;
  power: number;
  highTimes: number;
}

export interface RouteTerrain extends Grounds {
  /** 同一个文件夹里的地形文件名。16 位整数（低位在前）；第 0 行最北，第 0 列最西；逐行存；经纬度的网格。 */
  file: string;
  cols: number;
  rows: number;
  /** 地形文件盖住的经纬度范围（度）。要盖得住整块沙盘（圆锥投影的边是弯的，四条边都要算）。 */
  west: number;
  east: number;
  south: number;
  north: number;
  /** 地形文件里一个数是多少米。全程沙盘写 'm'；0 是海，陆地最小是 1。 */
  heightUnit: 'm';
  recipe: PlainSmoothed;
  edits: SeaEdit[];
}

/** 全程沙盘整理地形的办法：平原抹成缓坡，山照原样。它的 note 必须写。 */
export interface PlainSmoothed extends Grounds {
  kind: 'plain-smoothed';
  /** 四周（约 20 公里）的平均海拔低于这个数的是平原，高于 hillAboveM 的是山地，中间慢慢过渡。 */
  plainBelowM: number;
  hillAboveM: number;
  /** 平原抹成的缓坡：把平原自己的高度抹开这么多米。 */
  smoothM: number;
  /** 平原上比缓坡高出或低下不到 rippleM[0] 米的起伏只留 plainKeep；超过 rippleM[1] 米的算山，照原样；中间匀着过渡。 */
  plainKeep: number;
  rippleM: [number, number];
  /** 离沙盘边这么多米以内，地面收低到海面，切面才齐整。 */
  edgeTaperM: number;
  /** 路没到的地方：这几圈里面留白（夸大以后的地势压到 3%，上空绢的颜色，海岸只留一道细线）。圈可以伸到沙盘外面。 */
  blank: LngLat[][];
}

/** 这一圈里面今天的陆地不画，抹成海。圈可以伸到沙盘外面。 */
export interface SeaEdit extends Grounds {
  id: string;
  name: string;
  op: 'sea';
  /** 一圈闭合的线（最后一点不用重复第一点）。 */
  area: LngLat[];
}

export interface RouteWater {
  /** 海面。values 只有 normal，写 0。它的 note 必须写。 */
  levels: WaterLevels;
  /** 今天的海岸、湖、河放在哪个文件里（同一个文件夹）。 */
  todayFile: string;
  /** 海岸（照今天画的那一条）。explain、题签的 of 里用留用的词 coast 指它。 */
  coast: Grounds & { name: string };
  rivers: RouteRiver[];
  lakes: RouteLake[];
  washes: RouteWash[];
}

/** 照今天的数据画：取 todayFile 里叫这些名字的线；写了 west、east、south、north 的只取这个范围里的点。 */
export interface TodayPick {
  names: string[];
  west?: number;
  east?: number;
  south?: number;
  north?: number;
}

export interface RouteRiver extends Grounds {
  id: string;
  name: string;
  /** river 是河；canal 是运河：细线，淡一点。 */
  kind: 'river' | 'canal';
  /** 画多粗（多少公里由样式定）。运河不写。 */
  weight?: 'trunk' | 'major' | 'river' | 'minor';
  /** 自己写的线，和 today 正好写一个。可以伸到沙盘外面。 */
  line?: LngLat[];
  /** 照今天的数据画：几条取法合起来。 */
  today?: TodayPick[];
}

/** 有岸线的湖：照今天的湖画；except 那一圈里面的湖面不画（当时还是陆地），它自己带类别和依据。 */
export interface RouteLake extends Grounds {
  id: string;
  name: string;
  today: TodayPick[];
  except?: Grounds & { id: string; name: string; area: LngLat[] };
}

/** 只染一片水色、不画岸线的水。areas 是一圈或几圈。 */
export interface RouteWash extends Grounds {
  id: string;
  name: string;
  areas: LngLat[][];
}

export interface RoutePlace extends ScenePlace {
  /** 这个地方是哪几站（figure.json 里站的 id，按先后）。写了的，它的题签脚上有站号的印，点了进那一站。 */
  stops?: string[];
}

export interface SceneRoads {
  ways: RoadWay[];
  journeys: RoadJourney[];
}

/** 一截路。几趟都走它的，只画一笔。 */
export interface RoadWay {
  id: string;
  /** 水路、陆路还是海路。 */
  by: 'water' | 'land' | 'sea';
  /** 沿着哪条河、哪个湖走（它的 id）。只是交代，线还是 line 写的那条。 */
  along?: string;
  line: LngLat[];
}

/**
 * 到一站去的那一趟。parts 按走的先后；每一截有自己的名字、类别和依据，在说明和凭据里的 id 是“<这一趟的 id>/<第几截>”（从 1 数起）。
 * 一截的类别定它画成什么线：text（他自己的文字写到了途中的地方）画实线，schematic（只知道两头，或者照以前走过的路画）画虚线。
 */
export interface RoadJourney {
  id: string;
  name: string;
  /** 到的是哪一站（figure.json 里站的 id）。 */
  stop: string;
  date: string;
  /** ways 写一截路的 id；倒着走的在前面加一个减号，如 "-w-canal"。 */
  parts: (Grounds & { name: string; ways: string[] })[];
}

export interface RouteSection {
  /** 这一节叫什么（“全程”“到徐州”），最多七个字。全程沙盘的小节不对着哪一篇正文。 */
  heading: string;
  date: string;
  /** 题记：一句话，说沙盘上这一节看什么。不超过 40 个字。 */
  line: string;
  /** 镜头。不许写 targetUpM；distanceM 是沙盘里的米。mustShow 还可以写一趟路的 id。 */
  camera: SceneCamera;
  /** 这一节摆哪几条题签，一到十二条，要紧的在前。 */
  strips: string[];
  /** 旁边的说明先讲哪几样，至少一样。还可以写一趟路的 id（它各截的 note 照先后印）、从湖面里裁掉的那一角的 id，或者 'coast'。 */
  explain: string[];
  /** 这一节看的是到哪一站的来路。第一节（全程）不写。 */
  stop?: string;
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
   * 如实的说明，三种写法，都一定说到四样：哪些是示意，地形修整了哪里，山高夸大了几倍，模型和河都放大了
   *（全程沙盘上没有模型，第四样说的是“河和路都画宽了”）。
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
