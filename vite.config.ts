import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 站点发布在 GitHub Pages 的子路径下，所以用相对路径，页面之间用 # 路由。
export default defineConfig({
  base: './',
  plugins: [react()],
  // three 只认项目根目录里装的那一份。spikes/ 里的样张有自己装的一份（那个文件夹不进仓库）：开发服务预先打包依赖时会连样张的页面一起扫，
  // 样张引过的文件取样张的那一份、没引过的取根目录的，页面上就有了两份 three（控制台会说 Multiple instances of Three.js）。
  resolve: { dedupe: ['three'] },
  build: {
    // 最老要能打开的浏览器是 iOS 15 上的 Safari 15（老的家用平板停在这里）：程序和样式都按它能读懂的写法构建。
    // 更老的浏览器打不开，index.html 里有一小段不靠构建的脚本，那时显示一句话。
    target: ['es2020', 'safari15'],
    // 构建时写一份清单（dist/.vite/manifest.json）：查各块大小的测试照它找文件（构建出来的文件名里有一串每次都可能变的字符，猜不得）。
    manifest: true,
  },
  server: { port: 5400, strictPort: true },
  preview: { port: 5400, strictPort: true },
});
