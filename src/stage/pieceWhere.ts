// 小像站在全程沙盘的哪里。只算数，不引 three：给出来的是沙盘里的米（[x, z]，x 向东，z 向南），多高由摆它的程序照地面去取。
// 和 ./roadLines.ts 一样，只有全程沙盘才下载的那一块程序可以引它；页面的程序不许引（页面手里没有路的线，只说“哪几截路、走到几成”）。
//
// 三种说法（src/stage/types.ts 的 PiecePlace）：
//   在一个地名点上：就是那个点（题签指着的那一点）。
//   在一趟路上：把这几截路画出来的线照走的先后接成一条，从 from 到 to 沿着线匀着走，走到 k 成（0 到 1）。
//     from、to 写 'start'、'end' 是这条线的两头；写经纬度的，是线上离那里最近的一点。两头是同一点就是停在那里。
//   在画出来的线上、可沙盘没有立名字的一处（凤翔、常州……）：线上离它最近的那一点。
// 用的是抹圆以后、加密以前的线（roadLines.ts 的 roundedWay）：加密只是在同一条线上添点，所以他总站在画出来的线上。
// 认不得的地名点、认不得的路：给 null（当作不在沙盘上）。

import type { RouteScene } from '../domain/scene';
import type { FrameCoords } from '../domain/sceneGeo';
import type { LngLat } from '../domain/types';
import type { Vec2 } from './ground/types';
import { roundedWay } from './roadLines';
import type { PieceEnd, PiecePlace } from './types';

/** 几截路接成的一条线。 */
export interface PieceChain {
  /** 线上的点，照走的先后。 */
  points: Vec2[];
  /** 每个点离起头多远（沿着线量，沙盘里的米），和 points 一一对上；最后一个就是全长。 */
  along: number[];
}

/**
 * 把几截路画出来的线照走的先后接成一条。ways 的写法和场景文件里一样：一截路的 id，倒着走的前面一个减号。
 * 前一截的尾和后一截的头是同一点的只留一个；差着一点的（校验的规则 13 管着不超过 1 公里）直着连过去。
 * 有一截认不得，或者一截也没有：null。
 */
export function pieceChain(scene: RouteScene, coords: FrameCoords, ways: readonly string[]): PieceChain | null {
  const points: Vec2[] = [];
  for (const written of ways) {
    const reversed = written.startsWith('-');
    const id = reversed ? written.slice(1) : written;
    const way = scene.roads.ways.find((item) => item.id === id);
    if (!way) return null;
    const line = roundedWay(scene, coords, way);
    if (reversed) line.reverse();
    const last = points[points.length - 1];
    points.push(...(last && Math.hypot(line[0][0] - last[0], line[0][1] - last[1]) < 1e-6 ? line.slice(1) : line));
  }
  if (points.length === 0) return null;
  const along = [0];
  for (let i = 1; i < points.length; i++) along.push(along[i - 1] + Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]));
  return { points, along };
}

/** 这条线上离起头 s 米的那一点。s 出了两头就是那一头。 */
export function chainPoint(chain: PieceChain, s: number): Vec2 {
  const { points, along } = chain;
  let i = 1;
  while (i < points.length - 1 && along[i] < s) i++;
  const a = points[i - 1] ?? points[0];
  const b = points[i] ?? a;
  const length = along[i] - along[i - 1];
  const t = length > 0 ? Math.min(1, Math.max(0, (s - along[i - 1]) / length)) : 0;
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

/** 这条线上离 p 最近的一点：它离起头多远（s），p 离它多远（offM）。都是沙盘里的米。一样近的取靠前的。 */
export function chainNearest(chain: PieceChain, p: Vec2): { s: number; offM: number } {
  const { points, along } = chain;
  let best = { s: 0, offM: Math.hypot(p[0] - points[0][0], p[1] - points[0][1]) };
  for (let i = 1; i < points.length; i++) {
    const [ax, az] = points[i - 1];
    const dx = points[i][0] - ax;
    const dz = points[i][1] - az;
    const t = Math.min(1, Math.max(0, ((p[0] - ax) * dx + (p[1] - az) * dz) / (dx * dx + dz * dz || 1)));
    const offM = Math.hypot(p[0] - ax - dx * t, p[1] - az - dz * t);
    if (offM < best.offM) best = { s: along[i - 1] + (along[i] - along[i - 1]) * t, offM };
  }
  return best;
}

/** 一头落在这条线上离起头多远。 */
function endAt(chain: PieceChain, coords: FrameCoords, end: PieceEnd): number {
  if (end === 'start') return 0;
  if (end === 'end') return chain.along[chain.along.length - 1];
  return chainNearest(chain, coords.toLocal(end)).s;
}

/** 在一条接好的线上：从 from 到 to 走到 k 成的那一点。 */
export function pieceOnChain(chain: PieceChain, coords: FrameCoords, from: PieceEnd, to: PieceEnd, k: number): Vec2 {
  const a = endAt(chain, coords, from);
  return chainPoint(chain, a + (endAt(chain, coords, to) - a) * Math.min(1, Math.max(0, k)));
}

/** 画出来的一截路上离 at 最近的那一点（沙盘没有立名字的一处，他站在这里）。 */
export function pieceSpot(scene: RouteScene, coords: FrameCoords, way: string, at: LngLat): Vec2 | null {
  const chain = pieceChain(scene, coords, [way]);
  return chain && pieceOnChain(chain, coords, at, at, 0);
}

/** 小像站在沙盘里的哪一点（[x, z]，沙盘里的米）；不在沙盘上（认不得的 id）是 null。 */
export function pieceWhere(scene: RouteScene, coords: FrameCoords, where: PiecePlace): Vec2 | null {
  if (where.on === 'place') {
    const place = scene.places.find((item) => item.id === where.place);
    return place ? coords.toLocal(place.at) : null;
  }
  if (where.on === 'spot') return pieceSpot(scene, coords, where.way, where.at);
  const chain = pieceChain(scene, coords, where.ways);
  return chain && pieceOnChain(chain, coords, where.from, where.to, where.k);
}
