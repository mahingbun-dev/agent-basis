/**
 * T30 chat-import 租户桥(2026-11-20;47 §2.11/B16 · 50 §3.6/§5.3 · 54 §4.6)。
 *
 * 断言四组事实(全部真实 UserStore/SessionService + 记录器替身):
 * 1. 请求级门:无会话 401、workspaceId 缺失 400、他人/未登记 workspace 403,
 *    拒绝不 next()、不读上传体、审计只含身份/结果(无标题/压缩包内容);
 * 2. 流式记账:响应体原样透传,最终 outcome 行 `outcome.value.sessionIds`
 *    逐条 recordSession;progress 行/坏行/非 outcome 行不记账;
 * 3. 幂等与防窃取:已记账(含他人所有)的会话一律跳过,绝不改写归属;
 * 4. 失败/取消对账:outcome.ok=false 或断连(close)时按 workspace 会话清单
 *    补记无主会话;单行 >64KB 整行丢弃但后续行继续解析。
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AccessAuditEvent } from '../src/audit.ts'
import {
  CHAT_IMPORT_ARCHIVE_PATH,
  CHAT_IMPORT_MAX_LINE_BYTES,
  chatImportPathnameOf,
  chatImportWorkspaceIdOf,
  createChatImportGate,
  createNdjsonTap,
  installChatImportGate,
  parseChatImportOutcome,
  workspaceSessionIdsOf,
  type ChatImportRequest,
  type ChatImportResponse,
} from '../src/chat-import.ts'
import { SessionService } from '../src/session.ts'
import { UserStore } from '../src/store.ts'

const encoder = new TextEncoder()
const decoder = new TextDecoder()

function outcomeLine(ok: boolean, sessionIds: readonly string[] = []): string {
  return ok
    ? `${JSON.stringify({ type: 'outcome', outcome: { ok: true, value: { workspaceId: 'ignored', sessionIds } } })}\n`
    : `${JSON.stringify({ type: 'outcome', outcome: { ok: false, error: { reason: 'unreadable-archive', message: 'bad zip' } } })}\n`
}

function progressLine(done: number, total: number): string {
  return `${JSON.stringify({ type: 'progress', done, total })}\n`
}

/** node:http 响应替身:write/end 会被被测门包装,字节仍落 chunks。 */
class FakeResponse implements ChatImportResponse {
  status = 0
  headers: Record<string, string> = {}
  chunks: Uint8Array[] = []
  ended = false
  readonly listeners = new Map<'finish' | 'close', Array<() => void>>()

  writeHead(status: number, headers?: Record<string, string>): void {
    this.status = status
    this.headers = headers ?? {}
  }

  write(chunk: unknown): boolean {
    this.chunks.push(chunk instanceof Uint8Array ? chunk : encoder.encode(typeof chunk === 'string' ? chunk : ''))
    return true
  }

  end(chunk?: unknown): void {
    if (chunk !== undefined) this.chunks.push(chunk instanceof Uint8Array ? chunk : encoder.encode(typeof chunk === 'string' ? chunk : ''))
    this.ended = true
    this.fire('finish')
  }

  once(event: 'finish' | 'close', listener: () => void): void {
    const bucket = this.listeners.get(event) ?? []
    bucket.push(listener)
    this.listeners.set(event, bucket)
  }

  fire(event: 'finish' | 'close'): void {
    for (const listener of this.listeners.get(event) ?? []) listener()
  }

  text(): string {
    return this.chunks.map(chunk => decoder.decode(chunk)).join('')
  }
}

interface FakeRequest extends ChatImportRequest {
  readonly destroyed: number
}

function fakeRequest(options: { url: string; method?: string; cookie?: string }): FakeRequest {
  const request = {
    url: options.url,
    method: options.method ?? 'POST',
    headers: options.cookie === undefined ? {} : { cookie: options.cookie },
    destroyed: 0,
    destroy(): void {
      request.destroyed += 1
    },
  }
  return request
}

describe('chat-import 租户桥(B16/T30)', () => {
  let dir: string
  let store: UserStore
  let session: SessionService
  let aliceId: number
  let bobId: number
  let aliceCookie: string
  let workspaceSessions: Map<string, string[]>
  let audits: AccessAuditEvent[]

  const archiveUrl = (workspaceId: string): string =>
    `${CHAT_IMPORT_ARCHIVE_PATH}?workspaceId=${encodeURIComponent(workspaceId)}`

  const cookieOf = (userId: number): string =>
    `eterna_session=${session.issue({ userId, passwordVersion: store.getPasswordVersion(userId) ?? 1 })}`

  const gateOf = () => createChatImportGate({
    store,
    session,
    workspaceSessionIds: (workspaceId: string) => workspaceSessions.get(workspaceId),
    audit: (event) => { audits.push(event) },
  })

  const lastAudit = (): AccessAuditEvent => {
    const event = audits.at(-1)
    if (event === undefined) throw new Error('no audit recorded')
    return event
  }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'eterna-chat-import-'))
    store = new UserStore(join(dir, 'users.db'))
    session = new SessionService(Buffer.from('chat-import-secret-chat-import-01'))
    const alice = store.createUserWithSuffix({ account: 'alice', password: 'password8' })
    const bob = store.createUserWithSuffix({ account: 'bob', password: 'password8' })
    aliceId = alice.user.id
    bobId = bob.user.id
    store.recordWorkspace('w-alice', aliceId, '/tenant/alice')
    store.recordWorkspace('w-bob', bobId, '/tenant/bob')
    aliceCookie = cookieOf(aliceId)
    workspaceSessions = new Map([['w-alice', []], ['w-bob', []]])
    audits = []
  })

  afterEach(() => {
    store.close()
    rmSync(dir, { recursive: true, force: true })
  })

  describe('请求级租户门', () => {
    it('无 eterna 会话 → 401,不 next、不读请求体,审计 denied/unauthenticated', async () => {
      const gate = gateOf()
      const request = fakeRequest({ url: archiveUrl('w-alice') })
      const response = new FakeResponse()
      let nextCalled = false
      await gate.listener(request, response, async () => { nextCalled = true })
      expect(nextCalled).toBe(false)
      expect(response.status).toBe(401)
      expect(response.ended).toBe(true)
      expect(response.text()).toBe('unauthorized')
      expect(request.destroyed).toBe(1)
      expect(lastAudit().kind).toBe('access.chatImport')
      expect(lastAudit().detail).toMatchObject({ action: 'denied', reason: 'unauthenticated' })
    })

    it('非法 cookie/改密后的旧 cookie → 401(pwv 比对,与守卫路由同口径)', async () => {
      const gate = gateOf()
      const bad = new FakeResponse()
      await gate.listener(fakeRequest({ url: archiveUrl('w-alice'), cookie: 'eterna_session=garbage' }), bad, async () => {})
      expect(bad.status).toBe(401)

      const stale = cookieOf(aliceId)
      store.setPassword(aliceId, 'password8', 'password9')
      const staleResponse = new FakeResponse()
      await gate.listener(fakeRequest({ url: archiveUrl('w-alice'), cookie: stale }), staleResponse, async () => {})
      expect(staleResponse.status).toBe(401)
    })

    it('workspaceId 缺失/空 → 400(与上游同口径,不触达导入体)', async () => {
      const gate = gateOf()
      for (const url of [CHAT_IMPORT_ARCHIVE_PATH, `${CHAT_IMPORT_ARCHIVE_PATH}?workspaceId=`]) {
        const response = new FakeResponse()
        let nextCalled = false
        await gate.listener(fakeRequest({ url, cookie: aliceCookie }), response, async () => { nextCalled = true })
        expect(nextCalled).toBe(false)
        expect(response.status).toBe(400)
      }
    })

    it('他人 workspace → 403;未登记 workspace 同样 403(fail-closed)', async () => {
      const gate = gateOf()
      for (const workspaceId of ['w-bob', 'w-unregistered']) {
        const response = new FakeResponse()
        let nextCalled = false
        await gate.listener(fakeRequest({ url: archiveUrl(workspaceId), cookie: aliceCookie }), response, async () => { nextCalled = true })
        expect(nextCalled).toBe(false)
        expect(response.status).toBe(403)
        expect(response.text()).toBe('forbidden')
      }
      expect(store.sessionOwner('s-any')).toBeUndefined()
    })

    it('拒绝审计只记身份/结果,不含标题或压缩包内容', async () => {
      const gate = gateOf()
      await gate.listener(fakeRequest({ url: archiveUrl('w-bob'), cookie: aliceCookie }), new FakeResponse(), async () => {})
      const detail = lastAudit().detail ?? {}
      expect(Object.keys(detail).sort()).toEqual(['action', 'reason', 'userId', 'workspaceId'])
      expect(detail).toMatchObject({ action: 'denied', reason: 'workspace-foreign', userId: aliceId, workspaceId: 'w-bob' })
    })

    it('非目标路径与非 POST 原样 next(不写状态、不记账)', async () => {
      const gate = gateOf()
      for (const probe of [
        { url: '/api/session/list', method: 'POST' },
        { url: archiveUrl('w-alice'), method: 'GET' },
        { url: '/api/deepseek-chat-import/limits', method: 'POST' },
      ]) {
        const response = new FakeResponse()
        let nextCalled = false
        await gate.listener(
          fakeRequest({ url: probe.url, method: probe.method, cookie: aliceCookie }),
          response,
          async () => { nextCalled = true },
        )
        expect(nextCalled).toBe(true)
        expect(response.status).toBe(0)
      }
      expect(audits).toHaveLength(0)
    })

    it('query 顺序/额外参数不影响判定(只认 workspaceId)', () => {
      expect(chatImportWorkspaceIdOf(`${CHAT_IMPORT_ARCHIVE_PATH}?foo=1&workspaceId=w-alice`)).toBe('w-alice')
      expect(chatImportPathnameOf(`${CHAT_IMPORT_ARCHIVE_PATH}?workspaceId=w-alice`)).toBe(CHAT_IMPORT_ARCHIVE_PATH)
      expect(chatImportPathnameOf(`http://app.local${CHAT_IMPORT_ARCHIVE_PATH}?x=1`)).toBe(CHAT_IMPORT_ARCHIVE_PATH)
    })
  })

  describe('流式记账(outcome.value.sessionIds)', () => {
    it('本人 workspace 放行:响应字节原样透传 + outcome sessionIds 逐条 recordSession', async () => {
      const gate = gateOf()
      const response = new FakeResponse()
      let nextCalled = 0
      await gate.listener(fakeRequest({ url: archiveUrl('w-alice'), cookie: aliceCookie }), response, async () => {
        nextCalled += 1
        response.write(encoder.encode(progressLine(1, 2)))
        response.write(encoder.encode(progressLine(2, 2)))
        response.write(encoder.encode(outcomeLine(true, ['s-1', 's-2'])))
        response.end()
      })
      await gate.whenIdle()
      expect(nextCalled).toBe(1)
      // pass-through:响应字节与上游写出的完全一致
      expect(response.text()).toBe(progressLine(1, 2) + progressLine(2, 2) + outcomeLine(true, ['s-1', 's-2']))
      expect(store.sessionOwner('s-1')).toBe(aliceId)
      expect(store.sessionOwner('s-2')).toBe(aliceId)
      expect(lastAudit().detail).toMatchObject({
        action: 'import.ok', userId: aliceId, workspaceId: 'w-alice', sessions: 2, skipped: 0, reconciled: 0, outcomeOk: true,
      })
    })

    it('跨 chunk 的半行被拼回(行解析不依赖 chunk 边界)', async () => {
      const gate = gateOf()
      const response = new FakeResponse()
      const line = outcomeLine(true, ['s-split'])
      await gate.listener(fakeRequest({ url: archiveUrl('w-alice'), cookie: aliceCookie }), response, async () => {
        response.write(encoder.encode(line.slice(0, 17)))
        response.write(encoder.encode(line.slice(17)))
        response.end()
      })
      await gate.whenIdle()
      expect(store.sessionOwner('s-split')).toBe(aliceId)
    })

    it('坏行/非 outcome 行不阻断也不记账;ok:false 不按 outcome 记账', async () => {
      const gate = gateOf()
      const response = new FakeResponse()
      await gate.listener(fakeRequest({ url: archiveUrl('w-alice'), cookie: aliceCookie }), response, async () => {
        response.write(encoder.encode('not json at all\n'))
        response.write(encoder.encode(`${JSON.stringify({ type: 'progress', done: 3, total: 9 })}\n`))
        response.write(encoder.encode(`${JSON.stringify({ type: 'outcome', outcome: { ok: true, value: {} } })}\n`))
        response.write(encoder.encode(outcomeLine(false)))
        response.end()
      })
      await gate.whenIdle()
      expect(lastAudit().detail).toMatchObject({ action: 'import.rejected', sessions: 0, reconciled: 0 })
    })

    it('幂等:重复导入同一包不重复记账;他人所有的 sessionId 一律不改写', async () => {
      const gate = gateOf()
      const first = new FakeResponse()
      await gate.listener(fakeRequest({ url: archiveUrl('w-alice'), cookie: aliceCookie }), first, async () => {
        first.write(encoder.encode(outcomeLine(true, ['s-1'])))
        first.end()
      })
      await gate.whenIdle()
      const stolen = 's-bob-owned'
      store.recordSession(stolen, bobId, 'w-bob')
      const second = new FakeResponse()
      await gate.listener(fakeRequest({ url: archiveUrl('w-alice'), cookie: aliceCookie }), second, async () => {
        second.write(encoder.encode(outcomeLine(true, ['s-1', stolen])))
        second.end()
      })
      await gate.whenIdle()
      expect(store.sessionOwner('s-1')).toBe(aliceId)
      expect(store.sessionOwner(stolen)).toBe(bobId)
      expect(lastAudit().detail).toMatchObject({ action: 'import.ok', sessions: 0, skipped: 2 })
    })

    it('无 outcome 行且状态非 200(415/404 等)→ 记 import.rejected,不误记取消', async () => {
      const gate = gateOf()
      const response = new FakeResponse()
      await gate.listener(fakeRequest({ url: archiveUrl('w-alice'), cookie: aliceCookie }), response, async () => {
        response.writeHead(415, { 'content-type': 'text/plain' })
        response.end('content type must be application/octet-stream')
      })
      await gate.whenIdle()
      expect(lastAudit().detail).toMatchObject({ action: 'import.rejected', status: 415, sessions: 0 })
    })

    it(`单行 >${CHAT_IMPORT_MAX_LINE_BYTES}B 整行丢弃、后续行继续解析`, async () => {
      const gate = gateOf()
      const response = new FakeResponse()
      const huge = `${JSON.stringify({ type: 'outcome', outcome: { ok: true, value: { sessionIds: ['s-huge'], pad: 'x'.repeat(CHAT_IMPORT_MAX_LINE_BYTES) } } })}\n`
      expect(huge.length).toBeGreaterThan(CHAT_IMPORT_MAX_LINE_BYTES)
      await gate.listener(fakeRequest({ url: archiveUrl('w-alice'), cookie: aliceCookie }), response, async () => {
        response.write(encoder.encode(huge))
        response.write(encoder.encode(outcomeLine(true, ['s-after'])))
        response.end()
      })
      await gate.whenIdle()
      expect(store.sessionOwner('s-huge')).toBeUndefined()
      expect(store.sessionOwner('s-after')).toBe(aliceId)
    })
  })

  describe('失败/取消对账(workspaceRegistry.sessionIds)', () => {
    it('outcome.ok=false(损坏包):已写入会话按 workspace 清单补记,审计 reconcile 计数', async () => {
      workspaceSessions.set('w-alice', ['s-1', 's-partial'])
      const gate = gateOf()
      const response = new FakeResponse()
      await gate.listener(fakeRequest({ url: archiveUrl('w-alice'), cookie: aliceCookie }), response, async () => {
        response.write(encoder.encode(`${JSON.stringify({ type: 'progress', done: 1, total: 2 })}\n`))
        response.write(encoder.encode(outcomeLine(false)))
        response.end()
      })
      await gate.whenIdle()
      expect(store.sessionOwner('s-1')).toBe(aliceId)
      expect(store.sessionOwner('s-partial')).toBe(aliceId)
      expect(lastAudit().detail).toMatchObject({ action: 'import.rejected', sessions: 0, reconciled: 2 })
    })

    it('客户端断开(close,无 outcome 行):对账补记,审计 import.cancelled', async () => {
      workspaceSessions.set('w-alice', ['s-orphan'])
      const gate = gateOf()
      const response = new FakeResponse()
      await gate.listener(fakeRequest({ url: archiveUrl('w-alice'), cookie: aliceCookie }), response, async () => {
        response.write(encoder.encode(progressLine(1, 5)))
        response.fire('close')
      })
      await gate.whenIdle()
      expect(store.sessionOwner('s-orphan')).toBe(aliceId)
      expect(lastAudit().detail).toMatchObject({ action: 'import.cancelled', reconciled: 1 })
    })

    it('workspaceRegistry 缺席/形态漂移 → 对账降级为 0,不抛不阻断', async () => {
      const gate = createChatImportGate({
        store,
        session,
        workspaceSessionIds: () => undefined,
        audit: (event) => { audits.push(event) },
      })
      const response = new FakeResponse()
      await gate.listener(fakeRequest({ url: archiveUrl('w-alice'), cookie: aliceCookie }), response, async () => {
        response.write(encoder.encode(outcomeLine(true, ['s-direct'])))
        response.end()
      })
      await gate.whenIdle()
      expect(store.sessionOwner('s-direct')).toBe(aliceId)
      expect(lastAudit().detail).toMatchObject({ action: 'import.ok', sessions: 1, reconciled: 0 })
    })
  })

  describe('安装与探针面', () => {
    it('installChatImportGate 以 prepend 注册 connection/request;host 缺面返回 undefined', () => {
      const on = vi.fn((_event: string, _listener: unknown, _options?: { readonly prepend?: boolean }) => () => {})
      const dispose = installChatImportGate({
        store,
        session,
        workspaceSessionIds: () => [],
        audit: (event) => { audits.push(event) },
      }, { on })
      expect(typeof dispose).toBe('function')
      expect(on).toHaveBeenCalledTimes(1)
      expect(on.mock.calls[0]?.[0]).toBe('connection/request')
      expect(on.mock.calls[0]?.[2]).toEqual({ prepend: true })
      expect(installChatImportGate({
        store,
        session,
        workspaceSessionIds: () => [],
        audit: () => {},
      }, undefined)).toBeUndefined()
    })

    it('workspaceSessionIdsOf 结构读取:命中 .sessionIds、服务缺席/异常一律 undefined', () => {
      const reflect = (value: unknown) => ({ get: (key: string, _strict?: boolean) => (key === 'workspaceRegistry' ? value : undefined) })
      expect(workspaceSessionIdsOf(reflect({ get: () => ({ sessionIds: ['a', 2, 'b'] }) }), 'w')).toEqual(['a', 'b'])
      expect(workspaceSessionIdsOf(reflect({ get: () => undefined }), 'w')).toBeUndefined()
      expect(workspaceSessionIdsOf(reflect(undefined), 'w')).toBeUndefined()
      expect(workspaceSessionIdsOf(reflect({ get: () => { throw new Error('boom') } }), 'w')).toBeUndefined()
    })

    it('parseChatImportOutcome:只有 outcome 行有值,progress/坏行/非数组 sessionIds 安全降级', () => {
      expect(parseChatImportOutcome('')).toBeUndefined()
      expect(parseChatImportOutcome('{"type":"progress","done":1,"total":2}')).toBeUndefined()
      expect(parseChatImportOutcome('{"type":"outcome"')).toBeUndefined()
      expect(parseChatImportOutcome('{"type":"outcome","outcome":{"ok":true,"value":{"sessionIds":"x"}}}'))
        .toEqual({ ok: true, sessionIds: [] })
      expect(parseChatImportOutcome('{"type":"outcome","outcome":{"ok":true,"value":{"sessionIds":["a",null,3,"b"]}}}'))
        .toEqual({ ok: true, sessionIds: ['a', 'b'] })
      expect(parseChatImportOutcome('{"type":"outcome","outcome":{"ok":false}}')).toEqual({ ok: false, sessionIds: [] })
    })

    it('createNdjsonTap 输出=输入(pass-through 不缓冲)', async () => {
      const lines: string[] = []
      const tap = createNdjsonTap((line) => { lines.push(line) })
      const output: Uint8Array[] = []
      const writer = tap.writable.getWriter()
      const read = tap.readable.pipeTo(new WritableStream({ write(chunk) { output.push(chunk) } }))
      await writer.write(encoder.encode('a\nb'))
      await writer.write(encoder.encode('\nc'))
      await writer.close()
      await read
      expect(output.map(chunk => decoder.decode(chunk)).join('')).toBe('a\nb\nc')
      expect(lines).toEqual(['a', 'b', 'c'])
    })
  })
})
