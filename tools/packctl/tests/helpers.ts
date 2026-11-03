/**
 * 测试公共件:tmp 根目录 + 基于 pack init 产物构造被测 pack。
 * 全部真实落盘(agent-basis 的验收门要求真实运行;不 mock 文件系统)。
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { initPack } from '../src/init.ts'

export interface TmpRoot {
  readonly root: string
  cleanup: () => void
}

export function makeTmpRoot(prefix = 'packctl-'): TmpRoot {
  const root = mkdtempSync(join(tmpdir(), prefix))
  return { root, cleanup: () => { rmSync(root, { recursive: true, force: true }) } }
}

/** init 一个 demo 包并返回其根目录(断言 init 本身成功,失败即测试崩)。 */
export function makePack(root: string, industry = 'demo'): string {
  const { result, findings } = initPack(industry, { rootDir: root })
  if (result === undefined || findings.length > 0) {
    throw new Error(`initPack 失败: ${JSON.stringify(findings)}`)
  }
  return result.packDir
}
