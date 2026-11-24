// 一座挂在页面上的站点沙盘：StopStageView 的 three.js 实现。
// 装配的先后、镜头的数都照样张（spikes/art-direction/b/scene/sandtable.js）；
// 样张里一个镜头一张表（SHOTS）的那些数，现在从场景文件的小节和样式里算出来。
//
// 几条规矩：
//   造沙盘分成几段，每一段之间让浏览器喘口气（画页面、响应手指）；每一段等完都看一眼这座沙盘是不是已经关掉了。
//   只在有变化时才画：换小节、读者拖动、容器大小变了。没有一直转着的循环。
//   模型只有一套，大小跟着镜头的远近连续地变：每画一帧，把这一帧折算过的远近告诉零件库和题签。
//   影子只在灯、影子罩的那一块或显出来的模型变了的时候重画。模型只是大小变了，镜头还在动就先不重画，停下来以后补一次。
//   画质从借到手的画布那一份（lease.quality）读，不从别处读。
//   快慢只量、只报，不在这里评：第一个画面摆出来以后试画一次，镜头每滑完一趟量一次，都报给这一次访问的记性（tier.ts）。
//   它答“降”，这座沙盘从此不再画，通知页面（onSlow）；评的线、降到哪一档，这里一概不知道。
//   零件库只通过 buildModels 和 ModelSet 用（按家分块的零件怎么取，另从 kit/families.ts 拿：familiesOf、loadFamilies），题签只通过 mountStrips 和 StripLayer 用。

import { DirectionalLight, Fog, HemisphereLight, MathUtils, PMREMGenerator, PerspectiveCamera, Scene, Vector3, type WebGLRenderer } from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import type { RouteSection, SceneSection, SceneStrip, TableScene } from '../../domain/scene';
import type { FrameCoords } from '../../domain/sceneGeo';
import { coordsOf } from '../../domain/sceneGeoRoute';
import { stripTexts } from '../../domain/sceneText';
import { buildFields, readDem, samplers as groundSamplers } from '../ground';
import type { GroundSamplers, Vec2, Vec3 } from '../ground/types';
import { mountStrips, sectionStripSpecs } from '../overlay';
import type { StripLayer } from '../overlay/types';
import type { NamesMode, RouteTable, StageInsets, StageOptions, StageReadout, StageShot, StageTable, StageTier, StageViewInfo, StopStageView, StopTable } from '../types';
import { beginGroundPaint, type GroundPaintJob } from './groundPaint';
import { nextFrame, nextPaint, type Lease, type StageHost } from './host';
import type { LightSpec, ModelSet, StageStyle } from './internal';
import { buildModels } from './kit';
import { familiesOf, loadFamilies } from './kit/families';
import { buildMist, type Mist } from './mist';
import { pixelRatioFor, qualityFor } from './quality';
import { centreShift, chooseScale, equivalentDistance, lightDim, northDeg, pixelsPerMetre, placeCamera, projectSpots, shadowBox, shadowTuning, stripSpots, type StripSpot } from './rig';
import { Sequencer, mixState, type Glide, type TableState } from './sequencer';
import { styleFor } from './style';
import { buildTable, type Stand } from './table';
import { buildTerrainMesh, type TerrainMesh } from './terrainMesh';
import { TRIAL_FRAMES, bigEnoughToTry, chooseTier, createGlideMeter, middle, type GlideMeter, type TierMode } from './tier';
import { buildWater, rippleDense, rippleFor, rippleShare, rippleTurn, widestRiverM, type Water } from './water';

/** 浏览器里的画布主人。 */
export type BrowserHost = StageHost<HTMLElement, HTMLCanvasElement, WebGLRenderer>;

/**
 * 量快慢要用的两样：钟点（毫秒），和页面现在是不是在前台。
 * 都是交进来的，测试交假的：让钟走得快一点慢一点，就是“这台设备画得快、画得慢”，不看跑测试的机器。
 */
export interface ViewEnv {
  now(): number;
  pageVisible(): boolean;
}

/** 浏览器里的那两样。页面在后台时浏览器不给动画帧，那时候量出来的快慢不作数。 */
const browserEnv: ViewEnv = {
  now: () => performance.now(),
  pageVisible: () => typeof document === 'undefined' || document.visibilityState !== 'hidden',
};

/** 换小节时镜头滑多久；“回到这一节”滑多久。毫秒。 */
const GLIDE_MS = 2200;
const RESET_MS = 900;
/** 太阳离影子那一块的中心多远，影子的镜头从多远照到多远（样张的数）。 */
const SUN_DISTANCE = 26000;
const SHADOW_NEAR = 4000;
const SHADOW_FAR = 46000;
/**
 * 镜头停下来以后过这么多毫秒，模型的大小要是变了，补画一次影子。
 * 不是一停就补：滚轮每滚一格都算“动了一下、又停了”，一格补一次等于每一帧都重画影子。
 */
const SHADOW_SETTLE_MS = 250;
/** 折算过的远近比上一次画影子时差出这么多（取对数以后的差），才算模型的大小变了、影子该补画。 */
const SHADOW_STALE_LN = 0.05;

/** 读者拖动镜头的范围（样张的数）：最近、最远多少米，最斜到多少度（0 是正俯视）。 */
const MIN_DISTANCE = 900;
const MAX_DISTANCE = 90000;
const MAX_TILT = 80;
/**
 * 全程沙盘上读者最近能凑到多近。先画好的地面一个点合地上一公里多：凑到 6000，900 像素高的栏里一个点有三个多像素宽，
 * 看到的是一格一格的；12000 时是一个半像素。
 */
const ROUTE_MIN_DISTANCE = 12000;

/** 全程沙盘那一块程序（用到时才下载）。 */
export type RouteLevel = typeof import('./routeLevel');
/**
 * 全程沙盘那一块程序怎么取。取它的那一句动态 import 不写在沙盘程序里面，由页面那一边交进来（src/stage/index.ts）：
 * 写在这里的话，打包的工具会把“预先下载”用的一小段程序从页面的程序里单拆成一个文件，页面一打开就多下载三百多字节、多一次请求。
 */
export type RouteLevelLoader = () => Promise<RouteLevel>;

/** 全程沙盘那一块程序到了以后的两样：程序自己，和它一到就开始取的先画好的地面。 */
interface RouteBegun {
  level: RouteLevel;
  paint: ReturnType<RouteLevel['routeGroundPaint']>;
}

/** 造沙盘一开头就动手取的东西：站点沙盘是先画好的地面；全程沙盘是它那一块程序（连同先画好的地面）。 */
type Starting = { kind: 'route'; table: RouteTable; begun: Promise<RouteBegun> } | { kind: 'stop'; table: StopTable; paint: GroundPaintJob };

/** 地面往上的那几样，站点沙盘和全程沙盘各有各的造法，造出来是同一种东西。 */
interface TableParts {
  samplers: GroundSamplers;
  terrain: TerrainMesh;
  water: Water;
  mist: Mist;
  stand: Stand;
  models: ModelSet;
}

const NO_INSETS: StageInsets = { top: 0, right: 0, bottom: 0, left: 0 };

/** 一小节摆好以后的样子：镜头、水、云气、灯、影子罩哪一块。跟画面的大小有关，用的时候现算。 */
interface Look {
  heading: string;
  section: SceneSection | RouteSection;
  /** 镜头离对准的那一点多远（画面窄了已经退过）。 */
  distanceM: number;
  /** 这个距离是场景里写的距离的几倍。 */
  fit: number;
  /** 这一节一定要看得见的点，离留出来的那一块的中心最远多少像素：[横, 竖]。 */
  reach: [number, number];
  state: TableState;
  light: LightSpec;
  shadow: { centre: Vec2; half: number };
}

/** 造好以后才有的东西。 */
interface Built {
  renderer: WebGLRenderer;
  world: Scene;
  camera: PerspectiveCamera;
  controls: OrbitControls;
  sun: DirectionalLight;
  hemi: HemisphereLight;
  fog: Fog;
  samplers: GroundSamplers;
  water: Water;
  mist: Mist;
  stand: Stand;
  models: ModelSet;
  strips: StripLayer;
}

/** 等浏览器闲下来再做（没有这个功能的浏览器就稍等一下）。 */
function whenIdle(run: () => void): void {
  if (typeof requestIdleCallback === 'function') requestIdleCallback(() => run(), { timeout: 2000 });
  else setTimeout(run, 200);
}

/**
 * env 不写就是浏览器里的钟点和“页面在不在前台”（沙盘程序就是这么叫的）；测试交假的进来。
 * table 可以是站点沙盘，也可以是全程沙盘：同一个 ThreeStopView，碰到全程沙盘的几处各分一次（看 scene.level）。
 * loadRoute 是全程沙盘那一块程序怎么取；只摆站点沙盘的可以不交，摆全程沙盘而没有交的，ready 拒绝。
 */
export function createStopView(
  container: HTMLElement,
  table: StageTable,
  options: StageOptions,
  host: BrowserHost,
  env: ViewEnv = browserEnv,
  loadRoute?: RouteLevelLoader,
): StopStageView {
  return new ThreeStopView(container, table, options, host, env, loadRoute);
}

class ThreeStopView implements StopStageView {
  readonly ready: Promise<void>;

  private readonly container: HTMLElement;
  private readonly table: StageTable;
  private readonly options: StageOptions;
  private readonly host: BrowserHost;
  private readonly env: ViewEnv;
  private readonly loadRoute: RouteLevelLoader;
  private readonly scene: TableScene;
  private readonly coords: FrameCoords;
  private readonly style: StageStyle;
  private readonly sequencer: Sequencer;
  private namesMode: NamesMode;
  private insets: StageInsets;

  private built: Built | null = null;
  /** 全程沙盘那一块程序（摆全程沙盘时才有）：潜到一站上空要用它。 */
  private routeLevel: RouteLevel | null = null;
  /** 正在潜到一站上空。 */
  private diving = false;
  private lease: Lease<HTMLCanvasElement, WebGLRenderer> | null = null;
  /** 造出来的东西怎么放掉，按造的先后记着。 */
  private readonly disposers: (() => void)[] = [];
  private destroyed = false;
  private lost = false;
  private isReady = false;
  /** 最近一次摆小节出的错（没出错是 null）。第一个画面摆不出来要算沙盘没起来。 */
  private placeFailure: unknown = null;
  private settleReady: () => void = () => {};
  private failReady: (error: Error) => void = () => {};

  /** 现在的水位、水色、云气（滑到一半时是中间的数）。 */
  private levelM: number;
  private flood = 0;
  private mistNow = 1;
  /** 沙盘上现在摆的是哪一小节的东西。镜头一起步就换成新一节的。 */
  private shownSection: string;
  /** 最近一次摆好的（或者正在滑过去的）那一小节的样子；第一个画面摆出来之前是 null。 */
  private look: Look | null = null;
  /** 水纹朝哪边、平常多密，是照哪一小节的镜头定的（见 drawFrame 里写了 calmUnderPx 的那一段）。 */
  private rippleOf: Look | null = null;
  /** 最宽的一条河画多宽（米）：写了 calmUnderPx 的沙盘头一回用到时算一次记着，不每一帧算。还没算是 null。 */
  private widestM: number | null = null;
  /** 现在摆着的题签：哪一小节的、哪几条。 */
  private stripsFor: string;
  private shownStrips: SceneStrip[] = [];
  private stripsHidden = true;
  /** 刚换了一批题签，还没有摆过：第一次要整个摆，哪怕读者的手正按着。 */
  private stripsFresh = false;
  /** 题签指着的点只跟折算过的远近有关：镜头只是转的时候不用重算。 */
  private spotCache: { key: string; spots: StripSpot[] } | null = null;

  private moved = false;
  /** 这一次镜头是程序挪的，不算读者动的。 */
  private byProgram = false;
  /** 读者的手（鼠标、手指）正按在沙盘上，从控制器说“开始”到说“结束”。 */
  private handDown = false;
  /** 手按着的时候摆过题签（只是留在原来的位置上）：手放开以后要整个重摆一次。 */
  private heldStrips = false;
  private cancelRender: (() => void) | null = null;
  /** 容器大小或四边留的空变了，镜头要重新摆。 */
  private replaceQueued = false;
  private sizeNow = { width: 0, height: 0, ratio: 0 };
  /** 上一次摆镜头、或者上一次 resize() 时容器多大、画布用多少像素比。都一样就不用重摆。 */
  private seenSize = { width: -1, height: -1, ratio: 0 };
  private shadowInLastFrame = false;
  /** 上一次画影子时折算过的远近（模型那时候多大）。还没画过是 0。 */
  private shadowD = 0;
  /** 下一帧要是模型的大小变了，影子当场补画（镜头是直接摆到位的，或者停下来够久了）。 */
  private shadowCatchUp = false;
  /** 约好的“停下来以后看一眼影子”怎么取消；没约是 null。 */
  private cancelSettle: (() => void) | null = null;
  /** 正在画一帧（画完通知页面时，页面要是又叫过来画，就约到下一帧）。 */
  private drawing = false;
  /** 造好以后一共画了几帧（试画的几帧也算）。 */
  private frames = 0;
  /** 现在用的灯、影子罩的那一块（用来看要不要换）。 */
  private lightKey = '';
  private boxKey = '';
  /** 现在这套灯要云气淡到几成（白天是 1）。 */
  private mistTimes = 1;
  /** 光从哪边来：从沙盘指向太阳，长度为 1。 */
  private readonly sunDir = new Vector3(0, 1, 0);
  private lastInfo: StageViewInfo | null = null;

  /** 这座沙盘照哪一档摆、快慢怎么评（指定的不评，读者自己要的只看“没法用”，程序自己挑的都看）。还没挑是 null。 */
  private choice: { tier: StageTier; mode: TierMode } | null = null;
  /** 试画过了没有。一座沙盘只试一次。 */
  private trialDone = false;
  /** 试画一帧用了多久（毫秒，几次里居中的一次）；还没试过是 null。 */
  private trialMs: number | null = null;
  /** 最近一次从头滑到尾的滑动里，相邻两帧隔多久（毫秒，居中的数）；还没有是 null。 */
  private glideMs: number | null = null;
  /** 量出来太慢，已经告诉过页面：从此不再画，等页面来关。 */
  private slow = false;

  private readonly viewListeners = new Set<(info: StageViewInfo) => void>();
  private readonly movedListeners = new Set<(moved: boolean) => void>();
  private readonly lostListeners = new Set<() => void>();
  private readonly slowListeners = new Set<() => void>();

  constructor(container: HTMLElement, table: StageTable, options: StageOptions, host: BrowserHost, env: ViewEnv, loadRoute?: RouteLevelLoader) {
    this.container = container;
    this.table = table;
    this.options = options;
    this.host = host;
    this.env = env;
    this.loadRoute = loadRoute ?? (() => Promise.reject(new Error('全程沙盘的程序没有取到，沙盘没能摆出来')));
    this.scene = table.scene;
    this.coords = coordsOf(this.scene);
    this.style = styleFor(this.scene.style);
    this.namesMode = options.namesMode;
    this.insets = options.insets ?? NO_INSETS;

    const headings = this.scene.sections.map((s) => s.heading);
    let first = headings[0] ?? '';
    if (options.section !== undefined) {
      if (headings.includes(options.section)) first = options.section;
      else console.warn(`[沙盘] 场景里没有这个小节：${options.section}，先摆第一节`);
    }
    this.shownSection = first;
    this.stripsFor = first;
    this.levelM = this.scene.water.levels.values.normal;

    this.sequencer = new Sequencer(
      headings,
      first,
      {
        place: (heading) => {
          this.placeFailure = null;
          try {
            this.place(heading);
          } catch (error) {
            this.placeFailure = error;
            throw error;
          }
        },
        glide: (heading, why) => this.planGlide(heading, why),
        settled: () => nextPaint(),
      },
      // 滑到哪了、量每一帧隔多久，看的是同一个钟
      { now: () => this.env.now(), nextFrame: (run) => nextFrame(run) },
      options.reducedMotion,
    );

    this.ready = new Promise<void>((resolve, reject) => {
      this.settleReady = resolve;
      this.failReady = reject;
    });
    // 页面没有接住失败时，不让浏览器再报一次“未处理的错误”
    this.ready.catch(() => {});

    // 重活都在 build 里，而且它一上来先等浏览器画一帧：create 立刻返回，这一轮里什么重活也不做
    void this.build();
  }

  // ---------------------------------------------------------------- 对外的接口

  showSection(section: string, opts?: { animate?: boolean }): Promise<void> {
    // ready 完成之前叫的一律直接摆到位，不滑（第一个画面摆过了、ready 还没完成的那一小会儿也算）：
    // 不然 ready 一完成，页面以为沙盘已经在这一节了，镜头却还要滑两秒
    return this.sequencer.show(section, this.isReady && (opts?.animate ?? true));
  }

  resetView(): Promise<void> {
    return this.sequencer.reset();
  }

  /**
   * 全程沙盘潜到一站上空（规矩见 src/stage/types.ts）。镜头怎么走在全程沙盘那一块程序里（routeLevel.ts 的 diveEnd、divePath）；
   * 先后由 sequencer 管：它顶掉正在滑的那一趟，新的指令、读者的手、画面丢了、关掉都会顶掉它。站点沙盘没有那一块程序，一律答 false。
   */
  dive(stop: string, ms: number): Promise<boolean> {
    const b = this.built;
    const level = this.routeLevel;
    if (!b || !level || !this.isReady || this.slow || this.options.reducedMotion || this.scene.level !== 'route') return Promise.resolve(false);
    const from: TableState = {
      position: [b.camera.position.x, b.camera.position.y, b.camera.position.z],
      target: [b.controls.target.x, b.controls.target.y, b.controls.target.z],
      fov: b.camera.fov,
      levelM: this.levelM,
      flood: this.flood,
      mist: this.mistNow,
    };
    const to = level.diveEnd(this.scene, stop, from, b.samplers, this.coords);
    if (!to) return Promise.resolve(false);
    const path = level.divePath(from, to);
    // 题签一起步就收起来，只留那一站自己的那一条（它告诉读者镜头往哪儿去；这一节没有摆它，就照头一节的摆）。镜头是程序挪的，不算读者动过
    const place = this.scene.places.find((p) => p.stops?.includes(stop));
    const own = this.scene.strips.find((s) => s.of === place?.id)?.id;
    const spec = [this.stripsFor, this.scene.sections[0].heading]
      .flatMap((heading) => sectionStripSpecs(this.scene, heading, stripTexts(this.scene, heading, this.namesMode), this.options.marks))
      .find((s) => s.id === own);
    if (spec) {
      // 那一条现在就摆着：别的拿掉，它留在原处（镜头还没动，名字不该跳一下）；没摆着就换上它
      const kept = !!b.strips.only && !this.stripsHidden && this.shownStrips.some((s) => s.id === own);
      if (kept) b.strips.only?.(spec.id);
      else b.strips.set([spec]);
      this.shownStrips = this.stripsOf([spec.id]);
      this.spotCache = null;
      // 新换上的先挑一次位置；以后（留在原处的从头起）一路留在那个位置上，不重新挑（draw 里看 diving）
      this.stripsFresh = !kept;
    } else {
      b.strips.hide();
    }
    this.stripsHidden = !spec;
    this.setMoved(false);
    this.cancelSettle?.();
    this.cancelSettle = null;
    // 留着的那一条当场摆好（不等下一帧）：别的名字收起来的同一刻，它还在
    this.diving = true;
    if (spec) this.draw();
    // 潜的这一会儿镜头不交给读者的手（托着平板的手掌碰到沙盘、滚轮转了一下，都不该把它打断成一下子跳过去）
    b.controls.enabled = false;
    const done = this.sequencer.free({
      durationMs: ms,
      frame: (k) => {
        const now = this.built;
        if (!now) return;
        this.applyState(path(k), now);
        this.draw();
      },
    });
    void done.then(() => {
      this.diving = false;
      if (this.built && !this.slow) this.built.controls.enabled = true;
    });
    return done;
  }

  setNamesMode(mode: NamesMode): void {
    this.namesMode = mode;
    const b = this.built;
    // 镜头正在滑的时候题签藏着，到了自然会按新的名字摆。嫌慢以后不再画，题签也留着原样（换了字就得重摆）
    if (!b || this.stripsHidden || this.slow) return;
    this.showStrips(this.stripsFor, b);
    this.requestRender();
  }

  setInsets(insets: StageInsets): void {
    const was = this.insets;
    this.insets = insets;
    if (!this.built) return;
    // 四个数都没有变：什么也不用做
    if (was.top === insets.top && was.right === insets.right && was.bottom === insets.bottom && was.left === insets.left) return;
    this.replaceQueued = true;
    this.requestRender();
  }

  onViewChange(listener: (info: StageViewInfo) => void): () => void {
    this.viewListeners.add(listener);
    if (this.lastInfo) listener(this.lastInfo);
    return () => void this.viewListeners.delete(listener);
  }

  onUserMoved(listener: (moved: boolean) => void): () => void {
    this.movedListeners.add(listener);
    return () => void this.movedListeners.delete(listener);
  }

  onLost(listener: () => void): () => void {
    this.lostListeners.add(listener);
    return () => void this.lostListeners.delete(listener);
  }

  /** 只通知一次（见 goSlow）。指定了画质的沙盘从不通知。 */
  onSlow(listener: () => void): () => void {
    this.slowListeners.add(listener);
    return () => void this.slowListeners.delete(listener);
  }

  resize(): void {
    if (!this.built) return;
    // 容器的大小和上一次看到的一样：不重摆，也不画（手机上地址栏一收一放，窗口会报“大小变了”，沙盘栏其实没有变）。
    // 高或宽是 0 也照样记：收起来再展开，大小从 0 变回来，要重摆一次。
    // 屏幕的像素比变了（窗口挪到另一块屏幕上）也算变了：画布要按新的像素比重画
    const now = this.sizeSeen();
    if (now.width === this.seenSize.width && now.height === this.seenSize.height && now.ratio === this.seenSize.ratio) return;
    this.seenSize = now;
    this.replaceQueued = true;
    this.requestRender();
  }

  readout(): StageReadout {
    const b = this.built;
    const lease = this.lease;
    if (!b || !lease) return { triangles: 0, drawCalls: 0 };
    // 上一帧要是顺带重画了影子，数里就多算了一遍投影子的东西：再画一帧不带影子的
    if (this.shadowInLastFrame) this.draw();
    const readout: StageReadout = {
      triangles: b.renderer.info.render.triangles,
      drawCalls: b.renderer.info.render.calls,
      perf: {
        tier: lease.quality.tier,
        pixelRatio: this.sizeNow.ratio || this.pixelRatio(),
        // 和 three 定画布大小时的算法一样（WebGLRenderer.setSize：往下取整）
        buffer: { width: Math.floor(this.sizeNow.width * this.sizeNow.ratio), height: Math.floor(this.sizeNow.height * this.sizeNow.ratio) },
        frames: this.frames,
        trialMs: this.trialMs,
        glideMs: this.glideMs,
      },
    };
    const shot = this.shot(b);
    if (shot) readout.shot = shot;
    return readout;
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.sequencer.destroy();
    this.teardown();
    this.viewListeners.clear();
    this.movedListeners.clear();
    this.lostListeners.clear();
    this.slowListeners.clear();
    // 还没等到第一个画面就关掉了（嫌慢以后一直开着的也在这里了结）：让等着的地方结束，不算失败
    this.settleReady();
  }

  // ---------------------------------------------------------------- 造沙盘

  private keep(dispose: () => void): void {
    this.disposers.push(dispose);
  }

  private async build(): Promise<void> {
    try {
      // 先让浏览器把页面上“正在摆”的那句话画出来（等两帧：第一帧之后页面才真的画过一次）
      await nextPaint();
      await nextPaint();
      if (this.destroyed) return;

      const { scene, style, host } = this;
      if (scene.sections.length === 0) throw new Error('场景里一个小节也没有');

      // 照哪一档画质摆：页面指定了就照指定的，没指定就用这一次访问到现在还撑得住的最高一档。
      const choice = chooseTier(host.tiers, this.options);
      if (!choice) {
        // 已经量出来连减配也带不动、页面又没有指定（页面应当先问 engine.support()，它这时候答 too-slow）：不摆。
        // 缘故是“太慢”，不是摆坏了，所以和量出来太慢一样告诉页面：页面换成图片，不会请读者“再试一次”
        this.goSlow();
        // 之前记下的 showSection 不能一直悬着：让它们照常完成（没有东西可摆，什么也不画）
        void this.sequencer.start();
        return;
      }
      this.choice = choice;
      const lease = host.acquire(this.container, qualityFor(choice.tier));
      this.lease = lease;
      lease.onLost(() => this.handleLost());
      lease.signal.addEventListener('abort', () => {
        // 自己还回去的、画面丢了的，各有各的交代；剩下一种是画布被另一座沙盘借走了
        if (this.lease !== lease || lease.lost) return;
        // 已经摆好了才被借走：这座沙盘从此不画了，和画面丢了一样告诉页面（onLost），不能悄悄地停。
        // 嫌慢以后被借走的也走这一边：页面早就知道它不用了，不再说什么（见 handleLost）
        if (this.isReady || this.slow) this.handleLost();
        else this.fail(new Error('画布让给了另一座沙盘，这一座没有摆出来'));
      });
      const gone = (): boolean => lease.signal.aborted;
      const { renderer, quality } = lease;
      // 画布是上一座沙盘用过的：先按这里的大小清干净，免得还留着上一站的画面
      this.applySize(renderer, null);
      renderer.clear();

      // 地面的颜色：有制作时先画好的图，这里就开始取，和地形文件一起下载。
      // 全程沙盘另有一块程序（用到时才下载，怎么取是交进来的）：也在这里开始取，它一到就去取那两张图
      const table = this.table;
      const starting: Starting =
        table.kind === 'route'
          ? { kind: 'route', table, begun: this.loadRoute().then((level) => ({ level, paint: level.routeGroundPaint(table, lease.signal) })) }
          : { kind: 'stop', table, paint: beginGroundPaint(table, lease.signal) };
      // 那一块程序要是没取到，缘故留到下面等它的时候再说；这里先接住，免得成了没人管的错误
      if (starting.kind === 'route') starting.begun.catch(() => {});
      const response = await fetch(this.table.terrainUrl, { signal: lease.signal });
      if (!response.ok) throw new Error(`地形文件读不出来（${response.status}）`);
      const bytes = await response.arrayBuffer();
      if (gone()) return;

      // 地面往上的几样：站点沙盘和全程沙盘各有各的造法
      const parts = starting.kind === 'route' ? await this.buildRouteParts(starting.table, await starting.begun, bytes, lease) : await this.buildStopParts(starting.table, starting.paint, bytes, lease);
      if (!parts) return;
      const { samplers, terrain, water, mist, stand, models } = parts;
      const first = this.sequencer.section;
      await models.prepare([first]);
      if (gone()) return;

      const world = new Scene();
      const fog = new Fog(style.palette.fog, 40000, 140000);
      // 全程沙盘不起雾（两千公里的沙盘，雾一罩，远处的山就没有了）。雾还是造一份：每一帧照样给它算远近，不另分一次
      world.fog = scene.level === 'route' ? null : fog;
      world.add(terrain.group, water.group, mist.group, models.group, stand.group);

      // 紫檀要一点环境反光；别的材质都是不反光的
      const pmrem = new PMREMGenerator(renderer);
      const room = new RoomEnvironment();
      const environment = pmrem.fromScene(room, 0.04);
      stand.wood.envMap = environment.texture;
      pmrem.dispose();
      room.dispose();
      this.keep(() => environment.dispose());

      // 灯：一盏太阳光（唯一投影的灯），加天光补亮。颜色、方向是样式定的，摆第一节时安上
      const hemi = new HemisphereLight();
      const sun = new DirectionalLight();
      sun.castShadow = true;
      sun.shadow.mapSize.set(quality.shadowMapSize, quality.shadowMapSize);
      // 影子不是每一帧都重画：只在灯、影子罩的那一块或显出来的模型变了的时候画
      sun.shadow.autoUpdate = false;
      world.add(hemi, sun, sun.target);
      this.keep(() => sun.dispose());

      const camera = new PerspectiveCamera(26, 1, 400, 90000);
      const controls = new OrbitControls(camera, lease.canvas);
      controls.enableDamping = false;
      controls.maxPolarAngle = MathUtils.degToRad(MAX_TILT);
      controls.minDistance = this.minDistance();
      controls.maxDistance = MAX_DISTANCE;
      controls.addEventListener('start', this.onControlStart);
      controls.addEventListener('change', this.onControlChange);
      controls.addEventListener('end', this.onControlEnd);
      this.keep(() => controls.dispose());

      const strips = mountStrips(this.container);
      this.keep(() => strips.destroy());

      const built: Built = { renderer, world, camera, controls, sun, hemi, fog, samplers, water, mist, stand, models, strips };
      this.built = built;
      this.applySize(renderer, camera);

      // 摆第一个画面。第一帧要编译着色器、上传贴图、画影子；再画一帧保证是完整的。
      // 第一个画面摆出来以后紧接着试画（见 place 和 runTrial）：量出来太慢的，页面已经得了通知，
      // 这一座到此为止——不再画，ready 不完成也不拒绝，就这么开着等页面来关
      await this.sequencer.start();
      if (gone()) return;
      if (this.placeFailure) throw this.placeFailure;
      if (this.slow) return;
      this.draw();
      await nextPaint();
      if (gone() || this.slow) return;
      this.isReady = true;
      this.settleReady();

      // 别的小节要用的模型，趁浏览器闲着的时候先造好
      const rest = scene.sections.map((s) => s.heading).filter((heading) => heading !== first);
      if (rest.length > 0) {
        whenIdle(() => {
          // 嫌慢、等着被关掉的这一座，不用再备
          if (gone() || this.slow) return;
          models.prepare(rest).catch((error: unknown) => console.warn('[沙盘] 后面几节的模型没有先造好，用到时再造', error));
        });
      }
    } catch (error) {
      // 关掉或者画面丢了引起的中断，已经各自交代过了
      if (this.destroyed || this.lost) return;
      this.fail(error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * 站点沙盘地面往上的几样：读高程，整理和挖河，上色，地形板，水面，云气，座子，小模型。
   * 和接进全程沙盘以前是同样的几步、同样的先后，每一段之间让浏览器喘口气。半路这座沙盘不要了，返回 null。
   */
  private async buildStopParts(table: StopTable, groundPaint: GroundPaintJob, bytes: ArrayBuffer, lease: Lease<HTMLCanvasElement, WebGLRenderer>): Promise<TableParts | null> {
    const { coords, style } = this;
    const scene = table.scene;
    const { renderer, quality } = lease;
    const gone = (): boolean => lease.signal.aborted;
    // 按家分块的零件：场景里写到了哪几家的东西，现在就动手取（造模型以前要到）；一家也没写到的沙盘什么都不取
    const families = familiesOf(scene);
    const kit = families.length ? loadFamilies(families) : undefined;
    // 半路不要了、没有等它的时候，取不到也不算没人管的错
    kit?.catch(() => {});

    // 地面：读高程，整理和挖河，上色。先画好的图对不上、取不到时要现画，那是最慢的一步，前后各让一次
    const dem = readDem(scene.terrain, bytes);
    const ground = buildFields(scene, dem);
    await nextPaint();
    if (gone()) return null;
    const paint = await groundPaint.finish(scene, ground, bytes, style.ground);
    const samplers = groundSamplers(ground);
    await nextPaint();
    if (gone()) return null;

    const terrain = buildTerrainMesh({
      samplers,
      paint,
      nx: ground.nx,
      nz: ground.nz,
      coords,
      style,
      maxAnisotropy: renderer.capabilities.getMaxAnisotropy(),
    });
    this.keep(terrain.dispose);
    const water = buildWater({ ground, coords, scene, style });
    this.keep(water.dispose);
    await nextPaint();
    if (gone()) return null;

    const mist = buildMist({ ground, samplers, coords, scene, style, layers: quality.mistLayers });
    this.keep(mist.dispose);
    const stand = buildTable(coords, style.palette);
    this.keep(stand.dispose);
    await nextPaint();
    if (gone()) return null;

    // 小模型：先造第一个画面要用的，别的等摆出来以后再造
    const loaded = kit && (await kit);
    if (gone()) return null;
    const models = buildModels({ scene, ground, samplers, coords, style, quality, kit: loaded });
    this.keep(() => models.dispose());
    return { samplers, terrain, water, mist, stand, models };
  }

  /**
   * 全程沙盘地面往上的几样。和站点沙盘不一样的：地面是另一种算法，海、湖、河都画在先画好的地面上（不现画，也没有水面），
   * 没有云气，小模型换成路；地形板不取“附近的最低值”，网格的疏密从样式读（减配的一档再粗一点）。
   * level 是用到时才下载的那一块程序，和它一到就开始取的两张图。半路这座沙盘不要了，返回 null。
   */
  private async buildRouteParts(
    table: RouteTable,
    begun: RouteBegun,
    bytes: ArrayBuffer,
    lease: Lease<HTMLCanvasElement, WebGLRenderer>,
  ): Promise<TableParts | null> {
    const { coords, style } = this;
    const scene = table.scene;
    const { renderer, quality } = lease;
    const { level } = begun;
    this.routeLevel = level;
    const gone = (): boolean => lease.signal.aborted;
    const routeStyle = style.route;
    if (!routeStyle) throw new Error(`样式“${scene.style}”还摆不了全程沙盘`);

    const ground = level.buildRouteGround(scene, level.readRouteDem(scene.terrain, bytes), coords);
    await nextPaint();
    if (gone()) return null;
    const paint = await begun.paint.finish(scene, ground, bytes);
    const samplers = level.routeSamplers(ground);
    await nextPaint();
    if (gone()) return null;

    const terrain = buildTerrainMesh({
      samplers,
      paint,
      nx: ground.nx,
      nz: ground.nz,
      coords,
      style,
      maxAnisotropy: renderer.capabilities.getMaxAnisotropy(),
      marks: 'ripples',
      underWater: false,
      segmentM: routeStyle.segmentM * (quality.tier === 'reduced' ? routeStyle.reducedSegmentTimes : 1),
      ripplePx: routeStyle.ripplePx,
    });
    this.keep(terrain.dispose);
    const water = level.routeWater(terrain.uniforms);
    const mist = level.routeMist();
    const stand = buildTable(coords, style.palette);
    this.keep(stand.dispose);
    await nextPaint();
    if (gone()) return null;

    const models = level.buildRouteModels({ scene, coords, samplers, style: routeStyle, tier: quality.tier });
    this.keep(() => models.dispose());
    return { samplers, terrain, water, mist, stand, models };
  }

  /** 读者最近能凑到多近：站点沙盘 900，全程沙盘 12000。 */
  private minDistance(): number {
    return this.scene.level === 'route' ? ROUTE_MIN_DISTANCE : MIN_DISTANCE;
  }

  /** 沙盘上的 1 米是地上的多少米：站点沙盘是 1，全程沙盘是场景里写的比例。比例尺、“一米多少像素”都按地上的米说。 */
  private realPerTable(): number {
    return this.scene.level === 'route' ? this.scene.frame.scale : 1;
  }

  /** 沙盘没能摆出来（或者摆出来以后画布被借走了）：把造了一半的放掉，ready 拒绝。 */
  private fail(error: Error): void {
    this.teardown();
    this.failReady(error);
    // 之前记下的 showSection 不能一直悬着：让它们照常完成。这以后的指令什么也不做，也照常完成
    void this.sequencer.start();
  }

  /** 把这座沙盘造的东西都放掉，画布还给主人。 */
  private teardown(): void {
    this.cancelRender?.();
    this.cancelRender = null;
    this.cancelSettle?.();
    this.cancelSettle = null;
    const b = this.built;
    this.built = null;
    for (const dispose of this.disposers.splice(0).reverse()) {
      try {
        dispose();
      } catch (error) {
        console.warn('[沙盘] 有一样东西没能放掉', error);
      }
    }
    b?.renderer.renderLists.dispose();
    const lease = this.lease;
    this.lease = null;
    lease?.release();
  }

  /** 三维画面丢了，或者摆好以后画布被另一座沙盘借走了：这座沙盘不再画。 */
  private handleLost(): void {
    if (this.destroyed || this.lost) return;
    this.lost = true;
    this.sequencer.interrupt();
    const wasReady = this.isReady;
    this.teardown();
    // 已经告诉过页面“太慢”的那一座：页面正等着关它，不再另外通知；没完成的 ready 也照旧开着
    if (this.slow) return;
    if (wasReady) {
      for (const listener of [...this.lostListeners]) listener();
    } else {
      this.failReady(new Error('三维画面丢了，沙盘没能摆出来'));
      // 之前记下的 showSection 不能一直悬着：让它们照常完成
      void this.sequencer.start();
    }
  }

  // ---------------------------------------------------------------- 一小节的样子

  private size(): { width: number; height: number } {
    return { width: this.container.clientWidth, height: this.container.clientHeight };
  }

  /** 画布用的像素比：照借到手的那一档画质、屏幕的像素比和沙盘栏的大小定（quality.ts 的 pixelRatioFor）。 */
  private pixelRatio(): number {
    const lease = this.lease;
    if (!lease) return 1;
    const { width, height } = this.size();
    return pixelRatioFor(lease.quality, window.devicePixelRatio || 1, width, height);
  }

  /** 容器现在多大、画布该用多少像素比（用来看要不要重摆、重画）。 */
  private sizeSeen(): { width: number; height: number; ratio: number } {
    return { ...this.size(), ratio: this.pixelRatio() };
  }

  private sectionOf(heading: string): SceneSection | RouteSection {
    const sections: (SceneSection | RouteSection)[] = this.scene.sections;
    const section = sections.find((s) => s.heading === heading);
    if (!section) throw new RangeError(`场景里没有这个小节：${heading}`);
    return section;
  }

  /** 这一小节在现在这么大的画面上摆好是什么样。 */
  private lookFor(heading: string, b: Built): Look {
    const { scene, coords, style } = this;
    const section = this.sectionOf(heading);

    // 镜头：画面窄了要退远；看整块沙盘的一节，对准的那一点再挪一挪，让沙盘在留出来的那一块里居中
    const placed = placeCamera(section, scene, b.samplers, coords, style, this.size(), this.insets);
    const { pose, distanceM } = placed;

    // 水位，和水的颜色偏向大水多少：（这一节的水位 − 平时）÷（最高的水位 − 平时）。全程沙盘的小节不写水位，总是平时（海面）
    const levels = scene.water.levels.values;
    const normal = levels.normal;
    const top = Math.max(...Object.values(levels));
    const levelM = 'water' in section ? (levels[section.water] ?? normal) : normal;
    const flood = top > normal ? MathUtils.clamp((levelM - normal) / (top - normal), 0, 1) : 0;

    return {
      heading,
      section,
      distanceM,
      fit: placed.fit,
      reach: placed.reach,
      // 云气：样式照镜头的远近定浓淡；这一节自己写了几成的（记载里那一天没有雾：0）再乘上
      state: { position: pose.position, target: pose.target, fov: pose.fov, levelM, flood, mist: style.mistFor(distanceM) * (('mist' in section ? section.mist : undefined) ?? 1) },
      // 一种样式白天只有一盏灯，夜里一套、方向跟着这一节写的月亮：只看天色，不看镜头朝哪边、离多远
      light: style.light(('sky' in section ? section.sky : undefined) ?? 'day', 'moon' in section ? section.moon : undefined),
      shadow: shadowBox([pose.target[0], pose.target[2]], distanceM, coords),
    };
  }

  /**
   * 把影子罩到这一节要看的那一块；灯是样式定的一盏，只有天色变了才换。
   * 灯和那一块都和上一次一样就不动，影子也不用重画。
   */
  private applyLight(look: Look, b: Built): void {
    const lightKey = JSON.stringify(look.light);
    const boxKey = JSON.stringify(look.shadow);
    if (lightKey === this.lightKey && boxKey === this.boxKey) return;
    const { sun, hemi } = b;
    if (lightKey !== this.lightKey) {
      const L = look.light;
      sun.color.set(L.sunColor);
      sun.intensity = L.sun;
      hemi.color.set(L.sky);
      hemi.groundColor.set(L.ground);
      hemi.intensity = L.hemi;
      this.sunDir.set(...L.dir).normalize();
      // 不受灯照的几样跟着灯走：远处的雾、山脚的云气、座子木头上的反光按光的强弱压暗（白天是 1，一点不动）；
      // 夜里云气淡一些；月光直接照到的水面亮一些
      const dim = lightDim(L, this.style.light('day'));
      const palette = this.style.palette;
      b.fog.color.set(L.fog ?? palette.fog).multiplyScalar(dim);
      b.mist.setColor(L.mist ?? palette.mist, dim);
      this.mistTimes = L.mistStrength ?? 1;
      b.water.setSheen(L.sheen ?? 0);
      b.stand.setDim(dim);
    }
    this.lightKey = lightKey;
    this.boxKey = boxKey;

    const centre = new Vector3(look.shadow.centre[0], 0, look.shadow.centre[1]);
    sun.target.position.copy(centre);
    sun.position.copy(centre).addScaledVector(this.sunDir, SUN_DISTANCE);
    const half = look.shadow.half;
    const cam = sun.shadow.camera;
    cam.left = -half;
    cam.right = half;
    cam.top = half;
    cam.bottom = -half;
    cam.near = SHADOW_NEAR;
    cam.far = SHADOW_FAR;
    cam.updateProjectionMatrix();
    // 影子的虚实和偏移跟着罩多大一块走：贴近了看罩得小，影子边虚一点、偏移小一点
    const tuning = shadowTuning(half);
    const texel = (2 * half) / sun.shadow.mapSize.width;
    sun.shadow.radius = tuning.radius;
    sun.shadow.bias = tuning.bias;
    sun.shadow.normalBias = texel * tuning.normalBias;
    sun.shadow.needsUpdate = true;
  }

  /** 把镜头、水位、水色、云气摆成 state 说的样子（不画）。 */
  private applyState(state: TableState, b: Built): void {
    b.camera.position.set(...state.position);
    b.controls.target.set(...state.target);
    b.camera.fov = state.fov;
    b.camera.lookAt(b.controls.target);
    this.levelM = state.levelM;
    this.flood = state.flood;
    this.mistNow = state.mist;
    b.water.setLevel(state.levelM);
    b.water.setFlood(state.flood);
    b.mist.setFlood(state.flood);
    b.mist.setStrength(state.mist * this.mistTimes);
  }

  /** 场景里的这几条题签，按 ids 的先后；重复的、找不到的不算（和 stripTexts 一样）。 */
  private stripsOf(ids: string[]): SceneStrip[] {
    const out: SceneStrip[] = [];
    for (const id of ids) {
      const strip = this.scene.strips.find((s) => s.id === id);
      if (strip && !out.includes(strip)) out.push(strip);
    }
    return out;
  }

  /** 换一批题签：这一小节的，按现在的古今名字。 */
  private showStrips(heading: string, b: Built): void {
    // 全程沙盘上是站的地名带着站号的印（options.marks 里有的那几站）
    const specs = sectionStripSpecs(this.scene, heading, stripTexts(this.scene, heading, this.namesMode), this.options.marks);
    this.stripsFor = heading;
    this.shownStrips = this.stripsOf(specs.map((s) => s.id));
    this.spotCache = null;
    b.strips.set(specs);
    this.stripsHidden = false;
    this.stripsFresh = true;
  }

  /**
   * 现在摆着的题签各指着沙盘里的哪一点。模型跟着折算过的远近 D 放大，这些点也跟着抬高、跟着挪，所以按 D 记；
   * 记到整米：镜头只是转的时候 D 不变（只差在小数点后面很多位），不用每一帧重算。
   */
  private spots(D: number, b: Built): StripSpot[] {
    const key = `${this.stripsFor}|${Math.round(D)}`;
    if (this.spotCache?.key !== key) {
      this.spotCache = { key, spots: stripSpots(this.shownStrips, this.scene, b.samplers, this.coords, this.style, D) };
    }
    return this.spotCache.spots;
  }

  /** 这一帧折算过的远近：镜头离对准的那一点多远、视角多少、画面多高，折成“在 900 像素高、视角 21 度的画面上要离多远”。 */
  private viewDistance(b: Built): number {
    return equivalentDistance(b.camera.position.distanceTo(b.controls.target), b.camera.fov, this.size().height);
  }

  /** 给拍定格图的工具：现在这个画面的底细。第一个画面摆出来之前没有。 */
  private shot(b: Built): StageShot | undefined {
    const look = this.look;
    if (!look) return undefined;
    const { camera, controls } = b;
    const size = this.size();
    camera.updateMatrixWorld();
    const target: Vec3 = [controls.target.x, controls.target.y, controls.target.z];
    const spots = stripSpots(this.stripsOf(look.section.strips), this.scene, b.samplers, this.coords, this.style, this.viewDistance(b));
    return {
      section: look.heading,
      size,
      insets: { ...this.insets },
      // 镜头现在真的在哪。fit 和 reach 说的是这一节在这么大的画面上摆好时的数：读者动过镜头以后，这两个数不跟着变
      pose: { target, position: [camera.position.x, camera.position.y, camera.position.z], fov: camera.fov },
      fit: look.fit,
      reach: [look.reach[0], look.reach[1]],
      // 记的是“地上的一米多少像素”：全程沙盘上除以它的比例
      pxPerMetre: pixelsPerMetre(camera, target, size.height) / this.realPerTable(),
      northDeg: northDeg(camera),
      anchors: projectSpots(spots, this.coords, camera, size),
    };
  }

  // ---------------------------------------------------------------- 换小节（由 sequencer 调用）

  /** 直接摆成这一小节的样子，并画出来。画出来的要是这座沙盘头一个够格的画面，紧接着试画。 */
  private place(heading: string): void {
    const b = this.built;
    // 嫌慢以后不再摆、不再画；指令照常了结
    if (!b || this.slow) return;
    this.seenSize = this.sizeSeen();
    const look = this.lookFor(heading, b);
    this.look = look;
    this.shownSection = heading;
    this.applyLight(look, b);
    // 水纹朝哪边、平常多密照这一节的镜头定；写了 calmUnderPx 的沙盘上“留几成”每一帧另算（drawFrame）
    this.rippleOf = look;
    const ripple = rippleFor(look.section.camera.bearing, look.distanceM);
    b.water.setRipple(ripple.dense, ripple.turnDeg);
    this.applyState(look.state, b);

    b.controls.minDistance = this.minDistance();
    b.controls.maxDistance = MAX_DISTANCE;
    b.controls.maxPolarAngle = MathUtils.degToRad(MAX_TILT);
    this.widenControls(look, b);
    this.byProgram = true;
    b.controls.update();
    this.byProgram = false;

    // 题签摆不出来（场景文件有毛病）不该连沙盘也画不出来
    try {
      this.showStrips(heading, b);
    } catch (error) {
      console.warn('[沙盘] 这一小节的题签没能摆出来', error);
    }
    this.setMoved(false);
    // 镜头是直接摆到位的（或者刚滑到）：模型的大小要是和上一次画影子时不一样了，这一帧就把影子补上，不用再等
    this.cancelSettle?.();
    this.cancelSettle = null;
    this.shadowCatchUp = true;
    // 刚画的这一帧是完整的（着色器、贴图、影子都齐了）：还没试画过的话，就着它试
    if (this.draw()) this.runTrial(b);
  }

  /**
   * 试画：一座沙盘只试一次，在头一个“页面在前台、沙盘栏也够大”的摆好的画面之后。
   * 页面在后台、沙盘栏收着（一窄条说明不了真的画面，多宽都一样：见 tier.ts 的 bigEnoughToTry）的时候先不试，留到下一次摆好。
   * 同一个画面再画几帧，每一帧都等显卡真的画完才看钟，取居中的一次，报给这一次访问的记性；它答“降”，这座沙盘就不用了。
   * 指定了画质的也量、也报（读数里要有），记性对它一律答“留着”。
   */
  private runTrial(b: Built): void {
    const lease = this.lease;
    const choice = this.choice;
    if (this.trialDone || this.slow || !lease || !choice) return;
    const { width, height } = this.size();
    if (!this.env.pageVisible() || !bigEnoughToTry(width, height)) return;
    this.trialDone = true;
    // 先等刚才那一帧画完，不算在里面：它带着编译着色器、上传贴图、画影子，平常的一帧没有这些
    lease.finish();
    const times: number[] = [];
    for (let i = 0; i < TRIAL_FRAMES; i++) {
      const from = this.env.now();
      b.renderer.render(b.world, b.camera);
      lease.finish();
      times.push(this.env.now() - from);
      this.frames += 1;
    }
    // 试画的几帧都不带影子：读数不用为了“去掉影子那一遍”再画一帧
    this.shadowInLastFrame = false;
    const ms = middle(times);
    this.trialMs = ms;
    if (this.host.tiers.reportTrial(choice.tier, ms, choice.mode) === 'down') this.goSlow();
  }

  /**
   * 这座沙盘在这台设备上太慢（记性答了“降”），或者这台设备已经量出来带不动、这一座根本没有摆：
   * 从此不再画，读者的手也不再接，通知页面，只通知一次。画面留在原处，等页面来关（它会先把图片或低一档的沙盘备好）。
   * 第一个画面摆好之前就到了这一步的，ready 不完成也不拒绝（见 build）。
   * 指定了画质的沙盘从不通知：自动测试和拍图片的工具靠这一条不受机器快慢的影响。
   */
  private goSlow(): void {
    if (this.slow || this.destroyed || this.lost || this.choice?.mode === 'forced') return;
    this.slow = true;
    this.cancelRender?.();
    this.cancelRender = null;
    this.cancelSettle?.();
    this.cancelSettle = null;
    if (this.built) this.built.controls.enabled = false;
    for (const listener of [...this.slowListeners]) listener();
  }

  /**
   * 读者拖动镜头的范围至少要容得下这一节的镜头：画面窄了镜头会退到范围外面，
   * 不放宽的话，读者一碰，控制器就把镜头拉回它的范围里。
   */
  private widenControls(look: Look, b: Built): void {
    b.controls.minDistance = Math.min(b.controls.minDistance, look.distanceM * 0.7);
    b.controls.maxDistance = Math.max(b.controls.maxDistance, look.distanceM * 1.5);
    b.controls.maxPolarAngle = Math.max(b.controls.maxPolarAngle, MathUtils.degToRad(look.section.camera.pitch));
  }

  /** 准备滑到这一小节。 */
  private planGlide(heading: string, why: 'section' | 'reset'): Glide | null {
    const b = this.built;
    // 嫌慢以后不再滑（也不再画）：指令直接了结
    if (!b || this.slow) return null;
    const to = this.lookFor(heading, b);
    const from: TableState = {
      position: [b.camera.position.x, b.camera.position.y, b.camera.position.z],
      target: [b.controls.target.x, b.controls.target.y, b.controls.target.z],
      fov: b.camera.fov,
      levelM: this.levelM,
      flood: this.flood,
      mist: this.mistNow,
    };
    // 镜头本来就在摆好的位置上：不用滑
    if (why === 'reset' && distance3(from.position, to.state.position) < 1 && distance3(from.target, to.state.target) < 1) return null;

    // 题签在滑的时候藏起来，到了再摆
    b.strips.hide();
    this.stripsHidden = true;
    this.setMoved(false);
    // 影子罩的那一块一起步就换
    this.applyLight(to, b);
    this.widenControls(to, b);
    // 新一节的东西也一起步就换上，往近处去、往远处退都一样：模型只有一套，大小每一帧跟着镜头变，没有“到了才换”的另一套
    this.shownSection = heading;
    this.look = to;
    this.cancelSettle?.();
    this.cancelSettle = null;

    // 这一趟滑动里每一帧隔多久，一趟一份。半路被打断的（读者接过去、来了新的指令、关掉）到不了最后一帧，这一份就丢开不报
    const meter = createGlideMeter();
    return {
      durationMs: why === 'reset' ? RESET_MS : GLIDE_MS,
      frame: (e) => {
        // 先看钟再干活：量的是一帧到下一帧隔多久
        meter.frame(this.env.now(), this.env.pageVisible());
        const now = this.built;
        if (!now) return;
        this.applyState(mixState(from, to.state, e), now);
        this.draw();
        // 滑到头了：这一趟从头滑到了尾
        if (e >= 1) this.endGlide(meter);
      },
    };
  }

  /**
   * 一趟滑动从头滑到了尾：把相邻两帧间隔的居中数报给这一次访问的记性；它答“降”，这座沙盘就不用了。
   * 量到的太少、中间页面去过后台的，这一趟不作数（meter 给 null），不报，读数也留着上一趟的。
   */
  private endGlide(meter: GlideMeter): void {
    const choice = this.choice;
    const median = meter.end(true);
    if (median === null || !choice || this.slow) return;
    this.glideMs = median;
    if (this.host.tiers.reportGlide(choice.tier, median, choice.mode) === 'down') this.goSlow();
  }

  // ---------------------------------------------------------------- 读者动镜头

  private readonly onControlStart = (): void => {
    this.handDown = true;
    // 又动起来了：影子等停下来以后再看
    this.cancelSettle?.();
    this.cancelSettle = null;
    if (!this.sequencer.interrupt()) return;
    // 滑到半路被读者接过去：镜头留在原处，别的都换成新一节的样子
    const b = this.built;
    if (b) {
      const look = this.lookFor(this.sequencer.section, b);
      this.look = look;
      this.shownSection = look.heading;
      const position: Vec3 = [b.camera.position.x, b.camera.position.y, b.camera.position.z];
      const target: Vec3 = [b.controls.target.x, b.controls.target.y, b.controls.target.z];
      this.applyState({ ...look.state, position, target, fov: b.camera.fov }, b);
      this.showStrips(look.heading, b);
    }
    this.setMoved(true);
    this.requestRender();
  };

  private readonly onControlChange = (): void => {
    if (this.byProgram) return;
    this.setMoved(true);
    this.requestRender();
  };

  private readonly onControlEnd = (): void => {
    // 控制器在“没有开始过”的时候也会说“结束”（比如松开一个它不管的键）
    if (!this.handDown) return;
    this.handDown = false;
    // 手按着的时候题签只是留在原来的位置上：放开以后整个重摆一次
    if (this.heldStrips) {
      this.heldStrips = false;
      this.requestRender();
    }
    // 镜头停了：过一会儿看一眼模型的大小是不是变了，变了补画一次影子
    this.settleShadowSoon();
  };

  private setMoved(moved: boolean): void {
    if (this.moved === moved) return;
    this.moved = moved;
    for (const listener of [...this.movedListeners]) listener(moved);
  }

  // ---------------------------------------------------------------- 影子跟不跟得上模型的大小

  /** 镜头是不是正在动：程序在滑，或者读者的手按着。 */
  private cameraMoving(): boolean {
    return this.handDown || this.sequencer.gliding;
  }

  /** 折算过的远近是 D 时，模型的大小和上一次画影子时比，是不是差得值得补画了。 */
  private shadowStale(D: number): boolean {
    return !(this.shadowD > 0) || Math.abs(Math.log(D / this.shadowD)) > SHADOW_STALE_LN;
  }

  /** 约好过一会儿看一眼：那时候镜头不动了、模型的大小又和影子对不上，就补画一次。重复约只算最后一次。 */
  private settleShadowSoon(): void {
    this.cancelSettle?.();
    const id = setTimeout(() => {
      this.cancelSettle = null;
      const b = this.built;
      // 又动起来了的话，等它再停下来（那时候会再约）
      if (!b || this.cameraMoving() || !this.shadowStale(this.viewDistance(b))) return;
      this.shadowCatchUp = true;
      this.requestRender();
    }, SHADOW_SETTLE_MS);
    this.cancelSettle = () => clearTimeout(id);
  }

  // ---------------------------------------------------------------- 画

  /** 画布和镜头按容器现在的大小来。camera 是 null 时只管画布。 */
  private applySize(renderer: WebGLRenderer, camera: PerspectiveCamera | null): void {
    const { width, height } = this.size();
    if (!width || !height) return;
    const ratio = this.pixelRatio();
    renderer.setPixelRatio(ratio);
    renderer.setSize(width, height, false);
    if (camera) camera.aspect = width / height;
    this.sizeNow = { width, height, ratio };
  }

  /** 约好下一帧画一次。一帧里叫多少次都只画一次。嫌慢以后不再约。 */
  private requestRender(): void {
    if (this.cancelRender || !this.built || this.slow) return;
    this.cancelRender = nextFrame(() => {
      this.cancelRender = null;
      // 容器大小或四边留的空变了：镜头还在摆好的位置上就重新摆（退多远跟画面的宽窄有关）；读者动过就不动它
      if (this.replaceQueued) {
        this.replaceQueued = false;
        if (!this.moved && this.sequencer.started && !this.sequencer.gliding) {
          this.place(this.sequencer.section);
          return;
        }
      }
      this.draw();
    });
  }

  /** 画一帧，然后摆题签、通知指北和比例尺。返回这一次是不是真的画了（没造好、嫌慢以后、容器收着、正画到一半都不画）。 */
  private draw(): boolean {
    const b = this.built;
    if (!b || this.slow) return false;
    if (this.drawing) {
      this.requestRender();
      return false;
    }
    const size = this.size();
    if (!size.width || !size.height) return false;
    this.drawing = true;
    try {
      this.drawFrame(b, size);
    } finally {
      this.drawing = false;
    }
    return true;
  }

  private drawFrame(b: Built, size: { width: number; height: number }): void {
    const { renderer, camera, controls, sun, fog, models } = b;
    if (size.width !== this.sizeNow.width || size.height !== this.sizeNow.height || this.pixelRatio() !== this.sizeNow.ratio) this.applySize(renderer, camera);
    // 水纹照页面上的像素算：把画布这一帧真用的像素比（applySize 刚定的）告诉水面；挪到另一块屏幕上，下一帧就跟上
    b.water.setPixelRatio(this.sizeNow.ratio);

    const distance = camera.position.distanceTo(controls.target);
    camera.near = Math.max(60, distance * 0.1);
    camera.far = distance * 3 + 30000;
    // 四边留了空（上面有按钮，下面有题记）：把画面的中心挪到留出来的那一块中间
    const [shiftX, shiftY] = centreShift(this.insets);
    if (shiftX || shiftY) camera.setViewOffset(size.width, size.height, -shiftX, -shiftY, size.width, size.height);
    else camera.clearViewOffset();
    camera.updateProjectionMatrix();

    const [fogNear, fogFar] = this.style.fogFor(distance);
    fog.near = fogNear;
    fog.far = fogFar;

    // 写了 calmUnderPx 的沙盘：水纹留几成照这一帧真的镜头算——摆好的、滑到半路的、读者自己推近拉远的都是这一条。
    // 一道也不剩的那一帧，朝向和疏密换成要去的那一节的（这时候换，看不见）。
    // 每一帧都走：最宽的河只算一次，两个数各算各的，不另造数组和东西
    const water = this.scene.water;
    const from = this.rippleOf;
    if (from && 'dry' in water && water.calmUnderPx) {
      const share = rippleShare(water, distance, camera.fov, (this.widestM ??= widestRiverM(water)));
      const of = share || !this.look ? from : (this.rippleOf = this.look);
      b.water.setRipple(rippleDense(of.distanceM, share), rippleTurn(of.section.camera.bearing));
    }

    // 模型的大小、题签指着的点，都按这一帧真的远近来（不是按要去的那一节，也不是按起步的时候）。
    // 照远近换着显的东西（浮桥的几套）：读者动过镜头（moved）才在界线上下留着上一帧的那一套；程序摆的画面——摆好的一节、
    // 滑动的一路上——只照远近挑，所以同一个摆好的画面不管是从哪一节滑过来的、还是直接摆的，都是同一套
    const D = equivalentDistance(distance, camera.fov, size.height);
    if (models.apply(this.shownSection, this.levelM, D, this.moved)) sun.shadow.needsUpdate = true;
    // 显出来的东西没变、只是大小变了：镜头还在动就先不重画影子（一路上每一帧都重画太慢），
    // 直接摆到位的这一帧当场补，别的等镜头停下来一小会儿以后补一次
    if (!sun.shadow.needsUpdate && this.shadowStale(D)) {
      if (this.shadowCatchUp) sun.shadow.needsUpdate = true;
      else if (!this.cameraMoving() && !this.cancelSettle) this.settleShadowSoon();
    }
    this.shadowCatchUp = false;
    if (sun.shadow.needsUpdate) this.shadowD = D;
    this.shadowInLastFrame = sun.shadow.needsUpdate;
    renderer.render(b.world, camera);
    this.frames += 1;

    if (!this.stripsHidden) {
      const anchors = projectSpots(this.spots(D, b), this.coords, camera, size);
      // 读者的手还按着：题签留在原来的位置上，不重新挑（转一下换十几次位置，看上去是在闪）。刚换的一批还没摆过，照常摆
      // 潜到一站上空的路上也一样：留着的那一条不换位置
      if ((this.handDown || this.diving) && !this.stripsFresh) {
        b.strips.place(anchors, size, this.insets, { moving: true });
        if (this.handDown) this.heldStrips = true;
      } else {
        b.strips.place(anchors, size, this.insets);
      }
      this.stripsFresh = false;
    }

    const target: Vec3 = [controls.target.x, controls.target.y, controls.target.z];
    const info: StageViewInfo = { northDeg: northDeg(camera), scale: chooseScale(pixelsPerMetre(camera, target, size.height) / this.realPerTable()) };
    const last = this.lastInfo;
    if (!last || Math.abs(last.northDeg - info.northDeg) > 0.05 || last.scale.px !== info.scale.px || last.scale.label !== info.scale.label) {
      this.lastInfo = info;
      for (const listener of [...this.viewListeners]) listener(info);
    }
  }
}

function distance3(a: Vec3, b: Vec3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}
