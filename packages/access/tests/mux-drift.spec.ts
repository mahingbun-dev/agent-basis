/**
 * T2 防漂移 fixture(2026-11-11):上游 typert 全量 mode:'stream' 方法表 −
 * 策略动作清单(GLOBAL∪SESSION∪WORKSPACE)=∅。上游新增流端点而清单未跟时本测试红。
 * 直接读 node_modules 上游包(typert.remote-client.js),锁版 0.2.2-rc.1。
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { GLOBAL_STREAM_ACTIONS, SESSION_STREAM_ACTIONS, WORKSPACE_STREAM_ACTIONS } from '../src/mux.ts'

function findPnpmRoot(): string {
  let dir = new URL('..', import.meta.url).pathname
  for (let i = 0; i < 6; i++) {
    const candidate = join(dir, 'node_modules', '.pnpm')
    if (existsSync(candidate)) return candidate
    dir = join(dir, '..')
  }
  throw new Error('找不到 node_modules/.pnpm(上游包根)')
}

/** 上游全部 mode:'stream' 的 Remote 方法('ns/method')。 */
function upstreamStreamMethods(): string[] {
  const root = findPnpmRoot()
  const methods = new Set<string>()
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    // .pnpm 目录名形如 @deepseek-ai+dsh-api-session-controller@0.2.2-rc.1_<peerhash>
    const nameMatch = /^@deepseek-ai\+([a-z-]+)@/.exec(entry.name)
    const pkgName = nameMatch?.[1]
    if (pkgName === undefined || !pkgName.startsWith('dsh-api-')) continue
    const pkgDir = join(root, entry.name, 'node_modules', '@deepseek-ai', pkgName)
    const file = join(pkgDir, 'lib', 'typert.remote-client.js')
    if (!existsSync(file)) continue
    const text = readFileSync(file, 'utf8')
    const pattern = /'([a-zA-Z]+\/[a-zA-Z]+)': \{[\s\S]{0,800}?mode: 'stream'/g
    for (const match of text.matchAll(pattern)) methods.add(match[1] ?? '')
  }
  return [...methods].sort()
}

const COVERED = new Set([...GLOBAL_STREAM_ACTIONS, ...SESSION_STREAM_ACTIONS, ...WORKSPACE_STREAM_ACTIONS])

/** 上游 decide 链豁免动作(principal.kind==='owner' 或 action===FOLLOW_ACTION 恒 allow,
 *  dsh-api-remote-access lib/index.js:224)——不需策略绑定。 */
const UPSTREAM_EXEMPT = new Set(['remoteAccess/follow'])

describe('T2 防漂移:上游流方法表全覆盖', () => {
  const upstream = upstreamStreamMethods()

  it('上游流方法清单可解析且含已知核心集(空表=解析失效,测试本身失去意义)', () => {
    const core = ['workspace/follow', 'session/follow', 'session/observeState', 'session/control', 'terminal/attach', 'terminal/retain']
    for (const method of core) expect(upstream).toContain(method)
  })

  it('上游全部流方法 ∈ 策略动作清单(差集=∅)', () => {
    const missing = upstream.filter(m => !COVERED.has(m) && !UPSTREAM_EXEMPT.has(m))
    expect(missing).toEqual([])
  })

  it('策略清单无僵尸动作(每个动作都在上游流方法表内——防清单含未注册动作静默放宽)', () => {
    const upstreamSet = new Set(upstream)
    const zombie = [...COVERED].filter(a => !upstreamSet.has(a))
    expect(zombie).toEqual([])
  })
})
