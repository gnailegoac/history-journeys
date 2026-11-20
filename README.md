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
| `npm test` | 单元测试；每座沙盘的验收（地面、镜头、题签、预算，先画好的地面和定格图旧不旧）；随站的字体够不够、对不对 |
| `npm run build` | 构建，结果在 `dist/` |
| `npm run check:size` | 查刚构建出来的 `dist/` 有多大（要先构建）：摆沙盘时才下载的沙盘程序、页面一打开就下载的程序和样式表、随站的字体、整个文件夹，超过上限就通不过，每次都印一张表；顺带查随站的字体在构建出来的网站里带得对不对（正好是那三个文件，`index.html` 预先声明的和样式表里写的是同一个），构建出来的样式表里没有老平板读不懂的几种写法 |
| `npm run check` | 上面五项依次跑一遍 |
| `npm run test:e2e` | 浏览器端到端测试（第一次先运行 `npx playwright install chromium`）。页面的各项用不画沙盘的替身来测；另有几项用真的沙盘，看它摆不摆得出来、换不换得动小节、一个画面要画的东西在不在预算里；还有一组在浏览器里把网站走一遍，看每一个字是不是随站的字体画的、有没有请求出了网站自己的地址、字体文件来得晚时按钮上有没有字（`tests/e2e/fonts.spec.ts`）；一组量正文那一栏：一行多少个字、可以点开的词下面有没有虚线、能点的东西够不够 44 像素见方，还有贴着底边的那一条（上一站、问讲解员、下一站）和点开的讲解员面板在四种标准的窗口上的样子（`tests/e2e/leaf.spec.ts`）；一项把每一站的大标题在各种窗口宽度上过一遍，折了行的标题最后一行不能只剩一个字（`tests/e2e/titles.spec.ts`）；一组看首页和“来源”页：四种标准的窗口上首页的那页纸、卡片和绢上的全程图片，“来源”页上两套字体、每一行出处、每一张图片对不对得上随站发的文件，四份许可全文打不打得开，那一页里面的程序是不是点进去才下载（`tests/e2e/home-sources.spec.ts`）；一组量沙盘栏：绢上的字是不是墨色、够不够深，字有没有小于 14 像素的，题记写满 40 个字在各种栏宽上放不放得下，按钮和题签的样子，题记那一条在四种标准的窗口上每一小节有没有截掉的字、“说明”按钮在不在右头，人物页的图片和它下面的字在不在栏里，还有照老平板（iPadOS 15）的读法改过样式表以后是不是还一样（`tests/e2e/pane-look.spec.ts`）；一组看竖着拿的大平板（1024 × 1366）：沙盘在上、文字在下，收起、横过来、再竖回去，只放图片时用的是窄的那一张（`tests/e2e/large-upright.spec.ts`） |

各种上限只写在两个地方：文件有多大（定格图、一座沙盘的文件、随站的字体、程序的下载量）在 `tests/content/budgetRules.ts`，一个画面的三角形数、画几批、贴图多大在 `tests/stage/support/budgets.ts`。

沙盘画得对不对要人看。先设环境变量 `REAL_SHOTS=1`，再运行 `npx playwright test tests/e2e/real-shots.spec.ts`，会用真的沙盘给人物页和有沙盘的那一站的每一小节各拍一张照，最后一节再拍一张点开“说明”的（电脑 1440×900、横着拿的平板 1024×768、竖着拿的平板 768×1024 和竖放的大平板 1024×1366 各一套），存在 `tests/shots/real/`（不进仓库）。想另存一套留着对比，再设 `SHOTS_DIR`（存到哪个文件夹）；想看减配的画质，再设 `TIER=reduced`（不设拍的是完整的画质）；想看只放定格图、不摆立体沙盘时的样子，设 `TIER=still`（这时只拍有沙盘的那一站的每一小节，不拍人物页和“说明”）。只拍一种窗口，命令后面加 `-g "1440"`（电脑）、`-g "横着"`、`-g "竖着"`（两种小平板）或 `-g "1366"`（竖放的大平板）。页面别的几种状态（首页、“来源”页、人物页的各站目录和它后面的链接、一站正文的末尾、点开的小注、原文、凭据、讲解员面板、还没写的一站、没有沙盘的一站、两种“没找到”）另有一条：`npx playwright test tests/e2e/state-shots.spec.ts`，用的是同样的几个环境变量，存在同一个文件夹。拍照之前都等随站的字体到齐。同样设了 `REAL_SHOTS=1`，运行 `npx playwright test tests/e2e/zoom-shots.spec.ts`，会在两个小节上把镜头从近拉到远拍一排，看模型跟着远近变的时候连不连得上，存在 `tests/shots/zoom/`。只看界面的照片同理：设 `UI_SHOTS=1`，运行 `npx playwright test tests/e2e/shots.spec.ts`，存在 `tests/shots/ui/`。

## 工具做出来的两样：先画好的地面，每一小节的定格图

每座沙盘另有两样东西，是工具照着场景文件和沙盘程序做出来的：做好以后放进仓库，随网站一起发，发布的流程不重新做。清单和图片都不手改。每座沙盘都要有这两样：新加了一座沙盘（`scenes/<站>.json`）而没有做，`npm run validate` 通不过（规则 17、18）。

| 命令 | 做什么 |
|---|---|
| `npm run bake` | 给每座沙盘的地面上色，存成两张图和一份清单，放在 `content/figures/<人物>/baked/`。有了它，沙盘打开时不用现画地面（开发机上徐州摆好快一秒上下）。一座沙盘十几秒；地面没有变时什么也不写 |
| `npm run route:terrain`、`npm run route:today` | 做全程沙盘的地形文件和“今天的海岸、湖、河”（`content/figures/su-shi/scenes/route.terrain.bin`、`route.today.geojson`）。只照 `spikes/art-direction/route/data/` 里的文件做，不连外面的服务；文件没有变时什么也不写。平常用不着跑 |
| `npm run route:map` | 画全程沙盘的检查图：从正上方看，场景文件里的每一条线、每一圈、每一条路，放在 `tests/shots/route-check/`（不进仓库）。改了 `scenes/route.json` 里的线以后跑一遍，看一眼 |
| `STILLS_OUT=content/figures npm run stills` | 把每座沙盘的每一小节拍成定格图，宽、窄各一张，连同一份清单，放进 `content/figures/<人物>/stills/`。一座沙盘半分钟上下；画面没有变的图片不重写 |
| `npm run stills` | 同上一条，只是试拍：存到 `tests/shots/stills-trial/`（不进仓库），不动 `content/` |

`STILLS_OUT=… npm run stills` 是 bash 的写法；PowerShell 里写 `$env:STILLS_OUT = 'content/figures'; npm run stills; Remove-Item Env:STILLS_OUT`。每次拍完，`tests/shots/stills/<人物>-<站>.html` 是给人看的一页（不进仓库，直接用浏览器打开）：每张图上用红点标着各条题签指的位置，画面变了的那几张有标记。

这两条命令都会打开一个浏览器。同一时刻只能开一个，所以不要和 `npm run test:e2e`、上面拍照的命令同时跑。先后不能反：先 `npm run bake`，再拍定格图（定格图是在先画好的地面上拍的，清单里记着用的是哪一份地面）。

现在的大小（徐州，2026-11-20）：地面的颜色 279,735 字节（JPEG，质量 0.95），田的标记 254,181 字节，连同地形文件一共 811,136 字节（上限 1,572,864）；定格图十四张，宽的 1800 × 1350，窄的 1920 × 1144，每张 112,123 到 248,036 字节（上限 307,200），合计 2,806,117 字节。

改了场景文件或者沙盘程序以后要不要重做、重做哪一条，见 [docs/data-spec.md](docs/data-spec.md) 的“制作时做好的两样”。忘了重做，`npm test` 通不过（存着的图比做它的东西旧了），并且说出是哪一样变了：

- 说“先画好的地面是旧的”：运行 `npm run bake`，再运行 `STILLS_OUT=content/figures npm run stills`（地面变了，在它上面拍的定格图也算旧的）。
- 说“定格图是旧的”：运行 `STILLS_OUT=content/figures npm run stills`（那句话里写的就是这一条）。不带 `STILLS_OUT` 只是试拍，不动仓库里的图，检查还是通不过。

重做以后，把 `baked/`、`stills/` 里变了的文件和改动一起提交。文件不齐、对不上清单时，通不过的是 `npm run validate`（规则 17、18），办法一样。

## 随站的字体

网站自己带着两套字体，打开网页时不向别的网站要：楷体是霞鹜文楷 GB，宋体是 Noto Serif SC（思源宋体的谷歌发行版），都按 SIL 开放字体许可 1.1 版使用。只带网站用到的字，做成三个文件放在 `src/fonts/`，随仓库走，发布的流程不重新做；这些文件都不手改。哪些字归哪个文件、记录里记了什么，见 [docs/data-spec.md](docs/data-spec.md) 的“随站的字体”。页面上的字全用这两套：宋体排正文，楷体排标题、题签和按钮；怎么用、什么时候下载，见同一节的“页面怎么用这两套字体”。

| 命令 | 做什么 |
|---|---|
| `npm run fonts` | 数出网站上显示的字，从原字体里裁出来，做成 `src/fonts/` 里的三个字体文件、样式表、记录和给页面用的一个小模块，并把四份许可全文照原样放进 `public/licences/`。字、原字体的说明和做法都没有变时不重做：说一声“已经是新的”，什么也不写；这时样式表、那个小模块或者哪一份字体的许可全文要是不在、被改过，它照记录把这一样重写（前两样用不到原字体）。做一遍几秒钟，不开浏览器 |
| `FONTS_OUT=.cache/fonts-trial npm run fonts` | 试做：做出来的放到那个文件夹（相对项目的根目录；`.cache/` 不进仓库），不动 `src/fonts/` 和 `public/licences/`，不管新不新都做。再加 `FONTS_COMPARE=1`，另外印出宋体不留提示信息时有多大 |

（`FONTS_OUT=…` 放在命令前面是 bash 的写法；PowerShell 里先写 `$env:FONTS_OUT = '.cache/fonts-trial'`，做完 `Remove-Item Env:FONTS_OUT`。）

要真的重做（不是“已经是新的”），先把原字体放到 `.cache/fonts/`（这个文件夹不进仓库）。工具会核对它们的 SHA-256，对不上就停：

| 放到 `.cache/fonts/` 里叫什么 | 是什么，从哪里取 | 字节数 | SHA-256 |
|---|---|---|---|
| `LXGWWenKaiGB-Regular.ttf` | 霞鹜文楷 GB 1.530 版：<https://github.com/lxgw/LxgwWenkaiGB/releases/download/v1.530/LXGWWenKaiGB-Regular.ttf> | 26,170,696 | `5561d48097d92e5ab99fe7b1459d381bbcdff533bfc479207b089c6860c3990e` |
| `NotoSerifSC-Regular.otf` | Noto Serif SC 2.003 版：<https://github.com/notofonts/noto-cjk> 的 `Serif2.003` 这一版，`Serif/SubsetOTF/SC/NotoSerifSC-Regular.otf` | 11,625,800 | `e8f396decc1f0963a016a989c3d8852e863d1350996f573860a80767c83a1cd3` |
| `lxgw-wenkai-gb-OFL.txt` | 霞鹜文楷 GB 的许可全文：它的仓库里 v1.530 这一版的 `OFL.txt` | 5,173 | `a8aa32c38a3402ba4e40fb6d39c913300dd4a0336290dce5c14e3a2f9308d092` |
| `noto-serif-cjk-OFL.txt` | Noto Serif CJK 的许可全文：它的仓库里的 `Serif/LICENSE` | 4,301 | `6a73f9541c2de74158c0e7cf6b0a58ef774f5a780bf191f2d7ec9cc53efe2bf2` |

工具自己不下载：要用的时候照这张表取来放好。裁剪用的是开发依赖 `subset-font`（`npm install` 就装上了，不随网站发）。

现在的大小（2026-11-20，两站正文、一座沙盘、“来源”页）：`yanlu-kai.woff2` 55,988 字节（252 个字），`yanlu-song.woff2` 238,988 字节（989 个字），`yanlu-song-more.woff2` 189,476 字节（655 个字）。首次打开要下载的是前两个，合计 294,976 字节（上限 460,800）；一个文件的上限是 307,200，过了 286,720 提醒。

忘了重做会怎样：正文、小注、场景文件或者界面上添了字体文件里没有的字，`npm test` 通不过，说出是哪个字、在哪里用的：

- “……不在随站的字体里：运行 npm run fonts，再提交。”：照做，把 `src/fonts/` 里变了的文件和改动一起提交。

查字体的测试里别的几处“运行 npm run fonts”也是照做就行（改了 `tests/support/fontTool.ts` 里原字体的说明或者做法；样式表、小模块、许可全文和记录对不上）。

同一组检查（`tests/fonts/font-files.test.ts`）还守着几条写法上的规矩：界面上的字要原样写在程序里（不用转义、HTML 实体、`String.fromCharCode`、`Intl`、`toLocale` 打头的函数）；样式表的 `content:` 里不写字，不加粗，不用斜体，不用 Safari 15 读不懂的写法。换字体以前的页面留下过几处，在那个文件的 `PENDING` 里一处一处点了名，改到哪里删到哪里；现在这张名单是空的，新冒出来的不往里加，改掉它。

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
src/fonts/           随站的字体：三个字体文件、样式表、记录（都是工具做的，不手改）
public/licences/     两套字体和两个程序库（React、three.js）的许可全文，随网站发
tests/unit/          单元测试
tests/fonts/         查随站的字体：网站上的字都在不在字体文件里，文件和记录对不对得上
tests/stage/         沙盘程序的单元测试，以及拿真的场景文件做的验收（地面、镜头、三角形数和别的预算）
tests/content/       内容校验器，以及它自己用的样本；文件大小的上限
tests/build/         查构建出来的 dist/ 有多大
tests/tools/         做先画好的地面、拍定格图、做随站的字体的工具
tests/e2e/           浏览器端到端测试
tests/support/       几组测试共用的小工具和样本
stage-dev.html       开发时单看一座沙盘的页面（不随网站发布）
spikes/              引擎验证和画风样张阶段的试验代码
.github/workflows/   推送 main 后自动检查，通过了才发布到 GitHub Pages
启动.cmd             双击启动
```
