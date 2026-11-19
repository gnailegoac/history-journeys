// 场景里管地面的那一部分的记号。先画好的地面（npm run bake）记着它是照哪个记号画的；
// 沙盘打开时再算一遍，对不上就不用那两张图，现画。只算数，不碰 three，也不碰页面。

import { contentKey } from '../../domain/contentKey';
import type { StopScene } from '../../domain/scene';

/**
 * 类别和依据那一组字段（src/domain/scene.ts 的 Grounds）里纯是给人读的字：依据、出处、说不准的部分、给读者的说明。
 * 地面这一边从来不读它们，所以不算进记号：改一句依据，先画好的地面不用重做（docs/data-spec.md“什么时候要重做”）。
 * class（类别）留着：它不是一句话，是数据。
 */
const WORDS_ONLY = new Set(['basis', 'sourceIds', 'unsure', 'note']);

/**
 * 决定地面长什么样的那几块：样式、范围、地形和修整、水、摆件、点缀（其中纯是给人读的字不算，见 WORDS_ONLY）。
 * 小节、题签、地名点、远处、凭据都不算：改一个镜头、一句题记，先画好的地面不用重画。
 */
export function groundKey(scene: StopScene): string {
  const parts = [scene.style, scene.frame, scene.terrain, scene.water, scene.things, scene.dressing];
  return contentKey(JSON.stringify(parts, (name, value: unknown) => (WORDS_ONLY.has(name) ? undefined : value)));
}
