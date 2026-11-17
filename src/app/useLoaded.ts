// 读取一份内容，并记住它是为哪一页读的：换页后旧内容不会留在新页上。

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
