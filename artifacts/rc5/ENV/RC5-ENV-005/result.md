# RC5-ENV-005 — engines.node 与 node 版本

- 用例来源：`docs/design/51-上游rc.5合并测试用例与回归.md:94`（优先级 P0 / 方式 A）
- 执行时间：2026-11-19T22:04:43Z → 2026-11-19T22:04:43Z
- 命令与退出码：见 `cmd.log`
- 判定：**PASS**（静态半；运行时半 NOT RUN）

## 预期

根 `package.json` `engines.node >=24.9.0`；镜像 `node -v` 满足。

## 实际

静态半：`engines.node=>=24.9.0`；本机 `node v24.18.0`（≥24.9.0）。镜像内 `node -v` 未执行（无 E1 镜像）。

## 断言

- [x] engines.node=>=24.9.0
- [x] 本机 node 24.18.0 ≥ 24.9.0
- [ ] 镜像 node -v（运行时） — NOT RUN

## 备注

- 运行时半随 ENV-004 的 P5 镜像检查补齐。

## 证据

- `cmd.log`
