// 凭证：把沙盘程序造出来的几样东西各算成一份记得住的样子（数目和记号）——座子的网格，全程沙盘的地面，路的笔画，
// 画路的程序交给显卡的线段，小像的网格。写着沙盘名字的测试（现在是 ../su-shi-witness.test.ts）把某一天算出来的存着，
// 以后搬动程序（一种样式自己的东西搬出沙盘程序，一种状态的虚线合成一批，小像的几圈搬进样式……），
// 只要造出来的东西没有变，这里算出来的就还是存着的那一份；变了一个数，就对不上。
//
// 比的是“造出来什么”，不是“怎么造的”：
//   网格摊开成一个一个三角形的角来比（有没有索引、位置是写在顶点上还是写在网格的位置上，都不要紧）；
//   交给显卡的线段按“哪一层、什么颜色、多透、多宽、实线还是虚线”分组，组里的线段排好了再算（分几批、哪一批先交，都不要紧）；
//   线段的两头换到整组线外面的坐标里再比（位置是写在顶点上、写在线上还是写在整组上，都不要紧）；藏起来不画的线不算；
//   今天分成几批、先后怎样另算一份（roadBatches），哪一天改了分批的办法，只有那一份该变。
// 记号照 32 位浮点数的字节算（显卡拿到的就是 32 位的数；两台机器上的算术差在双精度的最后一位时，取成 32 位以后还是同一个数）。
// 这几样东西从沙盘程序的哪里取、怎么造，不在这个文件里（在 ./witnessSubjects.ts）：这里只认 three 的网格和线，
// 沙盘程序的文件搬了地方、函数换了名字，这个文件不用动。
// 只给 tests/ 里的测试用，在 Node 里跑，不碰磁盘。

import { Vector3 } from 'three';
import type { BufferAttribute, InterleavedBufferAttribute, Matrix4, Mesh, Object3D } from 'three';
import type { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { contentKey } from '../../../src/domain/contentKey';

/** 一串数的凭证：一共多少个，和它们的记号。 */
export interface Frozen {
  n: number;
  key: string;
}

/** 一串数取成 32 位浮点数，照它们的字节算记号。 */
export function frozen(values: ArrayLike<number>): Frozen {
  const floats = Float32Array.from(values);
  return { n: floats.length, key: contentKey(new Uint8Array(floats.buffer, floats.byteOffset, floats.byteLength)) };
}

// ---------------------------------------------------------------- 网格（座子，小像）

/** 一组网格的凭证：几个网格，几个三角形，每个角上的位置和另外几样（法线、贴图坐标、颜色……）。 */
export interface MeshesWitness {
  meshes: number;
  triangles: number;
  arrays: Record<string, Frozen>;
}

/**
 * root 底下每一个网格（照它们在里面的先后），摊开成一个一个三角形的角：位置换到 root 外面的坐标里（网格自己的位置、大小算进去），
 * names 里写的别的几样照顶点上写的原样取（网格要是转过方向，法线不跟着转：现在的座子和小像都不转）。
 * 材质、贴图、投不投影子不在里面：那些由定格图的像素管。
 */
export function meshesWitness(root: Object3D, names: readonly string[]): MeshesWitness {
  root.updateMatrixWorld(true);
  const lists: Record<string, number[]> = { position: [] };
  for (const name of names) lists[name] = [];
  let meshes = 0;
  let triangles = 0;
  const at = new Vector3();
  root.traverse((node) => {
    const mesh = node as Mesh;
    if (!mesh.isMesh) return;
    meshes += 1;
    const geometry = mesh.geometry;
    const position = geometry.getAttribute('position');
    const index = geometry.getIndex();
    const corners = index ? index.count : position.count;
    triangles += corners / 3;
    for (let c = 0; c < corners; c++) {
      const i = index ? index.getX(c) : c;
      at.fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld);
      lists.position.push(at.x, at.y, at.z);
      for (const name of names) {
        const attribute = geometry.getAttribute(name) as BufferAttribute | InterleavedBufferAttribute | undefined;
        if (!attribute) throw new Error(`网格上没有 ${name} 这一样`);
        for (let k = 0; k < attribute.itemSize; k++) lists[name].push(attribute.getComponent(i, k));
      }
    }
  });
  const arrays: Record<string, Frozen> = {};
  for (const [name, list] of Object.entries(lists)) arrays[name] = frozen(list);
  return { meshes, triangles, arrays };
}

// ---------------------------------------------------------------- 全程沙盘的地面

/** 全程沙盘的地面的凭证：格子多大、从哪起，四份数（海拔，沙盘里的高度，是不是陆地，离留白多远）。 */
export interface RouteGroundWitness {
  nx: number;
  nz: number;
  cell: number;
  x0: number;
  z0: number;
  h: Frozen;
  y: Frozen;
  land: Frozen;
  blank: Frozen;
}

/** 全程沙盘的地面里我们比的那几样（src/stage/ground/route.ts 的 RouteGround 就是这个样子）。 */
export interface WitnessGround {
  nx: number;
  nz: number;
  cell: number;
  x0: number;
  z0: number;
  h: ArrayLike<number>;
  y: ArrayLike<number>;
  land: ArrayLike<number>;
  blank: ArrayLike<number>;
}

export function routeGroundWitness(ground: WitnessGround): RouteGroundWitness {
  return {
    nx: ground.nx,
    nz: ground.nz,
    cell: Math.fround(ground.cell),
    x0: Math.fround(ground.x0),
    z0: Math.fround(ground.z0),
    h: frozen(ground.h),
    y: frozen(ground.y),
    land: frozen(ground.land),
    blank: frozen(ground.blank),
  };
}

// ---------------------------------------------------------------- 路的笔画

/** 一小节的笔画的凭证：一笔一句（哪一种、实线还是虚线、几个点、哪几截路连成的），和所有的点（一笔接一笔，[x, z]）。 */
export interface StrokesWitness {
  strokes: string[];
  points: Frozen;
}

/** 一笔：哪一种（ink、now、past），是不是虚线，哪几截路连成的（倒着走的前面一个减号），线上的点（沙盘里的米，[x, z]）。 */
export interface WitnessStroke {
  state: string;
  dotted: boolean;
  ways: readonly string[];
  points: readonly (readonly [number, number])[];
}

/** runs 是一小节要画的每一笔，照沙盘程序排的先后（现在是 src/stage/roadLines.ts 的 roadRuns 排的）。 */
export function strokesWitness(runs: readonly WitnessStroke[]): StrokesWitness {
  return {
    strokes: runs.map((run) => `${run.state} ${run.dotted ? '虚' : '实'} ${run.points.length} 点：${run.ways.join(' ')}`),
    points: frozen(runs.flatMap((run) => run.points.flatMap((point) => [point[0], point[1]]))),
  };
}

// ---------------------------------------------------------------- 画路的程序交给显卡的线段

/** 画出来的一条线（three 的 Line2 一族）：我们只读这几样。 */
interface DrawnLine {
  isLineSegments2?: boolean;
  isLine2?: boolean;
  renderOrder: number;
  matrixWorld: Matrix4;
  material: LineMaterial;
  geometry: { instanceCount: number; getAttribute(name: string): InterleavedBufferAttribute | undefined };
}

/**
 * group 里真的会交给显卡的线，照它们在里面的先后（一层一层往下找）：藏起来的不算——线自己、它上面哪一层（连 group 自己）的 visible 关着，
 * 或者它的材质的 visible 关着，显卡都拿不到它。顺手把每条线在 group 外面的位置算好（matrixWorld）。
 */
function drawnLines(group: Object3D): DrawnLine[] {
  group.updateMatrixWorld(true);
  const lines: DrawnLine[] = [];
  group.traverseVisible((node) => {
    const line = node as unknown as DrawnLine;
    if (line.isLineSegments2 && line.material.visible) lines.push(line);
  });
  return lines;
}

/**
 * 这条线是哪一组：哪一层（renderOrder），什么颜色，多透，多宽（宽是照页面像素算的，还是照沙盘里的米算的），
 * 实线还是虚线（一划、一空各多少，头一划从哪起）。虚线的长短跟着镜头变的那个数（dashScale）不在里面。
 */
function lookOf(line: DrawnLine): string {
  const m = line.material;
  const px = (value: number): number => Number(value.toFixed(4));
  const width = `宽 ${px(m.linewidth)}${m.worldUnits ? ' 米' : ' 像素'}`;
  return `第 ${line.renderOrder} 层 #${m.color.getHexString()} 透 ${px(m.opacity)} ${width} ${m.dashed ? `虚 ${px(m.dashSize)}/${px(m.gapSize)} 起 ${px(m.dashOffset)}` : '实'}`;
}

/** 一条线里有几段。 */
function segmentsIn(line: DrawnLine): number {
  const start = line.geometry.getAttribute('instanceStart');
  if (!start) throw new Error('线上没有 instanceStart');
  return Number.isFinite(line.geometry.instanceCount) ? line.geometry.instanceCount : start.count;
}

/** 每一组里有多少段线，和这些线段的记号。 */
export type RoadSegmentsWitness = Record<string, { segments: number; key: string }>;

/**
 * group 里现在真的画着的每一段线（藏起来的不算，见 drawnLines）：两头在哪（x、y、z，抬到地面上以后的，换到 group 外面的坐标里——
 * 线自己的、它上面哪一层的、group 自己的位置、大小都算进去），虚线的还有两头各离这一笔的起头多远（实线记 0）。
 * 照 lookOf 分组；一组里的线段照这八个数排好了再算记号，所以同样的线段分成几批交、先交哪一批、哪一笔在前，算出来都一样；
 * 一段线挪了一点（不管是改了顶点上的数，还是挪了线、挪了整组）、藏起来了、虚线上的距离不是从这一笔的起头量起的、
 * 换了一层、换了颜色粗细、宽度改成照米算、虚线的头一划换了地方，就不一样。
 * 实线上量没量过距离不要紧（实线不看它）。
 */
export function roadSegmentsWitness(group: Object3D): RoadSegmentsWitness {
  const groups = new Map<string, Float32Array[]>();
  const a = new Vector3();
  const b = new Vector3();
  for (const line of drawnLines(group)) {
    const start = line.geometry.getAttribute('instanceStart');
    const end = line.geometry.getAttribute('instanceEnd');
    if (!start || !end) throw new Error('线上没有 instanceStart、instanceEnd');
    const dashed = line.material.dashed;
    const from = dashed ? line.geometry.getAttribute('instanceDistanceStart') : undefined;
    const to = dashed ? line.geometry.getAttribute('instanceDistanceEnd') : undefined;
    if (dashed && (!from || !to)) throw new Error('虚线没有量过线上的距离');
    const label = lookOf(line);
    const list = groups.get(label) ?? [];
    groups.set(label, list);
    for (let i = 0; i < segmentsIn(line); i++) {
      a.set(start.getX(i), start.getY(i), start.getZ(i)).applyMatrix4(line.matrixWorld);
      b.set(end.getX(i), end.getY(i), end.getZ(i)).applyMatrix4(line.matrixWorld);
      list.push(Float32Array.of(a.x, a.y, a.z, b.x, b.y, b.z, from ? from.getX(i) : 0, to ? to.getX(i) : 0));
    }
  }
  const out: RoadSegmentsWitness = {};
  for (const label of [...groups.keys()].sort()) {
    const list = groups.get(label) as Float32Array[];
    list.sort((a, b) => {
      for (let k = 0; k < 8; k++) if (a[k] !== b[k]) return a[k] < b[k] ? -1 : 1;
      return 0;
    });
    const flat = new Float32Array(list.length * 8);
    list.forEach((segment, i) => flat.set(segment, i * 8));
    out[label] = { segments: list.length, key: frozen(flat).key };
  }
  return out;
}

/** group 里现在真的画着的（藏起来的不算）分成哪几批、先后怎样：一批一句（哪一组，是一份线段表还是一笔一条的线，几段）。 */
export function roadBatches(group: Object3D): string[] {
  return drawnLines(group).map((line) => `${lookOf(line)}：${line.isLine2 ? '一笔一条' : '一份线段表'}，${segmentsIn(line)} 段`);
}
