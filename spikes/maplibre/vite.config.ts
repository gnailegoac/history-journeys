import { defineConfig } from 'vite';

export default defineConfig({
  // route.json lives in ../shared, outside this project root
  server: { port: 5411, strictPort: true, fs: { allow: ['..'] } },
  preview: { port: 5411, strictPort: true },
  worker: { format: 'es' },
});
