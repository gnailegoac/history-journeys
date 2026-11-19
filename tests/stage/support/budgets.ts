// 一个画面的预算：三角形数、画几批、贴图的边长，和“减配的一档要比完整的省多少才不提醒”。每个数只在这里写一次：
// 场景验收（scene-models、scene-budgets）和浏览器里的真沙盘测试（tests/e2e/real-table.spec.ts）都从这里取。
// 文件大小的上限（定格图、一座沙盘的文件、程序的下载量）在 tests/content/budgetRules.ts。
//
// 一条规矩处处一样：正好等于上限算合格，超过才算不合格。
//
// 数一棵模型树“画一帧要几批、多少个三角形、用了哪些贴图”的函数也在这里，照的是 three 0.187 自己的规矩
//（src/renderers/WebGLRenderer.js 的 projectObject 和 renderBufferDirect，webgl/WebGLBufferRenderer.js）。
// 这个文件运行时不引入 three（只取类型）：浏览器端到端测试也要读它。

import type { BufferGeometry, InstancedMesh, Material, Mesh, Object3D, Texture } from 'three';
import { PICTURE_EDGE_MAX, verdict, withCommas } from '../../content/budgetRules';

/** 一个画面最多多少个三角形；过了多少提醒一句。 */
export const TRIANGLES_MAX = 200_000;
export const TRIANGLES_WARN = 180_000;

/** 画一帧最多几批（一个显出来的网格算一批）；过了多少提醒一句。 */
export const DRAW_CALLS_MAX = 100;
export const DRAW_CALLS_WARN = 70;

/** 沙盘程序现做的贴图，宽和高最大多少像素。和图片文件是同一个数。 */
export const TEXTURE_EDGE_MAX = PICTURE_EDGE_MAX;

/** 减配的一档比完整的一档少画的三角形不到这么多成，提醒一句（少是一定要少的）。 */
export const REDUCED_SAVES_WARN = 0.1;

/** 读正文的时候沙盘一帧都不该画：摆好以后站着不动这么多毫秒，画的帧数不许变。 */
export const STANDING_STILL_MS = 1500;

/** 折算过的远近 D 从多近扫到多远、一步乘几（1 公里到 130 公里，一步 5%）。 */
export const SWEEP_FROM_M = 1000;
export const SWEEP_TO_M = 130_000;
export const SWEEP_STEP = 1.05;

/** 扫一遍要试的每一个 D（米），从近到远，两头都在里面。 */
export function sweepDistances(): number[] {
  const out: number[] = [];
  for (let d = SWEEP_FROM_M; d < SWEEP_TO_M; d *= SWEEP_STEP) out.push(d);
  out.push(SWEEP_TO_M);
  return out;
}

// ---------------------------------------------------------------- 对着上限查

/** 一个数对着上限查出来的话：fail 是超了，warn 是快到了；都没有就是合格。 */
export interface Finding {
  fail?: string;
  warn?: string;
}

function check(what: string, value: number, max: number, warnAbove: number, unit: string): Finding {
  const result = verdict(value, max, warnAbove);
  if (result === 'fail') return { fail: `${what}：${withCommas(value)} ${unit}，超过了 ${withCommas(max)}` };
  if (result === 'warn') return { warn: `${what}：${withCommas(value)} ${unit}，快到上限 ${withCommas(max)} 了` };
  return {};
}

/** 一个画面的三角形数。 */
export function checkTriangles(what: string, triangles: number): Finding {
  return check(what, triangles, TRIANGLES_MAX, TRIANGLES_WARN, '个三角形');
}

/** 画一帧几批。 */
export function checkDrawCalls(what: string, calls: number): Finding {
  return check(what, calls, DRAW_CALLS_MAX, DRAW_CALLS_WARN, '批');
}

/**
 * 减配的一档对着完整的一档查：不能超过上限，而且一定要比完整的少；少得不到一成，提醒一句。
 * full、reduced 是同一节、同一个远近上两档各自一个画面的三角形数。
 */
export function checkReduced(what: string, full: number, reduced: number): Finding {
  const over = checkTriangles(`${what}（减配）`, reduced);
  if (over.fail) return over;
  if (reduced >= full) return { fail: `${what}：减配的一档有 ${withCommas(reduced)} 个三角形，没有比完整的一档（${withCommas(full)}）少` };
  if (reduced > full * (1 - REDUCED_SAVES_WARN)) {
    return { warn: `${what}：减配的一档 ${withCommas(reduced)} 个三角形，只比完整的一档（${withCommas(full)}）少 ${(((full - reduced) / full) * 100).toFixed(1)}%` };
  }
  return over;
}

// ---------------------------------------------------------------- 数一棵模型树

type Drawable = Mesh & { isLine?: boolean; isPoints?: boolean; isSprite?: boolean };

/** 一个形状里，从 start 起的 count 个顶点，落在这个形状要画的那一段里的有多少个。 */
function drawnVertices(geometry: BufferGeometry, start = 0, count = Infinity): number {
  const all = geometry.index ? geometry.index.count : (geometry.attributes.position?.count ?? 0);
  const range = geometry.drawRange;
  const from = Math.max(0, range.start, start);
  const to = Math.min(all, range.start + range.count, start + count);
  return Math.max(0, to - from);
}

/**
 * 这棵树现在显出来的东西，画一帧要几批、一共多少个三角形。
 * 藏起来的（visible 是 false）连同它下面的都不算；成批摆的（InstancedMesh）一个网格算一批，摆了 0 个的不画；
 * 一个网格用了几种材质的，一种一批。不管镜头看不看得见（不按视野裁掉）：数的是最多的情形。
 */
export function drawn(root: Object3D): { calls: number; triangles: number } {
  let calls = 0;
  let triangles = 0;
  const visit = (o: Object3D): void => {
    if (!o.visible) return;
    const d = o as Drawable;
    if ((d.isMesh || d.isLine || d.isPoints || d.isSprite) && d.geometry && d.material) {
      const instanced = (o as InstancedMesh).isInstancedMesh === true;
      const copies = instanced ? (o as InstancedMesh).count : 1;
      const solid = d.isMesh || d.isSprite;
      if (copies > 0) {
        if (Array.isArray(d.material)) {
          for (const group of d.geometry.groups) {
            const material = d.material[group.materialIndex ?? 0];
            if (!material || !material.visible) continue;
            calls += 1;
            if (solid) triangles += (drawnVertices(d.geometry, group.start, group.count) / 3) * copies;
          }
        } else if (d.material.visible) {
          calls += 1;
          if (solid) triangles += (drawnVertices(d.geometry) / 3) * copies;
        }
      }
    }
    for (const child of o.children) visit(child);
  };
  visit(root);
  return { calls, triangles };
}

/** 找到的一张贴图：在哪种材质的哪个位置上，多宽多高（读不出来是 null）。 */
export interface FoundTexture {
  where: string;
  width: number | null;
  height: number | null;
}

function isTexture(value: unknown): value is Texture {
  return typeof value === 'object' && value !== null && (value as { isTexture?: boolean }).isTexture === true;
}

/** 一张贴图多宽多高。数据贴图、画布、图片、渲染出来的贴图都读得出；一组六张的取最大的；读不出来是 null。 */
function textureSize(texture: Texture): { width: number | null; height: number | null } {
  type Picture = { naturalWidth?: number; naturalHeight?: number; videoWidth?: number; videoHeight?: number; width?: number; height?: number } | null | undefined;
  const one = (picture: Picture): { width: number | null; height: number | null } => {
    const width = picture?.naturalWidth || picture?.videoWidth || picture?.width;
    const height = picture?.naturalHeight || picture?.videoHeight || picture?.height;
    return { width: typeof width === 'number' ? width : null, height: typeof height === 'number' ? height : null };
  };
  const image: unknown = texture.image;
  if (!Array.isArray(image)) return one(image as Picture);
  let width: number | null = null;
  let height: number | null = null;
  for (const face of image as Picture[]) {
    const size = one(face);
    if (size.width === null || size.height === null) return { width: null, height: null };
    width = Math.max(width ?? 0, size.width);
    height = Math.max(height ?? 0, size.height);
  }
  return { width, height };
}

/**
 * 这几棵树下面的材质用到的每一张贴图（一张只记一次），藏起来的网格也算（它的贴图照样占着显存）。
 * 每棵树给一个名字（“小模型”“水面”），找到的贴图说得出是谁的。
 * 找三处：材质自己的字段（map、normalMap……）；自己写的着色器的 uniforms；编译前才塞进着色器的 uniforms——
 * 这一处要 compiled 帮忙：给它一种材质，它照 three 编译前的做法叫一遍 onBeforeCompile，把塞进去的 uniforms 交回来
 *（水面的那张“水看到的地面”就是这样塞进去的）。不给 compiled 就只找前两处。
 * 投影子用的材质（customDepthMaterial）也找。
 */
export function texturesOf(roots: { name: string; root: Object3D }[], compiled?: (material: Material) => Record<string, { value: unknown }>): FoundTexture[] {
  const found: FoundTexture[] = [];
  const seenTextures = new Set<Texture>();
  const seenMaterials = new Set<Material>();
  const note = (value: unknown, where: string): void => {
    for (const item of Array.isArray(value) ? value : [value]) {
      if (!isTexture(item) || seenTextures.has(item)) continue;
      seenTextures.add(item);
      found.push({ where, ...textureSize(item) });
    }
  };
  const look = (material: Material, owner: string): void => {
    if (seenMaterials.has(material)) return;
    seenMaterials.add(material);
    const name = `${owner}：${material.name || material.type}`;
    for (const [key, value] of Object.entries(material)) note(value, `${name}.${key}`);
    const own = (material as { uniforms?: Record<string, { value: unknown } | undefined> }).uniforms;
    for (const [key, uniform] of Object.entries(own ?? {})) note(uniform?.value, `${name} 的 uniform ${key}`);
    for (const [key, uniform] of Object.entries(compiled?.(material) ?? {})) note(uniform?.value, `${name} 编译前塞进去的 uniform ${key}`);
  };
  for (const { name, root } of roots) {
    root.traverse((o) => {
      const d = o as Drawable & { customDepthMaterial?: Material; customDistanceMaterial?: Material };
      if (!d.material) return;
      for (const material of Array.isArray(d.material) ? d.material : [d.material]) look(material, name);
      if (d.customDepthMaterial) look(d.customDepthMaterial, `${name}（投影子用的）`);
      if (d.customDistanceMaterial) look(d.customDistanceMaterial, `${name}（投影子用的）`);
    });
  }
  return found;
}

/** 贴图对着边长的上限查：超了的、读不出大小的，各说一句。 */
export function checkTextures(found: FoundTexture[]): string[] {
  const out: string[] = [];
  for (const texture of found) {
    if (texture.width === null || texture.height === null) out.push(`${texture.where}：读不出这张贴图多大`);
    else if (texture.width > TEXTURE_EDGE_MAX || texture.height > TEXTURE_EDGE_MAX) {
      out.push(`${texture.where}：${texture.width} × ${texture.height} 像素，宽和高都不能超过 ${TEXTURE_EDGE_MAX}`);
    }
  }
  return out;
}
