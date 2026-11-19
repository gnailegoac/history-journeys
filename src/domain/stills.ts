// 定格图清单（content/figures/<人物>/stills/<站>.json）。整份由 npm run stills 写，不手改。
// 这里只有类型：清单长什么样。谁读它：读取内容的程序（sceneContent.ts）、定格图的沙盘（src/stage/still）、校验规则 18。

export type StillShape = 'wide' | 'narrow';

/** 一种形状是照哪种窗口拍的。像素都是 CSS 像素。 */
export interface StillShapeSpec {
  /** 浏览器窗口：[宽, 高]。 */
  window: [number, number];
  /** 那时候沙盘栏多大：[宽, 高]。 */
  pane: [number, number];
  /** 那时候四边留的空：[上, 右, 下, 左]。 */
  insets: [number, number, number, number];
  /** 图片比沙盘栏左右各多拍出来多少。 */
  extra: number;
  /** 拍的时候的像素比。图片文件的宽 =（pane 的宽 + 2 × extra）× pixelRatio。 */
  pixelRatio: number;
}

export interface StillAnchor {
  /** 题签的 id。 */
  id: string;
  /** 那一点在图片的哪里：从左上角量，占整张图宽、高的几成（0 到 1；看不见的可以在外面）。 */
  x: number;
  y: number;
  visible: boolean;
  /** 远处的题签才有：画面上从沙盘中间朝外的方向（长度为 1）。 */
  out?: [number, number];
  /** 那一点脚下的地面在图片的哪里，同样是几成。 */
  foot?: [number, number];
}

export interface StillShot {
  /** 小节标题。 */
  section: string;
  shape: StillShape;
  /** 文件名：<站>-<第几节>-wide.jpg 或 <站>-<第几节>-narrow.jpg。 */
  file: string;
  width: number;
  height: number;
  bytes: number;
  /** JPEG 的质量，0 到 100。 */
  quality: number;
  /** 文件字节的记号。 */
  key: string;
  /** 压成 JPEG 之前那张截图的像素的记号（工具用它判断画面变没变）。 */
  raw: string;
  pose: { target: [number, number, number]; position: [number, number, number]; fov: number };
  fit: number;
  reach: [number, number];
  northDeg: number;
  pxPerMetre: number;
  /** 这一节的题签，按这一节写的先后，一条不多一条不少。 */
  anchors: StillAnchor[];
}

export interface StillManifest {
  /** 清单格式的版本，现在是 1。 */
  tool: 1;
  made: {
    tier: 'full';
    /** three 的版本，和 package.json 里的一样。 */
    three: string;
    /** 拍的时候沙盘栏的底色（'#rrggbb'）。 */
    background: string;
    /** 拍的时候镜头用的两个数（rig.ts 的 FIT_MARGIN_PX、MAX_FIT），定格图照同样的数摆。 */
    fitMarginPx: number;
    maxFit: number;
  };
  /** 这些图是照什么拍的。四个记号各是什么见 docs/data-spec.md。 */
  madeFrom: { scene: string; terrain: string; ground: string; program: string };
  shapes: Record<StillShape, StillShapeSpec>;
  stills: StillShot[];
}
