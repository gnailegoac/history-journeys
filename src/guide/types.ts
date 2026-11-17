// 答疑适配层的接口。原型里只有占位实现（available 为 false），界面先做出来。

export interface GuideQuestion {
  figureId: string;
  stopId: string;
  question: string;
}

export interface GuideAnswer {
  /** 讲解员的回答，第三人称，只依据站内已编写的内容。 */
  text: string;
}

export interface GuideService {
  /** 答疑功能是否已接入。为 false 时界面只展示，不能提问。 */
  readonly available: boolean;
  ask(question: GuideQuestion): Promise<GuideAnswer>;
}
