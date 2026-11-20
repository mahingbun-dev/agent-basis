# @core/contracts — seam 契约(全仓库唯一)

六个 core seam(tools / llm / agents / session / prompts / approval)的类型、注册器接口与 cordis `Context`/`Events` 增强;另含 interact/channels 消费的结构镜像(questions / presets / kv)。

## 纪律

1. **运行时靠 cordis provide,类型靠本包 augment**:`declare module '@core/cordis'` 把服务名(`ctx.tools` 等)与事件名(`tools/pre-execute` 等)一次定型;服务实例由 v1 插件包 `ctx.provide('<名>', …)` 提供,消费方 `inject: { tools: true }`。
2. **结构子集原则**:契约只声明消费方实际读取的字段(比上游更窄),生产方多余字段透明——上游语义对齐但不受上游版本牵引。
3. **本文件是唯一 seam 定义点**:任何包不得再本地声明 seam 类型(领域侧内部结构类型除外,如 governance 的 `ToolCallLike`);改 seam = 改这里 + 全仓 tsc 验证。

## 提供方 → 消费方速查

| seam | 提供方(v1) | 典型消费方 |
|---|---|---|
| `ctx.tools` | @basis/tools | 领域包工具、governance 门、packctl 检查 |
| `ctx.llm` | @basis/llm | agent-loop、cache-guard/observe 记账 |
| `ctx.agents` | @basis/agent-loop | runner(basis CLI) |
| `ctx.session` | @basis/session | governance 审计/预算、observe |
| `ctx.systemPrompt` | @basis/system-prompt | memory 索引 section、persona |
| `ctx.approval` | @basis/approval-cli | interact 卡片、pack ask 门 |
