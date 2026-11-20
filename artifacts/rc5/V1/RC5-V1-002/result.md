# RC5-V1-002 — 锁文件 @basis/@core 条目

- 用例来源：`docs/design/51-上游rc.5合并测试用例与回归.md:279`（优先级 P0 / 方式 A）
- 执行时间：2026-11-19T22:09:54Z → 2026-11-19T22:09:55Z
- 命令与退出码：见 `cmd.log`
- 判定：**PASS**

## 预期

grep `@basis/`、`@core/`，全部有锁条目。

## 实际

pnpm-lock importers 9/9 存在（core/cordis、core/contracts、core/runtime + 六个 @basis 包）；17 条 `@basis/*`/`@core/*` workspace 引用全部解析为 `workspace:*` + `link:` 条目，0 缺失。

## 断言

- [x] 9 个 importer 均在锁文件
- [x] 17 条 workspace 引用均有 link 条目

## 备注

- pnpm v9 锁文件对 workspace 包以 importer + `link:` 表示，顶层无 `@basis/*` 包键；按结构化解析核对。

## 证据

- `cmd.log`
- `check-lock.mjs`
