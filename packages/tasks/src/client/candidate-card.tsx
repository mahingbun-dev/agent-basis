/**
 * 候选卡可读化(2026-11-19 用户反馈「多了一个触发排队,不知道该继续对话还是等任务」):
 * tasks 引擎把候选以 JSON 文本投给主会话(`{"kind":"candidate",...}`,assessor.ts
 * candidateCard)。该文本在宿主里就是一条用户消息——排队预览与正文都会原样显示
 * 原始 JSON,用户无法分辨这是系统卡片还是自己发的内容。
 *
 * 这里在宿主 `conversation.user.text` 规则面上注册一条整段匹配规则,把候选 JSON
 * 渲染成中文系统 chip;同一渲染面被排队区预览与会话正文共用,两处同时生效。
 * 规则只改显示:模型收到的仍是原始 JSON,协议零改动。
 */
import type { ReactElement } from 'react'
import { Icon } from '@eterna/ui/icons'
import type { UserTextNodeSlotProps, UserTextRule, UserTextRuleMatch } from './client-types.ts'

/** 候选节点 id(与 conversation.user.text.node 的 key 同名)。 */
export const CANDIDATE_NODE_ID = 'candidate'

/** 从候选 JSON 中提取展示所需字段(其余字段不落 DOM)。 */
export interface CandidateCardData {
  readonly triggerId?: string
  readonly from?: string
  readonly at?: string
  readonly strength?: string
}

/**
 * 识别并解析候选卡文本;非候选或损坏 JSON 返回 undefined(回落普通文本渲染)。
 * @param text - 消息原文(模型看到的就这段)。
 * @returns 命中时返回展示字段,否则 undefined。
 */
export function parseCandidateCard(text: string): CandidateCardData | undefined {
  const trimmed = text.trim()
  if (trimmed === '' || !trimmed.startsWith('{')) return undefined
  let value: unknown
  try {
    value = JSON.parse(trimmed)
  } catch {
    return undefined
  }
  if (typeof value !== 'object' || value === null) return undefined
  const record = value as Record<string, unknown>
  if (record.kind !== 'candidate') return undefined
  return {
    ...(typeof record.trigger_id === 'string' ? { triggerId: record.trigger_id } : {}),
    ...(typeof record.from === 'string' ? { from: record.from } : {}),
    ...(typeof record.at === 'string' ? { at: record.at } : {}),
    ...(typeof record.strength === 'string' ? { strength: record.strength } : {}),
  }
}

/**
 * 整段匹配规则(order 5:先于引用/空白规则;from=0 才匹配整条文本)。
 * 宿主按 order 升序取首个命中;整段吞噬后其余规则不再处理这段 JSON。
 */
export const candidateCardRule: UserTextRule = {
  id: CANDIDATE_NODE_ID,
  order: 5,
  match(text: string, from: number): UserTextRuleMatch | undefined {
    if (from !== 0) return undefined
    const data = parseCandidateCard(text)
    return data === undefined ? undefined : { id: CANDIDATE_NODE_ID, start: 0, end: text.length, data }
  },
}

/** 候选 chip(排队预览 interactive=false;正文 interactive 也走同一渲染)。 */
export function CandidateCard({ node, t }: UserTextNodeSlotProps): ReactElement | null {
  const data = node.data as CandidateCardData | undefined
  if (data === undefined || t === undefined) return null
  const from = data.from
  return (
    <span
      data-eterna-tasks="candidate"
      {...(data.triggerId === undefined ? {} : { 'data-eterna-tasks-candidate-id': data.triggerId })}
      title={t('candidate.hint')}
    >
      <Icon name="flow" size={12} />
      <span>{t('candidate.label')}</span>
      {from === undefined || from === '' ? null : <span data-eterna-tasks-candidate-from="">{t('candidate.from', { from })}</span>}
      <span data-eterna-tasks-candidate-hint="">{t('candidate.short')}</span>
    </span>
  )
}