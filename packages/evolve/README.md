# @eterna/evolve

L1 受控自进化引擎(T10;设计文档 09《RSI 自进化机制设计》/ 10《dsh-evolve 详细设计》)。
**RSI 不是"让 agent 运行时自由改自己",而是"把进化做成一条有门禁的发布流水线"**:
信号采集 → 反思归因 → 提案(delta)→ 验证(G0/G1/G2 门禁)→ 发布(账本 lineage)→ 废弃(supersession)。

## 模块

| 模块 | 职责 | 关键 API |
|---|---|---|
| `entry.ts` | SKILL.md 条目解析器(ACE 条目化,packctl SKILL0xx 同口径;deprecate 后 `activeEntries` 不再输出) | `parseSkillDoc` / `renderSkillDoc` / `activeEntries` / `pairEntries` |
| `deltas.ts` | 五种 delta 纯函数,操作 `metadata.evo.entries` 与锚点正文 | `applyDeltas`(add_entry / update_entry / bump_counter / deprecate_entry / merge_entries) |
| `ledger.ts` | sqlite 进化账本:proposal→verification→release→effect lineage | `LedgerStore`(propose / markVerified / markApproved / markReleased / markSuperseded / markRolledBack / recordEffect) |
| `models.ts` | 模型角色 reflector/curator/reviewer 全可配置(默认 deepseek-flash),统一 `ModelCaller` 接口 | `dshLlmModelCaller`(适配 DSH `ctx.llm.stream`) / `resolveRoutes` |
| `reflector.ts` | 反思归因:聚类(trajectory_hash)→ MAST 3类14模式打标 → 同根因 ≥2 才立项 → 环境类分流 | `reflect` / `clusterSignals` / `MAST_PATTERNS` |
| `curator.ts` | delta 起草:模型蒸馏失败轨迹成条目正文;模型不可用回落确定性模板 | `curateSkillDelta` |
| `aievo.ts` | aievo-cli 包装:命令构造 + 退出码语义(0 通过/1 不达标/2 平台错误),未接入降级跳过 | `buildAievoCommand` / `runAievoGates` |
| `gates.ts` | G0=packctl lint 库函数;G1=evals replay 库函数;G2=aievo;G0 不过短路 | `runGates` / `runGate0` / `runGate1` |
| `audit.ts` | prompt-audit 扫描:引用文件缺失 / helpful-harmful 计数低下 / 高相似合并建议 | `promptAudit`(产出 deprecate/merge 提案 + audit_scan 信号草稿) |
| `pipeline.ts` | 闭环编排:信号→反思→提案→门禁→账本流转(发布写回由人审动作显式触发) | `runEvolutionCycle` / `processProposal` / `approveAndRelease` / `effectOf` |
| `index.ts` | 组合门 `createEvolution`(注册表 + `EVOLVE_SERVICE_ID` 唯一 ID,provide 可交换) | `createEvolution` |

## 设计要点

- **重复度阈值**:同一失败模式(trajectory_hash 聚类,缺省回落 kind+归一化摘要)计数
  ≥ `repeatThreshold`(默认 2,Cursor/Anthropic「重复犯过的错才沉淀」准则)才立项;
  环境坏/上下文跑偏 → 分流为「重启+全量指令」建议,不生成知识提案(Devin 口诀)。
- **模型绝不写实**:三角色路由全配置化(部署只改配置不改代码),调用统一走
  `ModelCaller`;单测全部注入 mock,绝不真实调用。模型失败 → 确定性启发/模板回落。
- **账本状态机**(fail-closed,非法迁移抛 `LedgerTransitionError`):
  `proposed → verified → approved → released → superseded | rolled_back`;
  effect 回填仅对 released 开放(T+7d before/after);记录 append-only,永不物理删。
- **G2 可降级**:ai-evo 未配置 baseUrl → 三任务 skipped、整体 degraded,不阻塞本地闭环;
  接入后 fail-closed(exit 0 才放行)。
- **废弃≠删除**:deprecate_entry 把条目移入文末「已废弃(Evo Archive)」节,
  frontmatter 留 `deprecated_at`;解析器 `activeEntries` 即刻不再输出(逻辑不可见),
  正文物理保留供溯源(审计可读)。归档节保留 30 天后物理移除(prompt-audit 周期)。
- **delta 后仍可 lint**:五种 delta 的产物统一过 `pairEntries` 重新配对校验,
  与 G0(packctl lint)同一口径 —— 测试钉住「delta 应用后的 pack 原样过 G0」。

## DSH seam(编译期钉住,tests/types.seam-pin.ts)

模型调用面消费 `ctx.llm`(已发布 `@deepseek-ai/dsh-llm` 0.2.2-alpha.2 类型):
`GenerateOptions`(provider/model/messages/system)+ `StreamChunk`(text-delta / finish
`{kind:'stop'|'tool-calls'|…}`)。DSH 升级破坏 seam 形态时 `verify` 的 tsc 阶段即失败。

## 验收

```bash
pnpm --filter @eterna/evolve run verify   # oxlint + tsc --noEmit + vitest run
```

64 断言 / 8 文件,含 fixture skill 端到端:制造失败信号(observe SignalStore,(kind,ref)
去重)→ 提案 delta(reflector+curator 全 mock)→ 门禁(G0/G1 真跑 packctl lint 与 evals
replay,G2 注入 mock runner)→ 账本 release 记录(verified→approved→released→effect)
→ deprecate 后解析器不再输出该条目(归档保留)→ 账本 supersession 链。

## 已知边界

- packctl init 模板的 `evals/golden/case-001.yaml`(`answer: ''`)过不了 evals 严格
  schema(loader 要求 answer 为对象形态)——测试 fixture 用双 loader 兼容形态覆写;
  真实 pack(T6 金集)应同样按 evals 口径写 golden。
- 安全回归探针集(投毒/越权/注入)未接入,G2 verification 如实记 `probe: 'not-run'`。
- ai-evo 真实平台联调(baseUrl + API Key)后置,G2 现阶段只有命令构造与退出码语义。
