// 这个浏览器能不能画三维地图：引擎需要 WebGL2。

let supported: boolean | null = null;

export function hasWebGL2(): boolean {
  if (supported) return true;
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    supported = gl !== null;
    // 试完就放掉，不占着一个上下文
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
  } catch {
    supported = false;
  }
  return supported;
}
