// 读摆件、点缀的参数。认哪些参数、各是什么样子，只看 ./sceneKinds.ts 里的两张表；
// 这里按表给出带类型的参数：要读一个表里没有的参数，编译就过不去；表里改了名字，读它的地方也跟着编译不过。
// 沙盘程序里算地面的一边（src/stage/ground）和造模型的一边（src/stage/three/kit）都从这里读，两边才对得上。
// 没写的参数这里不给默认值：默认多少是各个用的地方自己的事。只算数，不碰页面。

import { DRESSING_PARAMS, THING_PARAMS } from './sceneKinds';
import type { DressingKind, ParamType, Params, ThingKind } from './sceneKinds';

type ValueOf<P> = P extends 'number' ? number : P extends 'boolean' ? boolean : P extends readonly (infer W)[] ? W : never;
type Read<Table> = { -readonly [K in keyof Table]?: ValueOf<Table[K]> };

/** 某一种摆件的参数，每一个都可能没写。 */
export type ThingParams<K extends ThingKind> = Read<(typeof THING_PARAMS)[K]>;
/** 某一种点缀的参数，每一个都可能没写。 */
export type DressingParams<K extends DressingKind> = Read<(typeof DRESSING_PARAMS)[K]>;

/** 照着表读：表里有、样子也对的才要；别的一律当没写（校验会另外报错，这里不管）。 */
function read(table: Record<string, ParamType>, params: Params | undefined): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  if (!params) return out;
  for (const [name, type] of Object.entries(table)) {
    const v = params[name];
    if (v === undefined) continue;
    if (type === 'number') {
      if (typeof v === 'number' && Number.isFinite(v)) out[name] = v;
    } else if (type === 'boolean') {
      if (typeof v === 'boolean') out[name] = v;
    } else if (typeof v === 'string' && type.includes(v)) {
      out[name] = v;
    }
  }
  return out;
}

export function thingParams<K extends ThingKind>(kind: K, params: Params | undefined): ThingParams<K> {
  return read(THING_PARAMS[kind], params) as ThingParams<K>;
}

export function dressingParams<K extends DressingKind>(kind: K, params: Params | undefined): DressingParams<K> {
  return read(DRESSING_PARAMS[kind], params) as DressingParams<K>;
}
