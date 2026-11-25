// 行迹校验规则自己的测试（itineraryRules.ts）和做文件的工具的测试（tests/support/itineraryTool.ts）。
// 合格的样本就是真的那一份（content/figures/su-shi/itinerary.json，连同人物资料和全程沙盘的场景）：一处问题也没有；
// 再在它的抄本上一次只改坏一处，看是不是正好查出那一处。
// “如实”的五条各有一组：不编日子；第一行只说史料担保得了的；第二行的日子只许删字；路上匀着走、并且说了；沙盘上没有线的地方没有他。
// 每一组里都有“说假话的行迹”：看着像真的、其实多说了一点的（把月份写成哪一天，在日子旁边添一个字，把“二十八日”删成“八日”），都要查得出来。

import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { Itinerary, ItineraryMoment, ItineraryStretch } from '../../src/domain/itinerary';
import type { RouteScene } from '../../src/domain/scene';
import { routeCoords } from '../../src/domain/sceneGeoRoute';
import type { Figure } from '../../src/domain/types';
import { stretchIndexAt } from '../../src/timebar/barWhere';
import { wordsAt } from '../../src/timebar/barWords';
import { barText, boundaryNumbers, dayOfIso, doubtCarrier, earliestOf, isoOfDay, julianDay, latestOf, lookOf, lunarYearOf, lunarYears, projectItinerary, unsureOf, westernMonths } from '../support/itineraryTool';
import {
  AFTER_DATE,
  DOUBT_WORDS,
  ITINERARY_RULE,
  LABEL_MAX,
  LUNAR_YEAR_DAYS,
  MONTH_MAX_DAYS,
  SAYS_MAX,
  UNSURE_MIN_HAN,
  checkItineraryHonesty,
  checkItineraryShape,
  dateTokens,
  isDayText,
  isShortening,
  spotTown,
  validateItinerary,
} from './itineraryRules';
import { RULE_NAMES, formatViolation, validateFigure } from './rules';
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
  const files: ContentFiles = {
    [`${DIR}/figure.json`]: read('figure.json'),
    [`${DIR}/scenes/route.json`]: options.route ? JSON.stringify(options.route) : read('scenes/route.json'),
    [FILE]: JSON.stringify(copy),
    [BAR]: options.keepBar ? read('itinerary.bar.json') : barText(projectItinerary(copy, FIGURE)),
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
/**
 * 每一个日子的写法、公元年、月、日、范围的两头（链上的在前，路上各处的在后），和农历年表的每一行，算成一个数（十六个字符）。
 * 哪一样动了一个字、一个数，它就变。
 */
function datesSum(itinerary: Itinerary): string {
  const rows: string[] = [];
  const add = (moment: ItineraryMoment): void => void rows.push([moment.text, moment.year, moment.month ?? '', moment.day ?? '', moment.earliest ?? '', moment.latest ?? ''].join('|'));
  itinerary.stretches.forEach((item, i) => {
    if (i === 0) add(item.start);
    add(item.end);
  });
  for (const item of itinerary.stretches) for (const point of item.waypoints ?? []) if (point.date) add(point.date);
  for (const row of itinerary.years) rows.push([row.year, row.name, row.newYear ?? '', row.age].join('|'));
  return createHash('sha256').update(new TextEncoder().encode(rows.join('\n'))).digest('hex').slice(0, 16);
}
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

  it('头一段从出生那天起，最后一段到去世那天止（一共多少段印出来）', () => {
    console.log(`真的那一份行迹一共 ${REAL.stretches.length} 段`);
    const { numbers, problems: unplaced } = boundaryNumbers(REAL);
    expect(unplaced).toEqual([]);
    expect(isoOfDay(numbers[0])).toBe('1037-01-08');
    expect(isoOfDay(numbers[numbers.length - 1])).toBe('1101-08-24');
  });

  it('小像在不在沙盘上：住在站里的、在路上的、站在别的有的地方的（连线上没有立名字的几处）有他，别的没有他（各有几段照手写的那一份数，印出来）', () => {
    const looks = REAL.stretches.map(lookOf);
    const many = (look: string): number => looks.filter((item) => item === look).length;
    // 画成什么只看这一段是哪一种、它的 tablePoint 是哪一种
    const onTable = (item: ItineraryStretch): boolean => item.kind === 'elsewhere' && ['stop-point', 'place', 'way-vertex'].includes(item.tablePoint.type);
    expect([many('stop'), many('road'), many('quiet'), many('off')]).toEqual([
      REAL.stretches.filter((item) => item.kind === 'stop').length,
      REAL.stretches.filter((item) => item.kind === 'road').length,
      REAL.stretches.filter(onTable).length,
      REAL.stretches.filter((item) => item.kind === 'elsewhere' && !onTable(item)).length,
    ]);
    for (const look of ['stop', 'road', 'quiet', 'off']) expect(many(look), look).toBeGreaterThan(0);
    const spots = REAL.stretches.filter((item) => item.kind === 'elsewhere' && item.tablePoint.type === 'way-vertex');
    expect(spots.length).toBeGreaterThan(0);
    console.log(`住在站里 ${many('stop')} 段，在路上 ${many('road')} 段，站在别的有的地方 ${many('quiet')} 段（线上没有立名字的 ${spots.map((item) => item.id).join('、')}），没有他 ${many('off')} 段`);
    // 这几段各带着那一处的名字（小像站到那里的时候旁边立出来）：就是 where 开头的地名，第一行的“在哪”里也有它；句子里不再说“沙盘上没有立它的名字”
    for (const item of spots) {
      if (item.kind !== 'elsewhere' || item.tablePoint.type !== 'way-vertex') continue;
      expect(item.tablePoint.name, item.id).toBe(spotTown(item.where));
      expect(item.label, item.id).toContain(item.tablePoint.name);
      expect(item.says, item.id).not.toMatch(/没有立/u);
    }
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
    // “前后”现在自己也算像日子的话：这一句多报一条（没有列的日子：前后）
    expect(problems(reword('t31', '元丰三年二月一日到', '元丰三年二月一日前后到'))).toEqual([expect.stringContaining('“元丰三年二月一日”后面紧挨着“前”'), expect.stringContaining('有 saysDates 没有列的日子：前后')]);
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

  it('日子后面接“因……”（说他为什么）：通不过——“因”不在单子上，句子只说他做了什么', () => {
    // 原来的那一句：“治平三年四月二十五日以后因父亲去世离开”。史料写的是一件事（奉柩归蜀），不是缘由
    expect(problems(reword('t11', '以后离开，送父亲的灵柩回眉州', '以后因父亲去世离开'))).toEqual([expect.stringContaining('“治平三年四月二十五日以后”后面紧挨着“因”')]);
    expect(stretch(copyOf(), 't11').says).toBe('治平二年到；治平三年四月二十五日以后离开，送父亲的灵柩回眉州');
  });

  it('真的那一份里，读者看得见的两行字不说他为什么做一件事：没有“因”“为了”“以便”，也没有“等……”（等改派、等水涨）；“所以没有他”说的是沙盘，不算', () => {
    const WHY = /因|为了|以便|等/u;
    for (const item of [...REAL.stretches, REAL.first, REAL.last]) {
      for (const text of [item.label, item.says]) expect(WHY.test(text), text).toBe(false);
    }
    // 原来的那一句（“在城外等改派”：照他自己的信，改派是到京以前的事）查得出来
    expect(WHY.test('熙宁十年二月到，在城外等改派；四月动身去徐州，日子没有查到')).toBe(true);
  });

  it('真的那一份里，月日没有查到的日子只写到年：“照史料的写法”里年份后面不带“初”“末”这样的字，史料没有的字不添', () => {
    const moments = REAL.stretches.flatMap((item) => [item.start, item.end]).filter((moment) => moment.text.includes('月日没有查到'));
    expect(moments.length).toBeGreaterThan(0);
    for (const moment of moments) {
      expect(moment.text).toMatch(/^[^，初末中春夏秋冬]+年，月日没有查到$/u);
      expect(moment.earliestIs ?? '', moment.text).not.toMatch(/年[初末中]/u);
      expect(moment.latestIs ?? '', moment.text).not.toMatch(/年[初末中]/u);
    }
    // 句子里用到这几个日子的地方也只说到年
    for (const item of REAL.stretches) {
      for (const [n, moment] of [item.start, item.end].entries()) {
        if (!moment.text.includes('月日没有查到')) continue;
        for (const entry of item.saysDates.filter((one) => one.of === (n === 0 ? 'start' : 'end'))) expect(entry.text, `${item.id} ${entry.text}`).toMatch(/年$/u);
      }
    }
  });

  it('真的那一份里，出处的两行字是印给读者看的：不写文件的名字、别处的 id，不说“评审”；拉丁字母只在网址里', () => {
    expect(REAL.sources.length).toBeGreaterThan(0);
    for (const source of REAL.sources) {
      for (const text of [source.cite, source.read]) {
        expect(text, source.id).not.toMatch(/\.json|评审/u);
        expect(text.replace(/https?:\/\/[\w./-]+/g, ''), `${source.id}：${text}`).not.toMatch(/[A-Za-z]/);
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
    const bar = projectItinerary(REAL, FIGURE);
    expect(bar.stretches.map((item) => [item.id, item.label, item.says])).toEqual(REAL.stretches.map((item) => [item.id, item.label, item.says]));
    expect(bar.first).toEqual({ label: REAL.first.label, says: REAL.first.says });
    expect(bar.last).toEqual({ label: REAL.last.label, says: REAL.last.says });
  });
});

describe('如实四：两个有日子的地方之间匀着走，第二行说了', () => {
  it('路上的一句不以“匀着走的：”开头：通不过', () => {
    expect(problems((copy) => { const item = stretch(copy, 't30'); item.says = item.says.replace('匀着走的：', ''); })).toEqual([expect.stringContaining('第二行要以“匀着走的：”开头')]);
  });

  it('只有精确到日、又有位置的地方把路切开（哪几段、各几处照手写的那一份数，印出来）', () => {
    const legs = projectItinerary(REAL, FIGURE).stretches.filter((item) => item.legs).map((item) => `${item.id}:${item.legs?.length}`);
    const written = REAL.stretches.flatMap((item) => {
      const cuts = item.kind === 'road' ? (item.waypoints ?? []).filter((point) => point.at !== undefined && point.date?.precision === 'day').length : 0;
      return cuts > 0 ? [`${item.id}:${cuts}`] : [];
    });
    expect(legs).toEqual(written);
    expect(legs.length).toBeGreaterThan(0);
    // 路上只知道月份的一处不切，“别的”一段里的各处也不切
    expect(REAL.stretches.some((item) => item.kind === 'road' && (item.waypoints ?? []).some((point) => point.at !== undefined && point.date !== undefined && point.date.precision !== 'day'))).toBe(true);
    console.log(`把路切开的地方：${legs.join('，')}`);
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
    const found = problems((copy) => { const item = stretch(copy, 't37'); if (item.kind === 'elsewhere') item.tablePoint = { type: 'way-vertex', way: 'w-haizhou-mizhou', at: [120.75, 37.81], name: '登州', modern: '蓬莱' }; });
    expect(found).toContainEqual(expect.stringMatching(/离路“w-haizhou-mizhou”有 \d+ 公里，不能超过 15 公里/));
  });

  it('沙盘上没有他的一段，第二行头一个半句没有说：通不过', () => {
    expect(problems((copy) => { const item = stretch(copy, 't56'); item.says = item.says.replace('这一趟没有画，沙盘上没有他。', ''); })).toEqual([expect.stringContaining('头一个半句里要说“沙盘上没有他”')]);
  });

  it('站在线上、沙盘平时没有立名字的地方的七段：说“没有标出，沙盘上没有他”的通不过；还写着“沙盘上没有立某地的名字。”的也通不过（他站到那里的时候，旁边立着那一处的名字）', () => {
    expect(problems((copy) => { const item = stretch(copy, 't09'); item.says = `凤翔没有标出，沙盘上没有他。${item.says}`; })).toEqual([expect.stringContaining('不能说“没有他”“没有标出”')]);
    expect(problems((copy) => { const item = stretch(copy, 't09'); item.says = `沙盘上没有立凤翔的名字。${item.says}`; })).toEqual([expect.stringContaining('第二行不能再说“沙盘上没有立凤翔的名字”')]);
  });

  it('全程沙盘上后来立了那个地方的名字，行迹里还把它当成“线上没有立名字的地方”：通不过（不然他站到那里，同一个名字立了两回）', () => {
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

  it('工具做的那一份里：没有他的各段不带位置；有他的各段正好带一样（地名点、线上的一处，或者走的路）', () => {
    for (const item of projectItinerary(REAL, FIGURE).stretches) {
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
    expect(read('itinerary.bar.json')).toBe(barText(projectItinerary(REAL, FIGURE)));
  });

  it('工具做的那一份带着人物的名字，就是 figure.json 的 name', () => {
    expect(projectItinerary(REAL, FIGURE).name).toBe(FIGURE.name);
    expect(Object.keys(JSON.parse(read('itinerary.bar.json')) as Record<string, unknown>)).toEqual(['day0', 'name', 'years', 'first', 'last', 'stretches']);
  });

  it('手写的那一份改了、那一份没有重做：通不过，话里说运行哪一条命令', () => {
    const found = problems((copy) => (stretch(copy, 't31').label = '住在黄州'), { keepBar: true });
    expect(found).toEqual([expect.stringContaining('运行 npm run itinerary 重做')]);
  });

  it('没有那一份：通不过；没有全程沙盘的人物有行迹：通不过；有全程沙盘、没有行迹的人物现在还不报（只有工具做的那一份、没有手写的，报）', () => {
    const files: ContentFiles = { [`${DIR}/figure.json`]: read('figure.json'), [`${DIR}/scenes/route.json`]: read('scenes/route.json'), [FILE]: read('itinerary.json') };
    expect(validateItinerary(files, DIR, FIGURE).map((v) => [v.rule, v.file])).toEqual([[ITINERARY_RULE, BAR]]);
    const { [`${DIR}/scenes/route.json`]: _route, ...withoutRoute } = files;
    expect(validateItinerary(withoutRoute, DIR, FIGURE).map((v) => v.file)).toEqual([FILE]);
    const { [FILE]: _itinerary, ...withoutItinerary } = files;
    // 只管一头：有行迹的要有全程沙盘。反过来那一头等有了第二位人物再添
    expect(validateItinerary(withoutItinerary, DIR, FIGURE)).toEqual([]);
    expect(validateItinerary({ ...withoutItinerary, [BAR]: read('itinerary.bar.json') }, DIR, FIGURE).map((v) => [v.rule, v.file, v.problem])).toEqual([[ITINERARY_RULE, BAR, expect.stringContaining('没有手写的那一份')]]);
  });

  it('规则 22 接在一位人物的校验里（validateFigure）：真的那一份一处不报；手写的改了一个字、那一份没有重做，报的是【规则 22 行迹】；没有全程沙盘的人物带着行迹，也报', () => {
    expect(RULE_NAMES[ITINERARY_RULE]).toBe('行迹');
    const files: ContentFiles = { [`${DIR}/figure.json`]: read('figure.json'), [`${DIR}/scenes/route.json`]: read('scenes/route.json'), [FILE]: read('itinerary.json'), [BAR]: read('itinerary.bar.json') };
    // 这里只放了四个文件，别的规则会报缺这缺那；只看规则 22 的
    const rule22 = (given: ContentFiles): Violation[] => validateFigure(given, FIGURE.id).filter((v) => v.rule === ITINERARY_RULE);
    expect(rule22(files)).toEqual([]);
    const copy = copyOf();
    stretch(copy, 't31').label = '住在黄州';
    const changed = rule22({ ...files, [FILE]: JSON.stringify(copy) });
    expect(changed.map((v) => v.file)).toEqual([BAR]);
    expect(formatViolation(changed[0])).toContain('【规则 22 行迹】content/figures/su-shi/itinerary.bar.json');
    const { [`${DIR}/scenes/route.json`]: _route, ...withoutRoute } = files;
    expect(rule22(withoutRoute).map((v) => v.file)).toEqual([FILE, BAR]);
  });

  it('日子换算：儒略历的一天是第几天，来回换不走样；出生那天是第 0 天，去世那天是第 23,604 天', () => {
    expect(julianDay(1101, 8, 24) - julianDay(1037, 1, 8)).toBe(23604);
    for (const written of ['1037-01-08', '1080-01-25', '1084-02-29', '1100-12-31']) expect(isoOfDay(dayOfIso(written) ?? NaN)).toBe(written);
    expect(dayOfIso('1083-02-29')).toBeNull();
    expect(dayOfIso('1084-5-8')).toBeNull();
    const bar = projectItinerary(REAL, FIGURE);
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
});

// ---------------------------------------------------------------- 读过一遍以后添的几条规矩
// 下面的“说假话的行迹”各是把真的那一份改一处：看着像真的，规则原来放过了，现在都要查得出来。

describe('如实三（续）：删掉了年份、月份的日子，读的人拿前面的来补，补出来的要正是史料写的那一个', () => {
  it('后面的一个日子删掉了月份，前一个日子是另一个月：通不过', () => {
    // “六月七日在金陵，十七日在虔州”读成六月十七日；史料是八月十七日
    expect(problems(redate('t52', 1, '八月十七日', '十七日'))).toEqual([expect.stringContaining('“十七日”没有带月份，读的人会当成句子里前一个日子的六月；史料写的是八月')]);
    // “五月十一日在藤州，十一日到海边”读成同一天；史料是六月十一日
    expect(problems(redate('t54', 1, '六月十一日', '十一日'))).toEqual([expect.stringContaining('“十一日”没有带月份，读的人会当成句子里前一个日子的五月；史料写的是六月')]);
  });

  it('后面的一个日子删掉了年份，前一个日子是另一年：通不过', () => {
    // “熙宁四年十一月到；冬出差救灾”读成熙宁四年冬；史料是熙宁六年冬
    expect(problems(redate('t17', 1, '熙宁六年冬', '冬'))).toEqual([expect.stringContaining('“冬”没有带年份，读的人会当成句子里前一个日子的熙宁四年；史料写的是熙宁六年')]);
    // “绍圣四年七月二日到昌化军（儋州）；六月十七日以前离开”读成还没到就走了；史料是元符三年
    expect(problems(redate('t55', 1, '元符三年六月十七日以前', '六月十七日以前'))).toEqual([expect.stringContaining('“六月十七日以前”没有带年份，读的人会当成句子里前一个日子的绍圣四年；史料写的是元符三年')]);
  });

  it('删掉了年号、留着第几年的，前一个日子要是同一个年号：真的那一份里都是；头一个日子就不带年号、同第一行印的不是一个年号的通不过', () => {
    // 真的：“嘉祐四年十月出眉州……五年春到汴京”“治平元年十二月过华阴，二年到汴京”
    for (const id of ['t06', 't10', 't22', 't45']) expect(stretch(copyOf(), id).saysDates.some((entry) => /^[二三四五六七八九十]+年/u.test(entry.text)), id).toBe(true);
    // t59 从建中靖国元年正月起，句子开头写成“元年正月到”还是同一个年号；t33 从元丰七年起，把“元丰八年正月四日”写成“八年正月四日”也是
    expect(problems((copy) => { redate('t59', 0, '正月', '元年正月')(copy); })).toEqual([]);
    expect(problems(redate('t33', 1, '元丰八年正月四日', '八年正月四日'))).toEqual([]);
    // t58 从元符三年起：句子的头一个日子写成“元年正月”，读的人会当成元符元年
    expect(problems((copy) => { const item = stretch(copy, 't58'); item.says = item.says.replace('建中靖国元年正月', '元年正月'); item.saysDates[0].text = '元年正月'; })).toEqual([
      expect.stringContaining('“元年正月”没有带年号，读的人会当成第一行印着的元符的；史料写的是建中靖国元年'),
    ]);
  });

  it('句子里头一个日子不带年份的，要落在这一段开始摆出来的那个农历年里（第一行印着的那一年）：t58 原来的那一句通不过', () => {
    // 第一段留下的句子：t58 从元符三年冬起，句子说“正月五日在南安军，正月到虔州”，在“元符三年（1100）”底下摆了八十多天
    const old = (copy: Itinerary): void => {
      const item = stretch(copy, 't58');
      item.says = '这一趟没有画，沙盘上没有他。正月五日在南安军，正月到虔州';
      item.saysDates = [{ of: 'wp:南安军', text: '正月五日' }, { of: 'end', text: '正月' }];
    };
    expect(problems(old)).toEqual([expect.stringContaining('“正月五日”没有带年份，读的人会当成第一行印着的元符三年；史料写的是建中靖国元年')]);
    // 现在的那一句带着年份
    expect(stretch(copyOf(), 't58').says).toBe('这一趟没有画，沙盘上没有他。建中靖国元年正月到虔州');
    expect(stretch(copyOf(), 't58').saysDates).toEqual([{ of: 'end', text: '建中靖国元年正月' }]);
    // 头一个日子删掉了月份：前面没有哪个日子说过月份，没有东西可补
    expect(problems((copy) => { const item = stretch(copy, 't61'); item.says = item.says.replace('七月二十八日', '二十八日'); item.saysDates[0].text = '二十八日'; })).toEqual([
      expect.stringContaining('“二十八日”没有带月份，它前面又没有哪个日子说过月份；史料写的是七月'),
    ]);
    // 真的那一份里，句子的头一个日子不带年份的各段，都落在那一段开始的那一年里（通过了上面“十句都通过”）；有多少段印出来
    const bare = REAL.stretches.filter((item) => item.saysDates.length > 0 && !/年/u.test(item.saysDates[0].text)).map((item) => item.id);
    expect(bare.length).toBeGreaterThan(0);
    console.log(`句子的头一个日子不带年份的 ${bare.length} 段：${bare.join('、')}`);
  });
});

describe('如实三（续）：句子里日子以外的“像日子的话”', () => {
  it('岁数、住了多久、靠着别的日子说的、干支记的日子：通不过', () => {
    const stray = (what: string) => [expect.stringContaining(`有 saysDates 没有列的日子：${what}`)];
    // 岁数（表里那一年是虚岁四十五，句子里写的还差着一岁）
    expect(problems(reword('t31', '元丰三年二月一日到，', '元丰三年二月一日到，虚岁四十四；'))).toEqual(stray('岁'));
    // 住了多久
    expect(problems(reword('t21', '熙宁七年冬到；', '熙宁七年冬到，住了三个月；'))).toEqual(stray('三个月'));
    expect(problems(reword('t59', '正月到，', '正月到，住了六十天，'))).toEqual(stray('六十天'));
    expect(problems(reword('t31', '元丰三年二月一日到，', '元丰三年二月一日到，住了两夜，'))).toEqual(stray('两夜'));
    // 靠着别的日子说的
    expect(problems(reword('t53', '绍圣元年十月二日到，', '绍圣元年十月二日到，三天后上山；'))).toEqual(stray('三天'));
    expect(problems(reword('t21', '熙宁九年十二月离开', '熙宁九年十二月离开，年底到潍州'))).toEqual(stray('年底'));
    expect(problems(reword('t25', '熙宁十年四月到；', '熙宁十年四月到，次年回京；'))).toEqual(stray('次年'));
    expect(problems(reword('t25', '熙宁十年四月到；', '熙宁十年四月到，中元前后大水；'))).toEqual(stray('中元、前后'));
    expect(problems(reword('t25', '熙宁十年四月到；', '熙宁十年四月到，大水前后都在；'))).toEqual(stray('前后'));
    // 干支记的日子
    expect(problems(reword('t31', '元丰三年二月一日到，', '元丰三年二月一日到，壬戌游赤壁；'))).toEqual(stray('壬戌'));
    // “在哪”里也不许有
    expect(problems((copy) => (stretch(copy, 't31').label = '在黄州第三年'))).toContainEqual(expect.stringContaining('“在哪”里有像日子的字眼'));
    expect(problems((copy) => (stretch(copy, 't31').label = '在黄州四十七岁'))).toContainEqual(expect.stringContaining('“在哪”里有像日子的字眼（岁）'));
  });

  it('最后一个位置的“虚岁六十六”照旧放过（它另有一条规矩管）；别处的“虚岁多少”不放过', () => {
    expect(REAL.last.says).toMatch(/虚岁[一二三四五六七八九十]+/u);
    expect(problems((copy) => (copy.first.says = `${copy.first.says}，虚岁一岁`))).toEqual([expect.stringContaining('有 saysDates 没有列的日子：岁、岁')]);
  });
});

describe('如实一（续）：只说到季节的写法；日子和农历年的表同历表对过', () => {
  it('史料的写法只说到季节，精度却写成 month：通不过', () => {
    // “嘉祐元年春”收成一个月的范围
    const narrowed = (copy: Itinerary): void => boundary(copy, 't01', (moment) => Object.assign(moment, { precision: 'month', earliest: '1056-03-19', latest: '1056-04-16' }));
    expect(problems(narrowed)).toContainEqual(expect.stringContaining('“嘉祐元年春”的写法只说到季节，精度却是 month'));
    // 真的那一份里，末一个字是春夏秋冬的写法精度都是季（或者以前、以后）
    const seasons = [REAL.stretches[0].start, ...REAL.stretches.map((item) => item.end)].filter((moment) => /[春夏秋冬]$/u.test(moment.text));
    expect(seasons.length).toBeGreaterThan(0);
    for (const moment of seasons) expect(['season', 'before', 'after'], moment.text).toContain(moment.precision);
  });

  /**
   * 每一个日子的写法、公元年、月、日、范围的两头，和农历年表的每一行，算成一个数记在这里。
   * 这些东西校验只查得到“差得远的”（月日差十天以上、年名接不上）；差一天、一个没有日子落进去的年份改了名，规则看不出来，要对着历表看。
   * 上一回对历表：2026-11-24（表里 65 个正月初一、54 个精确到日的日子，同抓下来留着的历表页一个不差；范围的两头没有对过）。
   * 2026-11-25 改了一个日子的写法：到汴京的那一个（t10 的结束、t11 的开始）年份后面原来多一个“初”字，去掉了——史料里没有这个字；
   * 数字一个没动，它的范围两头（治平二年正月初一是 1065-02-08，五月二十八日是 1065-07-04）另对着留着的历表核过。
   * 从那以后这些东西一个字、一个数都没有动过，这个数才不变。
   * 这个数里没有的：路上各处的位置、哪里算说得准，不在这个数里，靠读（把一处有日子的地方挪到线上别的位置、把一个精度从“季”改成“以前”，
   * 规则 22 放得过去，这个数也不变）。
   */
  const COMPARED = { on: '2026-11-25', sum: '1a2ae0bf2619df8d' };

  it('日子和农历年的表：从上一回对历表以后一个字、一个数都没有动过（动了：先对着历表核一遍，再把这里记的数换掉）', () => {
    expect(datesSum(REAL), `行迹里的日子或者农历年的表改过了。先对着历表核一遍，再把这里记的数和对的日子换掉（上一回是 ${COMPARED.on}）`).toBe(COMPARED.sum);
    // 改一个数字、挪一天、给一个没有日子落进去的年份改名：规则 22 放得过去的，这个数都变
    const changed = (change: (copy: Itinerary) => void): boolean => {
      const copy = copyOf();
      change(copy);
      return datesSum(copy) !== COMPARED.sum;
    };
    expect(changed((copy) => boundary(copy, 't28', (moment) => (moment.text = '元丰二年八月十九日')))).toBe(true);
    expect(changed((copy) => boundary(copy, 't30', (moment) => (moment.text = '元丰三年二月二日')))).toBe(true);
    expect(changed((copy) => boundary(copy, 't53', (moment) => (moment.day = 2)))).toBe(true);
    expect(changed((copy) => boundary(copy, 't31', (moment) => (moment.latest = '1084-05-12')))).toBe(true);
    expect(changed((copy) => { for (const row of copy.years) if (row.name.startsWith('庆历')) row.name = row.name.replace('庆历', '庆厉'); })).toBe(true);
    expect(changed((copy) => (copy.years[20].newYear = isoOfDay((dayOfIso(copy.years[20].newYear) ?? 0) + 1)))).toBe(true);
    expect(changed((copy) => { const point = stretch(copy, 't30').waypoints?.find((item) => item.name === '陈州'); if (point?.date) point.date.day = (point.date.day ?? 0) + 1; })).toBe(true);
    // 句子、说不准的、出处改了，这个数不变（它们不用对历表）
    expect(changed((copy) => { stretch(copy, 't31').unsure = '改了一句'; copy.first.says = '改了一句'; })).toBe(false);
    // 而这几样里，规则 22 自己放得过去的确实有（所以才要这个数）：写法和句子一起改一天
    expect(problems((copy) => { boundary(copy, 't28', (moment) => (moment.text = '元丰二年八月十九日')); redate('t28', 1, '八月十八日', '八月十九日')(copy); redate('t29', 0, '元丰二年八月十八日', '元丰二年八月十九日')(copy); })).toEqual([]);
  });
});

describe('如实五（续）：线上“沙盘平时没有立名字”的地方，旁边确实没有别的名字', () => {
  it('小像站的地方旁边就立着题签，只是名字不一样（一个套着另一个，或者离立了题签的地名点不到 15 公里）：通不过', () => {
    // 汴京城外：名字套着“汴京”
    const outside = (copy: Itinerary): void => {
      const item = stretch(copy, 't23');
      if (item.kind !== 'elsewhere') throw new Error('t23 不是“别的”一段');
      const bianjing = ROUTE.places.find((place) => place.name === '汴京');
      if (!bianjing) throw new Error('全程沙盘里没有汴京这个地名点');
      item.tablePoint = { type: 'way-vertex', way: 'w-bian-a', at: bianjing.at, name: '汴京城外' };
    };
    expect(problems(outside)).toEqual([expect.stringContaining('全程沙盘上立着题签“汴京”')]);
    // 湖州城：名字套着“湖州”
    const town = (copy: Itinerary): void => {
      const item = stretch(copy, 't27');
      if (item.kind !== 'elsewhere') throw new Error('t27 不是“别的”一段');
      const huzhou = ROUTE.places.find((place) => place.name === '湖州');
      if (!huzhou) throw new Error('全程沙盘里没有湖州这个地名点');
      item.where = '湖州城（做知州）';
      item.tablePoint = { type: 'way-vertex', way: 'w-hangzhou-huzhou', at: huzhou.at, name: '湖州城' };
      item.label = '在湖州城做官';
    };
    expect(problems(town)).toEqual([expect.stringContaining('全程沙盘上立着题签“湖州”')]);
    // 名字全不相干，位置就在立了题签的地名点上
    const renamed = (copy: Itinerary): void => {
      town(copy);
      const item = stretch(copy, 't27');
      if (item.kind !== 'elsewhere') return;
      item.where = '吴兴（做知州）';
      item.label = '在吴兴做官';
      if (item.tablePoint.type === 'way-vertex') item.tablePoint.name = '吴兴';
    };
    expect(problems(renamed)).toContainEqual(expect.stringMatching(/的位置离立了题签的地名点“湖州”只有 \d+ 公里/));
    // 真的那一份里线上没有立名字的各处：离最近的立了题签的地名点都远过 15 公里（多远印出来）
    const coords = routeCoords(ROUTE.frame);
    const named = ROUTE.places.filter((place) => ROUTE.strips.some((strip) => strip.of === place.id));
    const lines: string[] = [];
    for (const item of REAL.stretches) {
      if (item.kind !== 'elsewhere' || item.tablePoint.type !== 'way-vertex') continue;
      const [x, z] = coords.toLocal(item.tablePoint.at);
      const nearest = named
        .map((place) => ({ name: place.name, km: (Math.hypot(coords.toLocal(place.at)[0] - x, coords.toLocal(place.at)[1] - z) * ROUTE.frame.scale) / 1000 }))
        .sort((a, b) => a.km - b.km)[0];
      expect(nearest.km, item.id).toBeGreaterThan(15);
      lines.push(`${item.id} ${spotTown(item.where)}：${nearest.name} ${Math.round(nearest.km)} 公里`);
    }
    expect(lines.length).toBeGreaterThan(0);
    console.log(`线上没有立名字的各处，最近的立了题签的地名点：${lines.join('，')}`);
  });
});

describe('说不准的要说出来', () => {
  it('头尾有一个不精确到日的一段，unsure 空着（或者只有空格）：通不过', () => {
    expect(problems((copy) => (stretch(copy, 't25').unsure = ''))).toEqual([expect.stringContaining('“t25”的头尾有一个不精确到日，unsure 却空着')]);
    expect(problems((copy) => (stretch(copy, 't26').unsure = ' '))).toEqual([expect.stringContaining('“t26”的头尾有一个不精确到日，unsure 却空着')]);
    // 真的那一份里每一段都写了
    for (const item of REAL.stretches) expect(item.unsure.trim(), item.id).not.toBe('');
  });

  it('句子里说到的、把路切开的路上一处，note 里写着另一种说法、对不上、是推出来的，这一处却没有写 unsure：通不过', () => {
    const without = (id: string, name: string) => (copy: Itinerary): void => {
      const point = stretch(copy, id).waypoints?.find((item) => item.name === name);
      if (!point?.unsure) throw new Error(`${id} 的“${name}”没有 unsure`);
      delete point.unsure;
    };
    expect(problems(without('t16', '涡口前五里'))).toEqual([expect.stringContaining('“t16”路上的“涡口前五里”，note 里写着这个日子另有一种说法、对不上或者是推出来的（“一本作”）')]);
    expect(problems(without('t18', '常州城外'))).toEqual([expect.stringContaining('“t18”路上的“常州城外”')]);
    expect(problems(without('t06', '江陵'))).toEqual([expect.stringContaining('“t06”路上的“江陵”')]);
    expect(problems(without('t32', '金陵'))).toEqual([expect.stringContaining('“t32”路上的“金陵”')]);
    // 只写空格不算写了
    expect(problems((copy) => { const point = stretch(copy, 't18').waypoints?.find((item) => item.name === '常州城外'); if (point) point.unsure = ' '; })).toHaveLength(1);
    // 这几处的 unsure 是照 note 里的话写的，只删字：每一条都是 note 里连着的一截
    for (const item of REAL.stretches) for (const point of item.waypoints ?? []) if (point.unsure && DOUBT_WORDS.test(point.note)) expect(point.note, `${item.id} ${point.name}`).toContain(point.unsure);
  });

  it('“说不准的”不是写了东西就算：一个句号、一道横线、一个看不见的字、一个“无”字，通不过（至少两个汉字）', () => {
    expect(UNSURE_MIN_HAN).toBe(2);
    for (const written of ['。', '——', '\u200b', '无']) {
      expect(problems((copy) => (stretch(copy, 't25').unsure = written)), JSON.stringify(written)).toEqual([expect.stringContaining('这不是一句话')]);
    }
    // 路上一处的也一样
    const point = (copy: Itinerary, id: string, name: string) => {
      const found = stretch(copy, id).waypoints?.find((item) => item.name === name);
      if (!found) throw new Error(`${id} 没有“${name}”`);
      return found;
    };
    expect(problems((copy) => (point(copy, 't16', '涡口前五里').unsure = '。'))).toEqual([expect.stringContaining('“涡口前五里”的 unsure 写的是“。”：这不是一句话')]);
    // 真的那一份里写了的每一条都够
    for (const item of REAL.stretches) {
      expect((item.unsure.match(/\p{Script=Han}/gu) ?? []).length, item.id).toBeGreaterThanOrEqual(UNSURE_MIN_HAN);
      for (const wp of item.waypoints ?? []) if (wp.unsure) expect((wp.unsure.match(/\p{Script=Han}/gu) ?? []).length, `${item.id} ${wp.name}`).toBeGreaterThanOrEqual(UNSURE_MIN_HAN);
    }
  });

  it('路上一处的 note 里写着另一种说法的，它的 unsure 要是 note 里连着的一截：另写一句（哪怕同 note 说的正相反）通不过；“别本”“又作”“或作”“异文”“一说”也算另一种说法', () => {
    const point = (copy: Itinerary) => {
      const found = stretch(copy, 't16').waypoints?.find((item) => item.name === '涡口前五里');
      if (!found) throw new Error('t16 没有“涡口前五里”');
      return found;
    };
    expect(problems((copy) => (point(copy).unsure = '没有别的说法'))).toEqual([expect.stringContaining('不是它的 note 里的话')]);
    // 换一种说法写那个疑点，再把 unsure 删掉：照样要写
    for (const word of ['别本写的是', '又作', '或作', '有异文：', '一说是']) {
      const found = problems((copy) => {
        point(copy).note = `诗题；查注说${word}“十月一日”`;
        delete point(copy).unsure;
      });
      expect(found, word).toEqual([expect.stringContaining('“t16”路上的“涡口前五里”，note 里写着这个日子另有一种说法')]);
      expect(DOUBT_WORDS.test(word), word).toBe(true);
    }
  });

  it('工具把这几处的 unsure 接在这一段的 unsure 后面、各带着那一处的名字，读者点开“图例”看得见；句子里没说到、又不切路的各处不接', () => {
    const made = projectItinerary(REAL, FIGURE);
    let carried = 0;
    for (const item of REAL.stretches) {
      const points = (item.waypoints ?? []).filter((point) => point.unsure?.trim() && doubtCarrier(item, point));
      const others = (item.waypoints ?? []).filter((point) => point.unsure?.trim() && !doubtCarrier(item, point));
      const got = made.stretches.find((entry) => entry.id === item.id)?.unsure ?? '';
      // 接上去的每一条前面带着那一处的名字：“江陵：查注引作十八日”
      expect(got, item.id).toBe([item.unsure, ...points.map((point) => `${point.name}：${point.unsure}`)].join('；'));
      expect(unsureOf(item), item.id).toBe(got);
      for (const point of others) expect(got, `${item.id} ${point.name}`).not.toContain(point.unsure);
      carried += points.length;
    }
    expect(carried).toBeGreaterThan(0);
    // 灵璧（句子里说到了，也切路）、楚州（句子里没说，切路）的都接上了
    const lingbi = stretch(copyOf(), 't26').waypoints?.find((point) => point.name === '灵璧')?.unsure;
    const chuzhou = stretch(copyOf(), 't16').waypoints?.find((point) => point.name.startsWith('楚州'))?.unsure;
    expect(lingbi && chuzhou).toBeTruthy();
    expect(made.stretches.find((entry) => entry.id === 't26')?.unsure).toContain(`；灵璧：${lingbi}`);
    expect(made.stretches.find((entry) => entry.id === 't16')?.unsure).toContain(`：${chuzhou}`);
    expect(made.stretches.find((entry) => entry.id === 't06')?.unsure).toContain('；江陵：');
    // 把一处从句子里拿掉、它又不切路（“别的”一段里的各处都不切）：它的 unsure 就不接了
    const copy = copyOf();
    const t18 = stretch(copy, 't18');
    t18.saysDates = t18.saysDates.filter((entry) => entry.of !== 'wp:常州城外');
    expect(unsureOf(t18)).toBe(t18.unsure);
  });

  it('各站的年份：时间轴用的那一份里不带（轴上圆点旁边不写年份——八站的哪一种栏上也放不全；目录里每一站已经有它的年份）', () => {
    const made = projectItinerary(REAL, FIGURE) as unknown as Record<string, unknown>;
    expect(made).not.toHaveProperty('stopYears');
    // 做出来的文件里也没有哪一站已发布的年份（“1080–1084”这样的字）
    const written = FIGURE.stops.map((stop) => stop.years).filter((years) => /\d{4}–\d{4}/.test(years));
    expect(written.length).toBeGreaterThan(0);
    for (const years of written) expect(read('itinerary.bar.json'), years).not.toContain(years);
  });
});

describe('如实三（续）：“以前”“以后”挂在哪一截日子上；头一个日子不带年份的一段不能跨着正月初一', () => {
  it('isShortening：留着“以前”“以后”的，史料的写法里它前面紧挨着的那一截日子也要留着', () => {
    // 删掉了月、日，“以前”就挂到年份上去了：他是在元符三年里离开的，句子却说成那一年以前
    expect(isShortening('元符三年以前', '元符三年六月，十七日以前')).toBe(false);
    expect(isShortening('治平三年以后', '治平三年四月二十五日以后')).toBe(false);
    // 删掉了哪一天，“以前”挂到月份上：他也许就是七月里离开的
    expect(isShortening('七月以前', '元丰八年七月二十五日以前')).toBe(false);
    expect(isShortening('九月以后', '熙宁七年九月二十日以后')).toBe(false);
    // 留着那一截的可以：删年份、删月份（月份另有一条管：要同句子里前一个日子的一样）
    expect(isShortening('六月十七日以前', '元符三年六月，十七日以前')).toBe(true);
    expect(isShortening('七月二十五日以前', '元丰八年七月二十五日以前')).toBe(true);
    expect(isShortening('九日以后', '元祐七年九月，九日以后')).toBe(true);
    expect(isShortening('治平四年八月以前', '治平四年八月以前')).toBe(true);
    expect(isShortening('八月以前', '治平四年八月以前')).toBe(true);
  });

  it('句子里把“以前”“以后”前面的那一截删掉（四句说假话的行迹）：通不过', () => {
    const refused = [expect.stringContaining('只许整截地删')];
    expect(problems(redate('t55', 1, '元符三年六月十七日以前', '元符三年以前'))).toEqual(refused);
    expect(problems(redate('t11', 1, '治平三年四月二十五日以后', '治平三年以后'))).toEqual(refused);
    expect(problems(redate('t35', 1, '七月二十五日以前', '七月以前'))).toEqual(refused);
    expect(problems(redate('t19', 1, '九月二十日以后', '九月以后'))).toEqual(refused);
    // 留着哪一天、删掉月份的：月份要同句子里前一个日子的一样（t48 的“九日以后”前面是“九月九日”）；不一样的通不过
    expect(stretch(copyOf(), 't48').says).toContain('九月九日在南都，九日以后到汴京');
    expect(problems(redate('t35', 1, '七月二十五日以前', '二十五日以前'))).toEqual([expect.stringContaining('“二十五日以前”没有带月份')]);
  });

  it('头一个日子不带年份，这一段在时间轴上又跨着正月初一：通不过（第一行先后印着两个年名，读的人会拿后一年去补）', () => {
    // 在黄州住了四年多、在惠州住了两年多：到的日子不带年份
    expect(problems(redate('t31', 0, '元丰三年二月一日', '二月一日'))).toEqual([expect.stringContaining('头一个日子“二月一日”没有带年份，可这一段在时间轴上跨着正月初一')]);
    expect(problems(redate('t53', 0, '绍圣元年十月二日', '十月二日'))).toEqual([expect.stringContaining('跨着正月初一')]);
    // 出差救灾的那一段原来的句子：除夜是熙宁六年的最后一天，这一段大半摆在熙宁七年底下
    const old = (copy: Itinerary): void => {
      const item = stretch(copy, 't18');
      item.says = '这一趟没有画，沙盘上没有他。除夜在常州城外，熙宁七年六月回杭州';
      item.saysDates = [{ of: 'wp:常州城外', text: '除夜' }, { of: 'end', text: '熙宁七年六月' }];
    };
    expect(problems(old)).toEqual([expect.stringContaining('头一个日子“除夜”没有带年份')]);
    // 真的那一份里：头一个日子不带年份的各段，在时间轴上都只摆在一个年名底下
    const years = lunarYears(REAL);
    const { numbers } = boundaryNumbers(REAL);
    const bare = REAL.stretches.flatMap((item, i) => (item.saysDates.length > 0 && !/年/u.test(item.saysDates[0].text) ? [{ id: item.id, under: years.filter((year) => year.last >= Math.floor(numbers[i]) && year.first < numbers[i + 1]).map((year) => year.name) }] : []));
    expect(bare.length).toBeGreaterThan(0);
    for (const item of bare) expect(item.under, item.id).toHaveLength(1);
    // 一段不跨年的，头一个日子不带年份照旧可以（去黄州的路：正月初一出汴京，二月一日到）
    expect(stretch(copyOf(), 't30').saysDates[0].text).not.toMatch(/年/u);
  });
});

describe('如实三（续）：更多“像日子的话”', () => {
  it('接着上一个日子说的、隔开一年的、约数的多久、节令、“卅”“廿”、年号后面的“初”“末”：通不过；“三天竺”“度岁”指名放过', () => {
    const insert = (what: string) => reword('t53', '绍圣元年十月二日到，', `绍圣元年十月二日到，${what}`);
    const refused = [
      '翌日上山；', '次日上山；', '是夜上山；', '当晚上山；', '同年上山；', '是年上山；', '中元上山；', '上巳上山；', '望日上山；', '月半上山；', '年末上山；', '年终上山；',
      '小寒上山；', '谷雨上山；', '住了半年；', '住了半年多；', '住了一个半月；', '住了百日；', '住了一百天；', '住了数月；', '住了十余日；', '卅日上山；', '廿日上山；',
      '绍圣初上山；', '元祐末上山；', '元丰中上山；', '熙宁间上山；', '隔年上山；', '来年上山；', '五更上山；', '三载后走；', '年后上山；',
    ];
    for (const what of refused) expect(problems(insert(what)), what).toEqual([expect.stringContaining('有 saysDates 没有列的日子')]);
    // 他在杭州出差救灾的那一句原来说“离开杭州半年多”：那是算出来的长短，不是哪一条史料的话
    expect(problems(reword('t17', '离开杭州', '离开杭州半年多'))).toEqual([expect.stringContaining('有 saysDates 没有列的日子：半年')]);
    expect(REAL.stretches.filter((item) => /半年|多年|数月/u.test(item.says)).map((item) => item.id)).toEqual([]);
    // 指名放过的两个词：杭州的地名“三天竺”，史料里说在哪里过年的“度岁”
    expect(problems(reword('t41', '元祐四年七月三日到；', '元祐四年七月三日到，游三天竺；'))).toEqual([]);
    expect(problems(reword('t21', '熙宁七年冬到；', '熙宁七年冬到，度岁；'))).toEqual([]);
    // 去掉“竺”字，“三天”还是日子
    expect(problems(reword('t41', '元祐四年七月三日到；', '元祐四年七月三日到，游三天；'))).toEqual([expect.stringContaining('有 saysDates 没有列的日子：三天')]);
    // 这张单子是一张网，不是证明：“不久”“逾月”这样的话它不认得（靠读）
    expect(problems(insert('不久上山；'))).toEqual([]);
  });
});

describe('如实五（续）：句子说沙盘上有什么，要是时间轴停在那里的时候摆着的那一节上真有的', () => {
  it('站在框外的一段（定州）：时间轴停在那里的时候摆的是全程；全程那一节没有立它的题签，句子里就不说“框上立着它的名字”', () => {
    const outside = REAL.stretches.filter((item) => item.kind === 'elsewhere' && item.tablePoint.type === 'edge-strip');
    expect(outside.length).toBeGreaterThan(0);
    for (const item of outside) {
      if (item.kind !== 'elsewhere' || item.tablePoint.type !== 'edge-strip') continue;
      // 停在这一段的时候沙盘摆哪一节：落在哪一站讲的年月里就是那一站的那一节，不然是头一节（全程）
      const section = ROUTE.sections.find((entry) => item.stopYearsOf !== null && entry.stop === item.stopYearsOf) ?? ROUTE.sections[0];
      const shown = section.strips.includes(item.tablePoint.strip);
      console.log(`${item.id}（${item.label}）停着的时候摆“${section.heading}”，这一节${shown ? '立着' : '没有立'}题签 ${item.tablePoint.strip}：${item.says}`);
      if (!shown) expect(item.says, item.id).not.toMatch(/立着|立了/u);
    }
  });

  it('“一个名字套着另一个”只同指着地名点的题签比：扬州那一处改叫“海陵”（题签“海”是海，不是哪个镇）通得过；套着镇名的照样通不过', () => {
    const rename = (town: string) => (copy: Itinerary): void => {
      const item = stretch(copy, 't47');
      if (item.kind !== 'elsewhere') throw new Error('t47 不是“别的”');
      const old = spotTown(item.where);
      item.where = item.where.replace(old, town);
      item.label = item.label.replace(old, town);
      if (item.tablePoint.type === 'way-vertex') item.tablePoint.name = town;
    };
    const sea = ROUTE.strips.find((strip) => strip.text === '海');
    expect(sea && !ROUTE.places.some((place) => place.id === sea.of)).toBe(true);
    expect(problems(rename('海陵'))).toEqual([]);
    expect(problems(rename('徐州城外'))).toContainEqual(expect.stringContaining('是一个名字套着另一个'));
  });
});

describe('如实二（续）：第一行括号里的公历月份', () => {
  it('每一段碰到的每一个“公历已经是下一年”的月份：史料担保得了的写年和月；担保不了的列在工具做的那一份里（plainMonths），那些天只写年份；别的日子都只写年份', () => {
    const made = projectItinerary(REAL, FIGURE);
    const zero = dayOfIso(made.day0) as number;
    const years = lunarYears(REAL);
    const lastDay = made.stretches[made.stretches.length - 1].until;
    // 自己一天一天数（每一天看四回：圆钮可以停在一天的中间）
    const pairs = new Map<string, { stretch: number; year: number; month: number; held: boolean }>();
    let tailDays = 0;
    for (let day = 0; day <= lastDay; day++) {
      const lunar = lunarYearOf(years, zero + day);
      if (!lunar) throw new Error(`第 ${day} 天不在 years 表里`);
      const [y, m] = isoOfDay(zero + day).split('-').map(Number);
      for (const part of [0, 0.25, 0.5, 0.75]) {
        const at = day + part;
        if (at > lastDay) continue;
        const words = wordsAt(made, at);
        if (y === lunar.year) {
          expect(words.year, isoOfDay(zero + day)).toBe(`${lunar.name}（${lunar.year}）`);
          continue;
        }
        if (part === 0) tailDays += 1;
        const i = stretchIndexAt(made, at);
        const item = REAL.stretches[i];
        // 这个月落在这个农历年里的那一截：从公历这一年的元旦（这个月的头一天）到这个月的最后一天（这个农历年的最后一天）
        const partFirst = Math.max(julianDay(y, m, 1), julianDay(lunar.year + 1, 1, 1));
        const partLast = Math.min((m === 12 ? julianDay(y + 1, 1, 1) : julianDay(y, m + 1, 1)) - 1, lunar.last);
        const held = (latestOf(item.start) as number) <= partLast && (earliestOf(item.end) as number) >= partFirst;
        pairs.set(`${item.id}|${y}-${m}`, { stretch: i, year: y, month: m, held });
        expect(words.year, `${item.id} ${isoOfDay(zero + day)}`).toBe(held ? `${lunar.name}（${y}年${m}月）` : `${lunar.name}（${lunar.year}）`);
        expect(words.spoken.startsWith(held ? `${lunar.name}，${y} 年 ${m} 月，` : `${lunar.name}，${lunar.year} 年，`), `${item.id} ${isoOfDay(zero + day)}`).toBe(true);
      }
    }
    // 工具列出来的就是这些，一对不多、一对不少，担保得了担保不了也一样
    const listed = westernMonths(REAL);
    expect(listed.map((pair) => `${REAL.stretches[pair.stretch].id}|${pair.year}-${pair.month}|${pair.held}`).sort()).toEqual([...pairs].map(([key, pair]) => `${key}|${pair.held}`).sort());
    // 做出来的那一份里，每一段的 plainMonths 正好是它担保不了的那几个月；别的段没有这一样
    const unheld = [...pairs.values()].filter((pair) => !pair.held);
    made.stretches.forEach((entry, i) => {
      const mine = unheld.filter((pair) => pair.stretch === i).map((pair) => [pair.year, pair.month]);
      expect(entry.plainMonths ?? [], entry.id).toEqual(mine);
      expect('plainMonths' in entry, entry.id).toBe(mine.length > 0);
    });
    expect(unheld.length).toBeGreaterThan(0);
    expect(pairs.size).toBeGreaterThan(unheld.length);
    console.log(`一生里农历年末、公历已经是下一年的有 ${tailDays} 天；一段碰到一个这样的月份算一对，一共 ${pairs.size} 对，担保不了的 ${unheld.length} 对：${unheld.map((pair) => `${REAL.stretches[pair.stretch].id}（${REAL.stretches[pair.stretch].label}）${pair.year} 年 ${pair.month} 月`).join('，')}`);
  });

  it('把一个离开的日子收到“一定在那个月以后”，那个月就担保得了了：plainMonths 里不再有它', () => {
    const before = westernMonths(REAL).filter((pair) => !pair.held);
    expect(before.length).toBeGreaterThan(0);
    const first = before[0];
    const id = REAL.stretches[first.stretch].id;
    // 这一段的头尾都改成精确到日：开始在那个月以前，结束在那个月以后
    const copy = copyOf();
    const i = copy.stretches.findIndex((item) => item.id === id);
    const pin = (moment: ItineraryMoment, day: number): void => {
      const [y, m, d] = isoOfDay(day).split('-').map(Number);
      Object.assign(moment, { precision: 'day', year: y, month: m, day: d });
      for (const key of ['earliest', 'latest', 'earliestIs', 'latestIs', 'sharesWindow'] as const) delete moment[key];
    };
    const start = earliestOf(copy.stretches[i].start) as number;
    const end = latestOf(copy.stretches[i].end) as number;
    pin(copy.stretches[i].start, start);
    if (i > 0) pin(copy.stretches[i - 1].end, start);
    pin(copy.stretches[i].end, end);
    if (i + 1 < copy.stretches.length) pin(copy.stretches[i + 1].start, end);
    const after = westernMonths(copy).filter((pair) => pair.stretch === first.stretch);
    expect(after.length).toBeGreaterThan(0);
    // 头尾都是那一天了：这一段碰到的月份里，它一定已经开始、一定还没结束
    for (const pair of after) expect(pair.held, `${id} ${pair.year}-${pair.month}`).toBe(true);
  });
});

describe('小像站到线上的一处，旁边立出那一处的名字：名字是手写在行迹里的', () => {
  /** 抄本里的一段的 tablePoint（要是“线上的一处”）。 */
  const spotOf = (copy: Itinerary, id: string) => {
    const item = stretch(copy, id);
    if (item.kind !== 'elsewhere' || item.tablePoint.type !== 'way-vertex') throw new Error(`${id} 不是线上的一处`);
    return item.tablePoint;
  };

  it('name 要就是 where 开头的那个地名；今名只在 where 的括号里写了“今某省某地”的时候有，是它去掉省名', () => {
    // 名字写得同 where 不一样
    expect(problems((copy) => (spotOf(copy, 't09').name = '凤翔府'))).toEqual([expect.stringContaining('name 写的是“凤翔府”，where 开头的地名是“凤翔”')]);
    // where 里写着今名，却没有抄
    expect(problems((copy) => { delete spotOf(copy, 't45').modern; })).toEqual([expect.stringContaining('where 里写着“今安徽阜阳”，tablePoint 却没有写 modern')]);
    // 今名不是 where 里那个地名的末尾、多了字
    expect(problems((copy) => (spotOf(copy, 't45').modern = '阜阳市'))).toEqual([expect.stringContaining('今名写的是“阜阳市”，where 里写的是“今安徽阜阳”')]);
    expect(problems((copy) => (spotOf(copy, 't59').modern = '江西'))).toEqual([expect.stringContaining('今名写的是“江西”，where 里写的是“今江西赣州”')]);
    expect(problems((copy) => (spotOf(copy, 't59').modern = ' '))).toEqual([expect.stringContaining('今名写的是“ ”')]);
    // where 里没有写今名的，不另去查一个来写
    expect(problems((copy) => (spotOf(copy, 't09').modern = '宝鸡'))).toEqual([expect.stringContaining('今名只照 where 里写的抄，没有写的不写，不另去查')]);
    // 少了 name：格式就通不过
    expect(problems((copy) => { delete (spotOf(copy, 't47') as { name?: string }).name; }).length).toBeGreaterThan(0);
  });

  it('真的那一份里的每一处：名字就是 where 开头的地名；where 里有“今……”的才有今名（各处印出来）；工具把它们带进时间轴用的那一份', () => {
    const made = projectItinerary(REAL, FIGURE);
    const lines: string[] = [];
    let withModern = 0;
    for (const item of REAL.stretches) {
      if (item.kind !== 'elsewhere' || item.tablePoint.type !== 'way-vertex') continue;
      const point = item.tablePoint;
      expect(point.name, item.id).toBe(spotTown(item.where));
      const today = /今([^，,。）)]+)/u.exec(item.where)?.[1];
      expect(point.modern === undefined, item.id).toBe(today === undefined);
      if (point.modern !== undefined) {
        withModern += 1;
        expect(today?.endsWith(point.modern), item.id).toBe(true);
        expect(point.modern, item.id).not.toBe(point.name);
      }
      // 做出来的那一份：这一段的 spot 是“哪条线、经纬度、名字”，有今名的再加今名
      const spot = made.stretches.find((entry) => entry.id === item.id)?.spot;
      expect(spot, item.id).toEqual(point.modern === undefined ? [point.way, point.at, point.name] : [point.way, point.at, point.name, point.modern]);
      lines.push(`${item.id} ${point.name}${point.modern ? `（今名 ${point.modern}）` : ''}`);
    }
    expect(lines.length).toBeGreaterThan(0);
    expect(withModern).toBeGreaterThan(0);
    expect(withModern).toBeLessThan(lines.length);
    console.log(`线上平时没有立名字的各处，他站到那里的时候旁边立出的名字：${lines.join('，')}`);
  });
});
