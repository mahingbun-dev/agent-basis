/**
 * @eterna/session-eval Host 半边插件入口(DSH bundle loader 契约)。
 *
 * 实时评测第三轨的 P0 确定性底座:把当前会话的事件快照投影成轨迹、算 §4.2
 * 规则指标、供右栏「评测」面板只读展示。**零模型成本、不落库、不改会话日志**。
 *
 * 职责边界:本包只提供进程内服务面(`ctx.eternaSessionEval`),不注册任何
 * Web/fetch/RPC 路由——铁律 T2。HTTP 面由 eterna-access 登记
 * (`/access/api/session-eval/snapshot`),两端经结构面相遇(见 host.ts 头注)。
 *
 * 设计见 docs/design/56-Agent实时评测调研与方案设计.md §5.2/§5.7(P0)。
 */
import type { Context } from '@deepseek-ai/cordis'
import { mountSessionEval } from './host.ts'

export { SESSION_EVAL_SERVICE_ID, createHostPorts, mountSessionEval } from './host.ts'
export { evaluateRules, ISSUE_LIMIT, ISSUE_OVERFLOW_NOTE, RULE_METRIC_KEYS, type RuleEvaluation } from './metrics.ts'
export { SessionEvalService, type SessionEvalFace, type SessionEvalPorts } from './service.ts'
export { projectTrajectory } from './trajectory.ts'
export type {
  EvalIssue,
  EvalSnapshot,
  EvalVerdict,
  MetricScore,
  SessionEventLike,
  SnapshotReply,
  ToolCallRecord,
  Trajectory,
  TurnRecord,
  UsageBuckets,
} from './types.ts'

/** DSH bundle loader 取 default export 插件实例(对齐 glue/adviser 插件形态). */
export default {
  name: 'eterna-session-eval',
  apply(ctx: Context): () => void {
    try {
      return mountSessionEval(ctx)
    } catch {
      // 装配失败只降级:服务缺席 → access 端点 503 fail-closed。
      // 评测是只读增强面,不该因宿主服务竞态把会话主流程拖垮(adviser 同款取舍)。
      return () => { /* 未装成,无资源需要撤销 */ }
    }
  },
}
