// 定格图的沙盘在 Node 里空跑时用的假东西：一个很小的假容器（只有定格图用到的那几样页面功能），
// 和假的取图办法（不真的下载：哪张取得到、哪张取不到、哪张先压着不给，由测试说了算）。
// 题签那一层不在这里：测试里用 vi.mock 把 src/stage/overlay 换成只记指令的假的。

import type { StillParts } from '../../../src/stage/still/engine';

/** 假的页面元素：只记下定格图对它做过什么。 */
export interface FakeElement {
  tagName: string;
  className: string;
  style: Record<string, string>;
  attributes: Record<string, string>;
  children: FakeElement[];
  parent: FakeElement | null;
  /** 假的取图办法把网址记在这里（真的图片元素上是 src）。 */
  src: string;
  clientWidth: number;
  clientHeight: number;
  ownerDocument: unknown;
  setAttribute(name: string, value: string): void;
  getAttribute(name: string): string | null;
  append(...nodes: FakeElement[]): void;
  remove(): void;
}

function fakeElement(tagName: string, ownerDocument: unknown): FakeElement {
  const el: FakeElement = {
    tagName,
    className: '',
    style: {},
    attributes: {},
    children: [],
    parent: null,
    src: '',
    clientWidth: 0,
    clientHeight: 0,
    ownerDocument,
    setAttribute(name, value) {
      el.attributes[name] = value;
    },
    getAttribute(name) {
      return name in el.attributes ? el.attributes[name] : null;
    },
    append(...nodes) {
      for (const node of nodes) {
        node.parent = el;
        el.children.push(node);
      }
    },
    remove() {
      const parent = el.parent;
      if (!parent) return;
      parent.children.splice(parent.children.indexOf(el), 1);
      el.parent = null;
    },
  };
  return el;
}

export interface FakePane {
  /** 交给定格图的容器（当成 HTMLElement 用）。 */
  container: HTMLElement;
  /** 同一个容器，按假元素看（查它里面添了什么）。 */
  node: FakeElement;
  /** 改容器的大小（改完要自己叫 view.resize()，和页面一样）。 */
  setSize(width: number, height: number): void;
  /** 改页面说的排法（--stage-shape）：'wide'、'narrow'，或者 ''（没说）。 */
  setShape(shape: 'wide' | 'narrow' | ''): void;
  /** 容器里那个 div.still-table；没有时是 undefined。 */
  wrapper(): FakeElement | undefined;
  /** 现在摆在上面的那张图片；没有时是 undefined。 */
  topPicture(): FakeElement | undefined;
  /** 现在显着的过渡各在哪一边。 */
  fades(): string[];
}

/** 一个假的沙盘容器。shape 是页面说的排法，不写就是没说。 */
export function fakePane(width: number, height: number, shape: 'wide' | 'narrow' | '' = ''): FakePane {
  let stageShape: string = shape;
  const doc: { createElement(tag: string): FakeElement; defaultView: unknown } = {
    createElement: (tag) => fakeElement(tag, doc),
    defaultView: {
      getComputedStyle: () => ({ getPropertyValue: (name: string) => (name === '--stage-shape' ? stageShape : '') }),
    },
  };
  const node = fakeElement('div', doc);
  node.clientWidth = width;
  node.clientHeight = height;
  const wrapper = (): FakeElement | undefined => node.children.find((child) => child.className === 'still-table');
  return {
    container: node as unknown as HTMLElement,
    node,
    setSize(w, h) {
      node.clientWidth = w;
      node.clientHeight = h;
    },
    setShape(next) {
      stageShape = next;
    },
    wrapper,
    topPicture: () => wrapper()?.children.find((child) => child.tagName === 'img' && child.className.split(' ').includes('is-top')),
    fades: () =>
      (wrapper()?.children ?? [])
        .filter((child) => child.className === 'still-fade' && child.style.display !== 'none')
        .map((child) => child.attributes['data-side']),
  };
}

export interface FakeImages {
  parts: StillParts;
  /** 每一次取图要的网址，按先后（重试的也算一次）。 */
  requests: string[];
  /** 每一次“等一会儿”等的是多少毫秒，按先后。 */
  waits: number[];
  /** 从现在起这个网址取不到。times 写了就只是接下来的这么多次取不到，之后又取得到。 */
  fail(url: string, times?: number): void;
  /** 这个网址又取得到了。 */
  mend(url: string): void;
  /** 从现在起这个网址先压着不给，等 release。 */
  hold(url: string): void;
  /** 把压着的这个网址放出来（取到了），以后也不再压。 */
  release(url: string): void;
  /** 从现在起“等一会儿”都压着，等 releaseWaits。 */
  holdWaits(): void;
  /** 把压着的“等一会儿”都放出来，以后也不再压。 */
  releaseWaits(): void;
}

/** 假的取图办法。不压着的时候，取图和“等一会儿”都马上完成。 */
export function fakeImages(): FakeImages {
  const requests: string[] = [];
  const waits: number[] = [];
  /** 网址 → 还要取不到几次（Infinity 是一直取不到）。 */
  const failing = new Map<string, number>();
  const holding = new Set<string>();
  const heldLoads = new Map<string, (() => void)[]>();
  let waitsHeld = false;
  let heldWaits: (() => void)[] = [];
  return {
    requests,
    waits,
    parts: {
      loadImage(img, url) {
        requests.push(url);
        (img as unknown as FakeElement).src = url;
        const left = failing.get(url) ?? 0;
        if (left > 0) {
          if (left === 1) failing.delete(url);
          else failing.set(url, left - 1);
          return Promise.reject(new Error(`假的取图办法：${url} 取不到`));
        }
        if (!holding.has(url)) return Promise.resolve();
        return new Promise<void>((resolve) => {
          heldLoads.set(url, [...(heldLoads.get(url) ?? []), resolve]);
        });
      },
      wait(ms) {
        waits.push(ms);
        if (!waitsHeld) return Promise.resolve();
        return new Promise<void>((resolve) => {
          heldWaits.push(resolve);
        });
      },
    },
    fail: (url, times = Infinity) => void failing.set(url, times),
    mend: (url) => void failing.delete(url),
    hold: (url) => void holding.add(url),
    release(url) {
      holding.delete(url);
      for (const resolve of heldLoads.get(url) ?? []) resolve();
      heldLoads.delete(url);
    },
    holdWaits() {
      waitsHeld = true;
    },
    releaseWaits() {
      waitsHeld = false;
      const waiting = heldWaits;
      heldWaits = [];
      for (const resolve of waiting) resolve();
    },
  };
}

/** 让等着的 Promise 都往下走一轮。 */
export function settle(): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, 0));
}
