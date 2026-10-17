# dsh-skill-map

[English](README.md) | 中文

![dsh-skill-map](https://raw.githubusercontent.com/kissfirembx/dsh-skill-map/main/assets/banner.svg)

**它把你装的一堆 skill 分好类，找起来快得多。**

在 DSH 里装了很多 skill 以后，光看名字，常常想不起哪个才是要用的。这个插件（就是给 DSH 加功能的小程序）把它们摆到右边的一页里，让你自己分。按「写代码、写文档、处理表格」分可以，按「常用、不常用」分也可以。

分好的结果存在你自己的电脑上，插件换新版本也不会丢。

## 它长什么样

![技能地图面板：顶部是工作区标签，中间是按分类排好的 skill，最下面是未归类与总数](https://raw.githubusercontent.com/kissfirembx/dsh-skill-map/main/assets/skill-map-panel.png)

## 它能做什么

- 右边多一页，专门放 skill。
- 一个工作区就是一套分法。想换一套分法，点上面的小标签就切过去了。
- 想多存一套分法，点「+」新建一个；双击标签能改名，点「×」能删掉（会先问你一句）。
- 第一次打开，可以让 AI 先帮你分一遍。
- 也可以先自己建分类，再让 AI 把还没归类的 skill 一个个放进去。你放好的，它不会动。
- 分类能改名、能拖着换位置、能删掉；skill 用鼠标拖一下就换分类。
- 每个 skill 占一行：前面是名字，后面一句话说它是干什么的。鼠标停在这一行上，还能看到它来自哪个 GitHub 项目，以及更长的介绍。
- 搜索框能按名字找，也能按这些介绍找。
- 点一下某一行，`/skill-name` 就复制好了，可以直接粘到输入框里。
- 暂时没想好放哪的，先扔进「未归类」，它一直在列表最下面。
- 觉得介绍写得不够全，点「更新」让 AI 补上。AI 写的不会盖掉你手写的那条。

## 怎么装

先在电脑上装好 DSH，然后在命令行里粘贴这一行，回车：

```sh
dsh plugin --profile web add @kissfire/dsh-skill-map
```

装完重启 `dsh web`，右边的标签栏里就多一个「技能地图」。

上面的装不上，还可以直接下装好的包。这个地址是固定的，永远指向最新版：

```sh
dsh plugin --profile web add https://github.com/kissfirembx/dsh-skill-map/releases/latest/download/kissfire-dsh-skill-map.tgz
```

## 许可证

本项目基于 [MIT 许可证](LICENSE) 发布。

## 想看得更细

下面是给会用的人看的，点开折叠块。

<details>
<summary>它出现在哪里、文件存在哪、怎么换语言</summary>

- 装了 `dsh-better-sidebar`，它是那个侧栏里的一个页签；没装，就是官方右侧栏（`@deepseek-ai/dsh-client-ui-sidebar-right`）里的页签，第一次加载时自动打开一次。
- 两个右侧栏都不在跑的时候，它会退到中央面板，并在侧栏的面板列表里放一个图标，总之一定有入口。
- 分好的结果存在 `$DSH_HOME/skill-map/map.json`。文件缺失或者被改坏了，就退回「还没有工作区」的空白状态，不会替你塞一套你没点过头的分类。
- 设置里的齿轮可以切换介绍的语言：用 skill 自己写的原文，或者 `$DSH_HOME/skill-map/descriptions.<lang>.json` 里的译文。某个 skill 没有译文就显示原文。

</details>

<details>
<summary>配置</summary>

| 键 | 类型 | 含义 |
| --- | --- | --- |
| `enabled` | boolean | 宿主路由总开关。 |
| `customSkillDirs` | string[] | 官方根之外的额外 skill 扫描根。 |
| `dshHome` | string | DSH 主目录覆盖项，工作区文档放在它下面。 |
| `agentsHome` | string | Agents 主目录覆盖项（`~/.agents`）。 |
| `syncModel` | string | 补文案与自动分类用的模型路由（`provider/model`），默认用当前 agent 的模型。 |

</details>

<details>
<summary>接口</summary>

| 路由 | 方法 | 含义 |
| --- | --- | --- |
| `/api/dsh-skill-map/list` | GET | 全部 skill，以及每个工作区解析后的分类与未归类。 |
| `/api/dsh-skill-map/save` | POST | 写入整份工作区文档。 |
| `/api/dsh-skill-map/workspaces/auto` | POST | 让模型分类：空白工作区提一套，已有分类的只分配未归位的。 |
| `/api/dsh-skill-map/health` | GET | 健康检查，带 skill 与工作区数量。 |
| `/api/dsh-skill-map/sync` | POST | 让模型补写缺失和变更的文案。 |

</details>

<details>
<summary>安全与限制</summary>

- 最多 20 个工作区，每个最多 200 个分类；分类是平铺的，不支持嵌套。
- 所有路由只认 loopback（或已配对设备），skill 目录只读；插件只写 DSH 主目录下自己的文件。
- 工作区文档原子写入、容错解析，坏文件退回空白态。
- 「更新」和「自动分类」需要 profile 里有 `llm` 服务；没有时报告不可用，提一套新分类时退回内置分类表。
- 浏览器半区每天发一次匿名安装心跳（随机 id 加包名），实现见 [src/client/telemetry.ts](src/client/telemetry.ts)。

</details>

<details>
<summary>开发与发布</summary>

```sh
pnpm install && pnpm typecheck && pnpm test && pnpm build
```

发布：升 `package.json` 的 `version`，跑 `pnpm publish:npm`，再把 `npm pack` 的产物附到 GitHub Release。

</details>
