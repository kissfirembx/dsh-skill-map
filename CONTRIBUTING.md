# Contributing

Thanks for taking the time to help. This is a small plugin; keep changes focused and the codebase stays easy to follow.

## Report a bug

Open an issue and include the DSH version, this plugin's version, your OS, and the steps that reproduce the problem. A screenshot of the panel helps.

## Set up

Node 24+ and pnpm 10.

```sh
pnpm install
pnpm typecheck
pnpm test
pnpm build
```

CI runs the same four commands on every push and pull request, so a pull request has to pass them.

## Open a pull request

- One topic per pull request.
- Behaviour changes come with tests under `tests/`; keep them next to the module they cover.
- `README.md` and `README.zh.md` are a pair — change one, change the other.
- User-facing strings live in `src/client/locales.ts`; add the Chinese and English text together.
- Style: official theme tokens only (`--dsw-*`), no colour literals, no emoji in UI copy or comments.

## License

Anything you submit is published under the [MIT License](LICENSE).

---

# 贡献说明

## 报告问题

开 issue 时写清 DSH 版本、本插件版本、系统，以及复现步骤。能附面板截图更好。

## 本地开发

Node 24+ 与 pnpm 10。

```sh
pnpm install
pnpm typecheck
pnpm test
pnpm build
```

CI 每次推送和 PR 都跑这四条，PR 必须全绿。

## 提 PR

- 一个 PR 只做一件事。
- 改行为要带测试，测试放 `tests/`，跟着模块走。
- `README.md` 与 `README.zh.md` 是一对，改一份就要同步另一份。
- 界面文案在 `src/client/locales.ts`，中文和英文一起补。
- 样式只用官方主题 token（`--dsw-*`），不写颜色字面量；界面文案与注释不用 emoji。

## 许可证

提交的内容按 [MIT 许可证](LICENSE) 发布。
