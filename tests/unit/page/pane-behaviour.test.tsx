// 沙盘栏（StagePane）的行为：用一个很小的假 DOM（miniDom.ts）在 Node 里把沙盘栏、沙盘的替身和题签层连起来跑一遍。
// 场景是几组测试共用的那座小沙盘；沙盘旁边的字用假的，只看沙盘栏怎么用它们。不看版面和样式（那是 tests/e2e 的事）。
//
// 几条规矩（最新的指令才算数、沙盘到了字才换、收起时不叫沙盘白跑）查的是“一路上出现过什么”，不只看最后停在哪：
// 替身把收到的每一次 showSection 记在 data-fake-requests 上；这里每等一下就记一笔沙盘栏说自己摆着哪一节、
// 替身实际摆着哪一节（见 watch）。
import { describe, expect, it, vi } from 'vitest';
import type { SectionInfo, StopScene } from '../../../src/domain';
import { FIXTURE_HEADINGS, fixtureScene } from '../../support/fixtureScene';
import { installMiniDom } from './miniDom';
import type { MiniElement } from './miniDom';

const doc = installMiniDom('?stage=fake');
const win = (globalThis as any).window;

vi.mock('../../../src/domain', async (original) => {
  const actual = await original<typeof import('../../../src/domain')>();
  return {
    ...actual,
    sectionHeadings: (scene: StopScene) => scene.sections.map((s) => s.heading),
    sectionInfo: (scene: StopScene, heading: string): SectionInfo => {
      const s = scene.sections.find((x) => x.heading === heading)!;
      return { section: heading, date: s.date, line: s.line, note: { short: '短', brief: '更短', lines: ['长一', '长二'] }, far: [] };
    },
    stripTexts: (scene: StopScene, heading: string, names: 'ancient' | 'modern') => {
      const s = scene.sections.find((x) => x.heading === heading)!;
      return s.strips.map((id) => {
        const strip = scene.strips.find((x) => x.id === id)!;
        const tone = strip.of === 'river' ? 'water' : strip.of === 'far-town' ? 'far' : 'place';
        return { id, text: names === 'modern' && strip.modern ? strip.modern : strip.text, tone } as const;
      });
    },
  };
});

const { act } = await import('react');
const { createRoot } = await import('react-dom/client');
const { StagePane } = await import('../../../src/ui/StagePane');

const [FIRST, SECOND] = FIXTURE_HEADINGS;
const table = { kind: 'stop' as const, key: 'f/s', scene: fixtureScene(), terrainUrl: 't.bin' };
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const settle = (ms = 40) => act(async () => void (await sleep(ms)));
const attr = (el: MiniElement | null, name: string) => el?.getAttribute(name) ?? null;

async function mount(search: string) {
  win.location.search = search;
  const container = doc.createElement('div');
  doc.body.appendChild(container);
  const root = createRoot(container as any);
  let section: string | null = null;
  let reloads = 0;
  const render = () =>
    act(async () => {
      root.render(<StagePane onStopPage table={{ state: 'ready', value: table }} section={section} still={{ state: 'ready', value: null }} onReloadTable={() => (reloads += 1)} />);
    });
  await render();

  const pane = () => container.querySelector('.stage-pane')!;
  const q = (selector: string) => container.querySelector(selector);
  // 一路上看到的：沙盘栏说自己摆着哪一节、题记是哪一节的、替身实际摆着哪一节。每等一下记一笔。
  const seen: { pane: string | null; caption: string | null; fake: string | null }[] = [];
  const watch = () => seen.push({ pane: attr(pane(), 'data-stage-section'), caption: attr(q('.stage-caption'), 'data-section'), fake: attr(q('.fake-stage'), 'data-fake-section') });

  return {
    container,
    pane,
    q,
    all: (selector: string) => container.querySelectorAll(selector),
    read: (section_: string | null) => {
      section = section_;
      return render();
    },
    /** 等到 ok() 成立再往下走（最多等 ms 毫秒）。机器忙的时候定时器会晚，所以等的是结果，不是固定的一段时间。 */
    until: async (ok: () => boolean, ms = 8000) => {
      const end = Date.now() + ms;
      watch();
      while (!ok() && Date.now() < end) {
        await settle(20);
        watch();
      }
    },
    seen,
    requests: () => (attr(q('.fake-stage'), 'data-fake-requests') ?? '').split('|').filter(Boolean),
    unmount: () => act(async () => root.unmount()),
    reloads: () => reloads,
  };
}

describe('沙盘栏 + 替身 + 题签层', () => {
  it('摆出来、换小节、被顶掉、古今名、回到这一节、画面断了再摆', { timeout: 30_000 }, async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const page = await mount('?stage=fake');

    // 刚挂上：正在摆，有题记，没有“摆着哪一节”，还什么画面都没有。
    expect(attr(page.pane(), 'data-stage-state')).toBe('loading');
    expect(attr(page.pane(), 'data-stage-picture')).toBe('none');
    expect(attr(page.pane(), 'data-stage-section')).toBeNull();
    expect(attr(page.q('.stage-caption'), 'data-section')).toBe(FIRST);
    // 替身一下就摆好：“沙盘正在摆出来”那句话要等上一阵还没有画面才说，这里一次都不该出现（见下面专门的一项）。
    expect(page.q('.stage-loading')).toBeNull();
    // 几句话都换在一块一直都在的地方里（读屏软件才念得出来）；现在它是空的。
    const says = page.q('.stage-says')!;
    expect(attr(says, 'role')).toBe('status');
    expect(says.childNodes).toHaveLength(0);

    let saidLoading = false;
    await page.until(() => {
      saidLoading ||= page.q('.stage-loading') !== null;
      return attr(page.pane(), 'data-stage-state') === 'ready';
    });
    expect(saidLoading).toBe(false);
    expect(attr(page.pane(), 'data-stage-state')).toBe('ready');
    expect(attr(page.pane(), 'data-stage-picture')).toBe('table');
    expect(attr(page.pane(), 'data-stage-section')).toBe(FIRST);
    // 替身不给画质的读数，所以没有“哪一档画质”。
    expect(attr(page.pane(), 'data-stage-tier')).toBeNull();
    expect(page.q('.stage-loading')).toBeNull();
    expect(page.q('.stage-says')).toBe(says);
    expect(says.childNodes).toHaveLength(0);
    // 放画面的那一块里叠着两层：这座沙盘没有图片，下面那一层空着；上面那一层摆好了才显出来。
    expect(page.q('.stage-canvas .stage-still-host')?.childNodes).toHaveLength(0);
    expect(page.q('.stage-host')?.className).toBe('stage-host is-up');
    expect(page.q('.stage-canvas')?.className).toBe('stage-canvas');
    const fake = () => page.q('.fake-stage')!;
    expect(page.all('.fake-stage')).toHaveLength(1);
    expect(attr(fake(), 'data-fake-section')).toBe(FIRST);
    expect(attr(fake(), 'data-fake-animated')).toBe('false');
    expect(attr(fake(), 'data-fake-names')).toBe('ancient');
    expect(attr(fake(), 'data-fake-reduced-motion')).toBe('false');
    // 第一节是 create 摆的，没有叫过 showSection。
    expect(page.requests()).toEqual([]);
    // 留边：上面是按钮（8 + 44），下面是题记（600 − 500）。
    expect(attr(fake(), 'data-fake-insets')).toBe('52 0 100 0');
    // 指北和比例尺是直接写在元素上的，在题记的第一行里。
    expect(attr(page.q('.stage-caption-head .stage-north g'), 'transform')).toBe('rotate(30.0)');
    expect(page.q('.stage-caption-head .stage-scale-label')?.textContent).toBe('2 公里');
    expect(page.q('.stage-scale-bar')?.style.width).toBe('96px');
    // 题签：这一节的两条，都摆出来了。
    const strips = () => page.all('.stage-host .strip').map((el) => ({ id: attr(el, 'data-strip-id'), text: el.textContent, tone: attr(el, 'data-tone'), hidden: el.style.visibility === 'hidden' }));
    expect(strips()).toEqual([
      { id: 's-town', text: '样城', tone: 'place', hidden: false },
      { id: 's-river', text: '样水', tone: 'water', hidden: false },
    ]);
    expect(page.all('.stage-host .strip-leaders line')).toHaveLength(2);
    // “回到这一节”点不了（用的是 aria-disabled：点完它焦点不会掉）。
    const reset = () => page.q('.stage-reset')!;
    expect(attr(reset(), 'aria-disabled')).toBe('true');
    expect(reset().disabled).toBe(false);

    // ---- 题记：一句说明的两种写法都在，旁边是“说明”按钮；完整的几句话点了才展开，不动留边。
    expect(page.q('.stage-note-short')?.textContent).toBe('短');
    expect(page.q('.stage-note-brief')?.textContent).toBe('更短');
    const noteButton = () => page.q('.stage-note-button')!;
    expect(noteButton().textContent).toBe('说明');
    expect(attr(noteButton(), 'aria-expanded')).toBe('false');
    expect(page.q('.stage-note-panel')).toBeNull();
    const resizesBeforeNote = attr(fake(), 'data-fake-resizes');
    await act(async () => noteButton().click());
    expect(attr(noteButton(), 'aria-expanded')).toBe('true');
    expect(page.all('.stage-note-panel .stage-note-lines p').map((p) => p.textContent)).toEqual(['长一', '长二']);
    expect(attr(noteButton(), 'aria-controls')).toBe(attr(page.q('.stage-note-panel'), 'id'));
    expect(attr(fake(), 'data-fake-insets')).toBe('52 0 100 0');
    expect(attr(fake(), 'data-fake-resizes')).toBe(resizesBeforeNote);
    // 再点一下收起；按 Esc 收起；点“关闭”收起，焦点回到“说明”按钮上。
    await act(async () => noteButton().click());
    expect(page.q('.stage-note-panel')).toBeNull();
    await act(async () => noteButton().click());
    await act(async () => void doc.dispatchEvent({ type: 'keydown', key: 'Escape' }));
    expect(page.q('.stage-note-panel')).toBeNull();
    expect(attr(noteButton(), 'aria-expanded')).toBe('false');
    await act(async () => noteButton().click());
    page.q('.stage-note-close')!.focus();
    await act(async () => page.q('.stage-note-close')!.click());
    expect(page.q('.stage-note-panel')).toBeNull();
    expect(doc.activeElement).toBe(noteButton());
    // 展开着读到第二节：到了以后题记换了，展开的那一块也收起来了。
    await act(async () => noteButton().click());
    expect(page.q('.stage-note-panel')).not.toBeNull();

    // ---- 读到第二节：滑过去。镜头还在路上的时候，题记和“摆着哪一节”都还是第一节的；到了才换。
    page.seen.length = 0;
    await page.read(SECOND);
    expect(attr(page.pane(), 'data-stage-section')).toBe(FIRST);
    expect(attr(page.q('.stage-caption'), 'data-section')).toBe(FIRST);
    expect(page.requests()).toEqual([SECOND]);
    expect(attr(fake(), 'data-fake-animated')).toBe('true');
    expect(strips().every((s) => s.hidden)).toBe(true);
    await page.until(() => attr(page.pane(), 'data-stage-section') === SECOND);
    expect(attr(page.pane(), 'data-stage-section')).toBe(SECOND);
    // 一路上沙盘栏说的“摆着哪一节”、题记是哪一节的，都没有抢在替身前头。
    for (const moment of page.seen) {
      expect(moment.pane).toBe(moment.fake);
      expect(moment.caption).toBe(moment.fake);
    }
    expect(page.seen.some((moment) => moment.pane === FIRST)).toBe(true);
    expect(strips().every((s) => !s.hidden)).toBe(true);
    expect(attr(page.q('.stage-caption'), 'data-section')).toBe(SECOND);
    expect(attr(fake(), 'data-fake-section')).toBe(SECOND);
    expect(strips().map((s) => s.id)).toEqual(['s-town', 's-far']);
    expect(strips().map((s) => s.tone)).toEqual(['place', 'far']);
    expect(page.q('.stage-note-panel')).toBeNull();
    expect(attr(noteButton(), 'aria-expanded')).toBe('false');

    // ---- 途中被顶掉：先要第一节，马上又要第二节。被顶掉的那一次是“照常完成”的，
    // 可它不是最新的一次，沙盘栏不能就此说自己摆着第一节。
    page.seen.length = 0;
    await page.read(FIRST);
    await page.read(SECOND);
    expect(page.requests()).toEqual([SECOND, FIRST, SECOND]);
    expect(attr(page.pane(), 'data-stage-section')).toBe(SECOND);
    await page.until(() => attr(fake(), 'data-fake-section') === SECOND && attr(fake(), 'data-fake-animated') === 'true' && strips().every((s) => !s.hidden));
    await settle(380);
    expect(attr(page.pane(), 'data-stage-section')).toBe(SECOND);
    expect(attr(fake(), 'data-fake-section')).toBe(SECOND);
    expect(page.seen.every((moment) => moment.pane === SECOND && moment.caption === SECOND)).toBe(true);

    // ---- 不认识的小节（正文和场景的标题对不上）：留在原处，不叫沙盘动，不出错。
    await page.read('没有这一节');
    await settle(380);
    expect(attr(page.pane(), 'data-stage-section')).toBe(SECOND);
    expect(page.requests()).toEqual([SECOND, FIRST, SECOND]);

    // ---- 今名。
    const buttons = () => page.all('.names-switch button');
    await act(async () => buttons()[1].click());
    expect(attr(fake(), 'data-fake-names')).toBe('modern');
    expect(attr(buttons()[1], 'aria-pressed')).toBe('true');
    expect(attr(buttons()[0], 'aria-pressed')).toBe('false');
    expect(strips().map((s) => s.text)).toEqual(['样市', '远镇']);
    expect(strips().every((s) => !s.hidden)).toBe(true);

    // ---- 动一下镜头 → 回到这一节。点完它又点不了了，焦点还在它上面。
    await act(async () => page.q('.fake-stage-nudge')!.click());
    expect(attr(reset(), 'aria-disabled')).toBe('false');
    reset().focus();
    await act(async () => reset().click());
    expect(attr(reset(), 'aria-disabled')).toBe('true');
    expect(doc.activeElement).toBe(reset());
    await settle(380);
    expect(attr(page.pane(), 'data-stage-section')).toBe(SECOND);
    // 点不了的时候点它，不叫沙盘动（替身一动，题签就先藏起来）。
    expect(strips().every((s) => !s.hidden)).toBe(true);
    await act(async () => reset().click());
    expect(strips().every((s) => !s.hidden)).toBe(true);

    // ---- 窗口大小变了：告诉沙盘。
    const beforeResize = Number(attr(fake(), 'data-fake-resizes'));
    win.fire('resize');
    await page.until(() => Number(attr(fake(), 'data-fake-resizes')) > beforeResize);
    expect(Number(attr(fake(), 'data-fake-resizes'))).toBeGreaterThan(beforeResize);

    // ---- 收起（假的页面算窄屏）：告诉沙盘大小变了。收起的时候读到别的小节，不叫沙盘白跑；展开时直接摆过去，不滑。
    const before = Number(attr(fake(), 'data-fake-resizes'));
    await act(async () => page.q('.stage-fold')!.click());
    expect(page.pane().className).toContain('is-folded');
    expect(Number(attr(fake(), 'data-fake-resizes'))).toBeGreaterThan(before);
    await page.read(FIRST);
    await settle(380);
    expect(page.requests()).toEqual([SECOND, FIRST, SECOND]);
    expect(attr(fake(), 'data-fake-section')).toBe(SECOND);
    await act(async () => page.q('.stage-fold')!.click());
    expect(page.pane().className).not.toContain('is-folded');
    expect(page.requests()).toEqual([SECOND, FIRST, SECOND, FIRST]);
    expect(attr(fake(), 'data-fake-animated')).toBe('false');
    await page.until(() => attr(page.pane(), 'data-stage-section') === FIRST);
    expect(attr(page.pane(), 'data-stage-section')).toBe(FIRST);
    await page.read(SECOND);
    await page.until(() => attr(page.pane(), 'data-stage-section') === SECOND);
    expect(attr(page.pane(), 'data-stage-section')).toBe(SECOND);

    // ---- 画面断了：这一栏留在原处（还钉着），一句话和按钮；焦点原来在栏里的按钮上，就落到“重新摆出来”上。
    buttons()[1].focus();
    await act(async () => page.q('.fake-stage-lose')!.click());
    expect(attr(page.pane(), 'data-stage-state')).toBe('lost');
    expect(attr(page.pane(), 'data-stage-picture')).toBe('none');
    expect(attr(page.pane(), 'data-stage-section')).toBeNull();
    expect(page.pane().className).toBe('stage-pane is-pinned is-wide is-kai');
    expect(page.q('.stage-says')).toBe(says);
    expect(page.q('.stage-says .stage-message p')?.textContent).toBe('沙盘的画面断了。');
    expect(page.q('.fake-stage')).toBeNull();
    expect(page.all('.strip')).toHaveLength(0);
    expect(page.q('.stage-controls')).toBeNull();
    expect(attr(page.q('.stage-caption'), 'data-section')).toBe(SECOND);
    expect(page.q('.stage-retry')?.textContent).toBe('重新摆出来');
    expect(doc.activeElement).toBe(page.q('.stage-retry'));

    // ---- 重新摆出来：回到读到的那一节，今名还留着；焦点落在这一栏上，没有掉到页面外头。
    await act(async () => page.q('.stage-retry')!.click());
    expect(doc.activeElement).toBe(page.pane());
    expect(attr(page.pane(), 'tabindex')).toBe('-1');
    await page.until(() => attr(page.pane(), 'data-stage-state') === 'ready');
    expect(attr(page.pane(), 'data-stage-state')).toBe('ready');
    expect(attr(page.pane(), 'data-stage-section')).toBe(SECOND);
    expect(page.all('.fake-stage')).toHaveLength(1);
    expect(attr(fake(), 'data-fake-names')).toBe('modern');
    expect(attr(fake(), 'data-fake-animated')).toBe('false');

    // 关掉：容器里什么都不剩。
    await page.unmount();
    expect(page.container.childNodes).toHaveLength(0);
    expect(warn.mock.calls.some((call) => String(call[0]).includes('画面断了'))).toBe(true);
    warn.mockRestore();
  });

  it('栏的宽窄记在栏上：连边线 584 像素起挂 is-wide，栏里面 661 像素起再挂 is-kai，栏里面的宽度写成 --pane-w；窗口的大小变了就重写，重画也冲不掉；栏窄了比例尺换一段短的', { timeout: 30_000 }, async () => {
    const page = await mount('?stage=fake');
    const fake = () => page.q('.fake-stage')!;
    await page.until(() => attr(page.pane(), 'data-stage-state') === 'ready');
    const shape = () => ({ cls: page.pane().className, w: page.pane().style.getPropertyValue('--pane-w'), scale: page.q('.stage-scale-label')?.textContent, bar: page.q('.stage-scale-bar')?.style.width });
    // 假的页面上这一栏 800 像素宽：宽的排法，题记用楷体；比例尺是沙盘报来的那一段。
    expect(shape()).toEqual({ cls: 'stage-pane is-pinned is-wide is-kai', w: '800px', scale: '2 公里', bar: '96px' });
    // 把栏改成这么宽，再告诉页面窗口的大小变了。
    const resizeTo = async (width: number) => {
      page.pane().box.width = width;
      const before = Number(attr(fake(), 'data-fake-resizes'));
      win.fire('resize');
      await page.until(() => Number(attr(fake(), 'data-fake-resizes')) > before);
    };
    // 660：还是宽的排法，题记不到 16px，不用楷体。
    await resizeTo(660);
    expect(shape()).toEqual({ cls: 'stage-pane is-pinned is-wide', w: '660px', scale: '2 公里', bar: '96px' });
    await resizeTo(661);
    expect(shape().cls).toBe('stage-pane is-pinned is-wide is-kai');
    // 584：宽的排法的下限（横着拿的平板）。583：窄的排法，比例尺换成不超过 56 像素的一段。
    await resizeTo(584);
    expect(shape()).toEqual({ cls: 'stage-pane is-pinned is-wide', w: '584px', scale: '2 公里', bar: '96px' });
    await resizeTo(583);
    expect(shape()).toEqual({ cls: 'stage-pane is-pinned', w: '583px', scale: '1 公里', bar: '48px' });
    // 重画会把类名整个重写（收起、展开）：重画完，栏的宽窄还记在上面。
    await resizeTo(700);
    await act(async () => page.q('.stage-fold')!.click());
    expect(page.pane().className).toBe('stage-pane is-pinned is-folded is-wide is-kai');
    await act(async () => page.q('.stage-fold')!.click());
    expect(shape()).toEqual({ cls: 'stage-pane is-pinned is-wide is-kai', w: '700px', scale: '2 公里', bar: '96px' });
    await page.unmount();
  });

  it('第一个画面摆好了、还没报告“摆好了”的空当里读到了第二节：报告摆好的时候，沙盘栏说的还是第一节，到了才换', { timeout: 30_000 }, async () => {
    // 替身在这个空当里收到的指令是滑过去的（300 毫秒），空当拉长到 150 毫秒：报告“摆好了”的时候镜头还在路上。
    const page = await mount('?stage=fake&readygap=150');
    const fake = () => page.q('.fake-stage');
    await page.until(() => attr(fake(), 'data-fake-started') === 'true');
    expect(attr(page.pane(), 'data-stage-state')).toBe('loading');
    await page.read(SECOND);
    expect(page.requests()).toEqual([SECOND]);
    expect(attr(fake(), 'data-fake-animated')).toBe('true');

    page.seen.length = 0;
    await page.until(() => attr(page.pane(), 'data-stage-state') === 'ready');
    // 报告“摆好了”的这一刻，替身还摆着第一节。
    expect(attr(fake(), 'data-fake-section')).toBe(FIRST);
    expect(attr(page.pane(), 'data-stage-section')).toBe(FIRST);
    expect(attr(page.q('.stage-caption'), 'data-section')).toBe(FIRST);
    await page.until(() => attr(page.pane(), 'data-stage-section') === SECOND);
    expect(attr(page.pane(), 'data-stage-section')).toBe(SECOND);
    expect(attr(page.q('.stage-caption'), 'data-section')).toBe(SECOND);
    // 摆好以后的一路上，沙盘栏说的都是替身实际摆着的那一节。
    for (const moment of page.seen.filter((m) => m.pane !== null)) expect(moment.pane).toBe(moment.fake);
    await page.unmount();
  });

  it('起不来：一句话和再试一次，题记跟着读到的小节换；再试一次以后焦点还在栏里的按钮上', { timeout: 30_000 }, async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const page = await mount('?stage=fake-fail');
    await page.until(() => attr(page.pane(), 'data-stage-state') === 'failed');
    expect(attr(page.pane(), 'data-stage-state')).toBe('failed');
    expect(attr(page.pane(), 'data-stage-section')).toBeNull();
    expect(page.pane().className).toBe('stage-pane is-wide is-kai');
    expect(page.q('.stage-says .stage-message p')?.textContent).toBe('沙盘没能摆出来，正文可以照常读。');
    expect(page.q('.stage-retry')?.textContent).toBe('再试一次');
    expect(page.q('.stage-controls')).toBeNull();
    expect(page.q('.stage-host')).toBeNull();
    expect(attr(page.q('.stage-caption'), 'data-section')).toBe(FIRST);
    // 沙盘是一打开页面就没起来的，读者没碰过这一栏：不抢焦点。
    expect(doc.activeElement).toBeNull();
    const told = () => warn.mock.calls.filter((call) => String(call[0]).includes('没能摆出来') && String(call[1]).includes('按要求起不来')).length;
    expect(told()).toBe(1);

    await page.read(SECOND);
    expect(attr(page.q('.stage-caption'), 'data-section')).toBe(SECOND);
    // 起不来的时候题记和“说明”也照样能用：展开的那一块接在题记下面。
    await act(async () => page.q('.stage-note-button')!.click());
    expect(page.all('.stage-note-panel .stage-note-lines p')).toHaveLength(2);
    await act(async () => page.q('.stage-note-button')!.click());
    expect(page.q('.stage-note-panel')).toBeNull();

    page.q('.stage-retry')!.focus();
    await act(async () => page.q('.stage-retry')!.click());
    await page.until(() => told() === 2 && attr(page.pane(), 'data-stage-state') === 'failed');
    expect(attr(page.pane(), 'data-stage-state')).toBe('failed');
    expect(told()).toBe(2);
    expect(page.reloads()).toBe(0);
    // 新的一座还是没起来：焦点落在新的“再试一次”上，没有掉到页面外头。
    expect(doc.activeElement).toBe(page.q('.stage-retry'));
    expect(page.pane().contains(doc.activeElement)).toBe(true);
    await page.unmount();
    warn.mockRestore();
  });

  it('画不了：一句大白话，没有按钮', { timeout: 30_000 }, async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const page = await mount('?stage=fake-unsupported');
    await page.until(() => attr(page.pane(), 'data-stage-state') === 'unsupported');
    expect(attr(page.pane(), 'data-stage-state')).toBe('unsupported');
    expect(page.q('.stage-message p')?.textContent).toContain('这个浏览器画不出立体的沙盘。');
    expect(page.q('.stage-retry')).toBeNull();
    expect(page.q('.stage-controls')).toBeNull();
    expect(page.pane().textContent.toLowerCase()).not.toContain('webgl');
    expect(attr(page.q('.stage-caption'), 'data-section')).toBe(FIRST);
    expect(warn.mock.calls.some((call) => String(call[1]) === 'no-webgl2')).toBe(true);
    await page.unmount();
    warn.mockRestore();
  });

  it('不带 ?stage 时走真的那条路：假的页面画不了立体的沙盘，页面先问了一句就知道，沙盘栏照着说，页面不坏', { timeout: 30_000 }, async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const page = await mount('');
    // 页面在下载沙盘程序（three.js）之前先问浏览器画不画得了：画不了就不下载，所以很快就有结果
    await page.until(() => attr(page.pane(), 'data-stage-state') !== 'loading', 20_000);
    expect(attr(page.pane(), 'data-stage-state')).toBe('unsupported');
    expect(attr(page.pane(), 'data-stage-picture')).toBe('none');
    expect(page.q('.stage-message p')?.textContent).toContain('这个浏览器画不出立体的沙盘。');
    expect(page.q('.stage-retry')).toBeNull();
    expect(page.q('.stage-host')).toBeNull();
    expect(warn.mock.calls.some((call) => String(call[1]) === 'no-webgl2')).toBe(true);
    await page.unmount();
    warn.mockRestore();
  });

  it('“沙盘正在摆出来”：等了一秒半还什么画面都没有才说；画面出来就收掉；沙盘的数据还在读的时候也一样', { timeout: 30_000 }, async () => {
    // 替身拖到 2.4 秒才报告摆好。钟点在打开页面之前记：那一秒半是从页面一打开数起的。
    const started = Date.now();
    const page = await mount('?stage=fake&readygap=2400');
    const says = page.q('.stage-says')!;
    expect(page.q('.stage-loading')).toBeNull();
    await settle(900);
    expect(attr(page.pane(), 'data-stage-state')).toBe('loading');
    expect(page.q('.stage-loading')).toBeNull();
    // 过了一秒半：说了，说在那一块一直都在的地方里。
    await page.until(() => page.q('.stage-loading') !== null);
    expect(Date.now() - started).toBeGreaterThanOrEqual(1400);
    expect(attr(page.pane(), 'data-stage-state')).toBe('loading');
    expect(says.querySelector('.stage-loading')?.textContent).toBe('沙盘正在摆出来，要等一会儿…');
    // 摆好了：那句话没有了。
    await page.until(() => attr(page.pane(), 'data-stage-state') === 'ready');
    expect(attr(page.pane(), 'data-stage-state')).toBe('ready');
    expect(page.q('.stage-loading')).toBeNull();
    expect(page.q('.stage-says')).toBe(says);
    await page.unmount();

    // 沙盘的数据（场景文件）还在读：也是先不说，过了一秒半才说。
    const container = doc.createElement('div');
    doc.body.appendChild(container);
    const root = createRoot(container as any);
    await act(async () => {
      root.render(<StagePane onStopPage table={{ state: 'loading' }} section={null} still={{ state: 'ready', value: null }} onReloadTable={() => {}} />);
    });
    const pane = () => container.querySelector('.stage-pane')!;
    expect(attr(pane(), 'data-stage-state')).toBe('loading');
    expect(attr(pane(), 'data-stage-picture')).toBe('none');
    expect(attr(container.querySelector('.stage-says'), 'role')).toBe('status');
    expect(container.querySelector('.stage-loading')).toBeNull();
    await settle(900);
    expect(container.querySelector('.stage-loading')).toBeNull();
    await settle(800);
    expect(container.querySelector('.stage-says .stage-loading')?.textContent).toBe('沙盘正在摆出来，要等一会儿…');
    // 数据读出来了、沙盘接着摆：那一秒半不从头数，已经等够了，沙盘还没画面，那句话接着说。
    win.location.search = '?stage=fake&readygap=600';
    await act(async () => {
      root.render(<StagePane onStopPage table={{ state: 'ready', value: table }} section={null} still={{ state: 'ready', value: null }} onReloadTable={() => {}} />);
    });
    await settle(100);
    expect(attr(pane(), 'data-stage-state')).toBe('loading');
    expect(container.querySelector('.stage-loading')).not.toBeNull();
    for (let i = 0; i < 200 && attr(pane(), 'data-stage-state') !== 'ready'; i += 1) await settle(20);
    expect(attr(pane(), 'data-stage-state')).toBe('ready');
    expect(container.querySelector('.stage-loading')).toBeNull();
    await act(async () => root.unmount());
  });

  it('?debug=1：读数挂在 window 上，关掉时拿走', { timeout: 30_000 }, async () => {
    const page = await mount('?stage=fake&debug=1');
    await page.until(() => typeof win.__stageReadout === 'function');
    expect(win.__stageReadout()).toEqual({ triangles: 0, drawCalls: 0 });
    await page.unmount();
    expect(win.__stageReadout).toBeUndefined();
  });
});
