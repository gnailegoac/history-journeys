// 答疑适配层的入口。以后接入服务端接口时，只换这里返回的实现。

import { placeholderGuide } from './placeholder';
import type { GuideService } from './types';

export type { GuideAnswer, GuideQuestion, GuideService } from './types';

export function getGuideService(): GuideService {
  return placeholderGuide;
}
