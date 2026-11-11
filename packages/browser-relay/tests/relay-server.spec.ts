// RelayServer 集成测试（E4）：HTTP 凭据校验（/api/tools 401/放行）、tokensFile
// 用户清单命中、同令牌 ws 二接入 409、多连接 status 汇总。
// 起真实 http server（随机端口），ws 用 ws 库客户端。
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WebSocket } from 'ws'
import { RelayServer } from '../src/server.ts'

// 连入并发 hello（扩展真实行为：open 后立刻 hello 才在 relay 注册命名空间）
const withWs = async (url: string): Promise<{ code: number | undefined }> => {
  return await new Promise((resolve) => {
    const ws = new WebSocket(url)
    let settled = false
    const done = (code: number | undefined): void => {
      if (settled) return
      settled = true
      try { ws.close() } catch { /* 已关 */ }
      resolve({ code })
    }
    ws.on('open', () => {
      ws.send(JSON.stringify({ t: 'hello', proto: 1, ext: 'test', extVersion: '0.1.0', chromeVersion: '157.0.0.0' }))
      setTimeout(() => {
        done(101)
      }, 250)
    })
    ws.on('unexpected-response', (_req, res) => { done(res.statusCode) })
    ws.on('close', (code) => { if (code === 4002) done(409) })
    ws.on('error', () => {})
    setTimeout(() => {
      done(undefined)
    }, 5000)
  })
}

describe('RelayServer（E4 鉴权与多连接）', () => {
  const dir = mkdtempSync(join(tmpdir(), 'relay-server-test-'))
  const tokensFile = join(dir, 'companion-tokens.json')
  let server: RelayServer
  let port = 0

  beforeAll(async () => {
    writeFileSync(tokensFile, JSON.stringify({
      '7': { token: 'tok-user-7', createdAt: '2026-11-11T00:00:00Z' },
    }))
    server = new RelayServer({
      port: 0,
      token: 'tok-primary',
      tokensFile,
      log: () => {},
    })
    await server.start()
    // listen(0) 后取实际端口
    const addr = (server as unknown as { httpServer: { address(): { port: number } } }).httpServer.address()
    port = addr.port
  })

  afterAll(() => {
    void server.stop()
    rmSync(dir, { recursive: true, force: true })
  })

  const base = (): string => `http://127.0.0.1:${String(port)}`

  it('/api/tools 无凭据 → 401（公网裸奔缺口闭合）', async () => {
    const res = await fetch(`${base()}/api/tools`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"name":"browser_snapshot","args":{}}' })
    expect(res.status).toBe(401)
    const body = await res.json() as { error?: { code?: string } }
    expect(body.error?.code).toBe('UNAUTHORIZED')
  })

  it('/api/tools 主 token header 命中 → 执行（无扩展连接返回 NO_EXTENSION 结构化错）', async () => {
    const res = await fetch(`${base()}/api/tools`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-relay-token': 'tok-primary' },
      body: '{"name":"browser_snapshot","args":{"url":"https://example.com"}}',
    })
    expect(res.status).toBe(200)
    const body = await res.json() as { ok?: boolean; error?: { code?: string } }
    expect(body.ok).toBe(false)
    expect(body.error?.code).toBe('NO_EXTENSION')
  })

  it('/api/tools 用户清单 token header 命中 → 放行', async () => {
    const res = await fetch(`${base()}/api/tools`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-relay-token': 'tok-user-7' },
      body: '{"name":"browser_snapshot","args":{}}',
    })
    expect(res.status).toBe(200)
  })

  it('/api/tools 非清单 token → 401', async () => {
    const res = await fetch(`${base()}/api/tools`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-relay-token': 'tok-not-in-list' },
      body: '{"name":"browser_snapshot","args":{}}',
    })
    expect(res.status).toBe(401)
  })

  it('/extension ws：主 token 与用户 token 并行接入，同 token 二接入 409', async () => {
    const b = `ws://127.0.0.1:${String(port)}`
    const hold = (token: string): Promise<{ ws: WebSocket; helloed: Promise<void> }> => {
      return new Promise((resolve) => {
        const ws = new WebSocket(`${b}/extension?token=${encodeURIComponent(token)}`)
        const helloed = new Promise<void>((res) => {
          ws.on('open', () => {
            ws.send(JSON.stringify({ t: 'hello', proto: 1, ext: 'test', extVersion: '0.1.0', chromeVersion: '157.0.0.0' }))
            setTimeout(res, 200)
          })
        })
        ws.on('error', () => {})
        resolve({ ws, helloed })
      })
    }
    const c1 = await hold('tok-primary')
    const c2 = await hold('tok-user-7')
    await c1.helloed
    await c2.helloed
    expect(server.core.connectedCount).toBe(2)
    // 同 token 第二接入：upgrade 层 409（该令牌已有浏览器接入）
    const r3 = await withWs(`${b}/extension?token=tok-user-7`)
    expect(r3.code).toBe(409)
    const r4 = await withWs(`${b}/extension?token=tok-not-in-list`)
    expect(r4.code).toBe(401)
    c1.ws.close()
    c2.ws.close()
  })

  it('/api/status 多连接汇总', async () => {
    const res = await fetch(`${base()}/api/status`)
    const body = await res.json() as { connectedBrowsers?: number; browsers?: unknown[] }
    // 上一个用例的 ws 已随 withWs resolve 关闭（close 已发），状态以最终 close 后为准
    expect(body.browsers).toBeInstanceOf(Array)
    expect(typeof body.connectedBrowsers).toBe('number')
  })
})
