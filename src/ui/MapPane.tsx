// 地图栏。人物页和各站页共用一张地图：它一直挂着，镜头跟着读到的地方走。
// 地图起不来时只留一句话，不影响阅读。

import { useCallback, useEffect, useRef, useState } from 'react';
import { MAP_DATA_NOTICE } from '../map';
import type { MapRoute, MapView, NamesMode } from '../map/types';
import { pickMapEngine } from './mapEngineSource';

type MapState = 'loading' | 'ready' | 'failed';

interface Props {
  route: MapRoute;
  /** 镜头该停在哪一站；null 为看全程。 */
  stopId: string | null;
  /** 读者点了地图上的某一站。 */
  onStopSelect: (stopId: string) => void;
}

export function MapPane({ route, stopId, onStopSelect }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const viewRef = useRef<MapView | null>(null);
  // 镜头该去的地方、上一次让它去的地方（undefined 表示还没放过）、第几次指令。
  const target = useRef(stopId);
  const requested = useRef<string | null | undefined>(undefined);
  const sequence = useRef(0);
  const placeFailed = useRef(false);
  const select = useRef(onStopSelect);
  const names = useRef<NamesMode>('ancient');

  const [state, setState] = useState<MapState>('loading');
  // 镜头到了哪一站（'' 为全程）；null 表示还一次都没摆到位。
  const [arrived, setArrived] = useState<string | null>(null);
  const [moved, setMoved] = useState(false);
  const [namesMode, setNamesMode] = useState<NamesMode>('ancient');
  const [folded, setFolded] = useState(false);

  useEffect(() => {
    select.current = onStopSelect;
  }, [onStopSelect]);

  // 让镜头去 target 指的地方。只有最新的一次指令到达后才算“到了”。
  const place = useCallback((animate: boolean) => {
    const view = viewRef.current;
    if (!view) return;
    const goal = target.current;
    const turn = ++sequence.current;
    requested.current = goal;
    placeFailed.current = false;
    setMoved(false);
    let done: Promise<void>;
    try {
      done = goal ? view.goToStop(goal, { animate }) : view.showOverview({ animate });
    } catch (error) {
      done = Promise.reject(error);
    }
    done.then(
      () => {
        if (turn === sequence.current && viewRef.current === view) setArrived(goal ?? '');
      },
      () => {
        if (turn === sequence.current) placeFailed.current = true;
      },
    );
  }, []);

  // 引擎用到时才加载；一位人物只建一张地图。
  useEffect(() => {
    let cancelled = false;
    let view: MapView | null = null;
    const unsubscribe: (() => void)[] = [];

    const fail = (reason: unknown) => {
      if (cancelled) return;
      // 给读者的只有一句话；原因写在控制台里，好分清是等得太久还是浏览器不支持。
      console.warn('[地图] 没能显示出来：', reason);
      unsubscribe.splice(0).forEach((off) => off());
      if (view) {
        try {
          view.destroy();
        } catch {
          // 已经坏掉的地图，关不干净也不用管。
        }
        if (viewRef.current === view) viewRef.current = null;
        view = null;
      }
      host.current?.replaceChildren();
      setArrived(null);
      setState('failed');
    };

    setState('loading');
    pickMapEngine()
      .then((engine) => {
        if (cancelled || !host.current) return;
        if (!engine.isSupported()) {
          fail(new Error('这个浏览器不支持地图需要的 WebGL2'));
          return;
        }
        const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        view = engine.create(host.current, route, { namesMode: names.current, reducedMotion });
        viewRef.current = view;
        unsubscribe.push(view.onStopSelect((id) => select.current(id)));
        unsubscribe.push(view.onUserMoved((value) => setMoved(value)));
        // 页面打开后的第一次摆放不飞。
        place(false);
        view.ready.then(() => {
          if (cancelled) return;
          setState('ready');
          if (placeFailed.current) place(false);
        }, fail);
      })
      .catch(fail);

    return () => {
      cancelled = true;
      unsubscribe.splice(0).forEach((off) => off());
      if (view) view.destroy();
      if (viewRef.current === view) viewRef.current = null;
      requested.current = undefined;
    };
  }, [route, place]);

  // 读到另一站（或回到人物页）时，镜头跟过去。
  useEffect(() => {
    target.current = stopId;
    if (viewRef.current && requested.current !== stopId) place(true);
  }, [stopId, place]);

  // 地图栏的大小变了，告诉地图。
  useEffect(() => {
    viewRef.current?.resize();
  }, [folded]);

  useEffect(() => {
    let frame = 0;
    const onResize = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => viewRef.current?.resize());
    };
    window.addEventListener('resize', onResize);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', onResize);
    };
  }, []);

  const chooseNames = (mode: NamesMode) => {
    names.current = mode;
    setNamesMode(mode);
    viewRef.current?.setNamesMode(mode);
  };

  const resetView = () => {
    viewRef.current?.resetView().catch(() => {});
  };

  const className = ['map-pane', folded ? 'is-folded' : '', state === 'failed' ? 'is-failed' : ''].filter(Boolean).join(' ');

  return (
    <section className={className} aria-label="地图" data-map-state={state} data-map-stop={arrived ?? undefined}>
      <div className="map-canvas">
        <div ref={host} className="map-host" />
      </div>

      {state === 'loading' && <p className="map-loading">地图加载中…</p>}
      {state === 'failed' && (
        <p className="map-message" role="status">
          地图没能显示出来，正文可以照常读。
        </p>
      )}

      {state !== 'failed' && (
        <>
          <div className="map-controls">
            <div className="names-switch" role="group" aria-label="地名">
              <button type="button" aria-pressed={namesMode === 'ancient'} onClick={() => chooseNames('ancient')}>
                古名
              </button>
              <button type="button" aria-pressed={namesMode === 'modern'} onClick={() => chooseNames('modern')}>
                今名
              </button>
            </div>
            <button type="button" className="map-button map-reset" disabled={state !== 'ready' || !moved} onClick={resetView}>
              {stopId ? '回到这一站' : '回到全程'}
            </button>
            <button type="button" className="map-button map-fold" aria-expanded={!folded} onClick={() => setFolded((value) => !value)}>
              {folded ? '展开地图' : '收起地图'}
            </button>
          </div>
          <p className="map-notice">{MAP_DATA_NOTICE}</p>
        </>
      )}
    </section>
  );
}
