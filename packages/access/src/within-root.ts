/**
 * 根内判定(T1 G4 修复,2026-11-11):双侧 realpath 实解析。
 * tenant 守卫与 sandbox 钳制共用(T3)。
 */
import { realpathSync } from 'node:fs'
import { basename, dirname, join, resolve, sep } from 'node:path'

export function withinRoot(path: string, root: string): boolean {
  // 根内 symlink 指向根外(逃逸)被解析为根外路径而拒绝;外部 symlink 指回本用户根内则放行
  // (无害);指入他人根则解析后不匹配本用户根而拒绝。不存在的路径:向上取最近存在祖先
  // 实解析后拼回尾段(修正 macOS /var→/private/var 等祖先符号链接前缀错配误判)。
  const realish = (p: string): string => {
    let cur = resolve(p)
    const tail: string[] = []
    for (;;) {
      try {
        const real = realpathSync(cur)
        return tail.length === 0 ? real : join(real, ...tail.reverse())
      } catch {
        tail.push(basename(cur))
        const parent = dirname(cur)
        if (parent === cur) return resolve(p)
        cur = parent
      }
    }
  }
  const rp = realish(path)
  const rr = realish(root)
  return rp === rr || rp.startsWith(rr + sep)
}
