// 时间轴的刻度（src/timebar/barScale.ts）：哪一天落在轴的哪里。在 Node 里跑，照 content/ 里真的行迹（时间轴用的那一份）查。
// 栏多宽、轴多宽是 tests/stage/support/standardPanes.ts 里量出来的那几种沙盘栏：轴 = 栏里面的宽 − 左右垫的空
//（栏够 584 像素宽的左右各 12，不到的各 10；见 src/styles/timebar.css 的 .bar）。

import { describe, expect, it } from 'vitest';
import type { ItineraryBar } from '../../src/domain/itinerary';
import { DISC_PX, OTHER_MIN_UNITS, ROAD_UNITS, SQUEEZE_MIN_PX, STAY_MIN_UNITS, YEARS_EDGE_PX, YEARS_GAP_PX, YEARS_GLYPH_PX, YEAR_GAP_PX, barScale, barTicks, blockUnits, dayAt, discAt, groupSpans, labelledTicks, squeezed, unitsAt, yearsShort } from '../../src/timebar/barScale';
import { HOME_PANES, STANDARD_PANES } from '../stage/support/standardPanes';
import { STRIP_NARROW_BELOW_PX } from '../stage/support/stripSizes';
import { readBytes } from '../support/readBytes';

const bar = JSON.parse(new TextDecoder().decode(readBytes('content/figures/su-shi/itinerary.bar.json'))) as ItineraryBar;
const scale = barScale(bar);

/**
 * 这种沙盘栏上轴多宽（像素）：左右排的版面上（窗口够 960 宽、横着）栏连着一像素的边线，里面少 1，沙盘在上的排法里栏和窗口一样宽；
 * 左右垫的空宽的栏各 12、窄的栏各 10。
 */
const trackOf = (pane: { window: { width: number; height: number }; size: { width: number } }): number =>
  pane.size.width - (pane.window.width >= 960 && pane.window.width > pane.window.height ? 1 : 0) - 2 * (pane.size.width >= STRIP_NARROW_BELOW_PX ? 12 : 10);
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
    // 最窄的是横着拿的平板上首页的那一栏
    expect(NARROWEST).toBe(532);
    const px = NARROWEST / scale.total;
    const road = Math.min(...scale.blocks.filter((b) => b.look === 'road').map((b) => (b.u1 - b.u0) * px));
    const stay = Math.min(...scale.blocks.filter((b) => b.look === 'stop').map((b) => (b.u1 - b.u0) * px));
    expect(road).toBeGreaterThanOrEqual(18);
    expect(stay).toBeGreaterThanOrEqual(10);
    console.log(
      [`一共 ${scale.total.toFixed(1)} 个单位。各种栏上的轴：`, ...PANES.map((pane) => `  ${pane.name}（窗口 ${pane.window.width} × ${pane.window.height}）轴 ${pane.track} 像素：一趟路 ${((5 * pane.track) / scale.total).toFixed(1)}，一站最窄的住处 ${((3 * pane.track) / scale.total).toFixed(1)}，不到 4 像素宽的格子 ${scale.blocks.filter((b) => ((b.u1 - b.u0) * pane.track) / scale.total < 4).length} 个`)].join('\n'),
    );
  });

  it('一站的年份写在圆点旁边：照这一站已发布的年份写（同一个世纪的后一个只写两位），那一站的那一段放得下圆点和它才写；写了的，两样合起来对着那一段的中间（各种栏上写了哪几站印出来）', () => {
    expect(yearsShort('1080–1084')).toBe('1080–84');
    expect(yearsShort('1079')).toBe('1079');
    expect(yearsShort('1094–1100')).toBe('1094–1100');
    expect(yearsShort('1099–1101')).toBe('1099–1101');
    const spans = groupSpans(scale);
    // 行迹里记着的就是各站已发布的年份，时间轴上有哪几站就有哪几站
    expect(Object.keys(bar.stopYears)).toEqual(spans.map((span) => span.stop));
    const lines: string[] = [];
    for (const pane of PANES) {
      const px = pane.track / scale.total;
      const written: string[] = [];
      spans.forEach((span) => {
        const text = yearsShort(bar.stopYears[span.stop]);
        const wide = (span.u1 - span.u0) * px;
        const mid = ((span.u0 + span.u1) / 2) * px;
        const at = discAt(span, px, text);
        const pair = DISC_PX + YEARS_GAP_PX + [...text].length * YEARS_GLYPH_PX;
        if (wide >= pair + 2 * YEARS_EDGE_PX) {
          // 放得下：圆点在左、年份在右，合起来对着中间，两头都不出这一段
          expect(at.years, `${pane.name} ${span.stop}`).not.toBeNull();
          expect(at.disc - DISC_PX / 2, `${pane.name} ${span.stop}`).toBeCloseTo(mid - pair / 2, 6);
          expect(at.years as number, `${pane.name} ${span.stop}`).toBeCloseTo(at.disc + DISC_PX / 2 + YEARS_GAP_PX, 6);
          expect(at.disc - DISC_PX / 2).toBeGreaterThanOrEqual(span.u0 * px + YEARS_EDGE_PX - 1e-6);
          expect((at.years as number) + [...text].length * YEARS_GLYPH_PX).toBeLessThanOrEqual(span.u1 * px - YEARS_EDGE_PX + 1e-6);
          written.push(`${span.stop} ${text}`);
        } else {
          // 放不下：不写，圆点正对着中间
          expect(at, `${pane.name} ${span.stop}`).toEqual({ disc: mid, years: null });
        }
        // 没有年份可写的（这位人物的资料里没有）：圆点正对着中间
        expect(discAt(span, px, undefined)).toEqual({ disc: mid, years: null });
      });
      lines.push(`  ${pane.name}（轴 ${pane.track} 像素）：${written.length ? written.join('，') : '一站也不写'}`);
    }
    console.log(['各种栏上圆点旁边写了年份的站：', ...lines].join('\n'));
    // 编的一段：正好放得下的写，差一个像素的不写
    const need = DISC_PX + YEARS_GAP_PX + 7 * YEARS_GLYPH_PX + 2 * YEARS_EDGE_PX;
    expect(discAt({ u0: 0, u1: need }, 1, '1080–84').years).not.toBeNull();
    expect(discAt({ u0: 0, u1: need - 1 }, 1, '1080–84').years).toBeNull();
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

  it('说这条轴不匀的记号：住下来的格子够 9 像素宽的都有两道斜线，路上的、没有他的格子没有', () => {
    expect(SQUEEZE_MIN_PX).toBe(9);
    for (const pane of PANES) {
      const px = pane.track / scale.total;
      for (const block of scale.blocks) {
        const width = (block.u1 - block.u0) * px;
        const stay = block.look === 'stop' || block.look === 'quiet';
        expect(squeezed(block, px), `${pane.name} ${block.id}（${block.look}，${width.toFixed(1)} 像素）`).toBe(stay && width >= 9);
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
});
