// 人物页和它的各站共用的版面：一栏文字，一栏沙盘。
// 人物页上沙盘栏摆全程沙盘；进了一站，摆这一站的沙盘，镜头跟着读到的小节走；这一站还没有自己的沙盘时，
// 摆的还是全程沙盘，看的是到这一站去的来路。

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { figureHref, homeHref, stopHref } from '../app/router';
import { useLoaded } from '../app/useLoaded';
import type { Loaded as LoadedValue } from '../app/useLoaded';
import { hasStopTable, loadFigure, loadStopTable, stopMarks } from '../domain';
import type { Figure } from '../domain';
import type { StopTable } from '../stage/types';
import { FigureContents } from './FigureContents';
import { PageTitle } from './PageTitle';
import { StagePane } from './StagePane';
import { StopPage } from './StopPage';
import { pickRouteTable } from './stageEngineSource';
import { SITE_TITLE, pageTitle } from './text';

interface Props {
  figureId: string;
  /** 正在读的那一站；人物页上为 null。 */
  stopId: string | null;
}

/** 这一站没有沙盘。 */
const NO_TABLE: LoadedValue<StopTable | null> = { state: 'ready', value: null };

export function FigureLayout({ figureId, stopId }: Props) {
  const figure = useLoaded(figureId, () => loadFigure(figureId));

  if (figure.state === 'loading') {
    // 两栏的壳，沙盘栏空着（只有它的底色）：从首页潜过来的时候，画面刚淡进沙盘栏的底色里，不能换成没有沙盘栏的一页闪一下
    return (
      <div className="figure-layout">
        <main className="reading">
          <div className="reading-inner">
            <p className="quiet">加载中…</p>
          </div>
        </main>
        <section className="stage-pane is-pinned" data-stage-state="loading" data-stage-picture="none" />
      </div>
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
  const stop = stopId ? (figure.stops.find((s) => s.id === stopId) ?? null) : null;
  const figureId = figure.id;
  const stopKey = stop ? stop.id : null;

  // 这一站的沙盘：场景和地形文件的网址；做过先画好的地面、每一小节的定格图的，读取的时候一并带了上来，原样交给沙盘栏。
  // 还没有场景文件的站是 null，这一点不用等就知道，沙盘栏一上来就摆全程沙盘。
  // attempt 是读者点“再试一次”的次数：没读出来时，每点一次重读一遍。
  const [attempt, setAttempt] = useState(0);
  const tableKey = stopKey ? `${figureId}/${stopKey}` : '';
  const hasTable = stopKey !== null && hasStopTable(figureId, stopKey);
  const loaded = useLoaded(`${tableKey}#${attempt}`, () => (stopKey && hasTable ? loadStopTable(figureId, stopKey) : Promise.resolve(null)));
  const table = useMemo<LoadedValue<StopTable | null>>(() => {
    if (!hasTable) return NO_TABLE;
    if (loaded.state !== 'ready') return loaded;
    const found = loaded.value;
    // found 里是 scene、terrainUrl，有的话还有 ground（先画好的地面）和 stills（每一小节的定格图）
    return { state: 'ready', value: found ? { kind: 'stop', key: tableKey, ...found } : null };
  }, [hasTable, loaded, tableKey]);
  // 全程沙盘，一位人物一座，只读一次：人物页和没有自己的沙盘的各站用的是同一座。每一站的印（第几站、通到哪）从 figure.json 里拼。
  // 没读出来时，读者点“再试一次”也重读一遍（again 是点的次数）。
  const [again, setAgain] = useState(0);
  const route = useLoaded(`${figureId}#${again}`, () => pickRouteTable(figureId));
  // “再试一次”重读的是没读出来的那一座。
  const reloadTable = useCallback(() => (table.state === 'error' ? setAttempt : setAgain)((count) => count + 1), [table.state]);
  const marks = useMemo(() => stopMarks(figure, (id) => stopHref(figureId, id)), [figure, figureId]);
  const routeScene = route.state === 'ready' && route.value ? route.value.scene : null;
  // 这一站没有自己的沙盘，而全程沙盘上有到这一站去的那一节：正文那一栏可以说“沙盘上是到这一站的来路”。
  const road = !hasTable && !!routeScene?.sections.some((s) => s.stop === stopKey);

  // 读者读到了哪一小节（正文还没写、有自己的沙盘的一站上：读者在文字栏的单子里按了哪一处）。
  // 记着是哪一站的：换了站，上一站的不算；离开又回到同一站，也从头算。
  const [reading, setReading] = useState<{ stopId: string; section: string } | null>(null);
  useEffect(() => {
    setReading(null);
  }, [stopKey]);
  const onSection = useCallback(
    (section: string) => {
      if (stopKey) setReading({ stopId: stopKey, section });
    },
    [stopKey],
  );
  const section = reading && reading.stopId === stopKey ? reading.section : null;

  return (
    <div className="figure-layout">
      <main className="reading">
        <div className="reading-inner">
          <nav className="crumbs" aria-label="位置">
            <a href={homeHref}>{SITE_TITLE}</a>
            {stopId && (
              <>
                <span className="crumbs-sep" aria-hidden="true" />
                <a href={figureHref(figure.id)}>{figure.name}</a>
              </>
            )}
          </nav>

          {!stopId && <FigureContents figure={figure} route={routeScene} />}
          {stopId && stop && <StopPage key={stop.id} figure={figure} stop={stop} table={table} road={road} section={section} onSection={onSection} />}
          {stopId && !stop && <MissingStop figure={figure} />}
        </div>
      </main>

      <StagePane
        onStopPage={stop !== null}
        table={table}
        section={section}
        route={route}
        stopId={stopKey}
        marks={marks}
        written={stop?.status === 'complete'}
        onReloadTable={reloadTable}
      />
    </div>
  );
}

function MissingStop({ figure }: { figure: Figure }) {
  return (
    <div className="missing">
      <PageTitle documentTitle={pageTitle(figure.name)}>没有这一站</PageTitle>
      <p className="quiet">
        <a className="text-link" href={figureHref(figure.id)}>
          回到{figure.name}的各站目录
        </a>
      </p>
    </div>
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
