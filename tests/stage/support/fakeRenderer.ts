// 在 Node 里把一座真的沙盘空跑一遍（src/stage/three/view.ts）要用的几样假东西：
// 渲染器（只记下画了几帧）、画布、画布主人要的那一套、紫檀座子要的环境贴图、页面（document）、取地形文件（fetch），
// 还有假的零件库（只记下每一帧告诉它的远近）和假的题签层（只记下每一帧给它的位置）。
// 都是函数：每个测试文件自己写 vi.mock、vi.stubGlobal，把这里做出来的东西交进去，所以几个测试文件互不相干。
//
// 这个文件只从 three 取类型，不取真的东西：它是在 vi.mock('three', …) 里面加载的，取了真的会绕回自己。
// 要用 three 里真东西的地方（假零件库要一个 Group），由测试文件造好了交进来。

import type { BufferGeometry, DirectionalLight, Group, InstancedMesh, Material, Mesh, Object3D, PerspectiveCamera, Scene, WebGLRenderer } from 'three';
import type { StripInput, StripLayer, StripSpec } from '../../../src/stage/overlay/types';
import type { HostParts } from '../../../src/stage/three/host';
import type { KitContext, ModelSet, Quality } from '../../../src/stage/three/internal';
import type { StageInsets } from '../../../src/stage/types';
import { readBytes } from '../../support/readBytes';

// ---------------------------------------------------------------- three 里换掉的一样

/**
 * 环境贴图要真的三维画面才烤得出来，这里换成一张空的。real 是真的 three。
 * 用法（写在测试文件里）：
 *   vi.mock('three', async (original) => {
 *     const { fakeThree } = await import('./support/fakeRenderer');
 *     return fakeThree(await original<typeof import('three')>());
 *   });
 */
export function fakeThree(real: typeof import('three')): Record<string, unknown> {
  class FakePmrem {
    fromScene(): { texture: InstanceType<typeof real.Texture>; dispose(): void } {
      return { texture: new real.Texture(), dispose() {} };
    }
    dispose(): void {}
  }
  return { ...real, PMREMGenerator: FakePmrem };
}

// ---------------------------------------------------------------- 页面

/** 假的 document：只会造“画布”，画布给一支什么也不留下的画笔（贴图照样“画”）。交给 vi.stubGlobal('document', …)。 */
export function fakeDocument(): { createElement(): unknown } {
  const brush: Record<string, unknown> = new Proxy(
    {},
    {
      get(_target, key) {
        if (key === 'createImageData') return (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) });
        if (key === 'getImageData') return (_x: number, _y: number, w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) });
        if (key === 'createLinearGradient' || key === 'createRadialGradient') return () => ({ addColorStop() {} });
        if (key === 'measureText') return () => ({ width: 10 });
        return () => undefined;
      },
      set: () => true,
    },
  );
  return { createElement: () => ({ width: 0, height: 0, style: {}, getContext: () => brush }) };
}

/** 假的 fetch：不管要什么，都给磁盘上的这个地形文件（路径相对项目的根目录）。交给 vi.stubGlobal('fetch', …)。 */
export function fakeFetch(terrainPath: string): () => Promise<{ ok: boolean; status: number; arrayBuffer(): Promise<ArrayBuffer> }> {
  return () => Promise.resolve({ ok: true, status: 200, arrayBuffer: () => Promise.resolve(readBytes(terrainPath)) });
}

// ---------------------------------------------------------------- 画布

type Handler = (event: Record<string, unknown>) => void;

/** 一个只会登记、触发事件的东西，顶替画布和 document。 */
export interface FakeEventTarget {
  has(type: string): boolean;
  addEventListener(type: string, fn: Handler): void;
  removeEventListener(type: string, fn: Handler): void;
  fire(type: string, event: Record<string, unknown>): void;
}

export function eventTarget(): FakeEventTarget {
  const map = new Map<string, Set<Handler>>();
  return {
    has: (type) => (map.get(type)?.size ?? 0) > 0,
    addEventListener(type, fn) {
      if (!map.has(type)) map.set(type, new Set());
      map.get(type)?.add(fn);
    },
    removeEventListener(type, fn) {
      map.get(type)?.delete(fn);
    },
    fire(type, event) {
      for (const fn of [...(map.get(type) ?? [])]) fn({ type, preventDefault() {}, stopPropagation() {}, ...event });
    },
  };
}

/**
 * 假的画布，width × height 那么大。el 是画布自己收到的事件（按下、滚轮），doc 是画布所在的页面收到的事件（拖、松开）：
 * 测试用 el.fire、doc.fire 假装读者在动沙盘（three.js 自己的 OrbitControls 就是这么听的）。
 */
export function fakeCanvas(width: number, height: number): { canvas: { style: Record<string, string> }; el: FakeEventTarget; doc: FakeEventTarget } {
  const doc = eventTarget();
  const el = eventTarget();
  const canvas = {
    style: {} as Record<string, string>,
    clientWidth: width,
    clientHeight: height,
    addEventListener: el.addEventListener,
    removeEventListener: el.removeEventListener,
    ownerDocument: doc,
    getRootNode: () => doc,
    setPointerCapture() {},
    releasePointerCapture() {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width, height }),
  };
  return { canvas, el, doc };
}

// ---------------------------------------------------------------- 渲染器

/** 每画一帧记的一笔。 */
export interface FakeFrame {
  /** 这一帧画没画影子。 */
  shadow: boolean;
  /** 镜头离沙盘的原点多远。 */
  camera: number;
  /** 画面的中心往下挪了多少像素。 */
  offsetY: number;
  /** 画面的宽高比。 */
  aspect: number;
  /** 这一帧的镜头，原样留一份（位置、朝向、视角、画面中心挪了多少都在里面），可以拿它把点再投一遍。 */
  view: PerspectiveCamera;
  /** 光从哪边来：从影子罩的那一块的中心指向太阳，长度为 1。场景里没有太阳光时是 null。 */
  sun: [number, number, number] | null;
  /** 影子：罩的那一块在哪、半边多长（米），边缘虚化的半径，偏移，沿法线的偏移，贴图的边长（像素）。 */
  shadowCentre: [number, number];
  shadowHalf: number;
  shadowRadius: number;
  shadowBias: number;
  shadowNormalBias: number;
  shadowMapSize: number;
}

export interface FakeRenderer {
  /** 交给画布主人的那个“渲染器”。 */
  renderer: WebGLRenderer;
  /** 画过的每一帧，按先后。 */
  frames: FakeFrame[];
  /** 画过的形状和材质，和其中已经放掉的。 */
  seen: { geometries: Set<BufferGeometry>; materials: Set<Material>; disposed: Set<unknown> };
  /** 画布先后用过的像素比。 */
  pixelRatios: number[];
  /** 最近一帧画的那个场景；一帧也没画过是 null。 */
  lastWorld(): Scene | null;
  /** 下一帧画完时要做的事（只做一次）。 */
  afterNextRender(run: () => void): void;
  /**
   * 每画完一帧都要做的事（一直做，到换成别的或者 null 为止）。
   * 用来假装“这台设备画一帧要这么久”：测试在这里让它自己的钟往前走（见 view-tier.test.ts）。
   */
  afterEveryRender(run: (() => void) | null): void;
}

/** 假的渲染器：不画，只记下每一帧画了什么（见 FakeFrame）、画过哪些形状和材质、它们后来放掉没有。 */
export function fakeRenderer(): FakeRenderer {
  const frames: FakeFrame[] = [];
  const seen = { geometries: new Set<BufferGeometry>(), materials: new Set<Material>(), disposed: new Set<unknown>() };
  const pixelRatios: number[] = [];
  let lastWorld: Scene | null = null;
  let afterNextRender: (() => void) | null = null;
  let afterEveryRender: (() => void) | null = null;
  const renderer = {
    setPixelRatio(ratio: number) {
      pixelRatios.push(ratio);
    },
    setSize() {},
    clear() {},
    capabilities: { getMaxAnisotropy: () => 8 },
    info: { render: { triangles: 0, calls: 0 } },
    renderLists: { dispose() {} },
    render(world: Scene, camera: PerspectiveCamera) {
      let shadow = false;
      let sun: FakeFrame['sun'] = null;
      let shadowCentre: [number, number] = [0, 0];
      let shadowHalf = 0;
      let shadowRadius = 0;
      let shadowBias = 0;
      let shadowNormalBias = 0;
      let shadowMapSize = 0;
      world.traverse((o: Object3D) => {
        const light = o as DirectionalLight;
        if (light.isDirectionalLight) {
          shadow = light.shadow.needsUpdate;
          light.shadow.needsUpdate = false;
          const dx = light.position.x - light.target.position.x;
          const dy = light.position.y - light.target.position.y;
          const dz = light.position.z - light.target.position.z;
          const length = Math.hypot(dx, dy, dz) || 1;
          sun = [dx / length, dy / length, dz / length];
          shadowCentre = [light.target.position.x, light.target.position.z];
          shadowHalf = light.shadow.camera.right;
          shadowRadius = light.shadow.radius;
          shadowBias = light.shadow.bias;
          shadowNormalBias = light.shadow.normalBias;
          shadowMapSize = light.shadow.mapSize.width;
        }
        const mesh = o as Mesh;
        if (!mesh.isMesh) return;
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const item of [mesh.geometry, ...materials]) {
          const known = item === mesh.geometry ? seen.geometries.has(mesh.geometry) : seen.materials.has(item as Material);
          if (known) continue;
          if (item === mesh.geometry) seen.geometries.add(mesh.geometry);
          else seen.materials.add(item as Material);
          item.addEventListener('dispose', () => seen.disposed.add(item));
        }
      });
      camera.updateMatrixWorld();
      lastWorld = world;
      frames.push({
        shadow,
        camera: camera.position.length(),
        offsetY: camera.view?.enabled ? camera.view.offsetY : 0,
        aspect: camera.aspect,
        view: camera.clone(),
        sun,
        shadowCentre,
        shadowHalf,
        shadowRadius,
        shadowBias,
        shadowNormalBias,
        shadowMapSize,
      });
      afterEveryRender?.();
      const then = afterNextRender;
      afterNextRender = null;
      then?.();
    },
  };
  return {
    renderer: renderer as unknown as WebGLRenderer,
    frames,
    seen,
    pixelRatios,
    lastWorld: () => lastWorld,
    afterNextRender(run) {
      afterNextRender = run;
    },
    afterEveryRender(run) {
      afterEveryRender = run;
    },
  };
}

/**
 * 画布主人要的那一套（HostParts），用的是上面的假画布和假渲染器。
 * canvasesMade() 是先后造过几块画布；loseContext() 假装最近一块画布上的三维画面丢了；
 * qualities 是每一次造渲染器时说的画质，按先后。
 * finish 是“等显卡把刚才那一帧画完”（试画计时用）：不交就和没有显卡可等的一样，什么也不做；
 * 交了的，沙盘每等一次叫它一次，测试在里面让自己的钟往前走，就是“等了这么久”。
 */
export function fakeHostParts(
  canvas: unknown,
  renderer: WebGLRenderer,
  finish?: () => void,
): { parts: HostParts<HTMLElement, HTMLCanvasElement, WebGLRenderer>; canvasesMade(): number; loseContext(): void; qualities: Quality[] } {
  let made = 0;
  let lose: () => void = () => {};
  const qualities: Quality[] = [];
  const parts: HostParts<HTMLElement, HTMLCanvasElement, WebGLRenderer> = {
    createCanvas: () => {
      made += 1;
      return canvas as HTMLCanvasElement;
    },
    createRenderer: (_canvas, quality) => {
      qualities.push(quality);
      return renderer;
    },
    attach() {},
    detach() {},
    onContextLost: (_canvas, listener) => {
      lose = listener;
      return () => {};
    },
    disposeRenderer() {},
  };
  if (finish) parts.finish = () => finish();
  return { parts, canvasesMade: () => made, loseContext: () => lose(), qualities };
}

// ---------------------------------------------------------------- 零件库

/** 假的零件库记下的东西。 */
export interface FakeKit {
  /** 顶替零件库的 buildModels（写在 vi.mock 里）。 */
  buildModels(ctx: KitContext): ModelSet;
  /** 每一次造模型拿到的东西（画质在里面），按先后。 */
  contexts: KitContext[];
  /** 每一次 apply：哪一小节、水位、折算过的远近，和它答的“显出来的东西变没变”。每画一帧正好一次。 */
  applies: { section: string; levelM: number; D: number; changed: boolean }[];
  /** 每一次 prepare 要先造哪几节。 */
  prepared: string[][];
  /** 放掉了几套。 */
  disposed(): number;
}

/**
 * 假的零件库：不造模型，只记下沙盘每一帧告诉它的事。makeGroup 造一个 three 的 Group（这个文件自己不能取 three）。
 * 它照约定回答 apply（见 src/stage/three/internal.ts 的 ModelSet）：换了小节算“显出来的东西变了”；
 * afloat 里的小节有船，水位一动也算变了；只是远近变了（模型的大小变了）不算。
 */
export function fakeKit(makeGroup: () => Group, afloat: readonly string[] = []): FakeKit {
  const contexts: KitContext[] = [];
  const applies: FakeKit['applies'] = [];
  const prepared: string[][] = [];
  let disposed = 0;
  return {
    contexts,
    applies,
    prepared,
    disposed: () => disposed,
    buildModels(ctx) {
      contexts.push(ctx);
      let shown = '';
      return {
        group: makeGroup(),
        apply(section, waterLevelM, viewDistanceM) {
          const key = afloat.includes(section) ? `${section}|${waterLevelM.toFixed(2)}` : section;
          const changed = key !== shown;
          shown = key;
          applies.push({ section, levelM: waterLevelM, D: viewDistanceM, changed });
          return changed;
        },
        prepare(sections) {
          prepared.push([...sections]);
          return Promise.resolve();
        },
        triangles: () => 0,
        dispose() {
          disposed += 1;
        },
      };
    },
  };
}

// ---------------------------------------------------------------- 题签层

/** 假的题签层记下的东西。 */
export interface FakeStrips {
  /** 顶替 mountStrips（写在 vi.mock 里）。 */
  mount(): StripLayer;
  /** 题签层收到的指令，按先后：'set 甲,乙'、'place'、'hide'、'only 某一条的 id'、'destroy'。连着几次 place 只记一次。 */
  log: string[];
  /** 最近一次换上的那批题签。 */
  specs(): StripSpec[];
  /** 每一次 place 收到的东西；moving 是这一次说没说“读者的手还在动”；avoid 是这一次给的不许压的那几块（没给就是 undefined）。 */
  places: { anchors: StripInput['anchors']; size: StripInput['size']; insets: StageInsets; moving: boolean; avoid: StripInput['avoid'] }[];
}

/** 假的题签层：什么也不摆，只记下沙盘叫它做了什么。 */
export function fakeStrips(): FakeStrips {
  const log: string[] = [];
  const places: FakeStrips['places'] = [];
  let specs: StripSpec[] = [];
  return {
    log,
    places,
    specs: () => specs,
    mount: () => ({
      set(strips) {
        specs = strips;
        log.push(`set ${strips.map((s) => s.text).join(',')}`);
      },
      place(anchors, size, insets, opts) {
        places.push({ anchors, size: { ...size }, insets: { ...insets }, moving: opts?.moving === true, avoid: opts?.avoid?.map((box) => ({ ...box })) });
        if (log[log.length - 1] !== 'place') log.push('place');
      },
      hide() {
        log.push('hide');
      },
      only(id) {
        specs = specs.filter((s) => s.id === id);
        log.push(`only ${id}`);
      },
      remeasure() {},
      destroy() {
        log.push('destroy');
      },
    }),
  };
}

// ---------------------------------------------------------------- 量

/** 一组东西下面的网格一共多少个三角形（成批摆的按摆了多少个算）。 */
export function trianglesUnder(root: Object3D): number {
  let n = 0;
  root.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh) return;
    const g = mesh.geometry;
    const each = (g.index ? g.index.count : g.attributes.position.count) / 3;
    n += each * ((o as InstancedMesh).isInstancedMesh ? (o as InstancedMesh).count : 1);
  });
  return n;
}
