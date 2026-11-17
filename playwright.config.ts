// 浏览器端到端测试。默认对着生产构建跑（端口 5400）。
// 开发时可以设环境变量 E2E_BASE_URL 指向自己已经起好的服务，这时不再另起服务。

import { defineConfig } from '@playwright/test';

// 这个项目没有装 Node 的类型声明，这里只取要用的那一点。
const proc = (globalThis as { process?: { env: Record<string, string | undefined>; platform?: string } }).process;
const env = proc?.env ?? {};
const externalBaseUrl = env.E2E_BASE_URL;
// 让无界面的浏览器也有 WebGL：Windows 上走 D3D11，别的系统（发布流程用的 Linux）走软件渲染。
const webglArgs =
  proc?.platform === 'win32'
    ? ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist']
    : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];

export default defineConfig({
  testDir: 'tests/e2e',
  outputDir: 'test-results',
  // 这台机器上 WebGL 很慢，一次只开一个浏览器。
  workers: 1,
  fullyParallel: false,
  // 发布流程里真地图那一项要连外面的地形和水系服务，偶尔会慢，失败时再试两次。
  retries: env.CI ? 2 : 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: 'list',
  use: {
    baseURL: externalBaseUrl ?? 'http://localhost:5400',
    browserName: 'chromium',
    headless: true,
    viewport: { width: 1440, height: 900 },
    launchOptions: {
      args: webglArgs,
    },
  },
  webServer: externalBaseUrl
    ? undefined
    : {
        command: 'npm run build && npx vite preview --port 5400 --strictPort',
        url: 'http://localhost:5400',
        reuseExistingServer: !env.CI,
        timeout: 180_000,
      },
});
