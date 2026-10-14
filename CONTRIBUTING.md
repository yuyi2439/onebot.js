# 贡献指南

本文件说明 onebot.js 的开发、测试、CI 与发布流程。使用方法见 [README](./README.md)。

## 环境要求

Node.js >= 22，包管理器使用 pnpm。

## 开发

```sh
pnpm install
pnpm test            # 单元测试（Vitest），自带本地 WebSocket 服务端，不需要实现端
pnpm test:coverage   # 同上，并写出 coverage/（text / html / lcov / json-summary）
pnpm typecheck       # tsc --noEmit，src 和 test 都查
pnpm build           # tsc → dist/
pnpm verify:dist     # 检查构建产物完整可导入（需要先 build）
pnpm test:smoke      # 手动联调脚本，需要本机跑着 OneBot/NapCat（默认 127.0.0.1:4040）
```

单元测试的客户端用例都在本地回环端口上起一个临时 WebSocket 服务端，因此整套测试不依赖
外网、也不依赖真实的 OneBot 实现。覆盖率阈值写在 [`vitest.config.ts`](./vitest.config.ts) 里，
低于阈值 `pnpm test:coverage` 会直接失败。

## CI

CI（[test.yml](./.github/workflows/test.yml)）只在 **PR** 上跑类型检查和 `pnpm test:coverage`
（覆盖率阈值是硬门禁），再把覆盖率传给 [Codecov](https://codecov.io/gh/yuyi2439/onebot.js) ——
README 顶部的徽章就是它出的，需要仓库 secrets 里有 `CODECOV_TOKEN`。直接 commit 不触发；只改文档
（`*.md`、`docs/**`、`LICENSE`）的 PR 也跳过。

## 发布

发布走 [publish.yml](./.github/workflows/publish.yml)：打 `v*` tag 之后，先通过 `workflow_call`
调用上面同一个 test workflow（所以 release 跑的就是同一套检查，不会跳过测试），再校验 tag 与
`package.json` 的版本一致、跑 `pnpm build` + `pnpm verify:dist`，全绿才执行 `pnpm publish`。
任何一步失败都不会发布。

## License

[MIT](./LICENSE)
