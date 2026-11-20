/**
 * rc.5 B14 系统层防漂移(2026-11-20,T25 / 50 §3.4.1 / 47 B14):
 * 直接读锁版上游 `@deepseek-ai/dsh-mcp-manager` 的 Remote 方法表工件
 * (`lib/typert.remote-client.js`,rc.5 由 typert generator 生成),锁死三件事:
 *
 * 1. 上游 Remote 面**恰好** {mcpManager/watch, mcpManager/restart, mcpManager/probe}
 *    —— 写配置走 Settings/configEditor,上游没有直接写 RPC(47 §B14「写配置走
 *    Settings/configEditor,无直接写 RPC」);新增/改名未跟策略清单即红。
 * 2. 归位:watch=stream(见描述符 `mode: 'stream'`),restart/probe=unary(描述符
 *    无 mode 字段)——上游改模式而 mux 清单不跟即红。
 * 3. 策略面:watch ∈ GLOBAL_STREAM + ADMIN_ONLY_STREAM;restart/probe ∈
 *    GLOBAL_UNARY + ADMIN_ONLY_UNARY;admin-only ⊆ 全量,且不含任何资源绑定
 *    (会话/工作区/事件)动作——系统层 MCP 是 Host 全局机群,只能绑 global。
 *
 * 资源绑定动作集取 mux.ts 的会话/工作区/事件清单(网关按资源判定时唯一可命中的面)。
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  ADMIN_ONLY_STREAM_ACTIONS,
  ADMIN_ONLY_UNARY_ACTIONS,
  GLOBAL_STREAM_ACTIONS,
  GLOBAL_UNARY_ACTIONS,
  SESSION_EVENT_ACTIONS,
  SESSION_STREAM_ACTIONS,
  SESSION_UNARY_ACTIONS,
  WORKSPACE_STREAM_ACTIONS,
  WORKSPACE_UNARY_ACTIONS,
} from '../src/mux.ts'

const MCP_MANAGER_PACKAGE = '@deepseek-ai/dsh-mcp-manager'
/** 上游 Remote 面全量(47 §B14 表 + rc.5 实读 typert.remote-client.js)。 */
const EXPECTED_REMOTE_METHODS = ['mcpManager/probe', 'mcpManager/restart', 'mcpManager/watch'] as const
/** 系统层管理动作(全部 admin-only):stream 半 + unary 半。 */
const EXPECTED_STREAM_METHODS = ['mcpManager/watch'] as const
const EXPECTED_UNARY_METHODS = ['mcpManager/probe', 'mcpManager/restart'] as const

/** 资源绑定动作面:这些清单里的动作按会话/工作区资源判定,admin-only 门禁入。 */
const RESOURCE_BOUND_ACTIONS: ReadonlySet<string> = new Set([
  ...SESSION_STREAM_ACTIONS,
  ...SESSION_UNARY_ACTIONS,
  ...SESSION_EVENT_ACTIONS,
  ...WORKSPACE_STREAM_ACTIONS,
  ...WORKSPACE_UNARY_ACTIONS,
])

function findPnpmRoot(): string {
  let dir = new URL('..', import.meta.url).pathname
  for (let i = 0; i < 6; i++) {
    const candidate = join(dir, 'node_modules', '.pnpm')
    if (existsSync(candidate)) return candidate
    dir = join(dir, '..')
  }
  throw new Error('找不到 node_modules/.pnpm(上游包根)')
}

interface UpstreamMcpManagerTable {
  readonly packageDir: string
  readonly packageName: string
  readonly version: string
  /** action → 描述符原文(自方法键起至下一方法键/文件尾)。 */
  readonly methods: Map<string, string>
}

/** 定位 .pnpm 内的锁版 mcp-manager(pnpm 目录名形如
 *  `@deepseek-ai+dsh-mcp-manager@0.2.2-rc.5_<peerhash>`;多 peer 变体同源,逐份核对)。 */
function upstreamMcpManagerTables(): UpstreamMcpManagerTable[] {
  const root = findPnpmRoot()
  const tables: UpstreamMcpManagerTable[] = []
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.name.startsWith('@deepseek-ai+dsh-mcp-manager@')) continue
    const packageDir = join(root, entry.name, 'node_modules', '@deepseek-ai', 'dsh-mcp-manager')
    const manifestPath = join(packageDir, 'package.json')
    const remotePath = join(packageDir, 'lib', 'typert.remote-client.js')
    if (!existsSync(manifestPath) || !existsSync(remotePath)) continue
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { name?: string; version?: string }
    tables.push({
      packageDir,
      packageName: manifest.name ?? '',
      version: manifest.version ?? '',
      methods: parseRemoteMethods(readFileSync(remotePath, 'utf8')),
    })
  }
  return tables
}

/** 从 typert remote-client 工件解析 `'<ns>/<method>': { … }` 段(缩进 4 空格的顶层方法键;
 *  嵌套 schema 键不含 `/`,不会误命中)。与 mux-drift 同一解析口径。 */
function parseRemoteMethods(text: string): Map<string, string> {
  const lines = text.split('\n')
  const keyRe = /^\s{4}'([\w-]+\/[\w-]+)': \{/
  const segments = new Map<string, string>()
  let current: string | undefined
  let start = -1
  for (let i = 0; i < lines.length; i++) {
    const key = keyRe.exec(lines[i] ?? '')?.[1]
    if (key === undefined) continue
    if (current !== undefined) segments.set(current, lines.slice(start, i).join('\n'))
    current = key
    start = i
  }
  if (current !== undefined) segments.set(current, lines.slice(start).join('\n'))
  return segments
}

const tables = upstreamMcpManagerTables()
const primary = tables[0]

/** 上游 Remote 动作集(取首份变体;多份一致性由下方用例断言)。 */
const upstreamMethods = new Set(primary?.methods.keys() ?? [])

/** 上游 stream 动作集:描述符显式 `mode: 'stream'`。 */
const upstreamStreamMethods = new Set(
  [...(primary?.methods.entries() ?? [])].filter(([, segment]) => /mode: 'stream'/.test(segment)).map(([action]) => action),
)

describe('rc.5 B14 防漂移:上游 dsh-mcp-manager Remote 方法表', () => {
  it('锁版包可解析且版本=0.2.2-rc.5(解析失效=后续断言失去意义)', () => {
    expect(tables.length, '找不到 @deepseek-ai/dsh-mcp-manager(rc.5 锁版;p4 依赖未装)').toBeGreaterThan(0)
    for (const table of tables) {
      expect(table.packageName).toBe(MCP_MANAGER_PACKAGE)
      expect(table.version, `${table.packageDir} 版本漂移`).toBe('0.2.2-rc.5')
      expect(table.methods.size, `${table.packageDir} Remote 方法表解析为空`).toBeGreaterThan(0)
    }
  })

  it('上游 Remote 面恰好 {watch,restart,probe}(写配置无直接 RPC,新增方法即红)', () => {
    for (const table of tables) {
      expect([...table.methods.keys()].sort(), `${table.packageDir} Remote 方法集漂移`).toEqual([...EXPECTED_REMOTE_METHODS].sort())
    }
  })

  it('上游方法模式:watch=stream,restart/probe=unary(描述符无 mode 字段)', () => {
    expect(upstreamMethods.has('mcpManager/watch')).toBe(true)
    for (const action of EXPECTED_STREAM_METHODS) {
      expect(upstreamStreamMethods.has(action), `${action} 应在上游声明 mode:'stream'`).toBe(true)
    }
    for (const action of EXPECTED_UNARY_METHODS) {
      expect(upstreamStreamMethods.has(action), `${action} 不应是流方法(上游改模式需复核策略归位)`).toBe(false)
    }
  })

  it('watch ∈ GLOBAL_STREAM + ADMIN_ONLY_STREAM(系统层连接状态流仅 admin)', () => {
    for (const action of EXPECTED_STREAM_METHODS) {
      expect(GLOBAL_STREAM_ACTIONS, `${action} 缺 global 流授予`).toContain(action)
      expect(ADMIN_ONLY_STREAM_ACTIONS, `${action} 缺 admin-only 收窄(非 admin 会收到全租户服务器清单)`).toContain(action)
    }
  })

  it('restart/probe ∈ GLOBAL_UNARY + ADMIN_ONLY_UNARY(系统层管理动作仅 admin)', () => {
    for (const action of EXPECTED_UNARY_METHODS) {
      expect(GLOBAL_UNARY_ACTIONS, `${action} 缺 global 一元授予`).toContain(action)
      expect(ADMIN_ONLY_UNARY_ACTIONS, `${action} 缺 admin-only 收窄`).toContain(action)
    }
  })

  it('mcpManager 动作全部落在全局面(会话/工作区/事件清单零命中)', () => {
    for (const action of EXPECTED_REMOTE_METHODS) {
      expect(RESOURCE_BOUND_ACTIONS.has(action), `${action} 误入资源绑定清单(系统层 MCP 是 Host 全局机群)`).toBe(false)
    }
  })

  it('admin-only ⊆ 全量(只收窄不放宽),且不含任何资源绑定动作', () => {
    for (const action of ADMIN_ONLY_UNARY_ACTIONS) {
      expect(GLOBAL_UNARY_ACTIONS, `ADMIN_ONLY_UNARY ${action} 不在 GLOBAL_UNARY(引入清单外动作)`).toContain(action)
    }
    for (const action of ADMIN_ONLY_STREAM_ACTIONS) {
      expect(GLOBAL_STREAM_ACTIONS, `ADMIN_ONLY_STREAM ${action} 不在 GLOBAL_STREAM(引入清单外动作)`).toContain(action)
    }
    for (const action of [...ADMIN_ONLY_UNARY_ACTIONS, ...ADMIN_ONLY_STREAM_ACTIONS]) {
      expect(RESOURCE_BOUND_ACTIONS.has(action), `admin-only ${action} 是资源绑定动作(只谈全局面)`).toBe(false)
    }
  })

  it('admin-only 的 mcpManager 半恰好等于上游全量(三个动作全部收窄,无遗漏/无越界)', () => {
    expect(ADMIN_ONLY_STREAM_ACTIONS.filter(action => action.startsWith('mcpManager/')).sort())
      .toEqual([...EXPECTED_STREAM_METHODS].sort())
    expect(ADMIN_ONLY_UNARY_ACTIONS.filter(action => action.startsWith('mcpManager/')).sort())
      .toEqual([...EXPECTED_UNARY_METHODS].sort())
  })

  it('策略清单无僵尸 mcpManager 动作(每个动作都在上游 Remote 表内)', () => {
    const policyMcpMethods = [...GLOBAL_STREAM_ACTIONS, ...GLOBAL_UNARY_ACTIONS].filter(action => action.startsWith('mcpManager/'))
    for (const action of policyMcpMethods) {
      expect(upstreamMethods.has(action), `${action} 不在上游 Remote 方法表(改名/下线未跟)`).toBe(true)
    }
    // 反向:上游每个 mcpManager 动作都被策略面接住(不漏授)
    for (const action of EXPECTED_REMOTE_METHODS) {
      expect([...GLOBAL_STREAM_ACTIONS, ...GLOBAL_UNARY_ACTIONS]).toContain(action)
    }
  })
})
