// 行迹：一位人物从出生到去世，哪一段年月在哪里。两样东西的样子都写在这里：
//   Itinerary     手写的那一份（content/figures/<人物>/itinerary.json）：每个日子的出处、范围、说不准的都在里面；
//   ItineraryBar  工具照它做出来的那一份（content/figures/<人物>/itinerary.bar.json）：时间轴用的，只留时间轴要的几样。
// 说明见 docs/data-spec.md“行迹”。这个文件里只有类型，不写给人看的字。

import type { LngLat } from './types';

/** 一个日子知道到哪一步：日、月、季、年、某一天以前、某一天以后、没有查到。 */
export type ItineraryPrecision = 'day' | 'month' | 'season' | 'year' | 'before' | 'after' | 'not-found';

/**
 * 一个日子。text 是照史料的写法（年号纪年），不改字。year 是公元年。
 * 精确到日的（precision 是 day）写 month、day（儒略历），不写 earliest、latest；
 * 别的都不写 month、day，只写一个范围：earliest、latest（“1084-05-08”这样的儒略历日子），两头都要写。
 * earliestIs、latestIs 说这一头是怎么定的。前后两个日子的范围一模一样的，各写 sharesWindow：第几个、一共几个。
 */
export interface ItineraryMoment {
  text: string;
  year: number;
  precision: ItineraryPrecision;
  month?: number;
  day?: number;
  earliest?: string;
  latest?: string;
  earliestIs?: string;
  latestIs?: string;
  sharesWindow?: { order: number; of: number };
}

/** 出处：和一站的 sources 一样的三样，另加一句“读了什么”（读了全文、只读了引文、没有读到原文）。 */
export interface ItinerarySource {
  id: string;
  basis: 'own-words' | 'record' | 'later';
  cite: string;
  read: string;
}

/** 农历年的一行：公元年（这个农历年大半落在的那一年）、年名、正月初一是公元哪一天（出生的那一年写 null）、这一年虚岁几岁。 */
export interface ItineraryYear {
  year: number;
  name: string;
  newYear: string | null;
  age: number;
}

/** 路上的一处：有 date 的，那一天他在这里；没有的只知道先后。at 是经纬度（没有查到位置的不写）。 */
export interface ItineraryWaypoint {
  name: string;
  at?: LngLat;
  date?: ItineraryMoment;
  sourceIds: string[];
  note: string;
  unsure?: string;
}

/** 一趟路里的一截：name、class 照 scenes/route.json 的那一截原样；ways 按他走的先后；partial 是只走了这一截里的一部分。 */
export interface ItineraryPart {
  name: string;
  ways: string[];
  class: 'text' | 'schematic';
  partial?: boolean;
}

/**
 * “别的”一段里，这个地方在全程沙盘上有没有：
 *   stop-point  是某一站的那个地名点，只是年份不在这一站里：小像站在那里；
 *   place       沙盘上立了名字、不是站的地名点：小像站在那里；
 *   way-vertex  在画出来的一条线上，沙盘上没有立它的名字：小像站在线上的这个位置；
 *   edge-strip  在沙盘的框外，框上立着它的题签：小像不出现；
 *   on-ways     路上的一趟，经过的地方大半在画出来的线上，这一趟本身没有画：小像不出现；
 *   none        沙盘上没有：小像不出现。
 */
export type ItineraryTablePoint =
  | { type: 'stop-point' | 'place'; place: string }
  | { type: 'way-vertex'; way: string; at: LngLat; note?: string }
  | { type: 'edge-strip'; strip: string; at: LngLat }
  | { type: 'on-ways'; ways: string[]; note: string }
  | { type: 'none' };

/** 每一段都有的几样。start 就是上一段的 end，一字不差。 */
interface ItineraryStretchBase {
  id: string;
  /** 落在哪一站讲的年月里（来路，加上住下来的年月）；不在哪一站里是 null。 */
  stopYearsOf: string | null;
  start: ItineraryMoment;
  end: ItineraryMoment;
  sourceIds: string[];
  class: 'text' | 'schematic';
  /** 这一段里说不准的。 */
  unsure: string;
  note?: string;
  /** 在路上超过三个月、到的日子又不精确到日的一段：为什么这么长（史料怎么说的）。 */
  longRoad?: string;
  /** 时间轴第一行的“在哪”，手写，最多十个字。 */
  label: string;
  /** 时间轴第二行的一句话，手写，最多三十二个字。 */
  says: string;
  /** says 里用到的每一个日子：是哪一个日子（start、end，或者“wp:”加路上一处的名字）的写法缩短来的。照句子里的先后列，也就是照日子的先后。 */
  saysDates: { of: string; text: string }[];
  /** 路上的各处（路，和“别的”里在路上的一段）。 */
  waypoints?: ItineraryWaypoint[];
}

export type ItineraryStretch =
  | (ItineraryStretchBase & { kind: 'stop'; stop: string; place: string })
  | (ItineraryStretchBase & { kind: 'road'; journey: string; from: string; to: string; parts: ItineraryPart[] })
  | (ItineraryStretchBase & { kind: 'elsewhere'; where: string; moving: boolean; tablePoint: ItineraryTablePoint });

/**
 * 时间轴最前、最后一个位置上的两行字。saysDates 和一段里的一样：says 里用到的每一个日子，
 * 最前的只能指头一段的 start，最后的只能指最后一段的 end。
 */
export interface ItineraryEndWords {
  label: string;
  says: string;
  saysDates: { of: string; text: string }[];
}

export interface Itinerary {
  /** 给写数据的人看的说明，程序不读。 */
  about: Record<string, unknown>;
  sources: ItinerarySource[];
  years: ItineraryYear[];
  stretches: ItineraryStretch[];
  /** 时间轴最前、最后一个位置上的两行字。 */
  first: ItineraryEndWords;
  last: ItineraryEndWords;
}

// ---------------------------------------------------------------- 时间轴用的那一份（工具做的）

/**
 * 时间轴上一段画成什么：stop 在一站讲的年月里、住在那里；road 在画出来的一趟路上；
 * quiet 沙盘上有这个地方、不在哪一站住下来的年月里（小像站在那里）；off 沙盘上没有（小像不出现）。
 */
export type ItineraryLook = 'stop' | 'road' | 'quiet' | 'off';

export interface ItineraryBarStretch {
  id: string;
  look: ItineraryLook;
  label: string;
  says: string;
  /** 这一段里说不准的（点开“说明”才看得见）；没有就不写。 */
  unsure?: string;
  /** 落在哪一站讲的年月里。 */
  group?: string;
  /** 目录里那一站旁边写什么：here 是“他在这儿”，coming 是“正往这儿走”；不写字的不写。 */
  mark?: 'here' | 'coming';
  /** 小像站在全程沙盘的哪个地名点上（stop，和站在有名字的地方的 quiet）。 */
  place?: string;
  /** 小像站在一条线上没有立名字的一处：那条线的 id，和这个地方的经纬度（另一种 quiet）。 */
  spot?: [string, LngLat];
  /** 这一段走的路，照走的先后，倒着走的前面一个减号（road）。 */
  ways?: string[];
  /** 这一段的各截是不是示意的（画虚线），照先后（road）。 */
  dashed?: boolean[];
  /** 路上精确到日、又有位置的各处：经纬度，和那一天是第几天。 */
  legs?: [LngLat, number][];
  /** 这一段到第几天为止（从 day0 数起；可以带小数，从不显示成日子）。 */
  until: number;
}

export interface ItineraryBar {
  /** 第 0 天：他出生的那一天，公元（儒略历）。 */
  day0: string;
  /** 这位人物的名字（figure.json 的 name）。 */
  name: string;
  /** 农历年：公元年、年名、正月初一是第几天、虚岁；头一行是出生的那一年，第三个数是 null。 */
  years: [number, string, number | null, number][];
  first: { label: string; says: string };
  last: { label: string; says: string };
  stretches: ItineraryBarStretch[];
}
