// 把 import.meta.glob 从磁盘读到的文件，整理成校验规则要的样子。

import type { ContentFiles } from './rules';

/**
 * paths：目录下所有文件的路径（含图片）；texts：其中 .json 和 .md 文件的文字。
 * prefix 是内容目录的路径，结果里的路径去掉这一截。
 */
export function toContentFiles(prefix: string, paths: string[], texts: Record<string, string>): ContentFiles {
  const files: ContentFiles = {};
  for (const path of paths) {
    if (path.startsWith(prefix)) files[path.slice(prefix.length)] = texts[path] ?? '';
  }
  return files;
}
