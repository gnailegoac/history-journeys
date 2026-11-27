// 算镜头的工具（npm run route:camera）要的那张表：一位人物的全程沙盘上，哪一节照哪个方框定镜头。
// 方框不是场景文件里的东西（场景里一节只写镜头的四个数），所以放在工具旁边。一位人物一行，一节一项，名字是小节的标题。
// 表里没有的人物、没有的小节，工具只量场景里现在写的镜头，不另算。看整块沙盘的一节（mustShow 写了 frame）不要方框：沙盘程序自己居中。
// 方框是度：西、东、南、北四条边。工具把它一圈的点落在真的地面上，在定稿样张的画面上居中、装下（./cameraTool.ts 的 cameraForBox）。
// alsoPitches 是除了判过的 46 度以外还要算的倾角：算出来的每一种摆法都印出来，挑哪一种是看过图以后人定的。
//
// 现在表是空的：苏轼的全程沙盘的镜头是照定稿的样张定的，没有用方框；工具对他只量场景里写的镜头。
// 照方框算镜头的那一半，测试用编出来的那座全程沙盘和一个编出来的方框走（tests/tools/route-tools.test.ts“镜头”那一组）。

import type { BoxPlan } from './cameraTool';

/** 那张表：人物的文件夹名 → 小节的标题 → 方框。 */
export const ROUTE_CAMERA_BOXES: Record<string, Record<string, BoxPlan>> = {};
