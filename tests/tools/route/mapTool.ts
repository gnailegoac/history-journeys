// 全程沙盘的检查图：从正上方看，照沙盘自己的投影，把场景文件里的每一条线、每一圈、每一条路都画出来。
// 给做场景的人看的：每一站在不在该在的地方，路连不连得上，海岸改在哪，哪些今天的湖和河没有被场景挑中（灰色）。
// 只算数、只画点，不碰磁盘；npm run route:map（tests/tools/route-tools.test.ts 的 map 模式）把它写成 map.png 和 map.txt。
//
// 图上的号码分四种颜色：黑的是路（roads.ways），红的是地名点和远处，蓝的是水（河、湖、只染水色的水），紫的是抹成海的圈。
// 号码对着 map.txt 里的清单。画法：
//   今天的陆地：米色；海：淡蓝；海拔 300 米以上的山：一层一层加深的赭色（只是让人认得出山在哪）。
//   抹成海的圈：圈里今天的陆地涂成粉红，圈的边是紫线。留白的圈：灰紫的虚线。
//   今天的湖：场景挑中的蓝，没挑中的灰；从湖里裁掉的角：橙色的边，里面还原成陆地的颜色。
//   只染水色的水：浅青，青色的虚线边。
//   今天的河：场景挑中的蓝（越粗越要紧），没挑中的灰。场景自己写的河：示意的是青绿色，照今天手连的是蓝色；运河是细的紫红线。
//   路：陆路黑，水路深红，海路紫；有“按正文摆的”一截走到的画实线，只有“示意的”走到的画虚线。
//   地名点：是站的画实心红点，别的画空心黑圈；题签指在水上、线上的点是小蓝方块；远处的题签指的点是红三角。

import type { RouteScene } from '../../../src/domain/scene';
import type { FrameCoords } from '../../../src/domain/sceneGeo';
import type { LngLat } from '../../../src/domain/types';
import type { RouteGround } from '../../../src/stage/ground/route';
import { pickedLakes, pickedLines } from '../../content/routeRules';
import type { TodayFeature } from '../../content/routeRules';

type Rgb = [number, number, number];

export interface RouteMap {
  width: number;
  height: number;
  /** 彩色的像素：width × height × 3 个字节。 */
  pixels: Uint8Array;
  /** map.txt 的各行。 */
  legend: string[];
}

/** 地面的一格画几个点。 */
export const MAP_POINTS_PER_CELL = 3;

const SEA: Rgb = [226, 236, 244];
const LAND: Rgb = [244, 238, 222];
const CUT: Rgb = [250, 205, 205];
const HILLS: [number, Rgb][] = [
  [300, [234, 222, 196]],
  [800, [222, 204, 170]],
  [1500, [206, 182, 146]],
  [2500, [186, 160, 128]],
  [3500, [166, 142, 116]],
];
const BLUE: Rgb = [40, 110, 190];
const GREY: Rgb = [150, 150, 150];
const GREY_FILL: Rgb = [200, 200, 200];
const LAKE: Rgb = [130, 175, 220];
const WASH: Rgb = [180, 225, 225];
const TEAL: Rgb = [0, 140, 130];
const CANAL: Rgb = [190, 60, 150];
const PURPLE: Rgb = [130, 40, 170];
const ORANGE: Rgb = [230, 130, 20];
const BLACK: Rgb = [20, 20, 20];
const RED: Rgb = [200, 30, 30];
const DARK_RED: Rgb = [150, 30, 20];
const WHITE: Rgb = [255, 255, 255];

/** 3 × 5 的数字点阵，每个数字五行，每行三位。 */
const DIGITS: Record<string, string[]> = {
  '0': ['111', '101', '101', '101', '111'],
  '1': ['010', '110', '010', '010', '111'],
  '2': ['111', '001', '111', '100', '111'],
  '3': ['111', '001', '111', '001', '111'],
  '4': ['101', '101', '111', '001', '001'],
  '5': ['111', '100', '111', '001', '111'],
  '6': ['111', '100', '111', '101', '111'],
  '7': ['111', '001', '010', '010', '010'],
  '8': ['111', '101', '111', '101', '111'],
  '9': ['111', '101', '111', '001', '111'],
};

/** 一条路在图上画实线还是虚线：有“按正文摆的”一截走到它就是实线。 */
export function waySolid(scene: RouteScene, wayId: string): boolean {
  return scene.roads.journeys.some((journey) => journey.parts.some((part) => part.class === 'text' && part.ways.some((written) => (written.startsWith('-') ? written.slice(1) : written) === wayId)));
}

/** 一条线在沙盘的投影里有多少公里。 */
export function lineKm(scene: RouteScene, coords: FrameCoords, line: LngLat[]): number {
  let m = 0;
  for (let i = 1; i < line.length; i++) {
    const [ax, az] = coords.toLocal(line[i - 1]);
    const [bx, bz] = coords.toLocal(line[i]);
    m += Math.hypot(bx - ax, bz - az);
  }
  return (m * scene.frame.scale) / 1000;
}

/** 画检查图。features 是读好的“今天的海岸、湖、河”；ground 是照场景算出来的地面（山在哪、抹成海以后哪里是陆地）。 */
export function drawRouteMap(scene: RouteScene, features: TodayFeature[], coords: FrameCoords, ground: RouteGround): RouteMap {
  const width = (ground.nx - 1) * MAP_POINTS_PER_CELL + 1;
  const height = (ground.nz - 1) * MAP_POINTS_PER_CELL + 1;
  const pixels = new Uint8Array(width * height * 3);
  const perM = MAP_POINTS_PER_CELL / ground.cell;
  const px = (p: LngLat): [number, number] => {
    const [x, z] = coords.toLocal(p);
    return [(x - coords.x0) * perM, (z - coords.z0) * perM];
  };

  const set = (x: number, y: number, c: Rgb): void => {
    const xi = Math.round(x);
    const yi = Math.round(y);
    if (xi < 0 || yi < 0 || xi >= width || yi >= height) return;
    const k = (yi * width + xi) * 3;
    pixels[k] = c[0];
    pixels[k + 1] = c[1];
    pixels[k + 2] = c[2];
  };
  const dot = (x: number, y: number, r: number, c: Rgb): void => {
    for (let dy = -Math.ceil(r); dy <= Math.ceil(r); dy++) for (let dx = -Math.ceil(r); dx <= Math.ceil(r); dx++) if (dx * dx + dy * dy <= r * r + 0.3) set(x + dx, y + dy, c);
  };
  /** 一条线：thick 是粗细（像素）；dash 写了 [画几个点, 空几个点] 就是虚线。 */
  const stroke = (line: LngLat[], c: Rgb, thick: number, dash?: [number, number], closed = false): void => {
    const points = line.map(px);
    if (closed && points.length > 1) points.push(points[0]);
    let run = 0;
    for (let i = 1; i < points.length; i++) {
      const [ax, ay] = points[i - 1];
      const [bx, by] = points[i];
      const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay)));
      for (let s = 0; s <= steps; s++) {
        run++;
        if (dash && run % (dash[0] + dash[1]) >= dash[0]) continue;
        const x = ax + ((bx - ax) * s) / steps;
        const y = ay + ((by - ay) * s) / steps;
        if (thick <= 1) set(x, y, c);
        else dot(x, y, thick / 2, c);
      }
    }
  };
  /** 一圈线里面涂色：一行一行扫，奇数次穿过线的那几段在里面。 */
  const fill = (ring: LngLat[], colourAt: (x: number, y: number) => Rgb | null): void => {
    const points = ring.map(px);
    let top = Infinity;
    let bottom = -Infinity;
    for (const [, y] of points) {
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
    }
    for (let y = Math.max(0, Math.ceil(top)); y <= Math.min(height - 1, Math.floor(bottom)); y++) {
      const cuts: number[] = [];
      for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
        const [ax, ay] = points[i];
        const [bx, by] = points[j];
        if (ay > y !== by > y) cuts.push(ax + ((bx - ax) * (y - ay)) / (by - ay));
      }
      cuts.sort((a, b) => a - b);
      for (let k = 0; k + 1 < cuts.length; k += 2) {
        for (let x = Math.max(0, Math.ceil(cuts[k])); x <= Math.min(width - 1, Math.floor(cuts[k + 1])); x++) {
          const c = colourAt(x, y);
          if (c) set(x, y, c);
        }
      }
    }
  };
  /** 一个号码：白底，c 色的字。 */
  const label = (at: [number, number], n: number, c: Rgb): void => {
    const text = String(n);
    const w = text.length * 8 + 2;
    const x0 = Math.round(at[0] + 4);
    const y0 = Math.round(at[1] - 6);
    for (let y = -1; y <= 11; y++) for (let x = -1; x <= w; x++) set(x0 + x, y0 + y, WHITE);
    [...text].forEach((ch, i) => {
      DIGITS[ch].forEach((row, r) => {
        [...row].forEach((bit, b) => {
          if (bit !== '1') return;
          for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) set(x0 + 1 + i * 8 + b * 2 + dx, y0 + r * 2 + dy, c);
        });
      });
    });
  };
  const middle = (line: LngLat[]): [number, number] => {
    const points = line.map(px);
    const total = points.slice(1).reduce((sum, p, i) => sum + Math.hypot(p[0] - points[i][0], p[1] - points[i][1]), 0);
    let walked = 0;
    for (let i = 1; i < points.length; i++) {
      const piece = Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
      if (walked + piece >= total / 2 && piece > 0) {
        const t = (total / 2 - walked) / piece;
        return [points[i - 1][0] + (points[i][0] - points[i - 1][0]) * t, points[i - 1][1] + (points[i][1] - points[i - 1][1]) * t];
      }
      walked += piece;
    }
    return points[0];
  };
  const centre = (ring: LngLat[]): [number, number] => {
    const points = ring.map(px);
    return [points.reduce((s, p) => s + p[0], 0) / points.length, points.reduce((s, p) => s + p[1], 0) / points.length];
  };

  // 底：海
  for (let k = 0; k < width * height; k++) pixels.set(SEA, k * 3);
  // 今天的陆地（各圈分别涂，合起来就是并集），山按做出来的地面加深；抹成海的地方涂粉红
  const groundAt = (x: number, y: number): { h: number; land: boolean } => {
    const i = Math.min(ground.nx - 1, Math.round(x / MAP_POINTS_PER_CELL));
    const j = Math.min(ground.nz - 1, Math.round(y / MAP_POINTS_PER_CELL));
    return { h: ground.h[j * ground.nx + i], land: ground.land[j * ground.nx + i] === 1 };
  };
  const seaRings = scene.terrain.edits.map((edit) => edit.area.map(px));
  const inPx = (x: number, y: number, ring: [number, number][]): boolean => {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [ax, ay] = ring[i];
      const [bx, by] = ring[j];
      if (ay > y !== by > y && x < ((bx - ax) * (y - ay)) / (by - ay) + ax) inside = !inside;
    }
    return inside;
  };
  for (const feature of features) {
    if (feature.kind !== 'land') continue;
    for (const polygon of feature.polygons) {
      fill(polygon[0], (x, y) => {
        if (seaRings.some((ring) => inPx(x, y, ring))) return CUT;
        const { h } = groundAt(x, y);
        let c = LAND;
        for (const [above, colour] of HILLS) if (h > above) c = colour;
        return c;
      });
    }
  }

  const legend: string[] = [];
  let waterNo = 0;

  // 留白的圈
  scene.terrain.recipe.blank.forEach((ring) => stroke(ring, [150, 130, 170], 1, [6, 6], true));

  // 今天的湖：挑中的蓝，没挑中的灰
  const pickedLakeRings = new Set(scene.water.lakes.flatMap((lake) => pickedLakes(features, lake.today)).map((polygon) => polygon[0]));
  const unpickedLakes: string[] = [];
  for (const feature of features) {
    if (feature.kind !== 'lake') continue;
    const picked = feature.polygons.some((polygon) => pickedLakeRings.has(polygon[0]));
    if (!picked) unpickedLakes.push(feature.name);
    for (const polygon of feature.polygons) {
      fill(polygon[0], () => (picked ? LAKE : GREY_FILL));
      stroke(polygon[0], picked ? BLUE : GREY, 1, undefined, true);
    }
  }
  // 从湖里裁掉的角
  for (const lake of scene.water.lakes) {
    if (!lake.except) continue;
    const cut = lake.except.area.map(px);
    for (const polygon of pickedLakes(features, lake.today)) fill(polygon[0], (x, y) => (inPx(x, y, cut) ? LAND : null));
    stroke(lake.except.area, ORANGE, 2, undefined, true);
  }
  // 只染水色的水
  for (const wash of scene.water.washes) {
    for (const ring of wash.areas) {
      fill(ring, () => WASH);
      stroke(ring, TEAL, 1, [4, 3], true);
    }
  }

  // 今天的河：没挑中的灰，挑中的蓝
  const WEIGHT_PX: Record<string, number> = { trunk: 5, major: 4, river: 3, minor: 2 };
  const unpickedRivers: string[] = [];
  for (const feature of features) {
    if (feature.kind !== 'river') continue;
    // 一条线整条都没被挑中的才算没挑中（挑中一段的，那一段下面会用蓝色盖上）
    const whole = !scene.water.rivers.some((river) => river.today?.some((pick) => pick.names.includes(feature.name)));
    if (whole) unpickedRivers.push(feature.name);
    for (const line of feature.lines) stroke(line, GREY, 1);
  }
  for (const river of scene.water.rivers) {
    waterNo++;
    const thick = river.kind === 'canal' ? 1.5 : WEIGHT_PX[river.weight ?? 'minor'];
    const colour = river.kind === 'canal' ? CANAL : river.class === 'schematic' ? TEAL : BLUE;
    const lines = river.line ? [river.line] : pickedLines(features, river.today ?? []);
    for (const line of lines) stroke(line, colour, thick, river.kind === 'canal' ? [5, 3] : undefined);
    const longest = lines.reduce((best, line) => (line.length > best.length ? line : best), lines[0] ?? []);
    if (longest.length > 0) label(middle(longest), waterNo, BLUE);
    const points = lines.reduce((sum, line) => sum + line.length, 0);
    legend.push(`水 ${waterNo}　${river.id}　${river.name}　${river.kind === 'canal' ? '运河' : (river.weight ?? '')}　${river.class}　${river.line ? `自己写的线，${points} 个点` : `照今天的数据，${lines.length} 段 ${points} 个点`}　${Math.round(lines.reduce((sum, line) => sum + lineKm(scene, coords, line), 0))} 公里`);
  }
  for (const lake of scene.water.lakes) {
    waterNo++;
    const rings = pickedLakes(features, lake.today);
    if (rings.length > 0) label(centre(rings[0][0]), waterNo, BLUE);
    legend.push(`水 ${waterNo}　${lake.id}　${lake.name}　湖　${lake.class}　照今天的数据，${rings.length} 圈${lake.except ? `；裁掉“${lake.except.name}”（${lake.except.id}，${lake.except.class}）` : ''}`);
  }
  for (const wash of scene.water.washes) {
    waterNo++;
    label(centre(wash.areas[0]), waterNo, BLUE);
    legend.push(`水 ${waterNo}　${wash.id}　${wash.name}　只染水色　${wash.class}　${wash.areas.length} 圈`);
  }

  // 抹成海的圈
  scene.terrain.edits.forEach((edit, i) => {
    stroke(edit.area, PURPLE, 2, undefined, true);
    label(centre(edit.area), i + 1, PURPLE);
    legend.push(`圈 ${i + 1}　${edit.id}　${edit.name}　抹成海　${edit.class}　${edit.area.length} 个点`);
  });

  // 路
  scene.roads.ways.forEach((way, i) => {
    const solid = waySolid(scene, way.id);
    const colour = way.by === 'land' ? BLACK : way.by === 'sea' ? PURPLE : DARK_RED;
    stroke(way.line, colour, 2, solid ? undefined : [7, 5]);
    for (const p of way.line) dot(...px(p), 2, colour);
    const users = scene.roads.journeys.filter((journey) => journey.parts.some((part) => part.ways.some((written) => (written.startsWith('-') ? written.slice(1) : written) === way.id))).map((journey) => journey.id);
    legend.push(`路 ${i + 1}　${way.id}　${way.by}${way.along ? `　沿 ${way.along}` : ''}　${solid ? '实线' : '虚线'}　${way.line.length} 个点　${Math.round(lineKm(scene, coords, way.line))} 公里　走到它的：${users.join('、')}`);
  });
  scene.roads.ways.forEach((way, i) => label(middle(way.line), i + 1, BLACK));

  // 地名点、题签指的点、远处
  scene.places.forEach((place, i) => {
    const at = px(place.at);
    if (place.stops) dot(at[0], at[1], 5, RED);
    else {
      dot(at[0], at[1], 5, BLACK);
      dot(at[0], at[1], 3, WHITE);
    }
    label([at[0] + 3, at[1] - 8], i + 1, RED);
    legend.push(`点 ${i + 1}　${place.id}　${place.name}　[${place.at[0]}, ${place.at[1]}]　${place.class}${place.stops ? `　是站：${place.stops.join('、')}` : ''}`);
  });
  scene.strips.forEach((strip) => {
    if (!strip.at) return;
    const [x, y] = px(strip.at);
    const far = scene.far.some((item) => item.id === strip.of);
    if (far) {
      for (let dy = 0; dy < 9; dy++) for (let dx = -dy; dx <= dy; dx++) set(x + dx * 0.6, y - 4 + dy, RED);
    } else {
      for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) set(x + dx, y + dy, Math.abs(dx) === 3 || Math.abs(dy) === 3 ? WHITE : BLUE);
    }
    legend.push(`题签　${strip.id}　${strip.text}${strip.modern ? `（今名 ${strip.modern}）` : ''}　指着 ${strip.of}　[${strip.at[0]}, ${strip.at[1]}]`);
  });
  scene.far.forEach((far, i) => legend.push(`远处 ${i + 1}　${far.id}　${far.name}　[${far.at[0]}, ${far.at[1]}]（在沙盘外面，图上画的是题签指的那一点：红三角）`));

  // 没有被场景挑中的（图上是灰的）
  const uniq = (names: string[]): string => [...new Set(names)].join('、') || '没有';
  legend.push(`没挑中的今天的湖（灰）：${uniq(unpickedLakes)}`);
  legend.push(`没挑中的今天的河（灰）：${uniq(unpickedRivers)}`);

  // 框
  for (let x = 0; x < width; x++) {
    set(x, 0, BLACK);
    set(x, height - 1, BLACK);
  }
  for (let y = 0; y < height; y++) {
    set(0, y, BLACK);
    set(width - 1, y, BLACK);
  }
  return { width, height, pixels, legend };
}
