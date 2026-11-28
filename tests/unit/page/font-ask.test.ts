// 页面照自己的范围去要字体文件（src/fonts/scope.ts）：在 Node 里查，不开浏览器。
// 这里不用假 DOM，只给 scope.ts 用到的那几样各编一个最小的：<html> 上的属性，document.fonts（check、load），getComputedStyle
//（照做字体的工具写的 src/fonts/fonts.css 里那几条换名称的规则算 --own-sans、--own-song：规则是真的，认的是 <html> 上那两个属性），
// document.head 和 <link>。查的是：
//   一、范围换了才要，要的正好是记录里这一种页面不用点开就要的黑体、宋体文件在样式表里的名称；同一个范围不要第二回；
//       不是哪一页的地址（没有这位人物、#/sources/…）什么也不要。
//   二、正文那一栏等这一页自己的字体文件：文件已经在手里的不等；没到的挂上 data-fonts-wait，到了拿掉，过了 FONT_WAIT_MS 也拿掉；
//       换了页，上一页那一回不算数。
//   三、没取成、浏览器没有 document.fonts、点开才要的字的那张表没取到、那份样式表没取到：页面照样在，什么也不抛出来；
//       前一页正等着的时候新的一页当场出了错，前一页挂的“等一等”也拿掉。
//       取过一回没取成的，下一回再取：字体文件——范围再换的时候把记着“没取成”的那一条 @font-face 原样重写一遍；
//       点开才要的字的样式表——没取到的那一条 <link> 拿掉，下一回重新挂。
//   四、点开才要的字：这一页那个范围的样式表挂上去，一份只挂一回；没有自己的文件的一站挂的是人物的；写好了的一站空下来的时候叫浏览器把文件取来。
// 浏览器里的样子在 tests/e2e/fonts.spec.ts 里查。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseHash } from '../../../src/app/router';
import { FONT_WAIT_MS, followFontScope, nameFontScope, ownPressed } from '../../../src/fonts/scope';
import { readBytes } from '../../support/readBytes';

const utf8 = new TextDecoder();
const text = (path: string): string => utf8.decode(readBytes(path));

interface RecordFile {
  file: string;
  face: string;
  source: string;
  scope: string;
  unit: string | null;
  role: string;
  sheet: string;
  characters: string;
}
interface RecordPage {
  kind: string;
  figure: string | null;
  unit: string | null;
  rest: string[];
  pressed: string[];
}
const record = JSON.parse(text('src/fonts/fonts.json')) as { home: string | null; files: RecordFile[]; pages: RecordPage[] };
const fileOf = (path: string): RecordFile => {
  const found = record.files.find((item) => item.file === path);
  if (!found) throw new Error(`记录里没有 ${path}`);
  return found;
};

// ---- <html>、document.fonts、getComputedStyle、document.head：各编一个最小的
const attributes = new Map<string, string>();
const root = {
  setAttribute: (name: string, value: string) => void attributes.set(name, value),
  removeAttribute: (name: string) => void attributes.delete(name),
  getAttribute: (name: string) => attributes.get(name) ?? null,
  hasAttribute: (name: string) => attributes.has(name),
};
/** fonts.css 里那几条换名称的规则（真的那一份）：认哪位人物、哪一站（或者不许写着站），各写哪两个名称。 */
const RULES = text('src/fonts/fonts.css')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n')
  .filter((line) => line.startsWith(':root'))
  .map((line) => ({
    fonts: /\[data-fonts='([^']+)'\]/.exec(line)?.[1] ?? '',
    unit: /\[data-fonts-unit='([^']+)'\]/.exec(line)?.[1] ?? null,
    noUnit: line.includes(':not([data-fonts-unit])'),
    sets: Object.fromEntries([...line.matchAll(/(--own-[a-z]+): ('[^']+');/g)].map((match) => [match[1], match[2]])) as Record<string, string>,
  }));
/** 浏览器照这几条规则算出来的一个记号（后写的、条件多的那一条盖住前面的：文件里一站的规则都排在人物的后面）。 */
const computed = (name: string): string => {
  let value = '';
  for (const rule of RULES) {
    if (rule.fonts !== root.getAttribute('data-fonts')) continue;
    if (rule.unit !== null && rule.unit !== root.getAttribute('data-fonts-unit')) continue;
    if (rule.noUnit && root.hasAttribute('data-fonts-unit')) continue;
    if (name in rule.sets) value = rule.sets[name];
  }
  return value;
};
interface Deferred {
  font: string;
  text?: string;
  resolve: () => void;
  reject: () => void;
}
/**
 * 编出来的 document.fonts：loaded 里的名称算已经在手里；load 记下来，返回一个由测试放行的 Promise（auto 是 true 就当场给）。
 * faces 是浏览器手里的每一条 @font-face 现在怎样（forEach 给出来的）：status 是 error 的就是取过、没取成的。
 */
const fonts = { loaded: new Set<string>(), asked: [] as Deferred[], auto: true, checkThrows: false, faces: [] as { family: string; status: string }[] };
/** 先后发生的事：哪一份样式表的哪一条规则重写了，叫浏览器取了哪一个（查“先重写，再去要”用）。 */
const events: string[] = [];
const fontSet = {
  check(font: string): boolean {
    if (fonts.checkThrows) throw new Error('这个浏览器的 check 当场出错');
    return fonts.loaded.has(font);
  },
  load(font: string, probe?: string): Promise<unknown[]> {
    events.push(`load ${font}`);
    return new Promise((resolve, reject) => {
      const done = (): void => {
        fonts.loaded.add(font);
        resolve([]);
      };
      fonts.asked.push({ font, text: probe, resolve: done, reject: () => reject(new Error('没取成')) });
      if (fonts.auto) done();
    });
  },
  forEach(each: (face: { family: string; status: string }) => void): void {
    fonts.faces.forEach(each);
  },
};
interface Link {
  rel: string;
  href: string;
  onload: (() => void) | null;
  onerror: (() => void) | null;
  remove: () => void;
}
/** 现在挂在页面上的 <link>（拿掉了的不在里面）。 */
const links: Link[] = [];
/** 编出来的一份样式表：一条条规则的原文；重写（先在原处插一条，再把后面那条旧的删掉）记在 events 里。 */
interface Sheet {
  cssRules: { cssText: string }[];
  insertRule(rule: string, at: number): void;
  deleteRule(at: number): void;
}
const makeSheet = (name: string, rules: string[]): Sheet => {
  const sheet: Sheet = {
    cssRules: rules.map((cssText) => ({ cssText })),
    insertRule(rule, at) {
      events.push(`${name} insert ${at}`);
      sheet.cssRules.splice(at, 0, { cssText: rule });
    },
    deleteRule(at) {
      events.push(`${name} delete ${at}`);
      sheet.cssRules.splice(at, 1);
    },
  };
  return sheet;
};
/** 页面上的样式表（document.styleSheets）。 */
const styleSheets: object[] = [];
const listeners: (() => void)[] = [];
const globals = globalThis as unknown as Record<string, unknown>;
globals.document = {
  documentElement: root,
  fonts: fontSet,
  styleSheets,
  head: { appendChild: (link: Link) => void links.push(link) },
  createElement: (): Link => {
    const link: Link = { rel: '', href: '', onload: null, onerror: null, remove: () => void links.splice(links.indexOf(link), 1) };
    return link;
  },
};
globals.getComputedStyle = () => ({ getPropertyValue: computed });
globals.window = { addEventListener: (_type: string, listener: () => void) => void listeners.push(listener), location: { hash: '' } };
const win = globals.window as { location: { hash: string } };

/** 让挂着的 Promise 都走完（不靠等时间）。 */
const flush = async (): Promise<void> => {
  for (let i = 0; i < 12; i++) await Promise.resolve();
};
const asked = (): string[] => fonts.asked.map((item) => item.font);
/** 换到一个哪一条规则也不认的地址，把“上一回是给谁要的”清掉。 */
const away = async (): Promise<void> => {
  nameFontScope(parseHash('#/zz-nobody'), record.home ?? '');
  await flush();
  fonts.asked.length = 0;
};
/** 记录里一种页面不用点开就要的黑体、宋体文件（框架的、楷体的不算），写成页面叫浏览器去取时说的那一句。 */
const wanted = (page: RecordPage): string[] => {
  const own = page.rest.map(fileOf).filter((item) => item.scope !== 'frame' && item.source !== 'kai');
  return [...own.filter((item) => item.source === 'sans').map((item) => `500 1em '${item.face}'`), ...own.filter((item) => item.source === 'song').map((item) => `1em '${item.face}'`)];
};
const hashOf = (page: RecordPage): string => (page.kind === 'home' ? '#/' : page.kind === 'sources' ? '#/sources' : page.unit ? `#/${page.figure}/${page.unit}` : `#/${page.figure}`);

beforeEach(async () => {
  fonts.auto = true;
  fonts.checkThrows = false;
  fonts.loaded.clear();
  fonts.faces = [];
  styleSheets.length = 0;
  (globals.document as { fonts?: unknown }).fonts = fontSet;
  globals.getComputedStyle = () => ({ getPropertyValue: computed });
  await away();
  events.length = 0;
});
afterEach(() => {
  vi.useRealTimers();
});

describe('页面照自己的范围要字体文件', () => {
  it('每一种页面要的，正好是记录里这一种页面不用点开就要的黑体、宋体文件在样式表里的名称（黑体带着粗细 500）；框架的两个不在里面（index.html 里一打开就取了），楷体不在里面（沙盘栏知道要摆沙盘了才要）', async () => {
    const pages = record.pages.filter((page) => page.kind !== 'frame');
    expect(pages.map((page) => page.kind).filter((kind, index, all) => all.indexOf(kind) === index).sort()).toEqual(['figure', 'home', 'sources', 'unit']);
    for (const page of pages) {
      await away();
      nameFontScope(parseHash(hashOf(page)), record.home ?? '');
      expect(asked(), hashOf(page)).toEqual(wanted(page));
      expect(wanted(page).length, hashOf(page)).toBeGreaterThan(0);
    }
    // 没有自己的文件的一站：要的是这位人物的（样式表里只有人物的那一条规则合得上）
    const figure = pages.find((page) => page.kind === 'figure');
    await away();
    nameFontScope(parseHash(`#/${figure?.figure}/zz-no-such-stop`));
    expect(asked()).toEqual(figure ? wanted(figure) : []);
  });

  it('同一个范围不要第二回（页面的程序、路由、首页各说一遍也只要一回）；换了范围再要；换回来的时候文件已经在手里，说一声就是了，正文不等', async () => {
    nameFontScope(parseHash('#/su-shi/xuzhou'));
    const first = asked();
    expect(first).toHaveLength(2);
    nameFontScope(parseHash('#/su-shi/xuzhou'));
    nameFontScope();
    nameFontScope(undefined, 'goethe');
    expect(asked()).toEqual(first);
    nameFontScope(parseHash('#/goethe'));
    expect(asked().slice(2)).toEqual(["500 1em 'Yanlu Sans goethe'", "1em 'Yanlu Song goethe'"]);
    await flush();
    nameFontScope(parseHash('#/su-shi/xuzhou'));
    // 换回来又说了一遍（浏览器手里有，不会再取）；这一回不挂“等一等”
    expect(asked().slice(4)).toEqual(first);
    expect(root.hasAttribute('data-fonts-wait')).toBe(false);
  });

  it('不是哪一页的地址什么也不要：没有这位人物；#/sources/…（“来源”页的那一条规则只认没有写着站的时候）；首页还不知道沙盘栏里摆着谁的时候也不要，知道了才要', async () => {
    const load = vi.fn(() => Promise.resolve({ SCOPE_PRESSED: {} }));
    followFontScope(() => parseHash(win.location.hash), load);
    fonts.asked.length = 0;
    load.mockClear();
    for (const hash of ['#/nobody', '#/sources/x', '#/nobody/xuzhou']) {
      nameFontScope(parseHash(hash));
      await flush();
      expect(asked(), hash).toEqual([]);
      expect(root.hasAttribute('data-fonts-wait'), hash).toBe(false);
    }
    // 连点开才要的字的那张表也不去取
    expect(load).not.toHaveBeenCalled();
    // “来源”页自己：要
    nameFontScope(parseHash('#/sources'));
    expect(asked()).toEqual(["1em 'Yanlu Song credits'"]);
    // 首页：还不知道摆着谁——不要；首页说了是谁——要他的
    fonts.asked.length = 0;
    nameFontScope(parseHash('#/'), '');
    expect(asked()).toEqual([]);
    nameFontScope(undefined, 'su-shi');
    expect(asked()).toEqual(["500 1em 'Yanlu Sans su-shi'", "1em 'Yanlu Song su-shi'"]);
  });

  it('页面的程序一起来就要、往后地址每变一回马上再要：路由还没开始听的时候地址变了，要来的是新的一页的文件', async () => {
    win.location.hash = '#/su-shi/xuzhou';
    followFontScope(() => parseHash(win.location.hash));
    expect(asked()).toEqual(["500 1em 'Yanlu Sans su-shi'", "1em 'Yanlu Song su-shi xuzhou'"]);
    win.location.hash = '#/goethe';
    // 页面的程序自己挂的那一个听的人（最后挂上的）听到地址变了
    listeners[listeners.length - 1]();
    expect(asked().slice(2)).toEqual(["500 1em 'Yanlu Sans goethe'", "1em 'Yanlu Song goethe'"]);
    expect([root.getAttribute('data-fonts'), root.getAttribute('data-fonts-unit')]).toEqual(['goethe', null]);
  });
});

describe('正文那一栏等这一页自己的字体文件（最多 FONT_WAIT_MS）', () => {
  it('是 300 毫秒；文件已经在手里的页面从来不挂 data-fonts-wait；首页也不挂', async () => {
    expect(FONT_WAIT_MS).toBe(300);
    fonts.loaded.add("500 1em 'Yanlu Sans su-shi'");
    fonts.loaded.add("1em 'Yanlu Song su-shi'");
    fonts.auto = false;
    nameFontScope(parseHash('#/su-shi'));
    expect(root.hasAttribute('data-fonts-wait')).toBe(false);
    // 有一个还没到：等
    await away();
    fonts.loaded.delete("1em 'Yanlu Song su-shi'");
    nameFontScope(parseHash('#/su-shi'));
    expect(root.hasAttribute('data-fonts-wait')).toBe(true);
    for (const item of fonts.asked) item.resolve();
    await flush();
    expect(root.hasAttribute('data-fonts-wait')).toBe(false);
    // 首页不等：它正文那一栏里只有框架的字，这位人物的文件（没到，照要）是给沙盘栏用的
    await away();
    fonts.loaded.clear();
    nameFontScope(parseHash('#/'), 'su-shi');
    expect(asked()).toEqual(["500 1em 'Yanlu Sans su-shi'", "1em 'Yanlu Song su-shi'"]);
    expect(root.hasAttribute('data-fonts-wait')).toBe(false);
  });

  it('没到的挂上；两个文件都到了才拿掉（到了一个还等着）；文件一直不到，过了 FONT_WAIT_MS 也拿掉——差一毫秒还挂着', async () => {
    vi.useFakeTimers();
    fonts.auto = false;
    nameFontScope(parseHash('#/su-shi/huangzhou'));
    expect(root.hasAttribute('data-fonts-wait')).toBe(true);
    fonts.asked[0].resolve();
    await flush();
    expect(root.hasAttribute('data-fonts-wait')).toBe(true);
    fonts.asked[1].resolve();
    await flush();
    expect(root.hasAttribute('data-fonts-wait')).toBe(false);
    // 另一页，文件一直不到
    nameFontScope(parseHash('#/goethe'));
    expect(root.hasAttribute('data-fonts-wait')).toBe(true);
    await vi.advanceTimersByTimeAsync(FONT_WAIT_MS - 1);
    expect(root.hasAttribute('data-fonts-wait')).toBe(true);
    await vi.advanceTimersByTimeAsync(1);
    expect(root.hasAttribute('data-fonts-wait')).toBe(false);
    // 后来才到：不再挂回去
    for (const item of fonts.asked) item.resolve();
    await flush();
    expect(root.hasAttribute('data-fonts-wait')).toBe(false);
  });

  it('换了页，上一页那一回不算数：上一页的文件到了、上一页的时候到了，都不把新的一页的“等一等”拿掉；新的一页的文件到了才拿掉；换到一页文件在手里的，马上拿掉', async () => {
    vi.useFakeTimers();
    fonts.auto = false;
    nameFontScope(parseHash('#/su-shi/xuzhou'));
    const old = [...fonts.asked];
    await vi.advanceTimersByTimeAsync(FONT_WAIT_MS - 100);
    nameFontScope(parseHash('#/goethe'));
    expect(root.hasAttribute('data-fonts-wait')).toBe(true);
    // 上一页的文件到了
    for (const item of old) item.resolve();
    await flush();
    expect(root.hasAttribute('data-fonts-wait')).toBe(true);
    // 上一页的时候到了（新的一页才等了 100 毫秒）
    await vi.advanceTimersByTimeAsync(100);
    expect(root.hasAttribute('data-fonts-wait')).toBe(true);
    // 新的一页的文件到了
    for (const item of fonts.asked) item.resolve();
    await flush();
    expect(root.hasAttribute('data-fonts-wait')).toBe(false);
    // 正等着的时候换到一页文件已经在手里的（刚才那一站的）：马上拿掉
    nameFontScope(parseHash('#/su-shi/huangzhou'));
    expect(root.hasAttribute('data-fonts-wait')).toBe(true);
    nameFontScope(parseHash('#/su-shi/xuzhou'));
    expect(root.hasAttribute('data-fonts-wait')).toBe(false);
  });
});

describe('要不来的时候页面照样在', () => {
  it('文件没取成（浏览器说取不到）：“等一等”马上拿掉，什么也不抛出来；check 当场出错、浏览器没有 document.fonts：两个属性照写，不挂“等一等”，不出错', async () => {
    fonts.auto = false;
    nameFontScope(parseHash('#/su-shi/xuzhou'));
    expect(root.hasAttribute('data-fonts-wait')).toBe(true);
    for (const item of fonts.asked) item.reject();
    await flush();
    expect(root.hasAttribute('data-fonts-wait')).toBe(false);
    // check 当场出错
    await away();
    fonts.checkThrows = true;
    expect(() => nameFontScope(parseHash('#/goethe'))).not.toThrow();
    expect([root.getAttribute('data-fonts'), root.hasAttribute('data-fonts-wait')]).toEqual(['goethe', false]);
    // 没有 document.fonts
    fonts.checkThrows = false;
    delete (globals.document as { fonts?: unknown }).fonts;
    expect(() => nameFontScope(parseHash('#/su-shi/xuzhou'))).not.toThrow();
    expect([root.getAttribute('data-fonts'), root.getAttribute('data-fonts-unit'), root.hasAttribute('data-fonts-wait')]).toEqual(['su-shi', 'xuzhou', false]);
  });

  it('点开才要的字的那张表没取到、没有交进来怎么取它、那份样式表没取到：什么也不抛出来，不用点开就要的文件照要', async () => {
    const rejections: unknown[] = [];
    const onRejection = (reason: unknown): void => void rejections.push(reason);
    const process = (globals as unknown as { process: { on(event: string, listener: (reason: unknown) => void): void; off(event: string, listener: (reason: unknown) => void): void } }).process;
    process.on('unhandledRejection', onRejection);
    try {
      // 那张表没取到
      followFontScope(() => parseHash('#/su-shi'), () => Promise.reject(new Error('没取到')));
      expect(asked()).toEqual(["500 1em 'Yanlu Sans su-shi'", "1em 'Yanlu Song su-shi'"]);
      await flush();
      // 没有交进来怎么取
      await away();
      followFontScope(() => parseHash('#/goethe'));
      expect(asked()).toHaveLength(2);
      await flush();
      await expect(ownPressed(true)).rejects.toBeUndefined();
      // 那份样式表没取到：等它的那一步照样走完
      await away();
      const before = links.length;
      followFontScope(() => parseHash('#/su-shi/xuzhou'), () => Promise.resolve({ SCOPE_PRESSED: { 'su-shi/xuzhou': { sheet: '/lost.css', probe: 'x', face: 'Yanlu Song su-shi xuzhou' } } }));
      await flush();
      expect(links.slice(before).map((link) => link.href)).toEqual(['/lost.css']);
      const pressed = ownPressed(true);
      // 等它的那一步先接到这一份上（样式表还在路上），然后这一份才说没取到
      await flush();
      links[links.length - 1].onerror?.();
      await expect(pressed).resolves.toBeDefined();
      await flush();
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(rejections).toEqual([]);
      // 没取到的那一条不留在页面上（下一回重新挂，见下面那一项）
      expect(links.slice(before)).toEqual([]);
    } finally {
      process.off('unhandledRejection', onRejection);
    }
  });

  it('前一页正等着的时候换了页，新的一页这一回当场出了错（check 出错、读不出样式、浏览器没有 document.fonts）：前一页挂上的“等一等”马上拿掉，什么也不抛出来；前一页的时候到了也不再挂回去', async () => {
    vi.useFakeTimers();
    const broken: [string, () => void][] = [
      ['check 出错', () => void (fonts.checkThrows = true)],
      ['读不出样式', () => void (globals.getComputedStyle = () => {
        throw new Error('读不出样式');
      })],
      ['没有 document.fonts', () => void delete (globals.document as { fonts?: unknown }).fonts],
    ];
    for (const [what, breakIt] of broken) {
      // 前一页：文件没到，等着
      fonts.checkThrows = false;
      (globals.document as { fonts?: unknown }).fonts = fontSet;
      globals.getComputedStyle = () => ({ getPropertyValue: computed });
      await away();
      fonts.auto = false;
      fonts.loaded.clear();
      nameFontScope(parseHash('#/su-shi/xuzhou'));
      expect(root.hasAttribute('data-fonts-wait'), what).toBe(true);
      await vi.advanceTimersByTimeAsync(FONT_WAIT_MS - 100);
      // 换了页，这一回当场出错
      breakIt();
      expect(() => nameFontScope(parseHash('#/goethe')), what).not.toThrow();
      expect([root.getAttribute('data-fonts'), root.hasAttribute('data-fonts-wait')], what).toEqual(['goethe', false]);
      // 前一页的时候到了、前一页的文件到了：不挂回去
      await vi.advanceTimersByTimeAsync(FONT_WAIT_MS);
      for (const item of fonts.asked) item.resolve();
      await flush();
      expect(root.hasAttribute('data-fonts-wait'), what).toBe(false);
    }
  });

  it('取过一回没取成的字体文件，范围再换的时候再取一回：浏览器记着“没取成”的那一条 @font-face 原样重新写进它那份样式表的原处（先重写，再去要），同一个名称的两条都重写，别的规则不动、先后不变；没有哪一个没取成的时候一份样式表也不碰；不让读的样式表跳过，别的照做；同一个范围再说一遍不重写', async () => {
    const face = (family: string, more = ''): string => `@font-face { font-family: "${family}"; src: url("x.woff2") format("woff2"); ${more}}`;
    const own = makeSheet('page', ['.a { color: red; }', face('Yanlu Sans'), face('Yanlu Song goethe'), face('Yanlu Song su-shi'), face('Yanlu Song su-shi xuzhou'), ':root[data-fonts-wait] main > * { opacity: 0; }']);
    const pressed = makeSheet('pressed', [face('Yanlu Song goethe', 'unicode-range: U+4E01; ')]);
    const locked = {
      get cssRules(): never {
        throw new Error('别处来的样式表不让读');
      },
    };
    styleSheets.push(own, locked, pressed);
    const rules = (sheet: Sheet): string[] => sheet.cssRules.map((rule) => rule.cssText);
    const before = [rules(own), rules(pressed)];
    // 没有哪一个没取成：一份也不碰
    fonts.faces = [{ family: '"Yanlu Song goethe"', status: 'loaded' }, { family: '"Yanlu Sans"', status: 'unloaded' }, { family: '"Yanlu Song su-shi"', status: 'loading' }];
    nameFontScope(parseHash('#/goethe'));
    expect(events.filter((event) => !event.startsWith('load '))).toEqual([]);
    // 歌德的宋体上一回没取成：写着这个名称的两条（页面那一份里的、点开才要的字那一份里的）各在原处重写，然后才去要
    await away();
    events.length = 0;
    fonts.auto = false;
    fonts.loaded.clear();
    fonts.faces = [{ family: '"Yanlu Song goethe"', status: 'error' }, { family: '"Yanlu Song su-shi"', status: 'loaded' }, { family: '"Yanlu Sans"', status: 'loaded' }];
    nameFontScope(parseHash('#/goethe'));
    expect(events).toEqual(['pressed insert 0', 'pressed delete 1', 'page insert 2', 'page delete 3', "load 500 1em 'Yanlu Sans goethe'", "load 1em 'Yanlu Song goethe'"]);
    expect([rules(own), rules(pressed)]).toEqual(before);
    // 重写过的那一条浏览器手里还没有：正文那一栏照常等它，到了显出来
    expect(root.hasAttribute('data-fonts-wait')).toBe(true);
    for (const item of fonts.asked) item.resolve();
    await flush();
    expect(root.hasAttribute('data-fonts-wait')).toBe(false);
    // 同一个范围再说一遍：不重写，不再要
    events.length = 0;
    nameFontScope(parseHash('#/goethe'));
    nameFontScope();
    expect(events).toEqual([]);
    // 浏览器给的名称不带引号也认；名称只是打头一样的另一条（su-shi 和 su-shi xuzhou）不跟着重写；哪一份里也没有的名称不出错
    fonts.faces = [];
    await away();
    events.length = 0;
    fonts.auto = true;
    fonts.faces = [{ family: 'Yanlu Song su-shi', status: 'error' }, { family: 'Yanlu Kai su-shi', status: 'error' }];
    expect(() => nameFontScope(parseHash('#/su-shi'))).not.toThrow();
    expect(events).toEqual(['page insert 3', 'page delete 4', "load 500 1em 'Yanlu Sans su-shi'", "load 1em 'Yanlu Song su-shi'"]);
    expect([rules(own), rules(pressed)]).toEqual(before);
  });

  it('点开才要的字的那份样式表头一回没取到：那一条 <link> 拿掉，下一回重新挂一遍——写好了的一站空下来的时候，或者范围再换到这里的时候；取到了的不再挂', async () => {
    // 地址是这一项自己的（别的几项挂过的那几份，页面记着，不会再挂）
    const table = {
      'su-shi/xuzhou': { sheet: '/again/su-shi.xuzhou.css', probe: 'x', face: 'Yanlu Song su-shi xuzhou' },
      'su-shi/huangzhou': { sheet: '/again/su-shi.huangzhou.css', probe: 'y', face: 'Yanlu Song su-shi huangzhou' },
      'su-shi': { sheet: '/again/su-shi.css', probe: 'z', face: 'Yanlu Song su-shi' },
    };
    followFontScope(() => parseHash('#/zz-nobody'), () => Promise.resolve({ SCOPE_PRESSED: table }));
    const hung = (href: string): Link[] => links.filter((link) => link.href === href);
    // 徐州：头一回没取到——拿掉了
    nameFontScope(parseHash('#/su-shi/xuzhou'));
    await flush();
    const [first] = hung('/again/su-shi.xuzhou.css');
    expect(first).toBeDefined();
    first.onerror?.();
    await flush();
    expect(hung('/again/su-shi.xuzhou.css')).toEqual([]);
    // 这一站空下来的时候（还在这一页上）：重新挂一遍，读完了再拿表里的名称和那一个字去要
    fonts.asked.length = 0;
    const idle = ownPressed(true);
    await flush();
    const [second] = hung('/again/su-shi.xuzhou.css');
    expect(second).toBeDefined();
    expect(second).not.toBe(first);
    expect(fonts.asked).toHaveLength(0);
    second.onload?.();
    await idle;
    expect(fonts.asked.map((item) => [item.font, item.text])).toEqual([['1em "Yanlu Song su-shi xuzhou"', 'x']]);
    // 取到了的：走开再回来，不再挂
    nameFontScope(parseHash('#/su-shi'));
    await flush();
    nameFontScope(parseHash('#/su-shi/xuzhou'));
    await flush();
    await ownPressed(true);
    expect(hung('/again/su-shi.xuzhou.css')).toEqual([second]);
    // 黄州：头一回没取到；读的人走开再回来（范围再换到这里）——重新挂一遍
    nameFontScope(parseHash('#/su-shi/huangzhou'));
    await flush();
    const [lost] = hung('/again/su-shi.huangzhou.css');
    lost.onerror?.();
    await flush();
    expect(hung('/again/su-shi.huangzhou.css')).toEqual([]);
    nameFontScope(parseHash('#/su-shi'));
    await flush();
    nameFontScope(parseHash('#/su-shi/huangzhou'));
    await flush();
    expect(hung('/again/su-shi.huangzhou.css')).toHaveLength(1);
    expect(hung('/again/su-shi.huangzhou.css')[0]).not.toBe(lost);
  });
});

describe('点开才要的字', () => {
  /** 做字体的工具写的那张表的样子（src/fonts/scopes.ts 引的是样式表的地址，在 Node 里不引它；这里照记录编一张一样的）。 */
  const table = Object.fromEntries(
    record.files.filter((item) => item.role === 'pressed').map((item) => [item.unit === null ? item.scope : `${item.scope}/${item.unit}`, { sheet: `/${item.sheet}`, probe: [...item.characters][0], face: item.face }]),
  );
  const load = (): Promise<{ SCOPE_PRESSED: typeof table }> => Promise.resolve({ SCOPE_PRESSED: table });

  it('这一页那个范围的样式表挂到页面上，一份只挂一回：一站的是它自己的；没有自己的文件的一站、首页、人物页挂的是人物的；“来源”页没有这样的文件，不挂', async () => {
    followFontScope(() => parseHash('#/zz-nobody'), load);
    const hrefs = (from: number): string[] => links.slice(from).map((link) => `${link.rel} ${link.href}`);
    let before = links.length;
    nameFontScope(parseHash('#/su-shi/xuzhou'));
    await flush();
    expect(hrefs(before)).toEqual(['stylesheet /scopes/su-shi.xuzhou.css']);
    // 没有自己的文件的一站，人物页，首页：都是人物的那一份，只挂一回
    before = links.length;
    for (const [hash, home] of [['#/su-shi/mizhou', ''], ['#/su-shi', ''], ['#/', 'su-shi'], ['#/su-shi/xuzhou', '']]) {
      nameFontScope(parseHash(hash), home);
      await flush();
    }
    expect(hrefs(before)).toEqual(['stylesheet /scopes/su-shi.css']);
    // 另一位人物；“来源”页
    before = links.length;
    nameFontScope(parseHash('#/goethe/valmy'));
    await flush();
    nameFontScope(parseHash('#/sources'));
    await flush();
    expect(hrefs(before)).toEqual(['stylesheet /scopes/goethe.css']);
    // 记录里每个点开才要的文件的那一份，表里都有
    expect(Object.keys(table).length).toBe(record.files.filter((item) => item.role === 'pressed').length);
  });

  it('写好了的一站空下来以后叫浏览器把它点开才要的那个文件取来：等样式表读完，拿表里的名称和那一个字去要；平常挂样式表的时候不要', async () => {
    followFontScope(() => parseHash('#/zz-nobody'), load);
    nameFontScope(parseHash('#/su-shi/huangzhou'));
    await flush();
    const sheet = links.find((link) => link.href === '/scopes/su-shi.huangzhou.css');
    expect(sheet).toBeDefined();
    sheet?.onload?.();
    await flush();
    // 挂样式表的那一回不去要点开才要的文件
    expect(asked()).toEqual(["500 1em 'Yanlu Sans su-shi'", "1em 'Yanlu Song su-shi huangzhou'"]);
    fonts.asked.length = 0;
    await ownPressed(true);
    const want = table['su-shi/huangzhou'];
    expect(fonts.asked.map((item) => [item.font, item.text])).toEqual([[`1em "${want.face}"`, want.probe]]);
    // 那一个字是那个文件里编码最小的一个，这一页不用点开就要的文件里没有它
    const page = record.pages.find((item) => item.kind === 'unit' && item.unit === 'huangzhou');
    for (const path of page?.rest ?? []) expect(fileOf(path).characters.includes(want.probe), path).toBe(false);
  });
});
