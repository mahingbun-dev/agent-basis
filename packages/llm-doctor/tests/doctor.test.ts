/**
 * doctor.ts 纯判定层测试:端点存在性探测(404=不存在/405·401=存在)、
 * baseURL 候选生成、normalize 决策、逐模型 ping(三协议 wire 形态)。
 * fetch 打本地 node:http 真服务器(端口随机),不 mock 协议语义。
 */
import { createServer, type Server } from 'node:http'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  candidateBaseUrls, checkRoute, normalizeConfig, pingModel, probeEndpoint,
  type FetchLike, type ProviderRouteConfig,
} from '../src/doctor.ts'

let server: Server
let baseUrl: string
/** 本地网关假体路径表(每例重建,规避动态 delete)。 */
let routes: Record<string, { get?: number; post?: unknown }>

beforeEach(async () => {
  routes = {
    // openai 路径存在(/v1 前缀),anthropic 路径存在(/v1/messages)
    '/v1/chat/completions': { get: 405, post: { choices: [{ message: { content: 'pong' } }] } },
    '/chat/completions': { get: 404, post: 404 },
    '/v1/responses': { get: 405, post: { output_text: 'pong' } },
    '/v1/messages': { get: 405, post: { content: [{ type: 'text', text: 'pong' }] } },
  }
  server = createServer((req, res) => {
    const entry = routes[req.url ?? '']
    if (entry === undefined) {
      res.writeHead(404, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ detail: 'Not Found' }))
      return
    }
    if (req.method === 'GET') {
      res.writeHead(entry.get ?? 404)
      res.end()
      return
    }
    if (req.method === 'POST') {
      if (typeof entry.post === 'number') {
        res.writeHead(entry.post, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ detail: 'Not Found' }))
        return
      }
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify(entry.post))
      return
    }
    res.writeHead(405)
    res.end()
  })
  await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve) })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('server address 失败')
  baseUrl = `http://127.0.0.1:${address.port}`
})

afterEach(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error === undefined) resolve()
      else reject(error)
    })
  })
})

const fetchLocal: FetchLike = (url, init) => fetch(url, init)

describe('candidateBaseUrls', () => {
  it('无 /v1 后缀 → 原值 + /v1 变体', () => {
    expect(candidateBaseUrls('http://gw:4000')).toEqual(['http://gw:4000', 'http://gw:4000/v1'])
  })
  it('带 /v1 后缀 → 原值 + 去 /v1 变体,尾斜杠规范化', () => {
    expect(candidateBaseUrls('http://gw:4000/v1/')).toEqual(['http://gw:4000/v1', 'http://gw:4000'])
  })
})

describe('probeEndpoint', () => {
  it('存在的路径(GET 405)= present', async () => {
    expect(await probeEndpoint(`${baseUrl}/v1`, 'openai-completions', fetchLocal)).toBe('present')
  })
  it('不存在的路径(404)= missing', async () => {
    expect(await probeEndpoint(baseUrl, 'openai-completions', fetchLocal)).toBe('missing')
  })
  it('未知协议 = missing(不可探测)', async () => {
    expect(await probeEndpoint(`${baseUrl}/v1`, 'acme-protocol', fetchLocal)).toBe('missing')
  })
})

describe('checkRoute', () => {
  it('配对正确 → ok', async () => {
    const result = await checkRoute('litellm', { api: 'openai-completions', baseURL: `${baseUrl}/v1` }, fetchLocal)
    expect(result.verdict).toBe('ok')
    expect(result.ok).toBe(true)
  })
  it('配对错误(anthropic + /v1 后缀)→ path-missing + 建议去 /v1', async () => {
    const result = await checkRoute('litellm', { api: 'anthropic-messages', baseURL: `${baseUrl}/v1` }, fetchLocal)
    expect(result.verdict).toBe('path-missing')
    expect(result.suggestedBaseURL).toBe(baseUrl)
  })
  it('网络不可达 → unreachable,不给建议', async () => {
    const result = await checkRoute('litellm', { api: 'openai-completions', baseURL: 'http://127.0.0.1:1/v1' }, fetchLocal)
    expect(result.verdict).toBe('unreachable')
    expect(result.suggestedBaseURL).toBeUndefined()
  })
  it('未知协议 → unsupported-api', async () => {
    const result = await checkRoute('litellm', { api: 'acme', baseURL: baseUrl }, fetchLocal)
    expect(result.verdict).toBe('unsupported-api')
  })
})

describe('normalizeConfig', () => {
  it('错误配对被修正为候选,正确配对原样保留', async () => {
    const config = { providers: {
      wrong: { api: 'anthropic-messages', baseURL: `${baseUrl}/v1` },
      right: { api: 'openai-completions', baseURL: `${baseUrl}/v1` },
    } }
    const outcome = await normalizeConfig(config, fetchLocal)
    expect(outcome.next).not.toBeNull()
    expect(outcome.fixes).toHaveLength(1)
    expect(outcome.fixes[0]?.provider).toBe('wrong')
    expect(outcome.next?.providers['wrong']?.baseURL).toBe(baseUrl)
    expect(outcome.next?.providers['right']?.baseURL).toBe(`${baseUrl}/v1`)
  })
  it('全部正确时 next=null(无写回)', async () => {
    const outcome = await normalizeConfig({ providers: { a: { api: 'openai-completions', baseURL: `${baseUrl}/v1` } } }, fetchLocal)
    expect(outcome.next).toBeNull()
    expect(outcome.fixes).toHaveLength(0)
  })
})

describe('pingModel', () => {
  const route = (api: string): ProviderRouteConfig => ({ api, baseURL: `${baseUrl}/v1` })
  it('openai-completions:200 → ok + 预览', async () => {
    const result = await pingModel(route('openai-completions'), 'deepseek-flash', 'sk-test', fetchLocal)
    expect(result.ok).toBe(true)
    expect(result.preview).toBe('pong')
    expect(result.latencyMs).toBeGreaterThanOrEqual(0)
  })
  it('anthropic-messages:200 → ok + 预览(baseURL 无 /v1,协议语义)', async () => {
    const result = await pingModel({ api: 'anthropic-messages', baseURL: baseUrl }, 'deepseek-flash', 'sk-test', fetchLocal)
    expect(result.ok).toBe(true)
    expect(result.preview).toBe('pong')
  })
  it('openai-responses:200 → ok + 预览', async () => {
    const result = await pingModel(route('openai-responses'), 'deepseek-flash', 'sk-test', fetchLocal)
    expect(result.ok).toBe(true)
  })
  it('404 → 失败 + 错误摘录', async () => {
    const result = await pingModel({ api: 'openai-completions', baseURL: baseUrl }, 'deepseek-flash', 'sk-test', fetchLocal)
    expect(result.ok).toBe(false)
    expect(result.error).toContain('404')
    expect(result.error).toContain('Not Found')
  })
  it('缺 baseURL → 配置不可测', async () => {
    const result = await pingModel({ api: 'openai-completions' }, 'deepseek-flash', undefined, fetchLocal)
    expect(result.ok).toBe(false)
    expect(result.error).toContain('不可测')
  })
})
