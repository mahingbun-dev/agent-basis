# RC5-V1-007 — v1 源不依赖产品线 dsh

- 用例来源：`docs/design/51-上游rc.5合并测试用例与回归.md:284`（优先级 P1 / 方式 A）
- 执行时间：2026-11-19T22:10:21Z → 2026-11-19T22:10:21Z
- 命令与退出码：见 `cmd.log`
- 判定：**PASS**

## 预期

grep v1 源，无 `@deepseek-ai/dsh` import。

## 实际

按 CI 同款命令（`grep -RIn --include=*.ts --include=*.mjs '@deepseek-ai/dsh' core packages/{six}`）EXIT 1（无命中）。

## 断言

- [x] v1 源 0 处 @deepseek-ai/dsh 引用

## 证据

- `cmd.log`
