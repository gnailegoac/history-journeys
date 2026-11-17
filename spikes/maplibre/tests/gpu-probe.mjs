// Prints the WebGL renderer that headless Chromium gets on this machine, for the two headless flavours.
import { chromium } from '@playwright/test';
const killer = setTimeout(() => process.exit(2), 90 * 1000);
const args = ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'];
for (const channel of [undefined, 'chromium']) {
  let browser;
  try {
    browser = await chromium.launch({ headless: true, channel, args });
    const page = await browser.newPage();
    const renderer = await page.evaluate(() => {
      const gl = document.createElement('canvas').getContext('webgl2');
      if (!gl) return 'no webgl2';
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    });
    console.log(channel ?? 'headless-shell (default)', '|', browser.version(), '|', renderer);
  } catch (e) {
    console.log(channel ?? 'default', 'failed:', e.message.split('\n')[0]);
  } finally {
    await browser?.close();
  }
}
clearTimeout(killer);
