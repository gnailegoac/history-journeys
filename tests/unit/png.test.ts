// 写、读 PNG 的那两个函数（tests/support/png.ts）。在 Node 里跑，不要浏览器。
// 查五件：写出来再读回来，一个字节不差；同样的像素写两遍，字节一样；写出来的文件照 PNG 的规矩（开头、文件头、结尾）；
// 读得了别人写的 PNG（这里手拼几张用了五种滤法的，灰度、彩色、带透明的都有）；坏了的、读不了的说得出是哪里不对。

import { deflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { decodePng, encodeGreyPng } from '../support/png';

/** 一串不靠随机数的“乱”字节：同样的种子每次一样。 */
function noise(n: number, seed: number): Uint8Array {
  const out = new Uint8Array(n);
  let s = seed >>> 0;
  for (let i = 0; i < n; i++) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    out[i] = s >>> 24;
  }
  return out;
}

/** 两份字节从第几个起不一样；长短不同算在短的那一份的末尾；完全一样是 −1。 */
function firstDifference(a: Uint8Array, b: Uint8Array): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return i;
  return a.length === b.length ? -1 : n;
}

/** 几种样子的灰度图：各种滤法都有挑得上的。 */
const PICTURES: { name: string; w: number; h: number; pixels: Uint8Array }[] = (() => {
  const make = (name: string, w: number, h: number, at: (x: number, y: number) => number) => {
    const pixels = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) pixels[y * w + x] = at(x, y) & 0xff;
    return { name, w, h, pixels };
  };
  return [
    make('一个点', 1, 1, () => 200),
    make('一行', 7, 1, (x) => x * 40),
    make('一列', 1, 9, (_x, y) => y * 30),
    make('全黑', 31, 17, () => 0),
    make('全白', 31, 17, () => 255),
    make('从左到右渐变', 300, 5, (x) => x),
    make('从上到下渐变', 5, 300, (_x, y) => y),
    make('斜着渐变', 97, 61, (x, y) => x * 3 + y * 5),
    make('大块的 0 和 255（像田的标记）', 257, 129, (x, y) => (Math.floor(x / 40) + Math.floor(y / 25)) % 2 === 0 ? 0 : 255),
    { name: '乱的', w: 211, h: 53, pixels: noise(211 * 53, 7) },
    { name: '256 个数各一个', w: 16, h: 16, pixels: Uint8Array.from({ length: 256 }, (_v, i) => i) },
  ];
})();

// ---------------------------------------------------------------- 手拼一张 PNG（不用被测的写法）

function crc(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of bytes) {
    c ^= byte;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return (c ^ 0xffffffff) >>> 0;
}

function block(type: string, data: Uint8Array): number[] {
  const body = [...type].map((ch) => ch.charCodeAt(0)).concat([...data]);
  const n = data.length;
  const sum = crc(Uint8Array.from(body));
  return [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255, ...body, sum >>> 24, (sum >>> 16) & 255, (sum >>> 8) & 255, sum & 255];
}

/** rows 是已经滤过的每一行（第一个字节是滤法）。split 是 true 时把压缩后的数据分成两块写。 */
function handPng(width: number, height: number, colourType: number, rows: number[][], opts: { bits?: number; interlace?: number; split?: boolean } = {}): Uint8Array {
  const head = [0, 0, 0, width, 0, 0, 0, height, opts.bits ?? 8, colourType, 0, 0, opts.interlace ?? 0];
  const packed = deflateSync(Uint8Array.from(rows.flat()));
  const half = Math.floor(packed.length / 2);
  const data = opts.split ? [...block('IDAT', packed.subarray(0, half)), ...block('IDAT', packed.subarray(half))] : block('IDAT', packed);
  return Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...block('IHDR', Uint8Array.from(head)), ...block('tEXt', Uint8Array.from([65, 0, 66])), ...data, ...block('IEND', new Uint8Array(0))]);
}

describe('写 PNG（encodeGreyPng）', () => {
  it.each(PICTURES)('写出来再读回来，一个字节不差：$name（$w × $h）', ({ w, h, pixels }) => {
    const back = decodePng(encodeGreyPng(pixels, w, h));
    expect([back.width, back.height, back.channels]).toEqual([w, h, 1]);
    expect(back.pixels.length).toBe(pixels.length);
    expect(firstDifference(back.pixels, pixels)).toBe(-1);
  });

  it('同样的像素写两遍，字节一样；像素不同，字节不同', () => {
    for (const { w, h, pixels } of PICTURES) {
      const a = encodeGreyPng(pixels, w, h);
      const b = encodeGreyPng(Uint8Array.from(pixels), w, h);
      expect(firstDifference(a, b)).toBe(-1);
    }
    const one = noise(64 * 64, 3);
    const other = Uint8Array.from(one);
    other[2000] ^= 1;
    expect(firstDifference(encodeGreyPng(one, 64, 64), encodeGreyPng(other, 64, 64))).not.toBe(-1);
  });

  it('不改交进来的像素', () => {
    const pixels = noise(40 * 30, 11);
    const before = Uint8Array.from(pixels);
    encodeGreyPng(pixels, 40, 30);
    expect(firstDifference(pixels, before)).toBe(-1);
  });

  it('文件照 PNG 的规矩：开头八个字节，文件头写的是 8 位灰度、不隔行，最后是结尾的那一块', () => {
    const file = encodeGreyPng(noise(300 * 200, 5), 300, 200);
    expect([...file.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    // 文件头：长度 13，名字 IHDR，宽 300，高 200，8 位，灰度，后三个都是 0
    expect([...file.subarray(8, 16)]).toEqual([0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
    expect([...file.subarray(16, 29)]).toEqual([0, 0, 1, 44, 0, 0, 0, 200, 8, 0, 0, 0, 0]);
    // 文件头的校验码，用另一种写法算一遍
    const sum = crc(file.subarray(12, 29));
    expect([...file.subarray(29, 33)]).toEqual([sum >>> 24, (sum >>> 16) & 255, (sum >>> 8) & 255, sum & 255]);
    // 结尾：长度 0，名字 IEND，校验码是固定的
    expect([...file.subarray(file.length - 12)]).toEqual([0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]);
  });

  it('好压的图压得小：全黑的 1171 × 971 不到 3 KB，大块黑白的比不压小得多', () => {
    expect(encodeGreyPng(new Uint8Array(1171 * 971), 1171, 971).length).toBeLessThan(3000);
    const blocks = PICTURES.find((p) => p.name.startsWith('大块'));
    if (!blocks) throw new Error('没有那张大块的图');
    expect(encodeGreyPng(blocks.pixels, blocks.w, blocks.h).length).toBeLessThan(blocks.pixels.length / 20);
  });

  it('宽高和像素的个数对不上时抛出错误', () => {
    expect(() => encodeGreyPng(new Uint8Array(11), 4, 3)).toThrow('像素的个数不对');
    expect(() => encodeGreyPng(new Uint8Array(0), 0, 3)).toThrow('图片的宽高不对');
    expect(() => encodeGreyPng(new Uint8Array(6), 2.5, 3)).toThrow('图片的宽高不对');
  });
});

describe('读 PNG（decodePng）', () => {
  it('读得了别人写的灰度图：五种滤法各一行', () => {
    // 像素（3 × 5）：每一行都是 10 20 40，只是滤法不同
    const rows = [
      [0, 10, 20, 40], // 不滤
      [1, 10, 10, 20], // 减左边
      [2, 0, 0, 0], // 减上边
      [3, 5, 5, 10], // 减左边和上边的平均：10−(0+10)/2，20−(10+20)/2，40−(20+40)/2
      [4, 0, 0, 0], // 第 4 种：左、上、左上里挑一个，这里挑到的都是上边
    ];
    const got = decodePng(handPng(3, 5, 0, rows));
    expect([got.width, got.height, got.channels]).toEqual([3, 5, 1]);
    expect([...got.pixels]).toEqual([10, 20, 40, 10, 20, 40, 10, 20, 40, 10, 20, 40, 10, 20, 40]);
  });

  it('读得了彩色、带透明的（浏览器截的图是这两种），“左边”隔的是一个点不是一个字节', () => {
    // 彩色 2 × 2：第一行不滤，第二行减左边（左边是前一个点的同一种颜色）
    const rgb = decodePng(
      handPng(2, 2, 2, [
        [0, 255, 0, 0, 0, 255, 0],
        [1, 10, 20, 30, 1, 2, 3],
      ]),
    );
    expect([rgb.width, rgb.height, rgb.channels]).toEqual([2, 2, 3]);
    expect([...rgb.pixels]).toEqual([255, 0, 0, 0, 255, 0, 10, 20, 30, 11, 22, 33]);

    // 彩色带透明 2 × 2：第二行是第 4 种滤法
    const rgba = decodePng(
      handPng(2, 2, 6, [
        [0, 1, 2, 3, 255, 5, 6, 7, 128],
        [4, 1, 1, 1, 0, 1, 1, 1, 0],
      ]),
    );
    expect(rgba.channels).toBe(4);
    // 第二行第一个点：照上边猜；第二个点：左 (2,3,4,255)、上 (5,6,7,128)、左上 (1,2,3,255)，各路挑离“左 + 上 − 左上”最近的
    expect([...rgba.pixels]).toEqual([1, 2, 3, 255, 5, 6, 7, 128, 2, 3, 4, 255, 6, 7, 8, 128]);

    // 灰度带透明 1 × 2
    const ga = decodePng(handPng(1, 2, 4, [[0, 9, 200], [2, 1, 55]]));
    expect(ga.channels).toBe(2);
    expect([...ga.pixels]).toEqual([9, 200, 10, 255]);
  });

  it('压缩后的数据分成几块写的也读得了；不认识的块跳过去', () => {
    const rows = Array.from({ length: 40 }, (_r, y) => [0, ...Array.from({ length: 50 }, (_c, x) => (x * y) & 255)]);
    const got = decodePng(handPng(50, 40, 0, rows, { split: true }));
    expect([got.width, got.height]).toEqual([50, 40]);
    expect(got.pixels[39 * 50 + 49]).toBe((49 * 39) & 255);
  });

  it('坏了的文件说得出哪里不对', () => {
    const good = encodeGreyPng(noise(20 * 10, 9), 20, 10);
    expect(() => decodePng(new Uint8Array(4))).toThrow('不是 PNG 文件');
    expect(() => decodePng(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0, 1]))).toThrow('不是 PNG 文件');
    // 改了像素那一块里的一个字节：校验码对不上
    const flipped = Uint8Array.from(good);
    flipped[50] ^= 0x10;
    expect(() => decodePng(flipped)).toThrow('校验码不对');
    // 少了后半截
    expect(() => decodePng(good.subarray(0, good.length - 20))).toThrow('不完整');
    expect(() => decodePng(good.subarray(0, good.length - 12))).toThrow('不完整');
  });

  it('读不了的几种（16 位、调色板、隔行）明说读不了，不乱读', () => {
    expect(() => decodePng(handPng(1, 1, 0, [[0, 0, 0]], { bits: 16 }))).toThrow('这种 PNG 读不了');
    expect(() => decodePng(handPng(1, 1, 3, [[0, 0]]))).toThrow('这种 PNG 读不了');
    expect(() => decodePng(handPng(1, 1, 0, [[0, 0]], { interlace: 1 }))).toThrow('这种 PNG 读不了');
    // 文件头说 3 × 2，像素只有一行
    expect(() => decodePng(handPng(3, 2, 0, [[0, 1, 2, 3]]))).toThrow('像素应该有');
    // 没有的滤法
    expect(() => decodePng(handPng(1, 1, 0, [[7, 0]]))).toThrow('没有这一种');
  });
});
