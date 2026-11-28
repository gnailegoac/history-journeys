// “来源”页里面的东西：网站用到的字体、地形数据、图片和程序各是哪里来的，按什么许可使用。
// 这一段程序和它上面的话（sourcesText.ts）自成一块，读者打开“来源”页才下载（架子在 SourcesPage.tsx）。
//
// 每一行从哪里来，页面自己不另记一份，免得和随站发的东西对不上：
//   字体      三套字体的名字、哪一版、网站、许可全文的地址：src/fonts/shipped.ts（做字体的工具写的）。src/ 里只有这个文件引它，
//             这张表就跟着这一块走；页面一打开就下载的程序要字体的名称，引的是 src/fonts/probe.ts。
//   地形和水  内容里的原话，一位可以点进去的人物一段，照首页卡片的先后；每一段前面是卡片上他的名字加“的沙盘”。
//             一段里是他的全程沙盘的 credits、他每一站的沙盘的 credits；在这一段里说过的不再印一遍（见 uniqueLines），
//             两位人物都用到的一行在各人的一段里各印一遍。
//   图片      每一站正文里的图片：是哪一站的、题记、作者、许可、出处的地址（那一站的 images）。
//             这两栏是 sourcesLines.ts 收齐的（那个文件不用 React：做字体的工具也用它问这一页印些什么）。
//   程序      两个程序库的许可全文：public/licences/ 里的两个文件。
// 五份许可全文是网站自己带着的文本文件，链接直接打开它们。“字体的网站”“图片出处”是通到别的网站的平常链接，
// 读者点了才去；页面自己不取它们。
// 印给读者看的字都不写在这个文件里（在 sourcesText.ts 和内容里）：做字体的工具是按文件分字的。
//
// 这个文件引入什么有讲究。点开才下载的一块里，不要引入页面那一块里自己又用到 react 的程序（src/app/ 的 router.ts、useLoaded.ts，
// PageTitle.tsx 和别的组件）：打包的工具（rolldown 1.2）碰到这种引法，会把 React 的核心从页面那一块里单拆成一个文件，
// 页面一打开要下载的程序凭空多出约 600 字节，还多一次请求（量过；tests/build/dist-size.test.ts 守着“页面的程序只有一个文件”）。
// 所以这里要用的钩子直接从 react 引；读内容的函数（src/domain）、shipped.ts、sourcesText.ts、sourcesLines.ts 不用 react，可以引。

import { useEffect, useState } from 'react';
import { SHIPPED_FONTS } from '../fonts/shipped';
import { loadFromContent } from './sourcesLines';
import type { FromContent } from './sourcesLines';
import { LIBRARY_LICENCES, SOURCES_TEXT } from './sourcesText';

// 说过的话只留头一回的那个函数也从这里给出去（它和收齐两栏的函数都在 sourcesLines.ts 里）。
export { uniqueLines } from './sourcesLines';

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
        {/* 一位人物一段：小标题是卡片上他的名字加“的沙盘”，下面是他的沙盘的每一行。 */}
        {found?.tables.map((table) => (
          <div key={table.figureId} className="sources-figure" data-figure-id={table.figureId}>
            <h3>{SOURCES_TEXT.tableOf(table.name)}</h3>
            <ul className="sources-list">
              {table.lines.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>
        ))}
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
