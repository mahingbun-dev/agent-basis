import { rmSync } from 'node:fs'

/**
 * 有界重试删除:Linux CI 实测(2026-11-11,PR #21)dispose()/测试体结束后仍有
 * in-flight 异步落盘(审计/快照/patch 写)与 rmSync 递归删除赛跑 → ENOTEMPTY
 * (errno 39,syscall rm);macOS 时序下未暴露。20 次×25ms 足以让尾写落地,
 * 仍失败则如实抛出(不吞错)。所有测试临时目录清理统一走这里。
 */
export async function rmRetry(target: string): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      rmSync(target, { recursive: true, force: true })
      return
    } catch (error) {
      if (attempt >= 20) throw error
      await new Promise((resolve) => { setTimeout(resolve, 25) })
    }
  }
}
