// 站点页的文字栏：抬头、正文是怎么来的两句说明、正文、凭据、回到各站目录和“来源”；贴着底边的那一条（上一站、问讲解员、下一站）。
// 这一站有沙盘时，它还盯着读者读到了哪一小节，报给上面，沙盘的镜头跟着走。

import { useEffect, useRef } from 'react';
import { figureHref, sourcesHref } from '../app/router';
import { useLoaded } from '../app/useLoaded';
import type { Loaded } from '../app/useLoaded';
import { loadStop, neighbours } from '../domain';
import type { Figure, StopMeta } from '../domain';
import { SONG_MORE_PROBE } from '../fonts/shipped';
import type { StopTable } from '../stage/types';
import { GuidePanel } from './GuidePanel';
import { PageTitle } from './PageTitle';
import { Provenance } from './Provenance';
import { StopText } from './StopText';
import { SOURCES_LABEL, STAGE_TEXT, STOP_TEXT_LINES, pageTitle, placeLabel } from './text';
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

  // 点开才看得见的字在另一个字体文件里，平常要到点开小注、原文、凭据的那一刻才去取：网慢的时候，
  // 刚点开的那几句里会有几个字先用设备自带的字顶着，过一会儿才换过来。所以写好了的一站，正文出来以后，等头两个字体文件到了、
  // 再过两秒，就叫浏览器先把它取来（拿它里面的一个字去要）；读者已经走开了就不取。取过一次浏览器自己记着，不会再取。
  // 首页、人物页和还没写的站不这样做：那里没有要点开的东西。字体的名字“Yanlu Song”是工具写进文件里的（src/fonts/fonts.css）。
  const hasText = written !== null;
  useEffect(() => {
    if (!hasText) return;
    let timer = 0;
    let left = false;
    void document.fonts?.ready.then(() => {
      if (!left) timer = setTimeout(() => void document.fonts.load('1em "Yanlu Song"', SONG_MORE_PROBE).catch(() => {}), 2000);
    });
    return () => {
      left = true;
      clearTimeout(timer);
    };
  }, [hasText]);

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
          {/* 一站一个小方块，这一站的那个是红的：只说它排在路上的第几个，不记读者读过哪几站。读屏不念：前面那句话已经说了。 */}
          <span className="ticks" aria-hidden="true">
            {figure.stops.map((item, i) => (
              <span key={item.id} className={i === index ? 'is-here' : undefined} />
            ))}
          </span>
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

      {/* 正文完了：一个小菱形（样式表画的），下面并排两个链接：回到目录，“来源”页。上一站、下一站在贴着底边的那一条里。 */}
      <div className="stop-nav">
        <a className="stop-nav-list" href={figureHref(figure.id)}>
          回到各站目录
        </a>
        <a className="stop-nav-sources" href={sourcesHref}>
          {SOURCES_LABEL}
        </a>
      </div>

      <GuidePanel figure={figure} prev={prev} next={next} sampleQuestions={written ? written.sampleQuestions : null} />
    </article>
  );
}
