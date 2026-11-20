# T39-UNIT · `/compact` 单测与包级 verify

**结论：PASS**（新增 9 用例全绿；`@eterna/compaction` verify 241/241、oxlint 0、tsc 0）
**发现并修复 1 个 P1 缺陷：fork 改掉了 `/compact` 的首方命令身份（definitionId）。**

## 一、缺陷（修复前实测）

`packages/compaction/src/command-plugin.ts` 在 2026-11-12 fork 时把
`definitionId` 从上游 `@deepseek-ai/dsh-command-compact` 改成 `@eterna/compaction/command-plugin`。
上游所有「首方能力」识别都按 identity 匹配：

| 消费方 | 影响 |
|---|---|
| `dsh-commands/src/builtin.ts:4-12,27-29` `builtinCommandName` | 返回 `undefined` → 不再是首方 compact |
| `dsh-client-ui-commands/src/client/presentation.ts:61-66` `builtinRowFace` | `/` 菜单丢本地化 label/icon，退化为英文 description |
| `dsh-client-ui-commands/src/client/resolution.ts:13-16` `claimToken` | 菜单插入 `compact` 而非中文 `压缩` |
| `dsh-commands/src/builtin.ts:43-48` `resolveCommand` | 键入 `/压缩` 解析不到（别名只按 identity 找） |
| `dsh-sdk-jsonrpc-server/src/query-input.ts:19-27` | SDK/桌面文本输入不识别 `/compact`，会当普通提示词发给模型 |

修复前单测实证：`builtinCommandName(descriptor) === undefined`（`pre-fix.vitest.log`）。

## 二、修复

`packages/compaction/src/command-plugin.ts:101-108`：`definitionId` 恢复为
`CommandDefinitionId('@deepseek-ai/dsh-command-compact')`（身份 = 首方能力，不随包模块名走；
挂载行名仍是 `@eterna/compaction/command-plugin`）。堆内无其它代码依赖旧 identity（全仓 grep 仅挂载行名与文档）。

## 三、修复后验证

- `vitest run --root packages/compaction tests/command-plugin.spec.ts` → **9/9**（`vitest.log`）。
- `pnpm --filter @eterna/compaction run verify` → build:client + oxlint + tsc + **241/241** 全绿（`verify.log`）。
- 浏览器回归：`/` 菜单行显示 `压缩compact压缩以上对话内容`；`/compact` 与 `/压缩` 都执行出
  `No compactable history yet.`（`../RC5-CMD-001`、`../RC5-CMD-002`）。

## 说明

- 修复前同日运行的另一条 abort 用例失败是**测试写法**（注册表 `withAbort` 先 reject，不是插件缺陷）；
  已改为直接调 handler 验证插件自身的 cancelled 映射，并在用例名中注明注册表行为。
- 未验证：真实历史压缩（需模型回合）→ deferred to W5。

## 证据

`pre-fix.vitest.log`、`vitest.log`、`verify.log`、`packages/compaction/tests/command-plugin.spec.ts`