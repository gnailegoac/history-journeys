// 首页：一页纸（网站的名字、一句话、人物卡片、“来源”），旁边的绢上摆着一位人物的全程沙盘。
// 版面和人物页是同一种：宽屏上纸在左、绢在右；别的窗口上绢在上、纸在下。
// 绢上的那一块就是人物页用的沙盘栏（StagePane），交给它的是第一位可以点进去的人物的全程沙盘和各站的印，和人物页上是同一座。

import { useEffect, useState } from 'react';
import { figureHref, sourcesHref, stopHref } from '../app/router';
import { useLoaded } from '../app/useLoaded';
import { loadFigure, loadFigureCards, stopMarks } from '../domain';
import type { FigureCard } from '../domain';
import { StagePane } from './StagePane';
import { pickRouteTable } from './stageEngineSource';
import { NOT_WRITTEN, SITE_LINE, SITE_TITLE, SOURCES_LABEL, START_READING } from './text';

const LOADING = { state: 'loading' } as const;

export function HomePage() {
  const cards = useLoaded('cards', loadFigureCards);
  // 第一位可以点进去的人物：绢上摆他的全程沙盘。名单还没读出来的时候 id 是空的，先等着。
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

  return (
    <div className="figure-layout home-layout">
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

          {/* 卡片完了：一个小菱形（样式表画的），下面是通到“来源”页的链接。和人物页、站点页末尾是同一种。 */}
          <div className="stop-nav">
            <a className="stop-nav-sources" href={sourcesHref}>
              {SOURCES_LABEL}
            </a>
          </div>
        </div>
      </main>

      {/* 绢上的那一块：和人物页上一样的全程沙盘，看的是头一节（全程）。 */}
      <StagePane
        onStopPage={false}
        table={LOADING}
        section={null}
        route={cards.state === 'loading' || found.state !== 'ready' ? (found.state === 'error' ? found : LOADING) : { state: 'ready', value: found.value?.route ?? null }}
        marks={found.state === 'ready' ? found.value?.marks : undefined}
        onReloadTable={() => setAgain((count) => count + 1)}
      />
    </div>
  );
}

// 卡片：左边是竖着写的名字（楷体），右边是朝代和年份、一句话介绍。可以点进去的最后一行是“从第一站读起”和一道短线；
// 还没写的整张卡片颜色深一点、字淡一点，右上角一个“还没写”的小标签，点不了。卡片上不记读者读过什么。
function Card({ card }: { card: FigureCard }) {
  const body = (
    <>
      <span className="card-name">{card.name}</span>
      <span className="card-body">
        <span className="card-head">
          <span className="card-era">
            {card.era} · {card.years}
          </span>
          {!card.available && <span className="tag">{NOT_WRITTEN}</span>}
        </span>
        <span className="card-tagline">{card.tagline}</span>
        {card.available && <span className="card-go">{START_READING}</span>}
      </span>
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
