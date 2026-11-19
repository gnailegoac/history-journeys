// 沙盘适配层的接口。页面只通过这里和沙盘说话，不直接碰沙盘程序（three.js 只在 src/stage/three/ 里出现）。
// 换画法时另写一个 StageEngine。自动测试用的“假沙盘”、以后的“定格图”也各是一个 StageEngine。
// 定格图是另一个 StageEngine（src/stage/still），页面里静态引入；它不碰 three。
//
// 分工：
//   沙盘这一边画沙盘，并在自己的容器里摆题签（题签要跟着镜头走，每一帧都可能动）。
//   页面印沙盘旁边的字：小节的时间、题记、如实的说明、远处的地方。这些字不经过沙盘，
//   页面自己用 src/domain/sceneText.ts 的 sectionInfo() 从场景数据生成；沙盘起不来的时候也照样有。
//   指北和比例尺跟着镜头变，由沙盘通过 onViewChange 告诉页面，页面来画。

import type { NamesMode, StopScene } from '../domain/scene';
import type { StillManifest } from '../domain/stills';

export type { NamesMode };

/** 画质分两档：完整，减配。定格图不算一档画质，它是另一个 StageEngine（src/stage/still）。 */
export type StageTier = 'full' | 'reduced';

/**
 * 要摆出来的一座沙盘。现在只有站点沙盘。
 * 全程沙盘接进来时（重做顺序第 4 步）在这里加一种 kind，再配一种它自己的 StageView；下面已有的不用改。
 */
export type StageTable = StopTable;

export interface StopTable {
  kind: 'stop';
  /** 认这座沙盘用的名字，如 "su-shi/xuzhou"。 */
  key: string;
  scene: StopScene;
  /** 地形文件的网址，由读取内容的程序给出。 */
  terrainUrl: string;
  /**
   * 制作时先画好的地面（npm run bake 做的两张图）。没有，或者和场景、地形文件对不上时，沙盘打开时现画。
   * inputs 是这两张图照着画的东西的记号：场景里管地面的那一部分，地形文件。沙盘程序拿它和手里的场景、
   * 刚取到的地形文件各算一遍对一对，对不上就不用这两张图。
   */
  ground?: {
    colourUrl: string;
    fieldsUrl: string;
    /** 两张图的宽和高（像素），两张一样大。 */
    width: number;
    height: number;
    inputs: { ground: string; terrain: string };
  };
  /** 每一小节的定格图（npm run stills 做的）。这座沙盘还没有定格图时不写。urls 的键是清单里的文件名。 */
  stills?: { manifest: StillManifest; urls: Record<string, string> };
}

/** 四边各留出多少像素（上面有按钮，下面有题记）。要看的东西摆在留出来的中间。 */
export interface StageInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface StageOptions {
  namesMode: NamesMode;
  /** 用户系统设置了“减少动态效果”时为 true：镜头和水位直接换，不滑过去。 */
  reducedMotion: boolean;
  /** 一开始摆哪一小节（小节标题）。不写就是第一节。 */
  section?: string;
  insets?: StageInsets;
  /**
   * 指定画质：写了就照它摆，不嫌慢，也不往下降，也不通知 onSlow（自动测试、拍定格图用）。
   * 不写由沙盘程序自己挑（试画一次），慢了会通知 onSlow。
   */
  tier?: StageTier;
  /**
   * 读者自己点了“试试立体的沙盘”：照 tier 摆，不再因为“有点慢”往下降；
   * 但慢得没法用（见 src/stage/three/tier.ts 的两条“没法用”的线）时照样通知 onSlow，页面换回图片。
   * 只和 tier 一起写。
   */
  asked?: boolean;
}

/** 跟着镜头变的两样：指北和比例尺。 */
export interface StageViewInfo {
  /** 指北针转多少度：画面正上方是北时为 0，顺时针为正。 */
  northDeg: number;
  /**
   * 比例尺：画面上 px 像素宽的一段，代表地面上 label 这么长（如“1 公里”）。label 由沙盘挑一个整数，
   * 写法固定是“数、空格、米或公里”（“500 米”“2 公里”）：页面在窄的栏里要照这个写法换一段短的（src/ui/scale.ts）。
   * 量的是画面中心附近；斜着看时远近不一样，只是大约。
   */
  scale: { px: number; label: string };
}

export type StageSupport =
  | { ok: true }
  /**
   * no-webgl2：这个浏览器不支持 WebGL2。
   * too-slow：这一次访问里已经量出来，这台设备连减配的一档也带不动（只降不升，记到这一次访问结束）。
   */
  | { ok: false; reason: 'no-webgl2' | 'too-slow' };

/** 给自动测试和量预算用的读数。假沙盘都给 0。 */
export interface StageReadout {
  /** 现在画着多少个三角形。 */
  triangles: number;
  /** 画一帧调用显卡多少次。 */
  drawCalls: number;
  /** 画质和快慢的读数。只有摆出来的立体沙盘给；还没造好的、假沙盘、定格图都不给。 */
  perf?: {
    tier: StageTier;
    pixelRatio: number;
    /** 画布实际多少像素。 */
    buffer: { width: number; height: number };
    /** 造好以后一共画了几帧（用来查“读正文的时候一帧都不画”）。 */
    frames: number;
    /** 试画的用时（毫秒，三次里居中的一次）；还没试过是 null。 */
    trialMs: number | null;
    /** 最近一次完整的滑动里，相邻两帧隔多久（毫秒，居中的数）；还没有是 null。 */
    glideMs: number | null;
  };
  /** 给拍定格图的工具用：现在这个画面的底细。只有摆出来的立体沙盘给。 */
  shot?: StageShot;
}

export interface StageShot {
  section: string;
  size: { width: number; height: number };
  insets: StageInsets;
  /** 镜头真的在哪（沙盘里的米），画面窄了退过以后的。 */
  pose: { target: [number, number, number]; position: [number, number, number]; fov: number };
  /** 镜头离对准的那一点，是场景里写的距离的几倍。 */
  fit: number;
  /** 这一节一定要看得见的点，离留出来的那一块的中心最远多少像素：[横, 竖]。 */
  reach: [number, number];
  pxPerMetre: number;
  northDeg: number;
  /** 这一节每条题签指着的那一点，按这一节题签的先后。像素，从画面左上角量。 */
  anchors: StageShotAnchor[];
}

export interface StageShotAnchor {
  id: string;
  x: number;
  y: number;
  visible: boolean;
  /** 远处的题签才有：画面上从沙盘中间朝外的方向（长度为 1）。 */
  out?: [number, number];
  /** 这一点脚下的地面落在画面的哪里（那一点抬高过才有）。 */
  foot?: { x: number; y: number };
}

/** 一座挂在页面上的沙盘：各种沙盘都有的部分。 */
export interface StageView {
  /**
   * 第一个画面完整地画出来以后完成。起不来时拒绝（地形文件读不出、三维画面建不起来），页面显示一句说明。
   * create 立刻返回，不在同一轮里做重活；动手算地形之前，先让浏览器把页面上“正在摆”的那句话画出来。
   */
  readonly ready: Promise<void>;

  /**
   * 回到刚才摆好的位置（站点沙盘上就是“回到这一节”）。
   * 被新的指令顶掉时照常完成（不拒绝）。
   */
  resetView(): Promise<void>;

  /** 题签换成当时的名字或今天的名字。 */
  setNamesMode(mode: NamesMode): void;

  setInsets(insets: StageInsets): void;

  /**
   * 镜头变了，指北和比例尺跟着变。返回取消订阅的函数。订阅时如果已经画过，立刻通知一次。
   * 读者拖动沙盘时每一帧都会通知。页面收到以后要直接改页面元素（转指北针、改比例尺的宽和字），
   * 不要放进会让整栏重画的状态里。
   */
  onViewChange(listener: (info: StageViewInfo) => void): () => void;

  /**
   * 读者自己动过镜头（true），或者镜头开始去往、已经回到摆好的位置（false）。用来决定“回到这一节”能不能点。
   * 只在这个值变了的时候通知；一开始是 false，不另行通知。
   */
  onUserMoved(listener: (moved: boolean) => void): () => void;

  /**
   * 三维画面中途丢了，或者摆好以后画布被同一个 StageEngine 新摆的一座沙盘借走了。
   * 定格图也用它：某一节的图片取不到（已经重试过一次）时通知。
   * 页面把这座沙盘（这张图）关掉，换成一句说明。
   */
  onLost(listener: () => void): () => void;

  /**
   * 这座沙盘在这台设备上太慢（试画，或者镜头滑动时量出来的）。只通知一次，摆好之前、之后都可能；
   * 摆好之前通知的，ready 不再完成也不拒绝，等页面来关。
   * 页面收到以后：先让这座沙盘留在原处（它不再画），再问一次 engine.support()——
   * 还行就重摆一座（会低一档），不行就换成定格图；新的画面出来了，或者过了 1.5 秒，才把这一座关掉。
   * 指定了画质的沙盘（options.tier，没有 asked）不会通知。假沙盘、定格图只在测试要它通知时通知。
   */
  onSlow(listener: () => void): () => void;

  /** 容器大小变了。 */
  resize(): void;

  readout(): StageReadout;

  /**
   * 关掉，并把这座沙盘的模型和贴图放掉。
   * 还没完成的 ready 和指令照常完成（不拒绝），页面不用为一座已经关掉的沙盘处理错误。
   * 关掉以后再调用 showSection、resetView 一律拒绝，别的方法不做事。可以重复调用。
   */
  destroy(): void;
}

/** 一座站点沙盘。 */
export interface StopStageView extends StageView {
  /**
   * 镜头去某一小节，沙盘换成那一节的样子（水位、哪些东西已经有了、摆哪几条题签）。section 是小节标题。
   * ready 完成之前就可以调用：这时直接摆到位，不滑。opts.animate 写 false 也是直接摆到位。
   * 到了、画面稳定以后完成；页面这时再换沙盘旁边的字。
   * 途中再次调用时，放弃旧的，改去新的；被放弃的那一次照常完成（不拒绝），所以页面要自己记住哪一次是最新的。
   * 只有这个小节标题在场景里没有时才拒绝。
   */
  showSection(section: string, opts?: { animate?: boolean }): Promise<void>;
}

export interface StageEngine {
  readonly name: string;
  readonly version: string;
  /** 这个浏览器能不能画立体的沙盘。不能时页面显示一句说明，不调用 create。可以反复问，不会每次都去试。 */
  support(): StageSupport;
  /**
   * 在 container 里摆出一座沙盘。不抛出错误：起不来时通过 ready 拒绝。
   * 沙盘只在 container 里面添东西（画布和题签）；关掉时把自己添的都拿走。
   * 同一个 StageEngine 一次只有一座沙盘是活的（共用一块画布）：前一座还没有 destroy 就再摆一座，
   * 前一座从此不再画，并通过 onLost 通知页面（还没摆好的那一座则是 ready 拒绝）。页面应当先 destroy 前一座。
   */
  create(container: HTMLElement, table: StopTable, options: StageOptions): StopStageView;
}
