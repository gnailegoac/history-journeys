// 写、读 PNG 图片，只用 Node 自带的 zlib，不装别的库。
// 写：只写 8 位灰度的（先画好的地面里“田的标记”那张图，npm run bake 用）。同样的像素每次写出同样的字节。
// 读：8 位、不隔行的灰度、灰度带透明、彩色、彩色带透明四种都读得了（测试里把写出来的图读回来对一对；浏览器截的图也是这几种）。
// 只给 tests/ 里的程序用（在 Node 里跑）；src/ 里的程序不要用。

import { deflateSync, inflateSync } from 'node:zlib';

/** PNG 文件开头固定的八个字节。 */
const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** 颜色类型（文件头里的一个数）各是每个点几个字节：0 灰度，2 彩色，4 灰度带透明，6 彩色带透明。 */
const CHANNELS: Record<number, 1 | 2 | 3 | 4> = { 0: 1, 2: 3, 4: 2, 6: 4 };

export interface PngPicture {
  width: number;
  height: number;
  /** 每个点几个字节：1 灰度，2 灰度带透明，3 彩色，4 彩色带透明。 */
  channels: 1 | 2 | 3 | 4;
  /** 像素，逐行存，第 0 行在最上面：width × height × channels 个字节。 */
  pixels: Uint8Array;
}

// ---------------------------------------------------------------- 校验码

/** PNG 每一块末尾的校验码（CRC-32）用的表。 */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array, from: number, to: number): number {
  let c = 0xffffffff;
  for (let i = from; i < to; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// ---------------------------------------------------------------- 一行一行地“滤”

/** PNG 的第 4 种滤法用的猜法：左、上、左上三个里，离“左 + 上 − 左上”最近的那个。 */
function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/** 照第 type 种滤法（0 到 4），这一行第 x 个字节是照哪个数猜的。bpp 是每个点几个字节；prev 是上一行，第一行没有上一行。 */
function guess(type: number, row: Uint8Array, prev: Uint8Array | null, x: number, bpp: number): number {
  const a = x >= bpp ? row[x - bpp] : 0;
  const b = prev ? prev[x] : 0;
  const c = prev && x >= bpp ? prev[x - bpp] : 0;
  if (type === 1) return a;
  if (type === 2) return b;
  if (type === 3) return (a + b) >> 1;
  if (type === 4) return paeth(a, b, c);
  return 0;
}

// ---------------------------------------------------------------- 写

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out, 4, 8 + data.length));
  return out;
}

/**
 * 把一张灰度图写成 PNG 文件的字节。pixels 是 width × height 个字节，逐行存，第 0 行在最上面，0 最黑，255 最白。
 * 每一行在五种滤法里挑“滤完以后各个字节离 0 最近”的那一种（一样近时挑号小的），再整个压缩（力度 9）。
 * 读回来和写进去的一个字节不差；同样的像素每次写出同样的字节。大小不对时抛出错误。
 */
export function encodeGreyPng(pixels: Uint8Array, width: number, height: number): Uint8Array {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new Error(`图片的宽高不对：${width} × ${height}`);
  }
  if (pixels.length !== width * height) {
    throw new Error(`像素的个数不对：${width} × ${height} 应该是 ${width * height} 个字节，实际是 ${pixels.length} 个`);
  }

  const stride = width + 1;
  const raw = new Uint8Array(stride * height);
  const tries = [0, 1, 2, 3, 4].map(() => new Uint8Array(width));
  for (let y = 0; y < height; y++) {
    const row = pixels.subarray(y * width, (y + 1) * width);
    const prev = y > 0 ? pixels.subarray((y - 1) * width, y * width) : null;
    let best = 0;
    let bestSum = Infinity;
    for (let type = 0; type < 5; type++) {
      const out = tries[type];
      let sum = 0;
      for (let x = 0; x < width; x++) {
        const v = (row[x] - guess(type, row, prev, x, 1)) & 0xff;
        out[x] = v;
        sum += v < 128 ? v : 256 - v;
      }
      if (sum < bestSum) {
        bestSum = sum;
        best = type;
      }
    }
    raw[y * stride] = best;
    raw.set(tries[best], y * stride + 1);
  }

  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  header[8] = 8; // 每个点 8 位
  header[9] = 0; // 灰度
  // 后三个字节（压缩的办法、滤的办法、隔不隔行）都是 0

  const parts = [Uint8Array.from(SIGNATURE), chunk('IHDR', header), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', new Uint8Array(0))];
  const file = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const part of parts) {
    file.set(part, at);
    at += part.length;
  }
  return file;
}

// ---------------------------------------------------------------- 读

/**
 * 把 PNG 文件的字节读成像素。只读 8 位、不隔行的灰度、灰度带透明、彩色、彩色带透明；
 * 别的（调色板、16 位、隔行）和坏了的文件（开头不对、校验码不对、像素不够）都抛出错误。
 */
export function decodePng(file: Uint8Array): PngPicture {
  if (file.length < 8 || SIGNATURE.some((byte, i) => file[i] !== byte)) throw new Error('不是 PNG 文件：开头的八个字节不对');
  const view = new DataView(file.buffer, file.byteOffset, file.byteLength);

  let header: Uint8Array | null = null;
  const data: Uint8Array[] = [];
  let ended = false;
  let at = 8;
  while (at < file.length && !ended) {
    if (at + 12 > file.length) throw new Error('PNG 文件不完整：最后一块没有写完');
    const length = view.getUint32(at);
    const end = at + 8 + length;
    if (end + 4 > file.length) throw new Error('PNG 文件不完整：最后一块没有写完');
    const type = String.fromCharCode(file[at + 4], file[at + 5], file[at + 6], file[at + 7]);
    if (crc32(file, at + 4, end) !== view.getUint32(end)) throw new Error(`PNG 文件坏了：${type} 这一块的校验码不对`);
    const body = file.subarray(at + 8, end);
    if (type === 'IHDR') header = body;
    else if (type === 'IDAT') data.push(body);
    else if (type === 'IEND') ended = true;
    at = end + 4;
  }
  if (!header || header.length !== 13) throw new Error('PNG 文件坏了：没有文件头');
  if (!ended) throw new Error('PNG 文件不完整：没有结尾的那一块');

  const head = new DataView(header.buffer, header.byteOffset, header.byteLength);
  const width = head.getUint32(0);
  const height = head.getUint32(4);
  const channels = CHANNELS[header[9]];
  if (header[8] !== 8 || !channels || header[12] !== 0) {
    throw new Error(`这种 PNG 读不了（每个点 ${header[8]} 位，颜色类型 ${header[9]}，${header[12] === 0 ? '不隔行' : '隔行'}）：只读 8 位、不隔行的灰度和彩色`);
  }

  const packed = new Uint8Array(data.reduce((n, d) => n + d.length, 0));
  let fill = 0;
  for (const d of data) {
    packed.set(d, fill);
    fill += d.length;
  }
  const raw = inflateSync(packed);
  const rowBytes = width * channels;
  if (raw.length !== (rowBytes + 1) * height) throw new Error(`PNG 文件坏了：像素应该有 ${(rowBytes + 1) * height} 个字节，实际是 ${raw.length} 个`);

  const pixels = new Uint8Array(rowBytes * height);
  for (let y = 0; y < height; y++) {
    const type = raw[y * (rowBytes + 1)];
    if (type > 4) throw new Error(`PNG 文件坏了：第 ${y} 行的滤法是 ${type}，没有这一种`);
    const row = pixels.subarray(y * rowBytes, (y + 1) * rowBytes);
    const prev = y > 0 ? pixels.subarray((y - 1) * rowBytes, y * rowBytes) : null;
    const from = y * (rowBytes + 1) + 1;
    // 一个字节一个字节从左往右还原：猜的时候用的是左边已经还原好的
    for (let x = 0; x < rowBytes; x++) row[x] = (raw[from + x] + guess(type, row, prev, x, channels)) & 0xff;
  }
  return { width, height, channels, pixels };
}
