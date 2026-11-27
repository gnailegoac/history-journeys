// 歌德的全程沙盘：各趟路写的先后有没有动过。
// 哪一节画哪些路是照 roads.journeys 里写的先后算的（docs/data-spec.md“写的先后就是走的先后”）。有行迹的人物，行迹是另一个见证；
// 歌德现在还没有行迹，写的先后对不对没有别的东西管着，所以把这 125 趟的 id 照先后钉在这里：
// 挪了一趟、添了一趟、改了一趟的名字，这里就停下来——要改，得连这张单子一起改，改的人就知道自己动了先后。
// 单子证明的是“先后还是当初照路线记录一趟一趟核过的那个”，不是“先后就是走的先后”；旁边另查一件看得出来的事：每一趟的时间都以年份开头，年份一路不往回走。
// 等他的行迹进来（那时候规则 22 管着先后），这个文件就可以去掉。
import { describe, expect, it } from 'vitest';
import type { RouteScene } from '../../src/domain/scene';
import { readBytes } from '../support/readBytes';

const scene = JSON.parse(new TextDecoder().decode(readBytes('content/figures/goethe/scenes/route.json'))) as RouteScene;

/** 125 趟路的 id，照文件里写的先后。 */
const ORDER = [
  'j-1765-leipzig-out', 'j-1768-leipzig-back', 'j-1770-strasbourg-out', 'j-1770-saarbruecken-ride', 'j-1771-strasbourg-back', 'j-1772-wetzlar-out', 'j-1772-lahn',
  'j-1772-rhine-home', 'j-1772-darmstadt-out', 'j-1772-darmstadt-back', 'j-1774-rhine-out', 'j-1774-rhine-back', 'j-1774-ems-home', 'j-1775-swiss-out',
  'j-1775-swiss-back', 'j-1775-heidelberg', 'j-1775-weimar', 'j-1776-woerlitz-out', 'j-1776-woerlitz-back', 'j-1777-harz-out', 'j-1777-harz-back', 'j-1778-berlin-out',
  'j-1778-berlin-back', 'j-1779-swiss-out', 'j-1779-swiss-on', 'j-1779-swiss-back', 'j-1783-harz-out', 'j-1783-harz-back', 'j-1784-eisenach-out', 'j-1784-eisenach-back',
  'j-1784-harz-out', 'j-1784-harz-back', 'j-1785-karlsbad-out', 'j-1785-karlsbad-back', 'j-1786-karlsbad', 'j-1786-rome', 'j-1787-naples', 'j-1787-sicily-out',
  'j-1787-sicily-back', 'j-1787-rome-back', 'j-1788-home', 'j-1790-venice-out', 'j-1790-venice-back', 'j-1790-mantua-home', 'j-1790-silesia-out', 'j-1790-krakau-out',
  'j-1790-krakau-back', 'j-1790-silesia-back', 'j-1792-campaign-out', 'j-1792-campaign-back', 'j-1792-home', 'j-1793-mainz-out', 'j-1793-mainz-back',
  'j-1794-dresden-out', 'j-1794-dresden-back', 'j-1795-karlsbad-out', 'j-1795-karlsbad-back', 'j-1797-swiss-out', 'j-1797-swiss-back', 'j-1800-leipzig-out',
  'j-1800-leipzig-back', 'j-1801-rossla-out', 'j-1801-rossla-back', 'j-1801-pyrmont-out', 'j-1801-pyrmont-back', 'j-1802-lauchstaedt-out', 'j-1802-lauchstaedt-back',
  'j-1805-lauchstaedt-out', 'j-1805-helmstedt-out', 'j-1805-helmstedt-back', 'j-1805-lauchstaedt-back', 'j-1806-karlsbad-out', 'j-1806-karlsbad-back',
  'j-1807-karlsbad-out', 'j-1807-karlsbad-back', 'j-1808-karlsbad-out', 'j-1808-to-franzensbad', 'j-1808-to-karlsbad', 'j-1808-to-franzensbad-2', 'j-1808-karlsbad-back',
  'j-1810-bohemia-out', 'j-1810-teplitz', 'j-1810-bohemia-back', 'j-1811-karlsbad-out', 'j-1811-karlsbad-back', 'j-1812-bohemia-out', 'j-1812-teplitz',
  'j-1812-teplitz-back', 'j-1812-bohemia-back', 'j-1813-teplitz-out', 'j-1813-teplitz-back', 'j-1814-berka-out', 'j-1814-berka-back', 'j-1814-rhine-out',
  'j-1814-to-frankfurt', 'j-1814-to-heidelberg', 'j-1814-rhine-back', 'j-1815-rhine-out', 'j-1815-cologne-out', 'j-1815-cologne-back', 'j-1815-to-frankfurt',
  'j-1815-to-heidelberg', 'j-1815-rhine-back', 'j-1816-tennstedt-out', 'j-1816-tennstedt-back', 'j-1818-karlsbad-out', 'j-1818-karlsbad-back', 'j-1819-karlsbad-out',
  'j-1819-karlsbad-back', 'j-1820-marienbad-out', 'j-1820-to-karlsbad', 'j-1820-karlsbad-back', 'j-1821-marienbad-out', 'j-1821-to-eger', 'j-1821-marienbad-back',
  'j-1822-marienbad-out', 'j-1822-to-eger', 'j-1822-marienbad-back', 'j-1823-bohemia-out', 'j-1823-to-karlsbad', 'j-1823-bohemia-back', 'j-1828-dornburg-out',
  'j-1828-dornburg-back', 'j-1831-ilmenau-out', 'j-1831-ilmenau-back',
];

describe('goethe/route：各趟路写的先后', () => {
  it('125 趟路的 id 照文件里的先后，和钉在这里的单子一个不差', () => {
    expect(ORDER).toHaveLength(125);
    expect(new Set(ORDER).size).toBe(125);
    expect(scene.roads.journeys.map((journey) => journey.id)).toEqual(ORDER);
  });

  it('每一趟的时间都以年份开头；照写的先后，年份一路不往回走；id 里带着的就是这一年', () => {
    let before = 0;
    for (const journey of scene.roads.journeys) {
      const year = Number(/^(\d{4}) 年/.exec(journey.date)?.[1]);
      expect(year, `${journey.id} 的时间“${journey.date}”不是以年份开头的`).toBeGreaterThan(1700);
      expect(year, `${journey.id}（${year} 年）写在了 ${before} 年的一趟后面`).toBeGreaterThanOrEqual(before);
      expect(journey.id.startsWith(`j-${year}-`), `${journey.id} 的 id 里不是 ${year}`).toBe(true);
      before = year;
    }
    // 头一趟 1765 年去莱比锡，末一趟 1831 年从伊尔默瑙回来
    expect(before).toBe(1831);
  });
});
