import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
// 随站的字体排在最前面：三条 @font-face（工具做的，见 docs/data-spec.md“随站的字体”）。
import './fonts/fonts.css';
import './styles/tokens.css';
import './styles/base.css';
import './styles/home.css';
import './styles/layout.css';
import './styles/reading.css';
import './styles/guide.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
