// 一份内容的记号：同样的字节算出同样的 16 个十六进制字符，改了一个字节就不一样。
// 用来看“先画好的图、定格图是不是照现在的场景和程序做的”：防的是忘了重做，不是防人作假，所以用不着密码学的算法。
// 当场就算完（不用等），不靠浏览器的加密功能：平板用普通的 http 打开开发服务时没有那个功能。在 Node 里也能跑。

/** 两路各自的起点和乘数（都是奇数）。 */
const SEED_A = 0xdeadbeef;
const SEED_B = 0x41c6ce57;
const MUL_A = 2654435761;
const MUL_B = 1597334677;
/** 收尾时搅匀用的两个乘数。 */
const MIX_A = 2246822507;
const MIX_B = 3266489909;

const hex8 = (n: number): string => (n >>> 0).toString(16).padStart(8, '0');

/**
 * 算记号。data 是字节，或者一段字（按 UTF-8 的字节算，所以同一段字在哪台机器上算都一样）。
 * 两路 32 位的“异或一个字节、再乘一个数”，收尾时互相搅一遍，合成 64 位，写成 16 个十六进制字符。
 * 长度也算进去：只在末尾多几个 0 字节的两份内容，记号不一样。
 */
export function contentKey(data: Uint8Array | string): string {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  let a = SEED_A ^ bytes.length;
  let b = SEED_B ^ bytes.length;
  for (let i = 0; i < bytes.length; i++) {
    const byte = bytes[i];
    a = Math.imul(a ^ byte, MUL_A);
    b = Math.imul(b ^ byte, MUL_B);
  }
  a = Math.imul(a ^ (a >>> 16), MIX_A) ^ Math.imul(b ^ (b >>> 13), MIX_B);
  b = Math.imul(b ^ (b >>> 16), MIX_A) ^ Math.imul(a ^ (a >>> 13), MIX_B);
  return hex8(b) + hex8(a);
}
