// 比例尺取多长。立体的沙盘（src/stage/three/rig.ts）和定格图的沙盘（src/stage/still）都用它，
// 所以放在两边都够得着的地方：只算数，不碰 three，也不碰页面。

/**
 * 比例尺可以取的长度（米）：1、2、5 打头的整数。
 * 最后三个（200、500、1000 公里）是全程沙盘用的：站点沙盘最远的画面上 10 公里已经有一百多像素，选不到它们。
 */
const SCALE_LENGTHS = [10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000, 100000, 200000, 500000, 1000000];
/** 比例尺那一段最长多少像素。取不超过它的最长的一个整数长度，画出来就在 60 到 140 像素之间（最短 56）。 */
const SCALE_MAX_PX = 140;

/** 比例尺：挑一个整数的长度，画面上那一段多少像素，上面写什么字（“500 米”“2 公里”）。 */
export function chooseScale(pxPerMetre: number): { px: number; label: string } {
  let metres = SCALE_LENGTHS[0];
  for (const candidate of SCALE_LENGTHS) if (candidate * pxPerMetre <= SCALE_MAX_PX) metres = candidate;
  return {
    px: Math.round(metres * pxPerMetre),
    label: metres < 1000 ? `${metres} 米` : `${metres / 1000} 公里`,
  };
}
