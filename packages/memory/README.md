# @basis/memory

L1 记忆插件(T2):M1 项目记忆 + M2 实体记忆 + 四个模型面工具 + systemPrompt 索引注入。
设计依据:设计文档 08 §5(旗舰设计 ①:dsh-memory)、12 §2(功能点承载)、14 号 T2。

## 模块

| 模块 | 内容 |
|---|---|
| `src/notes.ts` | **M1 项目记忆**:workspace NOTES 文件读写+检索接口(文件即记忆,Manus/Anthropic 模式)。路径安全(拒绝出根/绝对路径/非 .md),`write`/`append` 返回 undo(effect 配逆),写入强制 PII |
| `src/entity-store.ts` | **M2 实体记忆**:node:sqlite 六列表 `subject / key / content / valid_at / invalid_at / confidence`(T2 指定形态)。同键顶替(旧行打 invalid_at,历史全保留),`write` 返回 undo(删新行+复活被顶替行,精确恢复),`forget` 物理 DELETE 全部行 = **应用逆闭包真删** |
| `src/tokens.ts` | token 保守估算(CJK 1/字 + 其余 4 字符/token),注入预算的唯一度量衡 |
| `src/index-builder.ts` | 记忆索引构建:M2 live 行的 `key + 一句话摘要`,预算 ≤500 token,排序 confidence↓ → 新近↓,装不下从低优先级端截断并给 memory_search 提示 |
| `src/pii.ts` | `PiiGuard` 注入接口(结构子集)+ `BuiltinPiiGuard` 降级实现 |
| `src/memory.ts` | `Memory` 服务组合层(`MEMORY_SERVICE_ID` 注册表+唯一 ID 形态;coeffect 全声明:workspaceDir/dbPath/pii/now 构造注入);M1+M2 联合检索带出处 |
| `src/tools.ts` | 四工具 `defineTool` 定义 + `createMemoryIndexSection`(PromptSection)+ `MemoryHost` seam + `attachMemory` 总 disposer |

## 模型面工具

| 工具 | 语义 |
|---|---|
| `memory_write(subject, key, content, summary?, confidence?)` | 写 M2(PII 先行;同键顶替);成功返回记录与撤销提示 |
| `memory_read(subject, key)` | 读 live 正文(渐进披露的正文侧) |
| `memory_search(query, subject?, limit?)` | M2 实体过滤 + M1 notes 全文,多词 AND,带出处(`entity:subject/key#id`、`notes:file#Lline`) |
| `memory_forget(subject, key)` | **应用逆闭包真删**:物理 DELETE 该 (subject,key) 全部行(live+历史),返回删除快照 |

`read`/`search` 声明 `isConcurrencySafe`(`defineTool` 对 args 校验包装:非法 args 视为 exclusive);`write`/`forget` 独占(未声明)。

## systemPrompt 注入(渐进披露)

`createMemoryIndexSection(memory)` → dsh `PromptSection`:

- `name: 'memory:index'`,`order: 9000`(一方指导之后、persona suffix 10200 之前);
- `text` 是**同步 provider**,每次 prompt 装配时从 sqlite 重建(M2 同步取数,天然新鲜);
- 只含 `key + 一句话摘要`,预算 ≤500 token(header/lines/footer 一并计入),正文按需 `memory_read`;
- `interpolate: false`:记忆文本可能含 `{{…}}` 字面,dsh 变量插值是严格模式(未知引用 fail assembly),字面保真防误炸。

## PII 纪律(fail-closed)

一切写入路径(`writeEntity` / `writeNote` / `appendNote`,工具面与服务面同源)先过 PII:

- 首选注入 `@basis/governance` 的 `PiiFilter`(组合层取 `ctx.governance?.pii`),`PiiFilter` 结构满足 `PiiGuard`,直接注入无适配层;
- governance 服务未 provide 时降级 `BuiltinPiiGuard`(四类通用模式同源镜像;不支持领域包插拔行业模式)——**降级事实记入 blockers,不得静默**;
- 命中抛 `PiiBlockedError`(governance 版与内置版同名,按 `name` 判别);工具面转结构化 `{ ok: false, blocked: 'pii' }` 载荷,不中断 turn。

## Cordis 三纪律落实

1. **effect 配逆闭包**:`writeEntity().undo()`(顶替场景精确恢复 pre-write 状态)、`writeNote().undo()`(恢复原内容/删除新建文件并清空目录)、`forget` 真删(DELETE 全部行)、`attachMemory()` 返回宿主级总 disposer(卸载四工具+索引 section,幂等);
2. **coeffect 全声明**:目录/库路径/PII 守卫/时钟全部构造注入,不碰旁路全局;
3. **provide 可交换**:`MEMORY_SERVICE_ID = '@basis/memory'` 注册表+唯一 ID;`PiiGuard` 为 governance 服务的可交换结构接口。

## 组合层用法(真实 DSH 宿主)

```ts
import { Context } from '@deepseek-ai/cordis'
import { attachMemory, createMemory, dshHost } from '@basis/memory'
import { PiiFilter } from '@basis/governance'

declare const ctx: Context
const memory = createMemory({
  workspaceDir: '/path/to/workspace',
  dbPath: '/path/to/memory.db',
  pii: ctx.governance?.pii ?? undefined, // 未就绪则走内置降级(记 blockers)
})
const dispose = attachMemory(dshHost(ctx), memory) // effect 树接管配逆
```

## 与 DSH storage 的关系(blocker 备注)

T2 指定 M2 用 `node:sqlite`(Node ≥22 内建,免原生编译)六列表形态;dsh `storage-domain`(typed records)的对接属后续演进——`EntityMemoryStore` 的接口面(`write/read/search/forget/listLive`)已按 domain-record 语义(顶替+变更通知近似:superseded 快照)设计,替换存储层时工具面与索引面不动。

## 验收门

`pnpm --filter @basis/memory run verify` = oxlint + `tsc --noEmit`(含 `tests/types.seam-pin.ts` 编译期钉住:ToolDefinition→`ToolRuntime['register']`、PromptSection→`SystemPrompt['section']`、`dshHost(liveCtx)` 依赖两个 Context augmentation、governance `PiiFilter`→`PiiGuard`)+ vitest(80 测试)。

关键用例:跨会话召回(M1+M2,dispose 后新实例)、遗忘后检索不到(read/search/索引全链路)、索引预算 ≤500 token(120 条压力)、PII 注入与降级双路径、undo 精确配逆。

## Blockers / 后置项

- **需运行时联调**:seam 已用已发布 `@deepseek-ai/dsh-*` 0.2.2-alpha.2 类型编译期钉住,但未在真实 DSH 宿主(agent loop + prompt assembly)里跑过 `ctx.tools.register` / `ctx.systemPrompt.section` 的运行时行为;
- PII 降级路径(governance 服务未就绪时用 BuiltinPiiGuard)在真实组合层需接审计信号,本包仅以 `piiGuard` 字段暴露实际生效守卫;
- 整固(consolidation,设计文档 08 §5.4:小模型从 session log 抽记忆提案+审批)不在 T2 范围,属 memory v1(T10 后)。
