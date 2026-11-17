// 三种页面的分派。人物页和它的各站共用一个版面（FigureLayout），地图在其中一直挂着。

import { useEffect } from 'react';
import { FigureLayout } from '../ui/FigureLayout';
import { HomePage } from '../ui/HomePage';
import { useRoute } from './router';

export function App() {
  const route = useRoute();
  const pageKey = route.page === 'home' ? '' : route.page === 'figure' ? route.figureId : `${route.figureId}/${route.stopId}`;

  // 换页后从头读起。
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pageKey]);

  if (route.page === 'home') return <HomePage />;
  return (
    <FigureLayout
      key={route.figureId}
      figureId={route.figureId}
      stopId={route.page === 'stop' ? route.stopId : null}
    />
  );
}
