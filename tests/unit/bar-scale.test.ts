// 时间轴的刻度（src/timebar/barScale.ts）：哪一天落在轴的哪里。在 Node 里跑，照 content/ 里真的行迹（时间轴用的那一份）查。
// 栏多宽、轴多宽是 tests/stage/support/standardPanes.ts 里量出来的那几种沙盘栏。轴画出来的那一截 = 栏里面的宽 − 左右垫的空
//（栏够 584 像素宽的左右各 12，不到的各 10；见 src/styles/timebar.css 的 .bar）+ 能按的那一条往两边探出去的 − 两头各半个圆钮
//（.bar-track 的 margin、.bar-axis 的 left 和 right：数从样式表里读）。

import { describe, expect, it } from 'vitest';
import type { ItineraryBar } from '../../src/domain/itinerary';
import { DISC_PX, OTHER_MIN_UNITS, ROAD_UNITS, SQUEEZE_MIN_PX, STAY_MIN_UNITS, YEAR_GAP_PX, barScale, barTicks, blockUnits, dayAt, discAt, groupSpans, labelledTicks, squeezed, unitsAt } from '../../src/timebar/barScale';
import { HOME_PANES, STANDARD_PANES } from '../stage/support/standardPanes';
import { STRIP_NARROW_BELOW_PX } from '../stage/support/stripSizes';
import { readBytes } from '../support/readBytes';

const bar = JSON.parse(new TextDecoder().decode(readBytes('content/figures/su-shi/itinerary.bar.json'))) as ItineraryBar;
/** 时间轴的样式表，去掉注释。 */
const SHEET = new TextDecoder().decode(readBytes('src/styles/timebar.css')).replace(/\/\*[\s\S]*?\*\//g, '');
/** 样式表里一条规则的那几行（选择器要一字不差）。 */
const ruleOf = (selector: string): string => {
  const at = SHEET.split('}').find((rule) => rule.split('{')[0].trim() === selector);
  if (at === undefined) throw new Error(`timebar.css 里没有 ${selector} 这一条`);
  return at.split('{')[1];
};
/** 一条规则里一样东西写的是几像素（rem 照 16 像素算）。 */
const pxOf = (selector: string, property: string): number[] => {
  const written = new RegExp(`(?:^|;|\\s)${property}:\\s*([^;]+);`).exec(ruleOf(selector))?.[1];
  if (written === undefined) throw new Error(`${selector} 里没有写 ${property}`);
  return written.trim().split(/\s+/).map((part) => (part.endsWith('rem') ? parseFloat(part) * 16 : parseFloat(part)));
};
/** 能按的那一条往左右各探出去多少（样式表里是负的 margin）；画出来的那一截两头各往里收多少。 */
const TRACK_OUT_PX = -pxOf('.bar-track', 'margin')[1];
const AXIS_IN_PX = pxOf('.bar-axis', 'left')[0];
const scale = barScale(bar);

/**
 * 这种沙盘栏上轴多宽（像素）：左右排的版面上（窗口够 960 宽、横着）栏连着一像素的边线，里面少 1，沙盘在上的排法里栏和窗口一样宽；
 * 左右垫的空宽的栏各 12、窄的栏各 10。
 */
const trackOf = (pane: { window: { width: number; height: number }; size: { width: number } }): number =>
  pane.size.width - (pane.window.width >= 960 && pane.window.width > pane.window.height ? 1 : 0) - 2 * (pane.size.width >= STRIP_NARROW_BELOW_PX ? 12 : 10) + 2 * TRACK_OUT_PX - 2 * AXIS_IN_PX;
/** 量过的每一种摆全程沙盘的栏（人物页的四种，首页另外的两种），和它们的轴宽。 */
const PANES = [...STANDARD_PANES, ...HOME_PANES.filter((pane) => !STANDARD_PANES.includes(pane))].map((pane) => ({ name: pane.name, window: pane.window, track: trackOf(pane) }));
const NARROWEST = Math.min(...PANES.map((pane) => pane.track));

describe('时间轴的刻度', () => {
  it('一趟路 5 个单位；一站住下来的年月至少 3 个；别的至少 1 个', () => {
    expect(ROAD_UNITS).toBe(5);
    expect(STAY_MIN_UNITS).toBe(3);
    expect(OTHER_MIN_UNITS).toBe(1);
    // 路：不管走了几天
    for (const days of [5, 40, 400]) expect(blockUnits('road', days)).toBe(5);
    // 一站住下来的年月：两年多以内都是 3，再长是年数开方的两倍
    expect(blockUnits('stop', 100)).toBe(3);
    expect(blockUnits('stop', 365.25 * 2)).toBe(3);
    expect(blockUnits('stop', 365.25 * 4)).toBeCloseTo(4, 10);
    // 别的：不到半年是 1，再长是年数开方的一倍半
    expect(blockUnits('quiet', 30)).toBe(1);
    expect(blockUnits('off', 30)).toBe(1);
    expect(blockUnits('quiet', 365.25 * 4)).toBeCloseTo(3, 10);
    expect(blockUnits('off', 365.25 * 16)).toBeCloseTo(6, 10);
    // 真的那一份里每一格都照这个算，一格接着一格
    let from = 0;
    let u = 0;
    scale.blocks.forEach((block, i) => {
      const stretch = bar.stretches[i];
      expect([block.id, block.look, block.from, block.until, block.u0], block.id).toEqual([stretch.id, stretch.look, from, stretch.until, u]);
      expect(block.u1 - block.u0, block.id).toBeCloseTo(blockUnits(stretch.look, stretch.until - from), 10);
      expect(block.u1 - block.u0, block.id).toBeGreaterThanOrEqual(stretch.look === 'road' ? 5 : stretch.look === 'stop' ? 3 : 1);
      from = stretch.until;
      u = block.u1;
    });
    expect(scale.total).toBe(u);
    expect(scale.lastDay).toBe(from);
  });

  it('天数换成位置、位置换回天数：来回不走样，越晚越靠右', () => {
    let last = -1;
    for (let day = 0; day <= scale.lastDay; day += 7.3) {
      const u = unitsAt(scale, day);
      expect(u, `第 ${day} 天`).toBeGreaterThan(last);
      expect(dayAt(scale, u), `第 ${day} 天`).toBeCloseTo(day, 6);
      last = u;
    }
    for (let u = 0; u <= scale.total; u += 0.37) expect(unitsAt(scale, dayAt(scale, u)), `第 ${u} 个单位`).toBeCloseTo(u, 9);
    // 每一格的两头正好对上
    for (const block of scale.blocks) {
      expect(unitsAt(scale, block.from), block.id).toBeCloseTo(block.u0, 9);
      expect(dayAt(scale, block.u0), block.id).toBeCloseTo(block.from, 6);
    }
    // 出了两头的算两头
    expect(unitsAt(scale, -5)).toBe(0);
    expect(unitsAt(scale, scale.lastDay + 5)).toBe(scale.total);
    expect(dayAt(scale, -1)).toBe(0);
    expect(dayAt(scale, scale.total + 1)).toBe(scale.lastDay);
  });

  it('一段里面是匀的；一段路里面，各程之间是匀的', () => {
    for (const block of scale.blocks) {
      const span = block.until - block.from;
      for (const share of [0.1, 0.25, 0.5, 0.8]) {
        expect(unitsAt(scale, block.from + span * share), `${block.id} 的 ${share}`).toBeCloseTo(block.u0 + (block.u1 - block.u0) * share, 9);
      }
      // 路上有日子的各处之间：过了这一程几成的日子，就在这一程几成的地方
      const legs = bar.stretches[block.index].legs;
      if (!legs) continue;
      const days = [block.from, ...legs.map(([, day]) => day), block.until];
      for (let i = 1; i < days.length; i++) {
        const [a, b] = [days[i - 1], days[i]];
        expect(b, block.id).toBeGreaterThan(a);
        expect(unitsAt(scale, (a + b) / 2), `${block.id} 的第 ${i} 程`).toBeCloseTo((unitsAt(scale, a) + unitsAt(scale, b)) / 2, 9);
      }
    }
  });

  it('真的那一份：最窄的栏上一趟路不少于 18 像素、一站住下来的年月不少于 10 像素（一共多少单位、各种栏上的数印出来）', () => {
    // 一共多少单位是数据定的：每一格的单位加起来
    expect(scale.total).toBeCloseTo(scale.blocks.reduce((sum, block) => sum + (block.u1 - block.u0), 0), 9);
    // 最窄的是横着拿的平板上首页的那一栏：栏里面 552，减左右垫的空各 10 是 532，轴画出来的那一截再短 6（两头各让出半个圆钮，
    // 其中各 7 像素是往垫的空里探出去的）
    expect(NARROWEST).toBe(532 - 2 * AXIS_IN_PX + 2 * TRACK_OUT_PX);
    expect(NARROWEST).toBe(526);
    const px = NARROWEST / scale.total;
    const road = Math.min(...scale.blocks.filter((b) => b.look === 'road').map((b) => (b.u1 - b.u0) * px));
    const stay = Math.min(...scale.blocks.filter((b) => b.look === 'stop').map((b) => (b.u1 - b.u0) * px));
    expect(road).toBeGreaterThanOrEqual(18);
    expect(stay).toBeGreaterThanOrEqual(10);
    console.log(
      [`一共 ${scale.total.toFixed(1)} 个单位。各种栏上的轴：`, ...PANES.map((pane) => `  ${pane.name}（窗口 ${pane.window.width} × ${pane.window.height}）轴 ${pane.track} 像素：一趟路 ${((5 * pane.track) / scale.total).toFixed(1)}，一站最窄的住处 ${((3 * pane.track) / scale.total).toFixed(1)}，不到 4 像素宽的格子 ${scale.blocks.filter((b) => ((b.u1 - b.u0) * pane.track) / scale.total < 4).length} 个`)].join('\n'),
    );
  });

  it('一站的圆点正对着这一站那一段的中间；圆点旁边不写这一站的年份，时间轴用的那一份里也不带各站的年份（各种栏上各站的那一段多宽印出来）', () => {
    const spans = groupSpans(scale);
    expect(spans.length).toBeGreaterThan(0);
    expect(DISC_PX).toBe(20);
    // 行迹里不带各站的年份：八站的哪一种栏上也放不全，只写得下的几个像是散落的数字；目录里每一站已经有它的年份
    expect(bar).not.toHaveProperty('stopYears');
    const lines: string[] = [];
    for (const pane of PANES) {
      const px = pane.track / scale.total;
      for (const span of spans) expect(discAt(span, px), `${pane.name} ${span.stop}`).toBeCloseTo(((span.u0 + span.u1) / 2) * px, 9);
      lines.push(`  ${pane.name}（轴 ${pane.track} 像素）：${spans.map((span) => `${span.stop} ${((span.u1 - span.u0) * px).toFixed(0)}`).join('，')}`);
    }
    console.log(['各种栏上各站讲的那几年在轴上多宽（像素）：', ...lines].join('\n'));
    // 这个函数只交回一个数（圆点的中心），没有“年份摆在哪”
    expect(typeof discAt({ u0: 0, u1: 10 }, 3)).toBe('number');
    expect(discAt({ u0: 0, u1: 10 }, 3)).toBe(15);
  });

  it('每十年一道的刻度一个比一个靠右；年份两个之间不到 40 像素的不写', () => {
    const ticks = barTicks(bar, scale);
    // 最前面一道是行迹里头一个有正月初一的年份，后面是每一个整十的年份，一个不少
    const dated = bar.years.filter((row) => row[2] !== null).map((row) => row[0]);
    expect(ticks.map((tick) => tick.year)).toEqual([dated[0], ...dated.slice(1).filter((year) => year % 10 === 0)]);
    expect(ticks[0].year).toBe(1037);
    for (let i = 1; i < ticks.length; i++) expect(ticks[i].u, String(ticks[i].year)).toBeGreaterThan(ticks[i - 1].u);
    // 刻度就在那一年正月初一的地方；它们之间不一样远（轴不是匀的）
    for (const tick of ticks) expect(dayAt(scale, tick.u), String(tick.year)).toBeCloseTo(bar.years.find((row) => row[0] === tick.year)![2] as number, 6);
    const gaps = ticks.slice(1).map((tick, i) => tick.u - ticks[i].u);
    expect(Math.max(...gaps) / Math.min(...gaps.slice(1))).toBeGreaterThan(1.5);
    // 写出来的年份两个之间不少于 40 像素；没写的那一个，离上一个写了的不到 40 像素
    expect(YEAR_GAP_PX).toBe(40);
    for (const pane of PANES) {
      const px = pane.track / scale.total;
      const shown = labelledTicks(ticks, px);
      expect(shown[0], pane.name).toBe(ticks[0]);
      for (let i = 1; i < shown.length; i++) expect((shown[i].u - shown[i - 1].u) * px, `${pane.name} ${shown[i].year}`).toBeGreaterThanOrEqual(40);
      for (const tick of ticks.filter((t) => !shown.includes(t))) {
        const before = [...shown].reverse().find((s) => s.u < tick.u)!;
        expect((tick.u - before.u) * px, `${pane.name} ${tick.year}`).toBeLessThan(40);
      }
    }
    // 编的一条：隔 39.9 像素的不写，隔 40 的写
    const made = [0, 39.9, 80, 119, 121].map((u, i) => ({ year: 1000 + i, u }));
    expect(labelledTicks(made, 1).map((tick) => tick.year)).toEqual([1000, 1002, 1004]);
  });

  it('说这条轴不匀的记号：住下来的格子够 10 像素宽的都有两道斜线，路上的、没有他的格子没有；不到 10 像素的不画——两道斜线不顶着格子的边', () => {
    expect(SQUEEZE_MIN_PX).toBe(10);
    // 两道斜线一共占多宽：从 TimeBar.tsx 画它们的那一句里读（左边那一道从正中往左几像素起，右边那一道到正中往右几像素），加上线的粗细
    const drawn = /M\$\{mid - ([\d.]+)\} \$\{BLOCK_BOTTOM - [\d.]+\}l([\d.]+) -[\d.]+M\$\{mid \+ ([\d.]+)\} \$\{BLOCK_BOTTOM - [\d.]+\}l([\d.]+) -[\d.]+/.exec(new TextDecoder().decode(readBytes('src/timebar/TimeBar.tsx')));
    expect(drawn, 'TimeBar.tsx 里画两道斜线的那一句').not.toBeNull();
    const [left, , rightFrom, rightRun] = (drawn as RegExpExecArray).slice(1).map(Number);
    const strokes = left + rightFrom + rightRun + parseFloat(/stroke-width:\s*([\d.]+)/.exec(ruleOf('.bar-squeeze'))?.[1] ?? 'NaN');
    expect(strokes).toBe(7);
    // 格子左右各一像素的边：最窄的带斜线的格子里，斜线两边还有空（9 像素宽的格子里正顶着两条边）
    expect(SQUEEZE_MIN_PX - 2).toBeGreaterThan(strokes);
    for (const pane of PANES) {
      const px = pane.track / scale.total;
      for (const block of scale.blocks) {
        const width = (block.u1 - block.u0) * px;
        const stay = block.look === 'stop' || block.look === 'quiet';
        expect(squeezed(block, px), `${pane.name} ${block.id}（${block.look}，${width.toFixed(1)} 像素）`).toBe(stay && width >= 10);
      }
      // 每一站住下来的格子在哪一种栏上都够宽：都有这两道
      expect(scale.blocks.filter((b) => b.look === 'stop').every((b) => squeezed(b, px)), pane.name).toBe(true);
    }
    // 一站讲的那几年：一站一段，照 figure 里各站的先后，段和段不叠
    const spans = groupSpans(scale);
    const groups = [...new Set(bar.stretches.flatMap((s) => (s.group ? [s.group] : [])))];
    expect(spans.map((span) => span.stop)).toEqual(groups);
    for (let i = 1; i < spans.length; i++) expect(spans[i].u0, spans[i].stop).toBeGreaterThanOrEqual(spans[i - 1].u1);
    for (const span of spans) {
      const inGroup = scale.blocks.filter((b) => b.group === span.stop);
      expect([span.u0, span.u1], span.stop).toEqual([inGroup[0].u0, inGroup[inGroup.length - 1].u1]);
    }
  });

  it('样式表里的那几个数对得上：圆钮到了两头整个在这一条里面，不压着年份的数字；焦点框围着整条轴，年份在它里面', () => {
    const [knob] = pxOf('.bar-thumb', 'width');
    const [knobTop] = pxOf('.bar-thumb', 'top');
    const [yearTop] = pxOf('.bar-year', 'top');
    // 圆钮 20 像素；画出来的那一截两头各往里收半个圆钮：圆钮的正中到了头，整个圆钮还在能按的那一条里面
    expect(knob).toBe(20);
    expect(pxOf('.bar-thumb', 'margin-left')[0]).toBe(-knob / 2);
    expect(AXIS_IN_PX).toBe(knob / 2);
    expect(pxOf('.bar-axis', 'right')[0]).toBe(AXIS_IN_PX);
    // 能按的那一条往这一条左右垫的空里探出去的，比垫的空少（宽的栏垫 12、窄的垫 10）：圆钮连外面那一圈细线（1.5 像素）都在这一条里面
    const halo = 1.5;
    expect(ruleOf('.bar-thumb')).toContain(`box-shadow: 0 0 0 ${halo}px`);
    expect(TRACK_OUT_PX).toBeGreaterThan(0);
    expect(pxOf('.stage-pane:not(.is-wide) .bar', 'padding-left')[0] - TRACK_OUT_PX).toBeGreaterThanOrEqual(halo);
    expect(pxOf('.stage-pane:not(.is-wide) .bar', 'padding-right')[0] - TRACK_OUT_PX).toBeGreaterThanOrEqual(halo);
    // 两头有“上一段”“下一段”的时候不往外探
    expect(pxOf('.bar.is-calm .bar-track', 'margin')).toEqual([0]);
    // 所以画出来的那一截比“栏里面的宽减左右垫的空”只短 6 像素：最窄的栏上一趟路还够 18 像素（上面那一项查的就是这个宽）
    expect(2 * AXIS_IN_PX - 2 * TRACK_OUT_PX).toBe(6);
    // 圆钮的下边不到年份那一行的上边以下 1 像素（年份的数字在它那一行里还要低两像素）；原来是 3.5 像素，压着数字
    expect(knobTop + knob - yearTop).toBeLessThanOrEqual(1);
    // 年份那一行 14 像素高（字号 14、行高 1）：它的下边不出焦点框里边的下边半个像素以外
    const track = pxOf('.bar-track', 'height')[0];
    expect(track).toBe(48);
    expect(ruleOf('.bar-year')).toMatch(/line-height:\s*1;/);
    const ring = pxOf('.bar-track:focus-visible::after', 'inset');
    const [ringTop, ringSide, ringBottom] = ring;
    const [border] = pxOf('.bar-track:focus-visible::after', 'border');
    expect(border).toBe(2);
    expect(ringTop).toBeLessThan(0);
    expect(ringSide).toBeLessThan(0);
    // 那一圈里边的下边：轴的下边再往下（−inset）减去边线的宽
    const innerBottom = track - ringBottom - border;
    expect(innerBottom).toBeGreaterThanOrEqual(track);
    expect(yearTop + 14 - innerBottom).toBeLessThanOrEqual(0.5);
    // 这一圈的下边探出这一条的下边不到题记上边垫的空（这一条下边垫 2 像素）
    expect(-ringBottom).toBeLessThanOrEqual(4);
    // 栏宽的时候这一圈的下边再低 2 像素（年份的数字离它远一点）。题记上边垫的空从 stage.css 里读：窄的栏 5 像素，宽的栏 8 像素；
    // 这一圈探进那块空里以后，离题记里的字（垫的空的下边）窄的栏上还有 3 像素，宽的栏上还有 4 像素——再低就挨着题记里的字了
    const [wideBottom] = pxOf('.stage-pane.is-wide .bar-track:focus-visible::after', 'bottom');
    expect(wideBottom).toBe(ringBottom - 2);
    const stageSheet = new TextDecoder().decode(readBytes('src/styles/stage.css')).replace(/\/\*[\s\S]*?\*\//g, '');
    const captionPad = (selector: string): number => {
      const rule = stageSheet.split('}').find((item) => item.split('{')[0].trim() === selector);
      const written = /(?:^|;|\s)padding:\s*([^;\s]+)/.exec(rule?.split('{')[1] ?? '')?.[1] ?? '';
      return written.endsWith('rem') ? parseFloat(written) * 16 : parseFloat(written);
    };
    const bandPad = pxOf('.bar', 'padding')[2];
    expect(bandPad).toBe(2);
    expect(captionPad('.stage-caption')).toBe(5);
    expect(captionPad('.stage-pane.is-wide .stage-caption')).toBe(8);
    expect(captionPad('.stage-caption') - (-ringBottom - bandPad)).toBeGreaterThanOrEqual(3);
    expect(captionPad('.stage-pane.is-wide .stage-caption') - (-wideBottom - bandPad)).toBeGreaterThanOrEqual(4);
    // 宽的栏上年份那一行的下边在这一圈里边的下边以上 1 像素半（窄的栏上是那半个像素以外）
    expect(yearTop + 14 - (track - wideBottom - border)).toBeLessThanOrEqual(-1);
    // 轴自己身上没有往里贴的一圈、往里收的外框线（它们原来从年份的数字上穿过去）；沙盘栏里别处贴的那一圈白也去掉
    expect(ruleOf('.bar-track:focus-visible')).not.toMatch(/inset|outline-offset/);
    expect(ruleOf('.bar-track:focus-visible')).toMatch(/box-shadow:\s*none;/);
    // 圆点旁边不写各站的年份：没有那一条样式了
    expect(SHEET).not.toContain('.bar-years');
  });
});
