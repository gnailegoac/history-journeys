// 页面之间用 # 路由：站点是静态文件，又发布在子路径下。
//   #/                      首页
//   #/<人物>                人物页
//   #/<人物>/<站>           站点页

import { useMemo, useSyncExternalStore } from 'react';

export type Route =
  | { page: 'home' }
  | { page: 'figure'; figureId: string }
  | { page: 'stop'; figureId: string; stopId: string };

export function parseHash(hash: string): Route {
  const parts = hash
    .replace(/^#/, '')
    .split('/')
    .filter((part) => part !== '')
    .map(safeDecode);
  if (parts.length === 0) return { page: 'home' };
  if (parts.length === 1) return { page: 'figure', figureId: parts[0] };
  return { page: 'stop', figureId: parts[0], stopId: parts[1] };
}

function safeDecode(part: string): string {
  try {
    return decodeURIComponent(part);
  } catch {
    return part;
  }
}

export const homeHref = '#/';

export function figureHref(figureId: string): string {
  return `#/${encodeURIComponent(figureId)}`;
}

export function stopHref(figureId: string, stopId: string): string {
  return `#/${encodeURIComponent(figureId)}/${encodeURIComponent(stopId)}`;
}

// 页面打开之后读者有没有换过页。第一次打开时不抢焦点，换页之后把焦点移到新页的标题上。
let navigated = false;

export function hasNavigated(): boolean {
  return navigated;
}

function subscribe(onChange: () => void): () => void {
  const listener = () => {
    navigated = true;
    onChange();
  };
  window.addEventListener('hashchange', listener);
  return () => window.removeEventListener('hashchange', listener);
}

function currentHash(): string {
  return window.location.hash;
}

/** 当前的页面，跟着地址栏里的 # 走。 */
export function useRoute(): Route {
  const hash = useSyncExternalStore(subscribe, currentHash);
  return useMemo(() => parseHash(hash), [hash]);
}
