/**
 * DSH seam 编译期钉住(只被 tsc --noEmit 消费;vitest include 只收 *.spec.ts,不运行本文件)。
 *
 * 目的(35 号 §10 风险表「DSH 0.2.1→0.2.2-rc.1 契约差破坏 executor」行;34 §6-8):
 * executor 依赖的四类宿主事件与 sessions 面 seam 钉住本文件——DSH 升级破坏 seam 形态时,
 * `pnpm --filter @eterna/tasks run verify` 的 tsc 阶段即失败。
 *
 * 依据(本仓 node_modules 实测,catalog 均为 0.2.2-alpha.2):
 * - @deepseek-ai/dsh-agent lib/types/runtime-types.d.ts:279/304/437——'agent/status' /
 *   'agent/inbox/claimed' / 'agent/error' 对 cordis Events 的 augmentation。
 * - @deepseek-ai/dsh-session lib/types/index.d.ts:63——'session/event' augmentation;
 *   Session / SessionStore 类(worker session ensure/prompt/relay 的宿主对象面,35 号 A22)。
 *
 * 注:35 号 A0-2/A14 仍须对本仓 DSH 0.2.2-rc.1 宿主做全量 seam 复核与事件订阅对齐
 * (B9 版本差);本文件先钉已发布类型面上确定存在的四类事件与 sessions 面形状。
 */
import type { Events } from '@deepseek-ai/cordis'
import type { Agent, AgentRegistry, Inbox } from '@deepseek-ai/dsh-agent'
import type { Session, SessionEventMap, SessionStore } from '@deepseek-ai/dsh-session'
import type { ContextFormed, MessageSourceMap, UserMessage } from '@deepseek-ai/dsh-llm'
import '../src/session/sessions.ts'

/** 钉住 ①:executor 四类宿主事件名存在于 cordis Events(载荷细节随 A14 seam 评估细化)。 */
export type AgentStatusSeam = Events['agent/status']
export type AgentInboxClaimedSeam = Events['agent/inbox/claimed']
export type AgentErrorSeam = Events['agent/error']
/** 钉住 ②:worker session 面(A22 ensure/prompt/relay 消费的宿主对象形状)。 */
export type WorkerSessionSeam = Session
export type SessionStoreSeam = SessionStore

// ── 钉住 ③(35 号 A14):executor 四类宿主事件的载荷形状 ──────────────────────
// agent/status:{agent,status}(idle⇄running);agent/inbox/claimed:{agent,message,turn};
// agent/error:{agent,turn,step,error};session/event:(session, event)。
export type AgentStatusPayloadSeam = Parameters<Events['agent/status']>[0]
export type AgentInboxClaimedPayloadSeam = Parameters<Events['agent/inbox/claimed']>[0]
export type AgentErrorPayloadSeam = Parameters<Events['agent/error']>[0]
export type SessionEventSeam = Parameters<Events['session/event']>[1]
/** executor 跟踪 worker 结束语与 inputsRead 所读的两类 session 事件载荷。 */
export type AssistantMessageEventSeam = SessionEventMap['assistant/message']
export type UserMessageEventSeam = SessionEventMap['user/message']

// ── 钉住 ④(35 号 A14/A22):executor 与 Sessions 消费的 Agent/Inbox/注册表面 ──
/** 投递面:Sessions 的 prompt/holds 与 executor 的 stop/resume/shutdown 消费的 Agent 形状。 */
export type AgentDeliverySeam = Pick<Agent, 'id' | 'session' | 'status' | 'inbox' | 'cancel' | 'whenIdle' | 'followup' | 'steer' | 'inject'>
/** inbox 面:pending 扫描(去重)与启动前放回消息的 remove。 */
export type InboxSeam = Pick<Inbox, 'nextTurn' | 'nextStep' | 'remove'>
/** 注册表面:ensure 的 get→resume→create 路径(A22「按本仓 DSH session 面重写」)。 */
export type AgentRegistrySeam = Pick<AgentRegistry, 'get' | 'create' | 'resume'>

// ── 钉住 ⑤(35 号 A22):本包投递消息的生产者身份与构造面 ─────────────────────
// 'eterna-tasks' 源在 src/session/sessions.ts 声明(仿 SA 'dsh-superagent');此处编译期
// 钉住:UserMessage 的 source 联合包含它,且 notice 形态带 ContextFormed summary。
export type TasksMessageSourceSeam = MessageSourceMap['eterna-tasks']
export type TasksNoticeSourceSeam = { kind: 'eterna-tasks'; form: 'notice'; summary: string } & ContextFormed
export type TasksRelaySourceSeam = { kind: 'eterna-tasks'; form: 'relay' } & ContextFormed
// 以下仅在类型层钉住(tsc --noEmit 消费本文件;vitest 不运行):构造出的两种消息源
// 形状必须可赋给 UserMessage['source']——DSH 升级改坏消息源联合时,这里先编译失败。
declare const pinnedNotice: TasksNoticeSourceSeam
declare const pinnedRelay: TasksRelaySourceSeam
export type PinnedNoticeSourceAssignable = typeof pinnedNotice extends UserMessage['source'] ? 'notice-ok' : never
export type PinnedRelaySourceAssignable = typeof pinnedRelay extends UserMessage['source'] ? 'relay-ok' : never

// ── 钉住 ⑥(35 号 A22;A0 评审 tasks-engine-review.md §5-C11):Sessions 宿主服务面的
// 结构端口 ──────────────────────────────────────────────────────────────────────
// A0 §5-C11 结论:resolveAgent/create/rename(A0 实测出处 dsh-api-session-controller
// index.d.ts:78/100/155,agent.d.ts:57-63 的 ApiSessionAgentResult/错误码
// 'session/not-found'|'session/agent-busy'|'session/writer-held'|'gateway/internal')、
// workspaceRegistry.create(dsh-workspace index.d.ts:82/146)、permissionPresets.set
// (dsh-permission-presets index.d.ts:177)、sessionPersistence flush/open
// (dsh-session-persistence index.d.ts:133/145;handle.read/close = handle.d.ts:75,
// 「close() is the one teardown;Symbol.asyncDispose delegates to it」)在 DSH
// 0.2.2-rc.1 全部存在且签名与 SA 用法吻合。
// 落地形态(34 号 §1 依赖方向行「接线经端口注入,不 import 服务实例」+ access 包
// tenant.ts serviceOf 的 ctx.reflect 反射惯例):tasks 不把上述宿主包加进依赖
// (实测其 peer 级联涉未发布包,公网解析 404),而以 src/session/sessions.ts 的
// `SessionHostPorts` 结构端口承载同一签名;glue 组合层按本面适配注入。DSH 升级
// 改坏上述签名时,fixtures/host.ts 的同构假件(逐签名实现)与本面一起在 verify 的
// tsc 阶段暴露漂移;逐字对照以 A0 §5 表为复核基准。
import type { SessionHostPorts, SessionsHost } from '../src/session/sessions.ts'
/** 生命周期控制器面:resolveAgent/create/rename(错误按 RemoteError `code` 判别)。 */
export type SessionControllerSeam = SessionHostPorts['controller']
/** 工作区登记面:create(path, title?) → { id, path, title }(worker session cwd 的宿主登记)。 */
export type WorkspaceRegistrySeam = SessionHostPorts['workspaces']
/** 权限 preset 面:set(session, name)(A4 拍板 v1 现有沙箱旋钮)。 */
export type PermissionPresetSeam = SessionHostPorts['permissions']
/** 会话持久化面:flush + open(id, 'read') → 句柄(read 逐页/close 唯一释放)。 */
export type SessionPersistenceSeam = SessionHostPorts['persistence']
/** Sessions 的宿主依赖整体(context + ports + masterId + lifetime + presets/permissionPreset)。 */
export type SessionsHostSeam = SessionsHost
