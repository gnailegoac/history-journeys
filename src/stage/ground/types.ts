// 地面这一边（src/stage/ground/）和沙盘程序别的部分之间的约定。
// 整个 ground 文件夹只算数：不碰 three，也不碰页面（document、window），在 Node 里也能跑。
// 这个文件是几个人共用的接缝，要改先找负责人。
//
// 坐标：沙盘里的米。原点是 frame.center，x 向东，z 向南（所以北是 −z）；换算只用 src/domain/sceneGeo.ts 的 frameCoords。
// 高度：都是真实的米（海拔），没有乘夸大的倍数。

/** 平面上的一点 [x, z]，或者一对数。会被展开、解构的地方都用它，不用 number[]。 */
export type Vec2 = [number, number];
/** 空间里的一点 [x, y, z]，或者三个数（如颜色的红、绿、蓝）。 */
export type Vec3 = [number, number, number];

/** 地形文件读出来的样子：今天的高程网格。 */
export interface Dem {
  cols: number;
  rows: number;
  /** 网格盖住的经纬度范围（度）。 */
  west: number;
  east: number;
  south: number;
  north: number;
  /** 海拔（米）。逐行存，第 0 行最北，第 0 列最西。 */
  heights: Float32Array;
}

/**
 * 一座城的平面，从城墙那一圈线算出来。
 * 上色（街巷）和零件库（民居）都读它，两边才对得上；“离城多远”一律从 centre 算，不从沙盘的原点算。
 */
export interface CityPlan {
  /** 城墙这样摆件的 id。 */
  wallId: string;
  /** 城墙的线：一圈，最后一点不重复第一点。 */
  wall: Vec2[];
  /** 城的中心。 */
  centre: Vec2;
  /** 城里地面的海拔（米）。 */
  groundM: number;
  /** 城门：在城墙线上的哪一点；outward 是朝城外的方向（长度为 1）。 */
  gates: { id: string; at: Vec2; outward: Vec2 }[];
  /** 大街：从城门到城门。点缀里登记了 inside 这道城墙的 roads 才有。 */
  streets: Vec2[][];
  /** 小巷：只有两边排民居的那些，都顺着城墙最长的一边；横巷不在这里。民居的规则写了 lanes: true 才有。 */
  lanes: Vec2[][];
}

/**
 * 整理好的地面：一张网格和从场景里带过来的几样东西。
 * 网格每格 cell 米，nx 列、nz 行；第 k = j × nx + i 格在 x = x0 + i × cell，z = z0 + j × cell（第 0 行最北，第 0 列最西）。
 */
export interface Ground {
  nx: number;
  nz: number;
  cell: number;
  x0: number;
  z0: number;
  /** 修整以后的海拔（米）。 */
  h: Float32Array;
  /** 水看到的地面（米）：土坡的坡脚外面压到河床，水面才接得上坡脚。 */
  waterH: Float32Array;
  /** 1 是水漫不进去的地方（闭合的城墙里面和 water.dry 里的地方），0 是别处。只在水位高过平时才起作用。 */
  dry: Uint8Array;
  /** 到最近的河岸多少米；在河里是负数；离河很远的地方是一个很大的数。 */
  edge: Float32Array;
  /** 最近的那条河或那道壕画的宽度的一半（米）；离河很远的地方是 0。上色时窄的水道（壕）岸边只留一道细边。 */
  bankHalf: Float32Array;
  /**
   * 修整压出来的宽水面有几格“种子”（地面明明白白比平时的水位低、又不在哪条画出来的河里；见 fields.ts 的 openWater）。
   * 0 是没有宽水面：edge 只认画出来的河和壕，同原来一样（徐州）。
   */
  openSeeds: number;
  /** 最低的水位（米），比平时的水位低的时候才有；不然是 null。它露出来的地面上沙色，不上水底的颜色。 */
  lowWaterM: number | null;
  /**
   * “垫高一块地方”的修整（level，写了 area，mode 是 raise）把这一格垫高了多少米；别处是 0。
   * 这一截是垫出来的平地，不是山：上色、种树时把它减掉，垫高的地面就和四周的平地一个颜色，上面是田，不长山上的树。
   */
  lift: Float32Array;
  /** 这一格算不算山：0 是平地，1 是山。 */
  hill: Float32Array;
  /** hill 抹开以后的样子（看“山脚一带”用）。 */
  hillSoft: Float32Array;
  /** 凸凹：比四周高是正的（山脊），比四周低是负的（沟）。给山上色用；垫出来的平地和壕不算凸凹。 */
  curv: Float32Array;
  /** 每条河、每道壕加密以后的中线，按 id 取。 */
  rivers: Record<string, Vec2[]>;
  /** 村子摆在哪：n 是几座屋，seed 是这个村子的随机数种子。 */
  villages: { x: number; z: number; n: number; seed: number }[];
  /** 每道闭合的城墙一座城。 */
  cities: CityPlan[];

  // 下面四样是准备阶段补的，设计稿的 Ground 里没有列：上色只拿得到 Ground 和样式，这几样又只有场景里才有。
  /** 平地的海拔（terrain.recipe.plainBaseM，米）。山上的分带、洼地的草色都比着它算。 */
  baseM: number;
  /** 山高夸大几倍（frame.relief.times）。法线图按夸大以后的坡度算。 */
  reliefTimes: number;
  /** 要画在地面上的路：点缀里写了 line 的 roads。城里的街不在这里，在 cities 的 streets 里。 */
  roads: { type: 'street' | 'road'; line: Vec2[] }[];
  /** 要画在地面上的田：点缀里的 fields。area 是 null 时是整块沙盘的平地。green 是青苗：这一块整块画成草绿色。 */
  fields: { area: Vec2[] | null; seed: number; green?: boolean }[];
  /** 地面要画成浅色的院子：写了 paleYard 的院落围墙里面的那一圈（一圈一个，四个角）。没有就是空的。 */
  courts: Vec2[][];
}

/** 在任意一点取地面的数（格子之间按远近匀开）。出了沙盘取边上的值。 */
export interface GroundSamplers {
  height(x: number, z: number): number;
  waterH(x: number, z: number): number;
  edge(x: number, z: number): number;
  /** 这一点被修整垫高了多少米（见 Ground.lift）。 */
  lift(x: number, z: number): number;
  hill(x: number, z: number): number;
  hillSoft(x: number, z: number): number;
}

/** 现画出来的地面的颜色和法线。有先画好的图（StopTable.ground）而且对得上时不用现画颜色；法线总是现算（十几毫秒）。 */
export interface GroundPaint {
  /** 颜色图：w × h 个点，每点四个字节。前三个是颜色（sRGB），第四个是“这里有没有田”（细的田垄由着色器画）。 */
  colour: Uint8Array;
  w: number;
  h: number;
  /** 法线图：nx × nz 个点，每点四个字节。y 向上；山的坡度按夸大以后的算。 */
  normals: Uint8Array;
}

/** 地面上色用到的颜色。名字照样张 config.js 里 PAL 的“沙盘”一组，没有改。 */
export type GroundColour =
  /** 平地：茶色绢底。 */
  | 'tea'
  /** 平地：带一点藤黄。 */
  | 'teaWarm'
  /** 河边、洼地的草色。 */
  | 'meadow'
  /** 远看的田：三种浅色轮着上。 */
  | 'fieldA'
  | 'fieldB'
  | 'fieldC'
  /** 山脚：赭石。 */
  | 'ochre'
  /** 沟里：深赭。 */
  | 'ochreDeep'
  /** 山腰：石绿。 */
  | 'shilu'
  | 'shiluDeep'
  /** 山顶：石青。 */
  | 'shiqing'
  | 'shiqingDeep'
  /** 河岸留白。 */
  | 'sand'
  /** 水底。 */
  | 'bed'
  /** 画心四边留出的空绢。 */
  | 'blank'
  /** 城里的街巷。 */
  | 'road'
  /** 城外的路。 */
  | 'path'
  /** 城里的地面。 */
  | 'cityGround'
  /** 写明了要浅色的院子的地面。 */
  | 'court'
  /** 青苗的田。 */
  | 'sprout';

/** 地面怎么上色，由时代样式给（src/stage/three/style/）。地面这一边只管照着画。 */
export interface GroundStyle {
  /** 颜色，写成 '#rrggbb'。上色只从这里取颜色。 */
  colours: Record<GroundColour, string>;
  /**
   * 山上的分带。数是比平地（Ground.baseM）高出多少米，真实的米；每一带从第一个数起慢慢上色，到第二个数上足。
   * 样张的数：山脚 [2.4, 8]，山腰 [7, 22]，山顶 [40, 84]，最高处 [88, 125]。
   */
  bands: {
    /** 山脚：赭石。 */
    foot: Vec2;
    /** 山腰：石绿。 */
    green: Vec2;
    /** 山顶：石青。 */
    blue: Vec2;
    /** 最高处：深石青。 */
    deepBlue: Vec2;
  };
}
