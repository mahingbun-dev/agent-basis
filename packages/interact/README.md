# @eterna/interact

L1 人机交互质量插件(设计文档 08 §6、12 §3、14 号 T3):hitl.yaml 风险分档、R0-R3→DSH
permission-presets 配置产物、富上下文审批卡片、同 turn 提问合并(≤3 问/卡)、审批负信号事件。
本包是**策略纯函数层**——不触碰 Cordis ctx 全局;组合层把 `createInteract()` 的产物以
`ctx.interact` 服务(注册表 + `INTERACT_SERVICE_ID` 唯一 ID)形态 provide,可交换;
配逆 = `disposeInteract()`(flush 未发提问卡 + 清空负信号快照)。

## 模块

| 模块 | 入口 | 职责 | DSH seam |
|---|---|---|---|
| hitl 分档 | `src/hitl.ts` | hitl.yaml 加载与校验:R0 只读/R1 可逆写/R2 需确认/R3 高危;`on_no_answer` 挂起策略(suspend/escalate/fail,全局缺省+逐条覆盖);R3 专属 escalate_to/cooling_period_sec/double_confirm;裁决=命中规则**最高档**优先、未命中回落 default_grade | 规则数据源,执行在内核/governance |
| 预设产物 | `src/presets.ts` | R0-R3 → `@deepseek-ai/dsh-permission-presets` 插件行(presets 表 + defaultPreset)生成器 + YAML 渲染;档→预设名映射 | `ctx.permissionPresets` 配置面 |
| 富审批卡片 | `src/card.ts` | 五必备字段:将发生什么(命令/API+参数,超长折叠)/为什么(SOP/skill/golden)/影响面(文件+diff 摘要、外部系统对象)/回滚性(逆闭包明示,不可逆明示)/命中规则(ruleId+档+依据);R3 附加控制;`cardToQuestionItems()` 渲染为官方 user-questions 载荷 | `ctx.userQuestions`(intent `approval` 分支) |
| 提问合并 | `src/ask.ts` | 同 turn 多次 `ask_user_question` 合并为一张多问题卡片(上限 3 问,超限顺序拆卡);同 turn 重复 id 去重(保留首个);turn 切换自动 flush;合并率统计(asksIn/cardsOut/interruptionsSaved/mergeRate,供 observe「question 合并率」) | `ask_user_question` 工具参数形态 |
| 负信号 | `src/negative.ts` | 审批被拒(DSH `ApprovalOutcome='rejected'` 翻译)/被修改(R2 产出被用户改写=隐含差评)事件发布:订阅扇出+环形快照,监听器抛错隔离;allowed-once/cancelled/unavailable **非**负信号不发布 | `ctx.approval` waterfall 结局 |
| 组合门 | `src/index.ts` | `createInteract()`:hitl + 预设产物 + 卡片 + 合并器 + 信号总线一站式装配 | — |

## hitl.yaml 示例(键统一 snake_case)

```yaml
pack: event-planning
default_grade: R2            # 只允许 R2|R3(fail-closed:未命中规则的动作必须走人)
on_no_answer: escalate       # ask 不可达时:suspend 挂起(任务暂停非失败)| escalate 升级 channels | fail
rules:
  - id: payment-redline
    grade: R3
    tools: ['pay_*', 'contract_sign']   # tool 名 glob(* 任意长度 ? 单字符)
    args_contains: ['付款', '签署']     # 参数子串(稳定串化后 includes,OR);缺省只按工具名
    reason: '预算红线:对外付款/合同签署需人工复核'
    escalate_to: ['finance-lead']       # 以下三键仅 R3 条目允许
    cooling_period_sec: 300
    double_confirm: true
    on_no_answer: suspend               # 逐条覆盖全局
  - { id: draft-docs, grade: R1, tools: ['write_file', 'edit_file'] }
```

校验 fail-closed:未知键、非法枚举、重复 id、R0-R2 携带 R3 专属键、default_grade=R0/R1,
一律解析期抛 `InteractConfigError`(对齐 governance 对 `default: allow` 的态度)。

## 分档 → permission-presets 映射

| 档 | sandbox | approval | 依据 |
|---|---|---|---|
| R0 只读 | `read-only` | `never` | 静默读;越权升级请求被确定性拒绝 |
| R1 可逆写 | `workspace-write` | `never` | 可逆写静默+事后 diff 卡片;升级拒绝即 fail-closed |
| R2 需确认 | `workspace-write` | `ask` | 富审批卡片 |
| R3 高危 | `workspace-write` | `ask` | 审批 + interact 层叠加(升级/冷静期/二次确认) |

`generatePresetArtifact(hitl)` 产出四预设 + `defaultPreset`(取 default_grade 对应档),
`renderPresetYaml()` 渲染为可直接粘进 profile 的插件行;预设名不撞保留名 `custom`/`auto`。

## 组合层接线(示意)

```ts
const interact = createInteract({ hitlYaml, ask: { onFlush: r => sendAsk(r) } })
// tools/pre-execute:decision = interact.hitl.gradeFor(call);R2/R3 → 组合层组卡问人
// approval waterfall 应答处:interact.signals.recordOutcome(outcome, meta)   // 被拒→负信号
// R2 产出 diff 检测:interact.signals.recordModification(meta)               // 被改→负信号
// 观测:interact.ask.stats() → question 合并率;interact.signals.recent() → observe
```

## seam 钉住(防 DSH pre-stable 破坏)

- 依赖**已发布的** `@deepseek-ai/dsh-{user-questions,user-approval,permission-presets,sandbox}`
  + `@deepseek-ai/cordis`(全部与 deepseek-harness 同为 0.2.2-alpha.2,catalog 钉死),仅 `import type`
  (除 `yaml`)。提问载荷、卡片渲染项、预设条目、结局词汇**直接采用官方类型**——DSH 升级破坏
  任一形态,`tsc --noEmit` 即失败。
- `tests/types.seam-pin.ts`(tsc 消费,vitest 不运行)钉住:① 合并器 flush 产物可直接作
  `AskUserQuestionRequestEvent.questions` 发给 `ctx.userQuestions.ask()`;② 官方事件面问题项可被
  本包草稿校验器复检;③ 本包可作 `approval/request` waterfall 应答器(`ApprovalOutcome` 直喂
  `recordOutcome`);④ 预设产物 config 满足插件行配置面(`Record<string, PresetSpec>` +
  `defaultPreset`);⑤ 官方答案形态原样回传。

## 已知边界(诚实声明)

- **预设只有两个旋钮**:DSH `PresetSpec` 仅捆绑 sandbox+approval(permission-presets README
  「Only two mechanism knobs are bundled」),R3 的升级/冷静期/二次确认不进预设,由本包
  card.ts 的 R3 附加卡片字段与组合层执行。
- **预设是会话级缺省,非逐动作**:DSH 预设作用于 fresh session 的双旋钮缺省;逐动作分档裁决
  (gradeFor)+ 审批仍由 interact/governance 插件层执行——12 号文档「分档逻辑在插件,执行在内核」
  的既定分工。
- **R1 事后变更卡片**依赖 DSH deliverables 逐 turn diff(原生),本包不重复实现;被修改负信号
  (`recordModification`)的 diff 检测由组合层对接 deliverables 事件。
- **未在真实 DSH 运行时联调**(acp 驱动/bundle 挂载):seam 兼容性靠官方类型直用 + 编译期钉住
  保证;需运行时联调(见 PROGRESS.md T3 备注)。
- `on_no_answer` 的挂起/升级执行(suspend=任务暂停非失败 replay 即恢复、escalate=超时升级
  channels)由组合层与 T11 channels 落地;本包提供策略数据与逐条解析。

## verify

```bash
pnpm --filter @eterna/interact run verify   # oxlint + tsc --noEmit + vitest run(55 用例)
```
