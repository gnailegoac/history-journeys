// 读取一份内容，并记住它是为哪一页读的：换页后旧内容不会留在新页上。
// 后面还有一个“点开才去取”的：折着的东西里面的那一段程序，读者点开了才下载。

import { useEffect, useState } from 'react';

export type Loaded<T> = { state: 'loading' } | { state: 'ready'; value: T } | { state: 'error' };

const LOADING = { state: 'loading' } as const;

/** load 由 key 决定：只在 key 变了时重新读。 */
export function useLoaded<T>(key: string, load: () => Promise<T>): Loaded<T> {
  const [result, setResult] = useState<{ key: string; loaded: Loaded<T> } | null>(null);

  useEffect(() => {
    let live = true;
    load().then(
      (value) => {
        if (live) setResult({ key, loaded: { state: 'ready', value } });
      },
      () => {
        if (live) setResult({ key, loaded: { state: 'error' } });
      },
    );
    return () => {
      live = false;
    };
  }, [key]);

  return result && result.key === key ? result.loaded : LOADING;
}

/**
 * 点开才去取的一块（折着的“凭据”里面的东西、讲解员面板里面的东西：那一段程序不随页面一打开就下载）。
 * 返回现在的样子和一个 ask：还没叫过是 null；ask() 叫它去取——正在取、已经取到的不再取，上一次没取到的重取一遍
 *（读者关上再点开，就是再叫一次）。
 */
export function useOnDemand<T>(load: () => Promise<T>): [Loaded<T> | null, () => void] {
  const [loaded, setLoaded] = useState<Loaded<T> | null>(null);
  const ask = () => {
    if (loaded && loaded.state !== 'error') return;
    setLoaded(LOADING);
    load().then(
      (value) => setLoaded({ state: 'ready', value }),
      () => setLoaded({ state: 'error' }),
    );
  };
  return [loaded, ask];
}
