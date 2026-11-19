// 地面的颜色从哪来（src/stage/three/groundPaint.ts），和照它做出来的贴图（src/stage/three/terrainMesh.ts）。
// 在 Node 里跑，不要浏览器：图片是假的（只有宽和高），显卡没有，所以“画出来什么样”仍然要到浏览器里看。
//
// 查三件：
//   1 用哪一种：先画好的两张图和场景、地形文件对得上，就用图；没有图、场景的记号不对、地形文件的记号不对、
//     大小不对、图取不到，都现画，并且（除了“本来就没有图”）在控制台里说一句是哪一样。哪种情形都不抛出错误。
//   2 现画的那一条路拆出来的颜色和田的标记，和 paintColour 画的是同一份字节。
//   3 两条路做出来的贴图是同一种读法：颜色一张，田的标记一张（只有一路），过滤一样；着色器读的是 uFields。

import { DataTexture, LinearFilter, LinearMipmapLinearFilter, NoColorSpace, RGBAFormat, RedFormat, SRGBColorSpace, ShaderLib } from 'three';
import type { Material, Texture } from 'three';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { StopScene } from '../../src/domain/scene';
import { frameCoords } from '../../src/domain/sceneGeo';
import { buildFields, groundNormals, paintColour, paintGround, readDem, samplers } from '../../src/stage/ground';
import { beginGroundPaint, colourBytes, fieldBytes, groundInputs, groundPictureSize } from '../../src/stage/three/groundPaint';
import type { GroundPaintSource } from '../../src/stage/three/groundPaint';
import { styleFor } from '../../src/stage/three/style';
import { buildTerrainMesh, groundTextures } from '../../src/stage/three/terrainMesh';
import type { StopTable } from '../../src/stage/types';
import { fixtureScene, fixtureTerrainBytes } from '../support/fixtureScene';
import { fakeDocument } from './support/fakeRenderer';

/** 测试用的小沙盘，添一条“田”的点缀（不然田的标记全是 0，拆出来的那一份就什么也没查到）。每次给一份新的。 */
function sampleScene(): StopScene {
  const made = fixtureScene();
  made.dressing.push({ id: 'fields', name: '田', kind: 'fields', class: 'dressing', basis: '平地上的田，示意。', sourceIds: [] });
  return made;
}

// 这座小沙盘：3000 × 2400 米，地面网格 151 × 121，颜色图 301 × 241。
const scene = sampleScene();
const terrain = fixtureTerrainBytes();
const ground = buildFields(scene, readDem(scene.terrain, terrain));
const style = styleFor(scene.style);
const painted = paintColour(ground, style.ground);
const { w: W, h: H } = groundPictureSize(ground);

/** 假的图片：只有宽和高。 */
const picture = (width: number, height: number, name = ''): TexImageSource => ({ width, height, name }) as unknown as TexImageSource;

/** 和这座小沙盘对得上的“先画好的地面”。 */
function matchingGround(): NonNullable<StopTable['ground']> {
  return { colourUrl: 'baked/colour.jpg', fieldsUrl: 'baked/fields.png', width: W, height: H, inputs: groundInputs(scene, terrain) };
}

function tableWith(groundPart?: StopTable['ground']): StopTable {
  return { kind: 'stop', key: 'demo/sample-town', scene, terrainUrl: 'terrain.bin', ...(groundPart ? { ground: groundPart } : {}) };
}

/** 假的取图：记下要过哪些网址；默认给两张大小对的图。 */
function loader(answer?: (url: string) => Promise<TexImageSource>): { load: (url: string) => Promise<TexImageSource>; asked: string[]; colour: TexImageSource; fields: TexImageSource } {
  const asked: string[] = [];
  const colour = picture(W, H, 'colour');
  const fields = picture(W, H, 'fields');
  const load = (url: string): Promise<TexImageSource> => {
    asked.push(url);
    return answer ? answer(url) : Promise.resolve(url.endsWith('.jpg') ? colour : fields);
  };
  return { load, asked, colour, fields };
}

const same = (a: Uint8Array, b: Uint8Array): boolean => a.length === b.length && a.every((v, i) => v === b[i]);

beforeAll(() => {
  // 地形板四边的纸板纹是在一块画布上画的
  vi.stubGlobal('document', fakeDocument());
});
afterAll(() => {
  vi.unstubAllGlobals();
});
afterEach(() => {
  // 把接住的控制台还回去
  vi.restoreAllMocks();
});
/** 把控制台的警告接住（这一个测试里），返回说过的话。 */
function catchWarnings(): () => string[] {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  return () => warn.mock.calls.map((call) => String(call[0]));
}

/** 现画的结果对不对：和 paintColour、groundNormals 是同一份字节。 */
function expectLive(source: GroundPaintSource): void {
  expect(source.kind).toBe('live');
  if (source.kind !== 'live') return;
  expect([source.w, source.h]).toEqual([painted.w, painted.h]);
  expect(same(source.colour, painted.colour), '现画的颜色和 paintColour 画的一样').toBe(true);
  expect(same(source.normals, groundNormals(ground)), '法线和 groundNormals 算的一样').toBe(true);
}

// ---------------------------------------------------------------- 1 用哪一种

describe('用先画好的图，还是现画（beginGroundPaint）', () => {
  it('颜色图的大小是地面网格的两倍密，和 paintColour 画出来的一样大', () => {
    expect([W, H]).toEqual([(ground.nx - 1) * 2 + 1, (ground.nz - 1) * 2 + 1]);
    expect([W, H]).toEqual([painted.w, painted.h]);
    expect([W, H]).toEqual([301, 241]);
  });

  it('对得上：用图。两张图一开始就去取（不等地形文件），法线照样现算，不说话', async () => {
    const said = catchWarnings();
    const { load, asked, colour, fields } = loader();
    const job = beginGroundPaint(tableWith(matchingGround()), new AbortController().signal, load);
    // finish 还没叫，两张图已经在取了
    expect(asked).toEqual(['baked/colour.jpg', 'baked/fields.png']);

    const source = await job.finish(scene, ground, terrain, style.ground);
    expect(source.kind).toBe('baked');
    if (source.kind !== 'baked') return;
    expect(source.colour, '颜色是 colourUrl 取来的那一张').toBe(colour);
    expect(source.fields, '田的标记是 fieldsUrl 取来的那一张').toBe(fields);
    expect([source.w, source.h]).toEqual([W, H]);
    expect(same(source.normals, groundNormals(ground))).toBe(true);
    expect(asked).toHaveLength(2);
    expect(said()).toEqual([]);
  });

  it('这座沙盘没有先画好的地面：现画，不去取图，也不说话', async () => {
    const said = catchWarnings();
    const { load, asked } = loader();
    const source = await beginGroundPaint(tableWith(), new AbortController().signal, load).finish(scene, ground, terrain, style.ground);
    expectLive(source);
    expect(asked).toEqual([]);
    expect(said()).toEqual([]);
  });

  it('场景里管地面的部分改过了（记号对不上）：现画，说是场景', async () => {
    const said = catchWarnings();
    const { load } = loader();
    const stale = { ...matchingGround(), inputs: { ...matchingGround().inputs, ground: '0123456789abcdef' } };
    expectLive(await beginGroundPaint(tableWith(stale), new AbortController().signal, load).finish(scene, ground, terrain, style.ground));
    expect(said()).toHaveLength(1);
    expect(said()[0]).toContain('场景里管地面的部分');
    expect(said()[0]).toContain('npm run bake');
  });

  it('真的挪了场景里的一条河：图是照原来的场景做的，现画', async () => {
    const said = catchWarnings();
    const moved = sampleScene();
    const [lng, lat] = moved.water.rivers[0].line[1];
    moved.water.rivers[0].line[1] = [lng + 0.003, lat];
    const movedGround = buildFields(moved, readDem(moved.terrain, terrain));
    const { load } = loader();
    const source = await beginGroundPaint({ ...tableWith(matchingGround()), scene: moved }, new AbortController().signal, load).finish(moved, movedGround, terrain, style.ground);
    expect(source.kind).toBe('live');
    if (source.kind !== 'live') return;
    // 画的是挪过以后的地面，不是原来的
    expect(same(source.colour, paintColour(movedGround, style.ground).colour)).toBe(true);
    expect(same(source.colour, painted.colour)).toBe(false);
    expect(said()[0]).toContain('场景里管地面的部分');
  });

  it('只改了镜头、题记、依据：图照用', async () => {
    const said = catchWarnings();
    const edited = sampleScene();
    edited.sections[0].camera.distanceM += 800;
    edited.sections[1].line = '换了一句题记。';
    edited.things[0].basis = '换了一句依据。';
    const { load } = loader();
    const source = await beginGroundPaint({ ...tableWith(matchingGround()), scene: edited }, new AbortController().signal, load).finish(edited, ground, terrain, style.ground);
    expect(source.kind).toBe('baked');
    expect(said()).toEqual([]);
  });

  it('地形文件换过了（记号对不上）：现画，说是地形文件', async () => {
    const said = catchWarnings();
    const { load } = loader();
    const stale = { ...matchingGround(), inputs: { ...matchingGround().inputs, terrain: '0123456789abcdef' } };
    expectLive(await beginGroundPaint(tableWith(stale), new AbortController().signal, load).finish(scene, ground, terrain, style.ground));
    expect(said()).toEqual(['[沙盘] 先画好的地面用不上，这一次现画（慢一两秒）：地形文件换过了，图是照原来的那一份画的。要重新做，运行 npm run bake']);
  });

  it('刚取到的地形文件和做图时的不是同一份（差一个数）：现画', async () => {
    const said = catchWarnings();
    const other = fixtureTerrainBytes();
    new DataView(other).setInt16(0, 431, true);
    const { load } = loader();
    const source = await beginGroundPaint(tableWith(matchingGround()), new AbortController().signal, load).finish(scene, ground, other, style.ground);
    expect(source.kind).toBe('live');
    expect(said()[0]).toContain('地形文件换过了');
  });

  it('清单里写的大小不是这块沙盘的大小：现画，说出两个大小', async () => {
    const said = catchWarnings();
    const { load } = loader();
    for (const wrong of [{ width: W + 1, height: H }, { width: W, height: H - 2 }]) {
      expectLive(await beginGroundPaint(tableWith({ ...matchingGround(), ...wrong }), new AbortController().signal, load).finish(scene, ground, terrain, style.ground));
    }
    expect(said()).toHaveLength(2);
    expect(said()[0]).toContain(`${W + 1} × ${H}`);
    expect(said()[0]).toContain(`${W} × ${H}`);
  });

  it('图取不到（一张、两张、取图的那一步当场出错）：现画，说取不到', async () => {
    const said = catchWarnings();
    const answers: ((url: string) => Promise<TexImageSource>)[] = [
      () => Promise.reject(new Error('图片取不到（404）')),
      (url) => (url.endsWith('.png') ? Promise.reject(new Error('图片取不到（田的标记）')) : Promise.resolve(picture(W, H))),
      () => {
        throw new Error('取图的那一步当场出错');
      },
    ];
    for (const answer of answers) {
      const { load } = loader(answer);
      expectLive(await beginGroundPaint(tableWith(matchingGround()), new AbortController().signal, load).finish(scene, ground, terrain, style.ground));
    }
    expect(said()).toHaveLength(3);
    expect(said()[0]).toContain('图片取不到（404）');
    expect(said()[1]).toContain('田的标记');
    expect(said()[2]).toContain('取图的那一步当场出错');
    for (const line of said()) {
      expect(line).toContain('现画');
      // 图取不到是网络的事，不叫人去重做
      expect(line).not.toContain('npm run bake');
    }
  });

  it('取到的图大小不对（颜色那张，或者田的标记那张）：现画，说是哪一张', async () => {
    const said = catchWarnings();
    const small = loader((url) => Promise.resolve(url.endsWith('.jpg') ? picture(W - 1, H) : picture(W, H)));
    expectLive(await beginGroundPaint(tableWith(matchingGround()), new AbortController().signal, small.load).finish(scene, ground, terrain, style.ground));
    const tall = loader((url) => Promise.resolve(url.endsWith('.jpg') ? picture(W, H) : picture(W, H * 2)));
    expectLive(await beginGroundPaint(tableWith(matchingGround()), new AbortController().signal, tall.load).finish(scene, ground, terrain, style.ground));
    expect(said()).toHaveLength(2);
    expect(said()[0]).toContain('颜色那张图');
    expect(said()[1]).toContain('田的标记那张图');
  });

  it('图片的大小认的是图片本来的大小（浏览器里的图片有 naturalWidth）', async () => {
    const said = catchWarnings();
    const asImg = (nw: number, nh: number): TexImageSource => ({ naturalWidth: nw, naturalHeight: nh, width: 0, height: 0 }) as unknown as TexImageSource;
    const good = loader(() => Promise.resolve(asImg(W, H)));
    expect((await beginGroundPaint(tableWith(matchingGround()), new AbortController().signal, good.load).finish(scene, ground, terrain, style.ground)).kind).toBe('baked');
    const bad = loader(() => Promise.resolve(asImg(W, H + 1)));
    expect((await beginGroundPaint(tableWith(matchingGround()), new AbortController().signal, bad.load).finish(scene, ground, terrain, style.ground)).kind).toBe('live');
    expect(said()).toHaveLength(1);
  });

  it('取来的不是图片（空的）：也不抛出错误，现画', async () => {
    const said = catchWarnings();
    const { load } = loader(() => Promise.resolve(null as unknown as TexImageSource));
    expectLive(await beginGroundPaint(tableWith(matchingGround()), new AbortController().signal, load).finish(scene, ground, terrain, style.ground));
    expect(said()).toHaveLength(1);
  });

  it('不在浏览器里、又没有给假的取图（Node 里没有 Image）：当成取不到，现画', async () => {
    const said = catchWarnings();
    expectLive(await beginGroundPaint(tableWith(matchingGround()), new AbortController().signal).finish(scene, ground, terrain, style.ground));
    expect(said()).toHaveLength(1);
  });

  it('图取不到，后来也没有人叫 finish（沙盘半路关了）：不留下没人管的错误', async () => {
    const said = catchWarnings();
    const { load } = loader(() => Promise.reject(new Error('图片取不到')));
    beginGroundPaint(tableWith(matchingGround()), new AbortController().signal, load);
    // 等一小会儿：要是那个错误没人接，测试框架会把它算成这一组测试出错
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(said()).toEqual([]);
  });

  it('这座沙盘已经不要了（signal 中止了）：不白画，也不说话；图已经到手的照给', async () => {
    const said = catchWarnings();
    const gone = new AbortController();
    const failing = loader(() => Promise.reject(new Error('这座沙盘不要了')));
    const job = beginGroundPaint(tableWith(matchingGround()), gone.signal, failing.load);
    gone.abort();
    const source = await job.finish(scene, ground, terrain, style.ground);
    expect(source.kind).toBe('live');
    if (source.kind !== 'live') return;
    // 没有上色：一张空的，大小是对的
    expect([source.w, source.h, source.colour.length]).toEqual([W, H, W * H * 4]);
    expect(source.colour.every((v) => v === 0)).toBe(true);
    expect(said()).toEqual([]);

    // 没有图的沙盘也一样
    const blank = await beginGroundPaint(tableWith(), gone.signal).finish(scene, ground, terrain, style.ground);
    expect(blank.kind === 'live' && blank.colour.every((v) => v === 0)).toBe(true);

    // 图已经取到了才中止的：照给图
    const late = new AbortController();
    const ready = beginGroundPaint(tableWith(matchingGround()), late.signal, loader().load);
    await Promise.resolve();
    late.abort();
    expect((await ready.finish(scene, ground, terrain, style.ground)).kind).toBe('baked');
    expect(said()).toEqual([]);
  });
});

// ---------------------------------------------------------------- 2 现画的那一条路拆出来的两份

describe('现画的拆成颜色和田的标记', () => {
  const n = painted.w * painted.h;
  const fields = fieldBytes(painted.colour);
  const colour = colourBytes(painted.colour);

  it('田的标记是每个点的第四个字节，一个点一个字节', () => {
    expect(fields.length).toBe(n);
    for (let k = 0; k < n; k++) if (fields[k] !== painted.colour[k * 4 + 3]) throw new Error(`第 ${k} 个点的田的标记不一样`);
    // 这座小沙盘上有田也有不是田的地方（不然上面这一条什么也没查到）
    expect(fields.some((v) => v === 0)).toBe(true);
    expect(fields.some((v) => v > 128)).toBe(true);
  });

  it('颜色是每个点的前三个字节，一个点三个字节', () => {
    expect(colour.length).toBe(n * 3);
    for (let k = 0; k < n; k++) {
      if (colour[k * 3] !== painted.colour[k * 4] || colour[k * 3 + 1] !== painted.colour[k * 4 + 1] || colour[k * 3 + 2] !== painted.colour[k * 4 + 2]) {
        throw new Error(`第 ${k} 个点的颜色不一样`);
      }
    }
  });

  it('拆的时候不改原来那一份', () => {
    const before = Uint8Array.from(painted.colour);
    fieldBytes(painted.colour);
    colourBytes(painted.colour);
    expect(same(painted.colour, before)).toBe(true);
  });

  it('现画的两张贴图：颜色还是 paintColour 的那份字节，田的标记是拆出来的那一份', async () => {
    const source = await beginGroundPaint(tableWith(), new AbortController().signal).finish(scene, ground, terrain, style.ground);
    const { map, fields: mask } = groundTextures(source, 8);
    expect(map).toBeInstanceOf(DataTexture);
    expect(mask).toBeInstanceOf(DataTexture);
    const mapImage = map.image as { data: Uint8Array; width: number; height: number };
    const maskImage = mask.image as { data: Uint8Array; width: number; height: number };
    expect([mapImage.width, mapImage.height, maskImage.width, maskImage.height]).toEqual([W, H, W, H]);
    expect(same(mapImage.data, painted.colour)).toBe(true);
    expect(same(colourBytes(mapImage.data), colour)).toBe(true);
    expect(same(maskImage.data, fields)).toBe(true);
    expect([map.format, mask.format]).toEqual([RGBAFormat, RedFormat]);
  });
});

// ---------------------------------------------------------------- 3 两条路做出来的贴图，着色器怎么读

describe('地面的贴图和着色器（terrainMesh.ts）', () => {
  const normals = groundNormals(ground);
  const live: GroundPaintSource = { kind: 'live', ...painted, normals };
  const baked: GroundPaintSource = { kind: 'baked', colour: picture(W, H, 'colour'), fields: picture(W, H, 'fields'), w: W, h: H, normals };
  const meshOf = (paint: Parameters<typeof buildTerrainMesh>[0]['paint']) =>
    buildTerrainMesh({ samplers: samplers(ground), paint, nx: ground.nx, nz: ground.nz, coords: frameCoords(scene.frame), style, maxAnisotropy: 16 });
  /** 贴图的那几样设置，两条路要一样。 */
  const settings = (t: Texture) => [t.magFilter, t.minFilter, t.generateMipmaps, t.anisotropy, t.flipY, t.wrapS, t.wrapT];

  it('先画好的：两张图片各是一张贴图，不上下颠倒；颜色按 sRGB 读，田的标记只有一路、原样读', () => {
    if (baked.kind !== 'baked') return;
    const { map, fields } = groundTextures(baked, 16);
    expect(map.image).toBe(baked.colour);
    expect(fields.image).toBe(baked.fields);
    expect([map.flipY, fields.flipY]).toEqual([false, false]);
    expect([map.colorSpace, fields.colorSpace]).toEqual([SRGBColorSpace, NoColorSpace]);
    expect([map.format, fields.format]).toEqual([RGBAFormat, RedFormat]);
    expect(map.version).toBeGreaterThan(0);
    expect(fields.version).toBeGreaterThan(0);
  });

  it('两条路的贴图设置一样：放大时匀开，缩小时用逐级缩小的图，各向异性最多 8，颜色按 sRGB 读', () => {
    const a = groundTextures(live, 16);
    const b = groundTextures(baked, 16);
    expect(settings(a.map)).toEqual([LinearFilter, LinearMipmapLinearFilter, true, 8, false, a.map.wrapS, a.map.wrapT]);
    for (const t of [a.fields, b.map, b.fields]) expect(settings(t)).toEqual(settings(a.map));
    expect([a.map.colorSpace, a.fields.colorSpace]).toEqual([SRGBColorSpace, NoColorSpace]);
    expect([a.map.format, a.fields.format]).toEqual([b.map.format, b.fields.format]);
    // 显卡只支持到 4 倍时用 4 倍
    expect(groundTextures(live, 4).map.anisotropy).toBe(4);
    expect(groundTextures(baked, 4).fields.anisotropy).toBe(4);
  });

  it.each([
    ['现画的（groundPaint.ts 给的）', live],
    ['先画好的', baked],
    ['现画的（paintGround 给的，没有 kind）', paintGround(ground, style.ground)],
  ])('地形板照样造得出来，材质带着田的标记那张贴图：%s', (_name, paint) => {
    const terrain = meshOf(paint);
    const material = terrain.top.material as Material & { map: Texture; normalMap: Texture; uniforms: { uFields: { value: Texture } } };
    const mask = material.uniforms.uFields.value;
    expect(mask.format).toBe(RedFormat);
    expect(material.map.colorSpace).toBe(SRGBColorSpace);
    const normalImage = material.normalMap.image as { data: Uint8Array; width: number; height: number };
    expect([normalImage.width, normalImage.height]).toEqual([ground.nx, ground.nz]);
    expect(same(normalImage.data, normals)).toBe(true);
    if ('kind' in paint && paint.kind === 'baked') {
      expect(material.map.image).toBe(paint.colour);
      expect(mask.image).toBe(paint.fields);
    } else {
      expect(same((material.map.image as { data: Uint8Array }).data, painted.colour)).toBe(true);
      expect(same((mask.image as { data: Uint8Array }).data, fieldBytes(painted.colour))).toBe(true);
    }

    // 着色器：只有一种读法。拿 three 自己的这种材质的着色器来改（改不上就说明 three 换了写法）
    const shader = { uniforms: {} as Record<string, { value: unknown }>, vertexShader: ShaderLib.lambert.vertexShader, fragmentShader: ShaderLib.lambert.fragmentShader };
    expect(shader.fragmentShader).toContain('#include <map_fragment>');
    (material.onBeforeCompile as unknown as (sh: typeof shader) => void)(shader);
    expect(shader.uniforms.uFields, '着色器拿到的就是材质上挂的那一张').toBe(material.uniforms.uFields);
    expect(shader.fragmentShader).toContain('uniform sampler2D uFields;');
    expect(shader.fragmentShader).toContain('texture2D(uFields, vMapUv).r');
    expect(shader.fragmentShader).not.toContain('#include <map_fragment>');
    expect(shader.fragmentShader, '不再从颜色那张图的第四个字节读田').not.toContain('texel.a');
    expect(shader.vertexShader).toContain('vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');

    // 放掉：三张贴图都放掉了
    const dropped: string[] = [];
    material.map.addEventListener('dispose', () => dropped.push('颜色'));
    mask.addEventListener('dispose', () => dropped.push('田的标记'));
    material.normalMap.addEventListener('dispose', () => dropped.push('法线'));
    terrain.dispose();
    expect(dropped.sort()).toEqual(['法线', '田的标记', '颜色'].sort());
  });
});

// ---------------------------------------------------------------- 4 在浏览器里取图的那一段（Image 是假的）

describe('不给假的取图时，用浏览器的 Image 取', () => {
  /** 假的 Image：记下网址怎么设的；什么时候取到、取不到，由测试来叫 onload、onerror。 */
  class FakeImage {
    static made: FakeImage[] = [];
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    crossOrigin = '';
    naturalWidth = W;
    naturalHeight = H;
    width = 0;
    height = 0;
    srcs: string[] = [];
    decodes = 0;
    decodeFails = false;
    constructor() {
      FakeImage.made.push(this);
    }
    set src(value: string) {
      this.srcs.push(value);
    }
    decode(): Promise<void> {
      this.decodes += 1;
      return this.decodeFails ? Promise.reject(new Error('解不开')) : Promise.resolve();
    }
  }
  const begin = (signal: AbortSignal) => {
    FakeImage.made = [];
    vi.stubGlobal('Image', FakeImage);
    const job = beginGroundPaint(tableWith(matchingGround()), signal);
    const [colour, fields] = FakeImage.made;
    return { job, colour, fields };
  };
  afterEach(() => {
    // document 是整个文件都要用的，取掉 Image 以后再放回去
    vi.unstubAllGlobals();
    vi.stubGlobal('document', fakeDocument());
  });

  it('两张都取到：先解码再交出去，用的就是这两张；取的时候不带身份', async () => {
    const said = catchWarnings();
    const { job, colour, fields } = begin(new AbortController().signal);
    expect(FakeImage.made).toHaveLength(2);
    expect([colour.srcs, fields.srcs]).toEqual([['baked/colour.jpg'], ['baked/fields.png']]);
    expect([colour.crossOrigin, fields.crossOrigin]).toEqual(['anonymous', 'anonymous']);
    colour.onload?.();
    fields.onload?.();
    const source = await job.finish(scene, ground, terrain, style.ground);
    expect(source.kind).toBe('baked');
    if (source.kind !== 'baked') return;
    expect(source.colour).toBe(colour);
    expect(source.fields).toBe(fields);
    expect([colour.decodes, fields.decodes]).toEqual([1, 1]);
    expect(said()).toEqual([]);
  });

  it('先解码那一步不成：照样用这张图（往显卡上传时浏览器自己会解）', async () => {
    const { job, colour, fields } = begin(new AbortController().signal);
    colour.decodeFails = true;
    colour.onload?.();
    fields.onload?.();
    expect((await job.finish(scene, ground, terrain, style.ground)).kind).toBe('baked');
  });

  it('有一张取不到：现画，说是哪个网址', async () => {
    const said = catchWarnings();
    const { job, colour, fields } = begin(new AbortController().signal);
    colour.onload?.();
    fields.onerror?.();
    expectLive(await job.finish(scene, ground, terrain, style.ground));
    expect(said()).toHaveLength(1);
    expect(said()[0]).toContain('图片取不到（baked/fields.png）');
  });

  it('取到的图不是这块沙盘的大小：现画', async () => {
    const said = catchWarnings();
    const { job, colour, fields } = begin(new AbortController().signal);
    fields.naturalHeight = H - 1;
    colour.onload?.();
    fields.onload?.();
    expectLive(await job.finish(scene, ground, terrain, style.ground));
    expect(said()[0]).toContain(`田的标记那张图是 ${W} × ${H - 1}`);
  });

  it('还没取到，沙盘就不要了：两张都停下（网址换成空的），不再理会后来的消息，不现画，不说话', async () => {
    const said = catchWarnings();
    const gone = new AbortController();
    const { job, colour, fields } = begin(gone.signal);
    gone.abort();
    expect([colour.srcs, fields.srcs]).toEqual([['baked/colour.jpg', ''], ['baked/fields.png', '']]);
    expect([colour.onload, colour.onerror, fields.onload, fields.onerror]).toEqual([null, null, null, null]);
    const source = await job.finish(scene, ground, terrain, style.ground);
    expect(source.kind === 'live' && source.colour.every((v) => v === 0)).toBe(true);
    expect(said()).toEqual([]);
  });

  it('一开始就已经不要了：一张也不取', async () => {
    const gone = new AbortController();
    gone.abort();
    const { job } = begin(gone.signal);
    expect(FakeImage.made.flatMap((image) => image.srcs)).toEqual([]);
    expect((await job.finish(scene, ground, terrain, style.ground)).kind).toBe('live');
  });
});
