// 凭据点开以后里面的东西：正文每一小节里，哪些话出自他本人或当时的记载，哪些是编写时补的；
// 这一站有沙盘时，后面再接一栏“沙盘上的东西”。
// 这一段程序不随页面一打开就下载：读者点开“凭据”才取（Provenance.tsx）。

import type { StopContent, StopScene } from '../domain';
import { SceneRegister } from './SceneRegister';
import { BASIS_LABEL } from './foldText';

interface Props {
  content: StopContent;
  /** 这一站的沙盘的场景；没有沙盘时为 null。 */
  scene: StopScene | null;
}

export function ProvenanceBody({ content, scene }: Props) {
  const cites = new Map(content.sources.map((source) => [source.id, source.cite]));

  return (
    <>
      {content.provenance.length > 0 && <p className="provenance-line">正文里的事和话，各自依据什么。</p>}
      {content.provenance.map((group, g) => (
        <section key={g} className="provenance-group">
          <h3>{group.section}</h3>
          <ul>
            {group.items.map((item, i) => {
              const cited = item.sourceIds.flatMap((id) => {
                const cite = cites.get(id);
                return cite ? [cite] : [];
              });
              return (
                <li key={i} className="provenance-item" data-basis={item.basis}>
                  <p className="provenance-what">
                    {item.what}
                    <span className="tag">{BASIS_LABEL[item.basis]}</span>
                  </p>
                  {cited.map((cite, c) => (
                    <p key={c} className="provenance-cite">
                      出处：{cite}
                    </p>
                  ))}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
      {scene && <SceneRegister scene={scene} sources={content.sources} />}
    </>
  );
}
