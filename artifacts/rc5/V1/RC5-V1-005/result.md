# RC5-V1-005 — @core/runtime test + basis chat 六插件装载

- 用例来源：`docs/design/51-上游rc.5合并测试用例与回归.md:282`（优先级 P0 / 方式 A）
- 执行时间：2026-11-19T22:06:52Z → 2026-11-19T22:06:53Z
- 命令与退出码：见 `cmd.log`
- 判定：**PASS**

## 预期

`pnpm --filter @core/runtime test`；`node … chat --bundle basis.yml </dev/null`；6 插件全部解析装载；无 `bundle-core` 行；CLI 退出 0。

## 实际

runtime test EXIT 0（2 文件 / 13 tests）；`basis chat` EXIT 0（stdin EOF 即退出）。补充 boot 探针：manifest 6 插件（system-prompt/session/tools/llm/approval-cli/agent-loop）+ `ctx.systemPrompt/session/tools/llm/approval/agents` 六服务全部 present，`PROBE=PASS`；`grep bundle-core` 无命中（EXIT 1），`packages/bundle-core` 不存在。

## 断言

- [x] runtime test EXIT 0
- [x] basis chat EXIT 0
- [x] 6 插件解析装载（六 ctx 服务 present）
- [x] 无 bundle-core 行/目录

## 备注

- boot 探针走与 CI 相同的 `bootBundle` 路径；探针脚本在 `/tmp`，输出已入 cmd.log。

## 证据

- `cmd.log`
