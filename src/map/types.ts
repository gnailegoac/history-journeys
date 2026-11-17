// 地图适配层的接口。界面只通过这里和地图说话，不直接碰地图引擎。
// 换引擎时只需要另写一个 MapEngine。

import type { CameraPreset, LngLat } from '../domain/types';

export type NamesMode = 'ancient' | 'modern';

/** 地图需要的一位人物的全部数据，由 domain 层的 toMapRoute() 生成。 */
export interface MapRoute {
  overview: { center: LngLat; distanceKm: number };
  stops: MapStop[];
  /** legs[i] 是从 stops[i] 到 stops[i+1] 的路，path 含两端。 */
  legs: { from: string; to: string; path: LngLat[] }[];
  /** 各站站内的地点。只在镜头停在那一站时显示。 */
  places: MapPlace[];
}

export interface MapStop {
  id: string;
  /** 第几站，从 1 开始。 */
  order: number;
  ancient: string;
  modern: string;
  lngLat: LngLat;
  camera: CameraPreset;
}

export interface MapPlace {
  id: string;
  stopId: string;
  ancient: string;
  modern: string;
  lngLat: LngLat;
}

export interface MapViewOptions {
  namesMode: NamesMode;
  /** 用户系统设置了“减少动态效果”时为 true：镜头直接切换，不飞。 */
  reducedMotion: boolean;
}

/** 一张挂在页面上的地图。 */
export interface MapView {
  /** 首个画面可用（地形已加载）时完成。失败时拒绝，界面显示替代说明。 */
  readonly ready: Promise<void>;

  /**
   * 从地球上看整条轨迹。
   * showOverview 和 goToStop 在 ready 完成之前就可以调用：这时镜头直接摆到位，不飞。
   */
  showOverview(opts?: { animate?: boolean }): Promise<void>;

  /**
   * 镜头去某一站，停在该站的预设位置。
   * 当前已在另一站时，沿轨迹飞过去（经过途经点）；当前在总览时，直接降下去。
   * 到达且画面稳定后完成。飞行途中再次调用时，放弃旧的，改飞新的。
   * 被放弃的那一次调用照常完成（不拒绝）。只有站的 id 不存在时才拒绝。
   */
  goToStop(stopId: string, opts?: { animate?: boolean }): Promise<void>;

  /** “回到这一站”：回到当前这一站（或总览）的预设镜头。 */
  resetView(): Promise<void>;

  setNamesMode(mode: NamesMode): void;

  /** 用户点了地图上的某一站。返回取消订阅的函数。 */
  onStopSelect(listener: (stopId: string) => void): () => void;

  /**
   * 用户自己动过镜头（true），或者镜头开始去往、已经回到预设位置（false）。用来决定“回到这一站”按钮是否可用。
   * 只在这个值变了的时候通知；一开始是 false，不另行通知。
   */
  onUserMoved(listener: (moved: boolean) => void): () => void;

  /** 容器大小变了。 */
  resize(): void;

  destroy(): void;
}

export interface MapEngine {
  readonly name: string;
  readonly version: string;
  /** 这个浏览器能不能用（需要 WebGL2）。 */
  isSupported(): boolean;
  create(container: HTMLElement, route: MapRoute, options: MapViewOptions): MapView;
}
