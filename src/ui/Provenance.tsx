// 凭据：折着的那一行。点开以后里面的东西（ProvenanceBody.tsx，连同“沙盘上的东西”一栏）是另一段程序，
// 读者点开了才去取：一点就开，里面先是一句“加载中…”，取到了换成内容；没取到说一句话，关上再点开就重取。默认折起。
// 人物页上的那一行（全程沙盘的凭据）末尾还印这位人物的行迹的出处：那是他自己的一小块内容，和里面的那一段程序一起取，
// 两样都到了才换成内容——出处和别的凭据是同时印出来的。

import { useOnDemand } from '../app/useLoaded';
import { loadItinerarySources } from '../domain';
import type { StopContent, TableScene } from '../domain';
import { FoldSummary } from './StopText';
import { Waiting } from './Waiting';

interface Props {
  /** 这一站的正文里各句的依据和出处。人物页上那一行只有“沙盘上的东西”：依据是空的，出处是全程沙盘自己的。 */
  content: Pick<StopContent, 'provenance' | 'sources'>;
  /** 这一站的沙盘的场景（人物页上是全程沙盘的）；没有沙盘时为 null。 */
  scene: TableScene | null;
  /** 人物页上的那一行写这位人物的 id：他的行迹的出处跟着取。一站的页面上不写。 */
  figureId?: string;
}

const loadBody = () => import('./ProvenanceBody');

export function Provenance({ content, scene, figureId }: Props) {
  const [body, ask] = useOnDemand(async () => {
    const [{ ProvenanceBody }, read] = await Promise.all([loadBody(), figureId ? loadItinerarySources(figureId) : []]);
    return { ProvenanceBody, read };
  });
  if (content.provenance.length === 0 && !scene) return null;

  return (
    // 点开的那一下（不管是点的、键盘按的，还是程序打开的）去取里面的东西
    <details className="provenance" onToggle={(event) => event.currentTarget.open && ask()}>
      <FoldSummary label="凭据" />
      <div className="provenance-body">
        {body?.state === 'ready' ? <body.value.ProvenanceBody content={content} scene={scene} read={body.value.read} /> : <Waiting failed={body?.state === 'error'} />}
      </div>
    </details>
  );
}
