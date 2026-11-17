import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 站点发布在 GitHub Pages 的子路径下，所以用相对路径，页面之间用 # 路由。
export default defineConfig({
  base: './',
  plugins: [react()],
  server: { port: 5400, strictPort: true },
  preview: { port: 5400, strictPort: true },
  worker: { format: 'es' },
});
