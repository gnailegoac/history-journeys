// 沙盘适配层的入口。页面只从这里、types.ts 和 overlay 取东西。
// 这个文件要保持很小：沙盘程序（three.js 和造沙盘的代码）用动态 import 加载，没有沙盘的页面不会下载它。
// 定格图的沙盘（stillEngine）和“这个浏览器能不能画立体的沙盘”（probeWebgl）是直接带上的：
// 它们很小，不碰 three，而且正是在沙盘程序下载之前、下载不了的时候要用。

import { FAMILIES } from './families';
import { labelsIn } from './overlay/strips';
import type { LabelKitMaker } from './overlay/types';
import { stillEngine as still } from './still';
import { STYLES, labelKind } from './styles';
import type { StyleRow } from './styles';
import type { StageEngine } from './types';

export { probeWebgl } from './support';

/** 另一种题签（平着的纸条）的那一小块程序交出来的东西：给一层题签造一份。 */
type Slips = LabelKitMaker;

/**
 * 写着 style 这种样式的沙盘，题签要是另一种（样式的登记表那一行写了 labels: 'slip'），取它的那一小块程序；是竖着的纸条就什么也不取（undefined）。
 * 那一小块只引页面的程序里本来就有的东西，什么时候去要都行。没取到就拒绝：页面照“沙盘没能摆出来”办，读者点“再试一次”的时候重新取。
 * rows、load 不写就是登记表和真的那一块（测试交编出来的表和假的取法）。
 */
export function labelsFor(style: string | undefined, rows: readonly StyleRow[] = STYLES, load: () => Promise<{ slipKit: Slips }> = () => import('./overlay/slips')): Promise<Slips> | undefined {
  return labelKind(style, rows) === 'slip' ? load().then((got) => got.slipKit) : undefined;
}

/**
 * 给一个沙盘程序套上“题签是哪一种”：它每摆一座沙盘，先把那一小块程序记在容器上，题签层挂上去的时候照它造、照它摆（./overlay/strips.ts 的 labelsIn）。
 * 竖着的纸条（slips 是 undefined）原样交回，什么也不套。
 */
function labelled(engine: StageEngine, slips: Slips | undefined): StageEngine {
  return slips ? { ...engine, create: (container, table, options) => (labelsIn(container, slips), engine.create(container, table, options)) } : engine;
}

/**
 * 取得沙盘程序。第一次调用时才下载它的代码。style 是要摆的那座沙盘的样式（场景文件里写的）：它的题签是另一种的话，那一小块程序和沙盘程序一起取。
 * 全程沙盘另有一小块程序，摆全程沙盘时才下载：怎么取在这里交给沙盘程序（这一句动态 import 要是写在沙盘程序里面，
 * 打包的工具会把页面的程序拆成两个文件；tests/build/dist-size.test.ts 守着）。
 * 按家分块的零件也是这样交进去的：登记表在 ./families.ts。时代样式也是：登记表在 ./styles.ts。
 * 样式那一小块不在这里先要：它引着沙盘程序，赶在沙盘程序前头去要它的话，沙盘程序没取到的那一回会被它再要一遍
 * （tests/e2e/pane-stills.spec.ts 里“沙盘程序头一次没取到”那一条守着：没取到的那一回只要过一次）。
 * 沙盘一摆就自己照登记表去取（src/stage/three/view.ts 的 build）：那时沙盘程序刚到，样式和地形文件一起在路上，不多等一个来回。
 */
export async function loadStageEngine(style?: string, rows?: readonly StyleRow[], load?: () => Promise<{ slipKit: Slips }>): Promise<StageEngine> {
  const [{ engine, provideFamilies, provideRouteLevel, provideStyles }, slips] = await Promise.all([import('./three/engine'), labelsFor(style, rows, load)]);
  provideRouteLevel(() => import('./three/routeLevel'));
  provideFamilies(FAMILIES);
  provideStyles(STYLES);
  return labelled(engine, slips);
}

/**
 * 定格图的沙盘。哪一种题签都不等：交回的是一个已经兑现的 Promise。
 * 竖着的纸条的沙盘：里面就是定格图的沙盘本身（和没有另一种题签的时候一样快）。
 * style 的意思同上，题签是另一种的：那一小块程序这时去取，不等它——交出去的沙盘每摆一座，把“那一小块到了、记在这个容器上了”交给那一座（StageOptions.labels）：
 * 图片马上摆，题签到了再摆上去；没取到，那一座的 named 拒绝，页面说“沙盘没能摆出来”、给“再试一次”，点了再叫一次这里，重新取。
 * rows、load 同 labelsFor（测试交编出来的表和假的取法）；上面那一个也一样。
 */
export function loadStillEngine(style?: string, rows?: readonly StyleRow[], load?: () => Promise<{ slipKit: Slips }>): Promise<StageEngine> {
  const slips = labelsFor(style, rows, load);
  // 一座也没有摆、它就没取到的那一回：不让浏览器报“未处理的错误”
  slips?.catch(() => {});
  return Promise.resolve(slips ? { ...still, create: (container, table, options) => still.create(container, table, { ...options, labels: slips.then((kit) => labelsIn(container, kit)) }) } : still);
}

/** 定格图的沙盘本身（竖着的纸条的沙盘、测试直接用它）。 */
export const stillEngine: StageEngine = still;
