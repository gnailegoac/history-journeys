// 首页：挑选一位人物。

import { useEffect } from 'react';
import { figureHref } from '../app/router';
import { useLoaded } from '../app/useLoaded';
import { loadFigureCards } from '../domain';
import type { FigureCard } from '../domain';
import { NOT_WRITTEN, SITE_LINE, SITE_TITLE } from './text';

export function HomePage() {
  const cards = useLoaded('cards', loadFigureCards);

  useEffect(() => {
    document.title = SITE_TITLE;
  }, []);

  return (
    <main className="home">
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
    </main>
  );
}

function Card({ card }: { card: FigureCard }) {
  const body = (
    <>
      <span className="card-name">{card.name}</span>
      <span className="card-era">
        {card.era} · {card.years}
      </span>
      <span className="card-tagline">{card.tagline}</span>
      {!card.available && <span className="tag">{NOT_WRITTEN}</span>}
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
