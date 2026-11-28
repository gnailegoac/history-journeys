import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import type { Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * 一个文件是不是内容文件：路径里有 content/figures/ 这一截（内容都在这个文件夹里）。照这一截认，不拿项目的根目录去比：
 * 同一个文件夹在 Windows 上可以有长短两种写法、可以隔着一个链接，比整条路径会认不出来。
 */
const CONTENT_FILE = /[\\/]content[\\/]figures[\\/]/;

/**
 * 构建清单（dist/.vite/manifest.json）里每一项都从项目的根目录写起，不带这台机器上的文件夹。
 * 打包的工具给照地址引的样式表（import … from './x.css?url'：点开才要的字的那几份，src/fonts/scopes.ts）记的是整条路径——
 * 在哪个文件夹里构建，清单里就写着哪个文件夹，同一份源文件在两个地方构建出来的清单就不一样，文件夹的名字还跟着进了构建出来的东西。
 * 清单写完以后把这样的项改回来：从整条路径的后一截里找项目里真有的那个文件（不拿根目录去比，缘故同上面），照别的项那样写，再照原来的先后排好。
 * 只动清单这一个文件，只在构建时做（tests/build/dist-size.test.ts 守着：清单里没有一条整条的路径）。
 */
function manifestFromRoot(): Plugin {
  /** 整条的路径：打头是“/”，或者盘符（C:/、C:\）。 */
  const WHOLE = /^([A-Za-z]:)?[\\/]/;
  let root = '';
  let file = '';
  /** 一条整条的路径在项目里是哪个文件：一截一截去掉前头，直到剩下的在项目里找得到；找不到的原样留着。 */
  const fromRoot = (path: string): string => {
    if (!WHOLE.test(path)) return path;
    const parts = path.replace(/\\/g, '/').split('/');
    for (let from = 1; from < parts.length; from++) {
      const rest = parts.slice(from).join('/');
      if (existsSync(`${root}/${rest}`)) return rest;
    }
    return path;
  };
  return {
    name: 'manifest-from-root',
    apply: 'build',
    configResolved(config) {
      root = config.root;
      const name = config.build.manifest;
      const out = WHOLE.test(config.build.outDir) ? config.build.outDir : `${root}/${config.build.outDir}`;
      file = name ? `${out}/${name === true ? '.vite/manifest.json' : name}` : '';
    },
    writeBundle() {
      if (!file || !existsSync(file)) return;
      const before = new TextDecoder().decode(readFileSync(file));
      const manifest = JSON.parse(before) as Record<string, { src?: string }>;
      const entries = Object.entries(manifest).map(([key, item]): [string, { src?: string }] => [fromRoot(key), item.src === undefined ? item : { ...item, src: fromRoot(item.src) }]);
      const after = JSON.stringify(Object.fromEntries(entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))), undefined, 2);
      if (after !== before) writeFileSync(file, after);
    },
  };
}

// 站点发布在 GitHub Pages 的子路径下，所以用相对路径，页面之间用 # 路由。
export default defineConfig({
  base: './',
  plugins: [react(), manifestFromRoot()],
  // three 只认项目根目录里装的那一份。spikes/ 里的样张有自己装的一份（那个文件夹不进仓库）：开发服务预先打包依赖时会连样张的页面一起扫，
  // 样张引过的文件取样张的那一份、没引过的取根目录的，页面上就有了两份 three（控制台会说 Multiple instances of Three.js）。
  resolve: { dedupe: ['three'] },
  build: {
    // 最老要能打开的浏览器是 iOS 15 上的 Safari 15（老的家用平板停在这里）：程序和样式都按它能读懂的写法构建。
    // 更老的浏览器打不开，index.html 里有一小段不靠构建的脚本，那时显示一句话。
    target: ['es2020', 'safari15'],
    // 构建时写一份清单（dist/.vite/manifest.json）：查各块大小的测试照它找文件（构建出来的文件名里有一串每次都可能变的字符，猜不得）。
    manifest: true,
    // content/ 里的文件（图片、地形文件）不许塞进程序里：打包的工具平常会把 4 KB 以下的小文件写成一长串 data: 地址塞进引它的那一块，
    // 一张小图片（比如一张几乎是空的田的标记图）就这样进了内容的清单那一块——那一块每位读者一打开都要下载，图片却只有摆那一座沙盘的人用得着。
    // content/ 里的每一个文件在 dist/ 里都还是它自己的一个文件，清单那一块里只有网址（tests/build/dist-size.test.ts 守着）。别的小文件照平常的规矩。
    assetsInlineLimit: (file) => (CONTENT_FILE.test(file) ? false : undefined),
  },
  server: { port: 5400, strictPort: true },
  preview: { port: 5400, strictPort: true },
});
