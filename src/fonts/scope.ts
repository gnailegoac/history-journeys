// 这一页的字体归哪个范围：写在 <html> 上的两个属性。手写的（这个文件夹里别的都是工具做的），页面一打开就下载的程序带着它。
//   data-fonts       哪位人物的 id；“来源”页是 sources；首页是沙盘栏里摆着的那位人物（名单读出来才知道，知道以前不写）
//   data-fonts-unit  哪一站的 id：每一个站点页都写
// 地址里写的是什么就写什么，这里不查有没有这位人物、这一站：哪个范围有自己的字体文件，由样式表里的规则认，页面的程序不带名单。
// 现在还没有哪一条样式读这两个属性：字体文件还是全站共用的那四个。说明见 docs/data-spec.md“随站的字体”。
// 页面的脚本跑起来以前，index.html 里有几行普通的脚本已经照地址写过一遍（没有那几行也不要紧，这里晚一步写上）。
// 这个文件夹做字体的工具不读，这里的字不算进哪个字体文件：所以这个文件里注释以外不写汉字（tests/fonts/font-scopes.test.ts 守着）。

import type { Route } from '../app/router';

/** 现在是哪一页；首页的沙盘栏里摆着哪位人物（首页读出名单以后说一声，还不知道是空的）。 */
let page: Route | undefined;
let home = '';

/** 这一页的两个属性各写什么：先是 data-fonts，后是 data-fonts-unit；空的就是不写。 */
export function fontScope(route: Route, homeFigure: string): [string, string] {
  return [route.page === 'home' ? homeFigure : route.page === 'sources' ? 'sources' : route.figureId, route.page === 'stop' ? route.stopId : ''];
}

/**
 * 把这一页的范围写到 <html> 上，这一页没有的那一个拿掉。route 不给就是还在原来那一页，homeFigure 不给就照上一回说的。
 * 没有 <html> 可写的地方（不在浏览器里）什么也不做。
 */
export function nameFontScope(route = page, homeFigure = home): void {
  page = route;
  home = homeFigure;
  const root = typeof document === 'undefined' ? null : document.documentElement;
  if (!root || !route) return;
  fontScope(route, homeFigure).forEach((value, index) => {
    const name = index ? 'data-fonts-unit' : 'data-fonts';
    if (value) root.setAttribute(name, value);
    else root.removeAttribute(name);
  });
}

/**
 * 页面的程序一起来就叫它（src/main.tsx，页面还没画）：照现在的地址写一遍，往后地址每变一回马上再写一遍。read 给出现在是哪一页。
 * 从这时起就自己听着，不等路由开始听——路由要等页面头一回画完才听。这中间地址变了（页面还在起来，读者又按了一次“后退”），
 * 页面自己会追上去画新的一页，这两个属性要是没有人听着改，就一直留在原来那一页上。
 */
export function followFontScope(read: () => Route): void {
  const name = (): void => nameFontScope(read());
  name();
  window.addEventListener('hashchange', name);
}
