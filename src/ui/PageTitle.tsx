// 一页的大标题。换页之后把焦点移到这里，读屏和键盘从新页的开头接着走。

import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { hasNavigated } from '../app/router';

interface Props {
  /** 浏览器标签上的标题。 */
  documentTitle: string;
  children: ReactNode;
}

export function PageTitle({ documentTitle, children }: Props) {
  const ref = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    document.title = documentTitle;
  }, [documentTitle]);

  useEffect(() => {
    if (hasNavigated()) ref.current?.focus({ preventScroll: true });
  }, []);

  return (
    <h1 ref={ref} tabIndex={-1} className="page-title">
      {children}
    </h1>
  );
}
