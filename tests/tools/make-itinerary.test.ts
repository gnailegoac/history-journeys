// 做行迹里时间轴用的那一份的工具：npm run itinerary。
// 每位有行迹的人物：读手写的那一份（content/figures/<人物>/itinerary.json）、人物资料和全程沙盘的场景，照 tests/support/itineraryTool.ts
// 做出 itinerary.bar.json，和仓库里的不一样才写。做好以后同手写的那一份一起提交；发布的流程不重做。不手改。
// 说明见 docs/data-spec.md“行迹”。
//
// 它是一个测试文件，因为这个项目是靠 vitest 在 Node 里跑 TypeScript 的。只有 npm run itinerary（vitest --mode itinerary）才做；
// 要是哪一版的 vitest 不把 --mode 交到 import.meta.env.MODE 里，设环境变量 ITINERARY=1 也算。
// 仓库里的那一份新不新，由 npm run validate 查（规则 22 第十句），这里不另查。
//
// 另一个环境变量：
//   ITINERARY_OUT  试做：做出来的文件放到这个文件夹（相对项目的根目录，如 .cache/itinerary-trial），不动 content/。
//
// 手写的那一份还过不了规则 22 的前九句时不做：照一份不对的行迹做出来的东西不能用。先跑 npm run validate，把它说的改好。

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Itinerary } from '../../src/domain/itinerary';
import { ROUTE_SCENE_ID } from '../../src/domain/scene';
import type { RouteScene } from '../../src/domain/scene';
import type { Figure } from '../../src/domain/types';
import { ITINERARY_BAR_FILE, ITINERARY_FILE, checkItinerary, checkItineraryShape } from '../content/itineraryRules';
import { barText, projectItinerary } from '../support/itineraryTool';

const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
const MAKING = import.meta.env.MODE === 'itinerary' || env.ITINERARY === '1';

/** 项目的根目录：这个文件在 tests/tools/ 里，往上两层。 */
const ROOT = new URL('../../', import.meta.url);
const at = (path: string): URL => new URL(path, ROOT);
const utf8 = new TextDecoder();
const readText = (path: string): string => utf8.decode(readFileSync(at(path))).replace(/^﻿/, '');

describe.skipIf(!MAKING)('做行迹里时间轴用的那一份（npm run itinerary）', () => {
  it('每位有行迹的人物：照手写的那一份做，和仓库里的不一样才写', () => {
    const say = (line: string): void => console.log(line);
    const trial = env.ITINERARY_OUT !== undefined && env.ITINERARY_OUT !== '';
    const outRoot = trial ? String(env.ITINERARY_OUT).replace(/\/+$/, '') : 'content/figures';
    if (/^([a-zA-Z]:|\/|\.\.)/.test(outRoot)) throw new Error(`ITINERARY_OUT 要写相对项目根目录的文件夹（如 .cache/itinerary-trial），现在是“${outRoot}”`);

    const folders = readdirSync(at('content/figures/'), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    let made = 0;
    for (const folder of folders) {
      const dir = `content/figures/${folder}`;
      if (!existsSync(at(`${dir}/${ITINERARY_FILE}`))) continue;
      made += 1;
      const file = `figures/${folder}/${ITINERARY_FILE}`;
      const data = JSON.parse(readText(`${dir}/${ITINERARY_FILE}`)) as unknown;
      const figure = JSON.parse(readText(`${dir}/figure.json`)) as Figure;
      const route = JSON.parse(readText(`${dir}/scenes/${ROUTE_SCENE_ID}.json`)) as RouteScene;
      const shape = checkItineraryShape(data, file);
      const found = shape.length > 0 ? shape : checkItinerary(data as Itinerary, file, figure, route);
      if (found.length > 0) {
        throw new Error(`[行迹] ${dir}/${ITINERARY_FILE} 还有 ${found.length} 处不合规格，先不做。头一处：${found[0].field}：${found[0].problem}（全部的见 npm run validate）`);
      }
      const text = barText(projectItinerary(data as Itinerary, figure));
      const out = `${outRoot}/${folder}/${ITINERARY_BAR_FILE}`;
      if (!trial && existsSync(at(out)) && readText(out).replace(/\r\n?/g, '\n') === text) {
        say(`[行迹] ${out} 已经是新的，什么也没写。`);
        continue;
      }
      mkdirSync(at(`${outRoot}/${folder}/`), { recursive: true });
      writeFileSync(at(out), text);
      say(`[行迹] 写了 ${out}（${new TextEncoder().encode(text).length} 字节，${(data as Itinerary).stretches.length} 段）。同手写的那一份一起提交。`);
    }
    expect(made, '一位有行迹的人物也没有找到').toBeGreaterThan(0);
  });
});
