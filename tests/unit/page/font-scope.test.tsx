// 页面把自己的字体归哪个范围写到 <html> 上（src/fonts/scope.ts）：两个属性，data-fonts 和 data-fonts-unit。
// 用假 DOM（miniDom.ts）在 Node 里查：每一种地址写什么，换页的时候跟着换，首页等名单读出来才写，没有 <html> 可写的地方不出错；
// index.html 里先写一遍的那几行脚本，和它写的是同样的两个属性；页面的程序一起来就写、并且自己听着地址（路由还没开始听的时候地址变了也跟着换）。
// 浏览器里的样子在 tests/e2e/fonts.spec.ts 里查。
import { describe, expect, it } from 'vitest';
import { parseHash } from '../../../src/app/router';
import type { FigureCard } from '../../../src/domain';
import { readBytes } from '../../support/readBytes';
import { installMiniDom } from './miniDom';

const doc = installMiniDom('?stage=fake');
const win = (globalThis as any).window;
const root = doc.documentElement;

const { act } = await import('react');
const { createRoot } = await import('react-dom/client');
const { useRoute } = await import('../../../src/app/router');
const { followFontScope, fontScope, nameFontScope } = await import('../../../src/fonts/scope');
const { HomePage } = await import('../../../src/ui/HomePage');

const utf8 = new TextDecoder();
const cards = (JSON.parse(utf8.decode(readBytes('content/figures/index.json'))) as FigureCard[]).sort((a, b) => a.sortYear - b.sortYear);
/** 首页的沙盘栏里摆着的那位人物：头一位可以点进去的。 */
const HOME = cards.find((card) => card.available)?.id ?? '';
const attrs = (): [string | null, string | null] => [root.getAttribute('data-fonts'), root.getAttribute('data-fonts-unit')];
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const settle = (ms = 40) => act(async () => void (await sleep(ms)));
async function waitFor(ok: () => boolean, ms = 15000) {
  const until = Date.now() + ms;
  while (!ok() && Date.now() < until) await settle(20);
  if (!ok()) throw new Error('等不到');
}

describe('页面的字体归哪个范围，写在 <html> 上', () => {
  it('每一种地址各写什么：首页写沙盘栏里摆着的那位人物（还不知道是谁就不写）；人物页写他的 id；站点页再写上这一站的 id（有没有自己的字体文件都写）；“来源”页写 sources；地址里的人物、站不在内容里，也照地址写（认不认由样式表定）', () => {
    const at = (hash: string, home = ''): [string, string] => fontScope(parseHash(hash), home);
    expect(at('')).toEqual(['', '']);
    expect(at('#/')).toEqual(['', '']);
    expect(at('#/', 'su-shi')).toEqual(['su-shi', '']);
    expect(at('#/su-shi')).toEqual(['su-shi', '']);
    expect(at('#/goethe', 'su-shi')).toEqual(['goethe', '']);
    // 有正文的一站，和两样都没有的一站：写法一样
    expect(at('#/su-shi/xuzhou')).toEqual(['su-shi', 'xuzhou']);
    expect(at('#/su-shi/mizhou', 'su-shi')).toEqual(['su-shi', 'mizhou']);
    expect(at('#/sources', 'su-shi')).toEqual(['sources', '']);
    // 不在内容里的人物、站
    expect(at('#/nobody')).toEqual(['nobody', '']);
    expect(at('#/su-shi/nowhere')).toEqual(['su-shi', 'nowhere']);
    // 地址里转了码的照解出来的写；后面多出来的几截不算
    expect(at('#/%E7%94%B2/%E4%B9%99/more')).toEqual(['甲', '乙']);
  });

  it('写到 <html> 上：有的写上，这一页没有的拿掉；不说是哪一页就还是原来那一页；首页的人物说过一回就记着', () => {
    expect(HOME, '内容里要有一位可以点进去的人物').not.toBe('');
    nameFontScope(parseHash('#/su-shi/xuzhou'), '');
    expect(attrs()).toEqual(['su-shi', 'xuzhou']);
    nameFontScope(parseHash('#/goethe'));
    expect(attrs()).toEqual(['goethe', null]);
    nameFontScope(parseHash('#/sources'));
    expect(attrs()).toEqual(['sources', null]);
    // 首页：还不知道沙盘栏里摆着谁，两个都没有
    nameFontScope(parseHash('#/'));
    expect(attrs()).toEqual([null, null]);
    // 名单读出来了（首页说的这一声不带“是哪一页”）
    nameFontScope(undefined, HOME);
    expect(attrs()).toEqual([HOME, null]);
    // 走开再回来：记着的那一位马上写上
    nameFontScope(parseHash('#/goethe/valmy'));
    expect(attrs()).toEqual(['goethe', 'valmy']);
    nameFontScope(parseHash('#/'));
    expect(attrs()).toEqual([HOME, null]);
    // 在别的页面上说“首页摆着谁”：这一页的两个属性不动
    nameFontScope(parseHash('#/sources'));
    nameFontScope(undefined, 'goethe');
    expect(attrs()).toEqual(['sources', null]);
    nameFontScope(parseHash('#/'));
    expect(attrs()).toEqual(['goethe', null]);
    nameFontScope(parseHash('#/'), '');
    expect(attrs()).toEqual([null, null]);
  });

  it('没有 <html> 可写的地方（不在浏览器里、文档还没有根）不出错，什么也不做；有了以后照常写', () => {
    const g = globalThis as any;
    const kept = g.document;
    try {
      delete g.document;
      expect(() => nameFontScope(parseHash('#/su-shi/xuzhou'))).not.toThrow();
      g.document = { documentElement: null };
      expect(() => nameFontScope(parseHash('#/goethe'))).not.toThrow();
    } finally {
      g.document = kept;
    }
    // 上面两回都没处写：<html> 上还是原来的样子
    expect(attrs()).toEqual([null, null]);
    nameFontScope();
    expect(attrs()).toEqual(['goethe', null]);
  });

  it('换页：地址一变，新的一页还没画，两个属性已经换好了（路由听到地址变了先写它）；走一圈——首页、苏轼、他的一站、歌德、“来源”页，再一步一步退回来', async () => {
    nameFontScope(parseHash('#/'), '');
    win.location.hash = '#/';
    const container = doc.createElement('div');
    doc.body.appendChild(container);
    const view = createRoot(container as any);
    const drawn: string[] = [];
    function Page() {
      const route = useRoute();
      // 画这一页的时候，<html> 上已经是这一页的范围了
      drawn.push(`${route.page} ${attrs().map((value) => value ?? '-').join(' ')}`);
      return <p>{route.page}</p>;
    }
    await act(async () => view.render(<Page />));
    const go = async (hash: string): Promise<[string | null, string | null]> => {
      win.location.hash = hash;
      let atEvent: [string | null, string | null] = [null, null];
      await act(async () => {
        win.fire('hashchange');
        // 事件刚发完、页面还没重画的这一下
        atEvent = attrs();
      });
      expect(attrs()).toEqual(atEvent);
      return atEvent;
    };
    const walk = ['#/su-shi', '#/su-shi/xuzhou', '#/goethe', '#/sources', '#/goethe', '#/su-shi/xuzhou', '#/su-shi', '#/'];
    const seen: [string | null, string | null][] = [];
    for (const hash of walk) seen.push(await go(hash));
    expect(seen).toEqual([
      ['su-shi', null],
      ['su-shi', 'xuzhou'],
      ['goethe', null],
      ['sources', null],
      ['goethe', null],
      ['su-shi', 'xuzhou'],
      ['su-shi', null],
      [null, null],
    ]);
    // 每一页画的时候看到的就是它自己的范围（头一回画的是首页，还不知道摆着谁）
    expect(drawn.filter((line, index) => drawn.indexOf(line) === index)).toEqual(['home - -', 'figure su-shi -', 'stop su-shi xuzhou', 'figure goethe -', 'sources sources -']);
    await act(async () => view.unmount());
    container.remove();
  });

  it('首页：名单读出来以后，写的是沙盘栏里摆着的那位人物（头一位可以点进去的），和版面上记的 data-figure 是同一位；名单读出来以前不写', async () => {
    nameFontScope(parseHash('#/'), '');
    expect(attrs()).toEqual([null, null]);
    const container = doc.createElement('div');
    doc.body.appendChild(container);
    const view = createRoot(container as any);
    await act(async () => view.render(<HomePage />));
    await waitFor(() => container.querySelectorAll('.card').length > 0);
    expect(attrs()).toEqual([HOME, null]);
    expect(container.querySelector('.home-layout')?.getAttribute('data-figure')).toBe(HOME);
    await act(async () => view.unmount());
    container.remove();
    // 首页拿走以后还记着：下一回到首页马上写上
    nameFontScope(parseHash('#/sources'));
    nameFontScope(parseHash('#/'));
    expect(attrs()).toEqual([HOME, null]);
  });

  it('index.html 里先写一遍的那几行脚本：照地址写的两个属性，和页面的程序写的一模一样（首页的人物它不知道，不写）；它在页面的程序前面', () => {
    const html = utf8.decode(readBytes('index.html'));
    const script = /<script>\s*(\(function \(\) \{\s*var parts = location\.hash[\s\S]*?\}\)\(\);)\s*<\/script>/.exec(html);
    expect(script, 'index.html 里照地址写那两个属性的几行脚本').not.toBeNull();
    if (!script) return;
    expect(html.indexOf(script[0])).toBeLessThan(html.indexOf('<script type="module"'));
    expect(html.indexOf(script[0])).toBeLessThan(html.indexOf('</head>'));
    const run = new Function('location', 'document', script[1]) as (location: { hash: string }, document: unknown) => void;
    const early = (hash: string): [string, string] => {
      const set: Record<string, string> = {};
      run({ hash }, { documentElement: { setAttribute: (name: string, value: string) => void (set[name] = value) } });
      expect(Object.keys(set).filter((name) => name !== 'data-fonts' && name !== 'data-fonts-unit')).toEqual([]);
      return [set['data-fonts'] ?? '', set['data-fonts-unit'] ?? ''];
    };
    for (const hash of ['', '#', '#/', '#/su-shi', '#/su-shi/', '#/su-shi/xuzhou', '#/goethe/valmy', '#/sources', '#/nobody', '#/su-shi/nowhere', '#//su-shi//xuzhou', '#/%E7%94%B2/%E4%B9%99/more', '#/%zz/%E4%B9', 'su-shi/xuzhou']) {
      expect(early(hash), hash).toEqual(fontScope(parseHash(hash), ''));
    }
    // 这几行里没有汉字（做字体的工具照 index.html 里的字数，注释不算）
    expect([...script[1]].filter((ch) => (ch.codePointAt(0) ?? 0) > 0x7e)).toEqual([]);
  });

  it('页面的程序（src/main.tsx）一起来就照地址写、并且从这时起自己听着地址：这一句在把页面画出来的那一句前面（去掉 index.html 里那几行页面照样对，靠的就是它）', () => {
    // 去掉注释再看（注释里也提到这几个名字）
    const code = utf8
      .decode(readBytes('src/main.tsx'))
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    const call = /followFontScope\(\s*\(\)\s*=>\s*parseHash\(window\.location\.hash\)\s*\)/.exec(code);
    expect(call, 'src/main.tsx 里叫 followFontScope 的那一句').not.toBeNull();
    if (!call) return;
    const render = code.indexOf('createRoot(');
    expect(render).toBeGreaterThan(-1);
    expect(call.index).toBeLessThan(render);
    // 它前面只有引入：没有哪一句可能先出错把它挡住
    expect(code.slice(0, call.index).split('\n').filter((line) => line.trim() !== '' && !/^import\b/.test(line.trim()))).toEqual([]);
  });

  // 放在最后：followFontScope 挂上的那一个听的人摘不掉，后面的每一项都会带着它
  it('页面还在起来、路由还没开始听的时候地址又变了（读者又按了一次“后退”）：两个属性照样跟着换，不留在原来那一页上——页面的程序一起来就自己听着，不靠路由；回到首页，写的是记着的那一位，首页后来说的那一声也算在首页上', () => {
    win.location.hash = '#/su-shi/xuzhou';
    nameFontScope(parseHash('#/sources'), '');
    // 页面的程序起来：照地址写一遍。这时候没有谁画过页面，路由没有在听
    followFontScope(() => parseHash(win.location.hash));
    expect(attrs()).toEqual(['su-shi', 'xuzhou']);
    const change = (hash: string): [string | null, string | null] => {
      win.location.hash = hash;
      win.fire('hashchange');
      return attrs();
    };
    expect(change('#/goethe')).toEqual(['goethe', null]);
    expect(change('#/goethe/rome')).toEqual(['goethe', 'rome']);
    expect(change('#/sources')).toEqual(['sources', null]);
    expect(change('#/su-shi/xuzhou')).toEqual(['su-shi', 'xuzhou']);
    // 回到首页：还不知道沙盘栏里摆着谁，两个都拿掉（不留着上一页的）；首页读出名单以后说一声，写在首页上
    expect(change('#/')).toEqual([null, null]);
    nameFontScope(undefined, HOME);
    expect(attrs()).toEqual([HOME, null]);
    // 再走开、再回来：记着的那一位马上写上
    expect(change('#/goethe/rome')).toEqual(['goethe', 'rome']);
    expect(change('#/')).toEqual([HOME, null]);
  });
});
