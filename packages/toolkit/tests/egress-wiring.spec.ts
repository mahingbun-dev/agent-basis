/**
 * K2.3 egress 联动单测(36 号 §3 表 K2.3 门禁:generic 执行器过 `EgressLite.classify`,
 * 白名单外拒绝)。
 *
 * 依据:29 §6 governance 行「generic 路径的搜索/读网请求受 egress 白名单约束」;
 * 26 §4.3 配方「工具经 ctx.tools.register 注册则 governance pre-execute 瀑布自动覆盖,
 * 无需工具自写权限」。本测试以**真实 @eterna/governance EgressLite** 驱动(结构位
 * EgressGate 的实现方),验证:
 * - 出网工具名命中默认 glob(web_*)且不在白名单 → outbound-denied → 执行器零网络、显式降级;
 * - 白名单内 → outbound-allowed → 正常出网;
 * - 不识别为出网工具的名字(如 read_url 不在默认 glob 集)→ local → 放行
 *   (部署可经 outboundToolGlobs 扩充判定面——如实展示治理词汇表现状);
 * - defineTool 形态 toolSpecs 的 execute 同样过闸(注册面同名,瀑布与内闸一致)。
 */
import { describe, expect, it, vi } from 'vitest'
import { EgressLite } from '@eterna/governance'
import { TavilyClient, buildGenericToolSpecs, executeReadUrl, executeWebSearch } from '../src/index.ts'
import type { TavilyFetchResponse } from '../src/index.ts'

const PROXY = 'http://127.0.0.1:7890'

function okResponse(body: unknown): TavilyFetchResponse {
  return { ok: true, status: 200, json: async () => body }
}

const SEARCH_OK = { query: 'q', results: [{ title: 't', url: 'https://x.example.com', content: 'c', published_date: null, score: 1 }] }
const EXTRACT_OK = { results: [{ url: 'https://example.com', raw_content: '页面内容' }] }

function tavilyWithSpy(body: unknown = SEARCH_OK): { tavily: TavilyClient; fetchSpy: ReturnType<typeof vi.fn> } {
  const fetchSpy = vi.fn(async () => okResponse(body))
  const tavily = new TavilyClient({ apiKey: 'k', fetchImpl: fetchSpy })
  return { tavily, fetchSpy }
}

describe('真实 EgressLite 三态联动', () => {
  it('outbound-denied(web_* 命中、白名单外):执行器零网络、显式降级', async () => {
    const egress = new EgressLite({ proxyUrl: PROXY, allowedOutboundTools: [] })
    expect(egress.classify('web_search')).toBe('outbound-denied')
    const { tavily, fetchSpy } = tavilyWithSpy()
    const execution = await executeWebSearch({ query: 'q' }, { tavily, egress })
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(execution.status).toBe('degraded')
    expect(execution.reason).toContain('不在 egress 白名单')
    expect(execution.blocks[0]).toMatchObject({ type: 'search_step', action: 'search', status: 'error' })
  })

  it('outbound-allowed(白名单内):正常出网,状态 ok', async () => {
    const egress = new EgressLite({ proxyUrl: PROXY, allowedOutboundTools: ['web_search'] })
    expect(egress.classify('web_search')).toBe('outbound-allowed')
    const { tavily, fetchSpy } = tavilyWithSpy()
    const execution = await executeWebSearch({ query: 'q' }, { tavily, egress })
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(execution.status).toBe('ok')
  })

  it('local(read_url 不在默认出网 glob 集):放行——治理词汇表现状如实,部署可扩 globs', async () => {
    const egress = new EgressLite({ proxyUrl: PROXY, allowedOutboundTools: [] })
    expect(egress.classify('read_url')).toBe('local')
    const { tavily, fetchSpy } = tavilyWithSpy(EXTRACT_OK)
    const execution = await executeReadUrl({ url: 'https://example.com' }, {
      tavily,
      egress,
    })
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(execution.status).toBe('ok')
    // 部署把 read_url 纳入出网判定面后,白名单外即拒(同一闸门服从部署词汇表)。
    const strict = new EgressLite({ proxyUrl: PROXY, allowedOutboundTools: [], outboundToolGlobs: ['web_*', 'read_url'] })
    expect(strict.classify('read_url')).toBe('outbound-denied')
  })

  it('read_url denied 形态:纳入 glob 且白名单外 → 零网络、显式降级', async () => {
    const egress = new EgressLite({ proxyUrl: PROXY, allowedOutboundTools: [], outboundToolGlobs: ['web_*', 'read_url'] })
    const { tavily, fetchSpy } = tavilyWithSpy(EXTRACT_OK)
    const execution = await executeReadUrl({ url: 'https://example.com' }, { tavily, egress })
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(execution.status).toBe('degraded')
    expect(execution.reason).toContain('不在 egress 白名单')
  })

  it('defineTool 形态 toolSpecs(ctx.tools.register 注册面)同名过闸:denied 时 execute 零网络', async () => {
    const egress = new EgressLite({ proxyUrl: PROXY, allowedOutboundTools: [] })
    const { tavily, fetchSpy } = tavilyWithSpy()
    const { toolSpecs } = buildGenericToolSpecs({ tavily, egress })
    const webSearchSpec = toolSpecs.find(spec => spec.name === 'web_search')
    expect(webSearchSpec).toBeDefined()
    const result = (await webSearchSpec?.execute({ query: 'q' })) as { ok: boolean; degraded: boolean; reason: string }
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(result.degraded).toBe(true)
    expect(result.reason).toContain('不在 egress 白名单')
  })

  it('governance pre-execute 瀑布形态对齐:denied 即 deny 决策(26 §4.3 自动覆盖佐证)', () => {
    const egress = new EgressLite({ proxyUrl: PROXY, allowedOutboundTools: [] })
    const decision = egress.preExecuteDecision({ name: 'web_search', arguments: { query: 'q' } })
    expect(decision.kind).toBe('deny')
    const allowed = new EgressLite({ proxyUrl: PROXY, allowedOutboundTools: ['web_search'] })
    expect(allowed.preExecuteDecision({ name: 'web_search', arguments: {} }).kind).toBe('allow')
  })
})
