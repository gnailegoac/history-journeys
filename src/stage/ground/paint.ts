// 从样张搬来，结构没有动（spikes/art-direction/b/scene/terrain-data.js 的 paintMacro、fieldCell），只加了类型。
// 照青绿山水的办法给地面上色：平地茶色赭色，山腰石绿，山顶石青。
//
// 和样张不一样的只有“数从哪来”：
//   颜色和山上的分带      从样式（GroundStyle）读；
//   平地的海拔            Ground.baseM（样张写死 40）；
//   城里城外、街巷        Ground.cities（样张写死一座方城，街巷从沙盘的原点排）；
//   城外的路、田          Ground.roads、Ground.fields（样张写死两条路，田铺满平地）。场景里没有登记的不画。
// 样张里没有、这里新添的两条规矩：
//   修整垫高的地面（Ground.lift）不算山：山上的分带比着“垫高以前的地面”算，垫高的地面就和四周的平地一个颜色、上面是田；
//   窄的水道（壕，看 Ground.bankHalf）岸边只留一道细的留白，也不带河边那一大片草色。

import { crossAlleys } from './cityPlan';
import { bilinear } from './grid';
import { boxOf, distLine, inBox, ringSigned, smoothLine } from './lines';
import type { Box } from './lines';
import { clamp, fbm, hash2, hex, mix3, smoothstep } from './num';
import type { Ground, GroundColour, GroundStyle, Vec2, Vec3 } from './types';

/** 皴和山脊上提亮用的两种留白。样张里就是直接写的数，不在样式的颜色表里。 */
const WASH_PALE: Vec3 = [250, 246, 228];
const CREST_PALE: Vec3 = [255, 250, 232];

/**
 * 大田块：把平地分成不规则的块（按“走横竖格子”的远近分，块的边是横、竖、斜的直线，像田）。
 * 返回这一点所在的块用哪种颜色（有的块不上色，留着底色），和离块边的远近（0 在边上）。
 * seed 是这条田的规则的种子：0 时和样张的田块一样。
 */
const FIELD_TINTS: (GroundColour | null)[] = [null, 'fieldA', 'fieldB', 'fieldC', 'fieldB', 'fieldA', 'fieldC'];
function fieldCell(x: number, z: number, seed: number): { tint: GroundColour | null; border: number } {
  const S = 470;
  const cs = Math.cos(0.3);
  const sn = Math.sin(0.3);
  const wx = x + 150 * (fbm(x / 1100, z / 1100, 2, 131 + seed) - 0.5);
  const wz = z + 150 * (fbm(x / 1100, z / 1100, 2, 137 + seed) - 0.5);
  const gx = (cs * wx - sn * wz) / S;
  const gz = (sn * wx + cs * wz) / (S * 0.82);
  const ix = Math.floor(gx);
  const iz = Math.floor(gz);
  let d1 = 9;
  let d2 = 9;
  let id = 0;
  for (let dj = -1; dj <= 1; dj++) {
    for (let di = -1; di <= 1; di++) {
      const cx = ix + di + 0.18 + 0.64 * hash2(ix + di, iz + dj, 201 + seed);
      const cz = iz + dj + 0.18 + 0.64 * hash2(ix + di, iz + dj, 207 + seed);
      const d = Math.max(Math.abs(gx - cx), Math.abs(gz - cz));
      if (d < d1) {
        d2 = d1;
        d1 = d;
        id = hash2(ix + di, iz + dj, 77 + seed);
      } else if (d < d2) d2 = d;
    }
  }
  return { tint: FIELD_TINTS[Math.floor(id * FIELD_TINTS.length)], border: d2 - d1 };
}

/** 一座城上色时要用的东西：先粗筛的框，街和巷的线。 */
interface CityPaint {
  wall: Vec2[];
  box: Box;
  streets: Vec2[][];
  lanes: Vec2[][];
}

/**
 * 上底色。返回 RGBA 字节（sRGB）：RGB 是颜色，A 是“这里有没有田”（细的田垄在着色器里画）。
 * 每格 10 米（地面网格的一半）。
 */
export function paintColour(ground: Ground, style: GroundStyle): { colour: Uint8Array; w: number; h: number } {
  const S = 2;
  const { nx, nz, cell, x0, z0 } = ground;
  const w = (nx - 1) * S + 1;
  const hgt = (nz - 1) * S + 1;
  const out = new Uint8Array(w * hgt * 4);
  const step = cell / S;
  const x1 = x0 + (nx - 1) * cell;
  const z1 = z0 + (nz - 1) * cell;
  const base = ground.baseM;
  const low = ground.lowWaterM;
  const bands = style.bands;

  const names = Object.keys(style.colours) as GroundColour[];
  const C = Object.fromEntries(names.map((name) => [name, hex(style.colours[name])])) as Record<GroundColour, Vec3>;

  const sample = bilinear(ground.h, ground);
  const sampleEdge = bilinear(ground.edge, ground);
  const sampleCurv = bilinear(ground.curv, ground);
  const sampleLift = bilinear(ground.lift, ground);
  /** 垫高以前的地面。 */
  const shapeAt = (x: number, z: number): number => sample(x, z) - sampleLift(x, z);
  /** 最近的那条河或壕画的宽度的一半：取最近的一格（河和壕交界的地方不能匀开）。 */
  const halfAt = (x: number, z: number): number => {
    const i = clamp(Math.round((x - x0) / cell), 0, nx - 1);
    const j = clamp(Math.round((z - z0) / cell), 0, nz - 1);
    return ground.bankHalf[j * nx + i];
  };

  // 路只在几条窄带里，先粗筛
  const roads = ground.roads.map((r) => {
    const line = smoothLine(r.line, 80);
    return { type: r.type, line, box: boxOf(line, 40) };
  });
  const cities = ground.cities.map((c): CityPaint => {
    const streets = [...c.streets];
    // 点缀里写了 line、type 是 street 的路：在城里照大街画
    for (const r of roads) if (r.type === 'street') streets.push(r.line);
    return { wall: c.wall, box: boxOf(c.wall, 120), streets, lanes: [...c.lanes, ...crossAlleys(c)] };
  });
  const fields = ground.fields.map((f) => ({ area: f.area, box: f.area ? boxOf(f.area) : null, seed: f.seed }));

  /** 这一点在哪条田的规则里：几成（块的边上 40 米以内慢慢淡出），用哪个种子。不在任何一条里是 null。 */
  const fieldAt = (x: number, z: number): { k: number; seed: number } | null => {
    for (const f of fields) {
      if (f.area === null || f.box === null) return { k: 1, seed: f.seed };
      if (!inBox(x, z, f.box)) continue;
      const sd = ringSigned(x, z, f.area);
      if (sd < 0) return { k: smoothstep(0, 40, -sd), seed: f.seed };
    }
    return null;
  };

  for (let j = 0; j < hgt; j++) {
    const z = z0 + j * step;
    for (let i = 0; i < w; i++) {
      const x = x0 + i * step;
      const h = sample(x, z);
      const e = sampleEdge(x, z);
      const cv = sampleCurv(x, z);
      const n1 = fbm(x / 1700, z / 1700, 4, 3);
      const n2 = fbm(x / 380, z / 380, 4, 9);
      const n3 = fbm(x / 950, z / 950, 3, 21);
      // 比平地高出多少：修整垫高的那一截不算（那是垫出来的平地，不是山）
      const r = h - sampleLift(x, z) - base;
      // 岸边留白多宽：河是 46 米；壕这样窄的水道只留一道细边
      const half = halfAt(x, z);
      const sandW = half > 0 ? clamp(half * 0.55, 12, 46) : 46;
      const wide = half > 0 ? smoothstep(40, 100, half) : 1;

      // 平地
      let col = mix3(C.tea, C.teaWarm, smoothstep(0.3, 0.75, n1));
      col = mix3(col, C.ochre, smoothstep(0.56, 0.9, n2) * 0.1);
      // 河边、洼地带一点草色
      const meadow = Math.max(smoothstep(base - 0.5, base - 1.7, h), (1 - smoothstep(70, 560, e)) * 0.7 * wide) * smoothstep(0.28, 0.6, n3);
      col = mix3(col, C.meadow, meadow * 0.78);

      // 山：山脚赭石，山腰石绿，山顶石青；沟里压一点深赭，脊上提亮
      const rr = r + (n2 - 0.5) * 8 + cv * 1.4;
      const tFoot = smoothstep(bands.foot[0], bands.foot[1], rr);
      col = mix3(col, C.ochre, tFoot * 0.9);
      const tGreen = smoothstep(bands.green[0], bands.green[1], rr);
      col = mix3(col, mix3(C.shilu, C.shiluDeep, smoothstep(0.35, 0.8, n2)), tGreen);
      const tBlue = smoothstep(bands.blue[0], bands.blue[1], rr);
      col = mix3(col, C.shiqing, tBlue);
      col = mix3(col, C.shiqingDeep, smoothstep(bands.deepBlue[0], bands.deepBlue[1], rr) * 0.8);
      // 皴：顺着坡往下的细纹，深的是赭，浅的是留出的底色
      if (tFoot > 0.02) {
        // 坡度也照“垫高以前的地面”算：垫出来的平地四边的缓坡上不画山上的皴
        const gx = (shapeAt(x + 40, z) - shapeAt(x - 40, z)) / 80;
        const gz = (shapeAt(x, z + 40) - shapeAt(x, z - 40)) / 80;
        const gl = Math.hypot(gx, gz);
        if (gl > 0.004) {
          const ux = gx / gl;
          const uz = gz / gl;
          const st = fbm((-x * uz + z * ux) / 24, (x * ux + z * uz) / 280, 3, 61);
          const sk = smoothstep(0.02, 0.14, gl) * tFoot;
          col = mix3(col, C.ochreDeep, smoothstep(0.55, 0.78, st) * sk * (0.5 - 0.22 * tBlue));
          col = mix3(col, WASH_PALE, smoothstep(0.45, 0.22, st) * sk * 0.2);
        }
      }
      const gully = smoothstep(0.4, 3.0, -cv) * tFoot;
      col = mix3(col, C.ochreDeep, gully * (0.6 - 0.3 * tBlue));
      const crest = smoothstep(0.5, 3.2, cv) * tGreen;
      col = mix3(col, CREST_PALE, crest * 0.2);

      // 河岸留白，水底淡花青
      if (e < sandW) {
        // 窄的水道岸边的留白也淡一些：细细一条沟再描一圈白边，远看像一块块镶了边的方格
        col = mix3(col, C.sand, smoothstep(sandW, sandW * 0.13, e) * (0.4 + 0.45 * wide));
        // 最低的水位露出来的地面（滩、石滩）是沙色，不是水底的颜色；没有比平时低的水位时同原来一样
        if (e < 8) col = mix3(col, low === null ? C.bed : mix3(C.sand, C.bed, smoothstep(low + 0.3, low - 0.3, h)), smoothstep(8, -26, e));
      }

      // 城里城外先算好：田、路都要用。dOut 是到最近一道城墙的线多远，城里是负数
      let dOut = 1e9;
      let city: CityPaint | null = null;
      for (const c of cities) {
        if (!inBox(x, z, c.box)) continue;
        const d = ringSigned(x, z, c.wall);
        if (d < dOut) {
          dOut = d;
          city = c;
        }
      }
      const inCity = 1 - smoothstep(-30, 10, dOut);
      const edgeD = Math.min(x - x0, x1 - x, z - z0, z1 - z);
      const fade = 1 - smoothstep(40, 380 + n3 * 420, edgeD);

      // 路：比平地深一点的赭色细线（浅色的路远看像划痕）
      let onRoad = 0;
      for (const road of roads) {
        if (!inBox(x, z, road.box)) continue;
        onRoad = Math.max(onRoad, 1 - smoothstep(9, 24, distLine(x, z, road.line)));
      }

      // 远看的田：四五百米一块的不规则大田块，三种浅色轮着上，块和块之间留一道底色
      // 田离河岸留出一段；壕这样窄的水道，田一直画到离它十几米的地方
      const plain = (1 - smoothstep(1.2, 3.2, rr)) * smoothstep(10 + 20 * wide, 30 + 60 * wide, e) * (1 - inCity) * smoothstep(30, 110, dOut) * (1 - fade);
      let fieldMask = 0;
      if (plain > 0.01) {
        const rule = fieldAt(x, z);
        if (rule) {
          const fc = fieldCell(x, z, rule.seed);
          const spread = smoothstep(0.3, 0.46, fbm(x / 2300, z / 2300, 3, 143 + rule.seed));
          const gap = smoothstep(0.02, 0.07, fc.border);
          const k = plain * rule.k * spread * gap * (fc.tint ? 1 : 0);
          if (k > 0 && fc.tint) col = mix3(col, C[fc.tint], k * 0.82);
          fieldMask = k;
        }
      }
      if (onRoad > 0) col = mix3(col, C.path, onRoad * 0.6 * (1 - inCity));

      // 城里：浅灰黄的地，从城门到城门的大街和几条小巷
      if (inCity > 0 && city) {
        let g = C.cityGround;
        let main = 1e9;
        for (const street of city.streets) main = Math.min(main, distLine(x, z, street));
        g = mix3(g, C.road, 1 - smoothstep(13, 22, main));
        let lane = 1e9;
        for (const l of city.lanes) lane = Math.min(lane, distLine(x, z, l));
        g = mix3(g, C.road, (1 - smoothstep(4, 10, lane)) * 0.55);
        col = mix3(col, g, inCity);
      }

      // 画心四边留出空绢
      col = mix3(col, C.blank, fade * 0.62 * (1 - tFoot));

      // 一点手工上色的不匀
      const grain = (hash2(i, j, 5) - 0.5) * 5 + (fbm(x / 70, z / 70, 2, 31) - 0.5) * 9;
      col = [col[0] + grain, col[1] + grain, col[2] + grain * 0.9];

      // 近看的田垄只画在上了色的田块里（着色器里画）
      const field = fieldMask * (1 - onRoad);

      const k = (j * w + i) * 4;
      out[k] = clamp(Math.round(col[0]), 0, 255);
      out[k + 1] = clamp(Math.round(col[1]), 0, 255);
      out[k + 2] = clamp(Math.round(col[2]), 0, 255);
      out[k + 3] = clamp(Math.round(field * 255), 0, 255);
    }
  }
  return { colour: out, w, h: hgt };
}
