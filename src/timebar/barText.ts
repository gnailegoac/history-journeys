// 时间轴上固定的字。只有字，不引别的文件：src/ui/text.ts 把用黑体排的那几样（BAR_SANS）并进 SANS_LABELS，
// 做字体的工具才会把它们放进黑体的文件；页面的程序不用那张表，打包的时候这里的字不会跟着进页面的程序，只在时间轴的那一块里。
// 跟着日子变的字（哪一年、在哪、知道些什么）不在这里：它们在每位人物的行迹里（content/figures/<人物>/itinerary.bar.json）。

export const BAR_TEXT = {
  play: '播放',
  pause: '暂停',
  /** 系统设了“减少动态效果”的时候，轴两头的两个按钮。 */
  prev: '上一段',
  next: '下一段',
  /** 这一条右头的小按钮：点开是这条轴怎么看。写“图例”，不写“说明”——题记里已经有一个“说明”，两个一样的按钮只隔着一百来像素。 */
  note: '图例',
  /** 那个按钮给读屏念的名字。 */
  noteName: '时间轴的图例',
  close: '关闭',
  /** 点开“图例”的那一块里，“说不准的”前面的几个字。 */
  unsure: '说不准的：',
  /** 放着图片的时候，最前一个位置的第二行后面多的半句：图片上不画小像，要说出来（不然读的人会在图片上找他）。 */
  noFigure: '；图片上没有他的小像',
  /** 第一行的岁数：虚岁一岁……虚岁十岁，虚岁十一……。 */
  age: '虚岁',
  ageUnit: '岁',
  /** 第一行括号里的公历年和月（农历年末、公历已经是下一年的那些天才这样写）：1037年1月。 */
  west: (year: number, month: number): string => `${year}年${month}月`,
  /** 通到一站去的那个入口：label 是那一站的印上的字（一、二……）。 */
  enter: (label: string): string => `进第${label}站`,
  /** 入口给读屏念的名字，后面接那一站的印的那一句（第几站，站名）。 */
  enterName: '进这一站：',
  /** 轴给读屏念的名字。 */
  trackName: (name: string): string => `${name}一生的时间轴`,
} as const;

/**
 * 时间轴上用黑体排的固定的字：按钮、入口、岁数、第一行的括号、轴上的年份（数字和中间的一道）。
 * 哪一年的年名、“在哪”和人物的名字也是黑体，它们是内容里来的字，做字体的工具照行迹去数。
 *
 * 写成“叫一个函数”再标上 PURE（同 src/ui/text.ts 的 SANS_LABELS 一样）：页面的程序引了这张表却不用它，
 * 打包的时候整张表连同上面那几个字都不进页面的程序。直接写成数组的话，里面那一句 BAR_TEXT.enter(…) 是当场要算的，
 * 这个文件就会整个留在页面的程序里。
 */
export const BAR_SANS: readonly string[] = /* @__PURE__ */ barSans();

function barSans(): string[] {
  return [
    BAR_TEXT.play,
    BAR_TEXT.pause,
    BAR_TEXT.prev,
    BAR_TEXT.next,
    BAR_TEXT.note,
    BAR_TEXT.noteName,
    BAR_TEXT.close,
    BAR_TEXT.age,
    BAR_TEXT.ageUnit,
    BAR_TEXT.west(0, 0),
    BAR_TEXT.enter('一二三四五六七八九十'),
    '（）',
    '0123456789–',
  ];
}
