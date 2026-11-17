# 沿着他走过的路

选一位历史名人，以“我”的身份，沿着他一生走过的路一站一站读下去，在每个地方看见当时的时代、山川、风物和技艺。是学习网站，不是游戏。

整体设计见 [docs/overall-design.md](docs/overall-design.md)。

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
| `npm run check` | 上面四项依次跑一遍 |
| `npm run test:e2e` | 浏览器端到端测试（第一次先运行 `npx playwright install chromium`） |

## 内容在哪，怎么加一站

内容都在 `content/figures/` 里，程序里不写内容。文件怎么放、正文怎么写、有哪些校验规则，见 [docs/data-spec.md](docs/data-spec.md)。

加一站：

1. 在 `content/figures/<人物>/figure.json` 的 `stops` 里写这一站的抬头，在 `legs` 里接上它和前后两站之间的路。正文还没写时，`status` 写 `outline`。
2. 写 `stops/<站>.md`（正文）和 `stops/<站>.json`（小注、原文、图片、凭据、示例问题），图片文件放进 `images/`。
3. 把 `status` 改成 `complete`，运行 `npm run validate`，按列出的问题改到通过。

## 目录

```
content/figures/     内容：首页卡片，每位人物的资料、轨迹和各站正文
docs/                整体设计、技术方案、数据规格、部署方案、负责人决定记录
src/domain/          读取内容，以及正文解析、轨迹这些纯逻辑
src/map/             地图适配层，只有这里接触地图引擎
src/guide/           答疑适配层（原型里是占位）
src/app/ src/ui/     界面：首页、人物页、站点页、讲解员面板
src/styles/          样式
tests/unit/          单元测试
tests/content/       内容校验器，以及它自己用的样本
tests/e2e/           浏览器端到端测试
spikes/              引擎验证阶段的试验代码
.github/workflows/   推送 main 后自动检查，通过了才发布到 GitHub Pages
启动.cmd             双击启动
```
