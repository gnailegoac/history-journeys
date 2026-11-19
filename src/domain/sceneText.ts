// 从场景数据生成的文字和查询：某一小节沙盘上有哪些东西，题签写什么字，沙盘旁边的说明，凭据里“沙盘上的东西”一栏。
// 页面和沙盘程序都从这里取，不各写各的。全是纯函数，不改传进来的场景。
// 说明见 docs/data-spec.md“沙盘旁边的说明是怎么来的”。
//
// 场景文件合不合规格由 `npm run validate` 管。这里遇到对不上的地方：少一条题签、少一个出处就跳过去；
// 实在给不出结果的（没有这一小节、题签指不到一个点）才报错。

import { SCENE_CLASSES, SCENE_CLASS_LABEL } from './scene';
import type {
  Grounds,
  NamesMode,
  RegisterEntry,
  SceneDressing,
  SceneFarPlace,
  SceneFrame,
  SceneRegister,
  SceneRelief,
  SceneSection,
  SceneThing,
  SectionInfo,
  StopScene,
  TerrainRecipe,
  When,
} from './scene';
import { farEdgePoint } from './sceneGeo';
import type { Source } from './types';

// ---------------------------------------------------------------- 小节，和什么时候有

/** 场景里各小节的标题，按先后。 */
export function sectionHeadings(scene: StopScene): string[] {
  return scene.sections.map((section) => section.heading);
}

/**
 * 写了这个 when 的东西，在 heading 这一小节有没有。headings 是全部小节标题，按先后。不写 when 就是一直有。
 * when 里写的标题、或者 heading 自己，在 headings 里找不到时算没有：宁可少摆一样，不把东西摆到不该有的小节里。
 */
export function existsAt(when: When | undefined, heading: string, headings: string[]): boolean {
  if (when === undefined) return true;
  if ('only' in when) return when.only.includes(heading);
  const at = headings.indexOf(heading);
  if (at < 0) return false;
  if (when.from !== undefined) {
    const from = headings.indexOf(when.from);
    if (from < 0 || at < from) return false;
  }
  if (when.until !== undefined) {
    const until = headings.indexOf(when.until);
    if (until < 0 || at > until) return false;
  }
  return true;
}

/** 这一小节沙盘上有哪些摆件、哪些点缀。 */
export function thingsAt(scene: StopScene, heading: string): { things: SceneThing[]; dressing: SceneDressing[] } {
  const headings = sectionHeadings(scene);
  return {
    things: scene.things.filter((thing) => existsAt(thing.when, heading, headings)),
    dressing: scene.dressing.filter((rule) => existsAt(rule.when, heading, headings)),
  };
}

function sectionOf(scene: StopScene, heading: string): SceneSection {
  const section = scene.sections.find((s) => s.heading === heading);
  if (!section) throw new Error(`场景“${scene.stopId}”里没有“${heading}”这一小节`);
  return section;
}

// ---------------------------------------------------------------- 题签

// 一条题签指着哪一点（stripPoint）只有沙盘程序用，在 ./sceneStripPoint.ts。

/**
 * 这一小节要摆的题签，按要紧的先后：写什么字（当时的名字或今天的名字），是哪一种。
 * tone：place 是地方，water 是水名（指着河或急滩），far 是沙盘外面的远处。
 * 选了今天的名字而题签没有写 modern 的，还用当时的名字。
 */
export function stripTexts(scene: StopScene, heading: string, names: NamesMode): { id: string; text: string; tone: 'place' | 'water' | 'far' }[] {
  const section = sectionOf(scene, heading);
  const water = new Set([...scene.water.rivers, ...scene.water.rapids].map((item) => item.id));
  const far = new Set(scene.far.map((item) => item.id));
  const out: { id: string; text: string; tone: 'place' | 'water' | 'far' }[] = [];
  for (const id of section.strips) {
    const strip = scene.strips.find((s) => s.id === id);
    if (!strip || out.some((done) => done.id === id)) continue;
    const text = names === 'modern' && strip.modern ? strip.modern : strip.text;
    out.push({ id, text, tone: water.has(strip.of) ? 'water' : far.has(strip.of) ? 'far' : 'place' });
  }
  return out;
}

// ---------------------------------------------------------------- 远处，和山高

/** 八个方位词，从正北起顺时针，每个管 45 度。 */
const COMPASS = ['北', '东北', '东', '东南', '南', '西南', '西', '西北'] as const;

/**
 * 远处在哪个方向、多远，写成一句话，如“往西南约 24 公里（今安徽萧县白土镇）”。
 * 方向和距离从沙盘的原点算（src/domain/sceneGeo.ts 的 farEdgePoint）。方向用八个方位词；
 * 距离不到 100 公里取整公里，100 公里以上取最近的 5 公里。
 */
export function farSay(frame: SceneFrame, far: SceneFarPlace): string {
  const { bearingDeg, km } = farEdgePoint(frame, far.at);
  const direction = COMPASS[Math.round(bearingDeg / 45) % COMPASS.length];
  const rounded = km < 100 ? Math.round(km) : Math.round(km / 5) * 5;
  const gloss = far.gloss?.trim();
  return `往${direction}约 ${rounded} 公里${gloss ? `（${gloss}）` : ''}`;
}

/** 山高夸大了几倍，写成一句话：full 如“山的高度夸大了 6 倍”，short 如“山高夸大 6 倍”。 */
export function reliefSay(relief: SceneRelief): { full: string; short: string } {
  switch (relief.kind) {
    case 'uniform':
      if (relief.times === 1) return { full: '山的高度没有夸大', short: '山高没有夸大' };
      return { full: `山的高度夸大了 ${relief.times} 倍`, short: `山高夸大 ${relief.times} 倍` };
    default: {
      // 添了一种夸大的办法而这里没有跟上时，编译通不过。
      const unknown: never = relief.kind;
      throw new Error(`不认识的山高夸大办法：${JSON.stringify(unknown)}`);
    }
  }
}

// ---------------------------------------------------------------- 沙盘旁边的说明

/**
 * 说明里最多点几样示意的东西的名字：展开的那几句话里五样，常印着的那一句里三样。再多就写“等 N 样”，N 是一共几样。
 * 栏窄时的那一句不点名字，只说一共几样。
 */
const UNSURE_SHOWN = 5;
const UNSURE_SHOWN_SHORT = 3;

/**
 * 常印着的那一句（short）最多这么多个字：沙盘旁边只给它留了两行，栏最窄的时候两行放得下这么多。
 * 名字太长放不下时少点几样，一样也放不下就只说一共几样。
 */
export const NOTE_SHORT_MAX = 60;
/** 栏窄时的那一句（brief）最多这么多个字：只有一行。 */
export const NOTE_BRIEF_MAX = 32;

/** 地形整理过，一句话怎么说。full 只在 recipe 没有写 note 时顶上（校验不让它不写）。 */
const RECIPE_SAY: Record<TerrainRecipe['kind'], { full: string; short: string }> = {
  'plain-and-hills': { full: '平地是修整过的：高高低低的平地抹成了差不多一样高，山也跟着矮了一截。', short: '平地修整过' },
};

/** 模型和河都放大了。 */
const ENLARGED = { full: '摆在沙盘上的模型都放大了，镜头离得越远放得越大，不按比例；河画宽了。', short: '模型和河都放大了', brief: '模型和河放大了' };

/** 一小节在沙盘旁边要印的字：时间、题记、如实的说明、这一节的题签指到的远处。 */
export function sectionInfo(scene: StopScene, heading: string): SectionInfo {
  const section = sectionOf(scene, heading);
  const unsure = unsureAt(scene, section);
  const recipe = scene.terrain.recipe;
  const relief = reliefSay(scene.frame.relief);

  // 四样一定都说：哪些是示意，地形修整了哪里，（这一节特别要说的，）山高夸大了几倍、模型和河都放大了。
  // 展开的几句话：explain 里点到的每一样，它的 note 都印出来。
  const lines = [unsureSentence(unsure), recipe.note?.trim() || RECIPE_SAY[recipe.kind].full];
  for (const id of section.explain) {
    const note = noteOf(scene, id)?.trim();
    if (note && !lines.includes(note)) lines.push(note);
  }
  lines.push(`${relief.full}；${ENLARGED.full}`);

  // 常印着的一句：示意的点三样的名字；名字长得两行放不下，就少点几样。
  const rest = [RECIPE_SAY[recipe.kind].short, relief.short];
  let short = '';
  for (let shown = UNSURE_SHOWN_SHORT; shown >= 0; shown -= 1) {
    short = [unsureShort(unsure, shown), ...rest, ENLARGED.short].join('；');
    if (short.length <= NOTE_SHORT_MAX) break;
  }
  // 栏窄时的一句：只有一行，示意的只说一共几样。
  const brief = [unsureShort(unsure, 0), ...rest, ENLARGED.brief].join('；');

  const far: SectionInfo['far'] = [];
  for (const id of section.strips) {
    const place = scene.far.find((f) => f.id === scene.strips.find((s) => s.id === id)?.of);
    if (place && !far.some((done) => done.id === place.id)) far.push({ id: place.id, name: place.name, say: farSay(scene.frame, place) });
  }

  return { section: section.heading, date: section.date, line: section.line, note: { short, brief, lines }, far };
}

/** 带类别和依据的一样东西，连同它在说明和凭据里叫什么。 */
interface Grounded {
  id: string;
  name: string;
  grounds: Grounds;
}

/**
 * 场景里带类别和依据的全部东西，分三拨：地形（地形、整理、一处处修整），水（水位、河岸的规矩、河、急滩、
 * 水漫不进去的地方），摆在上面的（地名点、摆件、点缀、远处）。每一拨里按场景文件里写的先后。
 * 地形、整理、水位、河岸的规矩没有自己的名字和 id，用的是 explain 里指它们的那四个词。
 */
function grounded(scene: StopScene): { terrain: Grounded[]; water: Grounded[]; placed: Grounded[] } {
  const { terrain, water } = scene;
  return {
    terrain: [{ id: 'terrain', name: '地形', grounds: terrain }, { id: 'recipe', name: '地形的整理', grounds: terrain.recipe }, ...terrain.edits.map(named)],
    water: [
      { id: 'levels', name: '水位', grounds: water.levels },
      { id: 'banks', name: '河岸和河床', grounds: water.banks },
      ...water.rivers.map(named),
      ...water.rapids.map(named),
      ...water.dry.map(named),
    ],
    placed: [...scene.places.map(named), ...scene.things.map(named), ...scene.dressing.map(named), ...scene.far.map(named)],
  };
}

function named(item: Grounds & { id: string; name: string }): Grounded {
  return { id: item.id, name: item.name, grounds: item };
}

/** 说明里的一样示意的东西。whole：整样都是示意；不然是按正文摆的，只有 unsure 写的那部分是示意。 */
interface Unsure {
  whole: boolean;
  /** 宽屏的写法：名字，或“某某的某某”。 */
  text: string;
  /** 窄屏的写法：名字，或“某某的细节”。 */
  brief: string;
}

/**
 * 这一小节沙盘上有的东西里，哪些是示意：类别是示意的，和按正文摆、又写了 unsure 的。
 * explain 里点到的排在前面；其余的先是水，再是摆在上面的东西，最后是地形的修整（读的人先看到的在前）。
 * 摆件和点缀看 when；远处只算这一节的题签指到的。
 * 地形的整理不列在这里：它自己的那句话紧跟在后面，每一节都有。
 */
function unsureAt(scene: StopScene, section: SceneSection): Unsure[] {
  const headings = sectionHeadings(scene);
  const pointed = new Set(section.strips.map((id) => scene.strips.find((s) => s.id === id)?.of));
  const absent = new Set<Grounds>([
    scene.terrain.recipe,
    ...scene.things.filter((thing) => !existsAt(thing.when, section.heading, headings)),
    ...scene.dressing.filter((rule) => !existsAt(rule.when, section.heading, headings)),
    ...scene.far.filter((place) => !pointed.has(place.id)),
  ]);
  const all = grounded(scene);
  const present = [...all.water, ...all.placed, ...all.terrain].filter((item) => !absent.has(item.grounds));
  const explained = section.explain.flatMap((id) => present.filter((item) => item.id === id));
  const ordered = [...explained, ...present.filter((item) => !explained.includes(item))];

  const out: Unsure[] = [];
  for (const { name, grounds } of ordered) {
    const part = grounds.unsure?.trim();
    const item =
      grounds.class === 'schematic'
        ? { whole: true, text: name, brief: name }
        : grounds.class === 'text' && part
          ? { whole: false, text: `${name}的${part}`, brief: `${name}的细节` }
          : null;
    if (item && !out.some((done) => done.text === item.text)) out.push(item);
  }
  return out;
}

/**
 * 宽屏的那一句。整样示意的列名字，用顿号隔开；只有一部分示意的写成“某某的某某”，接在后面，各用分号隔开
 * （它们自己里面常有顿号和逗号）：
 *   “城墙、汴水是示意。”
 *   “黄楼的层数和高矮是示意。”
 *   “城墙、汴水，还有城壕的路线；南门的位置（在南墙的哪一点），都是示意。”
 *   “城墙、汴水，还有黄楼的层数和高矮，等 21 样是示意。”
 */
function unsureSentence(all: Unsure[]): string {
  if (all.length === 0) return '这一节摆出来的东西里，没有归在示意一类的。';
  const shown = all.slice(0, UNSURE_SHOWN);
  const names = shown.filter((item) => item.whole).map((item) => item.text);
  const parts = shown.filter((item) => !item.whole).map((item) => item.text);
  const more = all.length > shown.length ? `等 ${all.length} 样` : '';
  if (parts.length === 0) return `${names.join('、')}${more}是示意。`;
  const list = names.length > 0 ? `${names.join('、')}，还有${parts.join('；')}` : parts.join('；');
  if (more !== '') return `${list}，${more}是示意。`;
  return names.length > 0 || parts.length > 1 ? `${list}，都是示意。` : `${list}是示意。`;
}

/**
 * 一句话的说明里的头一截：点 count 样的名字，如“城墙、汴水、水位等 21 样是示意”；
 * count 是 0 时不点名字，只说一共几样，如“21 样是示意”。
 */
function unsureShort(all: Unsure[], count: number): string {
  if (all.length === 0) return '没有归为示意的东西';
  if (count <= 0) return `${all.length} 样是示意`;
  const shown = all.slice(0, count);
  const more = all.length > shown.length ? `等 ${all.length} 样` : '';
  return `${shown.map((item) => item.brief).join('、')}${more}是示意`;
}

/** 按场景文件里写的先后，带类别和依据的全部东西。 */
function groundedInFileOrder(scene: StopScene): Grounded[] {
  const all = grounded(scene);
  return [...all.terrain, ...all.water, ...all.placed];
}

/** explain 里点到的一样东西，旁边要说的那句话：它的 note；没有画的东西用它的 why。 */
function noteOf(scene: StopScene, id: string): string | undefined {
  const item = groundedInFileOrder(scene).find((g) => g.id === id);
  if (item) return item.grounds.note;
  return scene.notDrawn.find((omission) => omission.id === id)?.why;
}

// ---------------------------------------------------------------- 凭据里“沙盘上的东西”

/**
 * 凭据里“沙盘上的东西”一栏：按五类分组，后面是没有画的东西和用了谁的数据。sources 是这一站的出处。
 * 五类都给，顺序固定；哪一类没有东西，它的 entries 是空的。
 */
export function sceneRegister(scene: StopScene, sources: Source[]): SceneRegister {
  const cite = new Map(sources.map((source) => [source.id, source.cite]));
  const cites = (ids: string[]): string[] => ids.flatMap((id) => cite.get(id) ?? []);
  const all = groundedInFileOrder(scene);

  return {
    groups: SCENE_CLASSES.map((cls) => ({
      class: cls,
      label: SCENE_CLASS_LABEL[cls],
      entries: all
        .filter((item) => item.grounds.class === cls)
        .map(({ id, name, grounds }): RegisterEntry => {
          const unsure = grounds.unsure?.trim();
          return { id, name, class: cls, basis: grounds.basis, ...(unsure ? { unsure } : {}), cites: cites(grounds.sourceIds) };
        }),
    })),
    notDrawn: scene.notDrawn.map((omission) => ({ id: omission.id, name: omission.name, why: omission.why, cites: cites(omission.sourceIds) })),
    credits: [...scene.credits],
  };
}
