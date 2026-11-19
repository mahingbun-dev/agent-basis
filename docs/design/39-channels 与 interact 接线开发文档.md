# 39 - channels 与 interact 接线开发文档（WS-E 落地）

> 状态：开发实施文档（任务级规格，供 workflow 编排直接消费；§7 为编排规格）
> 日期：2026-11-17
> 上游规格：`24-主动工作体系融合设计` **§5.2**（概念映射：Source 行「binding 从 `channel_user → session` 升级为 `→ thread / ticket`」、Attention 行、Outbox 行）· `27-执行者模型与冲突解决` **§3.3**（情况 A 防线：「channels binding 多渠道收敛到同一身份 → 同一 thread/ticket → 线程串行化 + 批量合并」，且「情况 A 的整条防线都建在这一步上」）· `packages/interact/src/hitl.ts` 的 `escalate` / `cooling_period_sec` / `double_confirm` / `on_no_answer` **声明面**（G2 缺口缝合对象）
> 配套：`26` §2（interact/channels 中改清单）· `32` §2/§3（WS-E 工作流、原 P0 债务溶解）· `33` §1.3 WS-E 门禁（G2-E1–E7）与 §1.2（G1-2）· `34` §5（与 channels/interact 的接线点）与 §3（EngineForSources 契约）· `24a` 拍板 A5（channels 统一接收面 + Source 扩展钩子）、B3（embed 档 Attention 经 channels/API 出）
> 铁律：每条任务两列可追溯（**依据条款**＝设计文档号§节，精确到节；**验收门禁**＝可执行命令或测试文件）；涉交互任务附 §5 交互细节对照表；**不发明设计文档之外的任何行为**，设计缺口全部进 §9 开放问题。
> 关键依赖事实：WS-E 依赖 **WS-A 的 Trigger 协议**（`32` §2 依赖图），而 `packages/tasks` 本日实测**尚不存在**（`ls packages/` 无 tasks）——本文对 tasks 的全部契约引用以 `34` 号（草案）为准并逐处标注「对端＝34 §x 草案」；tasks 落地前，E2/E3/E7 的对端一律以端口桩驱动测试。

---

## 0. 范围与不做什么

**做**（`32` §2 WS-E 行的全文，逐项有据）：

1. binding 升级 `→ thread / ticket`（`24` §5.2 Source 行；`27` §3.3 情况 A）；
2. Source 角色 / 统一接收面 + 扩展钩子（`24a` A5；`34` §2.5/§3）；
3. `escalate` / `cooling_period_sec` / `double_confirm` / `on_no_answer` 运行时接线（`26` §2 interact 行②；`interact/src/hitl.ts` 声明面）；
4. webhook 网关挂载（`26` §2 channels 行③；`33` G2-E3）；
5. Outbox `reply` 投递器经 channels 出站 + 报告六态渲染（`26` §2 channels 行④；`34` §5-channels）；
6. 生产/super 形态挂载与装卸无残留（`26` §2 channels 行①；`33` G2-E6）。

**不做**：

- 不实现 tasks Engine/Trigger/Outbox 本体（WS-A，`34` 全文）；本文对端契约只引用不实现；
- 不做站内工作台 UI 与原型（WS-D；`30` §5 原型四件中的「Attention 卡（站内横幅）」归其范围）；
- 不改 hitl.yaml 键形、不改 `card.ts` 渲染管线与 DSH approval waterfall 协议（`packages/interact/src/card.ts:15` 模块头：「审批应答仍走内核 approval waterfall，本包不改协议」）；
- 不做 access 审批人角色（WS-C，`30` §7-3）；
- 不引入跨源身份映射（`24` §2.2「被拒绝的概念」表明确拒绝 Principal 实体与跨源身份映射）。

---

## 1. 现实基线（代码事实，2026-11-17 实测，file:line 可跳转）

### 1.1 interact 声明面（本接线的上游，G2 缺口的「声明」半边）

| 声明 | 位置 | 现状 |
|---|---|---|
| `onNoAnswer: NoAnswerStrategy`（逐条覆盖全局，缺省 `'suspend'`） | `packages/interact/src/hitl.ts:34`、`:65`、`:120`、`:234` | 只有解析与校验，无运行时消费者 |
| `escalateTo: readonly string[]`（R3 专属，注释明言「channels 消费」） | `packages/interact/src/hitl.ts:36`、`:203-210` | 同上 |
| `coolingPeriodSec: number`（R3 专属，0=无） | `packages/interact/src/hitl.ts:38`、`:211-218` | 同上 |
| `doubleConfirm: boolean`（R3 专属） | `packages/interact/src/hitl.ts:40`、`:219-225` | 同上 |
| `NoAnswerStrategy = 'suspend' \| 'escalate' \| 'fail'`，语义「挂起(任务暂停非失败)/ 升级 channels / 失败」 | `packages/interact/src/types.ts:19-20` | 同上 |
| doubleConfirm 的**渲染**已有：同卡第二问（id `${id}:confirm`、header「R3 二次确认」） | `packages/interact/src/card.ts:220-227` | 渲染有、运行时校验无 |
| R3 附加控制三行文案（升级给/冷静期/二次确认） | `packages/interact/src/card.ts:266-271` | 渲染有 |
| fail-closed 纪律：`default_grade` 只允许 R2\|R3；未知键/非法枚举/R0-R2 携带 R3 专属键均校验期拒绝 | `packages/interact/src/hitl.ts:104-106`、`:198-201` | 已实现（本接线不得削弱） |
| 预设边界：DSH `PresetSpec` 只捆绑 sandbox+approval 两旋钮，**R3 三控不进预设，由组合层执行** | `packages/interact/src/presets.ts:17-20`；`packages/interact/README.md:77-80` | 组合层执行＝本次 E4-E6 的空位 |
| 包自述：「`on_no_answer` 的挂起/升级执行……由组合层与 T11 channels 落地；本包提供策略数据与逐条解析」 | `packages/interact/README.md:88-90` | 责任归组合层，已由包 README 钉死 |
| 服务面：`INTERACT_SERVICE_ID` + `createInteract()/disposeInteract()`（注册表 + 唯一 ID，provide 可交换） | `packages/interact/src/index.ts:58`、`:93-120` | 已实现，无人 provide |

**消费者盘点（G2 半接线的精确证据，grep 实测）**：全仓 `@eterna/interact` 的导入者仅两家——`packages/memory/src/approval.ts:27-28` 与 `packages/prompt-studio/src/approval.ts:17-18`，且都只用 `buildApprovalCard` / `cardToQuestionItems`（卡片管线）。`escalateTo` / `coolingPeriodSec` / `doubleConfirm` / `onNoAnswer` 四者**零运行时消费者**。领域包侧另有自备的 ask 门（`packs/event-planning/plugin.ts:43-50` 的 `ASK_GATE` 硬编码表），不经 HitlPolicy。

**已知不一致（→ §9 开放问题 1）**：`packs/*/hitl.yaml` 实际键形是 `industry` / `escalation_contact` / `risk` / `match.tools`（`packs/event-planning/hitl.yaml:1-6`，`tools/packctl/src/init.ts:227` 同款脚手架），与 `HitlPolicy` 校验键形（`pack` / `default_grade` / `grade` / `tools` / `escalate_to`…）不一致，`escalation_contact` 全仓无消费者。

### 1.2 channels 现状（G4「已建未挂」的精确证据）

| 面 | 位置 | 事实 |
|---|---|---|
| 绑定存储：主键 `(channel_type, channel_user_id) → session_id`；多渠道身份可指向同一 session（收敛靠多行同目标）；同身份 re-bind 即移绑续接 | `packages/channels/src/binding.ts:34-44`（MIGRATION）、`:85-101`（bind）、`:103-108`（bindIfAbsent）、`:110-115`（resolveSession）、`:117-122`（sessionBindings）、头注 `:10-11` | **无 thread/ticket 维度** |
| 入站网关：`POST {prefix}/webhook/:channelType`（HMAC-SHA256 验签→message 信封按 binding 解 session→`sessionPort.deliverInbound`；未知绑定 404）+ `GET|POST /approval/:token`（令牌点击） | `packages/channels/src/webhook.ts:149-172`（路由）、`:174-228`（handleWebhook）、`:214-227`（message→session 投递） | 投递目标只有 session |
| 一次性审批令牌：32 字节 CSPRNG、落库只存 sha256、单次有效（already-used/expired/unknown-token）、`revokeAll` 在「审批已在其他渠道应答」时作废全部未用令牌、默认 TTL 30 分钟 | `packages/channels/src/token.ts:89`、`:147-166`、`:169-173` | 已实现（E4 直接复用） |
| 出站卡片契约：**所有出站审批卡片统一携带 `ApprovalActionPayload`**（approvalRequestId + channel + approve/reject 各一枚令牌），`buildApprovalCard` 强制装配、`validateOutboundCard` 强校验 | `packages/channels/src/cards.ts:51-80`、`:83-93`；`packages/channels/src/types.ts:54-69` | 已实现 |
| 卡片种类：`OutboundCardKind = 'approval' \| 'progress' \| 'delivery'` | `packages/channels/src/types.ts:71` | **无报告六态语义**（→ E7） |
| 服务面：`CHANNELS_SERVICE_ID` + `createChannelsService()`（bindings/tokens/adapters + `startWebhookGateway`，close 配逆） | `packages/channels/src/index.ts:71`、`:73-89`、`:100-131` | 已实现，**无人装配** |
| 邮件审批红线：禁止解析正文「同意」字样放行，只认一次性令牌链接 | `packages/channels/src/email.ts`（`FREE_TEXT_CONSENT_PATTERN`，`index.ts:50` 导出）；依据 12 号 §7.7 | 已实现（E4 邮件升级路径继承） |

**装配面盘点（G4 实证）**：全仓对 `@eterna/channels` 的导入者**为零**（grep 实测，`packages/channels/` 自身除外）；`profiles/eterna-web/cordis.patch.yml` 与 `profiles/eterna-embed/cordis.patch.yml` 均无 channels/interact 挂载行（实测通读）；`packages/glue/src/plugins/` 只有 audit/egress/governance/knowledge/memory 五件；`packages/access/src/routes.ts:56-64` 的 `TOGGLEABLE_PLUGINS` 无两包登记。

### 1.3 宿主侧先例（接线将照抄的形态）

- **pre-execute 瀑布插件先例**：`packages/glue/src/plugins/governance-plugin.ts:89-158`——`ctx.provide(服务 ID, world)`（`:100-103` 钉住「必须 provide 才能赋值」）+ `ctx.on('tools/pre-execute', …)` + 返回配逆闭包。E4-E6 的运行时消费者、E8 的 glue 插件按此形态新增。
- **审批桥超时语义**：`packages/access/src/approval-bridge.ts:24`（`BridgeOutcome = 'allowed-once' | 'rejected' | 'cancelled' | 'unavailable'`）、`:160-166`（超时→`unavailable`，审计 `access.approval.expired`）、`:14-15`（超时缺省 300s，`unavailable` =「无可用审批渠道」，**不冒充用户拒绝**）、`:182-185`（`ETERNA_TOOL_APPROVAL_TIMEOUT_MS`）。on_no_answer 分派器必须沿用该词表（→ E6）。
- **负信号诚实边界**：`packages/interact/src/negative.ts:12-13`——`'unavailable'` 无应答者 fail-closed **不是**负信号，不得发布 rejected/modified。
- **面板送达先例**：`packages/memory/src/approval.ts:4-18`（S2 实测结论）——官方 `conversation.approval.card` 所在 client 包未打进 dsh-web-frontend 0.2.2-rc.1 发行包，现行送达走面板审批队列。E4 的渠道送达（channels 出站）不受此限制，但站内横幅仍归 WS-D。

### 1.4 门禁基线（本日实测）

| 命令 | 结果（2026-11-17 14:16 实测） |
|---|---|
| `pnpm --filter @eterna/channels run verify` | 退出码 0：7 个 spec 文件（binding/cards/email/service/token/webhook/wechat）49 用例全绿 |
| `pnpm --filter @eterna/interact run verify` | 退出码 0：5 个 spec 文件（ask/card/hitl/negative/presets）55 用例全绿 |

另：`scripts/verify-governance-e2e.mjs` 存在（G2-E6 将扩展它）；`scripts/verify-eterna-super.mjs` **不存在**（`33` §1.2 G1-2 标注【新增，待建】，交付时点归 WS-A 启动时，`33` G2-A11）。

---

## 2. 任务总览（两列可追溯）

| # | 任务 | 一句话 | 依据条款 | 验收门禁 | 依赖 |
|---|---|---|---|---|---|
| **E1** | binding 升级 thread/ticket | 绑定表在 `→ session` 之上**增补** `→ thread / ticket`；多渠道身份收敛同一 thread | `24` §5.2（Source 行）；`27` §3.3（情况 A + 末段「整条防线建在这一步」）；`26` §2（channels 行②）；`34` §5-channels（binding 行，原文「增补」） | `packages/channels/tests/binding.spec.ts`（扩 thread/ticket 用例）；`pnpm --filter @eterna/channels run verify` | 无（可立即开工） |
| **E2** | Source 统一接收面 + 扩展钩子 | channels 事件归一化为 Trigger 进 tasks；PR 生命周期类走扩展钩子（A5） | `24a` A 组 A5；`34` §2.5（channel-adapter 行）、§3（EngineForSources：`receive`/`bindThread`/`threadClosed`）；`26` §2（channels 行③）；`33` G2-E7 | `packages/channels/tests/source-registry.spec.ts`（新建） | WS-A Trigger 协议（`32` §2）；未落地时对端用 TriggerSink 桩 |
| **E3** | webhook 网关挂载 + Trigger 幂等 | message 信封改按 thread 维度归一化投递；重复投递经幂等键收敛为一单 | `34` §5-channels（webhook/token 行）；`27` §3.3（情况 C 幂等）；`33` G2-E3 | `packages/channels/tests/webhook.spec.ts`（扩用例）+ `packages/tasks/tests/idempotency.spec.ts`（对端＝34 §4-C，WS-A 侧） | E1；WS-A（桩先行） |
| **E4** | escalate 运行时接线 | `escalateTo` / `on_no_answer: escalate` 有运行时消费者：超时正确升级，出站走 channels 审批卡（令牌契约） | `26` §2（interact 行②）；`interact/src/hitl.ts:36`（注释「channels 消费」）；`24` §4（G2 行）；`32` §3（「escalate 接 channels」原 P0 项溶解入 WS-E）；`33` G2-E4 | `packages/interact/tests/escalation.spec.ts`（新建）；`packages/channels/tests/token.spec.ts` 不回归（G2-E5） | E8（全链）；桩先行可开发 |
| **E5** | 冷静期 + 双确认运行时接线 | R3 冷静期内二次确认生效（渲染已有，补运行时判定） | `26` §2（interact 行②）；`interact/src/hitl.ts:38/:40`；`interact/src/card.ts:220-227`（第二问已有）；`interact/src/presets.ts:17-20`（「由组合层执行」）；`33` G2-E4 | `packages/interact/tests/escalation.spec.ts`（冷静期/双确认 describe 块） | 与 E4 同文件同批 |
| **E6** | on_no_answer 运行时接线 | 无人值守按三策略分派：suspend（暂停非失败、replay 可恢复）/ escalate / fail | `interact/src/types.ts:19-20`（语义原文）；`24` §4（G2 行「超时=unavailable」）；`33` G2-E4（判据原文「暂停非失败、replay 可恢复」） | `packages/interact/tests/escalation.spec.ts`（on_no_answer describe 块） | 与 E4 同批；挂起物归口见 §9-4 |
| **E7** | Outbox reply 出站 + 报告六态渲染 | `reply` 投递器换 channels 适配器（结果回到发起渠道）；`cards.ts` 增加六态渲染 | `26` §2（channels 行④）；`34` §5-channels（cards 行）+ §2.3（outbox 行「`sources.send` 换 channels」）；`24` §5.2（Outbox 行）+ §2.3（机制 5 六态枚举） | `packages/channels/tests/cards.spec.ts`（扩六态渲染用例）+ `packages/tasks/tests/outbox.spec.ts`（对端＝34 §4-C 判据「投递端换 channels 桩」） | WS-A Outbox（桩先行） |
| **E8** | 形态挂载 + 装卸无残留 | glue 新增两插件并提供服务；挂载行进 profile；TOGGLEABLE 登记；卸载无残留 | `26` §2（channels 行①「生产 profile 正式挂载」）；`33` G2-E6 + §1.2 G1-2；`docs/PLUGIN-AUTHORING.md:36`（插件可缺席，经 `33` G2-B9 引用） | 扩展 `scripts/verify-governance-e2e.mjs`（super profile 参数）+ `grep -icE "skipping\|incompatible" <log>` 输出 0（G2-E6 原命令）；`node scripts/verify-eterna-super.mjs`（G1-2，待建） | G1-2 脚本（WS-A 启动时交付） |

> 里程碑归属：E1–E8 全部挂 **M4**（`33` §1.3 WS-E 表「所属里程碑」列原文均为 M4）；端到端真跑判据见 `33` G3-M4 ③（「escalate/冷静期/双确认至少各一次真实路径」）。

---

## 3. 实现规格

### E1 binding 升级 thread / ticket

**语义（全部来自设计原文，不增不减）**：

- 「binding 从 `channel_user → session` **升级为** `→ thread / ticket`」（`24` §5.2 Source 行）；`34` §5 措辞为「**增补**」——据此实现取**增补**语义：保留 `session_id` 列与现行全部行为（`binding.ts` 现有 49 用例不回归），新增目标维度。
- 「多渠道收敛同一身份 → 同一 thread/ticket → 线程串行化 + 批量合并」（`27` §3.3 情况 A）。收敛表达沿用现行机制——**多行指向同一目标**（`binding.ts:10-11` 头注：多渠道身份可指向同一 session_id），不做跨源身份映射（`24` §2.2 被拒概念）。串行化与批量合并是 tasks Engine 侧行为（`27` §3.2-①/情况 A 末列），channels 侧只负责「收敛到同一 thread」这一步。
- 「同一线程同时只跑一个 Eval」「追问可恢复已结束工单」（`27` §3.1/§1.2；`24` §5.5 R5「保留讨论可恢复已结束工单」）——对 binding 的含义：thread 绑定**不因工单结束而解绑**（后续追问仍路由到该 thread）。实现为：绑定只有显式 re-bind/unbind 才变化（现行 upsert 语义保持）。

**落点**：`packages/channels/src/binding.ts`。

- `channel_bindings` 表增列 `thread_key TEXT`、`ticket_id TEXT`（均可空；migration 幂等 `ALTER TABLE … ADD COLUMN` 需带存在性检查——`CREATE TABLE IF NOT EXISTS` 对已建库不补列）；新增索引 `idx_channel_bindings_thread ON channel_bindings(thread_key)`（对称现行 `session_id` 索引，`binding.ts:43`）。
- 方法增补（与现行 `bind`/`bindIfAbsent`/`resolveSession`/`sessionBindings` 同构，`binding.ts:85-122`）：`bindThread(channelType, channelUserId, threadKey)`（upsert，移绑续接语义同现行）、`resolveThread(channelType, channelUserId): { threadKey?: string; ticketId?: string; sessionId?: string }`、`threadBindings(threadKey)`（收敛度查询，对称 `sessionBindings`）。`bind` 原签名不动（session 维度照旧可用）。
- `ChannelBindingRecord` 增对应可选字段；`asDomainKvTable()` 的 put 校验同步扩展（`binding.ts:186-196`「记录与键不一致」检查）。
- `thread_key` 的键形态：设计未定（`34` §3 `ThreadRef` 是 tasks 侧类型，包未落地）→ 本任务先以**不透明字符串**承载（channels 不解释其内部结构），具体形态进 §9 开放问题 3。

**验收（G2-E2 判据原文：「binding 从 `channel_user → session` 升级为 `→ thread / ticket`；多渠道同一用户收敛同一 thread」）**：`packages/channels/tests/binding.spec.ts` 扩用例——① 飞书+webhook 两渠道身份 bindThread 同一 thread_key 后 `threadBindings` 返回两行（情况 A 收敛断言）；② 同身份 re-bind 新 thread 返回 `previousThreadKey`（移绑续接）；③ 旧 session 行为不回归（既有用例原样保留）。

### E2 Source 统一接收面 + 扩展钩子

**语义**：

- 「channels 是统一接收面，tasks 只实现 Source 适配端口（A5 拍板：channels 统一接收面 + Source 扩展钩子）」（`34` §0 不做清单；`24a` A5）。channels 侧承担**注册面**（`34` §4-F「注册面由 channels 侧承担」）。
- 归一化目标＝Trigger（幂等 id 从事件内容派生；`channel_user` 收敛身份＝情况 A 归一化防线）（`34` §2.5 channel-adapter 行）。
- 扩展钩子保留 PR 生命周期绑定类：「GitHub PR merge→`threadClosed`」（`34` §2.5；对端契约 `34` §3 `EngineForSources.bindThread/bindThreadClosed`——原文 `bindThread(ticketId, thread, own)` / `threadClosed(thread, outcome, at)`）。
- WebChat 兼容面：「WebChat Source 协议保持与 Trigger 接口兼容（未来接入是配置工作）」（`29` §6 chat-demo 行，B4 拍板）。

**落点**：`packages/channels/src/source.ts`（新建）+ `src/index.ts` 导出。

- 本地最小端口 `TriggerSink`（结构面对齐 `34` §3 EngineForSources 的三个方法签名，仅取 channels 侧所需的调用面）：`receive(trigger: { id: string; channelType: ChannelType; channelUserId: string; text: string; occurredAt: string; threadKey?: string }): 'stored' | 'duplicate' | 'filtered'`；`bindThread(ticketId, threadKey, own): unknown`；`threadClosed(threadKey, outcome: 'merged' | 'closed', at: string): void`。幂等 id 的**派生算法**归 tasks（`34` §2.1 ids 行「内容派生稳定 id」），channels 只透传事件内容并回传三态。
- `createSourceRegistry()`：Source kind 注册表（唯一 ID 形态，对齐 `createAdapterRegistry` 先例 `types.ts:102-120`：ID 冲突抛错）；每 kind 声明 `channelType` 与归一化函数（`InboundMessage` → 上述 trigger 载荷）。内置 `webhook` kind 一个（E3 消费）；PR 生命周期类（如 `github-pr`）作为**钩子样例**仅注册归一化到 `bindThread/threadClosed` 的转发，不做 GitHub 拉取（渠道读取归 channels 包已有测试范围之外，`34` §4-F 不承接 github-read）。
- `ChannelsService` 增 `sources` 成员（`index.ts:73-89` 服务面扩展），close 配逆不变。

**验收（G2-E7 判据原文：「新事件源以 Source kind 扩展钩子接入（含 PR 生命周期绑定类），事件归一化为 Trigger 后进 tasks；扩展钩子注册与归一化路径有测试」）**：`packages/channels/tests/source-registry.spec.ts`——① 注册/ID 冲突；② webhook kind 归一化（信封→trigger 载荷，`channel_user` 透传）；③ PR 钩子路径（merge 事件→`threadClosed(threadKey,'merged',at)` 调用断言）；④ TriggerSink 桩返回 `duplicate` 时注册面原样透传（情况 C 的 channels 半边）。

### E3 webhook 网关挂载 + Trigger 幂等

**语义**：

- 「`webhook.ts`/`token.ts`：外部事件入口 → `channel-adapter.ts` 归一化为 Trigger（幂等 id）」（`34` §5-channels）；「重复投递（重试/重放）经幂等键收敛为一单（`Engine.receive → duplicate`）」（`33` G2-E3）。
- 验签/路由/状态码契约**不变**：HMAC timing-safe（`webhook.ts:79-91`）、401 invalid-signature、404 unknown-channel/unknown-binding、410 already-used、413 payload-too-large（现行 `webhook.ts:145-228` 全保留——12 号 §7.4/§7.7 契约）。
- message 分支投递目标从「`resolveSession` → `sessionPort.deliverInbound`」改为「`resolveThread` → source 归一化 → `TriggerSink.receive`」；**session 旧路径去留设计未明文**（`34` §5 只说入口归一化为 Trigger）→ 实现取「thread 优先、无 thread 绑定回退 session 投递」，回退语义 = 现行行为不回归；最终去留进 §9 开放问题 6。
- 投递应答：`receive` 三态映射 HTTP 202 `{accepted, disposition}`（disposition ∈ stored/duplicate/filtered 透传，供上游回调方观测幂等命中）；重复投递**不产生第二次投递副作用**（幂等归 tasks，channels 断言＝不重复调 sink 的副作用面——以桩计数断言）。

**验收（G2-E3）**：`packages/channels/tests/webhook.spec.ts` 扩用例——① message 信封带 thread 绑定时走 TriggerSink（桩）且 202 disposition=stored；② 同 messageId 重放第二次 disposition=duplicate 且 sink 副作用计数不增；③ 无 thread 绑定回退 sessionPort（现行用例不回归）；④ 验签失败仍 401（既有）。tasks 侧 `packages/tasks/tests/idempotency.spec.ts` 归 WS-A（对端＝34 §4-F `channel-adapter.spec.ts` 行验收判据「channels 事件→Trigger 归一化、scope 过滤 filtered、幂等 id 派生（27 号情况 C）」），本任务不写。

### E4 escalate 运行时接线

**语义**：

- 「`escalate_to`……升级给指定人（channels 消费）」（`interact/src/hitl.ts:36` 注释原文）；「`on_no_answer: escalate`＝升级 channels」（`types.ts:19-20`）；「超时正确升级」（`33` G2-E4 判据原文）。
- 原 P0 项「escalate 接 channels」「审批 100% 可在飞书闭环」的债务在本工作流溶解（`32` §3；`24` §6 P0 行——组织方式已被 32 号取代，工作内容有效）。
- 出站形态＝channels 审批卡：`ApprovalActionPayload` 契约（approve/reject 各一枚一次性令牌；`cards.ts:51-80` 强制装配）。邮件路径只认令牌链接，**禁止正文「同意」放行**（12 号 §7.7；`email.ts` 契约）。
- 一渠道应答后作废其余渠道令牌：`tokens.revokeAll(approvalRequestId)`（`token.ts:169-173` 头注语义「审批已在其他渠道应答时……防邮件令牌迟点再点复活已结束的审批」）。
- **升级不并发**纪律：「interact 提问合并已有，补『升级不并发』纪律」（`24` §8.1-3 采纳条目原文；`26` §2 interact 行③同）——同一挂起审批在 escalate 出站后不得再发常规 ask 卡（同一 approvalRequestId 至多一条在途出站问询）。
- 一次性授权语义不变：approve＝allowed-once（`approval-bridge.ts:115-116`；`card.ts:203` 按钮描述「本次允许，不产生持久授权」）。
- embed 档：「Attention 经 channels/API 出」（`24a` B3）——本任务提供 channels 出站面即其承载，不另建 API（API 面归 WS-A 的任务层）。

**落点**：`packages/interact/src/escalation.ts`（新建）+ glue 侧插件（E8）。

- `EscalationRuntime`（实例态挂 createInteract 产物或独立工厂，Cordis 纪律同 `index.ts:92-114`——纯对象 + 显式配逆）：
  - `escalate(card: ApprovalCard, targets: readonly string[]): Promise<EscalationOutcome>`——按 `card.r3.escalateTo`（`hitl.ts` 解析产物经 `card.ts:177` 透传）或调用方注入的 targets 出站；出站经注入的 `CardTransport`/`ChannelAdapter`（`types.ts:88-93`），不真连（传输注入，`cards.ts:10-11` 先例）。
  - 令牌签发：`ApprovalTokenService.issuePair`（`token.ts:131-140`）；`approvalBaseUrl` 拼 `/approval/:token`（`cards.ts:42-45`）。
  - 应答回收：复用 webhook `/approval/:token` 与 `approval_click` 信封路径（`webhook.ts:198-212`、`:230-244`），应答后 `revokeAll`。
  - 升级不并发：以 approvalRequestId 为键的在途去重（进程内 Set + 显式清理；不落业务台账——台账归口见 §9-4）。
- **寻址格式**：`escalateTo` 字符串如何解析为渠道 recipient（适配器 `sendCard(card, recipient)` 第二参）**设计未定**（`30` §7-3 审批人角色在 WS-C 未落地）→ 本任务以注入的 `resolveRecipient(target: string): string | undefined` 端口承载，缺省实现＝原样透传；裁决进 §9 开放问题 2。

**验收（G2-E4「超时正确升级」）**：`packages/interact/tests/escalation.spec.ts`——① R3 规则命中且 `onNoAnswer='escalate'`：注入假时钟推进超时 → 恰一次出站升级卡（载荷含双令牌）；② 同 approvalRequestId 二次 escalate 被去重（升级不并发）；③ 令牌 redeemed 后 `pendingCount` 归零且 `revokeAll` 清余票；④ `token.spec.ts` 既有防重放/双花用例不回归（G2-E5）。

### E5 冷静期 + 双确认运行时接线

**语义**：

- 「R3 条目可配……冷静期（cooling_period_sec）、二次确认（double_confirm）」（`interact/src/hitl.ts:5-6` 头注）；「R3 的升级/冷静期/二次确认无法进预设，由本包 card.ts 的 R3 附加卡片字段与**组合层执行**」（`presets.ts:17-20`）——本任务就是那个「组合层执行」。
- 判据原文：「R3 冷静期内二次确认生效」（`33` G2-E4）。渲染面已定：doubleConfirm＝同卡第二问（`card.ts:220-227`），「同卡 ≤3 问上限由 ask.ts 兜底」（`card.ts:195`）。
- 审批协议不改：「审批应答仍走内核 approval waterfall，本包不改协议」（`card.ts:15`）——运行时判定＝在应答回收处（E4 的应答路径）校验：`doubleConfirm` 为真的卡，两问（`approve:<ruleId>` 与 `approve:<ruleId>:confirm`）**均须 approve** 才放行为 allowed-once；任一 reject 即 rejected。第二问的 id 路由由 user-questions 官方机制承载（`ask.ts:6-8` 头注：DSH 要求 answer 按 id 回路由）。
- 冷静期：`coolingPeriodSec > 0` 时，approve 应答的**生效时刻**不早于 `签发时刻 + coolingPeriodSec`（`card.ts:195` 注释「冷静期后的复核确认」——第二问即复核，故冷静期与第二问天然同卡）。生效前的等待不属于超时（不计入 `ETERNA_TOOL_APPROVAL_TIMEOUT_MS` 的 unavailable 判定）还是共享同一超时——**设计未明文**，实现取「冷静期窗口冻结超时计时」（否则 300s 桥超时会先于较长冷静期触发 unavailable，使配置形同虚设），该取舍标注为**实现裁量**并进 §9 开放问题 5。

**落点**：`packages/interact/src/escalation.ts`（与 E4 同文件）：`confirmGate(card, answers, now): 'allow-once' | 'reject' | 'await-cooling'` 纯函数 + 假时钟注入。

**验收（G2-E4「R3 冷静期内二次确认生效」）**：`escalation.spec.ts`——① `doubleConfirm` 卡只有主问 approve、第二问未答 → 不生效；② 两问均 approve 且 `now - issuedAt ≥ coolingPeriodSec` → allowed-once；③ 两问均 approve 但仍在冷静期 → `await-cooling`，推进假时钟后放行；④ 任一 reject → rejected；⑤ `doubleConfirm=false` 的 R3 卡单问即决（现行行为）。

### E6 on_no_answer 运行时接线

**语义**：

- 三策略原文：「挂起(任务暂停非失败) / 升级 channels / 失败」（`types.ts:19-20`）；G2-E4 判据原文：「无人值守按 `on_no_answer` 挂起（暂停非失败、replay 可恢复）」。
- 触发面＝ask 不可达/无人应答的终局：现行宿主事实是 approval-bridge 超时→`'unavailable'`（`approval-bridge.ts:14-15`、`:160-166`；缺省 300s）。本任务＝在 `unavailable` 终局处按命中规则的 `onNoAnswer` 分派：
  - `suspend`：任务暂停非失败——**不产出** denied/rejected；语义锚点「approval 事件已持久，replay 即恢复」（`packs/event-planning/hitl.yaml:7` 注释同源）。挂起**登记的归口**：interact 不拥有业务状态（`24` §5.3-5「横切插件不拥有业务状态，只挂断点」；`32` §3「Attention 台账（waitsForPerson / followupOwners）→ WS-A：直接在 tasks 最终形态内实现，不建临时物」）→ 本任务只发 `onSuspended` 事件（进程内总线，负信号总线同构 `negative.ts:54-60`），由 tasks/组合层登记；tasks 未落地期间消费者缺席＝挂起仅表现为「不失败、待恢复」，**不建临时台账**（`32` §1-3「不建任何临时物」）。归口裁决进 §9 开放问题 4。
  - `escalate`：转 E4 出站（升级行为与去重纪律继承）。
  - `fail`：以 denied 收场（reason 引用规则 id；对齐内核「ask 无 approval 服务→deny」的 fail-closed 方向，`governance-plugin.ts:26-29` 引 pipeline serviceAsk 语义）——**不发布负信号**（`negative.ts:12-13`：unavailable 不是用户否定）。
- 词表沿用：不得出现桥词表之外的第三种「用户拒绝」表述（`approval-bridge.ts:14-15`「不冒充用户拒绝」）。

**落点**：`escalation.ts` 的 `dispatchNoAnswer(rule, outcome: 'unavailable'): 'suspended' | 'escalated' | 'failed'` + 事件发布。

**验收（G2-E4）**：`escalation.spec.ts`——① 规则 `on_no_answer: suspend` + 桥超时 unavailable → 分派 suspended、无 denied/无负信号、`onSuspended` 事件恰一次；② `escalate` → 转出站（E4 断言复用）；③ `fail` → denied 且 reasons 引用规则 id；④ 全局缺省 `'suspend'`（`hitl.ts:120`）与逐条覆盖（`hitl.ts:234`）两级行为对齐。

### E7 Outbox reply 出站 + 报告六态渲染

**语义**：

- 「Outbox `reply` 投递器经 channels 适配器出站（结果回到发起渠道）」（`34` §5-channels webhook/token 行；`24` §5.2 Outbox 行「持久副作用队列照搬设计」；`24` §7.3 T+20min「Outbox 把结果（文件 + 摘要卡）发回原群」）。
- 「`cards.ts` 增加报告六态渲染」（`26` §2 channels 行④原文）。六态枚举＝`progress / waiting / ready / blocked / failed / dropped`（`24` §2.3 机制 5）。
- Outbox 消息的四种 purpose：`ack / answer / result / attention`（`34` §2.1 replies 行，SA 实测承接）。渲染映射（实现细化，锚点如上）：`attention` → `kind:'approval'`（载荷契约同 E4）；`ack/answer/result` → `kind:'delivery'`（现行枚举 `types.ts:71` 已有 approval/progress/delivery 三值，**不扩枚举**）；工单 Report 六态进 `metadata` 与文案。
- 「进度不进 IM」＋「面板只列待人项」（`24` §7.6 过度打扰对策）× replies 四 purpose 无 progress purpose（`34` §2.1）⇒ 六态中 working 类中间态**不产生出站卡**；出站只发生在 purpose 存在时（`ready/blocked/failed` 等终/卡态经 result/attention 卡承载文案）。此为实现细化，两前提均系已拍板事实。
- 出站降级：「channelIgnored/channelGone 落 dropped」（`34` §4-C outbox 验收判据原文）——channels 侧提供投递错误的分类面（适配器抛错归类），落 dropped 的记账在 tasks 侧。

**落点**：`packages/channels/src/cards.ts` 增 `renderReportLines(state, summary): string`（六态 → 中文文案行，进卡片 body；文案仅描述状态不加设计外语义）+ 投递错误分类 `classifyDeliveryFailure(error): 'channelIgnored' | 'channelGone' | 'transient'`。

**验收**：`packages/channels/tests/cards.spec.ts` 扩用例——① 六态逐态渲染断言（枚举与 `24` §2.3-5 逐一对应）；② attention purpose 组卡走 approval 载荷强校验（`validateOutboundCard` 既有路径）；③ 错误分类三分支。tasks 侧 `outbox.spec.ts`（回执幂等/behind 排队/dropped）归 WS-A。

### E8 形态挂载 + 装卸无残留

**语义**：

- 「channels ①生产 profile 正式挂载」（`26` §2 channels 行①）；super 挂载面含 channels（`33` §1.2 G1-2「tasks/channels/workbench/toolkit 挂载行 active」；G2-E6「super 挂载面（tasks+channels）」）。**两处口径是否意指 base 亦挂 channels 未明文**（`26` 说「生产 profile」未分形态；Tier 归属上 channels/interact 是现有包，非 33 G0-6 注记的 Tier2=tasks/workbench）→ 挂载面先落 super 形态（G1-2/G2-E6 的明确口径），base 是否挂载进 §9 开放问题 7。
- 插件可缺席纪律：TOGGLEABLE 登记 + 停用后渲染裁剪（`docs/PLUGIN-AUTHORING.md:36`，经 `33` G2-B9 引用；先例 `profiles/eterna-web/cordis.patch.yml:484-485` prompt-studio 注释）。红线不动：governance/audit/egress/access 不可停（`routes.ts:50-54`）；channels/interact 非红线，可登记可停。
- 装卸无残留判据（G2-E6 原文）：「卸载后无新增 tool-call 记录、审计投影在场/缺席各断言一次、宿主日志 `skipping\|incompatible` 计数 0」。
- 装配形态（governance-plugin 先例，`governance-plugin.ts:89-158`）：`packages/glue/src/plugins/interact-plugin.ts`（provide `ctx.interact`＝createInteract 产物，hitl.yaml 装载 + escalation 运行时挂 approval 终局）与 `channels-plugin.ts`（provide `ctx.channels`＝createChannelsService + startWebhookGateway 的 close 进配逆）；两者均返回配逆闭包。dbPath 遵循 DSH_HOME 语义下的 `.eterna/` 缺省约定（多租户铁律，`AGENTS.md:17-21`；对齐 memory admin 先例 `profiles/eterna-web/cordis.patch.yml:517-519`「sqlite/overrides 走 cwd/.eterna 缺省约定」）。

**验收（G2-E6 原命令）**：扩展 `scripts/verify-governance-e2e.mjs`（super profile 参数）+ `grep -icE "skipping\|incompatible" <log>` 输出 0；`node scripts/verify-eterna-super.mjs`（G1-2 待建后并入）；`grep "eterna-channels\|eterna-interact" packages/access/src/routes.ts` 有输出（TOGGLEABLE 登记，G2-B9 同款判据形态）。

---

## 4. 配置面

**不新增配置键**（如实声明）：escalate 目标、冷静期秒数、二次确认、三策略全部来自 hitl.yaml 既有声明（`hitl.ts:65-71` 键集，不扩键）；审批超时沿用 `ETERNA_TOOL_APPROVAL_TIMEOUT_MS`（`approval-bridge.ts:182-185`）；webhook 密钥表沿用 `WebhookSecretTable`（`webhook.ts:29`）；令牌 TTL 沿用 `defaultTtlMs`（`token.ts:89`）。冷静期与超时的时序关系是实现裁量（§3-E5），不落新键。

---

## 5. 交互细节对照表（E4/E5/E6/E7 涉交互面；E1-E3 为数据/网关层，不附）

> 范围声明：本表只列 24/26/27/28/29/30 号已拍板的交互细节；「实现位置」标注现状代码或本任务落点。渠道卡片（飞书/钉钉/邮件/微信）在**外部 IM** 渲染——30 号 §4 的断点/a11y/主题条款约束的是本仓 UI 面，对外部 IM 卡片不适用（各按平台卡片规范，渲染器已存在 `cards.ts:101+`）；站内形态（横幅/面板）归 WS-D 原型（`30` §5-2），本组任务不建站内 UI。

| # | 已拍板交互细节（要点） | 出处 | 实现位置 |
|---|---|---|---|
| 1 | Attention 卡三形态：站内横幅 + 飞书卡片 + 邮件链接；批/拒/要求改 | 24 §7.2（审批人行） | 渠道形态：E4 出站（cards.ts 渲染器 + token 链接）；站内横幅：WS-D（30 §5-2 原型），本组不建 |
| 2 | Attention 卡两形态：站内横幅 + 渠道卡片（原型先行清单第 2 件） | 30 §5（首批原型清单 2） | 同上；渠道半边本组交付、站内半边待原型评审后由 WS-D 施工 |
| 3 | 一次只问一个具体的结构化问题；Attention 场景取严单问 | 24 §2.1（行为律 3）；34 §5-interact（「两者取严：Attention 场景单问」） | E4 出站卡单问（cardToQuestionItems 主问，`card.ts:206-218`）；一般提问合并 ask.ts 既有 |
| 4 | 升级不并发（提问合并已有，补「升级不并发」纪律） | 24 §8.1（采纳 3）；26 §2（interact 行③） | E4 `escalation.ts` 在途去重（§3-E4） |
| 5 | 进度不进 IM；面板只列待人项；面板只显示需要人的东西（健康态不占版面） | 24 §7.6（过度打扰对策）；30 §1 | E7 出站判定（§3-E7：无 progress purpose ⇒ 中间态不出站）；面板侧归 WS-D |
| 6 | 审批按钮文案与语义：「允许执行一次」（描述「本次允许，不产生持久授权(EternaAgent 仅一次性授权)」）/「拒绝」（描述「拒绝该动作并停止执行」） | interact 既有拍板面（08 §6.2 富卡，`card.ts:199-205`） | E4 出站卡动作 label 沿用同源文案（CardActionInput.label ← cardToQuestionItems 同源） |
| 7 | R3 二次确认第二问：文案「二次确认:已知悉影响面与回滚性,仍要执行该高危动作?」、header「R3 二次确认」 | `card.ts:220-227`（渲染既有） | E5 运行时校验两问一致（§3-E5） |
| 8 | R3 附加控制三行展示：升级给 X、冷静期 N 秒、二次确认 需要/不需要 | `card.ts:266-271`（renderedDetail 既有） | 渲染已有；E4/E5 保证声明值与运行时行为一致 |
| 9 | 超时语义：unavailable＝「无可用审批渠道」，模型可自纠，不冒充「用户拒绝」 | `approval-bridge.ts:14-15`（先例）；24 §4 G2 行（「超时=unavailable」） | E6 分派器词表沿用（§3-E6） |
| 10 | 邮件审批禁止解析正文「同意」字样放行；只认一次性令牌链接； redeemed 后 410 | 12 §7.7（`email.ts`/`token.ts`/`webhook.ts:230-244` 契约既有） | E4 邮件升级路径继承，零改动 |
| 11 | 结果回到发起渠道（Outbox 把结果发回原群；T+21min 追问无需再 @agent） | 24 §5.2（Outbox 行）；24 §7.3（端到端叙事） | E7 reply 投递器按绑定渠道选适配器 + E1 thread 绑定保持（不解绑） |
| 11a | 同一用户多渠道同时追问（Web + 飞书）：多渠道收敛到同一身份 → 同一 thread/ticket → 线程串行化 + 批量合并——用户观感＝「不管从哪问，接的是同一件事」 | 27 §3.3（情况 A 全行） | E1 收敛断言（binding.spec.ts 多行同 thread 用例）；串行化/合并为 tasks 侧行为（WS-A） |
| 11b | WebChat Source 协议保持与 Trigger 接口兼容——未来 WebChat 入口接入是配置工作，不是改造 | 29 §6（chat-demo 行，B4 拍板） | E2 归一化载荷以 Trigger 兼容面定义（TriggerSink 端口不绑定 webhook 特有字段） |
| 12 | 报告六态词汇：progress/waiting/ready/blocked/failed/dropped；「半成品标为半成品，失败报为失败」 | 24 §2.3（机制 5）；24 §2.1（行为律 5） | E7 六态渲染文案（`renderReportLines`） |
| 13 | 降级态：channelIgnored/channelGone 落 dropped；webhook 404 unknown-binding / 410 already-used / 401 invalid-signature | 34 §4-C（outbox 判据）；`webhook.ts` 既有状态码 | E7 错误分类 + E3 状态码保留 |
| 14 | 审批人可见性：审批人见全租户待人项；普通用户仅自己的（新角色） | 30 §7-3（Q3 拍板） | 角色机制归 WS-C；E4 出站 targets 的解析端口预留对接（§9-2） |
| 15 | 「等谁」可见化（活跃工单清单一行一单：id+阶段+等谁，如「T-9c81 …｜person/answer｜等你回答(Attention #12，已 4h)」） | 28 §6 | 数据面归 WS-A（tasks 谓词 waitsForPerson）；E6 的 onSuspended 事件为其可读信号源之一（归口 §9-4） |
| 16 | 中文 UI（用户面文字一律中文） | AGENTS.md:28；30 §4-3 | 出站卡 renderedDetail/六态文案均中文（`card.ts` 既有风格延续） |
| 17 | 深浅双主题 / `--et-*` 令牌 / 断点 1100/760/640 / a11y（语义标题、focus 光圈、prefers-reduced-motion）/ 双主题截图进 PR | 30 §4（铁律 2-5）；AGENTS.md:10-15 | **适用边界**：仅约束本仓 UI 面（WS-D/站内）；外部 IM 渠道卡片不适用（见范围声明）；本组无新增本仓 UI |
| 18 | 原型先行铁律（设计 skill 出原型→评审→严格按图开发；PR 附双主题截图对照） | 30 §5（流程）；24a 新增范围 2 | 渠道结果卡文案形态若需视觉设计，是否纳入原型先行待确认（§9-9） |

---

## 6. 门禁与测试命令总表

| 门禁 | 命令 / 测试文件 | 判据 | 状态 |
|---|---|---|---|
| G2-E1 包级 verify | `pnpm --filter @eterna/channels run verify && pnpm --filter @eterna/interact run verify` | 退出码 0 | **基线已实测绿**（49+55 用例，§1.4）；每任务收口重跑 |
| G2-E2 binding 升级 | `packages/channels/tests/binding.spec.ts`（扩） | 多渠道同一用户收敛同一 thread（27 §3.3-A） | 待建（E1） |
| G2-E3 webhook + 幂等 | `packages/channels/tests/webhook.spec.ts`（扩）+ `packages/tasks/tests/idempotency.spec.ts` | 重复投递经幂等键收敛为一单 | 前者待建（E3）；后者归 WS-A |
| G2-E4 escalate/冷静期/双确认/on_no_answer | `packages/interact/tests/escalation.spec.ts`（新建） | 超时正确升级、R3 冷静期内二次确认生效、无人值守按 on_no_answer 挂起（暂停非失败、replay 可恢复） | 待建（E4/E5/E6） |
| G2-E5 令牌防伪造 | `packages/channels/tests/token.spec.ts` | 双花/重放/邮件正文「同意」不放行不回归 | 既有（本接线不得回归） |
| G2-E6 装卸无残留 | `node scripts/verify-governance-e2e.mjs`（super 参数扩展）+ `grep -icE "skipping\|incompatible" <log>` | 卸载后无新增 tool-call、审计投影在场/缺席各一次、计数 0 | 待建（E8） |
| G2-E7 Source 统一接收面 | `packages/channels/tests/source-registry.spec.ts`（新建） | kind 注册 + 归一化 + PR 钩子路径有测试 | 待建（E2） |
| G1-2 super boot | `node scripts/verify-eterna-super.mjs` | 33 §1.2 原文 | **脚本待建**（WS-A 启动时交付，33 G2-A11） |
| 六态渲染（E7 附加） | `packages/channels/tests/cards.spec.ts`（扩） | 六态逐态渲染 + attention 组卡强校验 + 错误分类 | 待建（E7；判据锚 26 §2 channels④） |
| 里程碑收口 | `33` G3-M4 ③ | escalate/冷静期/双确认**至少各一次真实路径** | M4 时点执行 |

全仓门禁（`pnpm -w run verify`、packctl lint）按 `22` 号先例在冲突 gate 后执行；本工作流不动 memory/governance 源，预期无 gate 冲突。

---

## 7. workflow 编排规格（脚本蓝图）

| # | Phase | 内容 | 步骤与门禁 |
|---|---|---|---|
| 1 | 开工前置确认 | 核对 §9 开放问题 1/2/5 是否已由设计侧裁决（hitl 键形、escalate 寻址、冷静期时序）——未裁决则按 §3 标注的实现裁量推进并在 PR 说明留痕 | 记录裁决/裁量进 PR |
| 2 | 无对端先行批 | E1（binding）→ E5/E6 纯函数面（confirmGate/dispatchNoAnswer，桩驱动）→ E4（escalation.ts，传输桩） | 每任务：实现 → `pnpm --filter @eterna/{channels,interact} run verify` → 修复循环 ≤3 轮 |
| 3 | 挂载批 | E8 glue 两插件 + profile 行 + TOGGLEABLE 登记（依赖 G1-2 脚本就绪；未就绪则先交脚本缺口给 WS-A） | G2-E1 + G2-E6 |
| 4 | 对端合拢批 | WS-A Trigger 协议就绪后：E2（source registry 实装 TriggerSink 对端）→ E3（webhook 投递切换）→ E7（Outbox 出站 + 六态） | G2-E7 / G2-E3 / cards 扩用例 |
| 5 | M4 收口 | G2-E1–E7 全绿 + G3-M4 ③ 真实路径演示 | 33 §1.4 G3-M4 |

依赖红线（`32` §2）：E2/E3/E7 的**对端合拢**不得先于 WS-A Trigger 协议；先行批（桩）不受限。

---

## 8. 与既有文档的关系

```
24 §5.2（Source/Attention/Outbox 映射）──本文 E1/E4-E7 的语义源头
27 §3.3（情况 A 防线）──E1 的验收语义；§3.3-C 幂等──E3
26 §2（interact/channels 中改四条）──任务清单的直接来源（①→E8 ②→E4-E6 ③→E2/E3 ④→E7）
32 §2/§3（WS-E 定义与 P0 溶解）──本文即 WS-E 的实施文档
33 §1.3 WS-E（G2-E1–E7）+ §1.2 G1-2 + G3-M4──门禁列的唯一事实源
34 §3/§5（EngineForSources 与接线点）──对端契约（tasks 草案）
interact/src/hitl.ts 声明面──E4-E6 缝合对象的精确字段
24a A5/B3──E2 扩展钩子与 embed 档出路口径
```

本文不改变任何既有拍板；`32` §2 的 WS-E 内容全覆盖，无删减。

---

## 9. 开放问题（设计缺口，如实记录；不自行补设计）

1. **hitl.yaml 键形分裂**：`packs/*/hitl.yaml` 用 `industry/escalation_contact/risk/match.tools`（`packs/event-planning/hitl.yaml:1-6`、`tools/packctl/src/init.ts:227`），`HitlPolicy` 校验 `pack/default_grade/grade/tools/escalate_to/cooling_period_sec/double_confirm`（`hitl.ts:66-70`）；两形不兼容且 `escalation_contact` 无消费者。E4-E6 的数据源以哪个为准、是否需要迁移脚本或双形适配，需设计裁决。
2. **escalate_to 寻址格式**：字符串目标如何解析为渠道 recipient / access 用户 / 审批人角色（30 §7-3，WS-C）未见设计；本文以 `resolveRecipient` 端口悬置。
3. **thread_key 键形态**：与 34 §3 `ThreadRef` 的对应关系（渠道侧线程标识 → tasks ThreadRef 的映射规则）未定义；本文先以不透明字符串承载。
4. **suspend 挂起物归口**：`32` §3 把 Attention 台账归 WS-A「不建临时物」，但 tasks 未落地期间 `on_no_answer: suspend` 的载体与 replay 恢复路径由谁承载、E6 的 `onSuspended` 事件是否即最终接口，需与 WS-A 对齐（关联 28 §6「等谁」数据面）。
5. **冷静期 × 审批超时 × 令牌 TTL 时序**：三时钟（cooling_period_sec 可配任意正整数 / 桥超时缺省 300s / 令牌 TTL 缺省 30min）的优先序与「冷静期内首答缓存还是作废」无拍板；本文实现裁量＝冷静期窗口冻结超时计时（§3-E5），需确认。
6. **webhook session 旧路径去留**：binding「增补」thread/ticket 后，无 thread 绑定的 message 是否保留 session 投递回退（本文实现了回退），还是强制要求先建 thread——`34` §5 未明文。
7. **channels 挂载形态归属**：`26` §2 说「生产 profile 正式挂载」（未分形态）；`33` §1.2 G1-2 与 G2-E6 把 channels 挂载行归 super 挂载面；Tier 真值（33 G0-6：Tier2=tasks/workbench）下 channels 为 Tier1。base 形态是否挂载 channels 待裁决（影响 E8 的 patch 落点与 B3「embed 档 Attention 经 channels/API 出」的实现路径）。
8. **Outbox 回执归属**（承接 34 §6-7 原文）：receipts 留 tasks 租户库还是 channels 统一回执面——E7 合拢前需裁决，避免双账。
9. **渠道结果卡是否纳入原型先行**：30 §5 原型清单不含渠道端结果/摘要卡；六态渲染若涉视觉形态，是否触发「前端原型先行铁律」（24a 新增范围 2 / 30 §5）待确认（本文 E7 仅做文字行渲染，回避该问题）。
