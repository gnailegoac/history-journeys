// 时间轴上跟着日子变的字（src/timebar/barWords.ts）：第一行、给读屏念的那一句、栏多宽摆哪几样、地址里的开关。
// 在 Node 里跑，照 content/ 里真的行迹（时间轴用的那一份）查；公历的日子用做行迹的工具里的那个函数换（tests/support/itineraryTool.ts）。

import { describe, expect, it } from 'vitest';
import type { ItineraryBar } from '../../src/domain/itinerary';
import { stopMarks } from '../../src/domain/stopMarks';
import type { Figure } from '../../src/domain/types';
import { BAR_NOTE_TEXT } from '../../src/timebar/barNoteText';
import { BAR_SANS, BAR_TEXT } from '../../src/timebar/barText';
import { stretchIndexAt } from '../../src/timebar/barWhere';
import { AGE_PX, FAKE_STAGES, ROOMY_PX, ageWords, barFit, barSwitch, numeral, westernAt, wordsAt, yearRowAt } from '../../src/timebar/barWords';
import { SANS_LABELS } from '../../src/ui/text';
import { dayOfIso, isoOfDay } from '../support/itineraryTool';
import { readBytes } from '../support/readBytes';

const bar = JSON.parse(new TextDecoder().decode(readBytes('content/figures/su-shi/itinerary.bar.json'))) as ItineraryBar;
const lastDay = bar.stretches[bar.stretches.length - 1].until;
const day0 = dayOfIso(bar.day0) as number;
/** 第 day 天是公历（儒略历）的哪一天，写成“年-月-日”。 */
const dateOf = (day: number): string => isoOfDay(day0 + Math.floor(day));

describe('时间轴上的字', () => {
  it('第一行：农历年的年名、括号里的公元年、虚岁；一岁到十岁带“岁”字，十一岁起不带', () => {
    // 数字
    expect([1, 2, 9, 10, 11, 19, 20, 21, 47, 60, 66].map(numeral)).toEqual(['一', '二', '九', '十', '十一', '十九', '二十', '二十一', '四十七', '六十', '六十六']);
    expect(ageWords(1)).toBe('虚岁一岁');
    expect(ageWords(10)).toBe('虚岁十岁');
    expect(ageWords(11)).toBe('虚岁十一');
    expect(ageWords(47)).toBe('虚岁四十七');
    expect(ageWords(66)).toBe('虚岁六十六');
    // 每一个农历年：从正月初一那一天起是它，前一天还是上一年；年名、公元年、虚岁就是表里那一行的
    bar.years.forEach((row, i) => {
      const [year, name, newYear, age] = row;
      if (newYear === null) {
        expect(i).toBe(0);
        return;
      }
      expect(yearRowAt(bar, newYear), name).toBe(row);
      expect(yearRowAt(bar, newYear + 200), name).toBe(row);
      expect(yearRowAt(bar, newYear - 0.5), name).toBe(bar.years[i - 1]);
      const words = wordsAt(bar, Math.min(newYear + 1, lastDay - 1));
      expect(words.year, name).toBe(`${name}（${year}）`);
      expect(words.age, name).toBe(ageWords(age));
      // 虚岁一年长一岁，生下来是一岁
      expect(age, name).toBe(i + 1);
    });
    // 黄州的那几年里的一天
    const huangzhou = wordsAt(bar, 16525);
    expect([huangzhou.year, huangzhou.age, huangzhou.label]).toEqual(['元丰五年（1082）', '虚岁四十七', '在黄州']);
    // 最前、最后两个位置：年名、岁数照样是表里的，“在哪”和第二行是行迹里那两个位置自己的
    const first = wordsAt(bar, 0);
    expect([first.year, first.age, first.label, first.says]).toEqual(['景祐三年（1037年1月）', '虚岁一岁', bar.first.label, bar.first.says]);
    expect(wordsAt(bar, -3)).toEqual(first);
    const last = wordsAt(bar, lastDay);
    expect([last.year, last.age, last.label, last.says]).toEqual(['建中靖国元年（1101）', '虚岁六十六', bar.last.label, bar.last.says]);
    expect(wordsAt(bar, lastDay + 9)).toEqual(last);
    // 中间的每一段：“在哪”和第二行就是行迹里手写的那两样，一个字不改
    let from = 0;
    for (const stretch of bar.stretches) {
      const words = wordsAt(bar, (Math.max(from, 0.5) + stretch.until) / 2);
      expect([words.label, words.says], stretch.id).toEqual([stretch.label, stretch.says]);
      from = stretch.until;
    }
  });

  it('腊月里已经是公历下一年的一月、二月：年名还是那个农历年的，括号里写那一天公历的年和月（这一段在那个月里史料担保不了的除外：行迹里列着，只写年份）；别的日子括号里只有年份', () => {
    // 他生的那一天：公历已经是 1037 年 1 月，农历还是景祐三年的腊月。括号里写“1036”的话，就同轴上的头一个年份、同正文里的“生于 1037 年”对不上
    expect(bar.day0.startsWith('1037-01-')).toBe(true);
    expect(wordsAt(bar, 0).year).toBe('景祐三年（1037年1月）');
    expect(wordsAt(bar, 0).spoken.startsWith('景祐三年，1037 年 1 月，虚岁一岁，')).toBe(true);
    // 一生的每一天：公历的年份就是表里那一行的，括号里只写年份；公历已经到了下一年的（都在一月、二月，正月初一以前），写年和月
    let later = 0;
    let plainDays = 0;
    const months = new Set<number>();
    /** 这一天落在的那一段，行迹里有没有把这个月列成“只写年份”。 */
    const plain = (day: number, y: number, m: number): boolean => bar.stretches[stretchIndexAt(bar, day)].plainMonths?.some(([py, pm]) => py === y && pm === m) ?? false;
    for (let day = 0; day <= lastDay; day++) {
      const [year, name, , age] = yearRowAt(bar, day);
      const [y, m] = dateOf(day).split('-').map(Number);
      expect(westernAt(bar.day0, day), dateOf(day)).toEqual({ year: y, month: m });
      const words = wordsAt(bar, day + 0.25);
      if (y === year) {
        expect(words.year, dateOf(day)).toBe(`${name}（${year}）`);
        continue;
      }
      later++;
      months.add(m);
      expect(y, dateOf(day)).toBe(year + 1);
      if (plain(day + 0.25, y, m)) {
        // 这一段在这个月里也许还没开始、也许已经结束：不写月份，照平常只写这个农历年的那个公元年
        plainDays++;
        expect(words.year, dateOf(day)).toBe(`${name}（${year}）`);
        expect(words.spoken.startsWith(`${name}，${year} 年，${ageWords(age)}，`), dateOf(day)).toBe(true);
        continue;
      }
      expect(words.year, dateOf(day)).toBe(`${name}（${y}年${m}月）`);
      expect(words.spoken.startsWith(`${name}，${y} 年 ${m} 月，${ageWords(age)}，`), dateOf(day)).toBe(true);
    }
    expect(later).toBeGreaterThan(0);
    expect([...months].sort()).toEqual([1, 2]);
    // 行迹里列着的月份确实碰到了，也只是少数
    expect(bar.stretches.some((stretch) => (stretch.plainMonths ?? []).length > 0)).toBe(true);
    expect(plainDays).toBeGreaterThan(0);
    expect(plainDays).toBeLessThan(later / 2);
    console.log(`一生 ${lastDay + 1} 天里，农历年末、公历已经是下一年的有 ${later} 天：括号里写公历的年和月；其中 ${plainDays} 天史料担保不了那个月，只写年份`);
    // 每一个正月初一落在公历一月、二月的年份：前一天公历已经是这一年了，年名和括号里的年份还是上一年的
    let checked = 0;
    bar.years.forEach((row, i) => {
      const newYear = row[2];
      if (newYear === null) return;
      const before = dateOf(newYear - 1);
      // 正月初一那一天的公历年份就是括号里写的那一年
      expect(Number(dateOf(newYear).slice(0, 4)), row[1]).toBe(row[0]);
      if (Number(before.slice(0, 4)) !== row[0]) return;
      checked++;
      const words = wordsAt(bar, newYear - 1);
      const month = Number(before.slice(5, 7));
      expect(words.year, `${before}（${row[1]}正月初一的前一天）`).toBe(plain(newYear - 1, row[0], month) ? `${bar.years[i - 1][1]}（${bar.years[i - 1][0]}）` : `${bar.years[i - 1][1]}（${row[0]}年${month}月）`);
      expect(bar.years[i - 1][0], row[1]).toBe(row[0] - 1);
    });
    expect(checked).toBeGreaterThan(60);
  });

  it('这一栏放着图片的时候（图片上不画小像）：最前一个位置的第二行后面多半句“；图片上没有他的小像”，给读屏念的那一句里也有；别的位置、摆着沙盘的时候都没有', () => {
    expect(BAR_TEXT.noFigure).toBe('；图片上没有他的小像');
    const plain = wordsAt(bar, 0);
    const pictures = wordsAt(bar, 0, true);
    expect(plain.says).toBe(bar.first.says);
    expect(pictures.says).toBe(`${bar.first.says}；图片上没有他的小像`);
    expect(pictures.spoken.endsWith(`${bar.first.label}。${bar.first.says}；图片上没有他的小像。`)).toBe(true);
    expect(plain.spoken).not.toContain('图片');
    // 第一行不变
    expect([pictures.year, pictures.age, pictures.label]).toEqual([plain.year, plain.age, plain.label]);
    // 行迹里的那一句一个字没动
    expect(bar.first.says).not.toContain('图片');
    // 别的位置（连最后一个位置）：放着图片也还是行迹里的那一句
    let from = 0;
    for (const stretch of bar.stretches) {
      const day = (Math.max(from, 0.5) + stretch.until) / 2;
      expect(wordsAt(bar, day, true), stretch.id).toEqual(wordsAt(bar, day));
      from = stretch.until;
    }
    expect(wordsAt(bar, lastDay, true)).toEqual(wordsAt(bar, lastDay));
  });

  it('栏多宽摆哪几样：640 像素起有岁数、首页带名字、“进第几站”写全；540 到 639 没有名字，“进第几站”只是圆点；不到 540 连岁数也不写', () => {
    expect([ROOMY_PX, AGE_PX]).toEqual([640, 540]);
    expect(barFit(640)).toEqual({ roomy: true, age: true });
    expect(barFit(939)).toEqual({ roomy: true, age: true });
    expect(barFit(639)).toEqual({ roomy: false, age: true });
    expect(barFit(540)).toEqual({ roomy: false, age: true });
    expect(barFit(539)).toEqual({ roomy: false, age: false });
    expect(barFit(0)).toEqual({ roomy: false, age: false });
    // “进第几站”写全的样子
    expect(BAR_TEXT.enter('六')).toBe('进第六站');
  });

  it('给读屏念的那一句总是全的：年名、公元年、虚岁、在哪，再是第二行整句', () => {
    expect(wordsAt(bar, 16525).spoken).toBe('元丰五年，1082 年，虚岁四十七，在黄州。元丰三年二月一日到，元丰七年四月离开。');
    let from = 0;
    for (const stretch of bar.stretches) {
      const day = (Math.max(from, 0.5) + stretch.until) / 2;
      const [year, name, , age] = yearRowAt(bar, day);
      const [y, m] = dateOf(day).split('-').map(Number);
      const yearOnly = y === year || (stretch.plainMonths ?? []).some(([py, pm]) => py === y && pm === m);
      expect(wordsAt(bar, day).spoken, stretch.id).toBe(`${name}，${yearOnly ? `${year} 年` : `${y} 年 ${m} 月`}，${ageWords(age)}，${stretch.label}。${stretch.says}。`);
      from = stretch.until;
    }
    expect(wordsAt(bar, 0).spoken).toBe(`景祐三年，1037 年 1 月，虚岁一岁，${bar.first.label}。${bar.first.says}。`);
    expect(wordsAt(bar, lastDay).spoken).toBe(`建中靖国元年，1101 年，虚岁六十六，${bar.last.label}。${bar.last.says}。`);
  });

  it('地址里的 ?bar=：none 是不摆；一个整数是摆上、从那一天起；沙盘的替身上不写就不摆', () => {
    expect(barSwitch('')).toEqual({ on: true, day: null });
    expect(barSwitch('?tier=full')).toEqual({ on: true, day: null });
    expect(barSwitch('?bar=none')).toEqual({ on: false, day: null });
    expect(barSwitch('?tier=full&bar=none')).toEqual({ on: false, day: null });
    expect(barSwitch('?bar=0')).toEqual({ on: true, day: 0 });
    expect(barSwitch('?bar=16525')).toEqual({ on: true, day: 16525 });
    expect(barSwitch('?tier=still&bar=23604')).toEqual({ on: true, day: 23604 });
    // 沙盘的替身上（三种写法）：不写就不摆，写了日子才摆。这三个词就是页面认的那三个（src/ui/stageEngineSource.ts）
    const pageSource = new TextDecoder().decode(readBytes('src/ui/stageEngineSource.ts'));
    const pageKnows = /function fakeStageChoice\(\)[^{]*\{[^}]*return ([^;]+);/.exec(pageSource)?.[1].match(/'fake[a-z-]*'/g)?.map((word) => word.slice(1, -1));
    expect([...new Set(pageKnows)].sort()).toEqual([...FAKE_STAGES].sort());
    // 别的词（大写的、多几个字的）页面摆的是真的沙盘：时间轴照真的沙盘上那样，不写也摆
    for (const real of ['FAKE', 'fakery', 'fake-slow', 'real']) expect(barSwitch(`?stage=${real}`), real).toEqual({ on: true, day: null });
    for (const stage of FAKE_STAGES) {
      expect(barSwitch(`?stage=${stage}`), stage).toEqual({ on: false, day: null });
      expect(barSwitch(`?stage=${stage}&bar=none`), stage).toEqual({ on: false, day: null });
      expect(barSwitch(`?stage=${stage}&bar=9697`), stage).toEqual({ on: true, day: 9697 });
    }
    // 不是整数的不认：照没有写算
    for (const odd of ['abc', '12.5', '1.5', '-3', '+3', '3e2', ' 3', '']) {
      expect(barSwitch(`?bar=${odd}`), odd).toEqual({ on: true, day: null });
      expect(barSwitch(`?stage=fake&bar=${odd}`), odd).toEqual({ on: false, day: null });
    }
  });

  it('图例里讲括号的那一句同第一行印出来的对得上：括号里写了月份的那些天只有公历的一月、二月，那一句两个月都说到，不说是农历的哪一个月', () => {
    // 一天一天数过去：括号里写成“某年某月”的，是哪几个月
    const months = new Set<number>();
    for (let day = 0; day <= lastDay; day += 1) {
      const found = /（\d+年(\d+)月）$/u.exec(wordsAt(bar, day).year);
      if (found) months.add(Number(found[1]));
    }
    expect([...months].sort()).toEqual([1, 2]);
    expect(BAR_NOTE_TEXT.west).toContain('农历年底有时已经是公历下一年的一月、二月');
    // 不只是腊月：嘉祐六年十一月十八日已经是 1062 年 1 月 1 日，那一天括号里也是年和月；所以那一句不点哪一个农历月
    expect(wordsAt(bar, (dayOfIso('1062-01-01') as number) - day0).year).toBe('嘉祐六年（1062年1月）');
    expect(wordsAt(bar, (dayOfIso('1060-02-01') as number) - day0).year).toBe('嘉祐四年（1060年2月）');
    expect(BAR_NOTE_TEXT.west).not.toMatch(/腊月|冬月|十一月|十二月/u);
  });

  it('图例里讲圆圈的那一句说了实心的是什么：正文已经写好的站——轴上的圆圈照 stopMarks 的 written 画，written 就是这一站的正文写好了', () => {
    expect(BAR_NOTE_TEXT.discs('八')).toBe('轴上圆圈里的数字是他走过的八站，和题签上的印是同一个数。实心的圆圈，是正文已经写好的站。古名、今名只换题签上的名字，时间轴上写的是当时的名字。');
    // 真的人物：每一站“实心不实心”就是它的正文写好了没有；两样都有（都是实心、都是空心的时候这一句说的东西读者看不到）
    const figure = JSON.parse(new TextDecoder().decode(readBytes('content/figures/su-shi/figure.json'))) as Figure;
    const marks = stopMarks(figure, (id) => `#/su-shi/${id}`);
    const onAxis = [...new Set(bar.stretches.flatMap((stretch) => (stretch.group ? [stretch.group] : [])))];
    expect(onAxis.length).toBeGreaterThan(0);
    for (const id of onAxis) expect(marks[id].written, id).toBe(figure.stops.find((stop) => stop.id === id)?.status === 'complete');
    const filled = onAxis.filter((id) => marks[id].written);
    expect(filled.length).toBeGreaterThan(0);
    expect(filled.length).toBeLessThan(onAxis.length);
    // 轴上的圆圈是照这个 written 画的：TimeBar.tsx 里写着（没写好的带 is-unwritten，样式表把它画成空心）
    const source = new TextDecoder().decode(readBytes('src/timebar/TimeBar.tsx'));
    expect(source).toContain("stop.written ? 'bar-disc' : 'bar-disc is-unwritten'");
    const sheet = new TextDecoder().decode(readBytes('src/styles/timebar.css'));
    expect(/\.bar-disc\.is-unwritten\s*\{[^}]*background:\s*none/u.test(sheet)).toBe(true);
  });

  it('时间轴上用黑体排的固定的字都列进了黑体的那张表（src/ui/text.ts 的 SANS_LABELS）', () => {
    for (const label of BAR_SANS) expect(SANS_LABELS, label).toContain(label);
    const listed = BAR_SANS.join('');
    for (const word of [BAR_TEXT.play, BAR_TEXT.pause, BAR_TEXT.prev, BAR_TEXT.next, BAR_TEXT.note, BAR_TEXT.noteName, BAR_TEXT.close, BAR_TEXT.enter('十'), ageWords(66), ageWords(7), '（1082）']) {
      for (const char of word) expect(listed, `“${word}”里的“${char}”`).toContain(char);
    }
  });
});
