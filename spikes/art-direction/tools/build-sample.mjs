// 把“设色”样张（b：徐州一站的沙盘）打成一份不用开发服务、放在子目录里也能打开的静态文件，
// 写到网站的 public/samples/shese-xuzhou/ 下面；网站构建时 public/ 会原样拷进 dist/。
//
//   node spikes/art-direction/tools/build-sample.mjs      （在项目根目录下跑）
//
// 出来的东西：
//   index.html            一打开就转到 b/index.html?meter=1（带测速的站点页）
//   b/index.html          站点页
//   b/home.html           首页
//   assets/               打好的脚本和样式（three 也在里面）
//   shared/               页面打开以后才去取的数据（地形、正文、小注、人物）
// b/ 和 shared/ 还是并排放着，页面里写的 ../shared/... 不用改。
//
// vite 用的是项目根目录 node_modules 里的那一份（这个文件夹里没有装 vite，往上找就找到它）。

import { build } from 'vite';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const sampleRoot = path.resolve(here, '..');
const projectRoot = path.resolve(here, '../../..');
const outDir = path.join(projectRoot, 'public', 'samples', 'shese-xuzhou');

// 页面打开以后用 fetch 取的文件（见 b/stop.js、b/home.js、shared/scene-data.js 里的 loadDem）
const SHARED = ['xuzhou-dem.json', 'xuzhou-dem.bin', 'xuzhou.md', 'xuzhou.json', 'figures-index.json', 'su-shi-figure.json'];

// 样张不是正式内容，不让搜索引擎收
const noindex = {
  name: 'sample-noindex',
  transformIndexHtml: () => [{ tag: 'meta', attrs: { name: 'robots', content: 'noindex' }, injectTo: 'head-prepend' }],
};

await build({
  configFile: false,
  root: sampleRoot,
  base: './',
  publicDir: false,
  plugins: [noindex],
  build: {
    outDir,
    emptyOutDir: true,
    sourcemap: false,
    chunkSizeWarningLimit: 1000, // three 整个打在一个文件里，约 670 KB，不用每次提醒
    rolldownOptions: {
      input: {
        index: path.join(sampleRoot, 'b', 'index.html'),
        home: path.join(sampleRoot, 'b', 'home.html'),
      },
    },
  },
});

fs.mkdirSync(path.join(outDir, 'shared'), { recursive: true });
for (const f of SHARED) fs.copyFileSync(path.join(sampleRoot, 'shared', f), path.join(outDir, 'shared', f));

const ENTRY = 'b/index.html?meter=1';
fs.writeFileSync(
  path.join(outDir, 'index.html'),
  `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="robots" content="noindex">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>样张：徐州的沙盘</title>
<script>
// 网址末尾少了斜杠也转得对
location.replace(new URL('${ENTRY}', location.href.replace(/[?#].*$/, '').replace(/\\/index\\.html$/, '/').replace(/([^/])$/, '$1/')).href);
</script>
<noscript><meta http-equiv="refresh" content="0; url=${ENTRY}"></noscript>
</head>
<body>
<p><a href="${ENTRY}">打开样张：徐州的沙盘</a></p>
</body>
</html>
`,
);

// 这些文件要进公开的仓库：里面不能带着这台机器的路径、用户名、机器名。有就停下，不往下走。
const banned = [
  ['这台机器的用户名', os.userInfo().username],
  ['这台机器的名字', os.hostname()],
  ['用户目录', os.homedir()],
  ['用户目录', os.homedir().replaceAll('\\', '/')],
  ['项目所在的路径', projectRoot],
  ['项目所在的路径', projectRoot.replaceAll('\\', '/')],
  ['本机路径', 'AppData'],
  ['本机路径', 'file:///'],
].filter(([, s]) => s && s.length >= 3);
const bannedRe = [['本机路径', /[A-Za-z]:[\\/]+Users[\\/]/], ['本机路径', /\/(home|Users)\/[^/\s"']+\//]];
const files = fs.readdirSync(outDir, { recursive: true, withFileTypes: true }).filter((d) => d.isFile());
let total = 0;
const found = [];
for (const d of files) {
  const p = path.join(d.parentPath, d.name);
  const rel = path.relative(outDir, p).replaceAll('\\', '/');
  const buf = fs.readFileSync(p);
  total += buf.length;
  const text = buf.toString('latin1');
  const lower = text.toLowerCase();
  for (const [what, s] of banned) if (lower.includes(s.toLowerCase())) found.push(`${rel}：有${what}`);
  for (const [what, re] of bannedRe) if (re.test(text)) found.push(`${rel}：有${what}`);
}
console.log(`\n样张写好了：${files.length} 个文件，共 ${(total / 1024).toFixed(0)} KB`);
if (found.length) {
  console.error('打出来的文件里带着这台机器的东西，不能提交：\n  ' + found.join('\n  '));
  process.exit(1);
}
console.log('查过了：文件里没有这台机器的路径、用户名、机器名。');
