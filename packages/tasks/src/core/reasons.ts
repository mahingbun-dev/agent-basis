/**
 * 结构化 Reason 码表与模板,供 decision、被过滤的 trigger 与结束的 assignment 共用。
 * Policy gate 与 Source scope 亦可发出自己的字面 reason 码(Reason.code 为开放 string)。
 *
 * 设计依据:34 号 §2.1 reasons 行;35 号 A3。模板文本为 SA 原样(面向 agent 消费的英文模板;
 * 文案语言不在 A3 改造面——回执/文案语言见 35 号 §12-13 开放问题,prompt 中文化归 A23)。
 */
export const REASONS = {
  said: '{text}',
  timeout: 'Assessment timed out',
  policyChanged: 'Policy changed during assessment',
  noAdmissible: 'No admissible trigger',
  startedTicket: 'Already started ticket {ticket}',
  acceptedBefore: 'Trigger {trigger} was accepted before',
  routed: 'Routed to ticket {ticket}',
  explicitRouted: 'Explicit request from an allowed sender routed by the orchestrator',
  humanStop: 'Human asked to stop',
  legacyImport: 'Imported from the pre-domain-model task record',
  forwarded: 'Forwarded to the worker of the Ticket already on this Thread',
  senderNotMember: 'The sender is not on the Source\'s list',
  retried: 'Retried by a person',
  hostRestarted: 'dsh-superagent restarted',
  stopUnknown: 'Stop target is unknown or already ended',
  stopNotExplicit: 'A stop needs an explicit request from a sender on the list',
  directionUnsettled: 'Implementation intent or target direction is not established, or a product/design decision is still required',
  noRuleMatched: 'No enabled admission rule matched',
  ignoredFromCard: 'Ignored from its card, without a rule assessment',
  observed: 'Observe mode: would accept ({text})',
} as const
export type ReasonCode = keyof typeof REASONS
/** Reason 的码与模板值;`triggerId` 标出批次中该理由作用于哪条 trigger。 */
export interface Reason { code: ReasonCode | (string & {}); values?: Record<string, string>; triggerId?: string }
export const said = (text: string): Reason => ({ code: 'said', values: { text } })
/** 把 reasons 格式化为英文(agent 消费);有 triggerId 时以其为前缀。 */
export function reasonText(reasons: readonly Reason[] | Reason | undefined): string {
  // Reason.code 是开放码表(码表外允许字面码),查表按 string 索引、落空回退码值本身。
  const table: Record<string, string | undefined> = REASONS
  return [reasons ?? []].flat().map((reason) => {
    const template = table[reason.code] ?? reason.code
    const text = template.replace(/\{(\w+)\}/g, (match, name: string) => reason.values?.[name] ?? match)
    return reason.triggerId ? `${reason.triggerId}: ${text}` : text
  }).join('; ')
}
