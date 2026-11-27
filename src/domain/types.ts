// 数据规格的机器可读形式。说明见 docs/data-spec.md；两处不一致时先改文档，再改这里。
// 内容文件（content/ 目录）必须符合这些类型，并通过 `npm run validate`。

/** [经度, 纬度]，十进制度。 */
export type LngLat = [number, number];

/** 镜头相对一个地点的位置：离地点多远、俯仰多少、朝哪边。 */
export interface CameraPreset {
  /** 镜头到地点的直线距离，公里。 */
  distanceKm: number;
  /** 倾角，0 为正俯视，度。 */
  pitch: number;
  /** 方位，0 为朝北，顺时针，度。 */
  bearing: number;
}

/** 一个有古今两个名字的地点。 */
export interface Place {
  id: string;
  /** 当时的地名。 */
  ancient: string;
  /** 今天的地名。 */
  modern: string;
  lngLat: LngLat;
}

// ---------------------------------------------------------------- 首页

/** content/figures/index.json 里的一项：首页的一张人物卡片。 */
export interface FigureCard {
  id: string;
  name: string;
  /** 时代，如“北宋”。 */
  era: string;
  /** 生卒年，如“1037–1101”。 */
  years: string;
  /** 用于按时代排序的年份（出生年，公元前为负数）。 */
  sortYear: number;
  /** 一句话介绍。 */
  tagline: string;
  /** 是否已经写好、可以点进去。 */
  available: boolean;
  /**
   * 这位人物的各站都还没写（figure.json 里每一站都是 outline，一站的正文也没有）：写 true；有一站写好了就不写。
   * 这样的卡片可以点进去的时候，最后一行写的是“先看他走过的路”，不是“从第一站读起”——点进去看的是他的全程沙盘和各站的提要。
   * 校验照人物自己的 figure.json 查它写得对不对（docs/data-spec.md“文件放在哪”）。
   */
  outline?: boolean;
}

// ---------------------------------------------------------------- 人物

/** content/figures/<id>/figure.json。 */
export interface Figure {
  id: string;
  name: string;
  era: string;
  years: string;
  tagline: string;
  /** 人物页上“他是谁”的几段话，每个元素一段。第三人称。 */
  intro: string[];
  /** 从地球上看整条轨迹时，镜头对准哪里、离多远。停用：原来的地图用的，现在没有程序读。可以不写；写了的照旧查。 */
  overview?: { center: LngLat; distanceKm: number };
  /** 各站，按先后排列。 */
  stops: StopMeta[];
  /** 相邻两站之间的路。legs[i] 连接 stops[i] 和 stops[i+1]。停用：路现在写在全程沙盘的场景文件里。可以不写；写了的照旧查（规则 2）。 */
  legs?: Leg[];
}

/** 一站的抬头和地图信息。正文另放在 stops/<id>.md 和 stops/<id>.json；沙盘另放在 scenes/<id>.json。 */
export interface StopMeta {
  id: string;
  /** 站名，如“黄州：东坡上的地”。 */
  title: string;
  /** 目录和按钮上用的短名，如“黄州”。 */
  shortTitle: string;
  /** 年份，如“1080–1084”。 */
  years: string;
  /** 他当时的年纪。近代以前的中国人物按当时的算法用虚岁，并在文字里写明，如“虚岁四十五到四十九”。 */
  age: string;
  /** 这一站的主要地点。 */
  place: Place;
  /** 进入这一站时镜头停在哪。停用：镜头现在写在场景文件的各小节里。可以不写；写了的照旧查。 */
  camera?: CameraPreset;
  /** 目录里的一句话。 */
  summary: string;
  /** complete：正文已写好；outline：只有抬头，还没写。 */
  status: 'complete' | 'outline';
  /**
   * 这一站有自己的沙盘（scenes/<id>.json）：写 true；没有的不写这个字段。页面照它决定沙盘栏先摆什么，不用等别的文件；
   * 它和 scenes/ 里的文件对不对得上由规则 3 查（两头都查）。
   */
  table?: boolean;
  /** 这一站正文里提到、要在地图上标出的地点。停用：站内地点现在写在场景文件里，不要往这里加新东西。可以不写；写了的照旧查。 */
  localPlaces?: Place[];
}

export interface Leg {
  from: string;
  to: string;
  /** 途经点，不含两端的站。 */
  via: { name: string; lngLat: LngLat }[];
}

// ---------------------------------------------------------------- 一站的内容

/** 小注的四类。 */
export type NoteKind = 'history' | 'geography' | 'humanities' | 'science';

/** 凭据的四种依据。 */
export type Basis =
  /** 他本人的诗文、书信、题跋。 */
  | 'own-words'
  /** 史书和同时代人的记载。 */
  | 'record'
  /** 后人的记载和研究。 */
  | 'later'
  /** 编写时补的：推断、衔接、常识。 */
  | 'editor';

/** stops/<id>.json。 */
export interface StopExtras {
  stopId: string;
  notes: Note[];
  originals: Original[];
  images: StopImage[];
  sources: Source[];
  /** 凭据：正文每一小节各有一组。 */
  provenance: ProvenanceGroup[];
  /** “问讲解员”面板里的示例问题。 */
  sampleQuestions: string[];
}

/** 小注：只注正文里出现的东西，点开才出现。 */
export interface Note {
  id: string;
  kind: NoteKind;
  /** 正文里的原词，必须在正文中原样出现；界面标出它第一次出现的地方。 */
  anchor: string;
  title: string;
  /** 小注的正文，纯文字，可以分段（用空行）。 */
  body: string;
  sourceIds: string[];
}

/** 原文：他本人的诗文书信，附白话。 */
export interface Original {
  id: string;
  title: string;
  /** 写作时间，如“元丰五年（1082）三月”。 */
  date: string;
  /** 原文。诗词一行一句，用换行分开。 */
  text: string;
  /** 白话。 */
  plain: string;
  /** 放在正文哪一小节后面（小节标题）。 */
  section: string;
  sourceId: string;
}

export interface StopImage {
  id: string;
  /** 图片文件名，放在 content/figures/<人物>/images/ 下。 */
  file: string;
  alt: string;
  caption: string;
  /** 放在正文哪一小节后面（小节标题）。 */
  section: string;
  /** 作者或收藏机构。 */
  credit: string;
  /** 授权方式，如“公有领域”。 */
  license: string;
  /** 图片出处的网址。 */
  sourceUrl: string;
}

export interface Source {
  id: string;
  basis: Exclude<Basis, 'editor'>;
  /** 出处，如“苏轼《答秦太虚书》，《苏轼文集》卷五十二”。 */
  cite: string;
}

export interface ProvenanceGroup {
  /** 正文的小节标题。 */
  section: string;
  items: ProvenanceItem[];
}

export interface ProvenanceItem {
  /** 这一节里的哪件事或哪句话。 */
  what: string;
  basis: Basis;
  /** basis 不是 editor 时至少填一个。 */
  sourceIds: string[];
}

// ---------------------------------------------------------------- 读取后的形态

/** 正文里的一块。 */
export type Block =
  | { type: 'paragraph'; segments: Segment[] }
  /** 引用的原文句子。 */
  | { type: 'quote'; lines: string[] };

/** 一段文字里的一截；带 noteId 的那一截可以点开小注。 */
export interface Segment {
  text: string;
  noteId?: string;
}

export interface Section {
  heading: string;
  blocks: Block[];
}

/** 一站读取并整理后的全部内容。 */
export interface StopContent extends StopExtras {
  sections: Section[];
  /** 图片文件名到可用网址的对应。 */
  imageUrls: Record<string, string>;
}
