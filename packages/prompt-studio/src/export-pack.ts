/**
 * 导出包校验器(T7.3 ①:导入侧 schemaVersion + checksum 强校验,不符即拒收)。
 *
 * 从 promptImport 的内联校验抽出为纯函数面:vitest 逐条钉住(坏形状/schemaVersion
 * 不支持/checksum 篡改),宿主 prompt-import 端点与任何复用方共用同一套口径。
 * 硬校验字段=计划书 §6 T7.3 口径:schemaVersion=1 + persona 字符串 + checksum
 * sha256hex(UTF-8);导出方/时刻等元数据字段不做硬校验(读侧不需要,历史包宽容)。
 */
import { sha256Hex } from './checksum.ts'
import type { PromptExportPack } from './types.ts'

/** 校验通过:返回收窄后的 pack(运行时载荷按 unknown 收窄)。 */
export type ExportPackValidation =
  | { readonly ok: true; readonly pack: PromptExportPack }
  | { readonly ok: false; readonly issues: readonly string[] }

/** 校验导入包(不校验 persona 文本本身——内容规则由 validatePersonaText 统一把守)。 */
export function validateExportPack(raw: unknown): ExportPackValidation {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, issues: ['导入包缺失或不是 JSON 对象(需含 schemaVersion/persona/checksum)'] }
  }
  const pack = raw as Record<string, unknown>
  const issues: string[] = []
  if (pack['schemaVersion'] !== 1) {
    issues.push(`导入包 schemaVersion 不支持:${String(pack['schemaVersion'])}(仅支持 1)`)
  }
  if (typeof pack['persona'] !== 'string') {
    issues.push('导入包缺 persona 字段(或非字符串)')
  }
  if (typeof pack['checksum'] !== 'string') {
    issues.push('导入包缺 checksum 字段(或非字符串)')
  }
  if (issues.length > 0) return { ok: false, issues }
  const persona = pack['persona'] as string
  const checksum = pack['checksum'] as string
  const actual = sha256Hex(persona)
  if (actual !== checksum) {
    return { ok: false, issues: [`导入包校验和不符:期望 ${checksum},实际 ${actual}(persona 与 checksum 不配套,拒收)`] }
  }
  return {
    ok: true,
    pack: {
      schemaVersion: 1,
      exportedAt: typeof pack['exportedAt'] === 'string' ? pack['exportedAt'] : '',
      exportedBy: typeof pack['exportedBy'] === 'string' ? pack['exportedBy'] : '',
      sourceVersionId: typeof pack['sourceVersionId'] === 'string' ? pack['sourceVersionId'] : '',
      persona,
      checksum,
    },
  }
}
