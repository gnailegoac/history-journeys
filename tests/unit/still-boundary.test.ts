// 定格图的沙盘不许把 three 带进来：它是页面里静态引入的，画不了三维的设备也要用它，
// 一旦它（或者它用的题签层）引了 three、src/stage/three/ 或 src/stage/ground/，沙盘程序那一大块就跟着页面一起下载了。
//
// 查两样，都是读源文件的字：
//   1 src/stage/still/ 和 src/stage/overlay/ 里的文件，一句这样的引入也没有（只引类型也不行）；
//   2 从 src/stage/still/index.ts 顺着引入一层一层找下去（只引类型的不算，构建时会去掉），
//     碰不到 three，也碰不到那两个文件夹里的文件。
// 浏览器里另有一项（tests/e2e/still-table.spec.ts）：只放定格图时，没有下载沙盘程序那一块，页面上没有画布。

import { describe, expect, it } from 'vitest';

/** src/ 里所有程序文件的字，按“/src/…”的路径。 */
const sources = import.meta.glob<string>('/src/**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true });

interface Import {
  from: string;
  typeOnly: boolean;
}

/** 一个文件里的引入：import … from、export … from、只为副作用的 import、动态的 import()。注释里的不算（要在一行的开头）。 */
function importsOf(text: string): Import[] {
  const found: Import[] = [];
  for (const m of text.matchAll(/(?:^|\n)[ \t]*(?:import|export)\s+(type\s+)?[^'"`;]*?\bfrom\s*['"]([^'"]+)['"]/g)) found.push({ from: m[2], typeOnly: m[1] !== undefined });
  for (const m of text.matchAll(/(?:^|\n)[ \t]*import\s*['"]([^'"]+)['"]/g)) found.push({ from: m[1], typeOnly: false });
  for (const m of text.matchAll(/\bimport\(\s*['"]([^'"]+)['"]\s*\)/g)) found.push({ from: m[1], typeOnly: false });
  return found;
}

/** 这一句引的是不是 three，或者 three、ground 那两个文件夹里的东西。 */
function forbidden(from: string): boolean {
  return from === 'three' || from.startsWith('three/') || /(^|\/)(three|ground)(\/|$)/.test(from);
}

/** 相对路径的引入落在哪个文件上；不是相对路径（装的库）、或者不是程序文件（样式）时是 null。 */
function resolve(fromFile: string, spec: string): string | null {
  if (!spec.startsWith('.')) return null;
  const parts = fromFile.split('/').slice(0, -1);
  for (const piece of spec.split('/')) {
    if (piece === '.' || piece === '') continue;
    if (piece === '..') parts.pop();
    else parts.push(piece);
  }
  const base = parts.join('/');
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`]) {
    if (candidate in sources) return candidate;
  }
  return null;
}

describe('定格图的沙盘不碰 three', () => {
  it('读得到要查的文件', () => {
    const paths = Object.keys(sources);
    expect(paths).toContain('/src/stage/still/index.ts');
    expect(paths).toContain('/src/stage/still/engine.ts');
    expect(paths).toContain('/src/stage/still/fit.ts');
    expect(paths.some((path) => path.startsWith('/src/stage/overlay/'))).toBe(true);
    // 这个查法认得出沙盘程序里的引入（不然下面两项什么也查不出来）
    expect(importsOf(sources['/src/stage/three/engine.ts']).some((i) => forbidden(i.from))).toBe(true);
    expect(importsOf(sources['/src/stage/three/rig.ts']).some((i) => i.from.includes('ground') && forbidden(i.from))).toBe(true);
    expect(forbidden('../three/rig')).toBe(true);
    expect(forbidden('../ground')).toBe(true);
    expect(forbidden('three/addons/controls/OrbitControls.js')).toBe(true);
    expect(forbidden('../overlay')).toBe(false);
    expect(forbidden('../../domain/sceneText')).toBe(false);
    expect(importsOf(sources['/src/stage/index.ts']).map((i) => i.from)).toContain('./three/engine');
  });

  it('src/stage/still/ 和 src/stage/overlay/ 里没有一句引入 three、../three/、../ground/ 的（只引类型也不行）', () => {
    const bad: string[] = [];
    for (const [path, text] of Object.entries(sources)) {
      if (!path.startsWith('/src/stage/still/') && !path.startsWith('/src/stage/overlay/')) continue;
      for (const i of importsOf(text)) if (forbidden(i.from)) bad.push(`${path} 引了 ${i.from}`);
    }
    expect(bad).toEqual([]);
  });

  it('从 src/stage/still/index.ts 顺着引入找下去，碰不到 three，也碰不到 src/stage/three/、src/stage/ground/', () => {
    const seen = new Set<string>();
    const bad: string[] = [];
    const queue = ['/src/stage/still/index.ts'];
    while (queue.length > 0) {
      const file = queue.pop()!;
      if (seen.has(file)) continue;
      seen.add(file);
      if (file.startsWith('/src/stage/three/') || file.startsWith('/src/stage/ground/')) bad.push(`顺着引入到了 ${file}`);
      for (const i of importsOf(sources[file])) {
        if (i.typeOnly) continue;
        if (i.from === 'three' || i.from.startsWith('three/')) bad.push(`${file} 引了 ${i.from}`);
        const next = resolve(file, i.from);
        if (next) queue.push(next);
      }
    }
    expect(bad).toEqual([]);
    // 确实走到了它用的几样：题签层、比例尺、从场景生成题签上的字
    expect([...seen]).toEqual(expect.arrayContaining(['/src/stage/still/engine.ts', '/src/stage/still/fit.ts', '/src/stage/overlay/index.ts', '/src/stage/scale.ts', '/src/domain/sceneText.ts']));
  });
});
