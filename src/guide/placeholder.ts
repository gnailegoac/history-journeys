// 答疑的占位实现：功能还没有接入，界面只展示，不能提问。

import type { GuideAnswer, GuideService } from './types';

export const placeholderGuide: GuideService = {
  available: false,
  ask(): Promise<GuideAnswer> {
    return Promise.reject(new Error('答疑功能还没有接入'));
  },
};
