// 场景验收（五）：每一座真的站点沙盘，写给读者的每一句说明（note）都有地方印出来。
// 在 Node 里跑，只看场景文件和 src/domain/sceneText.ts 生成的字，不要浏览器。content/ 里有几座沙盘就查几座。
//
// 说明只印在点“说明”展开的那几句话里：这一节的 explain 点到了哪样东西，它的 note 才印。
// 写了 note、却没有哪一节的 explain 点到它，读者就永远看不到这句话，等于没写（地形的整理不用点，每一节都印）。
// 垫出来、挖出来的东西没有依据，尤其要有一句给读者看的话：写了 area 的修整都要有 note。

import { describe, expect, it } from 'vitest';
import type { StopScene } from '../../src/domain/scene';
import { sectionInfo } from '../../src/domain/sceneText';
import { realSceneFile, realSceneKeys } from './support/realScenes';

/** 场景里带 note 的东西：explain 里怎么指它（id，或那四个词之一），叫什么，note 是什么。 */
function notes(scene: StopScene): { id: string; name: string; note: string }[] {
  const { terrain, water } = scene;
  const all: { id: string; name: string; note?: string }[] = [
    { id: 'terrain', name: '地形', note: terrain.note },
    ...terrain.edits,
    { id: 'levels', name: '水位', note: water.levels.note },
    { id: 'banks', name: '河岸和河床', note: water.banks.note },
    ...water.rivers,
    ...water.rapids,
    ...water.dry,
    ...scene.places,
    ...scene.things,
    ...scene.dressing,
    ...scene.far,
  ];
  return all.flatMap((item) => (item.note?.trim() ? [{ id: item.id, name: item.name, note: item.note.trim() }] : []));
}

describe.each(realSceneKeys())('%s 的说明', (key) => {
  it('写了的每一句说明，至少有一节点“说明”时印得出来', () => {
    const { scene } = realSceneFile(key);
    const printed = new Set(scene.sections.flatMap((s) => sectionInfo(scene, s.heading).note.lines));
    const lost = notes(scene)
      .filter((item) => !printed.has(item.note))
      .map((item) => `${item.name}（${item.id}）`);
    expect(lost, `这几样写了说明，却没有哪一节的 explain 点到它们`).toEqual([]);
  });

  it('地形的整理那一句每一节都印', () => {
    const { scene } = realSceneFile(key);
    const note = scene.terrain.recipe.note?.trim();
    expect(note).toBeTruthy();
    for (const s of scene.sections) expect(sectionInfo(scene, s.heading).note.lines, `${s.heading} 没有印地形的整理`).toContain(note);
  });

  it('垫出来、压下去的一块地方（写了 area 的修整）都有一句给读者看的说明，或者依据里说了它没有改变读者看到的地形', () => {
    const { scene } = realSceneFile(key);
    const silent: string[] = [];
    for (const edit of scene.terrain.edits) {
      if (edit.op !== 'level' || !edit.area) continue;
      // 垫高出一截、读者看得出来的（比平地高出两米半以上）一定要有说明；抹平的（压到、垫到和平地差不多高）可以只写依据
      const stands = edit.mode !== 'lower' && edit.toM >= scene.terrain.recipe.plainBaseM + 2.5;
      if (stands && !edit.note?.trim()) silent.push(`${edit.name}（${edit.id}）`);
    }
    expect(silent, '这几处垫高的地面没有写给读者看的说明').toEqual([]);
  });
});
