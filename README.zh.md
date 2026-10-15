# dsh-skill-map

[English](README.md) | 中文

技能地图：在右侧栏的一个页签里，用你自己的分类浏览全部已加载 skill，并可就地改名、新增、删除、拖动排序或改归属。

## 能力

- 通过右侧栏公开给其他插件的服务，往右侧栏贡献一个页签。
- 把已加载的 skill 摊成分类：折叠符号、分类名、数量，默认全部折叠；每个 skill 一行，描述在悬停时展开，搜索过滤时也展开。
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

每次发布也会把构建好的包附在 [Releases](https://github.com/kissfirembx/dsh-skill-map/releases) 里，内容相同、不需要本地构建（后续版本把 URL 里的 tag 换掉即可）：

```sh
dsh plugin --profile web add https://github.com/kissfirembx/dsh-skill-map/releases/download/v0.1.0/kissfire-dsh-skill-map-0.1.0.tgz
```

重启 `dsh web`，或在插件管理器里把该插件行关掉再打开，然后在右侧栏打开技能地图页签。页签需要一个暴露插件服务的右侧栏；profile 里没有 `dsh-better-sidebar` 时插件照常安装，只是不贡献任何界面。

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

## 安全模型

- 全部路由走家族信任闸门：loopback 套接字加 loopback Host 头，或在装了 `dsh-remote-web-ui` 时用有效的已配对设备 cookie。未配对的局域网客户端在读任何文件之前就收到 `403 forbidden: loopback-only`。
- 本插件对 skill 目录只读。它唯一写入的文件是 DSH 主目录下自己的分类表文件。
- 写分类表时用一次新扫描校验归属，因此请求不可能描述本宿主不提供的 skill；未知名字会被丢弃并在响应里计数。
- 分类表用原子写入并容错解析，文件被截断或被手工改坏时退回内置分类，而不是把面板弄崩。

## 已知限制

- 页签需要一个向插件暴露服务的右侧栏；没有右侧栏的 profile 下本插件没有任何界面。
- 分类是平铺的：不支持嵌套，也没有逐 skill 备注。
- 已卸载 skill 的归属会在下次保存时被丢弃，而不是留着占位。
- 内置分类只在首次打开时播种一次，之后面板不再从包里改写它们。

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

更新经 npm 到达用户：市场拿已发布的版本号与本地安装版本比对，所以改代码不需要提任何 PR。只有改本插件的目录条目（描述、分类、仓库地址）才需要向 [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin) 提 PR；截图放本仓 `screenshots.json`，每晚自动抓取。

## 数据遥测

浏览器半区每个 UTC 日向 dsh-market.com 发送一次匿名安装心跳：一个 localStorage 随机 id 与本包名，没有其他内容。实现见 [src/client/telemetry.ts](src/client/telemetry.ts)。

## 许可证

BSD-3-Clause。
