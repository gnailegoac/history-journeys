// 时代样式的入口：按场景文件里写的 style 取出那一种样式。
// 添一种样式：先在 src/domain/scene.ts 的 SCENE_STYLES 里添名字，再在这个文件夹里写一个文件、添进下面的表
// （表里少一种，编译通不过）。

import type { SceneStyleId } from '../../../domain/scene';
import type { StageStyle } from '../internal';
import { songQinglv } from './songQinglv';

const STYLES: Record<SceneStyleId, StageStyle> = {
  'song-qinglv': songQinglv,
};

export function styleFor(id: SceneStyleId): StageStyle {
  return STYLES[id];
}
