// 给全程沙盘的地面上色的工具（tests/tools/route/paint.ts），在校验器的合格样本里那座小的全程沙盘上画一遍来查。
// 样本：600 × 400 公里；东边是海；一条照今天画的河、一条示意的河、一条运河；一个湖裁掉西南角；一片只染水色的水；东边有一圈抹成海。
// content/ 里真的那一座有三百多万个点，由 baked-fresh.test.ts 重画一遍和存着的比；这里只查画法自己。

import { describe, expect, it } from 'vitest';
import { contentKey } from '../../src/domain/contentKey';
import type { RouteScene } from '../../src/domain/scene';
import { routeCoords } from '../../src/domain/sceneGeoRoute';
import type { LngLat } from '../../src/domain/types';
import { hex } from '../../src/stage/ground/num';
import { buildRouteGround, keepAt, readRouteDem, routePictureSize } from '../../src/stage/ground/route';
import { STYLE_IDS, blankEdgeFor, styleFor } from './support/styles';
import { readToday } from '../content/routeRules';
import { readBytes } from '../support/readBytes';
import { routeBakeParts } from '../tools/route/bakeRoute';
import { SONG_QINGLV_PAINT, coverage, densify, gauss, paintRoute, riverPaths } from '../tools/route/paint';
import { ROUTE_PAINTERS, routePainterFor, routeRiversFor } from '../tools/route/painters';
import { realRouteScene, realSceneKeys } from './support/realScenes';

const FIXTURE = 'tests/content/fixtures/good/figures/demo/scenes/';
const text = (file: string): string => new TextDecoder().decode(readBytes(`${FIXTURE}${file}`));

function sample() {
  const scene = JSON.parse(text('route.json')) as RouteScene;
  const today = readToday({ today: text(scene.water.todayFile) }, 'today');
  if (!today || 'problem' in today) throw new Error('样本里今天的海岸、湖、河读不出来');
  const coords = routeCoords(scene.frame);
  const ground = buildRouteGround(scene, readRouteDem(scene.terrain, readBytes(`${FIXTURE}${scene.terrain.file}`)), coords, blankEdgeFor(scene.style));
  return { scene, coords, ground, features: today.features, style: styleFor(scene.style) };
}

describe('栅格小工具', () => {
  it('一圈线盖住每个点的多少：整个盖住是 1，盖一半是 0.5，圈外是 0', () => {
    const cov = coverage(6, 4, [[[1, 1], [3.5, 1], [3.5, 3], [1, 3]]]);
    expect(cov[1 * 6 + 1]).toBeCloseTo(1, 6);
    expect(cov[1 * 6 + 2]).toBeCloseTo(1, 6);
    expect(cov[1 * 6 + 3]).toBeCloseTo(0.5, 6);
    expect(cov[1 * 6 + 4]).toBe(0);
    expect(cov[0]).toBe(0);
  });

  it('抹平：总量不变（离边远的地方）；不到一个点的宽度用三点的小核', () => {
    const src = new Float32Array(21 * 21);
    src[10 * 21 + 10] = 100;
    for (const sigma of [0.5, 1, 3]) {
      const out = gauss(src, 21, 21, sigma);
      expect(out.reduce((a, b) => a + b, 0)).toBeCloseTo(100, 3);
      expect(out[10 * 21 + 10]).toBeLessThan(100);
      expect(out[10 * 21 + 10]).toBeGreaterThan(out[10 * 21 + 11]);
    }
  });

  it('把折线加密：过每一个写出来的点，头尾不动', () => {
    const line: [number, number][] = [[0, 0], [30, 10], [60, 0], [90, 20]];
    const dense = densify(line, 6);
    expect(dense.length).toBeGreaterThan(12);
    expect(dense[0]).toEqual([0, 0]);
    expect(dense[dense.length - 1]).toEqual([90, 20]);
    for (const p of line) expect(dense.some((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) < 1e-9)).toBe(true);
  });
});

describe('在样本上画一遍', () => {
  const S = sample();
  const painted = paintRoute(S);
  const { cell } = S.ground;
  /** 经纬度上这一点落在图上的哪个点。 */
  const at = (p: LngLat): number => {
    const [x, z] = S.coords.toLocal(p);
    const i = Math.round(((x - S.coords.x0) / cell) * 3);
    const j = Math.round(((z - S.coords.z0) / cell) * 3);
    return j * painted.w + i;
  };
  const rgb = (p: LngLat): [number, number, number] => {
    const k = at(p) * 3;
    return [painted.colour[k], painted.colour[k + 1], painted.colour[k + 2]];
  };
  const mark = (p: LngLat): number => painted.marks[at(p)];

  it('两份一样大，是地面的一格三个点；同样的输入画出同样的字节', { timeout: 60_000 }, () => {
    const size = routePictureSize(S.ground);
    expect([painted.w, painted.h]).toEqual([size.w, size.h]);
    expect(size).toEqual({ w: (S.ground.nx - 1) * 3 + 1, h: (S.ground.nz - 1) * 3 + 1 });
    expect(painted.colour.length).toBe(size.w * size.h * 3);
    expect(painted.marks.length).toBe(size.w * size.h);
    const again = paintRoute(sample());
    expect(contentKey(again.colour)).toBe(contentKey(painted.colour));
    expect(contentKey(again.marks)).toBe(contentKey(painted.marks));
  });

  it('海：离岸远的地方是深一点的花青，标着画水纹；岸边发白，不画水纹', () => {
    const far: LngLat = [114.98, 29.0];
    const deep = hex(SONG_QINGLV_PAINT.colours.seaDeep);
    const got = rgb(far);
    for (let c = 0; c < 3; c++) expect(Math.abs(got[c] - deep[c]), `离岸远的海的颜色 ${got.join(',')}，深的花青是 ${deep.join(',')}`).toBeLessThanOrEqual(3);
    expect(mark(far)).toBeGreaterThan(230);
    // 岸边发白，不画水纹：一道水纹有几十公里长，贴着岸画就压到岸上去了。离岸三公里还不画，二十公里上下画一半，四五十公里以外画足
    const shore: LngLat = [114.48, 29.9];
    expect(rgb(shore)[0]).toBeGreaterThan(got[0] + 15);
    expect(mark([114.455, 29.9])).toBe(0);
    expect(mark(shore)).toBe(0);
    const halfway = mark([114.66, 29.9]);
    expect(halfway).toBeGreaterThan(40);
    expect(halfway).toBeLessThan(mark(far) * 0.75);
  });

  it('平地：暖的茶色，不画水纹；陆地上哪里都不标水纹（湖除外）', () => {
    const plain: LngLat = [110.3, 28.5];
    const [r, , b] = rgb(plain);
    expect(r).toBeGreaterThan(b + 30);
    expect(mark(plain)).toBe(0);
  });

  it('抹成海的圈里面，今天的陆地画成了海', () => {
    const inRing: LngLat = [114.4, 28.35];
    const [r, , b] = rgb(inRing);
    expect(b, '圈里面还是陆地的颜色').toBeGreaterThan(r);
    // 同一条经线上、圈外面的地方还是陆地
    const outside = rgb([114.4, 29.2]);
    expect(outside[0]).toBeGreaterThan(outside[2]);
  });

  it('湖里是水，标着画水纹；裁掉的西南角是陆地', () => {
    const inLake: LngLat = [112.62, 28.78];
    expect(rgb(inLake)[2]).toBeGreaterThan(rgb(inLake)[0]);
    expect(mark(inLake)).toBeGreaterThan(100);
    const corner: LngLat = [112.27, 28.56];
    expect(rgb(corner)[0], '裁掉的那一角画成了水').toBeGreaterThan(rgb(corner)[2]);
    expect(mark(corner)).toBe(0);
  });

  it('河：照今天画的河深，示意的河淡；河有多宽照样式里的公里数；运河最细', () => {
    const paths = riverPaths(S.scene, S.features, S.coords);
    expect(paths.map((p) => [p.id, p.pale, p.widthKm])).toEqual([
      ['long', false, SONG_QINGLV_PAINT.riverKm.trunk],
      ['south-stream', true, SONG_QINGLV_PAINT.riverKm.river],
      ['cut', true, SONG_QINGLV_PAINT.riverKm.canal],
    ]);
    // 自己写的线过每一个写出来的点
    const written = S.scene.water.rivers[1].line ?? [];
    for (const p of written) {
      const [x, z] = S.coords.toLocal(p);
      expect(paths[1].lines[0].some((q) => Math.hypot(q[0] - x, q[1] - z) < 1e-6)).toBe(true);
    }
    // 画出来：河上的点比旁边十几公里外的陆地蓝得多。（样本只有四百公里高，四边留出空绢的那一圈盖到了大半张图，
    // 颜色都往空绢上靠了一些，所以这里比的是“比旁边蓝多少”，不比颜色自己。）
    const blue = (p: LngLat): number => rgb(p)[2] - rgb(p)[0];
    expect(blue([112.5, 29.6]) - blue([112.5, 29.8]), '照今天画的河').toBeGreaterThan(40);
    expect(blue([112.9, 28.0]) - blue([112.9, 28.2]), '示意的河').toBeGreaterThan(20);
    expect(blue([110.6, 29.3]) - blue([110.4, 29.3]), '运河').toBeGreaterThan(40);
    // 河面有多宽：沿一条经线数“比两边的陆地蓝”的点。这两段河都是斜着的，沿经线量比正着量宽一些：
    // 长河的这一段和纬线夹着约 28 度（宽 1.13 倍），运河的这一段夹着约 50 度（宽 1.56 倍）
    const kmPerPoint = (cell * S.scene.frame.scale) / 1000 / 3;
    const across = (p: LngLat): number => {
      const k0 = at(p);
      const blueAt = (k: number): number => painted.colour[k * 3 + 2] - painted.colour[k * 3];
      const land = (blueAt(k0 - 60 * painted.w) + blueAt(k0 + 60 * painted.w)) / 2;
      const half = (blueAt(k0) - land) / 2;
      let n = 0;
      for (let d = -50; d <= 50; d++) if (blueAt(k0 + d * painted.w) - land > half) n++;
      return n * kmPerPoint;
    };
    const trunk = across([111.85, 29.9]);
    const canal = across([110.3, 29.65]);
    expect(trunk / 1.13).toBeGreaterThan(SONG_QINGLV_PAINT.riverKm.trunk * 0.75);
    expect(trunk / 1.13).toBeLessThan(SONG_QINGLV_PAINT.riverKm.trunk * 1.25);
    expect(canal / 1.56).toBeGreaterThan(SONG_QINGLV_PAINT.riverKm.canal * 0.6);
    expect(canal / 1.56).toBeLessThan(SONG_QINGLV_PAINT.riverKm.canal * 1.6);
    expect(trunk).toBeGreaterThan(canal * 2);
    // 空着的一头收细：长河东头断在平地上（不接别的河，不在湖里，没到海边），离头十公里的地方不到中段一半宽
    const nearEnd = across([112.4, 29.646]);
    expect(nearEnd, `离头十公里处宽 ${nearEnd.toFixed(1)} 公里，中段 ${trunk.toFixed(1)} 公里`).toBeLessThan(trunk * 0.5);
    expect(nearEnd).toBeGreaterThan(0);
  });

  it('只染水色的水：比四周的平地蓝，没有岸线，也不画水纹', () => {
    const inWash: LngLat = [113.4, 29.75];
    // 同一条纬线上、往西五十公里的平地（离沙盘的边一样远，留出空绢的那一圈淡得一样多）
    const beside: LngLat = [112.9, 29.75];
    expect(rgb(inWash)[2] - rgb(inWash)[0]).toBeGreaterThan(rgb(beside)[2] - rgb(beside)[0] + 20);
    expect(mark(inWash)).toBe(0);
    // 没有岸线：从里到外颜色是慢慢变的，相邻两个点差不到 6 级
    const k0 = at([113.6, 29.75]);
    for (let d = -30; d < 30; d++) {
      for (let c = 0; c < 3; c++) expect(Math.abs(painted.colour[(k0 + d) * 3 + c] - painted.colour[(k0 + d + 1) * 3 + c])).toBeLessThan(6);
    }
  });
});

describe('一种样式一个画法（tests/tools/route/painters.ts）', () => {
  it('content/ 里每一座全程沙盘写的样式都有画法；有画法的样式都在样式的登记表里；没有画法的样式说得出', () => {
    const keys = realSceneKeys('route');
    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) {
      const style = realRouteScene(key).scene.style;
      expect(Object.keys(ROUTE_PAINTERS), `${key} 的样式“${style}”`).toContain(style);
      expect(typeof routePainterFor(style)).toBe('function');
    }
    for (const style of Object.keys(ROUTE_PAINTERS)) expect(STYLE_IDS, `画法登记的样式“${style}”`).toContain(style);
    expect(() => routePainterFor('zz-none')).toThrow(/^样式“zz-none”还没有全程沙盘地面的画法（tests\/tools\/route\/painters\.ts）；有画法的是：/);
    // 对象自己带的名字不算一种样式
    expect(() => routePainterFor('constructor')).toThrow('还没有全程沙盘地面的画法');
  });

  it('画在地面上的河也是一种样式一份：宋代青绿设色的就是 paint.ts 的 riverPaths，河宽是它的；没有画法的样式要河的线，说一句就停，不拿别的样式的河宽来顶', () => {
    // 做岸线的工具（npm run route:bank）和量“沿河的路离河多远”的测试（tests/stage/route-roads.test.ts）照场景里写的样式从这张表里取河的线
    expect(routeRiversFor('song-qinglv')).toBe(riverPaths);
    for (const [style, row] of Object.entries(ROUTE_PAINTERS)) {
      expect(typeof row.paint, style).toBe('function');
      expect(typeof row.rivers, style).toBe('function');
      expect(routePainterFor(style)).toBe(row.paint);
      expect(routeRiversFor(style)).toBe(row.rivers);
    }
    const S = sample();
    expect(routeRiversFor(S.scene.style)(S.scene, S.features, S.coords).map((p) => [p.id, p.widthKm])).toEqual([
      ['long', SONG_QINGLV_PAINT.riverKm.trunk],
      ['south-stream', SONG_QINGLV_PAINT.riverKm.river],
      ['cut', SONG_QINGLV_PAINT.riverKm.canal],
    ]);
    // 另一种样式的全程沙盘（名字是编的，没有画法）：要河的线，得到的是一句话，不是宋代青绿设色的河
    expect(() => routeRiversFor('zz-none')).toThrow(/^样式“zz-none”还没有全程沙盘地面的画法（tests\/tools\/route\/painters\.ts）；有画法的是：/);
    expect(() => routeRiversFor('constructor')).toThrow('还没有全程沙盘地面的画法');
  });

  it('宋代青绿设色的画法就是 paint.ts 的那一个；它自己的数原来写在样式里，搬过来一个没有改', () => {
    expect(routePainterFor('song-qinglv')).toBe(paintRoute);
    // 搬出来以后，发给读者的样式里没有这三组了
    const shipped = styleFor('song-qinglv').route as unknown as Record<string, unknown>;
    for (const name of ['riverKm', 'colours', 'bands']) expect(shipped[name], name).toBeUndefined();
    // 搬以前写在 src/stage/three/style/songQinglv.ts 的 ROUTE 里的数，一个字不差
    expect(SONG_QINGLV_PAINT).toEqual({
      riverKm: { trunk: 8, major: 4.6, river: 3.6, minor: 2.8, canal: 1.8 },
      colours: { loess: '#dcc592', sand: '#ebe1c2', shoreInk: '#a8936a', sea: '#b3ccd0', seaDeep: '#93b6c1', river: '#6f9db2', riverSong: '#93b3bd' },
      bands: { relK: 1.0, hK: 0.2, noise: 70, foot: [110, 240], footK: 0.6, green: [240, 540], blue: [520, 900], blueK: 0.92, rank: [0.62, 0.92], rankCurv: 1 / 500, deep: [1500, 2600], steep: [0.22, 0.6], patch: 0.24 },
    });
  });
});

// content/ 里真的那一座：留白的边和河口是照着沙盘上的图改的（2026-11-20），在真的地面上查。画一遍三百多万个点，这台机器上八九秒。
describe.each(realSceneKeys('route').filter((key) => key === 'su-shi/route'))('%s 画出来：留白的边，河口', (key) => {
  let painted: { w: number; h: number; rgb: Uint8Array; mask: Uint8Array } | null = null;
  const picture = (): { w: number; h: number; rgb: Uint8Array; mask: Uint8Array } => (painted ??= routeBakeParts(key).paint());

  it('留白的边上颜色比地势先淡完：西边地势还剩三成以下的陆地，画的已经是空绢（或者淡花青的白），没有一格还是石青、石绿', { timeout: 300_000 }, () => {
    const R = realRouteScene(key);
    const { nx, nz, cell, x0, z0, land, blank } = R.ground;
    const p = picture();
    let low = 0;
    let coloured = 0;
    let far = 0;
    let farColoured = 0;
    for (let j = 2; j < nz - 2; j++) {
      for (let i = 2; i < nx - 2; i++) {
        const k = j * nx + i;
        // 只看四周都是陆地的格子：岸边的一格，图上可能已经是海
        if (!land[k] || !land[k - 1] || !land[k + 1] || !land[k - nx] || !land[k + nx] || !land[k - nx - 1] || !land[k - nx + 1] || !land[k + nx - 1] || !land[k + nx + 1]) continue;
        const [lng] = R.coords.toLngLat(x0 + i * cell, z0 + j * cell);
        if (lng > 107.7) continue;
        const t = (j * 3 * p.w + i * 3) * 3;
        // 空绢是 237、222、188 上下，淡花青的白更亮；石绿、石青、赭石的红都不到 190
        const pale = p.rgb[t] >= 195;
        const keep = keepAt(blank[k]);
        if (keep <= 0.3) {
          low++;
          if (!pale) coloured++;
        } else if (blank[k] === 1 && R.ground.h[k] > 1500) {
          // 离留白一百公里以外的高山：照常上色
          far++;
          if (!pale) farColoured++;
        }
      }
    }
    console.log(`${key}：东经 107.7 度以西，地势只剩三成以下的陆地 ${low} 格，其中还上着颜色的 ${coloured} 格；离留白远的高山 ${far} 格，上着颜色的 ${farColoured} 格`);
    expect(low).toBeGreaterThan(20_000);
    expect(coloured).toBe(0);
    // 离留白远的高山照常上着颜色（一成上下是黄土高原上淡的黄土色，本来就淡）：留白没有淡到不该淡的地方去
    expect(farColoured).toBeGreaterThan(far * 0.75);
  });

  it('河口：长江口里是水的颜色，不是岸边那道白；口外是海的颜色', { timeout: 300_000 }, () => {
    const R = realRouteScene(key);
    const { cell, x0, z0 } = R.ground;
    const p = picture();
    const rgb = (q: LngLat): [number, number, number] => {
      const [x, z] = R.coords.toLocal(q);
      const t = (Math.round(((z - z0) / cell) * 3) * p.w + Math.round(((x - x0) / cell) * 3)) * 3;
      return [p.rgb[t], p.rgb[t + 1], p.rgb[t + 2]];
    };
    // 江阴、狼山之间的江面（今天的岸线把这一段画成窄窄的一条海）；口外的海
    const inMouth = rgb([120.79, 31.98]);
    const outside = rgb([122.3, 31.2]);
    console.log(`${key}：长江口里 ${inMouth.join(',')}；口外的海 ${outside.join(',')}`);
    // 岸边那道白：红在 215 上下，蓝比红只多几级。水的颜色：红不到 190，蓝比红多二十级以上
    expect(inMouth[0]).toBeLessThan(190);
    expect(inMouth[2] - inMouth[0]).toBeGreaterThan(20);
    expect(outside[2] - outside[0]).toBeGreaterThan(20);
  });

  it('只染水色的水带着一点湖的蓝：梁山泊、射阳湖的中心，蓝比红多（原来红比蓝多，在平地上是一块发灰的白）；可比真的湖淡得多，不到太湖湖心的六成', { timeout: 300_000 }, () => {
    const R = realRouteScene(key);
    const { cell, x0, z0 } = R.ground;
    const p = picture();
    const blue = (q: LngLat): number => {
      const [x, z] = R.coords.toLocal(q);
      const t = (Math.round(((z - z0) / cell) * 3) * p.w + Math.round(((x - x0) / cell) * 3)) * 3;
      return p.rgb[t + 2] - p.rgb[t];
    };
    const lake = blue([120.2, 31.2]);
    const washes: [string, LngLat][] = [
      ['梁山泊', [116.17, 35.68]],
      ['射阳湖', [119.7, 33.38]],
    ];
    console.log(`${key}：蓝比红多出来的——太湖湖心 ${lake}；` + washes.map(([name, q]) => `${name} ${blue(q)}`).join('，'));
    expect(lake).toBeGreaterThan(25);
    for (const [name, q] of washes) {
      expect(blue(q), name).toBeGreaterThan(0);
      expect(blue(q), name).toBeLessThan(lake * 0.6);
    }
  });
});
