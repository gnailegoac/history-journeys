// 给全程沙盘的地面上色的工具：彩绘地形模型（'painted-relief'）这一种样式的画法。登记在 ./painters.ts。
// 从这种样式定稿的样张搬来（它的 fields.js 里 prepare 和 build 上色的那一半、routetable.js 里画海的那一段着色器），加了类型；
// 数从场景、地面和“今天的海岸、湖、河”里来，不再从样张的数据文件来。栅格的小工具用 ./paint.ts 的。
// 它只是工具：src/ 里没有哪个文件引它，不进任何一块发出去的程序。只算数，不碰磁盘，不碰浏览器。
//
// 画出来两份，一样大（地面的一格画三个点，一个点合地上一公里上下）：
//   colour  颜色，一个点三个字节；
//   marks   水纹的标记，一个点一个字节。这种样式的海和湖上不画水纹：整张是 0。
//
// 上色的先后（照样张，数也是样张的）：
//   1 低地：谷底的黄绿和耕地的淡黄，水边偏绿，上面很淡的一块一块（手工上色的不匀，不是田界）；
//   2 丘陵：橄榄绿，比着“比四周低处高出多少，再加两成海拔”；
//   3 高山：灰褐的岩石，按海拔；
//   4 阴面：背着灯的坡上深一层，沟里深一点，脊上浅一点；
//   5 雪：一条按海拔定的带子，不是量出来的雪线。雪和岩石只画在一个圈里（阿尔卑斯山）和埃特纳火山四周 45 公里以内：
//     圈是画法自己的，不是说圈外没有雪；
//   6 留白的地方（recipe.blank）：一种素的浅灰，没有起伏、没有河、没有湖，海岸只留一道淡线；海照样是海；
//   7 岸边一道浅色；小河（场景没有挑、画法的单子里也没有的）是细的、淡的一层，只当地面的纹理；河照样张给每一条线的宽度画，大河宽、小河窄；湖，中间深一点；
//   8 一点手工上色的不匀；
//   9 海：近岸浅、离岸深，贴着岸不到一公里的一道浅色（样张是着色器现画的，这里画进图里，混色照样在线性的光里算）。
// 和样张不一样的几处：
//   上色照的海拔是沙盘的地面（约三公里一格），不是样张的 2.5 公里的格子。沙盘四边收低的那一圈，颜色照没收以前的海拔上（样张也是）：
//     地面上还留着数的地方都倒算回去；最外面的两圈格点（离边不到六公里）地面上是 0，倒算不了，照里面挨着的一圈上色（见 reliefHeights）；
//   河的宽度是样张的，可是写法不一样：样张照每条线的 rank 分档，这里的线只有名字，照名字写（见 RELIEF_PAINT.rankKm）；
//     宽度跟不了画面的比例（一张图要给九个画面用）；
//   大河的上游画窄了（样张没有近看过：罗讷河、莱茵河、因河、阿迪杰河在雪山中间同下游一样宽，像峡湾）：日内瓦湖以上的罗讷河、
//     博登湖以上的莱茵河、因斯布鲁克以上的因河、博岑以上的阿迪杰河、从布里恩茨湖上面一直到出图恩湖的阿勒河，都是 1.8 公里（见 reachKm）；
//   布伦纳山口两边的锡尔河、艾萨克河也是 1.8 公里，各在离山口 3 公里的地方停住（见 passKm）：两条河的线在山口上几乎碰头，
//     照样画就像一条河穿过了主山脊；
//   每个点自己跳的那一点颗粒不要了（压成 JPEG 就糊了，还白占字节）；
//   平地上的块用 ./paint.ts 的那一个函数（二十七八公里一块；样张是二十四公里），五种块里有一种换了颜色。

import type { RouteScene } from '../../../src/domain/scene';
import type { FrameCoords } from '../../../src/domain/sceneGeo';
import { curveInverse } from '../../../src/domain/sceneGeoRoute';
import type { LngLat } from '../../../src/domain/types';
import { clamp, fbm, hex, mix3, smoothstep } from '../../../src/stage/ground/num';
import { EDGE_ZERO_M, ROUTE_SOFTEN_CELLS, keepAt, routePictureSize, soften } from '../../../src/stage/ground/route';
import type { RouteGround } from '../../../src/stage/ground/route';
import type { Vec2, Vec3 } from '../../../src/stage/ground/types';
import { pickedLines } from '../../content/routeRules';
import type { TodayFeature } from '../../content/routeRules';
import { coverage, densify, fieldCell, gauss, linear, minFilter, screen, stampLine } from './paint';
import type { RiverPath, RoutePaintInput, RoutePainted } from './paint';

/**
 * 这个画法自己的数。颜色和分带都是定稿的样张的（它的 palette.js 的 PAL、fields.js 的 PAINT）。
 * colours：陆地的颜色仿的是照一座彩绘地形模型印出来的上色版画（样张的色表开头写的）——低地、丘陵、岩石、雪，丘陵、岩石、雪各带一种晕染用的深色。
 * riverWidths：河画多宽，照哪一种办法。'rank'：每一条线照样张给它的宽度（rankKm、reachKm）——定稿看过的是这一种，大河看得出是大河。
 *   'single'：一律 riverKm 公里；只为并排比一比、另做一遍图的时候用。要换，只改这一个词，别的不动。
 * riverKm：'single' 的时候每一条河的宽度；'rank' 的时候，场景里自己写了线的河、rankKm 里没有名字的河也用它。地上的公里，比实际宽得多。
 * rankKm：样张的河宽（它的 fields.js 的 riverWidthKm）。样张照 Natural Earth 给每条线的 rank 分档：rank 5 以内 4.4 公里，6、7 是 3.6，8、9 是 3.0，
 *   10 是 2.3，11、12 是 1.8；手工补的线（照今天的河道另取的那几条）2.2。“今天的海岸、湖、河”里的线没有 rank，只有名字，所以照名字写：
 *   每个名字底下，是样张里叫这个名字的线的那一档。
 * reachKm：一条线上从头一个点起的一段，另画一种宽度。from 是文件里那条线的头一个点，to 是这一段到哪个点为止（也得是那条线上的一个点；
 *   是最后一个点，就是整条线），km 是这一段的宽度；to 以后的照名字的那一档。两种来历：样张里同一个名字底下另一档的线（上游的一段 rank 是 11，
 *   或者是手工补的一段），和看了头一批真的图以后画窄的上游（1.8 公里）。
 * passKm：一条线在一个山口前面停住。from 是那条线的头一个点，place 是场景里那个山口的地名点的 id，km 是离山口多远就不画了：
 *   线上离山口最近的那一处往近的一头整段不画，往远的一头画到离山口 km 公里的地方为止。'single' 的时候也照样截。
 * reachKm 和 passKm 是照文件里的点一个数不差地认的。“今天的海岸、湖、河”重做以后（换了抽稀的办法、换了数据），哪一条认不出来了，
 *   画法不会悄悄退回整条线一个宽度：reliefReachProblems 把对不上的一条一条说出来，paintRelief 有一条对不上就停下来，一个点也不画。
 *   这两张单子（连同 rankKm、alsoRivers 里的名字）是这一座沙盘的：写的是歌德的全程沙盘上的河、它的“今天的海岸、湖、河”里的点、它的场景里的山口。
 *   另一座沙盘用这种画法，单子上的线在它的文件里找不到，画法就停在那一项检查上——那时候单子要改成一座沙盘一份。
 * minorKm、minorK：小河那一层多宽、盖上去几成。
 * alsoRivers：“今天的海岸、湖、河”里叫这些名字的河，场景没有挑（沙盘上没有它们的名字），也当河画——样张当河画的就是场景挑的那些加上这些；
 *   别的河都归到淡的那一层。
 * bands：比着的数是“比四周低处高出多少米 × relK + 海拔 × hK”，再加一点随机。hill、rock、snow：从多少到多少匀着过渡成橄榄绿、岩石、雪。
 *   rockOut：圈外面岩石从多高起（这张地面上圈外没有一处够得着，等于圈外不画岩石）。
 *   highZone：画雪和岩石的那一圈（经纬度）；volcano：圈外另一处，一座火山四周多少公里以内。steep：坡度从多少到多少匀着出阴面。patch：平地上的块盖上去几成。
 */
export const RELIEF_PAINT: {
  riverWidths: 'rank' | 'single';
  riverKm: number;
  rankKm: readonly { km: number; names: readonly string[] }[];
  reachKm: readonly { name: string; from: LngLat; to: LngLat; km: number }[];
  passKm: readonly { name: string; from: LngLat; place: string; km: number }[];
  minorKm: number;
  minorK: number;
  alsoRivers: readonly string[];
  colours: Record<
    'meadow' | 'arable' | 'meadow2' | 'arable2' | 'hill' | 'hillShade' | 'rock' | 'rockShade' | 'snow' | 'snowShade' | 'bank' | 'blank' | 'blankShore' | 'river' | 'lake' | 'lakeDeep' | 'sea' | 'seaDeep' | 'foam',
    string
  >;
  bands: {
    relK: number;
    hK: number;
    noise: number;
    hill: [number, number];
    rock: [number, number];
    rockNoise: number;
    snow: [number, number];
    snowNoise: number;
    rockOut: [number, number];
    highZone: LngLat[];
    volcano: { at: LngLat; km: number };
    steep: [number, number];
    patch: number;
  };
} = {
  riverWidths: 'rank',
  riverKm: 2.3,
  rankKm: [
    { km: 4.4, names: ['Danube', 'Donau', 'Elbe', 'Oder', 'Rhein', 'Rhine', 'Rhin', 'Vistula'] },
    { km: 3.6, names: ['Po', 'Rhône', 'Mosel', 'Tevere', 'Werra', 'Weser'] },
    { km: 3.0, names: ['Adige', 'Inn', 'Maas', 'Main', 'Vltava'] },
    { km: 2.3, names: ['Aare', 'Aisne', 'Arno', 'Isar', 'Neckar', 'Saale'] },
    // 锡尔河、艾萨克河在样张里是 2.2 和 2.3、2.2；看了图以后都画成 1.8
    { km: 1.8, names: ['Eger', 'Ill', 'Isarco / Eisack', 'Lahn', 'Reuss', 'Sill', 'Unstrut'] },
    { km: 2.2, names: ['Brenta', 'Ilm'] },
  ],
  reachKm: [
    // 样张里另一档的四条线（整条）
    { name: 'Elbe', from: [16.414, 50.364], to: [15.83, 50.22], km: 1.8 },
    { name: 'Oder', from: [17.198, 50.036], to: [18.228, 49.842], km: 1.8 },
    { name: 'Aisne', from: [4.966, 49.021], to: [4.774, 49.329], km: 2.2 },
    { name: 'Reuss', from: [8.555, 46.563], to: [8.613, 46.899], km: 2.2 },
    // 画窄的上游。罗讷河：从源头到日内瓦湖东头的那一条线，整条
    { name: 'Rhône', from: [8.379, 46.579], to: [6.866, 46.403], km: 1.8 },
    // 莱茵河：前莱茵河（源头到库尔上面两河会合的地方）和从那里到博登湖的那一条，各是整条
    { name: 'Rhein', from: [8.71, 46.623], to: [9.416, 46.835], km: 1.8 },
    { name: 'Rhein', from: [9.409, 46.835], to: [9.554, 47.511], km: 1.8 },
    // 因河是一条线从源头到帕绍：窄的一段到因斯布鲁克旁边的那个点为止（离城 2 公里，沿线 187 公里处）
    { name: 'Inn', from: [9.746, 46.403], to: [11.369, 47.275], km: 1.8 },
    // 阿迪杰河是一条线从源头到海：窄的一段到博岑西南、艾萨克河汇进来的那个点为止（离河口 0.9 公里，沿线 103 公里处）
    { name: 'Adige', from: [10.711, 46.827], to: [11.307, 46.485], km: 1.8 },
    // 阿勒河：流进布里恩茨湖以前的一条（照样张的 2.3 公里，它比它流进去的湖还宽）、布里恩茨湖里的一条、两湖之间的一条、图恩湖里的一条，各是整条
    { name: 'Aare', from: [8.32, 46.632], to: [8.048, 46.756], km: 1.8 },
    { name: 'Aare', from: [8.048, 46.756], to: [7.894, 46.706], km: 1.8 },
    { name: 'Aare', from: [7.894, 46.706], to: [7.82, 46.68], km: 1.8 },
    { name: 'Aare', from: [7.82, 46.68], to: [7.642, 46.75], km: 1.8 },
  ],
  passKm: [
    // 锡尔河的线从山口东南起、过山口往北到因斯布鲁克；艾萨克河的线从山口西边起、过山口往东南去（都是照今天的河道手工补的线）
    { name: 'Sill', from: [11.547, 46.991], place: 'brenner', km: 3 },
    { name: 'Isarco / Eisack', from: [11.471, 47], place: 'brenner', km: 3 },
  ],
  minorKm: 1.5,
  minorK: 0.5,
  alsoRivers: ['Vltava', 'Oder', 'Vistula', 'Rhône', 'Danube', 'Donau', 'Werra', 'Weser', 'Inn', 'Adige', 'Eger', 'Isarco / Eisack', 'Unstrut', 'Aisne', 'Neckar', 'Ill', 'Aare', 'Arno', 'Isar', 'Reuss', 'Sill'],
  colours: {
    meadow: '#cfd3a3',
    arable: '#dfd9b0',
    meadow2: '#c6cc98',
    arable2: '#e6e0bd',
    hill: '#8a9a64',
    hillShade: '#748659',
    rock: '#a79a86',
    rockShade: '#857763',
    snow: '#f5f4ef',
    snowShade: '#d8d5cc',
    bank: '#eef0de',
    blank: '#dce0e3',
    blankShore: '#a39d8c',
    river: '#4f7f9e',
    lake: '#a6c5d4',
    lakeDeep: '#82a9bf',
    sea: '#9ebdcd',
    seaDeep: '#7b9fb6',
    foam: '#dfe9ea',
  },
  bands: {
    relK: 1.0,
    hK: 0.2,
    noise: 70,
    hill: [95, 260],
    rock: [1350, 1850],
    rockNoise: 260,
    snow: [2200, 2450],
    snowNoise: 160,
    rockOut: [2500, 3000],
    highZone: [[5.0, 43.7], [7.9, 43.7], [8.3, 44.6], [9.6, 45.3], [12.0, 45.6], [14.2, 45.9], [16.6, 46.6], [16.6, 48.3], [13.0, 48.2], [9.5, 47.9], [6.8, 47.6], [5.0, 46.4]],
    volcano: { at: [15.0, 37.75], km: 45 },
    steep: [0.08, 0.5],
    patch: 0.3,
  },
};

/** 样张的两个尺寸：颜色图一个点合多少公里，高程一格多少公里。样张里按“几个点”“几格”写的数，在这里先换成公里再用。 */
const TRIAL_KM_PER_POINT = 1322.5 / 1412;
const TRIAL_KM_PER_CELL = 2.5;
/** 海和湖的边在图上化开多宽（“是不是水”从 0.5 − 这个数到 0.5 + 这个数匀着过渡）：约一个点。 */
const WATER_EDGE = 0.12;
/** 沙盘四边收低的那一圈，上色照的海拔倒算回去时，抹过的那个收低的数不到这么多的格点当它是 0（倒算不了）。 */
const EDGE_UNDO_NONE = 1e-6;
/** 平地上的块：./paint.ts 的函数给的三种记号，各用这个画法的哪一种颜色。 */
const FIELD_COLOUR = { fieldA: 'arable2', fieldB: 'meadow2', fieldC: 'meadow' } as const;

const samePoint = (a: LngLat, b: LngLat): boolean => a[0] === b[0] && a[1] === b[1];

/** 一个名字的那一档（rankKm）；单子上没有的名字用 riverKm。 */
function classKm(name: string): number {
  return RELIEF_PAINT.rankKm.find((item) => item.names.includes(name))?.km ?? RELIEF_PAINT.riverKm;
}

/**
 * “今天的海岸、湖、河”里的一条河的线，从头一个点起的那一段画多宽（地上的公里）：name 是它的名字，first 是它的头一个点。
 * 见 RELIEF_PAINT 的 riverWidths、reachKm。一条线上后面另有一段别的宽度的，见 reliefStrokes。
 */
export function reliefRiverKm(name: string, first: LngLat): number {
  if (RELIEF_PAINT.riverWidths === 'single') return RELIEF_PAINT.riverKm;
  const reach = RELIEF_PAINT.reachKm.find((item) => item.name === name && samePoint(item.from, first));
  return reach ? reach.km : classKm(name);
}

/** 一个点在沙盘上的位置，换成地上的公里（东、南）：量“离山口多远”用的是沙盘自己的尺。 */
type ToKm = (p: LngLat) => Vec2;
const kmOf = (scene: RouteScene, coords: FrameCoords): ToKm => {
  const k = scene.frame.scale / 1000;
  return (p) => {
    const [x, z] = coords.toLocal(p);
    return [x * k, z * k];
  };
};

/**
 * 一条线在山口前面停住：线上离山口最近的那一处，往近的一头整段不要；往远的一头，留下的从离山口正好 km 公里的地方起。
 * 留下的线照原来的先后。线到不了离山口 km 公里以内（没有什么可截），或者远的一头也在 km 公里以内（什么也留不下）：null。
 */
function shortOfPass(line: LngLat[], pass: LngLat, km: number, toKm: ToKm): LngLat[] | null {
  const c = toKm(pass);
  const pts = line.map(toKm);
  let best = Infinity;
  let bestAlong = 0;
  let along = 0;
  for (let i = 1; i < pts.length; i++) {
    const [ax, az] = pts[i - 1];
    const dx = pts[i][0] - ax;
    const dz = pts[i][1] - az;
    const len2 = dx * dx + dz * dz;
    const t = len2 > 0 ? clamp(((c[0] - ax) * dx + (c[1] - az) * dz) / len2, 0, 1) : 0;
    const d = Math.hypot(ax + t * dx - c[0], az + t * dz - c[1]);
    const len = Math.sqrt(len2);
    if (d < best) {
      best = d;
      bestAlong = along + t * len;
    }
    along += len;
  }
  if (best >= km) return null;
  // 山口在线的后半截：把线倒过来做，做完再倒回去
  const flip = bestAlong > along - bestAlong;
  const way = flip ? [...line].reverse() : line;
  const at = flip ? [...pts].reverse() : pts;
  const last = at[at.length - 1];
  if (Math.hypot(last[0] - c[0], last[1] - c[1]) < km) return null;
  // 从远的一头往回找：头一段碰到“离山口 km 公里”那个圈的线，取圈上靠远头的那个交点
  for (let i = at.length - 1; i >= 1; i--) {
    const [ax, az] = at[i - 1];
    const dx = at[i][0] - ax;
    const dz = at[i][1] - az;
    const fx = ax - c[0];
    const fz = az - c[1];
    const A = dx * dx + dz * dz;
    const B = 2 * (fx * dx + fz * dz);
    const disc = B * B - 4 * A * (fx * fx + fz * fz - km * km);
    if (A === 0 || disc < 0) continue;
    const t = (-B + Math.sqrt(disc)) / (2 * A);
    if (t < 0 || t > 1) continue;
    const a = way[i - 1];
    const b = way[i];
    const kept: LngLat[] = [[a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], ...way.slice(i)];
    return flip ? kept.reverse() : kept;
  }
  return null;
}

/**
 * “今天的海岸、湖、河”里的一条河的线画成哪几段，各多宽（经纬度的线）：
 * 单子上在山口前面停住的（passKm）截短了画，一种宽度；单子上分了段的（reachKm）是两段，接头的那个点两段都有；别的一整条。
 * 'single' 的时候每一段都是 riverKm，截短的照样截短。单子上的一条在这条线上对不上的时候，这里给的是整条线一种宽度——
 * 可是那样的时候 paintRelief 先就停下来了（reliefReachProblems），不会真这么画出来。
 */
export function reliefStrokes(name: string, line: LngLat[], scene: RouteScene, toKm: ToKm): { widthKm: number; line: LngLat[] }[] {
  const single = RELIEF_PAINT.riverWidths === 'single';
  const plainKm = single ? RELIEF_PAINT.riverKm : classKm(name);
  const pass = RELIEF_PAINT.passKm.find((item) => item.name === name && samePoint(item.from, line[0]));
  if (pass) {
    const place = scene.places.find((p) => p.id === pass.place);
    return [{ widthKm: plainKm, line: (place && shortOfPass(line, place.at, pass.km, toKm)) ?? line }];
  }
  const reach = RELIEF_PAINT.reachKm.find((item) => item.name === name && samePoint(item.from, line[0]));
  const at = reach ? line.findIndex((p) => samePoint(p, reach.to)) : -1;
  if (single || !reach || at < 1) return [{ widthKm: plainKm, line }];
  const strokes = [{ widthKm: reach.km, line: line.slice(0, at + 1) }];
  if (at < line.length - 1) strokes.push({ widthKm: classKm(name), line: line.slice(at) });
  return strokes;
}

/**
 * 画法的单子（reachKm、passKm）同“今天的海岸、湖、河”和场景对不对得上：对不上的一条一句话；都对得上是空的。
 * reachKm 的一条：文件里叫这个名字、头一个点是 from 的线正好一条；to 是那条线上头一个点以后的一个点；名字在 rankKm 里。
 * passKm 的一条：那样的线正好一条；场景里有 place 这个地名点；线真的走到离它 km 公里以内，截了以后还留得下一段；这条线不同时又在 reachKm 里。
 * 两张单子上的每一条线：场景里挑中它的那条河的取法没有用范围把它截短，也没有把它整条留在范围外面。
 * paintRelief 一开头就查，有一条对不上就停；做图的工具（npm run bake）和查“旧不旧”的测试都经过它。
 */
export function reliefReachProblems(scene: RouteScene, features: TodayFeature[], coords: FrameCoords): string[] {
  const problems: string[] = [];
  const toKm = kmOf(scene, coords);
  const linesFrom = (name: string, from: LngLat): LngLat[][] =>
    features
      .filter((feature) => feature.kind === 'river' && feature.name === name)
      .flatMap((feature) => feature.lines)
      .filter((line) => line.length >= 2 && samePoint(line[0], from));
  for (const reach of RELIEF_PAINT.reachKm) {
    const what = `reachKm 的“${reach.name}”从 [${reach.from.join(', ')}] 到 [${reach.to.join(', ')}]`;
    const lines = linesFrom(reach.name, reach.from);
    if (lines.length !== 1) problems.push(`${what}：文件里叫这个名字、从这个点起的线有 ${lines.length} 条，要正好一条`);
    else if (lines[0].findIndex((p) => samePoint(p, reach.to)) < 1) problems.push(`${what}：那条线上没有 to 这个点`);
    if (!RELIEF_PAINT.rankKm.some((item) => item.names.includes(reach.name))) problems.push(`${what}：rankKm 里没有这个名字`);
  }
  for (const pass of RELIEF_PAINT.passKm) {
    const what = `passKm 的“${pass.name}”从 [${pass.from.join(', ')}] 起、在“${pass.place}”前面 ${pass.km} 公里停住`;
    const lines = linesFrom(pass.name, pass.from);
    const place = scene.places.find((p) => p.id === pass.place);
    if (lines.length !== 1) problems.push(`${what}：文件里叫这个名字、从这个点起的线有 ${lines.length} 条，要正好一条`);
    if (!place) problems.push(`${what}：场景里没有这个地名点`);
    if (lines.length === 1 && place && !shortOfPass(lines[0], place.at, pass.km, toKm)) problems.push(`${what}：那条线走不到离它 ${pass.km} 公里以内，或者截了以后什么也不剩`);
    if (RELIEF_PAINT.reachKm.some((reach) => reach.name === pass.name && samePoint(reach.from, pass.from))) problems.push(`${what}：这条线又写在 reachKm 里`);
  }
  // 场景里一条河的取法写了范围（west、east、south、north），把单子上的一条线截短了，或者整条留在了范围外面：
  // 截短的线不照单子分段、不在山口前面停（见 riverStrokes），留在外面的不当这条河画——都不是单子写的样子，说出来
  const listed = [
    ...RELIEF_PAINT.reachKm.map((item) => ({ list: 'reachKm', name: item.name, from: item.from })),
    ...RELIEF_PAINT.passKm.map((item) => ({ list: 'passKm', name: item.name, from: item.from })),
  ];
  for (const river of scene.water.rivers) {
    for (const pick of river.today ?? []) {
      for (const item of listed) {
        if (!pick.names.includes(item.name)) continue;
        for (const feature of features) {
          if (feature.kind !== 'river' || feature.name !== item.name) continue;
          for (const line of feature.lines) {
            if (line.length < 2 || !samePoint(line[0], item.from)) continue;
            const runs = pickedLines([{ ...feature, lines: [line] }], [pick]);
            if (runs.length === 1 && runs[0].length === line.length) continue;
            problems.push(`${item.list} 的“${item.name}”从 [${item.from.join(', ')}] 起的那条线：场景里的河“${river.id}”的取法写了范围，这条线${runs.length === 0 ? '整条在范围外面' : '被截短了'}，单子上写的宽度和截短用不到它上面`);
          }
        }
      }
    }
  }
  return problems;
}

/** 画成河的一笔：一条线（沙盘里的米），和它多宽。 */
interface RiverStroke {
  widthKm: number;
  line: Vec2[];
}

/**
 * 场景里的一条河画成哪几笔。自己写的线（line）加密成顺滑的，宽度是 riverKm；照今天画的（today）是文件里取出来的线：
 * 整条都取到的，照 reliefStrokes 分段（一段一笔）；取法写了范围、线被截短的，一截一笔，宽度照文件里那条线从头一个点起的那一段
 *（单子上的分段和山口前面的截短不用在截短的线上）。先后同 pickedLines 取出来的一样。
 */
function riverStrokes(river: RouteScene['water']['rivers'][number], features: TodayFeature[], scene: RouteScene, coords: FrameCoords, stepM: number): RiverStroke[] {
  const local = (line: LngLat[]): Vec2[] => line.map((p) => coords.toLocal(p));
  if (river.line) return [{ widthKm: RELIEF_PAINT.riverKm, line: densify(local(river.line), stepM) }];
  const toKm = kmOf(scene, coords);
  const strokes: RiverStroke[] = [];
  for (const pick of river.today ?? []) {
    for (const feature of features) {
      if (feature.kind !== 'river' || !pick.names.includes(feature.name)) continue;
      for (const line of feature.lines) {
        if (line.length === 0) continue;
        for (const run of pickedLines([{ ...feature, lines: [line] }], [pick])) {
          if (run.length === line.length) for (const stroke of reliefStrokes(feature.name, line, scene, toKm)) strokes.push({ widthKm: stroke.widthKm, line: local(stroke.line) });
          else strokes.push({ widthKm: reliefRiverKm(feature.name, line[0]), line: local(run) });
        }
      }
    }
  }
  return strokes;
}

/**
 * 场景里每一条河画成什么线、多宽，一种颜色。线是取出来的线，不分段、不截短：自己写的线加密成顺滑的，照今天画的就是文件里取出来的线。
 * widthKm 是这条河最宽的一笔（一条河的几笔不都一样宽：易北河最上游的一条线是 1.8 公里，别的是 4.4；莱茵河博登湖以上是 1.8）。
 * 量“船走在水上”的测试、做岸线的工具拿的也是这一份；它们量的是线，不是宽度。
 */
export function reliefRivers(scene: RouteScene, features: TodayFeature[], coords: FrameCoords): RiverPath[] {
  const stepM = 6000 / scene.frame.scale;
  const local = (line: LngLat[]): Vec2[] => line.map((p) => coords.toLocal(p));
  return scene.water.rivers.map((river) => {
    const widest = riverStrokes(river, features, scene, coords, stepM).reduce((width, stroke) => Math.max(width, stroke.widthKm), 0) || RELIEF_PAINT.riverKm;
    const lines = river.line ? [densify(local(river.line), stepM)] : pickedLines(features, river.today ?? []).map(local);
    return { id: river.id, pale: false, widthKm: widest, lines };
  });
}

/**
 * 上色照的海拔（真实的米），地面的每个格点一个：留白压过的、沙盘四边收低的，都照没动以前的算。
 * 留白：照压过的算，留白的边上那一道坡自己成了一圈“丘陵”，所以除回去。
 * 四边：造地面的时候（src/stage/ground/route.ts 的第 3、4 步）每一格的海拔先乘了一个数（离边 6 公里以内是 0，到 edgeTaperM 是 1），
 *   再同四邻轻轻抹了一下。这里除的不是这一格自己的那个数，是把那个数照同一个小核抹过以后的：除出来的是这一格和四邻没收以前的海拔的一个平均
 *  （越靠边越偏向里面的格），不会把很小的数放大成山。
 *   倒算不了的只有最外面的格点：它自己和四邻乘的都是 0（离边不到 6 公里的两圈），地面上就是 0，什么也没留下。
 *   这些格点照挨着它、已经有数的格点的平均上色，一圈一圈往外抄：山的颜色一直到沙盘的边上，可是最外面这两圈是抄的，不是量的。
 * 抹的就是造地面的那个函数（route.ts 的 soften），不另抄一份。
 */
export function reliefHeights(scene: RouteScene, coords: FrameCoords, ground: RouteGround): Float32Array {
  const { nx, nz, cell } = ground;
  const N = nx * nz;
  const { scale } = scene.frame;
  const taper = scene.terrain.recipe.edgeTaperM;
  const zero = Math.min(EDGE_ZERO_M, taper / 2);
  // 每一格收低的时候乘的数，和它抹过以后的
  const kept = new Float32Array(N).fill(1);
  if (taper > 0) {
    for (let j = 0; j < nz; j++) {
      const z = ground.z0 + j * cell;
      for (let i = 0; i < nx; i++) {
        const x = ground.x0 + i * cell;
        kept[j * nx + i] = smoothstep(zero, taper, Math.min(x - coords.x0, coords.x1 - x, z - coords.z0, coords.z1 - z) * scale);
      }
    }
  }
  const keptSoft = soften(kept, nx, nz, ROUTE_SOFTEN_CELLS);
  const hp = new Float32Array(N);
  const known = new Uint8Array(N);
  let open: number[] = [];
  for (let k = 0; k < N; k++) {
    const keep = keepAt(ground.blank[k]);
    const pressed = keep < 1 ? scene.frame.datumM + curveInverse(scene.frame.relief, (ground.y[k] / keep) * scale) : ground.h[k];
    if (keptSoft[k] > EDGE_UNDO_NONE) {
      hp[k] = pressed / keptSoft[k];
      known[k] = 1;
    } else open.push(k);
  }
  // 倒算不了的格点：照挨着的、已经有数的格点的平均，一圈一圈往外
  while (open.length > 0) {
    const filled: [number, number][] = [];
    for (const k of open) {
      const i = k % nx;
      const j = (k - i) / nx;
      let sum = 0;
      let count = 0;
      for (let dj = -1; dj <= 1; dj++) {
        for (let di = -1; di <= 1; di++) {
          const ii = i + di;
          const jj = j + dj;
          if (ii < 0 || jj < 0 || ii >= nx || jj >= nz || !known[jj * nx + ii]) continue;
          sum += hp[jj * nx + ii];
          count += 1;
        }
      }
      if (count > 0) filled.push([k, sum / count]);
    }
    if (filled.length === 0) break;
    for (const [k, value] of filled) {
      hp[k] = value;
      known[k] = 1;
    }
    open = open.filter((k) => !known[k]);
  }
  return hp;
}

/** 一点在不在一圈线里面（沙盘里的米）。 */
function inside(x: number, z: number, ring: Vec2[]): boolean {
  let hit = false;
  for (let a = 0, b = ring.length - 1; a < ring.length; b = a++) {
    if (ring[a][1] > z !== ring[b][1] > z && x < ring[a][0] + ((ring[b][0] - ring[a][0]) * (z - ring[a][1])) / (ring[b][1] - ring[a][1])) hit = !hit;
  }
  return hit;
}

/** 给全程沙盘的地面上色。同样的输入画出同样的字节。 */
export function paintRelief(input: RoutePaintInput): RoutePainted {
  const { scene, coords, ground, features, style } = input;
  // 画法的单子同文件、场景对不上：停下来，一个点也不画（不悄悄退回整条线一个宽度）
  const reachProblems = reliefReachProblems(scene, features, coords);
  if (reachProblems.length > 0) throw new Error(`画法的单子（tests/tools/route/paintRelief.ts 的 reachKm、passKm）同“今天的海岸、湖、河”或者场景对不上，不往下画：${reachProblems.join('；')}`);
  const P = RELIEF_PAINT.bands;
  const { nx, nz, cell } = ground;
  const { w: W, h: H } = routePictureSize(ground);
  const POINTS = (W - 1) / (nx - 1);
  const N = nx * nz;
  const { scale } = scene.frame;
  const cellKm = (cell * scale) / 1000;
  const kmPerPoint = cellKm / POINTS;
  /** 样张里按“几个点”写的宽度，在这张图上是几个点；按“几格”写的，在这张网格上是几格。 */
  const points = (trialPoints: number): number => (trialPoints * TRIAL_KM_PER_POINT) / kmPerPoint;
  const cells = (trialCells: number): number => (trialCells * TRIAL_KM_PER_CELL) / cellKm;
  /** 沙盘里的米 → 图上的“点”坐标（第 i 个点占 [i, i + 1)，它的正中在沙盘里的 x0 + i × 格宽 ÷ 3）。 */
  const localToPoint = ([x, z]: Vec2): Vec2 => [((x - coords.x0) / cell) * POINTS + 0.5, ((z - coords.z0) / cell) * POINTS + 0.5];
  const toPoint = (p: LngLat): Vec2 => localToPoint(coords.toLocal(p));
  /** 图上的一个点落在地面网格的哪里（格），取那里的留白的数。 */
  const blankAt = (p: LngLat): number => {
    const [x, z] = coords.toLocal(p);
    const i = clamp(Math.round((x - ground.x0) / cell), 0, nx - 1);
    const j = clamp(Math.round((z - ground.z0) / cell), 0, nz - 1);
    return ground.blank[j * nx + i];
  };

  // ---------- 备料：岸线、湖、河（图那么大的栅格）
  // 岸线：今天的陆地，减掉抹成海的几圈
  const land = coverage(W, H, features.filter((f) => f.kind === 'land').flatMap((f) => f.polygons.flat().map((ring) => ring.map(toPoint))));
  for (const edit of scene.terrain.edits) {
    if (edit.op !== 'sea' || edit.area.length < 3) continue;
    const erase = coverage(W, H, [edit.area.map(toPoint)]);
    for (let i = 0; i < land.length; i++) land[i] *= 1 - erase[i];
  }
  // 湖：文件里的每一个湖都画（场景挑中的那几个在里面）；中心落在留白里的不画
  const lakeRings = features
    .filter((f) => f.kind === 'lake')
    .flatMap((f) => f.polygons)
    .filter((polygon) => {
      const outer = polygon[0] ?? [];
      const mid: LngLat = [outer.reduce((s, p) => s + p[0], 0) / (outer.length || 1), outer.reduce((s, p) => s + p[1], 0) / (outer.length || 1)];
      return outer.length >= 3 && blankAt(mid) > 0.5;
    });
  const lake = coverage(W, H, lakeRings.flatMap((polygon) => polygon.map((ring) => ring.map(toPoint))));
  for (let i = 0; i < lake.length; i++) lake[i] *= land[i];
  const lakeIn = gauss(lake, W, H, points(2.2));
  // 海
  const wat = new Float32Array(W * H);
  for (let i = 0; i < wat.length; i++) wat[i] = 1 - land[i];
  // 岸线的软边只抹不到一个点：再宽，两三公里宽的小岛整个化在岸边那道浅色里
  const sdf = gauss(wat, W, H, points(0.7));
  const wide = gauss(wat, W, H, points(26));
  // 河：场景里的和单子上的照常画；别的画成细的、淡的一层
  const riv = new Float32Array(W * H);
  const rivMinor = new Float32Array(W * H);
  const stepM = 6000 / scale;
  for (const river of scene.water.rivers) {
    for (const stroke of riverStrokes(river, features, scene, coords, stepM)) if (stroke.line.length >= 2) stampLine(riv, W, H, stroke.line.map(localToPoint), stroke.widthKm / kmPerPoint / 2);
  }
  // 文件里的每一条河的线：单子上的当河画（各照它的宽度，分了段的一段一笔，山口前面截短的截短了画），
  // 别的都进淡的那一层（场景挑中的也在里面：它上面盖着照常画的那一道，看不出来）
  const toKm = kmOf(scene, coords);
  for (const feature of features) {
    if (feature.kind !== 'river') continue;
    const also = RELIEF_PAINT.alsoRivers.includes(feature.name);
    for (const line of feature.lines) {
      if (line.length < 2) continue;
      if (also) for (const stroke of reliefStrokes(feature.name, line, scene, toKm)) stampLine(riv, W, H, stroke.line.map(toPoint), stroke.widthKm / kmPerPoint / 2);
      else stampLine(rivMinor, W, H, line.map(toPoint), RELIEF_PAINT.minorKm / kmPerPoint / 2);
    }
  }
  // 离水近不近（水边的草色、岸边的一道浅色）
  const anyWater = new Float32Array(W * H);
  for (let i = 0; i < anyWater.length; i++) anyWater[i] = Math.max(wat[i], lake[i], riv[i]);
  const near = gauss(anyWater, W, H, points(11));
  const bank = gauss(anyWater, W, H, points(1.6));

  // ---------- 备料：地面网格上的东西
  // 上色照的海拔：留白压过的、四边收低的，都照没动以前的算
  const hp = reliefHeights(scene, coords, ground);
  const n1 = new Float32Array(N);
  const n2 = new Float32Array(N);
  const n3 = new Float32Array(N);
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const x = i * cellKm;
      const y = j * cellKm;
      const k = j * nx + i;
      n1[k] = fbm(x / 290, y / 290, 4, 3);
      n2[k] = fbm(x / 62, y / 62, 4, 9);
      n3[k] = fbm(x / 160, y / 160, 3, 21);
    }
  }
  // 山有多“山”：比四周（三十公里上下）的低处高出多少
  const base = gauss(minFilter(hp, nx, nz, Math.max(1, Math.round(cells(12)))), nx, nz, cells(10));
  const lr = new Float32Array(N);
  for (let k = 0; k < N; k++) lr[k] = Math.max(0, hp[k] - base[k]);
  const smooth = gauss(hp, nx, nz, cells(2.6));
  const cv = new Float32Array(N); // 比两边凸出来多少（山脊是正的，沟是负的）
  for (let k = 0; k < N; k++) cv[k] = hp[k] - smooth[k];
  // 坡向和坡度（画阴面用）：按统一 10 倍算，和山高怎么夸大无关
  const pgx = new Float32Array(N);
  const pgz = new Float32Array(N);
  const run = 2 * cellKm * 1000;
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      pgx[k] = ((hp[j * nx + Math.min(nx - 1, i + 1)] - hp[j * nx + Math.max(0, i - 1)]) * 10) / run;
      pgz[k] = ((hp[Math.min(nz - 1, j + 1) * nx + i] - hp[Math.max(0, j - 1) * nx + i]) * 10) / run;
    }
  }
  const sampleGrid = (f: Float32Array, fx: number, fy: number): number => {
    const x = clamp(fx, 0, nx - 1.001);
    const y = clamp(fy, 0, nz - 1.001);
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const ax = x - ix;
    const ay = y - iy;
    const o = iy * nx + ix;
    return f[o] * (1 - ax) * (1 - ay) + f[o + 1] * ax * (1 - ay) + f[o + nx] * (1 - ax) * ay + f[o + nx + 1] * ax * ay;
  };

  // ---------- 上色
  const C = Object.fromEntries(Object.entries(RELIEF_PAINT.colours).map(([name, value]) => [name, hex(value)])) as Record<keyof typeof RELIEF_PAINT.colours, Vec3>;
  const CREST: Vec3 = [255, 252, 238];
  const SEA = [linear(C.sea[0]), linear(C.sea[1]), linear(C.sea[2])];
  const SEA_DEEP = [linear(C.seaDeep[0]), linear(C.seaDeep[1]), linear(C.seaDeep[2])];
  const FOAM = [linear(C.foam[0]), linear(C.foam[1]), linear(C.foam[2])];
  // 雪和岩石的圈（沙盘里的米）
  const zone = P.highZone.map((p) => coords.toLocal(p));
  const volcano = coords.toLocal(P.volcano.at);
  const volcanoM = (P.volcano.km * 1000) / scale;
  const inHigh = (x: number, z: number): boolean => Math.hypot(x - volcano[0], z - volcano[1]) < volcanoM || inside(x, z, zone);
  // 光从哪边来（东、南两个分量）：就是这种样式的那一盏灯
  const lamp = style.light('day').dir;
  const lampLen = Math.hypot(lamp[0], lamp[2]) || 1;
  const Lx = lamp[0] / lampLen;
  const Lz = lamp[2] / lampLen;

  const colour = new Uint8Array(W * H * 3);
  const marks = new Uint8Array(W * H);
  for (let j = 0; j < H; j++) {
    const fy = j / POINTS;
    const yk = j * kmPerPoint;
    for (let i = 0; i < W; i++) {
      const fx = i / POINTS;
      const xk = i * kmPerPoint;
      const t = j * W + i;
      const sd = sdf[t];
      const st = sampleGrid(ground.blank, fx, fy);
      const h = sampleGrid(hp, fx, fy);
      const rel = sampleGrid(lr, fx, fy);
      const curv = sampleGrid(cv, fx, fy);
      const a1 = sampleGrid(n1, fx, fy);
      const a2 = sampleGrid(n2, fx, fy);
      const a3 = sampleGrid(n3, fx, fy);

      // 1 低地：谷底的黄绿和耕地的淡黄，水边偏绿
      let col = mix3(C.meadow, C.arable, smoothstep(0.38, 0.66, a1 + 0.3 * (a3 - 0.5)));
      const wet = smoothstep(0.035, 0.3, near[t]) * (1 - smoothstep(60, 220, h)) * smoothstep(0.2, 0.6, a3 + 0.15);
      col = mix3(col, C.meadow, wet * 0.6);
      const plainK = (1 - smoothstep(35, 110, rel * 0.6 + h * 0.12)) * (1 - smoothstep(0.3, 0.55, sd));
      if (plainK > 0.02) {
        const fc = fieldCell(xk, yk);
        if (fc.tint) col = mix3(col, C[FIELD_COLOUR[fc.tint]], plainK * smoothstep(0.02, 0.2, fc.border) * P.patch);
      }
      // 2 丘陵：橄榄绿，按“比四周高出多少”和海拔一起定
      const m = rel * P.relK + h * P.hK + (a2 - 0.5) * P.noise + curv * 0.5;
      const tHill = smoothstep(P.hill[0], P.hill[1], m);
      col = mix3(col, C.hill, tHill * 0.96);
      // 3 高山：灰褐的岩石，按海拔；圈外面从 rockOut 起
      const high = h > 1000 ? inHigh(coords.x0 + (i * cell) / POINTS, coords.z0 + (j * cell) / POINTS) : true;
      const rockBand = high ? P.rock : P.rockOut;
      const tRock = smoothstep(rockBand[0], rockBand[1], h + (a2 - 0.5) * P.rockNoise + curv * 0.6);
      col = mix3(col, C.rock, tRock);
      // 4 阴面：背着光的坡上深一层；沟里深一点，脊上浅一点
      let steep = 0;
      let away = 0;
      if (tHill > 0.02 || h > P.snow[0] - 400) {
        const dx = sampleGrid(pgx, fx, fy);
        const dz = sampleGrid(pgz, fx, fy);
        const gl = Math.hypot(dx, dz) || 1e-6;
        steep = smoothstep(P.steep[0], P.steep[1], gl);
        // 下坡的方向是 (−dx, −dz)；同“朝着光”的方向相反就是阴面
        away = clamp((dx * Lx + dz * Lz) / gl, 0, 1);
      }
      const gully = smoothstep(18, 150, -curv) * steep;
      col = mix3(col, mix3(C.hillShade, C.rockShade, tRock), clamp(steep * (0.18 + 0.82 * away) * 0.72 + gully * 0.3, 0, 1) * tHill);
      col = mix3(col, CREST, smoothstep(25, 190, curv) * tHill * 0.14);
      // 5 雪：一条按海拔定的带子，只在圈里
      const tSnow = high ? smoothstep(P.snow[0], P.snow[1], h + (a2 - 0.5) * P.snowNoise + curv * 0.5) : 0;
      if (tSnow > 0) col = mix3(col, mix3(C.snow, C.snowShade, clamp(steep * (0.15 + 0.85 * away) + gully * 0.5, 0, 1)), tSnow);

      // 6 留白：素的浅色，海岸一道淡线。陆地上画的东西（河、湖、岸边的浅色）跟着淡掉
      const shown = smoothstep(0.35, 0.65, st);
      if (st < 0.999) col = mix3(col, C.blank, 1 - smoothstep(0.2, 0.8, st));
      if (st < 0.5 && sd > 0.06) col = mix3(col, C.blankShore, smoothstep(0.1, 0.42, sd) * (1 - smoothstep(0.1, 0.5, st)) * 0.6);
      // 7 岸边一道浅色，小河，河，湖（中间深一点）
      const lk = lake[t] * shown;
      col = mix3(col, C.bank, clamp(bank[t] * 2.2, 0, 1) * 0.28 * shown * (1 - lk));
      const rm = rivMinor[t] * shown * (1 - lk);
      if (rm > 0) col = mix3(col, C.river, rm * RELIEF_PAINT.minorK);
      const rv = riv[t] * shown * (1 - lk);
      if (rv > 0) col = mix3(col, C.river, rv * 0.95);
      if (lk > 0) col = mix3(col, mix3(C.lake, C.lakeDeep, smoothstep(0.55, 0.98, lakeIn[t])), lk);
      // 8 一点手工上色的不匀
      const grain = (fbm(xk / 7.5, yk / 7.5, 2, 31) - 0.5) * 8;
      let r = col[0] + grain;
      let g = col[1] + grain;
      let b = col[2] + grain * 0.9;

      // 9 海：一个平面，近岸浅、离岸深，贴着岸的一道浅色，一点不匀。混色在线性的光里算
      const water = smoothstep(0.5 - WATER_EDGE, 0.5 + WATER_EDGE, sd);
      if (water > 0) {
        const deep = smoothstep(0.56, 0.97, wide[t]);
        const fringe = (1 - smoothstep(0.5, 0.76, sd)) * 0.5;
        const uneven = 1 + 0.04 * (fbm(xk / 72, yk / 72, 1, 41) - 0.5) + 0.025 * (fbm(xk / 16, yk / 16, 1, 43) - 0.5);
        const before = [linear(r), linear(g), linear(b)];
        const after = [0, 0, 0];
        for (let c = 0; c < 3; c++) {
          const tone = SEA[c] + (SEA_DEEP[c] - SEA[c]) * deep;
          const wc = (tone + (FOAM[c] - tone) * fringe) * uneven;
          after[c] = screen(before[c] + (wc - before[c]) * water);
        }
        [r, g, b] = after;
      }
      const o = t * 3;
      colour[o] = clamp(Math.round(r), 0, 255);
      colour[o + 1] = clamp(Math.round(g), 0, 255);
      colour[o + 2] = clamp(Math.round(b), 0, 255);
    }
  }
  return { w: W, h: H, colour, marks };
}
