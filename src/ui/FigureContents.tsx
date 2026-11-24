// 人物页的文字栏：他是谁，加各站的目录，折着的一行“凭据”（全程沙盘上的东西各属于哪一类、依据什么）；末尾是通到“来源”页的链接。

import { sourcesHref, stopHref } from '../app/router';
import type { Figure, RouteScene } from '../domain';
import { PageTitle } from './PageTitle';
import { Provenance } from './Provenance';
import { NOT_WRITTEN, SOURCES_LABEL, pageTitle, placeLabel } from './text';

export function FigureContents({ figure, route }: { figure: Figure; route: RouteScene | null }) {
  return (
    <article className="figure-page">
      <header className="page-head">
        <PageTitle documentTitle={pageTitle(figure.name)}>{figure.name}</PageTitle>
        <p className="meta">
          {figure.era} · {figure.years}
        </p>
        <p className="figure-tagline">{figure.tagline}</p>
      </header>

      <div className="prose figure-intro">
        {figure.intro.map((paragraph, i) => (
          <p key={i}>{paragraph}</p>
        ))}
      </div>

      <section aria-labelledby="stops-heading">
        <h2 id="stops-heading" className="section-heading">
          各站目录
        </h2>
        <ol className="stops">
          {figure.stops.map((stop, i) => (
            <li key={stop.id}>
              <a className="stop-item" href={stopHref(figure.id, stop.id)} data-stop-id={stop.id} data-stop-status={stop.status}>
                {/* 圆点里的数字：一到十用汉字（和全程沙盘上的印一样），再多就用数字。读屏不念它：这是个有序的列表，第几项它自己会说。 */}
                <span className="stop-number" aria-hidden="true">
                  {'一二三四五六七八九十'[i] ?? i + 1}
                </span>
                <span className="stop-body">
                  {/* 站名和“还没写”的小标签都是黑体，大小不一样：并排的两块，不挤在同一行字里 */}
                  <span className="stop-head">
                    <span className="stop-title">{stop.title}</span>
                    {stop.status !== 'complete' && <span className="tag">{NOT_WRITTEN}</span>}
                  </span>
                  <span className="stop-meta">
                    <span>{stop.years}</span>
                    <span>{placeLabel(stop.place)}</span>
                    <span>{stop.age}</span>
                  </span>
                  <span className="stop-summary">{stop.summary}</span>
                </span>
              </a>
            </li>
          ))}
        </ol>
      </section>

      {/* 全程沙盘的凭据：和站点页上是同一个组件，这里只有“沙盘上的东西”一栏，出处是全程沙盘自己的。 */}
      {route && <Provenance content={{ provenance: [], sources: route.sources }} scene={route} />}

      {/* 目录完了：一道短短的细线（样式表画的），下面是通到“来源”页的链接。 */}
      <div className="stop-nav">
        <a className="stop-nav-sources" href={sourcesHref}>
          {SOURCES_LABEL}
        </a>
      </div>
    </article>
  );
}
