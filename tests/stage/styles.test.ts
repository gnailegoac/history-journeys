// 时代样式的登记表（src/stage/styles.ts）和照它取样式的那个入口（src/stage/three/style/index.ts）。
// 样式不在沙盘程序里：摆写着它的沙盘时才取；一种样式分两半，全程沙盘只取每一座沙盘都用的那一半，站点沙盘取整套。这里查的是不靠浏览器的那一半——
// 登记表里的每一行取得到、取到的就是它那种样式；content/ 里每一座沙盘写的样式表里都有；
// 不摆沙盘的测试和做图的工具用的那张现成的表（tests/stage/support/styles.ts）和登记表是同一份；
// 没有登记的、没取到的，取的人得到一句说得出缘故的话，再取一遍是重新取。
// 构建出来以后它是不是单独的一块、多大，在 tests/build/dist-size.test.ts；样式的请求断了、压住的时候页面什么样，在 tests/e2e/style-chunk.spec.ts。

import { describe, expect, it } from 'vitest';
import type { TableScene } from '../../src/domain/scene';
import type { TableStyle } from '../../src/stage/three/internal';
import { STYLES } from '../../src/stage/styles';
import { loadStyle, provideStyles, wholeStyle, type StyleEntry } from '../../src/stage/three/style';
import { STAND_REACH, STAND_REACH_Y, buildTable } from '../../src/stage/three/style/song-qinglv/stand';
import { MADE_UP_STYLES, MADE_UP_STYLE_ID, style as madeUpHalf } from './support/madeUpStyle';
import { STYLE_IDS, WHOLE_STYLE_IDS, loadStyles, styleFor } from './support/styles';

/**
 * “每一行”的几条查的行：登记表里的每一行，再加上测试里编出来的那一行（./support/madeUpStyle.ts）。
 * 编出来的那一行没有 load（只有全程沙盘用的样式）：登记表里现在没有这样的一行，“没有 load 的一行怎么查”就靠它跑到。
 */
const EVERY_ROW: readonly StyleEntry[] = [...STYLES, ...MADE_UP_STYLES];
/** 一行取得到的东西：有整套的取整套，没有的取它仅有的那一半。 */
const got = async (row: StyleEntry): Promise<TableStyle> => (row.load ? await row.load() : await row.loadRoute()).style;

const sceneFiles = import.meta.glob<TableScene>('/content/figures/*/scenes/*.json', { import: 'default', eager: true });
/** 每一种样式里全程沙盘取的那一半的源文件，原样的字。 */
const HALF_FILES = import.meta.glob<string>('/src/stage/three/style/*/*-route.ts', { query: '?raw', import: 'default', eager: true });

describe('时代样式的登记表', () => {
  // 2026-11-26 一行可以没有 load 以前，这一条的名字是“一行一种：名字不重复，是文件夹起得了的名字；取得到，取到的东西的名字就是这一行的名字”，
  // 只走登记表、只叫 load。现在连编出来的那一行（没有 load）一起走：有整套的取整套，没有的取那一半；那一半每一行都取一遍。查的几样没有少。
  it('一行一种：名字不重复，是文件夹起得了的名字；取得到（有整套的取整套，只有全程沙盘用的取它那一半），取到的东西的名字就是这一行的名字；每一行的那一半都取得到', async () => {
    expect(STYLES.length).toBeGreaterThan(0);
    const ids = EVERY_ROW.map((row) => row.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const row of EVERY_ROW) {
      expect(row.id).toMatch(/^[a-z][a-z0-9-]*$/);
      const style = await got(row);
      expect(style.id).toBe(row.id);
      // 再取一遍是同一份（拍照的那一页改的、沙盘拿到的是同一个东西）
      expect(await got(row)).toBe(style);
      // 每一座沙盘都用的那一半，哪一行都有
      expect((await row.loadRoute()).style.id).toBe(row.id);
    }
    // 苏轼的四座沙盘用的那一种在表里，是整套的；编出来的那一行不在登记表里，它没有 load
    expect(STYLES.map((row) => row.id)).toContain('song-qinglv');
    expect(WHOLE_STYLE_IDS).toContain('song-qinglv');
    expect(STYLE_IDS).not.toContain(MADE_UP_STYLE_ID);
    expect(MADE_UP_STYLES.map((row) => 'load' in row)).toEqual([false]);
  });

  it('content/ 里每一座沙盘写的样式，登记表里都有', () => {
    const keys = Object.keys(sceneFiles);
    expect(keys.length).toBeGreaterThan(0);
    const ids = STYLES.map((row) => row.id);
    for (const key of keys) expect(ids, `${key} 写的样式“${sceneFiles[key].style}”`).toContain(sceneFiles[key].style);
  });

  // 2026-11-26 以前这一条只叫每一行的 load；现在没有 load 的一行比的是它那一半（登记表里还没有这样的一行）。
  it('不摆沙盘的测试和做图的工具用的那张现成的表，和登记表是同一份：同样的几种，取到的是同一个东西；表里没有的说得出', async () => {
    expect(STYLE_IDS).toEqual(STYLES.map((row) => row.id));
    for (const row of STYLES) expect(styleFor(row.id)).toBe(await got(row));
    expect(() => styleFor('zz-none')).toThrow(/^样式“zz-none”登记表里没有（src\/stage\/styles\.ts）；有的是：/);
    // 整套的那几种：那一行有 load 的
    expect(WHOLE_STYLE_IDS).toEqual(STYLES.filter((row) => row.load).map((row) => row.id));
  });

  it('那张现成的表碰到没有 load 的一行（只有全程沙盘用的样式）：不停下，取到的是它仅有的那一半；有 load 的一行照旧取整套，那一半不去要', async () => {
    // 编出来的那一行：没有 load。取那张表的那个函数（文件一读进来就照登记表跑的就是它）不拒绝，交出来的是那一半
    const made = await loadStyles(MADE_UP_STYLES);
    expect([...made.keys()]).toEqual([MADE_UP_STYLE_ID]);
    expect(made.get(MADE_UP_STYLE_ID)).toBe(madeUpHalf);
    // 那一半里没有站点沙盘才用的几样：拿它当整套读，读到的是 undefined
    expect(made.get(MADE_UP_STYLE_ID)?.ground).toBeUndefined();
    // 两行的表：一行有 load，一行没有；各取各的，有 load 的那一行不去要那一半
    const asked: string[] = [];
    const whole = styleFor('song-qinglv');
    const rows: StyleEntry[] = [
      {
        id: 'style-whole',
        load: () => (asked.push('整套'), Promise.resolve({ style: { ...whole, id: 'style-whole' } })),
        loadRoute: () => (asked.push('整套那一行的一半'), Promise.resolve({ style: { ...whole, id: 'style-whole' } })),
      },
      { id: 'style-half', loadRoute: () => (asked.push('一半'), Promise.resolve({ style: { ...madeUpHalf, id: 'style-half' } })) },
    ];
    const both = await loadStyles(rows);
    expect([...both.keys()]).toEqual(['style-whole', 'style-half']);
    expect(asked).toEqual(['整套', '一半']);
    expect(both.get('style-half')?.id).toBe('style-half');
  });
});

describe('宋代青绿设色（song-qinglv）：从沙盘程序里搬进这种样式的数，一个字不差', () => {
  const song = styleFor('song-qinglv');

  it('留白的边：抹开 40 公里；西边打散的那七个数（原来写在 src/stage/ground/route.ts 里）', () => {
    // 地面的凭证（tests/stage/su-shi-witness.test.ts）比的是算出来的地面：抹开的宽度要差出一整格、打散的度数要差到千分之一以上才看得出来。
    // 所以这几个数另在这里一个字不差地记着：改了哪一个，这一条不通过。
    expect(song.route?.blank).toEqual({
      blurM: 40_000,
      torn: { westOf: [106.3, 107.7], eastDeg: 0.4, westDeg: 0.6, latDeg: 0.6, again: 0.45, valleyWestOf: [105.2, 106.2] },
    });
    // 一样不多，一样不少
    expect(Object.keys(song.route?.blank ?? {}).sort()).toEqual(['blurM', 'torn']);
    expect(Object.keys(song.route?.blank.torn ?? {}).sort()).toEqual(['again', 'eastDeg', 'latDeg', 'valleyWestOf', 'westDeg', 'westOf']);
  });

  it('装裱和座子：最宽的那一圈比沙盘的边多出 976 米，下沿在 −610 米（原来是 src/stage/three/table.ts 的 STAND_REACH、STAND_REACH_Y）；造法就是搬过来的那一个', () => {
    expect([song.stand.reachM, song.stand.reachY]).toEqual([976, -610]);
    expect([STAND_REACH, STAND_REACH_Y]).toEqual([976, -610]);
    expect(song.stand.build).toBe(buildTable);
  });

  it('全程沙盘的那一份里只有沙盘程序用的几样：给地面上色的数不在发给读者的样式里', () => {
    expect(Object.keys(song.route ?? {}).sort()).toEqual(['blank', 'reducedSegmentTimes', 'ripplePx', 'roads', 'segmentM']);
  });
});

describe('一种样式分两半：每一座沙盘都用的一半，站点沙盘才用的一半', () => {
  /** 站点沙盘才用的那几样。 */
  const STOP_ONLY = ['ground', 'figure', 'stripLift', 'stripLiftByClass'];
  /** 全程沙盘摆的时候从颜色里读的那七种（地形板的侧面和水纹，雾和云气，装裱和座子的三种）。 */
  const COMMON_COLOURS = ['blockSide', 'brocade', 'brocadeFig', 'fog', 'mist', 'ripple', 'sandal'];

  // 2026-11-26 夜里的一套灯搬到站点沙盘才用的那一半以前，这一条的名字里没有括号里的那一句：那时两边的 light 是同一个函数。
  // 现在整套的 light 是它自己的（多了夜里的一套），白天交出来的还是那一半里的那一盏——同一个东西；别的几样查的没有变。
  // 2026-11-26 一行可以没有 load 以前，这一条的名字是“登记表里每一种：那一半里没有站点沙盘才用的几样；整套里每一样都有，那一半里有的东西整套里是同一个
  // （灯：白天两边交的是同一盏）；颜色那七种两边一样”。现在连编出来的那一行一起走：没有 load 的一行只有前一句可查（它没有整套），有 load 的一行查的和原来一样。
  it('每一行（登记表里的，和编出来的那一行）：那一半里没有站点沙盘才用的几样；有整套的，整套里每一样都有，那一半里有的东西整套里是同一个（灯：白天两边交的是同一盏），颜色那七种两边一样；只有全程沙盘用的那一行没有整套，只查前一句', async () => {
    const withWhole: string[] = [];
    for (const row of EVERY_ROW) {
      const halfStyleOf = (await row.loadRoute()).style;
      const half = halfStyleOf as unknown as Record<string, unknown>;
      for (const name of STOP_ONLY) expect(half[name], `${row.id} 的那一半里的 ${name}`).toBeUndefined();
      // 只有全程沙盘用的样式：没有整套，到这里为止
      if (!row.load) continue;
      withWhole.push(row.id);
      const wholeStyleOf = (await row.load()).style;
      const whole = wholeStyleOf as unknown as Record<string, unknown>;
      for (const name of STOP_ONLY.slice(0, 3)) expect(whole[name], `${row.id} 整套里的 ${name}`).toBeDefined();
      for (const name of Object.keys(half)) {
        if (name === 'palette') continue;
        // 灯：整套的可以另有夜里的一套；白天交出来的是那一半里的那一盏
        if (name === 'light') expect(wholeStyleOf.light('day'), `${row.id} 白天的灯`).toBe(halfStyleOf.light('day'));
        else expect(whole[name], `${row.id} 的 ${name}`).toBe(half[name]);
      }
      const halfColours = half.palette as Record<string, string>;
      const wholeColours = whole.palette as Record<string, string>;
      for (const [name, colour] of Object.entries(halfColours)) expect(wholeColours[name], `${row.id} 的颜色 ${name}`).toBe(colour);
      expect(Object.keys(wholeColours).length).toBeGreaterThanOrEqual(Object.keys(halfColours).length);
    }
    // 两条路都真的走到了：登记表里整套的每一种查了后半句；编出来的那一行（没有 load）只查了前一句
    expect(withWhole).toEqual(WHOLE_STYLE_IDS);
    expect(EVERY_ROW.filter((row) => !row.load).map((row) => row.id)).toContain(MADE_UP_STYLE_ID);
  });

  it('宋代青绿设色：那一半里的颜色正好是全程沙盘读的七种，一个字不差；整套里的颜色一种没有少（五十七种，和分开以前一样多）', async () => {
    const row = STYLES.find((one) => one.id === 'song-qinglv');
    if (!row) throw new Error('登记表里没有 song-qinglv');
    const half = (await row.loadRoute()).style;
    expect(half.palette).toEqual({ ripple: '#f7f3e6', mist: '#f3ecdb', brocade: '#e4d8ba', brocadeFig: '#c9b88e', blockSide: '#c2a97c', sandal: '#33201b', fog: '#ece3cf' });
    expect(Object.keys(half.palette).sort()).toEqual(COMMON_COLOURS);
    expect(Object.keys(half).sort()).toEqual(['fogFor', 'id', 'light', 'mistFor', 'palette', 'piece', 'route', 'stand']);
    const whole = styleFor('song-qinglv');
    expect(Object.keys(whole.palette)).toHaveLength(57);
    expect(Object.keys(whole).sort()).toEqual(['figure', 'fogFor', 'ground', 'id', 'light', 'mistFor', 'palette', 'piece', 'route', 'stand', 'stripLift', 'stripLiftByClass']);
  });

  it('全程沙盘没有夜：登记表里每一种，那一半里的灯问哪一种天色给的都是白天那一盏，夜里才有的几样一样没有；宋代青绿设色那一半的文件里夜里的数一个也没有，整套里夜里的一套还在', async () => {
    const moon = { azimuth: 103, altitude: 12 };
    /** 只有夜里的灯才写的几样（src/stage/three/internal.ts 的 LightSpec）。 */
    const NIGHT_ONLY = ['fog', 'mist', 'mistStrength', 'sheen'];
    // 连编出来的那一行（只有全程沙盘用的样式）一起走：它的那一半也只有白天的一盏
    for (const row of EVERY_ROW) {
      const half = (await row.loadRoute()).style;
      const day = half.light('day');
      expect(half.light('night', moon), `${row.id} 的那一半，夜里问它`).toBe(day);
      expect(half.light('night'), `${row.id} 的那一半，夜里问它、不写月亮`).toBe(day);
      for (const name of NIGHT_ONLY) expect((day as unknown as Record<string, unknown>)[name], `${row.id} 的那一半里的 ${name}`).toBeUndefined();
    }
    // 宋代青绿设色：夜里的那一套数（月光、天色、地色、夜里的雾和云气，两头的强弱，水面亮几倍；tests/stage/rig.test.ts 里一个字不差地记着）
    // 在那一半的文件里一个也找不到——全程沙盘下载的那一小块里没有它们；整套的样式照样交得出夜里的一套
    const text = HALF_FILES['/src/stage/three/style/song-qinglv/song-qinglv-route.ts'];
    expect(text, '那一半的文件没有读到').toBeTypeOf('string');
    for (const value of ['#aac4f3', '#95b3ec', '#42527a', '#d5deea', '#dfe6ee', '1.495', '1.344', '1.17', '0.96', '9.1', 'moonDir', 'sheenFor']) {
      expect(text.includes(value), `song-qinglv-route.ts 里还写着夜里的 ${value}`).toBe(false);
    }
    const whole = styleFor('song-qinglv');
    const night = whole.light('night', moon);
    expect(night).not.toBe(whole.light('day'));
    expect([night.sunColor, night.sky, night.ground, night.fog, night.mist, night.mistStrength, night.sheen]).toEqual(['#aac4f3', '#95b3ec', '#42527a', '#d5deea', '#dfe6ee', 0.8, 9.1]);
    // 不写月亮的夜，整套的也是白天那一盏（搬以前就是这样）
    expect(whole.light('night')).toBe(whole.light('day'));
  });

  // 2026-11-26 以前取的是登记表的头一行（STYLES[0]）；现在取的是表里头一种整套的样式（今天还是那一行）：一行可以没有 load 了。
  it('拿着只取了一半的样式摆站点沙盘：说一句就停；整套的原样交回来', async () => {
    const row = STYLES.find((one) => one.load);
    if (!row?.load) throw new Error('登记表里没有一种整套的样式');
    const half = (await row.loadRoute()).style;
    expect(() => wholeStyle(half)).toThrow(`样式“${row.id}”只取了全程沙盘用的那一半，摆不了站点沙盘`);
    const whole = (await row.load()).style;
    expect(wholeStyle(whole)).toBe(whole);
  });
});

describe('只有全程沙盘用的样式：登记表里的一行可以没有 load（在编出来的那一行上试）', () => {
  it('照这张单子给全程沙盘取它：取得到，就是那一半；给站点沙盘取它：拒绝，话里说了这一行缺什么、场景文件怎么改，那一半没有被拿去顶替', async () => {
    let asked = 0;
    const rows: StyleEntry[] = MADE_UP_STYLES.map((row) => ({ ...row, loadRoute: () => (asked++, row.loadRoute()) }));
    expect(await loadStyle(MADE_UP_STYLE_ID, 'route', rows)).toBe(madeUpHalf);
    expect(asked).toBe(1);
    await expect(loadStyle(MADE_UP_STYLE_ID, 'stop', rows)).rejects.toThrow(`样式“${MADE_UP_STYLE_ID}”只有全程沙盘用的那一半（登记的这一行没有 load），摆不了站点沙盘：场景文件的 style 换一种两半都有的样式`);
    // 给站点沙盘取的那一回，那一半一次也没有去要
    expect(asked).toBe(1);
    // 没有登记的还是原来那一句（先查在不在表里）
    await expect(loadStyle('style-c', 'stop', rows)).rejects.toThrow('样式“style-c”的程序没有登记，沙盘没能摆出来');
  });

  it('登记表里有 load 的一行：给站点沙盘取的是整套，和原来一样', async () => {
    for (const id of WHOLE_STYLE_IDS) expect(await loadStyle(id, 'stop', STYLES)).toBe(styleFor(id));
    expect(WHOLE_STYLE_IDS.length).toBeGreaterThan(0);
  });
});

describe('照登记表取一种样式（沙盘程序里的那个入口）', () => {
  /** 一张编出来的登记表：两种样式，名字是编的，东西借现成的一种；取了几次记下来。 */
  const real = styleFor(STYLES[0].id);
  const made = (): { list: StyleEntry[]; asked: string[] } => {
    const asked: string[] = [];
    const row = (id: string): StyleEntry => ({
      id,
      load: () => {
        asked.push(id);
        return Promise.resolve({ style: { ...real, id } });
      },
      loadRoute: () => {
        asked.push(`${id} 的一半`);
        return Promise.resolve({ style: { ...real, id } });
      },
    });
    return { list: [row('style-a'), row('style-b')], asked };
  };

  it('取哪一种就只取哪一种：另一种的程序不去要', async () => {
    const { list, asked } = made();
    expect((await loadStyle('style-b', 'stop', list)).id).toBe('style-b');
    expect(asked).toEqual(['style-b']);
    // 给全程沙盘取：只取那一半，整套的那一块不去要
    expect((await loadStyle('style-a', 'route', list)).id).toBe('style-a');
    expect(asked).toEqual(['style-b', 'style-a 的一半']);
  });

  it('登记表里没有这种样式：拒绝，话里有它的名字；还没有交登记表的时候也是这一句', async () => {
    const { list, asked } = made();
    await expect(loadStyle('style-c', 'stop', list)).rejects.toThrow('样式“style-c”的程序没有登记，沙盘没能摆出来');
    await expect(loadStyle('style-c', 'route', list)).rejects.toThrow('样式“style-c”的程序没有登记，沙盘没能摆出来');
    expect(asked).toEqual([]);
    provideStyles([]);
    try {
      await expect(loadStyle(STYLES[0].id, 'stop')).rejects.toThrow(`样式“${STYLES[0].id}”的程序没有登记，沙盘没能摆出来`);
      // 交了以后，不写第二个参数用的就是交进来的那一张
      provideStyles(list);
      expect((await loadStyle('style-a', 'stop')).id).toBe('style-a');
    } finally {
      provideStyles([]);
    }
  });

  it('它的程序没有取到：拒绝，缘故原样带出来；再取一遍是重新取（不记着上一回的失败），取到了就给', async () => {
    let cut = true;
    let asked = 0;
    const list: StyleEntry[] = [
      {
        id: 'style-a',
        load: () => {
          asked++;
          return cut ? Promise.reject(new Error('网断了')) : Promise.resolve({ style: { ...real, id: 'style-a' } });
        },
        loadRoute: () => Promise.reject(new Error('这一条不取那一半')),
      },
    ];
    await expect(loadStyle('style-a', 'stop', list)).rejects.toThrow('网断了');
    await expect(loadStyle('style-a', 'stop', list)).rejects.toThrow('网断了');
    expect(asked).toBe(2);
    cut = false;
    expect((await loadStyle('style-a', 'stop', list)).id).toBe('style-a');
    expect(asked).toBe(3);
  });
});
