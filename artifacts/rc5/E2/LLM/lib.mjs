#!/usr/bin/env node
/**
 * rc.5 验收 · 确定性假模型回合的公共工具。
 *
 * 边界：只操作 E2 lane（rc5-e2suite / 3119 / 测试数据根），不碰其它容器。
 * 凭据：复用 rc5-test-client 的 0600 账号文件；不打印/不落盘 cookie。
 */
import { appendFileSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { LANE, call, readDb, sessions, sleep } from '../_lib/env.mjs'
import { redact } from '../_lib/evidence.mjs'

export const PROVIDER_ID = 'fake'
export const MODEL_ID = 'fake-1'
export const HOST_PORT = Number(process.env.FAKE_LLM_PORT ?? 4599)
export const LOG_PATH = join(LANE.evidenceRoot, 'LLM', 'tmp', 'fake-llm.jsonl')

export function logMark() {
  if (!existsSync(LOG_PATH)) return 0
  return readFileSync(LOG_PATH, 'utf8').split('\n').filter(Boolean).length
}

export function logSince(mark) {
  if (!existsSync(LOG_PATH)) return []
  const lines = readFileSync(LOG_PATH, 'utf8').split('\n').filter(Boolean).slice(mark)
  return lines.map(line => JSON.parse(line))
}

/**
 * 等假模型请求日志「安静」：连续 quietMs 没有新请求即视为回合/子代理已收尾。
 * 子代理是异步派发——父会话 waitIdle 返回时子代理可能还在跑，随后做删除类
 * 写操作会把子代理 mid-turn 的 scope 摘掉（MCPP-020 实测假阴性来源）。
 */
export async function waitQuiet(mark, { quietMs = 2500, timeoutMs = 90_000, minRows = 1 } = {}) {
  const t0 = Date.now()
  let lastCount = logSince(mark).length
  let lastGrowth = Date.now()
  for (;;) {
    await sleep(250)
    const count = logSince(mark).length
    if (count !== lastCount) {
      lastCount = count
      lastGrowth = Date.now()
    } else if (count >= minRows && Date.now() - lastGrowth >= quietMs) {
      return logSince(mark)
    }
    if (Date.now() - t0 > timeoutMs) return logSince(mark)
  }
}

export function fakeProvider() {
  return {
    displayName: 'RC5 Fake（确定性验收夹具）',
    apiKeyEnv: 'FAKE_LLM_API_KEY',
    api: 'openai-completions',
    baseURL: `http://host.docker.internal:${HOST_PORT}/v1`,
    models: [{
      id: MODEL_ID,
      name: 'Fake 1',
      contextWindow: 128000,
      maxTokens: 4096,
      input: ['text'],
      compat: {
        supportsDeveloperRole: true,
        requiresReasoningContentOnAssistantMessages: false,
        maxTokensField: 'max_tokens',
      },
    }],
  }
}

/** 幂等：写入 fake provider + 默认模型，并确认 route 可路由。 */
export async function ensureFakeRoute(cookie) {
  const write = await call(cookie, 'settings/update', {
    request: { ns: 'llm-pi-ai', patch: { providers: { [PROVIDER_ID]: fakeProvider() } } },
  }, { timeoutMs: 30_000 })
  if (write.ok !== true) throw new Error(`llm-pi-ai 写入失败: ${JSON.stringify(write.error)}`)
  const model = await call(cookie, 'settings/update', {
    request: { ns: 'agent-default-model', patch: { provider: PROVIDER_ID, model: MODEL_ID } },
  }, { timeoutMs: 30_000 })
  if (model.ok !== true) throw new Error(`default model 写入失败: ${JSON.stringify(model.error)}`)
  const probe = await call(cookie, 'session/modelCatalog', {}, { timeoutMs: 30_000 })
  const routable = probe.value?.routableProviders ?? []
  if (!routable.includes(PROVIDER_ID)) throw new Error(`fake route 不可路由: ${JSON.stringify(routable)}`)
}

/** 收尾：把默认模型恢复为 mimo，并去掉 fake provider。 */
export async function cleanupFakeRoute(cookie) {
  await call(cookie, 'settings/update', {
    request: { ns: 'agent-default-model', patch: { provider: 'mimo', model: 'mimo-v2.6-pro' } },
  }, { timeoutMs: 30_000 }).catch(() => undefined)
  const describe = await call(cookie, 'settings/describe', {}, { timeoutMs: 30_000 })
  const ns = (describe.value?.namespaces ?? []).find(row => row.ns === 'llm-pi-ai')
  const providers = { ...(ns?.value?.providers ?? {}) }
  delete providers[PROVIDER_ID]
  await call(cookie, 'settings/replace', { request: { ns: 'llm-pi-ai', value: { providers } } }, { timeoutMs: 30_000 })
    .catch(() => undefined)
}

export async function createSession(cookie, { cwd }) {
  const created = await call(cookie, 'session/create', { request: { cwd } }, { timeoutMs: 30_000 })
  if (created.ok !== true) throw new Error(`session/create 失败: ${JSON.stringify(created.error)}`)
  return created.value.sessionId
}

let requestSeq = 0

/** 只提交 prompt（不等待）：多回合排队/登出竞态用。 */
export async function admitPrompt(cookie, sessionId, text, { mode = 'queue' } = {}) {
  requestSeq += 1
  const requestId = `llm-${Date.now().toString(36)}-${requestSeq}`
  return call(cookie, 'session/prompt', {
    request: {
      requestId,
      sessionId,
      mode,
      clientTimeZone: 'Asia/Shanghai',
      content: [{ type: 'text', text }],
    },
  }, { timeoutMs: 30_000 })
}

export async function stateOf(cookie, sessionId) {
  const state = await call(cookie, 'session/state', { sessionId }, { timeoutMs: 20_000 })
  return state.value ?? {}
}

export async function promptTurn(cookie, sessionId, text, { timeoutMs = 180_000 } = {}) {
  // 先记游标：新回合会推进 cursor；只凭 running=false 判定会在回合启动前误判完成。
  const before = await stateOf(cookie, sessionId)
  const prompt = await admitPrompt(cookie, sessionId, text)
  if (prompt.ok !== true) throw new Error(`session/prompt 失败: ${JSON.stringify(prompt.error)}`)
  return waitIdle(cookie, sessionId, { timeoutMs, sinceCursor: before.cursor ?? 0 })
}

/** 等回合结束：cursor 已推进 + running=false + 队列空。 */
export async function waitIdle(cookie, sessionId, { timeoutMs = 180_000, sinceCursor = 0 } = {}) {
  const t0 = Date.now()
  let records = []
  for (;;) {
    const wait = await call(cookie, 'session/wait', {
      request: { sessionId, cursor: 0, timeoutMs: 15_000 },
    }, { timeoutMs: 40_000 })
    if (wait.ok === true) records = wait.value?.output?.records ?? []
    const value = await stateOf(cookie, sessionId)
    const advanced = typeof value.cursor === 'number' && value.cursor > sinceCursor
    if (advanced && value.running === false && (value.queue ?? []).length === 0 && (value.pendingInput ?? []).length === 0) {
      return { records, state: value }
    }
    if (Date.now() - t0 > timeoutMs) throw new Error(`回合超时（${timeoutMs}ms）：state=${JSON.stringify(value)}`)
    await sleep(1_000)
  }
}

/** assistant/message 里的 tool-call 列表（chat 引擎的真实派发对象）。 */
export function toolCallsOf(records) {
  const calls = []
  for (const record of records) {
    const event = record.event ?? record
    if (event.type !== 'assistant/message') continue
    for (const block of event.data?.message?.content ?? []) {
      if (block?.type === 'tool-call') calls.push({ name: block.name, arguments: block.arguments })
    }
  }
  return calls
}

export function textOfRecords(records) {
  const parts = []
  for (const record of records) {
    const event = record.event ?? record
    if (event.type !== 'assistant/message') continue
    for (const block of event.data?.message?.content ?? []) {
      if (block?.type === 'text') parts.push(block.text)
    }
  }
  return parts.join('\n')
}

export function userIdOf(account) {
  return readDb('SELECT id FROM users WHERE account = ?', [account])[0]?.id
}

export { LANE, call, readDb, sessions, sleep, redact }