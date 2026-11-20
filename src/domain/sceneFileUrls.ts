// 沙盘用到的文件的网址：每座沙盘的地形文件，工具做出来的两样（先画好的地面、每一小节的定格图）。
// 三张表都是“content/ 里的路径 → 打包以后的网址”，打包时就列好了；文件本身仍然是用到时才下载。
//
// 这几张表单独放一个模块，是为了不让它们进页面一打开就下载的那一块：一座沙盘有十几二十个文件，
// 网址压缩以后约 450 字节，沙盘越多越长。读取内容的程序（sceneContent.ts）用动态 import 取这个模块，
// 打开人物页或者一站时才下载，和场景文件、清单一起取，不排队。除了 sceneContent.ts，别处不要直接引入它。

/** 地形文件。 */
export const terrain = import.meta.glob<string>('/content/figures/*/scenes/*.terrain.bin', { query: '?url', import: 'default', eager: true });
/** 先画好的地面：颜色和田的标记两张图。 */
export const baked = import.meta.glob<string>('/content/figures/*/baked/*.{jpg,png}', { query: '?url', import: 'default', eager: true });
/** stills/ 里的图片：每座沙盘每一小节的定格图。 */
export const stills = import.meta.glob<string>('/content/figures/*/stills/*.{jpg,jpeg,png,webp,svg}', { query: '?url', import: 'default', eager: true });
