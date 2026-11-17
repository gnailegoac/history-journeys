// “问讲解员”：底边一条里的一个按钮，点开是讲解员面板。原型里答疑还没有接入，面板只展示，
// 并在标题下面直接说明现在还不能回答。

import { useEffect, useId, useRef, useState } from 'react';
import { getGuideService } from '../guide';

interface Props {
  figureName: string;
  sampleQuestions: string[];
}

export function GuidePanel({ figureName, sampleQuestions }: Props) {
  const guide = getGuideService();
  const [open, setOpen] = useState(false);
  const opener = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLElement>(null);
  const wasOpen = useRef(false);
  const titleId = useId();
  const inputId = useId();

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

  return (
    <>
      <div className="guide-dock" hidden={open}>
        <button ref={opener} type="button" className="guide-open" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}>
          问讲解员
        </button>
      </div>

      {open && (
        <section ref={panel} className="guide-panel" role="dialog" aria-modal="false" aria-labelledby={titleId} tabIndex={-1}>
          <div className="guide-head">
            <h2 id={titleId}>问讲解员</h2>
            <button type="button" className="guide-close" onClick={() => setOpen(false)}>
              关闭
            </button>
          </div>

          {!guide.available && (
            <>
              <p>讲解员现在还不能回答问题。下面是以后可以问的问题的样子。</p>
              <p>等它能回答了，只依据这一站写下的内容回答，不扮演{figureName}。</p>
            </>
          )}

          {sampleQuestions.length > 0 && (
            <>
              <h3>{guide.available ? '可以这样问' : '以后可以这样问'}</h3>
              <ul className="guide-samples">
                {sampleQuestions.map((question, i) => (
                  <li key={i}>{question}</li>
                ))}
              </ul>
            </>
          )}

          <form className="guide-form" onSubmit={(event) => event.preventDefault()}>
            <label htmlFor={inputId}>你的问题</label>
            <div className="guide-form-row">
              <textarea id={inputId} rows={2} disabled={!guide.available} />
              <button type="submit" disabled={!guide.available}>
                发送
              </button>
            </div>
          </form>
        </section>
      )}
    </>
  );
}
