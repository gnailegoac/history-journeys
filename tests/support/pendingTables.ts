// 正在做、工具做的那两样（先画好的地面，每一小节的定格图）还没有做出来的沙盘。
//
// 一座新沙盘是分几步接进来的：场景文件先进 content/（那一天起规则 10 到 15 就查它），
// 沙盘程序画得出它以后才做得了先画好的地面和定格图。中间这一段，把它的名字写在下面：
//   校验（规则 17、18）不要求它有这两样——已经有的照规则查；
//   做地面的工具（npm run bake）和拍定格图的工具（npm run stills）跳过它，除非带着 INCLUDE_PENDING=1 跑。
// 两样都做好、放进 content/ 以后，把名字拿掉。平时这张表是空的：发布出去的网站上，每座沙盘这两样都得有。
//
// 名字写成“人物/场景文件的名字”，如 su-shi/route（全程沙盘）、su-shi/huangzhou。
// 只有常数和两个只算数的函数：校验、两个工具（一个在 vitest 里跑，一个在 Playwright 里跑）都引它。

/** 这两样还没有做出来的沙盘。 */
export const MADE_FILES_PENDING: readonly string[] = [];

/** 这座沙盘是不是在那张表里。key 是“人物/场景文件的名字”。 */
export function isPending(key: string, pending: readonly string[] = MADE_FILES_PENDING): boolean {
  return pending.includes(key);
}

/**
 * 工具这一次要做哪几座：表里的跳过，除非 includePending（工具从环境变量 INCLUDE_PENDING=1 读来）。
 * 返回要做的和跳过的，先后不变。
 */
export function tablesToMake(keys: readonly string[], includePending: boolean, pending: readonly string[] = MADE_FILES_PENDING): { make: string[]; skipped: string[] } {
  if (includePending) return { make: [...keys], skipped: [] };
  return { make: keys.filter((key) => !pending.includes(key)), skipped: keys.filter((key) => pending.includes(key)) };
}

/** 环境变量里是不是写了 INCLUDE_PENDING=1。 */
export function includePendingFrom(env: Record<string, string | undefined>): boolean {
  return env.INCLUDE_PENDING === '1';
}
