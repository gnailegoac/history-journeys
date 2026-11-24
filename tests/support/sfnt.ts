// 读字体文件，和往字体里写一张新的名称表。只给做字体的工具和查字体的测试用（在 Node 里跑）。
// 全是自己写的，按字节读；不执行字体里的任何东西，也不靠别的库（解 WOFF2 用的是 Node 自带的 brotli）。
//
//   readSfnt(bytes)        一个 .ttf / .otf 文件 → 它的各张表
//   readWoff2(bytes)       一个 .woff2 文件 → 它的各张表（glyf、loca 这样变换过的表给的是变换以后的样子，不要去读）
//   cmapOf(tables)         文件里有哪些字：编码 → 字形的号
//   namesOf(tables)        名称表里的每一条；englishName(tables, id) 是其中 Windows、英文的那一条
//   featuresOf(tables, t)  GSUB、GPOS 里留着哪些排版功能
//   hintingOf(tables)      文件里留没留着提示信息（让小字在普通屏幕上清楚一些的那些数）
//   glyphCountOf(tables)   有多少个字形
//   weightOf(tables)       字体自己写的粗细
//   renameSfnt(bytes, 条目) 给一个 .ttf / .otf 换一张名称表，别的表一个字节不动，校验和重新算好
//   checkSfnt(bytes)       各张表的校验和对不对；对的话返回空的清单
//
// WOFF2 的样子（W3C 的 WOFF2 规格）：48 个字节的头，一张表的目录，然后是一整段 Brotli 压缩的数据；
// 解开以后各张表照目录的先后挨着放，每张表的长度是目录里写的“变换以后的长度”（有的话），没有就是“原来的长度”。
// cmap 和 name 从来不变换，所以直接读得了。

import { brotliDecompressSync } from 'node:zlib';

/** 一个字体文件里的各张表：四个字符的名字 → 这张表的字节。 */
export type FontTables = Map<string, Uint8Array>;

const view = (bytes: Uint8Array): DataView => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
const tagAt = (bytes: Uint8Array, at: number): string => String.fromCharCode(bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]);
/**
 * 抄一份字节。不用 slice()：从磁盘读来的是 Node 的 Buffer，它的 slice() 给的不是一份新的，改它就改了原来的那一份。
 * 这个文件里的函数都不改交进来的字节。
 */
const copyOf = (bytes: Uint8Array): Uint8Array => new Uint8Array(bytes);

// ---------------------------------------------------------------- 两种文件

/** 读一个 .ttf / .otf。flavor 是开头的四个字节（TrueType 是 0x00010000，带 CFF 的是 “OTTO”）。 */
export function readSfnt(bytes: Uint8Array): { flavor: string; tables: FontTables } {
  const v = view(bytes);
  const count = v.getUint16(4);
  const tables: FontTables = new Map();
  for (let i = 0; i < count; i++) {
    const at = 12 + i * 16;
    const offset = v.getUint32(at + 8);
    tables.set(tagAt(bytes, at), bytes.subarray(offset, offset + v.getUint32(at + 12)));
  }
  return { flavor: tagAt(bytes, 0), tables };
}

/** WOFF2 目录里用一个数代表的常见表名（规格里的那张表，先后不能动）。 */
const WOFF2_TAGS = [
  'cmap', 'head', 'hhea', 'hmtx', 'maxp', 'name', 'OS/2', 'post', 'cvt ', 'fpgm', 'glyf', 'loca', 'prep', 'CFF ', 'VORG', 'EBDT',
  'EBLC', 'gasp', 'hdmx', 'kern', 'LTSH', 'PCLT', 'VDMX', 'vhea', 'vmtx', 'BASE', 'GDEF', 'GPOS', 'GSUB', 'EBSC', 'JSTF', 'MATH',
  'CBDT', 'CBLC', 'COLR', 'CPAL', 'SVG ', 'sbix', 'acnt', 'avar', 'bdat', 'bloc', 'bsln', 'cvar', 'fdsc', 'feat', 'fmtx', 'fvar',
  'gvar', 'hsty', 'just', 'lcar', 'mort', 'morx', 'opbd', 'prop', 'trak', 'Zapf', 'Silf', 'Glat', 'Gloc', 'Feat', 'Sill',
];

export interface Woff2Info {
  flavor: string;
  /** 文件头里写的整个文件的长度。 */
  length: number;
  /** 还原成 .ttf / .otf 以后多少字节（文件头里写的）。 */
  totalSfntSize: number;
  /** 目录里的每张表：名字，原来多长，变换过的另有变换以后的长度。 */
  entries: { tag: string; origLength: number; transformLength?: number }[];
  /** 解开的那一段一共多长，和目录里各张表的长度加起来多长（两个数要相等）。 */
  streamLength: number;
  sumOfLengths: number;
}

/** 读一个 .woff2。不是 WOFF2、或者解开以后和目录对不上时抛出错误。 */
export function readWoff2(bytes: Uint8Array): { flavor: string; tables: FontTables; info: Woff2Info } {
  if (tagAt(bytes, 0) !== 'wOF2') throw new Error('这不是一个 WOFF2 文件（开头不是 wOF2）');
  const v = view(bytes);
  const numTables = v.getUint16(12);
  const compressed = v.getUint32(20);
  let p = 48;
  // 目录里的数是“每个字节七位、最高位表示后面还有”的写法
  const base128 = (): number => {
    let value = 0;
    for (let i = 0; i < 5; i++) {
      const b = bytes[p++];
      value = value * 128 + (b & 0x7f);
      if (!(b & 0x80)) return value;
    }
    throw new Error('WOFF2 的目录里有一个读不出来的数');
  };
  const entries: Woff2Info['entries'] = [];
  for (let i = 0; i < numTables; i++) {
    const flags = bytes[p++];
    let tag: string;
    if ((flags & 0x3f) === 63) {
      tag = tagAt(bytes, p);
      p += 4;
    } else {
      tag = WOFF2_TAGS[flags & 0x3f];
    }
    const version = flags >> 6;
    const origLength = base128();
    // glyf 和 loca：版本 0 是变换过的；别的表：版本不是 0 才是
    const transformed = tag === 'glyf' || tag === 'loca' ? version === 0 : version !== 0;
    entries.push(transformed ? { tag, origLength, transformLength: base128() } : { tag, origLength });
  }
  const stream = brotliDecompressSync(bytes.subarray(p, p + compressed));
  const tables: FontTables = new Map();
  let at = 0;
  for (const entry of entries) {
    const length = entry.transformLength ?? entry.origLength;
    tables.set(entry.tag, stream.subarray(at, at + length));
    at += length;
  }
  const info: Woff2Info = { flavor: tagAt(bytes, 4), length: v.getUint32(8), totalSfntSize: v.getUint32(16), entries, streamLength: stream.length, sumOfLengths: at };
  if (info.sumOfLengths !== info.streamLength) throw new Error(`WOFF2 解开以后有 ${info.streamLength} 个字节，目录里各张表加起来却是 ${info.sumOfLengths}`);
  return { flavor: info.flavor, tables, info };
}

// ---------------------------------------------------------------- 有哪些字

/** 文件里有哪些字：编码 → 字形的号。读的是 Unicode 的那张对照表，格式 12 优先，其次格式 4。 */
export function cmapOf(tables: FontTables): Map<number, number> {
  const t = tables.get('cmap');
  if (!t) throw new Error('字体里没有 cmap 这张表');
  const v = view(t);
  const subtables = Array.from({ length: v.getUint16(2) }, (_, i) => {
    const offset = v.getUint32(8 + i * 8);
    return { platform: v.getUint16(4 + i * 8), offset, format: v.getUint16(offset) };
  }).filter((s) => s.platform === 3 || s.platform === 0);
  const best = subtables.find((s) => s.format === 12) ?? subtables.find((s) => s.format === 4);
  if (!best) throw new Error('字体的 cmap 里没有格式 4 或格式 12 的对照表');
  const map = new Map<number, number>();
  const o = best.offset;
  if (best.format === 12) {
    const groups = v.getUint32(o + 12);
    for (let g = 0; g < groups; g++) {
      const start = v.getUint32(o + 16 + g * 12);
      const end = v.getUint32(o + 20 + g * 12);
      const glyph = v.getUint32(o + 24 + g * 12);
      for (let c = start; c <= end; c++) if (glyph + c - start !== 0) map.set(c, glyph + c - start);
    }
    return map;
  }
  const segX2 = v.getUint16(o + 6);
  const endAt = o + 14;
  const startAt = endAt + segX2 + 2;
  const deltaAt = startAt + segX2;
  const rangeAt = deltaAt + segX2;
  for (let s = 0; s < segX2; s += 2) {
    const end = v.getUint16(endAt + s);
    const start = v.getUint16(startAt + s);
    const delta = v.getInt16(deltaAt + s);
    const range = v.getUint16(rangeAt + s);
    for (let c = start; c <= end && c !== 0xffff; c++) {
      let glyph = range === 0 ? (c + delta) & 0xffff : v.getUint16(rangeAt + s + range + (c - start) * 2);
      if (range !== 0 && glyph !== 0) glyph = (glyph + delta) & 0xffff;
      if (glyph) map.set(c, glyph);
    }
  }
  return map;
}

/** 文件里的每一个字，按编码的先后连成一串。 */
export function charactersOf(tables: FontTables): string {
  return [...cmapOf(tables).keys()].sort((a, b) => a - b).map((code) => String.fromCodePoint(code)).join('');
}

/** 有多少个字形（maxp 表里的数）。 */
export function glyphCountOf(tables: FontTables): number {
  const t = tables.get('maxp');
  if (!t) throw new Error('字体里没有 maxp 这张表');
  return view(t).getUint16(4);
}

/** 字体自己写的粗细（OS/2 表里的 usWeightClass：400 是平常的，500 是 Medium）。 */
export function weightOf(tables: FontTables): number {
  const t = tables.get('OS/2');
  if (!t || t.length < 6) throw new Error('字体里没有 OS/2 这张表（粗细写在它里面）');
  return view(t).getUint16(4);
}

// ---------------------------------------------------------------- 名称表

export interface NameRecord {
  platform: number;
  encoding: number;
  lang: number;
  nameId: number;
  text: string;
}

const utf16be = (bytes: Uint8Array): string => {
  let text = '';
  for (let i = 0; i + 1 < bytes.length; i += 2) text += String.fromCharCode((bytes[i] << 8) | bytes[i + 1]);
  return text;
};

/** 名称表里的每一条。Windows 和 Unicode 平台的按 UTF-16 读，Mac 平台的一个字节一个字符。 */
export function namesOf(tables: FontTables): NameRecord[] {
  const t = tables.get('name');
  if (!t) throw new Error('字体里没有 name 这张表');
  const v = view(t);
  const count = v.getUint16(2);
  const strings = v.getUint16(4);
  const out: NameRecord[] = [];
  for (let i = 0; i < count; i++) {
    const at = 6 + i * 12;
    const platform = v.getUint16(at);
    const bytes = t.subarray(strings + v.getUint16(at + 10), strings + v.getUint16(at + 10) + v.getUint16(at + 8));
    const text = platform === 1 ? Array.from(bytes, (b) => String.fromCharCode(b)).join('') : utf16be(bytes);
    out.push({ platform, encoding: v.getUint16(at + 2), lang: v.getUint16(at + 4), nameId: v.getUint16(at + 6), text });
  }
  return out;
}

/** Windows 平台、英文（0x409）的那一条；没有是 undefined。 */
export function englishName(tables: FontTables, nameId: number): string | undefined {
  return namesOf(tables).find((n) => n.platform === 3 && n.lang === 0x409 && n.nameId === nameId)?.text;
}

/** 做一张名称表：每一条都是 Windows 平台、Unicode、英文，按编号的先后排。 */
function nameTable(records: { nameId: number; text: string }[]): Uint8Array {
  const sorted = [...records].sort((a, b) => a.nameId - b.nameId);
  const blobs = sorted.map(({ text }) => {
    const bytes = new Uint8Array(text.length * 2);
    for (let i = 0; i < text.length; i++) {
      bytes[i * 2] = text.charCodeAt(i) >> 8;
      bytes[i * 2 + 1] = text.charCodeAt(i) & 0xff;
    }
    return bytes;
  });
  const head = 6 + 12 * sorted.length;
  const out = new Uint8Array(head + blobs.reduce((sum, b) => sum + b.length, 0));
  const v = view(out);
  v.setUint16(0, 0);
  v.setUint16(2, sorted.length);
  v.setUint16(4, head);
  let offset = 0;
  sorted.forEach((record, i) => {
    const at = 6 + i * 12;
    v.setUint16(at, 3);
    v.setUint16(at + 2, 1);
    v.setUint16(at + 4, 0x409);
    v.setUint16(at + 6, record.nameId);
    v.setUint16(at + 8, blobs[i].length);
    v.setUint16(at + 10, offset);
    out.set(blobs[i], head + offset);
    offset += blobs[i].length;
  });
  return out;
}

// ---------------------------------------------------------------- 排版功能

/** GSUB 或 GPOS 里留着哪些排版功能（四个字符的名字，不重复，按字母排）。没有这张表是空的。 */
export function featuresOf(tables: FontTables, table: 'GSUB' | 'GPOS'): string[] {
  const t = tables.get(table);
  if (!t || t.length < 10) return [];
  const v = view(t);
  const list = v.getUint16(6);
  if (list === 0) return [];
  const count = v.getUint16(list);
  const tags = new Set<string>();
  for (let i = 0; i < count; i++) tags.add(tagAt(t, list + 2 + i * 6));
  return [...tags].sort();
}

// ---------------------------------------------------------------- 提示信息

/** CFF 里的一张索引：几项，各在哪。at 是它在 CFF 表里的位置；end 是它后面一个字节的位置。 */
function cffIndex(cff: Uint8Array, at: number): { items: Uint8Array[]; end: number } {
  const count = (cff[at] << 8) | cff[at + 1];
  if (count === 0) return { items: [], end: at + 2 };
  const offSize = cff[at + 2];
  const offsetAt = (i: number): number => {
    let value = 0;
    for (let k = 0; k < offSize; k++) value = value * 256 + cff[at + 3 + i * offSize + k];
    return value;
  };
  // 各项的位置是从“数据前面那一个字节”算起的
  const base = at + 3 + (count + 1) * offSize - 1;
  const items = Array.from({ length: count }, (_, i) => cff.subarray(base + offsetAt(i), base + offsetAt(i + 1)));
  return { items, end: base + offsetAt(count) };
}

/** CFF 里的一本“字典”：每个记号（一个字节的写成 "6"，两个字节的写成 "12 12"）→ 它前面的那几个数。带小数的数读成 NaN。 */
function cffDict(dict: Uint8Array): Map<string, number[]> {
  const v = view(dict);
  const out = new Map<string, number[]>();
  let operands: number[] = [];
  let i = 0;
  while (i < dict.length) {
    const b = dict[i];
    if (b <= 21) {
      const key = b === 12 ? `12 ${dict[i + 1]}` : String(b);
      i += b === 12 ? 2 : 1;
      out.set(key, operands);
      operands = [];
    } else if (b === 28) {
      operands.push(v.getInt16(i + 1));
      i += 3;
    } else if (b === 29) {
      operands.push(v.getInt32(i + 1));
      i += 5;
    } else if (b === 30) {
      // 带小数的数：半个字节半个字节地写，写到 f 为止
      i++;
      while (i < dict.length) {
        const pair = dict[i++];
        if (pair >> 4 === 0xf || (pair & 0xf) === 0xf) break;
      }
      operands.push(NaN);
    } else if (b >= 32 && b <= 246) {
      operands.push(b - 139);
      i++;
    } else if (b >= 247 && b <= 250) {
      operands.push((b - 247) * 256 + dict[i + 1] + 108);
      i += 2;
    } else if (b >= 251 && b <= 254) {
      operands.push(-(b - 251) * 256 - dict[i + 1] - 108);
      i += 2;
    } else {
      throw new Error(`CFF 的字典里有一个读不懂的字节（${b}）`);
    }
  }
  return out;
}

/** CFF 字体里记着提示信息的那几个记号：BlueValues、StdHW、StdVW、StemSnapH、StemSnapV。裁剪时说了不留提示信息，这几个就没有了。 */
const CFF_HINT_KEYS = ['6', '10', '11', '12 12', '12 13'];

/**
 * 文件里留没留着提示信息（hinting）。读的是文件自己：
 *   带 CFF 的（宋体）  每一组字各有一本“私有字典”，里面有 BlueValues、StdHW 这些数就是留着；一本里也没有就是没留；
 *   TrueType 的（楷体） 有 fpgm 或者 cvt 这两张表就是留着（霞鹜文楷本来就没有：只有七个字节的 prep）。
 */
export function hintingOf(tables: FontTables): 'kept' | 'none' {
  const cff = tables.get('CFF ');
  if (!cff) return tables.has('fpgm') || tables.has('cvt ') ? 'kept' : 'none';
  // 表头（第三个字节是表头有多长），名字的索引，最上面那本字典的索引
  const names = cffIndex(cff, cff[2]);
  const top = cffIndex(cff, names.end);
  if (top.items.length === 0) throw new Error('CFF 表里没有最上面的那本字典');
  const topDict = cffDict(top.items[0]);
  // 私有字典在哪：字典里的第 18 号记着“多长、在哪”。字多的字体（宋体就是）分成几组，每组各有一本，从第 12 36 号找过去
  const privates: Map<string, number[]>[] = [];
  const addPrivate = (dict: Map<string, number[]>): void => {
    const [size, offset] = dict.get('18') ?? [];
    if (size !== undefined && offset !== undefined) privates.push(cffDict(cff.subarray(offset, offset + size)));
  };
  addPrivate(topDict);
  const groups = topDict.get('12 36')?.[0];
  if (groups !== undefined) for (const item of cffIndex(cff, groups).items) addPrivate(cffDict(item));
  if (privates.length === 0) throw new Error('CFF 表里一本私有字典也没有找到');
  return privates.some((dict) => CFF_HINT_KEYS.some((key) => dict.has(key))) ? 'kept' : 'none';
}

// ---------------------------------------------------------------- 换名称表

/** 一张表的校验和：每四个字节当一个数，加起来（不够四个字节的补零）。 */
function checksum(bytes: Uint8Array): number {
  const v = view(bytes);
  const whole = bytes.length & ~3;
  let sum = 0;
  for (let i = 0; i < whole; i += 4) sum = (sum + v.getUint32(i)) >>> 0;
  if (bytes.length & 3) {
    const tail = new Uint8Array(4);
    tail.set(bytes.subarray(whole));
    sum = (sum + view(tail).getUint32(0)) >>> 0;
  }
  return sum;
}

/**
 * 给一个 .ttf / .otf 换一张名称表，返回新的文件。新的名称表里正好是 records 这几条；别的表的内容一个字节不动，
 * 在文件里的先后也不变。目录、各张表的校验和、head 表里整个文件的校验数都重新算好。
 */
export function renameSfnt(bytes: Uint8Array, records: { nameId: number; text: string }[]): Uint8Array {
  const v = view(bytes);
  const count = v.getUint16(4);
  const entries = Array.from({ length: count }, (_, i) => {
    const at = 12 + i * 16;
    const tag = tagAt(bytes, at);
    const offset = v.getUint32(at + 8);
    const data = tag === 'name' ? nameTable(records) : copyOf(bytes.subarray(offset, offset + v.getUint32(at + 12)));
    return { tag, offset, data, newOffset: 0 };
  });
  if (!entries.some((entry) => entry.tag === 'name')) throw new Error('字体里没有 name 这张表，没法改名称');
  const head = entries.find((entry) => entry.tag === 'head');
  if (!head) throw new Error('字体里没有 head 这张表');
  view(head.data).setUint32(8, 0); // 整个文件的校验数，最后再填
  // 各张表照原来在文件里的先后放，每张表从四的倍数开始
  let at = 12 + count * 16;
  for (const entry of [...entries].sort((a, b) => a.offset - b.offset)) {
    entry.newOffset = at;
    at += (entry.data.length + 3) & ~3;
  }
  const out = new Uint8Array(at);
  out.set(bytes.subarray(0, 12)); // 开头的 12 个字节（哪一种字体、有几张表）不变
  const o = view(out);
  // 目录按表名的先后排
  [...entries]
    .sort((a, b) => (a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0))
    .forEach((entry, i) => {
      const d = 12 + i * 16;
      for (let k = 0; k < 4; k++) out[d + k] = entry.tag.charCodeAt(k);
      o.setUint32(d + 4, checksum(entry.data));
      o.setUint32(d + 8, entry.newOffset);
      o.setUint32(d + 12, entry.data.length);
      out.set(entry.data, entry.newOffset);
    });
  o.setUint32(head.newOffset + 8, (0xb1b0afba - checksum(out)) >>> 0);
  return out;
}

/** 查一个 .ttf / .otf：各张表的校验和、head 表里整个文件的校验数、每张表是不是从四的倍数开始。返回不对的地方；都对是空的。 */
export function checkSfnt(bytes: Uint8Array): string[] {
  const wrong: string[] = [];
  const v = view(bytes);
  const count = v.getUint16(4);
  let headAt = -1;
  for (let i = 0; i < count; i++) {
    const at = 12 + i * 16;
    const tag = tagAt(bytes, at);
    const offset = v.getUint32(at + 8);
    let data = bytes.subarray(offset, offset + v.getUint32(at + 12));
    if (tag === 'head') {
      headAt = offset;
      data = copyOf(data);
      view(data).setUint32(8, 0);
    }
    if (checksum(data) !== v.getUint32(at + 4)) wrong.push(`${tag} 的校验和不对`);
    if (offset & 3) wrong.push(`${tag} 不是从四的倍数开始的`);
  }
  if (headAt < 0) return [...wrong, '没有 head 这张表'];
  const copy = copyOf(bytes);
  const adjustment = view(copy).getUint32(headAt + 8);
  view(copy).setUint32(headAt + 8, 0);
  if (((0xb1b0afba - checksum(copy)) >>> 0) !== adjustment) wrong.push('head 里整个文件的校验数不对');
  return wrong;
}
