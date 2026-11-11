/**
 * loopPrompt/snapshot 组装(纯函数;Host 侧活状态由网关收集后喂入)。
 */
import { diffSummaryText } from './diff.ts'
import type {
  ChannelInfo, EntrySummaryView, LoopPromptSnapshot, PendingApprovalView, PersonaState, TraceSessionCard, VersionOverview,
} from './types.ts'

/** 通道 A 说明(spike §1 结论;UI 据 effectiveNote 提示「新会话生效、无需重启」)。 */
export const CHANNEL_A: ChannelInfo = {
  kind: 'A-patch-hmr',
  note: '保存即对新建会话生效、无需重启宿主进程(profile patch 层 + HMR 重组合;进行中会话不受影响)。UI 按 8s 级等待/轮询后提示。',
}

export const EFFECTIVE_NOTE = '保存对新会话生效(无需重启);进行中会话与 KV-cache 前缀不受影响。影响:新会话前缀将变化。'

/** 运行时注入型条目的生效说明(T1.4 分型:对不可保存条目透传 EFFECTIVE_NOTE 会误导;自管改造见 T2.6)。 */
export const RUNTIME_ENTRY_NOTE = '该条目由代码在装配时注入(运行时构建,无静态全文)——本视图只读;保存通道对其 fail-closed 拒写(自管改造见 T2.6)。'

/**
 * 会话快照查看语义说明(T2.3 查询端点透传,UI 顶部展示):快照冻结 + 不可
 * 回放条目(运行时注入型)的降级标注口径(测试计划 §4 T2.3(b)⑤)。文案含
 * 「不可回放」与「装配时」锚点字样(t7-ui-check combo 级文案断言)。
 * (2026-11-11 用户裁定:纯运行时数据注入器不登记,行锚点只读型表述随之移除。)
 */
export const SNAPSHOT_VIEW_NOTE = '快照在会话开启事件时冻结,只读不可变——改动提示词只影响之后新开启的会话,本会话全程沿用快照。运行时注入型条目不可回放(文本装配时动态构建),仅记在场标记。'

export const COMPOSED_NOTE = '编辑范围仅 persona 段(preset-standard 行 plugins[id=persona].config.prefix);最终组合提示(plan-mode/skill/agent-instructions 等段)的只读组合视图在 T7.2 提供。'

/** snapshot 的输入部件(网关收集后的纯值)。 */
export interface SnapshotParts {
  readonly persona: PersonaState
  readonly versions: VersionOverview
  readonly pendingApproval: PendingApprovalView | null
  /** 提示词注册表全景(T1.4:每条目元数据+当前值+链概览)。 */
  readonly entries: readonly EntrySummaryView[]
  /** 最近会话清单(T7.4:同一次投影,长度即 sessions 数;默认 20 条)。 */
  readonly traceRecent: readonly TraceSessionCard[]
  readonly tracePipeline: string
}

/** 组装快照(纯 JSON;sessions 数 = recent 长度,清单整体随 trace.recent 下发)。 */
export function buildSnapshot(parts: SnapshotParts): LoopPromptSnapshot {
  return {
    generatedAt: new Date().toISOString(),
    persona: parts.persona,
    versions: parts.versions,
    pendingApproval: parts.pendingApproval,
    entries: parts.entries,
    trace: { sessions: parts.traceRecent.length, pipeline: parts.tracePipeline, recent: parts.traceRecent },
    channel: CHANNEL_A,
  }
}

/** 审批卡影响面用的 diff 摘要文案(diff.ts 的 LineDiff → 人话)。 */
export function cardDiffSummary(diff: { added: number; removed: number; isEmpty: boolean }): string {
  return diffSummaryText(diff)
}
