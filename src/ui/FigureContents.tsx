// 人物页的文字栏：他是谁，加各站的目录。

import { stopHref } from '../app/router';
import type { Figure } from '../domain';
import { PageTitle } from './PageTitle';
import { NOT_WRITTEN, pageTitle, placeLabel } from './text';

export function FigureContents({ figure }: { figure: Figure }) {
  return (
    <article className="figure-page">
      <header className="page-head">
        <PageTitle documentTitle={pageTitle(figure.name)}>{figure.name}</PageTitle>
        <p className="meta">
          {figure.era} · {figure.years}
        </p>
        <p className="figure-tagline">{figure.tagline}</p>
      </header>

      <div className="prose figure-intro">
        {figure.intro.map((paragraph, i) => (
          <p key={i}>{paragraph}</p>
        ))}
      </div>

      <section aria-labelledby="stops-heading">
        <h2 id="stops-heading" className="section-heading">
          各站目录
        </h2>
        <ol className="stops">
          {figure.stops.map((stop, i) => (
            <li key={stop.id}>
              <a className="stop-item" href={stopHref(figure.id, stop.id)} data-stop-id={stop.id} data-stop-status={stop.status}>
                <span className="stop-number" aria-hidden="true">
                  {i + 1}
                </span>
                <span className="stop-body">
                  <span className="stop-title">
                    {stop.title}
                    {stop.status !== 'complete' && <span className="tag">{NOT_WRITTEN}</span>}
                  </span>
                  <span className="stop-meta">
                    <span>{stop.years}</span>
                    <span>{placeLabel(stop.place)}</span>
                    <span>{stop.age}</span>
                  </span>
                  <span className="stop-summary">{stop.summary}</span>
                </span>
              </a>
            </li>
          ))}
        </ol>
      </section>
    </article>
  );
}
