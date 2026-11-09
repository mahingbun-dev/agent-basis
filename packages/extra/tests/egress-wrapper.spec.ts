/**
 * 出网工具包装器单测(任务指定三测之二):**包装器拒绝未列名域名**
 * ——底层 execute 必须不被调用;另覆盖工具级拒/本地工具直通/代理强注/
 * 无目的地 fail-closed/渲染面。
 */
import { describe, expect, it, vi } from 'vitest'
import { EgressLite } from '@eterna/governance'
import { DomainWhitelist } from '../src/domain-whitelist.ts'
import { EgressToolWrapper, createEgressWrapper, isEgressDeniedValue } from '../src/egress-wrapper.ts'
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools'

/** governance egress-lite 实例:仅放行 web_fetch 工具,代理固定本机。 */
const egressLite = new EgressLite({
  proxyUrl: 'http://127.0.0.1:7890',
  allowedOutboundTools: ['web_fetch'],
  noProxy: ['localhost'],
})

/** 域名白名单:deepseek 域 443、example 域任意端口。 */
const domains = new DomainWhitelist([
  { host: '*.deepseek.com', ports: [443] },
  { host: 'example.com' },
])

/** 测试用假 exec(底层工具不消费它;满足类型面即可)。 */
const fakeExec = { signal: new AbortController().signal } as unknown as ToolRunContext

/** 造一个带 execute 间谍的 dsh ToolDefinition(形态对齐 defineTool 产物)。 */
function fakeTool(name: string): { tool: ToolDefinition; calls: { args: unknown }[] } {
  const calls: { args: unknown }[] = []
  const tool: ToolDefinition = {
    name,
    description: `test tool ${name}`,
    parameters: { url: { type: 'string', required: true } },
    output: {
      schema: {
        type: 'object',
        properties: { ok: { type: 'boolean' }, url: { type: 'string' } },
        required: ['ok'],
      },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(args, _exec) {
      calls.push({ args })
      return { ok: true, url: typeof args === 'object' && args !== null ? (args as Record<string, unknown>)['url'] : null }
    },
  }
  return { tool, calls }
}

describe('EgressToolWrapper 拒绝未列名域名(核心门)', () => {
  it('域名不在白名单 → 结构化拒绝,底层 execute 不被调用', async () => {
    const wrapper = new EgressToolWrapper({ egress: egressLite, domains })
    const { tool, calls } = fakeTool('web_fetch')
    const wrapped = wrapper.wrap(tool)
    const result = await wrapped.execute({ url: 'https://evil.example.org/steal' }, fakeExec)
    expect(isEgressDeniedValue(result)).toBe(true)
    if (isEgressDeniedValue(result)) {
      expect(result.layer).toBe('domain')
      expect(result.tool).toBe('web_fetch')
      expect(result.reason).toContain('evil.example.org')
      expect(result.reason).toContain('不在出网域名白名单')
    }
    expect(calls).toHaveLength(0)
  })

  it('host 命中但端口未列名 → 拒绝(域名+端口双重判定)', async () => {
    const wrapper = new EgressToolWrapper({ egress: egressLite, domains })
    const { tool, calls } = fakeTool('web_fetch')
    const result = await wrapper.wrap(tool).execute({ url: 'https://api.deepseek.com:8443/x' }, fakeExec)
    expect(isEgressDeniedValue(result)).toBe(true)
    expect(calls).toHaveLength(0)
  })

  it('非 http(s) 协议目的地 → 拒绝(file: 防护)', async () => {
    const wrapper = new EgressToolWrapper({ egress: egressLite, domains })
    const { tool, calls } = fakeTool('web_fetch')
    const result = await wrapper.wrap(tool).execute({ url: 'file:///etc/passwd' }, fakeExec)
    expect(isEgressDeniedValue(result)).toBe(true)
    expect(calls).toHaveLength(0)
  })

  it('preflight 同语义(不执行工具即可判)', () => {
    const wrapper = new EgressToolWrapper({ egress: egressLite, domains })
    const pre = wrapper.preflight('web_fetch', { url: 'https://evil.example.org/x' })
    expect(pre.kind).toBe('denied')
    if (pre.kind === 'denied') expect(pre.value.layer).toBe('domain')
  })
})

describe('EgressToolWrapper 工具级白名单(governance egress-lite 第 1 层)', () => {
  it('出网工具不在工具白名单 → 拒,layer=tool', async () => {
    const wrapper = new EgressToolWrapper({ egress: egressLite, domains })
    const { tool, calls } = fakeTool('web_post')
    const result = await wrapper.wrap(tool).execute({ url: 'https://api.deepseek.com/x' }, fakeExec)
    expect(isEgressDeniedValue(result)).toBe(true)
    if (isEgressDeniedValue(result)) {
      expect(result.layer).toBe('tool')
      expect(result.reason).toContain('web_post')
    }
    expect(calls).toHaveLength(0)
  })

  it('本地工具(非出网型)直通,不注代理', async () => {
    const wrapper = new EgressToolWrapper({ egress: egressLite, domains })
    const { tool, calls } = fakeTool('read')
    const result = await wrapper.wrap(tool).execute({ url: 'NOT_A_URL_LOCAL_FILE' }, fakeExec)
    expect(result).toEqual({ ok: true, url: 'NOT_A_URL_LOCAL_FILE' })
    expect(calls).toHaveLength(1)
    const args = calls[0]!.args as Record<string, unknown>
    expect(args['env']).toBeUndefined()
  })
})

describe('EgressToolWrapper 放行路径 + 代理强注(第 3 层)', () => {
  it('列名域名放行且 HTTP(S)_PROXY 强注进 args.env(保留既有 env 键)', async () => {
    const wrapper = new EgressToolWrapper({ egress: egressLite, domains })
    const { tool, calls } = fakeTool('web_fetch')
    const result = await wrapper.wrap(tool).execute({ url: 'https://api.deepseek.com/v1/chat', env: { CUSTOM: 'keep' } }, fakeExec)
    expect(result).toEqual({ ok: true, url: 'https://api.deepseek.com/v1/chat' })
    expect(calls).toHaveLength(1)
    const args = calls[0]!.args as { url: string; env: Record<string, string> }
    expect(args.env['HTTP_PROXY']).toBe('http://127.0.0.1:7890')
    expect(args.env['HTTPS_PROXY']).toBe('http://127.0.0.1:7890')
    expect(args.env['http_proxy']).toBe('http://127.0.0.1:7890')
    expect(args.env['https_proxy']).toBe('http://127.0.0.1:7890')
    expect(args.env['NO_PROXY']).toBe('localhost')
    expect(args.env['CUSTOM']).toBe('keep')
  })

  it('injectProxyEnv=false 时不注', async () => {
    const wrapper = new EgressToolWrapper({ egress: egressLite, domains, injectProxyEnv: false })
    const { tool, calls } = fakeTool('web_fetch')
    await wrapper.wrap(tool).execute({ url: 'https://api.deepseek.com/x' }, fakeExec)
    expect((calls[0]!.args as Record<string, unknown>)['env']).toBeUndefined()
  })

  it('多个 URL 参数全部命中才放行(逐个判)', async () => {
    const wrapper = new EgressToolWrapper({ egress: egressLite, domains })
    const { tool, calls } = fakeTool('web_fetch')
    const result = await wrapper.wrap(tool).execute(
      { url: 'https://api.deepseek.com/a', base_url: 'https://example.com/b' },
      fakeExec,
    )
    expect(isEgressDeniedValue(result)).toBe(false)
    expect(calls).toHaveLength(1)
    // 一个好一个坏 → 拒
    const bad = await wrapper.wrap(fakeTool('web_fetch').tool).execute(
      { url: 'https://api.deepseek.com/a', base_url: 'https://bad.org/b' },
      fakeExec,
    )
    expect(isEgressDeniedValue(bad)).toBe(true)
  })
})

describe('EgressToolWrapper 无目的地策略(fail-closed 缺省)', () => {
  it('出网工具参数无 URL 键 → 缺省拒绝 layer=no-destination', async () => {
    const wrapper = new EgressToolWrapper({ egress: egressLite, domains })
    const { tool, calls } = fakeTool('web_fetch')
    const result = await wrapper.wrap(tool).execute({ city: 'hangzhou' }, fakeExec)
    expect(isEgressDeniedValue(result)).toBe(true)
    if (isEgressDeniedValue(result)) expect(result.layer).toBe('no-destination')
    expect(calls).toHaveLength(0)
  })

  it('unknownDestination=allow → 放行(egress-lite 兼容形态,如结构化 MCP 工具)', async () => {
    const wrapper = new EgressToolWrapper({ egress: egressLite, domains, unknownDestination: 'allow' })
    const { tool, calls } = fakeTool('web_fetch')
    const result = await wrapper.wrap(tool).execute({ city: 'hangzhou' }, fakeExec)
    expect(isEgressDeniedValue(result)).toBe(false)
    expect(calls).toHaveLength(1)
  })
})

describe('EgressToolWrapper 包装面契约(name/参数不变 + 拒绝值渲染)', () => {
  it('name/description/parameters 原样保留;output schema 扩 oneOf', () => {
    const wrapper = new EgressToolWrapper({ egress: egressLite, domains })
    const { tool } = fakeTool('web_fetch')
    const wrapped = wrapper.wrap(tool)
    expect(wrapped.name).toBe('web_fetch')
    expect(wrapped.description).toBe(tool.description)
    expect(wrapped.parameters).toBe(tool.parameters)
    const schema = wrapped.output.schema as { oneOf?: unknown[] }
    expect(Array.isArray(schema.oneOf)).toBe(true)
    expect(schema.oneOf).toHaveLength(2)
  })

  it('拒绝值渲染为用户可见文本块,原值走原 render', () => {
    const wrapper = new EgressToolWrapper({ egress: egressLite, domains })
    const { tool } = fakeTool('web_fetch')
    const wrapped = wrapper.wrap(tool)
    const denied = wrapped.output.render({}, { egress: 'denied', tool: 'web_fetch', reason: 'r', layer: 'domain' })
    expect(denied).toEqual([{ type: 'text', text: '[egress] 已拒绝调用:r' }])
    const ok = wrapped.output.render({}, { ok: true })
    expect(ok).toEqual([{ type: 'text', text: '{"ok":true}' }])
  })

  it('底层工具抛错原样透传(包装器不吞异常)', async () => {
    const wrapper = new EgressToolWrapper({ egress: egressLite, domains })
    const tool: ToolDefinition = {
      ...fakeTool('web_fetch').tool,
      async execute() {
        throw new Error('boom')
      },
    }
    await expect(wrapper.wrap(tool).execute({ url: 'https://api.deepseek.com/x' }, fakeExec)).rejects.toThrow('boom')
  })
})

describe('createEgressWrapper 组合便捷工厂', () => {
  it('governance EgressLite 直接注入(EgressLite 满足 ToolLevelEgress 结构面)', () => {
    const wrapper = createEgressWrapper(egressLite, domains)
    expect(wrapper).toBeInstanceOf(EgressToolWrapper)
    const pre = wrapper.preflight('web_fetch', { url: 'https://evil.org/x' })
    expect(pre.kind).toBe('denied')
  })

  it('vi 间谍验证:同一底层工具的多次调用各自判定(有状态 only in spy)', async () => {
    const wrapper = createEgressWrapper(egressLite, domains)
    const { tool } = fakeTool('web_fetch')
    const wrapped = wrapper.wrap(tool)
    const spy = vi.fn((args: unknown, exec: ToolRunContext) => wrapped.execute(args, exec))
    await spy({ url: 'https://api.deepseek.com/ok' }, fakeExec)
    await spy({ url: 'https://nope.org/bad' }, fakeExec)
    expect(spy).toHaveBeenCalledTimes(2)
    const second: unknown = await spy.mock.results[1]!.value
    expect(isEgressDeniedValue(second)).toBe(true)
  })
})
