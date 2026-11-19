// 全程沙盘的定格图：一张图，下面是题记、如实的说明、用了谁的数据。
// 全程沙盘接进人物页之前（重做顺序第 4 步）先放它；它不能转动。

/** 定格图和图旁边的字（src/domain/sceneContent.ts 的 loadRouteStill 给出来的样子）。 */
export interface RouteStillInfo {
  /** 图片的网址。 */
  url: string;
  /** 图片有多宽、多高（像素）：图还没下载完，浏览器就照这个比例把地方留出来。 */
  width: number;
  height: number;
  alt: string;
  /** 图下面的一句题记。 */
  caption: string;
  /** 如实的说明。 */
  note: string;
  /** 用了谁的数据。 */
  credit: string;
}

export function RouteStill({ still }: { still: RouteStillInfo }) {
  return (
    <figure className="stage-still">
      <img src={still.url} alt={still.alt} width={still.width} height={still.height} />
      <figcaption>
        <p className="stage-still-caption">{still.caption}</p>
        <p className="stage-still-note">{still.note}</p>
        <p className="stage-still-credit">{still.credit}</p>
      </figcaption>
    </figure>
  );
}
