# RC5-V1-001 — v1 源与清单全部已跟踪

- 用例来源：`docs/design/51-上游rc.5合并测试用例与回归.md:278`（优先级 P0 / 方式 A）
- 执行时间：2026-11-19T22:10:04Z → 2026-11-19T22:10:04Z
- 命令与退出码：见 `cmd.log`
- 判定：**PASS**

## 预期

`git ls-files core packages/{system-prompt,session,tools,llm,approval-cli,agent-loop} basis.yml` 全部已跟踪；无遗漏。

## 实际

9 个范围路径均有跟踪文件：core/cordis 16、core/contracts 18、core/runtime 14、basis.yml 1、六个 @basis 包各 7-8；`git ls-files --others` 在范围内 0 个未跟踪文件。

## 断言

- [x] 9 个范围路径均有跟踪文件
- [x] 范围内无未跟踪文件

## 证据

- `cmd.log`
- `check-tracked.sh`
