/**
 * checksum 与字节数口径(版本记录、导出包共用):sha256 hex、UTF-8 字节。
 */
import { createHash } from 'node:crypto'

/** persona 文本的 sha256 hex(UTF-8 口径;导出包校验和同口径)。 */
export function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

/** UTF-8 字节数(≤64KB 校验口径,对齐 agent-instructions maxBytes)。 */
export function byteLength(text: string): number {
  return Buffer.byteLength(text, 'utf8')
}
