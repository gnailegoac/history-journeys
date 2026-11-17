// 人物页和它的各站共用的版面：一栏文字，一张一直挂着的地图。镜头跟着读到的地方走。

import { useCallback, useEffect, useMemo } from 'react';
import type { ReactNode } from 'react';
import { figureHref, homeHref, stopHref } from '../app/router';
import { useLoaded } from '../app/useLoaded';
import { loadFigure, toMapRoute } from '../domain';
import type { Figure } from '../domain';
import { FigureContents } from './FigureContents';
import { MapPane } from './MapPane';
import { PageTitle } from './PageTitle';
import { StopPage } from './StopPage';
import { SITE_TITLE, pageTitle } from './text';

interface Props {
  figureId: string;
  /** 正在读的那一站；人物页上为 null。 */
  stopId: string | null;
}

export function FigureLayout({ figureId, stopId }: Props) {
  const figure = useLoaded(figureId, () => loadFigure(figureId));

  if (figure.state === 'loading') {
    return (
      <main className="plain-page">
        <p className="quiet">加载中…</p>
      </main>
    );
  }
  if (figure.state === 'error' || !figure.value) {
    return (
      <Missing title="没有找到这位人物" documentTitle={SITE_TITLE}>
        <a className="text-link" href={homeHref}>
          回到首页
        </a>
      </Missing>
    );
  }
  return <Loaded figure={figure.value} stopId={stopId} />;
}

function Loaded({ figure, stopId }: { figure: Figure; stopId: string | null }) {
  const route = useMemo(() => toMapRoute(figure), [figure]);
  const stop = stopId ? (figure.stops.find((s) => s.id === stopId) ?? null) : null;
  const figureId = figure.id;

  const openStop = useCallback(
    (id: string) => {
      window.location.hash = stopHref(figureId, id);
    },
    [figureId],
  );

  return (
    <div className="figure-layout">
      <main className="reading">
        <div className="reading-inner">
          <nav className="crumbs" aria-label="位置">
            <a href={homeHref}>{SITE_TITLE}</a>
            {stopId && (
              <>
                <span aria-hidden="true"> / </span>
                <a href={figureHref(figure.id)}>{figure.name}</a>
              </>
            )}
          </nav>

          {!stopId && <FigureContents figure={figure} />}
          {stopId && stop && <StopPage key={stop.id} figure={figure} stop={stop} />}
          {stopId && !stop && <MissingStop figure={figure} />}
        </div>
      </main>

      <MapPane route={route} stopId={stop ? stop.id : null} onStopSelect={openStop} />
    </div>
  );
}

function MissingStop({ figure }: { figure: Figure }) {
  return (
    <>
      <PageTitle documentTitle={pageTitle(figure.name)}>没有这一站</PageTitle>
      <p className="quiet">
        <a className="text-link" href={figureHref(figure.id)}>
          回到{figure.name}的各站目录
        </a>
      </p>
    </>
  );
}

function Missing({ title, documentTitle, children }: { title: string; documentTitle: string; children: ReactNode }) {
  useEffect(() => {
    document.title = documentTitle;
  }, [documentTitle]);
  return (
    <main className="plain-page">
      <h1 className="page-title">{title}</h1>
      <p className="quiet">{children}</p>
    </main>
  );
}
