/**
 * webchat 委派入口——orchestrator 主会话的用户消息 → Trigger 进 Engine(35 号 A21 sources
 * 适配的会话面补全;诊断施工清单①「在 tasks 插件内监听 orchestrator 会话的用户消息(dsh
 * session 事件 seam),归一化为 Trigger(幂等 id=会话id+消息id、human=true、addressed=direct)
 * 进 Engine.receive」;35-A21 目标行为:用户在 web 聊天会话里发一条委派消息 → 该消息成为
 * Trigger(explicit,发送者=会话主人)→ Eval 评估 → accept 出票 → worker session 接手)。
 *
 * 设计依据与语义来源:
 * - 事件 seam 与既有 sources 形态:参照 dsh-superagent 原型 src/core 的 intake 语义与其
 *   sources 目录的触发器归一化形态(feishu-trigger.ts:确定幂等 id + actor/human/addressed
 *   + 会话线程),以及本包 channel-adapter.ts 的「被动汇,无注册表无轮询」纪律(34 §0-A5
 *   「注册表与轮询不搬」——24a 拍板 A5 channels 统一接收面的同款);
 * - seam 本体:宿主 Cordis context 的 `session/event` 事件(dsh-session index.d.ts:63
 *   augmentation;executor/dsh.ts:554 已按同一 seam 跟踪 worker 投递)——`user/message`
 *   事件且 `source.kind === 'user'`(dsh-llm message.d.ts「a direct human prompt」)即用户
 *   在会话里亲口写下的一条消息:本包自投的投递是 'eterna-tasks' 源、宿主合成的 inject
 *   (文件变更/通知等)各有其 kind,都不在此列;
 * - 主会话白名单:仅监听 realm 内主会话(TasksOptions.masterId / sessionHost.masterId,
 *   诊断清单②同源口径)——非主会话的 web 聊天会话不产生委派 Trigger;
 * - 发送者=会话主人:经 `actorOf` 端口解析(glue 按 access 账号面注入);端口缺席时以本栈
 *   绑定的 realm(账号,plugin.ts TasksOptions.realm 注)为主人——单 realm 一账号栈里
 *   主会话的主人是部署账号本身;
 * - 准入不在此裁决:Trigger 进 `Engine.receive` 后由 intake(scope 监听过滤,intake.ts:37-40)
 *   与 gate(名单 × addressed='direct' → explicit,gate.ts:130)按策略裁定——「宿主会复查
 *   访问权限」的 prompt 纪律与此同构;本入口是纯被动汇,不自带权限面(T2:不占路由面、
 *   不自建鉴权,名单面归 access/gate)。
 *
 * 幂等:id 以稳定内容派生(key(),core/ids.ts;27 号 §3.2-② 幂等键机制)= 会话 id + 消息 id
 * (诊断清单①原文「幂等 id=会话id+消息id」)。DSH 的 MessageId 在会话内稳定,宿主对同一
 * 消息的重复事件(重启回放/监听器重挂)恒得同一 id,`Engine.receive` 判 duplicate 收敛;
 * 事件到达时刻不参与派生(intake 归一时间戳后落库,channel-adapter.ts 头注同款纪律)。
 */
import type { Context } from '@deepseek-ai/cordis'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import { key, threadKey } from '../core/index.ts'
import type { ActorRef, EngineForSources, ScopeResult, SourceScope, Trigger } from '../core/index.ts'

/** webchat 委派入口的 Source 名(Source 自有词汇;settings.policy.sources 以同名键配置名单)。 */
export const WEBSCHAT_SOURCE = 'webchat'

/** 归一化输入:一条主会话用户消息的最小事实面(session/event `user/message` 载荷的投影)。 */
export interface WebchatMessageInput {
  /** 承载消息的会话 id(orchestrator 主会话;会话即线程)。 */
  readonly sessionId: string
  /** 消息 id(DSH MessageId;会话内稳定——幂等 id 的消息半边)。 */
  readonly messageId: string
  /** 消息文本(text 块按序连接;intake 的 Trigger.text 不可信外部数据原样承载)。 */
  readonly text: string
  /** 消息时刻(session/event 的 epoch 毫秒;缺省由装配时钟供给)。 */
  readonly at: string
  /** 发送者=会话主人(actorOf 端口的解析结果;单 realm 栈缺省为部署账号)。 */
  readonly actor: ActorRef
}

/**
 * 归一化一条主会话用户消息为 core Trigger(纯函数,诊断清单①的归一化面):
 * - 幂等 id = `key('tasks/webchat-trigger', 会话id, 消息id)`(34 §2.5「幂等 id 从事件内容
 *   派生」的会话面形态;重放同一消息恒同一 id,内容不同不得碰撞);
 * - `human: true`(用户亲口消息)、`addressed: 'direct'`(在主人自己的会话里对 agent 说话,
 *   Trigger 契约的「私聊」位;gate.ts:130 名单内 direct → explicit 的依据);
 * - 主线程 = 会话本身 `{ source: 'webchat', id: 会话id }`(后续消息与工单订阅都落同一线程,
 *   Eval 按线程批处理,evals.ts start 的线程级批次语义);
 * - channel 只写地址指向原会话(回执经 outbox 投回会话的接线位,34 §3 ChannelRef);
 * - meta 承载 sessionId/messageId(scope 行匹配与 orchestrator_trigger_requeue 的定位面)。
 */
export function normalizeWebchatTrigger(input: WebchatMessageInput): Trigger {
  const thread = { source: WEBSCHAT_SOURCE, id: input.sessionId }
  return {
    id: key('tasks/webchat-trigger', input.sessionId, input.messageId),
    source: WEBSCHAT_SOURCE,
    threads: [thread],
    actor: input.actor,
    human: true,
    addressed: 'direct',
    at: input.at,
    text: input.text,
    channel: { source: WEBSCHAT_SOURCE, thread: threadKey(thread), address: { messageId: input.messageId } },
    meta: { sessionId: input.sessionId, messageId: input.messageId },
  }
}

/**
 * 装配缺省 SourceScope(★真实现,替换 plugin.ts 旧 `UNWIRED_SCOPE`「一律不监听」;
 * 2026-11-18 出票端到端验收三断点③:stub 级 scope 把 webchat Trigger 过滤为 filtered、
 * 不进 Eval):webchat 来源、orchestrator 主会话(白名单 id 经 `master` getter 动态解析——
 * master 会话引导可晚于装配落定,每次 intake 现读)的用户消息返回 `listened=true`
 * (`observed:false`——只收对准消息;强度不在本面裁决,由 gate 名单 × addressed='direct'
 * 裁 explicit,gate.ts:130 的「名单内且对准 agent 不查格子恒显式」)。其余一律 filtered
 * (reason 'sources_unwired' 原码保留,intake.ts:37-40 记 filtered 落库、不进 Eval)。
 * `meta.sessionId` 即 normalizeWebchatTrigger 写入的会话定位面。
 */
export function webchatMasterScope(master: () => string | undefined): SourceScope {
  return {
    scope: (input): ScopeResult => {
      const masterId = master()
      return input.source === WEBSCHAT_SOURCE && masterId !== undefined && input.meta.sessionId === masterId
        ? { listened: true, observed: false, row: 'master' }
        : { listened: false, reason: 'sources_unwired' }
    },
  }
}

/** `WebchatDelegationEntry` 的宿主依赖(装配面注入;入口自身无状态、纯被动)。 */
export interface WebchatEntryHost {
  /** realm 内主会话 id(白名单;非主会话的用户消息不产生 Trigger)。 */
  readonly masterId: string
  /** 领域引擎的 Source 角色面(34 §3 EngineForSources:receive)。 */
  readonly engine: Pick<EngineForSources, 'receive'>
  /** 会话主人解析端口(glue 按 access 账号面注入;返回 undefined 即跳过该消息)。 */
  readonly actorOf: (sessionId: string) => ActorRef | undefined
  /** 时钟(消息时刻缺省值;缺省 Date.now——intake 仍会归一时间戳)。 */
  readonly now?: () => number
  /** 一条 Trigger 已入引擎(stored)后的回调(装配面借此排一轮 pass,评估即时不等周期)。 */
  readonly onStored?: () => void
  /** 事件处理失败的回调(装配面借此写健康项;入口不外溢异常,不破宿主事件总线)。 */
  readonly onError?: (error: unknown) => void
}

/**
 * webchat 委派入口(诊断清单①的实现类;channel-adapter.ts 的被动汇同款,无轮询无后台循环)。
 * `install` 在宿主 Cordis context 上订阅 `session/event`,只放行:主会话白名单内的会话 ×
 * `user/message` × `source.kind === 'user'`(用户亲口消息);每条归一化为 Trigger 送
 * `Engine.receive`,三态结果如实回报。文本取自消息的 text 块(按序连接;纯附件消息无文本
 * 可评,跳过不产 Trigger)。处理异常经 `onError` 上报装配面,不在宿主事件总线里外溢
 * (plugin.ts 事件分发器的「订阅方异常不外溢」同款纪律)。
 */
export class WebchatDelegationEntry {
  private readonly host: WebchatEntryHost
  private readonly disposers: (() => void)[] = []
  constructor(host: WebchatEntryHost) {
    this.host = host
  }

  /** 订阅宿主 `session/event`(启动时调一次);返回退订闭包。 */
  install(context: Context): () => void {
    this.disposers.push(context.on('session/event', (session, event) => {
      try {
        if (String(session.id) !== this.host.masterId) return
        if (event.type !== 'user/message') return
        // 只收用户亲口消息:本包自投的 'eterna-tasks'、宿主合成的 inject 等各有其 kind。
        if (event.data.source.kind !== 'user') return
        const text = event.data.content.filter(block => block.type === 'text').map(block => block.text).join('\n').trim()
        // 无文本可评(纯附件)不产 Trigger:委派评估以文本为输入(A19 候选卡窗口的事实面)。
        if (!text) return
        const actor = this.host.actorOf(String(session.id))
        if (actor === undefined) return
        const at = typeof event.time === 'number' ? new Date(event.time).toISOString()
          : new Date((this.host.now ?? (() => Date.now()))()).toISOString()
        const trigger = normalizeWebchatTrigger({ sessionId: String(session.id), messageId: event.data.id,
          text, at, actor })
        const result = this.host.engine.receive(trigger)
        if (result === 'stored') this.host.onStored?.()
      } catch (error) {
        this.host.onError?.(error)
      }
    }))
    return this.dispose.bind(this)
  }

  /** 退订宿主事件(幂等)。 */
  dispose(): void {
    for (const dispose of this.disposers.splice(0)) dispose()
  }
}

/** 入口的 session/event 载荷投影(类型面;真身见 @deepseek-ai/dsh-session SessionEventMap)。 */
export type WebchatSessionEvent = { type: 'user/message'; time?: number; data: Pick<UserMessage, 'id' | 'content' | 'source'> }
