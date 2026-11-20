// 凭据：折着的那一行。点开以后里面的东西（ProvenanceBody.tsx，连同“沙盘上的东西”一栏）是另一段程序，
// 读者点开了才去取：一点就开，里面先是一句“加载中…”，取到了换成内容；没取到说一句话，关上再点开就重取。默认折起。

import { useOnDemand } from '../app/useLoaded';
import type { StopContent, StopScene } from '../domain';
import { FoldSummary } from './StopText';
import { Waiting } from './Waiting';

interface Props {
  content: StopContent;
  /** 这一站的沙盘的场景；没有沙盘时为 null。 */
  scene: StopScene | null;
}

const loadBody = () => import('./ProvenanceBody');

export function Provenance({ content, scene }: Props) {
  const [body, ask] = useOnDemand(loadBody);
  if (content.provenance.length === 0 && !scene) return null;

  return (
    // 点开的那一下（不管是点的、键盘按的，还是程序打开的）去取里面的东西
    <details className="provenance" onToggle={(event) => event.currentTarget.open && ask()}>
      <FoldSummary label="凭据" />
      <div className="provenance-body">
        {body?.state === 'ready' ? <body.value.ProvenanceBody content={content} scene={scene} /> : <Waiting failed={body?.state === 'error'} />}
      </div>
    </details>
  );
}
