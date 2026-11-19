// 两档画质各是哪几个数（src/stage/three/quality.ts），和画布该用多少像素比。只是算数，不要浏览器。
// 运行：npx vitest run tests/stage/quality.test.ts
//
// 这里的数都还没有在平板和手机上量过；测试守的是“写下来的数没有被悄悄改掉”，不是“这些数是对的”。

import { describe, expect, it } from 'vitest';
import type { Quality } from '../../src/stage/three/internal';
import { FULL_QUALITY, REDUCED_QUALITY, pixelRatioFor, qualityFor } from '../../src/stage/three/quality';
// 贴图的边长最多多少像素（影子贴图也是一张贴图）：这个上限只在 support/budgets.ts 写一次
import { TEXTURE_EDGE_MAX } from './support/budgets';

describe('两档画质', () => {
  it('完整的一档，一个数不差', () => {
    expect(FULL_QUALITY).toEqual({
      tier: 'full',
      pixelRatioCap: 2,
      maxDrawPixels: 4_000_000,
      antialias: true,
      shadowMapSize: 2048,
      treeKeep: 1,
      houseKeep: 1,
      mistLayers: 3,
    });
  });

  it('减配的一档，一个数不差：像素比最多 1.5，不开抗锯齿，影子贴图小一半，树和成片的民居各留一半，雾一层', () => {
    expect(REDUCED_QUALITY).toEqual({
      tier: 'reduced',
      pixelRatioCap: 1.5,
      maxDrawPixels: 2_000_000,
      antialias: false,
      shadowMapSize: 1024,
      treeKeep: 0.5,
      houseKeep: 0.5,
      mistLayers: 1,
    });
  });

  it('减配的每一个数都不比完整的多', () => {
    const numbers: (keyof Quality)[] = ['pixelRatioCap', 'maxDrawPixels', 'shadowMapSize', 'treeKeep', 'houseKeep', 'mistLayers'];
    for (const key of numbers) expect(REDUCED_QUALITY[key] as number, key).toBeLessThanOrEqual(FULL_QUALITY[key] as number);
  });

  it('两档的影子贴图都不超过贴图的上限', () => {
    for (const quality of [FULL_QUALITY, REDUCED_QUALITY]) expect(quality.shadowMapSize, quality.tier).toBeLessThanOrEqual(TEXTURE_EDGE_MAX);
  });

  it('按档取：full 给完整的那一份，reduced 给减配的那一份（是同一个东西，不是抄一份）', () => {
    expect(qualityFor('full')).toBe(FULL_QUALITY);
    expect(qualityFor('reduced')).toBe(REDUCED_QUALITY);
  });
});

describe('画布用多少像素比', () => {
  /**
   * 几种屏幕上的沙盘栏（CSS 像素）和屏幕的像素比，两档各该用多少。
   * 沙盘栏的大小是照页面的版式算的：宽屏时正文一栏之外都是沙盘，窄屏时沙盘栏高是窗口的四成。
   */
  const screens: { name: string; pane: [number, number]; dpr: number; full: number; reduced: number }[] = [
    { name: '手机 390 × 844，像素比 3', pane: [390, 338], dpr: 3, full: 2, reduced: 1.5 },
    { name: '平板横着 1080 × 810，像素比 2', pane: [640, 810], dpr: 2, full: 2, reduced: 1.5 },
    { name: '平板竖着 810 × 1080，像素比 2', pane: [810, 432], dpr: 2, full: 2, reduced: 1.5 },
    { name: '大平板 1366 × 1024，像素比 2', pane: [874, 1024], dpr: 2, full: 2, reduced: 1.49 },
    { name: '笔记本 1440 × 900，像素比 1', pane: [940, 900], dpr: 1, full: 1, reduced: 1 },
    { name: '笔记本 1512 × 982，像素比 2', pane: [1012, 982], dpr: 2, full: 2, reduced: 1.42 },
    // 根号下（400 万 ÷ 1,533,600）是 1.615005…，四舍五入是 1.62（设计草稿的表里手算成了 1.61）
    { name: '台式机 1920 × 1080，像素比 2', pane: [1420, 1080], dpr: 2, full: 1.62, reduced: 1.14 },
    { name: '台式机 2560 × 1440，像素比 1', pane: [2060, 1440], dpr: 1, full: 1, reduced: 1 },
  ];

  it.each(screens)('$name', ({ pane, dpr, full, reduced }) => {
    expect(pixelRatioFor(FULL_QUALITY, dpr, pane[0], pane[1])).toBe(full);
    expect(pixelRatioFor(REDUCED_QUALITY, dpr, pane[0], pane[1])).toBe(reduced);
  });

  it('画出来的像素总数：不到上限的照屏幕的来，到了上限的压在上限附近（四舍五入最多多出百分之一），最低的像素比是 1', () => {
    const lines: string[] = [];
    for (const { name, pane, dpr } of screens) {
      const area = pane[0] * pane[1];
      const cells: string[] = [];
      for (const quality of [FULL_QUALITY, REDUCED_QUALITY]) {
        const ratio = pixelRatioFor(quality, dpr, pane[0], pane[1]);
        const pixels = area * ratio * ratio;
        expect(ratio).toBeGreaterThanOrEqual(1);
        expect(ratio).toBeLessThanOrEqual(Math.max(1, Math.min(dpr, quality.pixelRatioCap)));
        // 像素比已经是 1 的不能再降：那时候可以超过上限
        if (ratio > 1) expect(pixels, `${name} ${quality.tier}`).toBeLessThanOrEqual(quality.maxDrawPixels * 1.01);
        cells.push(`${quality.tier} ${ratio}（${(pixels / 1e6).toFixed(2)} 百万像素）`);
      }
      lines.push(`  ${name}，沙盘栏 ${pane[0]} × ${pane[1]}：${cells.join('，')}`);
    }
    console.log(`各种屏幕上画布的像素比：\n${lines.join('\n')}`);
  });

  it('屏幕的像素比不到 1、没有、不是数：按 1 算', () => {
    expect(pixelRatioFor(FULL_QUALITY, 0.75, 940, 900)).toBe(1);
    expect(pixelRatioFor(FULL_QUALITY, 0, 940, 900)).toBe(1);
    expect(pixelRatioFor(FULL_QUALITY, Number.NaN, 940, 900)).toBe(1);
  });

  it('沙盘栏收起来了（宽或高是 0）：照屏幕的像素比来，最多到这一档的数，不出错', () => {
    expect(pixelRatioFor(FULL_QUALITY, 3, 0, 0)).toBe(2);
    expect(pixelRatioFor(REDUCED_QUALITY, 3, 390, 0)).toBe(1.5);
  });

  it('取到小数点后两位', () => {
    // 屏幕的像素比是 1.3333…（浏览器放大到 133% 时会这样）
    expect(pixelRatioFor(FULL_QUALITY, 4 / 3, 940, 900)).toBe(1.33);
    // 1920 × 1080 的沙盘栏：根号下（400 万 ÷ 2,073,600）是 1.3888…
    expect(pixelRatioFor(FULL_QUALITY, 2, 1920, 1080)).toBe(1.39);
  });
});
