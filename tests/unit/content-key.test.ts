// 两种记号：一份内容的记号（src/domain/contentKey.ts），场景里管地面的那一部分的记号（src/stage/ground/key.ts）。
// 记号写进了仓库里的清单（先画好的地面、定格图），所以算法不能悄悄变：下面有几个写死的数。
// 管地面的那一部分的记号要变得恰到好处：改镜头、题签、题记、依据，不变（先画好的地面不用重做）；
// 挪一条河、动一样摆件、换样式，要变（不变的话，页面会在改过的场景上显出旧的颜色）。

import { describe, expect, it } from 'vitest';
import { contentKey } from '../../src/domain/contentKey';
import type { StopScene } from '../../src/domain/scene';
import { groundKey } from '../../src/stage/ground';
import { realSceneFile, realSceneKeys } from '../stage/support/realScenes';
import { fixtureScene } from '../support/fixtureScene';
import { readBytes } from '../support/readBytes';

describe('一份内容的记号（contentKey）', () => {
  it('是 16 个十六进制字符；同样的内容每次一样', () => {
    for (const data of ['', 'a', '徐州', new Uint8Array(0), new Uint8Array([1, 2, 3]), new Uint8Array(100_000)]) {
      const key = contentKey(data);
      expect(key).toMatch(/^[0-9a-f]{16}$/);
      expect(contentKey(data)).toBe(key);
    }
  });

  it('算法没有变：这几个数和仓库里的清单是同一种算法算的', () => {
    expect(contentKey('')).toBe('488bdcb81aee8d83');
    expect(contentKey('a')).toBe('1213124eda4555df');
    expect(contentKey('徐州')).toBe('6038bce7a13a59a3');
    expect(contentKey(new Uint8Array([0]))).toBe('c81d8541118946ba');
    expect(contentKey(new Uint8Array([0, 0]))).toBe('87bcde8235a3cd8b');
    expect(contentKey(Uint8Array.from({ length: 256 }, (_v, i) => i))).toBe('8efd31b036cb1f3a');
  });

  it('一段字和它的 UTF-8 字节，记号一样', () => {
    expect(contentKey('徐州')).toBe(contentKey(new Uint8Array([0xe5, 0xbe, 0x90, 0xe5, 0xb7, 0x9e])));
    expect(contentKey('abc')).toBe(contentKey(new Uint8Array([97, 98, 99])));
    expect(contentKey('')).toBe(contentKey(new Uint8Array(0)));
  });

  it('只看交进来的那一段字节，不看它后面那块内存里别的', () => {
    const whole = Uint8Array.from({ length: 64 }, (_v, i) => i * 3);
    expect(contentKey(whole.subarray(8, 24))).toBe(contentKey(Uint8Array.from(whole.slice(8, 24))));
    expect(contentKey(whole.subarray(8, 24))).not.toBe(contentKey(whole));
  });

  it('改一个字节、一个二进制位，记号就不一样', () => {
    const bytes = new Uint8Array(5000);
    for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 31 + 7) & 0xff;
    const seen = new Set([contentKey(bytes)]);
    // 每隔一段改一个二进制位，各算一个记号：都不一样
    for (let i = 0; i < bytes.length; i += 13) {
      const changed = Uint8Array.from(bytes);
      changed[i] ^= 1 << (i % 8);
      seen.add(contentKey(changed));
    }
    expect(seen.size).toBe(1 + Math.ceil(bytes.length / 13));
  });

  it('长短也算：末尾多一个 0、前后两个字节对调，记号都不一样', () => {
    expect(contentKey(new Uint8Array(3))).not.toBe(contentKey(new Uint8Array(4)));
    expect(contentKey(new Uint8Array([1, 2]))).not.toBe(contentKey(new Uint8Array([2, 1])));
    expect(contentKey('ab')).not.toBe(contentKey('ba'));
  });

  it('两万个短的内容，记号没有相同的', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 20_000; i++) seen.add(contentKey(`第 ${i} 份`));
    expect(seen.size).toBe(20_000);
  });
});

describe('场景里管地面的那一部分的记号（groundKey）', () => {
  const base = groundKey(fixtureScene());
  /** 拿一份新的场景，改一处，算记号。 */
  const after = (change: (scene: StopScene) => void): string => {
    const scene = fixtureScene();
    change(scene);
    return groundKey(scene);
  };

  it('是 16 个十六进制字符；同一份场景每次一样', () => {
    expect(base).toMatch(/^[0-9a-f]{16}$/);
    expect(groundKey(fixtureScene())).toBe(base);
  });

  it('改小节（镜头、水位、题记）、题签、地名点、远处、凭据、没有画的，记号不变', () => {
    expect(after((s) => (s.sections[0].camera.distanceM += 500))).toBe(base);
    expect(after((s) => (s.sections[0].camera.target = [117.001, 34.001]))).toBe(base);
    expect(after((s) => (s.sections[1].line = '换了一句题记。'))).toBe(base);
    expect(after((s) => (s.sections[1].water = 'normal'))).toBe(base);
    expect(after((s) => s.sections.pop())).toBe(base);
    expect(after((s) => (s.strips[0].text = '换了字'))).toBe(base);
    expect(after((s) => s.strips.pop())).toBe(base);
    expect(after((s) => (s.places[0].at = [117.01, 34.01]))).toBe(base);
    expect(after((s) => (s.far[0].name = '别处'))).toBe(base);
    expect(after((s) => s.credits.push('再添一条。'))).toBe(base);
    expect(after((s) => (s.notDrawn = []))).toBe(base);
    expect(after((s) => (s.stopId = 'other'))).toBe(base);
  });

  it('只改依据、出处、说不准的部分、给读者的说明这些字，记号不变', () => {
    expect(after((s) => (s.terrain.basis = '换了一句依据。'))).toBe(base);
    expect(after((s) => (s.terrain.recipe.note = '换了一句说明。'))).toBe(base);
    expect(after((s) => (s.terrain.edits[0].basis = '换了一句依据。'))).toBe(base);
    expect(after((s) => (s.water.levels.note = '换了一句说明。'))).toBe(base);
    expect(after((s) => (s.water.rivers[0].basis = '换了一句依据。'))).toBe(base);
    expect(after((s) => (s.water.rivers[1].unsure = '宽窄'))).toBe(base);
    expect(after((s) => (s.water.rivers[0].sourceIds = ['f2']))).toBe(base);
    expect(after((s) => (s.things[0].note = '换了一句说明。'))).toBe(base);
    expect(after((s) => (s.things[1].basis = '换了一句依据。'))).toBe(base);
    expect(after((s) => (s.dressing[0].basis = '换了一句依据。'))).toBe(base);
  });

  it('窄的河上不画水纹的门槛（water.calmUnderPx）不算进记号：写上、改它，记号不变；没写它的沙盘的记号和把它算进去的老算法一个字符不差', () => {
    expect(after((s) => (s.water.calmUnderPx = 48))).toBe(base);
    expect(after((s) => (s.water.calmUnderPx = 60))).toBe(base);
    /** 老算法：只去掉纯是给人读的那四样字，门槛也算进去。 */
    const older = (scene: StopScene): string => {
      const words = new Set(['basis', 'sourceIds', 'unsure', 'note']);
      return contentKey(JSON.stringify([scene.style, scene.frame, scene.terrain, scene.water, scene.things, scene.dressing], (name, value: unknown) => (words.has(name) ? undefined : value)));
    };
    expect(older(fixtureScene())).toBe(base);
    let published = 0;
    for (const key of realSceneKeys()) {
      const { scene } = realSceneFile(key);
      // 没写门槛的：新老两种算法一样。写了的：记号和“去掉门槛以后照老算法算”的一样，和“连门槛照老算法算”的不一样。
      const bare = structuredClone(scene);
      delete bare.water.calmUnderPx;
      expect(groundKey(scene), key).toBe(older(bare));
      // 先画好的地面的清单里记着的也是这个记号（发布过的两座沙盘不用重画）：没写门槛的黄州，和发布以后才写上门槛的徐州
      if (scene.water.calmUnderPx === undefined || key === 'su-shi/xuzhou') {
        if (scene.water.calmUnderPx !== undefined) expect(groundKey(scene), key).not.toBe(older(scene));
        const [figure, stop] = key.split('/');
        let manifest: { inputs: { ground: string } } | null = null;
        try {
          manifest = JSON.parse(new TextDecoder().decode(readBytes(`content/figures/${figure}/baked/${stop}.json`))) as { inputs: { ground: string } };
        } catch {
          manifest = null;
        }
        if (manifest) {
          expect(manifest.inputs.ground, `${key} 先画好的地面记着的记号`).toBe(groundKey(scene));
          published += 1;
        }
      } else {
        expect(groundKey(scene), key).not.toBe(older(scene));
      }
    }
    // 徐州、黄州都在里面
    expect(published).toBeGreaterThanOrEqual(2);
  });

  it('挪一条河的一个点、改河画多宽、改水位，记号变', () => {
    expect(after((s) => (s.water.rivers[0].line[1] = [s.water.rivers[0].line[1][0] + 0.0001, s.water.rivers[0].line[1][1]]))).not.toBe(base);
    expect(after((s) => (s.water.rivers[0].drawWidthM += 10))).not.toBe(base);
    expect(after((s) => (s.water.levels.values.flood += 0.5))).not.toBe(base);
    expect(after((s) => (s.water.banks.bankM += 0.5))).not.toBe(base);
    expect(after((s) => s.water.rivers.pop())).not.toBe(base);
  });

  it('动一样摆件（挪、换参数、去掉、换类别），记号变', () => {
    expect(after((s) => (s.things[0].line = s.things[0].line?.slice(0, 3)))).not.toBe(base);
    expect(after((s) => (s.things[0].params = { ...s.things[0].params, face: 'brick' }))).not.toBe(base);
    expect(after((s) => s.things.pop())).not.toBe(base);
    expect(after((s) => (s.things[0].class = 'text'))).not.toBe(base);
  });

  it('换样式、改范围、改山高夸大几倍、改地形的整理和修整、改点缀，记号变', () => {
    expect(after((s) => (s.style = 'other-style' as StopScene['style']))).not.toBe(base);
    expect(after((s) => (s.frame.eastM += 20))).not.toBe(base);
    expect(after((s) => (s.frame.relief = { kind: 'uniform', times: 5 }))).not.toBe(base);
    expect(after((s) => (s.terrain.recipe.plainBaseM += 1))).not.toBe(base);
    expect(after((s) => (s.terrain.file = 'other.terrain.bin'))).not.toBe(base);
    expect(after((s) => s.terrain.edits.pop())).not.toBe(base);
    expect(after((s) => s.dressing.pop())).not.toBe(base);
  });

  it('各处改出来的记号互不相同', () => {
    const keys = [
      base,
      after((s) => (s.frame.eastM += 20)),
      after((s) => (s.frame.westM += 20)),
      after((s) => (s.water.rivers[0].drawWidthM += 10)),
      after((s) => (s.water.rivers[1].drawWidthM += 10)),
      after((s) => s.things.pop()),
    ];
    expect(new Set(keys).size).toBe(keys.length);
  });
});
