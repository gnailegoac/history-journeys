// 全程沙盘上的路画成什么线（src/stage/roadLines.ts）：拐角抹圆，一小节里哪几趟路画成哪一种，排成一笔一笔。
// 先在编出来的线和编出来的小场景上查算法，再照 content/ 里真的全程沙盘查一遍，把每一节有多少段线打印出来。
// 在 Node 里跑，不要浏览器；这个模块不引 three。

import { describe, expect, it } from 'vitest';
import type { RouteScene } from '../../src/domain/scene';
import type { FrameCoords } from '../../src/domain/sceneGeo';
import { coordsOf } from '../../src/domain/sceneGeoRoute';
import type { Vec2 } from '../../src/stage/ground/types';
import { ROAD_CORNER_KM, ROAD_CORNER_STEPS, ROAD_STATES, ROAD_STEP_KM, densify, journeyStates, lineLength, roadRuns, roundCorners, roundedWay, segmentCount, segmentsOf, wayLine } from '../../src/stage/roadLines';
import type { RoadRun } from '../../src/stage/roadLines';
import { waySolid } from '../tools/route/mapTool';

/** 抹圆以后的线离写的线最远多少公里（设计里定的）。 */
const ROUNDED_OFF_MAX_KM = 3;

/** 一点离一条折线最近多远。 */
function toLine(p: Vec2, line: Vec2[]): number {
  let best = Infinity;
  for (let i = 1; i < line.length; i++) {
    const [ax, az] = line[i - 1];
    const dx = line[i][0] - ax;
    const dz = line[i][1] - az;
    const t = Math.min(1, Math.max(0, ((p[0] - ax) * dx + (p[1] - az) * dz) / (dx * dx + dz * dz || 1)));
    best = Math.min(best, Math.hypot(p[0] - ax - dx * t, p[1] - az - dz * t));
  }
  return best;
}

describe('拐角抹圆', () => {
  it('一个直角：从两边各切掉 9，换成六段的弧；头尾不动；弧的正中在 [97.75, 2.25]', () => {
    const line: Vec2[] = [[0, 0], [100, 0], [100, 100]];
    const out = roundCorners(line, 9);
    expect(out).toHaveLength(1 + (ROAD_CORNER_STEPS + 1) + 1);
    expect(out[0]).toEqual([0, 0]);
    expect(out[out.length - 1]).toEqual([100, 100]);
    expect(out[1]).toEqual([91, 0]);
    expect(out[1 + ROAD_CORNER_STEPS]).toEqual([100, 9]);
    const mid = out[1 + ROAD_CORNER_STEPS / 2];
    expect(mid[0]).toBeCloseTo(97.75, 9);
    expect(mid[1]).toBeCloseTo(2.25, 9);
    // 弧上每一点离原来的折线不超过 9 的四分之一
    for (const p of out) expect(toLine(p, line)).toBeLessThanOrEqual(9 / 4 + 1e-9);
    // 给回去的是新的点，不是传进来的那几个
    expect(out[0]).not.toBe(line[0]);
  });

  it('边短的拐角少切（不超过边长的 0.45）；差不多是直的、切不下多少的拐角不动；两个点的线原样', () => {
    // 两条 10 长的边：各切 4.5
    const short = roundCorners([[0, 0], [10, 0], [10, 10]], 9);
    expect(short[1]).toEqual([5.5, 0]);
    expect(short[1 + ROAD_CORNER_STEPS]).toEqual([10, 4.5]);
    // 拐了不到 8 度（余弦大于 0.99）：不动
    expect(roundCorners([[0, 0], [100, 0], [200, 10]], 9)).toEqual([[0, 0], [100, 0], [200, 10]]);
    // 边只有 2 长：能切的 0.9 不到 9 的九分之一，不动
    expect(roundCorners([[0, 0], [2, 0], [2, 100]], 9)).toEqual([[0, 0], [2, 0], [2, 100]]);
    expect(roundCorners([[0, 0], [7, 3]], 9)).toEqual([[0, 0], [7, 3]]);
    // 拐得小的少分几段：拐 45 度分三段，拐 20 度分两段，拐 135 度还是六段
    const turned = (deg: number): Vec2[] => [[0, 0], [100, 0], [100 + 100 * Math.cos((deg * Math.PI) / 180), 100 * Math.sin((deg * Math.PI) / 180)]];
    expect(roundCorners(turned(45), 9)).toHaveLength(2 + 3 + 1);
    expect(roundCorners(turned(20), 9)).toHaveLength(2 + 2 + 1);
    expect(roundCorners(turned(135), 9)).toHaveLength(2 + ROAD_CORNER_STEPS + 1);
    // 连着两个拐角，中间的边 20 长：两边各切 9，两段弧不碰头
    const two = roundCorners([[0, 0], [100, 0], [100, 20], [0, 20]], 9);
    expect(two).toHaveLength(2 + 2 * (ROAD_CORNER_STEPS + 1));
    expect(two[1 + ROAD_CORNER_STEPS]).toEqual([100, 9]);
    expect(two[2 + ROAD_CORNER_STEPS]).toEqual([100, 11]);
  });

  it('加密：没有哪一段比给的长；原来的点都在；量长短', () => {
    const line: Vec2[] = [[0, 0], [100, 0], [100, 13]];
    const dense = densify(line, 6);
    // 100 长的分成 17 段，13 长的分成 3 段
    expect(dense).toHaveLength(1 + 17 + 3);
    for (let i = 1; i < dense.length; i++) expect(Math.hypot(dense[i][0] - dense[i - 1][0], dense[i][1] - dense[i - 1][1])).toBeLessThanOrEqual(6 + 1e-9);
    expect(dense[17]).toEqual([100, 0]);
    expect(dense[dense.length - 1]).toEqual([100, 13]);
    expect(lineLength(dense)).toBeCloseTo(113, 9);
    // 正好是整数倍的不多分一段
    expect(densify([[0, 0], [12, 0]], 6)).toEqual([[0, 0], [6, 0], [12, 0]]);
  });
});

// ---------------------------------------------------------------- 编出来的小场景

/** 编出来的换算：1 度是 100 公里；沙盘的比例是 1000，所以沙盘里的 1 米是地上的 1 公里。 */
const FLAT: FrameCoords = {
  toLocal: (p) => [p[0] * 100, 0 - p[1] * 100],
  toLngLat: (x, z) => [x / 100, 0 - z / 100],
  inside: () => true,
  y: () => 0,
  x0: -1000,
  x1: 1000,
  z0: -1000,
  z1: 1000,
};

/** 四截路、三趟、四节的小场景（只有这个模块读的那几样）。 */
function small(): RouteScene {
  const part = (cls: 'text' | 'schematic', ways: string[]) => ({ name: '编的', class: cls, basis: '编的', sourceIds: [], ways });
  return {
    frame: { scale: 1000 },
    roads: {
      ways: [
        { id: 'wa', by: 'land', line: [[0, 0], [1, 0]] },
        { id: 'wb', by: 'land', line: [[1, 0], [1, 1]] },
        { id: 'wc', by: 'land', line: [[1, 1], [2, 1]] },
        { id: 'wd', by: 'water', line: [[1, 0], [2, 0]] },
      ],
      journeys: [
        { id: 'j1', name: '第一趟', stop: 's1', date: '编的', parts: [part('text', ['wa', 'wb']), part('schematic', ['wc'])] },
        { id: 'j2', name: '第二趟', stop: 's2', date: '编的', parts: [part('schematic', ['-wb', 'wd'])] },
        { id: 'j3', name: '第三趟', stop: 's3', date: '编的', parts: [part('text', ['wa']), part('schematic', ['wd'])] },
      ],
    },
    sections: [{ heading: '全程' }, { heading: '到一', stop: 's1' }, { heading: '到二', stop: 's2' }, { heading: '到三', stop: 's3' }],
  } as unknown as RouteScene;
}

/** 一笔写成一句：哪一种、虚实、哪几截路。 */
const say = (run: RoadRun): string => `${run.state} ${run.dotted ? '虚' : '实'} ${run.ways.join('+')}`;

describe('一小节里的路排成一笔一笔（编出来的小场景）', () => {
  it('哪几趟画成哪一种：头一节都是墨线；后面到这一站的是刚走的，前面各站的是走过的，后面的不画', () => {
    const scene = small();
    expect([...journeyStates(scene, 0)]).toEqual([['j1', 'ink'], ['j2', 'ink'], ['j3', 'ink']]);
    expect([...journeyStates(scene, 1)]).toEqual([['j1', 'now']]);
    expect([...journeyStates(scene, 2)]).toEqual([['j1', 'past'], ['j2', 'now']]);
    expect([...journeyStates(scene, 3)]).toEqual([['j1', 'past'], ['j2', 'past'], ['j3', 'now']]);
    expect(ROAD_STATES).toEqual(['now', 'ink', 'past']);
  });

  it('全程：每截路只画一笔；有“按史料摆的”一截走到的是实线；接着走、虚实一样的连成一笔', () => {
    const runs = roadRuns(small(), FLAT, 0);
    expect(runs.map(say)).toEqual(['ink 实 wa+wb', 'ink 虚 wc', 'ink 虚 wd']);
    // 头一笔：两截各 100 公里，6 公里一段是 17 段；接头上的那一点只有一个，接头（城）不抹圆
    expect(runs[0].points).toHaveLength(1 + 17 + 17);
    expect(runs[0].points[0]).toEqual([0, 0]);
    expect(runs[0].points[17]).toEqual([100, 0]);
    expect(runs[0].points[34]).toEqual([100, -100]);
    expect(runs[0].lengthM).toBeCloseTo(200, 9);
    expect(segmentCount(runs)).toBe(34 + 17 + 17);
  });

  it('后面的小节：刚走的压过走过的；倒着走的一截点也倒过来；一趟里中间隔着画过的一截，就断成两笔', () => {
    const scene = small();
    expect(roadRuns(scene, FLAT, 1).map(say)).toEqual(['now 实 wa+wb', 'now 虚 wc']);
    // 第三节：第二趟只有“示意的”，倒着走 wb 再走 wd，连成一笔虚线；第一趟的 wb 已经画过，它的 wa 和 wc 断成两笔
    const third = roadRuns(scene, FLAT, 2);
    expect(third.map(say)).toEqual(['now 虚 -wb+wd', 'past 实 wa', 'past 虚 wc']);
    expect(third[0].points[0]).toEqual([100, -100]);
    expect(third[0].points[17]).toEqual([100, 0]);
    expect(third[0].points[34]).toEqual([200, 0]);
    // 第四节：第三趟的 wa 是实线、wd 是虚线，虚实不一样不连；走过的两趟里 wb 只画一笔，是实线（第一趟按史料摆的）
    expect(roadRuns(scene, FLAT, 3).map(say)).toEqual(['now 实 wa', 'now 虚 wd', 'past 实 wb', 'past 虚 wc']);
  });

  it('合成线段表：每段四个数，一笔和下一笔之间不连', () => {
    const runs = roadRuns(small(), FLAT, 3);
    const solidNow = segmentsOf(runs.filter((run) => run.state === 'now' && !run.dotted));
    expect(solidNow).toHaveLength(17 * 4);
    expect([...solidNow.slice(0, 4)]).toEqual([0, 0, Math.fround(100 / 17), 0]);
    expect([...solidNow.slice(-4)].map((v) => Math.round(v * 1000) / 1000)).toEqual([94.118, 0, 100, 0]);
    const all = segmentsOf(runs);
    expect(all).toHaveLength(segmentCount(runs) * 4);
    // 第一笔的末一段到 [100, 0]，第二笔（wd）从 [100, 0] 起：表里是两段各自的头尾，没有多出来的一段
    expect([...all.slice(17 * 4, 17 * 4 + 2)]).toEqual([100, 0]);
  });

  it('一截路自己的拐角抹圆一次：沙盘里的米（这里 1 米是 1 公里），切掉的是 9 公里', () => {
    const scene = small();
    scene.roads.ways.push({ id: 'we', by: 'land', line: [[0, 0], [1, 0], [1, 1]] });
    const way = scene.roads.ways[4];
    const rounded = roundedWay(scene, FLAT, way);
    expect(rounded[1]).toEqual([100 - ROAD_CORNER_KM, 0]);
    expect(rounded[1 + ROAD_CORNER_STEPS]).toEqual([100, -ROAD_CORNER_KM]);
    const line = wayLine(scene, FLAT, way);
    expect(line[0]).toEqual([0, 0]);
    expect(line[line.length - 1]).toEqual([100, -100]);
    for (let i = 1; i < line.length; i++) expect(Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1])).toBeLessThanOrEqual(ROAD_STEP_KM + 1e-9);
  });
});

// ---------------------------------------------------------------- content/ 里真的全程沙盘

const sceneFiles = import.meta.glob<{ level?: string }>('/content/figures/*/scenes/route.json', { import: 'default', eager: true });
const real = Object.entries(sceneFiles).map(([path, scene]) => ({ key: path.replace('/content/figures/', '').replace('/scenes/route.json', '/route'), scene: scene as unknown as RouteScene }));

describe.each(real)('$key 的路画成的线', ({ key, scene }) => {
  const coords = coordsOf(scene);
  const km = (m: number): number => (m * scene.frame.scale) / 1000;

  it('每一截路：抹圆以后的线离写的线不超过 3 公里，两头一点不动；写的拐点离抹圆以后的线不超过切掉的一半（打印最大的）', () => {
    let worst = { way: '', km: 0 };
    let worstCorner = { way: '', km: 0 };
    let corners = 0;
    for (const way of scene.roads.ways) {
      const written = way.line.map((p): Vec2 => coords.toLocal(p));
      const rounded = roundedWay(scene, coords, way);
      expect(rounded[0]).toEqual(written[0]);
      expect(rounded[rounded.length - 1]).toEqual(written[written.length - 1]);
      // 抹圆了的拐角：写的拐点不在抹圆以后的线上了
      corners += written.filter((p) => !rounded.some((q) => q[0] === p[0] && q[1] === p[1])).length;
      // 抹圆以后的线每公里取一点，量它离写的线多远
      for (const p of densify(rounded, 1000 / scene.frame.scale)) {
        const off = km(toLine(p, written));
        if (off > worst.km) worst = { way: way.id, km: off };
      }
      for (const p of written) {
        const off = km(toLine(p, rounded));
        if (off > worstCorner.km) worstCorner = { way: way.id, km: off };
      }
    }
    console.log(`${key}：${scene.roads.ways.length} 截路，抹圆了 ${corners} 个拐角；抹圆以后的线离写的线最远 ${worst.km.toFixed(2)} 公里（${worst.way}）；写的拐点离抹圆以后的线最远 ${worstCorner.km.toFixed(2)} 公里（${worstCorner.way}）`);
    expect(corners).toBeGreaterThan(20);
    expect(worst.km).toBeLessThanOrEqual(ROUNDED_OFF_MAX_KM);
    expect(worstCorner.km).toBeLessThanOrEqual(ROAD_CORNER_KM / 2 + 1e-6);
  });

  it('每一节：该画的每一截路正好画一笔；没有哪一段线超过 6 公里；一笔里的点是连着的；有多少段线打印出来', () => {
    const lines: string[] = [];
    scene.sections.forEach((section, index) => {
      const states = journeyStates(scene, index);
      const runs = roadRuns(scene, coords, index);
      // 该画的：这一节要画的每一趟走到的每一截路
      const wanted = new Set<string>();
      for (const journey of scene.roads.journeys) if (states.has(journey.id)) for (const part of journey.parts) for (const written of part.ways) wanted.add(written.replace(/^-/, ''));
      const drawn = runs.flatMap((run) => run.ways.map((written) => written.replace(/^-/, '')));
      expect(drawn.slice().sort(), `${section.heading}：画的路和该画的路不一样`).toEqual([...wanted].sort());
      for (const run of runs) {
        expect(run.points.length).toBeGreaterThanOrEqual(2);
        for (let i = 1; i < run.points.length; i++) {
          const step = km(Math.hypot(run.points[i][0] - run.points[i - 1][0], run.points[i][1] - run.points[i - 1][1]));
          expect(step, `${section.heading} 的 ${run.ways.join('+')} 有一段 ${step.toFixed(1)} 公里`).toBeLessThanOrEqual(ROAD_STEP_KM + 1e-6);
          expect(step).toBeGreaterThan(0);
        }
        expect(run.lengthM).toBeCloseTo(lineLength(run.points), 6);
      }
      const count = (state: string, dotted: boolean): number => segmentCount(runs.filter((run) => run.state === state && run.dotted === dotted));
      const per = ROAD_STATES.filter((state) => runs.some((run) => run.state === state)).map((state) => `${state} 实线 ${count(state, false)} 段、虚线 ${count(state, true)} 段（${runs.filter((run) => run.state === state && run.dotted).length} 笔）`);
      const total = segmentCount(runs);
      lines.push(`  ${section.heading}：${runs.length} 笔，${km(runs.reduce((sum, run) => sum + run.lengthM, 0)).toFixed(0)} 公里；${per.join('；')}；连垫在下面的浅色线一共 ${total * 2} 段，${total * 2 * 6} 个三角形`);
      expect(segmentsOf(runs)).toHaveLength(total * 4);
    });
    console.log(`${key} 每一节的路（一段线是六个三角形；每一笔下面垫一份浅色的）：\n${lines.join('\n')}`);
    // 全程那一节：每一截路都画了，都是墨线
    const whole = roadRuns(scene, coords, 0);
    expect(new Set(whole.flatMap((run) => run.ways.map((written) => written.replace(/^-/, '')))).size).toBe(scene.roads.ways.length);
    expect(whole.every((run) => run.state === 'ink')).toBe(true);
    // 虚实和检查图（npm run route:map）另一个函数算出来的一样：有“按史料摆的”一截走到的是实线
    for (const run of whole) for (const written of run.ways) expect(run.dotted, `全程里的 ${written}`).toBe(!waySolid(scene, written.replace(/^-/, '')));
  });

  it('到徐州那一节（要是有）：到徐州的一趟是刚走的，前面四站的四趟是走过的，后面的不画', () => {
    const index = scene.sections.findIndex((section) => section.stop === 'xuzhou');
    if (key !== 'su-shi/route') return;
    expect(index).toBeGreaterThan(0);
    expect([...journeyStates(scene, index)]).toEqual([['j-1056', 'past'], ['j-1059', 'past'], ['j-1071', 'past'], ['j-1074', 'past'], ['j-1077', 'now']]);
    // 最后一节：两趟刚走的，别的都是走过的，一趟不少
    const lastStates = journeyStates(scene, scene.sections.length - 1);
    expect(lastStates.size).toBe(scene.roads.journeys.length);
    expect([...lastStates].filter(([, state]) => state === 'now').map(([id]) => id)).toEqual(['j-1094', 'j-1097']);
  });
});

// ---------------------------------------------------------------- 谁可以引这个模块

describe('src/stage/roadLines.ts 只给全程沙盘的那一块程序用', () => {
  const sources = import.meta.glob<string>('/src/**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true });
  /** 可以引它的文件：全程沙盘才下载的那一块，它后面画路的文件，和算小像站在哪的文件（也只跟着那一块下载）。 */
  const MAY_IMPORT = ['/src/stage/three/routeLevel.ts', '/src/stage/three/routeKit.ts', '/src/stage/pieceWhere.ts'];
  /** 哪些文件引了 pieceWhere（只取类型的也算，动态的也算）。 */
  const pieceImporters = (files: Record<string, string>): string[] =>
    Object.entries(files)
      .filter(([file, text]) => file !== '/src/stage/pieceWhere.ts' && /from\s*['"][^'"]*\/pieceWhere['"]|import\(\s*['"][^'"]*\/pieceWhere['"]\s*\)/.test(text))
      .map(([file]) => file);

  /** 一个文件里运行时真的引进来的东西（只取类型的不算）：从哪里引的。动态的 import() 也算。 */
  const runtimeImports = (text: string): string[] => [
    ...[...text.matchAll(/(?:^|\n)\s*import\s+(type\s+)?[^;]*?from\s*['"]([^'"]+)['"]/g)].filter((m) => !m[1]).map((m) => m[2]),
    ...[...text.matchAll(/(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g)].map((m) => m[1]),
    ...[...text.matchAll(/\bimport\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1]),
  ];
  /** 哪些文件引了 roadLines（只取类型的也算：页面那边连它的类型也用不着）。 */
  const importersOf = (files: Record<string, string>): string[] =>
    Object.entries(files)
      .filter(([file, text]) => file !== '/src/stage/roadLines.ts' && /from\s*['"][^'"]*\/roadLines['"]|import\(\s*['"][^'"]*\/roadLines['"]\s*\)/.test(text))
      .map(([file]) => file);

  it('它自己不引 three，引别的文件只取类型', () => {
    const text = sources['/src/stage/roadLines.ts'];
    expect(text).toBeDefined();
    expect(text).toContain('import type');
    expect(runtimeImports(text)).toEqual([]);
    // 这个查法认得出来：添一句真的引入就查得到
    expect(runtimeImports(`${text}\nimport { Group } from 'three';\n`)).toEqual(['three']);
    expect(runtimeImports("import './engine';\nconst kit = await import('./routeKit');\nimport type { A } from './a';")).toEqual(['./engine', './routeKit']);
  });

  it('页面的程序、站点沙盘的程序都没有引它', () => {
    expect(importersOf(sources).filter((file) => !MAY_IMPORT.includes(file))).toEqual([]);
    // 这个查法认得出来：页面的一个文件引了它（哪怕只取类型、哪怕是动态的）就查得到
    expect(importersOf({ ...sources, '/src/ui/planted.ts': "import { roadRuns } from '../stage/roadLines';" })).toContain('/src/ui/planted.ts');
    expect(importersOf({ '/src/stage/index.ts': "const lines = await import('./roadLines');", '/src/stage/three/view.ts': "import type { RoadRun } from '../roadLines';" })).toEqual(['/src/stage/index.ts', '/src/stage/three/view.ts']);
  });

  it('pieceWhere.ts 只有全程沙盘那一块程序引它（routeLevel.ts）：页面的程序、站点沙盘的程序都不引', () => {
    const text = sources['/src/stage/pieceWhere.ts'];
    expect(text).toBeDefined();
    // 它自己不引 three；真的引进来的只有路的线（roadLines.ts），别的只取类型
    expect(runtimeImports(text)).toEqual(['./roadLines']);
    expect(pieceImporters(sources)).toEqual(['/src/stage/three/routeLevel.ts']);
    // 这个查法认得出来：页面的一个文件、沙盘程序的一个文件引了它（哪怕只取类型、哪怕是动态的）就查得到
    expect(pieceImporters({ ...sources, '/src/timebar/planted.ts': "import { pieceWhere } from '../stage/pieceWhere';" })).toContain('/src/timebar/planted.ts');
    expect(pieceImporters({ '/src/stage/three/view.ts': "import type { PieceChain } from '../pieceWhere';", '/src/stage/index.ts': "const where = await import('./pieceWhere');" })).toEqual(['/src/stage/three/view.ts', '/src/stage/index.ts']);
  });

  it('placeAround.ts（小像停着的时候题签只挪碰着他的那几条）只有全程沙盘那一块程序引它（routeLevel.ts）：页面的程序、站点沙盘的程序、题签层自己都不引', () => {
    /** 哪些文件引了 placeAround（只取类型的也算，动态的也算）。 */
    const importers = (files: Record<string, string>): string[] =>
      Object.entries(files)
        .filter(([file, text]) => file !== '/src/stage/overlay/placeAround.ts' && /from\s*['"][^'"]*\/placeAround['"]|import\(\s*['"][^'"]*\/placeAround['"]\s*\)/.test(text))
        .map(([file]) => file);
    const text = sources['/src/stage/overlay/placeAround.ts'];
    expect(text).toBeDefined();
    // 它自己真的引进来的只有摆题签的那一个文件（那一个在页面的程序里：定格图也用它）
    expect(runtimeImports(text)).toEqual(['./placeStrips']);
    expect(importers(sources)).toEqual(['/src/stage/three/routeLevel.ts']);
    // 题签层的入口（src/stage/overlay/index.ts）不把它转出去：转出去，页面的程序就带上它了
    expect(sources['/src/stage/overlay/index.ts']).not.toContain('placeAround');
    // 这个查法认得出来
    expect(importers({ ...sources, '/src/stage/overlay/strips.ts': "import { aroundPiece } from './placeAround';" })).toContain('/src/stage/overlay/strips.ts');
    expect(importers({ '/src/stage/three/view.ts': "import type { StripPlacer } from '../overlay/placeAround';", '/src/stage/index.ts': "const around = await import('./overlay/placeAround');" })).toEqual(['/src/stage/three/view.ts', '/src/stage/index.ts']);
  });
});
