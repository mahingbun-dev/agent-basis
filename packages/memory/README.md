# @eterna/memory

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
| `src/portrait.ts` | **用户画像 v0 派生视图**(M-M1 T4):`buildPortrait` 纯函数聚合 user 层 approved semantic 记录 → 四分节 Markdown(frontmatter 记 `version/generated_at/source_memory_ids`,可追溯到条);不读库不落盘,生成入口 `scripts/gen-portrait.mjs`(node 直跑,写到与 sqlite 同目录 `portrait.md`,glue 装配时现读注入画像区) |
| `src/consolidation.ts` | **整固 job 骨架**(M-M2 T6):会话尾触发 + 三门控(direct-write 防双写 / no-user-prose≥3 词 / 凭据红线 skip)+ 单 running+latest-pending 覆盖合并调度 + `consolidation_cursor` 会话粒度游标(success/no-op/skip 推进,error/abort 不推进)+ 快照冻结 + session close 先 abort 后 60s 有界 drain;提取执行体(T7)经 `ConsolidationTask` seam 注入;事件订阅在 glue 层(`turn/end(completed)` 代理会话尾——dsh 无 session/end 事件,19a 号 S1 结论) |
| `src/extraction.ts` | **提取执行**(M-M2 T7+T8):curator 直调(`ctx.llm.prepareCall` 一次性 one-shot + 冻结提示词,与 `tests/fixtures/extraction-prompt.md` 逐字一致,单测钉住)+ 会话快照(`session.v4.jsonl.zstd` 多帧 zstd 解码——算法同源复制自 panel,只认真人类 user 消息与 assistant 文本块,截断保最近)+ 现有记忆 manifest(提案前查重面)+ 提案防御解析(Nothing 门 / JSON 抢救 / 逐条校验,结构坏 fail-closed 条目坏丢弃计数)+ 落库统一走 `writeEntity`(`source=consolidation/compaction`,provenance 盖章,review_state 按既有规则;T8 起 add 提案入库前过 **Gm1 一致性闸**——对同 scope+kind live 行最大重叠落在 [0.3, 0.9) 的做一次 LLM 矛盾判定(判定提示词与 `tests/fixtures/contradiction-judge-prompt.md` 逐字一致):矛盾→独立入库+`supersede` 旧行 / 互补→合并 UPDATE 进既有 key / 无关→照 ADD;判定调用失败该提案**拦截不落库**(fail-closed,18 号 PII 精神))+ `createExtractionTask` 组装 `ConsolidationTask`(glue 注入 T6 调度器;读盘前先 `ctx.sessions.flush` 等 durability checkpoint) |
| `src/audit.ts` | **记忆审计账本**(M-M2 T9):每次整固的**提案 / 门控 / 审批**结果各写一行 JSONL(`.eterna/memory-audit.jsonl`,与 memory.sqlite3 同目录,tenant-scan 随 dbPath 覆盖;evolve ledger 挂载后切换、键位对齐);写入 fail-open(warn 不抛——账本缺行不反噬整固任务或审批动作);路径/时钟/日志构造注入,`readAll` 回读供测试与巡检 |
| `src/approval.ts` | **审批卡片与评审审计**(M-M2 T9 + 勘察 S2 结论):pending 产生时组 @eterna/interact `ApprovalCardInput`(标题「从本次会话学到…」/ Why=出处会话摘要经 PiiGuard 回退 / Action=记住/跳过)经 `buildApprovalCard` fail-closed 校验并渲染 detail——**类型复用,不投官方通道**(S2 实测:官方卡片消费面 dsh-client-ui-approval / dsh-client-ui-user-questions 未打进 dsh-web-frontend 0.2.2-rc.1 发行包,送达 = 面板审批队列);官方 user-questions 载荷经 `memoryApprovalAskRequest` 预留零转换切换面(本包 `tests/types.seam-pin.ts` 钉住 ⑥);`withReviewAudit` 包装 Memory.review 记审批行(glue 以 `@eterna/memory` provide 包装后实例) |
| `src/metrics.ts` | **T13 验收指标聚合**(M-M3 收尾,19 号 §5-T13/§9-6):`buildMemoryMetrics` 纯函数——审计事件流四项在线指标(审批采纳率 = review 行配比;审批响应时长 = proposal/dream 待审行引入→review 落定的 id 配对时间差,标准中位/最大;画像纠正率 = correction 行 / 画像来源记忆条数;域解析分布 = domain-resolve 行按 source/bound 计数);第五项「索引预算占用分布」由 `computeIndexZoneTokens` 按当前库**只读**现算(DatabaseSync readOnly,绝不触发迁移写;域键取最近使用已转正域,画像读库同目录 portrait.md)——每轮装配都发生不落账本;第五项「域打标准确率」需人工标注,离线脚本 `scripts/memory-domain-accuracy.mjs`(标注 × 账本 domain-resolve 行比对)。审计新增两类事件见 `src/audit.ts`(domain-resolve/correction);facade `metrics()` 组装(panel 快照经 `readMetrics` 消费) |
| `src/domain.ts` | **域注册表与会话域解析**(M-M1 T1 + M-M3 T10):`domain_registry` 表(workspace 显式域登记即注册 / 自由域候选 ≥minSessionsForNewDomain(默认 3,18 §13 Q2)独立会话转正,touchUsed 使用计数)+ `domain_hit_sessions` 每会话每域至多一次的**持久**命中去重(进程重启不重复计数,recordSessionHit);T10 编排 `resolveDomain`——workspace 显式域跳过打标直注(ASCII kebab 键,纯非 ASCII 名回落 `ws-<FNV-1a>` 稳定键)/ 否则对首条用户消息打标:冻结提示词(与 `tests/fixtures/domain-tagging-prompt.md` 逐字一致,单测钉住)先归并已注册域,无匹配计数候选(**候选期不绑定**——无索引域区、episodic 不落该域,防域爆炸),转正当次起绑定;打标 LLM 经 `DomainTagger` seam 注入(工厂 `createDomainTagger` 在 extraction.ts,复用 T7 curator 路由),解析 `parseDomainTagOutput` 防御式三态(结构坏抛 `DomainTagParseError` 交 glue 下一条消息重试) |
| `src/dream.ts` | **重量 Dream 四阶段**(M-M3 T11,19 号 §5-T11 + 19a 号 S4 结论 B):Orient 盘点(user 层/各域 live 与索引 token)→ Gather 窗口期 episodic 窄读(自 lastDreamAt 起,`dream.maxTurns` 缺省 50,未挂载 evolve 信号则只读 episodic)→ Consolidate(域内晋升复用 @eterna/evolve `clusterSignals` 聚类 ≥2 + curator 冻结提示词起草(与 `tests/fixtures/dream-consolidation-prompt.md` 逐字一致);稳定偏好 → user 层提案按 **Q3 全审**(`userPromotionSampleRate` 缺省 1.0,降档走 key 稳定哈希确定性抽样);NOTES/AGENTS.md 对账 → CONFLICT-FLAG(复用 summary 前缀,不改指令文件,与 `tests/fixtures/dream-conflict-prompt.md` 逐字一致);相对日期转绝对(确定性兜底 + 提示词纪律);被证伪事实回收 = `supersede` 软失效(18 §6「物理删除仅用户显式 forget」))→ Prune(episodic TTL 30 天淘汰(Q5)+ perDomainLimit 挤出(检索分升序,半衰期降权即排序)+ 画像再生成(条件:user 层 approved 记忆数变化 ≥1 或距上次 ≥24h;`buildPortrait` 复用,version 单调 bump));触发 = **会话尾 + lastDreamAt 时间阈值合并**(S4-B 退路:schedule seam 不可用,`dream.cron` 键降级解释为间隔小时数;lastDreamAt = 游标 'dream' 行,调度器完成时原子推进,error/abort 不推进待补跑);周报 = audit `dream` 行(panel 展示在 T12 消费) |

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

- 首选注入 `@eterna/governance` 的 `PiiFilter`(组合层取 `ctx.governance?.pii`),`PiiFilter` 结构满足 `PiiGuard`,直接注入无适配层;
- governance 服务未 provide 时降级 `BuiltinPiiGuard`(四类通用模式同源镜像;不支持领域包插拔行业模式)——**降级事实记入 blockers,不得静默**;
- 命中抛 `PiiBlockedError`(governance 版与内置版同名,按 `name` 判别);工具面转结构化 `{ ok: false, blocked: 'pii' }` 载荷,不中断 turn。

## Cordis 三纪律落实

1. **effect 配逆闭包**:`writeEntity().undo()`(顶替场景精确恢复 pre-write 状态)、`writeNote().undo()`(恢复原内容/删除新建文件并清空目录)、`forget` 真删(DELETE 全部行)、`attachMemory()` 返回宿主级总 disposer(卸载四工具+索引 section,幂等);
2. **coeffect 全声明**:目录/库路径/PII 守卫/时钟全部构造注入,不碰旁路全局;
3. **provide 可交换**:`MEMORY_SERVICE_ID = '@eterna/memory'` 注册表+唯一 ID;`PiiGuard` 为 governance 服务的可交换结构接口。

## 组合层用法(真实 DSH 宿主)

```ts
import { Context } from '@deepseek-ai/cordis'
import { attachMemory, createMemory, dshHost } from '@eterna/memory'
import { PiiFilter } from '@eterna/governance'

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

`pnpm --filter @eterna/memory run verify` = oxlint + `tsc --noEmit`(含 `tests/types.seam-pin.ts` 编译期钉住:ToolDefinition→`ToolRuntime['register']`、PromptSection→`SystemPrompt['section']`、`dshHost(liveCtx)` 依赖两个 Context augmentation、governance `PiiFilter`→`PiiGuard`)+ vitest(439 测试;2026-11-15 T13 指标埋点后实测,`./node_modules/.bin/vitest run` 于本包目录输出——根 `pnpm verify` 时点被并行会话未完成的 @basis/* 新包安装失败挡住,与本包无关)。

关键用例:跨会话召回(M1+M2,dispose 后新实例)、遗忘后检索不到(read/search/索引全链路)、索引预算 ≤500 token(120 条压力)、PII 注入与降级双路径、undo 精确配逆。

## Blockers / 后置项

- **需运行时联调**:seam 已用已发布 `@deepseek-ai/dsh-*` 0.2.2-alpha.2 类型编译期钉住,但未在真实 DSH 宿主(agent loop + prompt assembly)里跑过 `ctx.tools.register` / `ctx.systemPrompt.section` 的运行时行为;
- PII 降级路径(governance 服务未就绪时用 BuiltinPiiGuard)在真实组合层需接审计信号,本包仅以 `piiGuard` 字段暴露实际生效守卫;
- 整固(consolidation,设计文档 08 §5.4:小模型从 session log 抽记忆提案+审批)不在 T2 范围,属 memory v1(T10 后)。
