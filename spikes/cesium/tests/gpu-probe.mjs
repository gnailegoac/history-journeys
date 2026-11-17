// Which WebGL renderer does headless Chromium get on this machine? (hard timeout 60 s)
import { chromium } from "@playwright/test";
const killer = setTimeout(() => process.exit(2), 60_000);
const args = ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"];
for (const [name, options] of [
  ["headless shell (Playwright default)", { headless: true, args }],
  ["full Chromium, new headless mode", { headless: true, channel: "chromium", args }],
]) {
  try {
    const browser = await chromium.launch(options);
    const page = await browser.newPage();
    const renderer = await page.evaluate(() => {
      const gl = document.createElement("canvas").getContext("webgl2");
      const info = gl?.getExtension("WEBGL_debug_renderer_info");
      return info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : "";
    });
    console.log(`${name}: ${renderer} | ${browser.version()}`);
    await browser.close();
  } catch (error) {
    console.log(`${name}: failed: ${String(error).split("\n")[0]}`);
  }
}
clearTimeout(killer);
