/**
 * @eterna/evals —— DSH 评测 runner(独立 CLI,不进 agent 进程)。
 * 公开面:类型、schema 加载、断言器、适配器与注册表、runner、report/sessions 渲染。
 */
export type {
  AgentAdapter,
  AgentRunInput,
  AgentRunResult,
  ApprovalFlowAssert,
  ApprovalOutcomeLike,
  AnswerAssert,
  AcpAdapterConfig,
  BudgetAssert,
  CaseMetrics,
  CaseResult,
  FailureCategory,
  FailureDetail,
  FileAssert,
  FinalStateAssert,
  GoldenCase,
  HttpAssert,
  PackRunResult,
  PluginRecordLike,
  ReplayAdapterConfig,
  ScriptAssert,
  SessionEventLike,
  TokenUsageLike,
  TrajectoryAssert,
  TrajectoryMode,
  WorkspaceRecordData,
} from './types.ts'
export { SchemaError, loadPackCases, parseGoldenCase, setFsPort } from './schema.ts'
export { approvalDecidedOf, approvalAskedOf, messageTextOf, summarize, toolCallOf, usageOf } from './events.ts'
export type { SessionSummary, ToolCallView } from './events.ts'
export { assertAnswer, assertBudget } from './budget.ts'
export { assertFinalState } from './finalState.ts'
export { assertTrajectory, checkTrajectoryMode } from './trajectory.ts'
export { ReplayAdapter, WORKSPACE_RECORD_TYPE } from './adapters/replay.ts'
export { AcpAdapter, defaultDriverPath } from './adapters/acp.ts'
export type { AcpAdapterOptions } from './adapters/acp.ts'
export { adapterIds, ensureBuiltinAdapters, getAdapter, registerAdapter } from './adapters/registry.ts'
export { runPack } from './runner.ts'
export type { RunPackOptions } from './runner.ts'
export { renderReport } from './report.ts'
export { sessionsLines } from './sessions.ts'
export { main as cliMain } from './cli.ts'
