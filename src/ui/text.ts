// 界面上反复用到的几句固定的话和小的拼字逻辑。

import type { Basis, NoteKind, Place } from '../domain';
import type { StageReadout } from '../stage/types';

export const SITE_TITLE = '沿着他走过的路';
export const SITE_LINE = '选一位历史人物，沿着他一生走过的路，一站一站读下去。';
export const NOT_WRITTEN = '还没写';

export const NOTE_KIND_LABEL: Record<NoteKind, string> = {
  history: '历史',
  geography: '地理',
  humanities: '人文',
  science: '科学',
};

export const BASIS_LABEL: Record<Basis, string> = {
  'own-words': '他本人的话',
  record: '史书和当时人的记载',
  later: '后人的记载',
  editor: '编写时补的',
};

/** 站点页抬头下面的两句说明：正文是怎么来的，带虚线的词怎么用。 */
export const STOP_TEXT_LINES = [
  '正文是编写的人根据他自己的诗文、书信和史书，用今天的话改写的；引号里才是他的原话。',
  '带虚线的词可以点开，看小注。',
];

/** 沙盘栏上的话。给读者的只说发生了什么、还能做什么；技术上的原因写在控制台里。 */
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
  /** 人物页上还没有全程沙盘的定格图。 */
  noRoute: '全程沙盘还没接进来。',
  /** 这一站还没有沙盘：有定格图时请读者先看它，没有时只说前半句。 */
  noScene: '这一站的沙盘还没做好，先看全程。',
  noSceneAlone: '这一站的沙盘还没做好。',
  stillLoading: '加载中…',
  namesGroup: '地名',
  ancient: '古名',
  modern: '今名',
  reset: '回到这一节',
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

/** 凭据里“沙盘上的东西”一栏的几句固定的话。 */
export const REGISTER_TEXT = {
  heading: '沙盘上的东西',
  line: '沙盘上摆的每样东西属于哪一类，依据什么。',
  notDrawn: '没有画的',
  cite: '出处：',
} as const;

/**
 * 界面上用楷体排的固定的字，一处列全。做字体的工具照这张表把这些字放进楷体的文件
 *（tests/support/fontTool.ts；说明见 docs/data-spec.md“随站的字体”）：要用楷体排的字没有列在这里，
 * 楷体文件里就没有它，页面上它只能用宋体显示。
 * 不在这张表里、也用楷体排的，是内容里来的字（人物的名字、各站的标题、小节标题、小注的标题、题签、题记），
 * 和沙盘上东西的五个类别名（src/domain/scene.ts 的 SCENE_CLASS_LABEL），工具自己去数。
 * 用楷体排的字里不要有弯引号（这套楷体里它们只有三分之一个字宽）。
 *
 * 前面几项就是上面那些常数；后面直接写着字的几项，现在还写在各个组件里，或者页面上还没有
 *（“来源”页、目录上的数字印、首页的“从第一站读起”），换字体、换样子的时候挪到这个文件里来，这里改成引用。
 *
 * 写成“叫一个函数”再标上 PURE，是为了页面的程序里不带它：页面不用这张表，直接写成数组的话，
 * 打包的时候数组虽然去掉了，取 STAGE_TEXT.ancient 这些的那一串会留下来（多一百多个字节）。
 */
export const KAI_LABELS: readonly string[] = /* @__PURE__ */ kaiLabels();

function kaiLabels(): string[] {
  return [
    SITE_TITLE,
    STAGE_TEXT.ancient,
    STAGE_TEXT.modern,
    STAGE_TEXT.reset,
    STAGE_TEXT.fold,
    STAGE_TEXT.unfold,
    STAGE_TEXT.retry,
    STAGE_TEXT.rebuild,
    STAGE_TEXT.tryTable,
    STAGE_TEXT.noteTitle,
    STAGE_TEXT.north,
    REGISTER_TEXT.heading,
    REGISTER_TEXT.notDrawn,
    '时间',
    '地点',
    '年纪',
    '各站目录',
    '读原文',
    '凭据',
    '问讲解员',
    '发送',
    '没有找到这位人物',
    '没有这一站',
    '从第一站读起',
    '来源',
    '字体',
    '地形和水',
    '图片',
    '程序',
    '一二三四五六七八九十',
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
