# RC5 R02 · 上游行为项六件逐项补证（54 §9 R02）

- 环境：worktree `/Users/sunny/code/agent-basis-rc5`；依赖 = pnpm store 内 `@deepseek-ai/*@0.2.2-rc.5` 安装源（与镜像同版本）
- 口径：静态契约面（已安装声明源 + 本仓消费位 + 全工作区 typecheck）；LoggerLevel 另有 API-009 运行时真行为

## 逐项

- PASS · LoggerLevel 数值语义 → API-009 证据档存在且 PASS（artifacts/rc5/API/RC5-API-009/result.md）
- PASS · 投影帧：changes 数组 + seq 的参数序（rc.5 声明源）（node_modules/.pnpm/@deepseek-ai+dsh-session-projection@0.2.2-rc.5_@deepseek-ai+cordis@4.1.0_@deepseek-ai+d_263a3a99bb1eb3e174413e8558a96966/node_modules/@deepseek-ai/dsh-session-projection/src/index.ts:154）
- PASS · GenerateOptions 泛型 Purpose extends string（rc.5 声明源）（node_modules/.pnpm/@deepseek-ai+dsh-llm@0.2.2-rc.5_@deepseek-ai+cordis@4.1.0_@deepseek-ai+dsh-error@0.2.2-rc.5_@deepseek-ai+cordis@4.1.0_/node_modules/@deepseek-ai/dsh-llm/src/types.ts:564）
- PASS · 本仓消费位按 rc.5 GenerateOptions 编译（packages/compaction/evals/gateway.ts:15）
- PASS · ToolGuardDenial 类型 + ToolGuard 返回位（rc.5 声明源）（node_modules/.pnpm/@deepseek-ai+dsh-tools@0.2.2-rc.5_@deepseek-ai+cordis@4.1.0_@deepseek-ai+dsh-agent@0.2._0c9e84951de3b6c843c34fe86e0428ed/node_modules/@deepseek-ai/dsh-tools/src/contracts.ts:413）
- PASS · 本仓治理走 tools/pre-execute（deny 不可回翻由内核保证）（packages/glue/src/plugins/governance-plugin.ts:42）
- PASS · PluginTabProps.update 必填 + PluginTabUpdate（rc.5 声明源）（node_modules/.pnpm/@deepseek-ai+dsh-client-ui-plugin-manager@0.2.2-rc.5_@deepseek-ai+cordis@4.1.0/node_modules/@deepseek-ai/dsh-client-ui-plugin-manager/src/client/slot-contract.ts:118）
- PASS · 本仓镜面契约 + 插件页消费位（contract=40 consumer=13）
- PASS · pnpm -w run verify 全工作区 EXIT=0（post-merge 日志）（EXIT=0）

## 结论

**PASS**。六件：LoggerLevel（API-009 运行时）、投影帧参数序、`GenerateOptions` 泛型、`ToolGuardDenial`、plugin-manager `PluginTabProps.update`、全工作区编译门禁。

## 边界

- 投影帧监听器本仓不直接订阅（客户端/宿主消费）；本项钉的是 rc.5 声明源的参数序不被误接。
- `ToolGuardDenial` 本仓不直用（治理走 `tools/pre-execute`，内核单调 guard 保证 deny 不可回翻）；本项钉类型形状与消费路线。