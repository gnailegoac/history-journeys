// 地面的颜色从哪来：制作时先画好的两张图（StopTable.ground），或者沙盘打开时现画。
// 先画好的图只有和手里的场景、刚取到的地形文件对得上才用；对不上、取不到、大小不对，就现画（慢一两秒，颜色是对的），
// 并在控制台里说一句是哪一样对不上。这一手是给改场景的人留的：挪了一条河，刷新页面，颜色马上跟着变，不用先重做。
// 发布出去的网站走不到这里：图比场景旧的时候，npm test 里的检查先不通过（tests/stage/baked-fresh.test.ts）。
// 法线总是现算。这个文件不碰 three：贴图由 terrainMesh.ts 做。

import { contentKey } from '../../domain/contentKey';
import type { StopScene } from '../../domain/scene';
import { groundKey, groundNormals, paintColour } from '../ground';
import type { Ground, GroundStyle } from '../ground/types';
import type { StopTable } from '../types';

export type GroundPaintSource =
  /** 现画的：colour 是 w × h 个点，每点四个字节（前三个是颜色，第四个是“这里有没有田”）。 */
  | { kind: 'live'; colour: Uint8Array; w: number; h: number; normals: Uint8Array }
  /** 先画好的：colour 是颜色那张图，fields 是田的标记那张图，两张一样大。 */
  | { kind: 'baked'; colour: TexImageSource; fields: TexImageSource; w: number; h: number; normals: Uint8Array };

export interface GroundPaintJob {
  /** 地面算好以后叫：对一对记号，等两张图；对不上、取不到、大小不对就现画。不抛出错误。 */
  finish(scene: StopScene, ground: Ground, terrainBytes: ArrayBuffer, style: GroundStyle): Promise<GroundPaintSource>;
}

// ---------------------------------------------------------------- 记号、大小、拆成两份

/**
 * 先画好的地面是照什么画的，两个记号：场景里管地面的那一部分，地形文件的字节。
 * 做图的工具、查“旧不旧”的测试和这里的核对用的都是这一个函数，三处才对得上。
 */
export function groundInputs(scene: StopScene, terrainBytes: ArrayBuffer): { ground: string; terrain: string } {
  return { ground: groundKey(scene), terrain: contentKey(new Uint8Array(terrainBytes)) };
}

/** 颜色图多大：每 10 米一个点，是地面网格的两倍密（paintColour 画出来的就是这么大）。 */
export function groundPictureSize(ground: Ground): { w: number; h: number } {
  return { w: (ground.nx - 1) * 2 + 1, h: (ground.nz - 1) * 2 + 1 };
}

/** 从现画的图（四个字节一个点）里取出田的标记：一个点一个字节。 */
export function fieldBytes(rgba: Uint8Array): Uint8Array {
  const out = new Uint8Array(rgba.length / 4);
  for (let k = 0; k < out.length; k++) out[k] = rgba[k * 4 + 3];
  return out;
}

/** 从现画的图（四个字节一个点）里取出颜色：一个点三个字节。做图的工具和查“旧不旧”的测试用；页面上现画时颜色不用拆。 */
export function colourBytes(rgba: Uint8Array): Uint8Array {
  const n = rgba.length / 4;
  const out = new Uint8Array(n * 3);
  for (let k = 0; k < n; k++) {
    out[k * 3] = rgba[k * 4];
    out[k * 3 + 1] = rgba[k * 4 + 1];
    out[k * 3 + 2] = rgba[k * 4 + 2];
  }
  return out;
}

// ---------------------------------------------------------------- 取图

/** 在浏览器里取一张图。signal 中止了就不取了。全程沙盘取先画好的地面也用它（routeLevel.ts）。 */
export function loadPicture(url: string, signal: AbortSignal): Promise<TexImageSource> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error('这座沙盘不要了'));
      return;
    }
    const image = new Image();
    const done = (): void => {
      image.onload = null;
      image.onerror = null;
      signal.removeEventListener('abort', stop);
    };
    const stop = (): void => {
      done();
      // 换成空的网址，浏览器就不接着下载了
      image.src = '';
      reject(new Error('这座沙盘不要了'));
    };
    signal.addEventListener('abort', stop, { once: true });
    image.onload = () => {
      done();
      // 先解码（不占页面的线程），往显卡上传时就不用再等。这一步不成也不要紧：上传时浏览器自己会解
      const decoded = typeof image.decode === 'function' ? image.decode().catch(() => undefined) : Promise.resolve();
      void decoded.then(() => resolve(image));
    };
    image.onerror = () => {
      done();
      reject(new Error(`图片取不到（${url}）`));
    };
    // 图片要交给显卡：万一它不和页面在同一个地址下，得按“不带身份”的办法取，显卡才肯用（同一个地址下没有影响）
    image.crossOrigin = 'anonymous';
    image.src = url;
  });
}

/** 一张图多大（像素）。 */
export function pictureSize(image: TexImageSource): [number, number] {
  if ('naturalWidth' in image) return [image.naturalWidth, image.naturalHeight];
  if ('videoWidth' in image) return [image.videoWidth, image.videoHeight];
  if ('displayWidth' in image) return [image.displayWidth, image.displayHeight];
  return [image.width, image.height];
}

type Loaded = { ok: true; colour: TexImageSource; fields: TexImageSource } | { ok: false; why: string };

const say = (why: unknown): string => (why instanceof Error ? why.message : String(why));

// ---------------------------------------------------------------- 入口

/** 一开始就叫（地形文件还没取到）：有先画好的图就开始取，和地形文件一起下载。loadImage 可以换成假的（测试用）。 */
export function beginGroundPaint(table: StopTable, signal: AbortSignal, loadImage?: (url: string) => Promise<TexImageSource>): GroundPaintJob {
  const baked = table.ground;
  const load = (url: string): Promise<TexImageSource> => {
    // 取图的那一步当场出错（比如不在浏览器里，没有 Image）也算“取不到”，不往外抛
    try {
      return loadImage ? loadImage(url) : loadPicture(url, signal);
    } catch (error) {
      return Promise.reject(error);
    }
  };
  // 现在就开始取。取不到的缘故留到 finish 里再说；这里先接住，免得成了没人管的错误
  const pictures: Promise<Loaded> | null = baked
    ? Promise.all([load(baked.colourUrl), load(baked.fieldsUrl)]).then(
        ([colour, fields]): Loaded => ({ ok: true, colour, fields }),
        (error: unknown): Loaded => ({ ok: false, why: say(error) }),
      )
    : null;

  return {
    async finish(scene, ground, terrainBytes, style) {
      const { w, h } = groundPictureSize(ground);
      const normals = groundNormals(ground);
      const live = (): GroundPaintSource => {
        // 这座沙盘已经不要了（画布被收走）：不白画一两秒，给一张没上色的。叫的那一边这时候本来就不再用它
        if (signal.aborted) return { kind: 'live', colour: new Uint8Array(w * h * 4), w, h, normals };
        return { kind: 'live', ...paintColour(ground, style), normals };
      };
      /** redo：是不是重新做一遍图就好了（图取不到是网络的事，重做没有用）。 */
      const giveUp = (why: string, redo: boolean): GroundPaintSource => {
        if (!signal.aborted) console.warn(`[沙盘] 先画好的地面用不上，这一次现画（慢一两秒）：${why}${redo ? '。要重新做，运行 npm run bake' : ''}`);
        return live();
      };

      // 这座沙盘还没有先画好的地面：现画，不算出错，也不用说
      if (!baked || !pictures) return live();

      try {
        const now = groundInputs(scene, terrainBytes);
        if (baked.inputs.ground !== now.ground) return giveUp('场景里管地面的部分（样式、范围、地形、水、摆件、点缀）改过了，图是照改以前的画的', true);
        if (baked.inputs.terrain !== now.terrain) return giveUp('地形文件换过了，图是照原来的那一份画的', true);
        if (baked.width !== w || baked.height !== h) return giveUp(`清单里写的图是 ${baked.width} × ${baked.height}，照沙盘的范围应该是 ${w} × ${h}`, true);

        const got = await pictures;
        if (!got.ok) return giveUp(got.why, false);
        for (const [name, image] of [['颜色', got.colour], ['田的标记', got.fields]] as const) {
          const [pw, ph] = pictureSize(image);
          if (pw !== w || ph !== h) return giveUp(`${name}那张图是 ${pw} × ${ph}，应该是 ${w} × ${h}`, true);
        }
        return { kind: 'baked', colour: got.colour, fields: got.fields, w, h, normals };
      } catch (error) {
        return giveUp(say(error), false);
      }
    },
  };
}
