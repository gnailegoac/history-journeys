// 内容校验里“格式”这一层：一份 JSON 数据的样子对不对。字段齐不齐，类型对不对，数字在不在说得通的范围里，
// 有没有不认识的字段。另有几样各条规则都要用的小东西：一处问题怎么记，文件在不在，JSON 读不读得出来。
// 全是纯函数：不读磁盘，也不依赖测试框架。

/**
 * 内容目录读进内存的样子：相对 content/ 的路径（用“/”分隔，如 figures/su-shi/figure.json）→ 文件里的文字。
 * 图片、地形文件等只看有没有，文字留空。
 */
export type ContentFiles = Record<string, string>;

/**
 * 二进制文件有多大：相对 content/ 的路径 → 字节数。地形文件、先画好的地面和定格图的大小有规定（规则 10、16、17、18），
 * 规则自己不读磁盘，由调用的人量好了给进来。这里没有的文件不查大小。
 */
export type FileSizes = Record<string, number>;

/**
 * 图片有多宽、多高（像素）：相对 content/ 的路径 → 宽和高。人物页定格图写的宽高要和图片文件一样（规则 16），
 * 先画好的地面和每一小节的定格图也一样（规则 17、18）。规则自己不读磁盘，由调用的人量好了给进来。这里没有的图片（比如 SVG）不查。
 */
export type PictureSizes = Record<string, { width: number; height: number }>;

/** 一处不合规格的地方。 */
export interface Violation {
  /** 0 是“格式”；1 到 18 对应数据规格里的校验规则。 */
  rule: number;
  /** 哪个文件，相对 content/ 的路径。 */
  file: string;
  /** 哪个字段（正文则是哪一行、哪个小节）；说的是整个文件时为空。 */
  field: string;
  /** 哪里不对。 */
  problem: string;
}

export function violation(rule: number, file: string, field: string, problem: string): Violation {
  return { rule, file, field, problem };
}

export function has(files: ContentFiles, path: string): boolean {
  return Object.hasOwn(files, path);
}

/** 读一个 JSON 文件；没有这个文件或读不出来时 data 为 undefined，并说明原因。 */
export function readJson(files: ContentFiles, file: string): { data?: unknown; violations: Violation[] } {
  if (!has(files, file)) return { violations: [violation(0, file, '', '没有这个文件')] };
  try {
    return { data: JSON.parse(files[file].replace(/^\uFEFF/, '')) as unknown, violations: [] };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { violations: [violation(0, file, '', `不是合法的 JSON，程序读不出来（${detail}）`)] };
  }
}

/** 一个坐标哪里不对；没问题时返回 null。 */
export function lngLatProblem(value: unknown): string | null {
  if (!Array.isArray(value) || value.length !== 2 || !value.every((n) => typeof n === 'number' && Number.isFinite(n))) {
    return '应该写成 [经度, 纬度] 两个数';
  }
  const [lng, lat] = value as [number, number];
  if (lng < -180 || lng > 180) return `经度 ${lng} 超出范围（应在 -180 到 180 之间）`;
  if (lat < -90 || lat > 90) {
    const swapped = Math.abs(lng) <= 90 ? '；是不是把经度和纬度写反了？' : '';
    return `纬度 ${lat} 超出范围（应在 -90 到 90 之间）${swapped}`;
  }
  return null;
}

// ---------------------------------------------------------------- 样子

/** 一个数要在什么范围里。above 是必须比它大（不含它自己）；min、max 含它们自己。 */
export interface NumberRange {
  above?: number;
  min?: number;
  max?: number;
  /** 必须是整数。 */
  whole?: boolean;
}

/** 几种写法里选一种时，选不出来的原因：哪个字段（相对这组字段；空的是这组字段自己），哪里不对。 */
export interface PickProblem {
  field: string;
  problem: string;
}

/**
 * 字段该是什么样子。
 *   any      什么都行（另有规则细查的）。
 *   lngLat   坐标 [经度, 纬度]；不对时算在规则 1“坐标”上。
 *   object   一组字段。strict 的不许有这里没列的字段（防的是把 from 错写成 form 这一类错）。
 *   optional 可以不写；写了就要符合里面的样子。
 *   record   名字随便起、值都是同一种样子的一组字段（水位的名字和海拔）。
 *   union    几种写法里的一种：pick 看这组字段是哪一种，给出那一种的样子；看不出来就说哪里不对。
 */
export type Shape =
  | { is: 'string' | 'boolean' | 'any' | 'lngLat' }
  | { is: 'number'; range?: NumberRange }
  | { is: 'oneOf'; values: readonly string[] }
  | { is: 'list'; item: Shape }
  | { is: 'object'; fields: Record<string, Shape>; strict: boolean }
  | { is: 'optional'; item: Shape }
  | { is: 'record'; item: Shape }
  | { is: 'union'; pick: (fields: Record<string, unknown>) => Shape | PickProblem };

export const text: Shape = { is: 'string' };
export const number: Shape = { is: 'number' };
export const bool: Shape = { is: 'boolean' };
export const anything: Shape = { is: 'any' };
export const lngLat: Shape = { is: 'lngLat' };
export const numberIn = (range: NumberRange): Shape => ({ is: 'number', range });
export const oneOf = (values: readonly string[]): Shape => ({ is: 'oneOf', values });
export const list = (item: Shape): Shape => ({ is: 'list', item });
/** 一组字段，多出别的字段不管。 */
export const object = (fields: Record<string, Shape>): Shape => ({ is: 'object', fields, strict: false });
/** 一组字段，不许有没列出来的字段。 */
export const strict = (fields: Record<string, Shape>): Shape => ({ is: 'object', fields, strict: true });
export const optional = (item: Shape): Shape => ({ is: 'optional', item });
export const record = (item: Shape): Shape => ({ is: 'record', item });
export const union = (pick: (fields: Record<string, unknown>) => Shape | PickProblem): Shape => ({ is: 'union', pick });

/** 用一个字段的值来分的几种写法，如修整的 op：level 是一种样子，mound 是另一种。 */
export function tagged(tag: string, cases: Record<string, Shape>): Shape {
  return union((fields) => {
    const value = fields[tag];
    if (typeof value === 'string' && Object.hasOwn(cases, value)) return cases[value];
    return { field: tag, problem: value === undefined ? '缺少这个字段' : `只能是 ${Object.keys(cases).join(' 或 ')}` };
  });
}

/** 对照样子检查一份 JSON 数据：缺了哪个字段，哪个字段的类型不对，哪个数不在范围里，哪个字段不认识。 */
export function checkShape(value: unknown, shape: Shape, file: string, field = ''): Violation[] {
  const bad = (problem: string) => [violation(0, file, field, problem)];
  const under = (name: string) => (field === '' ? name : `${field}.${name}`);
  if (shape.is === 'optional') return value === undefined ? [] : checkShape(value, shape.item, file, field);
  if (shape.is !== 'any' && value === undefined) return bad('缺少这个字段');
  switch (shape.is) {
    case 'any':
      return [];
    case 'string':
      return typeof value === 'string' ? [] : bad('应该是一段文字（写在双引号里）');
    case 'number': {
      if (typeof value !== 'number' || !Number.isFinite(value)) return bad('应该是一个数');
      const problem = shape.range ? rangeProblem(value, shape.range) : null;
      return problem ? bad(problem) : [];
    }
    case 'boolean':
      return typeof value === 'boolean' ? [] : bad('应该是 true 或 false');
    case 'lngLat': {
      const problem = lngLatProblem(value);
      return problem ? [violation(1, file, field, problem)] : [];
    }
    case 'oneOf':
      return typeof value === 'string' && shape.values.includes(value) ? [] : bad(`只能是 ${shape.values.join(' 或 ')}`);
    case 'list':
      if (!Array.isArray(value)) return bad('应该是一个列表（写在 [ ] 里）');
      return value.flatMap((item, i) => checkShape(item, shape.item, file, `${field}[${i}]`));
    case 'object': {
      if (!isFields(value)) return bad('应该是一组字段（写在 { } 里）');
      const out = Object.entries(shape.fields).flatMap(([name, item]) => checkShape(value[name], item, file, under(name)));
      if (shape.strict) {
        const known = Object.keys(shape.fields);
        for (const name of Object.keys(value)) {
          if (!known.includes(name)) out.push(violation(0, file, under(name), `不认识这个字段（这里可以写：${known.join('、')}）`));
        }
      }
      return out;
    }
    case 'record':
      if (!isFields(value)) return bad('应该是一组字段（写在 { } 里）');
      return Object.entries(value).flatMap(([name, item]) => checkShape(item, shape.item, file, under(name)));
    case 'union': {
      if (!isFields(value)) return bad('应该是一组字段（写在 { } 里）');
      const picked = shape.pick(value);
      if ('is' in picked) return checkShape(value, picked, file, field);
      return [violation(0, file, picked.field === '' ? field : under(picked.field), picked.problem)];
    }
  }
}

function isFields(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function rangeProblem(value: number, range: NumberRange): string | null {
  if (range.whole && !Number.isInteger(value)) return `应该是一个整数，现在是 ${value}`;
  const tooLow = (range.above !== undefined && value <= range.above) || (range.min !== undefined && value < range.min);
  const tooHigh = range.max !== undefined && value > range.max;
  if (!tooLow && !tooHigh) return null;
  const lowest = range.above !== undefined ? `大于 ${range.above}` : range.min !== undefined ? `不小于 ${range.min}` : '';
  const highest = range.max !== undefined ? `不大于 ${range.max}` : '';
  if (range.min !== undefined && range.max !== undefined) return `应该在 ${range.min} 到 ${range.max} 之间，现在是 ${value}`;
  return `应该${[lowest, highest].filter((part) => part !== '').join('、')}，现在是 ${value}`;
}
