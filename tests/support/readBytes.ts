// 测试里从磁盘读文件的字节、看文件多大（import.meta.glob 读不了二进制文件的内容）。
// 路径都相对项目的根目录，用“/”分隔，如 content/figures/su-shi/scenes/xuzhou.terrain.bin。
// 只给测试用（在 Node 里跑）；src/ 里的程序不要用。

import { readFileSync, statSync } from 'node:fs';

/** 项目的根目录：这个文件在 tests/support/ 里，往上两层。 */
const ROOT = new URL('../../', import.meta.url);

/** 读一个文件的全部字节。没有这个文件时抛出错误。 */
export function readBytes(path: string): ArrayBuffer {
  const bytes = readFileSync(new URL(path, ROOT));
  const out = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(out).set(bytes);
  return out;
}

/** 一个文件有多少字节。没有这个文件时抛出错误。 */
export function fileSize(path: string): number {
  return statSync(new URL(path, ROOT)).size;
}
