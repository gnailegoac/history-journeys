// “这个浏览器能不能画立体的沙盘”怎么问（src/stage/support.ts 的 probeWebgl）。页面在下载沙盘程序之前先问它。
// 页面（document）是这里给的假的；结果是记在文件里的，所以每个测试都重新加载一遍这个文件。
// 运行：npx vitest run tests/stage/support.test.ts
//
// 各种浏览器对“只能用软件画”怎么回答，这里查不了：那要到真的浏览器里看。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readBytes } from '../support/readBytes';

type Answer = 'gl' | 'none' | 'throw';

/**
 * 假的页面：只会造画布，画布只会回答“要一个 WebGL2 的画面”。
 * answer(strict)：strict 是 true 时问的是“只能用软件画就不要了”的那一种。
 * log 记下：造了几块画布，先后各问的是哪一种，要到手的画面放掉了几个。
 */
function fakePage(answer: (strict: boolean) => Answer, options: { noLoseContext?: boolean } = {}) {
  const log = { canvases: 0, asks: [] as ('strict' | 'plain')[], released: 0 };
  const document = {
    createElement(tag: string) {
      expect(tag).toBe('canvas');
      log.canvases += 1;
      return {
        getContext(kind: string, attributes?: { failIfMajorPerformanceCaveat?: boolean }) {
          expect(kind).toBe('webgl2');
          const strict = attributes?.failIfMajorPerformanceCaveat === true;
          log.asks.push(strict ? 'strict' : 'plain');
          const result = answer(strict);
          if (result === 'throw') throw new Error('浏览器不让用');
          if (result === 'none') return null;
          return {
            getExtension: (name: string) => {
              if (name !== 'WEBGL_lose_context' || options.noLoseContext) return null;
              return {
                loseContext() {
                  log.released += 1;
                },
              };
            },
          };
        },
      };
    },
  };
  return { document, log };
}

/** 重新加载一遍（结果是记在文件里的）。 */
async function freshProbe(): Promise<() => { webgl2: boolean; caveat: boolean }> {
  vi.resetModules();
  const { probeWebgl } = await import('../../src/stage/support');
  return probeWebgl;
}

beforeEach(() => {
  vi.unstubAllGlobals();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('问浏览器能不能画立体的沙盘', () => {
  it('有显卡的浏览器：能画，没有“会很慢”的提示；只问了一次，要到的画面马上放掉', async () => {
    const page = fakePage(() => 'gl');
    vi.stubGlobal('document', page.document);
    const probeWebgl = await freshProbe();
    expect(probeWebgl()).toEqual({ webgl2: true, caveat: false });
    expect(page.log).toEqual({ canvases: 1, asks: ['strict'], released: 1 });
  });

  it('只能用软件画的浏览器：能画，带着“会很慢”的提示；第二次是另造一块画布问的', async () => {
    const page = fakePage((strict) => (strict ? 'none' : 'gl'));
    vi.stubGlobal('document', page.document);
    const probeWebgl = await freshProbe();
    expect(probeWebgl()).toEqual({ webgl2: true, caveat: true });
    expect(page.log).toEqual({ canvases: 2, asks: ['strict', 'plain'], released: 1 });
  });

  it('不支持 WebGL2：不能画（也就没有什么提示）', async () => {
    const page = fakePage(() => 'none');
    vi.stubGlobal('document', page.document);
    const probeWebgl = await freshProbe();
    expect(probeWebgl()).toEqual({ webgl2: false, caveat: false });
    expect(page.log).toEqual({ canvases: 2, asks: ['strict', 'plain'], released: 0 });
  });

  it('浏览器一问就出错：当作不能画，不把错误抛给页面', async () => {
    const page = fakePage(() => 'throw');
    vi.stubGlobal('document', page.document);
    const probeWebgl = await freshProbe();
    expect(probeWebgl()).toEqual({ webgl2: false, caveat: false });
  });

  it('第一种问法出错、第二种问到了：能画，带着提示', async () => {
    const page = fakePage((strict) => (strict ? 'throw' : 'gl'));
    vi.stubGlobal('document', page.document);
    const probeWebgl = await freshProbe();
    expect(probeWebgl()).toEqual({ webgl2: true, caveat: true });
  });

  it('浏览器没有“放掉画面”的功能：照样答得出来', async () => {
    const page = fakePage(() => 'gl', { noLoseContext: true });
    vi.stubGlobal('document', page.document);
    const probeWebgl = await freshProbe();
    expect(probeWebgl()).toEqual({ webgl2: true, caveat: false });
    expect(page.log.released).toBe(0);
  });

  it('只试一次：再问多少遍都是记下来的那个结果，不再造画布；页面后来变了也不重试', async () => {
    const page = fakePage((strict) => (strict ? 'none' : 'gl'));
    vi.stubGlobal('document', page.document);
    const probeWebgl = await freshProbe();
    const first = probeWebgl();
    expect(probeWebgl()).toBe(first);
    expect(probeWebgl()).toBe(first);
    expect(page.log.canvases).toBe(2);

    const later = fakePage(() => 'none');
    vi.stubGlobal('document', later.document);
    expect(probeWebgl()).toBe(first);
    expect(later.log.canvases).toBe(0);
  });

  it('不能画的结果也只试一次', async () => {
    const page = fakePage(() => 'none');
    vi.stubGlobal('document', page.document);
    const probeWebgl = await freshProbe();
    probeWebgl();
    probeWebgl();
    expect(page.log.canvases).toBe(2);
  });

  it('没有页面（在 Node 里）：答不能画，不出错', async () => {
    const probeWebgl = await freshProbe();
    expect(probeWebgl()).toEqual({ webgl2: false, caveat: false });
  });
});

describe('这个文件要能在沙盘程序下载之前用', () => {
  it('它什么也不引入：不碰 three，也不从 src/stage/three/ 里取东西', () => {
    const source = new TextDecoder().decode(readBytes('src/stage/support.ts'));
    expect(source).toContain('export function probeWebgl');
    expect(source).not.toMatch(/^\s*import\s/m);
    expect(source).not.toMatch(/\bfrom\s+['"]/);
    expect(source).not.toMatch(/\bimport\s*\(/);
  });
});
