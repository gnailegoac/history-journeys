// 这一页的字体归哪个范围：写在 <html> 上的两个属性，和照它去要这一页自己的字体文件。手写的（这个文件夹里别的都是工具做的），
// 页面一打开就下载的程序带着它。
//   data-fonts       哪位人物的 id；“来源”页是 sources；首页是沙盘栏里摆着的那位人物（名单读出来才知道，知道以前不写）
//   data-fonts-unit  哪一站的 id：每一个站点页都写
// 地址里写的是什么就写什么，这里不查有没有这位人物、这一站：哪个范围有自己的字体文件，由样式表里的规则认（src/fonts/fonts.css，工具做的：
// 合得上的那一条把这个范围的名称交给 --own-sans、--own-song），页面的程序不带名单。写完属性，读出这两个名称，叫浏览器把这一页
// 不用点开就要的文件取来；再把这个范围点开才要的字的样式表引进来（src/fonts/scopes.ts，另一小块）。说明见 docs/data-spec.md“随站的字体”。
// 页面的脚本跑起来以前，index.html 里有几行普通的脚本已经照地址写过一遍、把合得上的文件先要了（没有那几行也不要紧，这里晚一步）。
// 这个文件夹做字体的工具不读，这里的字不算进哪个字体文件：所以这个文件里注释以外不写汉字（tests/fonts/font-scopes.test.ts 守着）。

import type { Route } from '../app/router';

/** 现在是哪一页；首页的沙盘栏里摆着哪位人物（首页读出名单以后说一声，还不知道是空的）。 */
let page: Route | undefined;
let home = '';
/** 上一回是给哪个范围要的文件（同一个范围不要第二回）；要到第几回了（前一页还在等的那一回，换了页就不算数）。 */
let asked = '';
let turn = 0;

/**
 * 这一页自己的字体文件还没到的时候，正文那一栏（连标题）最多等它多少毫秒才显出来。文件已经在手里的不等；到了就显；
 * 过了这么久还没到，也显出来（先用设备自带的字顶着，到了再换）。等的那一会儿栏只是看不见，读屏的工具照样读得到。
 * 首页不等（它那一栏里只有框架的字）。
 * 写 0 就是不等（这一个数就是开关）。那一会儿 <html> 上挂着 data-fonts-wait，样式在 src/styles/layout.css。
 * 这个数管的是“最晚什么时候说可以显了”，不是“最晚什么时候显出来”：说的那一句（时候到了、文件到了都一样）要排在页面正在做的事后面。
 * 慢的设备上新的一页正画到一半，这一句就晚到，属性也就多挂一会儿（在浏览器里把处理器放慢到四分之一、六分之一量过：0.4 到 0.8 秒）；
 * 那一会儿页面本来也画不出新的一帧，读的人多等的是零点一秒上下，不是多出来的那半秒。
 */
export const FONT_WAIT_MS = 300;

/**
 * 取过一回没取成的字体文件，浏览器自己不再取：那一条 @font-face 记着“没取成”，用到它的字一直是设备自带的字，到刷新网页为止
 *（网断了一下、正好头一回走到这个范围，就会这样）。范围换了的时候看一遍：哪一个名称的文件没取成，就把写着这个名称的 @font-face
 * 原样重新写进它那份样式表的原处——浏览器当它是一条新的规则，页面上用到它的字、紧接着的那一句 load，都会再取一回。
 * 同一个名称的另一条（点开才要的那个文件）跟着重写，它的文件浏览器手里要是已经有了，不再下载。不让读的样式表（别处来的）跳过。
 */
function askAgain(): void {
  const lost: string[] = [];
  document.fonts.forEach((face) => face.status === 'error' && lost.push(face.family.replace(/["']/g, '')));
  if (!lost.length) return;
  for (let index = document.styleSheets.length; index--; )
    try {
      const sheet = document.styleSheets[index];
      for (let at = sheet.cssRules.length; at--; ) {
        const rule = sheet.cssRules[at].cssText;
        const family = /^@font-face[^}]*font-family:\s*["']?([^;"']+)/.exec(rule);
        if (family && lost.includes(family[1])) {
          sheet.insertRule(rule, at);
          sheet.deleteRule(at + 1);
        }
      }
    } catch {
      // 这一份不让读：跳过
    }
}

/** 这一页的两个属性各写什么：先是 data-fonts，后是 data-fonts-unit；空的就是不写。 */
export function fontScope(route: Route, homeFigure: string): [string, string] {
  return [route.page === 'home' ? homeFigure : route.page === 'sources' ? 'sources' : route.figureId, route.page === 'stop' ? route.stopId : ''];
}

/**
 * 把这一页的范围写到 <html> 上，这一页没有的那一个拿掉；范围换了，就去要这个范围的字体文件。
 * route 不给就是还在原来那一页，homeFigure 不给就照上一回说的。没有 <html> 可写的地方（不在浏览器里）什么也不做。
 */
export function nameFontScope(route = page, homeFigure = home): void {
  page = route;
  home = homeFigure;
  const root = typeof document === 'undefined' ? null : document.documentElement;
  if (!root || !route) return;
  const scope = fontScope(route, homeFigure);
  scope.forEach((value, index) => {
    const name = index ? 'data-fonts-unit' : 'data-fonts';
    if (value) root.setAttribute(name, value);
    else root.removeAttribute(name);
  });
  if (asked === (asked = scope.join('/'))) return;
  // 这一回的等：换了页，上一页那一回再说“可以显了”就不算数
  const mine = ++turn;
  const show = (): void => {
    if (mine === turn) root.removeAttribute('data-fonts-wait');
  };
  try {
    // 上一回没取成的文件，这一回再取（见 askAgain）
    askAgain();
    // 样式表认出来的这个范围的两个名称（没有自己的文件的范围读到的是空的：什么也不要）
    const style = getComputedStyle(root);
    const fonts = ['500 1em ' + style.getPropertyValue('--own-sans').trim(), '1em ' + style.getPropertyValue('--own-song').trim()].filter((font) => !font.endsWith(' '));
    // 首页不等：它正文那一栏里只有框架的字（卡片），这位人物的文件是给沙盘栏用的
    if (FONT_WAIT_MS && route.page !== 'home' && fonts.some((font) => !document.fonts.check(font))) {
      root.setAttribute('data-fonts-wait', '');
      setTimeout(show, FONT_WAIT_MS);
    } else show();
    void Promise.all(fonts.map((font) => document.fonts.load(font))).then(show, show);
    if (fonts.length) void ownPressed().catch(() => {});
  } catch {
    // 浏览器没有 document.fonts、当场出了错：不要就是了，页面上用到这些字的时候浏览器照旧会去取
    show();
  }
}

/**
 * 怎么把做字体的工具写的那张表（src/fonts/scopes.ts：每个范围点开才要的那个文件）引进来——它是用到时才取的一小块。
 * 引入的那一句写在 src/main.tsx 里，从 followFontScope 交进来，不写在这个文件里：这个文件比页面别的部分都先跑，那一句写在这里，
 * 打包的工具就把“先取别的块”的那一小段程序从页面的程序里拆出去单成一块，页面一打开多一次请求（tests/build/dist-size.test.ts 守着）。
 */
let scopes: (() => Promise<typeof import('./scopes')>) | undefined;
/** 挂上去了的点开才要的字的样式表：地址 → 它读完了没有（一份只挂一回；没取到的那一回不算，拿掉了，下一回重新挂）。 */
const sheets: Record<string, Promise<unknown>> = {};

/**
 * 这一页那个范围点开才要的字：把它的样式表挂到页面上（没有自己的文件的一站用的是人物的）；fetch 是 true 的话，
 * 接着叫浏览器把那个文件取来（写好了的一站空下来以后这样做，见 src/ui/StopPage.tsx）。这个范围没有这样的文件就什么也不做。
 */
export function ownPressed(fetch?: boolean): Promise<unknown> {
  const root = document.documentElement;
  const figure = root.getAttribute('data-fonts') ?? '';
  const unit = root.getAttribute('data-fonts-unit');
  return (scopes ? scopes() : Promise.reject()).then(({ SCOPE_PRESSED: all }) => {
    const own = (unit && all[figure + '/' + unit]) || all[figure];
    return (
      own &&
      (sheets[own.sheet] ??= new Promise((done) => {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = own.sheet;
        link.onload = done;
        // 没取到：把它拿掉、忘掉。下一回——范围再换到这里，或者写好了的一站空下来的时候——重新挂一遍；这一回等它的那一步照样走完
        link.onerror = () => {
          link.remove();
          delete sheets[own.sheet];
          done(0);
        };
        document.head.appendChild(link);
      })).then((): unknown => fetch && document.fonts.load('1em "' + own.face + '"', own.probe))
    );
  });
}

/**
 * 页面的程序一起来就叫它（src/main.tsx，页面还没画）：照现在的地址写一遍，往后地址每变一回马上再写一遍。read 给出现在是哪一页。
 * 从这时起就自己听着，不等路由开始听——路由要等页面头一回画完才听。这中间地址变了（页面还在起来，读者又按了一次“后退”），
 * 页面自己会追上去画新的一页，这两个属性要是没有人听着改，就一直留在原来那一页上，要来的也是原来那一页的字体。
 * load 是怎么把 src/fonts/scopes.ts 引进来（见上面 scopes 的说明）；不给的话点开才要的字的样式表不挂，页面上用到那些字时先用设备自带的字。
 */
export function followFontScope(read: () => Route, load?: () => Promise<typeof import('./scopes')>): void {
  scopes = load;
  const name = (): void => nameFontScope(read());
  name();
  window.addEventListener('hashchange', name);
}
