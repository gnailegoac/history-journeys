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

/** 样式表里的一条声明：在哪个选择器（或者 @font-face 这样的块）下面，属性，值。 */
export interface Declaration {
  selector: string;
  property: string;
  value: string;
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
  const stack: { prelude: string; kind: 'group' | 'rule' | 'keyframes' }[] = [];
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
    declarations.push({ selector: top.prelude, property: piece.slice(0, colon).trim(), value: piece.slice(colon + 1).trim() });
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
      stack.push({ prelude, kind });
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

/** 字体的两个记号。别的 --font-… 都不许有。 */
const FONT_TOKENS = ['--font-song', '--font-kai'];
/** font-family 的值只许是这几种：两个记号之一；记号后面带一串兜底的字体（题签用，开发时单看沙盘的页面没有记号）；跟着上一层。 */
const familyAllowed = (value: string): boolean => /^var\(--font-(song|kai)\)$/.test(value) || /^var\(--font-(song|kai),/.test(value) || value === 'inherit';
/** 设备自带的黑体一类：哪里都不该出现。 */
const SANS_WORDS = ['system-ui', 'sans-serif', 'PingFang', 'YaHei'];

/**
 * 扫一份样式表。找这些：
 *   font-weight   不是 400、也不是 var(--weight-heading) 的；--weight-heading 这个记号不是 400
 *   font-style    不是 normal 的；哪里写了 italic、oblique
 *   font          简写（只许 font: inherit）
 *   font-family   不是两个记号的；别的 --font-… 记号；system-ui、sans-serif、PingFang、YaHei 这几个词
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
  for (const { property, value } of declarations) {
    const line = `${property}: ${value}`;
    if (property === 'font-weight' && value !== '400' && value !== 'var(--weight-heading)') add('font-weight', line);
    if (property === '--weight-heading' && value !== '400') add('font-weight', line);
    if (property === 'font-style' && value !== 'normal') add('font-style', line);
    if (property === 'font' && value !== 'inherit') add('font', line);
    if (property === 'font-family' && !familyAllowed(value)) add('font-family', line);
    if (property.startsWith('--font-') && !FONT_TOKENS.includes(property)) add('font-family', `${property}: …`);
    if (property === 'content' && hasQuotedText(value)) add('content', line);
    if ((property === 'text-decoration' || property === '-webkit-text-decoration') && value.split(/\s+/).length > 1) add('text-decoration', line);
    if (property !== 'font-style' && /\bitalic\b|\boblique\b/.test(value)) add('font-style', line);
    if (/color-mix\(/.test(value)) add('color-mix', line);
    if (property === 'text-wrap' || property.startsWith('text-wrap-')) add('text-wrap', line);
  }
  const text = stripCssComments(css);
  for (const word of SANS_WORDS) for (let i = 0; i < countIn(text, word); i++) add('sans', word);
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
