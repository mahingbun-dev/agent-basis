/**
 * 内容派生的稳定标识:相等输入恒产相同 id。
 *
 * 设计依据:34 号 §2.1 ids 行;24 号 §5.3-1(幂等 id 不变量)、27 号 §3.2-②(幂等键机制:重复投递
 * 收敛为一单的数据基础)。纯函数,仅用 Node 标准库 crypto,零外部依赖。
 */
import { createHash } from 'node:crypto'

/** 对全部入参字符串做 sha256,取十六进制前 32 位;同内容同 id,跨进程稳定。 */
export function key(...values: string[]): string {
  return createHash('sha256').update(JSON.stringify(values)).digest('hex').slice(0, 32)
}
