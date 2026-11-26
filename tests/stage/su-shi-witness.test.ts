// 苏轼四座沙盘的凭证。在 Node 里跑，不要浏览器，随 npm test 跑。
// 存着的那一份（./su-shi-witness.json）是照搬动程序以前的沙盘程序算出来的：座子的网格，全程沙盘的地面，九个小节的笔画，
// 画路的程序交给显卡的每一段线，小像的网格。怎么算、比什么不比什么，见 ./support/witness.ts；
// 这几样东西现在从沙盘程序的哪里取，见 ./support/witnessSubjects.ts（这个文件不直接引沙盘程序）；
// 全程沙盘的场景和地面是 ./support/realScenes.ts 叫沙盘程序算出来的。
//
// 这些测试是给“只搬不改”的改动作证的：一种样式自己的东西搬出沙盘程序，留白、座子、小像的数搬进样式，一种状态的虚线合成一批……
// 造出来的东西要是一个数也没变，这个文件、存着的那一份、怎么比的那个文件就一个字也不用改，照样通过
// （东西搬了地方，改的只是 witnessSubjects.ts 里从哪里取的那几行，和 realScenes.ts 里造地面的那一句）；
// 哪一条不通过，就是造出来的东西变了（定格图多半也要变）。
// 只有写着“今天是这样分批的”那一条例外：改分批办法的那一次要改的就是它，而且只该改它。
// 存着的那一份不随手重算：真要让苏轼的沙盘变样（那是要重拍定格图的事），才连着它一起改，并且在提交里说明。
//
// 数、名字都是苏轼的：写着名字取（su-shi/route，他的三座站点沙盘），不取“排在最前面的那一座”。

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { readBytes } from '../support/readBytes';
import { fakeDocument } from './support/fakeRenderer';
import { meshesWitness, roadBatches, roadSegmentsWitness, routeGroundWitness, strokesWitness } from './support/witness';
import type { MeshesWitness, RoadSegmentsWitness, RouteGroundWitness, StrokesWitness } from './support/witness';
import { pieceOf, roadsOf, routeGroundOf, routeHeadingsOf, standOf, strokesOf } from './support/witnessSubjects';

/** 他的全程沙盘，和三座站点沙盘。 */
const ROUTE = 'su-shi/route';
const STOPS = ['su-shi/huangzhou', 'su-shi/meishan', 'su-shi/xuzhou'] as const;
/** 两档画质。 */
const TIERS = ['full', 'reduced'] as const;
type Tier = (typeof TIERS)[number];

/** 存着的那一份的样子。小节照标题记（“全程”“到徐州”……），两档画质各一份。 */
interface Stored {
  stand: Record<string, MeshesWitness>;
  routeGround: RouteGroundWitness;
  strokes: Record<string, StrokesWitness>;
  roadSegments: Record<Tier, Record<string, RoadSegmentsWitness>>;
  roadBatches: Record<string, string[]>;
  piece: MeshesWitness;
}

const STORED = JSON.parse(new TextDecoder().decode(readBytes('tests/stage/su-shi-witness.json'))) as Stored;

beforeAll(() => {
  // 座子的两张贴图是画在页面的画布上的：给一个假的页面，座子才造得出来（网格是真的，只是贴图上没有画面）
  vi.stubGlobal('document', fakeDocument());
});

afterAll(() => {
  vi.unstubAllGlobals();
});

/** 照现在的程序在一档画质上造他全程沙盘的路，一节一节摆出来，每一节算一份 read 给的东西。 */
async function roadsNow<T>(tier: Tier, read: (root: Awaited<ReturnType<typeof roadsOf>>['root']) => T): Promise<Record<string, T>> {
  const roads = await roadsOf(ROUTE, tier);
  const out: Record<string, T> = {};
  for (const heading of await routeHeadingsOf(ROUTE)) {
    roads.show(heading);
    out[heading] = read(roads.root);
  }
  roads.dispose();
  return out;
}

describe('苏轼的四座沙盘：搬动程序以前留下的凭证', () => {
  // 读地形文件、算一遍全程沙盘的地面，整套测试一起跑的时候要几秒：哪一条先用到它，哪一条就要等，所以每一条都单给一个时限
  it('存着的那一份是齐的：四座沙盘的座子，全程沙盘的地面，每一小节的笔画、两档画质的线段、分批，小像', { timeout: 60_000 }, async () => {
    const headings = await routeHeadingsOf(ROUTE);
    expect(headings.length).toBeGreaterThan(0);
    expect(Object.keys(STORED.stand).sort()).toEqual([...STOPS, ROUTE].sort());
    expect(Object.keys(STORED.strokes)).toEqual(headings);
    expect(Object.keys(STORED.roadBatches)).toEqual(headings);
    for (const tier of TIERS) expect(Object.keys(STORED.roadSegments[tier]), tier).toEqual(headings);
    for (const heading of headings) {
      expect(STORED.strokes[heading].strokes.length, heading).toBeGreaterThan(0);
      expect(STORED.roadBatches[heading].length, heading).toBeGreaterThan(0);
    }
    expect(STORED.routeGround.h.n).toBe(STORED.routeGround.nx * STORED.routeGround.nz);
    expect(STORED.piece.triangles).toBeGreaterThan(0);
  });

  it.each([...STOPS, ROUTE])('%s 的座子：每个三角形的角在哪、朝哪、贴图取哪一点，和存着的一样', { timeout: 60_000 }, async (key) => {
    const stand = await standOf(key);
    expect(meshesWitness(stand.root, ['normal', 'uv'])).toEqual(STORED.stand[key]);
    stand.dispose();
  });

  it(`${ROUTE} 的地面：格子，海拔，沙盘里的高度，是不是陆地，离留白多远，和存着的一样`, { timeout: 60_000 }, async () => {
    expect(routeGroundWitness(await routeGroundOf(ROUTE))).toEqual(STORED.routeGround);
  });

  it(`${ROUTE} 九个小节的笔画：哪几截路连成一笔、哪一种、实线还是虚线、线上的每一点，和存着的一样`, { timeout: 60_000 }, async () => {
    const now: Record<string, StrokesWitness> = {};
    for (const [index, heading] of (await routeHeadingsOf(ROUTE)).entries()) now[heading] = strokesWitness(await strokesOf(ROUTE, index));
    expect(now).toEqual(STORED.strokes);
  });

  it.each(TIERS)(
    `${ROUTE} 九个小节，%s 这一档：画路的程序交给显卡的每一段线（两头在哪，虚线上离这一笔的起头多远），按层、颜色、粗细、虚实分开，和存着的一样——不管分几批、先后怎样`,
    { timeout: 60_000 },
    async (tier) => {
      expect(await roadsNow(tier, roadSegmentsWitness)).toEqual(STORED.roadSegments[tier]);
    },
  );

  it(`${ROUTE} 九个小节：今天路是这样分批的——垫底的一批，每种状态的实线一批，虚线一笔一条（改分批办法的那一次改的是这一条；上面两档的线段不该动）`, { timeout: 60_000 }, async () => {
    const full = await roadsNow('full', roadBatches);
    expect(full).toEqual(STORED.roadBatches);
    // 减配的一档只是每一种粗一点：批数、先后、每批几段都一样
    const reduced = await roadsNow('reduced', roadBatches);
    for (const heading of Object.keys(full)) {
      expect(reduced[heading].map((line) => line.slice(line.indexOf('：'))), heading).toEqual(full[heading].map((line) => line.slice(line.indexOf('：'))));
    }
  });

  it('苏轼这种样式的小像：每个三角形的角在哪、什么颜色，和存着的一样', { timeout: 60_000 }, async () => {
    const piece = await pieceOf(ROUTE);
    expect(meshesWitness(piece.root, ['color'])).toEqual(STORED.piece);
    piece.dispose();
  });
});
