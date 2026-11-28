// 首页：文字栏（网站的名字、一句话、人物卡片、“来源”），旁边的沙盘栏里摆着一位人物的全程沙盘。
// 版面和人物页是同一种：宽屏上文字栏在左、沙盘栏在右；别的窗口上沙盘栏在上、文字栏在下。
// 沙盘栏就是人物页用的那一栏（StagePane），交给它的是第一位可以点进去的人物的全程沙盘和各站的印，和人物页上是同一座。

import { useEffect, useLayoutEffect, useState } from 'react';
import { figureHref, sourcesHref, stopHref } from '../app/router';
import { useLoaded } from '../app/useLoaded';
import { lacksItinerary, loadFigure, loadFigureCards, stopMarks } from '../domain';
import type { FigureCard } from '../domain';
import { nameFontScope } from '../fonts/scope';
import { StagePane } from './StagePane';
import { pickRouteTable } from './stageEngineSource';
import { NOT_WRITTEN, SITE_LINE, SITE_TITLE, SOURCES_LABEL, START_READING, START_ROADS } from './text';

const LOADING = { state: 'loading' } as const;

export function HomePage() {
  const cards = useLoaded('cards', loadFigureCards);
  // 第一位可以点进去的人物：沙盘栏里摆他的全程沙盘。名单还没读出来的时候 id 是空的，先等着。
  const id = (cards.state === 'ready' && cards.value.find((card) => card.available)?.id) || '';
  // again：全程沙盘没读出来时，读者点“再试一次”的次数，每点一次重读一遍。
  const [again, setAgain] = useState(0);
  const found = useLoaded(`${id}#${again}`, async () => {
    const figure = id ? await loadFigure(id) : null;
    return figure ? { route: await pickRouteTable(id), marks: stopMarks(figure, (stop) => stopHref(id, stop)) } : null;
  });

  useEffect(() => {
    document.title = SITE_TITLE;
  }, []);

  // 首页的字体归沙盘栏里摆着的这位人物的范围：名单读出来了，告诉写 <html> 上那两个属性的地方（src/fonts/scope.ts）
  useLayoutEffect(() => {
    if (id) nameFontScope(undefined, id);
  }, [id]);

  return (
    <div className="figure-layout home-layout" data-figure={id || undefined}>
      <main className="reading home">
        <div className="reading-inner">
          <header className="home-head">
            <h1 className="home-title">{SITE_TITLE}</h1>
            <p className="home-line">{SITE_LINE}</p>
          </header>

          {cards.state === 'loading' && <p className="quiet">加载中…</p>}
          {cards.state === 'error' && <p className="quiet">人物名单没能读出来。</p>}
          {cards.state === 'ready' && (
            <ul className="cards" aria-label="人物">
              {cards.value.map((card) => (
                <li key={card.id}>
                  <Card card={card} />
                </li>
              ))}
            </ul>
          )}

          {/* 卡片完了：一道短短的细线（样式表画的），下面是通到“来源”页的链接。和人物页、站点页末尾是同一种。 */}
          <div className="stop-nav">
            <a className="stop-nav-sources" href={sourcesHref}>
              {SOURCES_LABEL}
            </a>
          </div>
        </div>
      </main>

      {/* 沙盘栏：和人物页上一样的全程沙盘，看的是头一节（全程）。 */}
      <StagePane
        onStopPage={false}
        table={LOADING}
        section={null}
        route={cards.state === 'loading' || found.state !== 'ready' ? (found.state === 'error' ? found : LOADING) : { state: 'ready', value: found.value?.route ?? null }}
        marks={found.state === 'ready' ? found.value?.marks : undefined}
        noBar={lacksItinerary(id)}
        onReloadTable={() => setAgain((count) => count + 1)}
      />
    </div>
  );
}

// 卡片：头一行是名字（黑体）、朝代和年份（年份自己一小块，不拆开），还没写的在这一行的右头有一个“还没写”的小标签；下面是一句话介绍。
// 可以点进去的是一块白底的板，最后一行是“从第一站读起”——各站都还没写的人物（卡片上写了 outline）是“先看他走过的路”；
// 还没写的只是单子上的一行，点不了。卡片上不记读者读过什么。
function Card({ card }: { card: FigureCard }) {
  const body = (
    <>
      <span className="card-head">
        <span className="card-name">{card.name}</span>
        <span className="card-era">
          {card.era} · <span className="card-years">{card.years}</span>
        </span>
        {!card.available && <span className="tag">{NOT_WRITTEN}</span>}
      </span>
      <span className="card-tagline">{card.tagline}</span>
      {card.available && <span className="card-go">{card.outline ? START_ROADS : START_READING}</span>}
    </>
  );
  if (!card.available) {
    return (
      <div className="card is-unavailable" data-figure-id={card.id} data-available="false">
        {body}
      </div>
    );
  }
  return (
    <a className="card" href={figureHref(card.id)} data-figure-id={card.id} data-available="true">
      {body}
    </a>
  );
}
