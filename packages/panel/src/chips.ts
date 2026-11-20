/**
 * 流程启动条配置(2026-11-20,每用户各自一套)——**纯模块**:模型、防御性校验、
 * 可见性谓词、默认值。浏览器面板(src/client)直接打包引入,不依赖 node 内建;
 * 落盘读写在 chips-store.ts(node:fs),经 access 守卫通道
 * (/api/eternaPanel/chips|chipsSave)按 cookie 身份路由到本人用户根。
 *
 * 初始为空(用户拍板 2026-11-20):缺文件/损坏一律 fail-closed 回默认空配置,
 * 触发条隐藏;用户在设置分区「流程启动条」自行增删(可从内置模板导入)。
 */

/** 一条触发条条目(用户自定义;id 由客户端生成,服务端只验格式与唯一性)。 */
export interface ChipConfig {
  /** 稳定 id(客户端 DOM 锚点 data-eterna-panel-chip 用;[A-Za-z0-9_-]{1,64})。 */
  readonly id: string
  /** chip 短标题(1..24 字符,trim 后)。 */
  readonly title: string
  /** 流程启动语(点击 chip 写入草稿并自动发送;1..500 字符,trim 后)。 */
  readonly kickoff: string
  /** 备注(可选;设置分区行卡说明,≤120 字符)。 */
  readonly note?: string
  /** 启用开关(false=保留配置但不在条上出现)。 */
  readonly enabled: boolean
}

/** 每用户触发条配置(revision 为乐观并发版本号,保存 CAS 用)。 */
export interface ChipsConfig {
  readonly revision: number
  /** 总开关(false=整条隐藏,条目配置保留)。 */
  readonly visible: boolean
  /** 条目有序列表(数组序即展示序)。 */
  readonly chips: readonly ChipConfig[]
}

/** 字段上限(客户端与服务端共用同一常量,校验口径一致)。 */
export const CHIP_LIMITS = {
  /** 条目数上限。 */
  count: 12,
  /** title 长度上限。 */
  title: 24,
  /** kickoff 长度上限。 */
  kickoff: 500,
  /** note 长度上限。 */
  note: 120,
} as const

/** id 格式(客户端生成;路径/DOM 锚点安全字符集)。 */
const CHIP_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/

/** 默认配置:空 + 显示开启(空列表时触发条整条隐藏,由可见性谓词兜住)。 */
export const DEFAULT_CHIPS_CONFIG: ChipsConfig = { revision: 0, visible: true, chips: [] }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function validChip(raw: unknown): ChipConfig | undefined {
  if (!isRecord(raw)) return undefined
  const { id, title, kickoff, note, enabled } = raw
  if (typeof id !== 'string' || !CHIP_ID_PATTERN.test(id)) return undefined
  if (typeof title !== 'string' || title.trim() === '' || title.trim().length > CHIP_LIMITS.title) return undefined
  if (typeof kickoff !== 'string' || kickoff.trim() === '' || kickoff.trim().length > CHIP_LIMITS.kickoff) return undefined
  if (note !== undefined && (typeof note !== 'string' || note.trim().length > CHIP_LIMITS.note)) return undefined
  if (typeof enabled !== 'boolean') return undefined
  const chip: ChipConfig = {
    id,
    title: title.trim(),
    kickoff: kickoff.trim(),
    ...(note !== undefined && note.trim() !== '' ? { note: note.trim() } : {}),
    enabled,
  }
  return chip
}

/**
 * 防御性解析:任意 unknown → ChipsConfig | undefined(结构不符/越限即拒,
 * 不做容错截断——触发条是用户显式配置,坏形不静默改写)。
 */
export function parseChipsConfig(raw: unknown): ChipsConfig | undefined {
  if (!isRecord(raw)) return undefined
  const { revision, visible, chips } = raw
  if (typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision < 0) return undefined
  if (typeof visible !== 'boolean') return undefined
  if (!Array.isArray(chips) || chips.length > CHIP_LIMITS.count) return undefined
  const parsed: ChipConfig[] = []
  const seen = new Set<string>()
  for (const entry of chips) {
    const chip = validChip(entry)
    if (chip === undefined) return undefined
    if (seen.has(chip.id)) return undefined
    seen.add(chip.id)
    parsed.push(chip)
  }
  return { revision, visible, chips: parsed }
}

/** 触发条实际呈现的条目:总开关开 且 逐条 enabled;数组序即展示序。 */
export function chipsBarEntries(config: ChipsConfig): readonly ChipConfig[] {
  if (!config.visible) return []
  return config.chips.filter(chip => chip.enabled)
}

/** 保存入参(客户端 wire 形状;chips 为全量列表,数组序即新展示序)。 */
export interface ChipsSaveInput {
  /** 乐观并发版本号(与落盘 revision 不符 → conflict)。 */
  readonly revision: number
  readonly visible: boolean
  readonly chips: readonly ChipConfig[]
}

/** 保存结果(conflict 附当前落盘配置供客户端对齐;invalid 附中文原因)。 */
export type ChipsSaveOutcome =
  | { readonly ok: true; readonly config: ChipsConfig }
  | {
    readonly ok: false
    readonly code: 'conflict' | 'invalid' | 'unavailable'
    readonly message: string
    readonly config?: ChipsConfig
  }

/**
 * 保存入参校验(纯):unknown → ChipsSaveInput | undefined。结构与逐条校验同
 * parseChipsConfig 口径;revision 单独验(允许 0 = 首存)。
 */
export function parseChipsSaveInput(raw: unknown): ChipsSaveInput | undefined {
  if (!isRecord(raw)) return undefined
  const { revision, visible, chips } = raw
  if (typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision < 0) return undefined
  if (typeof visible !== 'boolean') return undefined
  if (!Array.isArray(chips) || chips.length > CHIP_LIMITS.count) return undefined
  const parsed: ChipConfig[] = []
  const seen = new Set<string>()
  for (const entry of chips) {
    const chip = validChip(entry)
    if (chip === undefined) return undefined
    if (seen.has(chip.id)) return undefined
    seen.add(chip.id)
    parsed.push(chip)
  }
  return { revision, visible, chips: parsed }
}
