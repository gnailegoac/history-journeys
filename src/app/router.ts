// 页面之间用 # 路由：站点是静态文件，又发布在子路径下。
//   #/                      首页
//   #/<人物>                人物页
//   #/<人物>/<站>           站点页
//   #/sources               “来源”页（所以没有哪位人物的 id 可以叫 sources：内容校验守着，tests/content/rules.ts）

import { useMemo, useSyncExternalStore } from 'react';
import { nameFontScope } from '../fonts/scope';

export type Route =
  | { page: 'home' }
  | { page: 'sources' }
  | { page: 'figure'; figureId: string }
  | { page: 'stop'; figureId: string; stopId: string };

export function parseHash(hash: string): Route {
  const parts = hash
    .replace(/^#/, '')
    .split('/')
    .filter((part) => part !== '')
    .map(safeDecode);
  if (parts.length === 0) return { page: 'home' };
  if (parts.length === 1) return parts[0] === 'sources' ? { page: 'sources' } : { page: 'figure', figureId: parts[0] };
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
export const sourcesHref = '#/sources';

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
    // 换了页：新的一页还没画，先把它的字体归哪个范围写到 <html> 上（src/fonts/scope.ts）
    nameFontScope(parseHash(currentHash()));
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
