// 地图的替身：不用 WebGL，只用普通的页面元素。每一站一个点，当前这一站标出来，点可以点。
// 自动测试通过 ?map=fake 用它；它把收到的指令写在自己的 data- 属性上，测试据此判断。

import type { MapEngine, MapRoute, MapView, MapViewOptions, NamesMode } from '../../map/types';
import '../../styles/fake-map.css';

const FLIGHT_MS = 120;

export function createFakeMapEngine(config: { fail?: boolean } = {}): MapEngine {
  return {
    name: 'fake',
    version: '0',
    isSupported: () => true,
    create: (container, route, options) => (config.fail ? createFailedView() : createFakeView(container, route, options)),
  };
}

function createFailedView(): MapView {
  const never = () => Promise.reject(new Error('替身地图：按要求起不来'));
  const ready = never();
  ready.catch(() => {});
  return {
    ready,
    showOverview: never,
    goToStop: never,
    resetView: never,
    setNamesMode: () => {},
    onStopSelect: () => () => {},
    onUserMoved: () => () => {},
    resize: () => {},
    destroy: () => {},
  };
}

function createFakeView(container: HTMLElement, route: MapRoute, options: MapViewOptions): MapView {
  const selectListeners = new Set<(stopId: string) => void>();
  const movedListeners = new Set<(moved: boolean) => void>();
  let namesMode: NamesMode = options.namesMode;
  let current: string | null = null;
  let moved = false;
  let resizes = 0;
  let timer: number | undefined;
  let destroyed = false;

  const root = document.createElement('div');
  root.className = 'fake-map';
  root.dataset.fakeReducedMotion = String(options.reducedMotion);

  // 把经纬度按各站的范围摊到方框里，只求点的相对位置对。
  const lngs = route.stops.map((s) => s.lngLat[0]);
  const lats = route.stops.map((s) => s.lngLat[1]);
  const [west, east] = [Math.min(...lngs), Math.max(...lngs)];
  const [south, north] = [Math.min(...lats), Math.max(...lats)];
  const spread = (value: number, low: number, high: number) => (high > low ? (value - low) / (high - low) : 0.5);

  const dots = route.stops.map((stop) => {
    const dot = document.createElement('button');
    dot.type = 'button';
    dot.className = 'fake-map-dot';
    dot.dataset.stopId = stop.id;
    dot.style.left = `${12 + 76 * spread(stop.lngLat[0], west, east)}%`;
    dot.style.top = `${82 - 60 * spread(stop.lngLat[1], south, north)}%`;
    dot.addEventListener('click', () => selectListeners.forEach((listener) => listener(stop.id)));
    root.append(dot);
    return { stop, dot };
  });

  // 替身上没法拖动，用这个按钮代替“读者自己动了镜头”。
  const nudge = document.createElement('button');
  nudge.type = 'button';
  nudge.className = 'fake-map-nudge';
  nudge.textContent = '替身地图：挪一下镜头';
  nudge.addEventListener('click', () => setMoved(true));
  root.append(nudge);

  container.append(root);

  // 和真地图一样：只有“动过没有”变了才通知。
  function setMoved(value: boolean) {
    if (moved === value) return;
    moved = value;
    root.dataset.fakeMoved = String(value);
    movedListeners.forEach((listener) => listener(value));
  }

  function paint() {
    root.dataset.fakeView = current ? 'stop' : 'overview';
    root.dataset.fakeStop = current ?? '';
    root.dataset.fakeNames = namesMode;
    root.dataset.fakeResizes = String(resizes);
    for (const { stop, dot } of dots) {
      dot.textContent = `${stop.order} ${namesMode === 'ancient' ? stop.ancient : stop.modern}`;
      if (stop.id === current) dot.setAttribute('aria-current', 'true');
      else dot.removeAttribute('aria-current');
    }
  }

  // 镜头去一个地方；途中又来新的指令时，旧的那次不再完成。
  // 和真地图一样：一开始走就不算读者动过，到了以后也不算。
  function moveTo(stopId: string | null, animate: boolean): Promise<void> {
    if (destroyed) return Promise.reject(new Error('替身地图已经关掉'));
    window.clearTimeout(timer);
    setMoved(false);
    const wait = animate && !options.reducedMotion ? FLIGHT_MS : 0;
    root.dataset.fakeAnimated = String(wait > 0);
    return new Promise((resolve) => {
      timer = window.setTimeout(() => {
        current = stopId;
        paint();
        setMoved(false);
        resolve();
      }, wait);
    });
  }

  paint();
  root.dataset.fakeMoved = 'false';

  return {
    ready: new Promise((resolve) => window.setTimeout(resolve, 0)),
    showOverview: (opts) => moveTo(null, opts?.animate ?? true),
    goToStop: (stopId, opts) => {
      if (!route.stops.some((s) => s.id === stopId)) return Promise.reject(new Error(`没有这一站：${stopId}`));
      return moveTo(stopId, opts?.animate ?? true);
    },
    resetView: () => moveTo(current, true),
    setNamesMode: (mode) => {
      namesMode = mode;
      paint();
    },
    onStopSelect: (listener) => {
      selectListeners.add(listener);
      return () => selectListeners.delete(listener);
    },
    onUserMoved: (listener) => {
      movedListeners.add(listener);
      return () => movedListeners.delete(listener);
    },
    resize: () => {
      resizes += 1;
      root.dataset.fakeResizes = String(resizes);
    },
    destroy: () => {
      destroyed = true;
      window.clearTimeout(timer);
      selectListeners.clear();
      movedListeners.clear();
      root.remove();
    },
  };
}
