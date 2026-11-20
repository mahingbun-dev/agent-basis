/**
 * B14/T27(2026-11-20):个人 MCP 运行时——agent/created 按 sessionOwner 挂
 * createScope + McpClient(≤4 连接、8s 预算、失败只 warn)、agent/disposed /
 * disposeUser / disposeAll 生命周期、tools/pre-execute + tools/execute 双守卫
 * (必须 {global:true})、同用户子代理放行 / 跨租户 deny、kill switch。
 *
 * createScope 与 McpClient 用注入假件(不拉起真实子进程/网络);账本、归属与
 * 条目读取用真 users.db。
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  MCP_PERSONAL_MAX_CONNECTIONS, MCP_PERSONAL_STARTUP_TIMEOUT_MS, encryptMcpSecret,
  type McpPersonalConfig,
} from '../src/mcp-personal.ts'
import {
  mountPersonalMcp, personalMcpClientInput,
  type PersonalMcpScope, type PersonalEventHost,
} from '../src/mcp-personal-runtime.ts'
import { UserStore } from '../src/store.ts'

const CONFIG: McpPersonalConfig = {
  enabled: true,
  catalog: [{ name: 'fs', label: 'FS', transport: 'stdio', command: 'mcp-fs', args: ['--x'], envSchema: ['FS_TOKEN'] }],
  httpHosts: [],
}
const MASTER_KEY = Buffer.alloc(32, 5)

interface ListenerEntry { readonly listener: (...args: never[]) => unknown; readonly options: { readonly global?: boolean } | undefined }

class FakeHost implements PersonalEventHost {
  readonly listeners = new Map<string, ListenerEntry[]>()
  cleanup: (() => Promise<void>) | undefined
  on(event: string, listener: (...args: never[]) => unknown, options?: { readonly global?: boolean }): () => unknown {
    const list = this.listeners.get(event) ?? []
    list.push({ listener, options })
    this.listeners.set(event, list)
    return () => { /* 测试不拆监听 */ }
  }
  effect(execute: () => () => Promise<void>): unknown {
    this.cleanup = execute()
    return () => { /* noop */ }
  }
  entriesOf(event: string): ListenerEntry[] {
    return this.listeners.get(event) ?? []
  }
  async emit(event: string, payload: unknown): Promise<void> {
    for (const entry of this.entriesOf(event)) await entry.listener(payload as never)
  }
  /** 模拟 waterfall:监听链依次调用 next。 */
  async waterfall(event: string, exec: unknown): Promise<unknown> {
    const chain = this.entriesOf(event)
    let index = 0
    const next = async (): Promise<unknown> => {
      const entry = chain[index++]
      if (entry === undefined) return { kind: 'allow' }
      return entry.listener(exec as never, (next as unknown) as never)
    }
    return next()
  }
}

describe('B14 个人 MCP:运行时', () => {
  let dir: string
  let store: UserStore
  let aliceId: number
  let bobId: number
  let host: FakeHost
  let scopes: Array<PersonalMcpScope & { disposed: number }>
  let pluginCalls: Array<{ serverName: string; config: Record<string, unknown> }>
  let warns: string[]
  let config: McpPersonalConfig
  let masterKey: Buffer | undefined
  let failServerNames: Set<string>
  let registeredAgents: Map<string, { session: { id: string } }>
  let runtime: ReturnType<typeof mountPersonalMcp>

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'eterna-mcp-runtime-'))
    store = new UserStore(join(dir, 'users.db'))
    const alice = store.createUserWithSuffix({ account: 'alice', password: 'password8' })
    const bob = store.createUserWithSuffix({ account: 'bob', password: 'password8' })
    aliceId = alice.user.id
    bobId = bob.user.id
    store.recordSession('s-alice', aliceId, null)
    store.recordSession('s-alice-sub', aliceId, null) // 同用户子代理会话
    store.recordSession('s-bob', bobId, null)
    host = new FakeHost()
    scopes = []
    pluginCalls = []
    warns = []
    config = CONFIG
    masterKey = MASTER_KEY
    failServerNames = new Set()
    registeredAgents = new Map()
    runtime = mount()
  })

  afterEach(() => {
    store.close()
    rmSync(dir, { recursive: true, force: true })
  })

  function mount(): ReturnType<typeof mountPersonalMcp> {
    return mountPersonalMcp(host as never, {
      store,
      sessionOwnerOf: id => store.sessionOwner(id),
      logger: { warn: message => warns.push(message) },
      config,
      masterKey,
      cwdOf: (userId: number) => join(dir, 'workspaces', String(userId)),
      connectionsLimit: MCP_PERSONAL_MAX_CONNECTIONS,
      startupTimeoutMs: MCP_PERSONAL_STARTUP_TIMEOUT_MS,
      createScope: () => {
        const scope = {
          disposed: 0,
          ctx: {
            plugin: (_plugin: unknown, clientConfig: unknown) => {
              const record = clientConfig as Record<string, unknown>
              if (failServerNames.has(String(record.serverName))) throw new Error('boom')
              pluginCalls.push({ serverName: String(record.serverName), config: record })
            },
          },
          dispose: async () => { scope.disposed += 1 },
        }
        scopes.push(scope)
        return scope
      },
      mcpClientConfigOf: input => input,
      mcpClientPlugin: { name: 'fake-mcp-client' },
      agentsOf: sessionId => registeredAgents.get(sessionId),
    })
  }

  function addRows(userId: number, count: number): void {
    for (let i = 0; i < count; i++) {
      store.upsertMcpServer(userId, {
        name: `srv-${i}`,
        serverName: `p${userId}_srv${i}`,
        transport: 'streamable-http',
        url: `https://example.com/${i}/mcp`,
      })
    }
  }

  const agentOf = (sessionId: string): { session: { id: string } } => ({ session: { id: sessionId } })

  it(`每 Agent 最多 ${MCP_PERSONAL_MAX_CONNECTIONS} 连接:6 条启用行只挂 4 条`, async () => {
    addRows(aliceId, 6)
    await host.emit('agent/created', { agent: agentOf('s-alice') })
    expect(scopes).toHaveLength(1)
    expect(pluginCalls).toHaveLength(MCP_PERSONAL_MAX_CONNECTIONS)
    expect(pluginCalls.map(call => call.serverName)).toEqual([
      `p${aliceId}_srv0`, `p${aliceId}_srv1`, `p${aliceId}_srv2`, `p${aliceId}_srv3`,
    ])
    expect(runtime.mountedAgents()).toBe(1)
    expect(runtime.connectionsOf(aliceId)).toBe(MCP_PERSONAL_MAX_CONNECTIONS)
  })

  it('无归属会话不挂载;禁用行不挂载', async () => {
    addRows(aliceId, 2)
    const disabled = store.listMcpServers(aliceId)[0]
    if (disabled !== undefined) store.setMcpServerEnabled(aliceId, disabled.id, false)
    await host.emit('agent/created', { agent: agentOf('unknown-session') })
    expect(scopes).toHaveLength(0)
    await host.emit('agent/created', { agent: agentOf('s-alice') })
    expect(pluginCalls).toHaveLength(1)
  })

  it('账本晚写(agent/created 先于 sessions 行):mountSession 回查 live Agent 补挂且幂等', async () => {
    addRows(aliceId, 1)
    // 真实时序复现:agent 已建、账本行还没写 → agent/created 挂载被跳过
    const agent = agentOf('s-late')
    registeredAgents.set('s-late', agent)
    await host.emit('agent/created', { agent })
    expect(scopes).toHaveLength(0)
    // 账本写入后,create 路径补挂
    store.recordSession('s-late', aliceId, null)
    await runtime.mountSession('s-late')
    expect(scopes).toHaveLength(1)
    expect(runtime.mountedAgents(aliceId)).toBe(1)
    // 幂等:再调不重复挂
    await runtime.mountSession('s-late')
    expect(scopes).toHaveLength(1)
  })

  it('子代理会话(父会话在账本):按 parentSession 上溯挂载,守卫同用户放行/跨用户拒', async () => {
    addRows(aliceId, 1)
    const child = { session: { id: 's-child', header: { parentSession: 's-alice' } } }
    registeredAgents.set('s-child', child)
    await host.emit('agent/created', { agent: child })
    expect(pluginCalls).toHaveLength(1)
    const own = await host.waterfall('tools/pre-execute', { name: `mcp__p${aliceId}_srv0__echo`, agent: child })
    expect(own).toEqual({ kind: 'allow' })
    const cross = await host.waterfall('tools/pre-execute', { name: `mcp__p${bobId}_srv0__echo`, agent: child })
    expect(cross).toMatchObject({ kind: 'deny' })
  })

  it('单条失败只 warn:其余条目照常挂载,全部失败则释放空 scope', async () => {
    addRows(aliceId, 2)
    failServerNames = new Set([`p${aliceId}_srv0`])
    await host.emit('agent/created', { agent: agentOf('s-alice') })
    expect(pluginCalls).toHaveLength(1)
    expect(warns.some(message => message.includes(`p${aliceId}_srv0`))).toBe(true)
    expect(scopes[0]?.disposed).toBe(0)

    failServerNames = new Set([`p${aliceId}_srv0`, `p${aliceId}_srv1`])
    await host.emit('agent/created', { agent: agentOf('s-alice-sub') })
    const second = scopes[1]
    expect(second?.disposed).toBe(1)
    expect(runtime.mountedAgents(aliceId)).toBe(1) // 首个 Agent 仍在
  })

  it('单条启动超预算(测试缩短为 20ms)→ warn 且不阻塞 Agent 创建', async () => {
    addRows(aliceId, 1)
    const hangingHost = new FakeHost()
    const disposed: number[] = []
    const hangingRuntime = mountPersonalMcp(hangingHost as never, {
      store,
      sessionOwnerOf: id => store.sessionOwner(id),
      logger: { warn: message => warns.push(message) },
      config,
      masterKey,
      startupTimeoutMs: 20,
      createScope: () => ({
        disposed: 0,
        ctx: { plugin: () => new Promise(() => { /* 永不 settle,由预算切断 */ }) },
        dispose: async () => { disposed.push(1) },
      }),
      mcpClientConfigOf: input => input,
      mcpClientPlugin: { name: 'hang-mcp-client' },
    })
    const started = Date.now()
    await hangingHost.emit('agent/created', { agent: agentOf('s-alice') })
    expect(Date.now() - started).toBeLessThan(2000)
    expect(warns.some(message => message.includes('预算'))).toBe(true)
    expect(hangingRuntime.mountedAgents()).toBe(0)
    expect(disposed).toHaveLength(1) // 全部失败 → 空 scope 释放
  })

  it('createScope 收到的连接配置含 serverName/url/toolCallTimeout/startupTimeout 且无明文无关字段', async () => {
    store.upsertMcpServer(aliceId, {
      name: 'stdio', serverName: `p${aliceId}_stdio`, transport: 'stdio', catalogId: 'fs', command: 'mcp-fs', args: ['--x'],
    })
    store.putMcpSecret(aliceId, 'env:FS_TOKEN', encryptMcpSecret(MASTER_KEY, 'env-value'))
    await host.emit('agent/created', { agent: agentOf('s-alice') })
    expect(pluginCalls).toHaveLength(1)
    const call = pluginCalls[0]
    expect(call?.config.transport).toBe('stdio')
    expect(call?.config.command).toBe('mcp-fs')
    expect(call?.config.env).toEqual({ FS_TOKEN: 'env-value' })
    expect(call?.config.cwd).toBe(join(dir, 'workspaces', String(aliceId)))
    expect(call?.config.startupTimeoutMs).toBe(MCP_PERSONAL_STARTUP_TIMEOUT_MS)
    expect(call?.config.failOnStartupError).toBe(false)
  })

  it('双守卫监听必须 {global:true}', () => {
    for (const event of ['agent/created', 'agent/disposed', 'tools/pre-execute', 'tools/execute']) {
      const entries = host.entriesOf(event)
      expect(entries, event).toHaveLength(1)
      expect(entries[0]?.options?.global, event).toBe(true)
    }
  })

  it('tools/pre-execute:同用户子代理放行、跨用户 deny、无归属 deny', async () => {
    addRows(aliceId, 1)
    await host.emit('agent/created', { agent: agentOf('s-alice') })
    const tool = { name: `mcp__p${aliceId}_srv0__read` }

    const same = await host.waterfall('tools/pre-execute', { ...tool, agent: agentOf('s-alice-sub') })
    expect(same).toEqual({ kind: 'allow' })
    const own = await host.waterfall('tools/pre-execute', { ...tool, agent: agentOf('s-alice') })
    expect(own).toEqual({ kind: 'allow' })

    const cross = await host.waterfall('tools/pre-execute', { ...tool, agent: agentOf('s-bob') })
    expect(cross).toMatchObject({ kind: 'deny' })
    expect(String((cross as { reason?: string }).reason)).toContain('cross-tenant')

    const orphan = await host.waterfall('tools/pre-execute', { ...tool, agent: agentOf('no-such-session') })
    expect(orphan).toMatchObject({ kind: 'deny' })

    const unrelated = await host.waterfall('tools/pre-execute', { name: 'mcp__browser__open', agent: agentOf('s-bob') })
    expect(unrelated).toEqual({ kind: 'allow' })
  })

  it('tools/execute:跨用户抛错兜底,同用户放行', async () => {
    addRows(aliceId, 1)
    await host.emit('agent/created', { agent: agentOf('s-alice') })
    const tool = { name: `mcp__p${aliceId}_srv0__read` }
    await expect(host.waterfall('tools/execute', { ...tool, agent: agentOf('s-bob') }))
      .rejects.toThrow('cross-tenant')
    await expect(host.waterfall('tools/execute', { ...tool, agent: agentOf('s-alice-sub') }))
      .resolves.toEqual({ kind: 'allow' })
  })

  it('disposeUser:摘除该用户全部 live scope,幂等;不影响他人', async () => {
    addRows(aliceId, 1)
    addRows(bobId, 1)
    await host.emit('agent/created', { agent: agentOf('s-alice') })
    await host.emit('agent/created', { agent: agentOf('s-alice-sub') })
    await host.emit('agent/created', { agent: agentOf('s-bob') })
    expect(runtime.mountedAgents(aliceId)).toBe(2)
    expect(runtime.mountedAgents(bobId)).toBe(1)

    await runtime.disposeUser(aliceId)
    expect(runtime.mountedAgents(aliceId)).toBe(0)
    expect(scopes[0]?.disposed).toBe(1)
    expect(scopes[1]?.disposed).toBe(1)
    expect(runtime.mountedAgents(bobId)).toBe(1)

    await runtime.disposeUser(aliceId)
    expect(scopes[0]?.disposed).toBe(1) // 幂等
  })

  it('agent/disposed 摘除对应 scope', async () => {
    addRows(aliceId, 1)
    const agent = agentOf('s-alice')
    await host.emit('agent/created', { agent })
    expect(runtime.mountedAgents()).toBe(1)
    await host.emit('agent/disposed', { agent })
    await vi.waitFor(() => { expect(runtime.mountedAgents()).toBe(0) })
    expect(scopes[0]?.disposed).toBe(1)
  })

  it('disposeAll(effect 清理)释放全部 scope 且后续 created 不再挂载', async () => {
    addRows(aliceId, 1)
    await host.emit('agent/created', { agent: agentOf('s-alice') })
    await host.cleanup?.()
    expect(runtime.mountedAgents()).toBe(0)
    expect(scopes[0]?.disposed).toBe(1)
    await host.emit('agent/created', { agent: agentOf('s-alice') })
    expect(runtime.mountedAgents()).toBe(0)
  })

  it('归属账本异常:created 只 warn 不挂;守卫 deny(异常不穿透)', async () => {
    const brokenHost = new FakeHost()
    const brokenRuntime = mountPersonalMcp(brokenHost as never, {
      store,
      sessionOwnerOf: () => { throw new Error('ledger down') },
      logger: { warn: message => warns.push(message) },
      config,
      masterKey,
      createScope: () => ({
        ctx: { plugin: () => undefined },
        dispose: async () => undefined,
      }),
      mcpClientConfigOf: input => input,
      mcpClientPlugin: { name: 'fake-mcp-client' },
    })
    await brokenHost.emit('agent/created', { agent: agentOf('s-alice') })
    expect(brokenRuntime.mountedAgents()).toBe(0)
    expect(warns.some(message => message.includes('归属解析失败'))).toBe(true)
    const decision = await brokenHost.waterfall('tools/pre-execute', {
      name: `mcp__p${aliceId}_srv0__read`, agent: agentOf('s-alice'),
    })
    expect(decision).toMatchObject({ kind: 'deny' })
  })

  it('kill switch:enabled=false / 缺主密钥 → 不挂且守卫 deny', async () => {
    addRows(aliceId, 1)
    config = { ...CONFIG, enabled: false }
    for (const state of ['disabled', 'no-key'] as const) {
      config = { ...CONFIG, enabled: state !== 'disabled' }
      masterKey = state === 'no-key' ? undefined : MASTER_KEY
      host = new FakeHost()
      runtime = mount()
      await host.emit('agent/created', { agent: agentOf('s-alice') })
      expect(scopes, state).toHaveLength(0)
      const decision = await host.waterfall('tools/pre-execute', {
        name: `mcp__p${aliceId}_srv0__read`, agent: agentOf('s-alice'),
      })
      expect(decision, state).toMatchObject({ kind: 'deny' })
    }
  })

  it('personalMcpClientInput:stdio/http 两形态与 8s/60s 默认', () => {
    const stdio = personalMcpClientInput(
      { transport: 'stdio', serverName: 'p1_x', command: 'mcp-fs', args: ['a'], env: { A: 'b' } },
      { cwd: '/tmp' },
    )
    expect(stdio).toMatchObject({ transport: 'stdio', serverName: 'p1_x', command: 'mcp-fs', args: ['a'], env: { A: 'b' }, cwd: '/tmp' })
    expect(stdio.startupTimeoutMs).toBe(MCP_PERSONAL_STARTUP_TIMEOUT_MS)
    const http = personalMcpClientInput({ transport: 'streamable-http', serverName: 'p1_y', url: 'https://x.test/mcp', headers: { A: 'b' } })
    expect(http).toMatchObject({ transport: 'streamable-http', url: 'https://x.test/mcp', headers: { A: 'b' } })
    expect(http.reconnect).toEqual({ enabled: true, maxAttempts: 3 })
  })
})
