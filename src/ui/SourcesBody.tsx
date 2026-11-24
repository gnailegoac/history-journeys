// “来源”页里面的东西：网站用到的字体、地形数据、图片和程序各是哪里来的，按什么许可使用。
// 这一段程序和它上面的话（sourcesText.ts）自成一块，读者打开“来源”页才下载（架子在 SourcesPage.tsx）。
//
// 每一行从哪里来，页面自己不另记一份，免得和随站发的东西对不上：
//   字体      三套字体的名字、哪一版、网站、许可全文的地址：src/fonts/shipped.ts（做字体的工具写的）。src/ 里只有这个文件引它，
//             这张表就跟着这一块走；页面一打开就下载的程序要字体的名称，引的是 src/fonts/probe.ts。
//   地形和水  内容里的原话：每位可以点进去的人物的全程沙盘的 credits，他每一站的沙盘的 credits；说过的不再印一遍（见 uniqueLines）。
//   图片      每一站正文里的图片：是哪一站的、题记、作者、许可、出处的地址（那一站的 images）。
//   程序      两个程序库的许可全文：public/licences/ 里的两个文件。
// 五份许可全文是网站自己带着的文本文件，链接直接打开它们。“字体的网站”“图片出处”是通到别的网站的平常链接，
// 读者点了才去；页面自己不取它们。
// 印给读者看的字都不写在这个文件里（在 sourcesText.ts 和内容里）：做字体的工具是按文件分字的。
//
// 这个文件引入什么有讲究。点开才下载的一块里，不要引入页面那一块里自己又用到 react 的程序（src/app/ 的 router.ts、useLoaded.ts，
// PageTitle.tsx 和别的组件）：打包的工具（rolldown 1.2）碰到这种引法，会把 React 的核心从页面那一块里单拆成一个文件，
// 页面一打开要下载的程序凭空多出约 600 字节，还多一次请求（量过；tests/build/dist-size.test.ts 守着“页面的程序只有一个文件”）。
// 所以这里要用的钩子直接从 react 引；读内容的函数（src/domain）、shipped.ts、sourcesText.ts 不用 react，可以引。

import { useEffect, useState } from 'react';
import { loadFigure, loadFigureCards, loadRouteTable, loadStop, loadStopTable } from '../domain';
import type { StopImage } from '../domain';
import { SHIPPED_FONTS } from '../fonts/shipped';
import { LIBRARY_LICENCES, SOURCES_TEXT } from './sourcesText';

/** 从内容里读出来的两栏：地形和水的每一行（不重复），每一张图片和它是哪一站的（那一站的短名字）。 */
interface FromContent {
  lines: string[];
  pictures: { stop: string; picture: StopImage }[];
}

/**
 * 说过的话只留头一回，先后不变。算“说过”的有两种：
 * 一模一样的一行（两座沙盘用的是同一份数据的时候，它们的出处是同一句话）；
 * 分号前面的半句，前面留下的哪一行就是这样开头的——同一份数据，全程的图片署过一遍，沙盘的凭据里又署一遍，
 * 后面带的半句是说给凭据里的读者听的（“裁剪和修整见上面的说明”），在这一页上“上面”没有那段说明。
 * 所以内容里一行出处要署的名都写在头一个分号前面；分号后面只写补充的话。
 */
export function uniqueLines(lines: string[]): string[] {
  const kept: string[] = [];
  for (const line of lines) {
    const head = line.split('；')[0];
    if (!kept.some((seen) => seen.startsWith(head))) kept.push(line);
  }
  return kept;
}

/** 把每位可以点进去的人物、他的每一站和每一座沙盘读一遍，收齐那两栏。 */
async function loadFromContent(): Promise<FromContent> {
  const lines: string[] = [];
  const pictures: FromContent['pictures'] = [];
  for (const card of await loadFigureCards()) {
    const figure = card.available ? await loadFigure(card.id) : null;
    if (!figure) continue;
    // 全程沙盘的出处排在最前面，只印头一个分号前面署名的半句：后半句（“裁剪和修整见上面的说明”）是说给凭据里的读者听的
    for (const line of (await loadRouteTable(figure.id))?.scene.credits ?? []) lines.push(line.includes('；') ? `${line.split('；')[0]}。` : line);
    const stops = await Promise.all(
      figure.stops.map((stop) => Promise.all([loadStopTable(figure.id, stop.id), stop.status === 'complete' ? loadStop(figure.id, stop.id) : null, stop.shortTitle] as const)),
    );
    for (const [table, content, stop] of stops) {
      if (table) lines.push(...table.scene.credits);
      if (content) pictures.push(...content.images.map((picture) => ({ stop, picture })));
    }
  }
  return { lines: uniqueLines(lines), pictures };
}

/** 通到别的网站的链接：在新的一页打开，不把这一页的地址带过去。 */
const OUTSIDE = { target: '_blank', rel: 'noopener noreferrer' } as const;

export function SourcesBody() {
  // 那两栏：还没读到是 undefined，没读出来是 null。
  const [found, setFound] = useState<FromContent | null>();
  useEffect(() => {
    let live = true;
    loadFromContent().then(
      (value) => live && setFound(value),
      () => live && setFound(null),
    );
    return () => {
      live = false;
    };
  }, []);

  const { sans, song, kai } = SHIPPED_FONTS;
  const [fonts, land, pictures, program] = SOURCES_TEXT.headings;
  /** 还没读到、没读出来时站在那一栏里的一句。 */
  const waiting = found ? null : <p className="quiet">{found === null ? SOURCES_TEXT.failed : SOURCES_TEXT.loading}</p>;

  return (
    <>
      <p className="sources-lead">{SOURCES_TEXT.lead}</p>

      <section data-sources="fonts">
        <h2 className="section-heading">{fonts}</h2>
        {/* 三套字体，先后是黑体、宋体、楷体。 */}
        {[sans, song, kai].map((font) => (
          <div key={font.family} className="sources-item" data-font={font.family}>
            <p>{font === sans ? SOURCES_TEXT.sans(font) : font === song ? SOURCES_TEXT.song(font) : SOURCES_TEXT.kai(font)}</p>
            {/* 三套字体的两个链接写的是一样的字：读屏软件把链接单列出来的时候分不出谁是谁的，所以另给一个带着字体名字的名字。 */}
            <p className="sources-links">
              <a href={font.licence} aria-label={`${font.name} ${SOURCES_TEXT.licence}`}>
                {SOURCES_TEXT.licence}
              </a>
              <a href={font.site} aria-label={`${font.name} ${SOURCES_TEXT.fontSite}`} {...OUTSIDE}>
                {SOURCES_TEXT.fontSite}
              </a>
            </p>
          </div>
        ))}
        <p>{SOURCES_TEXT.subset(sans, song, kai)}</p>
      </section>

      <section data-sources="land">
        <h2 className="section-heading">{land}</h2>
        {waiting}
        {found && (
          <ul className="sources-list">
            {found.lines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        )}
      </section>

      <section data-sources="pictures">
        <h2 className="section-heading">{pictures}</h2>
        {waiting}
        {found && found.pictures.length === 0 && <p className="quiet">{SOURCES_TEXT.noPictures}</p>}
        {found && found.pictures.length > 0 && (
          <ul className="sources-list">
            {found.pictures.map(({ stop, picture }) => (
              <li key={picture.id + picture.file} className="sources-item">
                <p>{SOURCES_TEXT.picture(stop, picture.caption)}</p>
                <p className="sources-credit">
                  {picture.credit} · {picture.license}
                </p>
                <p className="sources-links">
                  <a href={picture.sourceUrl} {...OUTSIDE}>
                    {SOURCES_TEXT.pictureSource}
                  </a>
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section data-sources="program">
        <h2 className="section-heading">{program}</h2>
        <div className="sources-item">
          <p>{SOURCES_TEXT.program}</p>
          <p className="sources-links">
            <a href={LIBRARY_LICENCES.react}>{SOURCES_TEXT.reactLicence}</a>
            <a href={LIBRARY_LICENCES.three}>{SOURCES_TEXT.threeLicence}</a>
          </p>
        </div>
        <p>{SOURCES_TEXT.shipped}</p>
      </section>
    </>
  );
}
