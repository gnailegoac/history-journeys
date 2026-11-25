// 做“今天的岸线、湖、河”那个文件要用的几样。用它们的是 tests/tools/route-tools.test.ts（npm run route:today）；只在 Node 里跑。
//
// 文件 content/figures/<人物>/scenes/route.today.geojson 是一份 GeoJSON（FeatureCollection）：
//   每一项的 properties 是 { kind, name }：kind 是 land（陆地的一圈）、lake（湖的一圈）、river（河的一条线）；
//   name 是 Natural Earth 里的名字（Chang Jiang、Huang、Tai Hu ……）；它没给名字的，工具照位置起一个：
//   湖和陆地用这一圈的中心，河用线的头一个点，写成 lake@116.89,32.39 这样（两位小数）。
//   同一个名字可以有好几项（一条河分成几段；出了方框又回来的河，裁开以后也是几项）。
//   坐标是 [经度, 纬度]，三位小数；一圈的头尾是同一个点，照 GeoJSON 的规矩逆时针走。
// 场景文件照名字从里面挑要画的；页面不读它，读它的是给地面上色的工具、内容校验和测试。
//
// 给哪一位人物做、他的源数据在哪、裁到哪个方框、哪个湖要放回原来的大小，写在 ./figures.ts 的那张表里（一位人物一行）。
// 下面说的是苏轼的那一份：
// 它是从样张的 spikes/art-direction/route/data/water.json 做的（那是 Natural Earth 1:10m 裁出来的，公有领域）：
//   陆地：样张已经裁到方框（东经 100.3 到 124.3，北纬 16.8 到 39.3）；这里去掉一模一样的重复的圈，把没合上的圈合上。
//   河：出了方框的部分裁掉。
//   三样都按 0.6 公里抽稀（道格拉斯-普克算法，在沙盘的投影上量公里）；一抽稀就剩不下一个面的小岛，原样留着不抽。
// 样张做 water.json 的时候已经去掉了一些东西（后来才有的湖和水库、今天才这样流的河段、不到 40 平方公里的湖、
// 桌面以外的河），它们的线不在这台机器的任何文件里，所以这个文件里也没有；去掉了哪些，water.json 的 removed 里记着，
// 工具每次都印出来。另有一处样张改过的：今天的高邮湖被它按中心缩到了六成，这里照它记下的中心放回原来的大小
//（来回各有一次三位小数的取整，放回去以后差不到 0.15 公里）。

import type { LngLat } from './terrainTool';

// ---------------------------------------------------------------- 样张的 water.json

export interface TrialLake {
  name: string | null;
  zh: string | null;
  /** 这一圈的中心。 */
  at: LngLat;
  km2: number;
  /** 样张改过这个湖的话，这里有一句说明。 */
  note?: string;
  ring: LngLat[];
}

export interface TrialRiver {
  name: string | null;
  zh: string | null;
  rank: number;
  /** 样张把这条线截短了的话，这里有一句说明。 */
  cut?: string;
  line: LngLat[];
}

/** 样张做数据时去掉的一样东西。 */
export interface TrialRemoved {
  kind: string;
  name: string;
  why: string;
  at?: LngLat;
  km2?: number;
  from?: LngLat;
  to?: LngLat;
}

export interface TrialWater {
  land: LngLat[][];
  lakes: TrialLake[];
  rivers: TrialRiver[];
  removed: TrialRemoved[];
}

// ---------------------------------------------------------------- 做出来的文件

export type TodayKind = 'land' | 'lake' | 'river';

export interface TodayFeature {
  type: 'Feature';
  properties: { kind: TodayKind; name: string };
  geometry: { type: 'Polygon'; coordinates: LngLat[][] } | { type: 'LineString'; coordinates: LngLat[] };
}

export interface Box {
  west: number;
  east: number;
  south: number;
  north: number;
}

// 文件裁到哪个方框、源数据里哪个湖被缩小过，是一位人物一份的：写在 ./figures.ts 的那张表里，从那里交进来。

/** 抽稀到多细（公里）。 */
export const THIN_KM = 0.6;

/** 源数据改过的一个湖：名字，按中心缩到了几成。工具照这个放回原来的大小。 */
export interface ShrunkLake {
  name: string;
  factor: number;
}

// ---------------------------------------------------------------- 小工具

/** 取三位小数。 */
export const r3 = (v: number): number => Math.round(v * 1000) / 1000;

const same = (a: LngLat, b: LngLat): boolean => a[0] === b[0] && a[1] === b[1];

/** 两位小数的写法：先取三位小数，再取两位，末位是 5 的往上进（116.885 写成 116.89）。 */
function two(v: number): string {
  return (Math.round(Math.round(v * 1000) / 10) / 100).toFixed(2);
}

/** 没有名字的东西照位置起的名字，如 lake@116.89,32.39。 */
export function positionName(kind: TodayKind, at: LngLat): string {
  return `${kind}@${two(at[0])},${two(at[1])}`;
}

/** 一圈围住的面积（平方度，带正负：逆时针是正的）。头尾是不是同一个点都行。 */
export function signedArea(ring: LngLat[]): number {
  let sum = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    sum += a[0] * b[1] - b[0] * a[1];
  }
  return sum / 2;
}

/** 一圈的中心（照面积算的；面积是 0 的取各点的平均）。 */
export function ringCentre(ring: LngLat[]): LngLat {
  let area = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    const c = a[0] * b[1] - b[0] * a[1];
    area += c;
    cx += (a[0] + b[0]) * c;
    cy += (a[1] + b[1]) * c;
  }
  if (area === 0) return [ring.reduce((s, p) => s + p[0], 0) / ring.length, ring.reduce((s, p) => s + p[1], 0) / ring.length];
  return [cx / (3 * area), cy / (3 * area)];
}

/** 头尾不是同一个点的，把头一个点补在最后。 */
export function closeRing(ring: LngLat[]): LngLat[] {
  return same(ring[0], ring[ring.length - 1]) ? ring.slice() : [...ring, ring[0]];
}

/** 一点在不在一圈里面（正好在边上的不保证算哪边）。 */
export function insideRing(p: LngLat, ring: LngLat[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i];
    const b = ring[j];
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

/**
 * 把一条线抽稀（道格拉斯-普克）：头尾留着；中间的点，离“留下的两个点连成的线段”超过 tolKm 公里的才留。
 * toKm 把经纬度换成公里。头尾是同一个点的圈也行（这时先留下离它最远的那个点）。
 */
export function thin(points: LngLat[], tolKm: number, toKm: (lng: number, lat: number) => [number, number]): LngLat[] {
  if (points.length < 3) return points.slice();
  const km = points.map((p) => toKm(p[0], p[1]));
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [a, b] = stack.pop() as [number, number];
    const ax = km[a][0];
    const ay = km[a][1];
    const dx = km[b][0] - ax;
    const dy = km[b][1] - ay;
    const l2 = dx * dx + dy * dy || 1e-9;
    let worst = -1;
    let far = tolKm;
    for (let i = a + 1; i < b; i++) {
      const t = Math.max(0, Math.min(1, ((km[i][0] - ax) * dx + (km[i][1] - ay) * dy) / l2));
      const d = Math.hypot(km[i][0] - ax - dx * t, km[i][1] - ay - dy * t);
      if (d > far) {
        far = d;
        worst = i;
      }
    }
    if (worst > 0) {
      keep[worst] = 1;
      stack.push([a, worst], [worst, b]);
    }
  }
  return points.filter((_p, i) => keep[i] === 1);
}

/** 线段 a→b 在方框里的那一截：从几成到几成（0 是 a，1 是 b）；整段在外面是 null。 */
function clipSegment(a: LngLat, b: LngLat, box: Box): [number, number] | null {
  let t0 = 0;
  let t1 = 1;
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const sides: [number, number][] = [
    [-dx, a[0] - box.west],
    [dx, box.east - a[0]],
    [-dy, a[1] - box.south],
    [dy, box.north - a[1]],
  ];
  for (const [p, q] of sides) {
    if (p === 0) {
      if (q < 0) return null;
      continue;
    }
    const r = q / p;
    if (p < 0) {
      if (r > t1) return null;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return null;
      if (r < t1) t1 = r;
    }
  }
  return [t0, t1];
}

/**
 * 把一条线裁到方框里：出了方框的部分去掉，进出的地方添上正好在框边上的点（三位小数）。
 * 出去又回来的线裁成几段；整条都在里面的，原样一段。不到两个点的段不要。
 */
export function clipLineToBox(line: LngLat[], box: Box): LngLat[][] {
  const pieces: LngLat[][] = [];
  let current: LngLat[] = [];
  const add = (p: LngLat): void => {
    if (current.length === 0 || !same(current[current.length - 1], p)) current.push(p);
  };
  const flush = (): void => {
    if (current.length >= 2) pieces.push(current);
    current = [];
  };
  const at = (a: LngLat, b: LngLat, t: number): LngLat => [r3(a[0] + (b[0] - a[0]) * t), r3(a[1] + (b[1] - a[1]) * t)];
  for (let k = 0; k + 1 < line.length; k++) {
    const a = line[k];
    const b = line[k + 1];
    const part = clipSegment(a, b, box);
    if (!part) {
      flush();
      continue;
    }
    const [t0, t1] = part;
    if (t0 > 0) flush();
    add(t0 > 0 ? at(a, b, t0) : a);
    add(t1 < 1 ? at(a, b, t1) : b);
    if (t1 < 1) flush();
  }
  flush();
  return pieces;
}

/** 把样张按中心缩小过的一圈放回原来的大小。at 是样张记下的中心，factor 是它缩到的几成。 */
export function restoreShrunk(ring: LngLat[], at: LngLat, factor: number): LngLat[] {
  return ring.map((p) => [r3(at[0] + (p[0] - at[0]) / factor), r3(at[1] + (p[1] - at[1]) / factor)]);
}

/** 抽稀一圈，再让它逆时针走。抽稀以后剩不下一个面（不到四个点，或者面积是 0）的，原样留着不抽；whole 说是不是原样留的。 */
function thinRing(ring: LngLat[], tolKm: number, toKm: (lng: number, lat: number) => [number, number]): { ring: LngLat[]; whole: boolean } {
  const closed = closeRing(ring);
  let out = thin(closed, tolKm, toKm);
  const whole = out.length < 4 || signedArea(out) === 0;
  if (whole) out = closed;
  if (signedArea(out) < 0) out = out.slice().reverse();
  return { ring: out.map((p) => [r3(p[0]), r3(p[1])]), whole };
}

// ---------------------------------------------------------------- 做文件

export interface TodayReport {
  land: {
    /** 样张的文件里有几圈、多少个点。 */
    ringsIn: number;
    pointsIn: number;
    /** 一模一样的重复的圈有几个（去掉了）。 */
    duplicates: number;
    /** 不成一个面的圈（不到三个不同的点），去掉了；记下它们的头一个点。 */
    degenerate: LngLat[];
    /** 去掉重复和不成面的以后多少个点（抽稀以前）。 */
    pointsUnique: number;
    /** 写进文件的有几圈、多少个点；其中原样留着没抽稀的几圈。 */
    ringsOut: number;
    pointsOut: number;
    keptWhole: number;
  };
  lakes: { ringsIn: number; pointsIn: number; ringsOut: number; pointsOut: number; restored: string[] };
  rivers: {
    linesIn: number;
    pointsIn: number;
    /** 写进文件的有几条、多少个点。 */
    linesOut: number;
    pointsOut: number;
    /** 被方框裁过的河：名字，裁成了几段。 */
    clipped: { name: string; pieces: number }[];
  };
  /** 工具起了名字的：名字，样张给它认的中文名（没有就是 null）。 */
  named: { name: string; zh: string | null }[];
}

const count = (lines: LngLat[][]): number => lines.reduce((sum, line) => sum + line.length, 0);

/**
 * 从样张的 water.json 做出文件里的每一项，先陆地、再湖、再河，各照样张里的先后。
 * toKm 是沙盘的投影（抽稀时量公里用）。box 是文件裁到的方框，shrunk 是源数据里缩小过、要放回原来大小的湖
 *（两样都是这位人物在 ./figures.ts 里的那一行写的）。样张的文件不是工具认得的样子（陆地里有套着的圈、
 * 有工具不知道的改动、湖出了方框）就停下来说，不硬做。
 */
export function todayFeatures(
  water: TrialWater,
  toKm: (lng: number, lat: number) => [number, number],
  box: Box,
  shrunk: readonly ShrunkLake[],
  tolKm: number = THIN_KM,
): { features: TodayFeature[]; report: TodayReport } {
  const features: TodayFeature[] = [];
  const named: { name: string; zh: string | null }[] = [];
  const inBox = (p: LngLat): boolean => p[0] >= box.west && p[0] <= box.east && p[1] >= box.south && p[1] <= box.north;

  // 陆地：去掉一模一样的重复的圈和不成面的圈
  const seen = new Set<string>();
  const unique: LngLat[][] = [];
  const degenerate: LngLat[] = [];
  let duplicates = 0;
  for (const ring of water.land) {
    const key = JSON.stringify(ring);
    if (seen.has(key)) {
      duplicates += 1;
      continue;
    }
    seen.add(key);
    if (new Set(ring.map((p) => `${p[0]},${p[1]}`)).size < 3) {
      degenerate.push(ring[0]);
      continue;
    }
    if (!ring.every(inBox)) throw new Error(`样张的陆地有一圈出了方框（头一个点 ${ring[0][0]}, ${ring[0][1]}）：这个工具不裁陆地，只认样张裁好的`);
    unique.push(ring);
  }
  // 没有一圈套在另一圈里面（陆地里的洞）：有的话“落在哪一圈里就是陆地”就不对了
  unique.forEach((ring, i) => {
    const j = unique.findIndex((other, k) => k !== i && insideRing(ring[0], other));
    if (j >= 0) throw new Error(`样张的陆地里第 ${i} 圈（头一个点 ${ring[0][0]}, ${ring[0][1]}）在另一圈里面：是洞，还是没去干净的重复？这个工具不认`);
  });
  let landPoints = 0;
  let keptWhole = 0;
  for (const ring of unique) {
    const { ring: out, whole } = thinRing(ring, tolKm, toKm);
    if (whole) keptWhole += 1;
    landPoints += out.length;
    features.push({ type: 'Feature', properties: { kind: 'land', name: positionName('land', ringCentre(ring)) }, geometry: { type: 'Polygon', coordinates: [out] } });
  }

  // 湖
  const restored: string[] = [];
  let lakePoints = 0;
  for (const lake of water.lakes) {
    let ring = lake.ring;
    const known = shrunk.find((item) => item.name === lake.name);
    if (lake.note !== undefined) {
      if (!known) throw new Error(`样张改过“${lake.name ?? lake.zh ?? '没有名字的湖'}”（${lake.note}），这个工具不知道这一处改动`);
      ring = restoreShrunk(ring, lake.at, known.factor);
      restored.push(known.name);
    } else if (known) {
      throw new Error(`样张里的 ${known.name} 没有带着“缩小过”的说明：不是这个工具认得的那份文件`);
    }
    if (!ring.every(inBox)) throw new Error(`湖“${lake.name ?? positionName('lake', lake.at)}”出了方框：这个工具不裁湖`);
    const name = lake.name ?? positionName('lake', lake.at);
    if (lake.name === null) named.push({ name, zh: lake.zh });
    const { ring: out } = thinRing(ring, tolKm, toKm);
    lakePoints += out.length;
    features.push({ type: 'Feature', properties: { kind: 'lake', name }, geometry: { type: 'Polygon', coordinates: [out] } });
  }

  // 河
  const clipped: { name: string; pieces: number }[] = [];
  let riverLines = 0;
  let riverPoints = 0;
  for (const river of water.rivers) {
    const name = river.name ?? positionName('river', river.line[0]);
    if (river.name === null) named.push({ name, zh: river.zh });
    const pieces = clipLineToBox(river.line, box);
    if (!river.line.every(inBox)) clipped.push({ name, pieces: pieces.length });
    for (const piece of pieces) {
      const out = thin(piece, tolKm, toKm).map((p): LngLat => [r3(p[0]), r3(p[1])]);
      riverLines += 1;
      riverPoints += out.length;
      features.push({ type: 'Feature', properties: { kind: 'river', name }, geometry: { type: 'LineString', coordinates: out } });
    }
  }

  return {
    features,
    report: {
      land: { ringsIn: water.land.length, pointsIn: count(water.land), duplicates, degenerate, pointsUnique: count(unique), ringsOut: unique.length, pointsOut: landPoints, keptWhole },
      lakes: { ringsIn: water.lakes.length, pointsIn: count(water.lakes.map((l) => l.ring)), ringsOut: water.lakes.length, pointsOut: lakePoints, restored },
      rivers: { linesIn: water.rivers.length, pointsIn: count(water.rivers.map((r) => r.line)), linesOut: riverLines, pointsOut: riverPoints, clipped },
      named,
    },
  };
}

/** 文件里陆地的每一圈（做地形文件时照它们分陆地和海）。 */
export function landRings(features: TodayFeature[]): LngLat[][] {
  return features.flatMap((f) => (f.properties.kind === 'land' && f.geometry.type === 'Polygon' ? f.geometry.coordinates : []));
}

/** 写成文件的样子：一项一行，行尾是 LF，最后有一个换行；同样的内容每次写出同样的字节。 */
export function todayText(features: TodayFeature[]): string {
  const lines = features.map((f) => JSON.stringify({ type: f.type, properties: { kind: f.properties.kind, name: f.properties.name }, geometry: { type: f.geometry.type, coordinates: f.geometry.coordinates } }));
  return `{"type":"FeatureCollection","features":[\n${lines.join(',\n')}\n]}\n`;
}

/** 每一类各有多少个字节（照写进文件的样子算，不算分隔的逗号和换行）。 */
export function bytesByKind(features: TodayFeature[]): Record<TodayKind, number> {
  const out: Record<TodayKind, number> = { land: 0, lake: 0, river: 0 };
  for (const f of features) out[f.properties.kind] += new TextEncoder().encode(JSON.stringify(f)).length;
  return out;
}

/** 做出来的每一项合不合文件的规矩；不合的一条一句。没有问题是空的。box 是这位人物的文件裁到的方框。 */
export function todayProblems(features: TodayFeature[], box: Box): string[] {
  const problems: string[] = [];
  const badPoint = (p: LngLat): boolean => !(p.length === 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]) && r3(p[0]) === p[0] && r3(p[1]) === p[1]);
  const outside = (p: LngLat): boolean => p[0] < box.west || p[0] > box.east || p[1] < box.south || p[1] > box.north;
  features.forEach((f, i) => {
    const where = `第 ${i} 项（${f.properties.kind} ${f.properties.name}）`;
    if (f.properties.name === '') problems.push(`${where}没有名字`);
    const points = f.geometry.type === 'Polygon' ? f.geometry.coordinates.flat() : f.geometry.coordinates;
    if (points.some(badPoint)) problems.push(`${where}有不是三位小数的坐标`);
    if (points.some(outside)) problems.push(`${where}有出了方框的点`);
    if (f.geometry.type === 'Polygon') {
      if (f.properties.kind === 'river') problems.push(`${where}是河，却是一个面`);
      if (f.geometry.coordinates.length !== 1) problems.push(`${where}应该正好一圈，现在是 ${f.geometry.coordinates.length} 圈`);
      for (const ring of f.geometry.coordinates) {
        if (ring.length < 4) problems.push(`${where}的一圈只有 ${ring.length} 个点，不成一个面`);
        else if (!same(ring[0], ring[ring.length - 1])) problems.push(`${where}的一圈头尾不是同一个点`);
        else if (signedArea(ring) <= 0) problems.push(`${where}的一圈不是逆时针走的`);
      }
    } else {
      if (f.properties.kind !== 'river') problems.push(`${where}不是河，却是一条线`);
      if (f.geometry.coordinates.length < 2) problems.push(`${where}的线不到两个点`);
    }
  });
  return problems;
}
