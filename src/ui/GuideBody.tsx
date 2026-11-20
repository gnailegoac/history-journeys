// 讲解员面板里面的东西：现在还不能回答的两句话、以后可以问的问题的样子、提问的输入框。
// 原型里答疑还没有接入，只展示。这一段程序不随页面一打开就下载：读者点开“问讲解员”才取（GuidePanel.tsx）。

import { useId } from 'react';
import { getGuideService } from '../guide';

interface Props {
  figureName: string;
  sampleQuestions: string[];
}

export function GuideBody({ figureName, sampleQuestions }: Props) {
  const guide = getGuideService();
  const inputId = useId();

  return (
    <>
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
    </>
  );
}
