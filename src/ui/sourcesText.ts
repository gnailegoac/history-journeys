// “来源”页上的话。单独一个文件，为的是两件事：
// 一、它们跟着“来源”页里面的那一段程序走（SourcesBody.tsx），读者打开那一页才下载；写在 text.ts 里的话，就随页面一打开就下载了。
// 二、做字体的工具把这个文件里的字算作“点开才看得见的”，归到点开才要的那个宋体文件里（tests/support/fontTool.ts 的
//     PRESSED_SOURCES），不放进每位读者一打开网站就要下载的那一个。所以这个文件里只写“来源”页上才有的话；
//     别的页面上不点就看得见的字不要写到这里来（写了的话，那个页面会提前去取点开才要的字体文件，
//     tests/e2e/fonts.spec.ts 会发现）。
// 四个小标题是楷体，列在 text.ts 的 KAI_LABELS 里（从这里引用）；页面的名字“来源”在 text.ts（别的页面的链接上也写着它）。
// 两套字体叫什么、哪一版、网站和许可全文的地址不写在这里：页面从 src/fonts/shipped.ts 读（那是做字体的工具写的，
// 和随站的字体文件对得上），这里的句子只留出放它们的位置。

/** 随站的一套字体在 shipped.ts 里记的几样。 */
interface ShippedFont {
  /** 写在字体文件里的名称（Yanlu Kai、Yanlu Song）。 */
  family: string;
  /** 原字体的名字（英文）。 */
  name: string;
  version: string;
}

export const SOURCES_TEXT = {
  lead: '这个网站用到的字体、地形数据和图片，各是哪里来的，按什么许可使用。',
  /** 四个小标题：字体，地形和水，图片，程序。 */
  headings: ['字体', '地形和水', '图片', '程序'],

  kai: (font: ShippedFont): string =>
    `标题、题签和按钮上的楷体：霞鹜文楷 GB（${font.name}），${font.version} 版，作者 LXGW，在 Fontworks 的 Klee One 的基础上制作。按 SIL 开放字体许可 1.1 版使用。`,
  song: (font: ShippedFont): string =>
    `正文的宋体：思源宋体（用的是 Google 发布的 ${font.name}，${font.version} 版，两者是同一套字），© Adobe。按 SIL 开放字体许可 1.1 版使用。`,
  subset: (kai: ShippedFont, song: ShippedFont): string =>
    `网站只带了用到的那些字，所以这两个文件不是完整的字体，文件里的名称也改成了“${kai.family}”“${song.family}”。想要完整的字体，请到它们自己的网站下载。`,
  /** 四份许可全文都是英文的原文（许可要求照原样带着）：链接上先说一声，读者点开不至于愣住。 */
  licence: '许可全文（英文）',
  fontSite: '字体的网站',

  /** 地形和水、图片两栏的字是从内容里读的：还没读到、没读出来、一张图片也没有的时候各一句。 */
  loading: '加载中…',
  failed: '这一栏没能读出来。',
  noPictures: '现在还没有用到别处的图片。',
  pictureSource: '图片出处',
  /** 一张图片那一条的头一句：先说是哪一站的（那一站的短名字），后面是它在正文里的题记。 */
  picture: (stop: string, caption: string): string => `${stop}：${caption}`,

  program: '页面用 React，沙盘用 three.js，都是开源的，按 MIT 许可使用。',
  reactLicence: 'React 的许可全文（英文）',
  threeLicence: 'three.js 的许可全文（英文）',
  shipped: '字体、地形和图片都随网站一起发；打开网页的时候不访问别的网站。',
} as const;

/** 两个程序库的许可全文在网站上的地址（相对网站的根；文件在 public/licences/，是做字体的工具从装好的库里原样抄来的）。 */
export const LIBRARY_LICENCES = {
  react: 'licences/react-LICENSE.txt',
  three: 'licences/three-LICENSE.txt',
} as const;
