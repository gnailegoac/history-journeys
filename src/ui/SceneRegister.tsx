// 凭据里“沙盘上的东西”一栏：沙盘上摆的每样东西属于五类里的哪一类、依据什么、出处在哪；
// 后面是史料里有、沙盘上故意没画的东西；最后一行是用了谁的数据。
// 内容都是 src/domain 的 sceneRegister() 从场景数据拼出来的，这里只管排出来。

import { useMemo } from 'react';
import { sceneRegister } from '../domain';
import type { SceneRegister as Register, Source, StopScene } from '../domain';
import { REGISTER_TEXT } from './text';

export function SceneRegister({ scene, sources }: { scene: StopScene; sources: Source[] }) {
  const register = useMemo(() => registerOf(scene, sources), [scene, sources]);
  if (!register) return null;
  const groups = register.groups.filter((group) => group.entries.length > 0);

  return (
    <section className="scene-register">
      <h3>{REGISTER_TEXT.heading}</h3>
      <p className="provenance-line">{REGISTER_TEXT.line}</p>

      {groups.map((group) => (
        <section key={group.class} className="scene-register-group" data-class={group.class}>
          <h4>{group.label}</h4>
          <ul>
            {group.entries.map((entry) => (
              <li key={entry.id} className="scene-register-item" data-scene-id={entry.id}>
                <p className="scene-register-name">{entry.name}</p>
                <p className="scene-register-basis">{entry.basis}</p>
                {entry.unsure && (
                  <p className="scene-register-unsure">
                    {entry.name}的{entry.unsure}是示意。
                  </p>
                )}
                <Cites cites={entry.cites} />
              </li>
            ))}
          </ul>
        </section>
      ))}

      {register.notDrawn.length > 0 && (
        <section className="scene-register-group scene-not-drawn">
          <h4>{REGISTER_TEXT.notDrawn}</h4>
          <ul>
            {register.notDrawn.map((item) => (
              <li key={item.id} className="scene-register-item" data-scene-id={item.id}>
                <p className="scene-register-name">{item.name}</p>
                <p className="scene-register-basis">{item.why}</p>
                <Cites cites={item.cites} />
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="scene-credits">
        {register.credits.map((credit, i) => (
          <p key={i}>{credit}</p>
        ))}
      </div>
    </section>
  );
}

function Cites({ cites }: { cites: string[] }) {
  return (
    <>
      {cites.map((cite, i) => (
        <p key={i} className="provenance-cite">
          {REGISTER_TEXT.cite}
          {cite}
        </p>
      ))}
    </>
  );
}

// 这一栏拼不出来时不印它，正文和别的凭据照常。
function registerOf(scene: StopScene, sources: Source[]): Register | null {
  try {
    return sceneRegister(scene, sources);
  } catch (error) {
    console.warn('[沙盘] 没能生成“沙盘上的东西”一栏：', error);
    return null;
  }
}
