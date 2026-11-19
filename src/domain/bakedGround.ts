// 先画好的地面的清单（content/figures/<人物>/baked/<站>.json）。整份由 npm run bake 写，不手改。
// 这里只有类型：清单长什么样。谁读它：读取内容的程序（sceneContent.ts）、校验规则 17、查“图是不是旧了”的测试。

export interface BakedPicture {
  file: string;
  width: number;
  height: number;
  bytes: number;
  /** 文件字节的记号。 */
  key: string;
}

export interface BakedGroundManifest {
  tool: 1;
  /** 照什么画的：场景里管地面的那一部分的记号（groundKey），地形文件的记号。 */
  inputs: { ground: string; terrain: string };
  /** 画出来的像素的记号（压缩以前）：颜色，田的标记。 */
  pixels: { colour: string; fields: string };
  /** 颜色：JPEG。quality 是 0 到 1；psnr 是压完以后和原来比的清晰度（分贝）。 */
  colour: BakedPicture & { quality: number; psnr: number };
  /** 田的标记：8 位灰度 PNG。 */
  fields: BakedPicture;
}
