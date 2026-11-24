// 工具做的（npm run fonts），不要手改。说明见 docs/data-spec.md“随站的字体”。
// 给页面用的几样。页面不引入 fonts.json：那里面记着每一个字，太大。

/** 随站的三套字体：文件里的名称、原字体叫什么、哪一版、它的网站、许可全文在网站上的地址（相对网站的根）。 */
export const SHIPPED_FONTS = {
  sans: { family: 'Yanlu Sans', name: 'Noto Sans SC Medium', version: '2.004', site: 'https://github.com/notofonts/noto-cjk', licence: 'licences/noto-sans-cjk-OFL.txt' },
  song: { family: 'Yanlu Song', name: 'Noto Serif SC', version: '2.003', site: 'https://github.com/notofonts/noto-cjk', licence: 'licences/noto-serif-cjk-OFL.txt' },
  kai: { family: 'Yanlu Kai', name: 'LXGW WenKai GB', version: '1.530', site: 'https://github.com/lxgw/LxgwWenkaiGB', licence: 'licences/lxgw-wenkai-gb-OFL.txt' },
} as const;

/** 点开才要的那个宋体文件里的一个字：页面空下来的时候拿它叫浏览器先把那个文件取来。 */
export const SONG_MORE_PROBE = '©';
