/**
 * 提供方字段泄漏防护(29 §2.1「禁提供方字段透传」的运行时防线)。
 *
 * 双向检查(36 号 K1.3 guards.ts):
 * ① 顶层键 ∈ 该块类型的白名单(块协议字段集草案,36 号 §2.3;O-2 评审前 draft);
 * ② 任意深度不含契约禁入键(FORBIDDEN_KEYS:encrypted_content/signature/web_search_usage
 *    等)——防提供方字段借嵌套值回归泄漏。
 *
 * 块序列化(JSON)是渲染与 prompt 的唯一消费物,序列化前必须过本守卫;
 * K2.4 公共金集断言对全部块样例走同一守卫(G2-B3)。
 */
import { FORBIDDEN_KEYS } from '../contract/forbidden.ts'
import type { ForbiddenKeyViolation } from '../contract/forbidden.ts'
import type { BlockType, NormalizedBlock } from './types.ts'

/** 各块类型的保留键白名单(序列化样例的键名上限;白名单外零泄漏)。 */
export const BLOCK_KEY_WHITELIST: Readonly<Record<BlockType, ReadonlySet<string>>> = {
  source: new Set(['type', 'title', 'url', 'summary', 'publishTime', 'siteName', 'icon']),
  citation: new Set(['type', 'index', 'sourceIndex']),
  search_step: new Set(['type', 'step', 'action', 'query', 'url', 'status', 'detail']),
  attachment_ref: new Set(['type', 'fileId', 'name']),
}

/** 一处泄漏命中(白名单外键或任意深度的禁入键)。 */
export interface BlockLeak {
  /** 命中路径(JSONPath 风格,根为 `$`)。 */
  readonly path: string
  readonly key: string
  readonly reason: 'not-whitelisted' | 'forbidden'
  /** reason=forbidden 时附禁入来源(provider/openai)。 */
  readonly source?: ForbiddenKeyViolation['source']
}

function walkNested(value: unknown, path: string, out: BlockLeak[]): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      walkNested(item, `${path}[${index}]`, out)
    })
    return
  }
  if (value !== null && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      if (FORBIDDEN_KEYS.has(key)) {
        out.push({
          path: `${path}.${key}`,
          key,
          reason: 'forbidden',
          source: key === 'encrypted_content' || key === 'signature' || key === 'web_search_usage' ? 'provider' : 'openai',
        })
      }
      walkNested(child, `${path}.${key}`, out)
    }
  }
}

/**
 * 找出块序列中的全部泄漏:白名单外顶层键 + 任意深度禁入键。
 * 输入不限于强类型 NormalizedBlock(防未经类型收口的自由拼装对象混入)。
 */
export function findBlockLeaks(blocks: readonly unknown[]): BlockLeak[] {
  const out: BlockLeak[] = []
  blocks.forEach((block, blockIndex) => {
    const base = `$[${blockIndex}]`
    if (block === null || typeof block !== 'object' || Array.isArray(block)) {
      out.push({ path: base, key: '', reason: 'not-whitelisted' })
      return
    }
    const record = block as Record<string, unknown>
    const type = record['type']
    if (typeof type !== 'string' || !(type in BLOCK_KEY_WHITELIST)) {
      out.push({ path: `${base}.type`, key: 'type', reason: 'not-whitelisted' })
      return
    }
    const whitelist = BLOCK_KEY_WHITELIST[type as BlockType]
    for (const key of Object.keys(record)) {
      if (!whitelist.has(key)) {
        out.push({ path: `${base}.${key}`, key, reason: 'not-whitelisted' })
      }
    }
    walkNested(record, base, out)
  })
  return out
}

/** 块泄漏错误(含全部命中明细)。 */
export class BlockLeakError extends Error {
  readonly leaks: readonly BlockLeak[]

  constructor(leaks: readonly BlockLeak[]) {
    super(
      `规范化块泄漏: ${leaks.map(l => `${l.path} ${l.reason === 'forbidden' ? '禁入键' : '白名单外键'} "${l.key}"`).join('; ')}`
      + ' —— 禁提供方字段透传(29 §2.1)',
    )
    this.name = 'BlockLeakError'
    this.leaks = leaks
  }
}

/** 断言块序列可序列化(白名单+禁入键双检);命中即抛 BlockLeakError。 */
export function assertBlocksSerializable(blocks: readonly NormalizedBlock[] | readonly unknown[]): void {
  const leaks = findBlockLeaks(blocks)
  if (leaks.length > 0) throw new BlockLeakError(leaks)
}

/** 序列化块序列(渲染与 prompt 的唯一消费物):先过守卫,再产 JSON 字符串。 */
export function serializeBlocks(blocks: readonly NormalizedBlock[] | readonly unknown[]): string {
  assertBlocksSerializable(blocks)
  return JSON.stringify(blocks)
}
