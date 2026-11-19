// 宋代青绿设色这一种样式里，模型跟着镜头远近怎么变：每一类从多远起不再变小、最多放大几倍、放大到头时留几成、摊开几倍。
// “远近”都是折算过的远近 D（见 ../kit/figure.ts 的 equivalentDistance）。怎么用这些数也在那个文件里。
//
// 这些数对着电脑上的图片（1440 × 900）调过两轮。竖着拿的平板上沙盘栏加高到屏幕的 56% 以后（768 × 573），
// 对着那一种画面和横着拿的平板（584 × 768）的图片看过：要看的几样东西都够大，这张表没有再动。
// holdFromM 是“这样东西本来多大 × 2428 ÷ 想让它在画面上至少多少像素”。括号里是徐州这座沙盘上属于这一类的东西。

import type { FigureStyle } from '../internal';

export const SONG_QINGLV_FIGURE: FigureStyle = {
  rules: {
    // 城墙、城门的高：只拉竖向，和前一半远看的一套一样
    wallH: { holdFromM: 16000, maxTimes: 1.55 },
    // 城门楼和立在地上的楼（黄楼）：前一半远看的一套的倍数
    tower: { holdFromM: 9400, maxTimes: 2.25 },
    // 墙顶上的角楼、亭（快哉亭）
    wallTop: { holdFromM: 5700, maxTimes: 2.6 },
    // 城里的一组院落（州衙）：整组绕着院子的中心放大，所以摊开的倍数和放大的倍数一样。
    // 和四周的民居从同一个远近起放大：院子先大起来，就压到旁边的屋上去了
    yardCity: { holdFromM: 12000, maxTimes: 1.6, spreadAtMax: 1.6 },
    // 城外的一组院落（台头寺，连同寺旁的松树）：同上。寺的围墙本来就和它站的土丘一般大，放大一点四角就伸到坡下、水面上去了，
    // 所以等到细处（围墙、长廊）快收掉的远近才放大：近处几节里它是本来的大小
    yardOut: { holdFromM: 14000, maxTimes: 2.0, spreadAtMax: 2.0 },
    // 沿巷子排的民居：从巷子往两边摊开，放大到头时五座留一座
    cityHouse: { holdFromM: 12000, maxTimes: 2.1, keepAtMax: 0.2, spreadAtMax: 2.1 },
    // 村子里的屋：前一半远看的一套的数
    village: { holdFromM: 10500, maxTimes: 2.5, keepAtMax: 0.65, spreadAtMax: 1.5 },
    // 下面三类一样也不去掉（keepAtMax 是 1）：船和石头的数目、分组是依据里说了的
    // （“三到六条一组”“两条小船”“西边留出一线水路”），少一条、少一块都不对。
    // 所以它们最多放大几倍不是凭眼光定的，要场景容得下，由测试量出来（tests/stage/scene-figures.test.ts）；石头先写小的一头。
    // 货船是量出来的数：系在城下的船贴着城墙，城墙算岸，再大船头就扎进墙身里了。
    boat: { holdFromM: 10000, maxTimes: 1.38, keepAtMax: 1 },
    // 小船：两条船一前一后走在乱石西边那一线水路里，零件库摆的时候前后隔开了两条放大到头的船身，放大到头也不相接。
    // 从 3.4 公里起就不再变小：“云龙山和百步洪”那一节里它有二十二三个像素长，看得出是两条船
    smallBoat: { holdFromM: 3400, maxTimes: 2.4, keepAtMax: 1 },
    rock: { holdFromM: 8000, maxTimes: 1.5, keepAtMax: 1 },
    // 苔点一样的树：放大到头时三棵留一棵（前一半远看的一套的数）
    tree: { holdFromM: 14000, maxTimes: 2.4, keepAtMax: 0.335 },
    // 下面三类是后一半新加的：单座的小建筑，连同挨着它的东西整组放大。
    // 地上单座的屋（张山人的草屋，连同篱笆和果树）。“住在城墙上”那一节里屋顶十七八个像素宽，城楼的顶三十来个像素：一看就比城楼小
    hut: { holdFromM: 4100, maxTimes: 4.3, spreadAtMax: 4.3 },
    // 墙顶上单座的屋（城墙上的棚子）。棚子的顶进深 13.5 米，墙顶宽 36 米：最多放大到 2.6 倍，再大就比它站的墙顶还宽，悬在墙外了。
    // 它顺着墙长 34 米，放大到头有八九十米长，比城楼（一百多米）短一截、矮一半
    shed: { holdFromM: 3000, maxTimes: 2.6 },
    // 地上的亭（放鹤亭，连同亭下的小屋）
    pavilion: { holdFromM: 4600, maxTimes: 3.8, spreadAtMax: 3.8 },
  },
  detailFadeM: [17000, 24000],
  closeTreesM: [3000, 4500],
};
