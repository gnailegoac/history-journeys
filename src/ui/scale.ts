// 比例尺的那一段在窄的沙盘栏里放不下时，换一段短的。
// 沙盘程序报来的是“画面上 px 像素宽的一段代表 label 这么长”（src/stage/types.ts 的 StageViewInfo），
// label 的写法是固定的：“500 米”“2 公里”。这里照这个写法读出它是多少米，再挑一个短一些的整数长度。

/**
 * 比例尺可以取的长度（米）：1、2、5 打头的整数。沙盘程序挑的也是这一串（src/stage/scale.ts），最短到 10 米、最长到 1000 公里
 *（全程沙盘上一段是几百公里）；这里往下多留三个，再近也换得出短的。
 */
const LENGTHS = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000, 100000, 200000, 500000, 1000000];

const LABEL = /^(\d+(?:\.\d+)?) (米|公里)$/;

/**
 * 比例尺的那一段最长 maxPx 像素：本来就不超过就原样用；超过了，换成不超过 maxPx 的最长的一个整数长度。
 * label 读不懂、或者再短也放不下时原样用，不乱改。
 */
export function fitScale(scale: { px: number; label: string }, maxPx: number): { px: number; label: string } {
  if (!(scale.px > maxPx)) return scale;
  const read = LABEL.exec(scale.label);
  if (!read) return scale;
  const metres = Number(read[1]) * (read[2] === '公里' ? 1000 : 1);
  if (!(metres > 0)) return scale;
  const pxPerMetre = scale.px / metres;
  let best: number | null = null;
  for (const length of LENGTHS) if (length * pxPerMetre <= maxPx) best = length;
  if (best === null) return scale;
  return { px: Math.round(best * pxPerMetre), label: best < 1000 ? `${best} 米` : `${best / 1000} 公里` };
}
