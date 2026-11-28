import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { parseHash } from './app/router';
import { loadLists } from './domain';
import { followFontScope } from './fonts/scope';
// 随站的字体排在最前面：框架的两条 @font-face、每个范围不用点开就要的文件各一条、每个范围一条换名称的规则（工具做的，见 docs/data-spec.md“随站的字体”）。
import './fonts/fonts.css';
import './styles/tokens.css';
import './styles/base.css';
import './styles/home.css';
import './styles/layout.css';
import './styles/reading.css';
import './styles/guide.css';

// 这一页的字体归哪个范围，页面还没画就写到 <html> 上、照它把这一页自己的字体文件要来，往后地址每变一回马上再写、再要
//（src/fonts/scope.ts）：从这一行起就听着，不等路由开始听（src/app/router.ts 要等页面头一回画完才听，它听到了也写一遍）。
followFontScope(() => parseHash(window.location.hash), () => import('./fonts/scopes'));

// 内容的清单是另一小块（src/domain/contentLists.ts）：页面还没画就去要，和首页的卡片、人物的资料同时要，
// 读一站、读一座沙盘的时候不用再等它。这一次没取到不要紧：谁用到它谁再取一遍，取不到的话页面在那里说。
loadLists().catch(() => {});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
