// 内容校验（npm run validate）：把 content/ 目录从磁盘读进来，
// 按 docs/data-spec.md 的校验规则检查每位人物、每一站、每一站的沙盘和工具照着沙盘做出来的文件，把不合规格的地方逐条列出来。

import { describe, expect, it } from 'vitest';
import { fileSize, readBytes } from '../support/readBytes';
import { TABLE_FILES_MAX_BYTES, megabytes, tableFiles } from './budgetRules';
import { toContentFiles, toFileKeys, toFileSizes, toPictureSizes } from './files';
import { formatReport, RULE_NAMES, RULES_CHECKED_ELSEWHERE, validateContent } from './rules';

// .geojson 是全程沙盘的“今天的海岸、湖、河”（scenes/route.today.geojson）：规则 10、15 要读它里面的名字和线。
const texts = import.meta.glob<string>('/content/**/*.{json,md,geojson}', { query: '?raw', import: 'default', eager: true });
const paths = Object.keys(import.meta.glob('/content/**/*'));
// 地形文件、先画好的地面和定格图的大小从磁盘量（规则自己不读磁盘）。paths 里的路径以“/content/”开头，量的时候去掉开头的“/”。
const sizes = toFileSizes('/content/', paths, (path) => fileSize(path.slice(1)));
// 图片有多宽多高、是哪一种，也从磁盘上的图片文件里读（人物页靠 figure.json 里写的宽高先把地方留出来；
// 工具做的图片要和它的清单对得上）。
const pictures = toPictureSizes('/content/', paths, (path) => readBytes(path.slice(1)));
// 工具做的图片各自的记号：和清单里写的不一样，就是图片或者清单被人动过。
const keys = toFileKeys('/content/', paths, (path) => readBytes(path.slice(1)));
const violations = validateContent(toContentFiles('/content/', paths, texts), sizes, pictures, keys);

/** content/ 里的路径（不带开头的“/content/”）。 */
const inContent = (pattern: RegExp): string[] => paths.filter((path) => pattern.test(path)).map((path) => path.slice('/content/'.length));

describe('内容校验：content/ 目录', () => {
  RULE_NAMES.forEach((name, rule) => {
    // 号码在表里、却不归这里查的（规则 19 随站的字体，由 npm test 查）不列出来，免得看着像是在这里查过了
    if (RULES_CHECKED_ELSEWHERE.includes(rule)) return;
    it(rule === 0 ? name : `规则 ${rule} ${name}`, () => {
      const found = violations.filter((v) => v.rule === rule);
      if (found.length > 0) expect.fail(formatReport(found));
    });
  });

  it('每张 JPEG、PNG 的定格图和先画好的地面都量到了宽高，是哪一种图片也认出来了', () => {
    for (const path of inContent(/\/(stills|baked)\/[^/]+\.(jpe?g|png)$/i)) {
      expect(pictures[path]?.width, path).toBeGreaterThan(0);
      expect(pictures[path]?.height, path).toBeGreaterThan(0);
      expect(pictures[path]?.kind, `${path}：后缀和文件里的东西不是一种图片`).toBe(/\.png$/i.test(path) ? 'png' : 'jpeg');
      expect(keys[path], path).toMatch(/^[0-9a-f]{16}$/);
      expect(sizes[path], path).toBeGreaterThan(0);
    }
  });

  it('每个地形文件的大小都量到了', () => {
    for (const path of inContent(/\/scenes\/[^/]+\.terrain\.bin$/)) expect(sizes[path], path).toBeGreaterThan(0);
  });

  it('每座沙盘的文件合计多大（印出来；过了上限的八成提醒一句，超了由规则 17 报）', () => {
    const lines: string[] = [];
    for (const scene of inContent(/\/scenes\/[^/]+\.json$/)) {
      const match = /^(figures\/[^/]+)\/scenes\/([^/]+)\.json$/.exec(scene);
      if (!match) continue;
      const [, dir, stop] = match;
      const terrain = sizes[`${dir}/scenes/${stop}.terrain.bin`] ?? 0;
      const colour = sizes[`${dir}/baked/${stop}.colour.jpg`];
      const fields = sizes[`${dir}/baked/${stop}.fields.png`];
      if (colour === undefined || fields === undefined) {
        lines.push(`${dir}/${stop}：地形文件 ${megabytes(terrain)}；还没有先画好的地面`);
        continue;
      }
      const sum = tableFiles({ terrain, colour, fields });
      const line = `${dir}/${stop}：地形文件 ${megabytes(terrain)} + 颜色 ${megabytes(colour)} + 田的标记 ${megabytes(fields)} = ${megabytes(sum.total)}，上限 ${megabytes(TABLE_FILES_MAX_BYTES)}（用了 ${Math.round((sum.total / TABLE_FILES_MAX_BYTES) * 100)}%）`;
      lines.push(line);
      if (sum.verdict === 'warn') console.warn(`[内容校验] 快到上限了：${line}`);
    }
    console.log(['每座沙盘的文件合计', ...lines.map((line) => `  ${line}`)].join('\n'));
    expect(lines.length).toBeGreaterThan(0);
  });
});
