# 沿着他走过的路

选一位历史名人，以“我”的身份，沿着他一生走过的路一站一站读下去，在每个地方看见当时的时代、山川、风物和技艺。是学习网站，不是游戏。

整体设计见 [docs/overall-design.md](docs/overall-design.md)。

现在做到哪：第一位人物是苏轼。徐州一站有立体的沙盘，镜头、水位和题签跟着读到的小节换；人物页和别的站先放一张全程沙盘的定格图。打开徐州这一站，先显出这一小节先拍好的定格图，立体的沙盘摆好了再换上去。设备慢的时候，沙盘自己降到减配的画质（树和成片的民居各留一半，雾只画一层，不做抗锯齿，影子粗一些）；再慢，就一直放定格图，读者可以按“试试立体的沙盘”；浏览器画不了立体的画面时也一直放定格图（这时没有这个按钮）。只照平板和电脑做，不考虑手机。沙盘上每样东西是真的、按正文摆的还是示意，沙盘旁边有一句话说明（点“说明”展开完整的几句），每一站的“凭据”里逐样列着。

## 运行

双击 `启动.cmd`。窗口里会写出要打开的地址：这台电脑用 <http://localhost:5400/>，家里同一个网络里的平板、手机用窗口里列出的那个地址。用的时候不要关窗口。

也可以在命令行里运行（需要 Node.js，开发时用的是 24）：

```
npm install
npm start
```

## 检查和测试

| 命令 | 做什么 |
|---|---|
| `npm run typecheck` | 类型检查 |
| `npm run validate` | 内容校验：按数据规格检查 `content/` 里的每位人物、每一站，把不合规格的地方逐条列出来 |
| `npm test` | 单元测试 |
| `npm run build` | 构建，结果在 `dist/` |
| `npm run check:size` | 查刚构建出来的 `dist/` 有多大（要先构建）：摆沙盘时才下载的沙盘程序、页面一打开就下载的程序和样式表、整个文件夹，超过上限就通不过，每次都印一张表 |
| `npm run check` | 上面五项依次跑一遍 |
| `npm run test:e2e` | 浏览器端到端测试（第一次先运行 `npx playwright install chromium`）。页面的各项用不画沙盘的替身来测；另有几项用真的沙盘，看它摆不摆得出来、换不换得动小节、一个画面要画的东西在不在预算里 |

各种上限只写在两个地方：文件有多大（定格图、一座沙盘的文件、程序的下载量）在 `tests/content/budgetRules.ts`，一个画面的三角形数、画几批、贴图多大在 `tests/stage/support/budgets.ts`。

沙盘画得对不对要人看。先设环境变量 `REAL_SHOTS=1`，再运行 `npx playwright test tests/e2e/real-shots.spec.ts`，会用真的沙盘给人物页和有沙盘的那一站的每一小节各拍一张照，最后一节再拍一张点开“说明”的（电脑 1440×900、横着拿的平板 1024×768 和竖着拿的平板 768×1024 各一套），存在 `tests/shots/real/`（不进仓库）。想另存一套留着对比，再设 `SHOTS_DIR`（存到哪个文件夹）；想看减配的画质，再设 `TIER=reduced`（不设拍的是完整的画质）；想看只放定格图、不摆立体沙盘时的样子，设 `TIER=still`（这时只拍有沙盘的那一站的每一小节，不拍人物页和“说明”）。只拍一种窗口，命令后面加 `-g "1440"`（电脑）、`-g "横着"` 或 `-g "竖着"`（两种平板）。同样设了 `REAL_SHOTS=1`，运行 `npx playwright test tests/e2e/zoom-shots.spec.ts`，会在两个小节上把镜头从近拉到远拍一排，看模型跟着远近变的时候连不连得上，存在 `tests/shots/zoom/`。只看界面的照片同理：设 `UI_SHOTS=1`，运行 `npx playwright test tests/e2e/shots.spec.ts`，存在 `tests/shots/ui/`。

## 工具做出来的两样：先画好的地面，每一小节的定格图

每座沙盘另有两样东西，是工具照着场景文件和沙盘程序做出来的：做好以后放进仓库，随网站一起发，发布的流程不重新做。清单和图片都不手改。每座沙盘都要有这两样：新加了一座沙盘（`scenes/<站>.json`）而没有做，`npm run validate` 通不过（规则 17、18）。

| 命令 | 做什么 |
|---|---|
| `npm run bake` | 给每座沙盘的地面上色，存成两张图和一份清单，放在 `content/figures/<人物>/baked/`。有了它，沙盘打开时不用现画地面（开发机上徐州摆好快一秒上下）。一座沙盘十几秒；地面没有变时什么也不写 |
| `STILLS_OUT=content/figures npm run stills` | 把每座沙盘的每一小节拍成定格图，宽、窄各一张，连同一份清单，放进 `content/figures/<人物>/stills/`。一座沙盘半分钟上下；画面没有变的图片不重写 |
| `npm run stills` | 同上一条，只是试拍：存到 `tests/shots/stills-trial/`（不进仓库），不动 `content/` |

`STILLS_OUT=… npm run stills` 是 bash 的写法；PowerShell 里写 `$env:STILLS_OUT = 'content/figures'; npm run stills; Remove-Item Env:STILLS_OUT`。每次拍完，`tests/shots/stills/<人物>-<站>.html` 是给人看的一页（不进仓库，直接用浏览器打开）：每张图上用红点标着各条题签指的位置，画面变了的那几张有标记。

这两条命令都会打开一个浏览器。同一时刻只能开一个，所以不要和 `npm run test:e2e`、上面拍照的命令同时跑。先后不能反：先 `npm run bake`，再拍定格图（定格图是在先画好的地面上拍的，清单里记着用的是哪一份地面）。

现在的大小（徐州，2026-11-19）：地面的颜色 279,735 字节（JPEG，质量 0.95），田的标记 254,181 字节，连同地形文件一共 811,136 字节（上限 1,572,864）；定格图十四张，宽的 1800 × 1350，窄的 1920 × 1144，每张 117,313 到 280,737 字节（上限 307,200），合计 2,968,642 字节。

改了场景文件或者沙盘程序以后要不要重做、重做哪一条，见 [docs/data-spec.md](docs/data-spec.md) 的“制作时做好的两样”。忘了重做，`npm test` 通不过（存着的图比做它的东西旧了），并且说出是哪一样变了：

- 说“先画好的地面是旧的”：运行 `npm run bake`，再运行 `STILLS_OUT=content/figures npm run stills`（地面变了，在它上面拍的定格图也算旧的）。
- 说“定格图是旧的”：运行 `STILLS_OUT=content/figures npm run stills`（那句话里写的就是这一条）。不带 `STILLS_OUT` 只是试拍，不动仓库里的图，检查还是通不过。

重做以后，把 `baked/`、`stills/` 里变了的文件和改动一起提交。文件不齐、对不上清单时，通不过的是 `npm run validate`（规则 17、18），办法一样。

## 内容在哪，怎么加一站

内容都在 `content/figures/` 里，程序里不写内容。文件怎么放、正文怎么写、有哪些校验规则，见 [docs/data-spec.md](docs/data-spec.md)。

加一站：

1. 在 `content/figures/<人物>/figure.json` 的 `stops` 里写这一站的抬头，在 `legs` 里接上它和前后两站之间的路。正文还没写时，`status` 写 `outline`。
2. 写 `stops/<站>.md`（正文）和 `stops/<站>.json`（小注、原文、图片、凭据、示例问题），图片文件放进 `images/`。
3. 把 `status` 改成 `complete`，运行 `npm run validate`，按列出的问题改到通过。

## 目录

```
content/figures/     内容：首页卡片，每位人物的资料、轨迹和各站正文，站点沙盘的场景和地形文件，
                     以及工具照着沙盘做出来的先画好的地面（baked/）和定格图（stills/）
docs/                整体设计、技术方案、数据规格、部署方案、负责人决定记录，每座沙盘的考证记录
src/domain/          读取内容，以及正文解析、轨迹、从场景生成沙盘旁边的说明这些纯逻辑
src/stage/           沙盘适配层：页面只认 types.ts 里的约定；地面的计算在 ground/，题签在 overlay/，
                     只有 three/ 接触三维引擎（three.js）；still/ 是只放定格图的沙盘
src/guide/           答疑适配层（原型里是占位）
src/app/ src/ui/     界面：首页、人物页、站点页、讲解员面板
src/styles/          样式
tests/unit/          单元测试
tests/stage/         沙盘程序的单元测试，以及拿真的场景文件做的验收（地面、镜头、三角形数和别的预算）
tests/content/       内容校验器，以及它自己用的样本；文件大小的上限
tests/build/         查构建出来的 dist/ 有多大
tests/tools/         做先画好的地面、拍定格图的工具
tests/e2e/           浏览器端到端测试
tests/support/       几组测试共用的小工具和样本
stage-dev.html       开发时单看一座沙盘的页面（不随网站发布）
spikes/              引擎验证和画风样张阶段的试验代码
.github/workflows/   推送 main 后自动检查，通过了才发布到 GitHub Pages
启动.cmd             双击启动
```
