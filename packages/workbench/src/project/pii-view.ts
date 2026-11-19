/**
 * 展开全文的 PII 展示层过滤(38 号 T10/L-4/L-5;30 号 §7-4 拍板:展开全文过
 * governance pii.ts 可插拔正则;原始全文已在 audit NDJSON,展示层**只过滤
 * 不删改**——用 redact(脱敏仍可写),不用 assertClean(不拦展示),B5)。
 */
// 浏览器安全子路径(pii.ts 自包含无 node 依赖;governance 包 barrel 含
// sink.ts 的 node:fs 导入,进不了浏览器 bundle——子路径导出同 @eterna/ui
// ./icons 先例)。行为面不变:同一 pii.ts 源文件,L-4 仍走 governance redact。
import { PiiFilter, type PiiFinding } from '@eterna/governance/pii'
import type { LogSegment, WorkbenchLogEntry } from '../types.ts'

/** 共享过滤器实例(缺省通用四类模式:手机号/身份证号/邮箱/IPv4)。 */
export const piiFilter = new PiiFilter()

export interface RedactedSegments {
  readonly segments: readonly LogSegment[]
  readonly findings: readonly PiiFinding[]
}

/** 单段脱敏:命中片段替换为 `[PII:<patternId>]`(governance redact 契约),mono/num 标记保留。 */
export function redactSegment(segment: LogSegment, filter: PiiFilter = piiFilter): RedactedSegments {
  const result = filter.redact(segment.text)
  return {
    segments: [{ ...segment, text: result.text }],
    findings: result.findings,
  }
}

/** 展开全文逐段脱敏(段落结构原样;原文不改——redact 返回新串,入口文本不动)。 */
export function redactParagraphs(
  paragraphs: readonly (readonly LogSegment[])[],
  filter: PiiFilter = piiFilter,
): { readonly paragraphs: readonly (readonly LogSegment[])[]; readonly findings: readonly PiiFinding[] } {
  const findings: PiiFinding[] = []
  const next = paragraphs.map((paragraph) => {
    const redacted: LogSegment[] = []
    for (const segment of paragraph) {
      const result = redactSegment(segment, filter)
      redacted.push(...result.segments)
      findings.push(...result.findings)
    }
    return redacted
  })
  return { paragraphs: next, findings }
}

/** 单条日志展开全文的展示面(无 full 的条目返回 undefined)。 */
export function redactedFull(entry: WorkbenchLogEntry, filter: PiiFilter = piiFilter): readonly (readonly LogSegment[])[] | undefined {
  if (entry.full === undefined) return undefined
  return redactParagraphs(entry.full, filter).paragraphs
}
