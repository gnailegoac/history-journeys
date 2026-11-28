// 工具做的（npm run fonts），不要手改。说明见 docs/data-spec.md“随站的字体”。
// 每个范围点开才要的那个字体文件：它的样式表的地址（页面用到时才挂上去），它里面的一个字和它在样式表里的名称（页面拿这两样叫浏览器先把那个文件取来）。

import sheet0 from './scopes/goethe.css?url';
import sheet1 from './scopes/su-shi.css?url';
import sheet2 from './scopes/su-shi.meishan.css?url';
import sheet3 from './scopes/su-shi.xuzhou.css?url';
import sheet4 from './scopes/su-shi.huangzhou.css?url';

export const SCOPE_PRESSED: Record<string, { sheet: string; probe: string; face: string }> = {
  'goethe': { sheet: sheet0, probe: '丁', face: 'Yanlu Song goethe' },
  'su-shi': { sheet: sheet1, probe: '丁', face: 'Yanlu Song su-shi' },
  'su-shi/meishan': { sheet: sheet2, probe: '②', face: 'Yanlu Song su-shi meishan' },
  'su-shi/xuzhou': { sheet: sheet3, probe: '《', face: 'Yanlu Song su-shi xuzhou' },
  'su-shi/huangzhou': { sheet: sheet4, probe: '〇', face: 'Yanlu Song su-shi huangzhou' },
};
