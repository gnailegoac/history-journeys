// 站点页的文字栏：抬头、正文是怎么来的两句说明、正文、凭据、上一站和下一站、问讲解员。
// 这一站有沙盘时，它还盯着读者读到了哪一小节，报给上面，沙盘的镜头跟着走。

import { useRef } from 'react';
import { figureHref, stopHref } from '../app/router';
import { useLoaded } from '../app/useLoaded';
import type { Loaded } from '../app/useLoaded';
import { loadStop, neighbours } from '../domain';
import type { Figure, StopMeta } from '../domain';
import type { StopTable } from '../stage/types';
import { GuidePanel } from './GuidePanel';
import { PageTitle } from './PageTitle';
import { Provenance } from './Provenance';
import { StopText } from './StopText';
import { STAGE_TEXT, STOP_TEXT_LINES, pageTitle, placeLabel } from './text';
import { useReadingSection } from './useReadingSection';

interface Props {
  figure: Figure;
  stop: StopMeta;
  /** 这一站的沙盘；读出来是 null 表示这一站还没有沙盘。 */
  table: Loaded<StopTable | null>;
  /** 读者读到了另一小节（小节标题）。 */
  onSection: (section: string) => void;
}

/** 把焦点放到沙盘栏上；下一步 Tab 就到它的第一个按钮。 */
function toStage(): void {
  document.querySelector<HTMLElement>('.stage-pane')?.focus();
}

export function StopPage({ figure, stop, table, onSection }: Props) {
  const content = useLoaded(`${figure.id}/${stop.id}`, () => loadStop(figure.id, stop.id));
  const { index, prev, next } = neighbours(figure, stop.id);
  const written = content.state === 'ready' && content.value !== null ? content.value : null;
  const scene = table.state === 'ready' && table.value ? table.value.scene : null;
  // 这一站有没有沙盘：yes 有，none 没有，loading 还不知道，failed 沙盘的数据没读出来。
  const sceneState = table.state === 'loading' ? 'loading' : table.state === 'error' ? 'failed' : scene ? 'yes' : 'none';

  const article = useRef<HTMLElement>(null);
  useReadingSection(article, written !== null && scene !== null, onSection);

  return (
    <article
      ref={article}
      className="stop-page"
      data-stop-id={stop.id}
      data-stop-text={written ? 'written' : content.state === 'loading' ? 'loading' : 'none'}
      data-stop-scene={sceneState}
    >
      <header className="page-head">
        <p className="eyebrow">
          第 {index + 1} 站 · 共 {figure.stops.length} 站
        </p>
        <PageTitle documentTitle={pageTitle(stop.title, figure.name)}>{stop.title}</PageTitle>
        {/* 沙盘栏在页面的结构里排在正文后面：用键盘、读屏的人要走完整篇正文才到得了它的按钮。这里给一步直接过去的。 */}
        {scene && (
          <button type="button" className="skip-to-stage" onClick={toStage}>
            {STAGE_TEXT.toStage}
          </button>
        )}
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
          <Provenance content={written} scene={scene} />
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
