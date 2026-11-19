// 测试和制作用的工具要从磁盘读写文件（地形文件、先画好的地面、定格图、构建出来的 dist/）、压缩和解压，
// 用的是 Node 自带的 fs 和 zlib。这个项目没有装 Node 的类型声明，这里只声明用到的几个函数。
// 只给 tests/ 里的程序用（在 Node 里跑）；src/ 里的程序不要用。
declare module 'node:fs' {
  export function readFileSync(path: string | URL): Uint8Array;
  export function statSync(path: string | URL): { size: number };
  export function writeFileSync(path: string | URL, data: Uint8Array | string): void;
  export function mkdirSync(path: string | URL, options?: { recursive?: boolean }): void;
  export function existsSync(path: string | URL): boolean;
  export function rmSync(path: string | URL, options?: { recursive?: boolean; force?: boolean }): void;
  /** 一个文件夹里的名字。recursive 是 true 时连子文件夹里的一起列，给的是相对这个文件夹的路径（Windows 上用“\”分隔，要自己换成“/”）。 */
  export function readdirSync(path: string | URL, options?: { recursive?: boolean }): string[];
  /** 同上，但是每一项带着“是文件还是文件夹”。 */
  export function readdirSync(path: string | URL, options: { withFileTypes: true; recursive?: boolean }): { name: string; isFile(): boolean; isDirectory(): boolean }[];
}

declare module 'node:zlib' {
  /** level 是压缩的力度，0 到 9。 */
  export function deflateSync(data: Uint8Array, options?: { level?: number }): Uint8Array;
  export function inflateSync(data: Uint8Array): Uint8Array;
  export function gzipSync(data: Uint8Array, options?: { level?: number }): Uint8Array;
  /** 解开一段 Brotli 压缩的数据（WOFF2 字体文件里用的就是它）。 */
  export function brotliDecompressSync(data: Uint8Array): Uint8Array;
}

// 做字体的工具（tests/support/fontTool.ts）另外要用的三样。
declare module 'node:crypto' {
  /** 只用到 SHA-256：createHash('sha256').update(字节).digest('hex') 给出 64 个字符。 */
  export function createHash(algorithm: 'sha256'): { update(data: Uint8Array): { digest(encoding: 'hex'): string } };
}

declare module 'node:buffer' {
  /** Node 自己的那种字节数组。裁剪字体的库只认它，不认普通的 Uint8Array，所以交给它之前要转一下。 */
  export const Buffer: { from(data: Uint8Array): Uint8Array };
}

// 裁剪字体的库（subset-font）自己没有带类型声明。只声明用到的这一个函数和这几个选项。
declare module 'subset-font' {
  export interface SubsetFontOptions {
    /** 做成什么格式。 */
    targetFormat?: 'sfnt' | 'woff' | 'woff2';
    /** 名称表里另外要留下的几条（编号）。 */
    preserveNameIds?: number[];
    /** 只留这几种排版功能（四个字符的名字）；不写是全留。 */
    keepFeatures?: string[];
    /** 去掉提示信息。 */
    noHinting?: boolean;
  }
  /** font 要是 Node 的 Buffer；text 是要留下的字。 */
  export default function subsetFont(font: Uint8Array, text: string, options?: SubsetFontOptions): Promise<Uint8Array>;
}
