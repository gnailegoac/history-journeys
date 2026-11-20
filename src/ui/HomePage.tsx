// 首页：一页纸（网站的名字、一句话、人物卡片、“来源”），旁边的绢上摆着一位人物的全程图片。
// 版面和人物页是同一种：宽屏上纸在左、绢在右；别的窗口上绢在上（不钉着，跟着页面滚走，最高半个屏幕）、纸在下。
// 绢上的那一块就是人物页用的沙盘栏（StagePane），放的是第一位可以点进去的人物的那张全程图片，和人物页上同一张、同一句题记。
// 重做顺序第 5 步把全程沙盘接到首页：到时候只换下面那一个 <StagePane>（交给它一座沙盘），版面不用动。

import { useEffect } from 'react';
import { figureHref, sourcesHref } from '../app/router';
import { useLoaded } from '../app/useLoaded';
import { loadFigure, loadFigureCards } from '../domain';
import type { FigureCard } from '../domain';
import { StagePane } from './StagePane';
import { pickRouteStill } from './stageEngineSource';
import { NOT_WRITTEN, SITE_LINE, SITE_TITLE, SOURCES_LABEL, START_READING } from './text';

export function HomePage() {
  const cards = useLoaded('cards', loadFigureCards);
  // 第一位可以点进去的人物：绢上放他的全程图片。名单还没读出来的时候 id 是空的，先等着。
  const id = (cards.state === 'ready' && cards.value.find((card) => card.available)?.id) || '';
  const picture = useLoaded(id, async () => {
    const figure = id ? await loadFigure(id) : null;
    return figure ? pickRouteStill(figure) : null;
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

      {/* 绢上的那一块。第 5 步：这里换成摆着全程沙盘的 StagePane。 */}
      <StagePane onStopPage={false} table={{ state: 'loading' }} section={null} still={cards.state === 'loading' ? cards : picture} onReloadTable={() => {}} />
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
