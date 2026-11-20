// “来源”页（#/sources）的架子：一页纸独自立在绢上，没有沙盘栏；位置那一行、标题马上就有。
// 页面上的话和列出来的每一条在另一段程序里（SourcesBody.tsx，连同 sourcesText.ts），读者打开这一页才下载，
// 不随页面一打开就下载；还没到的时候标题下面是一句“加载中…”，没取到是另一句，请读者刷新网页（回首页再点进来也是再取一次；
// 网站发了新的一版以后旧的那一段程序不在了，只有刷新才取得到）。读屏软件会把换进去的这一句念出来（role="status"）。

import { homeHref } from '../app/router';
import { useLoaded } from '../app/useLoaded';
import { PageTitle } from './PageTitle';
import { SITE_TITLE, SOURCES_LABEL, pageTitle } from './text';

export function SourcesPage() {
  const body = useLoaded('', () => import('./SourcesBody'));
  return (
    <main className="plain-page sources">
      <nav className="crumbs" aria-label="位置">
        <a href={homeHref}>{SITE_TITLE}</a>
      </nav>
      <PageTitle documentTitle={pageTitle(SOURCES_LABEL)}>{SOURCES_LABEL}</PageTitle>
      {body.state === 'ready' ? (
        <body.value.SourcesBody />
      ) : (
        <p className="quiet" role="status">
          {body.state === 'error' ? '这一页没能读出来。刷新一下网页再试。' : '加载中…'}
        </p>
      )}
    </main>
  );
}
