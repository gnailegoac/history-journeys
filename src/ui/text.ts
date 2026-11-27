// 界面上反复用到的几句固定的话和小的拼字逻辑。
// 点开“凭据”才用得到的几句（各条依据的名字、“沙盘上的东西”一栏的几句）在 foldText.ts：它们跟着那一段点开才下载的程序走。
// “来源”页上的话在 sourcesText.ts：跟着那一页的程序走，打开那一页才下载。

import type { NoteKind, Place } from '../domain';
import type { StageReadout } from '../stage/types';
import { BAR_SANS } from '../timebar/barText';
import { BASIS_LABEL, REGISTER_TEXT } from './foldText';
import { SOURCES_TEXT } from './sourcesText';

export const SITE_TITLE = '沿着他走过的路';
export const SITE_LINE = '选一位历史人物，沿着他一生走过的路，一站一站读下去。';
export const NOT_WRITTEN = '还没写';
/** 首页上可以点进去的那张卡片底下的一句。 */
export const START_READING = '从第一站读起';
/** 各站都还没写的人物（卡片上写了 outline），可以点进去的那张卡片底下换成这一句：点进去看的是全程沙盘和各站的提要。 */
export const START_ROADS = '先看他走过的路';
/** “来源”页的名字：首页、人物页、每一站的末尾通到它的链接上写的，也是那一页的标题。 */
export const SOURCES_LABEL = '来源';

export const NOTE_KIND_LABEL: Record<NoteKind, string> = {
  history: '历史',
  geography: '地理',
  humanities: '人文',
  science: '科学',
};

/** 站点页抬头下面的两句说明：正文是怎么来的，带虚线的词怎么用。 */
export const STOP_TEXT_LINES = [
  '正文是编写的人根据他自己的诗文、书信和史书，用今天的话改写的；引号里才是他的原话。',
  '带虚线的词可以点开，看小注。',
];

/** 正文还没写、有自己的沙盘的一站：文字栏里那张单子的小标题（黑体），单子上的一行一行是沙盘上看的各处。 */
export const VIEWS_HEADING = '沙盘上看的几处';

/**
 * 沙盘栏上的话。给读者的只说发生了什么、还能做什么；技术上的原因写在控制台里。
 * failed、unsupported、slow 三句末尾的“正文可以照常读”，在没有正文的一站上、正文这一次没读出来的一站上不说（StagePane.tsx 的 say）：
 * 那三句都要写成“，正文可以照常读。”或者“。正文可以照常读。”收尾，去掉以后还是一句完整的话。
 */
export const STAGE_TEXT = {
  label: '沙盘',
  loading: '沙盘正在摆出来，要等一会儿…',
  failed: '沙盘没能摆出来，正文可以照常读。',
  retry: '再试一次',
  unsupported: '这个浏览器画不出立体的沙盘。换一个新一点的浏览器，或者把手机、平板的系统升级以后再来看。正文可以照常读。',
  lost: '沙盘的画面断了。',
  rebuild: '重新摆出来',
  /** 这台设备带不动立体的沙盘，这座沙盘又没有图片可放。 */
  slow: '立体的沙盘在这台设备上太慢，先不摆了，正文可以照常读。',
  /**
   * 立体的沙盘摆不了、放的是每一小节的图片时，按钮下面的一行话。每一句都只占一行（最长 22 个字），
   * 说到那张图都叫“图片”。
   */
  stillUnsupported: '这个浏览器画不出立体的沙盘，这里放的是图片。',
  stillSlow: '立体的沙盘在这台设备上太慢，这里放的是图片。',
  /** 地址里指定了只放图片（?tier=still）：在哪台设备上都是真话。 */
  stillOnly: '这里放的是沙盘的图片，不能转动。',
  stillLost: '沙盘的画面断了，这里先放图片。',
  stillFailed: '沙盘没能摆出来，这里先放图片。',
  /** 放着图片时给读者的一个按钮：再试一次立体的沙盘。点了以后那一行话换成下面这一句，句尾是“换回图片”。 */
  tryTable: '试试立体的沙盘',
  askedLine: '设备慢的话，可以换回图片。',
  backToStills: '换回图片',
  /** 这位人物还没有全程沙盘。（这一次没读出来说的是 failed 那一句，带“再试一次”。） */
  noRoute: '全程沙盘还没接进来。',
  /** 写好了正文、还没有自己的沙盘的一站：按钮下面的一行话的前半句；后半句是 roadTail（摆着的是全程沙盘，看的是这一站的那一节）。 */
  roadNotice: '这一站的沙盘还没做好，',
  namesGroup: '地名',
  ancient: '古名',
  modern: '今名',
  reset: '回到这一节',
  /** 正文还没写的一站自己的沙盘上，中间的那个按钮：那一页上没有“节”，文字栏里说的是“那一处”。 */
  resetHere: '回到这一处',
  /** 全程沙盘上中间的那个按钮：人物页上，和没有自己的沙盘的一站上。 */
  resetWhole: '回到全程',
  resetRoad: '回到这一段',
  fold: '收起沙盘',
  unfold: '展开沙盘',
  north: '北',
  /** 沙盘旁边那一句说明后面的小按钮，和它展开的那一块。 */
  note: '说明',
  noteLabel: '沙盘的说明',
  noteTitle: '沙盘上哪些是真的，哪些是示意',
  noteClose: '关闭',
  /** 站点页标题后面给用键盘的人的一步：直接到沙盘栏。 */
  toStage: '到沙盘',
} as const;

/**
 * “沙盘上是……”那半句。没有自己的沙盘的一站，摆着的是全程沙盘上这一站的那一节；文字栏里（正文还没写的一站）和沙盘栏的按钮下面
 *（正文写好了的一站）各有一句话说它，后半句是同一句，在这里。说哪一种看那座全程沙盘自己（roads.stopShows）：
 * 不写、写 way-there 的，那一节画的是到这一站去的来路；写 stop-years 的（years 是 true），画的是这一站那几年走的路——不一定走到这一站，所以不说“来路”。
 */
export const roadTail = (years: boolean): string => `沙盘上是${years ? '' : '到'}这一站的${years ? '' : '来'}路。`;

/**
 * 地址里带 ?debug=1 时沙盘栏里印的一行读数（平板上没有开发者工具，靠它看画质和快慢），如
 * “画质：完整；像素比 2；试画 23 毫秒；移动时每帧 17 毫秒；摆好用了 3.1 秒”。
 * perf 是沙盘程序给的读数（沙盘的替身不给，那就只印最后一段）；readySeconds 是从开始摆到摆好用了几秒。
 */
export function stageDebugLine(perf: StageReadout['perf'], readySeconds: number | null): string {
  const parts: string[] = [];
  if (perf) {
    parts.push(`画质：${perf.tier === 'full' ? '完整' : '减配'}`);
    parts.push(`像素比 ${perf.pixelRatio}`);
    parts.push(perf.trialMs === null ? '还没试画' : `试画 ${Math.round(perf.trialMs)} 毫秒`);
    parts.push(perf.glideMs === null ? '镜头还没移动过' : `移动时每帧 ${Math.round(perf.glideMs)} 毫秒`);
  }
  if (readySeconds !== null) parts.push(`摆好用了 ${readySeconds.toFixed(1)} 秒`);
  return parts.join('；');
}

/**
 * 界面上用黑体排的固定的字，一处列全。做字体的工具照这张表把这些字放进黑体的文件
 *（tests/support/fontTool.ts；说明见 docs/data-spec.md“随站的字体”）：要用黑体排的字没有列在这里，
 * 黑体文件里就没有它，页面上它会掉到别的字体上（tests/e2e/fonts.spec.ts 会发现）。
 * 不在这张表里、也用黑体排的，是内容里来的字（人物的名字、朝代和年份，各站的标题、年份、地点和年纪，小节标题，
 * 小注的标题，沙盘旁边的小节名和时间），和沙盘上东西的五个类别名（src/domain/scene.ts 的 SCENE_CLASS_LABEL），工具自己去数。
 * 楷体没有这样一张表：楷体只有沙盘上的题签和题签脚上的印在用，那些字工具照页面拼题签、拼印的函数去数。
 *
 * 前面几项就是上面那些常数（“沙盘上的东西”“没有画的”两项在 foldText.ts 里：它们跟着点开才下载的那一段程序走；
 * “来源”页的四个小标题在 sourcesText.ts 里，跟着那一页的程序走）；
 * 后面直接写着字的几项，现在还写在各个组件里。目录上圆点里的数字（“一二三……”那一项）写在
 * src/ui/FigureContents.tsx 里，“读原文”“凭据”写在用到它们的地方（StopText.tsx、Provenance.tsx），
 * “问讲解员”“发送”在 GuidePanel.tsx、GuideBody.tsx。
 *
 * 写成“叫一个函数”再标上 PURE，是为了页面的程序里不带它：页面不用这张表，直接写成数组的话，
 * 打包的时候数组虽然去掉了，取 STAGE_TEXT.ancient 这些的那一串会留下来（多一百多个字节）。
 */
export const SANS_LABELS: readonly string[] = /* @__PURE__ */ sansLabels();

function sansLabels(): string[] {
  return [
    // 标题、按钮、小标题
    SITE_TITLE,
    STAGE_TEXT.ancient,
    STAGE_TEXT.modern,
    STAGE_TEXT.reset,
    STAGE_TEXT.resetHere,
    STAGE_TEXT.resetWhole,
    STAGE_TEXT.resetRoad,
    STAGE_TEXT.fold,
    STAGE_TEXT.unfold,
    STAGE_TEXT.retry,
    STAGE_TEXT.rebuild,
    STAGE_TEXT.tryTable,
    STAGE_TEXT.noteTitle,
    STAGE_TEXT.north,
    REGISTER_TEXT.heading,
    REGISTER_TEXT.notDrawn,
    REGISTER_TEXT.mark,
    '时间',
    '地点',
    '年纪',
    '各站目录',
    VIEWS_HEADING,
    '读原文',
    '凭据',
    '问讲解员',
    '发送',
    '没有找到这位人物',
    '没有这一站',
    START_READING,
    START_ROADS,
    SOURCES_LABEL,
    ...SOURCES_TEXT.headings,
    '一二三四五六七八九十',
    // 小标签
    NOT_WRITTEN,
    '正在看',
    ...Object.values(NOTE_KIND_LABEL),
    ...Object.values(BASIS_LABEL),
    // 一页的抬头
    STAGE_TEXT.toStage,
    '第 站 · 共',
    // 小注、原文、凭据
    STAGE_TEXT.noteClose,
    '小注',
    '+−',
    '白话',
    // 一页的末尾，贴着底边的那一条，讲解员面板
    '回到各站目录',
    '上一站',
    '下一站',
    '可以这样问',
    '以后可以这样问',
    '你的问题',
    // 沙盘栏：两个小按钮，比例尺上的数和单位
    STAGE_TEXT.backToStills,
    STAGE_TEXT.note,
    ' 米 公里',
    '0123456789',
    // 全程沙盘下面的时间轴：按钮、入口、岁数、括号、轴上的年份（字写在 src/timebar/barText.ts 里，跟着时间轴的那一段程序走）
    ...BAR_SANS,
  ];
}

/** 古名带今名，如“黄州（今湖北黄冈）”；两个名字一样时只写一个。 */
export function placeLabel(place: Pick<Place, 'ancient' | 'modern'>): string {
  return place.ancient === place.modern ? place.ancient : `${place.ancient}（今${place.modern}）`;
}

/** 浏览器标签上的标题，跟着页面走。 */
export function pageTitle(...parts: string[]): string {
  return [...parts, SITE_TITLE].join(' · ');
}
