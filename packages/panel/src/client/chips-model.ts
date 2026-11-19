/**
 * 流程启动条设置分区的纯逻辑(2026-11-20):草稿态、脏检查、保存前问题检查、
 * id 生成。不依赖 react 与 node 内建——本仓客户端测试不做组件渲染,纯函数
 * 单独成模块供 vitest 直测(client-sources/client-settings 同款拆法)。
 */
import { CHIP_LIMITS, type ChipConfig, type ChipsConfig } from '../chips.ts'

/** 设置分区里的单行草稿(editing=行内展开编辑态;note 统一为 string,''=无)。 */
export interface ChipDraft {
  readonly id: string
  readonly title: string
  readonly kickoff: string
  readonly note: string
  readonly enabled: boolean
  readonly editing: boolean
}

/** 已存配置 → 草稿行(全部收起编辑态;note 缺省归一为 '')。 */
export function draftsFromConfig(config: ChipsConfig): ChipDraft[] {
  return config.chips.map(chip => ({
    id: chip.id,
    title: chip.title,
    kickoff: chip.kickoff,
    note: chip.note ?? '',
    enabled: chip.enabled,
    editing: false,
  }))
}

/** 草稿行 → 落盘条目(trim;note 空串归一为省略)。 */
export function draftToChip(draft: ChipDraft): ChipConfig {
  const note = draft.note.trim()
  return {
    id: draft.id,
    title: draft.title.trim(),
    kickoff: draft.kickoff.trim(),
    ...(note !== '' ? { note } : {}),
    enabled: draft.enabled,
  }
}

/** 草稿全量 → 待存配置(revision 由调用方回填)。 */
export function draftsToConfig(visible: boolean, drafts: readonly ChipDraft[], revision: number): ChipsConfig {
  return { revision, visible, chips: drafts.map(draftToChip) }
}

/**
 * 脏检查(合并保存口径):草稿(trim 归一后)与已存配置逐项比对——条目内容、
 * 顺序、启停、条数、总开关任一不同即脏。saved=null(未载入)恒不脏。
 */
export function chipsDirty(saved: ChipsConfig | null, visible: boolean, drafts: readonly ChipDraft[]): boolean {
  if (saved === null) return false
  if (saved.visible !== visible) return true
  if (saved.chips.length !== drafts.length) return true
  return drafts.some((draft, index) => {
    const chip = saved.chips[index]
    if (chip === undefined) return true
    const next = draftToChip(draft)
    return chip.id !== next.id
      || chip.title !== next.title
      || chip.kickoff !== next.kickoff
      || (chip.note ?? '') !== (next.note ?? '')
      || chip.enabled !== next.enabled
  })
}

/**
 * 保存前问题检查:返回第一条中文问题文案;null=可保存。与 chips.ts 服务端
 * 校验同一口径(CHIP_LIMITS 共用常量),把 400 挡在按下保存之前。
 */
export function firstDraftIssue(drafts: readonly ChipDraft[]): string | null {
  if (drafts.length > CHIP_LIMITS.count) {
    return `条目数超上限(最多 ${CHIP_LIMITS.count} 条)。`
  }
  for (const draft of drafts) {
    if (draft.title.trim() === '' || draft.kickoff.trim() === '') {
      return `「${draft.title.trim() === '' ? '未命名流程' : draft.title.trim()}」缺少标题或启动语。`
    }
    if (draft.title.trim().length > CHIP_LIMITS.title) {
      return `「${draft.title.trim().slice(0, CHIP_LIMITS.title)}…」标题超过 ${CHIP_LIMITS.title} 字。`
    }
    if (draft.kickoff.trim().length > CHIP_LIMITS.kickoff) {
      return `「${draft.title.trim()}」启动语超过 ${CHIP_LIMITS.kickoff} 字。`
    }
    if (draft.note.trim().length > CHIP_LIMITS.note) {
      return `「${draft.title.trim()}」备注超过 ${CHIP_LIMITS.note} 字。`
    }
  }
  return null
}

/** 客户端条目 id:c- + 时间戳 base36 + 随机尾(同草稿列表内唯一;服务端再验全局唯一)。 */
export function genChipId(): string {
  const rand = Math.random().toString(36).slice(2, 8)
  return `c-${Date.now().toString(36)}${rand === '' ? '0' : rand}`
}
