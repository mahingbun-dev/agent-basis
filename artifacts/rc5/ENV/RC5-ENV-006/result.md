# RC5-ENV-006 — Dockerfile 内核钉版

- 用例来源：`docs/design/51-上游rc.5合并测试用例与回归.md:95`（优先级 P0 / 方式 A）
- 执行时间：2026-11-19T22:04:26.457Z → 2026-11-19T22:04:26.457Z
- 命令与退出码：见 `cmd.log`
- 判定：**PASS**

## 预期

`grep @deepseek-ai/dsh@` 精确 rc.5，无 alpha.3。

## 实际

Dockerfile:151 有效行 `npm i -g … @deepseek-ai/dsh@0.2.2-rc.5`；有效行（去注释）无 `0.2.2-alpha.*`；未单独安装 `dsh-mcp-client`（使用宿主内嵌）。

## 断言

- [x] 内核精确 rc.5
- [x] 无 alpha.* 钉版
- [x] 未另装 mcp-client

## 证据

- `cmd.log`
- `../_suite/verify-rc5-env.json`
