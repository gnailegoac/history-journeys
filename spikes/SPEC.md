# 引擎验证：标准

目的：用同一个最小场景，分别在 MapLibre GL JS 和 CesiumJS 上实现，实测后决定全站用哪一个三维地图引擎。背景见 `docs/overall-design.md` 的“地图”一节和 `docs/technical-plan.md`。

这是验证，不是产品代码。做完之后两个场景里至多留一个的思路，代码本身不会直接进入正式工程。

## 场景

一个全屏的三维地图页面，数据全部来自 `spikes/shared/route.json`（不要改这个文件，也不要另造数据）：

1. 打开时从地球上看苏轼的整条轨迹（八站加途经点）。
2. 点某一站，镜头沿轨迹飞到那里，按该站的 `camera` 停在当地的三维地形上。
3. 能切到 `viewpoints` 里的几个检验视角（三峡夔门、黄州近景、大庾岭）。
4. 站点和黄州的 `localPlaces` 有地名，可在古名与今名之间切换。
5. 用户可以自己转动、倾斜、缩放，有一个“回到这一站”的按钮。

界面只要一个很小的面板：八站按钮、检验视角按钮、古今地名切换、“回到这一站”。界面文字用中文。不做正文、不做首页。

## 验收条目

| 编号 | 条目 | 怎样算通过 |
|---|---|---|
| C1 | 地球到山谷连续 | 从地球视图连续缩放到一条山谷的尺度（能看清几公里范围），中间没有换模式的跳变或黑屏 |
| C2 | 真实地形立体 | 在三峡夔门和大庾岭视角（倾角不小于 60 度）山体明显立起来，能看出峡谷和山口；黄州近景能看出江和对岸的山。写明用了多少倍的地形夸张 |
| C3 | 轨迹贴地 | 轨迹线贴着地形走，从地球上和近处都看得见，不悬空也不被地面吞掉 |
| C4 | 镜头飞行 | `flyToStop` 从当前站沿轨迹（经过途经点）平滑飞到目标站，时长 4 到 10 秒，没有瞬移 |
| C5 | 地名 | 地名立在地面上、始终朝向读者；目标站在画面内时地名不被地形挡住；古今切换有效；中文显示正常 |
| C6 | 自然底图 | 底图只有自然地貌（地形明暗、按高程着色或自然色、水体）。不出现现代道路、城市、现代国界和外文地名 |
| C7 | 自由操作 | 鼠标和触摸都能转动、倾斜、缩放；“回到这一站”能回到该站的预设镜头 |
| C8 | 性能 | 报告实测数字，不许估计：首个可用画面的时间、飞行过程的平均和最低帧率、整段巡览的瓦片请求数和传输字节数、WebGL 渲染器名称。暂定指标（待负责人确认）：电脑上首个可用画面不超过 5 秒，硬件加速下飞行平均不低于 30 帧 |
| C9 | 无账号无密钥 | 不使用任何需要注册、令牌或密钥的服务。列出每个数据源的地址和使用条款 |
| C10 | 体积 | 报告生产构建后 JS 和 CSS 的体积（压缩前与 gzip 后） |

做不到的条目如实写“未通过”或“部分通过”并说明原因。这本身就是验证要得到的结论，不要为了通过而作假或绕开。

## 自动检查用的接口

页面必须在 `window.__spike` 上提供：

```ts
interface SpikeApi {
  engine: { name: string; version: string };
  ready: Promise<void>;                       // 首个视图渲染完成、地形已加载
  stops: { id: string; title: string }[];
  viewpoints: { id: string; label: string }[];
  flyToStop(index: number): Promise<void>;    // 到达且画面稳定后才结束
  goToViewpoint(id: string): Promise<void>;
  setNames(mode: 'ancient' | 'modern'): void;
  resetView(): void;
  getState(): { lngLat: [number, number]; pitch: number; bearing: number; stopIndex: number | null; namesMode: string };
  fpsReset(): void;
  fps(): { avg: number; min: number; samples: number };   // 自上次 fpsReset 以来
  webglRenderer(): string;                    // UNMASKED_RENDERER_WEBGL，取不到时返回空字符串
}
```

## 约束

- 只在自己的文件夹里写文件：`spikes/maplibre/` 或 `spikes/cesium/`。不改 `spikes/shared/`、`docs/` 和对方的文件夹。
- 用 Vite 加 TypeScript，不用界面框架。引擎用当前最新的正式版本。
- 不提交 git，不推送。
- 已核实本机网络可以访问的开放服务（2026-11-17）：
  - `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png`（开放高程瓦片，Terrarium 编码）
  - `https://elevation3d.arcgis.com/arcgis/rest/services/WorldElevation3D/Terrain3D/ImageServer`（ArcGIS 全球高程服务）
  - `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer`（卫星影像，只可作对照，不符合 C6）
  - `https://cdn.jsdelivr.net/npm/world-atlas@2/`（Natural Earth 陆地轮廓）
  用别的数据源可以，但要先确认能访问、无需密钥，并写进说明。
- 浏览器实测用 Playwright，版本固定为 `@playwright/test@1.65.0`（它对应的 Chromium 装在用户目录的 `AppData\Local\ms-playwright` 下；如果启动时报找不到浏览器，先运行 `npx playwright install chromium`）。无界面模式运行，不要弹出窗口。启动参数加上 `--use-angle=d3d11 --enable-gpu --ignore-gpu-blocklist`，并在数据里记下实际的 WebGL 渲染器，这样帧率才有解释的依据。
- 内存与清理：不写没有上限的循环或会无限分配内存的脚本；每个浏览器脚本都要有超时；结束前关掉自己起的服务和浏览器进程，并确认端口已释放。
- 网络搜索和文档查询只用通用的技术关键词，不带任何与本项目或其负责人有关的信息。

## 交付物（都放在自己的文件夹里）

- 可运行的工程：`npm install` 后 `npm run dev` 能打开，`npm run build` 能构建。
- `shots/`：`globe.png`、`sanxia.png`、`huangzhou-close.png`、`dayuling.png`、`stop-huangzhou.png`、`flight-mid.png`（飞行途中）、`names-ancient.png`、`names-modern.png`，桌面视口 1440×900。
- `metrics.json`：C8 和 C10 的实测数字，以及测量时的环境。
- `NOTES.md`（中文）：用了哪些数据源及条款、每个验收条目的结论和证据、遇到的限制、这个引擎用于本项目的利弊、怎样运行。
