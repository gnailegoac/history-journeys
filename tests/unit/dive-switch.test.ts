// “潜下去”的两个开关（src/ui/stageEngineSource.ts 的 divesHere）：?dive=none 哪里都不潜；用沙盘的替身时要 ?dive=1 才潜。
// 运行：npx vitest run tests/unit/dive-switch.test.ts

import { describe, expect, it } from 'vitest';

const win = { location: { search: '' } };
(globalThis as { window?: unknown }).window = win;

const { divesHere } = await import('../../src/ui/stageEngineSource');

describe('要不要潜的开关（divesHere）', () => {
  const cases: [string, boolean][] = [
    ['', true],
    ['?tier=full', true],
    ['?tier=reduced&debug=1', true],
    ['?dive=none', false],
    ['?tier=full&dive=none', false],
    // 沙盘的替身：平时不潜（原有的测试看的都是“一点就换”），地址里要了才潜
    ['?stage=fake', false],
    ['?stage=fake-fail', false],
    ['?stage=fake-unsupported', false],
    ['?stage=fake&dive=1', true],
    ['?stage=fake&dive=none', false],
    ['?stage=fake&dive=yes', false],
    // 写了不认得的 stage：用的是真的沙盘程序，照常潜
    ['?stage=other', true],
    ['?dive=1', true],
  ];
  for (const [search, wanted] of cases) {
    it(`地址里是“${search}”：${wanted ? '潜' : '不潜'}`, () => {
      win.location.search = search;
      expect(divesHere()).toBe(wanted);
    });
  }
});
