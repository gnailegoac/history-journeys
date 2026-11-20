// 贴着底边的那一条，和“问讲解员”点开的面板。
// 那一条里并排三格：左边上一站，中间“问讲解员”，右边下一站。这一站在头或在尾时，那一头的格子空着；
// 这一站的正文还没写（或者还没读出来）时中间空着，两头照旧。
// 原型里答疑还没有接入，面板只展示，并在标题下面直接说明现在还不能回答。
// 面板里面的东西（GuideBody.tsx）是另一段程序，读者点开了才去取：面板一点就开，标题和“关闭”马上就有，
// 下面先是一句“加载中…”，取到了换成内容；没取到说一句话，关上再点开就重取。

import { useEffect, useId, useRef, useState } from 'react';
import { stopHref } from '../app/router';
import { useOnDemand } from '../app/useLoaded';
import type { Figure, StopMeta } from '../domain';
import { Waiting } from './Waiting';

interface Props {
  figure: Figure;
  /** 上一站、下一站；没有的是 null。 */
  prev: StopMeta | null;
  next: StopMeta | null;
  /** 这一站的示例问题；正文还没写、还没读出来时是 null：那时没有“问讲解员”。 */
  sampleQuestions: string[] | null;
}

const loadBody = () => import('./GuideBody');

export function GuidePanel({ figure, prev, next, sampleQuestions }: Props) {
  const [open, setOpen] = useState(false);
  const [body, ask] = useOnDemand(loadBody);
  const opener = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLElement>(null);
  const wasOpen = useRef(false);
  const titleId = useId();

  // 打开时焦点进面板，关上后回到按钮。
  useEffect(() => {
    if (open) panel.current?.focus({ preventScroll: true });
    else if (wasOpen.current) opener.current?.focus({ preventScroll: true });
    wasOpen.current = open;
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open]);

  // 一头的格子：“上一站”或者“下一站”（宋体的小字）在上，站名（楷体）在下，各占一行；没有那一站时是空的一格。
  const cell = (stop: StopMeta | null, rel: 'prev' | 'next') =>
    stop ? (
      <a className={`walk-link is-${rel}`} href={stopHref(figure.id, stop.id)} rel={rel}>
        <span className="walk-label">{rel === 'prev' ? '上一站' : '下一站'}</span>
        <span className="walk-name">{stop.shortTitle}</span>
      </a>
    ) : (
      <span />
    );

  return (
    <>
      <nav className="guide-dock walk" aria-label="换一站" hidden={open}>
        {cell(prev, 'prev')}
        {sampleQuestions ? (
          <button
            ref={opener}
            type="button"
            className="guide-open"
            aria-haspopup="dialog"
            aria-expanded={open}
            onClick={() => {
              setOpen(true);
              ask();
            }}
          >
            问讲解员
          </button>
        ) : (
          <span />
        )}
        {cell(next, 'next')}
      </nav>

      {open && sampleQuestions && (
        <section ref={panel} className="guide-panel" role="dialog" aria-modal="false" aria-labelledby={titleId} tabIndex={-1}>
          <div className="guide-head">
            <h2 id={titleId}>问讲解员</h2>
            <button type="button" className="guide-close" onClick={() => setOpen(false)}>
              关闭
            </button>
          </div>
          {body?.state === 'ready' ? <body.value.GuideBody figureName={figure.name} sampleQuestions={sampleQuestions} /> : <Waiting failed={body?.state === 'error'} />}
        </section>
      )}
    </>
  );
}
