// 四种页面的分派：首页，“来源”页，人物页，站点页。人物页和它的各站共用一个版面（FigureLayout），沙盘栏在其中一直挂着。

import { useEffect } from 'react';
import { FigureLayout } from '../ui/FigureLayout';
import { HomePage } from '../ui/HomePage';
import { SourcesPage } from '../ui/SourcesPage';
import { useRoute } from './router';

export function App() {
  const route = useRoute();
  const pageKey = route.page === 'home' || route.page === 'sources' ? route.page : route.page === 'figure' ? route.figureId : `${route.figureId}/${route.stopId}`;

  // 换页后从头读起。
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pageKey]);

  if (route.page === 'home') return <HomePage />;
  if (route.page === 'sources') return <SourcesPage />;
  return (
    <FigureLayout
      key={route.figureId}
      figureId={route.figureId}
      stopId={route.page === 'stop' ? route.stopId : null}
    />
  );
}
