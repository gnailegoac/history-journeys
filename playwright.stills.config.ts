// 拍定格图的工具（npm run stills）用的配置：只跑 tests/tools/make-stills.spec.ts 这一个文件。
// 平常的浏览器测试（npm run test:e2e，用 playwright.config.ts）看不到它，它也不跑那些测试。
//
// 和浏览器测试不一样的地方：对着开发服务拍（自己在 5410 端口起一个），不对着生产构建——
// 拍照用的那一页（stage-dev.html）不在正式构建里。程序是同一份源文件，只是没有打包。
// 会打开一个浏览器：同一时刻只能开一个，不要和 npm run test:e2e、npm run bake 同时跑。
// 这个文件算在定格图的记号里（tests/support/programKey.ts）：这里的参数变了，存着的定格图就算旧的，要重拍。

import { defineConfig } from '@playwright/test';

// 这个项目没有装 Node 的类型声明，这里只取要用的那一点。
const proc = (globalThis as { process?: { env: Record<string, string | undefined>; platform?: string } }).process;
const env = proc?.env ?? {};
// 让无界面的浏览器也有 WebGL，和 playwright.config.ts 一样：Windows 上走 D3D11，别的系统走软件渲染。
// （照抄一份而不是从那边引：那个文件不算在定格图的记号里，这几个参数却决定画出来什么样。）
const webglArgs =
  proc?.platform === 'win32' && env.E2E_WEBGL !== 'swiftshader'
    ? ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist']
    : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];

export default defineConfig({
  testDir: 'tests/tools',
  testMatch: 'make-stills.spec.ts',
  outputDir: 'test-results/stills',
  // 没有显卡，WebGL 很慢，一次只开一个浏览器。
  workers: 1,
  fullyParallel: false,
  // 拍照不重试：拍不成就说拍不成，不要悄悄地多拍一遍
  retries: 0,
  // 一座沙盘十四张，一分钟上下；留得很宽，慢的机器也够
  timeout: 30 * 60_000,
  expect: { timeout: 20_000 },
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:5410',
    browserName: 'chromium',
    headless: true,
    launchOptions: {
      args: webglArgs,
    },
  },
  webServer: {
    command: 'npx vite --port 5410 --strictPort',
    url: 'http://localhost:5410',
    // 端口上已经有别的服务就不拍：不知道那是哪一份程序
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
