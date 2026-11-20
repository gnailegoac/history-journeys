// 把 import.meta.glob 从磁盘读到的文件，整理成校验规则要的样子。

import { contentKey } from '../../src/domain/contentKey';
import type { FileKeys, MeasuredPictures, PictureKind } from './sceneRules';
import type { ContentFiles, FileSizes } from './shape';

/**
 * paths：目录下所有文件的路径（含图片）；texts：其中 .json、.md 和 .geojson 文件的文字。
 * prefix 是内容目录的路径，结果里的路径去掉这一截。
 */
export function toContentFiles(prefix: string, paths: string[], texts: Record<string, string>): ContentFiles {
  const files: ContentFiles = {};
  for (const path of paths) {
    if (path.startsWith(prefix)) files[path.slice(prefix.length)] = texts[path] ?? '';
  }
  return files;
}

/**
 * 从图片文件的开头读出它有多宽、多高（像素），和它是哪一种图片。认得 PNG 和 JPEG；
 * 别的格式（比如 SVG）、读不懂的文件返回 null。认的是文件里的字节，不是文件名：改了后缀的图片骗不过它。
 */
export function pictureSize(bytes: ArrayBuffer): { width: number; height: number; kind: PictureKind } | null {
  const view = new DataView(bytes);
  // PNG：开头 8 个字节是固定的，接着第一块（IHDR）里就是宽和高。
  if (view.byteLength >= 24 && view.getUint32(0) === 0x89504e47 && view.getUint32(4) === 0x0d0a1a0a) {
    return { width: view.getUint32(16), height: view.getUint32(20), kind: 'png' };
  }
  // JPEG：一段一段地跳，找到写着宽高的那一段（SOF0 到 SOF15，其中 C4、C8、CC 不是）。
  if (view.byteLength >= 4 && view.getUint16(0) === 0xffd8) {
    let at = 2;
    while (at + 9 < view.byteLength) {
      if (view.getUint8(at) !== 0xff) return null;
      const marker = view.getUint8(at + 1);
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { width: view.getUint16(at + 7), height: view.getUint16(at + 5), kind: 'jpeg' };
      }
      at += 2 + view.getUint16(at + 2);
    }
  }
  return null;
}

/** 要量宽高的图片在哪：stills/ 里的定格图（人物页的一张、每一小节的），baked/ 里先画好的地面。 */
const MEASURED = /\/(stills|baked)\/[^/]+$/;

/**
 * stills/ 和 baked/ 里的图片各有多宽、多高、是哪一种。read 给出一个文件的全部字节（路径是 paths 里的原样），
 * 由调用的人从磁盘读。读不出宽高的文件（SVG、清单）不在结果里。结果里的路径去掉 prefix。
 */
export function toPictureSizes(prefix: string, paths: string[], read: (path: string) => ArrayBuffer): MeasuredPictures {
  const pictures: MeasuredPictures = {};
  for (const path of paths) {
    if (!path.startsWith(prefix) || !MEASURED.test(path)) continue;
    const size = pictureSize(read(path));
    if (size) pictures[path.slice(prefix.length)] = size;
  }
  return pictures;
}

/**
 * 大小有规定的几种文件：scenes/ 里的地形文件（.bin）和全程沙盘的“今天的海岸、湖、河”（.geojson），
 * stills/ 里的定格图，baked/ 里先画好的地面。
 */
const SIZED = /\/scenes\/[^/]+\.(bin|geojson)$|\/(stills|baked)\/[^/]+$/;

/**
 * 这几种文件各有多大。sizeOf 给出一个文件的字节数（路径是 paths 里的原样），由调用的人从磁盘量。
 * 结果里的路径同样去掉 prefix。
 */
export function toFileSizes(prefix: string, paths: string[], sizeOf: (path: string) => number): FileSizes {
  const sizes: FileSizes = {};
  for (const path of paths) {
    if (path.startsWith(prefix) && SIZED.test(path)) sizes[path.slice(prefix.length)] = sizeOf(path);
  }
  return sizes;
}

/** 工具做出来、清单里记着记号的图片：baked/ 和 stills/ 里的 JPEG、PNG。 */
const KEYED = /\/(stills|baked)\/[^/]+\.(jpe?g|png)$/i;

/**
 * 这些图片各自的记号：照文件的字节算（和工具写清单时用的是同一个算法，src/domain/contentKey.ts）。
 * read 给出一个文件的全部字节，由调用的人从磁盘读。结果里的路径去掉 prefix。
 */
export function toFileKeys(prefix: string, paths: string[], read: (path: string) => ArrayBuffer): FileKeys {
  const keys: FileKeys = {};
  for (const path of paths) {
    if (path.startsWith(prefix) && KEYED.test(path)) keys[path.slice(prefix.length)] = contentKey(new Uint8Array(read(path)));
  }
  return keys;
}
