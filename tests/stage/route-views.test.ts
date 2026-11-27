// 全程沙盘的验收：每一小节的镜头、题签、说明，照真的场景文件和算出来的地面查。在 Node 里跑，不要浏览器。
// 查法和站点沙盘的三组（scene-cameras、scene-strips、scene-notes）是同一套：镜头用 src/stage/three/rig.ts 的 placeCamera 摆，
// 题签指着的点用 screenAnchors 算，摆法是 src/stage/overlay/placeStrips.ts，题签多大照 ./support/stripSizes.ts，
// 画面是 ./support/standardPanes.ts 的标准的沙盘栏。**一座全程沙盘查的是它的页面摆得出来的栏**（下面的 panesOf；docs/data-spec.md“全程沙盘上的题签”）：
//   人物有行迹的（苏轼的那一座）：全程沙盘摆在两种栏里——人物页和首页的栏带着时间轴（下面多留一条，竖着拿的平板上栏也高一条），
//   还没有自己的沙盘的一站的页面上没有时间轴（同一站自己的沙盘的栏一样）——两种都查，查的栏、每一条测试的名字和 2026-11-27 以前一个字不差；
//   人物没有行迹的（歌德的那一座）：他的人物页上没有时间轴（src/ui/StagePane.tsx 的 noBar），哪一种页面的栏都不带——查的是同样几种窗口上不带时间轴的栏，
//   带着时间轴的一种也不查，也就没有“再给小像留出地方”的时候（那 36 像素是给小像留的，小像只有有行迹的人物才有）。
//   哪一座是哪一种，照 content/ 里的文件夹读（人物的文件夹里有没有 itinerary.json），“题签”那一组后面有一条测试守着。
// 全程沙盘另有三条自己的规矩（docs/data-spec.md“题签摆在哪”）：
//   引线不超过 48 像素（一条题签离它指的那一点太远，孩子会把名字读到别处去）；当时的名字、今天的名字两种都查；
//   沙盘栏上面多一行说明的画面上，题签也一条不能少（最长的引线只打印，不设上限）。
//   带着时间轴的四种另有“那一行话下面再给小像留出地方”的时候，也查。
//   “全程”那一节另有一组（文件靠后）：人物页和首页一打开看的就是它，所以在量过的每一种沙盘栏上——四种标准的、首页的两种、
//   别的竖着拿的平板（./support/standardPanes.ts 的 UPRIGHT_PANES），连上面多一行说明的——引线都不超过 48 像素，站名不站到别的站那一边去。
// “说明”这一组查的是印出来的字（src/domain/sceneText.ts 的 sectionInfo，页面用的就是它）：写了的每一句 note 都有一节印出来，
// 每一节印的句子不多不少、不重复；题记、远处、那一句说明的两种写法各有多长，最长的印出来。
// 题签的字和“是哪几站”也是页面拼的那一份（stripTexts，经 ./support/stripSizes.ts 的 routeSectionStrips）。
// 题签有两种（样式的登记表那一行的 labels），“每一座”的几组照这座沙盘的那一种查（docs/data-spec.md“场景验收照题签的那一种查”）：
//   竖着的纸条（苏轼的那一座）：摆法是 placeStrips，查的和原来一个字不差；
//   平着的纸条（歌德的那一座）：摆法是 placeSlips，连地面的四个角一起交给它；没有点的名字写的那个位置不算一个点；
//     每一条纸条（连它前头的圆）不出地面的边；站名左右站没站反，照 28 像素算“并排”；站号的圆有多大照圆算。
//     一条不少、引线不超过 48 像素，和竖着的纸条一样。

import { PerspectiveCamera } from 'three';
import { describe, expect, it } from 'vitest';
import type { NamesMode, RouteSection, SceneStrip } from '../../src/domain/scene';
import { NOTE_BRIEF_MAX, NOTE_SHORT_MAX, sectionInfo, stripTexts } from '../../src/domain/sceneText';
import { placeStrips } from '../../src/stage/overlay';
import type { LabelKind, StripInput, StripPlacement } from '../../src/stage/overlay';
import { GROUND_INSET_PX, placeSlips } from '../../src/stage/overlay/slips';
import { labelKind } from '../../src/stage/styles';
import type { Vec3 } from '../../src/stage/ground/types';
import { centreShift, equivalentDistance, framePoints, groundCorners, placeCamera, project, screenAnchors, wholeTable } from '../../src/stage/three/rig';
import { styleFor } from './support/styles';
import type { StageInsets } from '../../src/stage/types';
import { LINE_MAX, WORDS_MAX, textWidth } from '../content/sceneRules';
import { namesIn } from '../support/readBytes';
import { realRouteScene, realSceneKeys } from './support/realScenes';
import type { RealRouteScene } from './support/realScenes';
import { HOME_PANES, NOTICE_HEAD_PX, NOTICE_ROW_TOP, ROUTE_HOME_PANES, ROUTE_NOTICE_ROW_TOP, ROUTE_PANES, ROUTE_UPRIGHT_PANES, STANDARD_PANES, UPRIGHT_PANES, engineSize } from './support/standardPanes';
import type { StandardPane } from './support/standardPanes';
import { ROUTE_CAMERA_NEAREST_DEFAULT_M, ROUTE_CAMERA_NEAREST_M, camerasTooNear, journeysWithNotesPrinted, ownJourneysTold, ownRoadsHeldInPane, routeCameraNearestM, schematicWherePointed } from './support/routeFacts';
import { isAreaName, labelSize, routeSectionStrips } from './support/stripSizes';

interface Pane {
  /** 栏的名字：沙盘栏自己的大小（连它的一像素边线），印在测试的标题里。 */
  name: string;
  /** 沙盘程序拿到的画面：镜头、题签指着的点、摆题签，都照它算。 */
  size: { width: number; height: number };
  insets: StageInsets;
  /** 沙盘栏自己多宽（连边线）：题签用大的还是小的照它分（页面量的也是它）。 */
  paneWidth: number;
}

const leave = (top: number, bottom: number): StageInsets => ({ top, right: 0, bottom, left: 0 });
const NO_INSETS: StageInsets = { top: 0, right: 0, bottom: 0, left: 0 };

/**
 * 量过的一种沙盘栏交给摆法的样子。只有这一处把栏的大小换成沙盘程序拿到的画面（./support/standardPanes.ts 的 engineSize：
 * 少栏自己的一条边线）；2026-11-27 以前交的是栏自己的大小。
 */
const plain = (pane: StandardPane): Pane => ({ name: pane.name, size: engineSize(pane), insets: pane.insets, paneWidth: pane.size.width });
/** 四种标准的沙盘栏，不带时间轴（还没有自己的沙盘的一站的页面），四边留的是在浏览器里量出来的空。 */
const WITHOUT_BAR: Pane[] = STANDARD_PANES.map(plain);
/** 带着时间轴的四种（人物页）。 */
const WITH_BAR: Pane[] = ROUTE_PANES.map(plain);
/** 标准的沙盘栏：两种都算。 */
const STANDARD: Pane[] = [...WITHOUT_BAR, ...WITH_BAR];
/** 一种栏上面多一行说明的时候，上面留多少（在页面上量出来的）。 */
const noticeTop = (name: string): number => NOTICE_ROW_TOP[name] ?? ROUTE_NOTICE_ROW_TOP[name];
/** 一种沙盘栏上面多一行说明的时候（只有图片的那一档；写好了正文、还没有自己的沙盘的一站）。 */
const withNotice = (pane: Pane): Pane => ({ name: `${pane.name}，上面多一行说明`, size: pane.size, insets: leave(noticeTop(pane.name), pane.insets.bottom), paneWidth: pane.paneWidth });
/** 带着时间轴的栏上，读者点了“试试立体的沙盘”以后：那一行话下面再给小像留出 36 像素。 */
const withHead = (pane: Pane): Pane => ({ name: `${pane.name}，上面多一行说明、再给小像留出地方`, size: pane.size, insets: leave(noticeTop(pane.name) + NOTICE_HEAD_PX, pane.insets.bottom), paneWidth: pane.paneWidth });
/** 带着时间轴的四种“再给小像留出地方”的时候。 */
const WITH_HEAD: Pane[] = WITH_BAR.map(withHead);
/** 标准的沙盘栏上面多一行说明的时候；带着时间轴的四种另有“再给小像留出地方”的时候。 */
const WITH_NOTICE: Pane[] = [...STANDARD.filter((pane) => noticeTop(pane.name) !== undefined).map(withNotice), ...WITH_HEAD];
/**
 * 一座全程沙盘的人物有没有行迹：content/figures/<人物>/ 里有没有 itinerary.json，照文件夹读。有行迹的人物，人物页和首页的栏带着时间轴，
 * 沙盘上有小像；没有行迹的，哪一种页面的栏都不带（docs/data-spec.md“谁要有行迹”；页面是照内容的清单读的，那张清单列的就是这些文件）。
 * 哪一天他的行迹进来了，带着时间轴的各种栏自己就查起来。
 */
const hasItinerary = (key: string): boolean => namesIn(`content/figures/${key.split('/')[0]}`).includes('itinerary.json');
/** 别的竖着拿的平板上人物页的栏（带着时间轴）：平常的，和上面多一行说明的。 */
const UPRIGHT: Pane[] = ROUTE_UPRIGHT_PANES.flatMap((pane) => [plain(pane), withNotice(plain(pane))]);
/** 首页的沙盘栏里和人物页不一样的那几种（宽屏上的两种：首页的文字栏宽，沙盘栏就窄）。带着时间轴。 */
const HOME: Pane[] = ROUTE_HOME_PANES.filter((pane) => !ROUTE_PANES.includes(pane)).map(plain);
/** 没有时间轴的人物页、首页上的那几种：别的竖着拿的平板（平常的，和上面多一行说明的），首页宽屏上的两种。 */
const UPRIGHT_BARE: Pane[] = UPRIGHT_PANES.flatMap((pane) => [plain(pane), withNotice(plain(pane))]);
const HOME_BARE: Pane[] = HOME_PANES.filter((pane) => !STANDARD_PANES.includes(pane)).map(plain);

/** 一座全程沙盘查哪些栏。 */
interface TablePanes {
  /** 这位人物有行迹：人物页和首页的栏带着时间轴。 */
  bar: boolean;
  /** 标准的沙盘栏：这座沙盘的页面摆得出来的每一种。 */
  standard: Pane[];
  /** 上面多一行说明的画面。 */
  withNotice: Pane[];
  /** 首页的沙盘栏里和人物页不一样的那几种。 */
  home: Pane[];
  /** “全程”那一节查的每一种：人物页的四种、它们多一行说明的、首页的两种、别的竖着拿的平板连它们多一行说明的。 */
  wholeView: Pane[];
}

/**
 * 这座全程沙盘查哪些栏：它的页面摆得出来的那些。
 *   人物有行迹：和 2026-11-27 以前每一座都查的一模一样——标准的八种（不带时间轴的四种是还没有自己的沙盘的一站的页面，带着的四种是人物页），
 *   上面多一行说明的八种连“再给小像留出地方”的四种，首页的两种、别的竖着拿的平板，都带着时间轴。
 *   人物没有行迹：人物页、首页的栏也不带时间轴，和一站的页面上的栏一个样子——标准的就是不带时间轴的四种，上面多一行说明的也是这四种，
 *   首页的两种、别的竖着拿的平板都是不带时间轴的；带着时间轴的一种也没有，“再给小像留出地方”的也就没有。
 * 每叫一次都记一笔（ASKED）：“题签”那一组后面有一条测试拿这张账去对文件夹。
 */
function panesOf(key: string): TablePanes {
  const bar = hasItinerary(key);
  const panes: TablePanes = bar
    ? { bar, standard: STANDARD, withNotice: WITH_NOTICE, home: HOME, wholeView: [...WITH_BAR, ...WITH_BAR.map(withNotice), ...HOME, ...UPRIGHT] }
    : { bar, standard: WITHOUT_BAR, withNotice: WITHOUT_BAR.map(withNotice), home: HOME_BARE, wholeView: [...WITHOUT_BAR, ...WITHOUT_BAR.map(withNotice), ...HOME_BARE, ...UPRIGHT_BARE] };
  ASKED.set(key, panes);
  return panes;
}
/** 收集测试的时候记下来的：哪一座沙盘查的是哪些栏。 */
const ASKED = new Map<string, TablePanes>();
/** 定稿样张的画面：照它定的镜头，在它上面程序不该再挪。 */
const TRIAL_PANE: Pane = { name: '880 × 900', size: { width: 880, height: 900 }, insets: NO_INSETS, paneWidth: 880 };

/** 全程沙盘上一条引线最长多少像素。 */
const ROUTE_LEADER_MAX_PX = 48;
// 镜头最近多少米（沙盘里的米）是一座沙盘一个数，在旁边的一张小表里（./support/routeFacts.ts 的 ROUTE_CAMERA_NEAREST_M：管的是
// 先画好的地面近看有多粗；苏轼的是 15,000，表里没有的沙盘照 15,000 查）。2026-11-26 以前这里是一个常数 ROUTE_DISTANCE_MIN = 15_000，每一座都照它查。
const NAMES: NamesMode[] = ['ancient', 'modern'];

/** 这几个数和 placeStrips.ts 里的一样。 */
const MARGIN = 4;
const DOT = 6;
const SEEN_OUTSIDE = 8;

interface Box {
  left: number;
  right: number;
  top: number;
  bottom: number;
}
const overlap = (a: Box, b: Box): boolean => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
function passesThrough(x1: number, y1: number, x2: number, y2: number, b: Box): boolean {
  const steps = Math.max(8, Math.ceil(Math.hypot(x2 - x1, y2 - y1) * 4));
  for (let i = 0; i <= steps; i++) {
    const x = x1 + ((x2 - x1) * i) / steps;
    const y = y1 + ((y2 - y1) * i) / steps;
    if (x > b.left + 0.01 && x < b.right - 0.01 && y > b.top + 0.01 && y < b.bottom - 0.01) return true;
  }
  return false;
}
const freeArea = ({ size, insets }: Pane): Box => ({ left: insets.left + MARGIN, top: insets.top + MARGIN, right: size.width - insets.right - MARGIN, bottom: size.height - insets.bottom - MARGIN });

/** 一节的镜头在一种画面上摆好：镜头、离多远是写的距离的几倍、要看得见的点、把沙盘里的一点投到画面上。 */
function placed(R: RealRouteScene, section: RouteSection, pane: Pane) {
  const { scene, coords, samplers } = R;
  const style = styleFor(scene.style);
  const view = placeCamera(section, scene, samplers, coords, style, pane.size, pane.insets);
  const camera = new PerspectiveCamera(view.pose.fov, pane.size.width / pane.size.height, Math.max(60, view.distanceM * 0.1), view.distanceM * 3 + 30000);
  camera.position.set(...view.pose.position);
  camera.lookAt(...view.pose.target);
  const [shiftX, shiftY] = centreShift(pane.insets);
  if (shiftX || shiftY) camera.setViewOffset(pane.size.width, pane.size.height, -shiftX, -shiftY, pane.size.width, pane.size.height);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
  const written = section.strips.map((id) => scene.strips.find((s) => s.id === id)).filter((s): s is SceneStrip => s !== undefined);
  const D = equivalentDistance(view.distanceM, view.pose.fov, pane.size.height);
  const anchors = screenAnchors(written, scene, samplers, coords, style, D, camera, pane.size);
  // 地面的四个角落在画面的哪里：沙盘程序每一帧交给题签层的那一份（平着的纸条不出这一块；竖着的纸条不看）
  const ground = groundCorners(coords, camera, pane.size);
  return { view, written, anchors, ground, at: (point: Vec3) => project(point, camera, pane.size) };
}

/**
 * 一节的题签在一种画面上：交给摆法的那一份。题签是平着的纸条的沙盘，连地面的四个角一起交（沙盘程序就是这样交的）；
 * 竖着的纸条的沙盘不交——交不交，它摆出来的一个数不差（tests/unit/place-strips.test.ts）。
 */
function arranged(R: RealRouteScene, section: RouteSection, pane: Pane, names: NamesMode): { input: StripInput; text: (id: string) => string } {
  const { written, anchors, ground } = placed(R, section, pane);
  // 题签用大的还是小的，照栏自己的宽分（584 像素宽的栏里画面是 583 像素宽，题签还是大的那一种）
  const strips = routeSectionStrips(R.scene, section.heading, pane.paneWidth, names);
  const text = (id: string): string => {
    const strip = written.find((s) => s.id === id);
    return strip ? (names === 'modern' && strip.modern ? strip.modern : strip.text) : id;
  };
  const slips = labelKind(R.scene.style) === 'slip';
  return { input: { strips, anchors, size: pane.size, insets: pane.insets, ...(slips && ground ? { ground } : {}) }, text };
}

/** 一条没摆的题签，说它是怎么回事：摆不下，没有点的名字四周找不到空，或者指的那一点不在画面里。 */
const hiddenWhy = (p: StripPlacement): string => (p.why === 'room' ? '摆不下' : p.why === 'area' ? '摆不下（这个名字没有点：写的那个位置四周 48 像素以内没有空）' : '指的那一点不在画面里');

/** 画面上的一点离地面那一块的边多远（在里面是正的）。四个角照绕一圈的先后。 */
function insideGroundBy(p: { x: number; y: number }, ground: NonNullable<StripInput['ground']>): number {
  let twice = 0;
  ground.forEach((a, i) => {
    const b = ground[(i + 1) % ground.length];
    twice += a.x * b.y - b.x * a.y;
  });
  const turn = Math.sign(twice);
  return Math.min(
    ...ground.map((a, i) => {
      const b = ground[(i + 1) % ground.length];
      const length = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      return (((p.x - a.x) * -(b.y - a.y) + (p.y - a.y) * (b.x - a.x)) / length) * turn;
    }),
  );
}

const inside = (p: { x: number; y: number; visible?: boolean }, { size, insets }: Pane): boolean =>
  p.visible !== false && p.x >= insets.left && p.x <= size.width - insets.right && p.y >= insets.top && p.y <= size.height - insets.bottom;

const leaderPx = (p: StripPlacement): number => (p.leader ? Math.hypot(p.leader[2] - p.leader[0], p.leader[3] - p.leader[1]) : 0);

/**
 * 摆出来的题签里不该有的事（和 scene-strips.test.ts 查的是同样几件）：出了留出来的那一块，压住了一个点，两条相叠，引线穿过别的题签。
 * 照题签的那一种有两处不一样（docs/data-spec.md“场景验收照题签的那一种查”），都只有平着的纸条才有：
 *   没有点的名字（交给摆法的那一份上写着 area）写的那个位置不算一个点：它自己的纸条摆在上面、别的纸条压过去，都不算“压点”；
 *   交了地面的四个角的，每一条纸条（连它前头的圆）四个角都要在那一块里面、离边至少 3 像素。
 * 竖着的纸条的沙盘这两样都没有（没有一条写着 area，也不交四个角）：查的和原来一个字不差。
 */
function faults(input: StripInput, result: StripPlacement[], pane: Pane, text: (id: string) => string): string[] {
  const found: string[] = [];
  const free = freeArea(pane);
  const seen = input.anchors.filter(
    (a, i) => !input.strips[i].area && a.visible && a.x >= free.left - SEEN_OUTSIDE && a.x <= free.right + SEEN_OUTSIDE && a.y >= free.top - SEEN_OUTSIDE && a.y <= free.bottom + SEEN_OUTSIDE,
  );
  const shown = result.flatMap((p, i) => {
    if (p.hidden) return [];
    const { w, h } = input.strips[i];
    return [{ p, box: { left: p.x - w / 2, right: p.x + w / 2, top: p.y - h / 2, bottom: p.y + h / 2 } }];
  });
  for (const a of shown) {
    const name = `“${text(a.p.id)}”`;
    if (a.box.left < free.left || a.box.right > free.right || a.box.top < free.top || a.box.bottom > free.bottom) found.push(`${name}出了留出来的那一块`);
    if (input.ground) {
      const ground = input.ground;
      const by = Math.min(
        ...[
          [a.box.left, a.box.top],
          [a.box.right, a.box.top],
          [a.box.right, a.box.bottom],
          [a.box.left, a.box.bottom],
        ].map(([x, y]) => insideGroundBy({ x, y }, ground)),
      );
      if (by < GROUND_INSET_PX - 1e-6) found.push(`${name}出了地面的边（离边 ${by.toFixed(1)} 像素，至少要 ${GROUND_INSET_PX}）`);
    }
    for (const dot of seen) {
      if (overlap(a.box, { left: dot.x - DOT, right: dot.x + DOT, top: dot.y - DOT, bottom: dot.y + DOT })) found.push(`${name}压住了“${text(dot.id)}”指的那一点`);
    }
    for (const b of shown) {
      if (a === b) continue;
      if (a.p.id < b.p.id && overlap(a.box, b.box)) found.push(`${name}和“${text(b.p.id)}”叠在一起`);
      if (a.p.leader && passesThrough(...a.p.leader, b.box)) found.push(`${name}的引线穿过了“${text(b.p.id)}”`);
    }
  }
  return found;
}

/**
 * 这座沙盘的题签照哪一套摆法摆：题签是哪一种，照它的样式从登记表查（src/stage/styles.ts）。竖着的纸条是 placeStrips；
 * 平着的纸条是它自己的那一套（src/stage/overlay/slips.ts 的 placeSlips）。题签多大也是照这一种算的（./support/stripSizes.ts 的 routeSectionStrips）。
 */
const placeLabels = (R: RealRouteScene, input: StripInput): StripPlacement[] => (labelKind(R.scene.style) === 'slip' ? placeSlips : placeStrips)(input);

/**
 * 两条题签的中心上下差不到这么多像素，算“差不多一样高”（下面查站名左右站没站反用的）。这是题签有多高定的数，一种题签一个：
 * 竖着的纸条 90——那是竖着的纸条的数：带印的站名有七十到九十几像素高，上下差不到 90 像素的两条在画面上看着就是并排的；
 * 平着的纸条只有 28 像素高，上下差不到 28 像素的两条才算并排。
 */
const SAME_ROW_PX: Record<LabelKind, number> = { strip: 90, slip: 28 };

/**
 * 站名站到别的站那一边去了：两个站的题签差不多一样高（中心上下差不到 row 像素：竖着的纸条是 90，见 SAME_ROW_PX），左右的先后却和它们指的两个点相反
 *（两个点、两条题签左右都差 12 像素以上才算）。孩子会把名字读到另一站头上去。sealed 是带着站号的印的那几条（就是站名）。
 */
function wrongSides(input: StripInput, result: StripPlacement[], sealed: Set<string>, text: (id: string) => string, row: number): string[] {
  const stops = result.flatMap((p, i) => (!p.hidden && sealed.has(p.id) ? [{ p, dot: input.anchors[i] }] : []));
  const found: string[] = [];
  for (let i = 0; i < stops.length; i++) {
    for (let j = i + 1; j < stops.length; j++) {
      const a = stops[i];
      const b = stops[j];
      const dots = a.dot.x - b.dot.x;
      const strips = a.p.x - b.p.x;
      if (Math.abs(a.p.y - b.p.y) < row && Math.abs(dots) > 12 && Math.abs(strips) > 12 && Math.sign(dots) !== Math.sign(strips)) found.push(`“${text(a.p.id)}”和“${text(b.p.id)}”左右站反了`);
    }
  }
  return found;
}

/** 看路的小节在一种画面上：到这一站的每一趟路，路上写的每个点查了多少个，落在留出来的那一块外面的是哪些。 */
function roadPointsOutside(R: RealRouteScene, pane: Pane): { checked: number; outside: string[] } {
  const outside: string[] = [];
  let checked = 0;
  // 看“这一站那几年走的路”的沙盘（roads.stopShows 写 stop-years）：这一站自己的路可以走出画面，不查
  if (!ownRoadsHeldInPane(R.scene)) return { checked, outside };
  for (const section of R.scene.sections.slice(1)) {
    const { view, at } = placed(R, section, pane);
    if (view.fit >= 2.49) continue;
    for (const journey of R.scene.roads.journeys.filter((item) => item.stop === section.stop)) {
      for (const part of journey.parts) {
        for (const written of part.ways) {
          const way = R.scene.roads.ways.find((item) => item.id === (written.startsWith('-') ? written.slice(1) : written));
          for (const p of way?.line ?? []) {
            const [x, z] = R.coords.toLocal(p);
            const on = at([x, R.coords.y(Math.max(0, R.samplers.height(x, z))), z]);
            checked++;
            if (!inside(on, pane)) outside.push(`${section.heading}：${journey.id} 的 ${way?.id} 上 [${p[0]}, ${p[1]}] 落在 (${on.x.toFixed(0)}, ${on.y.toFixed(0)})`);
          }
        }
      }
    }
  }
  return { checked, outside };
}

/** 一块很窄的画面（420 × 800，不是标准的沙盘栏）上：看路的小节里镜头退远了的有几节，路上写的点落在画面外面的是哪些。 */
function narrowView(R: RealRouteScene): { retreated: number; outside: string[] } {
  const narrow: Pane = { name: '420 × 800', size: { width: 420, height: 800 }, insets: leave(62, 130), paneWidth: 420 };
  const outside: string[] = [];
  let retreated = 0;
  for (const section of R.scene.sections.slice(1)) {
    const { view, at } = placed(R, section, narrow);
    if (view.fit > 1.05) retreated++;
    // 看“这一站那几年走的路”的沙盘：这一站自己的路可以走出画面，不查（镜头退没退照数）
    if (view.fit >= 2.49 || !ownRoadsHeldInPane(R.scene)) continue;
    for (const journey of R.scene.roads.journeys.filter((item) => item.stop === section.stop)) {
      for (const written of journey.parts.flatMap((part) => part.ways)) {
        const way = R.scene.roads.ways.find((item) => item.id === (written.startsWith('-') ? written.slice(1) : written));
        for (const p of way?.line ?? []) {
          const [x, z] = R.coords.toLocal(p);
          const on = at([x, R.coords.y(Math.max(0, R.samplers.height(x, z))), z]);
          if (!inside(on, narrow)) outside.push(`${section.heading}：${way?.id} 上 [${p[0]}, ${p[1]}] 落在 (${on.x.toFixed(0)}, ${on.y.toFixed(0)})，镜头是写的距离的 ${view.fit.toFixed(2)} 倍`);
        }
      }
    }
  }
  return { retreated, outside };
}

/** 场景里写的每一句 note：是哪样东西的。一趟路的 note 写在它的各截上。地形的整理不在这里：它每一节都印。 */
function writtenNotes(R: RealRouteScene): { what: string; note: string }[] {
  const { terrain, water } = R.scene;
  const all: { id: string; name: string; note?: string }[] = [
    { id: 'terrain', name: '地形', note: terrain.note },
    ...terrain.edits,
    { id: 'levels', name: '海面', note: water.levels.note },
    { id: 'coast', name: water.coast.name, note: water.coast.note },
    ...water.rivers,
    ...water.lakes,
    ...water.lakes.flatMap((lake) => (lake.except ? [lake.except] : [])),
    ...water.washes,
    ...R.scene.places,
    ...R.scene.far,
    ...R.scene.roads.journeys.flatMap((journey) => journey.parts.map((part, n) => ({ id: `${journey.id}/${n + 1}`, name: part.name, note: part.note }))),
  ];
  return all.flatMap((item) => (item.note?.trim() ? [{ what: `${item.name}（${item.id}）`, note: item.note.trim() }] : []));
}

/**
 * 另数一遍：第 upTo 节画着的路里（0 是头一节，每一趟都画），示意的和有一部分示意的截有几截。
 * 哪几趟画着，这里照规矩自己再数一遍，不用程序的那一个函数（src/domain/sceneRoads.ts）：照写的先后，这一站自己的最后一趟和写在它前面的都画着。
 */
function schematicParts(R: RealRouteScene, upTo: number): number {
  const stop = R.scene.sections[upTo]?.stop;
  let last = -1;
  R.scene.roads.journeys.forEach((journey, i) => {
    if (journey.stop === stop) last = i;
  });
  return R.scene.roads.journeys
    .filter((_, i) => upTo === 0 || i <= last)
    .flatMap((journey) => journey.parts)
    .filter((part) => part.class === 'schematic' || (part.class === 'text' && part.unsure?.trim())).length;
}

// ---------------------------------------------------------------- 每一座全程沙盘
// 下面各组 content/ 里有几座全程沙盘就查几座，查的是哪一座都该有的事。一座沙盘自己的数和地名（查到多少个点、几站、头一节讲哪几样、
// 哪条题签多高）在文件最后写着它名字的那一组里：添一位人物，不拿他的沙盘去对苏轼的数。

describe.each(realSceneKeys('route'))('%s 的镜头', (key) => {
  // 2026-11-26 以前这一条的名字是“每一节：朝北、不转；不比 15000 米近（看整块沙盘的一节除外，它由 closest 管）；视角是 18 度”，
  // 每一座都照 15,000 查。现在那个数一座沙盘一个，从旁边的表里读；苏轼的还是 15,000（写着他名字的那一组另守着），表里没有的也照 15,000。
  it('每一节：朝北、不转；不比这座沙盘自己的那个数近（./support/routeFacts.ts 的表：苏轼的是 15000 米，表里没有的沙盘照 15000 米；看整块沙盘的一节除外，它由 closest 管）；视角是 18 度', () => {
    const R = realRouteScene(key);
    const nearest = routeCameraNearestM(key);
    // 表里的数不能比默认的大出一截又没人知道：是正数，印出来
    expect(nearest).toBeGreaterThan(0);
    console.log(`${key} 看一站的小节，镜头最近 ${nearest} 米（${key in ROUTE_CAMERA_NEAREST_M ? '表里写的' : `表里没有，照 ${ROUTE_CAMERA_NEAREST_DEFAULT_M}`}）`);
    for (const section of R.scene.sections) {
      expect(section.camera.bearing, section.heading).toBe(0);
      expect(section.camera.fov, section.heading).toBe(18);
      if (!wholeTable(section)) {
        expect(section.camera.distanceM, section.heading).toBeGreaterThanOrEqual(nearest);
        expect(section.camera.closest, `${section.heading}：看路的小节不写 closest`).toBeUndefined();
      }
    }
    // 同一条规矩的另一种问法（算镜头的工具用的就是它）：一句也没有
    expect(camerasTooNear(R.scene, nearest)).toEqual([]);
  });

  const T = panesOf(key);

  describe.each(T.standard)('画面 $name', (pane) => {
    it('每条题签指着的那一点、mustShow 里的每个点，都在画面留出来的那一块里（镜头退到头的不算）', () => {
      const R = realRouteScene(key);
      const outside: string[] = [];
      for (const section of R.scene.sections) {
        const { view, written, anchors, at } = placed(R, section, pane);
        anchors.forEach((anchor, i) => {
          if (!inside(anchor, pane)) outside.push(`${section.heading}：“${written[i].text}”落在 (${anchor.x.toFixed(0)}, ${anchor.y.toFixed(0)})，镜头是写的距离的 ${view.fit.toFixed(2)} 倍`);
        });
        if (view.fit >= 2.49) continue;
        view.points.forEach((point, i) => {
          const p = at(point);
          if (!inside(p, pane)) outside.push(`${section.heading}：第 ${i + 1} 个要看的点落在 (${p.x.toFixed(0)}, ${p.y.toFixed(0)})`);
        });
      }
      expect(outside).toEqual([]);
    });

    it('看路的小节：到这一站的每一趟路，路上写的每个点都在画面留出来的那一块里（点是从场景里另算的，不是镜头自己报的）；看“这一站那几年走的路”的沙盘（roads.stopShows 写 stop-years）不查：那几年的路可以走出画面', () => {
      const R = realRouteScene(key);
      const { checked, outside } = roadPointsOutside(R, pane);
      // 真的查到了点（一座沙盘上查到多少个，写着它名字的那一组里另说）；路可以走出画面的沙盘一个点也不查
      if (ownRoadsHeldInPane(R.scene)) expect(checked).toBeGreaterThan(0);
      else expect(checked).toBe(0);
      expect(outside).toEqual([]);
    });

    it('看整块沙盘的一节，沙盘（连座子）上下的空一样、左右的空一样', () => {
      const R = realRouteScene(key);
      const off: string[] = [];
      for (const section of R.scene.sections) {
        if (!wholeTable(section)) continue;
        const { at } = placed(R, section, pane);
        const corners = framePoints(R.coords, styleFor(R.scene.style).stand).map((p) => at(p));
        const { size, insets } = pane;
        const left = Math.min(...corners.map((p) => p.x)) - insets.left;
        const right = size.width - insets.right - Math.max(...corners.map((p) => p.x));
        const top = Math.min(...corners.map((p) => p.y)) - insets.top;
        const bottom = size.height - insets.bottom - Math.max(...corners.map((p) => p.y));
        if (Math.abs(top - bottom) > 2 || Math.abs(left - right) > 2 || Math.min(left, right, top, bottom) < 8) off.push(`${section.heading}：上 ${top.toFixed(0)}、下 ${bottom.toFixed(0)}、左 ${left.toFixed(0)}、右 ${right.toFixed(0)}`);
      }
      expect(off).toEqual([]);
    });
  });

  it('画面很窄的时候（420 × 800，不是标准的沙盘栏）：路上写的每个点还都在画面里（镜头真的退远了没有，写着名字的那一组查）', () => {
    // 标准的沙盘栏上，每一节写的距离本来就装得下整条路，镜头用不着退；这里用一块窄得多的画面，看“mustShow 里写的那几趟路”真的在管事
    const R = realRouteScene(key);
    expect(narrowView(R).outside).toEqual([]);
  });

  // 人物没有行迹的沙盘，标准的沙盘栏只有不带时间轴的四种：这一条的名字照它查的栏说（有行迹的那一座，名字和以前一个字不差）
  it(`把每一节在标准的沙盘栏（${T.bar ? '不带时间轴的四种、带着时间轴的四种' : '这位人物没有行迹，他的页面上的栏都不带时间轴：四种'}）和样张的画面上摆好的数印出来：写的距离的几倍 / 镜头离多少米`, () => {
    const R = realRouteScene(key);
    const lines: string[] = [`${key} 每一节的镜头（写的距离的几倍 / 镜头离多少米）：`];
    for (const section of R.scene.sections) {
      const cells = [TRIAL_PANE, ...T.standard].map((pane) => {
        const { view } = placed(R, section, pane);
        return `${pane.name} ${view.fit.toFixed(2)} / ${view.distanceM.toFixed(0)}`;
      });
      lines.push(`  ${section.heading}（写的 ${section.camera.distanceM}）：${cells.join('；')}`);
    }
    console.log(lines.join('\n'));
    expect(lines.length).toBe(R.scene.sections.length + 1);
  });
});

describe.each(realSceneKeys('route'))('%s 的题签', (key) => {
  const T = panesOf(key);

  describe.each(T.standard)('标准的画面 $name', (pane) => {
    it.each(NAMES)('%s：每一节的题签一条也不少，不压点、不相叠、引线不穿过别的题签', (names) => {
      const R = realRouteScene(key);
      const problems: string[] = [];
      for (const section of R.scene.sections) {
        const { input, text } = arranged(R, section, pane, names);
        expect(input.strips.map((s) => s.id), section.heading).toEqual(section.strips);
        // 平着的纸条的沙盘：地面的四个角交到了摆法手里（这些栏上四个角都在镜头前面），“不出地面的边”才真的查了
        if (labelKind(R.scene.style) === 'slip') expect(input.ground, `${section.heading}：地面的四个角`).toHaveLength(4);
        const result = placeLabels(R, input);
        for (const p of result) if (p.hidden) problems.push(`${section.heading}：“${text(p.id)}”${hiddenWhy(p)}`);
        for (const fault of faults(input, result, pane, text)) problems.push(`${section.heading}：${fault}`);
      }
      expect(problems).toEqual([]);
    });

    it.each(NAMES)(`%s：没有一条引线超过 ${ROUTE_LEADER_MAX_PX} 像素`, (names) => {
      const R = realRouteScene(key);
      const long: string[] = [];
      for (const section of R.scene.sections) {
        const { input, text } = arranged(R, section, pane, names);
        for (const p of placeLabels(R, input)) {
          if (!p.hidden && leaderPx(p) > ROUTE_LEADER_MAX_PX) long.push(`${section.heading}：“${text(p.id)}”的引线 ${leaderPx(p).toFixed(0)} 像素`);
        }
      }
      expect(long).toEqual([]);
    });
  });

  it(`标准的画面上（${T.bar ? '不带时间轴的四种、带着时间轴的四种' : '这位人物没有行迹，他的页面上的栏都不带时间轴：四种'}）各摆下几条、最长的引线多少像素（打印出来）`, () => {
    const R = realRouteScene(key);
    const lines: string[] = [];
    for (const pane of T.standard) {
      for (const names of NAMES) {
        let asked = 0;
        let shown = 0;
        const longest: string[] = [];
        for (const section of R.scene.sections) {
          const { input, text } = arranged(R, section, pane, names);
          const result = placeLabels(R, input);
          asked += input.strips.length;
          shown += result.filter((p) => !p.hidden).length;
          const worst = result.reduce((best, p) => (leaderPx(p) > leaderPx(best) ? p : best), result[0]);
          longest.push(`${section.heading} ${leaderPx(worst).toFixed(0)}（${text(worst.id)}）`);
        }
        lines.push(`${key} ${pane.name} ${names === 'ancient' ? '当时的名字' : '今天的名字'}：${asked} 条里摆下 ${shown} 条；各节最长的引线：${longest.join('，')}`);
      }
    }
    console.log(lines.join('\n'));
    expect(lines.length).toBe(T.standard.length * NAMES.length);
  });

  it(`上面多一行说明的画面查的是每一种标准的沙盘栏，一种不少；${T.bar ? '带着时间轴的四种另查“那一行话下面再给小像留出地方”的时候' : '这位人物没有行迹，栏都不带时间轴，没有“那一行话下面再给小像留出地方”的时候'}`, () => {
    // 这座沙盘查的栏：有行迹的是八种标准的，没有行迹的是不带时间轴的四种；上面多一行说明的就是它们各多一行，一种不少
    expect(T.standard).toHaveLength(T.bar ? STANDARD_PANES.length + ROUTE_PANES.length : STANDARD_PANES.length);
    expect(T.withNotice.map((pane) => pane.name)).toEqual([
      ...T.standard.map((pane) => `${pane.name}，上面多一行说明`),
      ...(T.bar ? WITH_BAR.map((pane) => `${pane.name}，上面多一行说明、再给小像留出地方`) : []),
    ]);
    // 下面这几句说的是两种栏的数怎么对得上，哪一座沙盘都查一遍
    expect(STANDARD).toHaveLength(STANDARD_PANES.length + ROUTE_PANES.length);
    expect(WITH_NOTICE.map((pane) => pane.name)).toEqual([...STANDARD.map((pane) => `${pane.name}，上面多一行说明`), ...WITH_BAR.map((pane) => `${pane.name}，上面多一行说明、再给小像留出地方`)]);
    // 带着时间轴的栏：左右排的版面上栏还是那么大，下面多留一条；沙盘在上的版面上栏也高一条。上面留的不变
    ROUTE_PANES.forEach((pane, i) => {
      const without = STANDARD_PANES[i];
      expect(pane.insets.top, pane.name).toBe(without.insets.top);
      expect(pane.insets.bottom - without.insets.bottom, pane.name).toBe(96);
      expect(pane.size.width, pane.name).toBe(without.size.width);
      expect(pane.size.height - without.size.height, pane.name).toBe(without.window.width > without.window.height && without.window.width >= 960 ? 0 : 96);
    });
  });

  describe.each(T.withNotice)('上面多一行说明的画面 $name', (pane) => {
    it.each(NAMES)('%s：每一节的题签一条也不少（最长的引线打印出来，不设上限）', (names) => {
      const R = realRouteScene(key);
      const problems: string[] = [];
      const lines: string[] = [];
      for (const section of R.scene.sections) {
        const { input, text } = arranged(R, section, pane, names);
        const result = placeLabels(R, input);
        for (const p of result) if (p.hidden) problems.push(`${section.heading}：“${text(p.id)}”${hiddenWhy(p)}`);
        const worst = result.reduce((best, p) => (leaderPx(p) > leaderPx(best) ? p : best), result[0]);
        lines.push(`${section.heading} ${leaderPx(worst).toFixed(0)}（${text(worst.id)}）`);
      }
      console.log(`${key} ${pane.name} ${names === 'ancient' ? '当时的名字' : '今天的名字'}：各节最长的引线 ${lines.join('，')}`);
      expect(problems).toEqual([]);
    });
  });
});

describe('交给摆法的画面是沙盘程序拿到的那一块，不是沙盘栏自己的大小', () => {
  it('量过的每一种沙盘栏：交给摆法的画面比栏少栏自己的一条边线（左右排的版面少在宽上，沙盘在上的版面少在高上），四边留的空不变；题签用大的还是小的照栏自己的宽分；栏的名字还是栏自己的大小', () => {
    const all: StandardPane[] = [...STANDARD_PANES, ...ROUTE_PANES, ...HOME_PANES, ...ROUTE_HOME_PANES, ...UPRIGHT_PANES, ...ROUTE_UPRIGHT_PANES];
    for (const pane of all) {
      const placed = plain(pane);
      const sideBySide = pane.window.width >= 960 && pane.window.width > pane.window.height;
      expect(placed.size, pane.name).toEqual(sideBySide ? { width: pane.size.width - 1, height: pane.size.height } : { width: pane.size.width, height: pane.size.height - 1 });
      expect(placed.size, pane.name).toEqual(engineSize(pane));
      expect(placed.insets, pane.name).toEqual(pane.insets);
      expect(placed.paneWidth, pane.name).toBe(pane.size.width);
      expect(placed.name, pane.name).toBe(pane.name);
      // 上面多一行说明的时候也是这一块
      const noticed = withNotice(placed);
      if (noticeTop(pane.name) !== undefined) expect([noticed.size, noticed.paneWidth], noticed.name).toEqual([placed.size, placed.paneWidth]);
    }
    // 写出来的几个数：电脑、横着拿的平板、竖着拿的平板、竖着拿的大平板上一站的页面
    expect(WITHOUT_BAR.map((pane) => `${pane.name} → ${pane.size.width} × ${pane.size.height}`)).toEqual(['940 × 900 → 939 × 900', '584 × 768 → 583 × 768', '768 × 573 → 768 × 572', '1024 × 765 → 1024 × 764']);
    // 584 像素宽的栏里画面只有 583 像素宽：题签还是大的那一种（照栏自己的宽分）
    expect(WITHOUT_BAR[1].paneWidth).toBe(584);
    // 这个文件里查的每一种栏都是这样来的：没有哪一种还照栏自己的大小摆
    for (const pane of [...STANDARD, ...WITH_NOTICE, ...HOME, ...HOME_BARE, ...UPRIGHT, ...UPRIGHT_BARE]) {
      const [width, height] = pane.name.split('，')[0].split(' × ').map(Number);
      expect([width - pane.size.width, height - pane.size.height].sort(), pane.name).toEqual([0, 1]);
      expect(pane.paneWidth, pane.name).toBe(width);
    }
  });
});

// 2026-11-27 以前这一组的名字是“‘再给小像留出地方’的四种画面只查人物有行迹的全程沙盘”，守的是“没有行迹的人物的那一座跳过那四种”
//（那时页面还给每一位人物的人物页留着时间轴的那一条，别的带着时间轴的栏照查）。现在没有行迹的人物的页面上没有时间轴，
// 他的沙盘查的整个换成不带时间轴的栏：这一条守的是“谁查哪一种，照文件夹读”，原来那一句（没有行迹的不查那四种）还在里面。
describe('一座全程沙盘查的是它的页面摆得出来的栏：带不带时间轴，照人物有没有行迹', () => {
  it('带着时间轴的栏（连“再给小像留出地方”的四种）只查 content/ 里人物的文件夹里有 itinerary.json 的全程沙盘，查的和以前一种不差；没有的那几座查的是同样几种窗口上不带时间轴的栏，带着时间轴的一种也没有（照文件夹读，不是一张写死的单子；打印出来）', () => {
    const keys = realSceneKeys('route');
    expect(keys.length, 'content/ 里要有全程沙盘').toBeGreaterThan(0);
    // 照文件夹另数一遍：content/figures/ 里每一位人物的文件夹（index.json 不是文件夹），里面有没有 itinerary.json
    const folders = namesIn('content/figures').filter((name) => !name.includes('.'));
    const without = folders.filter((figure) => !namesIn(`content/figures/${figure}`).includes('itinerary.json'));
    for (const key of keys) expect(folders, key).toContain(key.split('/')[0]);
    // 收集测试的时候每一座真的查了哪些栏（panesOf 记的账）：每一座都有一笔
    expect([...ASKED.keys()].sort()).toEqual([...keys].sort());
    // 两种栏的名字另写一遍（不从 panesOf 里取）：窗口是同样几种，差的只是带不带时间轴
    const windows = (panes: readonly { window: { width: number; height: number } }[]): string[] => panes.map((pane) => `${pane.window.width} × ${pane.window.height}`);
    expect(windows(ROUTE_PANES)).toEqual(windows(STANDARD_PANES));
    expect(windows(ROUTE_UPRIGHT_PANES)).toEqual(windows(UPRIGHT_PANES));
    expect(windows(ROUTE_HOME_PANES)).toEqual(windows(HOME_PANES));
    const notice = (name: string): string => `${name}，上面多一行说明`;
    const head = (name: string): string => `${name}，上面多一行说明、再给小像留出地方`;
    const bare = STANDARD_PANES.map((pane) => pane.name);
    const barred = ROUTE_PANES.map((pane) => pane.name);
    const want = {
      with: {
        standard: [...bare, ...barred],
        withNotice: [...[...bare, ...barred].map(notice), ...barred.map(head)],
        home: ROUTE_HOME_PANES.slice(0, 2).map((pane) => pane.name),
        wholeView: [...barred, ...barred.map(notice), ...ROUTE_HOME_PANES.slice(0, 2).map((pane) => pane.name), ...ROUTE_UPRIGHT_PANES.flatMap((pane) => [pane.name, notice(pane.name)])],
      },
      without: {
        standard: bare,
        withNotice: bare.map(notice),
        home: HOME_PANES.slice(0, 2).map((pane) => pane.name),
        wholeView: [...bare, ...bare.map(notice), ...HOME_PANES.slice(0, 2).map((pane) => pane.name), ...UPRIGHT_PANES.flatMap((pane) => [pane.name, notice(pane.name)])],
      },
    };
    // 首页的两种说的是宽屏上的那两种（沙盘在上的两种窗口上首页的栏和人物页的一样）
    expect(ROUTE_HOME_PANES.slice(2)).toEqual(ROUTE_PANES.slice(2));
    expect(HOME_PANES.slice(2)).toEqual(STANDARD_PANES.slice(2));
    const names = (panes: Pane[]): string[] => panes.map((pane) => pane.name);
    const lines: string[] = [];
    for (const key of keys) {
      const figure = key.split('/')[0];
      const asked = ASKED.get(key)!;
      const lacks = without.includes(figure);
      // 照文件夹：有 itinerary.json 的带时间轴，没有的不带
      expect(asked.bar, key).toBe(!lacks);
      const wanted = lacks ? want.without : want.with;
      expect(names(asked.standard), `${key}：标准的`).toEqual(wanted.standard);
      expect(names(asked.withNotice), `${key}：上面多一行说明的`).toEqual(wanted.withNotice);
      expect(names(asked.home), `${key}：首页的`).toEqual(wanted.home);
      expect(names(asked.wholeView), `${key}：“全程”那一节的`).toEqual(wanted.wholeView);
      const all = [...asked.standard, ...asked.withNotice, ...asked.home, ...asked.wholeView].map((pane) => pane.name);
      const withBar = all.filter((name) => name.includes('带时间轴'));
      const withHead = all.filter((name) => name.endsWith('再给小像留出地方'));
      if (lacks) {
        // 没有行迹：带着时间轴的一种也不查，“再给小像留出地方”的也就没有
        expect(withBar, key).toEqual([]);
        expect(withHead, key).toEqual([]);
      } else {
        // 有行迹：带着时间轴的各种都查，“再给小像留出地方”的四种都在
        expect(withHead, key).toEqual(WITH_HEAD.map((pane) => pane.name));
        expect(WITH_HEAD).toHaveLength(ROUTE_PANES.length);
        expect(withBar.length, key).toBe(barred.length + barred.length * 2 + 2 + (barred.length * 2 + 2 + ROUTE_UPRIGHT_PANES.length * 2));
      }
      lines.push(
        lacks
          ? `${key}：content/figures/${figure}/ 里没有 itinerary.json，这位人物没有行迹，他的页面上没有时间轴：查的是不带时间轴的栏（标准的 ${asked.standard.length} 种，上面多一行说明的 ${asked.withNotice.length} 种，首页的 ${asked.home.length} 种，“全程”那一节 ${asked.wholeView.length} 种），带着时间轴的、“再给小像留出地方”的一种也不查；他的行迹进来以后自己就查`
          : `${key}：这位人物有行迹，带着时间轴的栏都查（标准的 ${asked.standard.length} 种，上面多一行说明的 ${asked.withNotice.length} 种里有“再给小像留出地方”的 ${WITH_HEAD.length} 种，首页的 ${asked.home.length} 种，“全程”那一节 ${asked.wholeView.length} 种）`,
      );
    }
    console.log(lines.join('\n'));
    expect(lines).toHaveLength(keys.length);
  });
});

describe.each(realSceneKeys('route'))('%s 在首页上', (key) => {
  // 首页摆的是同一座全程沙盘、同一栏，一打开看的是头一节（全程）；读者动了时间轴，别的各节也在这一栏里看。
  // 宽屏上首页的栏比人物页的窄（./support/standardPanes.ts 的 ROUTE_HOME_PANES），所以每一节在这两种栏上另查一遍，
  // 规矩和标准的沙盘栏上一样：题签一条不少，不压点、不相叠，引线不超过 48 像素；头一节的沙盘摆在正中。
  // 人物没有行迹的那一座（要是首页摆的是它）：首页的栏也不带时间轴，查的是 HOME_PANES 里宽屏上的那两种。
  const T = panesOf(key);

  describe.each(T.home)('首页的沙盘栏 $name', (pane) => {
    it.each(NAMES)(`%s：每一节的题签一条也不少，不压点、不相叠、引线不穿过别的题签，没有一条引线超过 ${ROUTE_LEADER_MAX_PX} 像素`, (names) => {
      const R = realRouteScene(key);
      const problems: string[] = [];
      const lines: string[] = [];
      for (const section of R.scene.sections) {
        const { input, text } = arranged(R, section, pane, names);
        expect(input.strips.map((s) => s.id), section.heading).toEqual(section.strips);
        // 平着的纸条的沙盘：地面的四个角交到了摆法手里（这些栏上四个角都在镜头前面），“不出地面的边”才真的查了
        if (labelKind(R.scene.style) === 'slip') expect(input.ground, `${section.heading}：地面的四个角`).toHaveLength(4);
        const result = placeLabels(R, input);
        for (const p of result) if (p.hidden) problems.push(`${section.heading}：“${text(p.id)}”${hiddenWhy(p)}`);
        for (const fault of faults(input, result, pane, text)) problems.push(`${section.heading}：${fault}`);
        for (const p of result) if (!p.hidden && leaderPx(p) > ROUTE_LEADER_MAX_PX) problems.push(`${section.heading}：“${text(p.id)}”的引线 ${leaderPx(p).toFixed(0)} 像素`);
        const worst = result.reduce((best, p) => (leaderPx(p) > leaderPx(best) ? p : best), result[0]);
        lines.push(`${section.heading} ${leaderPx(worst).toFixed(0)}（${text(worst.id)}）`);
      }
      console.log(`${key} 首页 ${pane.name} ${names === 'ancient' ? '当时的名字' : '今天的名字'}：各节最长的引线 ${lines.join('，')}`);
      expect(problems).toEqual([]);
    });

    it('全程那一节：题签指的每一点都在画面留出来的那一块里；整块沙盘（连座子）上下的空一样、左右的空一样', () => {
      const R = realRouteScene(key);
      const section = R.scene.sections[0];
      expect(wholeTable(section), '头一节看的是整块沙盘').toBe(true);
      const { written, anchors, at } = placed(R, section, pane);
      anchors.forEach((anchor, i) => expect(inside(anchor, pane), `“${written[i].text}”落在 (${anchor.x.toFixed(0)}, ${anchor.y.toFixed(0)})`).toBe(true));
      const corners = framePoints(R.coords, styleFor(R.scene.style).stand).map((p) => at(p));
      const { size, insets } = pane;
      const left = Math.min(...corners.map((p) => p.x)) - insets.left;
      const right = size.width - insets.right - Math.max(...corners.map((p) => p.x));
      const top = Math.min(...corners.map((p) => p.y)) - insets.top;
      const bottom = size.height - insets.bottom - Math.max(...corners.map((p) => p.y));
      expect(Math.abs(top - bottom), `上 ${top.toFixed(0)}、下 ${bottom.toFixed(0)}`).toBeLessThanOrEqual(2);
      expect(Math.abs(left - right), `左 ${left.toFixed(0)}、右 ${right.toFixed(0)}`).toBeLessThanOrEqual(2);
      expect(Math.min(left, right, top, bottom)).toBeGreaterThanOrEqual(8);
    });
  });

  it('首页另查的就是宽屏上的那两种栏；沙盘在上的两种窗口上，首页的栏和人物页的一模一样', () => {
    // 有行迹的人物：带着时间轴的两种；没有行迹的：同样两种窗口上不带时间轴的两种
    expect(T.home.map((pane) => pane.name)).toEqual(T.bar ? ['800 × 900，带时间轴', '553 × 768，带时间轴'] : ['800 × 900', '553 × 768']);
    expect(HOME.map((pane) => pane.name)).toEqual(['800 × 900，带时间轴', '553 × 768，带时间轴']);
    expect(HOME_BARE.map((pane) => pane.name)).toEqual(['800 × 900', '553 × 768']);
    expect(ROUTE_HOME_PANES.slice(2)).toEqual(ROUTE_PANES.slice(2));
    expect(HOME_PANES.slice(2)).toEqual(STANDARD_PANES.slice(2));
    // 首页的栏只比人物页的窄，不比它高
    const figurePage = T.bar ? ROUTE_PANES : STANDARD_PANES;
    T.home.forEach((pane, i) => {
      expect(pane.size.height).toBe(figurePage[i].size.height);
      expect(pane.size.width).toBeLessThan(figurePage[i].size.width);
    });
  });
});

describe.each(realSceneKeys('route'))('%s：“全程”那一节的站名', (key) => {
  // 人物页和首页一打开看的就是这一节，八站的名字都在上面。沙盘栏矮了（竖着拿的平板，上面再多一行说明），整块沙盘就小，题签最挤：
  // 2026-11-20 出过的事是徐州的名字站到了密州的东边、海里，汴京的名字落到了大江以南。所以这一节在量过的每一种沙盘栏上都查，
  // 连上面多一行说明的（只放图片的那一档、设备嫌慢、浏览器画不了立体的沙盘时，人物页和首页就是这样）。
  // 看这一节的只有人物页和首页：人物有行迹的，它们的栏都带着时间轴，查的是带着时间轴的各种栏；
  // 人物没有行迹的，它们的栏都不带，查的是同样几种窗口上不带时间轴的栏（panesOf）。
  const WHOLE_VIEW: Pane[] = panesOf(key).wholeView;

  describe.each(WHOLE_VIEW)('画面 $name', (pane) => {
    it.each(NAMES)(`%s：题签一条不少，不压点、不相叠；没有一条引线超过 ${ROUTE_LEADER_MAX_PX} 像素；站名不站到别的站那一边去`, (names) => {
      const R = realRouteScene(key);
      const section = R.scene.sections[0];
      const { input, text } = arranged(R, section, pane, names);
      const result = placeLabels(R, input);
      const sealed = new Set(stripTexts(R.scene, section.heading, names).flatMap((t) => (t.stops?.length ? [t.id] : [])));
      // 有带着印的站名（这一座是几站，写着名字的那一组查；每一站都有印，在“站号的印”那一组查）
      expect(sealed.size, '头一节里要有带着印的站名').toBeGreaterThan(0);
      const problems: string[] = [];
      for (const p of result) if (p.hidden) problems.push(`“${text(p.id)}”${hiddenWhy(p)}`);
      problems.push(...faults(input, result, pane, text));
      for (const p of result) if (!p.hidden && leaderPx(p) > ROUTE_LEADER_MAX_PX) problems.push(`“${text(p.id)}”的引线 ${leaderPx(p).toFixed(0)} 像素`);
      problems.push(...wrongSides(input, result, sealed, text, SAME_ROW_PX[labelKind(R.scene.style)]));
      expect(problems).toEqual([]);
    });
  });

  it('查到的画面：四种标准的、上面多一行说明的四种、首页的两种、别的竖着拿的平板五种连它们多一行说明的；各种画面上最长的引线（打印出来）', () => {
    expect(WHOLE_VIEW).toHaveLength(4 + 4 + 2 + 10);
    expect(UPRIGHT_PANES.map((pane) => pane.window.width)).toEqual([744, 800, 810, 820, 834]);
    // 别的竖着拿的平板上留的空和标准的那一种一样，多一行说明时上面留的也一样
    for (const pane of UPRIGHT_PANES) {
      expect(pane.insets, pane.name).toEqual(STANDARD_PANES[2].insets);
      expect(NOTICE_ROW_TOP[pane.name], pane.name).toBe(NOTICE_ROW_TOP[STANDARD_PANES[2].name]);
    }
    // 带着时间轴的也一样
    expect(ROUTE_UPRIGHT_PANES.map((pane) => pane.window.width)).toEqual(UPRIGHT_PANES.map((pane) => pane.window.width));
    for (const pane of ROUTE_UPRIGHT_PANES) {
      expect(pane.insets, pane.name).toEqual(ROUTE_PANES[2].insets);
      expect(ROUTE_NOTICE_ROW_TOP[pane.name], pane.name).toBe(ROUTE_NOTICE_ROW_TOP[ROUTE_PANES[2].name]);
    }
    const R = realRouteScene(key);
    const section = R.scene.sections[0];
    const lines = WHOLE_VIEW.map((pane) => {
      const cells = NAMES.map((names) => {
        const { input, text } = arranged(R, section, pane, names);
        const result = placeLabels(R, input);
        const worst = result.reduce((best, p) => (leaderPx(p) > leaderPx(best) ? p : best), result[0]);
        return `${leaderPx(worst).toFixed(0)}（${text(worst.id)}）`;
      });
      return `  ${pane.name}：${cells.join(' / ')}`;
    });
    console.log(`${key} “全程”那一节各种画面上最长的引线（当时的名字 / 今天的名字）：\n${lines.join('\n')}`);
    expect(lines).toHaveLength(WHOLE_VIEW.length);
  });
});

describe.each(realSceneKeys('route'))('%s 的说明', (key) => {
  const written = writtenNotes;

  /** 每一节印在沙盘旁边的字（页面用的就是这个函数）。 */
  const printed = (R: RealRouteScene) => R.scene.sections.map((section) => ({ section, info: sectionInfo(R.scene, section.heading) }));

  it('写了的每一句说明，至少有一节把它印出来（查的是印出来的字，不是 explain 里的 id）；地形的整理每一节都印', () => {
    const R = realRouteScene(key);
    const all = printed(R);
    const shown = new Set(all.flatMap(({ info }) => info.note.lines));
    const lost = written(R)
      .filter((item) => !shown.has(item.note))
      .map((item) => item.what);
    expect(lost, '这几样写了说明，却没有哪一节印出来').toEqual([]);
    const recipe = R.scene.terrain.recipe.note?.trim();
    expect(recipe).toBeTruthy();
    for (const { section, info } of all) expect(info.note.lines[1], section.heading).toBe(recipe);
  });

  it('每一节展开的说明：头一句说哪些是示意，第二句是地形的整理，最后一句是山高和画宽了；中间印的都是场景里写的句子，一句不印两遍', () => {
    const R = realRouteScene(key);
    const notes = new Set([...written(R).map((item) => item.note), ...R.scene.notDrawn.map((item) => item.why.trim())]);
    const { highTimes, lowTimes } = R.scene.frame.relief;
    for (const { section, info } of printed(R)) {
      const { lines } = info.note;
      expect(lines[0], section.heading).toMatch(/是示意。$/);
      expect(lines[lines.length - 1], section.heading).toBe(`山的高度夸大了约 ${highTimes} 到 ${lowTimes} 倍，矮山夸得多、高山夸得少；河和路都画宽了，不按比例。`);
      const middle = lines.slice(2, -1);
      expect(middle.length, `${section.heading}：explain 里点的东西至少印出一句`).toBeGreaterThan(0);
      for (const line of middle) expect(notes.has(line), `${section.heading}：“${line}”不是场景里写的句子`).toBe(true);
      expect(new Set(lines).size, section.heading).toBe(lines.length);
    }
  });

  // 2026-11-26 以前这一条的名字是“看路的一节：到这一站的每一趟路，它写了的每一句 note 都印在这一节；后面各站的路不算在‘几样是示意’里”，
  // 每一座都照“这一站的每一趟”查。看“这一站那几年走的路”的沙盘上，一站可以有几十趟自己的路，印在这一节的是 explain 点到的那几趟
  //（docs/data-spec.md“看一站的小节画的是什么”）；哪几趟要印照 ./support/routeFacts.ts 的 journeysWithNotesPrinted。苏轼的这一座照旧是每一趟。
  it('看路的一节：到这一站的每一趟路，它写了的每一句 note 都印在这一节（看“这一站那几年走的路”的沙盘——roads.stopShows 写 stop-years——是这一站自己的路里 explain 点到的那几趟）；后面各站的路不算在“几样是示意”里', () => {
    const R = realRouteScene(key);
    const all = printed(R);
    const count = (brief: string): number => Number(/^(\d+) 样是示意/.exec(brief)?.[1]);
    /** 另数一遍：这一节画着的路里，示意的和有一部分示意的截。 */
    const partsShown = (upTo: number): number => schematicParts(R, upTo);
    /** 这一节的题签指到的远处、名字没有点的地名点里归在示意一类的（这两样只在题签指到它的那一节算；2026-11-26 以前只数远处）。 */
    const farShown = (strips: string[]): number => schematicWherePointed(R.scene, { strips });
    const fixed = count(all[0].info.note.brief) - partsShown(0) - farShown(all[0].section.strips);
    const lines: string[] = [];
    let journeysChecked = 0;
    all.forEach(({ section, info }, n) => {
      for (const journey of n > 0 ? journeysWithNotesPrinted(R.scene, section) : []) {
        journeysChecked++;
        for (const part of journey.parts) if (part.note?.trim()) expect(info.note.lines, `${section.heading}：${part.name}的说明`).toContain(part.note.trim());
      }
      // 不是路、不是远处的那些（河、湖、海岸……）每一节都一样多：差的只是路
      expect(count(info.note.brief) - partsShown(n) - farShown(section.strips), section.heading).toBe(fixed);
      lines.push(`${section.heading} ${count(info.note.brief)} 样`);
    });
    // 真的查到了路：每一节看一站的小节至少有一趟（两种沙盘都是：ownJourneysTold 另守着）
    expect(journeysChecked).toBeGreaterThanOrEqual(all.length - 1);
    // 画的路只多不少：到头一站的那一节算进去的示意的截，不比每一趟都画的头一节多（这一座上真的少了没有，写着名字的那一组查）
    expect(partsShown(1)).toBeLessThanOrEqual(partsShown(0));
    console.log(`${key} 各节“几样是示意”：${lines.join('，')}（其中不是路也不是远处的 ${fixed} 样）`);
  });

  it('长短：题记最多 40 个字；题记连同远处的那句话最多 50 个字宽；常印着的一句最多 60 个字，栏窄时的一句最多 32 个字（最长的各印出来）', () => {
    const R = realRouteScene(key);
    const longest = { line: ['', 0] as [string, number], withFar: ['', 0] as [string, number], short: ['', 0] as [string, number], brief: ['', 0] as [string, number] };
    const take = (slot: [string, number], heading: string, length: number): void => {
      if (length > slot[1]) [slot[0], slot[1]] = [heading, length];
    };
    let far = 0;
    for (const { section, info } of printed(R)) {
      const line = [...info.line].length;
      // 和校验规则 14 同一种量法：汉字算一个，数字、字母、空格算半个；题记和远处的那句话之间空半个字
      const withFar = textWidth(info.line) + info.far.reduce((sum, item) => sum + 0.5 + textWidth(`${item.name}：${item.say}`), 0);
      far += info.far.length;
      expect(line, `${section.heading} 的题记`).toBeLessThanOrEqual(LINE_MAX);
      expect(withFar, `${section.heading} 的题记连同远处`).toBeLessThanOrEqual(WORDS_MAX);
      expect([...info.note.short].length, `${section.heading} 常印着的一句`).toBeLessThanOrEqual(NOTE_SHORT_MAX);
      expect([...info.note.brief].length, `${section.heading} 栏窄时的一句`).toBeLessThanOrEqual(NOTE_BRIEF_MAX);
      take(longest.line, section.heading, line);
      take(longest.withFar, section.heading, withFar);
      take(longest.short, section.heading, [...info.note.short].length);
      take(longest.brief, section.heading, [...info.note.brief].length);
    }
    expect([LINE_MAX, WORDS_MAX, NOTE_SHORT_MAX, NOTE_BRIEF_MAX]).toEqual([40, 50, 60, 32]);
    // 这一座上有没有远处、“连同远处”那一项真的量到了东西没有，写着名字的那一组查；这里只印出来
    console.log(`${key}：各节印出来的远处一共 ${far} 处`);
    console.log(
      `${key} 最长的：题记 ${longest.line[1]} 个字（${longest.line[0]}）；题记连同远处 ${longest.withFar[1]} 个字宽（${longest.withFar[0]}）；` +
        `常印着的一句 ${longest.short[1]} 个字（${longest.short[0]}）；栏窄时的一句 ${longest.brief[1]} 个字（${longest.brief[0]}）`,
    );
  });

  it('每一节看路的小节，explain 里有到这一站的每一趟路，mustShow 里也有（头一节讲哪几样，写着名字的那一组查）；看“这一站那几年走的路”的沙盘（roads.stopShows 写 stop-years）：explain 里至少有一趟这一站自己的路，mustShow 不管路', () => {
    const R = realRouteScene(key);
    // 两种沙盘各问什么在 ./support/routeFacts.ts：不合的一句一句列出来，这里要一句也没有
    expect(ownJourneysTold(R.scene)).toEqual([]);
  });

  it('题记：提到的站名、水名、山名，这一节都立着题签', () => {
    const R = realRouteScene(key);
    const names = [...new Set(R.scene.strips.map((strip) => strip.text))];
    const missing: string[] = [];
    for (const section of R.scene.sections) {
      const shown = new Set(stripTexts(R.scene, section.heading, 'ancient').map((strip) => strip.text));
      for (const name of names) {
        // “海”是一个字，题记里的“海边”“过海”不一定是说那条题签：只有站名和两个字以上的名字才这样查
        if ([...name].length < 2) continue;
        if (section.line.includes(name) && !shown.has(name)) missing.push(`${section.heading}：题记里说到“${name}”，这一节却没有它的题签`);
      }
    }
    expect(missing).toEqual([]);
  });
});

describe.each(realSceneKeys('route'))('%s 的站号的印', (key) => {
  it('是站的地名，题签带着这几站（页面拼的那一份）；题签的高照印的方数算：一站一方，一个地名带着两站的两方', () => {
    const R = realRouteScene(key);
    const first = R.scene.sections[0].heading;
    const texts = stripTexts(R.scene, first, 'ancient');
    const sized = routeSectionStrips(R.scene, first, 940);
    const sealed = texts.filter((t) => t.stops);
    expect(sealed.length).toBeGreaterThan(0);
    // 题签多大照这座沙盘的题签是哪一种算（./support/stripSizes.ts 的 labelSize）：竖着的纸条，站号是脚上的印，一方印高出一截——
    // 就是这一条的名字说的；平着的纸条，站号是名字前头的圆，一个圆宽出一截，高不变
    const kind = labelKind(R.scene.style);
    texts.forEach((t, i) => {
      const seals = t.stops?.length ?? 0;
      const area = kind === 'slip' && isAreaName(R.scene, t.id);
      expect(sized[i], t.text).toMatchObject({ id: t.id, ...labelSize(kind, t.text, 'wide', seals, area) });
      const bare = labelSize(kind, t.text, 'wide', 0, area);
      // 带印的比不带印的高（竖着的纸条）；带着圆的比不带的宽、一样高（平着的纸条）
      if (seals > 0 && kind === 'strip') expect(sized[i].h, t.text).toBeGreaterThan(bare.h);
      if (seals > 0 && kind === 'slip') {
        expect(sized[i].w, t.text).toBeGreaterThan(bare.w);
        expect(sized[i].h, t.text).toBe(bare.h);
      }
    });
    // 头一节里每一站都有印，没有别的站（一站可以盖在两个地名上）
    const stops = R.scene.sections.flatMap((section) => (section.stop ? [section.stop] : []));
    expect([...new Set(sealed.flatMap((t) => t.stops ?? []))].sort()).toEqual([...stops].sort());
  });
});

// ---------------------------------------------------------------- 苏轼的这一座自己的数和地名

describe('su-shi/route：苏轼这一座自己的数和地名', () => {
  const key = 'su-shi/route';

  describe.each(STANDARD)('镜头，画面 $name', (pane) => {
    it('看路的小节：到各站的路上写的点，查到的有两百个以上', () => {
      expect(roadPointsOutside(realRouteScene(key), pane).checked).toBeGreaterThan(200);
    });
  });

  it('镜头：这一座看一站的小节最近 15000 米，是表里写着的（不是表里没有、照默认的数顶上的）；写的距离最近的一节是 15000 米以上', () => {
    expect(ROUTE_CAMERA_NEAREST_M[key]).toBe(15_000);
    expect(routeCameraNearestM(key)).toBe(15_000);
    const R = realRouteScene(key);
    const written = R.scene.sections.filter((section) => !wholeTable(section)).map((section) => section.camera.distanceM);
    expect(Math.min(...written)).toBeGreaterThanOrEqual(15_000);
    // 这个数在管事：拿一个比它大的数来查，查得出近的那几节
    expect(camerasTooNear(R.scene, Math.min(...written) + 1).length).toBeGreaterThan(0);
  });

  it('说明：九节“几样是示意”是 33、22、23、25、26、28、28、29、33——名字没有点的地方只在立了它的题签的小节里算（2026-11-26）以后还是这九个数：这一座上没有这样的地名点', () => {
    const R = realRouteScene(key);
    const counts = R.scene.sections.map((section) => Number(/^(\d+) 样是示意/.exec(sectionInfo(R.scene, section.heading).note.brief)?.[1]));
    expect(counts).toEqual([33, 22, 23, 25, 26, 28, 28, 29, 33]);
    expect(R.scene.places.filter((place) => place.area)).toEqual([]);
    // 这一座上两个示意的地名点（有点的）照旧每一节都算，立没立题签都算
    const schematic = R.scene.places.filter((place) => place.class === 'schematic').map((place) => place.id);
    expect(schematic.length).toBeGreaterThan(0);
    // 有的小节一条指着它们的题签也没有立：那几节的数里照样有它们（每一节不是路、不是远处的那些一样多，上面“每一座”那一组里守着）
    expect(R.scene.sections.some((section) => !section.strips.some((id) => schematic.includes(R.scene.strips.find((strip) => strip.id === id)?.of ?? '')))).toBe(true);
  });

  it('镜头：画面很窄的时候（420 × 800）有的小节镜头真的照着路退远了', () => {
    // 这一座上每一节写的距离在标准的沙盘栏上装得下整条路；窄到 420 像素就装不下了，镜头得退——“mustShow 里写的那几趟路”真的在管事
    expect(narrowView(realRouteScene(key)).retreated).toBeGreaterThan(0);
  });

  it.each(NAMES)('“全程”那一节的站名，%s：八站的名字都带着印', (names) => {
    const R = realRouteScene(key);
    const sealed = new Set(stripTexts(R.scene, R.scene.sections[0].heading, names).flatMap((t) => (t.stops?.length ? [t.id] : [])));
    expect(sealed.size, '八站的名字都带着印').toBeGreaterThanOrEqual(8);
  });

  it('说明：写了说明的东西有十样以上；到头一站的那一节算进去的示意的截，比每一趟都画的头一节少', () => {
    const R = realRouteScene(key);
    expect(writtenNotes(R).length).toBeGreaterThan(10);
    expect(schematicParts(R, 1)).toBeLessThan(schematicParts(R, 0));
  });

  it('说明：这座沙盘上有一处远处（定州），“题记连同远处”那一项真的量到了东西', () => {
    const R = realRouteScene(key);
    const far = R.scene.sections.reduce((sum, section) => sum + sectionInfo(R.scene, section.heading).far.length, 0);
    expect(far).toBeGreaterThan(0);
  });

  it('说明：头一节讲的是黄河、大江、海岸、湖和路这五样', () => {
    const R = realRouteScene(key);
    expect(R.scene.sections[0].explain).toHaveLength(5);
    // 头一节印出来的是这五句：五样东西各一句，一句不少
    expect(sectionInfo(R.scene, R.scene.sections[0].heading).note.lines).toHaveLength(5 + 3);
  });

  it('站号的印：宽的栏上徐州 72 像素高，杭州（两方印）94，昌化军 91', () => {
    const R = realRouteScene(key);
    const first = R.scene.sections[0].heading;
    const texts = stripTexts(R.scene, first, 'ancient');
    const sized = routeSectionStrips(R.scene, first, 940);
    const h = (text: string): number => sized[texts.findIndex((t) => t.text === text)].h;
    expect([h('徐州'), h('杭州'), h('昌化军')]).toEqual([72, 94, 91]);
  });
});
