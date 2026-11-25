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
import { stopMarks } from '../../src/domain/stopMarks';
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

/**
 * 轴画出来的那一截（.bar-axis）在页面上的位置（连着两次量到一样才算数）：各格、圆钮的位置都从它的左头量。
 * 能按的那一条（.bar-track）比它两头各长半个圆钮；高是一样的。
 */
async function trackBox(page: Page): Promise<{ left: number; top: number; width: number; height: number }> {
  const read = (): Promise<{ left: number; top: number; width: number; height: number }> =>
    page.locator('.bar-axis').evaluate((el) => {
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
  const wanted = sectionAt(bar, SECTIONS, midOf(last));
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
    await expect(stagePane(page), bar.stretches[i].id).toHaveAttribute('data-stage-section', sectionAt(bar, SECTIONS, to.day));
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
  // 翻页键往后：下一段的起头
  await press('PageUp', stretchStep(bar, day, 1));
  expect(day).toBe(bar.stretches[STAYS[0]].until);
  await press('PageUp', stretchStep(bar, day, 1));
  expect(day).toBe(bar.stretches[STAYS[0] + 1].until);
  // 翻页键往前：已经停在一段的起头上，到上一段的起头
  await press('PageDown', stretchStep(bar, day, -1));
  await press('PageDown', stretchStep(bar, day, -1));
  expect(day).toBe(startOf(STAYS[0]));
  // 走到这一段的半中间再按往前的翻页键：头一下到这一段的起头（不越过它），第二下才到上一段的起头
  await press('ArrowRight', keyStep(bar, day, 1));
  await press('ArrowRight', keyStep(bar, day, 1));
  expect(day).toBeGreaterThan(startOf(STAYS[0]));
  await press('PageDown', startOf(STAYS[0]));
  await press('PageDown', startOf(STAYS[0] - 1));
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
  const here = sectionAt(bar, SECTIONS, midOf(stay));
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
  const wanted = sectionAt(bar, SECTIONS, day);
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

// ================================================================ 播放

/** 住在一站里、它后面那一段该看的是另一节的头一段：播放的几项用它。 */
const SECTIONS = route.sections;
const STAY_THEN_OTHER = STAYS.find((i) => i + 1 < bar.stretches.length && sectionAt(bar, SECTIONS, midOf(i + 1)) !== sectionAt(bar, SECTIONS, midOf(i))) as number;
/**
 * 一趟路，它后面紧接着住在这一趟路到的那一站：从这趟路的起头播起，路（5 个单位）加上住下来的年月（至少 3 个单位）一共六七秒，
 * 沙盘一直摆着这一站的那一节，不用停下来等。“播着的时候出了什么事就停”的几项从这里播起。
 */
const LONG_RUN = bar.stretches.findIndex((stretch, i) => stretch.look === 'road' && bar.stretches[i + 1]?.look === 'stop' && bar.stretches[i + 1].group === stretch.group);
const nowOf = (page: Page): Promise<number> => page.locator('.bar-track').getAttribute('aria-valuenow').then(Number);
/** 按在圆钮自己的位置上再放手：日子不变，沙盘换到这一段的那一节。 */
async function settleAt(page: Page, day: number): Promise<void> {
  const box = await trackBox(page);
  await page.mouse.click(pointOf(box, day).x, box.top + 28);
  await expect(stagePane(page)).toHaveAttribute('data-stage-section', sectionAt(bar, SECTIONS, pointOf(box, day).day));
  await page.mouse.move(2, 2);
}

test('页面打开以后什么都不自己动：圆钮不走，沙盘的替身没有被叫去换小节，按钮写的是“播放”，给读屏的那一句是空的', async ({ page }) => {
  for (const where of ['figure', 'home'] as const) {
    await open(page, Math.ceil(startOf(STAY_THEN_OTHER)) + 3, where);
    const first = await nowOf(page);
    await expect(page.locator('.bar-play')).toHaveText('播放');
    // 隔一阵看一回，看四回：圆钮还在原处，沙盘还摆着全程，没有被叫去换过小节
    for (let i = 0; i < 4; i++) {
      await page.waitForTimeout(600);
      expect(await nowOf(page), `${where} 第 ${i + 1} 回`).toBe(first);
      expect(await fakeRequests(page), `${where} 第 ${i + 1} 回`).toEqual([]);
    }
    await expect(stagePane(page)).toHaveAttribute('data-stage-section', WHOLE);
    await expect(page.locator('.bar-says')).toHaveText('');
    await expect(page.locator('.bar-play')).toHaveText('播放');
  }
});

test('按“播放”：圆钮往右走，按钮写“暂停”；碰一下沙盘就停，按钮变回“播放”，停了不自己再走；再按接着走，按“暂停”也停', async ({ page }) => {
  const from = Math.ceil(startOf(STAY_THEN_OTHER)) + 2;
  await open(page, from);
  await settleAt(page, from);
  const play = page.locator('.bar-play');
  const start = await nowOf(page);
  await play.click();
  await expect(play).toHaveText('暂停');
  await expect.poll(() => nowOf(page)).toBeGreaterThan(start);
  // 走着的时候小像跟着摆，不说“停着”
  await expect(fakeStage(page)).toHaveAttribute('data-fake-piece-rest', 'false');
  // 碰一下沙盘：停
  const table = await fakeStage(page).boundingBox();
  if (!table) throw new Error('沙盘的替身没有大小');
  await page.mouse.click(table.x + table.width / 2, table.y + table.height / 3);
  await expect(play).toHaveText('播放');
  const stopped = await nowOf(page);
  expect(stopped).toBeGreaterThan(start);
  for (let i = 0; i < 3; i++) {
    await page.waitForTimeout(500);
    expect(await nowOf(page), `停了以后第 ${i + 1} 回`).toBe(stopped);
  }
  await expect(fakeStage(page)).toHaveAttribute('data-fake-piece-rest', 'true');
  // 再按：从停下的地方接着走
  await play.click();
  await expect(play).toHaveText('暂停');
  await expect.poll(() => nowOf(page)).toBeGreaterThan(stopped);
  // 按“暂停”：停
  await play.click();
  await expect(play).toHaveText('播放');
  const paused = await nowOf(page);
  await page.waitForTimeout(700);
  expect(await nowOf(page)).toBe(paused);
  // 栏里别的按钮也算碰了：播放着的时候点题记的“说明”，停
  await play.click();
  await expect(play).toHaveText('暂停');
  await page.locator('.stage-note-button').click();
  await expect(play).toHaveText('播放');
  // 在轴上按键也停（圆钮照键走）
  await page.locator('.stage-note-button').click();
  await play.click();
  await expect(play).toHaveText('暂停');
  await page.locator('.bar-track').focus();
  await page.keyboard.press('Home');
  await expect(play).toHaveText('播放');
  await expect(page.locator('.bar-track')).toHaveAttribute('aria-valuenow', '0');
});

test('播到另一站讲的年月里：给读屏报一次是哪一年、在哪；开始和停下的时候也各报一句', async ({ page }) => {
  // 从一站住下来的年月过了一半的地方播起：过一两秒就走进下一站讲的年月（先是去那一站的路）
  const until = bar.stretches[STAY_THEN_OTHER].until;
  const from = Math.ceil(midOf(STAY_THEN_OTHER));
  expect(stretchIndexAt(bar, from)).toBe(STAY_THEN_OTHER);
  await open(page, from);
  await settleAt(page, from);
  const says = page.locator('.bar-says');
  await expect(says).toHaveAttribute('role', 'status');
  await expect(says).toHaveText('');
  await page.locator('.bar-play').click();
  // 开始：这一天是哪一年、在哪
  const here = wordsAt(bar, from);
  await expect(says).toHaveText(`${here.year}，${here.label}`);
  // 走进了下一站讲的年月：报那一段的
  const next = wordsAt(bar, until + 0.01);
  expect(bar.stretches[STAY_THEN_OTHER + 1].group).not.toBe(bar.stretches[STAY_THEN_OTHER].group);
  await expect(says).toHaveText(`${next.year}，${next.label}`);
  // 沙盘跟着换到了那一节，小像还在走
  await expect(stagePane(page)).toHaveAttribute('data-stage-section', sectionAt(bar, SECTIONS, until + 0.01));
  await expect(page.locator('.bar-play')).toHaveText('暂停');
  // 停下：报停在哪（还是这一站讲的年月里，句子是停下那一刻第一行印着的）
  await page.locator('.bar-play').click();
  await expect(page.locator('.bar-play')).toHaveText('播放');
  const end = await page.locator('.bar-when').evaluate((el) => [...el.querySelectorAll('span')].map((span) => span.textContent ?? ''));
  await expect(says).toHaveText(`${end[0]}，${end[end.length - 1]}`);
});

// ================================================================ 别的读者

test('系统设了“减少动态效果”：没有“播放”，轴的两头是“上一段”“下一段”，按一下到下一段的起头；往前先到这一段的起头', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const from = Math.ceil(midOf(STAYS[1]));
  await open(page, from);
  await expect(page.locator('.bar')).toHaveClass(/is-calm/);
  await expect(page.locator('.bar-play')).toHaveCount(0);
  const steps = page.locator('.bar-slide .bar-step');
  await expect(steps).toHaveText(['上一段', '下一段']);
  // 排在轴的两头：上一段在轴的左边，下一段在右边
  const boxes = await page.locator('.bar-slide').evaluate((el) => [...el.children].map((child) => ({ name: child.className, left: child.getBoundingClientRect().left })));
  expect(boxes.map((b) => b.name.split(' ').pop())).toEqual(['bar-step', 'bar-track', 'bar-step']);
  expect(boxes[0].left).toBeLessThan(boxes[1].left);
  expect(boxes[1].left).toBeLessThan(boxes[2].left);
  const track = page.locator('.bar-track');
  // 下一段：到下一段的起头，两行字跟着换，沙盘换到那一节
  let day = stretchStep(bar, from, 1);
  await steps.nth(1).click();
  await expect(track).toHaveAttribute('aria-valuenow', String(valueNow(day)));
  await expect(page.locator('.bar-when')).toHaveText(rowOne(day));
  await expect(page.locator('.bar-known')).toHaveText(wordsAt(bar, day).says);
  await expect(stagePane(page)).toHaveAttribute('data-stage-section', sectionAt(bar, SECTIONS, day));
  // 小像摆到那一天的地方（那一段沙盘上没有他的话，拿走）
  const there = whereAt(bar, day);
  await expect.poll(() => piece(page)).toBe(there ? JSON.stringify(there) : '');
  // 上一段：已经在起头上，到上一段的起头；再走到半中间按上一段，先到这一段的起头
  day = stretchStep(bar, day, -1);
  await steps.nth(0).click();
  await expect(track).toHaveAttribute('aria-valuenow', String(valueNow(day)));
  expect(day).toBe(startOf(STAYS[1]));
  await track.focus();
  await page.keyboard.press('ArrowRight');
  await expect(track).toHaveAttribute('aria-valuenow', String(valueNow(keyStep(bar, day, 1))));
  await steps.nth(0).click();
  await expect(track).toHaveAttribute('aria-valuenow', String(valueNow(day)));
  // 拖、按在轴上照旧
  const box = await trackBox(page);
  const to = pointOf(box, midOf(STAYS[2]));
  await page.mouse.click(to.x, box.top + 28);
  await expect(track).toHaveAttribute('aria-valuenow', String(valueNow(to.day)));
});

test('只放图片的时候：时间轴照样有，两行字照样换，图片上没有小像——最前一个位置的第二行多半句“图片上没有他的小像”，“图例”的头一句也这么说', async ({ page }) => {
  await page.goto(`/?stage=fake&sectionstills=fake&tier=still&bar=0#/${FIGURE_ID}`);
  const pane = stagePane(page);
  await expect(pane).toHaveAttribute('data-stage-picture', 'still');
  await expect(page.locator('.bar-thumb')).toHaveCount(1);
  // 没有立体的沙盘，也就没有小像
  await expect(fakeStage(page)).toHaveCount(0);
  // 最前一个位置：第二行多半句；给读屏念的那一句里也有
  const first = `${bar.first.says}；图片上没有他的小像`;
  await expect(page.locator('.bar-known')).toHaveText(first);
  await expect(page.locator('.bar-track')).toHaveAttribute('aria-valuetext', new RegExp(`${first}。$`));
  await expect(page.locator('.bar-when')).toHaveText(rowOne(0));
  // “图例”的头一句说的是图片
  await page.locator('.bar-note').click();
  const lines = page.locator('.bar-panel .stage-note-lines p');
  await expect(lines.first()).toHaveText('这台设备上放的是沙盘的图片，图片上没有小像；时间轴上的字照样说他在哪里。');
  await expect(page.locator('.bar-panel')).not.toContainText('沙盘上的小像是');
  await page.keyboard.press('Escape');
  await expect(page.locator('.bar-panel')).toHaveCount(0);
  // 按在轴上：两行字照样换，图片换到那一节；别的位置的第二行就是行迹里的那一句
  const box = await trackBox(page);
  const to = pointOf(box, midOf(STAYS[3]));
  await page.mouse.click(to.x, box.top + 28);
  await expect(page.locator('.bar-when')).toHaveText(rowOne(to.day));
  await expect(page.locator('.bar-known')).toHaveText(wordsAt(bar, to.day).says);
  await expect(pane).toHaveAttribute('data-stage-section', sectionAt(bar, SECTIONS, to.day));
  await expect(pane).toHaveAttribute('data-stage-picture', 'still');
  // 回到最前：那半句又在
  await page.locator('.bar-track').focus();
  await page.keyboard.press('Home');
  await expect(page.locator('.bar-known')).toHaveText(first);
  // 对照：摆着立体的沙盘的时候没有那半句（这一项最前面的那几项里查的就是）
});

test('栏收起来：时间轴跟着收起，播放停下；再打开，日子还在，小像再摆上', async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 1024 });
  expect(LONG_RUN).toBeGreaterThan(0);
  const from = Math.ceil(startOf(LONG_RUN)) + 1;
  await open(page, from);
  await settleAt(page, from);
  const play = page.locator('.bar-play');
  await play.click();
  await expect(play).toHaveText('暂停');
  await expect.poll(() => nowOf(page)).toBeGreaterThan(valueNow(from));
  // 收起
  const fold = page.locator('.stage-fold');
  await fold.click();
  await expect(fold).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('.stage-bar')).toBeHidden();
  // 收起的那一刻就不走了：马上记下日子，过一阵再看，还是那一天（接着播的话，这一阵里圆钮早走远了）
  const kept = await nowOf(page);
  await page.waitForTimeout(800);
  expect(await nowOf(page)).toBe(kept);
  await expect(play).toHaveText('播放', { useInnerText: false });
  // 沙盘上的小像拿走了（没有时间轴，说不出他是哪一天的）
  await expect.poll(() => piece(page)).toBe('');
  // 再打开：日子还在，不自己接着播
  await fold.click();
  await expect(fold).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('.stage-bar')).toBeVisible();
  await expect(page.locator('.bar-thumb')).toHaveCount(1);
  expect(await nowOf(page)).toBe(kept);
  await expect(play).toHaveText('播放');
  await expect.poll(() => piece(page)).not.toBe('');
  await page.waitForTimeout(600);
  expect(await nowOf(page)).toBe(kept);
});

test('很矮的窗口（720 × 450）：不摆时间轴，沙盘上没有小像，沙盘四边留的空同不摆时间轴的时候一样', async ({ page }) => {
  await page.setViewportSize({ width: 720, height: 450 });
  const insets = (): Promise<string | null> => fakeStage(page).getAttribute('data-fake-insets');
  await page.goto(`/?stage=fake&bar=none#/${FIGURE_ID}`);
  await expect(stagePane(page)).toHaveAttribute('data-stage-state', 'ready');
  await expect.poll(insets).not.toBeNull();
  const without = await insets();
  await page.goto('about:blank');
  await page.goto(`/?stage=fake&bar=${Math.ceil(midOf(STAYS[2]))}#/${FIGURE_ID}`);
  await expect(stagePane(page)).toHaveAttribute('data-stage-state', 'ready');
  await expect(page.locator('.stage-bar .bar')).toHaveCount(1);
  await expect(page.locator('.stage-bar')).toBeHidden();
  await expect(page.locator('.bar-thumb')).toHaveCount(0);
  await page.waitForTimeout(500);
  expect(await insets()).toBe(without);
  expect((await piece(page)) ?? '').toBe('');
  // 底下那一条里没有时间轴的那 96 像素：它同题记一样高
  const heights = await page.evaluate(() => ['.stage-foot', '.stage-caption', '.stage-bar'].map((selector) => document.querySelector(selector)!.getBoundingClientRect().height));
  expect(heights[2]).toBe(0);
  expect(heights[0]).toBe(heights[1]);
});

test('正播放着，窗口变矮了、时间轴没了地方（没有人碰它，这一条也没有拿走）：播放停下，小像拿走；窗口变回来，日子还在，不自己接着播', async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 1024 });
  expect(LONG_RUN).toBeGreaterThan(0);
  const from = Math.ceil(startOf(LONG_RUN)) + 1;
  await open(page, from);
  await settleAt(page, from);
  const play = page.locator('.bar-play');
  await play.click();
  await expect(play).toHaveText('暂停');
  await expect.poll(() => nowOf(page)).toBeGreaterThan(valueNow(from));
  // 窗口变矮：样式表不摆时间轴了
  await page.setViewportSize({ width: 720, height: 450 });
  await expect(page.locator('.stage-bar')).toBeHidden();
  await expect(page.locator('.stage-bar .bar')).toHaveCount(1);
  // 那一刻起不走了
  await expect(play).toHaveText('播放', { useInnerText: false });
  const kept = await nowOf(page);
  await page.waitForTimeout(800);
  expect(await nowOf(page)).toBe(kept);
  await expect.poll(() => piece(page)).toBe('');
  // 窗口变回来：这一条又在，日子还在，按钮是“播放”，圆钮不自己走
  await page.setViewportSize({ width: 768, height: 1024 });
  await expect(page.locator('.stage-bar')).toBeVisible();
  await expect(page.locator('.bar-thumb')).toHaveCount(1);
  await expect(play).toHaveText('播放');
  expect(await nowOf(page)).toBe(kept);
  await page.waitForTimeout(600);
  expect(await nowOf(page)).toBe(kept);
  await expect.poll(() => piece(page)).not.toBe('');
});

test('时间轴的那一段程序没取到：这一条里说一句话，别的照常', async ({ page }) => {
  await page.route(/\/assets\/TimeBar-[^/]*\.js$/, (routed) => routed.abort());
  await page.goto(`/?stage=fake&bar=0#/${FIGURE_ID}`);
  await expect(stagePane(page)).toHaveAttribute('data-stage-state', 'ready');
  const band = page.locator('.stage-foot .stage-bar');
  await expect(band).toHaveText('时间轴没能读出来，刷新一下网页再试。');
  await expect(band.locator('[role="status"]')).toHaveCount(1);
  await expect(page.locator('.bar')).toHaveCount(0);
  // 这一条还是那么高；题记、目录、沙盘照常
  await expect.poll(() => band.evaluate((el) => el.getBoundingClientRect().height)).toBe(BAR_BAND_PX);
  await expect(page.locator('.stage-caption')).toBeVisible();
  await expect(page.locator('.stop-item').first()).toBeVisible();
  await expect(stagePane(page)).toHaveAttribute('data-stage-section', WHOLE);
  await expect(page.locator('.stage-note-button')).toBeVisible();
});

// ================================================================ “图例”

test('点时间轴的“图例”：先是这一段的哪一年、在哪和整句话，有说不准的接着说；下面八句；按 Esc、点“关闭”收起；同题记的“说明”一次只开一个；它不盖时间轴', async ({ page }) => {
  const i = STAYS[1];
  await open(page, Math.ceil(midOf(i)));
  const day = Math.ceil(midOf(i));
  const button = page.locator('.bar-note');
  const panel = page.locator('.bar-panel');
  await expect(button).toHaveText('图例');
  await expect(button).toHaveAttribute('aria-expanded', 'false');
  await expect(panel).toHaveCount(0);
  await button.click();
  await expect(button).toHaveAttribute('aria-expanded', 'true');
  await expect(panel).toHaveCount(1);
  await expect(panel).toHaveAttribute('role', 'region');
  await expect(panel).toHaveAttribute('aria-label', '时间轴的图例');
  await expect(panel.locator('.stage-note-panel-title')).toHaveText('图例');
  // 这一段：第一行的三样，那一句话的全文，说不准的
  const words = wordsAt(bar, day);
  await expect(panel.locator('.bar-now-when')).toHaveText(`${words.year}${words.age}${words.label}`);
  await expect(panel.locator('.bar-now p').nth(1)).toHaveText(words.says);
  const unsure = bar.stretches[i].unsure;
  expect(unsure, '这一段要有说不准的').toBeTruthy();
  await expect(panel.locator('.bar-now-unsure')).toHaveText(`说不准的：${unsure}`);
  // 下面八句：头一句说小像，第四句里是行迹里那几处的名字，最后一句里是轴上有几站
  const lines = panel.locator('.stage-note-lines p');
  await expect(lines).toHaveCount(8);
  const spots = [...new Set(bar.stretches.flatMap((stretch) => (stretch.spot ? [stretch.spot[2]] : [])))];
  expect(spots.length).toBeGreaterThan(0);
  await expect(lines.nth(0)).toHaveText(`沙盘上的小像是${bar.name}。它比真人大得多，只用来标出这一天他在哪里；长袍、高帽是示意的，没有照哪一幅画像。`);
  await expect(lines.nth(1)).toHaveText('这条时间轴不是匀的：路上的几个月画得宽，住下来的几年画得窄（格子上有两道斜线）。下面的刻度是每十年一道。');
  await expect(lines.nth(2)).toHaveText('两个有日子的地方之间，小像在路上是匀着走的；哪一天到了哪里没有记载。');
  await expect(lines.nth(3)).toHaveText(`有几处沙盘上平时没有立名字（${spots.join('、')}），他站到那里的时候，旁边才立出那一处的名字。`);
  await expect(lines.nth(4)).toHaveText('空着的虚线格子，是这座沙盘上没有的地方、没有画的路，那时候沙盘上没有他。');
  await expect(lines.nth(5)).toHaveText('括号里的公历年份，是这个农历年大半落在的那一年。腊月有时已经是公历下一年的一月，那些天括号里写的是公历的年和月；日子说不准的地方仍只写年份。');
  await expect(lines.nth(6)).toContainText('松开以后，转到他那一站的那一段');
  const stops = new Set(bar.stretches.flatMap((stretch) => (stretch.group ? [stretch.group] : []))).size;
  await expect(lines.nth(7)).toHaveText(`轴上圆圈里的数字是他走过的${'一二三四五六七八九十'[stops - 1]}站，和题签上的印是同一个数。古名、今名只换题签上的名字，时间轴上写的是当时的名字。`);
  await expect(page.locator('.bar-track .bar-disc')).toHaveCount(stops);
  // 它在时间轴的上面，不盖时间轴，也不伸到按钮那一排上面去
  const boxes = await page.evaluate(() => {
    const rect = (selector: string) => document.querySelector(selector)!.getBoundingClientRect();
    return { panel: rect('.bar-panel'), band: rect('.stage-bar'), controls: rect('.stage-controls') };
  });
  expect(boxes.panel.bottom).toBeLessThanOrEqual(boxes.band.top);
  expect(boxes.panel.top).toBeGreaterThanOrEqual(boxes.controls.bottom);
  // 拖到别的一段：开着的这一块跟着换
  const box = await trackBox(page);
  const to = pointOf(box, midOf(STAYS[2]));
  await page.mouse.click(to.x, box.top + 28);
  await expect(panel.locator('.bar-now p').nth(1)).toHaveText(wordsAt(bar, to.day).says);
  // 等沙盘换到那一节（换小节的时候题记的“说明”自己会收起：下面查“一次只开一个”，不能赶在它前头）
  await expect(stagePane(page)).toHaveAttribute('data-stage-section', sectionAt(bar, SECTIONS, to.day));
  await expect(page.locator('.stage-caption')).toHaveAttribute('data-section', sectionAt(bar, SECTIONS, to.day));
  // 按 Esc 收起；再点开，点“关闭”收起
  await page.keyboard.press('Escape');
  await expect(panel).toHaveCount(0);
  await expect(button).toHaveAttribute('aria-expanded', 'false');
  await button.click();
  await expect(panel).toHaveCount(1);
  await panel.locator('.stage-note-close').click();
  await expect(panel).toHaveCount(0);
  // 同题记的“说明”一次只开一个：题记的开着的时候点“图例”，题记的先收起；“图例”开着的时候点题记的“说明”，“图例”收起
  const caption = page.locator('.stage-note-button');
  const captionPanel = page.locator('.stage-note-panel:not(.bar-panel)');
  /** 两块各开没开；隔一阵再看一回，两回一样才算数（刚点下去的那一瞬两块都在）。 */
  const bothPanels = async (): Promise<string> => {
    const read = (): Promise<string> => Promise.all([panel.count(), captionPanel.count(), button.getAttribute('aria-expanded'), caption.getAttribute('aria-expanded')]).then((got) => got.join(' '));
    let last = await read();
    for (let tries = 0; tries < 30; tries++) {
      await page.waitForTimeout(150);
      const now = await read();
      if (now === last) return now;
      last = now;
    }
    return last;
  };
  await caption.click();
  await expect(captionPanel).toHaveCount(1);
  expect(await bothPanels()).toBe('0 1 false true');
  await button.click();
  // “图例”开了，题记的那一块收起了
  await expect(captionPanel).toHaveCount(0);
  expect(await bothPanels()).toBe('1 0 true false');
  await caption.click();
  // 题记的开了，“图例”收起了
  await expect(panel).toHaveCount(0);
  expect(await bothPanels()).toBe('0 1 false true');
  await page.keyboard.press('Escape');
  expect(await bothPanels()).toBe('0 0 false false');
});

test('栏矮的时候（1024 × 420 的窗口：按钮那一排和时间轴之间不到 160 像素）“图例”的那一块在自己里面滚：不盖时间轴，不伸到按钮那一排上面', async ({ page }) => {
  // 题记的“说明”在这么矮的栏上会往下多盖题记一截（它至少要 160 像素高）；“图例”不往下盖——下面是时间轴——宁可矮一点
  await page.setViewportSize({ width: 1024, height: 420 });
  await open(page, Math.ceil(midOf(STAYS[1])));
  await page.locator('.bar-note').click();
  await expect(page.locator('.bar-panel')).toHaveCount(1);
  const read = () =>
    page.evaluate(() => {
      const rect = (selector: string) => document.querySelector(selector)!.getBoundingClientRect();
      const panel = document.querySelector('.bar-panel')!;
      return { panel: rect('.bar-panel'), band: rect('.stage-bar'), controls: rect('.stage-controls'), scrolls: panel.scrollHeight - panel.clientHeight };
    });
  await expect.poll(async () => (await read()).scrolls).toBeGreaterThan(0);
  const boxes = await read();
  console.log(`1024 × 420：“图例”的那一块高 ${boxes.panel.height.toFixed(0)} 像素，里面还有 ${boxes.scrolls} 像素要滚；它的下边离时间轴 ${(boxes.band.top - boxes.panel.bottom).toFixed(1)} 像素，上边离按钮那一排 ${(boxes.panel.top - boxes.controls.bottom).toFixed(1)} 像素`);
  expect(boxes.panel.bottom).toBeLessThanOrEqual(boxes.band.top);
  expect(boxes.panel.top).toBeGreaterThanOrEqual(boxes.controls.bottom);
  // 这个窗口上它真的不到 160 像素高（不然这一项什么也没有查到）
  expect(boxes.panel.height).toBeLessThan(160);
  // 滚得到底：最后一句看得见
  await page.locator('.bar-panel .stage-note-lines p').last().scrollIntoViewIfNeeded();
  await expect(page.locator('.bar-panel .stage-note-lines p').last()).toBeInViewport();
});

// ================================================================ 进一站的入口

test('走到一站讲的那几年里，第一行右头有进这一站的入口，读屏念的是“进这一站：”加那一站的印的那一句；出了那几年就没有', async ({ page }) => {
  const marks = stopMarks(figure, (stopId) => `#/${FIGURE_ID}/${stopId}`);
  await open(page, 0);
  const enter = page.locator('.bar-enter');
  // 出生的那一天不在哪一站讲的年月里：没有入口
  await expect(enter).toHaveCount(0);
  const track = page.locator('.bar-track');
  await track.focus();
  let day = 0;
  let inGroup = 0;
  let outside = 1;
  // 用翻页键一段一段走完一生：每一段的起头上，有没有入口、通到哪、念什么，都照行迹里这一段落在哪一站
  for (let n = 0; n < bar.stretches.length; n++) {
    day = stretchStep(bar, day, 1);
    await page.keyboard.press('PageUp');
    await expect(track).toHaveAttribute('aria-valuenow', String(valueNow(day)));
    const stretch = bar.stretches[stretchIndexAt(bar, day)];
    if (day >= lastDay) break;
    if (!stretch.group) {
      outside++;
      await expect(enter, stretch.id).toHaveCount(0);
      continue;
    }
    inGroup++;
    const mark = marks[stretch.group];
    await expect(enter, stretch.id).toHaveCount(1);
    await expect(enter, stretch.id).toHaveAttribute('href', mark.href);
    await expect(enter, stretch.id).toHaveAttribute('aria-label', `进这一站：${mark.title}`);
    // 栏够宽：字写全
    await expect(enter, stretch.id).toHaveText(`进第${mark.label}站`);
  }
  expect(inGroup).toBeGreaterThan(0);
  expect(outside).toBeGreaterThan(1);
});

test('栏窄的时候（横着拿的平板）入口只是那一站的圆点和箭头，能点的地方不小于 44 像素；写好了的站是实心的圆点，没写的只有一圈', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  const marks = stopMarks(figure, (stopId) => `#/${FIGURE_ID}/${stopId}`);
  const stays = STAYS.filter((i) => bar.stretches[i].group);
  const written = stays.find((i) => marks[bar.stretches[i].group as string].written);
  const unwritten = stays.find((i) => !marks[bar.stretches[i].group as string].written);
  expect(written !== undefined && unwritten !== undefined).toBe(true);
  for (const i of [written as number, unwritten as number]) {
    const mark = marks[bar.stretches[i].group as string];
    await open(page, Math.ceil(midOf(i)));
    const enter = page.locator('.bar-enter');
    await expect(enter).toHaveClass(/is-seal/);
    await expect(enter).toHaveText(mark.label);
    await expect(enter).toHaveAttribute('aria-label', `进这一站：${mark.title}`);
    await expect(enter.locator('.bar-disc')).toHaveClass(mark.written ? /^bar-disc$/ : /is-unwritten/);
    // 能点的地方：它自己加上撑出去的那一圈（::after）
    const tap = await enter.evaluate((el) => {
      const after = getComputedStyle(el, '::after');
      const own = el.getBoundingClientRect();
      return { width: parseFloat(after.width), height: own.height - parseFloat(after.top) - parseFloat(after.bottom), own: { width: own.width, height: own.height } };
    });
    console.log(`窄的栏上进${mark.label}站的入口：看着 ${tap.own.width.toFixed(0)} × ${tap.own.height.toFixed(0)} 像素，能点的地方 ${tap.width.toFixed(0)} × ${tap.height.toFixed(0)} 像素`);
    expect(tap.width).toBeGreaterThanOrEqual(44);
    expect(tap.height).toBeGreaterThanOrEqual(44);
  }
});

test('从入口点进有自己的沙盘的一站：镜头潜下去的那一会儿时间轴不接手指和按键，潜完页面换到那一站，那里没有时间轴；回来日子还在', async ({ page }) => {
  // 头一个有自己的沙盘、又在行迹里有住下来的一段的站
  const i = STAYS.find((index) => sceneOnDisk(FIGURE_ID, bar.stretches[index].group as string) !== null) as number;
  const stop = bar.stretches[i].group as string;
  const day = Math.ceil(midOf(i));
  await page.goto(`/?stage=fake&dive=1&bar=${day}#/${FIGURE_ID}`);
  await expect(stagePane(page)).toHaveAttribute('data-stage-state', 'ready');
  await expect(page.locator('.bar-thumb')).toHaveCount(1);
  const enter = page.locator('.bar-enter');
  await expect(enter).toHaveAttribute('href', `#/${FIGURE_ID}/${stop}`);
  // 一路上记下：栏上写着正往哪一站潜的时候，时间轴是不是不接按键（inert）、不接手指（pointer-events）
  await page.evaluate(() => {
    const seen: { dive: string | null; inert: boolean; pointer: string; hash: string }[] = [];
    (window as unknown as { __barDive: typeof seen }).__barDive = seen;
    const note = (): void => {
      const pane = document.querySelector('.stage-pane');
      const root = document.querySelector('.bar');
      const band = document.querySelector('.stage-bar');
      if (!pane || !root || !band) return;
      seen.push({ dive: pane.getAttribute('data-stage-dive'), inert: root.hasAttribute('inert'), pointer: getComputedStyle(band).pointerEvents, hash: location.hash });
    };
    new MutationObserver(note).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['data-stage-dive', 'inert'] });
  });
  const before = await page.locator('.bar-track').getAttribute('aria-valuenow');
  await enter.click();
  await expect.poll(() => page.evaluate(() => location.hash)).toBe(`#/${FIGURE_ID}/${stop}`);
  const seen = await page.evaluate(() => (window as unknown as { __barDive: { dive: string | null; inert: boolean; pointer: string; hash: string }[] }).__barDive);
  const diving = seen.filter((moment) => moment.dive === stop);
  expect(diving.length, '栏上从没写过正往这一站潜').toBeGreaterThan(0);
  // 潜的那一会儿地址还没有变；时间轴不接手指，也不接按键
  expect(diving.every((moment) => moment.hash === `#/${FIGURE_ID}`)).toBe(true);
  expect(diving.every((moment) => moment.pointer === 'none')).toBe(true);
  expect(diving.some((moment) => moment.inert), '潜的时候时间轴没有挂上 inert').toBe(true);
  // 那一站的页面：自己的沙盘，没有时间轴
  await expect(page.locator('.stop-page')).toHaveAttribute('data-stop-id', stop);
  await expect(page.locator('.stage-bar')).toHaveCount(0);
  // 回人物页：日子还在
  await page.goBack();
  await expect(page.locator('.bar-thumb')).toHaveCount(1);
  await expect(page.locator('.bar-track')).toHaveAttribute('aria-valuenow', before as string);
  await expect(page.locator('.bar')).not.toHaveAttribute('inert', /.*/);
});

// ================================================================ 这一回修的几处

test('圆钮到了最前、最后一个位置，整个还在时间轴的那一条里面，也不压着年份的数字；圆点旁边不写各站的年份（人物页的两种栏、首页最窄的栏）', async ({ page }) => {
  const cases: [string, { width: number; height: number }, 'figure' | 'home'][] = [
    ['电脑上的人物页', { width: 1440, height: 900 }, 'figure'],
    ['竖着拿的平板上的人物页', { width: 768, height: 1024 }, 'figure'],
    ['横着拿的平板上的首页', { width: 1024, height: 768 }, 'home'],
  ];
  for (const [name, size, where] of cases) {
    await page.setViewportSize(size);
    for (const [end, day] of [['最前', 0], ['最后', lastDay]] as const) {
      await page.goto('about:blank');
      await open(page, day, where);
      // 连着两回量到一样才算数
      const read = () =>
        page.evaluate(() => {
          const rect = (selector: string) => document.querySelector(selector)!.getBoundingClientRect();
          const [band, knob, axis, track] = [rect('.stage-bar'), rect('.bar-thumb'), rect('.bar-axis'), rect('.bar-track')];
          const years = [...document.querySelectorAll('.bar-year')].map((el) => el.getBoundingClientRect());
          return {
            left: knob.left - band.left,
            right: band.right - knob.right,
            centre: knob.left + knob.width / 2 - axis.left,
            axis: axis.width,
            grow: (track.width - axis.width) / 2,
            knob: knob.width,
            under: Math.min(...years.map((year) => year.top)) - knob.bottom,
            beside: document.querySelectorAll('.bar-years').length,
          };
        });
      let got = await read();
      for (let tries = 0; tries < 30; tries++) {
        await page.waitForTimeout(100);
        const again = await read();
        if (JSON.stringify(again) === JSON.stringify(got)) break;
        got = again;
      }
      console.log(`${name}，${end}一个位置：圆钮离这一条的左边 ${got.left.toFixed(1)} 像素、右边 ${got.right.toFixed(1)} 像素；圆钮的下边离年份的上边 ${got.under.toFixed(1)} 像素（年份的字比它那一行的上边还低两像素）；轴画出来 ${got.axis} 像素宽`);
      // 圆钮的正中就在画出来的那一截的头上；能按的那一条两头各多出半个圆钮
      expect(Math.abs(got.centre - (day === 0 ? 0 : got.axis))).toBeLessThan(0.6);
      expect(got.grow).toBe(got.knob / 2);
      // 整个在这一条里面。宽的栏上离边 5 像素，判；窄的栏上只有 3 像素，这里只印出来（数是样式表里的，tests/unit/bar-scale.test.ts 照样式表算着查）
      if (got.left >= 4 && got.right >= 4) {
        expect(got.left).toBeGreaterThanOrEqual(0);
        expect(got.right).toBeGreaterThanOrEqual(0);
      } else console.log(`  （${name}：离边不到 4 像素，只印不判）`);
      // 原来圆钮有一半探在这一条的头外面（离边是负的十来像素）：现在不许比 -1 还小
      expect(Math.min(got.left, got.right)).toBeGreaterThan(-1);
      // 圆点旁边没有年份
      expect(got.beside).toBe(0);
    }
  }
});

test('键盘走到轴上：焦点框围着整条轴，年份在它里面，没有哪一道线从年份的数字上穿过去', async ({ page }) => {
  await open(page, Math.ceil(midOf(STAYS[2])));
  // 用 Tab 键走到轴上（用键盘到的，才显焦点框）
  for (let i = 0; i < 60; i++) {
    await page.keyboard.press('Tab');
    if (await page.evaluate(() => document.activeElement?.classList.contains('bar-track'))) break;
  }
  await expect(page.locator('.bar-track')).toBeFocused();
  const ring = await page.locator('.bar-track').evaluate((el) => {
    const own = getComputedStyle(el);
    const after = getComputedStyle(el, '::after');
    const box = el.getBoundingClientRect();
    const px = (value: string): number => parseFloat(value) || 0;
    return {
      shadow: own.boxShadow,
      outlineOffset: px(own.outlineOffset),
      outlineColor: own.outlineColor,
      border: px(after.borderTopWidth),
      content: after.content,
      // 那一圈的外边、里边（页面上的坐标）
      outerBottom: box.bottom - px(after.bottom),
      innerBottom: box.bottom - px(after.bottom) - px(after.borderBottomWidth),
      outerTop: box.top + px(after.top),
      innerLeft: box.left + px(after.left) + px(after.borderLeftWidth),
      innerRight: box.right - px(after.right) - px(after.borderRightWidth),
      years: [...el.querySelectorAll('.bar-year')].map((year) => { const r = year.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right }; }),
      trackTop: box.top,
      trackBottom: box.bottom,
    };
  });
  // 轴自己身上没有往里贴的那一圈白（它原来正贴在年份的数字上），也没有往里收的外框线
  expect(ring.shadow).toBe('none');
  expect(ring.outlineOffset).toBeGreaterThanOrEqual(0);
  // 焦点框是另画的一圈，两像素宽
  expect(ring.content).not.toBe('none');
  expect(ring.border).toBe(2);
  // 这一圈的下边在轴的下边以外、上边在轴的上边以外：年份不在它上面
  expect(ring.innerBottom).toBeGreaterThanOrEqual(ring.trackBottom);
  expect(ring.outerTop).toBeLessThanOrEqual(ring.trackTop);
  // 每一个年份都在这一圈里面（左右、上下）；下边只差半个像素，印出来，不在这里判（样式表里的数由 tests/unit/bar-scale.test.ts 算着查）
  expect(ring.years.length).toBeGreaterThan(3);
  const least = Math.min(...ring.years.map((year) => ring.innerBottom - year.bottom));
  console.log(`焦点框里边的下边离年份那一行的下边最近 ${least.toFixed(1)} 像素；年份那一行的上边在轴的上边以下 ${(Math.min(...ring.years.map((year) => year.top)) - ring.trackTop).toFixed(1)} 像素`);
  for (const year of ring.years) {
    expect(year.left).toBeGreaterThanOrEqual(ring.innerLeft);
    expect(year.right).toBeLessThanOrEqual(ring.innerRight);
    // 原来那一圈白从年份那一行的中间穿过去（它的里边在年份的下边以上六像素）：现在这一圈的里边不许比年份那一行的下边高出 1 像素
    expect(ring.innerBottom - year.bottom).toBeGreaterThan(-1);
  }
});

test('地址里的 ?bar= 只在读者还没动过时间轴的时候算数：动过以后进一站的页面再回来，圆钮还在读者停下的地方，不跳回地址里的那一天', async ({ page }) => {
  const bare = figure.stops.find((stop) => sceneOnDisk(FIGURE_ID, stop.id) === null)?.id as string;
  expect(bare).toBeTruthy();
  const from = Math.ceil(midOf(STAYS[0]));
  await open(page, from);
  const track = page.locator('.bar-track');
  await expect(track).toHaveAttribute('aria-valuenow', String(valueNow(from)));
  // 读者按到别的地方
  const box = await trackBox(page);
  const to = pointOf(box, midOf(STAYS[3]));
  await page.mouse.click(to.x, box.top + 28);
  await expect(track).toHaveAttribute('aria-valuenow', String(valueNow(to.day)));
  expect(valueNow(to.day)).not.toBe(valueNow(from));
  // 进一站的页面（地址里“?”后面的那一截还在），再回来
  await page.locator(`.stop-item[data-stop-id="${bare}"]`).click();
  await expect(page.locator('.stop-page')).toHaveAttribute('data-stop-id', bare);
  await expect(page.locator('.stage-bar')).toHaveCount(0);
  expect(await page.evaluate(() => location.search)).toContain(`bar=${from}`);
  await page.goBack();
  await expect(page.locator('.bar-thumb')).toHaveCount(1);
  await expect(track).toHaveAttribute('aria-valuenow', String(valueNow(to.day)));
  await expect(page.locator('.bar-when')).toHaveText(rowOne(to.day));
});

test('轴只跟着按下去的那一根手指：另一根手指的动、抬都不管；那一根抬了才算放手', async ({ page }) => {
  await open(page, 0);
  const box = await trackBox(page);
  const track = page.locator('.bar-track');
  /** 在轴上发一个手指的事件（号是 id）。 */
  const finger = (type: string, id: number, x: number): Promise<void> =>
    track.evaluate(
      (el, [kind, pointerId, clientX, clientY]) => {
        el.dispatchEvent(new PointerEvent(kind as string, { pointerId: pointerId as number, pointerType: 'touch', isPrimary: pointerId === 11, button: 0, buttons: 1, clientX: clientX as number, clientY: clientY as number, bubbles: true, cancelable: true }));
      },
      [type, id, x, box.top + 28] as [string, number, number, number],
    );
  const at = (i: number) => pointOf(box, midOf(STAYS[i]));
  const now = (day: number): Promise<void> => expect(track).toHaveAttribute('aria-valuenow', String(valueNow(day)));
  // 头一根手指按下去：圆钮到它那里
  await finger('pointerdown', 11, at(1).x);
  await now(at(1).day);
  // 第二根手指按下去、动、抬：圆钮不动，也不算放手（沙盘还没有被叫去换到停下的那一节）
  const asked = (await fakeRequests(page)).length;
  await finger('pointerdown', 12, at(4).x);
  await finger('pointermove', 12, at(5).x);
  await page.waitForTimeout(200);
  await now(at(1).day);
  await finger('pointerup', 12, at(5).x);
  await page.waitForTimeout(200);
  await now(at(1).day);
  expect((await fakeRequests(page)).filter((heading) => heading !== WHOLE).length, '第二根手指抬了，不算放手').toBe((await fakeRequests(page)).slice(0, asked).filter((heading) => heading !== WHOLE).length);
  // 头一根接着拖：圆钮跟着走
  await finger('pointermove', 11, at(2).x);
  await now(at(2).day);
  // 头一根抬了：放手，沙盘换到停下的那一节
  await finger('pointerup', 11, at(2).x);
  await expect(stagePane(page)).toHaveAttribute('data-stage-section', sectionAt(bar, SECTIONS, at(2).day));
  // 放手以后别的手指再动：不管
  await finger('pointermove', 12, at(5).x);
  await page.waitForTimeout(200);
  await now(at(2).day);
});
