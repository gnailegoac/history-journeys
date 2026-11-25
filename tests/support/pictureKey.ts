// 场景文件里决定画面的那一部分的记号（定格图清单里的 madeFrom.scene）。
// 定格图是照场景拍的；场景里有些字段改了，画面和题签指着的点都不会变——依据、说明、题记、名字、题签上的字。
// 算记号之前把这些字段去掉：改一句依据，不该让十四张图都算成旧的。
// 拍定格图的工具和查“旧不旧”的测试（tests/stage/stills-fresh.test.ts）用的是这同一个函数。只算数，不碰磁盘。

import { contentKey } from '../../src/domain/contentKey';

/**
 * 不管出现在哪里都去掉的字段：
 *   basis、sourceIds、unsure、note  依据的那一组（class 不去：点缀按不按数目减，要看它）
 *   credits、notDrawn              用了谁的数据，没有画的东西
 *   date、explain                  小节的时间，说明先讲哪几样
 *   name、gloss、inHisWords        给读者看的名字和括注；远处照当时人的话写的那一句（只印在题记下面，题签摆在哪看的是坐标）
 */
const DROPPED = new Set(['basis', 'sourceIds', 'unsure', 'note', 'credits', 'notDrawn', 'date', 'explain', 'name', 'gloss', 'inHisWords']);

/** 题签上只有这两个字段不管画面：当时的名字，今天的名字。别的（指着哪样东西、指在哪一点、摆在哪一边）都留着。 */
const DROPPED_ON_STRIPS = new Set(['text', 'modern']);

/** 这两个字段里面不再往下挑（见 pruned 里的说明）。 */
const OPAQUE = new Set(['values', 'params']);

function pruned(value: unknown, onStrip: boolean): unknown {
  if (Array.isArray(value)) return value.map((item) => pruned(item, onStrip));
  if (value === null || typeof value !== 'object') return value;
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (DROPPED.has(key)) continue;
    if (onStrip && DROPPED_ON_STRIPS.has(key)) continue;
    // line 有两种：小节的题记是一句话，去掉；城墙、河、路的 line 是一串坐标，决定画面，留着
    if (key === 'line' && typeof child === 'string') continue;
    // 水位的名字（values）和零件的参数（params）是“名字 → 数”的表：里面的名字是作者起的，原样留着，不当成字段去挑
    out[key] = OPAQUE.has(key) ? child : pruned(child, false);
  }
  return out;
}

/** 场景去掉不管画面的字段以后是什么样（给测试看；记号就是照它算的）。scene 是场景文件解析出来的东西。 */
export function pictureParts(scene: unknown): unknown {
  if (scene === null || typeof scene !== 'object' || Array.isArray(scene)) return pruned(scene, false);
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(scene)) {
    // 最外面的 sources 是全程沙盘自己的出处（站点沙盘的出处在那一站的正文文件里）：改一条出处的写法，画面不变
    // 最外面的 piece 是凭据里印的小像的那几句话：小像不在定格图里，它站在哪也不写在场景里
    if (DROPPED.has(key) || key === 'sources' || key === 'piece') continue;
    // 最外面的 strips 是题签的单子（小节里的 strips 只是一串 id，不在这里）
    out[key] = key === 'strips' && Array.isArray(child) ? child.map((strip) => pruned(strip, true)) : pruned(child, false);
  }
  return out;
}

/** 场景文件里决定画面的那一部分的记号。scene 是场景文件解析出来的东西。 */
export function pictureKey(scene: unknown): string {
  return contentKey(JSON.stringify(pictureParts(scene)));
}
