// 按家分块的零件，在 Node 里跑的测试怎么拿到：页面上是场景里写到了才下载（src/stage/three/view.ts），
// 这里一开头就把登记表（src/stage/families.ts）里每一家都取来，再照同一条规矩挑：场景里写到了哪几家，并成一份交给零件库。
// 一家也用不着的沙盘（徐州）拿到的是 undefined，和页面上一样。

import type { StopScene } from '../../../src/domain/scene';
import { FAMILIES } from '../../../src/stage/families';
import { familiesOf, mergeFamilies } from '../../../src/stage/three/kit/families';
import type { KitFamily } from '../../../src/stage/three/kit/families';

const loaded = new Map<string, KitFamily>();
for (const entry of FAMILIES) loaded.set(entry.name, (await entry.load()).family);

/** 这座沙盘用得着哪几家（名字）。 */
export function familyNamesFor(scene: StopScene): string[] {
  return familiesOf(scene, FAMILIES).map((entry) => entry.name);
}

/** 这座沙盘用得着的几家，并成一份；一家也用不着是 undefined。 */
export function kitFor(scene: StopScene): KitFamily | undefined {
  const names = familyNamesFor(scene);
  return names.length ? mergeFamilies(names.map((name) => loaded.get(name) as KitFamily)) : undefined;
}
