// 时间轴上跟着日子变的字：第一行（哪一年、虚岁多少、在哪）、第二行（这一段知道些什么）、给读屏念的那一句；
// 栏多宽摆哪几样；地址里的开关。只算数、只拼字，不碰页面。
// 程序算出来的只有“哪一个农历年”：行迹的 years 表里，正月初一不晚于这一天的最后一行，年名、括号里的公元年、虚岁都是那一行的；
// 这一天公历已经是下一年的（农历年末的那几十天），括号里换成那一天公历的年和月——这一段在那个月里史料担保不了的除外
//（行迹里这一段的 plainMonths 列着），那些天照平常只写这个农历年的那个公元年。
// “在哪”和第二行的句子是行迹里手写的，原样印，这里不改一个字。日子从不印出来（它是第几天，可以带小数）。

import type { ItineraryBar } from '../domain/itinerary';
import { stretchIndexAt } from './barWhere';
import { BAR_TEXT } from './barText';

/** 栏里面够这么宽（像素）：第一行大一号，首页上带着人物的名字，“进第几站”写全。 */
export const ROOMY_PX = 640;
/** 栏里面不到这么宽（像素）：第一行连岁数也不写。 */
export const AGE_PX = 540;

/** 一到九。 */
const DIGITS = '一二三四五六七八九';

/** 1 到 99 写成汉字的数：一、十、十一、二十、六十六。 */
export function numeral(n: number): string {
  const tens = Math.floor(n / 10);
  const ones = n % 10;
  return `${tens > 1 ? DIGITS[tens - 1] : ''}${tens > 0 ? '十' : ''}${ones > 0 ? DIGITS[ones - 1] : ''}`;
}

/** 虚岁怎么写：一岁到十岁带“岁”字（虚岁一岁），十一岁起不带（虚岁十一）。 */
export function ageWords(age: number): string {
  return `${BAR_TEXT.age}${numeral(age)}${age <= 10 ? BAR_TEXT.ageUnit : ''}`;
}

/** 第 day 天是哪一个农历年：years 表里正月初一不晚于这一天的最后一行（头一行是出生的那一年，没有正月初一）。 */
export function yearRowAt(bar: Pick<ItineraryBar, 'years'>, day: number): ItineraryBar['years'][number] {
  let found = bar.years[0];
  for (const row of bar.years) if (row[2] !== null && row[2] <= day) found = row;
  return found;
}

/**
 * 第 day 天是公历（1582 年以前通行的儒略历）的哪一年、哪一月。day0 是第 0 天的公历日子（行迹里写的，“1037-01-08”）。
 * 只用来认“这一天公历已经是下一年了”和那是几月；哪一天从不印出来。算法同做行迹的工具里的那一个（tests/unit/bar-words.test.ts 拿它来对）。
 */
export function westernAt(day0: string, day: number): { year: number; month: number } {
  const [y0, m0, d0] = day0.split('-').map(Number);
  // 儒略历的某年某月某日是第几天（儒略日数）
  const a = Math.floor((14 - m0) / 12);
  const start = d0 + Math.floor((153 * (m0 + 12 * a - 3) + 2) / 5) + 365 * (y0 + 4800 - a) + Math.floor((y0 + 4800 - a) / 4) - 32083;
  // 倒回去：第几天是哪年哪月
  const c = start + Math.floor(day) + 32082;
  const d = Math.floor((4 * c + 3) / 1461);
  const m = Math.floor((5 * (c - Math.floor((1461 * d) / 4)) + 2) / 153);
  return { year: d - 4800 + Math.floor(m / 10), month: m + 3 - 12 * Math.floor(m / 10) };
}

/** 时间轴停在第 day 天的时候印的字。 */
export interface BarWords {
  /**
   * 年名和括号里的公元年：元丰五年（1082）。一个农历年的最后几十天落在公历的下一年里（腊月常常已经是下一年的一月）：
   * 那些天括号里写那一天公历的年和月——景祐三年（1037年1月）——不然读的人看到的是“1036”，而他生在 1037 年 1 月。
   * 写了月份，“某年某月、在某地”就也要是史料担保得了的：这一段在那个月里也许还没开始、也许已经结束的（行迹里列在 plainMonths），
   * 那些天不写月份，照平常写——熙宁九年（1076）。
   */
  year: string;
  /** 虚岁四十七。 */
  age: string;
  /** 在哪（行迹里手写的；最前、最后两个位置是 first、last 的）。 */
  label: string;
  /** 第二行：这一段知道些什么。 */
  says: string;
  /** 给读屏念的那一句：年名，公元年，虚岁，在哪，再是第二行整句。 */
  spoken: string;
}

/**
 * 第 day 天印什么字。第 0 天（和以前）是最前一个位置，最后一天（和以后）是最后一个位置：各有自己的两行字。
 * pictures 是这一栏现在放着的是图片（图片上不画小像）：最前一个位置的第二行后面多半句“；图片上没有他的小像”。
 */
export function wordsAt(bar: ItineraryBar, day: number, pictures = false): BarWords {
  const lastDay = bar.stretches[bar.stretches.length - 1].until;
  const at = Math.min(Math.max(day, 0), lastDay);
  const [year, name, , age] = yearRowAt(bar, at);
  const here = bar.stretches[stretchIndexAt(bar, at)];
  const stretch = at <= 0 ? bar.first : at >= lastDay ? bar.last : here;
  const ageSays = ageWords(age);
  // 这一天公历是不是已经到了下一年（括号里平常写的是这个农历年大半落在的那一年）；到了，这一段在那个月里又是史料担保得了的，才写年和月
  const west = westernAt(bar.day0, at);
  const later = west.year !== year && !here.plainMonths?.some(([y, m]) => y === west.year && m === west.month);
  const says = at <= 0 && pictures ? `${stretch.says}${BAR_TEXT.noFigure}` : stretch.says;
  return {
    year: `${name}（${later ? BAR_TEXT.west(west.year, west.month) : year}）`,
    age: ageSays,
    label: stretch.label,
    says,
    spoken: `${name}，${later ? `${west.year} 年 ${west.month} 月` : `${year} 年`}，${ageSays}，${stretch.label}。${says}。`,
  };
}

/** 栏里面这么宽的时候摆哪几样。 */
export interface BarFit {
  /** 第一行大一号；首页上带人物的名字；“进第几站”写全（不然只是那一站的圆点和箭头）。 */
  roomy: boolean;
  /** 第一行写不写岁数。 */
  age: boolean;
}

/** 栏里面 inner 像素宽的时候摆哪几样（放不下的时候先去掉名字，再去掉岁数；年份和“在哪”总在）。 */
export function barFit(inner: number): BarFit {
  return { roomy: inner >= ROOMY_PX, age: inner >= AGE_PX };
}

/** 地址里的开关读出来的样子。 */
export interface BarSwitch {
  /** 摆不摆时间轴。 */
  on: boolean;
  /** 从第几天起；没有指定是 null（从记着的那一天起，头一回是出生的那一天）。 */
  day: number | null;
}

/**
 * 地址里的 ?bar=（拍照的工具和测试用的开关，同 ?tier=、?dive=1 一样；读者拖到哪一天从不写进地址）：
 *   ?bar=none   不摆（这一条空着）；
 *   ?bar=整数   摆上，从那一天起（0 是出生的那一天）；
 *   没有写      摆上——沙盘的替身上（?stage=fake……）除外：那里不写就不摆，原来的测试看到的还是原来的页面。
 * “整数”是不带正负号、不带小数点的一串数字（第几天，从 0 起）；别的写法（-3、1.5、空的）都算没有写。
 * 是不是沙盘的替身，同页面认的一模一样（FAKE_STAGES：src/ui/stageEngineSource.ts 认的那三个词，别的词页面摆的是真的沙盘）。
 * search 是 location.search。
 */
export function barSwitch(search: string): BarSwitch {
  const params = new URLSearchParams(search);
  const asked = params.get('bar');
  if (asked === 'none') return { on: false, day: null };
  if (asked !== null && /^\d+$/.test(asked)) return { on: true, day: Number(asked) };
  return { on: !FAKE_STAGES.includes(params.get('stage') ?? ''), day: null };
}

/** 地址里 ?stage= 写这几个词的时候，页面摆的是沙盘的替身（这个文件夹不引 src/ui/，所以抄一份；tests/unit/bar-words.test.ts 守着两边一样）。 */
export const FAKE_STAGES: readonly string[] = ['fake', 'fake-fail', 'fake-unsupported'];
