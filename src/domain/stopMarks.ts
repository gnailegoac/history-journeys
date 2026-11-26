// 全程沙盘上每一站的印：从 figure.json 里拼出来。页面和沙盘测试页用的是这同一个函数；只算数，不碰页面。

import type { Figure } from './types';

/**
 * 全程沙盘上一站的印：label 是印上的字（第几站：一到八）；href 是这一站的网址；written 是正文写好了没有
 *（写好了是实心的印，没写的只有一道边）；title 是读屏软件念的那一句。
 * own 是这一站有自己的沙盘（figure.json 里这一站写的 table）：在全程沙盘上按通到这样一站的链接，镜头先潜下去再换页（src/ui/dive.ts）。
 */
export interface StopMark {
  label: string;
  href: string;
  written: boolean;
  title: string;
  own?: boolean;
}

/**
 * 这位人物每一站的印，键是站的 id。hrefOf 说一站的网址怎么写（页面交路由的 stopHref）。
 * 印上的字是站的先后（一到十，再多就写数字），和正文那一栏目录里的印一样；数的是先后，不是进度。
 */
export function stopMarks(figure: Figure, hrefOf: (stopId: string) => string): Record<string, StopMark> {
  const out: Record<string, StopMark> = {};
  figure.stops.forEach((stop, i) => {
    const label = '一二三四五六七八九十'[i] ?? String(i + 1);
    const written = stop.status === 'complete';
    out[stop.id] = { label, href: hrefOf(stop.id), written, title: `第${label}站，${stop.title}${written ? '' : '，还没写'}`, own: stop.table === true };
  });
  return out;
}
