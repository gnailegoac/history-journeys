// 一张挂在页面上的地图：MapView 的 MapLibre GL JS 实现。

import { AttributionControl, Map as MlMap, type MapMouseEvent, type PointLike } from 'maplibre-gl';
import type { LngLat } from '../../domain/types';
import type { MapRoute, MapStop, MapView, MapViewOptions, NamesMode } from '../types';
import farWaterUrl from './data/far-water.json?url';
import { planFlight, stopDistanceScale, type Camera, type FlightPlan } from './flight';
import { angleDelta, clamp, haversineKm } from './geo';
import { drawStopIcon, placeFeatures, routeFeatures, spotKey, stopFeatures, stopIconName } from './markers';
import { FAR_HANDOVER, LAYER, baseStyle, osmWaterLayers, osmWaterSources, placeFilter, stopIconExpression, type OsmWater } from './style';
import { hasWebGL2 } from './support';
import { loadOsmWater } from './water';

const MIN_ZOOM = 1.5;
const MAX_ZOOM = 14.5;
const MAX_PITCH = 80;
/** 首个画面最多等这么久，过了就算失败。只算页面看得见的时间。 */
const READY_TIMEOUT_MS = 30000;
/** 地图容器不宽于这个数（像素）时，署名一开始就收起。和引擎自己判断“小地图”的宽度一致。 */
const COMPACT_ATTRIBUTION_MAX_WIDTH = 640;
/** 到站后等瓦片到齐，最多等这么久。 */
const SETTLE_MAX_MS = 10000;
/** 总览时轨迹四周至少留出的空白，像素。 */
const OVERVIEW_PADDING = 56;
/** 点击站点时允许的偏差，像素。手指比鼠标粗。 */
const CLICK_SLOP = 8;
const CONTAINER_CLASS = 'hj-map';

const EARTH_CIRCUMFERENCE_M = 40075016.686;
const rad = (deg: number) => (deg * Math.PI) / 180;
/** 缩放级别 0 时，一个像素在这个纬度上是多少米。 */
const metersPerPixelAtZoom0 = (lat: number) => (EARTH_CIRCUMFERENCE_M * Math.cos(rad(lat))) / 512;

/** 镜头要去的地方：总览，或第 index 站。 */
type Target = { kind: 'overview' } | { kind: 'stop'; index: number };

/** 一次镜头操作。新的操作开始时，旧的被取消，等着它的地方都会收到通知。 */
interface Operation {
  cancelled: boolean;
  onCancel: (() => void)[];
}

export class MapLibreView implements MapView {
  readonly ready: Promise<void>;

  private map: MlMap | null = null;
  private readonly container: HTMLElement;
  private readonly route: MapRoute;
  private readonly stops: MapStop[];
  private readonly reducedMotion: boolean;
  private namesMode: NamesMode;

  private destroyed = false;
  /** 首个画面已经可用。在这之前镜头只跳不飞。 */
  private loaded = false;
  private styleLoaded = false;
  private afterStyleLoad: (() => void)[] = [];

  /** “回到这一站”要回的地方。 */
  private target: Target = { kind: 'overview' };
  /** 镜头现在停在哪（读者自己挪动过也算还在那里）；正在飞或飞到一半被打断时为 null。 */
  private at: Target | null = { kind: 'overview' };
  private moved = false;
  private operation: Operation | null = null;

  private readonly selectListeners = new Set<(stopId: string) => void>();
  private readonly movedListeners = new Set<(moved: boolean) => void>();
  private readonly disposers: (() => void)[] = [];
  private settleReady: () => void = () => {};

  constructor(container: HTMLElement, route: MapRoute, options: MapViewOptions) {
    this.container = container;
    this.route = route;
    this.stops = route.stops;
    this.reducedMotion = options.reducedMotion;
    this.namesMode = options.namesMode;

    let fail: (error: Error) => void = () => {};
    this.ready = new Promise<void>((resolve, reject) => {
      this.settleReady = resolve;
      fail = reject;
    });
    // 界面没有接住失败时，不让浏览器再报一次“未处理的错误”
    this.ready.catch(() => {});

    if (!hasWebGL2()) {
      fail(new Error('这个浏览器不支持 WebGL2，显示不了三维地图'));
      return;
    }

    const stopData = stopFeatures(route);
    let map: MlMap;
    try {
      map = new MlMap({
        container,
        style: baseStyle({
          farWaterUrl: new URL(farWaterUrl, document.baseURI).href,
          route: routeFeatures(route),
          stopDots: stopData.dots,
          stopLabels: stopData.labels,
          places: placeFeatures(route),
          namesMode: this.namesMode,
          dotOffsets: stopData.offsets,
        }),
        center: route.overview.center,
        zoom: 3,
        minZoom: MIN_ZOOM,
        maxZoom: MAX_ZOOM,
        maxPitch: MAX_PITCH,
        attributionControl: false,
        // 中文用读者设备上的字体在浏览器里现画，不需要字体服务器
        localIdeographFontFamily: '"PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", "Noto Sans SC", "Source Han Sans SC", sans-serif',
        // 手机屏幕常是 3 倍像素，三维地形按 3 倍画太费，最多按 2 倍
        pixelRatio: Math.min(window.devicePixelRatio || 1, 2),
        locale: {
          'AttributionControl.ToggleAttribution': '数据来源',
          'AttributionControl.MapFeedback': '地图反馈',
          'Map.Title': '地图',
        },
      });
    } catch (error) {
      fail(error instanceof Error ? error : new Error(String(error)));
      return;
    }
    this.map = map;
    container.classList.add(CONTAINER_CLASS);
    map.jumpTo(this.presetCamera(this.target));
    map.addControl(
      new AttributionControl({
        compact: true,
        customAttribution: '<a href="https://maplibre.org/" target="_blank" rel="noopener">MapLibre</a>',
      }),
      'bottom-right',
    );
    // 地图窄的时候（手机、平板竖放），署名一开始就收成右下角的小按钮，点开才展开，
    // 不然会盖住半张地图和页面放在左下角的那行说明。宽的时候照常先展开。
    if (container.clientWidth <= COMPACT_ATTRIBUTION_MAX_WIDTH) {
      const attribution = container.querySelector('.maplibregl-ctrl-attrib');
      attribution?.removeAttribute('open');
      attribution?.classList.remove('maplibregl-compact-show');
    }

    // 引擎靠动画帧干活，页面在后台（或手机锁屏）时没有动画帧，首个画面出不来。
    // 所以只在页面看得见时计时：转到后台就停表，回来再从头计。
    let readyTimer = 0;
    const armReadyTimer = () => {
      window.clearTimeout(readyTimer);
      readyTimer = 0;
      if (document.visibilityState !== 'visible') return;
      readyTimer = window.setTimeout(() => {
        stopReadyTimer();
        fail(new Error('地图加载超时'));
      }, READY_TIMEOUT_MS);
    };
    const stopReadyTimer = () => {
      window.clearTimeout(readyTimer);
      document.removeEventListener('visibilitychange', armReadyTimer);
    };
    document.addEventListener('visibilitychange', armReadyTimer);
    armReadyTimer();
    this.disposers.push(stopReadyTimer);
    map.once('load', () => {
      stopReadyTimer();
      this.loaded = true;
      this.settleReady();
    });

    map.once('style.load', () => this.onStyleLoad());
    map.on('error', (event) => console.warn('[地图]', event.error?.message ?? event));
    map.on('click', (event) => this.onClick(event));
    map.on('mousemove', (event) => this.onMouseMove(event));
    // 带着原始输入事件的镜头变化，是读者自己用鼠标、手指或键盘动的
    map.on('move', (event) => {
      if (event.originalEvent) this.setMoved(true);
    });
    // 画面大小变了：同样的“离多远”对应的缩放级别也变了，镜头还停在预设位置时跟着调
    map.on('resize', () => {
      if (this.at && !this.moved) map.jumpTo(this.presetCamera(this.at));
    });

    // 读者一碰地图，就把镜头交还给读者
    const surface = map.getCanvasContainer();
    const takeOver = () => this.takeOver();
    for (const type of ['mousedown', 'touchstart', 'wheel', 'keydown'] as const) {
      surface.addEventListener(type, takeOver, { capture: true, passive: true });
      this.disposers.push(() => surface.removeEventListener(type, takeOver, { capture: true }));
    }

    void loadOsmWater().then((water) => {
      if (this.destroyed) return;
      if (!water) {
        console.warn('[地图] 详细水体的瓦片地址没有取到，近处的海改按高程画');
        return;
      }
      this.whenStyleLoaded(() => this.addOsmWater(water));
    });
  }

  // ---------------------------------------------------------------- 对外的接口

  showOverview(opts?: { animate?: boolean }): Promise<void> {
    return this.moveTo({ kind: 'overview' }, opts?.animate ?? true, false);
  }

  goToStop(stopId: string, opts?: { animate?: boolean }): Promise<void> {
    const index = this.stops.findIndex((s) => s.id === stopId);
    if (index < 0) return Promise.reject(new RangeError(`轨迹里没有这一站：${stopId}`));
    return this.moveTo({ kind: 'stop', index }, opts?.animate ?? true, false);
  }

  resetView(): Promise<void> {
    return this.moveTo(this.target, true, true);
  }

  setNamesMode(mode: NamesMode): void {
    this.namesMode = mode;
    this.syncNames();
  }

  onStopSelect(listener: (stopId: string) => void): () => void {
    this.selectListeners.add(listener);
    return () => void this.selectListeners.delete(listener);
  }

  onUserMoved(listener: (moved: boolean) => void): () => void {
    this.movedListeners.add(listener);
    return () => void this.movedListeners.delete(listener);
  }

  resize(): void {
    this.map?.resize();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.cancelOperation();
    for (const dispose of this.disposers.splice(0)) dispose();
    this.afterStyleLoad = [];
    this.selectListeners.clear();
    this.movedListeners.clear();
    // remove() 会摘掉引擎自己的监听、停掉渲染循环并释放 WebGL 上下文
    this.map?.remove();
    this.map = null;
    this.container.classList.remove(CONTAINER_CLASS);
    // 还没等到首个画面就卸载了：让等着的地方结束，不算失败
    this.settleReady();
  }

  /** 引擎的地图对象。只给开发用的测试页（map-dev.html）用，界面不要碰。 */
  get engineMap(): MlMap | null {
    return this.map;
  }

  // ---------------------------------------------------------------- 镜头

  /** 画面中心到镜头的距离，像素。由画面高度和视角决定。 */
  private cameraToCenterPx(): number {
    const map = this.map;
    const height = Math.max(1, this.container.clientHeight);
    const fov = map ? map.getVerticalFieldOfView() : 36.87;
    return (0.5 * height) / Math.tan(rad(fov / 2));
  }

  /** 镜头离所看的点 meters 米时的缩放级别。 */
  private zoomForDistance(meters: number, lat: number): number {
    return Math.log2((this.cameraToCenterPx() * metersPerPixelAtZoom0(lat)) / meters);
  }

  private presetCamera(target: Target): Camera {
    if (target.kind === 'overview') return this.overviewCamera();
    const stop = this.stops[target.index];
    // 地图小的时候拉近一些，这一站周围的地名才摆得开
    const meters = stop.camera.distanceKm * 1000 * stopDistanceScale(this.container.clientWidth, this.container.clientHeight);
    return {
      center: [stop.lngLat[0], stop.lngLat[1]],
      zoom: clamp(this.zoomForDistance(meters, stop.lngLat[1]), MIN_ZOOM, MAX_ZOOM),
      pitch: clamp(stop.camera.pitch, 0, MAX_PITCH),
      bearing: stop.camera.bearing,
    };
  }

  /** 总览：按数据里给的距离看；画面太窄、轨迹放不下时再退远一些，直到整条轨迹都在画面里。 */
  private overviewCamera(): Camera {
    const { center, distanceKm } = this.route.overview;
    const kmPerDegLng = 111.32 * Math.cos(rad(center[1]));
    let halfWidthKm = 0;
    let halfHeightKm = 0;
    const include = (p: LngLat) => {
      halfWidthKm = Math.max(halfWidthKm, Math.abs(angleDelta(center[0], p[0])) * kmPerDegLng);
      halfHeightKm = Math.max(halfHeightKm, Math.abs(p[1] - center[1]) * 110.57);
    };
    for (const stop of this.stops) include(stop.lngLat);
    for (const leg of this.route.legs) for (const p of leg.path) include(p);
    const halfWidthPx = Math.max(40, this.container.clientWidth / 2 - OVERVIEW_PADDING);
    const halfHeightPx = Math.max(40, this.container.clientHeight / 2 - OVERVIEW_PADDING);
    const kmPerPx = Math.max(halfWidthKm / halfWidthPx, halfHeightKm / halfHeightPx);
    const zoomByDistance = this.zoomForDistance(distanceKm * 1000, center[1]);
    const zoomToFit = kmPerPx > 0 ? Math.log2(metersPerPixelAtZoom0(center[1]) / (kmPerPx * 1000)) : zoomByDistance;
    return {
      center: [center[0], center[1]],
      zoom: clamp(Math.min(zoomByDistance, zoomToFit), MIN_ZOOM, MAX_ZOOM),
      pitch: 0,
      bearing: 0,
    };
  }

  private currentCamera(map: MlMap): Camera {
    const c = map.getCenter();
    return { center: [c.lng, c.lat], zoom: map.getZoom(), pitch: map.getPitch(), bearing: map.getBearing() };
  }

  /**
   * 镜头中心在地面上走哪条路。
   * 从一站去相邻的一站，而且镜头还在那一站附近：沿这一段轨迹走。别的情况：直线过去。
   */
  private groundPath(from: Camera, fromAt: Target | null, target: Target, to: Camera): LngLat[] {
    if (target.kind === 'stop' && fromAt?.kind === 'stop' && Math.abs(fromAt.index - target.index) === 1) {
      const here = this.stops[fromAt.index];
      const first = Math.min(fromAt.index, target.index);
      const leg = this.route.legs[first];
      const legMatches = leg && leg.from === this.stops[first].id && leg.to === this.stops[first + 1].id && leg.path.length >= 2;
      const nearby = haversineKm(from.center, here.lngLat) <= Math.max(2 * here.camera.distanceKm, 30);
      if (legMatches && nearby) {
        const path = target.index > fromAt.index ? leg.path : [...leg.path].reverse();
        return [from.center, ...path, to.center];
      }
    }
    return [from.center, to.center];
  }

  /**
   * 所有镜头移动都走这里。quick 为 true 是“回到这一站”的归位。
   * 被新的操作或读者的手势打断时照常完成（不拒绝）。
   */
  private async moveTo(target: Target, animate: boolean, quick: boolean): Promise<void> {
    const map = this.map;
    if (!map || this.destroyed) return;
    const operation = this.beginOperation();
    try {
      const from = this.currentCamera(map);
      const fromAt = this.at;
      this.target = target;
      this.at = null;
      // 镜头交给程序了，“读者动过”从这里重新算起：途中读者再碰地图，才会再通知一次
      this.setMoved(false);
      this.syncCurrentStop();

      if (animate && !this.reducedMotion && this.loaded) {
        const to = this.presetCamera(target);
        const points = quick ? [from.center, to.center] : this.groundPath(from, fromAt, target, to);
        const plan = planFlight(from, to, points, {
          zoomForDistanceKm: (km, lat) => this.zoomForDistance(km * 1000, lat),
          quick,
        });
        const arrived = await this.fly(map, operation, plan);
        if (!arrived) return;
      }
      // 终点重新算一遍：飞行途中画面大小可能变过
      map.jumpTo(this.presetCamera(target));
      this.at = target;
      this.setMoved(false);
      await this.settled(map, operation);
    } catch (error) {
      console.warn('[地图] 镜头移动出错', error);
    } finally {
      if (this.operation === operation) this.operation = null;
    }
  }

  /** 按计划每帧摆一次镜头。飞完返回 true，被打断返回 false。 */
  private fly(map: MlMap, operation: Operation, plan: FlightPlan): Promise<boolean> {
    return new Promise((resolve) => {
      const start = performance.now();
      let frameId = 0;
      // 页面在后台时浏览器不给动画帧：到点后由定时器收尾，免得一直等下去
      const watchdog = window.setTimeout(() => finish(true), plan.durationMs + 1500);
      const finish = (arrived: boolean) => {
        cancelAnimationFrame(frameId);
        window.clearTimeout(watchdog);
        resolve(arrived);
      };
      operation.onCancel.push(() => finish(false));
      const frame = () => {
        if (operation.cancelled) return;
        const s = clamp((performance.now() - start) / plan.durationMs, 0, 1);
        map.jumpTo(plan.at(s));
        if (s >= 1) finish(true);
        else frameId = requestAnimationFrame(frame);
      };
      frameId = requestAnimationFrame(frame);
    });
  }

  /** 等瓦片到齐、画面不再变化。最多等 SETTLE_MAX_MS；操作被取消时立刻结束。 */
  private settled(map: MlMap, operation: Operation): Promise<void> {
    return new Promise((resolve) => {
      const done = () => {
        window.clearTimeout(timer);
        map.off('idle', done);
        resolve();
      };
      const timer = window.setTimeout(done, SETTLE_MAX_MS);
      operation.onCancel.push(done);
      map.on('idle', done);
      map.triggerRepaint();
    });
  }

  private beginOperation(): Operation {
    this.cancelOperation();
    const operation: Operation = { cancelled: false, onCancel: [] };
    this.operation = operation;
    return operation;
  }

  private cancelOperation(): void {
    const operation = this.operation;
    if (!operation) return;
    this.operation = null;
    operation.cancelled = true;
    for (const notify of operation.onCancel.splice(0)) notify();
  }

  /** 读者碰了地图。正在飞就停下，镜头留在半路，算读者动过。 */
  private takeOver(): void {
    if (!this.operation) return;
    const flying = this.at === null;
    this.cancelOperation();
    if (flying) this.setMoved(true);
  }

  private setMoved(moved: boolean): void {
    if (this.moved === moved) return;
    this.moved = moved;
    for (const listener of [...this.movedListeners]) listener(moved);
  }

  // ---------------------------------------------------------------- 样式里随状态变的部分

  private whenStyleLoaded(action: () => void): void {
    if (this.styleLoaded) action();
    else this.afterStyleLoad.push(action);
  }

  private onStyleLoad(): void {
    const map = this.map;
    if (!map) return;
    this.styleLoaded = true;
    const pixelRatio = Math.min(Math.ceil(window.devicePixelRatio || 1), 3);
    for (const stop of this.stops) {
      for (const current of [false, true]) {
        const name = stopIconName(stop.order, current);
        const image = map.hasImage(name) ? null : drawStopIcon(stop.order, current, pixelRatio);
        if (image) map.addImage(name, image, { pixelRatio });
      }
    }
    this.syncNames();
    this.syncCurrentStop();
    for (const action of this.afterStyleLoad.splice(0)) action();
  }

  private syncNames(): void {
    const map = this.map;
    if (!map || !this.styleLoaded) return;
    for (const layer of [LAYER.stopLabels, LAYER.placeLabels]) map.setLayoutProperty(layer, 'text-field', ['get', this.namesMode]);
  }

  /** 当前这一站的圆点大一号；站内地点只显示当前这一站的。 */
  private syncCurrentStop(): void {
    const map = this.map;
    if (!map || !this.styleLoaded) return;
    const id = this.target.kind === 'stop' ? this.stops[this.target.index].id : '';
    map.setLayoutProperty(LAYER.stopDots, 'icon-image', stopIconExpression(id));
    map.setFilter(LAYER.placeDots, placeFilter(id));
    map.setFilter(LAYER.placeLabels, placeFilter(id));
  }

  /** 加上详细水体，并让远景的海、湖、河在近处让位。 */
  private addOsmWater(water: OsmWater): void {
    const map = this.map;
    if (!map) return;
    try {
      for (const [id, source] of Object.entries(osmWaterSources(water))) map.addSource(id, source);
      const { fills, lines } = osmWaterLayers();
      for (const layer of fills) map.addLayer(layer, LAYER.seaDepth);
      for (const layer of lines) map.addLayer(layer, LAYER.routeCasing);
      map.setPaintProperty(LAYER.seaFar, 'color-relief-opacity', FAR_HANDOVER.seaOpacity);
      map.setPaintProperty(LAYER.farLakes, 'fill-opacity', FAR_HANDOVER.lakeOpacity);
      map.setPaintProperty(LAYER.farRivers, 'line-opacity', FAR_HANDOVER.riverOpacity);
      for (const layer of [LAYER.seaFar, LAYER.farLakes, LAYER.farRivers]) map.setLayerZoomRange(layer, 0, FAR_HANDOVER.maxzoom);
    } catch (error) {
      console.warn('[地图] 详细水体没有加上', error);
    }
  }

  // ---------------------------------------------------------------- 点击站点

  /**
   * 点击位置上的站点。先看正好点中的（同一个地点并排的几个圆点靠这个分开），
   * 没有再放宽 slop 个像素；圆点比站名优先。
   */
  private stopNear(map: MlMap, point: { x: number; y: number }, slop: number): string | null {
    if (!this.styleLoaded) return null;
    const layers = [LAYER.stopDots, LAYER.stopLabels];
    const pick = (hits: { layer: { id: string }; properties?: Record<string, unknown> | null }[]): string | null => {
      const hit = hits.find((h) => h.layer.id === LAYER.stopDots) ?? hits[0];
      const id = hit?.properties?.id;
      if (typeof id !== 'string') return null;
      return hit?.layer.id === LAYER.stopLabels ? this.stopForLabel(id) : id;
    };
    const exact = pick(map.queryRenderedFeatures([point.x, point.y], { layers }));
    if (exact || slop <= 0) return exact;
    const box: [PointLike, PointLike] = [
      [point.x - slop, point.y - slop],
      [point.x + slop, point.y + slop],
    ];
    return pick(map.queryRenderedFeatures(box, { layers }));
  }

  /**
   * 点中站名时算哪一站。同一个地点的几站共用一个站名，站名上记的是其中第一站：
   * 镜头正在其中某一站时算这一站，否则算第一站。
   */
  private stopForLabel(id: string): string {
    if (this.target.kind !== 'stop') return id;
    const current = this.stops[this.target.index];
    const first = this.stops.find((s) => s.id === id);
    return first && spotKey(first) === spotKey(current) ? current.id : id;
  }

  private onClick(event: MapMouseEvent): void {
    const map = this.map;
    if (!map) return;
    const id = this.stopNear(map, event.point, CLICK_SLOP);
    if (id) for (const listener of [...this.selectListeners]) listener(id);
  }

  private onMouseMove(event: MapMouseEvent): void {
    const map = this.map;
    if (!map) return;
    map.getCanvas().style.cursor = this.stopNear(map, event.point, 0) ? 'pointer' : '';
  }
}
