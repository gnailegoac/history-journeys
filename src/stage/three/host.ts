// 画布和渲染器的主人。整个访问期间只有一块画布、一个渲染器：从一站翻到下一站、
// 开发时 React 把同一座沙盘“建、拆、再建”一遍（StrictMode），用的都是同一块，不会一次次向浏览器要新的三维画面。
//
// 一座沙盘用的时候来借（acquire），关掉的时候还（release）。借到手的那一份带一个 signal：
// 这一份作废了（还了，被下一座沙盘借走了，或者三维画面丢了）它就响，造沙盘的每一步等完之后都要看一眼。
// 三维画面丢了（平板、手机内存吃紧时会这样）以后，这块画布不再用，下一次来借时换新的。
// 来借的时候说好用哪一档画质（Quality）。抗锯齿是造渲染器时就定死的，所以换了一档、抗锯齿对不上时，
// 也和画面丢了一样：旧的画布和渲染器放掉，换新的。
//
// 这一次访问里“画质最高到哪一档”的记性（tier.ts 的 TierMemory）也放在主人身上：主人只有一个，
// 每一座沙盘都从它这里借画布，拿到的就是同一份记性。
//
// 画布和渲染器怎么造是交进来的（HostParts），所以这一套先后在 Node 里也能测（tests/stage/host.test.ts）。

import { Material, Mesh, NoToneMapping, PCFShadowMap, SRGBColorSpace, Texture, WebGLRenderer, type Object3D } from 'three';
import type { Quality } from './internal';
import { FULL_QUALITY } from './quality';
import { createTierMemory, type TierMemory } from './tier';

// 两档画质的数在 quality.ts；完整的一档这里照旧给出来（用它的地方很多）。
export { FULL_QUALITY };

/** 画布和渲染器怎么造、怎么放、怎么拿走。P 是容器，C 是画布，R 是渲染器。 */
export interface HostParts<P, C, R> {
  createCanvas(): C;
  /** 造不出来（浏览器不给三维画面）时抛出错误。 */
  createRenderer(canvas: C, quality: Quality): R;
  /** 把画布放进容器。 */
  attach(container: P, canvas: C): void;
  /** 把画布从容器里拿出来（画布留着，下一次还用）。 */
  detach(container: P, canvas: C): void;
  /** 画布上的三维画面丢了的时候叫 listener。返回取消的函数。 */
  onContextLost(canvas: C, listener: () => void): () => void;
  /** 放掉渲染器。lost 是 true 时这块画布的三维画面丢过（浏览器后来可能又把它还了回来）。 */
  disposeRenderer(renderer: R, lost: boolean): void;
  /**
   * 等显卡把刚才那一帧真的画完（试画计时用，见 Lease.finish）。不写就是不等。
   * 要紧跟在画完一帧之后叫：浏览器里是从画布上读回一个像素。
   */
  finish?(renderer: R): void;
}

/** 借到手的一份画布和渲染器。 */
export interface Lease<C, R> {
  readonly canvas: C;
  readonly renderer: R;
  /** 这一份是照哪一档画质借的。沙盘里和画质有关的数都从这里读。 */
  readonly quality: Quality;
  /** 这一份作废了就响：还了，被下一座沙盘借走了，或者三维画面丢了。 */
  readonly signal: AbortSignal;
  /** 是不是因为三维画面丢了才作废的。 */
  readonly lost: boolean;
  /** 三维画面丢了的时候通知。返回取消订阅的函数。 */
  onLost(listener: () => void): () => void;
  /**
   * 等显卡把刚才那一帧真的画完再回来（试画计时用）：叫渲染器画一帧只是把活交给显卡，不等它画完；
   * 不等的话量出来的只是“交代”用了多久。紧跟在 renderer.render 之后叫。这一份作废以后什么也不做。
   */
  finish(): void;
  /** 还回去。可以重复调用。 */
  release(): void;
}

export interface StageHost<P, C, R> {
  /** 这一次访问里画质最高到哪一档的记性。只有这一份；沙盘照它挑档，量出来慢了也报给它。 */
  readonly tiers: TierMemory;
  /**
   * 借画布和渲染器，并把画布放进 container。上一份还没还的话，先让它作废。造不出渲染器时抛出错误。
   * quality 是这一座沙盘用哪一档画质，不写就是完整的一档。
   * 手里的渲染器造的时候抗锯齿开没开，和这一次要的不一样：先把旧的画布和渲染器放掉，再造新的。
   */
  acquire(container: P, quality?: Quality): Lease<C, R>;
  /** 把画布和渲染器彻底放掉（整个页面不再用沙盘时）。 */
  dispose(): void;
}

export function createHost<P, C, R>(parts: HostParts<P, C, R>): StageHost<P, C, R> {
  const tiers = createTierMemory();
  let canvas: C | null = null;
  let renderer: R | null = null;
  /** 手里这个渲染器造的时候开没开抗锯齿（造好以后改不了）。 */
  let antialias = false;
  let unlisten: (() => void) | null = null;
  /** 画布上的三维画面丢了：这块画布不再用。 */
  let dead = false;
  /** 现在借出去的那一份怎么作废。 */
  let endCurrent: ((lost: boolean) => void) | null = null;

  function discard(): void {
    unlisten?.();
    unlisten = null;
    if (renderer) parts.disposeRenderer(renderer, dead);
    renderer = null;
    canvas = null;
    dead = false;
  }

  function acquire(container: P, leaseQuality: Quality = FULL_QUALITY): Lease<C, R> {
    endCurrent?.(false);
    // 画面丢过的不再用；抗锯齿对不上的（换了一档画质）也不能接着用
    if (dead || (renderer && antialias !== leaseQuality.antialias)) discard();
    if (!canvas || !renderer) {
      const made = parts.createCanvas();
      const madeRenderer = parts.createRenderer(made, leaseQuality);
      canvas = made;
      renderer = madeRenderer;
      antialias = leaseQuality.antialias;
      unlisten = parts.onContextLost(made, () => {
        // 只认现在这块画布的；换过画布以后，旧画布再来的通知不管
        if (canvas !== made) return;
        dead = true;
        endCurrent?.(true);
      });
    }
    const leased = canvas;
    const leasedRenderer = renderer;
    parts.attach(container, leased);

    const controller = new AbortController();
    const lostListeners = new Set<() => void>();
    let wasLost = false;
    let ended = false;
    const end = (lost: boolean): void => {
      if (ended) return;
      ended = true;
      endCurrent = null;
      wasLost = lost;
      controller.abort();
      parts.detach(container, leased);
      if (lost) for (const listener of [...lostListeners]) listener();
      lostListeners.clear();
    };
    endCurrent = end;

    return {
      canvas: leased,
      renderer: leasedRenderer,
      quality: leaseQuality,
      signal: controller.signal,
      get lost() {
        return wasLost;
      },
      onLost(listener) {
        if (ended) return () => {};
        lostListeners.add(listener);
        return () => void lostListeners.delete(listener);
      },
      finish() {
        if (!ended) parts.finish?.(leasedRenderer);
      },
      release: () => end(false),
    };
  }

  function dispose(): void {
    endCurrent?.(false);
    discard();
  }

  return { tiers, acquire, dispose };
}

// ---------------------------------------------------------------- 等浏览器画一帧

/** 约下一帧和定时用的两样。都返回取消的函数。 */
export interface PaintClock {
  requestFrame(run: () => void): () => void;
  setTimer(run: () => void, ms: number): () => void;
}

/** 浏览器里的时钟。 */
export const browserClock: PaintClock = {
  requestFrame(run) {
    const id = requestAnimationFrame(run);
    return () => cancelAnimationFrame(id);
  },
  setTimer(run, ms) {
    const id = setTimeout(run, ms);
    return () => clearTimeout(id);
  },
};

/** 页面在后台时浏览器不给动画帧，最多等这么久就不等了。 */
const FRAME_TIMEOUT_MS = 100;

/**
 * 下一帧调用 run（只调用一次）。页面在后台时浏览器不给动画帧，所以同时定一个 100 毫秒的时，哪个先到算哪个。
 * 返回取消的函数。
 */
export function nextFrame(run: () => void, clock: PaintClock = browserClock): () => void {
  let done = false;
  const fire = (): void => {
    if (done) return;
    done = true;
    cancelFrame();
    cancelTimer();
    run();
  };
  // 先把两个取消函数占住：时钟要是当场就调用 fire，也不会出错
  let cancelFrame: () => void = () => {};
  let cancelTimer: () => void = () => {};
  cancelFrame = clock.requestFrame(fire);
  if (!done) cancelTimer = clock.setTimer(fire, FRAME_TIMEOUT_MS);
  return () => {
    if (done) return;
    done = true;
    cancelFrame();
    cancelTimer();
  };
}

/** 等到下一帧。用来把活分成几段，中间让浏览器把页面画出来、响应手指。 */
export function nextPaint(clock: PaintClock = browserClock): Promise<void> {
  return new Promise((resolve) => {
    nextFrame(resolve, clock);
  });
}

// ---------------------------------------------------------------- 放掉模型和贴图

/** 把一种材质和它用的贴图都放掉。uniforms 里的贴图（自己写的着色器）也算。 */
export function disposeMaterial(material: Material): void {
  const seen = new Set<Texture>();
  const drop = (value: unknown): void => {
    if (value instanceof Texture && !seen.has(value)) {
      seen.add(value);
      value.dispose();
    }
  };
  for (const value of Object.values(material)) drop(value);
  const uniforms = (material as { uniforms?: Record<string, { value: unknown }> }).uniforms;
  if (uniforms) for (const uniform of Object.values(uniforms)) drop(uniform?.value);
  material.dispose();
}

/** 把一组东西下面所有网格的形状、材质和贴图都放掉（并成一个的、成批摆的都算）。 */
export function disposeTree(root: Object3D): void {
  const materials = new Set<Material>();
  root.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    object.geometry.dispose();
    const material: Material | Material[] = object.material;
    for (const m of Array.isArray(material) ? material : [material]) materials.add(m);
  });
  for (const material of materials) disposeMaterial(material);
}

// ---------------------------------------------------------------- 浏览器里的那一套

/** 画布放进去以前，容器自己写的 position（放进去时可能要改，拿出来时还原）。 */
const positionBefore = new WeakMap<HTMLElement, string>();

/** 读回来的那一个像素放在这里（读到什么不要紧，要的是“等到画完”）。 */
const onePixel = new Uint8Array(4);

/** 浏览器里真的画布和渲染器。渲染器的设置照样张（spikes/art-direction/b/scene/sandtable.js）。 */
export const browserParts: HostParts<HTMLElement, HTMLCanvasElement, WebGLRenderer> = {
  createCanvas() {
    const canvas = document.createElement('canvas');
    // 画布铺满容器，题签那一层盖在它上面。不给它起类名，免得和页面自己的样式撞上
    canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;';
    return canvas;
  },
  createRenderer(canvas, quality) {
    const renderer = new WebGLRenderer({ canvas, antialias: quality.antialias, alpha: true, powerPreference: 'high-performance' });
    renderer.setClearColor(0x000000, 0);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = PCFShadowMap;
    renderer.toneMapping = NoToneMapping;
    renderer.outputColorSpace = SRGBColorSpace;
    return renderer;
  },
  attach(container, canvas) {
    // 画布是按容器来定位的：容器要是没有定位，先给它定上，拿走画布时再还原
    if (getComputedStyle(container).position === 'static') {
      positionBefore.set(container, container.style.position);
      container.style.position = 'relative';
    }
    container.prepend(canvas);
  },
  detach(container, canvas) {
    canvas.remove();
    // 画布留着下一次用，可它那一大块画面（沙盘栏的大小乘像素比，开着抗锯齿时还要翻几倍）不用留着：
    // 缩成一个像素，读者回到人物页、或者这一次访问只放图片了的时候，这块内存就还给浏览器了。
    // 下一座沙盘借到手以后先照自己的容器定大小（view.ts 的 applySize），才画。
    canvas.width = 1;
    canvas.height = 1;
    const before = positionBefore.get(container);
    if (before !== undefined) {
      container.style.position = before;
      positionBefore.delete(container);
    }
  },
  onContextLost(canvas, listener) {
    const onLost = (): void => listener();
    canvas.addEventListener('webglcontextlost', onLost);
    return () => canvas.removeEventListener('webglcontextlost', onLost);
  },
  disposeRenderer(renderer, lost) {
    renderer.dispose();
    // 把三维画面还给浏览器（同时开着的数目有限）。丢过的也要看一眼：three 收到“画面丢了”时不让浏览器当成彻底作废，
    // 浏览器过后可能把它还回来；那样这块不用了的画布还占着一个三维画面，挤掉新的那一个。还丢着的就不用还了
    if (!lost || !renderer.getContext().isContextLost()) renderer.forceContextLoss();
  },
  finish(renderer) {
    // 从画布上读回一个像素：浏览器得等显卡把前面交代的活都干完才答得出来
    const gl = renderer.getContext();
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, onePixel);
  },
};
