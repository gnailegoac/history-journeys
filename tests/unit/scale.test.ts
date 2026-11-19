// 比例尺在窄的沙盘栏里换一段短的（src/ui/scale.ts）。

import { describe, expect, it } from 'vitest';
import { fitScale } from '../../src/ui/scale';

describe('fitScale', () => {
  it('本来就不超过，原样用（给回去的就是传进来的那一个）', () => {
    const scale = { px: 48, label: '1 公里' };
    expect(fitScale(scale, 56)).toBe(scale);
    expect(fitScale({ px: 56, label: '500 米' }, 56)).toEqual({ px: 56, label: '500 米' });
    expect(fitScale({ px: 140, label: '2 公里' }, Infinity)).toEqual({ px: 140, label: '2 公里' });
  });

  it('超过了，换成不超过的最长的一个整数长度：1、2、5 打头', () => {
    // 2 公里 96 像素：1 公里是 48 像素。
    expect(fitScale({ px: 96, label: '2 公里' }, 56)).toEqual({ px: 48, label: '1 公里' });
    // 2 公里 140 像素：1 公里 70 还是太长，500 米 35。
    expect(fitScale({ px: 140, label: '2 公里' }, 56)).toEqual({ px: 35, label: '500 米' });
    // 5 公里 115 像素：2 公里 46。
    expect(fitScale({ px: 115, label: '5 公里' }, 56)).toEqual({ px: 46, label: '2 公里' });
    // 100 米 100 像素：50 米 50。
    expect(fitScale({ px: 100, label: '100 米' }, 56)).toEqual({ px: 50, label: '50 米' });
    // 1 公里 100 像素：500 米 50（公里换成米）。
    expect(fitScale({ px: 100, label: '1 公里' }, 56)).toEqual({ px: 50, label: '500 米' });
  });

  it('沙盘程序报的每一种比例尺（那一段在 56 到 140 像素之间），换出来的都不超过 56 像素，也不会短得看不见', () => {
    const lengths = [10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000, 100000];
    for (const metres of lengths) {
      for (const px of [57, 70, 96, 120, 140]) {
        const label = metres < 1000 ? `${metres} 米` : `${metres / 1000} 公里`;
        const fitted = fitScale({ px, label }, 56);
        expect(fitted.px, `${label} ${px}`).toBeLessThanOrEqual(56);
        expect(fitted.px, `${label} ${px}`).toBeGreaterThanOrEqual(22);
        // 换了一段，比例不变：每米多少像素还是那个数（像素取整，差不到一个像素）。
        const read = /^(\d+(?:\.\d+)?) (米|公里)$/.exec(fitted.label)!;
        const fittedMetres = Number(read[1]) * (read[2] === '公里' ? 1000 : 1);
        expect(Math.abs(fitted.px - (px / metres) * fittedMetres), `${label} ${px}`).toBeLessThanOrEqual(0.5);
      }
    }
  });

  it('再短也放不下（一米就比这一段宽）：原样用，不乱改', () => {
    expect(fitScale({ px: 140, label: '2 米' }, 56)).toEqual({ px: 140, label: '2 米' });
    expect(fitScale({ px: 140, label: '10 米' }, 56)).toEqual({ px: 28, label: '2 米' });
  });

  it('label 读不懂就原样用，不乱改', () => {
    expect(fitScale({ px: 96, label: '两公里' }, 56)).toEqual({ px: 96, label: '两公里' });
    expect(fitScale({ px: 96, label: '2公里' }, 56)).toEqual({ px: 96, label: '2公里' });
    expect(fitScale({ px: 96, label: '0 米' }, 56)).toEqual({ px: 96, label: '0 米' });
    expect(fitScale({ px: 96, label: '' }, 56)).toEqual({ px: 96, label: '' });
  });
});
