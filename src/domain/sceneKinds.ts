// 摆件和点缀有哪几种，各认哪些参数、位置怎么写、能摆在什么上面。说明见 docs/data-spec.md 的“场景数据”一节。
// 这几张表只有沙盘程序（src/stage/three、src/domain/sceneParams.ts）和校验（tests/content/sceneRules.ts）用，页面不用：
// 所以不放在 ./scene.ts 里（页面要引那个文件，放在那里就得跟着页面的程序一起下载），也不从 ./index.ts 转出去。
// 场景数据里别的类型都在 ./scene.ts；这里的几个类型从那边也拿得到。

// ---------------------------------------------------------------- 摆件

/** 零件库里有的东西。添一种零件要改程序，先添在这里和下面三张表里。 */
export const THING_KINDS = ['wall', 'gate', 'tower', 'pavilion', 'hall-group', 'house', 'dike', 'bank', 'timber-bank', 'cliff', 'earth-wall', 'small-gate'] as const;
export type ThingKind = (typeof THING_KINDS)[number];

/**
 * 只有一部分沙盘用得着的零件：造它的程序不在沙盘程序里，按“家”分块，用到时才下载（登记在 src/stage/families.ts）。
 * 树、石头的 type 里也有这样的（bamboo、cypress、shore），登记在同一处。
 */
export const FAMILY_THING_KINDS = ['cliff', 'earth-wall', 'small-gate'] as const satisfies readonly ThingKind[];
export type FamilyThingKind = (typeof FAMILY_THING_KINDS)[number];

/** 参数的样子：一个数，是或否，或者几个词里选一个。 */
export type ParamType = 'number' | 'boolean' | readonly string[];

export type Params = Record<string, string | number | boolean>;

/**
 * 各种零件认哪些参数。都可以不写，不写用零件库的默认。表里没有的参数名通不过校验。
 * 大小不在这里：模型都放大了，不按比例，多大由样式定。
 */
export const THING_PARAMS = {
  /** 城墙。face：夯土还是包砖；parapet：有没有垛口。 */
  wall: { face: ['earth', 'brick'], parapet: 'boolean' },
  /** 城门。big：门墩加大。 */
  gate: { face: ['earth', 'brick'], big: 'boolean' },
  /** 楼：城门楼、角楼。storeys：几层；walls：白墙还是刷黄土；timber：木头上红漆还是素的。 */
  tower: { storeys: 'number', size: ['small', 'large'], walls: ['plaster', 'yellow-wash'], timber: ['red', 'plain'] },
  /** 亭。 */
  pavilion: { roof: ['tile', 'thatch'] },
  /** 一组院落：官署、寺。halls：几进；galleries：有没有长廊；enclosed：有没有围墙；terraced：顺着山坡一级一级下来；paleYard：院子的地面画成浅色。 */
  'hall-group': { halls: 'number', galleries: 'boolean', enclosed: 'boolean', terraced: 'boolean', paleYard: 'boolean' },
  /** 单座的屋。fence：带不带篱笆。 */
  house: { roof: ['tile', 'thatch'], fence: 'boolean' },
  /** 堤。topM：堤顶的海拔（米）。 */
  dike: { topM: 'number' },
  /** 墙脚到水边的土坡。 */
  bank: {},
  /** 木桩护岸。 */
  'timber-bank': {},
  /** 崖壁：线是崖脚。 */
  cliff: {},
  /** 不闭合的矮土墙。ruined：塌了的；fence：中间一段是篱笆。 */
  'earth-wall': { ruined: 'boolean', fence: 'boolean' },
  /** 单立的小门。 */
  'small-gate': {},
} as const satisfies Record<ThingKind, Record<string, ParamType>>;

/** 各种零件的位置怎么写：point 是一个点（at），line 是一条线（line），ring 是一圈闭合的线（line，最后一点不用重复第一点）。 */
export const THING_PLACING: Record<ThingKind, 'point' | 'line' | 'ring'> = {
  wall: 'ring',
  gate: 'point',
  tower: 'point',
  pavilion: 'point',
  'hall-group': 'point',
  house: 'point',
  dike: 'line',
  bank: 'line',
  'timber-bank': 'line',
  cliff: 'line',
  'earth-wall': 'line',
  'small-gate': 'point',
};

/**
 * 各种零件可以摆在哪种零件上（on）。空的只能摆在地上；城门必须写 on。
 * 堤写了 on 是贴在城墙里侧的土坡；土坡（bank）写了 on 是贴在城墙外侧。
 */
export const THING_HOSTS: Record<ThingKind, readonly ThingKind[]> = {
  wall: [],
  gate: ['wall'],
  tower: ['gate', 'wall'],
  pavilion: ['wall'],
  'hall-group': [],
  house: ['wall'],
  dike: ['wall'],
  bank: ['wall'],
  'timber-bank': [],
  cliff: [],
  'earth-wall': [],
  'small-gate': [],
};

// ---------------------------------------------------------------- 点缀

export const DRESSING_KINDS = ['houses', 'villages', 'fields', 'trees', 'boats', 'rocks', 'roads'] as const;
export type DressingKind = (typeof DRESSING_KINDS)[number];

/** 各种点缀认哪些参数。都可以不写。seed 是随机数的种子：同一个数每次摆出来一样。 */
export const DRESSING_PARAMS = {
  /** 成片的民居。density：多密，1 是平常；lanes：排成街巷。 */
  houses: { density: 'number', lanes: 'boolean', seed: 'number' },
  /** 村子。count：几个。 */
  villages: { count: 'number', seed: 'number' },
  /** 田。green：青苗，整块画成草绿色（只给写了 area 的）。 */
  fields: { seed: 'number', green: 'boolean' },
  /** 树。type：杂树、松、柳、果树、竹、柏（后两种的程序按家分块）。 */
  trees: { type: ['mixed', 'pine', 'willow', 'fruit', 'bamboo', 'cypress'], density: 'number', radiusM: 'number', seed: 'number' },
  /** 船。type：货船还是小船；moored：系着不动。 */
  boats: { type: ['cargo', 'small'], count: 'number', moored: 'boolean', radiusM: 'number', seed: 'number' },
  /** 露着的石头。shore 是只在水落时露出来的（程序按家分块）。 */
  rocks: { type: ['grey', 'pale', 'shore'], count: 'number', radiusM: 'number', seed: 'number' },
  /** 路。street 是城里的街，road 是城外的路。 */
  roads: { type: ['street', 'road'] },
} as const satisfies Record<DressingKind, Record<string, ParamType>>;

/** 点缀摆在哪：城墙里面、一块地方、沿一条线、一个点周围，或者整块沙盘（all，就是哪个都不写）。 */
export type DressingWhere = 'inside' | 'area' | 'line' | 'at' | 'all';

/** 各种点缀可以用哪几种写法。 */
export const DRESSING_WHERE: Record<DressingKind, readonly DressingWhere[]> = {
  houses: ['inside', 'area'],
  villages: ['all', 'area'],
  fields: ['all', 'area'],
  trees: ['all', 'area', 'line', 'at'],
  boats: ['line', 'at'],
  rocks: ['at'],
  /** 写 inside 是城里从城门到城门的街。 */
  roads: ['line', 'inside'],
};
