import { defineConfig } from "vite";
import { viteStaticCopy } from "vite-plugin-static-copy";

// CesiumJS needs four folders served as static files (workers, assets, third-party wasm, widget css).
// See the CesiumJS quickstart: CESIUM_BASE_URL must point to where they are served.
const cesiumSource = "node_modules/cesium/Build/Cesium";
const cesiumBaseUrl = "cesiumStatic";

export default defineConfig({
  base: "./",
  server: { port: 5412, strictPort: true, fs: { allow: [".."] } },
  preview: { port: 5412, strictPort: true },
  build: { chunkSizeWarningLimit: 6000 },
  plugins: [
    viteStaticCopy({
      targets: ["Workers", "ThirdParty", "Assets", "Widgets"].map((dir) => ({
        src: `${cesiumSource}/${dir}`,
        dest: cesiumBaseUrl,
        rename: { stripBase: 4 }, // drop node_modules/cesium/Build/Cesium, keep Workers/... etc.
      })),
    }),
  ],
});
