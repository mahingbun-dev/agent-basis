# RC5-ENV-001 — pnpm install --frozen-lockfile

- 用例来源：`docs/design/51-上游rc.5合并测试用例与回归.md:90`（优先级 P0 / 方式 A）
- 执行时间：2026-11-19T22:04:33Z → 2026-11-19T22:04:33Z
- 命令与退出码：见 `cmd.log`
- 判定：**PASS**

## 预期

退出码 0；锁文件零变更。

## 实际

`pnpm install --frozen-lockfile` EXIT 0（pnpm v11.7.0；Scope: all 40 workspace projects；Already up to date；Done in 204ms）。锁文件 SHA-256 执行前/后均为 `0af006d8…ee6ac6`，`LOCK_UNCHANGED=yes`。

## 断言

- [x] 命令退出码 0
- [x] 锁文件字节级未变（SHA-256 相同）

## 备注

- `git status --porcelain pnpm-lock.yaml` 仍显示 `M`：该改动是本分支已提交内容相对 HEAD 的 6 行增量，不是本次 install 产生（哈希前后一致可证）。`git status --porcelain | wc -l` = 188，工作树并非严格「干净」；ENV-001 的命令与断言仍按 51 号口径执行并通过。

## 证据

- `cmd.log`
