// 行迹的工具：手写的那一份（content/figures/<人物>/itinerary.json）怎么变成时间轴用的那一份（itinerary.bar.json）。
// 说明见 docs/data-spec.md“行迹”。
// 三个地方用它：做文件的工具（tests/tools/make-itinerary.test.ts，npm run itinerary）、内容校验（tests/content/itineraryRules.ts：
// 仓库里的那一份要和这里做出来的一字不差）、它们自己的测试。全是纯函数：不读磁盘，不依赖测试框架；只在 Node 里跑，src/ 里的程序不要用。
//
// 分三段：
//   一、日子      儒略历的一天是第几天；一个日子最早、最晚是哪一天；农历年的表。
//   二、位置      每一段的头尾放在时间轴的哪一天（只用来摆位置，从不显示成日子）。
//   三、做文件    时间轴用的那一份长什么样，写成文件是什么字。

import type {
  Itinerary,
  ItineraryBar,
  ItineraryBarStretch,
  ItineraryLook,
  ItineraryMoment,
  ItineraryStretch,
  ItineraryWaypoint,
} from '../../src/domain/itinerary';
import type { RouteScene } from '../../src/domain/scene';
import type { Figure } from '../../src/domain/types';

// ================================================================ 一、日子

/** 儒略历（1582 年以前通行的历法）的某年某月某日是第几天（儒略日数）。 */
export function julianDay(year: number, month: number, day: number): number {
  const a = Math.floor((14 - month) / 12);
  const y = year + 4800 - a;
  const m = month + 12 * a - 3;
  return day + Math.floor((153 * m + 2) / 5) + 365 * y + Math.floor(y / 4) - 32083;
}

/** julianDay 倒过来：第几天是儒略历的哪年哪月哪日，写成“1084-05-08”。 */
export function isoOfDay(n: number): string {
  const c = Math.floor(n) + 32082;
  const d = Math.floor((4 * c + 3) / 1461);
  const e = c - Math.floor((1461 * d) / 4);
  const m = Math.floor((5 * e + 2) / 153);
  const day = e - Math.floor((153 * m + 2) / 5) + 1;
  const month = m + 3 - 12 * Math.floor(m / 10);
  const year = d - 4800 + Math.floor(m / 10);
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** “1084-05-08”是第几天；写法不对、没有这一天（2 月 30 日）给 null。 */
export function dayOfIso(written: unknown): number | null {
  if (typeof written !== 'string') return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(written);
  if (!match) return null;
  const n = julianDay(Number(match[1]), Number(match[2]), Number(match[3]));
  return isoOfDay(n) === written ? n : null;
}

const twoDigits = (n: number): string => String(n).padStart(2, '0');

/** 一个日子最早是哪一天：精确到日的就是那一天；别的是 earliest。没有写、写得不对、历法上没有这一天给 null。 */
export function earliestOf(moment: ItineraryMoment): number | null {
  if (moment.precision !== 'day') return dayOfIso(moment.earliest);
  if (moment.month === undefined || moment.day === undefined) return null;
  return dayOfIso(`${String(moment.year).padStart(4, '0')}-${twoDigits(moment.month)}-${twoDigits(moment.day)}`);
}

/** 一个日子最晚是哪一天。 */
export function latestOf(moment: ItineraryMoment): number | null {
  if (moment.precision === 'day') return earliestOf(moment);
  return dayOfIso(moment.latest);
}

/** 一个农历年：从哪一天到哪一天（头尾都算）。出生的那一年没有写正月初一，first 是负无穷；最后一年的 last 是正无穷。 */
export interface LunarYear {
  year: number;
  name: string;
  age: number;
  first: number;
  last: number;
}

/** 照行迹自己的 years 表排出每个农历年的头尾。正月初一写得不对的那一年不在结果里（校验会说）。 */
export function lunarYears(itinerary: Pick<Itinerary, 'years'>): LunarYear[] {
  const rows = itinerary.years
    .map((row, i) => ({ row, first: row.newYear === null && i === 0 ? -Infinity : dayOfIso(row.newYear) }))
    .filter((item): item is { row: Itinerary['years'][number]; first: number } => item.first !== null);
  return rows.map(({ row, first }, i) => ({ year: row.year, name: row.name, age: row.age, first, last: i + 1 < rows.length ? rows[i + 1].first - 1 : Infinity }));
}

/** 第几天落在哪个农历年里。 */
export function lunarYearOf(years: readonly LunarYear[], day: number): LunarYear | null {
  const n = Math.floor(day);
  return years.find((year) => n >= year.first && n <= year.last) ?? null;
}

// ================================================================ 二、位置

/** 链上的各个日子：头一段的 start，后面是每一段的 end。 */
export function boundaries(itinerary: Pick<Itinerary, 'stretches'>): ItineraryMoment[] {
  const { stretches } = itinerary;
  return stretches.length === 0 ? [] : [stretches[0].start, ...stretches.map((stretch) => stretch.end)];
}

/** 第几个日子叫什么（给报错的话用）：“t31.end”；头一个是“<头一段>.start”。 */
export function boundaryName(itinerary: Pick<Itinerary, 'stretches'>, index: number): string {
  return index === 0 ? `${itinerary.stretches[0].id}.start` : `${itinerary.stretches[index - 1].id}.end`;
}

export interface BoundaryNumbers {
  /** 每个日子放在哪一天（可以带小数）；这个日子自己就不对的是 NaN。 */
  numbers: number[];
  /** 放不了的：第几个日子，哪里不对。 */
  problems: { index: number; problem: string }[];
}

/**
 * 每一段的头尾放在时间轴的哪一天。只用来摆位置，从不显示成日子：
 *   一、精确到日的，就是那一天；
 *   二、前后两个日子范围一模一样的（先动身、后到），照 sharesWindow 匀着排在范围里（两个的话，三分之一处、三分之二处）；
 *   三、范围里有一个正月初一的，放在那个正月初一上——这样时间轴第一行说的“某年、在某地”，一定是史料担保得了的；
 *   四、别的放在范围的正中间。
 * 范围只写了一头的、范围里有两个正月初一的、共用的范围里有正月初一的，都放不了。
 */
export function boundaryNumbers(itinerary: Pick<Itinerary, 'stretches' | 'years'>): BoundaryNumbers {
  const years = lunarYears(itinerary);
  const problems: BoundaryNumbers['problems'] = [];
  const numbers = boundaries(itinerary).map((moment, index) => {
    const lo = earliestOf(moment);
    const hi = latestOf(moment);
    if (lo === null || hi === null) {
      problems.push({ index, problem: '范围没有写全：最早、最晚哪一天两头都要写（精确到日的写 month、day）' });
      return NaN;
    }
    if (lo === hi) return lo;
    const newYears = years.filter((year) => year.first > lo && year.first <= hi);
    if (moment.sharesWindow) {
      if (newYears.length > 0) problems.push({ index, problem: `和前后的日子共用的范围里有一个正月初一（${newYears[0].name}）：排不出哪一年` });
      return lo + ((hi - lo) * moment.sharesWindow.order) / (moment.sharesWindow.of + 1);
    }
    if (newYears.length > 1) {
      problems.push({ index, problem: `范围（${isoOfDay(lo)} 到 ${isoOfDay(hi)}）里有两个正月初一：时间轴说不出这是哪一年的事，把范围收窄，或者拆成两段` });
      return (lo + hi) / 2;
    }
    return newYears.length === 1 ? newYears[0].first : (lo + hi) / 2;
  });
  return { numbers, problems };
}

// ================================================================ 三、做文件

/** 时间轴上这一段画成什么（见 src/domain/itinerary.ts 的 ItineraryLook）。 */
export function lookOf(stretch: ItineraryStretch): ItineraryLook {
  if (stretch.kind === 'stop') return 'stop';
  if (stretch.kind === 'road') return 'road';
  const type = stretch.tablePoint.type;
  return type === 'stop-point' || type === 'place' || type === 'way-vertex' ? 'quiet' : 'off';
}

/**
 * 目录里那一站旁边写什么。只在是真话的地方写：
 *   here    住在这一站讲的地方（kind 是 stop）：“他在这儿”；
 *   coming  在一趟画出来的路上，这趟路到的是这一站的地名点、出发的地方不是：“正往这儿走”；
 * 别的不写字。地名照全程沙盘的地名点的名字认。
 */
export function markOf(stretch: ItineraryStretch, route: Pick<RouteScene, 'places'>): 'here' | 'coming' | undefined {
  if (stretch.kind === 'stop') return 'here';
  if (stretch.kind !== 'road' || stretch.stopYearsOf === null) return undefined;
  const ofGroup = (name: string): boolean => route.places.some((place) => place.name === name && (place.stops ?? []).includes(stretch.stopYearsOf as string));
  return ofGroup(stretch.to) && !ofGroup(stretch.from) ? 'coming' : undefined;
}

/** 一段路上切开“一程一程”的各处：精确到日、又有位置的。月份、季节的不切（他照匀着走的步子经过那里）。 */
export function legPoints(stretch: ItineraryStretch): (ItineraryWaypoint & { at: [number, number]; date: ItineraryMoment })[] {
  if (stretch.kind !== 'road') return [];
  return (stretch.waypoints ?? []).filter((point): point is ItineraryWaypoint & { at: [number, number]; date: ItineraryMoment } => point.at !== undefined && point.date?.precision === 'day');
}

/**
 * 路上的一处，它的说不准（unsure）要不要带给读者：句子里说到了它（saysDates 里列着），或者小像照它走（它把路切成一程一程）。
 * 别的各处只是给写数据的人看的。
 */
export function doubtCarrier(stretch: ItineraryStretch, point: ItineraryWaypoint): boolean {
  return stretch.saysDates.some((entry) => entry.of === `wp:${point.name}`) || legPoints(stretch).some((leg) => leg === point);
}

/**
 * 时间轴用的那一份里，一段的“说不准的”：这一段自己的 unsure，后面接上那几处（doubtCarrier）的 unsure，一条一条用分号隔开。
 * 每一条都是手写的，原样抄；接上去的每一条前面带着那一处的名字和一个冒号（“江陵：查注引作十八日”），不然读的人不知道说的是哪一处的日子。
 * 都没有写的是空的。
 */
export function unsureOf(stretch: ItineraryStretch): string {
  const fromPoints = (stretch.waypoints ?? []).filter((point) => doubtCarrier(stretch, point) && (point.unsure ?? '').trim() !== '').map((point) => `${point.name}：${point.unsure}`);
  return [stretch.unsure, ...fromPoints].filter((written) => written.trim() !== '').join('；');
}

/** 第一行括号里也许要写的一个公历月份，史料担保不担保得了。 */
export interface WesternMonth {
  /** 第几段（从 0 数）。 */
  stretch: number;
  /** 公历的年、月（儒略历）。 */
  year: number;
  month: number;
  /** 担保得了：这一段在这个月落在农历年尾巴里的那一截结束以前一定已经开始，到那一截开始的时候一定还没有结束。 */
  held: boolean;
}

/**
 * 时间轴第一行的括号：一个农历年的最后几十天落在公历的下一年里（腊月常常已经是下一年的一月），那些天括号里写的是那一天公历的年和月
 *（“景祐三年（1037年1月）”）。写了月份，“某年某月、在某地”也要是史料担保得了的。这里把每一段在时间轴上碰到的每一个这样的月份列出来，
 * 各做农历年的那两样比较：这一段最晚的开始不晚于这个月落在这个农历年里的那一截的最后一天，最早的结束不早于那一截的头一天。
 * 两样都成立的（held）括号里写年和月；有一样不成立的，时间轴在那些天照平常只写这个农历年的那个公元年（见 projectItinerary 的 plainMonths）。
 * “这一段在时间轴上碰到哪些天”照做出来的那一份算（头尾取到小数点后两位，同 projectItinerary 一样）。
 */
export function westernMonths(itinerary: Pick<Itinerary, 'stretches' | 'years'>): WesternMonth[] {
  const zero = dayZero(itinerary);
  const { numbers } = boundaryNumbers(itinerary);
  const years = lunarYears(itinerary);
  const out: WesternMonth[] = [];
  if (zero === null) return out;
  itinerary.stretches.forEach((stretch, i) => {
    const [a, b] = [twoPlaces(numbers[i] - zero), twoPlaces(numbers[i + 1] - zero)];
    const [latestStart, earliestEnd] = [latestOf(stretch.start), earliestOf(stretch.end)];
    if (Number.isNaN(a) || Number.isNaN(b) || latestStart === null || earliestEnd === null) return;
    // 圆钮停在这一段里的时候，那一天是哪几天（最后一段连最后一天也算：圆钮停得到那里）
    const firstDay = zero + Math.floor(a);
    const lastDay = zero + (i === itinerary.stretches.length - 1 ? Math.floor(b) : Math.ceil(b) - 1);
    for (const year of years) {
      // 这个农历年的尾巴：公历已经是下一年的那些天
      const tailFirst = Math.max(year.first, julianDay(year.year + 1, 1, 1));
      let day = Math.max(firstDay, tailFirst);
      const until = Math.min(lastDay, year.last);
      while (day <= until) {
        const [y, m] = isoOfDay(day).split('-').map(Number);
        const nextMonth = m === 12 ? julianDay(y + 1, 1, 1) : julianDay(y, m + 1, 1);
        const partFirst = Math.max(julianDay(y, m, 1), tailFirst);
        const partLast = Math.min(nextMonth - 1, year.last);
        out.push({ stretch: i, year: y, month: m, held: latestStart <= partLast && earliestEnd >= partFirst });
        day = nextMonth;
      }
    }
  });
  return out;
}

/** 第 0 天：链的头一天（他出生的那一天）。 */
export function dayZero(itinerary: Pick<Itinerary, 'stretches'>): number | null {
  return itinerary.stretches.length === 0 ? null : earliestOf(itinerary.stretches[0].start);
}

const twoPlaces = (n: number): number => Math.round(n * 100) / 100;

/**
 * 时间轴用的那一份。手写的那一份要先过了校验（规则 22 的前九句）才做得对；头尾放不了的，这里照 NaN 写出来的东西不能用。
 * 句子（label、says、unsure、first、last）原样抄，一个字不动；程序不拼句子——“说不准的”只是把这一段的和路上那几处的
 * 一条一条接起来（unsureOf）。人物的名字照 figure.json 的 name 抄（时间轴给读屏念的名字、首页第一行开头的名字用它）。
 * 第一行括号里担保不了的公历月份（westernMonths 里 held 是 false 的）一段一段记在 plainMonths 里：时间轴在那些天只写年份。
 */
export function projectItinerary(itinerary: Itinerary, route: Pick<RouteScene, 'places'>, figure: Pick<Figure, 'name'>): ItineraryBar {
  const zero = dayZero(itinerary) ?? 0;
  const { numbers } = boundaryNumbers(itinerary);
  const unheld = westernMonths(itinerary).filter((pair) => !pair.held);
  const stretches = itinerary.stretches.map((stretch, i): ItineraryBarStretch => {
    const look = lookOf(stretch);
    const out: ItineraryBarStretch = { id: stretch.id, look, label: stretch.label, says: stretch.says, until: twoPlaces(numbers[i + 1] - zero) };
    const unsure = unsureOf(stretch);
    if (unsure !== '') out.unsure = unsure;
    const plain = unheld.filter((pair) => pair.stretch === i).map((pair): [number, number] => [pair.year, pair.month]);
    if (plain.length > 0) out.plainMonths = plain;
    if (stretch.stopYearsOf !== null) out.group = stretch.stopYearsOf;
    const mark = markOf(stretch, route);
    if (mark) out.mark = mark;
    if (stretch.kind === 'stop') out.place = stretch.place;
    if (stretch.kind === 'elsewhere') {
      const point = stretch.tablePoint;
      if (point.type === 'stop-point' || point.type === 'place') out.place = point.place;
      if (point.type === 'way-vertex') out.spot = point.modern ? [point.way, point.at, point.name, point.modern] : [point.way, point.at, point.name];
    }
    if (stretch.kind === 'road') {
      out.ways = stretch.parts.flatMap((part) => part.ways);
      out.dashed = stretch.parts.map((part) => part.class === 'schematic');
      const legs = legPoints(stretch);
      if (legs.length > 0) out.legs = legs.map((point) => [point.at, (earliestOf(point.date) ?? NaN) - zero]);
    }
    return out;
  });
  return {
    day0: isoOfDay(zero),
    name: figure.name,
    years: itinerary.years.map((row) => [row.year, row.name, row.newYear === null ? null : (dayOfIso(row.newYear) ?? NaN) - zero, row.age]),
    first: { label: itinerary.first.label, says: itinerary.first.says },
    last: { label: itinerary.last.label, says: itinerary.last.says },
    stretches,
  };
}

/** 时间轴用的那一份写成文件里的字：不缩进，一行，最后有一个换行。（工具做的，不手改；页面的程序把它整个带进时间轴的那一块。） */
export function barText(bar: ItineraryBar): string {
  return `${JSON.stringify(bar)}\n`;
}
