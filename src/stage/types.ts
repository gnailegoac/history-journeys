// 沙盘适配层的接口。页面只通过这里和沙盘说话，不直接碰沙盘程序（three.js 只在 src/stage/three/ 里出现）。
// 换画法时另写一个 StageEngine。自动测试用的“假沙盘”、以后的“定格图”也各是一个 StageEngine。
// 定格图是另一个 StageEngine（src/stage/still），页面里静态引入；它不碰 three。
//
// 分工：
//   沙盘这一边画沙盘，并在自己的容器里摆题签（题签要跟着镜头走，每一帧都可能动）。
//   页面印沙盘旁边的字：小节的时间、题记、如实的说明、远处的地方。这些字不经过沙盘，
//   页面自己用 src/domain/sceneText.ts 的 sectionInfo() 从场景数据生成；沙盘起不来的时候也照样有。
//   指北和比例尺跟着镜头变，由沙盘通过 onViewChange 告诉页面，页面来画。

import type { NamesMode, RouteScene, StopScene } from '../domain/scene';
import type { StillManifest } from '../domain/stills';
import type { StopMark } from '../domain/stopMarks';

export type { NamesMode, StopMark };

/** 画质分两档：完整，减配。定格图不算一档画质，它是另一个 StageEngine（src/stage/still）。 */
export type StageTier = 'full' | 'reduced';

/**
 * 要摆出来的一座沙盘：站点沙盘，或者全程沙盘。两种的样子一样，只差 kind 和场景是哪一层的。
 * 立体的沙盘程序、定格图、两个替身和页面，两种都认。
 */
export type StageTable = StopTable | RouteTable;

/** 一位人物的全程沙盘。别的字段的意思和 StopTable 的一样。 */
export interface RouteTable extends Omit<StopTable, 'kind' | 'scene'> {
  kind: 'route';
  /** 认这座沙盘用的名字，如 "su-shi/route"。 */
  key: string;
  scene: RouteScene;
}

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
  /**
   * 全程沙盘上每一站的印：键是 figure.json 里站的 id。页面用 src/domain/stopMarks.ts 的 stopMarks() 从 figure.json 里拼。
   * 不写，题签上就没有站号的印。站点沙盘不看。
   */
  marks?: Record<string, StopMark>;
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
  /**
   * 给测试用：小像现在在哪。at 是它脚下那一点（沙盘里的米）；px 是脚下那一点落在画面的哪里（x、y）和它在画面上多高（h，从脚到帽顶，像素）。
   * 沙盘上没有小像（没有摆、拿走了、潜的时候收起来了）是 null；摆不了小像的沙盘（站点沙盘、定格图、沙盘的替身）不写。
   */
  piece?: { at: [number, number, number]; px: { x: number; y: number; h: number } } | null;
}

/**
 * 小像站在哪。三种说法；页面只说这些，路的线在沙盘这一边：
 *   place  一个地名点上（场景里 places 的 id）；
 *   road   一趟路上：ways 是走的那几截路，照走的先后，倒着走的前面一个减号（和场景文件里的写法一样）；
 *          从 from 到 to 沿着画出来的线匀着走，走到 k 成（0 到 1）。from、to 是这几截路接起来的两头（'start'、'end'），
 *          或者路上一处的经纬度（落在线上离它最近的一点）；
 *   spot   画出来的一截路上、沙盘没有立名字的一处：way 是那一截路，at 是那一处的经纬度（落在线上离它最近的一点）。
 */
export type PiecePlace =
  | { on: 'place'; place: string }
  | { on: 'road'; ways: string[]; from: PieceEnd; to: PieceEnd; k: number }
  | { on: 'spot'; way: string; at: [number, number] };

/** 一趟路上的一头。 */
export type PieceEnd = 'start' | 'end' | [number, number];

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

/** 一座挂在页面上的沙盘，能照小节摆（站点沙盘和全程沙盘都是它）。 */
export interface StopStageView extends StageView {
  /**
   * 镜头去某一小节，沙盘换成那一节的样子（水位、哪些东西已经有了、摆哪几条题签）。section 是小节标题。
   * ready 完成之前就可以调用：这时直接摆到位，不滑。opts.animate 写 false 也是直接摆到位。
   * 到了、画面稳定以后完成；页面这时再换沙盘旁边的字。
   * 途中再次调用时，放弃旧的，改去新的；被放弃的那一次照常完成（不拒绝），所以页面要自己记住哪一次是最新的。
   * 只有这个小节标题在场景里没有时才拒绝。
   */
  showSection(section: string, opts?: { animate?: boolean }): Promise<void>;

  /**
   * 全程沙盘才有：镜头从现在的地方（滑到半路、读者拖过以后也一样）潜到一站的上空，对准那一站的地名点。
   * 用 ms 毫秒，照钟点走，不照画了几帧：慢的设备上是帧少，不是潜得久。镜头先对准那一站（钟点走到六成就对准了），凑近是起步慢、越来越快；
   * 一起步别的题签都收起来，只留那一站自己的那一条；潜的这一会儿读者的手动不了镜头。
   * 潜到了，完成为 true。潜不了（还没摆好、嫌慢了、系统说要少动、沙盘上没有这一站）马上完成为 false；
   * 半路被新的指令顶掉、被读者接过去、画面丢了、关掉了，也完成为 false。从不拒绝。
   * 潜完以后镜头留在那里：页面接着换到那一站；不换的话，要再叫一次 showSection 才回到原来的小节。
   */
  dive?(stop: string, ms: number): Promise<boolean>;

  /**
   * 全程沙盘才有：把小像摆到这里；null 是拿走。马上摆到，不滑，不动镜头；之后画一帧（读正文的时候多出来的画法只有这一种）。
   * 还没摆好就调用的，记着最后一次，摆好了照它摆。认不得的 id（地名点、路）当作 null，并在控制台说一句。
   * 小像停着的时候，题签让开它（只挪碰着它的那几条，见 src/stage/overlay/placeAround.ts）：站在一处（地名点上，或者 spot）总算停着；
   * 在路上的，atRest 是 true 才算（时间轴停在这一天：读者放了手、按了暂停）。在路上走着的时候（拖着、按着键、播放着）不让：
   * 题签不跟着一个走动的东西来回换位置。
   * 潜到一站上空的那一趟（dive）一起步，小像收起来——除非他正站在那一站的地名点上；下一次 showSection 再摆出来。
   * 从不抛出；嫌慢以后、画面丢了、关掉以后不做事。站点沙盘上只是记着，什么也不摆。
   * 定格图不写这个方法（图片上不画小像）；沙盘的替身不画，只把叫它摆在哪记在 data-fake-piece 上。
   */
  placePiece?(where: PiecePlace | null, atRest?: boolean): void;
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
  create(container: HTMLElement, table: StageTable, options: StageOptions): StopStageView;
}

// ---------------------------------------------------------------- 时间轴（src/timebar/，摆上全程沙盘才下载的一段程序）

/** 时间轴走到了哪一站讲的那几年（stop 是站的 id）；says 是目录里那一站上添的几个字：他正住在那里、正往那里去时才有，别的时候是空的。 */
export interface BarHere {
  stop: string;
  says: string;
}

/** 沙盘栏交给时间轴的几样。 */
export interface BarProps {
  /** 摆着的全程沙盘（场景里有哪几节、各看哪一站；它的 key 的头一段是哪位人物）。 */
  table: RouteTable;
  /** 每一站的印：印上的字、网址、写好了没有（src/domain/stopMarks.ts）。 */
  marks: StageOptions['marks'];
  /** 现在挂着的立体的沙盘（没摆好、放着图片时 view 是 null）：小像是摆在它上面的。 */
  slot: { current: { view: StopStageView | null } };
  /** 读者动了时间轴：全程沙盘该看这一节（小节标题）。时间轴只报这一句，镜头怎么过去是沙盘栏的事；读者没动过时间轴的时候不报。 */
  onGoal?: (heading: string) => void;
  /** 时间轴走到了哪一站讲的那几年、目录上该写哪几个字；不在哪一站讲的年份里是 null。人物页的目录还没有接这一样的时候不交。 */
  onHere?: (here: BarHere | null) => void;
}
