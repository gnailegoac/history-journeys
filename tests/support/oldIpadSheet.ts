// “老平板”的替身：把一份样式表照 iPadOS 15 的 Safari 的读法改一遍。只算字，不碰磁盘，也不引别的文件
//（浏览器测试要用它，那边引不得读 content/ 的那些模块）。
// 用的地方：tests/build/dist-size.test.ts（构建出来的样式表改完应该一个字不差）、tests/e2e/pane-look.spec.ts（拿改过的顶替真的）。

/**
 * 照“老平板”的读法把一份样式表改一遍：@container 的块整块去掉，值里用了 cqw 的声明改成 unset
 *（iPadOS 15 的 Safari 两样都不认：不认的 @ 规则整块丢掉；带着 var() 的声明里有不认的单位，算到最后等于没写）。
 * 给出改过的样式表，和去掉了几块、改了几条。引号里和括号里的大括号、分号不当真。
 * 浏览器测试拿改过的样式表顶替真的那一份，看老平板上会算出什么样子（tests/e2e/pane-look.spec.ts）；
 * 这只是照着规矩推出来的替身，不是 Safari。现在的样式表里这两样一处也没有，改完应该一个字不差。
 */
export function oldIpadSheet(css: string): { css: string; containers: number; cqw: number } {
  let out = '';
  let containers = 0;
  let cqw = 0;
  /** 眼下这一段（一条声明，或者一对大括号前面的那一截）在 out 里从哪里起。 */
  let from = 0;
  let quote = '';
  let parens = 0;
  /** 从 at（一个左大括号）起，找到和它配对的右大括号在哪。 */
  const closing = (at: number): number => {
    let depth = 0;
    let inQuote = '';
    for (let j = at; j < css.length; j++) {
      const ch = css[j];
      if (inQuote) {
        if (ch === '\\') j++;
        else if (ch === inQuote) inQuote = '';
      } else if (ch === '"' || ch === "'") inQuote = ch;
      else if (ch === '{') depth++;
      else if (ch === '}' && --depth === 0) return j;
    }
    return css.length - 1;
  };
  for (let i = 0; i < css.length; i++) {
    const c = css[i];
    if (quote) {
      out += c;
      if (c === '\\') out += css[++i] ?? '';
      else if (c === quote) quote = '';
    } else if (c === '"' || c === "'") {
      quote = c;
      out += c;
    } else if (c === '(') {
      parens++;
      out += c;
    } else if (c === ')') {
      parens = Math.max(0, parens - 1);
      out += c;
    } else if (parens > 0) {
      out += c;
    } else if (c === '{') {
      if (/^\s*@container\b/.test(out.slice(from))) {
        out = out.slice(0, from);
        containers++;
        i = closing(i);
      } else {
        out += c;
        from = out.length;
      }
    } else if (c === ';' || c === '}') {
      const piece = out.slice(from);
      const colon = piece.indexOf(':');
      if (colon > 0 && piece.slice(colon).includes('cqw')) {
        out = `${out.slice(0, from)}${piece.slice(0, colon)}:unset`;
        cqw++;
      }
      out += c;
      from = out.length;
    } else {
      out += c;
    }
  }
  return { css: out, containers, cqw };
}
