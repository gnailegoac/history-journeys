// 水面的着色器一个字也没有变。
// 水纹的那几个函数从水面的着色器里单拿了出来（src/stage/three/water.ts 的 rippleGlsl），全程沙盘的地面也用它。
// 拿出来以前的原文存了一份（./support/water-shader.stored.glsl）：水面现在拼出来的两段，和存着的逐字对。
// 站点沙盘的定格图是照这份着色器拍的；这里通不过，就是站点沙盘的水面变了。

import { describe, expect, it } from 'vitest';
import { WATER_FRAGMENT, WATER_GLSL, rippleGlsl } from '../../src/stage/three/water';

const stored = import.meta.glob<string>('./support/water-shader.stored.glsl', { query: '?raw', import: 'default', eager: true })['./support/water-shader.stored.glsl'];
const MARK = '\n//// ---- 上面是声明和水纹的函数，下面是换掉 map_fragment 的正文 ----\n';

describe('水面的着色器', () => {
  it('存着的那一份读得到，分得成两段', () => {
    expect(typeof stored).toBe('string');
    expect(stored.split(MARK)).toHaveLength(2);
    expect(stored.includes('\r')).toBe(false);
  });

  it('拼出来的两段和水纹的函数单拿出来以前逐字一样', () => {
    const [common, fragment] = stored.split(MARK);
    expect(WATER_GLSL).toBe(common);
    expect(WATER_FRAGMENT).toBe(fragment);
  });

  it('水纹的函数：不写间隔就是水面用的那一份（8 个页面像素）；写了别的数，只有那一个数不一样', () => {
    const usual = rippleGlsl();
    expect(WATER_GLSL.endsWith(usual)).toBe(true);
    expect(rippleGlsl(8)).toBe(usual);
    expect(usual).toContain('float target = max(px * 8.0, 4.0);');
    const finer = rippleGlsl(6);
    expect(finer).toContain('float target = max(px * 6.0, 4.0);');
    expect(finer.replace('px * 6.0', 'px * 8.0')).toBe(usual);
    // 四个函数都在，量像素的两处都乘着画布的像素比
    for (const name of ['float whash(', 'float wnoise(', 'float rippleOct(', 'float ripples(']) expect(usual).toContain(name);
    expect(usual.split('* uPx;').length - 1).toBe(2);
  });
});
