# 企业能力插件设计（T4）：@basis/audit 首插件与三方准入路线

> 生成：2026-11-07 ｜ 修订：2026-11-07 r2（评审修订：服务名语义 / inject 可选性 / deny 理由可达性 / waterfall 透传 / 令牌 v1 口径，见 §5 修订记录）｜ 状态：设计定稿待复审 ｜ 仓库：agent-basis（dev）
> 权威依据：`plans/2026-11-06-dsh企业agent路线定案.md` §11.7（图纸《智能体平台分层架构》复核，2026-11-07）与 T4 任务行（§6）；图纸②=写权限管控（达梦只读/「写入仅限预警记录表」），图纸⑧=三方准入（签名校验/工具白名单/最小权限令牌/调用审计）。
> 本文是 T4 产出物「权限/审计/知识挂载点设计文档 + 首个插件骨架」中的**权限/审计**部分；知识挂载点以 11 号设计文档与 `@basis/knowledge` 提案制为准，不在此重复。

---

## 1. 现状盘点：@basis 五包能力 vs 图纸②⑧

### 1.1 能力矩阵（逐包，全部经 DSH 官方 seam，零内核改动）

| 包 | 已有能力（代码锚点） | 挂载形态 | 与②⑧的关系 |
| --- | --- | --- | --- |
| `@basis/governance` | 规则引擎 `RuleEngine`：YAML → `evaluate(tool,args)` → allow/ask/deny，**deny 优先、fail-closed**（解析期拒绝 `default: allow`，`packages/governance/src/rules.ts:1-9`）；预算守卫 `BudgetGuard`（`agent/turn-stopping` seam 硬截断）；PII 过滤 `PiiFilter`；**审计投影 `AuditProjector`**（session 事件流 → 审计记录，内存/文件双 sink，`src/audit.ts`、`src/sink.ts:14-42`）；egress-lite（出网工具白名单判定，自认「防护等级=引导非强制」，`src/egress.ts:1-11`） | **未挂载为宿主行为**：glue 的 governance-plugin 只 `ctx.provide('governance', { rules, pii })`，既没接审计、也没挂 pre-execute（`packages/glue/src/plugins/governance-plugin.ts:11,31-48`） | ②的主判定引擎；⑧的调用审计库本体 |
| `@basis/interact` | `hitl.yaml` 风险分档 R0-R3（fail-closed：`default_grade` 只允许 R2/R3，`packages/interact/src/hitl.ts:104-106`）；R0-R3 → DSH `permission-presets` 配置产物（**已知边界：PresetSpec 只捆绑 sandbox/approval 两旋钮**，`src/presets.ts:18-20` 头注）；富审批卡片；审批负信号**库**（`src/negative.ts` recordOutcome，repo 内暂无组合层调用方，见 §3.4 不变量 3） | 库形态（产物生成器）；领域包侧的 ask 门实装在 `packs/event-planning/plugin.ts:355-357` | ②的「写入需确认」档位来源 |
| `@basis/knowledge` | wiki-local + WeKnora 双后端、RRF 融合、**提案制写入**（agent_drafted 未过审永不进检索）；glue 侧提案门禁 fail-closed（governance 规则显式 allow 才放行，`packages/glue/src/plugins/knowledge-plugin.ts:26-35`） | glue bundle `- insert:` 装载（`packages/glue/cordis.patch.yml`） | 非②⑧主体；提案门禁复用 governance |
| `@basis/observe` | evolve_signal sqlite 信号存储，kind ∈ `feedback_low \| approval_modified \| approval_rejected \| eval_fail \| drift \| audit_scan`（**audit_scan 已预留**，`packages/observe/src/signals.ts:11-13`）；指标聚合器（session 事件纯函数折叠，`src/metrics.ts:1-13`） | 库形态 | ⑧审计的下游消费者（audit_scan） |
| `@basis/extra` | egress 完整版三层（工具级→域名级→代理强注，结构化拒绝不中断 turn，`packages/extra/src/egress-wrapper.ts:1-21`）；reviewer preset（只读审查 subagent，工具白名单 read/grep/glob）；tenant realm（行业→客户两级 isolate，**已裁定 audit 跨租户共享**——`ISOLATED_TENANT_SERVICES` 不含 audit，`src/tenant-realm.ts:25,40`） | 库形态（§11.4：egress 首期挂，realm 不挂） | ⑧工具白名单的出网向先例 |

### 1.2 市场与安装面（三方准入的既有基础）

- `market/index.json`（format 1）：自管插件索引，`source: git` 固定 commit + path（`market/index.json`）；glue-bundle 为自包含构建形态（vendor + esbuild，`market/glue-bundle/package.json`）。
- DSH `plugin-manager`（官方，`deepseek-harness/packages/boot/plugin-manager/README.md`）：`installBundle`/`inspect(spec)`/`listVersions`/`updateBundle`；**每次工具动作需 danger-full-access 或逐次审批**；依赖 build-script 审批独立存在；GitHub 安装前有 `git ls-remote` 连通性检查。
- **缺口：全程无签名校验**——`git ls-remote` 只验仓库可达，不验内容完整性；inspect 只读 name/version/engines 元数据。

### 1.3 与图纸②⑧的差距清单

图纸⑧四项（`plans/...md:169`：「签名校验/工具白名单/最小权限令牌/调用审计；复用 @basis/governance + plugin market 安装确认；默认关闭按需开启」）与图纸②（`plans/...md:167`：「TDengine/达梦只读；写入仅限预警记录表 → @basis/governance 规则直接对应」）：

| 图纸项 | 现状 | 缺口 | 判定 |
| --- | --- | --- | --- |
| ② 写权限判定引擎 | RuleEngine deny 优先 fail-closed，MCP 工具名（`mcp__*`）可直接进规则 | — | ✅ 已有 |
| ② 宿主执行点 | **glue governance-plugin 未挂 `tools/pre-execute`**；目前唯一挂了 pre-execute 的是 @event/pack 的 ask 门（`packs/event-planning/plugin.ts:355-357`） | 企业档卸掉领域包后 deny 判定无处执行 | ⚠️ 接线缺口（P1 修） |
| ② 参数级写权限 | `argsContains` 子串匹配（`rules.ts:19-26`），表达不了「表名参数必须=预警记录表」的路径级判定 | argsPath 匹配或依赖 MCP 工具白名单收敛 | ⚠️ P3 增强 |
| ⑧ 签名校验 | plugin-manager 无验签；market 索引固定 commit | 自建验签（bundle 外侧，不进宿主） | ❌ P2 |
| ⑧ 工具白名单 | egress-lite/reviewer 是出网/审查向；无「三方插件可注册哪些工具」的准入向白名单 | 准入令牌的 tools[] 载荷承载 | ⚠️ P1 |
| ⑧ 最小权限令牌 | 无任何载体；且 **DSH ToolExecution 无注册方身份字段**（`contracts.ts:170-197`：callId/rootCallId/name/schema/arguments/agent/toolSet/parent/signal/token），`tools/change` 事件无载荷（`events.ts:56-59`）——「调用↔插件」关联无内核事实可用 | 令牌 v1 只能凭配置声明落保护表（§3.5），注册事实级关联待上游 | ❌ P1（口径已收窄） |
| ⑧ 调用审计 | `AuditProjector` 库已就绪（本期实测 74/74 测试过）；**但 glue 未接线**——panel 明证：「审计读 `.basis/audit.jsonl`（glue 未接审计投影时文件不存在 = 0 条）」（`packages/panel/src/snapshot.ts:4`）；且 `AuditRecord` 无 actor/pluginId 字段（`sink.ts:14-35`） | 接线 + 查询面 + actor 字段扩展 | ⚠️ 库✅ / 插件❌ |

**盘点小结**：②⑧的判定与投影逻辑大部分已作为纯函数层存在，真正缺的是四件事——**宿主接线**（pre-execute + session/event）、**准入令牌**（全新，v1 凭配置声明）、**签名校验**（bundle 外侧）、**审计 schema 的 actor 扩展**（⑧要到插件粒度必须加字段）。这决定了首插件选型（§2）。

### 1.4 盘点期实测记录（本会话真实执行）

```
$ pnpm --filter @basis/governance run verify
→ FAIL：oxlint 1 error（typescript/no-unsafe-argument，tests/types.seam-pin.ts:38:30，
  `void budget.onTurnStopping(event)` 实参 any），tsc/vitest 未及执行
$ cd packages/governance && npx vitest run
→ Test Files 6 passed (6) / Tests 74 passed (74)
```

即：governance 测试套件全绿，但 **verify 门禁当前被 lint 卡住**（seam 钉住文件的箭头注册形态触发 no-unsafe-argument；注：直接 `npx oxlint` 曾解析到不同二进制报 0 错，以 pnpm 脚本口径为准）。这是首插件开工前要先修的存量问题（P0 清单第一项），本设计只如实记录、不据此改判能力结论。

---

## 2. 首插件选定：`@basis/audit`（审计留痕）

### 2.1 结论

首插件 = **`@basis/audit`**（`packages/audit` 库 + `market/audit-bundle` 装载壳），三个能力面：

- **A 审计事件流**：`session/event` → 复用 `@basis/governance` 的 `AuditProjector` → `FileAuditSink`（`.basis/audit.jsonl`，沿用 panel 已约定的路径）+ 可选第二 sink；
- **B 最小权限令牌核验**（⑧）：配置声明的工具保护表 + HMAC 令牌核验器，挂 DSH **单调 guard**（`ctx.tools.guard`），默认关闭、配置即启用（对齐 §11.7「默认关闭按需开启」）；v1 口径见 §3.5；
- **C 留痕查询面**：`ctx.audit.query(filter)` 分页游标查询服务，供 panel 与后续合规报表复用（§3.1）。

### 2.2 选定理由（五条，全部对照可验证事实）

1. **审计是⑧四项中其它三项的消费终点**。签名校验结论、白名单命中、令牌核验拒绝，最终都要落留痕才构成合规闭环；先建终点，其余控制逐项接入时天然有账可查。反向顺序（先做签名）会让前期的准入动作无账可落。
2. **库已就绪，插件化 = 接线**。`AuditProjector`（tool/call+tool/result 配对折叠、PII 脱敏、双 sink、flush 屏障）与 `AuditRecord` schema 是现成的（`governance/src/audit.ts`、`sink.ts`），74 测试全绿（§1.4 实测）；panel 已经按 `.basis/audit.jsonl` 读数（`panel/src/snapshot.ts:4`）；observe 已预留 `audit_scan` 信号 kind；tenant-realm 已裁定 audit 跨租户共享。四个下游全部只等接线。
3. **零裁决 = 最低耦合**。audit 不产生 allow/ask/deny，不与 governance 争 pre-execute 顺序，装卸不影响任何既有行为——T4 验收「新插件在两档 profile 均可装卸（effect 逆闭包卸载无残留）」对纯观察型插件最容易确定性验证。
4. **被拒调用的留痕有内核事实保证，但理由文本要分层取**（本次 DSH 源码核实）：tool-call 调度器在 `pipeline.prepare()`（pre-execute 判定所在）**之前**先 `settlement.start()` 落 `tool/call` 事件（`deepseek-harness/packages/core/tools/src/batch.ts:157-159`；append 落点 `:247,256`），被 deny 的调用随后以 `tool/result`（isError:true）收尾。**因此审计只需消费 session 事件流即可覆盖「含被拒调用在内」的全部工具调用，无需在决策路径上插桩**——这是选「事件流接线」而非「pre-execute 观察」的关键依据。诚实边界：拒绝理由在 ToolExecutionResult 层是 `content: [{ text: "Error: ${reason}"] }`（`pipeline.ts:213-224`），而 session 事件的 `error` 字段只携带 `result.error.info`（`batch.ts:252-266`），deny 路径 info 缺省 → **事件层无 error 字段，理由只在 message.content 文本里**；结构化进留痕需两层改动，见 §3.4 缺口 2。
5. **合规红线一致**。§11.8 裁定遥测两处全裁后「无隐式外联」；audit 是本地落盘（NDJSON 文件），不产生新出站面，与「数据不出内网」红线零冲突。

被否的备选：先做「签名校验插件」——需自建验签链且官方安装面（plugin-manager）无挂钩点，工作量大、无官方 seam；先做「写权限增强」——判定引擎已在，缺的接线包含在 audit/governance 插件工作里，单独立包无增量。

---

## 3. 接口设计

### 3.0 Cordis 语义锚（本节全部经 vendor 源码核实，是 §3.1–§3.3 的前提）

1. **`provide(name)` 的 name 就是 ctx 属性名**：`props[name] = { type: 'service' }`（`vendor/cordis/src/reflect.ts:291-306`）；运行时先例 = glue governance-plugin 以服务名 `'governance'` provide 得到 `ctx.governance`（`glue/src/plugins/governance-plugin.ts:11,43`）。
2. **`inject` 是硬依赖表**：官方注释「Services the plugin requires; it only loads while all are available」（`vendor/cordis/src/registry.ts:106-108`）；`Inject.resolve` 对 `false` 值原样保留条目（`registry.ts:84`，`false ?? null` = false）；Fiber 对任一 inject 键缺服务即 epoch=INACTIVE、fiber 永不装载（`vendor/cordis/src/fiber.ts:619-625`）；inject 条目的 value 非空时成为该服务的 intercept config（`fiber.ts:242-249`），**不是可选性开关**。app-boot 把 missing-inject 列为启动失败诊断。
3. **waterfall veto 语义**：「calling next() invokes the next listener; not calling it vetoes」（`vendor/cordis/src/events.ts:76-85`）——不透传即短路后续全部监听者。
4. **既有命名分叉事实（audit 不复制）**：`governance/src/index.ts:49` 的 `GOVERNANCE_SERVICE_ID='@basis/governance'` 是库内**对象 id 标签**（`Governance.id` 字段），与 glue 运行时服务名 `'governance'`（`glue/.../governance-plugin.ts:11`）是两个同名不同义的常量。audit 以「服务名 `'audit'` / 对象标签 `'@basis/audit'`」双常量显式分名，杜绝同款分叉。

### 3.1 provide/inject 面（服务本体）

**库**（`packages/audit`，依赖 `@basis/governance` 复用投影器）：

```ts
// packages/audit/src/service.ts
/** cordis 服务名 = ctx 属性名(§3.0-1):provide('audit') → ctx.audit。 */
export const AUDIT_SERVICE_ID = 'audit'
/** 库内对象 id 标签(注册表命名空间,非 cordis 服务名)。 */
export const AUDIT_ID = '@basis/audit'

export interface AuditWorld {
  readonly id: typeof AUDIT_ID
  /** A 面:事件投影器(governance 库实例,sink 集 = FileAuditSink[.basis/audit.jsonl] + 可选外部 sink)。 */
  readonly trail: AuditProjector
  /** B 面:令牌核验(默认关闭;配置 enabled+secret 后启用)。 */
  readonly tokens: TokenVerifier
  /** C 面:留痕查询(分页游标,防全量物化,见下)。 */
  query(filter: AuditQuery & { readonly limit: number; readonly cursor?: string }):
    Promise<{ readonly records: readonly AuditRecord[]; readonly nextCursor?: string }>
  /** 治理侧直投(预算违规/令牌拒绝等非工具调用事件),actor 粒度在此落。 */
  report(detail: Readonly<Record<string, unknown>> & { readonly actor?: AuditActor }): readonly AuditRecord[]
}

declare module '@deepseek-ai/cordis' {
  interface Context { audit?: AuditWorld }
}
```

- **查询面防无上界**：C 面强制 `limit` + 游标（返回 nextCursor），不做整文件物化；落盘侧配套轮转策略——v1 按日分文件 `.basis/audit-YYYYMMDD.jsonl`（panel 读数路径同步适配）或大小上限轮转，P0 实现时二选一定死；append-only 无轮转的单一 `.basis/audit.jsonl` 在长期宿主下不可接受；
- **审计记录 actor 扩展（⑧插件粒度的前提）**：audit 携带的 governance 库版本对 `AuditRecord`（`sink.ts:14-35`）新增可选字段 `actor?: AuditActor`（`AuditActor = { pluginId: string; source: 'config' | 'decision' | 'install' }`）——A 面从保护表（§3.5）回填工具归属，B 面拒绝与 P2 准入事件经 `report()` 填。向后兼容（纯新增可选字段）；
- **inject 声明（按 §3.0-2 的硬依赖语义最小化）**：`inject: { tools: true }`——guard seam 所在的 tools 服务，DSH 基础树必在。**governance 不进 inject**：audit 必须在无 governance 的宿主上可装载（§2.2-2 的独立价值），声明即永续 PENDING；
- **governance 的机会读取（不声明依赖）**：`apply` 内以结构子集 cast 读取（`(ctx as { governance?: { pii?: PiiFilter } }).governance?.pii`，同 `memory-plugin.ts:18` 既有形态）：在场用其 PiiFilter，缺席用 audit 自带 `defaultPiiPatterns` 兜底——审计是合规资产，脱敏不可缺位，且本设计不再复制 `inject: { governance: false }` 写法（该写法经 §3.0-2 核实是硬依赖，glue 的 memory/knowledge 两插件现状属「因 glue 恒同挂 governance 才未爆」的潜伏问题，记录在案，是否修正由 glue 维护者决定，不阻塞本设计）。

### 3.2 bundle 装载（`- insert:` 语义）

**装载壳**（`market/audit-bundle/`，形态参照 glue-bundle 但依赖声明做对）：

```yaml
# market/audit-bundle/cordis.patch.yml
- insert:
    - id: basis-audit
      name: '@basis/audit-bundle/audit-plugin'
```

- **为什么必须 `- insert:`**：cordis patch 的裸 id 行只覆写既有行，基础树无同名行时整行被丢弃并 warn（`deepseek-harness/vendor/include/src/patch.ts:93-94`「patch: entry %C not found → continue」）——glue 曾因此静默不装载（`packages/glue/cordis.patch.yml:1-7` 头注 E2E 教训）；`- insert:` 无组 id 时按根层追加（`patch.ts:79-81`），这是 @event/pack 与 glue 实测可装载的形态；
- **package.json 要点**：`dsh.bundle.patch` 指向上述 yml；dsh 包（`@deepseek-ai/cordis`、`@deepseek-ai/dsh-session`、`@deepseek-ai/dsh-tools`）进 **`peerDependencies`**（`docs/PLUGIN-AUTHORING.md` §1 规范 3 原文），`@basis/governance` 是自有库依赖进 `dependencies`。**既有偏差点破**：`packages/glue/package.json:19-26` 把 cordis/dsh-tools 放在 `dependencies`，与上述规范不符（market/glue-bundle 构建产物反而是 peerDeps 形态）——audit-bundle 不复制该偏差；
- **模块形态**：`export default defineAuditPlugin()`——loader 取 default export **实例**，漏写=静默不装载（硬性规范 1）；
- **双档装卸**：Web 档经 `dsh.profile.bundles` 追加 `@basis/audit-bundle`（profile 包 materialize 时 pnpm file: + node_modules symlink 配方，`docs/PLUGIN-AUTHORING.md` §4）；嵌入档（T6）同 bundle 行。卸载 = bundles 列表移除或行置 `disabled: true`。

### 3.3 effect 逆闭包（卸载零残留）

```ts
// packages/audit/src/plugin.ts(骨架)
apply(ctx: Context): () => void {
  const world = createAuditWorld(config)                 // 开 sink/trail/tokens(coeffect:仅 config 给定路径)
  const provide = ctx.provide(AUDIT_SERVICE_ID, world)   // 逆① 撤服务('audit' → ctx.audit,§3.0-1)
  const offEvent = ctx.on('session/event', (_session, event) => world.trail.projectEvent(event))  // 逆② 停增量
  const offGuard = config.tokens?.enabled ? ctx.tools.guard(world.tokens.guard) : undefined       // 逆③ 摘单调红线
  return () => {
    offGuard?.(); offEvent()
    void world.trail.flush().catch(() => {})             // 逆④ 冲账(flush 上抛首错语义保留给显式调用,卸载路径吞错防阻塞宿主)
    void provide()                                       // 逆⑤(provide 的 disposer 是 async,reflect.ts:311-321;fiber 侧兜底等待)
  }
}
```

- **顺序**：摘 guard → 摘事件监听（停止增量）→ flush 冲账 → 撤 provide。先摘监听保证 flush 是**闭账**而非继续收账；
- **flush 异步性诚实声明**：`apply` 的 disposer 是同步签名（先例 `packs/event-planning/plugin.ts:359-366` 的 disposed 守卫形态），flush 与 provide 撤销均以 fire-and-forget 触发；不依赖卸载时点保证持久性——`FileAuditSink.write` 本就逐条 await 追加（`governance/src/sink.ts:65-68`），常驻宿主不靠 dispose 落盘；`flush()` 上抛写错的强语义保留给测试与显式冲账调用（`audit.ts:142-150`）；
- **在途调用边界（既有实现语义，验收必须规避）**：`AuditProjector` 以 `#pending` Map 配对 tool/call→tool/result（`audit.ts:39,56-92`）；逆②摘除后到达的 tool/result 无人消费，该调用的 result 记录永不产生。因此 E2E 卸载断言**不得**用「行数不变」绝对口径，改用：**「卸载后无新增 tool-call 记录」**，且脚本在卸载前等待 turn 边界 / `session/flush`，避免在途窗口污染断言；
- **验收挂钩（T4 口径）**：装载 → 断言 `ctx.audit` 在场 → 产生若干调用（含一次被 deny 的）→ 断言 `.basis/audit*.jsonl` 行数与 kind 分布 → 卸载（disabled）→ 再触发调用 → 断言 **`ctx.audit` 缺席 + 无新增 tool-call 记录** + 无监听残留（宿主日志 grep `skipping|incompatible` = 0）。装载前后各断言一次 ctx.audit，使「缺席」断言有意义（§3.0-1 语义下服务名正确才会出现）。

### 3.4 与 governance deny 优先的协作（三 seam 分工）

| seam | 谁挂 | 职责 | 单调性 |
| --- | --- | --- | --- |
| `tools/pre-execute` waterfall（`core/tools/src/events.ts:18`） | **governance**（P1 由 glue governance-plugin 挂载，装配 `createGovernance().preExecute`） | allow/ask/deny 决策：预算→egress→规则引擎，deny 优先（`governance/src/index.ts:86-93`） | 可扩展（waterfall veto），deny 一经产生由内核保证不可回翻 |
| `ctx.tools.guard()`（`core/tools/src/index.ts:384-386`，类型 `contracts.ts:384-391`） | **audit**（B 面令牌核验） | deny-only 红线：命中保护表的调用无有效令牌 → 返回拒绝理由 | **单调**：checkGuards 只在 pre-execute waterfall 与 approval 均通过后运行（`pipeline.ts:199-213`），guards 无 allow 语义、监听顺序不可能把 deny 翻回 allow（`core/tools/README.md:92`） |
| `session/event`（`core/session/src/index.ts:76`；插件级消费先例 `context/agent-instructions/src/index.ts:322`，该插件 inject 未含 session，佐证监听无需依赖注入） | **audit**（A 面） | 纯观察留痕，不参与裁决 | 无裁决权 |

**协作不变量**（四条，前两条写进验收断言）：

1. audit 的 guard 永远不可能给 governance 的 deny 放行（guard 无 allow 语义，内核保证）；
2. governance 的 deny/ask 全过程被 audit 留痕（§2.2-4 的 batch.ts 事实：`tool/call` 先于 `prepare()` 落账，被拒调用也有 call+result 对）；
3. **审批负信号链路现状 = 待接线，不是既有链路**：`ApprovalSignalBus.recordOutcome` 是库函数，头注自认「由组合层在 waterfall 应答处调」（`interact/src/negative.ts:7-9`），repo 内 grep 无任何生产调用方（仅 interact 包内测试引用）；observe 只预留 `approval_rejected` kind。在组合层接线落地前，audit 的 tool/result 事实面不依赖它；接线列为 P1 工作项，届时 audit「不重复记审批决策」的分工才成立；
4. **双投影器禁令**：全宿主唯一 `AuditProjector` 归 audit 插件。governance 库的 `Governance.audit` 字段与 `createGovernanceFromYaml` 的 audit 装配路径（`governance/src/index.ts:58,73,111`）在 glue 装配时**不得**再建实例（glue 现状未建，无存量冲突）；governance 侧的治理事件（预算违规/令牌拒绝）经 `ctx.audit.report()` 直投（`AuditProjector.reportGovernance` 已有，`audit.ts:153-157`）。

**两处已核实的衔接缺口（P0/P1 工作项）**：

1. **pre-execute 接线的透传规则（allow 不得短路 ask 门）**：waterfall 是 veto 语义（§3.0-3），governance 监听器若对 allow 直接返回 `{kind:'allow'}`，会跳过后续所有监听者——包括 @event/pack 的 ask 门（`packs/event-planning/plugin.ts:355-357`），把「该走人」的 R2/R3 动作静默放行。**组合规则钉死：governance 监听器仅 deny/ask 短路返回；allow 一律 `await next()` 透传**（deny 短路=被拒调用不进 ask 门，留痕由事件流兜底，不变量 2）。装载顺序仍要求 governance 先于领域包（deny 先判），由 bundle 层次天然保证；若未来顺序敏感，在 profile 层显式钉 `dsh.profile.bundles` 顺序，不在插件内猜。
2. **deny 理由进审计记录（两层改动，缺一采不到）**：session 事件的 `error` 字段 = `result.error.info`（`batch.ts:252-266`），pre-execute deny 的 error 只有 `message` 无 `info`（`pipeline.ts:213-224`，且 `GovernancePreDecision` 无 info 字段，`governance/src/types.ts:32-36`）→ **事件层根本没有 error 字段，拒绝理由只存在于 message.content 文本 `Error: ${reason}`**。修法两层： ① 治理层——`GovernancePreDecision` 的 deny 分支增可选 `info?: Record<string, unknown>`（结构化理由载体，`pipeline.ts:220` 会把 `decision.info` 带进 `error.info`，链路已通）；② 事件层——audit 携带的 governance 库版本在 tool/result 分支把 `error` 对象整体记入新字段 `errorInfo`（而非只读 `error.name`——现状 `errorName` 读取点在 `audit.ts:79`，deny 路径恒 undefined）+ 无 info 时以 `Error: ` 前缀从 content 文本兜底解析。两层都属向后兼容新增。

### 3.5 最小权限令牌 v1（⑧，口径收窄版）

**内核事实约束**：ToolExecution 无注册方身份字段（`contracts.ts:170-197`），`tools/change` 事件无载荷（`events.ts:56-59`）——「这次调用是哪个三方插件注册的工具」在运行时不可知。因此 v1 放弃「凭注册事实关联」，改为**凭部署配置声明**：

- **保护表**：audit 插件 config 声明 `protectedTools: [{ tools: glob[]; scopes: string[]; pluginId: string }]`——企业准入方（人工）为每个已准入三方插件声明其工具名 glob 与所需 scopes；一方工具不进表（表外工具 guard 不拦，显式声明）；
- **令牌**：HMAC-SHA256，payload `{ pluginId, tools[], scopes[], iat, exp }`；令牌材料经环境变量/准入文件下发（不落地 DSH 凭据库，对齐 §11.8 凭据裁定），`TokenVerifier` 启动时装载并校验签名/有效期/scopes 覆盖；
- **执行点**：guard（单调，§3.4 表）对命中保护表的调用查 `tokens.authorized(glob, scopes)`，无效即返回拒绝理由；
- **诚实边界**：这是「准入开关」语义——未准入（无有效令牌）的三方工具每次调用被拒且留痕；它**不能**证明某次调用真的来自该插件（运行时无身份可验）。注册事实级关联需上游提供注册方身份或带载荷的注册事件，列为对上游的观察项，v1 不等；
- **默认关闭**：`config.tokens.enabled` 缺省 false（§11.7「默认关闭按需开启」）；关闭时 guard 不注册（§3.3 逆③ 为 undefined）。

---

## 4. 分阶段路线

| 阶段 | 内容 | 产出 | 验收口径 |
| --- | --- | --- | --- |
| **P0 审计接线**（=T4 首插件骨架） | `packages/audit`（A/C 面：session/event 接线 + FileAuditSink 轮转版 + 分页 query + actor 字段扩展）+ `market/audit-bundle` + glue governance-plugin 保持现状不动 | 插件骨架 + 本设计文档落地实现 | ① 存量 lint 修复后 `pnpm --filter @basis/governance run verify` 全绿、`pnpm --filter @basis/audit run verify` 全绿；② `packctl lint` 过；③ 两档 profile 装卸 E2E（§3.3 验收挂钩：ctx.audit 在场/缺席、无新增 tool-call 口径、避开在途窗口）；④ 留痕断言：含 deny 调用的 tool-call 记录落盘 |
| **P1 令牌核验 + 治理宿主接线**（⑧令牌/工具白名单 + ②执行点） | §3.5 保护表 + TokenVerifier + guard（默认关闭）；glue governance-plugin 挂 `tools/pre-execute`（**allow 透传规则**，§3.4 缺口 1）；GovernancePreDecision.info + AuditProjector errorInfo 采集（§3.4 缺口 2）；审批负信号组合层接线（§3.4 不变量 3） | 准入令牌核验 + 宿主级 deny + deny 理由结构化留痕 | 命中保护表且无有效令牌的调用被 guard 拒且留痕（含 actor.pluginId）；governance 规则 deny 在卸掉领域包的企业档上仍生效且 R2/R3 ask 门不被 allow 短路（宿主级 E2E 双断言） |
| **P2 三方准入流程**（⑧签名校验） | market 索引准入流水线：`inspect` 报告 + 安装审批记录 → `ctx.audit.report({ actor })` 落账；**签名校验在 bundle 外侧**（独立 verifier 脚本：拉取 commit 后对 `dsh.bundle.patch` + 插件入口清单做摘要比对，不进宿主进程）——诚实声明：官方 plugin-manager 无验签挂钩点，v1 只做 commit-pinned + 摘要留痕，密码学验签待官方扩展或外部 CI | 准入四件套中签名项的最小可用版 | 准入全流程（装→批→启→调→审）每步在审计文件有对应记录（actor.source='install'） |
| **P3 写权限落地**（②） | MCP 数据源（Timeseries/达梦只读/预警记录表）工具进 governance 规则；`argsContains` → argsPath 匹配增强（「表名参数必须=预警记录表」）；audit 报表按数据源聚合；RBAC 维持 §4 访谈裁定（推迟嵌入档，realm 不挂） | 图纸②验收 | 达梦写类 MCP 工具非白表参数 deny+留痕；只读工具放行 |

依赖关系：P1 依赖 P0（guard 拒绝理由要经 audit 留痕）；P2 依赖 P1（准入令牌是准入流程的运行面）；P3 依赖 P1（写权限执行点=治理宿主接线）。整条线不改 DSH 内核、不加出站面，与 §11.8 裁定全部兼容。

---

## 5. 修订记录

- **r2（2026-11-07，评审修订）**：① 服务名改 `'audit'`、对象标签 `'@basis/audit'` 双常量分名——cordis provide 的 name 即 ctx 属性名（`reflect.ts:291-306`），原稿两常量混用使 `ctx.audit` 永不存在；② 删除 `inject: { governance: false }` 设计——cordis inject 是硬依赖表（`registry.ts:84,106-108`、`fiber.ts:619-625`），false 非可选开关，改结构子集机会读取，并记录 glue 既有同款潜伏问题；③ deny 理由可达性改两层口径——session 事件 error 字段只携带 `result.error.info`（`batch.ts:252-266`），deny 无 info，理由只在 content 文本；原稿「errorMessage 采集」单层修法采不到东西，改为 GovernancePreDecision.info + errorInfo 采集 + 文本兜底；④ pre-execute 接线补 allow 透传规则（waterfall veto 语义，`events.ts:76-85`），防 allow 短路 ask 门；⑤ 令牌 v1 收窄为配置声明保护表（ToolExecution 无注册方身份、tools/change 无载荷，注册事实级关联列为上游观察项）；⑥ AuditRecord 增 actor 扩展、query 改分页游标 + 轮转策略、卸载验收改「无新增 tool-call」口径并规避在途窗口、provide disposer async 注记；⑦ 负信号链路改「待接线」；⑧ audit-bundle 依赖声明点破 glue 源包 peerDeps 偏差；⑨ 行号勘误（patch.ts:93-94、contracts.ts:384-391、errorName 读取点 audit.ts:79）。
- **r1（2026-11-07）**：初稿。

## 附：本设计引用的关键事实清单

| 事实 | 出处 |
| --- | --- |
| 图纸⑧准入四项与「复用 governance + market 安装确认；默认关闭按需开启」 | `plans/2026-11-06-dsh企业agent路线定案.md:169` |
| 图纸②写权限与 governance 直接对应 | 同上 `:167`；T4 行 `:64` |
| glue governance-plugin 只 provide 未接线；服务名为 `'governance'` | `packages/glue/src/plugins/governance-plugin.ts:11,31-48` |
| cordis provide name = ctx 属性名；disposer async | `deepseek-harness/vendor/cordis/src/reflect.ts:291-321` |
| inject 硬依赖语义（false 非可选；缺服务即 INACTIVE） | `vendor/cordis/src/registry.ts:84,106-108`、`vendor/cordis/src/fiber.ts:242-249,619-625` |
| waterfall veto 语义 | `vendor/cordis/src/events.ts:76-85` |
| panel 审计路径约定与「未接=0 条」 | `packages/panel/src/snapshot.ts:4` |
| @event/pack 唯一 pre-execute 实装 | `packs/event-planning/plugin.ts:355-357` |
| 裸 id 行覆写丢弃 / insert 根层追加 | `deepseek-harness/vendor/include/src/patch.ts:79-81,93-94` |
| tool/call 先于 pre-execute 落账（deny 亦留痕） | `deepseek-harness/packages/core/tools/src/batch.ts:157-159`（start 先于 prepare）、`:247,256`（tool/call、tool/result 落账） |
| session 事件 error 字段只带 info；deny 路径无 info | `batch.ts:252-266`；`pipeline.ts:213-224` |
| guard 单调、无 allow 语义、在 approval 后运行 | `core/tools/src/contracts.ts:384-391`、`core/tools/src/index.ts:384-386`、`core/tools/src/pipeline.ts:199-213`、`core/tools/README.md:92` |
| ToolExecution 无注册方身份；tools/change 无载荷 | `core/tools/src/contracts.ts:170-197`、`core/tools/src/events.ts:56-59` |
| `session/event` 插件级消费形态（无需 session inject） | `core/session/src/index.ts:76`、`context/agent-instructions/src/index.ts:35,322` |
| plugin-manager 审批/连通检查/无验签 | `deepseek-harness/packages/boot/plugin-manager/README.md`（Summary 段） |
| 负信号库就绪但无组合层调用方 | `packages/interact/src/negative.ts:7-9,107`（repo 内 grep recordOutcome 仅 interact 包内测试） |
| audit 跨租户共享裁定 | `packages/extra/src/tenant-realm.ts:25,40` |
| governance verify 现状（lint 卡/74 测试绿） | 本会话实测（§1.4） |
