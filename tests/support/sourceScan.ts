// 扫源文件，找不该有的写法。查随站的字体的测试用它（tests/fonts/font-files.test.ts）；只在 Node 里跑。
// 这里只管“找出来”，每一处给出在哪个文件、犯的是哪一条、原样是什么；哪些算数、哪些是眼下还许可的，由测试自己定。
//
// 为什么要扫。能跑的浏览器测试只有 Chromium，Safari 跑不了；随站的字体里又只有程序里原样写着的那些字。
// 所以有两类写法靠“写的时候就不许”来守：
//   一、会在运行时造出程序里没写着的字的（scanProgram）：转义、HTML 实体、String.fromCharCode、Intl、toLocale 打头的函数。
//   二、样式表里 Safari 15 读不懂、或者读了会出岔子的，和会让浏览器自己把字描粗、歪成斜体、换成别的字体的（scanStyle）。

import { stripComments } from './fontTool';

/** 找到的一处：在哪个文件，犯的是哪一条（一个短名字），原样是什么。 */
export interface Finding {
  file: string;
  rule: string;
  what: string;
}

// ---------------------------------------------------------------- 程序（.ts、.tsx）

const PROGRAM_RULES: { rule: string; pattern: RegExp }[] = [
  // 一、\u{4e00}、\x41 这样的转义：字没有原样写出来
  { rule: 'escape', pattern: /\\u[0-9a-fA-F{][0-9a-fA-F}]*|\\x[0-9a-fA-F]{2}/g },
  // &nbsp; &#8212; &#x2014; 这样的 HTML 实体
  { rule: 'entity', pattern: /&(?:#\d+|#x[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g },
  { rule: 'fromCharCode', pattern: /\bfromCharCode\b|\bfromCodePoint\b/g },
  { rule: 'Intl', pattern: /\bIntl\./g },
  { rule: 'toLocale', pattern: /\btoLocale[A-Za-z]*/g },
];

/** 扫一个程序文件（注释里的不算）。 */
export function scanProgram(file: string, text: string): Finding[] {
  const code = stripComments(text);
  const found: Finding[] = [];
  for (const { rule, pattern } of PROGRAM_RULES) for (const match of code.matchAll(pattern)) found.push({ file, rule, what: match[0] });
  return found;
}

// ---------------------------------------------------------------- 样式表

/** 样式表里的一条声明：在哪个选择器（或者 @font-face 这样的块）下面，属性，值；rule 是它所在的那一条规则在这份样式表里排第几（同一条规则里的声明是同一个数）。 */
export interface Declaration {
  selector: string;
  property: string;
  value: string;
  rule: number;
}

const tidy = (text: string): string => text.replace(/\s+/g, ' ').trim();

/** 去掉样式表里的注释。 */
export function stripCssComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

/**
 * 把一份样式表读成一条条声明，顺便找出嵌套着写的规则（一条规则的大括号里又有一条规则；@media、@supports、@container
 * 里面套规则不算，@keyframes 里的每一步也不算）。引号里和括号里的分号、大括号不当真（data: 网址里就有分号）。
 */
export function readCss(css: string): { declarations: Declaration[]; nested: string[] } {
  const text = stripCssComments(css);
  const declarations: Declaration[] = [];
  const nested: string[] = [];
  /** 一层大括号：它前面写的是什么，是哪一种。group 是 @media 这样的一组规则；rule 是一条规则（里面是声明）。 */
  const stack: { prelude: string; kind: 'group' | 'rule' | 'keyframes'; rule: number }[] = [];
  let rules = 0;
  let buffer = '';
  let quote = '';
  let parens = 0;
  const declare = (): void => {
    const top = stack[stack.length - 1];
    const piece = tidy(buffer);
    buffer = '';
    if (!top || top.kind !== 'rule' || piece === '') return;
    const colon = piece.indexOf(':');
    if (colon < 0) return;
    declarations.push({ selector: top.prelude, property: piece.slice(0, colon).trim(), value: piece.slice(colon + 1).trim(), rule: top.rule });
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      buffer += c;
      if (c === '\\') buffer += text[++i] ?? '';
      else if (c === quote) quote = '';
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      buffer += c;
    } else if (c === '(') {
      parens++;
      buffer += c;
    } else if (c === ')') {
      parens = Math.max(0, parens - 1);
      buffer += c;
    } else if (parens > 0) {
      buffer += c;
    } else if (c === '{') {
      const prelude = tidy(buffer);
      buffer = '';
      const parent = stack[stack.length - 1];
      const kind = /^@(media|supports|container|layer)\b/.test(prelude) ? 'group' : /^@keyframes\b/.test(prelude) ? 'keyframes' : 'rule';
      if (kind === 'rule' && parent?.kind === 'rule') nested.push(prelude);
      stack.push({ prelude, kind, rule: kind === 'rule' ? ++rules : 0 });
    } else if (c === '}') {
      declare();
      stack.pop();
    } else if (c === ';') {
      declare();
    } else {
      buffer += c;
    }
  }
  return { declarations, nested };
}

/** 一个值里有没有非空的引号字符串（content: '+' 这样的）。 */
const hasQuotedText = (value: string): boolean => /"[^"]+"|'[^']+'/.test(value);

/** 字体的两个记号（框架的）。别的 --font-… 都不许有；题签用的是人物自己的 --figure-font。 */
const FONT_TOKENS = ['--font-song', '--font-sans'];
/** font-family 的值只许是这几种：两个记号之一；跟着上一层；题签的规则里是人物自己的字体记号、后面带一串备用的字体（开发时单看沙盘的页面没有记号）。 */
const familyAllowed = (value: string, strips: boolean): boolean => /^var\(--font-(song|sans)\)$/.test(value) || value === 'inherit' || (strips && /^var\(--figure-font,/.test(value));
/** 设备自带的黑体一类：只许出现在 --font-sans 这一个记号的值里。 */
const SANS_WORDS = ['system-ui', 'sans-serif', 'PingFang', 'YaHei'];

/** 一条规则的选择器，一个一个分开（括号里的逗号不算）。 */
function selectorsOf(prelude: string): string[] {
  const list: string[] = [];
  let depth = 0;
  let piece = '';
  for (const c of prelude) {
    if (c === '(') depth++;
    if (c === ')') depth--;
    if (c === ',' && depth === 0) {
      list.push(piece.trim());
      piece = '';
    } else piece += c;
  }
  list.push(piece.trim());
  return list.filter(Boolean);
}

/** 题签的选择器：里面有 .strip、.strip-seal、.strip-leaders 这样的类（.strips 是放题签的那一层，不算）。 */
const STRIP = /\.strip(?:-[a-z]+)*(?![\w-])/;
/** 这一条规则是不是题签的：它的每一个选择器都是。 */
const isStripRule = (prelude: string): boolean => selectorsOf(prelude).every((selector) => STRIP.test(selector));
/** 人物自己的那一套记号写在哪：选择器的末尾是 .stage-pane（tokens.css 末尾的那一块；再添的人物写成 [data-figure='…'] .stage-pane）。 */
const isFigureBlock = (prelude: string): boolean => selectorsOf(prelude).every((selector) => /\.stage-pane$/.test(selector));
/** 许可直接读沙盘栏底色的两条规则：栏自己，和测试用的沙盘替身。 */
const READS_GROUND = ['.stage-pane', '.fake-stage'];
/** 一个值里读了哪几个记号。 */
const varsRead = (value: string): string[] => Array.from(value.matchAll(/var\(\s*(--[A-Za-z0-9-]+)/g), (match) => match[1]);
/** 人物自己的记号：--figure-… ，和沙盘栏的底色。 */
const isFigureToken = (name: string): boolean => name.startsWith('--figure-') || name === '--color-paper-sunk';

/**
 * 框架的样式和人物的样式各读各的那一套记号（tokens.css 开头说的两套）。找这些，都记成 seam：
 *   人物的记号（--figure-…、--color-paper-sunk）写在了沙盘栏以外的规则上；
 *   题签的规则读了人物那一套以外的记号；
 *   别的规则读了人物的记号——沙盘栏自己和沙盘的替身读栏的底色除外。
 */
function seamFindings(declarations: Declaration[], add: (rule: string, what: string) => void): void {
  for (const { selector, property, value } of declarations) {
    const strips = isStripRule(selector);
    if (isFigureToken(property) && !isFigureBlock(selector)) add('seam', `${selector} { ${property}: … }`);
    for (const name of varsRead(value)) {
      if (strips ? !name.startsWith('--figure-') : isFigureToken(name) && !(name === '--color-paper-sunk' && READS_GROUND.includes(selector))) add('seam', `${selector} { ${property}: ${value} }`);
    }
  }
}

/**
 * 扫一份样式表。找这些：
 *   font-weight   不是 400、也不是 var(--weight-sans) 的；--weight-sans 这个记号不是 500；又写了 --weight-heading
 *   sans-weight   用了黑体（font-family: var(--font-sans)）的规则，同一条里没有写 font-weight: var(--weight-sans)（黑体的文件只有 500 这一种粗细）
 *   font-style    不是 normal 的；哪里写了 italic、oblique
 *   font          简写（只许 font: inherit）
 *   font-family   不是两个记号的（题签的规则里是人物自己的那一个）；别的 --font-… 记号
 *   sans          system-ui、sans-serif、PingFang、YaHei 这几个词写在了 --font-sans 的值以外
 *   seam          框架的规则读了人物的记号，题签的规则读了框架的记号，人物的记号写在了沙盘栏以外（见 seamFindings）
 *   content       content: 里写了字（工具不看样式表，这些字进不了字体）
 *   text-decoration  简写里除了线的种类还写了别的（Safari 26.2 以前不认，线会没有）：要拆成 text-decoration-line 这几条
 *   color-mix、text-wrap  Safari 15 没有
 *   nesting       嵌套着写的规则，Safari 15 没有
 * @container、cqw、:has( 出现了几次不在这里判，用 countIn 数。
 */
export function scanStyle(file: string, css: string): Finding[] {
  const found: Finding[] = [];
  const add = (rule: string, what: string): void => {
    found.push({ file, rule, what: tidy(what) });
  };
  const { declarations, nested } = readCss(css);
  for (const prelude of nested) add('nesting', prelude);
  /** 用了黑体的规则（排第几 → 选择器），和写了黑体的粗细的规则。 */
  const sansRules = new Map<number, string>();
  const weighted = new Set<number>();
  /** --font-sans 的值：设备自带的黑体的名字只许写在这里面。 */
  let sansValue = '';
  for (const { selector, property, value, rule } of declarations) {
    const line = `${property}: ${value}`;
    if (property === 'font-weight' && value !== '400' && value !== 'var(--weight-sans)') add('font-weight', line);
    if (property === '--weight-sans' && value !== '500') add('font-weight', line);
    if (property === '--weight-heading') add('font-weight', `${property}: …`);
    if (property === 'font-style' && value !== 'normal') add('font-style', line);
    if (property === 'font' && value !== 'inherit') add('font', line);
    if (property === 'font-family' && !familyAllowed(value, isStripRule(selector))) add('font-family', line);
    if (property.startsWith('--font-') && !FONT_TOKENS.includes(property)) add('font-family', `${property}: …`);
    if (property === 'font-family' && value === 'var(--font-sans)') sansRules.set(rule, selector);
    if (property === 'font-weight' && value === 'var(--weight-sans)') weighted.add(rule);
    if (property === '--font-sans') sansValue += ` ${value}`;
    if (property === 'content' && hasQuotedText(value)) add('content', line);
    if ((property === 'text-decoration' || property === '-webkit-text-decoration') && value.split(/\s+/).length > 1) add('text-decoration', line);
    if (property !== 'font-style' && /\bitalic\b|\boblique\b/.test(value)) add('font-style', line);
    if (/color-mix\(/.test(value)) add('color-mix', line);
    if (property === 'text-wrap' || property.startsWith('text-wrap-')) add('text-wrap', line);
  }
  for (const [rule, selector] of sansRules) if (!weighted.has(rule)) add('sans-weight', selector);
  seamFindings(declarations, add);
  const text = stripCssComments(css);
  for (const word of SANS_WORDS) for (let i = 0; i < countIn(text, word) - countIn(sansValue, word); i++) add('sans', word);
  return found;
}

/** 样式表里每一句 @media 的条件，按先后（注释里的不算；压缩过的样式表也认）。 */
export function mediaQueries(css: string): string[] {
  return Array.from(stripCssComments(css).matchAll(/@media\b([^{]*)\{/g), (match) => tidy(match[1]));
}

/** 左右排的版面从多宽的窗口起（像素）：layout.css 的那条线。 */
const SIDE_BY_SIDE_FROM_PX = 960;

/**
 * 一句 @media 的条件哪里不对，一处一个词；空的就是都对。
 *   wide-layout  照窗口的宽窄分版面的一句（min-width 到了 960px）没有带“横着”——(orientation: landscape)。
 *                左右排的版面要窗口够宽、而且横着：竖着拿的大平板有 1024 像素宽，少了这半句，这条规则在它上面就照左右排算了，
 *                可它的版面是上下排的。
 *   max-width    拿“窗口不到多宽”（max-width 到了 900px）来说上下排的版面：上下排的不只是窄的窗口，竖着的宽窗口也是。
 *                要说“不是左右排”，把左右排的那一句整个反过来：not all and (min-width: 960px) and (orientation: landscape)。
 *   media-range  比大小的新写法（width >= 960px）、not 后面直接跟括号、or：iPadOS 15 的 Safari 不认（16.4 才有），整句不算数。
 */
export function mediaProblems(query: string): string[] {
  const problems: string[] = [];
  const px = (value: string, unit: string): number => Number(value) * (unit === 'px' ? 1 : 16);
  const landscape = /\(\s*orientation\s*:\s*landscape\s*\)/.test(query);
  for (const [, value, unit] of query.matchAll(/min-width\s*:\s*([\d.]+)(px|rem|em)/g)) {
    if (px(value, unit) >= SIDE_BY_SIDE_FROM_PX && !landscape && !problems.includes('wide-layout')) problems.push('wide-layout');
  }
  for (const [, value, unit] of query.matchAll(/max-width\s*:\s*([\d.]+)(px|rem|em)/g)) {
    if (px(value, unit) >= 900 && !problems.includes('max-width')) problems.push('max-width');
  }
  if (/[<>]/.test(query) || /\bnot\s*\(/.test(query) || /\)\s*or\s*\(/.test(query)) problems.push('media-range');
  return problems;
}

/** 一份样式表里每一句有毛病的 @media（见 mediaProblems）。 */
export function scanMedia(file: string, css: string): Finding[] {
  return mediaQueries(css).flatMap((query) => mediaProblems(query).map((rule) => ({ file, rule, what: query })));
}

/** 一段字里 needle 出现了几次。 */
export function countIn(text: string, needle: string): number {
  return text.split(needle).length - 1;
}

/** 一组找到的东西数一数：同一个文件、同一条、同样的原样，算一项，记次数。给出排好序的“文件 | 哪一条 | 原样 × 几次”。 */
export function tally(findings: Finding[]): string[] {
  const counts = new Map<string, number>();
  for (const { file, rule, what } of findings) {
    const key = `${file} | ${rule} | ${what}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts].map(([key, times]) => `${key} × ${times}`).sort();
}
