// 工具做的（npm run fonts），不要手改。说明见 docs/data-spec.md“随站的字体”。
// 页面一打开就下载的程序用的几样，单放在这里：三套字体的那张表（shipped.ts）只有“来源”页用，不跟着进那一块程序。

/** 写在字体文件里的名称：宋体的，楷体的（题签和印上的字）。页面叫浏览器先去取哪一套字体的时候用。 */
export const SONG_FAMILY = 'Yanlu Song';
export const KAI_FAMILY = 'Yanlu Kai';

/** 点开才要的那个宋体文件里的一个字：页面空下来的时候拿它叫浏览器先把那个文件取来。 */
export const SONG_MORE_PROBE = '©';
