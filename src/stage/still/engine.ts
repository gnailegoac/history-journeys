// 定格图的沙盘：每一小节一张先拍好的图片（npm run stills 做的），上面摆的是和立体沙盘同一层题签
// （页面上的字，照清单里记下的位置摆，所以古名、今名照样能换，题签照样互相避让）。
// 它是另一个 StageEngine：页面在立体的沙盘还没摆好、画不了、太慢或者画面断了的时候用它。
//
// 几条规矩：
//   这个文件夹不碰 three，也不从 src/stage/three/、src/stage/ground/ 里取东西（tests/unit/still-boundary.test.ts 守着）。
//   图片摆多大、摆在哪，照立体沙盘摆镜头的办法算（./fit.ts），立体的沙盘接手时画面才不跳。
//   这里不印给读者看的话：图旁边的字、取不到图时说什么，都是页面的事。取不到图只通过 ready 拒绝或 onLost 告诉页面。
//   容器里只添两样：div.still-table（两张叠着的图片，换小节时一张淡入；图片铺不到的边上盖一条淡出的过渡）和题签那一层。
//   样子在 src/styles/still.css。div.still-table 上写着现在摆的是什么，给自动测试看：
//   data-still-section 哪一小节，data-still-shape 宽的还是窄的（wide、narrow），data-still-insets 照四边各留多少摆的。

import type { NamesMode, TableScene } from '../../domain/scene';
import { stripTexts } from '../../domain/sceneText';
import type { StillManifest, StillShape, StillShot } from '../../domain/stills';
import { mountStrips, sectionStripSpecs } from '../overlay';
import type { StripLayer, StripSpec } from '../overlay/types';
import { chooseScale } from '../scale';
import type { StageEngine, StageInsets, StageOptions, StageReadout, StageTable, StageViewInfo, StopStageView } from '../types';
import { anchorsOnPane, edgeFades, fitStill, pickShape, type StillFit, type StillPane } from './fit';
import '../../styles/still.css';

/** 换小节时新的一张淡入多久（毫秒）。和 still.css 里 .is-arriving 的时长是同一个数。 */
export const FADE_MS = 250;
/** 一张图取不到，隔这么久（毫秒）再试一次；还取不到就算取不到。 */
export const RETRY_AFTER_MS = 400;

const NO_INSETS: StageInsets = { top: 0, right: 0, bottom: 0, left: 0 };
const SIDES = ['left', 'right', 'top', 'bottom'] as const;
/** 过渡那一条朝哪边淡出（从底色到透明）。 */
const FADE_TOWARDS: Record<(typeof SIDES)[number], string> = { left: 'to right', right: 'to left', top: 'to bottom', bottom: 'to top' };

/** 定格图要靠浏览器做的两件事。测试里换成假的。 */
export interface StillParts {
  /** 把 url 这张图取来、解码好，放进 img。取不到时拒绝。 */
  loadImage(img: HTMLImageElement, url: string): Promise<void>;
  /** 等这么多毫秒。 */
  wait(ms: number): Promise<void>;
}

/** 浏览器里的做法。 */
export const browserStillParts: StillParts = {
  loadImage(img, url) {
    // 这张图片元素里放着的已经是这一张（读者翻回前一节）：不用再取。再写一遍同样的网址，有的浏览器不再报“取到了”，会一直等下去
    if (img.getAttribute('src') === url && img.complete && img.naturalWidth > 0) return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      const done = (): void => {
        img.removeEventListener('load', loaded);
        img.removeEventListener('error', failed);
      };
      const loaded = (): void => {
        done();
        resolve();
      };
      const failed = (): void => {
        done();
        reject(new Error(`图片取不到：${url}`));
      };
      img.addEventListener('load', loaded);
      img.addEventListener('error', failed);
      img.src = url;
    }).then(() => {
      // 取到了再等它解码好，换上去的那一下才不会闪。解码这一步出的错不算取不到（图已经在了）
      if (typeof img.decode !== 'function') return undefined;
      return img.decode().catch(() => undefined);
    });
  },
  wait: (ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
};

/** 做一个定格图的 StageEngine。parts 不写就用浏览器里的做法。 */
export function createStillEngine(parts: StillParts = browserStillParts): StageEngine {
  return {
    name: 'still',
    version: '1',
    support: () => ({ ok: true }),
    create: (container, table, options) => (table.stills ? new StillStopView(container, table, table.stills, options, parts) : emptyView()),
  };
}

/** 这座沙盘没有定格图：什么也不摆，ready 拒绝，页面照“没有定格图”处理。 */
function emptyView(): StopStageView {
  const ready = Promise.reject(new Error('这座沙盘没有定格图'));
  // 页面没有接住失败时，不让浏览器再报一次“未处理的错误”
  ready.catch(() => {});
  let destroyed = false;
  const call = (): Promise<void> => (destroyed ? Promise.reject(new Error('定格图已经关掉')) : Promise.resolve());
  return {
    ready,
    showSection: call,
    resetView: call,
    setNamesMode: () => {},
    setInsets: () => {},
    onViewChange: () => () => {},
    onUserMoved: () => () => {},
    onLost: () => () => {},
    onSlow: () => () => {},
    resize: () => {},
    readout: () => ({ triangles: 0, drawCalls: 0 }),
    destroy: () => {
      destroyed = true;
    },
  };
}

const px = (value: number): string => `${Math.round(value * 100) / 100}px`;

/** '#rrggbb' 换成 [红, 绿, 蓝]；不是这个写法时是 null。 */
function rgbOf(colour: string): [number, number, number] | null {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(colour);
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : null;
}

class StillStopView implements StopStageView {
  readonly ready: Promise<void>;

  private readonly container: HTMLElement;
  private readonly scene: TableScene;
  private readonly manifest: StillManifest;
  private readonly urls: Record<string, string>;
  private readonly parts: StillParts;
  private readonly headings: string[];
  private readonly reducedMotion: boolean;
  private namesMode: NamesMode;
  private insets: StageInsets;
  /** 全程沙盘上每一站的印（页面交进来的）；站点沙盘用不着。 */
  private readonly marks: StageOptions['marks'];

  private readonly wrapper: HTMLDivElement;
  /** 两张叠着的图片：一张摆着现在的，另一张用来取下一张。 */
  private readonly imgs: [HTMLImageElement, HTMLImageElement];
  private readonly fades: Record<(typeof SIDES)[number], HTMLDivElement>;
  private readonly strips: StripLayer;
  /** 先取好的后一节的图片：留着它，浏览器才不会把取到一半的丢掉。 */
  private readonly spares = new Map<string, HTMLImageElement>();

  /** imgs 里哪一张在上面（摆着现在的图）。 */
  private top: 0 | 1 = 0;
  /** 现在摆着的图：哪一小节的、清单里的哪一项。还没有图时是 null。 */
  private shown: { heading: string; shot: StillShot } | null = null;
  private fit: StillFit | null = null;
  /** 页面说的排法（--stage-shape）；没说是 null。 */
  private hint: StillShape | null;
  /** 最近一次要去的小节，和那一次挑的是宽的还是窄的。 */
  private wanted: string;
  private wantedShape: StillShape | null = null;
  /** 第几次指令。取图、淡入等完回来，数变了就是被新的顶掉了（或者已经关掉）。 */
  private runs = 0;
  /** 正在路上的那一次 showSection：被顶掉、取不到、关掉时，用它让那一次照常完成。 */
  private settlePending: (() => void) | null = null;
  private fading = false;
  /** 题签摆出来了没有（淡入的时候藏着）。 */
  private stripsUp = false;
  private readySettled = false;
  /** 不再做事了：第一张图就没取到（ready 拒绝了），或者后来有一张取不到（已经通知 onLost）。 */
  private stopped = false;
  private destroyed = false;
  private settleReady: () => void = () => {};
  private failReady: (error: Error) => void = () => {};
  /** 上一次 resize() 时容器多大。一样就不用重摆。 */
  private seenSize = { width: -1, height: -1 };
  private lastInfo: StageViewInfo | null = null;

  private readonly viewListeners = new Set<(info: StageViewInfo) => void>();
  private readonly lostListeners = new Set<() => void>();

  constructor(container: HTMLElement, table: StageTable, stills: NonNullable<StageTable['stills']>, options: StageOptions, parts: StillParts) {
    this.container = container;
    this.scene = table.scene;
    this.manifest = stills.manifest;
    this.urls = stills.urls;
    this.parts = parts;
    this.headings = table.scene.sections.map((s) => s.heading);
    this.reducedMotion = options.reducedMotion;
    this.namesMode = options.namesMode;
    this.insets = options.insets ?? NO_INSETS;
    this.marks = options.marks;

    let first = this.headings[0] ?? '';
    if (options.section !== undefined) {
      if (this.headings.includes(options.section)) first = options.section;
      else console.warn(`[定格图] 场景里没有这个小节：${options.section}，先摆第一节`);
    }
    this.wanted = first;

    this.ready = new Promise<void>((resolve, reject) => {
      this.settleReady = resolve;
      this.failReady = reject;
    });
    // 页面没有接住失败时，不让浏览器再报一次“未处理的错误”
    this.ready.catch(() => {});

    const doc = container.ownerDocument;
    this.wrapper = doc.createElement('div');
    this.wrapper.className = 'still-table';
    const picture = (): HTMLImageElement => {
      const img = doc.createElement('img');
      img.className = 'still-picture is-idle';
      // 图上没有字，旁边的字是页面印的：对读屏的人来说这张图不用念
      img.setAttribute('alt', '');
      img.setAttribute('draggable', 'false');
      return img;
    };
    this.imgs = [picture(), picture()];
    this.wrapper.append(this.imgs[0], this.imgs[1]);
    const fade = (side: (typeof SIDES)[number]): HTMLDivElement => {
      const el = doc.createElement('div');
      el.className = 'still-fade';
      el.setAttribute('data-side', side);
      el.style.display = 'none';
      this.wrapper.append(el);
      return el;
    };
    this.fades = { left: fade('left'), right: fade('right'), top: fade('top'), bottom: fade('bottom') };
    container.append(this.wrapper);
    this.strips = mountStrips(container);

    this.hint = this.readHint();
    this.seenSize = this.size();
    if (this.headings.length === 0) this.giveUp(this.runs, new Error('场景里一个小节也没有'));
    else this.begin(first, false);
  }

  // ---------------------------------------------------------------- 对外的接口

  showSection(section: string, opts?: { animate?: boolean }): Promise<void> {
    if (this.destroyed) return Promise.reject(new Error('定格图已经关掉'));
    if (!this.headings.includes(section)) return Promise.reject(new RangeError(`场景里没有这个小节：${section}`));
    if (this.stopped) return Promise.resolve();
    // 途中又来新的指令：旧的那一次照常完成，但不再摆它那一节
    this.settle();
    return new Promise<void>((resolve) => {
      this.settlePending = resolve;
      this.begin(section, opts?.animate ?? true);
    });
  }

  /** 定格图动不了，本来就在摆好的位置上。 */
  resetView(): Promise<void> {
    return this.destroyed ? Promise.reject(new Error('定格图已经关掉')) : Promise.resolve();
  }

  setNamesMode(mode: NamesMode): void {
    this.namesMode = mode;
    // 正在淡入的时候题签藏着，淡完自然会按新的名字摆
    if (this.destroyed || !this.stripsUp) return;
    this.showStrips();
  }

  setInsets(insets: StageInsets): void {
    const was = this.insets;
    this.insets = insets;
    if (this.destroyed || this.stopped) return;
    if (was.top === insets.top && was.right === insets.right && was.bottom === insets.bottom && was.left === insets.left) return;
    this.refit();
  }

  onViewChange(listener: (info: StageViewInfo) => void): () => void {
    this.viewListeners.add(listener);
    if (this.lastInfo) listener(this.lastInfo);
    return () => void this.viewListeners.delete(listener);
  }

  /** 定格图上读者动不了镜头：从不通知。 */
  onUserMoved(): () => void {
    return () => {};
  }

  onLost(listener: () => void): () => void {
    this.lostListeners.add(listener);
    return () => void this.lostListeners.delete(listener);
  }

  /** 定格图没有快慢：从不通知。 */
  onSlow(): () => void {
    return () => {};
  }

  resize(): void {
    if (this.destroyed || this.stopped) return;
    const hint = this.readHint();
    const size = this.size();
    if (hint === this.hint && size.width === this.seenSize.width && size.height === this.seenSize.height) return;
    this.hint = hint;
    this.seenSize = size;
    // 排法换了（窄屏转成宽屏）：这一节换另一种形状的那一张，直接换上，不淡入。还在路上的 showSection 等新的这一张
    if (this.wantedShape !== null && this.shapeFor(this.wanted) !== this.wantedShape) this.begin(this.wanted, false);
    else this.refit();
  }

  readout(): StageReadout {
    return { triangles: 0, drawCalls: 0 };
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    // 还在路上的取图、淡入，回来时一看数变了就什么也不做
    this.runs += 1;
    this.wrapper.remove();
    this.strips.destroy();
    this.spares.clear();
    this.viewListeners.clear();
    this.lostListeners.clear();
    this.settle();
    // 还没等到第一张图就关掉了：让等着的地方结束，不算失败
    this.readySettled = true;
    this.settleReady();
  }

  // ---------------------------------------------------------------- 换一张图

  /** 让正在路上的那一次 showSection 完成。 */
  private settle(): void {
    const settle = this.settlePending;
    this.settlePending = null;
    settle?.();
  }

  /** 开始去一小节：先前在路上的那一次作废。 */
  private begin(heading: string, animate: boolean): void {
    this.wanted = heading;
    const run = ++this.runs;
    // 上一张还在淡入：直接淡完，腾出底下那一张来取新的
    this.endFade();
    this.run(run, heading, animate).catch((error: unknown) => this.giveUp(run, error instanceof Error ? error : new Error(String(error))));
  }

  private async run(run: number, heading: string, animate: boolean): Promise<void> {
    const shape = this.shapeFor(heading);
    this.wantedShape = shape;
    const shot = this.shotOf(heading, shape);
    const url = shot ? this.urls[shot.file] : undefined;
    if (!shot || !url) {
      this.giveUp(run, new Error(`“${heading}”这一节没有${shape === 'wide' ? '宽' : '窄'}的定格图`));
      return;
    }

    const incoming = this.imgs[this.top === 0 ? 1 : 0];
    const loaded = await this.load(incoming, url, run);
    if (run !== this.runs) return;
    if (!loaded) {
      this.giveUp(run, new Error(`定格图取不到：${shot.file}`));
      return;
    }

    // 换上去。第一张、页面说了不要动画、读者设了“减少动态效果”的，直接换；别的淡入
    const fade = animate && this.shown !== null && this.readySettled && !this.reducedMotion;
    this.strips.hide();
    this.stripsUp = false;
    const outgoing = this.imgs[this.top];
    this.top = this.top === 0 ? 1 : 0;
    this.shown = { heading, shot };
    incoming.className = fade ? 'still-picture is-top is-arriving' : 'still-picture is-top';
    outgoing.className = fade ? 'still-picture' : 'still-picture is-idle';
    this.fading = fade;
    this.wrapper.setAttribute('data-still-section', heading);
    this.wrapper.setAttribute('data-still-shape', shape);
    this.refit();

    if (fade) {
      await this.parts.wait(FADE_MS);
      if (run !== this.runs) return;
      this.endFade();
    }
    this.showStrips();
    if (!this.readySettled) {
      this.readySettled = true;
      this.settleReady();
    }
    this.settle();
    this.preloadAfter(heading, shape);
  }

  /** 取一张图放进 img；取不到再试一次。被新的指令顶掉了也返回 false（调用的地方自己看是不是被顶掉了）。 */
  private async load(img: HTMLImageElement, url: string, run: number): Promise<boolean> {
    for (let attempt = 0; attempt < 2; attempt++) {
      if (attempt > 0) {
        await this.parts.wait(RETRY_AFTER_MS);
        if (run !== this.runs) return false;
      }
      try {
        await this.parts.loadImage(img, url);
        return true;
      } catch {
        if (run !== this.runs) return false;
      }
    }
    return false;
  }

  /** 这一次摆不出来。还没有过图：ready 拒绝；已经有过图：通知 onLost。之后不再做事，等页面来关。 */
  private giveUp(run: number, error: Error): void {
    if (run !== this.runs || this.destroyed) return;
    console.warn('[定格图] 这一节的图片没能摆出来', error);
    this.stopped = true;
    if (!this.readySettled) {
      this.readySettled = true;
      this.failReady(error);
    } else {
      for (const listener of [...this.lostListeners]) listener();
    }
    this.settle();
  }

  /** 淡入做完（或者不等了）：新的一张完全显出来，旧的一张收起来。 */
  private endFade(): void {
    if (!this.fading) return;
    this.fading = false;
    this.imgs[this.top].className = 'still-picture is-top';
    this.imgs[this.top === 0 ? 1 : 0].className = 'still-picture is-idle';
  }

  /**
   * 换好一张以后，把后一节的那一张先取来：读者往下读时不用等。
   * 全程沙盘不先取：它的小节不是照着正文往下读的（人物页一直是头一节，一站的页面只看到这一站去的那一节），先取的那一张多半用不上。
   */
  private preloadAfter(heading: string, shape: StillShape): void {
    if (this.scene.level === 'route') return;
    const next = this.headings[this.headings.indexOf(heading) + 1];
    if (next === undefined) return;
    const shot = this.shotOf(next, shape);
    const url = shot ? this.urls[shot.file] : undefined;
    if (!url || this.spares.has(url)) return;
    const img = this.container.ownerDocument.createElement('img');
    this.spares.set(url, img);
    // 先取只是为了快；取不到不算事，真用到那一节时会再取、再报
    this.parts.loadImage(img, url).catch(() => {});
  }

  // ---------------------------------------------------------------- 摆在哪

  private size(): { width: number; height: number } {
    return { width: this.container.clientWidth, height: this.container.clientHeight };
  }

  /** 现在的沙盘栏。收起来了（宽或高是 0）时是 null：这时不摆，等它展开。 */
  private pane(): StillPane | null {
    const { width, height } = this.size();
    return width > 0 && height > 0 ? { width, height, insets: this.insets } : null;
  }

  /** 页面说现在是宽的排法还是窄的排法（layout.css 写在 .stage-pane 上的 --stage-shape）。没说是 null。 */
  private readHint(): StillShape | null {
    const view = this.container.ownerDocument.defaultView;
    if (!view) return null;
    const value = view.getComputedStyle(this.container).getPropertyValue('--stage-shape').trim();
    return value === 'wide' || value === 'narrow' ? value : null;
  }

  private shotOf(heading: string, shape: StillShape): StillShot | undefined {
    return this.manifest.stills.find((still) => still.section === heading && still.shape === shape);
  }

  private closestOf(heading: string): number | undefined {
    const sections: { heading: string; camera: { closest?: number } }[] = this.scene.sections;
    return sections.find((s) => s.heading === heading)?.camera.closest;
  }

  /** 这一节用宽的那一张还是窄的那一张。页面说了就照页面的；没说（开发用的单独一页）就挑摆好以后盖得多的。 */
  private shapeFor(heading: string): StillShape {
    if (this.hint) return this.hint;
    const pane = this.pane();
    if (!pane) return this.wantedShape ?? 'wide';
    return pickShape(
      this.manifest.shapes,
      pane,
      (['wide', 'narrow'] as const).filter((shape) => this.shotOf(heading, shape) !== undefined),
    );
  }

  /** 照现在的沙盘栏把摆着的那张图摆好：图片、边上的过渡、题签、指北和比例尺。 */
  private refit(): void {
    const shown = this.shown;
    const pane = this.pane();
    if (!shown || !pane) return;
    const { shot } = shown;
    const fit = fitStill(shot, this.manifest.shapes[shot.shape], this.manifest.made, pane, this.closestOf(shown.heading));
    this.fit = fit;
    // 给自动测试看：这张图是照四边各留多少摆的（上 右 下 左）
    this.wrapper.setAttribute('data-still-insets', [this.insets.top, this.insets.right, this.insets.bottom, this.insets.left].join(' '));

    const img = this.imgs[this.top];
    img.style.left = px(fit.left);
    img.style.top = px(fit.top);
    img.style.width = px(fit.width);
    img.style.height = px(fit.height);

    const rgb = rgbOf(this.manifest.made.background);
    const fades = rgb ? edgeFades(fit, pane) : [];
    for (const side of SIDES) {
      const el = this.fades[side];
      const fade = fades.find((f) => f.side === side);
      if (!fade || !rgb) {
        el.style.display = 'none';
        continue;
      }
      el.style.left = px(fade.left);
      el.style.top = px(fade.top);
      el.style.width = px(fade.width);
      el.style.height = px(fade.height);
      // 透明的那一头写成同一种颜色的透明：老一点的 Safari 把 transparent 当成透明的黑，过渡中间会发灰
      el.style.background = `linear-gradient(${FADE_TOWARDS[side]}, rgb(${rgb.join(', ')}), rgba(${rgb.join(', ')}, 0))`;
      el.style.display = '';
    }

    this.placeStrips();

    const info: StageViewInfo = { northDeg: shot.northDeg, scale: chooseScale(shot.pxPerMetre * fit.scale) };
    const last = this.lastInfo;
    if (!last || Math.abs(last.northDeg - info.northDeg) > 0.05 || last.scale.px !== info.scale.px || last.scale.label !== info.scale.label) {
      this.lastInfo = info;
      for (const listener of [...this.viewListeners]) listener(info);
    }
  }

  /** 换上这一小节的题签（按现在的古今名字），照清单里记的位置摆。 */
  private showStrips(): void {
    const shown = this.shown;
    if (!shown) return;
    let specs: StripSpec[] = [];
    // 题签摆不出来（场景文件有毛病）不该连图也不让看
    try {
      specs = sectionStripSpecs(this.scene, shown.heading, stripTexts(this.scene, shown.heading, this.namesMode), this.marks);
    } catch (error) {
      console.warn('[定格图] 这一小节的题签没能摆出来', error);
    }
    // 先藏着换，再摆：不让新的字在旧的位置上闪一下
    this.strips.hide();
    this.strips.set(specs);
    this.stripsUp = true;
    this.placeStrips();
  }

  private placeStrips(): void {
    const shown = this.shown;
    const pane = this.pane();
    if (!this.stripsUp || !shown || !this.fit || !pane) return;
    this.strips.place(anchorsOnPane(shown.shot.anchors, this.fit, pane), { width: pane.width, height: pane.height }, this.insets);
  }
}
