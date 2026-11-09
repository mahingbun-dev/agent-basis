/**
 * egress 插件 pre-execute 接线单测(T8 三测之二:egress deny/allow)。
 *
 * 覆盖:内网默认白名单(缺省 = DEFAULT_EGRESS_DOMAIN_RULES:192.168.31.*、localhost、
 * manas)下的域名级 deny/allow、工具级 deny、无目的地参数的工具级兜底(unknownDestination
 * 缺省 allow)、资产配置文件扩域与端口、配置文件语法非法 fail-closed、local 工具直通、
 * 审计直投(结构化 denied 明细)。判定面 = @basis/extra EgressToolWrapper.preflight
 * (packages/extra/src/egress-wrapper.ts:66-87),挂载形态见 src/plugins/egress-plugin.ts 头注。
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { BASIS_EGRESS_PLUGIN_NAME, DEFAULT_ALLOWED_OUTBOUND_TOOLS, defineEgressPlugin } from '../src/plugins/egress-plugin.ts'
import { makeFakeContext } from './fake-context.ts'
import type { PreToolDecisionLike, ToolExecutionLike } from './fake-context.ts'

const tempDirs: string[] = []
const disposers: (() => void)[] = []

afterEach(async () => {
  for (const dispose of disposers.splice(0)) dispose()
  await Promise.all(tempDirs.map(dir => rm(dir, { recursive: true, force: true })))
  tempDirs.length = 0
})

async function mountEgress(config: Parameters<typeof defineEgressPlugin>[0] = {}) {
  const harness = makeFakeContext()
  disposers.push(defineEgressPlugin(config).apply(harness.fake as unknown as Context))
  const report = vi.fn<(detail: Record<string, unknown>) => void>()
  harness.provide('audit', { report }) // ctx.audit 属性桥(逐调用惰性读取)
  return { harness, report }
}

/** 带下游间谍的 pre-execute 派发(间谍默认 veto 为 allow)。 */
async function dispatchWithSpy(
  harness: ReturnType<typeof makeFakeContext>,
  exec: ToolExecutionLike,
  verdict: PreToolDecisionLike = { kind: 'allow' },
) {
  const spy = vi.fn((_exec: unknown, _next: unknown): Promise<PreToolDecisionLike> => Promise.resolve(verdict))
  harness.fake.on('tools/pre-execute', spy)
  const decision = await harness.dispatchPreExecute(exec)
  return { decision, spy } as const
}

describe('egress 插件:内网默认白名单(缺省 fail-closed,数据不出内网)', () => {
  it('web_fetch 外网域:域名级 deny,后续监听者不执行(veto),审计留结构化明细', async () => {
    const { harness, report } = await mountEgress()
    const { decision, spy } = await dispatchWithSpy(harness, { name: 'web_fetch', arguments: { url: 'https://example.com/page' } })
    expect(decision.kind).toBe('deny')
    if (decision.kind === 'deny') expect(decision.reason).toContain('不在出网域名白名单')
    expect(spy).not.toHaveBeenCalled()
    expect(report).toHaveBeenCalledTimes(1)
    expect(report.mock.calls[0]?.[0]).toMatchObject({
      source: 'glue-egress',
      tool: 'web_fetch',
      decision: 'deny',
      denied: { egress: 'denied', tool: 'web_fetch', layer: 'domain' },
      actor: { pluginId: BASIS_EGRESS_PLUGIN_NAME, source: 'decision' },
    })
  })

  it('内网 IP 与 NAS 主机名放行(大小写不敏感),放行分支参数原样透传', async () => {
    const { harness, report } = await mountEgress()
    const spy = vi.fn((_exec: unknown, _next: unknown): Promise<PreToolDecisionLike> => Promise.resolve({ kind: 'allow' }))
    harness.fake.on('tools/pre-execute', spy)

    const exec: ToolExecutionLike = { name: 'web_fetch', arguments: { url: 'http://MaNas:8080/api/v1/knowledge-search' } }
    expect((await harness.dispatchPreExecute(exec)).kind).toBe('allow')
    expect((await harness.dispatchPreExecute({ name: 'web_fetch', arguments: { url: 'http://192.168.31.165:4000/v1' } })).kind).toBe('allow')
    expect(spy).toHaveBeenCalledTimes(2)
    expect(spy.mock.calls[0]?.[0]).toBe(exec) // 瀑布不复制 exec:参数未被改写(无 proxyUrl 时第 3 层整层关闭)
    expect(report).not.toHaveBeenCalled()
  })

  it('fail-closed:非白名单地址(127.0.0.1)照拒', async () => {
    const { harness } = await mountEgress()
    const { decision } = await dispatchWithSpy(harness, { name: 'web_fetch', arguments: { url: 'http://127.0.0.1:9000/admin' } })
    expect(decision.kind).toBe('deny')
  })

  it('web_search 无目的地参数:工具级白名单兜底 allow(unknownDestination 缺省 allow,不误杀唯一显式出站)', async () => {
    const { harness } = await mountEgress()
    const { decision } = await dispatchWithSpy(harness, { name: 'web_search', arguments: { queries: ['电机振动诊断'] } })
    expect(decision.kind).toBe('allow')
  })

  it('工具级 deny:出网型但不在放行表(web_upload)', async () => {
    const { harness } = await mountEgress()
    const { decision } = await dispatchWithSpy(harness, { name: 'web_upload', arguments: {} })
    expect(decision.kind).toBe('deny')
    if (decision.kind === 'deny') expect(decision.reason).toContain('不在工具级 egress 白名单')
  })

  it('local 工具直通(非出网型不受 egress 约束)', async () => {
    const { harness } = await mountEgress()
    const { decision, spy } = await dispatchWithSpy(harness, { name: 'read_file', arguments: { path: 'NOTES/a.md' } })
    expect(decision.kind).toBe('allow')
    expect(spy).toHaveBeenCalledTimes(1)
  })
})

describe('egress 插件:内网 MCP 家族与域名级兜底', () => {
  it('mcp__* 无 URL 参数:工具级放行(内网 MCP 目的地在配置面)', async () => {
    const { harness } = await mountEgress()
    const { decision } = await dispatchWithSpy(harness, { name: 'mcp__weknora__ask', arguments: { question: '预警阈值' } })
    expect(decision.kind).toBe('allow')
  })

  it('mcp__* 携 URL 出网参数:仍被域名级 fail-closed 拒', async () => {
    const { harness } = await mountEgress()
    const { decision } = await dispatchWithSpy(harness, { name: 'mcp__fetch__fetch', arguments: { url: 'https://example.com/data' } })
    expect(decision.kind).toBe('deny')
  })
})

describe('egress 插件:资产配置文件(whitelistPath)', () => {
  it('扩域 + 端口限定:命中规则放行,端口不符拒', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'basis-glue-egress-'))
    tempDirs.push(dir)
    const whitelistPath = join(dir, 'egress-whitelist.yml')
    await writeFile(whitelistPath, [
      'whitelist:',
      "  - '192.168.31.*'",
      '  - localhost',
      '  - manas',
      "  - { host: '*.deepseek.com', ports: [443] }",
    ].join('\n'), 'utf8')
    const { harness } = await mountEgress({ whitelistPath })

    const allowed = await dispatchWithSpy(harness, { name: 'web_fetch', arguments: { url: 'https://api.deepseek.com/v1/x' } })
    expect(allowed.decision.kind).toBe('allow')

    const wrongPort = await dispatchWithSpy(harness, { name: 'web_fetch', arguments: { url: 'https://api.deepseek.com:8443/v1/x' } })
    expect(wrongPort.decision.kind).toBe('deny')
  })

  it('配置文件语法非法 = 装载抛错(fail-closed,同 governance 规则文件口径)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'basis-glue-egress-'))
    tempDirs.push(dir)
    const whitelistPath = join(dir, 'egress-whitelist.yml')
    await writeFile(whitelistPath, 'whitelist: [未闭合\n  - {host', 'utf8')
    expect(() => defineEgressPlugin({ whitelistPath }).apply(makeFakeContext().fake as unknown as Context)).toThrow()
  })

  it('工具级放行表可经配置收窄(缺省 = web 检索 + 内网 MCP 家族)', async () => {
    expect(DEFAULT_ALLOWED_OUTBOUND_TOOLS).toEqual(['web_search', 'web_fetch', 'mcp__*'])
    const { harness } = await mountEgress({ allowedOutboundTools: ['web_search'] })
    const { decision } = await dispatchWithSpy(harness, { name: 'web_fetch', arguments: { url: 'http://192.168.31.165/x' } })
    expect(decision.kind).toBe('deny')
    if (decision.kind === 'deny') expect(decision.reason).toContain('不在工具级 egress 白名单')
  })
})
