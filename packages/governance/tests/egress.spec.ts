import { describe, expect, it } from 'vitest'
import { DEFAULT_OUTBOUND_TOOL_GLOBS, EgressLite } from '../src/index.ts'

const egress = new EgressLite({
  proxyUrl: 'http://127.0.0.1:7890',
  allowedOutboundTools: ['web_fetch', 'web_search*', 'mcp__weknora__*'],
  noProxy: ['localhost', '127.0.0.1', '*.internal'],
})

describe('egress-lite:出网工具白名单判定', () => {
  it('三态判定:local / outbound-allowed / outbound-denied', () => {
    expect(egress.classify('read_file')).toBe('local')
    expect(egress.classify('shell')).toBe('local')
    expect(egress.classify('web_fetch')).toBe('outbound-allowed')
    expect(egress.classify('web_search_deep')).toBe('outbound-allowed')
    expect(egress.classify('mcp__weknora__ask')).toBe('outbound-allowed')
    expect(egress.classify('web_upload')).toBe('outbound-denied') // 出网型但不在白名单
    expect(egress.classify('mcp__synology__fs_read')).toBe('outbound-denied')
  })

  it('本地工具不受 egress 约束(交给规则引擎继续判)', () => {
    expect(egress.preExecuteDecision({ name: 'shell', arguments: { cmd: 'ls' } })).toEqual({ kind: 'allow' })
  })

  it('白名单内的出网工具放行', () => {
    expect(egress.preExecuteDecision({ name: 'web_fetch', arguments: { url: 'https://a.b' } })).toEqual({ kind: 'allow' })
  })

  it('白名单外的出网工具 deny,理由带白名单清单(12 号文档 D-A 决策)', () => {
    const decision = egress.preExecuteDecision({ name: 'web_upload', arguments: {} })
    expect(decision.kind).toBe('deny')
    if (decision.kind === 'deny') {
      expect(decision.reason).toContain('web_upload')
      expect(decision.reason).toContain('egress 白名单')
      expect(decision.reason).toContain('web_fetch')
    }
  })

  it('空白名单 = 一查出网工具全拒(最严格配置)', () => {
    const strict = new EgressLite({ proxyUrl: 'http://p:1', allowedOutboundTools: [] })
    expect(strict.classify('web_fetch')).toBe('outbound-denied')
    expect(strict.classify('read_file')).toBe('local')
  })

  it('可自定义出网型工具识别集(outboundToolGlobs 覆盖缺省)', () => {
    const custom = new EgressLite({
      proxyUrl: 'http://p:1',
      allowedOutboundTools: ['http_post'],
      outboundToolGlobs: ['http_*'],
    })
    expect(custom.classify('web_fetch')).toBe('local') // web_* 不再视为出网型
    expect(custom.classify('http_post')).toBe('outbound-allowed')
    expect(DEFAULT_OUTBOUND_TOOL_GLOBS).toContain('web_*')
  })

  it('proxyUrl 必须带协议,否则构造失败', () => {
    expect(() => new EgressLite({ proxyUrl: '127.0.0.1:7890', allowedOutboundTools: [] })).toThrow(RangeError)
  })
})

describe('egress-lite:proxy 环境变量注入载荷', () => {
  it('大小写双形态 + NO_PROXY 直连例外', () => {
    expect(egress.proxyEnvPayload()).toEqual({
      HTTP_PROXY: 'http://127.0.0.1:7890',
      HTTPS_PROXY: 'http://127.0.0.1:7890',
      http_proxy: 'http://127.0.0.1:7890',
      https_proxy: 'http://127.0.0.1:7890',
      NO_PROXY: 'localhost,127.0.0.1,*.internal',
      no_proxy: 'localhost,127.0.0.1,*.internal',
    })
  })

  it('noProxy 为空时不注入 NO_PROXY 键', () => {
    const payload = new EgressLite({ proxyUrl: 'http://p:1', allowedOutboundTools: [] }).proxyEnvPayload()
    expect(payload).not.toHaveProperty('NO_PROXY')
    expect(payload).not.toHaveProperty('no_proxy')
  })

  it('withProxyEnv 合并进工具参数:proxy 强注覆盖同名键,其余既有 env 保留,原对象不动', () => {
    const args = { url: 'https://a.b', env: { LANG: 'C', http_proxy: 'http://evil:1' } }
    const injected = egress.withProxyEnv(args)
    expect(injected.env).toEqual({
      LANG: 'C',
      HTTP_PROXY: 'http://127.0.0.1:7890',
      HTTPS_PROXY: 'http://127.0.0.1:7890',
      http_proxy: 'http://127.0.0.1:7890',
      https_proxy: 'http://127.0.0.1:7890',
      NO_PROXY: 'localhost,127.0.0.1,*.internal',
      no_proxy: 'localhost,127.0.0.1,*.internal',
    })
    expect(injected.url).toBe('https://a.b')
    expect(args.env).toMatchObject({ http_proxy: 'http://evil:1' }) // 原对象未被改写
  })

  it('无 env 参数的工具获得全新 env 载荷', () => {
    const injected = egress.withProxyEnv({ url: 'https://a.b' })
    expect(injected.env['HTTPS_PROXY']).toBe('http://127.0.0.1:7890')
    expect(Object.keys(injected)).toEqual(['url', 'env'])
  })
})
