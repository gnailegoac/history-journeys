// 定格图的沙盘：每一小节一张先拍好的图片，上面摆的是和立体沙盘一样的题签（页面上的字，不是印在图里的）。
// 它是另一个 StageEngine，页面里静态引入，所以这个文件夹不碰 three，也不从 src/stage/three/、src/stage/ground/ 里取东西。
//
// 怎么摆在 ./engine.ts，图片摆多大、摆在哪在 ./fit.ts。这座沙盘没有定格图（StopTable.stills 没写）时，
// 摆出来的东西 ready 拒绝，页面照“这座沙盘没有定格图”处理。

import type { StageEngine } from '../types';
import { createStillEngine } from './engine';

export const stillEngine: StageEngine = createStillEngine();
