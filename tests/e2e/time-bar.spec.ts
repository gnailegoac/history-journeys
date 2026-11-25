// 时间轴：人物页和首页的全程沙盘下面、题记上面的那一条（src/timebar/）。到真的页面上看：拖、按、按键的时候圆钮、两行字、
// 给读屏念的那一句、小像怎么跟着走；什么时候叫沙盘换小节；这一条多高；哪些页面上没有它。
// 沙盘用的是替身（?stage=fake），时间轴在替身上要在地址里写 ?bar=第几天 才摆（不写的话别的测试看到的还是原来的页面）；
// 替身不画小像，把最近一次叫它摆在哪记在 data-fake-piece 上，说没说“停着”记在 data-fake-piece-rest 上。
// 每一天该印什么字、小像该在哪，是拿页面用的同一份行迹（content/ 里的 itinerary.bar.json）和同几个函数在这里另算的。
// 等的都是结果（expect.poll），不数画了几帧，不限定多少毫秒以内；按下去以后不马上读一次大小、位置就下结论。

import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { ItineraryBar } from '../../src/domain/itinerary';
import type { Figure } from '../../src/domain/types';
import { barScale, dayAt, unitsAt } from '../../src/timebar/barScale';
import { keyStep, sectionAt, stretchStep } from '../../src/timebar/barState';
import { stretchIndexAt, whereAt } from '../../src/timebar/barWhere';
import { wordsAt, westernAt, yearRowAt } from '../../src/timebar/barWords';
import { namesIn, readBytes } from '../support/readBytes';
import { BAR_BAND_PX, ROUTE_HOME_PANES, ROUTE_PANES } from '../stage/support/standardPanes';
import { fakeRequests, fakeStage, routeOnDisk, sceneOnDisk, stagePane } from './helpers';

const readJson = <T>(path: string): T => JSON.parse(new TextDecoder().decode(readBytes(path))) as T;
/** 头一位有行迹的人物。 */
const FIGURE_ID = namesIn('content/figures').find((name) => !name.includes('.') && namesIn(`content/figures/${name}`).includes('itinerary.bar.json')) as string;
const bar = readJson<ItineraryBar>(`content/figures/${FIGURE_ID}/itinerary.bar.json`);
const figure = readJson<Figure>(`content/figures/${FIGURE_ID}/figure.json`);
const route = routeOnDisk(FIGURE_ID);
if (!route) throw new Error(`${FIGURE_ID} 没有全程沙盘`);
const scale = barScale(bar);
const lastDay = scale.lastDay;
const WHOLE = route.sections[0].heading;
const startOf = (i: number): number => (i === 0 ? 0 : bar.stretches[i - 1].until);
const midOf = (i: number): number => (startOf(i) + bar.stretches[i].until) / 2;
/** 住在一站里的各段（第几段）。 */
const STAYS = bar.stretches.flatMap((stretch, i) => (stretch.look === 'stop' ? [i] : []));
/** 第一行印出来的字：几块连着（块和块之间的空是样式留的，不是字）。 */
const rowOne = (day: number): string => {
  const words = wordsAt(bar, day);
  return `${words.year}${words.age}${words.label}`;
};
const valueNow = (day: number): number => Math.round((unitsAt(scale, day) / scale.total) * 1000);

/** 打开人物页（或者首页），时间轴从第 day 天起；等沙盘的替身摆好、时间轴画出来。 */
async function open(page: Page, day: number, where: 'figure' | 'home' = 'figure'): Promise<void> {
  await page.goto(`/?stage=fake&bar=${day}#/${where === 'home' ? '' : FIGURE_ID}`);
  await expect(stagePane(page)).toHaveAttribute('data-stage-state', 'ready');
  await expect(page.locator('.bar-thumb')).toHaveCount(1);
}

/** 轴在页面上的位置（连着两次量到一样才算数）。 */
async function trackBox(page: Page): Promise<{ left: number; top: number; width: number; height: number }> {
  const read = (): Promise<{ left: number; top: number; width: number; height: number }> =>
    page.locator('.bar-track').evaluate((el) => {
      const box = el.getBoundingClientRect();
      return { left: box.left, top: box.top, width: box.width, height: box.height };
    });
  let last = await read();
  for (let tries = 0; tries < 40; tries++) {
    await page.waitForTimeout(100);
    const now = await read();
    if (now.width > 0 && JSON.stringify(now) === JSON.stringify(last)) return now;
    last = now;
  }
  throw new Error('轴的位置一直在变，量不准');
}
/** 轴上第 day 天在页面上的横坐标（取整到像素的正中），和按在那里页面会算成第几天。 */
function pointOf(box: { left: number; width: number }, day: number): { x: number; day: number } {
  const x = Math.round(box.left + (unitsAt(scale, day) / scale.total) * box.width) + 0.5;
  return { x, day: dayAt(scale, ((x - box.left) / box.width) * scale.total) };
}
const piece = (page: Page): Promise<string | null> => fakeStage(page).getAttribute('data-fake-piece');

test('拖圆钮：第一行、第二行跟着换，给读屏念的那一句也换；沙盘的替身记下小像站在哪', async ({ page }) => {
  await open(page, 0);
  // 一打开：最前一个位置的两行字，小像站在出生的地方；页面没有叫沙盘换过小节
  await expect(page.locator('.bar-when')).toHaveText(rowOne(0));
  await expect(page.locator('.bar-known')).toHaveText(bar.first.says);
  await expect.poll(() => piece(page)).toBe(JSON.stringify(whereAt(bar, 0)));
  expect(await fakeRequests(page)).toEqual([]);

  const box = await trackBox(page);
  const y = box.top + 28;
  // 从圆钮（最左头）按下去，拖到每一站住下来的年月的正中间：手不放，字和小像就跟着换
  await page.mouse.move(box.left + 1, y);
  await page.mouse.down();
  for (const i of STAYS) {
    const to = pointOf(box, midOf(i));
    await page.mouse.move(to.x, y, { steps: 4 });
    const words = wordsAt(bar, to.day);
    expect(stretchIndexAt(bar, to.day), bar.stretches[i].id).toBe(i);
    await expect(page.locator('.bar-when'), bar.stretches[i].id).toHaveText(rowOne(to.day));
    await expect(page.locator('.bar-known'), bar.stretches[i].id).toHaveText(words.says);
    await expect(page.locator('.bar-track'), bar.stretches[i].id).toHaveAttribute('aria-valuetext', words.spoken);
    await expect(page.locator('.bar-track'), bar.stretches[i].id).toHaveAttribute('aria-valuenow', String(valueNow(to.day)));
    await expect.poll(() => piece(page), bar.stretches[i].id).toBe(JSON.stringify(whereAt(bar, to.day)));
    await expect(page.locator('.bar'), bar.stretches[i].id).toHaveAttribute('data-bar-stop', bar.stretches[i].group ?? '');
  }
  // 一路上只叫沙盘换过一次：退到全程（它本来就摆着全程，替身记下的是这一次指令）——还没有放手，不叫它去哪一站的那一节
  const during = await fakeRequests(page);
  expect(during.every((heading) => heading === WHOLE), `手还没放的时候叫沙盘去了：${during.join('、')}`).toBe(true);
  // 放手：叫沙盘换到停下的那一节
  await page.mouse.up();
  const last = STAYS[STAYS.length - 1];
  const wanted = sectionAt(bar, route.sections, midOf(last));
  await expect(stagePane(page)).toHaveAttribute('data-stage-section', wanted);
  expect((await fakeRequests(page)).at(-1)).toBe(wanted);
  // 中间的按钮回的是那一节
  await expect(page.locator('.stage-reset')).toHaveText('回到这一段');
});

test('按在轴上：圆钮到按的地方', async ({ page }) => {
  await open(page, 0);
  const box = await trackBox(page);
  for (const i of [STAYS[Math.floor(STAYS.length / 2)], STAYS[0], STAYS[STAYS.length - 1]]) {
    const to = pointOf(box, midOf(i));
    await page.mouse.click(to.x, box.top + 28);
    await expect(page.locator('.bar-track'), bar.stretches[i].id).toHaveAttribute('aria-valuenow', String(valueNow(to.day)));
    await expect(page.locator('.bar-when'), bar.stretches[i].id).toHaveText(rowOne(to.day));
    // 圆钮画在按的地方（差在一个像素里；这个数只印出来看，判对错的是上面那两样）
    const left = await page.locator('.bar-thumb').evaluate((el) => parseFloat((el as HTMLElement).style.left));
    console.log(`按在轴上第 ${(to.x - box.left).toFixed(1)} 像素的地方（${bar.stretches[i].id}）：圆钮画在第 ${left} 像素`);
    expect(Math.abs(left - (to.x - box.left)), bar.stretches[i].id).toBeLessThan(4);
    // 放了手：叫沙盘换到这一段的那一节
    await expect(stagePane(page), bar.stretches[i].id).toHaveAttribute('data-stage-section', sectionAt(bar, route.sections, to.day));
  }
  // 按在轴的最上边（圆点那一排）、最下边（年份那一排）也算：整行都是能按的地方
  const to = pointOf(box, midOf(STAYS[1]));
  await page.mouse.click(to.x, box.top + 3);
  await expect(page.locator('.bar-track')).toHaveAttribute('aria-valuenow', String(valueNow(to.day)));
  const back = pointOf(box, midOf(STAYS[0]));
  await page.mouse.click(back.x, box.top + box.height - 3);
  await expect(page.locator('.bar-track')).toHaveAttribute('aria-valuenow', String(valueNow(back.day)));
});

test('左右键、翻页键、Home、End', async ({ page }) => {
  // 地址里只能写整数的日子：从头一站住下来的年月里、起头后面的一天起
  const from = Math.ceil(startOf(STAYS[0])) + 1;
  await open(page, from);
  const track = page.locator('.bar-track');
  await track.focus();
  let day = from;
  const press = async (key: string, to: number): Promise<void> => {
    await page.keyboard.press(key);
    day = to;
    await expect(track, `${key} 以后`).toHaveAttribute('aria-valuenow', String(valueNow(day)));
    await expect(track, `${key} 以后`).toHaveAttribute('aria-valuetext', wordsAt(bar, day).spoken);
    await expect(page.locator('.bar-when'), `${key} 以后`).toHaveText(rowOne(day));
  };
  // 右、上：往后走这一段的八分之一；左、下：往前
  await press('ArrowRight', keyStep(bar, day, 1));
  await press('ArrowUp', keyStep(bar, day, 1));
  await press('ArrowLeft', keyStep(bar, day, -1));
  await press('ArrowDown', keyStep(bar, day, -1));
  // 走了两格又退了两格：回到这一段的起头
  expect(day).toBe(startOf(STAYS[0]));
  // 翻页键：下一段、上一段的起头
  await press('PageUp', stretchStep(bar, day, 1));
  expect(day).toBe(bar.stretches[STAYS[0]].until);
  await press('PageUp', stretchStep(bar, day, 1));
  expect(day).toBe(bar.stretches[STAYS[0] + 1].until);
  await press('PageDown', stretchStep(bar, day, -1));
  await press('PageDown', stretchStep(bar, day, -1));
  expect(day).toBe(startOf(STAYS[0]));
  await press('End', lastDay);
  await press('ArrowRight', lastDay);
  await press('Home', 0);
  await press('ArrowLeft', 0);
  // 焦点还在轴上；页面没有跟着键滚动
  await expect(track).toBeFocused();
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
});

test('按 Home、按 End：两行字是最前、最后一个位置的那两句（“生在眉州”“在常州去世”），小像站在眉州、站在常州那条线上', async ({ page }) => {
  await open(page, midOf(STAYS[2]) | 0);
  const track = page.locator('.bar-track');
  await track.focus();
  await page.keyboard.press('End');
  const last = wordsAt(bar, lastDay);
  expect([last.label, last.says]).toEqual([bar.last.label, bar.last.says]);
  await expect(page.locator('.bar-when')).toHaveText(rowOne(lastDay));
  await expect(page.locator('.bar-when .bar-label')).toHaveText(bar.last.label);
  await expect(page.locator('.bar-known')).toHaveText(bar.last.says);
  await expect(track).toHaveAttribute('aria-valuenow', '1000');
  // 最后一段他在哪（一条线上没有立名字的一处），小像就站在哪
  const end = whereAt(bar, lastDay);
  expect(end).not.toBeNull();
  await expect.poll(() => piece(page)).toBe(JSON.stringify(end));
  await page.keyboard.press('Home');
  await expect(page.locator('.bar-when')).toHaveText(rowOne(0));
  await expect(page.locator('.bar-when .bar-label')).toHaveText(bar.first.label);
  await expect(page.locator('.bar-known')).toHaveText(bar.first.says);
  await expect(track).toHaveAttribute('aria-valuenow', '0');
  await expect.poll(() => piece(page)).toBe(JSON.stringify(whereAt(bar, 0)));
  // 头一个位置的括号里是那一天公历的年和月（他生在农历年末，公历已经是下一年）
  const [year, name] = yearRowAt(bar, 0);
  const west = westernAt(bar.day0, 0);
  expect(west.year).toBe(year + 1);
  await expect(page.locator('.bar-when span').first()).toHaveText(`${name}（${west.year}年${west.month}月）`);
});

test('按住右键一路走到后面的站：沙盘的替身先被叫退到全程，停手以后才被叫换到停下的那一节', async ({ page }) => {
  // 从一站住下来的年月的最后一格起（这一站后面还有别的站）
  const stay = STAYS[1];
  const here = sectionAt(bar, route.sections, midOf(stay));
  const from = keyStep(bar, bar.stretches[stay].until, -1);
  await open(page, Math.ceil(from));
  const box = await trackBox(page);
  // 先按在这一站的年月里：沙盘换到这一站的那一节
  const at = pointOf(box, midOf(stay));
  await page.mouse.click(at.x, box.top + 28);
  await expect(stagePane(page)).toHaveAttribute('data-stage-section', here);
  const before = await fakeRequests(page);
  expect(before.at(-1)).toBe(here);

  const track = page.locator('.bar-track');
  await track.focus();
  // 按住右键：一下接一下，走过后面的好几站
  const target = startOf(STAYS[STAYS.length - 2]);
  let day = at.day;
  let presses = 0;
  while (day < target) {
    await page.keyboard.down('ArrowRight');
    day = keyStep(bar, day, 1);
    presses++;
  }
  await page.keyboard.up('ArrowRight');
  await expect(track).toHaveAttribute('aria-valuenow', String(valueNow(day)));
  // 走出这一站的年月的头一下，沙盘马上被叫退到全程：这一节后面紧跟着的指令就是全程
  const wanted = sectionAt(bar, route.sections, day);
  expect(wanted).not.toBe(here);
  await expect.poll(async () => (await fakeRequests(page)).slice(before.length)[0]).toBe(WHOLE);
  // 停手以后才换到停下的那一节
  await expect(stagePane(page)).toHaveAttribute('data-stage-section', wanted);
  const after = (await fakeRequests(page)).slice(before.length);
  expect(after.at(-1)).toBe(wanted);
  // 按得够密的时候一路上只有这两次；机器忙、两下之间隔了三百多毫秒的话中间会多出几次（只印出来看）
  console.log(`按了 ${presses} 下右键，沙盘被叫了 ${after.length} 次：${after.join(' → ')}`);
  expect(after.length).toBeGreaterThanOrEqual(2);
  // 小像在停下的地方，说的是“停着”
  await expect.poll(() => piece(page)).toBe(JSON.stringify(whereAt(bar, day)));
});

test('停在路上：拖着的时候不说“停着”，放了手才说（那时题签才让开他）', async ({ page }) => {
  const road = bar.stretches.findIndex((stretch) => stretch.look === 'road');
  await open(page, 0);
  const box = await trackBox(page);
  const y = box.top + 28;
  const to = pointOf(box, midOf(road));
  expect(whereAt(bar, to.day)?.on).toBe('road');
  await page.mouse.move(box.left + 1, y);
  await page.mouse.down();
  await page.mouse.move(to.x, y, { steps: 5 });
  await expect.poll(() => piece(page)).toBe(JSON.stringify(whereAt(bar, to.day)));
  await expect(fakeStage(page)).toHaveAttribute('data-fake-piece-rest', 'false');
  await expect(page.locator('.bar-known')).toHaveText(bar.stretches[road].says);
  await page.mouse.up();
  await expect(fakeStage(page)).toHaveAttribute('data-fake-piece-rest', 'true');
  expect(await piece(page)).toBe(JSON.stringify(whereAt(bar, to.day)));
});

test('按在第一行、第二行上：沙盘不转', async ({ page }) => {
  await open(page, midOf(STAYS[0]) | 0);
  // 这一条整条接手指：第一行、第二行、轴旁边的空上，最上面的那样东西都在这一条里面，不是沙盘
  const tops = await page.evaluate(() => {
    const band = document.querySelector('.stage-bar') as HTMLElement;
    const box = band.getBoundingClientRect();
    const inBand = (x: number, y: number): boolean => !!document.elementFromPoint(x, y)?.closest('.stage-bar');
    const points: [string, number, number][] = [];
    for (const selector of ['.bar-when', '.bar-known']) {
      const row = document.querySelector(selector)!.getBoundingClientRect();
      points.push([selector, row.left + 4, row.top + row.height / 2], [selector, row.right - 4, row.top + row.height / 2]);
    }
    points.push(['这一条的左上角', box.left + 2, box.top + 2], ['这一条的右下角', box.right - 2, box.bottom - 2]);
    return points.map(([what, x, y]) => ({ what, hit: inBand(x, y) }));
  });
  for (const { what, hit } of tops) expect(hit, what).toBe(true);
  // 按在第一行上拖一截：沙盘的替身没有被叫去换小节，小像也没有挪，时间轴的日子没有变
  const before = { requests: await fakeRequests(page), piece: await piece(page), now: await page.locator('.bar-track').getAttribute('aria-valuenow') };
  const row = await page.locator('.bar-when').boundingBox();
  if (!row) throw new Error('第一行没有位置');
  await page.mouse.move(row.x + 8, row.y + row.height / 2);
  await page.mouse.down();
  await page.mouse.move(row.x + 120, row.y - 200, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(500);
  expect({ requests: await fakeRequests(page), piece: await piece(page), now: await page.locator('.bar-track').getAttribute('aria-valuenow') }).toEqual(before);
  await expect(fakeStage(page)).not.toHaveAttribute('data-fake-moved', 'true');
});

test('时间轴那一条 96 像素高；那一段程序到之前和到之后，沙盘四边留的空一样', async ({ page }) => {
  // 把那一段程序拦住，等这里放行
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let asked = 0;
  await page.route(/\/assets\/TimeBar-[^/]*\.js$/, async (routed) => {
    asked++;
    await gate;
    await routed.continue();
  });
  await page.goto(`/?stage=fake&bar=0#/${FIGURE_ID}`);
  await expect(stagePane(page)).toHaveAttribute('data-stage-state', 'ready');
  await expect.poll(() => asked).toBe(1);
  const band = page.locator('.stage-foot .stage-bar');
  await expect(band).toHaveCount(1);
  const height = (): Promise<number> => band.evaluate((el) => el.getBoundingClientRect().height);
  const insets = (): Promise<string | null> => fakeStage(page).getAttribute('data-fake-insets');
  // 还没到：这一条已经是 96 像素高，里面是空的；沙盘四边留的空报过了
  await expect.poll(height).toBe(BAR_BAND_PX);
  await expect(band.locator('.bar')).toHaveCount(0);
  const figurePane = ROUTE_PANES[0];
  await expect.poll(insets).toBe(`${figurePane.insets.top} 0 ${figurePane.insets.bottom} 0`);
  const resizes = await fakeStage(page).getAttribute('data-fake-resizes');
  // 到了：里面有了东西；这一条还是那么高，沙盘没有再被告知留多少空、大小变了
  release();
  await expect(band.locator('.bar-thumb')).toHaveCount(1);
  await expect(page.locator('.bar-when')).toHaveText(rowOne(0));
  await expect.poll(height).toBe(BAR_BAND_PX);
  await page.waitForTimeout(500);
  expect(await insets()).toBe(`${figurePane.insets.top} 0 ${figurePane.insets.bottom} 0`);
  expect(await fakeStage(page).getAttribute('data-fake-resizes')).toBe(resizes);
});

test('每一站的页面上——有自己的沙盘的、还没有自己的沙盘（摆着全程沙盘）的——都没有时间轴的那一条，也不去取那一段程序；回到人物页才取', async ({ page }) => {
  test.setTimeout(180_000);
  const asked: string[] = [];
  page.on('request', (request) => {
    if (/\/assets\/TimeBar-[^/]*\.js$/.test(request.url())) asked.push(request.url());
  });
  const own = figure.stops.filter((stop) => sceneOnDisk(FIGURE_ID, stop.id) !== null).map((stop) => stop.id);
  const bare = figure.stops.filter((stop) => sceneOnDisk(FIGURE_ID, stop.id) === null).map((stop) => stop.id);
  expect(own.length).toBeGreaterThan(0);
  expect(bare.length).toBeGreaterThan(0);
  for (const stopId of figure.stops.map((stop) => stop.id)) {
    // 每一站都是从头打开的一页（地址里还写着从哪一天起：有这一条的话它就会画出来）
    await page.goto('about:blank');
    await page.goto(`/?stage=fake&bar=0#/${FIGURE_ID}/${stopId}`);
    await expect(stagePane(page), stopId).toHaveAttribute('data-stage-state', 'ready');
    if (bare.includes(stopId)) await expect(stagePane(page), stopId).toHaveAttribute('data-stage-level', 'route');
    else await expect(stagePane(page), stopId).not.toHaveAttribute('data-stage-level', 'route');
    await expect(page.locator('.stage-foot'), stopId).toHaveCount(1);
    await page.waitForTimeout(400);
    await expect(page.locator('.stage-bar'), stopId).toHaveCount(0);
    await expect(page.locator('.bar'), stopId).toHaveCount(0);
    expect(await stagePane(page).getAttribute('data-stage-bar'), stopId).toBeNull();
    expect(await fakeStage(page).getAttribute('data-fake-piece'), stopId).toBeNull();
    expect(asked, `${stopId} 的页面上去取了时间轴的那一段程序`).toEqual([]);
  }
  // 从一站的页面回到人物页（点目录上面的人物名字那一行不一定有：直接换地址）：这才取，取一次
  await page.goto(`/?stage=fake&bar=0#/${FIGURE_ID}`);
  await expect(page.locator('.bar-thumb')).toHaveCount(1);
  expect(asked).toHaveLength(1);
  await expect(stagePane(page)).toHaveAttribute('data-stage-bar', '');
});

test('农历年末、公历已经是下一年的日子：第一行括号里写公历的年和月；有这样的日子的每一段各取一天，人物页和首页的第一行在最窄的几种栏上都不出格、不截', async ({ page }) => {
  test.setTimeout(600_000);
  // 每一段里这样的日子：取年名和岁数印出来最长的那一个农历年末的一天
  const days: { id: string; day: number }[] = [];
  bar.stretches.forEach((stretch, i) => {
    let best: { day: number; long: number } | null = null;
    for (const [year, , newYear] of bar.years) {
      if (newYear === null) continue;
      // 这个正月初一的前一天：还是上一个农历年，公历已经是这一年
      const day = newYear - 1;
      if (day < startOf(i) || day >= stretch.until || westernAt(bar.day0, day).year !== year) continue;
      const long = [...rowOne(day)].length;
      if (!best || long > best.long) best = { day, long };
    }
    if (best) days.push({ id: stretch.id, day: best.day });
  });
  // 头一个位置也是这样的一天
  days.unshift({ id: '最前一个位置', day: 0 });
  expect(days.length).toBeGreaterThan(10);
  // 最窄的两种栏（横着拿的平板：首页、人物页）和带着人物名字的首页（电脑）
  const panes: { where: 'figure' | 'home'; window: { width: number; height: number }; name: string }[] = [
    { where: 'home', window: ROUTE_HOME_PANES[1].window, name: `首页 ${ROUTE_HOME_PANES[1].name}` },
    { where: 'figure', window: ROUTE_PANES[1].window, name: `人物页 ${ROUTE_PANES[1].name}` },
    { where: 'home', window: ROUTE_HOME_PANES[0].window, name: `首页 ${ROUTE_HOME_PANES[0].name}` },
  ];
  const lines: string[] = [];
  const cut: string[] = [];
  for (const pane of panes) {
    await page.goto('about:blank');
    await page.setViewportSize(pane.window);
    let least = { px: Infinity, what: '' };
    for (const { id, day } of days) {
      await page.goto('about:blank');
      await open(page, day, pane.where);
      const words = wordsAt(bar, day);
      const west = westernAt(bar.day0, day);
      expect(words.year, id).toContain(`（${west.year}年${west.month}月）`);
      await expect(page.locator('.bar-when'), `${pane.name} ${id}`).toContainText(`${words.year}${words.age}${words.label}`);
      // 两行字都不比自己的地方宽（宽了就是被截了）
      const fits = (): Promise<{ when: number; known: number }> =>
        page.evaluate(() => {
          const room = (selector: string): number => {
            const el = document.querySelector(selector) as HTMLElement;
            return el.clientWidth - el.scrollWidth;
          };
          const label = document.querySelector('.bar-when .bar-label') as HTMLElement;
          return { when: Math.min(room('.bar-when'), label.clientWidth - label.scrollWidth), known: room('.bar-known') };
        });
      // 等字体到了、排好了再量（量到连着两次一样）
      let room = await fits();
      for (let tries = 0; tries < 40; tries++) {
        await page.waitForTimeout(100);
        const now = await fits();
        if (now.when === room.when && now.known === room.known && (await page.evaluate(() => document.fonts.status)) === 'loaded') break;
        room = now;
      }
      if (room.when < 0) cut.push(`${pane.name} ${id}：第一行“${rowOne(day)}”出格 ${-room.when} 像素`);
      if (room.known < 0) cut.push(`${pane.name} ${id}：第二行出格 ${-room.known} 像素`);
      // 第一行后面还剩多少地方（只印出来看）
      const spare = await page.evaluate(() => {
        const row = document.querySelector('.bar-when') as HTMLElement;
        const lastSpan = row.lastElementChild as HTMLElement;
        return row.getBoundingClientRect().right - lastSpan.getBoundingClientRect().right;
      });
      if (spare < least.px) least = { px: spare, what: `${id} “${rowOne(day)}”` };
    }
    lines.push(`${pane.name}：${days.length} 个位置都不出格；第一行后面最少还剩 ${least.px.toFixed(1)} 像素（${least.what}）`);
  }
  console.log(lines.join('\n'));
  expect(cut).toEqual([]);
});
