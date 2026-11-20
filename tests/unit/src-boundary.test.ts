// src/ 里的程序不许引 tests/ 里的东西。
// 给全程沙盘的地面上色的程序是工具（tests/tools/route/paint.ts）：它不随网站发出去，页面只取它画好的两张图。
// 哪一天 src/ 里有文件引了它（或者 tests/ 里别的文件），它就跟着进了发出去的程序。读源文件的字来查。

import { describe, expect, it } from 'vitest';

const sources = import.meta.glob<string>('/src/**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true });

/** 一个文件里引入的路径：import … from、export … from、只为副作用的 import、动态的 import()。 */
function importsOf(text: string): string[] {
  const found: string[] = [];
  for (const m of text.matchAll(/(?:^|\n)[ \t]*(?:import|export)\s+(?:type\s+)?[^'"`;]*?\bfrom\s*['"]([^'"]+)['"]/g)) found.push(m[1]);
  for (const m of text.matchAll(/(?:^|\n)[ \t]*import\s*['"]([^'"]+)['"]/g)) found.push(m[1]);
  for (const m of text.matchAll(/\bimport\(\s*['"]([^'"]+)['"]\s*\)/g)) found.push(m[1]);
  return found;
}

/** 从 fromFile（“/src/…”）出发，这一句相对路径的引入落在哪（“/…”，不带扩展名）；不是相对路径时是 null。 */
function target(fromFile: string, spec: string): string | null {
  if (!spec.startsWith('.')) return null;
  const parts = fromFile.split('/').slice(0, -1);
  for (const piece of spec.split('/')) {
    if (piece === '.' || piece === '') continue;
    if (piece === '..') parts.pop();
    else parts.push(piece);
  }
  return parts.join('/');
}

describe('src/ 不引 tests/', () => {
  it('读得到要查的文件；这个查法认得出引入', () => {
    expect(Object.keys(sources).length).toBeGreaterThan(50);
    expect(importsOf(sources['/src/stage/index.ts'])).toContain('./three/routeLevel');
    expect(target('/src/stage/three/view.ts', '../ground/route')).toBe('/src/stage/ground/route');
    expect(target('/src/stage/three/view.ts', '../../../tests/tools/route/paint')).toBe('/tests/tools/route/paint');
    expect(target('/src/stage/three/view.ts', 'three')).toBeNull();
  });

  it('没有哪个文件引了 src/ 外面的东西（tests/、content/ 里的程序、项目根目录上的文件）', () => {
    const outside: string[] = [];
    for (const [file, text] of Object.entries(sources)) {
      for (const spec of importsOf(text)) {
        const to = target(file, spec);
        // 样式表、内容文件用别的办法取（import.meta.glob），这里只看写成 import 的；落在 /src/ 里面的才合格
        if (to !== null && !to.startsWith('/src/')) outside.push(`${file} 引了 ${spec}`);
        if (spec.startsWith('/tests') || spec.startsWith('tests/')) outside.push(`${file} 引了 ${spec}`);
      }
    }
    expect(outside).toEqual([]);
  });
});
