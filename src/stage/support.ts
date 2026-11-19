// 这个浏览器能不能画立体的沙盘。页面在下载沙盘程序之前先问这里：不能画就不下载。
// 所以这个文件不碰 three，也不从 src/stage/three/ 里取东西。
// 沙盘程序自己（src/stage/three/engine.ts）问的也是这里，所以一次访问里只试一回。

let probed: { webgl2: boolean; caveat: boolean } | null = null;

/** 试着要一个 WebGL2 的画面，要到了马上放掉（同时开着的数目有限）。strict 是 true 时，只能用软件画的浏览器不给。 */
function tryWebgl2(strict: boolean): boolean {
  try {
    const gl = document.createElement('canvas').getContext('webgl2', strict ? { failIfMajorPerformanceCaveat: true } : undefined);
    if (!gl) return false;
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return true;
  } catch {
    return false;
  }
}

/**
 * webgl2：这个浏览器支持不支持 WebGL2（网页画三维用的功能）。
 * caveat：支持，但是浏览器自己说“画起来会很慢”（多半是没有显卡、用软件画）。这只是一个提示：
 * 各种浏览器怎么回答没有一一查过，所以只拿它把这一次访问的画质上限压到减配，不拿它说“画不了”。
 * 只试一次，结果记下来；可以反复问。
 */
export function probeWebgl(): { webgl2: boolean; caveat: boolean } {
  if (probed) return probed;
  if (tryWebgl2(true)) probed = { webgl2: true, caveat: false };
  else if (tryWebgl2(false)) probed = { webgl2: true, caveat: true };
  else probed = { webgl2: false, caveat: false };
  return probed;
}
