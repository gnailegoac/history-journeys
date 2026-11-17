// 界面上反复用到的几句固定的话和小的拼字逻辑。

import type { Basis, NoteKind, Place } from '../domain';

export const SITE_TITLE = '沿着他走过的路';
export const SITE_LINE = '选一位历史人物，沿着他一生走过的路，一站一站读下去。';
export const NOT_WRITTEN = '还没写';

export const NOTE_KIND_LABEL: Record<NoteKind, string> = {
  history: '历史',
  geography: '地理',
  humanities: '人文',
  science: '科学',
};

export const BASIS_LABEL: Record<Basis, string> = {
  'own-words': '他本人的话',
  record: '史书和当时人的记载',
  later: '后人的记载',
  editor: '编写时补的',
};

/** 站点页抬头下面的两句说明：正文是怎么来的，带虚线的词怎么用。 */
export const STOP_TEXT_LINES = [
  '正文是编写的人根据他自己的诗文、书信和史书，用今天的话改写的；引号里才是他的原话。',
  '带虚线的词可以点开，看小注。',
];

/** 古名带今名，如“黄州（今湖北黄冈）”；两个名字一样时只写一个。 */
export function placeLabel(place: Pick<Place, 'ancient' | 'modern'>): string {
  return place.ancient === place.modern ? place.ancient : `${place.ancient}（今${place.modern}）`;
}

/** 浏览器标签上的标题，跟着页面走。 */
export function pageTitle(...parts: string[]): string {
  return [...parts, SITE_TITLE].join(' · ');
}
