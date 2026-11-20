# RC5-ENV-004 — 容器内 dsh --version（静态代理）

- 用例来源：`docs/design/51-上游rc.5合并测试用例与回归.md:93`（优先级 P0 / 方式 A）
- 执行时间：2026-11-19T22:04:26.457Z → 2026-11-19T22:04:26.457Z
- 命令与退出码：见 `cmd.log`
- 判定：**PASS**（静态半；运行时半 NOT RUN）

## 预期

E1 镜像内 `dsh --version` 输出 `0.2.2-rc.5`。

## 实际

静态半：workspace 实装 `@deepseek-ai/dsh` = `0.2.2-rc.5`；Dockerfile 钉版 = `0.2.2-rc.5`。运行时半（容器内 `dsh --version`）未执行：本 lane 不启容器、无镜像 tag。

## 断言

- [x] workspace 实装 rc.5（静态）
- [x] Dockerfile 钉版 rc.5（静态）
- [ ] 容器内 dsh --version（运行时） — NOT RUN

## 备注

- 脚本显式标记 `runtime=not-run`；不计入通过。待 P5/E1 镜像补齐。

## 证据

- `cmd.log`
- `../_suite/verify-rc5-env.json`
