// 点开“凭据”才用得到的几句固定的话。单独一个文件：它们跟着凭据里面的那一段程序走（ProvenanceBody.tsx），
// 读者点开了才下载；写在 text.ts 里的话，就随页面一打开就下载了。

import type { Basis } from '../domain';

export const BASIS_LABEL: Record<Basis, string> = {
  'own-words': '他本人的话',
  record: '史书和当时人的记载',
  later: '后人的记载',
  editor: '编写时补的',
};

/** 凭据里“沙盘上的东西”一栏的几句固定的话。 */
export const REGISTER_TEXT = {
  heading: '沙盘上的东西',
  line: '沙盘上摆的每样东西属于哪一类，依据什么。',
  notDrawn: '没有画的',
  cite: '出处：',
  /** 全程沙盘上不在五类里的一样：小像。 */
  mark: '记号',
  /** 全程沙盘的凭据的最后：行迹（他哪一年在哪里）照哪些书和文章排的。下面一条出处印一次，连着“读了什么”。 */
  itinerary: '他哪一年在哪里，是照下面这些书和文章排的。',
} as const;
