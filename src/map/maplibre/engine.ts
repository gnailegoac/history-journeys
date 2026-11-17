// MapLibre GL JS 的地图引擎。整个项目里只有 src/map/maplibre/ 这个目录接触引擎。
// 这个文件由 src/map/index.ts 用动态 import 加载；样式表也在这里引入，界面不用另外引。

import 'maplibre-gl/dist/maplibre-gl.css';
import './map.css';
import { getVersion, setWorkerUrl } from 'maplibre-gl';
// 6.x 只有 ES 模块；配合打包工具时，要把 worker 文件的地址明确告诉它
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import type { MapEngine } from '../types';
import { hasWebGL2 } from './support';
import { MapLibreView } from './view';

setWorkerUrl(workerUrl);

export const engine: MapEngine = {
  name: 'MapLibre GL JS',
  version: getVersion(),
  isSupported: hasWebGL2,
  create: (container, route, options) => new MapLibreView(container, route, options),
};
