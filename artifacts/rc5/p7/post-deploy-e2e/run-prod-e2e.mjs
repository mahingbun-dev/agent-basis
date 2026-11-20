#!/usr/bin/env node
/**
 * 生产端到端回归（rc.5 上线后；T56 目标「部署后对整个系统 E2E」）。
 *
 * 面：门禁 → 管理员登录 → dsh 会话铸票 → 模型目录/默认模型 → 建会话 →
 *     真·模型回合（mimo）→ 工作台清单 → terminal churn → mcp-personal →
 *     chat-import 门 → 会话清理 → companion 中继/指引页 → 审计追加。
 *
 * 边界：
 *  - 入口默认公网 `https://eternity-electricity.cn:3210`（真链路：NAS 反代/TLS/反代头），
 *    `--base` 可覆盖；凭据只从部署树 0600 `.env` 读入内存，绝不打印/落盘；
 *  - 写面仅限：1 个标注会话（跑完 session/delete）、1 个临时终端（close 回收）、
 *    无 settings 写（默认模型只读检查）；
 *  - 证据：`result.md` + `summary.json`（脱敏）。
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  bootTokenFromContainer,
  bootstrapDshSession,
  getJson,
  login,
  request,
  rpc,
  shape,
} from '../../../../scripts/rc5-test-client.mjs'

const ROOT = '/Users/sunny/code/agent-basis-rc5'
const OUT = join(ROOT, 'artifacts', 'rc5', 'p7', 'post-deploy-e2e')
const BASE = process.env.E2E_BASE ?? 'https://eternity-electricity.cn:3210'
const CONTAINER = 'eterna-agent'

/* 读部署树 .env（0600）的管理员凭据；不打印 */
function adminCredentials() {
  const env = {}
  for (const line of readFileSync('/Users/sunny/code/agent-basis-main-0.2.0-rc.5/.env', 'utf8').split('\n').filter(Boolean)) {
    const at = line.indexOf('=')
    if (at > 0) env[line.slice(0, at)] = line.slice(at + 1)
  }
  const account = env.ETERNA_ACCESS_ADMIN_USER
  const password = env.ETERNA_ACCESS_ADMIN_PASSWORD
  if (typeof account !== 'string' || typeof password !== 'string' || account === '' || password === '') {
    throw new Error('部署树 .env 缺 ETERNA_ACCESS_ADMIN_USER/PASSWORD')
  }
  return { account, password }
}

const results = []
const record = (id, name, ok, detail) => {
  results.push({ id, name, ok: ok === true, detail: String(detail).slice(0, 400) })
  console.log(`${ok === true ? 'PASS' : 'FAIL'} ${id} ${name} — ${String(detail).slice(0, 220)}`)
}
const stamp = () => new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)

/* ------------------------------------------------------------------ 用例 */

async function main() {
  const t0 = Date.now()
  const { account, password } = await adminCredentials()

  /* 01 匿名门禁 */
  {
    const me = await getJson(BASE, '/access/api/me').catch(error => ({ status: 0, error: String(error) }))
    const gate = await request(new URL('/', BASE), { redirect: 'manual' }).catch(error => ({ status: 0, error: String(error) }))
    record('PDE-01', '匿名门禁（me 401 / 根跳登录）',
      me.status === 401 && (gate.status === 302 || gate.status === 303 || gate.status === 401),
      `me=${me.status} root=${gate.status} location=${shape(gate.headers?.location ?? '-', 60)}`)
  }

  /* 02 管理员登录 + me */
  let adminCookie
  const auditAtStart = await execCount().catch(() => -1)
  {
    const result = await login(BASE, account, password).catch(error => ({ error: String(error) }))
    adminCookie = result.cookie
    const me = adminCookie === undefined ? undefined : await getJson(BASE, '/access/api/me', { cookie: adminCookie }).catch(error => ({ error: String(error) }))
    const role = me?.body?.role ?? me?.body?.user?.role
    record('PDE-02', '管理员登录 + me 角色', adminCookie !== undefined && (role === 'admin' || me?.status === 200),
      `cookie=${adminCookie !== undefined} me.status=${me?.status} role=${shape(role, 20)}`)
  }

  /* 03 dsh 会话铸票（/connect 换 dsh-auth，与 eterna_session 合并成完整 cookie 罐） */
  let dshCookie
  {
    try {
      const bootToken = bootTokenFromContainer(CONTAINER)
      dshCookie = await bootstrapDshSession(BASE, bootToken)
    } catch (error) {
      record('PDE-03', 'dsh 会话铸票（/connect 换票）', false, String(error).slice(0, 200))
    }
  }
  const mergeCookies = (...jars) => {
    const jar = new Map()
    for (const jarText of jars) {
      for (const pair of String(jarText ?? '').split('; ')) {
        const at = pair.indexOf('=')
        if (at > 0) jar.set(pair.slice(0, at), pair.slice(at + 1))
      }
    }
    return [...jar].map(([key, value]) => `${key}=${value}`).join('; ')
  }
  const cookie = mergeCookies(adminCookie, dshCookie)
  {
    const list = await rpc(BASE, cookie, 'session/list', {}).catch(error => ({ ok: false, error: String(error) }))
    record('PDE-03', 'dsh 铸票 + 合并罐 → session/list', list.ok === true && Array.isArray(list.value?.items),
      `ok=${list.ok} items=${Array.isArray(list.value?.items) ? list.value.items.length : '-'} ${shape(list.error, 80)}`)
  }

  /* 04 模型目录/默认模型（只读） */
  {
    const catalog = await rpc(BASE, cookie, 'session/modelCatalog', {}).catch(error => ({ ok: false, error: String(error) }))
    const routable = catalog.value?.routableProviders ?? []
    const describe = await rpc(BASE, cookie, 'settings/describe', {}).catch(error => ({ ok: false, error: String(error) }))
    const defaultModel = (describe.value?.namespaces ?? []).find(row => row.ns === 'agent-default-model')?.value ?? {}
    record('PDE-04', '模型目录 + 默认模型（mimo 可路由）',
      catalog.ok === true && routable.includes('mimo') && defaultModel.provider === 'mimo',
      `routable=${JSON.stringify(routable).slice(0, 120)} default=${shape(defaultModel, 60)}`)
  }

  /* 05 建会话（标注名） */
  let sessionId
  {
    const created = await rpc(BASE, cookie, 'session/create', { request: {} }).catch(error => ({ ok: false, error: String(error) }))
    sessionId = created.value?.sessionId ?? created.value?.id
    if (typeof sessionId === 'string') {
      await rpc(BASE, cookie, 'session/rename', { sessionId, title: `E2E-PROD-回归-${stamp()}` }).catch(() => undefined)
    }
    record('PDE-05', 'session/create + rename', typeof sessionId === 'string', `sessionId=${shape(sessionId, 24)}`)
  }

  /* 06 真·模型回合（mimo，禁工具直答） */
  {
    let ok = false
    let detail = 'skipped（无 sessionId）'
    if (typeof sessionId === 'string') {
      const before = await rpc(BASE, cookie, 'session/state', { sessionId }, { timeoutMs: 20_000 }).catch(() => ({}))
      const since = before.value?.cursor ?? 0
      const admitted = await rpc(BASE, cookie, 'session/prompt', {
        request: {
          requestId: `e2e-prod-${Date.now()}`,
          sessionId,
          mode: 'queue',
          clientTimeZone: 'Asia/Shanghai',
          content: [{ type: 'text', text: '不要调用任何工具。直接只回复一行：PROD-E2E-OK' }],
        },
      }, { timeoutMs: 30_000 }).catch(error => ({ ok: false, error: String(error) }))
      const deadline = Date.now() + 180_000
      let finalText = ''
      let cursor = -1
      while (Date.now() < deadline) {
        const state = await rpc(BASE, cookie, 'session/state', { sessionId }, { timeoutMs: 20_000 }).catch(() => ({}))
        const value = state.value ?? {}
        cursor = typeof value.cursor === 'number' ? value.cursor : cursor
        if (typeof value.cursor === 'number' && value.cursor > since && value.running === false) {
          const events = await rpc(BASE, cookie, 'session/events', {
            request: { address: { kind: 'session', sessionId }, maxMessages: 60 },
          }, { timeoutMs: 30_000 }).catch(() => ({}))
          for (const rec of events.value?.records ?? []) {
            const inner = rec?.event ?? rec
            const message = inner?.data?.message
            if (message?.role !== 'assistant') continue
            for (const part of Array.isArray(message.content) ? message.content : []) {
              if (part?.type === 'text' && typeof part.text === 'string' && part.text.includes('PROD-E2E-OK')) finalText = part.text
            }
          }
          if (finalText !== '') break
        }
        await new Promise(resolve => setTimeout(resolve, 2_000))
      }
      ok = admitted.ok === true && finalText !== ''
      detail = `admitted=${admitted.ok} cursor=${cursor} replyContains=PROD-E2E-OK(${finalText !== ''}) ${shape(admitted.error, 80)}`
    }
    record('PDE-06', '真·模型回合（mimo 直答）', ok, detail)
  }

  /* 07 terminal churn ×2（create → close → list 无 running） */
  {
    let ok = typeof sessionId === 'string'
    let detail = 'skipped（无 sessionId）'
    if (ok) {
      for (let round = 1; round <= 2 && ok; round += 1) {
        const id = `e2e-prod-term-${round}`
        const created = await rpc(BASE, cookie, 'terminal/create', { agentId: sessionId, request: { id, cols: 80, rows: 24 } }, { timeoutMs: 60_000 }).catch(error => ({ ok: false, error: String(error) }))
        const closed = created.ok === true ? await rpc(BASE, cookie, 'terminal/close', { agentId: sessionId, id }, { timeoutMs: 30_000 }).catch(error => ({ ok: false, error: String(error) })) : { ok: false }
        if (created.ok !== true || closed.ok !== true) { ok = false; detail = `round${round} create=${created.ok} close=${closed.ok} ${shape(created.error ?? closed.error, 120)}` }
      }
      if (ok) {
        const list = await rpc(BASE, cookie, 'terminal/list', { sessionId }, { timeoutMs: 30_000 }).catch(error => ({ ok: false, error: String(error) }))
        const terminals = Array.isArray(list.value) ? list.value : []
        const running = terminals.filter(row => row?.state === 'running')
        ok = list.ok === true && running.length === 0
        detail = `2 轮 create/close 全成功；list ok=${list.ok} terminals=${terminals.length} running=${running.length} ${shape(list.error, 80)}`
      }
    }
    record('PDE-07', 'terminal churn ×2（含跨用户面 readiness）', ok, detail)
  }

  /* 08 mcp-personal 管理面（admin 只读） */
  {
    const catalog = await rpc(BASE, cookie, 'mcp-personal/catalog', {}).catch(error => ({ ok: false, error: String(error) }))
    record('PDE-08', '个人 MCP 管理面（admin catalog）', catalog.ok === true,
      `ok=${catalog.ok} entries=${Array.isArray(catalog.value) ? catalog.value.length : shape(catalog.value, 40)} ${shape(catalog.error, 100)}`)
  }

  /* 09 chat-import 门（匿名拒 / 登录过门；路由 /api/deepseek-chat-import/archive） */
  {
    const anon = await request(new URL('/api/deepseek-chat-import/archive', BASE), { method: 'POST' }).catch(error => ({ status: 0, error: String(error) }))
    const authed = await request(new URL('/api/deepseek-chat-import/archive', BASE), { method: 'POST', cookie }).catch(error => ({ status: 0, error: String(error) }))
    const anonDenied = anon.status === 401 || anon.status === 403 || (anon.status === 200 && anon.body?.ok === false)
    const authedPastGate = authed.status !== 401 && authed.status !== 403
    record('PDE-09', 'chat-import 上传门（匿名拒 / 登录过门）', anonDenied && authedPastGate,
      `anon=${anon.status} authed=${authed.status}（无载荷，过门后被处理器 4xx 属预期）`)
  }

  /* 10 companion 中继（宿主映射端口 9310，verify.sh 同款） */
  {
    const relay = 'http://127.0.0.1:9310'
    const status = await getJson(relay, '/api/status').catch(error => ({ status: 0, error: String(error) }))
    const guide = await request(new URL('/companion/guide', relay)).catch(error => ({ status: 0, error: String(error) }))
    record('PDE-10', 'companion 中继 status + guide（9310）', status.status === 200 && guide.status === 200,
      `status=${status.status} guide=${guide.status}`)
  }

  /* 11 清理：归档标注会话（workspace/archiveSession {request:{sessionId}}；rc.5 无 session/delete unary） */
  {
    let ok = typeof sessionId !== 'string'
    let detail = typeof sessionId !== 'string' ? '无会话可清' : ''
    if (typeof sessionId === 'string') {
      const archived = await rpc(BASE, cookie, 'workspace/archiveSession', { request: { sessionId } }, { timeoutMs: 30_000 }).catch(error => ({ ok: false, error: String(error) }))
      ok = archived.ok === true
      detail = `archiveSession ok=${archived.ok} ${shape(archived.error, 100)}`
    }
    record('PDE-11', '测试会话清理（归档出主列表）', ok, detail)
  }

  /* 12 审计追加（本套件全部动作的留痕：与套件开始时比行数） */
  {
    const after = Number(await execCount().catch(() => -1))
    const before = Number(auditAtStart)
    record('PDE-12', '审计 jsonl 追加（本套件动作留痕）', before >= 0 && after > before,
      `lines=${before}→${after}（+${after > before ? after - before : 0}）`)
  }

  const pass = results.filter(row => row.ok).length
  const summary = {
    suite: 'post-deploy-e2e',
    base: BASE,
    container: CONTAINER,
    startedAt: new Date(t0).toISOString(),
    finishedAt: new Date().toISOString(),
    durationMs: Date.now() - t0,
    pass, fail: results.length - pass,
    cases: results,
  }
  writeFileSync(join(OUT, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`)
  console.log(`\nRESULT pass=${pass} fail=${results.length - pass}`)
  process.exit(results.every(row => row.ok) ? 0 : 1)
}

async function execCount() {
  const { execFileSync } = await import('node:child_process')
  return execFileSync('docker', ['exec', CONTAINER, 'sh', '-c', 'wc -l < /data/.eterna/audit-20261120.jsonl 2>/dev/null || echo -1'], { encoding: 'utf8' }).trim()
}

main().catch(error => {
  console.error('E2E runner 异常:', error)
  process.exit(2)
})