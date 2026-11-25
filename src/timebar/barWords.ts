// 时间轴上跟着日子变的字：第一行（哪一年、虚岁多少、在哪）、第二行（这一段知道些什么）、给读屏念的那一句；
// 栏多宽摆哪几样；地址里的开关。只算数、只拼字，不碰页面。
// 程序算出来的只有“哪一个农历年”：行迹的 years 表里，正月初一不晚于这一天的最后一行，年名、括号里的公元年、虚岁都是那一行的。
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

/** 时间轴停在第 day 天的时候印的字。 */
export interface BarWords {
  /** 年名和括号里的公元年：元丰五年（1082）。 */
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

/** 第 day 天印什么字。第 0 天（和以前）是最前一个位置，最后一天（和以后）是最后一个位置：各有自己的两行字。 */
export function wordsAt(bar: ItineraryBar, day: number): BarWords {
  const lastDay = bar.stretches[bar.stretches.length - 1].until;
  const at = Math.min(Math.max(day, 0), lastDay);
  const [year, name, , age] = yearRowAt(bar, at);
  const stretch = at <= 0 ? bar.first : at >= lastDay ? bar.last : bar.stretches[stretchIndexAt(bar, at)];
  const ageSays = ageWords(age);
  return {
    year: `${name}（${year}）`,
    age: ageSays,
    label: stretch.label,
    says: stretch.says,
    spoken: `${name}，${year} 年，${ageSays}，${stretch.label}。${stretch.says}。`,
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
 * search 是 location.search。
 */
export function barSwitch(search: string): BarSwitch {
  const params = new URLSearchParams(search);
  const asked = params.get('bar');
  if (asked === 'none') return { on: false, day: null };
  if (asked !== null && /^\d+$/.test(asked)) return { on: true, day: Number(asked) };
  return { on: !(params.get('stage') ?? '').startsWith('fake'), day: null };
}
