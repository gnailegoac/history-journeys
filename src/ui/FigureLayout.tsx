// 人物页和它的各站共用的版面：一栏文字，一栏沙盘。
// 人物页上沙盘栏放全程沙盘的定格图；进了一站，摆这一站的沙盘，镜头跟着读到的小节走。

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { figureHref, homeHref } from '../app/router';
import { useLoaded } from '../app/useLoaded';
import type { Loaded as LoadedValue } from '../app/useLoaded';
import { hasStopTable, loadFigure, loadStopTable } from '../domain';
import type { Figure } from '../domain';
import type { StopTable } from '../stage/types';
import { FigureContents } from './FigureContents';
import { PageTitle } from './PageTitle';
import { StagePane } from './StagePane';
import { StopPage } from './StopPage';
import { pickRouteStill } from './stageEngineSource';
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
  const stop = stopId ? (figure.stops.find((s) => s.id === stopId) ?? null) : null;
  const figureId = figure.id;
  const stopKey = stop ? stop.id : null;

  // 这一站的沙盘：场景和地形文件的网址；做过先画好的地面、每一小节的定格图的，读取的时候一并带了上来，原样交给沙盘栏。
  // 还没有场景文件的站是 null，这一点不用等就知道，沙盘栏一上来就放定格图，不先说一句“沙盘正在摆出来”。
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
  const reloadTable = useCallback(() => setAttempt((count) => count + 1), []);

  // 全程沙盘的定格图，一位人物一张。
  const still = useLoaded(figureId, () => pickRouteStill(figure));

  // 读者读到了哪一小节。记着是哪一站的：换了站，上一站的不算；离开又回到同一站，也从头算。
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

          {!stopId && <FigureContents figure={figure} />}
          {stopId && stop && <StopPage key={stop.id} figure={figure} stop={stop} table={table} onSection={onSection} />}
          {stopId && !stop && <MissingStop figure={figure} />}
        </div>
      </main>

      <StagePane onStopPage={stop !== null} table={table} section={section} still={still} onReloadTable={reloadTable} />
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
