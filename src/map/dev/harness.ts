// 地图测试页（map-dev.html）：只挂一张全窗口的地图和几个小按钮，用来单独检查地图适配层。
// 不属于正式构建。按钮只用 MapView 接口里的东西，和正式页面的用法一样。

import figureJson from '../../../content/figures/su-shi/figure.json';
import { toMapRoute } from '../../domain/route';
import type { Figure } from '../../domain/types';
import { MAP_DATA_NOTICE, loadMapEngine } from '../index';
import type { MapView, NamesMode } from '../types';

const figure = figureJson as unknown as Figure;
const route = toMapRoute(figure);
const params = new URLSearchParams(location.search);

const container = document.getElementById('map') as HTMLElement;
const bar = document.getElementById('bar') as HTMLElement;
const status = document.getElementById('status') as HTMLElement;

let view: MapView | null = null;
let namesMode: NamesMode = params.get('names') === 'modern' ? 'modern' : 'ancient';
/** 当前在哪：null 是全程。 */
let currentStopId: string | null = null;
let moved = false;

/** 给自动测试脚本看的记录，只留最近的一些。 */
const log = { moved: [] as boolean[], selected: [] as string[] };
const keep = <T>(list: T[], item: T) => {
  list.push(item);
  if (list.length > 100) list.shift();
};

function button(text: string, onClick: () => void, options: { active?: boolean; disabled?: boolean; id?: string } = {}): HTMLButtonElement {
  const b = document.createElement('button');
  b.textContent = text;
  if (options.id) b.dataset.id = options.id;
  b.classList.toggle('active', Boolean(options.active));
  b.disabled = Boolean(options.disabled);
  b.addEventListener('click', onClick);
  return b;
}

function gap(): HTMLElement {
  const g = document.createElement('span');
  g.className = 'gap';
  return g;
}

function goTo(stopId: string | null): void {
  currentStopId = stopId;
  render();
  if (stopId === null) void view?.showOverview();
  else void view?.goToStop(stopId);
}

function setNames(mode: NamesMode): void {
  namesMode = mode;
  view?.setNamesMode(mode);
  render();
}

function render(): void {
  bar.replaceChildren(
    button('全程', () => goTo(null), { active: currentStopId === null, id: 'overview' }),
    ...figure.stops.map((s, i) => button(`${i + 1} ${s.shortTitle}`, () => goTo(s.id), { active: s.id === currentStopId, id: s.id })),
    gap(),
    button('古名', () => setNames('ancient'), { active: namesMode === 'ancient', id: 'ancient' }),
    button('今名', () => setNames('modern'), { active: namesMode === 'modern', id: 'modern' }),
    gap(),
    button('回到这一站', () => void view?.resetView(), { disabled: !moved, id: 'reset' }),
  );
}

async function mount(): Promise<void> {
  const engine = await loadMapEngine();
  status.textContent = `${engine.name} ${engine.version} · ${MAP_DATA_NOTICE}`;
  const created = engine.create(container, route, {
    namesMode,
    reducedMotion: params.has('reduced') || window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  });
  view = created;
  created.onStopSelect((stopId) => {
    keep(log.selected, stopId);
    goTo(stopId);
  });
  created.onUserMoved((value) => {
    moved = value;
    keep(log.moved, value);
    render();
  });
  if (currentStopId) void created.goToStop(currentStopId, { animate: false });
  try {
    await created.ready;
  } catch (error) {
    status.textContent = `地图没有加载成功：${error instanceof Error ? error.message : String(error)}`;
    throw error;
  }
}

function unmount(): void {
  view?.destroy();
  view = null;
  moved = false;
  render();
}

render();
const ready = mount();
ready.catch(() => {});

const dev = {
  ready,
  route,
  log,
  get view() {
    return view;
  },
  /** 引擎的地图对象，只给测试脚本摆镜头、读状态用。 */
  get map() {
    return (view as { engineMap?: unknown } | null)?.engineMap ?? null;
  },
  get moved() {
    return moved;
  },
  mount,
  unmount,
};

declare global {
  interface Window {
    __mapDev: typeof dev;
  }
}
window.__mapDev = dev;
