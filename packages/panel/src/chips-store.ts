/**
 * 流程启动条配置落盘(2026-11-20):每用户一份 JSON,路径由调用方(access 守卫)
 * 显式给出——守卫按 cookie 身份解析 userRoot(<tenantRoot>/<account>),本模块
 * 只对 root 做 mkdir + 原子写,不做任何身份/租户推导(路径语义单源在 access)。
 *
 * fail-closed:缺文件/损坏 JSON → 默认空配置(触发条隐藏,不炸 composer);
 * 原子写 = temp + rename(prompt-studio version-store 先例),无残留 temp。
 * CAS:保存入参 revision ≠ 落盘 revision → conflict 附当前配置。
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import {
  DEFAULT_CHIPS_CONFIG, parseChipsConfig, parseChipsSaveInput,
  type ChipsConfig, type ChipsSaveOutcome,
} from './chips.ts'

export { DEFAULT_CHIPS_CONFIG, parseChipsConfig } from './chips.ts'
export type { ChipConfig, ChipsConfig, ChipsSaveOutcome } from './chips.ts'

/** 配置文件位置:<userRoot>/.eterna/panel/chips.json(与 tasks 的 .eterna/ 数据面同域)。 */
export function chipsFilePath(root: string): string {
  return join(root, '.eterna', 'panel', 'chips.json')
}

/** 读配置:缺文件/损坏/结构不符 → 默认空配置(fail-closed,绝不抛给调用方)。 */
export function readChipsConfig(root: string): ChipsConfig {
  const file = chipsFilePath(root)
  let text: string
  try {
    text = readFileSync(file, 'utf8')
  } catch {
    return DEFAULT_CHIPS_CONFIG
  }
  try {
    return parseChipsConfig(JSON.parse(text)) ?? DEFAULT_CHIPS_CONFIG
  } catch {
    return DEFAULT_CHIPS_CONFIG
  }
}

/**
 * 保存(CAS):入参经 parseChipsSaveInput 严格校验;revision 与落盘不符 →
 * conflict 附当前配置(客户端载入后核对再存);成功原子写 revision+1。
 * root 由守卫保证存在(userRootFor 缺目录则建),这里仍 recursive mkdir 兜底。
 */
export function saveChipsConfig(root: string, input: unknown): ChipsSaveOutcome {
  const parsed = parseChipsSaveInput(input)
  if (parsed === undefined) {
    return { ok: false, code: 'invalid', message: '触发条配置格式不正确(检查标题/启动语长度、条目数与 id 唯一性)' }
  }
  const current = readChipsConfig(root)
  if (parsed.revision !== current.revision) {
    return { ok: false, code: 'conflict', message: '配置已被其他窗口修改', config: current }
  }
  const next: ChipsConfig = { revision: current.revision + 1, visible: parsed.visible, chips: parsed.chips }
  const file = chipsFilePath(root)
  const tmp = `${file}.${process.pid}.tmp`
  try {
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
    renameSync(tmp, file)
  } catch (error) {
    return { ok: false, code: 'unavailable', message: `配置写入失败:${error instanceof Error ? error.message : String(error)}` }
  }
  return { ok: true, config: next }
}
