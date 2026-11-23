// 按“家”分块的零件。只有一部分沙盘用得着的零件（黄州的崖壁、崖脚的石头、竹和柏；以后各站的浮桥、塔、水门……）
// 不放在沙盘程序里：一家一小块程序，场景里写到了哪一家的东西，造模型以前才下载那一家；一样也没写到的沙盘一块也不下载。
// 有哪几家、各管什么、从哪里取，登记在 src/stage/families.ts（页面那一边），取沙盘程序的时候交进来（provideFamilies）：
// 取它们的那几句动态 import 不能写在沙盘程序里面，缘故和全程沙盘那一块一样（见 ../view.ts 的 RouteLevelLoader）。
// 添一家不用动这里：登记表里添一行，添它自己的文件。

import type { SceneDressing, StopScene } from '../../../domain/scene';
import type { FamilyThingKind } from '../../../domain/sceneKinds';
import type { Pass } from './pass';
import type { Rock } from './dressing';
import type { ThingBuilder } from './things';

/** 一种细高的树（竹、柏）怎么种。 */
export interface TreeKind {
  /** 颜色：样式里的颜色名。 */
  colour: string;
  /** 一棵多宽、多高（米）。 */
  size(rnd: () => number): [number, number];
  /** 一处种几棵（成丛的写）；不写是一棵。丛里的各棵离丛心最多 spreadM 米。 */
  clump?(rnd: () => number): number;
  spreadM?: number;
}

/** 一家零件到了以后交给零件库的东西。 */
export interface KitFamily {
  /** 这一家造的摆件：kind 到造法。 */
  things?: Partial<Record<FamilyThingKind, ThingBuilder>>;
  /** 这一家摆的石头：type 到摆法（只算每块在哪、什么样）。 */
  rocks?: Record<string, (pass: Pass, rule: SceneDressing) => Rock[]>;
  /** 这一家的树：type 到种法。 */
  trees?: Record<string, TreeKind>;
  /** 这一家自己的材质的名字。材质是白的，颜色全写在顶点上（从样式里取）。 */
  materials?: readonly string[];
}

/** 登记表里的一行。 */
export interface FamilyEntry {
  name: string;
  /** 这一家管的东西：摆件写 kind；树、石头写“点缀的 kind:type”（trees:bamboo、rocks:shore）。 */
  holds: readonly string[];
  /** 取这一家的程序。 */
  load(): Promise<{ family: KitFamily }>;
}

let registry: readonly FamilyEntry[] = [];

/** 把登记表交进来（src/stage/index.ts 取到沙盘程序以后交）。 */
export function provideFamilies(list: readonly FamilyEntry[]): void {
  registry = list;
}

/** 这座沙盘的场景里写到了哪几家的东西。一家也没写到是空的。list 不写用交进来的那一张。 */
export function familiesOf(scene: StopScene, list: readonly FamilyEntry[] = registry): FamilyEntry[] {
  const named = new Set<string>(scene.things.map((thing) => thing.kind));
  for (const rule of scene.dressing) if (typeof rule.params?.type === 'string') named.add(`${rule.kind}:${rule.params.type}`);
  return list.filter((entry) => entry.holds.some((name) => named.has(name)));
}

/** 几家并成一份。 */
export function mergeFamilies(families: readonly KitFamily[]): KitFamily {
  const out = { things: {}, rocks: {}, trees: {}, materials: [] as string[] };
  for (const family of families) {
    Object.assign(out.things, family.things);
    Object.assign(out.rocks, family.rocks);
    Object.assign(out.trees, family.trees);
    out.materials.push(...(family.materials ?? []));
  }
  return out;
}

/** 取这几家的程序，并成一份。 */
export async function loadFamilies(entries: readonly FamilyEntry[]): Promise<KitFamily> {
  return mergeFamilies((await Promise.all(entries.map((entry) => entry.load()))).map((loaded) => loaded.family));
}
