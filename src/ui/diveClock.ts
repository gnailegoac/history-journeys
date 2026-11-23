// 潜到一站自己的沙盘（./dive.ts）用的两个钟点。单放一个文件，什么也不引入：浏览器测试（tests/e2e/dive.spec.ts）也读这两个数。

/** 潜多久（毫秒）。stage.css 里那一条淡出的等待加上淡出的工夫是同一个数。 */
export const DIVE_MS = 900;
/** 潜了这么久（毫秒）沙盘还没有回话，也把地址换过去：读者不会卡在半路。 */
export const DIVE_GUARD_MS = DIVE_MS + 300;
