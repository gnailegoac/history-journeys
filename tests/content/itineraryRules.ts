// 行迹的校验规则：docs/data-spec.md“行迹”一节和校验规则 22。
// rules.ts 校验一位人物的时候把他的 itinerary.json 交到这里（validateItinerary）；格式是 0，别的都是规则 22。
// 规则 22 分十句，一句一个函数，先后和 data-spec.md 里写的一样：
//   一 链（checkItineraryChain）      二 对得上（checkItineraryIds）    三 精度（checkItineraryPrecision）
//   四 出处（checkItinerarySources）   五 路（checkItineraryRoads）      六 第一行说的是真话（checkItineraryHonesty）
//   七 站（checkItineraryStops）       八 两行字（checkItineraryWords）   九 农历年的表（checkItineraryYears）
//   十 时间轴用的那一份（checkItineraryBar）
// 全是纯函数：输入是读进内存的行迹、人物资料和全程沙盘的场景，输出是不合规格的地方。不读磁盘，也不依赖测试框架。
// 头尾放在哪一天、时间轴用的那一份怎么做，用的是工具的同一份（tests/support/itineraryTool.ts），这里不另写。

import type { Itinerary, ItineraryMoment, ItineraryStretch } from '../../src/domain/itinerary';
import { ROUTE_SCENE_ID } from '../../src/domain/scene';
import type { RouteScene } from '../../src/domain/scene';
import { routeCoords } from '../../src/domain/sceneGeoRoute';
import type { Figure, LngLat } from '../../src/domain/types';
import {
  barText,
  boundaries,
  boundaryName,
  boundaryNumbers,
  dayOfIso,
  doubtCarrier,
  earliestOf,
  isoOfDay,
  latestOf,
  legPoints,
  lookOf,
  lunarYearOf,
  lunarYears,
  projectItinerary,
} from '../support/itineraryTool';
import type { LunarYear } from '../support/itineraryTool';
import { checkRouteShape, isRouteLevel } from './routeRules';
import { anything, bool, checkShape, has, list, lngLat, numberIn, oneOf, optional, readJson, strict, tagged, text, violation } from './shape';
import type { ContentFiles, Shape, Violation } from './shape';

/** 规则的号码（rules.ts 的 RULE_NAMES 里第 22 项，名字是“行迹”）。 */
export const ITINERARY_RULE = 22;
/** 手写的那一份、工具做的那一份，在一位人物的文件夹里叫什么。 */
export const ITINERARY_FILE = 'itinerary.json';
export const ITINERARY_BAR_FILE = 'itinerary.bar.json';

/** 时间轴第一行的“在哪”最多几个字；落在一站讲的年月里的最多几个字（那里第一行右边还有进这一站的入口）。 */
export const LABEL_MAX = 10;
export const LABEL_IN_GROUP_MAX = 7;
/** 时间轴第二行的一句话最多几个字（最窄的沙盘栏上一行放得下）。 */
export const SAYS_MAX = 32;
/** 精度是“月”的范围最多几天（一个月，或者“四月或五月”这样的两个月）；“季”的最多几天（三个月加一个闰月）。 */
export const MONTH_MAX_DAYS = 60;
export const SEASON_MAX_DAYS = 120;
/** 路上有位置的一处，离这一段走的线最远多少公里（沿河的水路画在河的一边，离河最多 15 公里）。 */
export const WAYPOINT_MAX_KM = 25;
/** 在一条线上、没有立名字的地方，离那条线最远多少公里。 */
export const SPOT_MAX_KM = 15;
/** 在路上、到的日子又不精确到日的一段，超过多少天要写 longRoad。 */
export const LONG_ROAD_DAYS = 93;
/** 一个农历年有多少天：十二个月的 353、354、355 天，有闰月的 383、384、385 天。别的天数都是哪一个正月初一写错了。 */
export const LUNAR_YEAR_DAYS: readonly number[] = [353, 354, 355, 383, 384, 385];
/** 一个农历年最长多少天（出生、去世的日子离表的头尾“不到一年”，照它算）。 */
export const LUNAR_YEAR_MAX_DAYS = 385;
/** 句子里缩短一个日子的写法时不许删掉的词：删了它，说出来的就比史料知道的还细。 */
export const KEPT_WORDS = ['以前', '以后', '或', '之间', '初'] as const;
/**
 * 第二行里，一个日子的前面、后面紧挨着的那个字只能是这几个（前面是句子的开头也行）。
 * 日子旁边添一个字（“四月初离开”“四月底”“二月一日前后”“四月（1084）”），说出来的就不是史料的那个日子了；
 * 这两张单子是照真的句子定的，要添字先看添了以后句子说的还是不是那个日子。
 */
export const BEFORE_DATE = '：，；。在';
export const AFTER_DATE = '到离出在过回被坐因快动，；';
/** 路上的一句话的开头；沙盘上没有他的一句话，头一个半句里要有的。 */
export const ROAD_OPENING = '匀着走的：';
export const ABSENT = /沙盘上没有他|所以没有他/;
export const ABSENT_WITHIN = 17;
/** 站在一条线上、沙盘平时没有立名字的地方的一句话里不许再有的：他站到那里的时候，旁边立着那一处的名字。 */
export const NO_NAME = /没有立.*的名字/u;
/** 今名比 where 里“今”后面的那个地名最多少几个字（去掉的是省名：“安徽阜阳”写“阜阳”）。 */
export const PROVINCE_MAX = 3;

// ---------------------------------------------------------------- 格式

const whole = numberIn({ whole: true });
const SOURCE_BASES = ['own-words', 'record', 'later'];
const PRECISIONS = ['day', 'month', 'season', 'year', 'before', 'after', 'not-found'];
const CLASSES = ['text', 'schematic'];

const MOMENT = strict({
  text,
  year: whole,
  precision: oneOf(PRECISIONS),
  month: optional(numberIn({ min: 1, max: 12, whole: true })),
  day: optional(numberIn({ min: 1, max: 31, whole: true })),
  earliest: optional(text),
  latest: optional(text),
  earliestIs: optional(text),
  latestIs: optional(text),
  sharesWindow: optional(strict({ order: numberIn({ min: 1, whole: true }), of: numberIn({ min: 2, whole: true }) })),
});
const WAYPOINT = strict({ name: text, at: optional(lngLat), date: optional(MOMENT), sourceIds: list(text), note: text, unsure: optional(text) });
const PART = strict({ name: text, ways: list(text), class: oneOf(CLASSES), partial: optional(bool) });
const TABLE_POINT = tagged('type', {
  'stop-point': strict({ type: text, place: text }),
  place: strict({ type: text, place: text }),
  'way-vertex': strict({ type: text, way: text, at: lngLat, name: text, modern: optional(text), note: optional(text) }),
  'edge-strip': strict({ type: text, strip: text, at: lngLat }),
  'on-ways': strict({ type: text, ways: list(text), note: text }),
  none: strict({ type: text }),
});
/** 每一段都有的几样。stopYearsOf 是站的 id 或者 null，另查。 */
const STRETCH_BASE = {
  id: text,
  kind: text,
  stopYearsOf: anything,
  start: MOMENT,
  end: MOMENT,
  sourceIds: list(text),
  class: oneOf(CLASSES),
  unsure: text,
  note: optional(text),
  longRoad: optional(text),
  label: text,
  says: text,
  saysDates: list(strict({ of: text, text })),
  waypoints: optional(list(WAYPOINT)),
};
const STRETCH = tagged('kind', {
  stop: strict({ ...STRETCH_BASE, stop: text, place: text }),
  road: strict({ ...STRETCH_BASE, journey: text, from: text, to: text, parts: list(PART) }),
  elsewhere: strict({ ...STRETCH_BASE, where: text, moving: bool, tablePoint: TABLE_POINT }),
});
const WORDS = strict({ label: text, says: text, saysDates: list(strict({ of: text, text })) });

/** 手写的那一份的样子。不认识的字段通不过。about 是给写数据的人看的说明，里面写什么不管。 */
const ITINERARY: Shape = strict({
  about: anything,
  sources: list(strict({ id: text, basis: oneOf(SOURCE_BASES), cite: text, read: text })),
  years: list(strict({ year: whole, name: text, newYear: anything, age: whole })),
  stretches: list(STRETCH),
  first: WORDS,
  last: WORDS,
});

/** 行迹的格式：字段齐全、类型对、没有不认识的字段；另查两处样子表里写不出来的（可以是 null 的两个字段）。 */
export function checkItineraryShape(data: unknown, file: string): Violation[] {
  const out = checkShape(data, ITINERARY, file);
  if (out.length > 0) return out;
  const itinerary = data as Itinerary;
  itinerary.stretches.forEach((stretch, i) => {
    const group: unknown = stretch.stopYearsOf;
    if (group !== null && typeof group !== 'string') out.push(violation(0, file, `stretches[${i}].stopYearsOf`, '应该是一站的 id（写在双引号里），不在哪一站讲的年月里写 null'));
  });
  itinerary.years.forEach((row, i) => {
    const written: unknown = row.newYear;
    if (written !== null && typeof written !== 'string') out.push(violation(0, file, `years[${i}].newYear`, '应该是正月初一的公元日子（“1080-01-25”这样写），出生的那一年写 null'));
  });
  return out;
}

// ---------------------------------------------------------------- 小东西

const bad = (file: string, field: string, problem: string): Violation => violation(ITINERARY_RULE, file, field, problem);
const count = (written: string): number => [...written].length;
/** 两样东西是不是一字不差（字段的先后不算）。 */
function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a).sort();
  const kb = Object.keys(b).sort();
  return ka.length === kb.length && ka.every((key, i) => key === kb[i] && same((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]));
}
/** 一段在文件里的位置，和给人看的叫法。 */
const at = (i: number): string => `stretches[${i}]`;
/** 这一段是不是在路上（画出来的一趟路，或者“别的”里写了 moving 的）。 */
const moving = (stretch: ItineraryStretch): boolean => stretch.kind === 'road' || (stretch.kind === 'elsewhere' && stretch.moving);
/** 一截路的写法：去掉前面表示“倒着走”的减号。 */
const wayRef = (written: string): { id: string; reversed: boolean } => (written.startsWith('-') ? { id: written.slice(1), reversed: true } : { id: written, reversed: false });
/** “别的”一段站在一条线上没有立名字的地方时，那个地方叫什么：where 开头到括号为止的那几个字。 */
export const spotTown = (where: string): string => where.split(/[（(]/)[0].trim();

/**
 * 数据里这一段说的是哪个地方（第一行的“在哪”里要有它）：住在一站的、站在有名字的地方的是地名点的名字，
 * 站在线上没有立名字的地方的是 where 开头的地名，路上的是 to；沙盘上没有他的各段不查。
 */
function namedPlace(stretch: ItineraryStretch, route: Pick<RouteScene, 'places'>): string | undefined {
  const placeName = (id: string): string | undefined => route.places.find((place) => place.id === id)?.name;
  if (stretch.kind === 'stop') return placeName(stretch.place);
  if (stretch.kind === 'road') return stretch.to;
  const point = stretch.tablePoint;
  if (point.type === 'stop-point' || point.type === 'place') return placeName(point.place);
  return point.type === 'way-vertex' ? spotTown(stretch.where) : undefined;
}

// ---------------------------------------------------------------- 日子的写法拆成一截一截

/**
 * 史料里一个日子的写法，拆开来是这几种东西：年号（era）、第几年（year，“六年”“元年”）、几月（month，“十一月”“闰八月”“正月”）、
 * 哪一天（day，“十九日”“初一”“除夜”“元日”“晦日”）、季（season）、不许删的词（kept，见 KEPT_WORDS），别的字一个字一截（other）。
 * 数字连着它的单位是一截：“二十八日”拆不出“八日”，“十二月”拆不出“二月”。
 */
export interface DateToken {
  kind: 'era' | 'year' | 'month' | 'day' | 'season' | 'kept' | 'other';
  text: string;
}

const N = '[一二三四五六七八九十]';
const DATE_TOKEN_PATTERNS: [DateToken['kind'], RegExp][] = [
  ['kept', /^(?:以前|以后|之间|或)/u],
  ['day', /^(?:除夜|除夕|元日|晦日)/u],
  ['day', new RegExp(`^初${N}`, 'u')],
  ['year', new RegExp(`^(?:元|${N}{1,3})年`, 'u')],
  ['month', new RegExp(`^闰?(?:正|腊|${N}{1,2})月`, 'u')],
  ['day', new RegExp(`^${N}{1,3}日(?!子)`, 'u')],
  ['season', /^[春夏秋冬]/u],
  ['kept', /^初/u],
  ['era', new RegExp(`^\\p{Script=Han}{2,4}?(?=(?:元|${N}{1,3})年)`, 'u')],
];

/** 把一个日子的写法拆成一截一截（见 DateToken）。 */
export function dateTokens(written: string): DateToken[] {
  const out: DateToken[] = [];
  let rest = written;
  while (rest.length > 0) {
    let found: DateToken | null = null;
    for (const [kind, pattern] of DATE_TOKEN_PATTERNS) {
      const match = pattern.exec(rest);
      if (match && match[0].length > 0) {
        found = { kind, text: match[0] };
        break;
      }
    }
    const token = found ?? { kind: 'other' as const, text: [...rest][0] };
    out.push(token);
    rest = rest.slice(token.text.length);
  }
  return out;
}

/** “以前”“以后”挂在哪一种东西上：它前面最近的一截年、月、日、季。 */
const HANGS_ON: readonly DateToken['kind'][] = ['year', 'month', 'day', 'season'];

/** 史料的写法末一个字是季节（“嘉祐元年春”）：只知道是哪一季。这样的日子精度只能是这几种。 */
const SEASON_END = /[春夏秋冬]$/u;
const SEASON_PRECISIONS: readonly string[] = ['season', 'before', 'after'];

/** 不带月份也说得出是哪一天的写法（一年的最后一天、头一天）。 */
const WHOLE_DAY = ['除夜', '除夕', '元日'];

/**
 * 一个写法是不是说到了“哪一天”，而且别的什么也没说：年号、第几年、几月、哪一天，一样不多；
 * 不带月份的只能是“除夜”“元日”。“四月”“四月八日以后”“冬，三日”“四月或五月的二十二日”都不是。
 */
export function isDayText(written: string): boolean {
  const tokens = dateTokens(written);
  const kinds = tokens.map((token) => token.kind).join(' ');
  if (kinds === 'era year month day') return !WHOLE_DAY.includes(tokens[3].text);
  return kinds === 'era year day' && WHOLE_DAY.includes(tokens[2].text);
}

/** 行迹里所有的日子：在文件的哪里，是哪一个。链上的在前（头一段的 start，各段的 end），路上各处的在后。 */
function moments(itinerary: Itinerary): { field: string; moment: ItineraryMoment }[] {
  const out: { field: string; moment: ItineraryMoment }[] = [];
  itinerary.stretches.forEach((stretch, i) => {
    if (i === 0) out.push({ field: `${at(i)}.start`, moment: stretch.start });
    out.push({ field: `${at(i)}.end`, moment: stretch.end });
  });
  itinerary.stretches.forEach((stretch, i) => stretch.waypoints?.forEach((point, j) => point.date && out.push({ field: `${at(i)}.waypoints[${j}].date`, moment: point.date })));
  return out;
}

// ---------------------------------------------------------------- 一 链

/**
 * 规则 22 一 链：至少一段，id 不重复；每一段的 start 就是上一段的 end，一字不差（不留空、不重叠）；
 * 头一段从出生那天起、最后一段到去世那天止，都精确到日，公元年和 figure.json 的 years 两头一样；
 * 不精确到日的日子，最早、最晚哪一天两头都写了，最早不晚于最晚（只写一头不行：程序从不拿前后的日子替它补）；
 * 一个比一个晚（最早的一天、最晚的一天都不往回走）；范围一模一样的前后两个日子各写了 sharesWindow，先后连着数、总数一样；
 * 照 itineraryTool.ts 的四步放到时间轴上，一个比一个靠后；一个范围里最多一个正月初一，共用的范围里没有。
 */
export function checkItineraryChain(itinerary: Itinerary, file: string, figure: Pick<Figure, 'years'>): Violation[] {
  const out: Violation[] = [];
  const { stretches } = itinerary;
  if (stretches.length === 0) return [bad(file, 'stretches', '一段也没有')];
  stretches.forEach((stretch, i) => {
    const first = stretches.findIndex((other) => other.id === stretch.id);
    if (stretch.id.trim() === '') out.push(bad(file, `${at(i)}.id`, '没有填 id'));
    else if (first < i) out.push(bad(file, `${at(i)}.id`, `id“${stretch.id}”和第 ${first + 1} 段重复了`));
    if (i > 0 && !same(stretches[i - 1].end, stretch.start)) {
      out.push(bad(file, `${at(i)}.start`, `“${stretch.id}”的 start 和上一段“${stretches[i - 1].id}”的 end 不是同一个日子：一段接一段，上一段到哪一天，这一段就从哪一天起，要一字不差`));
    }
  });

  const chain = boundaries(itinerary);
  const name = (i: number): string => boundaryName(itinerary, i);
  const field = (i: number): string => (i === 0 ? `${at(0)}.start` : `${at(i - 1)}.end`);
  const [bornYear, diedYear] = (figure.years.match(/\d{4}/g) ?? []).map(Number);
  const ends: [number, string, number | undefined][] = [
    [0, '头一段要从他出生的那一天起', bornYear],
    [chain.length - 1, '最后一段要到他去世的那一天止', diedYear],
  ];
  for (const [i, what, year] of ends) {
    if (chain[i].precision !== 'day') out.push(bad(file, field(i), `${what}，精确到日；现在的精度是 ${chain[i].precision}`));
    else if (year !== undefined && chain[i].year !== year) out.push(bad(file, field(i), `${what}：figure.json 的 years 写的是 ${year} 年，这里是 ${chain[i].year} 年`));
  }

  const lo = chain.map(earliestOf);
  const hi = chain.map(latestOf);
  chain.forEach((moment, i) => {
    const [a, b] = [lo[i], hi[i]];
    if (a === null || b === null) return; // 没有写全：下面 boundaryNumbers 会说
    if (a > b) out.push(bad(file, field(i), `“${moment.text}”最早的一天（${isoOfDay(a)}）比最晚的一天（${isoOfDay(b)}）还晚`));
    const [pa, pb] = [lo[i - 1], hi[i - 1]];
    if (i > 0 && pa !== null && pa !== undefined && a < pa) out.push(bad(file, field(i), `“${moment.text}”最早的一天（${isoOfDay(a)}）比上一个日子最早的一天（${isoOfDay(pa)}）还早`));
    if (i > 0 && pb !== null && pb !== undefined && b < pb) out.push(bad(file, field(i), `“${moment.text}”最晚的一天（${isoOfDay(b)}）比上一个日子最晚的一天（${isoOfDay(pb)}）还早`));
    // 范围一模一样的前后两个日子：要写明谁先谁后
    const sameAsPrevious = i > 0 && a !== b && lo[i - 1] === a && hi[i - 1] === b;
    if (sameAsPrevious && !(moment.sharesWindow && chain[i - 1].sharesWindow)) {
      out.push(bad(file, field(i), `${name(i)} 和 ${name(i - 1)} 的范围一模一样（${isoOfDay(a)} 到 ${isoOfDay(b)}）：两个都要写 sharesWindow，说明谁先谁后`));
    }
    if (moment.sharesWindow) {
      const { order, of } = moment.sharesWindow;
      const mate = order === 1 ? i + 1 : i - 1;
      const other = chain[mate];
      if (order > of) out.push(bad(file, `${field(i)}.sharesWindow`, `order（${order}）不能比 of（${of}）大`));
      else if (!other || lo[mate] !== a || hi[mate] !== b || !other.sharesWindow || other.sharesWindow.of !== of || other.sharesWindow.order !== order + (order === 1 ? 1 : -1)) {
        out.push(bad(file, `${field(i)}.sharesWindow`, `${name(i)} 写了 sharesWindow，可它${order === 1 ? '后面' : '前面'}的日子范围不一样，或者没有接着数（第 ${order} 个的旁边要是第 ${order + (order === 1 ? 1 : -1)} 个，of 一样）`));
      }
    }
  });

  const { numbers, problems } = boundaryNumbers(itinerary);
  for (const { index, problem } of problems) out.push(bad(file, field(index), `“${chain[index].text}”${problem}`));
  for (let i = 1; i < numbers.length; i++) {
    if (Number.isNaN(numbers[i]) || Number.isNaN(numbers[i - 1])) continue;
    if (!(numbers[i] > numbers[i - 1])) out.push(bad(file, field(i), `${name(i)} 在时间轴上不比 ${name(i - 1)} 靠后（都落在 ${isoOfDay(numbers[i])} 前后）：这一段在时间轴上没有地方`));
  }
  return out;
}

// ---------------------------------------------------------------- 二 对得上

/**
 * 规则 22 二 对得上：站（stop、stopYearsOf）是 figure.json 里有的；在一站住着的一段，stopYearsOf 就是这一站，
 * place 是全程沙盘上 stops 里写着这一站的地名点；“别的”一段的 tablePoint：stop-point 指的是有 stops 的地名点，
 * place 指的是没有 stops、立了题签的地名点，way-vertex 的 way 是场景里的一截路、at 在沙盘里面、离那截路不超过 15 公里，
 * name 就是 where 开头的那个地名（小像站到那里的时候，旁边立出这个名字），modern 只在 where 的括号里写了“今某省某地”的时候有、是它去掉省名；
 * 而且沙盘上确实没有立这个地方的名字（场景里没有哪一条题签的古名、今名是它，也没有哪一条指着地名点的题签的名字套着它、被它套着，
 * 它离哪一个立了题签的地名点都超过 15 公里：不然小像旁边立出来的名字就同原来的题签重了，一个地方两个名字）；
 * edge-strip 的 strip 是指着远处的一条题签，on-ways 写的路都找得到；saysDates 的 of 是 start、end，或者这一段路上有日子的一处（“wp:名字”）；
 * first 的 saysDates 只能指 start（头一段的），last 的只能指 end（最后一段的）。
 */
export function checkItineraryIds(itinerary: Itinerary, file: string, figure: Pick<Figure, 'stops'>, route: RouteScene): Violation[] {
  const out: Violation[] = [];
  const stops = figure.stops.map((stop) => stop.id);
  const place = (id: string) => route.places.find((item) => item.id === id);
  const coords = routeCoords(route.frame);
  itinerary.stretches.forEach((stretch, i) => {
    const what = `“${stretch.id}”`;
    if (stretch.stopYearsOf !== null && !stops.includes(stretch.stopYearsOf)) out.push(bad(file, `${at(i)}.stopYearsOf`, `${what}写的站“${stretch.stopYearsOf}”在 figure.json 里找不到`));
    if (stretch.kind === 'stop') {
      if (!stops.includes(stretch.stop)) out.push(bad(file, `${at(i)}.stop`, `${what}写的站“${stretch.stop}”在 figure.json 里找不到`));
      if (stretch.stopYearsOf !== stretch.stop) out.push(bad(file, `${at(i)}.stopYearsOf`, `${what}住在“${stretch.stop}”这一站，stopYearsOf 也要写这一站`));
      const found = place(stretch.place);
      if (!found) out.push(bad(file, `${at(i)}.place`, `${what}写的地名点“${stretch.place}”在全程沙盘（scenes/${ROUTE_SCENE_ID}.json）里找不到`));
      else if (!(found.stops ?? []).includes(stretch.stop)) out.push(bad(file, `${at(i)}.place`, `地名点“${stretch.place}”的 stops 里没有“${stretch.stop}”这一站：小像会站到别的站上去`));
    }
    if (stretch.kind === 'elsewhere') {
      const point = stretch.tablePoint;
      const field = `${at(i)}.tablePoint`;
      if (point.type === 'stop-point' || point.type === 'place') {
        const found = place(point.place);
        if (!found) out.push(bad(file, `${field}.place`, `${what}写的地名点“${point.place}”在全程沙盘里找不到`));
        else if (point.type === 'stop-point' && (found.stops ?? []).length === 0) out.push(bad(file, `${field}.type`, `地名点“${point.place}”不是哪一站的点，type 该写 place`));
        else if (point.type === 'place' && (found.stops ?? []).length > 0) out.push(bad(file, `${field}.type`, `地名点“${point.place}”是一站的点，type 该写 stop-point`));
        else if (point.type === 'place' && !route.strips.some((strip) => strip.of === point.place)) out.push(bad(file, `${field}.place`, `地名点“${point.place}”在沙盘上没有立题签：小像站在那里，读者找不到这个名字`));
      }
      if (point.type === 'way-vertex') {
        const way = route.roads.ways.find((item) => item.id === point.way);
        if (!way) out.push(bad(file, `${field}.way`, `${what}写的路“${point.way}”在全程沙盘的 roads.ways 里找不到`));
        else {
          const km = (lineDistance(coords.toLocal(point.at), way.line.map((p) => coords.toLocal(p))).distance * route.frame.scale) / 1000;
          if (!coords.inside(point.at)) out.push(bad(file, `${field}.at`, `${what}的位置 [${point.at[0]}, ${point.at[1]}] 在沙盘外面`));
          else if (km > SPOT_MAX_KM) out.push(bad(file, `${field}.at`, `${what}的位置离路“${point.way}”有 ${Math.round(km)} 公里，不能超过 ${SPOT_MAX_KM} 公里：沙盘上没有画到那里的线，小像不能站在那里（type 改成 none，句子说“沙盘上没有他”）`));
        }
        const town = spotTown(stretch.where);
        // 他站到那里的时候旁边立出来的名字：就是 where 开头的那个地名；今名只在 where 的括号里写了“今某省某地”的时候有，是它去掉省名
        if (point.name !== town) out.push(bad(file, `${field}.name`, `${what}的 name 写的是“${point.name}”，where 开头的地名是“${town}”：小像旁边立出来的名字要就是这个地方的名字`));
        const today = /今([^，,。）)]+)/u.exec(stretch.where)?.[1];
        if (point.modern !== undefined) {
          if (today === undefined) out.push(bad(file, `${field}.modern`, `${what}写了今名“${point.modern}”，可 where 里没有写“今某地”：今名只照 where 里写的抄，没有写的不写，不另去查`));
          else if (point.modern.trim() === '' || !today.endsWith(point.modern) || today.length - point.modern.length > PROVINCE_MAX) out.push(bad(file, `${field}.modern`, `${what}的今名写的是“${point.modern}”，where 里写的是“今${today}”：今名是它去掉省名（“安徽阜阳”写“阜阳”），别的字不动`));
        } else if (today !== undefined) out.push(bad(file, `${field}.modern`, `${what}的 where 里写着“今${today}”，tablePoint 却没有写 modern：读者选了“今名”的时候，小像旁边要立出今名（去掉省名）`));
        const standing = route.strips.find((strip) => strip.text === town || strip.modern === town);
        // 名字不一样、其实是同一个地方的也算：一个名字套着另一个（“汴京城外”和“汴京”），或者就在立了题签的地名点旁边。
        // 只同指着地名点的题签比：海、江、湖的题签（“海”）不是哪个镇的名字，“海陵”里有个“海”字不算
        const akin = route.strips
          .filter((strip) => route.places.some((item) => item.id === strip.of))
          .find((strip) => [strip.text, strip.modern].some((name) => name !== undefined && name !== '' && town !== '' && (town.includes(name) || name.includes(town))));
        const beside = route.places
          .filter((item) => route.strips.some((strip) => strip.of === item.id))
          .map((item) => ({ item, km: (Math.hypot(coords.toLocal(item.at)[0] - coords.toLocal(point.at)[0], coords.toLocal(item.at)[1] - coords.toLocal(point.at)[1]) * route.frame.scale) / 1000 }))
          .find(({ km }) => km <= SPOT_MAX_KM);
        if (standing) out.push(bad(file, `${field}.type`, `全程沙盘上已经立了“${town}”的题签（${standing.id}）：${what}就不是“线上没有立名字的地方”了。tablePoint 改成 place（是一站的点就写 stop-point）：不然他站到那里，旁边又立出一条“${town}”，一个名字立了两回`));
        else if (akin) out.push(bad(file, `${field}.type`, `全程沙盘上立着题签“${akin.text}”${akin.modern ? `（今名“${akin.modern}”）` : ''}（${akin.id}），和“${town}”是一个名字套着另一个：小像站在那条题签旁边，旁边又立出“${town}”，一个地方成了两个名字。tablePoint 改成 place（是一站的点就写 stop-point）`));
        else if (beside) out.push(bad(file, `${field}.at`, `${what}的位置离立了题签的地名点“${beside.item.name}”只有 ${Math.round(beside.km)} 公里（不超过 ${SPOT_MAX_KM} 公里的都算在它旁边）：小像站在那条题签旁边，旁边又立出“${town}”，一个地方成了两个名字。tablePoint 改成 place（是一站的点就写 stop-point）`));
      }
      if (point.type === 'edge-strip') {
        const strip = route.strips.find((item) => item.id === point.strip);
        if (!strip) out.push(bad(file, `${field}.strip`, `${what}写的题签“${point.strip}”在全程沙盘里找不到`));
        else if (!route.far.some((far) => far.id === strip.of)) out.push(bad(file, `${field}.strip`, `题签“${point.strip}”指的不是远处的地方`));
      }
      if (point.type === 'on-ways') {
        point.ways.forEach((written, j) => {
          if (!route.roads.ways.some((item) => item.id === wayRef(written).id)) out.push(bad(file, `${field}.ways[${j}]`, `${what}写的路“${written}”在全程沙盘的 roads.ways 里找不到`));
        });
      }
    }
    stretch.saysDates.forEach((entry, j) => {
      if (momentOf(stretch, entry.of) === null) out.push(bad(file, `${at(i)}.saysDates[${j}].of`, `${what}的 saysDates 指的“${entry.of}”找不到：只能是 start、end，或者这一段路上有日子的一处（wp:名字）`));
    });
  });
  itinerary.first.saysDates.forEach((entry, j) => {
    if (entry.of !== 'start') out.push(bad(file, `first.saysDates[${j}].of`, `最前一个位置的 saysDates 只能指 start（头一段开始的那个日子），现在是“${entry.of}”`));
  });
  itinerary.last.saysDates.forEach((entry, j) => {
    if (entry.of !== 'end') out.push(bad(file, `last.saysDates[${j}].of`, `最后一个位置的 saysDates 只能指 end（最后一段结束的那个日子），现在是“${entry.of}”`));
  });
  return out;
}

/** saysDates 的 of 指的那个日子；找不到是 null。 */
function momentOf(stretch: ItineraryStretch, of: string): ItineraryMoment | null {
  if (of === 'start') return stretch.start;
  if (of === 'end') return stretch.end;
  if (!of.startsWith('wp:')) return null;
  return stretch.waypoints?.find((point) => point.name === of.slice(3))?.date ?? null;
}

/** 沙盘里的一点离一条线多远（沙盘里的米），最近的地方在线上走了多远。 */
function lineDistance(p: [number, number], line: [number, number][]): { distance: number; along: number } {
  let best = Infinity;
  let along = 0;
  let run = 0;
  for (let i = 0; i + 1 < line.length; i++) {
    const [ax, az] = line[i];
    const [bx, bz] = line[i + 1];
    const length = Math.hypot(bx - ax, bz - az);
    const t = length === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - ax) * (bx - ax) + (p[1] - az) * (bz - az)) / (length * length)));
    const d = Math.hypot(p[0] - (ax + t * (bx - ax)), p[1] - (az + t * (bz - az)));
    if (d < best) {
      best = d;
      along = run + t * length;
    }
    run += length;
  }
  return { distance: best, along };
}

// ---------------------------------------------------------------- 三 精度

/**
 * 规则 22 三 精度（不编日子）：精确到日的写了 month、day，是历法上有的一天，不写范围，
 * 史料的写法（text）自己就说到了哪一天——年号、第几年、几月、哪一天（“十九日”“初一”“晦日”），或者“除夜”“元日”，别的什么也不带；
 * 写法里只有月份、季节，或者带着“以前、以后、或、之间、没有查到”的，精度不许写 day（那一天是编的）；
 * 不精确到日的不许写 month、day，最早、最晚两头都写了、写法对，范围不止一天（只有一天的该写成 day），
 * 写法自己已经说到哪一天的，精度就该是 day；写法末一个字是“春夏秋冬”的（只说到季节），精度只能是 season、before、after；
 * “月”的范围不超过 60 天，“季”的不超过 120 天；
 * year 是最早那一天的公元年；精度是“没有查到”的，text 里写着“没有查到”。链上的日子和路上各处的日子都查。
 */
export function checkItineraryPrecision(itinerary: Itinerary, file: string): Violation[] {
  const out: Violation[] = [];
  for (const { field, moment } of moments(itinerary)) {
    const what = `“${moment.text}”`;
    if (moment.text.trim() === '') out.push(bad(file, `${field}.text`, '没有写史料的写法'));
    if (moment.precision === 'day') {
      if (moment.month === undefined || moment.day === undefined) out.push(bad(file, field, `${what}的精度是 day，要写 month、day（公元，儒略历）`));
      else if (earliestOf(moment) === null) out.push(bad(file, field, `${what}写的 ${moment.year} 年 ${moment.month} 月 ${moment.day} 日，历法上没有这一天`));
      for (const key of ['earliest', 'latest', 'earliestIs', 'latestIs'] as const) if (moment[key] !== undefined) out.push(bad(file, `${field}.${key}`, `${what}精确到日，不写范围（${key}）`));
      if (moment.text.trim() !== '' && !isDayText(moment.text)) {
        out.push(bad(file, `${field}.precision`, `${what}的精度写的是 day，可史料的写法里没有说到哪一天（要是“某年某月某日”“某年除夜”“某年元日”这样，不带“以前、以后、或、之间、没有查到”）：不编日子。只查到月份、季节的，精度照实写，另写范围（earliest、latest）`));
      }
      continue;
    }
    if (moment.month !== undefined || moment.day !== undefined) {
      out.push(bad(file, field, `${what}的精度是 ${moment.precision}，没有查到是哪一天，不能写 month、day：不编日子。只写范围（earliest、latest）`));
    }
    if (isDayText(moment.text)) out.push(bad(file, `${field}.precision`, `${what}的写法已经说到了哪一天，精度却是 ${moment.precision}：知道是哪一天，精度就写 day`));
    // 写法只说到季节的，范围不能悄悄收成一个月、一年
    if (SEASON_END.test(moment.text.trim()) && !SEASON_PRECISIONS.includes(moment.precision)) {
      out.push(bad(file, `${field}.precision`, `${what}的写法只说到季节，精度却是 ${moment.precision}：只知道是哪一季的，精度写 season（或者 before、after），范围照一季写`));
    }
    const lo = dayOfIso(moment.earliest);
    const hi = dayOfIso(moment.latest);
    for (const [key, n] of [['earliest', lo], ['latest', hi]] as const) {
      if (moment[key] === undefined) out.push(bad(file, `${field}.${key}`, `${what}不精确到日，范围的两头都要写；这一头没有写`));
      else if (n === null) out.push(bad(file, `${field}.${key}`, `“${moment[key]}”不是一个日子（写成“1084-05-08”这样，儒略历）`));
    }
    if (lo === null || hi === null) continue;
    const days = hi - lo + 1;
    if (days === 1) out.push(bad(file, field, `${what}的范围只有一天：知道是哪一天，精度就写 day`));
    if (moment.precision === 'month' && days > MONTH_MAX_DAYS) out.push(bad(file, field, `${what}的精度是 month，范围却有 ${days} 天，不能超过 ${MONTH_MAX_DAYS} 天`));
    if (moment.precision === 'season' && days > SEASON_MAX_DAYS) out.push(bad(file, field, `${what}的精度是 season，范围却有 ${days} 天，不能超过 ${SEASON_MAX_DAYS} 天`));
    if (moment.year !== Number(isoOfDay(lo).slice(0, 4))) out.push(bad(file, `${field}.year`, `${what}的 year 是 ${moment.year}，最早的一天却在 ${isoOfDay(lo).slice(0, 4)} 年`));
    if (moment.precision === 'not-found' && !moment.text.includes('没有查到')) out.push(bad(file, `${field}.text`, `${what}的精度是“没有查到”，写法里要明说“没有查到”`));
  }
  return out;
}

// ---------------------------------------------------------------- 四 出处

/**
 * 规则 22 四 出处：sources 里 id 不重复，cite、read 都写了；每一段、路上的每一处至少一个出处，写的都在 sources 里。
 */
export function checkItinerarySources(itinerary: Itinerary, file: string): Violation[] {
  const out: Violation[] = [];
  const ids = itinerary.sources.map((source) => source.id);
  itinerary.sources.forEach((source, i) => {
    if (ids.indexOf(source.id) < i) out.push(bad(file, `sources[${i}].id`, `出处的 id“${source.id}”重复了`));
    if (source.cite.trim() === '') out.push(bad(file, `sources[${i}].cite`, `出处“${source.id}”没有写是什么`));
    if (source.read.trim() === '') out.push(bad(file, `sources[${i}].read`, `出处“${source.id}”没有写读了什么（读了全文、只读了引文，还是没有读到原文）`));
  });
  const check = (written: string[], field: string, what: string): void => {
    if (written.length === 0) out.push(bad(file, field, `${what}没有出处：每一段、路上的每一处至少一个`));
    written.forEach((id, j) => {
      if (!ids.includes(id)) out.push(bad(file, `${field}[${j}]`, `${what}的出处“${id}”在 sources 里找不到`));
    });
  };
  itinerary.stretches.forEach((stretch, i) => {
    check(stretch.sourceIds, `${at(i)}.sourceIds`, `“${stretch.id}”`);
    stretch.waypoints?.forEach((point, j) => check(point.sourceIds, `${at(i)}.waypoints[${j}].sourceIds`, `“${stretch.id}”路上的“${point.name}”`));
  });
  return out;
}

// ---------------------------------------------------------------- 五 路

/**
 * 规则 22 五 路：路上的一段写的那一趟是全程沙盘里有的，stopYearsOf 是这一趟到的那一站；它的每一截名字、类别和场景里的那一截一样，
 * 走的路是那一截的全部，或者（写了 partial）其中连着的一段；同一趟的各段接起来，正好是场景里这一趟的每一截路，一截不多、一截不少、先后一样；
 * 全程沙盘里的每一趟都有人走；路上有位置的各处离这一段走的线不超过 25 公里，先后和走的方向一样；
 * 只有精确到日、又有位置的地方把路切成一程一程，它们的日子落在这一段的头尾之间，一个不比一个早；
 * 路上各处的日子，不早于这一段最早可能开始的那一天，不晚于最晚可能结束的那一天。
 */
export function checkItineraryRoads(itinerary: Itinerary, file: string, route: RouteScene): Violation[] {
  const out: Violation[] = [];
  const coords = routeCoords(route.frame);
  const { numbers } = boundaryNumbers(itinerary);
  const walked = new Map<string, string[]>();

  itinerary.stretches.forEach((stretch, i) => {
    const what = `“${stretch.id}”`;
    // 路上各处的日子在这一段里
    const [from, until] = [earliestOf(stretch.start), latestOf(stretch.end)];
    stretch.waypoints?.forEach((point, j) => {
      if (!point.date) return;
      const [a, b] = [earliestOf(point.date), latestOf(point.date)];
      if (a === null || b === null || from === null || until === null) return;
      if (a < from || b > until) out.push(bad(file, `${at(i)}.waypoints[${j}].date`, `${what}路上的“${point.name}”（${point.date.text}）不在这一段的日子里（${isoOfDay(from)} 到 ${isoOfDay(until)}）`));
    });
    if (stretch.kind !== 'road') return;

    const journey = route.roads.journeys.find((item) => item.id === stretch.journey);
    if (!journey) {
      out.push(bad(file, `${at(i)}.journey`, `${what}写的这一趟“${stretch.journey}”在全程沙盘的 roads.journeys 里找不到`));
      return;
    }
    if (stretch.stopYearsOf !== journey.stop) out.push(bad(file, `${at(i)}.stopYearsOf`, `${what}走的是到“${journey.stop}”这一站的路，stopYearsOf 要写这一站（现在是 ${stretch.stopYearsOf === null ? 'null' : `“${stretch.stopYearsOf}”`}）`));
    if (stretch.parts.length === 0) out.push(bad(file, `${at(i)}.parts`, `${what}一截也没有写`));
    stretch.parts.forEach((part, j) => {
      const field = `${at(i)}.parts[${j}]`;
      const original = journey.parts.find((item) => item.name === part.name);
      if (!original) {
        out.push(bad(file, `${field}.name`, `“${stretch.journey}”这一趟里没有叫“${part.name}”的一截（名字要和 scenes/${ROUTE_SCENE_ID}.json 里的一字不差）`));
        return;
      }
      if (original.class !== part.class) out.push(bad(file, `${field}.class`, `这一截在场景里的类别是 ${original.class}，这里写的是 ${part.class}：实线、虚线要和沙盘上画的一样`));
      const whole = original.ways.join(' ');
      const mine = part.ways.join(' ');
      if (part.partial) {
        if (mine === whole) out.push(bad(file, `${field}.partial`, '这一截走全了，不用写 partial'));
        else if (part.ways.length === 0 || !` ${whole} `.includes(` ${mine} `)) out.push(bad(file, `${field}.ways`, `写了 partial 的一截，走的路要是场景里这一截（${whole}）当中连着的一段`));
      } else if (mine !== whole) out.push(bad(file, `${field}.ways`, `这一截走的路（${mine}）和场景里的（${whole}）不一样；只走了一部分的写 partial`));
    });
    walked.set(stretch.journey, [...(walked.get(stretch.journey) ?? []), ...stretch.parts.flatMap((part) => part.ways)]);

    // 路上有位置的各处：离线不远，先后对
    const chain: [number, number][] = [];
    for (const written of stretch.parts.flatMap((part) => part.ways)) {
      const ref = wayRef(written);
      const line = route.roads.ways.find((item) => item.id === ref.id)?.line.map((p: LngLat) => coords.toLocal(p)) ?? [];
      chain.push(...(ref.reversed ? [...line].reverse() : line));
    }
    let last = -Infinity;
    stretch.waypoints?.forEach((point, j) => {
      if (!point.at || chain.length < 2) return;
      const found = lineDistance(coords.toLocal(point.at), chain);
      const km = (found.distance * route.frame.scale) / 1000;
      if (km > WAYPOINT_MAX_KM) out.push(bad(file, `${at(i)}.waypoints[${j}].at`, `${what}路上的“${point.name}”离这一段走的线有 ${Math.round(km)} 公里，不能超过 ${WAYPOINT_MAX_KM} 公里`));
      else if (found.along < last - 1e-6) out.push(bad(file, `${at(i)}.waypoints[${j}].at`, `${what}路上的“${point.name}”排在前一处的后面，在线上却比它靠前：路上各处照走的先后写`));
      last = Math.max(last, found.along);
    });

    // 一程一程：只在精确到日、又有位置的地方切
    let previous = numbers[i];
    for (const point of legPoints(stretch)) {
      const day = earliestOf(point.date);
      if (day === null || Number.isNaN(numbers[i]) || Number.isNaN(numbers[i + 1])) continue;
      if (day < previous || day > numbers[i + 1]) {
        out.push(bad(file, `${at(i)}.waypoints`, `${what}路上的“${point.name}”（${point.date.text}，${isoOfDay(day)}）不在这一段在时间轴上的头尾之间（${isoOfDay(numbers[i])} 到 ${isoOfDay(numbers[i + 1])}），或者比前一处还早：小像走不到那里`));
      }
      previous = Math.max(previous, day);
    }
  });

  for (const [i, journey] of route.roads.journeys.entries()) {
    const mine = walked.get(journey.id);
    const whole = journey.parts.flatMap((part) => part.ways).join(' ');
    if (!mine) out.push(bad(file, 'stretches', `全程沙盘上的第 ${i + 1} 趟路“${journey.id}”（${journey.name}）行迹里没有人走：画出来的每一趟都要有一段`));
    else if (mine.join(' ') !== whole) out.push(bad(file, 'stretches', `“${journey.id}”（${journey.name}）这一趟各段接起来走的路（${mine.join(' ')}）和场景里的（${whole}）不一样：一截不能多、不能少，先后要一样`));
  }
  return out;
}

// ---------------------------------------------------------------- 六 第一行说的是真话

/**
 * 规则 22 六 第一行说的是真话：时间轴第一行印的是“哪一年、在哪”。每一段在时间轴上碰到的每一个农历年里，
 * 这一段一定已经开始了（最晚的开始不晚于这一年的最后一天），也一定还没有结束（最早的结束不早于这一年的正月初一）：
 * 所以不管拖到哪里，印出来的“某年、在某地”都是史料担保得了的。农历年末、公历已经是下一年的那些天，括号里印的是那一天公历的年和月：
 * 对每一段碰到的每一个这样的月份做同样的两样比较（这一段一定在那个月落在这个农历年里的那一截结束以前开始，到那一截开始的时候一定还没有结束；
 * itineraryTool.ts 的 westernMonths）。这两样不是“通不过”：担保不了的月份由工具列进时间轴用的那一份（plainMonths），时间轴在那些天只印年份——
 * 列得对不对由第十句守着（仓库里的那一份要和工具做出来的一字不差）。另查两样：一段在时间轴上不比它的范围容得下的更长；
 * 在路上的一段，到的日子不精确到日、在时间轴上又超过 93 天的，要写 longRoad（史料怎么说它走了这么久）。
 * numbers 是每个日子放在时间轴上的哪一天；不给就照 itineraryTool.ts 的四步算。
 */
export function checkItineraryHonesty(itinerary: Itinerary, file: string, numbers: number[] = boundaryNumbers(itinerary).numbers): Violation[] {
  const out: Violation[] = [];
  const years = lunarYears(itinerary);
  itinerary.stretches.forEach((stretch, i) => {
    const [a, b] = [numbers[i], numbers[i + 1]];
    const [earliestStart, latestStart, earliestEnd, latestEnd] = [earliestOf(stretch.start), latestOf(stretch.start), earliestOf(stretch.end), latestOf(stretch.end)];
    if (Number.isNaN(a) || Number.isNaN(b) || earliestStart === null || latestStart === null || earliestEnd === null || latestEnd === null) return;
    const what = `“${stretch.id}”（${stretch.label}）`;
    const first = lunarYearOf(years, a);
    if (!first) {
      out.push(bad(file, at(i), `${what}开始的那一天（${isoOfDay(a)}）不在 years 表的哪一年里`));
      return;
    }
    const touched: LunarYear[] = [first, ...years.filter((year) => year.first > a && year.first < b)];
    for (const year of touched) {
      if (latestStart > year.last) out.push(bad(file, at(i), `时间轴第一行会说“${year.name}　${stretch.label}”，可这一段也许那一年过完了才开始（最晚的开始是 ${isoOfDay(latestStart)}）：史料担保不了`));
      if (earliestEnd < year.first) out.push(bad(file, at(i), `时间轴第一行会说“${year.name}　${stretch.label}”，可这一段也许那一年以前就结束了（最早的结束是 ${isoOfDay(earliestEnd)}）：史料担保不了`));
    }
    const days = b - a;
    if (days > latestEnd - earliestStart) out.push(bad(file, at(i), `${what}在时间轴上有 ${Math.round(days)} 天，比它的范围容得下的（${latestEnd - earliestStart} 天）还长`));
    if (moving(stretch) && stretch.end.precision !== 'day' && days > LONG_ROAD_DAYS && !stretch.longRoad?.trim()) {
      out.push(bad(file, `${at(i)}.longRoad`, `${what}是在路上的一段，到的日子不精确到日，在时间轴上却有 ${Math.round(days)} 天：超过 ${LONG_ROAD_DAYS} 天的要写 longRoad，说史料怎么讲它走了这么久`));
    }
  });
  return out;
}

// ---------------------------------------------------------------- 七 站

/**
 * 规则 22 七 站：figure.json 里的每一站，落在它讲的年月里的各段（stopYearsOf 写着它的）连在一起，里面至少一段是住在这一站的；
 * 住在这一站的各段在时间轴上碰到的农历年，都在这一站已发布的年份（figure.json 的 years）里面。
 * 到这一站去的路可以从前一年走起；住到正月初一那天离开的，算在旧的一年里。
 */
export function checkItineraryStops(itinerary: Itinerary, file: string, figure: Pick<Figure, 'stops'>): Violation[] {
  const out: Violation[] = [];
  const years = lunarYears(itinerary);
  const { numbers } = boundaryNumbers(itinerary);
  for (const stop of figure.stops) {
    const group = itinerary.stretches.flatMap((stretch, i) => (stretch.stopYearsOf === stop.id ? [i] : []));
    const stays = itinerary.stretches.flatMap((stretch, i) => (stretch.kind === 'stop' && stretch.stop === stop.id ? [i] : []));
    if (stays.length === 0) {
      out.push(bad(file, 'stretches', `“${stop.id}”（${stop.shortTitle}）这一站在行迹里没有住下来的一段`));
      continue;
    }
    if (group.some((index, n) => n > 0 && index !== group[n - 1] + 1)) out.push(bad(file, 'stretches', `落在“${stop.id}”这一站讲的年月里的各段（${group.map((index) => itinerary.stretches[index].id).join('、')}）没有连在一起`));
    const [from, to = from] = (stop.years.match(/\d{4}/g) ?? []).map(Number);
    if (from === undefined) continue;
    for (const i of stays) {
      const [a, b] = [numbers[i], numbers[i + 1]];
      if (Number.isNaN(a) || Number.isNaN(b)) continue;
      const first = lunarYearOf(years, a)?.year;
      const last = lunarYearOf(years, b - 0.001)?.year;
      if (first === undefined || last === undefined) continue;
      if (first < from || last > to) out.push(bad(file, at(i), `“${itinerary.stretches[i].id}”住在“${stop.shortTitle}”是 ${first} 到 ${last} 年，这一站发布的年份是 ${stop.years}：时间轴上这一站的年月不能伸到它外面`));
    }
  }
  return out;
}

// ---------------------------------------------------------------- 八 两行字

/**
 * 句子里的一个日子是不是照史料的写法缩短来的。照“一截一截”比（dateTokens），不照一个字一个字比：
 * 只许整截地删，不添、不换，先后不变——“二十八日”删不成“八日”，“十二月”删不成“二月”；
 * 留着年号的，它后面的“第几年”也要留着；碰到的每一个半句（史料的写法用逗号隔开的）里，不许删的词都还在；
 * 留着“以前”“以后”的，史料的写法里它前面紧挨着的那一截日子（哪一年、几月、哪一天、哪一季）也要留着——
 * “六月十七日以前”删成“元符三年以前”，“以前”就挂到年份上去了，说的是另一个日子。
 *（留着哪一天、删掉了月份的，月份要同句子里前一个日子的一样：那一条在 checkSaidDates 里，这里不查。）
 */
export function isShortening(short: string, full: string): boolean {
  const want = dateTokens(short);
  const have = dateTokens(full);
  const used = have.map(() => false);
  let j = 0;
  have.forEach((token, i) => {
    if (j < want.length && token.kind === want[j].kind && token.text === want[j].text) {
      used[i] = true;
      j += 1;
    }
  });
  if (j < want.length) return false;
  if (have.some((token, i) => token.kind === 'era' && used[i] && !used[i + 1])) return false;
  // 留着的“以前”“以后”：它前面最近的那一截日子也留着
  for (let i = 0; i < have.length; i++) {
    if (!used[i] || (have[i].text !== '以前' && have[i].text !== '以后')) continue;
    let k = i - 1;
    while (k >= 0 && !HANGS_ON.includes(have[k].kind)) k -= 1;
    if (k >= 0 && !used[k]) return false;
  }
  // 半句：史料的写法里用逗号隔开的。碰到的半句里，不许删的词要都留着
  let clause = 0;
  const clauseOf = have.map((token) => (token.text === '，' ? clause++ : clause));
  const touched = new Set(clauseOf.filter((_, i) => used[i]));
  return have.every((token, i) => token.kind !== 'kept' || !touched.has(clauseOf[i]) || used[i]);
}

/**
 * 句子里像日子的字眼：saysDates 里列过的去掉以后，不能再有。“三月”“二十八日”“七年”，阿拉伯数字，“初八”，“上旬”，
 * 节令和一年里有名字的日子，“春夏秋冬”；岁数（“岁”），多久（“三个月”“六十天”“两夜”“三宿”），
 * 靠着别的日子说的（“年底、年初、月底、月初、次年、明年、去年、前后”），干支记的日子（“壬戌”）。
 * 接着上一个日子说的（“翌日、次日、是年、是夜、当天、当晚、同年”），隔开一年的（“隔年、来年、后年、前年、今年、年后”），
 * 约数的多久（“半年、半月、数月、百日、十余日、多年、三载”），更、望、月半、中元、上巳、年末、年终、月末，“卅、廿”，二十四节气；
 * 年号后面紧跟着“初、末、中、间”的（“绍圣初”“元祐末”：年号照 years 表认，见 strayDates）。
 * “日子”这个词、“哪一年”“哪一天”不算；“三天竺”（杭州的地名）和“度岁”（史料里说在哪里过年的词）指名放过。
 * 这张单子是一张网，不是证明：网眼里漏得过去的说法总还有（“不久”“逾月”）。句子里的地方、做了什么事、住了多久是手写的字，规则管不到，靠读。
 */
const STRAY_DATE =
  /[0-9０-９]|初[一二三四五六七八九十]|旬|除夜|除夕|元日|元旦|上元|中元|上巳|寒食|清明|端午|七夕|中秋|重阳|重九|冬至|夏至|腊八|晦|朔|望|[春夏秋冬]|雨水|惊蛰|谷雨|小满|芒种|小暑|大暑|处暑|白露|寒露|霜降|小雪|大雪|小寒|大寒|岁|年底|年初|年末|年终|年后|月底|月初|月末|月半|半年|半月|次年|明年|去年|[隔来后前今]年|前后|翌|次日|[是当同][年月日夜晚天]|载|更|卅|廿|[甲乙丙丁戊己庚辛壬癸][子丑寅卯辰巳午未申酉戌亥]|(?<!哪)[一二三四五六七八九十两半几]+(?:个月|天|夜|宿)|[数百余多]+(?:年|月|日|天)(?!子)|(?<!哪)[一二三四五六七八九十正元闰腊两]+(?:年|月|日)(?!子)/gu;
/** 指名放过的两个词（里面的“三天”“岁”不是日子）。 */
const STRAY_EXEMPT = ['三天竺', '度岁'] as const;
/** 年号后面紧跟着的这几个字，说的是那个年号的头几年、末几年、中间：也是日子。 */
const ERA_PART = '初末中间';

/** 一句话里像日子的字眼（见 STRAY_DATE）。eras 是 years 表里有的年号。 */
function strayDates(written: string, eras: readonly string[]): string[] {
  const plain = STRAY_EXEMPT.reduce((rest, word) => rest.split(word).join('□'.repeat(word.length)), written);
  const byEra = eras.length > 0 ? plain.match(new RegExp(`(?:${eras.join('|')})[${ERA_PART}]`, 'gu')) : null;
  return [...(plain.match(STRAY_DATE) ?? []), ...(byEra ?? [])];
}

/** years 表里有哪几个年号（年名去掉“第几年”）。 */
function erasOf(itinerary: Pick<Itinerary, 'years'>): string[] {
  return [...new Set(itinerary.years.flatMap((row) => YEAR_NAME.exec(row.name)?.[1] ?? []))];
}
/** 最后一个位置的句子里的“虚岁多少”：它另有一条规矩管（要是 years 表最后一年的岁数），查“像日子的字眼”的时候先放过。 */
const LAST_AGE = /虚岁[一二三四五六七八九十]+/gu;
/**
 * 路上一处的 note 里有这些字眼，就是这一处的日子另有一种说法、同别的记载对不上，或者是推出来的：
 * 句子里说到它、或者小像照它走的，这一处要写 unsure（工具把它接在这一段的 unsure 后面，读者点开“图例”看得见）。
 */
export const DOUBT_WORDS = /一本作|一作|引作|录作|谱作|注作|别本|又作|或作|异文|对不上|推出来|也可能|差一天|两说|一说/u;
/** “说不准的”写了字的，里面至少要有这么多个汉字：一个句号、一道横线、一个“无”字不算说了。 */
export const UNSURE_MIN_HAN = 2;
const hanCount = (written: string): number => (written.match(/\p{Script=Han}/gu) ?? []).length;

/** 句子里用到的一个日子：saysDates 的一项，连同它指的那个日子的写法、在这一段里排第几（start 最前，路上各处照先后，end 最后）。 */
interface SaidDate {
  of: string;
  text: string;
  full: string | undefined;
  rank: number;
}

/**
 * 一句话里的日子（一段的 says，或者 first、last 的 says）：saysDates 照日子的先后列（先 start，再路上各处，最后 end），同一个日子不列两次；
 * 每一项都在句子里，先后和列的一样；它前面、后面紧挨着的字是 BEFORE_DATE、AFTER_DATE 里的；它是照史料的写法缩短来的；
 * 列过的去掉以后，句子里不能再有像日子的字眼。
 */
function checkSaidDates(says: string, dates: SaidDate[], file: string, field: string, what: string, options: { beginYear?: string; shownUnder?: string[]; allowAge?: boolean; eras?: readonly string[] } = {}): Violation[] {
  const out: Violation[] = [];
  let rest = says;
  let cursor = 0;
  let lastRank = -1;
  // 读的人拿什么补一个没带年份、没带月份的日子：句子里前一个日子的（史料写的那个年名、那个月）；头一个日子前面没有别的，
  // 补的是第一行印着的年名（这句话开始摆出来的那个农历年），月份没有东西可补
  let carried: { year: string | undefined; months: string | null; first: boolean } = { year: options.beginYear, months: null, first: true };
  dates.forEach((entry, j) => {
    if (entry.full === undefined) return; // 规则 22 二 会说
    const where = `${field}.saysDates[${j}]`;
    if (entry.rank <= lastRank) out.push(bad(file, `${where}.of`, `${what}的 saysDates 要照日子的先后列（先 start，再路上各处，最后 end），同一个日子不列两次：“${entry.of}”排在了后面`));
    lastRank = Math.max(lastRank, entry.rank);
    if (!isShortening(entry.text, entry.full)) out.push(bad(file, `${where}.text`, `“${entry.text}”不是照史料的写法“${entry.full}”缩短来的：只许整截地删（“二十八日”不能删成“八日”，“十二月”不能删成“二月”），不许添字、换字，“${KEPT_WORDS.join('、')}”不许删`));
    else {
      // 删掉了年份、月份的：读的人会拿前面的补上，补上的要正是史料写的那一个
      const [short, full] = [saidParts(entry.text), saidParts(entry.full)];
      const from = carried.first ? '第一行印着的' : '句子里前一个日子的';
      if (full.name !== undefined && short.year === undefined && carried.year !== undefined && carried.year !== full.name) {
        out.push(bad(file, `${where}.text`, `${what}的第二行里，“${entry.text}”没有带年份，读的人会当成${from}${carried.year}；史料写的是${full.name}（“${entry.full}”）。把年份写上`));
      } else if (carried.first && full.name !== undefined && short.year === undefined && (options.shownUnder ?? []).length > 1) {
        // 这一段在时间轴上跨过了正月初一：第一行先后印着两个年名，头一个日子不带年份，读的人拖到后一年就会拿后一年去补
        out.push(bad(file, `${where}.text`, `${what}的第二行里，头一个日子“${entry.text}”没有带年份，可这一段在时间轴上跨着正月初一（第一行先后印着${(options.shownUnder ?? []).join('、')}）：读的人拖到后一年，会当成后一年的。把年份写上（史料写的是“${entry.full}”）`));
      } else if (full.name !== undefined && short.year !== undefined && short.era === undefined && carried.year !== undefined && eraOf(carried.year) !== full.era) {
        out.push(bad(file, `${where}.text`, `${what}的第二行里，“${entry.text}”没有带年号，读的人会当成${from}${eraOf(carried.year)}的；史料写的是${full.name}（“${entry.full}”）。把年号写上`));
      }
      if (full.months !== '' && short.months === '' && short.day && (carried.months !== full.months || carried.year !== full.name)) {
        out.push(bad(file, `${where}.text`, `${what}的第二行里，“${entry.text}”没有带月份，${carried.months === null ? '它前面又没有哪个日子说过月份' : `读的人会当成${from}${carried.months}`}；史料写的是${full.months}（“${entry.full}”）。把月份写上`));
      }
      if (full.name !== undefined) carried = { year: full.name, months: full.months === '' ? null : full.months, first: false };
    }
    const found = rest.indexOf(entry.text, cursor);
    if (entry.text === '' || found < 0) {
      out.push(bad(file, `${where}.text`, `${what}的第二行里没有“${entry.text}”（先后要和句子里一样：先说的日子在前，同一个日子不能列两次）`));
      return;
    }
    const before = found === 0 ? '' : [...rest.slice(0, found)].pop() ?? '';
    const after = [...rest.slice(found + entry.text.length)][0] ?? '';
    if (before !== '' && !BEFORE_DATE.includes(before)) out.push(bad(file, `${field}.says`, `${what}的第二行里，“${entry.text}”前面紧挨着“${before}”：日子前面只能是句子的开头，或者“${[...BEFORE_DATE].join('')}”里的一个字，不能在日子上添字`));
    if (after === '' || !AFTER_DATE.includes(after)) out.push(bad(file, `${field}.says`, `${what}的第二行里，“${entry.text}”后面紧挨着“${after === '' ? '（句子完了）' : after}”：日子后面只能是“${[...AFTER_DATE].join('')}”里的一个字。“四月初离开”“四月底”“二月一日前后”这样在日子旁边添字，说出来的就不是史料的那个日子了`));
    rest = `${rest.slice(0, found)}${'□'.repeat(entry.text.length)}${rest.slice(found + entry.text.length)}`;
    cursor = found + entry.text.length;
  });
  const stray = strayDates(options.allowAge ? rest.replace(LAST_AGE, (age) => '□'.repeat(age.length)) : rest, options.eras ?? []);
  if (stray.length > 0) out.push(bad(file, `${field}.says`, `${what}的第二行里有 saysDates 没有列的日子：${stray.join('、')}。句子里的每一个日子都要列出来，说明是哪一个日子的写法缩短来的；岁数、住了多久、“次年”“年底”“前后”这样靠着别的日子说的话也算日子：日子只照史料的写法删字来说，别的说法不写`));
  return out;
}

/** 一个日子的写法里说的年名（年号加第几年）、年号、第几年、哪几个月（“四月或五月”是两个）、说没说到哪一天。没有说的是 undefined、空的。 */
function saidParts(written: string): { name: string | undefined; era: string | undefined; year: string | undefined; months: string; day: boolean } {
  const tokens = dateTokens(written);
  const era = tokens.find((token) => token.kind === 'era')?.text;
  const year = tokens.find((token) => token.kind === 'year')?.text;
  return { name: era !== undefined && year !== undefined ? `${era}${year}` : undefined, era, year, months: tokens.filter((token) => token.kind === 'month').map((token) => token.text).join('、'), day: tokens.some((token) => token.kind === 'day') };
}

/** 年名里的年号（“元丰三年”的“元丰”）。 */
const eraOf = (yearName: string): string | undefined => YEAR_NAME.exec(yearName)?.[1];

/**
 * 规则 22 八 两行字：label 写了，最多十个字（落在一站讲的年月里的最多七个），没有弯引号，里面有数据里这个地方的名字
 *（住在一站的、站在有名字的地方的是地名点的名字，站在线上没有立名字的地方的是 where 开头的地名，路上的是 to）；
 * says 写了，最多三十二个字；路上的一句以“匀着走的：”开头；沙盘上没有他的一段，头一个半句里说“沙盘上没有他”；
 * 沙盘上有他的一段不许说“没有他”“没有标出”；站在线上、沙盘平时没有立名字的地方的一段，不许再说“沙盘上没有立某地的名字”
 *（他站到那里的时候旁边立着那一处的名字）；
 * says 里的每一个日子都列在 saysDates 里，照日子的先后列，是它指的那个日子的写法缩短来的（只许整截地删：“二十八日”删不成“八日”；
 * “以前、以后、或、之间、初”不删），它前面、后面紧挨着的字是 BEFORE_DATE、AFTER_DATE 里的（日子旁边不许添字），没有列的日子不许有；
 * 句子里一个日子删掉了年份的，它的年名要和句子里前一个日子的（史料写的）一样，头一个日子的要和这一段开始摆出来的那个农历年一样
 *（第一行印着的那一年）；只删了年号、留着第几年的，年号要一样；删掉了月份还说着哪一天的，年名、月份都要和前一个日子的一样——
 * 读的人是拿前面的来补的，补出来的要正是史料写的那个日子；
 * label 里不写日子；first、last 的两行字照同样的长度查，“在哪”里要有头一段、最后一段的那个地方，句子里的日子照同样的办法查
 *（first 的对着头一段的 start，last 的对着最后一段的 end），last 的句子里写了“虚岁多少”的，要是 years 表最后一年的岁数；
 * 说不准的要说出来：头尾有一个不精确到日（或者写了 earliestIs、latestIs）的一段，unsure 不能空着；句子里说到的、把路切成一程一程的路上一处，
 * note 里写着另一种说法、对不上、是推出来的（DOUBT_WORDS），这一处要写 unsure（工具把它接在这一段的 unsure 后面，前面带上这一处的名字）；
 * unsure 写了字的至少两个汉字（一个句号、一道横线不算）；路上一处的 note 里有那些字眼的，它的 unsure 要是 note 里连着的一截；
 * 句子里头一个日子不带年份的，这一段在时间轴上不能跨着正月初一（第一行先后印着两个年名，读的人会拿后一年去补）。
 */
export function checkItineraryWords(itinerary: Itinerary, file: string, route: Pick<RouteScene, 'places'>): Violation[] {
  const out: Violation[] = [];
  const eras = erasOf(itinerary);
  const lengths = (label: string, says: string, field: string, what: string, labelMax: number): void => {
    if (label.trim() === '') out.push(bad(file, `${field}.label`, `${what}没有写第一行的“在哪”`));
    else if (count(label) > labelMax) out.push(bad(file, `${field}.label`, `${what}的“${label}”有 ${count(label)} 个字，最多 ${labelMax} 个${labelMax === LABEL_IN_GROUP_MAX ? '（落在一站讲的年月里，第一行右边还有进这一站的入口）' : ''}`));
    if (/[“”‘’]/.test(label)) out.push(bad(file, `${field}.label`, `${what}的“在哪”里不要有弯引号`));
    const dated = strayDates(label, eras);
    if (dated.length > 0) out.push(bad(file, `${field}.label`, `${what}的“在哪”里有像日子的字眼（${dated.join('、')}）：第一行的年份是程序照 years 表写的，“在哪”里不写日子`));
    if (says.trim() === '') out.push(bad(file, `${field}.says`, `${what}没有写第二行的那句话`));
    else if (count(says) > SAYS_MAX) out.push(bad(file, `${field}.says`, `${what}的第二行有 ${count(says)} 个字，最多 ${SAYS_MAX} 个（最窄的沙盘栏上一行要放得下）`));
  };
  lengths(itinerary.first.label, itinerary.first.says, 'first', '最前一个位置', LABEL_MAX);
  lengths(itinerary.last.label, itinerary.last.says, 'last', '最后一个位置', LABEL_MAX);

  // 每一段开始摆出来的那一天落在哪个农历年里（第一行印着的年名）：句子里头一个日子不带年份的，读的人拿它来补
  const years = lunarYears(itinerary);
  const { numbers } = boundaryNumbers(itinerary);
  const yearAt = (n: number | undefined): string | undefined => (n === undefined || Number.isNaN(n) ? undefined : lunarYearOf(years, n)?.name);

  // 最前、最后一个位置：“在哪”说的是头一段、最后一段的那个地方；句子里的日子对着头一段的 start、最后一段的 end
  const [head, tail] = [itinerary.stretches[0], itinerary.stretches[itinerary.stretches.length - 1]];
  const ends: [string, string, Itinerary['first'], ItineraryStretch | undefined, 'start' | 'end'][] = [
    ['first', '最前一个位置', itinerary.first, head, 'start'],
    ['last', '最后一个位置', itinerary.last, tail, 'end'],
  ];
  for (const [field, what, words, stretch, of] of ends) {
    if (!stretch) continue;
    const named = namedPlace(stretch, route);
    if (named && !words.label.includes(named)) out.push(bad(file, `${field}.label`, `${what}的“${words.label}”里没有“${named}”：${of === 'start' ? '头一段' : '最后一段'}（“${stretch.id}”）他在那里，这里说的要是同一个地方`));
    const dates = words.saysDates.map((entry): SaidDate => ({ ...entry, full: entry.of === of ? stretch[of].text : undefined, rank: 0 }));
    // 这两个位置停在头一天、最后一天上；最后一个位置的“虚岁多少”下面另查
    out.push(...checkSaidDates(words.says, dates, file, field, what, { beginYear: yearAt(of === 'start' ? numbers[0] : numbers[numbers.length - 1]), allowAge: of === 'end', eras }));
  }
  const lastAge = /虚岁([一二三四五六七八九十]+)/u.exec(itinerary.last.says)?.[1];
  const died = itinerary.years[itinerary.years.length - 1];
  if (lastAge !== undefined && died && numeral(lastAge) !== died.age) out.push(bad(file, 'last.says', `最后一个位置的第二行说“虚岁${lastAge}”，years 表最后一年（${died.name}）写的是 ${died.age} 岁`));

  itinerary.stretches.forEach((stretch, i) => {
    const what = `“${stretch.id}”`;
    lengths(stretch.label, stretch.says, at(i), what, stretch.stopYearsOf === null ? LABEL_MAX : LABEL_IN_GROUP_MAX);

    // 第一行的“在哪”说的就是数据里的那个地方
    const named = namedPlace(stretch, route);
    if (named && !stretch.label.includes(named)) out.push(bad(file, `${at(i)}.label`, `${what}的“${stretch.label}”里没有“${named}”：数据里这一段${stretch.kind === 'road' ? '是到那里去的路' : '他在那里'}，第一行说的要是同一个地方`));

    // 第二行开头的半句
    const look = lookOf(stretch);
    if (look === 'road' && !stretch.says.startsWith(ROAD_OPENING)) out.push(bad(file, `${at(i)}.says`, `${what}是路上的一段，第二行要以“${ROAD_OPENING}”开头：两个有日子的地方之间，小像是匀着走的，要先说这一句`));
    if (look === 'off' && !ABSENT.test(stretch.says.slice(0, ABSENT_WITHIN))) out.push(bad(file, `${at(i)}.says`, `${what}这一段沙盘上没有他，第二行头一个半句里要说“沙盘上没有他”`));
    if (look !== 'off' && /没有他|没有标出/.test(stretch.says)) out.push(bad(file, `${at(i)}.says`, `${what}这一段小像站在沙盘上，第二行不能说“没有他”“没有标出”`));
    if (stretch.kind === 'elsewhere' && stretch.tablePoint.type === 'way-vertex' && NO_NAME.test(stretch.says)) {
      out.push(bad(file, `${at(i)}.says`, `${what}站在一条线上、沙盘平时没有立名字的地方：他站到那里的时候，旁边立着这一处的名字（tablePoint 的 name），第二行不能再说“沙盘上没有立${spotTown(stretch.where)}的名字”`));
    }

    // 句子里的日子
    const rank = (of: string): number => (of === 'start' ? 0 : of === 'end' ? Infinity : 1 + (stretch.waypoints ?? []).findIndex((point) => `wp:${point.name}` === of));
    // 这一段在时间轴上先后摆在哪几个农历年底下（开始的那一年，和中间跨过的每一个正月初一的那一年）
    const [a, b] = [numbers[i], numbers[i + 1]];
    const shownUnder = Number.isNaN(a) || Number.isNaN(b) ? [] : years.filter((year) => year.last >= Math.floor(a) && year.first < b).map((year) => year.name);
    out.push(...checkSaidDates(stretch.says, stretch.saysDates.map((entry) => ({ ...entry, full: momentOf(stretch, entry.of)?.text, rank: rank(entry.of) })), file, at(i), what, { beginYear: yearAt(numbers[i]), shownUnder, eras }));

    // 说不准的要说出来
    const loose = [stretch.start, stretch.end].some((moment) => moment.precision !== 'day' || moment.earliestIs !== undefined || moment.latestIs !== undefined);
    if (loose && stretch.unsure.trim() === '') out.push(bad(file, `${at(i)}.unsure`, `${what}的头尾有一个不精确到日，unsure 却空着：哪里说不准要写出来（读者点开“图例”看得见）`));
    else if (stretch.unsure.trim() !== '' && hanCount(stretch.unsure) < UNSURE_MIN_HAN) out.push(bad(file, `${at(i)}.unsure`, `${what}的 unsure 写的是“${stretch.unsure}”：这不是一句话。哪里说不准要用字写出来（至少 ${UNSURE_MIN_HAN} 个汉字）；没有说不准的就空着`));
    stretch.waypoints?.forEach((point, j) => {
      const field = `${at(i)}.waypoints[${j}].unsure`;
      const doubted = DOUBT_WORDS.test(point.note);
      const written = point.unsure?.trim() ?? '';
      if (written === '') {
        if (doubtCarrier(stretch, point) && doubted) out.push(bad(file, field, `${what}路上的“${point.name}”，note 里写着这个日子另有一种说法、对不上或者是推出来的（“${DOUBT_WORDS.exec(point.note)?.[0]}”），句子里又说到了它（或者小像照它走）：这一处要写 unsure，照 note 里的话写，只删字`));
        return;
      }
      if (hanCount(written) < UNSURE_MIN_HAN) out.push(bad(file, field, `${what}路上的“${point.name}”的 unsure 写的是“${point.unsure}”：这不是一句话（至少 ${UNSURE_MIN_HAN} 个汉字）`));
      // note 里写着另一种说法的：unsure 要是 note 里连着的一截（只删字，不另写一句——另写的一句可以同 note 说的正相反）
      else if (doubted && !point.note.includes(written)) out.push(bad(file, field, `${what}路上的“${point.name}”的 unsure（“${point.unsure}”）不是它的 note 里的话：照 note 里的话写，只删字（要是 note 里连着的一截）`));
    });
  });
  return out;
}

// ---------------------------------------------------------------- 九 农历年的表

/** 年名：年号加第几年，如“元丰三年”“建中靖国元年”。 */
const YEAR_NAME = /^(\p{Script=Han}{2,4}?)(元|[二三四五六七八九十]{1,3})年$/u;
/** 一个日子的写法开头的年号纪年。 */
const TEXT_YEAR = /^\p{Script=Han}{2,4}?(?:元|[二三四五六七八九十]{1,3})年/u;
const NUMERAL: Record<string, number> = { 元: 1, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
/** “元”“九”“十”“十一”“二十”“二十三”是几。 */
function numeral(written: string): number {
  const chars = [...written];
  if (chars.length === 1) return NUMERAL[chars[0]];
  if (chars[0] === '十') return 10 + NUMERAL[chars[1]];
  return NUMERAL[chars[0]] * 10 + (chars.length > 2 ? NUMERAL[chars[2]] : 0);
}

/**
 * 精确到日的写法里的月、日，是那个农历年的第几天（从 0 数起）：最少、最多。一个月 29 或 30 天，前面至多一个闰月；
 * 正月的日子没有余地（正月初一就是第 0 天）；“除夜”是这一年的最后一天（给 'last'）。tokens 是 isDayText 认得的写法拆出来的。
 */
function dayOfYear(tokens: DateToken[]): { lo: number; hi: number } | 'last' {
  const day = tokens[tokens.length - 1].text;
  if (day === '元日') return { lo: 0, hi: 0 };
  if (day === '除夜' || day === '除夕') return 'last';
  const written = tokens[2].text;
  const core = written.replace(/^闰/u, '').replace(/月$/u, '');
  const month = core === '正' ? 1 : core === '腊' ? 12 : numeral(core);
  const nth = day === '晦日' ? null : numeral(day.replace(/^初/u, '').replace(/日$/u, '')) - 1;
  const [lo, hi] = nth === null ? [28, 29] : [nth, nth];
  if (written.startsWith('闰')) return { lo: 29 * month + lo, hi: 30 * month + hi };
  return month === 1 ? { lo, hi } : { lo: 29 * (month - 1) + lo, hi: 30 * month + hi };
}

/**
 * 规则 22 九 农历年的表（years）：头一行是他出生的那一年，newYear 写 null，虚岁一岁；后面一年接一年，公元年、虚岁各加一；
 * 每一年的正月初一是历法上有的一天、就在这个公元年里，比上一年的晚 353、354、355 天或者 383、384、385 天（别的天数不是一个农历年）；
 * 年名是“年号加第几年”，同一个年号的接着数，换了年号的从元年起；他出生的那一天在头一个正月初一以前、不到一年，
 * 去世的那一天在最后一个正月初一以后、不到一年；行迹里每一个日子的写法开头的年号纪年，和照它最早的那一天在表里查到的年名一样；
 * 精确到日的写法里的月、日，和它的公元日子对得上：“正月初一”“元日”就是表里那一年的正月初一，正月某日是它后面的第几天，
 * “除夜”是下一个正月初一的前一天，别的月份在一个月 29 到 30 天、前面至多一个闰月算出来的范围里。
 * 这张表有没有照历表抄对，校验只能查到这里；表里没有日子落进去的年份，要靠对着历表读一遍（见 docs/data-spec.md“行迹”）。
 */
export function checkItineraryYears(itinerary: Itinerary, file: string): Violation[] {
  const out: Violation[] = [];
  const rows = itinerary.years;
  if (rows.length < 2) return [bad(file, 'years', '农历年的表至少两行：出生的那一年，和后面的每一年')];
  const firsts = rows.map((row) => dayOfIso(row.newYear));
  rows.forEach((row, i) => {
    const field = `years[${i}]`;
    const name = YEAR_NAME.exec(row.name);
    if (!name) out.push(bad(file, `${field}.name`, `“${row.name}”不是“年号加第几年”的写法（如“元丰三年”）`));
    if (i === 0) {
      if (row.newYear !== null) out.push(bad(file, `${field}.newYear`, '头一行是他出生的那一年，正月初一在他出生以前，写 null'));
      if (row.age !== 1) out.push(bad(file, `${field}.age`, `出生的那一年虚岁是一岁，现在写的是 ${row.age}`));
      return;
    }
    const previous = rows[i - 1];
    if (row.year !== previous.year + 1) out.push(bad(file, `${field}.year`, `${row.year} 年前面是 ${previous.year} 年：要一年接一年，不能跳`));
    if (row.age !== previous.age + 1) out.push(bad(file, `${field}.age`, `“${row.name}”虚岁写的是 ${row.age}，上一年是 ${previous.age}：每过一个农历新年加一岁`));
    const first = firsts[i];
    if (first === null) out.push(bad(file, `${field}.newYear`, `“${row.name}”的正月初一没有写对（写成“1080-01-25”这样，儒略历）`));
    else {
      if (Number(isoOfDay(first).slice(0, 4)) !== row.year) out.push(bad(file, `${field}.newYear`, `“${row.name}”的正月初一（${row.newYear}）不在 ${row.year} 年里：括号里印的公元年就对不上了`));
      const before = firsts[i - 1];
      if (i > 1 && before !== null && !LUNAR_YEAR_DAYS.includes(first - before)) {
        out.push(bad(file, `${field}.newYear`, `“${previous.name}”从正月初一到下一个正月初一有 ${first - before} 天：一个农历年只能是 ${LUNAR_YEAR_DAYS.join('、')} 天，这两个正月初一有一个写错了`));
      }
    }
    const before = YEAR_NAME.exec(previous.name);
    if (name && before) {
      const next = name[1] === before[1] ? numeral(before[2]) + 1 : 1;
      if (numeral(name[2]) !== next) out.push(bad(file, `${field}.name`, `“${previous.name}”后面是“${row.name}”：同一个年号接着数，换了年号从元年起`));
    }
  });

  const born = itinerary.stretches.length > 0 ? earliestOf(itinerary.stretches[0].start) : null;
  const died = itinerary.stretches.length > 0 ? latestOf(itinerary.stretches[itinerary.stretches.length - 1].end) : null;
  const [second, last] = [firsts[1], firsts[firsts.length - 1]];
  if (born !== null && second !== null && second !== undefined && !(born < second && second - born <= LUNAR_YEAR_MAX_DAYS)) out.push(bad(file, 'years[1].newYear', `他出生的那一天（${isoOfDay(born)}）要在表里头一个正月初一（${isoOfDay(second)}）以前、不到一年`));
  if (died !== null && last !== null && last !== undefined && !(died >= last && died - last <= LUNAR_YEAR_MAX_DAYS)) out.push(bad(file, `years[${rows.length - 1}].newYear`, `他去世的那一天（${isoOfDay(died)}）要在表里最后一个正月初一（${isoOfDay(last)}）以后、不到一年`));

  const years = lunarYears(itinerary);
  for (const { field, moment } of moments(itinerary)) {
    const day = earliestOf(moment);
    if (day === null) continue;
    const written = TEXT_YEAR.exec(moment.text)?.[0];
    const found = lunarYearOf(years, day)?.name;
    if (!written) out.push(bad(file, `${field}.text`, `“${moment.text}”开头不是年号纪年（如“元丰三年二月一日”）：照史料的写法写全`));
    else if (found !== undefined && written !== found) out.push(bad(file, `${field}.text`, `“${moment.text}”写的是${written}，照它的公元日子（${isoOfDay(day)}）在 years 表里查到的是${found}：两头对不上，有一头错了`));
    // 精确到日的：写法里的月、日，和公元日子离那一年正月初一的天数对得上
    const year = lunarYearOf(years, day);
    if (moment.precision !== 'day' || !isDayText(moment.text) || !year || written !== found || !Number.isFinite(year.first)) continue;
    const want = dayOfYear(dateTokens(moment.text));
    const nth = day - year.first;
    if (want === 'last' ? Number.isFinite(year.last) && day !== year.last : nth < want.lo || nth > want.hi) {
      const should = want === 'last' ? `除夜是这一年的最后一天（${isoOfDay(year.last)}）` : want.lo === want.hi ? `该是第 ${want.lo + 1} 天` : `该在第 ${want.lo + 1} 到第 ${want.hi + 1} 天之间`;
      out.push(bad(file, field, `“${moment.text}”写的月、日，和它的公元日子对不上：${isoOfDay(day)} 照 years 表是${year.name}的第 ${nth + 1} 天，${should}。不是公元的月日换算错了，就是这一年的正月初一写错了`));
    }
  }
  return out;
}

// ---------------------------------------------------------------- 十 时间轴用的那一份

/**
 * 规则 22 十 时间轴用的那一份（itinerary.bar.json）：在，而且和工具现在照手写的那一份、全程沙盘的场景和人物的名字做出来的一字不差。
 * 它是工具做的，不手改；手写的那一份改了，要运行 npm run itinerary 重做，再一起提交。
 */
export function checkItineraryBar(itinerary: Itinerary, route: RouteScene, figure: Pick<Figure, 'name'>, files: ContentFiles, barFile: string): Violation[] {
  if (!has(files, barFile)) return [bad(barFile, '', '没有这个文件：运行 npm run itinerary，把做出来的文件一起提交')];
  const want = barText(projectItinerary(itinerary, route, figure));
  return files[barFile].replace(/^﻿/, '').replace(/\r\n?/g, '\n') === want ? [] : [bad(barFile, '', '和手写的那一份（itinerary.json）现在做出来的不一样：它是工具做的，不要手改；运行 npm run itinerary 重做，再提交')];
}

// ---------------------------------------------------------------- 入口

/** 格式通过以后，一份行迹的规则 22 的前九句。 */
export function checkItinerary(itinerary: Itinerary, file: string, figure: Pick<Figure, 'years' | 'stops'>, route: RouteScene): Violation[] {
  return [
    ...checkItineraryChain(itinerary, file, figure),
    ...checkItineraryIds(itinerary, file, figure, route),
    ...checkItineraryPrecision(itinerary, file),
    ...checkItinerarySources(itinerary, file),
    ...checkItineraryRoads(itinerary, file, route),
    ...checkItineraryHonesty(itinerary, file),
    ...checkItineraryStops(itinerary, file, figure),
    ...checkItineraryWords(itinerary, file, route),
    ...checkItineraryYears(itinerary, file),
  ];
}

/**
 * 一位人物的行迹（rules.ts 的 validateFigure 调它）。只管一头：有行迹的人物要有全程沙盘（它的每一段都要对着沙盘上的点和路）。
 * 反过来那一头——有全程沙盘的人物要有行迹——现在还不查：等有了第二位人物再添（docs/data-spec.md“行迹”一节写着）。
 * 所以没有行迹的人物在这里一处也不报；只有工具做的那一份、没有手写的那一份，报。
 * 格式有问题时别的先不查；前九句有问题时，第十句（工具做的那一份新不新）先不查：照一份还不对的行迹做出来的东西比不出什么。
 * 全程沙盘的场景文件自己读不出来、格式不对的，这里不查（那边会报）。
 */
export function validateItinerary(files: ContentFiles, dir: string, figure: Figure): Violation[] {
  const file = `${dir}/${ITINERARY_FILE}`;
  const barFile = `${dir}/${ITINERARY_BAR_FILE}`;
  const routeFile = `${dir}/scenes/${ROUTE_SCENE_ID}.json`;
  if (!has(files, routeFile)) {
    return [file, barFile].filter((path) => has(files, path)).map((path) => bad(path, '', `这位人物没有全程沙盘（scenes/${ROUTE_SCENE_ID}.json），不该有这个文件：行迹的每一段都要对着沙盘上的点和路`));
  }
  if (!has(files, file)) return has(files, barFile) ? [bad(barFile, '', `没有手写的那一份（${ITINERARY_FILE}），不该有这个文件：它是工具照手写的那一份做的`)] : [];
  const routeRead = readJson(files, routeFile);
  if (routeRead.data === undefined || !isRouteLevel(routeRead.data) || checkRouteShape(routeRead.data, routeFile).length > 0) return [];
  const read = readJson(files, file);
  if (read.data === undefined) return read.violations;
  const shape = checkItineraryShape(read.data, file);
  if (shape.length > 0) return shape;
  const itinerary = read.data as Itinerary;
  const route = routeRead.data as RouteScene;
  const found = checkItinerary(itinerary, file, figure, route);
  return found.length > 0 ? found : checkItineraryBar(itinerary, route, figure, files, barFile);
}
