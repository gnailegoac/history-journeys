// 工具做的（npm run fonts），不要手改。说明见 docs/data-spec.md“随站的字体”。
// 给“来源”页用的一张表。页面不引入 fonts.json：那里面记着每一个字，太大。
// 页面一打开就下载的程序不要引入这个文件（它要的几样在 probe.ts 里）：引入了，这张表就跟着进了那一块程序。

/** 随站的三套字体：文件里的名称、原字体叫什么、哪一版、它的网站、许可全文在网站上的地址（相对网站的根）。 */
export const SHIPPED_FONTS = {
  sans: { family: 'Yanlu Sans', name: 'Noto Sans SC Medium', version: '2.004', site: 'https://github.com/notofonts/noto-cjk', licence: 'licences/noto-sans-cjk-OFL.txt' },
  song: { family: 'Yanlu Song', name: 'Noto Serif SC', version: '2.003', site: 'https://github.com/notofonts/noto-cjk', licence: 'licences/noto-serif-cjk-OFL.txt' },
  kai: { family: 'Yanlu Kai', name: 'LXGW WenKai GB', version: '1.530', site: 'https://github.com/lxgw/LxgwWenkaiGB', licence: 'licences/lxgw-wenkai-gb-OFL.txt' },
} as const;
