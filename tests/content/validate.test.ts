// 内容校验（npm run validate）：把 content/ 目录从磁盘读进来，
// 按 docs/data-spec.md 的九条规则检查每位人物、每一站，把不合规格的地方逐条列出来。

import { describe, expect, it } from 'vitest';
import { toContentFiles } from './files';
import { formatReport, RULE_NAMES, validateContent } from './rules';

const texts = import.meta.glob<string>('/content/**/*.{json,md}', { query: '?raw', import: 'default', eager: true });
const paths = Object.keys(import.meta.glob('/content/**/*'));
const violations = validateContent(toContentFiles('/content/', paths, texts));

describe('内容校验：content/ 目录', () => {
  RULE_NAMES.forEach((name, rule) => {
    it(rule === 0 ? name : `规则 ${rule} ${name}`, () => {
      const found = violations.filter((v) => v.rule === rule);
      if (found.length > 0) expect.fail(formatReport(found));
    });
  });
});
