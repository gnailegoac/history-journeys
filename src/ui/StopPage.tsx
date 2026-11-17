// 站点页的文字栏：抬头、正文是怎么来的两句说明、正文、凭据、上一站和下一站、问讲解员。

import { figureHref, stopHref } from '../app/router';
import { useLoaded } from '../app/useLoaded';
import { loadStop, neighbours } from '../domain';
import type { Figure, StopMeta } from '../domain';
import { GuidePanel } from './GuidePanel';
import { PageTitle } from './PageTitle';
import { Provenance } from './Provenance';
import { StopText } from './StopText';
import { STOP_TEXT_LINES, pageTitle, placeLabel } from './text';

interface Props {
  figure: Figure;
  stop: StopMeta;
}

export function StopPage({ figure, stop }: Props) {
  const content = useLoaded(`${figure.id}/${stop.id}`, () => loadStop(figure.id, stop.id));
  const { index, prev, next } = neighbours(figure, stop.id);
  const written = content.state === 'ready' && content.value !== null ? content.value : null;

  return (
    <article className="stop-page" data-stop-id={stop.id} data-stop-text={written ? 'written' : content.state === 'loading' ? 'loading' : 'none'}>
      <header className="page-head">
        <p className="eyebrow">
          第 {index + 1} 站 · 共 {figure.stops.length} 站
        </p>
        <PageTitle documentTitle={pageTitle(stop.title, figure.name)}>{stop.title}</PageTitle>
        <dl className="facts">
          <div>
            <dt>时间</dt>
            <dd>{stop.years}</dd>
          </div>
          <div>
            <dt>地点</dt>
            <dd>{placeLabel(stop.place)}</dd>
          </div>
          <div>
            <dt>年纪</dt>
            <dd>{stop.age}</dd>
          </div>
        </dl>
      </header>

      {content.state === 'loading' && <p className="quiet">正文加载中…</p>}
      {content.state === 'error' && <p className="quiet">这一站的正文没能读出来。</p>}
      {content.state === 'ready' && content.value === null && (
        <p className="quiet not-written">这一站的正文还没写。</p>
      )}
      {written && (
        <>
          <div className="text-about">
            {STOP_TEXT_LINES.map((line, i) => (
              <p key={i}>{line}</p>
            ))}
          </div>
          <StopText content={written} />
          <Provenance content={written} />
        </>
      )}

      <nav className="stop-nav" aria-label="换一站">
        <div className="stop-nav-row">
          {prev ? (
            <a className="stop-nav-link is-prev" href={stopHref(figure.id, prev.id)} rel="prev">
              <span className="stop-nav-label">上一站</span>
              <span className="stop-nav-name">{prev.shortTitle}</span>
            </a>
          ) : (
            <span className="stop-nav-gap" />
          )}
          {next ? (
            <a className="stop-nav-link is-next" href={stopHref(figure.id, next.id)} rel="next">
              <span className="stop-nav-label">下一站</span>
              <span className="stop-nav-name">{next.shortTitle}</span>
            </a>
          ) : (
            <span className="stop-nav-gap" />
          )}
        </div>
        <a className="stop-nav-list" href={figureHref(figure.id)}>
          回到各站目录
        </a>
      </nav>

      {written && <GuidePanel figureName={figure.name} sampleQuestions={written.sampleQuestions} />}
    </article>
  );
}
