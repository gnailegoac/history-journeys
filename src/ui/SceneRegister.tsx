// 凭据里“沙盘上的东西”一栏：沙盘上摆的每样东西属于五类里的哪一类、依据什么、出处在哪；
// 后面是史料里有、沙盘上故意没画的东西；最后一行是用了谁的数据。
// 内容都是 src/domain 的 sceneRegister() 从场景数据拼出来的，这里只管排出来。
// 全程沙盘另有三样，都直接从数据里读，不经 sceneRegister()（那个函数跟着页面一打开就下载的程序走，这里的字点开才下载）：
//   开头的几条总的说明（场景文件最外面的 general，可以不写）：一条一段，照文件里的先后，没有标题，id 不印；
//   五类后面的“记号”一栏：小像（场景文件最外面的 piece，不在五类里）；
//   最后的一段：这位人物的行迹照哪些书和文章排的——手写的那一份行迹（itinerary.json）里的 sources，一条出处印一次，连着“读了什么”。
//   那一份里只有 sources 这一个字段进网站，每位人物的是他自己的一小块，不打在这一块程序里（tests/build/dist-size.test.ts 查着）：
//   读者在人物页上点开“凭据”，页面把这位人物的那一小块和这一段程序一起取来（Provenance.tsx），从 itinerary 交进来。

import { useMemo } from 'react';
import { sceneRegister } from '../domain';
import type { SceneRegister as Register, Source, TableScene } from '../domain';
import type { ItinerarySource } from '../domain/itinerary';
import { REGISTER_TEXT } from './foldText';

/** 一条出处（cite）只留头一次。 */
export function onceEach(all: ItinerarySource[]): ItinerarySource[] {
  return all.filter((source, i) => all.findIndex((other) => other.cite === source.cite) === i);
}

/** itinerary：这位人物的行迹的出处，照文件里的先后（人物页上那一行才有；一站的页面上是空的）。只有全程沙盘的凭据印它。 */
export function SceneRegister({ scene, sources, itinerary }: { scene: TableScene; sources: Source[]; itinerary: ItinerarySource[] }) {
  const register = useMemo(() => registerOf(scene, sources), [scene, sources]);
  if (!register) return null;
  const groups = register.groups.filter((group) => group.entries.length > 0);
  const piece = scene.level === 'route' ? scene.piece : undefined;
  const general = scene.level === 'route' ? scene.general : undefined;
  const read = scene.level === 'route' ? onceEach(itinerary) : [];

  return (
    <>
      <section className="scene-register">
        <h3>{REGISTER_TEXT.heading}</h3>
        <p className="provenance-line">{REGISTER_TEXT.line}</p>

        {/* 全程沙盘的几条总的说明（场景文件最外面的 general）：排在这一栏的开头，一条一段，照文件里的先后；没有标题，id 不印 */}
        {general?.map((line, i) => (
          <p key={i} className="scene-register-item scene-general">
            {line.text}
          </p>
        ))}

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

        {/* 全程沙盘上的小像：不在五类里，另是一栏 */}
        {piece && (
          <section className="scene-register-group scene-marks">
            <h4>{REGISTER_TEXT.mark}</h4>
            <ul>
              <li className="scene-register-item">
                <p className="scene-register-name">{piece.name}</p>
                <p className="scene-register-basis">{piece.basis}</p>
                <p className="scene-register-unsure">{piece.note}</p>
              </li>
            </ul>
          </section>
        )}

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

      {/* 行迹的出处：一条印一次，下面是读了它的什么 */}
      {read.length > 0 && (
        <section className="itinerary-sources">
          <p className="provenance-line">{REGISTER_TEXT.itinerary}</p>
          <ul>
            {read.map((source) => (
              <li key={source.id} className="scene-register-item">
                <p className="scene-register-name">{source.cite}</p>
                <p className="scene-register-basis">{source.read}</p>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
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
function registerOf(scene: TableScene, sources: Source[]): Register | null {
  try {
    return sceneRegister(scene, sources);
  } catch (error) {
    console.warn('[沙盘] 没能生成“沙盘上的东西”一栏：', error);
    return null;
  }
}
