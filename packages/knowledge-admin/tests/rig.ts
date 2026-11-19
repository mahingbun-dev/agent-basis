/**
 * 测试脚手架:临时租户根 + 独立 adminHome + 可控时钟 + 可控依赖注入。
 *
 * 纪律(与生产一致):
 * - 每个用例一个临时目录(`/tmp` 由沙箱允许的临时区),用例结束递归删除;
 * - **不碰任何真实凭据/access users.db**;凭据面用内存假体;
 * - 时钟固定到 2026-11-18 起,`paginate`/审计断言可复现。
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { KnowledgeAdminCaller } from '../src/types.ts'
import type { KnowledgeAdminPluginConfig } from '../src/config.ts'
import type { KnowledgeAdminServiceDeps } from '../src/service.ts'
import type { DeepWikiFetch, DeepWikiFetchResponse } from '../src/deepwiki.ts'

/** 测试上下文(临时路径 + 服务依赖)。 */
export interface TestRig {
  readonly root: string
  readonly tenantRoot: string
  readonly adminHome: string
  readonly env: NodeJS.ProcessEnv
  readonly cwd: string
  readonly config: KnowledgeAdminPluginConfig
  /** 依赖注入(用例可覆盖 get/fetch/runProcess)。 */
  deps(override?: KnowledgeAdminServiceDeps): KnowledgeAdminServiceDeps
  cleanup(): void
}

/** 建临时 rig(调用方负责 cleanup)。 */
export function createRig(): TestRig {
  const root = mkdtempSync(join(tmpdir(), 'kh-admin-test-'))
  const tenantRoot = join(root, 'workspaces')
  const adminHome = join(root, 'admin')
  const env: NodeJS.ProcessEnv = { DSH_HOME: root }
  const config: KnowledgeAdminPluginConfig = { tenantRoot, adminHome }
  const deps = (override: KnowledgeAdminServiceDeps = {}): KnowledgeAdminServiceDeps => ({
    config,
    env,
    cwd: root,
    ...override,
  })
  return {
    root,
    tenantRoot,
    adminHome,
    env,
    cwd: root,
    config,
    deps,
    cleanup: (): void => {
      rmSync(root, { recursive: true, force: true })
    },
  }
}

/** 普通账号调用者(缺省 = 真人面板通道;Agent 通道用 agentCaller)。 */
export function userCaller(account: string, userId = 7): KnowledgeAdminCaller {
  return { account, admin: false, userId, human: true }
}

/** 管理员调用者(缺省 = 真人面板通道)。 */
export function adminCaller(account = 'root', userId = 1): KnowledgeAdminCaller {
  return { account, admin: true, userId, human: true }
}

/** Agent 通道调用者(human=false):写入一律 pending、审批 forbidden。 */
export function agentCaller(account: string, admin = false, userId = 7): KnowledgeAdminCaller {
  return { account, admin, userId, human: false }
}

/** 固定时钟(每次调用返回同一时刻 + 可手推)。 */
export function fixedClock(start = '2026-11-18T09:00:00.000Z'): { now(): Date; advance(ms: number): void } {
  let current = Date.parse(start)
  return {
    now: () => new Date(current),
    advance: (ms: number) => { current += ms },
  }
}

/** 可控 fetch 假体:按 (url, 状态码, body) 应答;记录调用次数供断言。 */
export function fakeFetch(routes: Readonly<Record<string, { status: number; body: string }>>): {
  fetch: DeepWikiFetch
  calls: readonly string[]
} {
  const calls: string[] = []
  const fetchImpl: DeepWikiFetch = async (url: string): Promise<DeepWikiFetchResponse> => {
    calls.push(url)
    const match = Object.entries(routes).find(([pattern]) => url.includes(pattern))
    if (match === undefined) {
      return {
        status: 404,
        ok: false,
        text: async () => 'not found',
      }
    }
    const [pattern, route] = match
    void pattern
    return {
      status: route.status,
      ok: route.status >= 200 && route.status < 300,
      text: async () => route.body,
    }
  }
  return { fetch: fetchImpl, calls }
}

/** 不可达 fetch(每次抛网络错)。 */
export function throwingFetch(message = 'connect ECONNREFUSED 127.0.0.1:8001'): DeepWikiFetch {
  return async () => {
    throw new Error(message)
  }
}
