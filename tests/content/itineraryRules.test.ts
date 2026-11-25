// 行迹校验规则自己的测试（itineraryRules.ts）和做文件的工具的测试（tests/support/itineraryTool.ts）。
// 合格的样本就是真的那一份（content/figures/su-shi/itinerary.json，连同人物资料和全程沙盘的场景）：一处问题也没有；
// 再在它的抄本上一次只改坏一处，看是不是正好查出那一处。
// “如实”的五条各有一组：不编日子；第一行只说史料担保得了的；第二行的日子只许删字；路上匀着走、并且说了；沙盘上没有线的地方没有他。
// 每一组里都有“说假话的行迹”：看着像真的、其实多说了一点的（把月份写成哪一天，在日子旁边添一个字，把“二十八日”删成“八日”），都要查得出来。

import { describe, expect, it } from 'vitest';
import type { Itinerary, ItineraryMoment, ItineraryStretch } from '../../src/domain/itinerary';
import type { RouteScene } from '../../src/domain/scene';
import type { Figure } from '../../src/domain/types';
import { barText, boundaryNumbers, dayOfIso, isoOfDay, julianDay, lookOf, lunarYearOf, lunarYears, projectItinerary } from '../support/itineraryTool';
import {
  AFTER_DATE,
  ITINERARY_RULE,
  LABEL_MAX,
  LUNAR_YEAR_DAYS,
  MONTH_MAX_DAYS,
  SAYS_MAX,
  checkItineraryHonesty,
  checkItineraryShape,
  dateTokens,
  isDayText,
  isShortening,
  spotOpening,
  spotTown,
  validateItinerary,
} from './itineraryRules';
import type { ContentFiles, Violation } from './shape';

const texts = import.meta.glob<string>('/content/figures/su-shi/{figure.json,itinerary.json,itinerary.bar.json,scenes/route.json}', { query: '?raw', import: 'default', eager: true });
const DIR = 'figures/su-shi';
const FILE = `${DIR}/itinerary.json`;
const BAR = `${DIR}/itinerary.bar.json`;
const read = (name: string): string => texts[`/content/${DIR}/${name}`];
const FIGURE = JSON.parse(read('figure.json')) as Figure;
const ROUTE = JSON.parse(read('scenes/route.json')) as RouteScene;
const REAL = JSON.parse(read('itinerary.json')) as Itinerary;

/** 真的那一份的一个抄本。 */
const copyOf = (): Itinerary => JSON.parse(read('itinerary.json')) as Itinerary;
/** 抄本里的一段。 */
function stretch(copy: Itinerary, id: string): ItineraryStretch {
  const found = copy.stretches.find((item) => item.id === id);
  if (!found) throw new Error(`没有 ${id} 这一段`);
  return found;
}
/** 改一段的 end：同一个日子在文件里写了两处（这一段的 end、下一段的 start），两处一起改，链还是连着的。 */
function boundary(copy: Itinerary, id: string, change: (moment: ItineraryMoment) => void): void {
  const i = copy.stretches.findIndex((item) => item.id === id);
  change(copy.stretches[i].end);
  if (i + 1 < copy.stretches.length) change(copy.stretches[i + 1].start);
}
/** 校验一个抄本。工具做的那一份照这个抄本重做（不然每一处改动都只会报“那一份旧了”）；keepBar 是留着原来的那一份；route 是换一份全程沙盘的场景。 */
function check(copy: Itinerary, options: { keepBar?: boolean; route?: RouteScene } = {}): Violation[] {
  const route = options.route ?? ROUTE;
  const files: ContentFiles = {
    [`${DIR}/figure.json`]: read('figure.json'),
    [`${DIR}/scenes/route.json`]: options.route ? JSON.stringify(options.route) : read('scenes/route.json'),
    [FILE]: JSON.stringify(copy),
    [BAR]: options.keepBar ? read('itinerary.bar.json') : barText(projectItinerary(copy, route, FIGURE)),
  };
  return validateItinerary(files, DIR, FIGURE);
}
/** 改坏一处以后查出来的话。 */
const problems = (change: (copy: Itinerary) => void, options: { keepBar?: boolean; route?: RouteScene } = {}): string[] => {
  const copy = copyOf();
  change(copy);
  return check(copy, options).map((v) => v.problem);
};
/** 把一段第二行里的一截换掉（saysDates 不动）；找不到那一截就是测试自己写错了。 */
const reword = (id: string, from: string, to: string) => (copy: Itinerary): void => {
  const item = stretch(copy, id);
  if (!item.says.includes(from)) throw new Error(`${id} 的第二行里没有“${from}”`);
  item.says = item.says.replace(from, to);
};
/** 把一段第二行里的一个日子连同 saysDates 里的那一项一起换掉。 */
const redate = (id: string, n: number, from: string, to: string) => (copy: Itinerary): void => {
  const item = stretch(copy, id);
  if (item.saysDates[n].text !== from) throw new Error(`${id} 的 saysDates[${n}] 不是“${from}”`);
  reword(id, from, to)(copy);
  item.saysDates[n].text = to;
};
/** 把一个日子改成“精确到日”：写上公元的月、日，去掉范围；史料的写法不动。 */
const asDay = (month: number, day: number) => (moment: ItineraryMoment): void => {
  Object.assign(moment, { precision: 'day', month, day });
  for (const key of ['earliest', 'latest', 'earliestIs', 'latestIs', 'sharesWindow'] as const) delete moment[key];
};

describe('真的那一份行迹', () => {
  it('格式和规则 22 的十句都通过', () => {
    const found = check(copyOf(), { keepBar: true });
    expect(found.map((v) => `${v.file} › ${v.field}：${v.problem}`)).toEqual([]);
  });

  it('六十一段：头一段从出生那天起，最后一段到去世那天止', () => {
    expect(REAL.stretches).toHaveLength(61);
    const { numbers, problems: unplaced } = boundaryNumbers(REAL);
    expect(unplaced).toEqual([]);
    expect(isoOfDay(numbers[0])).toBe('1037-01-08');
    expect(isoOfDay(numbers[numbers.length - 1])).toBe('1101-08-24');
  });

  it('小像在不在沙盘上：十段在站里，十二段在路上，十八段站在别的有的地方（七段在线上没有立名字的地方），二十一段没有他', () => {
    const looks = REAL.stretches.map(lookOf);
    const many = (look: string): number => looks.filter((item) => item === look).length;
    expect([many('stop'), many('road'), many('quiet'), many('off')]).toEqual([10, 12, 18, 21]);
    const spots = REAL.stretches.filter((item) => item.kind === 'elsewhere' && item.tablePoint.type === 'way-vertex');
    expect(spots.map((item) => item.id)).toEqual(['t09', 't33', 't35', 't45', 't47', 't59', 't61']);
    for (const item of spots) if (item.kind === 'elsewhere') expect(item.says.startsWith(spotOpening(spotTown(item.where))), item.id).toBe(true);
  });

  it('没有一个范围里有正月初一：每一段的头尾都不用挪到新年上', () => {
    const years = lunarYears(REAL);
    for (const item of REAL.stretches) {
      if (item.end.precision === 'day') continue;
      const [a, b] = [dayOfIso(item.end.earliest), dayOfIso(item.end.latest)];
      expect(a !== null && b !== null && lunarYearOf(years, a)?.year === lunarYearOf(years, b)?.year, `${item.id}.end`).toBe(true);
    }
  });

  it('两行字的长度：第一行的“在哪”最多十个字，第二行最多三十二个字', () => {
    expect(Math.max(...REAL.stretches.map((item) => [...item.label].length))).toBeLessThanOrEqual(LABEL_MAX);
    expect(Math.max(...REAL.stretches.map((item) => [...item.says].length))).toBe(SAYS_MAX);
  });
});

describe('格式', () => {
  it('不认识的字段、不认识的精度、不认识的 tablePoint 通不过', () => {
    const wrong = (change: (data: Record<string, unknown>) => void): string[] => {
      const data = JSON.parse(read('itinerary.json')) as Record<string, unknown>;
      change(data);
      return checkItineraryShape(data, FILE).map((v) => `${v.field}：${v.problem}`);
    };
    const first = (data: Record<string, unknown>, i: number): Record<string, unknown> => (data.stretches as Record<string, unknown>[])[i];
    expect(wrong((data) => (first(data, 0).form = 'x'))).toEqual([expect.stringContaining('stretches[0].form：不认识这个字段')]);
    expect(wrong((data) => ((first(data, 0).end as Record<string, unknown>).precision = 'week'))).toEqual([expect.stringContaining('stretches[0].end.precision：只能是 day 或')]);
    expect(wrong((data) => ((first(data, 8).tablePoint as Record<string, unknown>).type = 'nearby'))).toEqual([expect.stringContaining('stretches[8].tablePoint.type：只能是')]);
    expect(wrong((data) => (first(data, 0).stopYearsOf = 3))).toEqual([expect.stringContaining('不在哪一站讲的年月里写 null')]);
  });

  it('格式不对的时候别的先不查，记在规则 0 上', () => {
    const copy = copyOf();
    (copy.stretches[0] as unknown as Record<string, unknown>).label = 5;
    const found = check(copy);
    expect(found.map((v) => v.rule)).toEqual([0]);
  });
});

describe('如实一：不编日子', () => {
  it('只查到月份的日子写了 month、day：通不过', () => {
    expect(problems((copy) => boundary(copy, 't31', (moment) => Object.assign(moment, { month: 5, day: 8 })))).toEqual([expect.stringContaining('不能写 month、day：不编日子')]);
  });

  it('范围只写了一头：通不过（程序从不拿前后的日子替它补）', () => {
    const found = problems((copy) => boundary(copy, 't31', (moment) => delete moment.latest));
    expect(found).toContainEqual(expect.stringContaining('范围没有写全'));
    expect(found).toContainEqual(expect.stringContaining('范围的两头都要写；这一头没有写'));
  });

  it('“月”的范围 60 天可以，61 天不行；范围只有一天的该写成 day', () => {
    // t31.end 是“元丰七年四月”：1084-05-08 到 05-31
    expect(problems((copy) => boundary(copy, 't31', (moment) => (moment.earliest = isoOfDay((dayOfIso('1084-05-31') ?? 0) - (MONTH_MAX_DAYS - 1)))))).toEqual([]);
    expect(problems((copy) => boundary(copy, 't31', (moment) => (moment.earliest = isoOfDay((dayOfIso('1084-05-31') ?? 0) - MONTH_MAX_DAYS))))).toEqual([expect.stringContaining(`范围却有 ${MONTH_MAX_DAYS + 1} 天`)]);
    expect(problems((copy) => boundary(copy, 't31', (moment) => (moment.earliest = '1084-05-31')))).toContainEqual(expect.stringContaining('范围只有一天'));
  });

  it('历法上没有的一天、写法不对的日子：通不过', () => {
    expect(problems((copy) => boundary(copy, 't30', (moment) => (moment.day = 30)))).toContainEqual(expect.stringContaining('历法上没有这一天'));
    expect(problems((copy) => boundary(copy, 't31', (moment) => (moment.latest = '1084-5-31')))).toContainEqual(expect.stringContaining('不是一个日子'));
  });

  it('isDayText：写法自己说到了哪一天、别的什么也不带，才算', () => {
    for (const written of ['元丰三年二月一日', '元丰三年正月初一', '熙宁六年除夜', '熙宁七年元日', '建中靖国元年七月二十八日', '元祐六年闰八月二十二日', '元丰七年十一月晦日']) expect(isDayText(written), written).toBe(true);
    for (const written of ['元丰七年四月', '嘉祐元年春', '嘉祐二年，月日没有查到', '嘉祐二年四月八日以后', '熙宁七年冬，三日', '元祐六年八月或闰八月的二十二日', '元祐六年三月，九日到十九日之间', '二月一日', '元丰三年二月一日前后']) expect(isDayText(written), written).toBe(false);
    expect(dateTokens('嘉祐六年十一月，十九日以前').map((token) => `${token.kind}:${token.text}`)).toEqual(['era:嘉祐', 'year:六年', 'month:十一月', 'other:，', 'day:十九日', 'kept:以前']);
  });

  it('真的那一份里，精确到日的每一个日子，史料的写法都说到了哪一天；别的日子都没有', () => {
    const all = REAL.stretches.flatMap((item, i) => [...(i === 0 ? [item.start] : []), item.end, ...(item.waypoints ?? []).flatMap((point) => (point.date ? [point.date] : []))]);
    for (const moment of all) expect(isDayText(moment.text), moment.text).toBe(moment.precision === 'day');
  });

  it('把精度改成 day、编出一个公元的月日，史料的写法却只到月份、季节、“没有查到”：通不过', () => {
    const refused = expect.stringContaining('史料的写法里没有说到哪一天');
    // 只查到月份的（元丰七年四月）
    expect(problems((copy) => boundary(copy, 't31', asDay(5, 20)))).toContainEqual(refused);
    // 只查到季节的（嘉祐元年春）
    expect(problems((copy) => boundary(copy, 't01', asDay(3, 1)))).toContainEqual(refused);
    // 没有查到的（嘉祐二年，月日没有查到）
    expect(problems((copy) => { boundary(copy, 't04', asDay(9, 1)); boundary(copy, 't03', (moment) => { delete moment.sharesWindow; moment.latest = '1057-08-31'; }); })).toContainEqual(refused);
    // 路上只知道月份的一处（唐州，嘉祐五年正月）：改成 day 就会把路切开，小像那一天就钉在那里
    expect(problems((copy) => { const point = stretch(copy, 't06').waypoints?.find((item) => item.name === '唐州'); if (point?.date) asDay(2, 15)(point.date); })).toContainEqual(refused);
  });

  it('史料的写法已经说到了哪一天，精度却不写 day：通不过', () => {
    expect(problems((copy) => boundary(copy, 't31', (moment) => (moment.text = '元丰七年四月八日')))).toContainEqual(expect.stringContaining('知道是哪一天，精度就写 day'));
  });
});

describe('如实二：第一行只说史料担保得了的', () => {
  it('一个范围里有两个正月初一：说不出是哪一年的事，通不过', () => {
    expect(problems((copy) => boundary(copy, 't12', (moment) => (moment.latest = '1069-02-10')))).toContainEqual(expect.stringContaining('里有两个正月初一'));
  });

  it('共用的范围里有正月初一：通不过；范围一样却没有写谁先谁后：通不过', () => {
    const later = (copy: Itinerary): void => {
      boundary(copy, 't03', (moment) => (moment.latest = '1058-02-10'));
      boundary(copy, 't04', (moment) => (moment.latest = '1058-02-10'));
    };
    expect(problems(later)).toContainEqual(expect.stringContaining('共用的范围里有一个正月初一（嘉祐三年）'));
    expect(problems((copy) => boundary(copy, 't23', (moment) => delete moment.sharesWindow))).toContainEqual(expect.stringContaining('两个都要写 sharesWindow'));
  });

  it('范围里有一个正月初一的，头尾放在那个正月初一上：第一行说的年份还是担保得了的', () => {
    // t12.end 的范围放宽到跨过熙宁元年的正月初一（1068-02-06）
    const copy = copyOf();
    boundary(copy, 't12', (moment) => Object.assign(moment, { earliest: '1067-06-01', latest: '1068-03-01' }));
    const { numbers } = boundaryNumbers(copy);
    const i = copy.stretches.findIndex((item) => item.id === 't12');
    expect(isoOfDay(numbers[i + 1])).toBe('1068-02-06');
    expect(checkItineraryHonesty(copy, FILE)).toEqual([]);
    // 要是放在范围的正中间，第一行就会说出一个史料担保不了的年份：这一句查得出来
    const doctored = numbers.slice();
    doctored[i + 1] += 20;
    expect(checkItineraryHonesty(copy, FILE, doctored).map((v) => v.problem)).toEqual([expect.stringContaining('时间轴第一行会说“熙宁元年　回眉州的路上”，可这一段也许那一年以前就结束了')]);
  });

  it('第一行的“在哪”说的不是数据里的那个地方：通不过', () => {
    expect(problems((copy) => (stretch(copy, 't31').label = '在杭州'))).toEqual([expect.stringContaining('里没有“黄州”')]);
    expect(problems((copy) => (stretch(copy, 't30').label = '去杭州的路上'))).toEqual([expect.stringContaining('里没有“黄州”')]);
    expect(problems((copy) => (stretch(copy, 't09').label = '在外地做官'))).toEqual([expect.stringContaining('里没有“凤翔”')]);
  });

  it('“在哪”十一个字：通不过；落在一站讲的年月里的八个字：通不过', () => {
    expect(problems((copy) => (stretch(copy, 't32').label = '离开黄州以后在路上走'))).toEqual([]);
    expect(problems((copy) => (stretch(copy, 't32').label = '离开黄州以后在路上走着'))).toEqual([expect.stringContaining('有 11 个字，最多 10 个')]);
    expect(problems((copy) => (stretch(copy, 't28').label = '被押回汴京的路上'))).toEqual([expect.stringContaining('有 8 个字，最多 7 个')]);
  });

  it('最前、最后一个位置的“在哪”说的不是头一段、最后一段的那个地方：通不过', () => {
    expect(problems((copy) => (copy.first.label = '生在成都'))).toEqual([expect.stringContaining('里没有“眉州”')]);
    expect(problems((copy) => (copy.last.label = '在杭州去世'))).toEqual([expect.stringContaining('里没有“常州”')]);
  });

  it('“在哪”里写了日子：通不过（第一行的年份是程序照表写的）', () => {
    expect(problems((copy) => (stretch(copy, 't31').label = '在黄州四年'))).toEqual([expect.stringContaining('“在哪”里有像日子的字眼（四年）')]);
  });

  it('农历年的表：一年只能是 353、354、355、383、384、385 天；真的那一份里只有 354、355、383、384、385', () => {
    const firsts = REAL.years.map((row) => dayOfIso(row.newYear));
    const lengths = new Set(firsts.slice(2).map((first, i) => (first ?? 0) - (firsts[i + 1] ?? 0)));
    expect([...lengths].sort()).toEqual([354, 355, 383, 384, 385]);
    expect(LUNAR_YEAR_DAYS).toEqual([353, 354, 355, 383, 384, 385]);
    // 宝元元年的正月初一早写 12 天：前后两年成了 372 天、366 天，在旧的规则（353 到 385 天）里是过得去的
    expect(problems((copy) => (copy.years[2].newYear = '1038-01-26'))).toEqual([expect.stringContaining('有 372 天'), expect.stringContaining('有 366 天')]);
  });

  it('精确到日的写法里的月、日，和它的公元日子对不上：通不过（正月的日子、除夜没有余地）', () => {
    // 元丰八年正月四日是 1085-02-01（正月初一 01-29）；写成 02-03 就是第 6 天
    expect(problems((copy) => boundary(copy, 't33', (moment) => (moment.day = 3)))).toContainEqual(expect.stringContaining('是元丰八年的第 6 天，该是第 4 天'));
    // 熙宁六年除夜是 1074-01-29（熙宁七年的正月初一是 01-30）
    expect(problems((copy) => { const point = stretch(copy, 't18').waypoints?.find((item) => item.name === '常州城外'); if (point?.date) point.date.day = 28; })).toContainEqual(expect.stringContaining('除夜是这一年的最后一天（1074-01-29）'));
    // 表里的正月初一晚写一天（前后两年还是 355 天、383 天，长短上看不出来）：落在这一年正月里的日子就对不上了
    const shifted = problems((copy) => (copy.years[44].newYear = '1080-01-26'));
    expect(shifted).toContainEqual(expect.stringContaining('“元丰三年正月十四日”写的月、日，和它的公元日子对不上：1080-02-07 照 years 表是元丰三年的第 13 天，该是第 14 天'));
    expect(shifted).toContainEqual(expect.stringContaining('“元丰三年正月初一”写的是元丰三年，照它的公元日子（1080-01-25）在 years 表里查到的是元丰二年'));
  });

  it('农历年的表：一年的长短不对、年名接不上、虚岁没有加一、日子的年号和表对不上，都通不过', () => {
    expect(problems((copy) => (copy.years[45].newYear = '1081-03-20'))).toContainEqual(expect.stringContaining('一个农历年只能是 353、354、355、383、384、385 天'));
    expect(problems((copy) => (copy.years[45].name = '元丰五年'))).toContainEqual(expect.stringContaining('同一个年号接着数，换了年号从元年起'));
    expect(problems((copy) => (copy.years[45].age = 47))).toContainEqual(expect.stringContaining('每过一个农历新年加一岁'));
    expect(problems((copy) => boundary(copy, 't30', (moment) => (moment.text = '元丰四年二月一日')))).toContainEqual(expect.stringContaining('在 years 表里查到的是元丰三年'));
  });

  it('住在一站的年月伸到这一站发布的年份外面：通不过', () => {
    // 黄州发布的是 1080–1084；把离开黄州的范围挪到元丰八年
    const found = problems((copy) => boundary(copy, 't31', (moment) => Object.assign(moment, { text: '元丰八年四月', year: 1085, earliest: '1085-04-28', latest: '1085-05-26' })));
    expect(found).toContainEqual(expect.stringContaining('这一站发布的年份是 1080–1084'));
  });
});

describe('如实三：第二行的日子只许照史料的写法删字', () => {
  it('isShortening：删字可以，添字、换字不行，“以前、以后、或、之间、初”不许删', () => {
    expect(isShortening('元丰七年四月', '元丰七年四月')).toBe(true);
    expect(isShortening('四月', '元丰七年四月')).toBe(true);
    expect(isShortening('五年春', '嘉祐五年春')).toBe(true);
    expect(isShortening('元丰七年四月八日', '元丰七年四月')).toBe(false);
    expect(isShortening('元丰七年五月', '元丰七年四月')).toBe(false);
    expect(isShortening('嘉祐二年四月八日', '嘉祐二年四月八日以后')).toBe(false);
    expect(isShortening('四月或五月', '元祐六年四月或五月')).toBe(true);
    expect(isShortening('四月', '元祐六年四月或五月')).toBe(false);
    expect(isShortening('七月初', '元符三年七月初，四日以前')).toBe(true);
    // 只碰到前一个半句的，后一个半句里的“以前”不用带
    expect(isShortening('元丰七年冬', '元丰七年冬，十一月晦日以前')).toBe(true);
    expect(isShortening('十一月晦日', '元丰七年冬，十一月晦日以前')).toBe(false);
  });

  it('isShortening 照一截一截比：数字连着它的单位是一截，“二十八日”删不成“八日”，“十二月”删不成“二月”', () => {
    expect(isShortening('七月二十八日', '元丰二年七月二十八日')).toBe(true);
    expect(isShortening('七月八日', '元丰二年七月二十八日')).toBe(false);
    expect(isShortening('元丰二年八月十日', '元丰二年八月十八日')).toBe(false);
    expect(isShortening('熙宁九年二月', '熙宁九年十二月')).toBe(false);
    expect(isShortening('熙宁元年十月六日以后', '熙宁元年十月二十六日以后')).toBe(false);
    expect(isShortening('嘉祐六年十一日以前', '嘉祐六年十一月，十九日以前')).toBe(false);
    expect(isShortening('元丰八年一月或二月', '元丰八年十一月或十二月')).toBe(false);
    // 年号留着，它后面的“第几年”也要留着；只留“第几年”可以
    expect(isShortening('元丰三月', '元丰二年三月')).toBe(false);
    expect(isShortening('二年三月', '元丰二年三月')).toBe(true);
    // 史料的写法分两个半句的，接起来说可以
    expect(isShortening('嘉祐六年十一月十九日以前', '嘉祐六年十一月，十九日以前')).toBe(true);
    expect(isShortening('元祐六年三月九日到十九日之间', '元祐六年三月，九日到十九日之间')).toBe(true);
  });

  it('句子里把一个日子里的数字删掉几个字，成了另一个日子：通不过', () => {
    const refused = [expect.stringContaining('只许整截地删')];
    expect(problems(redate('t27', 1, '七月二十八日', '七月八日'))).toEqual(refused);
    expect(problems(redate('t29', 0, '元丰二年八月十八日', '元丰二年八月十日'))).toEqual(refused);
    expect(problems(redate('t21', 1, '熙宁九年十二月', '熙宁九年二月'))).toEqual(refused);
    expect(problems(redate('t13', 1, '熙宁元年十月二十六日以后', '熙宁元年十月六日以后'))).toEqual(refused);
    expect(problems(redate('t07', 1, '嘉祐六年十一月十九日以前', '嘉祐六年十一日以前'))).toEqual(refused);
    expect(problems(redate('t38', 0, '元丰八年十一月或十二月', '元丰八年一月或二月'))).toEqual(refused);
  });

  it('在一个日子旁边添字（saysDates 不动）：通不过——“四月初”“四月底”“四月上旬”“四月以前”“四月初八”“四月8日”“四月寒食”“二月一日前后”“十二月冬至”“四月（1084）”', () => {
    const beside = (added: string): string[] => problems(reword('t31', '元丰七年四月离开', `元丰七年四月${added}离开`));
    for (const added of ['初', '底', '上旬', '以前', '初八', '8日', '寒食', '（1084）']) expect(beside(added), added).toContainEqual(expect.stringContaining('“元丰七年四月”后面紧挨着'));
    expect(problems(reword('t31', '元丰三年二月一日到', '元丰三年二月一日前后到'))).toEqual([expect.stringContaining('“元丰三年二月一日”后面紧挨着“前”')]);
    expect(problems(reword('t21', '熙宁九年十二月离开', '熙宁九年十二月冬至离开'))).toContainEqual(expect.stringContaining('“熙宁九年十二月”后面紧挨着“冬”'));
    expect(problems(reword('t45', '元祐六年八月或闰八月到', '元祐六年八月或闰八月初到'))).toEqual([expect.stringContaining('后面紧挨着“初”')]);
    expect(problems(reword('t31', '元丰三年二月一日到', '约元丰三年二月一日到'))).toEqual([expect.stringContaining('前面紧挨着“约”')]);
    // 日子落在句子的末尾：后面的字被删掉了，也算
    expect(problems((copy) => (stretch(copy, 't21').says = '熙宁七年冬到；离开在熙宁九年十二月'))).toEqual([expect.stringContaining('后面紧挨着“（句子完了）”')]);
  });

  it('真的那一份里，每一个日子后面紧挨着的字都在单子上', () => {
    for (const item of REAL.stretches) {
      let from = 0;
      for (const entry of item.saysDates) {
        const found = item.says.indexOf(entry.text, from);
        expect(found, `${item.id} ${entry.text}`).toBeGreaterThanOrEqual(0);
        expect(AFTER_DATE.includes(item.says.charAt(found + entry.text.length)), `${item.id} ${entry.text}`).toBe(true);
        from = found + entry.text.length;
      }
    }
  });

  it('句子里多出一个 saysDates 没有列的日子：通不过（写成“八日”“初八”“8”“上旬”“寒食”都一样）', () => {
    expect(problems(reword('t31', '元丰七年四月离开', '元丰七年四月八日离开'))).toContainEqual(expect.stringContaining('有 saysDates 没有列的日子：八日'));
    expect(problems(reword('t40', '；途中没有日子', '；六月初十过扬州'))).toEqual([expect.stringContaining('有 saysDates 没有列的日子：六月、初十')]);
    expect(problems(reword('t40', '；途中没有日子', '；中秋在扬州'))).toEqual([expect.stringContaining('有 saysDates 没有列的日子：中秋')]);
    expect(problems(reword('t40', '；途中没有日子', '；夏天过扬州'))).toEqual([expect.stringContaining('有 saysDates 没有列的日子：夏')]);
  });

  it('saysDates 照日子的先后列，句子里也照这个先后说：把到的日子、离开的日子对调，通不过', () => {
    // 句子里对调了，saysDates 没有动
    expect(problems((copy) => (stretch(copy, 't31').says = '元丰七年四月到，元丰三年二月一日离开'))).toContainEqual(expect.stringContaining('第二行里没有“元丰七年四月”（先后要和句子里一样'));
    // 句子里对调了，saysDates 也跟着对调
    expect(problems((copy) => { const item = stretch(copy, 't31'); item.says = '元丰七年四月到，元丰三年二月一日离开'; item.saysDates.reverse(); })).toEqual([expect.stringContaining('saysDates 要照日子的先后列')]);
  });

  it('最后一个位置的句子里的日子、岁数也查：日子对着最后一段的 end，“虚岁多少”对着 years 表的最后一年', () => {
    expect(REAL.last.saysDates).toEqual([{ of: 'end', text: '七月二十八日' }]);
    expect(problems((copy) => { copy.last.says = copy.last.says.replace('七月二十八日', '七月二十九日'); copy.last.saysDates[0].text = '七月二十九日'; })).toEqual([expect.stringContaining('不是照史料的写法“建中靖国元年七月二十八日”缩短来的')]);
    expect(problems((copy) => (copy.last.says = copy.last.says.replace('七月二十八日', '七月二十九日')))).toContainEqual(expect.stringContaining('第二行里没有“七月二十八日”'));
    expect(problems((copy) => (copy.last.says = copy.last.says.replace('虚岁六十六', '虚岁六十七')))).toEqual([expect.stringContaining('years 表最后一年（建中靖国元年）写的是 66 岁')]);
    expect(problems((copy) => (copy.first.saysDates = [{ of: 'end', text: '七月二十八日' }]))).toContainEqual(expect.stringContaining('最前一个位置的 saysDates 只能指 start'));
  });

  it('列出来的日子比史料细（删了“以后”）、换了字：通不过', () => {
    expect(problems((copy) => { const item = stretch(copy, 't03'); item.says = item.says.replace('嘉祐二年四月八日以后', '嘉祐二年四月八日'); item.saysDates[1].text = '嘉祐二年四月八日'; })).toEqual([expect.stringContaining('不是照史料的写法“嘉祐二年四月八日以后”缩短来的')]);
    expect(problems((copy) => { const item = stretch(copy, 't25'); item.says = item.says.replace('元丰二年三月', '元丰二年四月'); item.saysDates[1].text = '元丰二年四月'; })).toEqual([expect.stringContaining('不是照史料的写法“元丰二年三月”缩短来的')]);
  });

  it('第二行三十三个字：通不过', () => {
    // t53 的这一句是二十一个字，后面再接十二个
    expect(problems((copy) => { const item = stretch(copy, 't53'); item.says = `${item.says}，后来又被贬到海南那边去`; })).toEqual([expect.stringContaining(`有 ${SAYS_MAX + 1} 个字，最多 ${SAYS_MAX} 个`)]);
  });

  it('程序不拼句子：工具做的那一份里，两行字和手写的一字不差', () => {
    const bar = projectItinerary(REAL, ROUTE, FIGURE);
    expect(bar.stretches.map((item) => [item.id, item.label, item.says])).toEqual(REAL.stretches.map((item) => [item.id, item.label, item.says]));
    expect(bar.first).toEqual({ label: REAL.first.label, says: REAL.first.says });
    expect(bar.last).toEqual({ label: REAL.last.label, says: REAL.last.says });
  });
});

describe('如实四：两个有日子的地方之间匀着走，第二行说了', () => {
  it('路上的一句不以“匀着走的：”开头：通不过', () => {
    expect(problems((copy) => { const item = stretch(copy, 't30'); item.says = item.says.replace('匀着走的：', ''); })).toEqual([expect.stringContaining('第二行要以“匀着走的：”开头')]);
  });

  it('只有精确到日、又有位置的地方把路切开：十二段路里七段有，一共十四处', () => {
    const legs = projectItinerary(REAL, ROUTE, FIGURE).stretches.filter((item) => item.legs).map((item) => `${item.id}:${item.legs?.length}`);
    expect(legs).toEqual(['t06:1', 't16:2', 't22:2', 't26:1', 't30:2', 't52:4', 't54:2']);
  });

  it('路上一处的日子比前一处还早、落在这一段的头尾外面：通不过', () => {
    const move = (day: number) => (copy: Itinerary): void => {
      const point = stretch(copy, 't30').waypoints?.find((item) => item.name === '蔡州道上');
      if (point?.date) point.date.day = day;
    };
    expect(problems(move(3))).toContainEqual(expect.stringContaining('比前一处还早：小像走不到那里'));
    expect(problems(move(28))).toContainEqual(expect.stringContaining('不在这一段的日子里'));
  });

  it('路上有位置的一处离线太远、先后和走的方向反了：通不过', () => {
    const at = (name: string, to: [number, number]) => (copy: Itinerary): void => {
      const point = stretch(copy, 't30').waypoints?.find((item) => item.name === name);
      if (point) point.at = to;
    };
    expect(problems(at('蔡州道上', [116.5, 33.0]))).toContainEqual(expect.stringContaining('不能超过 25 公里'));
    expect(problems(at('岐亭', [114.6, 34.3]))).toContainEqual(expect.stringContaining('在线上却比它靠前'));
  });

  it('一趟路的各截要和全程沙盘里的一样：少走一截、类别写错，都通不过', () => {
    expect(problems((copy) => { const item = stretch(copy, 't30'); if (item.kind === 'road') item.parts[0].ways.pop(); })).toContainEqual(expect.stringContaining('只走了一部分的写 partial'));
    expect(problems((copy) => { const item = stretch(copy, 't30'); if (item.kind === 'road') item.parts[0].class = 'schematic'; })).toContainEqual(expect.stringContaining('实线、虚线要和沙盘上画的一样'));
  });

  it('在路上的一段，到的日子不精确到日、又超过 93 天，没有写 longRoad：通不过', () => {
    expect(problems((copy) => delete stretch(copy, 't06').longRoad)).toEqual([expect.stringContaining('超过 93 天的要写 longRoad')]);
  });
});

describe('如实五：沙盘上没有线的地方，没有他；有他的地方，不说没有他', () => {
  it('不在线上的地方写成“在线上”：通不过', () => {
    const found = problems((copy) => { const item = stretch(copy, 't37'); if (item.kind === 'elsewhere') item.tablePoint = { type: 'way-vertex', way: 'w-haizhou-mizhou', at: [120.75, 37.81] }; });
    expect(found).toContainEqual(expect.stringMatching(/离路“w-haizhou-mizhou”有 \d+ 公里，不能超过 15 公里/));
  });

  it('沙盘上没有他的一段，第二行头一个半句没有说：通不过', () => {
    expect(problems((copy) => { const item = stretch(copy, 't56'); item.says = item.says.replace('这一趟没有画，沙盘上没有他。', ''); })).toEqual([expect.stringContaining('头一个半句里要说“沙盘上没有他”')]);
  });

  it('站在线上没有立名字的地方的七段：还说“没有标出，沙盘上没有他”的通不过，开头不是“沙盘上没有立某地的名字。”的通不过', () => {
    const found = problems((copy) => { const item = stretch(copy, 't09'); item.says = item.says.replace('沙盘上没有立凤翔的名字。', '凤翔没有标出，沙盘上没有他。'); });
    expect(found).toHaveLength(2);
    expect(found).toContainEqual(expect.stringContaining('不能说“没有他”“没有标出”'));
    expect(found).toContainEqual(expect.stringContaining('要以“沙盘上没有立凤翔的名字。”开头'));
  });

  it('全程沙盘上后来立了那个地方的名字，行迹里还说“沙盘上没有立它的名字”：通不过', () => {
    // 全程沙盘添一个地名点“常州”和它的题签（往北回去的那一趟画上以后就会有）；行迹一个字不动
    const route = JSON.parse(read('scenes/route.json')) as RouteScene;
    const huzhou = route.places.find((place) => place.id === 'huzhou');
    if (!huzhou) throw new Error('全程沙盘里没有湖州这个地名点');
    route.places.push({ ...huzhou, id: 'changzhou', name: '常州', at: [119.97, 31.81] });
    route.strips.push({ id: 's-changzhou', text: '常州', of: 'changzhou', side: 'left' });
    const found = check(copyOf(), { route }).map((v) => `${v.field}：${v.problem}`);
    expect(found).toHaveLength(2);
    expect(found[0]).toContain('stretches[34].tablePoint.type：全程沙盘上已经立了“常州”的题签（s-changzhou）');
    expect(found[1]).toContain('stretches[60].tablePoint.type：全程沙盘上已经立了“常州”的题签（s-changzhou）');
    // 题签只写了今名的也算
    route.strips[route.strips.length - 1] = { id: 's-changzhou', text: '毗陵', modern: '常州', of: 'changzhou', side: 'left' };
    expect(check(copyOf(), { route })).toHaveLength(2);
  });

  it('工具做的那一份里：没有他的二十一段不带位置；有他的各段正好带一样（地名点、线上的一处，或者走的路）', () => {
    for (const item of projectItinerary(REAL, ROUTE, FIGURE).stretches) {
      const where = [item.place, item.spot, item.ways].filter((value) => value !== undefined).length;
      expect(where, item.id).toBe(item.look === 'off' ? 0 : 1);
    }
  });

  it('地名点、路、题签的 id 写错：通不过', () => {
    expect(problems((copy) => { const item = stretch(copy, 't31'); if (item.kind === 'stop') item.place = 'hangzhou'; })).toContainEqual(expect.stringContaining('小像会站到别的站上去'));
    expect(problems((copy) => { const item = stretch(copy, 't09'); if (item.kind === 'elsewhere' && item.tablePoint.type === 'way-vertex') item.tablePoint.way = 'w-none'; })).toContainEqual(expect.stringContaining('在全程沙盘的 roads.ways 里找不到'));
    expect(problems((copy) => { const item = stretch(copy, 't51'); if (item.kind === 'elsewhere' && item.tablePoint.type === 'edge-strip') item.tablePoint.strip = 's-bianjing'; })).toContainEqual(expect.stringContaining('指的不是远处的地方'));
  });
});

describe('链、出处、站', () => {
  it('一段的 start 不是上一段的 end：通不过', () => {
    expect(problems((copy) => (stretch(copy, 't31').start.text = '元丰三年二月二日'))).toContainEqual(expect.stringContaining('不是同一个日子'));
  });

  it('一段没有出处、出处找不到：通不过', () => {
    expect(problems((copy) => (stretch(copy, 't31').sourceIds = []))).toEqual([expect.stringContaining('没有出处')]);
    expect(problems((copy) => stretch(copy, 't31').sourceIds.push('nobody'))).toEqual([expect.stringContaining('在 sources 里找不到')]);
  });

  it('落在一站讲的年月里的各段没有连在一起：通不过', () => {
    expect(problems((copy) => (stretch(copy, 't18').stopYearsOf = null))).toContainEqual(expect.stringContaining('没有连在一起'));
  });
});

describe('时间轴用的那一份（工具做的）', () => {
  it('仓库里的那一份就是工具现在做出来的', () => {
    expect(read('itinerary.bar.json')).toBe(barText(projectItinerary(REAL, ROUTE, FIGURE)));
  });

  it('工具做的那一份带着人物的名字，就是 figure.json 的 name', () => {
    expect(projectItinerary(REAL, ROUTE, FIGURE).name).toBe(FIGURE.name);
    expect(Object.keys(JSON.parse(read('itinerary.bar.json')) as Record<string, unknown>)).toEqual(['day0', 'name', 'years', 'first', 'last', 'stretches']);
  });

  it('手写的那一份改了、那一份没有重做：通不过，话里说运行哪一条命令', () => {
    const found = problems((copy) => (stretch(copy, 't31').label = '住在黄州'), { keepBar: true });
    expect(found).toEqual([expect.stringContaining('运行 npm run itinerary 重做')]);
  });

  it('没有那一份：通不过；没有全程沙盘的人物有行迹：通不过', () => {
    const files: ContentFiles = { [`${DIR}/figure.json`]: read('figure.json'), [`${DIR}/scenes/route.json`]: read('scenes/route.json'), [FILE]: read('itinerary.json') };
    expect(validateItinerary(files, DIR, FIGURE).map((v) => [v.rule, v.file])).toEqual([[ITINERARY_RULE, BAR]]);
    const { [`${DIR}/scenes/route.json`]: _route, ...withoutRoute } = files;
    expect(validateItinerary(withoutRoute, DIR, FIGURE).map((v) => v.file)).toEqual([FILE]);
    const { [FILE]: _itinerary, ...withoutItinerary } = files;
    expect(validateItinerary(withoutItinerary, DIR, FIGURE).map((v) => v.problem)).toEqual([expect.stringContaining('有全程沙盘的人物要有行迹')]);
  });

  it('日子换算：儒略历的一天是第几天，来回换不走样；出生那天是第 0 天，去世那天是第 23,604 天', () => {
    expect(julianDay(1101, 8, 24) - julianDay(1037, 1, 8)).toBe(23604);
    for (const written of ['1037-01-08', '1080-01-25', '1084-02-29', '1100-12-31']) expect(isoOfDay(dayOfIso(written) ?? NaN)).toBe(written);
    expect(dayOfIso('1083-02-29')).toBeNull();
    expect(dayOfIso('1084-5-8')).toBeNull();
    const bar = projectItinerary(REAL, ROUTE, FIGURE);
    expect(bar.day0).toBe('1037-01-08');
    expect(bar.stretches[bar.stretches.length - 1].until).toBe(23604);
    expect(bar.years[0]).toEqual([1036, '景祐三年', null, 1]);
    expect(bar.years[bar.years.length - 1]).toEqual([1101, '建中靖国元年', 23399, 66]);
  });

  it('头尾放在哪一天的四步：精确到日的就是那一天；共用范围的排在三分之一、三分之二处；别的在正中间', () => {
    const { numbers } = boundaryNumbers(REAL);
    const end = (id: string): number => numbers[REAL.stretches.findIndex((item) => item.id === id) + 1];
    expect(isoOfDay(end('t30'))).toBe('1080-02-24');
    // t03、t04 共用 1057-05-14 到 1058-01-26（257 天）
    const [lo, hi] = [dayOfIso('1057-05-14') ?? 0, dayOfIso('1058-01-26') ?? 0];
    expect(end('t03')).toBeCloseTo(lo + (hi - lo) / 3, 6);
    expect(end('t04')).toBeCloseTo(lo + ((hi - lo) * 2) / 3, 6);
    // t31.end：1084-05-08 到 05-31 的正中间
    expect(end('t31')).toBe(((dayOfIso('1084-05-08') ?? 0) + (dayOfIso('1084-05-31') ?? 0)) / 2);
  });

  it('目录里的两种字只在是真话的地方有：住在一站的各段是“他在这儿”，到这一站去的路是“正往这儿走”，别的不写', () => {
    const bar = projectItinerary(REAL, ROUTE, FIGURE);
    expect(bar.stretches.filter((item) => item.mark === 'here').map((item) => item.id)).toEqual(['t05', 't17', 't19', 't21', 't25', 't29', 't31', 't41', 't53', 't55']);
    expect(bar.stretches.filter((item) => item.mark === 'coming').map((item) => item.id)).toEqual(['t16', 't20', 't24', 't28', 't30', 't40', 't52']);
  });
});
