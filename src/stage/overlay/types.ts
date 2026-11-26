// 题签这一层和沙盘程序之间的约定。题签是页面上的字（清楚、能选中），竖着写，带一条引线，盖在沙盘上面。
// 沙盘程序每画一帧，把每条题签指着的那一点落在画面的哪里告诉这一层；摆在哪、躲不躲开别的题签，由这一层定。
// 这个文件是几个人共用的接缝，要改先找负责人。
//
// 像素都是 CSS 像素，从容器的左上角量。

import type { StageInsets } from '../types';

/**
 * 题签是哪一种：strip 是竖着的纸条（这个文件夹里原来的那一种，不写就是它）；slip 是平着的纸条。
 * 哪一座沙盘用哪一种写在样式的登记表里（src/stage/styles.ts），页面那一边查了交过来；这个文件夹不认样式的名字。
 */
export type LabelKind = 'strip' | 'slip';

/** 画面上的一点（像素）。 */
export interface ScreenPoint {
  x: number;
  y: number;
}

/** 一条要摆的题签。 */
export interface StripSpec {
  id: string;
  /** 写什么字（已经按“当时的名字 / 今天的名字”挑好了）。 */
  text: string;
  /** place 是地方；water 是水名，字用靛青；far 是沙盘外面的远处，摆在沙盘边上。 */
  tone: 'place' | 'water' | 'far';
  /** 最好摆在那一点的哪一边。不写就摆在上边。 */
  side?: 'above' | 'below' | 'left' | 'right';
  /** 沿着 side 那一边往哪一头偏一格（场景里写的；和 side 一横一竖才算数）。 */
  lean?: StripSpec['side'];
  /**
   * 全程沙盘上是站的地名才有：名字下面一站一方写着站号的印，每一方是通到那一站的链接（杭州两方）。
   * label 是印上的字（一到八）；href 是那一站的网址；filled：正文写好了的站是实心的印，还没写的只有一道边；
   * here：这一小节讲的就是这一站，印外面多一圈墨线；title 是读屏软件念的那一句（“第四站，徐州：大水围城”）。
   */
  seals?: StripSeal[];
  /**
   * 这个名字指的是一片地方（一座山脉、一个国、一片海），不是一点。竖着的纸条不看它（照旧有点、有引线）；
   * 平着的纸条看：没有点、没有引线，摆不下也不留空心的圈（docs/data-spec.md“另一种题签”）。
   */
  area?: boolean;
}

/** 题签上的一方站号的印。 */
export interface StripSeal {
  stop: string;
  label: string;
  href: string;
  filled: boolean;
  here: boolean;
  title: string;
}

/** 摆题签要知道的东西。 */
export interface StripInput {
  /** 每条题签多宽多高（量出来的）；rank 是要紧的先后，0 最要紧，摆不下时先去掉数大的。 */
  strips: { id: string; w: number; h: number; rank: number; side?: StripSpec['side']; lean?: StripSpec['side']; area?: boolean }[];
  /** 每条题签指着的那一点落在画面的哪里；visible 是 false 时那一点在镜头背后或画面外面。 */
  anchors: {
    id: string;
    x: number;
    y: number;
    visible: boolean;
    /** 远处的题签才有：画面上从沙盘中间朝外的方向（长度为 1）。题签摆在这一边，不往沙盘里摆。 */
    out?: [number, number];
    /** 这一点脚下的地面落在画面的哪里。从这一点到脚下的这一段，题签都不压（不盖住它指的那样东西）。 */
    foot?: { x: number; y: number };
  }[];
  /** 画面多大。 */
  size: { width: number; height: number };
  /** 四边各留出多少，题签不摆进去。 */
  insets: StageInsets;
  /**
   * 沙盘上另有东西占着画面的时候（全程沙盘上停着的小像）：它在画面上占的方块，一样一块。题签不压这几块，引线也不从上面穿过去；
   * 只有指着一块里面的一点的题签，引线可以从里面出来（小像站在这个地名点上，名字的线从他脚下出去）。不写就是没有，摆出来的和不认得这个字段时一个数不差。
   * 直接交给 placeStrips 的话，每一条题签都躲着这几块重摆；全程沙盘用的是 ./placeAround.ts：只挪碰着这几块的那几条，别的不动。
   */
  avoid?: { x0: number; y0: number; x1: number; y1: number }[];
  /**
   * 地面的四个角落在画面的哪里（海面那么高的四个角，不是座子的；照绕一圈的先后）。平着的纸条摆在这四个角围成的那一块里面（离边至少 3 像素）；
   * 竖着的纸条的摆法（placeStrips）不看它：给不给，摆出来的一个数不差。不写就是不查这一条。
   */
  ground?: readonly ScreenPoint[];
}

/** 一条题签摆在哪。 */
export interface StripPlacement {
  id: string;
  /** 题签的中心。 */
  x: number;
  y: number;
  /** 这一条这次不摆（那一点看不见，或者让给了更要紧的）。 */
  hidden: boolean;
  /** 引线：[x1, y1, x2, y2]，从那一点到题签最近的一边；不用画时是 null。 */
  leader: [number, number, number, number] | null;
  /**
   * 引线从哪里画起：从那一点数，走了全长的几成（0 到 1）。不写就是从那一点画起。
   * 全程沙盘上小像停着的时候才有：引线落在他身上的那一截不画，线从他占的那一块的边上起（那一点上的圆点照旧画）。
   */
  from?: number;
  /** 摆在第几个候选的位置上。下一次原样传回来（prev），题签就尽量不动。手还在动时先藏起来的那一条也带着它原来的号。 */
  slot?: number;
  /**
   * 这一次没摆的缘故：unseen 是那一点不在画面里，room 是摆不下。摆不下的那一点上画一个空心的圈。
   * area 只有平着的纸条的摆法给：一个没有点的名字摆不下——什么也不画（没有哪一点“没标出”）。
   */
  why?: 'unseen' | 'room' | 'area';
}

/** 算题签摆在哪的函数：同 placeStrips 一个样子。 */
export type StripPlacer = (input: StripInput, prev?: StripPlacement[], opts?: { moving?: boolean }) => StripPlacement[];

/**
 * 全程沙盘上“让开小像”的那一个摆法（./placeAround.ts 造的）：多接一样（第四个）——拿哪一套摆法去让，不给就是 placeStrips；
 * 身上带着 yields 这个记号。另一种题签认的就是这个记号：带着它的，把自己的摆法交给它去让；
 * 没带的——平常的 placeStrips，或者谁另写的一个——一律换成自己的摆法，不会有一条平着的纸条照别的规矩摆出来。
 */
export type YieldingPlacer = ((input: StripInput, prev?: StripPlacement[], opts?: { moving?: boolean }, place?: StripPlacer) => StripPlacement[]) & { yields: true };

/**
 * 给一层题签造一份 LabelKit。root 是那一层的元素。那一小块程序自己不引 placeStrips.ts（引了，打包的工具会把它从页面的程序里
 * 单拆成一个文件），也用不着它：交进来的摆法它只认上面说的那个记号。
 */
export type LabelKitMaker = (root: HTMLElement) => LabelKit;

/**
 * 另一种题签（平着的纸条）要的三样，在单独的一小块程序里（./slips.ts），写了这一种的沙盘才下载；一层题签用一份。
 * 竖着的纸条用不着它：没有交它的那一层，造出来的东西和原来一个字节不差。
 */
export interface LabelKit {
  /** 造一条题签的元素。dot 是它指的那一点上的圆点（要在上面做记号的自己做）。 */
  make(doc: Document, spec: StripSpec, dot: SVGCircleElement): HTMLDivElement;
  /** 这一层用的摆法。base 是沙盘程序交给这一层的那一个（不交就是 placeStrips；全程沙盘交的是让开小像的那一个，见 YieldingPlacer）。 */
  place(base: StripPlacer): StripPlacer;
  /**
   * 定格图用：地面的四个角落在沙盘栏的哪里。都是清单和场景里本来就有的东西：frame 是场景的范围（四边各多少米；全程沙盘还有比例 scale），
   * pose 是清单里这张图记的镜头，shape 是这张图照哪种窗口拍的（沙盘栏多大、四边留的空、左右多拍出来多少），fit 是这张图现在摆在栏里的哪里、多大。
   * 立体的沙盘自己投，不问这里。有一个角在镜头背后（近看一处的小节）就不给（undefined）：四个角围不成一块，那一回不查。
   */
  ground(
    frame: { westM: number; eastM: number; northM: number; southM: number; scale?: number },
    pose: { target: [number, number, number]; position: [number, number, number]; fov: number },
    shape: { pane: [number, number]; insets: [number, number, number, number]; extra: number },
    fit: { left: number; top: number; width: number; height: number },
  ): ScreenPoint[] | undefined;
}

/**
 * 挂在沙盘容器里的题签层。由 mountStrips(container) 做出来（src/stage/overlay/index.ts）。
 * 摆在哪由纯函数 placeStrips(input, prev?, opts?) 算（src/stage/overlay/placeStrips.ts）：
 * prev 是上一次的结果，留着是为了转动沙盘时题签不乱跳。opts.moving 和下面 place 的是一回事。
 */
export interface StripLayer {
  /** 换一批题签（换小节、换古今名字时）。 */
  set(strips: StripSpec[]): void;
  /**
   * 按这一帧各点的位置把题签摆好。
   * opts.moving 是 true（读者的手还在动沙盘）时不重新挑位置：每条题签留在原来的候选位置上，
   * 留不住的先藏起来、留一个空心的圈；手放开以后的那一次（moving 不写或 false）再整个重摆。
   * opts.avoid 是这一帧不许压的那几块（见 StripInput.avoid）；不写就是没有。
   * opts.ground 是这一帧地面的四个角（见 StripInput.ground）；不写就是不查。
   */
  place(anchors: StripInput['anchors'], size: StripInput['size'], insets: StageInsets, opts?: { moving?: boolean; avoid?: StripInput['avoid']; ground?: StripInput['ground'] }): void;
  /** 先都藏起来（镜头滑动的时候）。下一次 place 再显出来。 */
  hide(): void;
  /**
   * 只留这一条，别的都拿掉（全程沙盘潜到一站上空时，留那一站自己的名字）。和 set 不一样的是：它上一次摆在哪还算数，
   * 下一次 place 先照原来的位置摆——镜头还没有动，名字不该跳一下。
   */
  only?(id: string): void;
  /** 重新量每条题签的大小（字体加载好以后）。 */
  remeasure(): void;
  /** 平着的纸条的那一层才有：定格图问它地面的四个角落在画面的哪里（见 LabelKit.ground）。 */
  ground?: LabelKit['ground'];
  /** 把这一层从容器里拿走。 */
  destroy(): void;
}
