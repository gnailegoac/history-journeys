// 浏览器端到端测试。默认对着生产构建跑（端口 5400）。
// 开发时可以设环境变量 E2E_BASE_URL 指向自己已经起好的服务，这时不再另起服务。

import { defineConfig } from '@playwright/test';

// 这个项目没有装 Node 的类型声明，这里只取要用的那一点。
const proc = (globalThis as { process?: { env: Record<string, string | undefined>; platform?: string } }).process;
const env = proc?.env ?? {};
const externalBaseUrl = env.E2E_BASE_URL;
// 让无界面的浏览器也有 WebGL（沙盘要用）：Windows 上走 D3D11，别的系统（发布流程用的 Linux）走软件渲染。
// 想在 Windows 上试一试发布流程那种软件渲染有多慢，设环境变量 E2E_WEBGL=swiftshader。
const webglArgs =
  proc?.platform === 'win32' && env.E2E_WEBGL !== 'swiftshader'
    ? ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist']
    : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];

export default defineConfig({
  testDir: 'tests/e2e',
  outputDir: 'test-results',
  // 开发机和发布流程的机器都没有显卡，WebGL 很慢，一次只开一个浏览器。
  workers: 1,
  fullyParallel: false,
  // 发布流程里真沙盘那一项是用软件渲染画的，偶尔会慢到超时，失败时再试两次。（页面打开以后不连任何外面的服务。）
  retries: env.CI ? 2 : 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  // 在 GitHub 的流水线里多出一份标注：哪一项失败、失败在哪一行，不用下载日志就看得到。
  reporter: env.GITHUB_ACTIONS ? [['list'], ['github']] : 'list',
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
