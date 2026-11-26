import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { loadLists } from './domain';
// 随站的字体排在最前面：四条 @font-face（工具做的，见 docs/data-spec.md“随站的字体”）。
import './fonts/fonts.css';
import './styles/tokens.css';
import './styles/base.css';
import './styles/home.css';
import './styles/layout.css';
import './styles/reading.css';
import './styles/guide.css';

// 内容的清单是另一小块（src/domain/contentLists.ts）：页面还没画就去要，和首页的卡片、人物的资料同时要，
// 读一站、读一座沙盘的时候不用再等它。这一次没取到不要紧：谁用到它谁再取一遍，取不到的话页面在那里说。
loadLists().catch(() => {});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
