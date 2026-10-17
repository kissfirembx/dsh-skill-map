# dsh-skill-map

[English](README.md) | 中文

技能地图：在右侧栏的一个页签里，用你自己的分类浏览全部已加载 skill，并可就地改名、新增、删除、拖动排序或改归属。

## 能力

- 通过右侧栏公开给其他插件的服务，往右侧栏贡献一个页签。
- 把已加载的 skill 摊成分类：折叠符号、分类名、数量，默认全部折叠；每个 skill 一行——名字后面跟一句这个 skill 做什么。悬停该行（或搜索过滤时），这句简介换成这个 skill 从哪个 GitHub 项目下载的（读安装台账），下面是更完整的描述。
- 文案漂移只在内部记录，不摊在界面上：装了新 skill 又还没有简介时，页脚会出现一个「补写 N 条缺失简介」的小按钮，点它就跑同一趟「更新」；描述变过、以及删掉 skill 后留下的死条目不再提示，也不必处理。
- 也可以让它自己写：点头部的「更新」，插件用这个 profile 自己的模型补上所有缺的文案、刷新描述变过的条目，写完自动重载列表并告诉你结果。机器写的文案永远不会盖掉你手写的那条。
- 搜索 skill 名字与描述，并可一次展开或折叠全部分类。
- 在面板自己的设置页（头部齿轮）里切换描述语言：skill 自己的原文，或 `$DSH_HOME/skill-map/descriptions.<lang>.json` 里的任一译文缓存；缓存里没有该 skill 时显示原文。
- 在面板里新建、重命名、删除分类，并拖动排序。
- 把 skill 拖到另一个分类，或拖回「未归类」。
- 点击 skill 行复制 `/skill-name`，可直接粘到输入框。
- 分类表存在你自己的文件里，因此不随插件版本变动。

## 安装

```sh
dsh plugin --profile web add @kissfire/dsh-skill-map
```

每次发布也会把构建好的包附在 [Releases](https://github.com/kissfirembx/dsh-skill-map/releases) 里，内容相同、不需要本地构建。这个 URL 是固定的：`latest` 始终指向最新一次发布，升版本时不必改它。

```sh
dsh plugin --profile web add https://github.com/kissfirembx/dsh-skill-map/releases/latest/download/kissfire-dsh-skill-map.tgz
```

重启 `dsh web`，或在插件管理器里把该插件行关掉再打开，然后打开技能地图。它两种情况都落在右侧栏：装了 `dsh-better-sidebar` 就是那个侧栏里的页签；没装则插件在官方右侧栏（`@deepseek-ai/dsh-client-ui-sidebar-right`）里注册自己的页签，首次加载时自动打开一次。只有两个右侧栏都不在跑时才退到中央面板，并在侧栏自带的面板列表里加一个图标——总之一定有入口。

## 配置

| 键 | 类型 | 含义 |
| --- | --- | --- |
| `enabled` | boolean | 宿主路由总开关。 |
| `customSkillDirs` | string[] | 官方根之外的额外 skill 扫描根。 |
| `dshHome` | string | DSH 主目录覆盖项，分类表文件放在它下面。 |
| `agentsHome` | string | Agents 主目录覆盖项（`~/.agents`）。 |

## 路由

| 路由 | 方法 | 含义 |
| --- | --- | --- |
| `/api/dsh-skill-map/list` | GET | 按你的分类表分组的清单；可选 `?cwd=`。 |
| `/api/dsh-skill-map/save` | POST | 写入整张分类表（分类与归属）。 |
| `/api/dsh-skill-map/health` | GET | 健康检查，带上 skill 与分类数量。 |
| `/api/dsh-skill-map/sync` | POST | 让这个 profile 的模型补上「没写过」和「描述变过」的 skill 文案，写入分类表旁边的 `summaries.auto.json`。 |

## 安全模型

- 全部路由走家族信任闸门：loopback 套接字加 loopback Host 头，或在装了 `dsh-remote-web-ui` 时用有效的已配对设备 cookie。未配对的局域网客户端在读任何文件之前就收到 `403 forbidden: loopback-only`。
- 本插件对 skill 目录只读。它只写 DSH 主目录下自己的文件：分类表，以及更新动作产出的自动文案文件。
- 写分类表时用一次新扫描校验归属，因此请求不可能描述本宿主不提供的 skill；未知名字会被丢弃并在响应里计数。
- 分类表用原子写入并容错解析，文件被截断或被手工改坏时退回内置分类，而不是把面板弄崩。

## 已知限制

- 技能地图在装与不装 `dsh-better-sidebar` 时都是右侧栏页签：装了用那个侧栏的页签服务，没装用官方右侧栏的页签注册表。只有两个右侧栏都不在跑时才退到中央面板，打开期间会盖住中间栏。
- 分类是平铺的：不支持嵌套，也没有逐 skill 备注。
- 已卸载 skill 的归属会在下次保存时被丢弃，而不是留着占位。
- 内置分类只在首次打开时播种一次，之后面板不再从包里改写它们。
- 「更新」需要 profile 里有 `llm` 服务。没有时它只报告该动作不可用，面板其余部分照常工作。

## 开发

```sh
pnpm install
pnpm typecheck
pnpm test
pnpm build
```

## 发布

```sh
pnpm typecheck && pnpm test && pnpm build
# 在 package.json 里升 version
pnpm publish:npm
```

`pnpm publish:npm` 先构建，再执行 `npm publish --ignore-scripts`。这个开关抑制 `prepare` 钩子，否则它会对着 `pnpm build` 已从源码产出的产物把 tsdown 再跑一遍。类型声明只由 `pnpm build` 里的 `tsc -b` 那一半生成（tsdown 配了 `dts: false`），所以那一步不能删。

然后把预构建 tarball 以安装行指向的固定名附到 Release：

```sh
npm pack
# 把产出的 kissfire-dsh-skill-map-<version>.tgz 改名为 kissfire-dsh-skill-map.tgz
gh release create v<version> kissfire-dsh-skill-map.tgz -R kissfirembx/dsh-skill-map --title v<version> --notes "更新说明"
```

更新经 npm 到达用户：市场拿已发布的版本号与本地安装版本比对，所以改代码不需要提任何 PR。只有改本插件的目录条目（描述、分类、仓库地址）才需要向 [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin) 提 PR。

截图来自本仓根目录的 `screenshots.json`，由市场每晚抓取：可以是纯路径数组、`{"screenshots": [...]}`，或「条目 URL → 路径」的映射——上限 8 张，只收相对路径，按本仓 HEAD 解析。因此增删截图只是往本仓推送，不涉及任何 PR。

## 数据遥测

浏览器半区每个 UTC 日向 dsh-market.com 发送一次匿名安装心跳：一个 localStorage 随机 id 与本包名，没有其他内容。实现见 [src/client/telemetry.ts](src/client/telemetry.ts)。

## 许可证

BSD-3-Clause。
