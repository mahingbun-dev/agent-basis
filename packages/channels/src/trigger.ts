/**
 * Source 契约中立类型与纯函数(39 号 §3-E2;24a 拍板 A5;34 号 §2.5/§3)。
 *
 * 31 号 §2.2 铁律 1「Tier1 永不 import Tier2」:channels 是 Tier1,不得 import
 * Tier2 包 @eterna/tasks,故本面类型与派生工具在 channels 内部声明。形态与
 * @eterna/tasks core(model.ts 的 ActorRef/ThreadRef/ChannelRef/Trigger、
 * threadKey/isoTime 与 ids.ts 的 key)逐字段同构——tasks(Tier2)适配本面
 * (Tier2→Tier1 依赖合法),组合层按结构类型把 tasks Engine 注入 TriggerSink。
 * 两侧同构是行为不变量的载体,漂移即接线断裂:
 *
 * - 幂等 id:内容派生稳定 id(34 §2.1 ids 行;27 §3.2-② 幂等键机制)对事件内容
 *   派生——**不含到达时刻**(重放/重试的到达时刻不同,若参与派生则幂等失效);
 *   重复投递经 `receive → duplicate` 收敛为一单(27 §3.3 情况 C),三态由 sink
 *   (tasks 侧)回传、注册面原样透传。两侧 key() 算法漂移 = intake 判重失效。
 * - `channel_user` 收敛身份:透传为 Trigger.actor({source, id}=渠道类型+渠道
 *   身份,24a A5/27 §3.3 情况 A 的归一化防线);多渠道收敛同一 thread 靠 E1 的
 *   多行同目标绑定,不做跨源身份映射(24 §2.2 被拒概念)。
 * - WebChat 兼容面(29 §6,B4 拍板):归一化载荷以 Trigger 兼容面定义,端口
 *   (TriggerSink,source.ts)不绑定 webhook 特有字段,未来 WebChat 入口接入是
 *   配置工作。
 */

import { createHash } from 'node:crypto'

/** Source 自身词汇中的行动者身份;哪些行动者可在该 Source 上发起工作由 Policy 决定。 */
export interface ActorRef { source: string; id: string }

/** 线程身份;从原生事件派生 `id` 的规则属于 Source。 */
export interface ThreadRef { source: string; id: string }

/** 线程上的只写地址;地址格式属于 Source。 */
export interface ChannelRef { source: string; thread: string; address: Record<string, string> }

/** 线程在全域的稳定键(与 tasks core threadKey 同构:`${source}:${id}`)。 */
export const threadKey = (ref: ThreadRef): string => `${ref.source}:${ref.id}`

/**
 * 把合法时间戳归一为 `Date#toISOString` 形态,使落库时间戳在内存与 SQL 中可按
 * 字典序比较;无法解析为时间戳的值原样返回(与 tasks core isoTime 同构)。
 */
export function isoTime(value: string): string {
  const time = Date.parse(value)
  return Number.isFinite(time) ? new Date(time).toISOString() : value
}

/**
 * 内容派生的稳定标识:相等输入恒产相同 id(34 号 §2.1 ids 行;24 号 §5.3-1 幂等
 * id 不变量)。纯函数,仅用 Node 标准库 crypto,零外部依赖:sha256(JSON 文本)
 * 取十六进制前 32 位;同内容同 id,跨进程稳定(与 tasks core ids.ts key 同构)。
 */
export function key(...values: string[]): string {
  return createHash('sha256').update(JSON.stringify(values)).digest('hex').slice(0, 32)
}

/** Source 产生的一条不可变事件。`text` 与 `meta` 是不可信外部数据。 */
export interface Trigger {
  id: string
  source: string
  /** 该 trigger 所属的全部线程;第一个(`threads[0]`)是承载其评估的主线程。 */
  threads: ThreadRef[]
  actor: ActorRef
  /** Source 声明:该事件由人写出,而非 bot、CI 或本 agent。 */
  human: boolean
  /** Source 声明:发送者以提及或私聊方式对 agent 说话。 */
  addressed?: 'mention' | 'direct'
  at: string
  text: string
  channel?: ChannelRef
  url?: string
  /** 给适配器的 Source 原生细节;内核从不解释它们。 */
  meta: Record<string, unknown>
}
