// 校验规则自己的测试：每条规则都用合格的样本（fixtures/good）和出错的样本（fixtures/bad）各试一遍，
// 再在合格样本上一次只改坏一处，看是不是正好查出那一处。
// 这里是格式和规则 1 到 9；场景数据的规则 10 到 18 和场景文件的格式在 sceneRules.test.ts。

import { describe, expect, it } from 'vitest';
import type { Figure, FigureCard, StopExtras } from '../../src/domain/types';
import { toContentFiles } from './files';
import { checkBody, checkRoute, formatReport, formatViolation, lngLatProblem, validateContent } from './rules';
import type { ContentFiles } from './rules';

const texts = import.meta.glob<string>('./fixtures/**/*.{json,md}', { query: '?raw', import: 'default', eager: true });
const paths = Object.keys(import.meta.glob('./fixtures/**/*'));
const fixture = (name: string): ContentFiles => toContentFiles(`./fixtures/${name}/`, paths, texts);

const GOOD = fixture('good');
const BAD = fixture('bad');

const INDEX = 'figures/index.json';
const FIGURE = 'figures/demo/figure.json';
const STOP = 'figures/demo/stops/river.json';
const BODY = 'figures/demo/stops/river.md';
const IMAGE = 'figures/demo/images/boat.svg';

/** 全部问题，每处写成“规则号 文件 › 字段”。 */
function all(files: ContentFiles): string[] {
  return validateContent(files).map((v) => `${v.rule} ${v.file}${v.field === '' ? '' : ` › ${v.field}`}`);
}

/** 某一条规则查出来的地方，每处写成“文件 › 字段”。 */
function flagged(files: ContentFiles, rule: number): string[] {
  return validateContent(files)
    .filter((v) => v.rule === rule)
    .map((v) => `${v.file}${v.field === '' ? '' : ` › ${v.field}`}`);
}

/** 在合格样本上改一个 JSON 文件。 */
function edit<T>(path: string, change: (data: T) => void): ContentFiles {
  const data = JSON.parse(GOOD[path]) as T;
  change(data);
  return { ...GOOD, [path]: JSON.stringify(data) };
}
const editCards = (change: (cards: FigureCard[]) => void) => edit<FigureCard[]>(INDEX, change);
const editFigure = (change: (figure: Figure) => void) => edit<Figure>(FIGURE, change);
const editStop = (change: (extras: StopExtras) => void) => edit<StopExtras>(STOP, change);

/** 在合格样本上换掉或加上一个文件。 */
const withFile = (path: string, content: string): ContentFiles => ({ ...GOOD, [path]: content });

/** 在合格样本上去掉一个文件。 */
function without(path: string): ContentFiles {
  const files = { ...GOOD };
  delete files[path];
  return files;
}

const goodFigure = (): Figure => JSON.parse(GOOD[FIGURE]) as Figure;

describe('两份样本', () => {
  it('合格的样本一处问题也没有', () => {
    expect(all(GOOD)).toEqual([]);
  });

  it('出错的样本里，十六条规则和格式都查出了问题', () => {
    const rules = new Set(validateContent(BAD).map((v) => v.rule));
    expect([...rules].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
    expect(validateContent(BAD)).toHaveLength(120);
    // 其中格式和前九条的（两个场景文件的格式、坐标和占位算在里面）：
    expect(validateContent(BAD).filter((v) => v.rule <= 9)).toHaveLength(56);
  });
});

describe('格式：文件读得出来，字段齐全，id 对得上', () => {
  it('合格的样本通过', () => {
    expect(flagged(GOOD, 0)).toEqual([]);
  });

  it('出错的样本：可以点进去的卡片没有人物文件；figure.json 不是合法的 JSON', () => {
    // 场景文件 scenes/c.json 的格式问题另在 sceneRules.test.ts 里逐条对。
    const notScenes = flagged(BAD, 0).filter((where) => !where.includes('/scenes/'));
    expect(notScenes).toEqual(['figures/index.json › [1].available', 'figures/unreadable/figure.json']);
  });

  it('没有 index.json', () => {
    expect(all(without(INDEX))).toEqual(['0 figures/index.json']);
  });

  it('index.json 不是合法的 JSON，或者不是列表', () => {
    expect(all(withFile(INDEX, '[{ "id": "demo" '))).toEqual(['0 figures/index.json']);
    expect(all(withFile(INDEX, '{}'))).toEqual(['0 figures/index.json']);
  });

  it('卡片缺字段、字段类型不对', () => {
    const missing = edit<Partial<FigureCard>[]>(INDEX, (cards) => delete cards[1].tagline);
    expect(all(missing)).toEqual(['0 figures/index.json › [1].tagline']);
    const wrongType = edit<Record<string, unknown>[]>(INDEX, (cards) => {
      cards[0].sortYear = '1000';
      cards[1].available = 'no';
    });
    expect(all(wrongType)).toEqual(['0 figures/index.json › [0].sortYear', '0 figures/index.json › [1].available']);
  });

  it('两张卡片的 id 一样', () => {
    expect(all(editCards((cards) => (cards[1].id = 'demo')))).toEqual(['0 figures/index.json › [1].id']);
  });

  it('卡片标了可以点进去，却没有 figure.json', () => {
    expect(all(editCards((cards) => (cards[1].available = true)))).toEqual(['0 figures/index.json › [1].available']);
  });

  it('人物文件夹里没有 figure.json', () => {
    expect(all(without(FIGURE))).toEqual(['0 figures/index.json › [0].available', '0 figures/demo/figure.json']);
  });

  it('figure.json 缺字段、字段类型不对时，逐个指出来', () => {
    const broken = edit<Record<string, unknown>>(FIGURE, (figure) => {
      const stops = figure.stops as Record<string, unknown>[];
      delete figure.overview;
      figure.intro = '只有一段，忘了写成列表';
      stops[0].status = 'done';
      (stops[0].camera as Record<string, unknown>).pitch = '60';
      delete (stops[1].place as Record<string, unknown>).modern;
    });
    expect(all(broken)).toEqual([
      '0 figures/demo/figure.json › intro',
      '0 figures/demo/figure.json › overview',
      '0 figures/demo/figure.json › stops[0].camera.pitch',
      '0 figures/demo/figure.json › stops[0].status',
      '0 figures/demo/figure.json › stops[1].place.modern',
    ]);
  });

  it('figure.json 的 id 和文件夹名不一样', () => {
    expect(all(editFigure((figure) => (figure.id = 'someone-else')))).toEqual(['0 figures/demo/figure.json › id']);
  });

  it('同一站里两个地点的 id 一样', () => {
    const files = editFigure((figure) => (figure.stops[0].localPlaces[1].id = 'lock'));
    expect(all(files)).toEqual(['0 figures/demo/figure.json › stops[0].localPlaces[1].id']);
  });

  it('一站的 .json 不是合法的 JSON', () => {
    expect(all(withFile(STOP, '{ "stopId": "river", '))).toEqual(['0 figures/demo/stops/river.json']);
  });

  it('一站的 .json 缺字段、字段类型不对；格式没改好之前不报这个文件的其余规则', () => {
    const broken = edit<Record<string, unknown>>(STOP, (extras) => {
      delete extras.sources;
      (extras.notes as Record<string, unknown>[])[0].sourceIds = 's1';
      extras.sampleQuestions = [1];
    });
    expect(all(broken)).toEqual([
      '0 figures/demo/stops/river.json › notes[0].sourceIds',
      '0 figures/demo/stops/river.json › sources',
      '0 figures/demo/stops/river.json › sampleQuestions[0]',
    ]);
  });

  it('一站的 .json 里 stopId 和文件名不一样', () => {
    expect(all(editStop((extras) => (extras.stopId = 'lake')))).toEqual(['0 figures/demo/stops/river.json › stopId']);
  });

  it('小注、出处的 id 重复', () => {
    expect(all(editStop((extras) => (extras.notes[3].id = 'n1')))).toEqual(['0 figures/demo/stops/river.json › notes[3].id']);
    const files = editStop((extras) => extras.sources.push({ id: 's1', basis: 'record', cite: '重复的出处' }));
    expect(all(files)).toEqual(['0 figures/demo/stops/river.json › sources[2].id']);
  });

  it('JSON 文件开头带 BOM 不算错', () => {
    const files = { ...GOOD, [INDEX]: `﻿${GOOD[INDEX]}`, [FIGURE]: `﻿${GOOD[FIGURE]}`, [STOP]: `﻿${GOOD[STOP]}` };
    expect(all(files)).toEqual([]);
  });
});

describe('规则 1 坐标', () => {
  it('合格的样本通过', () => {
    expect(flagged(GOOD, 1)).toEqual([]);
  });

  it('出错的样本：经纬度写反、经度超出范围、只写了一个数、途经点纬度超出范围；场景文件里的坐标也查', () => {
    expect(flagged(BAD, 1)).toEqual([
      'figures/broken/figure.json › stops[0].place.lngLat',
      'figures/broken/figure.json › stops[0].localPlaces[0].lngLat',
      'figures/broken/figure.json › stops[0].localPlaces[1].lngLat',
      'figures/broken/figure.json › legs[0].via[0].lngLat',
      'figures/broken/scenes/c.json › frame.center',
    ]);
  });

  it('四处坐标都查：总览、站、站内地点、途经点', () => {
    expect(all(editFigure((f) => (f.overview.center = [181, 30])))).toEqual(['1 figures/demo/figure.json › overview.center']);
    expect(all(editFigure((f) => (f.stops[1].place.lngLat = [111.5, -90.5])))).toEqual(['1 figures/demo/figure.json › stops[1].place.lngLat']);
    expect(all(editFigure((f) => (f.stops[0].localPlaces[1].lngLat = [-180.1, 30])))).toEqual([
      '1 figures/demo/figure.json › stops[0].localPlaces[1].lngLat',
    ]);
    expect(all(editFigure((f) => (f.legs[0].via[0].lngLat = [111.2, 91])))).toEqual(['1 figures/demo/figure.json › legs[0].via[0].lngLat']);
  });

  it('范围的边界值算合格', () => {
    expect(lngLatProblem([180, 90])).toBeNull();
    expect(lngLatProblem([-180, -90])).toBeNull();
    expect(lngLatProblem([0, 0])).toBeNull();
  });

  it('超出范围时说出是经度还是纬度；像是写反了就提醒一句', () => {
    expect(lngLatProblem([180.01, 0])).toContain('经度 180.01');
    expect(lngLatProblem([-181, 0])).toContain('经度 -181');
    expect(lngLatProblem([0, 90.01])).toContain('纬度 90.01');
    expect(lngLatProblem([0, -91])).toContain('纬度 -91');
    expect(lngLatProblem([30.4, 114.9])).toContain('写反了');
    expect(lngLatProblem([114.9, 95])).not.toContain('写反了');
  });

  it('不是两个数的写法都不行', () => {
    for (const value of [undefined, null, '110,30', 110, [110], [110, 30, 5], ['110', '30'], [110, null], { lng: 110, lat: 30 }]) {
      expect(lngLatProblem(value), JSON.stringify(value)).toContain('[经度, 纬度]');
    }
  });
});

describe('规则 2 站点与轨迹', () => {
  it('合格的样本通过', () => {
    expect(flagged(GOOD, 2)).toEqual([]);
  });

  it('出错的样本：三站只有一段路，而且这段路跳过了第二站', () => {
    expect(flagged(BAD, 2)).toEqual(['figures/broken/figure.json › legs', 'figures/broken/figure.json › legs[0].to']);
  });

  const fields = (figure: Figure) => checkRoute(figure, 'figure.json').map((v) => v.field);

  it('站的 id 重复', () => {
    const figure = goodFigure();
    figure.stops[2].id = 'river';
    figure.legs[1].to = 'river';
    expect(fields(figure)).toEqual(['stops[2].id']);
  });

  it('路少一段、多一段', () => {
    const fewer = goodFigure();
    fewer.legs.pop();
    expect(fields(fewer)).toEqual(['legs']);
    const more = goodFigure();
    more.legs.push({ from: 'port', to: 'river', via: [] });
    expect(fields(more)).toEqual(['legs']);
  });

  it('路没有依次首尾相连', () => {
    const wrongFrom = goodFigure();
    wrongFrom.legs[1].from = 'river';
    expect(fields(wrongFrom)).toEqual(['legs[1].from']);
    const swapped = goodFigure();
    swapped.legs.reverse();
    expect(fields(swapped)).toEqual(['legs[0].from', 'legs[0].to', 'legs[1].from', 'legs[1].to']);
  });

  it('只有一站、没有路，或者还没有站，都算合格', () => {
    const single = goodFigure();
    single.stops = [single.stops[0]];
    single.legs = [];
    expect(fields(single)).toEqual([]);
    expect(fields({ ...goodFigure(), stops: [], legs: [] })).toEqual([]);
  });

  it('在整份内容里也查得到', () => {
    expect(all(editFigure((f) => (f.legs[1].from = 'river')))).toEqual(['2 figures/demo/figure.json › legs[1].from']);
  });
});

describe('规则 3 文件齐全', () => {
  it('合格的样本通过', () => {
    expect(flagged(GOOD, 3)).toEqual([]);
  });

  it('出错的样本：outline 的站有正文文件；complete 的站缺 .json；多出一个对不上的文件', () => {
    expect(flagged(BAD, 3)).toEqual(['figures/broken/stops/b.md', 'figures/broken/stops/c.json', 'figures/broken/stops/orphan.json']);
  });

  it('complete 的站缺 .md 或缺 .json', () => {
    expect(all(without(BODY))).toEqual(['3 figures/demo/stops/river.md']);
    expect(all(without(STOP))).toEqual(['3 figures/demo/stops/river.json']);
  });

  it('outline 的站有了 .md 或 .json', () => {
    expect(all(withFile('figures/demo/stops/pass.md', '## 山口\n\n还没写完。'))).toEqual(['3 figures/demo/stops/pass.md']);
    expect(all(withFile('figures/demo/stops/port.json', '{}'))).toEqual(['3 figures/demo/stops/port.json']);
  });

  it('stops/ 里有对不上任何一站的 .md 或 .json', () => {
    expect(all(withFile('figures/demo/stops/lake.md', '## 湖\n\n写错了文件名。'))).toEqual(['3 figures/demo/stops/lake.md']);
  });

  it('把站改成 outline 却留着文件', () => {
    const files = editFigure((f) => (f.stops[0].status = 'outline'));
    // 这一站的沙盘也跟着不合格了：还没写好的站不能有场景文件（规则 10）。
    expect(all(files)).toEqual(['3 figures/demo/stops/river.md', '3 figures/demo/stops/river.json', '10 figures/demo/scenes/river.json']);
  });
});

describe('规则 4 正文', () => {
  it('合格的样本通过', () => {
    expect(flagged(GOOD, 4)).toEqual([]);
  });

  it('出错的样本：正文太短；有一个小节只有引用、没有段落', () => {
    expect(flagged(BAD, 4)).toEqual(['figures/broken/stops/a.md', 'figures/broken/stops/a.md › 小节“空的小节”', 'figures/broken/stops/c.md']);
  });

  const problems = (markdown: string) => checkBody(markdown, 'x.md').violations.map((v) => `${v.field}｜${v.problem}`);
  const body = (length: number) => `## 一\n\n${'字'.repeat(length - 10)}\n\n> ${'引'.repeat(10)}\n`;

  it('800 到 1400 字算合格，引用行也算字数，标题不算', () => {
    expect(problems(body(800))).toEqual([]);
    expect(problems(body(1400))).toEqual([]);
    expect(problems(`## ${'很长的标题'.repeat(200)}\n\n${'字'.repeat(800)}`)).toEqual([]);
  });

  it('少于 800 字或多于 1400 字', () => {
    expect(problems(body(799))).toEqual(['｜正文有 799 字（不算小节标题），应在 800 到 1400 字之间']);
    expect(problems(body(1401))).toEqual(['｜正文有 1401 字（不算小节标题），应在 800 到 1400 字之间']);
    expect(problems('')).toEqual(['｜正文有 0 字（不算小节标题），应在 800 到 1400 字之间']);
  });

  it('有的小节没有段落', () => {
    const markdown = `## 一\n\n${'字'.repeat(900)}\n\n## 空的\n\n## 只有引用\n\n> 引用。\n`;
    expect(problems(markdown)).toEqual(['小节“空的”｜这个小节没有段落，至少要有一段', '小节“只有引用”｜这个小节没有段落，至少要有一段']);
  });

  it('小节标题重复', () => {
    const markdown = `## 一\n\n${'字'.repeat(900)}\n\n## 一\n\n又一段。\n`;
    expect(problems(markdown).map((p) => p.split('｜')[0])).toEqual(['小节“一”']);
  });

  it('写法不对：没有从小节标题开始，或者用了别的标题', () => {
    const noHeading = checkBody(`开头没有标题。\n\n## 一\n\n${'字'.repeat(900)}`, 'x.md');
    expect(noHeading.sections).toBeNull();
    expect(noHeading.violations.map((v) => v.problem)).toEqual(['正文必须以“## 小节标题”开头：开头没有标题。']);
    const otherHeading = checkBody(`## 一\n\n${'字'.repeat(900)}\n\n### 小小节\n`, 'x.md');
    expect(otherHeading.sections).toBeNull();
    expect(otherHeading.violations.map((v) => v.problem)).toEqual(['正文里只允许“## ”开头的小节标题：### 小小节']);
  });

  it('在整份内容里：正文写法不对时只报正文，不再报靠正文才能查的小注、原文、图片、凭据', () => {
    expect(all(withFile(BODY, `# 大标题\n\n${GOOD[BODY]}`))).toEqual(['4 figures/demo/stops/river.md']);
  });
});

describe('规则 5 小注', () => {
  it('合格的样本通过', () => {
    expect(flagged(GOOD, 5)).toEqual([]);
  });

  it('出错的样本：类别不对、原词不在段落里、没有出处、出处找不到', () => {
    expect(flagged(BAD, 5)).toEqual([
      'figures/broken/stops/a.json › notes[1].kind',
      'figures/broken/stops/a.json › notes[1].anchor',
      'figures/broken/stops/a.json › notes[1].sourceIds',
      'figures/broken/stops/a.json › notes[2].anchor',
      'figures/broken/stops/a.json › notes[2].sourceIds[0]',
    ]);
  });

  const anchorProblem = (anchor: string, index = 0) => {
    const files = editStop((extras) => (extras.notes[index].anchor = anchor));
    return validateContent(files).map((v) => `${v.rule} ${v.field}｜${v.problem}`);
  };

  it('原词在正文里找不到', () => {
    expect(anchorProblem('乌蓬船')).toEqual(['5 notes[0].anchor｜小注“n1”的原词“乌蓬船”在正文的段落里找不到（要一字不差；小节标题和引用行不算）']);
  });

  it('原词只在引用行或小节标题里出现，不算', () => {
    expect(GOOD[BODY]).toContain('> 行船三日');
    expect(anchorProblem('行船三日').map((p) => p.split('｜')[0])).toEqual(['5 notes[0].anchor']);
    expect(GOOD[BODY]).toContain('## 上船');
    expect(anchorProblem('上船').map((p) => p.split('｜')[0])).toEqual(['5 notes[0].anchor']);
  });

  it('原词没有填', () => {
    expect(anchorProblem('')).toEqual(['5 notes[0].anchor｜小注“n1”没有填原词']);
  });

  it('原词在正文里只出现在另一条更长的原词里面，标不出来', () => {
    expect(anchorProblem('乌篷', 1)).toEqual(['5 notes[1].anchor｜小注“n2”的原词“乌篷”在正文里出现的地方都被别的小注的原词占了，标不出来']);
  });

  it('短的原词在更长的原词之外另有出现时合格', () => {
    // “水”在“水闸”里有，在别的句子里也有。
    expect(anchorProblem('水')).toEqual([]);
  });

  it('类别不是四类之一', () => {
    const files = edit<{ notes: { kind: string }[] }>(STOP, (extras) => (extras.notes[2].kind = '地理'));
    expect(all(files)).toEqual(['5 figures/demo/stops/river.json › notes[2].kind']);
  });

  it('没有出处，或者出处在 sources 里找不到', () => {
    expect(all(editStop((extras) => (extras.notes[0].sourceIds = [])))).toEqual(['5 figures/demo/stops/river.json › notes[0].sourceIds']);
    expect(all(editStop((extras) => (extras.notes[0].sourceIds = ['s2', 's7'])))).toEqual(['5 figures/demo/stops/river.json › notes[0].sourceIds[1]']);
  });
});

describe('规则 6 原文', () => {
  it('合格的样本通过', () => {
    expect(flagged(GOOD, 6)).toEqual([]);
  });

  it('出错的样本：小节对不上、出处找不到、原文和白话是空的', () => {
    expect(flagged(BAD, 6)).toEqual([
      'figures/broken/stops/a.json › originals[0].section',
      'figures/broken/stops/a.json › originals[0].sourceId',
      'figures/broken/stops/a.json › originals[0].text',
      'figures/broken/stops/a.json › originals[0].plain',
    ]);
  });

  it('一次改坏一处', () => {
    expect(all(editStop((e) => (e.originals[0].section = '河 上')))).toEqual(['6 figures/demo/stops/river.json › originals[0].section']);
    expect(all(editStop((e) => (e.originals[0].sourceId = 's7')))).toEqual(['6 figures/demo/stops/river.json › originals[0].sourceId']);
    expect(all(editStop((e) => (e.originals[0].text = '')))).toEqual(['6 figures/demo/stops/river.json › originals[0].text']);
    expect(all(editStop((e) => (e.originals[0].plain = ' \n ')))).toEqual(['6 figures/demo/stops/river.json › originals[0].plain']);
  });

  it('没有原文的站合格', () => {
    expect(all(editStop((e) => (e.originals = [])))).toEqual([]);
  });
});

describe('规则 7 图片', () => {
  it('合格的样本通过', () => {
    expect(flagged(GOOD, 7)).toEqual([]);
  });

  it('出错的样本：图片文件不存在、小节对不上、三个字段没有填', () => {
    expect(flagged(BAD, 7)).toEqual([
      'figures/broken/stops/a.json › images[0].file',
      'figures/broken/stops/a.json › images[0].section',
      'figures/broken/stops/a.json › images[0].alt',
      'figures/broken/stops/a.json › images[0].credit',
      'figures/broken/stops/a.json › images[0].sourceUrl',
    ]);
  });

  it('图片文件不在 images/ 里，或者没有填文件名', () => {
    expect(all(without(IMAGE))).toEqual(['7 figures/demo/stops/river.json › images[0].file']);
    expect(all(editStop((e) => (e.images[0].file = 'Boat.svg')))).toEqual(['7 figures/demo/stops/river.json › images[0].file']);
    expect(all(editStop((e) => (e.images[0].file = '')))).toEqual(['7 figures/demo/stops/river.json › images[0].file']);
  });

  it('小节对不上', () => {
    expect(all(editStop((e) => (e.images[0].section = '下船')))).toEqual(['7 figures/demo/stops/river.json › images[0].section']);
  });

  it('alt、caption、credit、license、sourceUrl 哪个没填都不行', () => {
    for (const key of ['alt', 'caption', 'credit', 'license', 'sourceUrl'] as const) {
      expect(all(editStop((e) => (e.images[0][key] = '  ')))).toEqual([`7 figures/demo/stops/river.json › images[0].${key}`]);
    }
  });

  it('没有图片的站合格', () => {
    expect(all(editStop((e) => (e.images = [])))).toEqual([]);
  });
});

describe('规则 8 凭据', () => {
  it('合格的样本通过', () => {
    expect(flagged(GOOD, 8)).toEqual([]);
  });

  it('出错的样本：出处的依据写错、有小节没有凭据、有一组是空的、该填出处的没填、出处找不到、依据写错、小节对不上', () => {
    expect(flagged(BAD, 8)).toEqual([
      'figures/broken/stops/a.json › sources[1].basis',
      'figures/broken/stops/a.json › provenance',
      'figures/broken/stops/a.json › provenance[0].items',
      'figures/broken/stops/a.json › provenance[1].items[0].sourceIds',
      'figures/broken/stops/a.json › provenance[1].items[2].sourceIds[0]',
      'figures/broken/stops/a.json › provenance[1].items[3].basis',
      'figures/broken/stops/a.json › provenance[2].section',
    ]);
  });

  it('正文有一个小节没有凭据', () => {
    const files = editStop((e) => e.provenance.splice(1, 1));
    expect(validateContent(files).map((v) => `${v.rule} ${v.field}｜${v.problem}`)).toEqual(['8 provenance｜正文的小节“河上”没有凭据，每个小节都要有一组']);
  });

  it('凭据写的小节在正文里没有', () => {
    const files = editStop((e) => e.provenance.push({ section: '下船', items: [{ what: '多出来的一组', basis: 'editor', sourceIds: [] }] }));
    expect(all(files)).toEqual(['8 figures/demo/stops/river.json › provenance[3].section']);
  });

  it('一组里一条也没有', () => {
    expect(all(editStop((e) => (e.provenance[2].items = [])))).toEqual(['8 figures/demo/stops/river.json › provenance[2].items']);
  });

  it('依据不是“编写时补的”，却没有填出处', () => {
    for (const basis of ['own-words', 'record', 'later'] as const) {
      const files = editStop((e) => (e.provenance[2].items[0] = { what: '在渡口换船', basis, sourceIds: [] }));
      expect(all(files), basis).toEqual(['8 figures/demo/stops/river.json › provenance[2].items[0].sourceIds']);
    }
  });

  it('依据是“编写时补的”，可以不填出处', () => {
    const extras = JSON.parse(GOOD[STOP]) as StopExtras;
    expect(extras.provenance[2].items[0]).toMatchObject({ basis: 'editor', sourceIds: [] });
  });

  it('填的出处在 sources 里找不到', () => {
    const files = editStop((e) => (e.provenance[0].items[0].sourceIds = ['s1', 's7']));
    expect(all(files)).toEqual(['8 figures/demo/stops/river.json › provenance[0].items[0].sourceIds[1]']);
  });

  it('依据不是四种之一；出处的依据不能是“编写时补的”', () => {
    const item = edit<{ provenance: { items: { basis: string }[] }[] }>(STOP, (e) => (e.provenance[0].items[0].basis = 'legend'));
    expect(all(item)).toEqual(['8 figures/demo/stops/river.json › provenance[0].items[0].basis']);
    const source = edit<{ sources: { basis: string }[] }>(STOP, (e) => (e.sources[1].basis = 'editor'));
    expect(all(source)).toEqual(['8 figures/demo/stops/river.json › sources[1].basis']);
  });
});

describe('规则 9 没有占位', () => {
  it('合格的样本通过', () => {
    expect(flagged(GOOD, 9)).toEqual([]);
  });

  it('出错的样本：卡片、人物资料、complete 的站的抬头、.json、正文和场景文件里的占位都查出来；outline 的站的抬头不查', () => {
    expect(BAD['figures/broken/figure.json']).toContain('"age": "（待填）"');
    expect(flagged(BAD, 9)).toEqual([
      'figures/index.json › [0].tagline',
      'figures/broken/figure.json › intro[0]',
      'figures/broken/figure.json › stops[2].summary',
      'figures/broken/stops/a.json › sources[0].cite',
      'figures/broken/stops/a.json › provenance[1].items[1].what',
      'figures/broken/stops/c.md › 第 3 行',
      'figures/broken/scenes/a.json › terrain.recipe.basis',
    ]);
  });

  it('首页卡片和人物资料里的占位', () => {
    expect(all(editCards((cards) => (cards[1].tagline = '（待内容编写时填写）')))).toEqual(['9 figures/index.json › [1].tagline']);
    expect(all(editFigure((f) => (f.tagline = '（待内容编写时填写）')))).toEqual(['9 figures/demo/figure.json › tagline']);
    expect(all(editFigure((f) => f.intro.push('（待补一段）')))).toEqual(['9 figures/demo/figure.json › intro[1]']);
  });

  it('complete 的站的抬头查，outline 的站的抬头不查', () => {
    expect(all(editFigure((f) => (f.stops[0].age = '（待填）')))).toEqual(['9 figures/demo/figure.json › stops[0].age']);
    expect(all(editFigure((f) => (f.stops[1].age = '（待填）')))).toEqual([]);
    expect(all(editFigure((f) => (f.stops[2].summary = '（待填）')))).toEqual([]);
  });

  it('complete 的站的 .json 里，哪个字段留了占位都查得到', () => {
    expect(all(editStop((e) => (e.notes[1].body += '（待核）')))).toEqual(['9 figures/demo/stops/river.json › notes[1].body']);
    expect(all(editStop((e) => (e.sources[0].cite = '示例先生《行河记》卷二(待查页码)')))).toEqual(['9 figures/demo/stops/river.json › sources[0].cite']);
    expect(all(editStop((e) => e.sampleQuestions.push('（待定）')))).toEqual(['9 figures/demo/stops/river.json › sampleQuestions[1]']);
  });

  it('起步稿留下的凭据占位也算', () => {
    const files = editStop((e) => (e.provenance[2].items = [{ what: '（起步稿，凭据待内容编写时逐条填写）', basis: 'editor', sourceIds: [] }]));
    expect(validateContent(files).map((v) => `${v.rule} ${v.field}｜${v.problem}`)).toEqual([
      '9 provenance[2].items[0].what｜还留着占位文字“（起步稿，凭据待内容编写时逐条填写）”',
    ]);
  });

  it('正文里的占位，说出在第几行', () => {
    const lines = GOOD[BODY].split('\n');
    lines[4] += '（待补一句）';
    expect(all(withFile(BODY, lines.join('\n')))).toEqual(['9 figures/demo/stops/river.md › 第 5 行']);
  });

  it('没有括号的“待”字、括号里不是待办的“待”字，不算；括号里带“待核”一类的话，算', () => {
    expect(all(editStop((e) => (e.notes[0].body = '用不完的钱留着待客。')))).toEqual([]);
    expect(all(editStop((e) => (e.notes[0].body = '他在城外（等待船来的地方）住了一夜。')))).toEqual([]);
    expect(all(editStop((e) => (e.notes[0].body = '水位差是个约数（约数，待核）。')))).toEqual([
      '9 figures/demo/stops/river.json › notes[0].body',
    ]);
  });
});

describe('报告的写法', () => {
  it('一处问题一句话：哪条规则、哪个文件、哪个字段、哪里不对', () => {
    expect(formatViolation({ rule: 5, file: 'figures/su-shi/stops/huangzhou.json', field: 'notes[2].anchor', problem: '原词在正文里找不到' })).toBe(
      '【规则 5 小注】content/figures/su-shi/stops/huangzhou.json › notes[2].anchor：原词在正文里找不到',
    );
    expect(formatViolation({ rule: 3, file: 'figures/su-shi/stops/mizhou.md', field: '', problem: '没有这个文件' })).toBe(
      '【规则 3 文件齐全】content/figures/su-shi/stops/mizhou.md：没有这个文件',
    );
    expect(formatViolation({ rule: 0, file: 'figures/index.json', field: '[0].sortYear', problem: '应该是一个数' })).toBe(
      '【格式】content/figures/index.json › [0].sortYear：应该是一个数',
    );
  });

  it('清单带总数和序号；有格式问题时多一句说明', () => {
    const report = formatReport([
      { rule: 1, file: 'a.json', field: 'x', problem: '甲' },
      { rule: 2, file: 'b.json', field: '', problem: '乙' },
    ]);
    expect(report).toBe('内容校验没有通过，共 2 处：\n1. 【规则 1 坐标】content/a.json › x：甲\n2. 【规则 2 站点与轨迹】content/b.json：乙');
    expect(formatReport([{ rule: 0, file: 'a.json', field: '', problem: '读不出来' }])).toContain('格式改好以后才检查');
    expect(formatReport([])).toBe('内容校验通过。');
  });

  it('出错样本的每一处问题都写得出完整的一句话', () => {
    for (const v of validateContent(BAD)) {
      expect(formatViolation(v)).toMatch(/^【(格式|规则 \d+ .+)】content\/figures\/.+：.+$/);
    }
  });
});
