/**
 * T3.1 AI 链路封装单测(测试计划 §5 T3.1(b),四组判据):
 * 1. 同构假体注入——configEditor 桩(路由行)+ 按 wire 协议应答的假 fetch:润色返回
 *    建议稿、审核返回问题清单(结构断言;system 消息=注册表元提示词当前值,吃狗粮);
 * 2. 无 key / llm 服务缺席优雅降级——unavailable 分态(非 5xx、不炸宿主),文案锚点
 *    「AI 能力不可用」;key 在场性只判 env/.env 存在性,绝无值出口;
 * 3. 元提示词自管——meta 层条目在注册表/对账清单中(registry.test 互锁)、真文件
 *    可读回、可版本化(链种子);润色目标为元提示词自身时单层收敛(递归保护预演);
 * 4. 超时/异常 → 降级响应 + 审计记录,不留半写状态(版本数/patch 字节/在途审批三不变)。
 *
 * 同构纪律:假 fetch 按三协议真实请求/响应形态应答(URL/头/请求体断言),wire 路径
 * 与 llm-doctor pingModel 同源口径;真实 cordis 根 Context + configEditor provide 桩
 * (config-editor-write.test.ts 同款)。
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { LoopPromptGateway } from '../src/index.ts'
import { byteLength } from '../src/checksum.ts'
import {
  AI_META_POLISH_ENTRY_ID, AI_META_REVIEW_ENTRY_ID, aiChatCompletion, checkAiAvailability,
  createKeyPresenceResolver, findCarrierInPatch, readDefaultModelFromPatch, resolveAiRoute,
  resolveDefaultModelRoute,
} from '../src/ai-service.ts'
import type { AiFetchLike } from '../src/ai-service.ts'
import type { ConfigEditorFace, ConfigEditorRow } from '../src/config-editor-write.ts'
import { getPromptRegistryEntry, readEntryText } from '../src/registry.ts'
import type { RegistryFileReader } from '../src/registry.ts'
import { validateEntryText } from '../src/validator.ts'
import { diffLines, diffSummaryText, lineDiffOps } from '../src/diff.ts'
import type { AiPolishResult, AiProposalResult, AiReviewResult, AiStatusResult, StudioContextLike, VersionsResult } from '../src/types.ts'

/** 仓库根(packages/prompt-studio/tests → 上三级):注册表真文件读取面。 */
const REPO_ROOT = join(import.meta.dirname, '..', '..', '..')
const readRepoFile: RegistryFileReader = file => readFileSync(join(REPO_ROOT, file), 'utf8')

/** 基线 persona(含三条红线锚点,与 host-plugin.test 同款)。 */
const PERSONA_V1 = 'You are the Eterna enterprise assistant. T3-AI 红线:预算超支>5%必须触发审批;对外付款不得代付;比选必须中立。'
/** 无红线内容(审核 ruleFindings 的确定性样例)。 */
const CONTENT_NO_RED_LINES = 'You are an assistant without safety anchors.'

/** fixture profile patch(preset-standard 行 persona 裸标量;默认条目读值面)。 */
function fixturePatch(persona: string): string {
  return [
    '# fixture profile patch(T3.1 AI 链路)',
    '- id: preset-standard',
    "  name: '@deepseek-ai/dsh-agent-preset'",
    '  config:',
    '    plugins:',
    '      - id: persona',
    "        name: '@deepseek-ai/dsh-persona'",
    '        config:',
    `          prefix: '${persona}'`,
    '',
  ].join('\n')
}

/** configEditor 桩(只读面:configuration() 行清单;AI 链路不 edit)。 */
function fakeEditor(rows: { id: string; override: Record<string, unknown> }[]): ConfigEditorFace {
  const entries = rows.map(row => ({ options: { id: row.id } }))
  return {
    entries: () => entries,
    configuration: () => rows.map((row, index) => ({ entry: entries[index], inherited: {}, override: row.override })),
    edit: async () => { throw new Error('AI 链路测试桩不接受 edit(AI 端点零写动作)') },
  }
}

/** 生产的默认模型路由行(pi-ai 形态;agent-default-model → litellm/deepseek-flash)。 */
function piAiRows(): { id: string; override: Record<string, unknown> }[] {
  return [
    {
      id: 'llm-pi-ai',
      override: {
        providers: {
          litellm: {
            displayName: '企业模型网关(LiteLLM)',
            apiKeyEnv: 'LITELLM_API_KEY',
            api: 'openai-completions',
            baseURL: 'http://127.0.0.1:4000/v1',
            models: [{ id: 'deepseek-flash', name: 'DeepSeek Flash' }],
          },
        },
      },
    },
    { id: 'agent-default-model', override: { provider: 'litellm', model: 'deepseek-flash' } },
  ]
}

const rowsOf = (editor: ConfigEditorFace): ConfigEditorRow[] => {
  const raw = editor.configuration() as ConfigEditorRow[]
  return Array.isArray(raw) ? raw : []
}

/** 记录型假 fetch(同构:按调用应答,记录 url/init 供 wire 断言)。 */
interface WireCall { readonly url: string; readonly init: RequestInit | undefined }
type RecordingFetch = AiFetchLike & { readonly calls: readonly WireCall[] }
function recordingFetch(respond: (call: WireCall) => Response | Promise<Response>): RecordingFetch {
  const calls: WireCall[] = []
  return Object.assign(
    (url: string, init?: RequestInit): Promise<Response> => {
      const call = { url, init }
      calls.push(call)
      return Promise.resolve(respond(call))
    },
    { calls },
  )
}

const jsonResponse = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

/** 内存 KvUnit(host-plugin.test 同款最小面;versions + snapshots 双表)。 */
class MemoryUnit {
  readonly tables = new Map<string, Map<string, unknown>>([
    ['versions', new Map()], ['snapshots', new Map()],
  ])
  async loadAll() {
    const tables: Record<string, Record<string, unknown>> = {}
    for (const [name, records] of this.tables) tables[name] = Object.fromEntries(records)
    return { tables, global: null }
  }
  async putRecord(table: string, key: string, value: unknown): Promise<void> {
    this.tables.get(table)?.set(key, value)
  }
  async close(): Promise<void> {}
}

function asStudio(ctx: Context): StudioContextLike {
  return ctx as unknown as StudioContextLike
}

/** 审计明细(等 flush 后解析 NDJSON;返回 detail 数组)。 */
async function auditDetails(auditPath: string): Promise<Array<Record<string, unknown>>> {
  const text = readFileSync(auditPath, 'utf8')
  return text.split('\n')
    .filter(line => line.trim().length > 0)
    .map(line => (JSON.parse(line) as { detail?: Record<string, unknown> }).detail ?? {})
}

describe('路由解析与可用性自检(纯函数)', () => {
  it('pi-ai 形态:agent-default-model → providers 子表命中,route 携带 api/baseURL/apiKeyEnv', () => {
    const resolved = resolveAiRoute(rowsOf(fakeEditor(piAiRows())))
    expect('route' in resolved && resolved.route).toMatchObject({
      rowId: 'llm-pi-ai', provider: 'litellm', model: 'deepseek-flash',
      api: 'openai-completions', baseURL: 'http://127.0.0.1:4000/v1', apiKeyEnv: 'LITELLM_API_KEY',
    })
  })

  it('OpenAI 兼容适配器形态(@eterna/llm-openai 平铺 config):wire 固定 openai-completions', () => {
    const rows = [
      { id: 'eterna-llm', override: { provider: 'eterna', baseURL: 'http://127.0.0.1:4000/v1', apiKeyEnv: 'LITELLM_API_KEY', models: [{ id: 'deepseek-flash' }] } },
      { id: 'agent-default-model', override: { provider: 'eterna', model: 'deepseek-flash' } },
    ]
    const resolved = resolveAiRoute(rowsOf(fakeEditor(rows)))
    expect('route' in resolved && resolved.route).toMatchObject({
      rowId: 'eterna-llm', api: 'openai-completions', baseURL: 'http://127.0.0.1:4000/v1',
    })
  })

  it('降级明示:默认行缺席 / 模型不在目录 / provider 无承载行', () => {
    const noDefault = resolveAiRoute(rowsOf(fakeEditor([{ id: 'llm-pi-ai', override: piAiRows()[0]!.override }])))
    expect('reason' in noDefault && noDefault.reason).toContain('agent-default-model')
    const offCatalog = resolveAiRoute(rowsOf(fakeEditor(piAiRows().map(row =>
      row.id === 'agent-default-model' ? { ...row, override: { provider: 'litellm', model: 'not-in-catalog' } } : row))))
    expect('reason' in offCatalog && offCatalog.reason).toContain('不在 llm-pi-ai 行 litellm 路由目录内')
    const noCarrier = resolveAiRoute(rowsOf(fakeEditor([{ id: 'agent-default-model', override: { provider: 'ghost', model: 'm1' } }])))
    expect('reason' in noCarrier && noCarrier.reason).toContain('路由不可解析')
  })

  it('checkAiAvailability:双面缺席 / key 缺席(keyPresence=undefined)→ unavailable + env 名明示;无凭据路由= keyless 可用', () => {
    const noEditor = checkAiAvailability(undefined, undefined, () => 'env')
    expect(noEditor.available).toBe(false)
    expect(noEditor.reason).toContain('configEditor 服务缺席且 live patch 不可读')
    const noKey = checkAiAvailability(fakeEditor(piAiRows()), undefined, () => undefined)
    expect(noKey.available).toBe(false)
    expect(noKey.reason).toContain('LITELLM_API_KEY')
    expect(noKey.reason).toContain('在场性')
    const keylessRows = piAiRows().map(row => row.id === 'llm-pi-ai'
      ? { ...row, override: { providers: { litellm: { api: 'openai-completions', baseURL: 'http://127.0.0.1:4000/v1', apiKeyEnv: '' } } } }
      : row)
    const keyless = checkAiAvailability(fakeEditor(keylessRows), undefined, () => undefined)
    expect(keyless.available).toBe(true)
    expect(keyless.keySource).toBe('keyless')
  })

  /** t7 隔离档 patch 形态(eterna-llm 在 insert 块内 + agent-default-model 根级行)。 */
  const T7_SHAPE_PATCH = [
    '# fixture(t7 形态)',
    '- insert:',
    '    - id: eterna-llm',
    "      name: '@eterna/llm-openai'",
    '      config:',
    "        baseURL: 'http://127.0.0.1:4000/v1'",
    '        apiKeyEnv: LITELLM_API_KEY',
    "        provider: 'eterna'",
    '        models:',
    '          - id: deepseek-flash',
    '',
    '- id: agent-default-model',
    '  config:',
    "    provider: 'eterna'",
    "    model: 'deepseek-flash'",
    '',
  ].join('\n')

  it('patch 兜底面:insert 块承载行 + 根级 agent-default-model 结构解析(configEditor 行清单不可见的形态)', () => {
    expect(readDefaultModelFromPatch(T7_SHAPE_PATCH)).toEqual({ provider: 'eterna', model: 'deepseek-flash' })
    expect(findCarrierInPatch(T7_SHAPE_PATCH, 'eterna', 'deepseek-flash')).toMatchObject({
      rowId: 'eterna-llm', api: 'openai-completions',
      baseURL: 'http://127.0.0.1:4000/v1', apiKeyEnv: 'LITELLM_API_KEY',
    })
    // 目录不匹配:catalog 有模型清单且不含目标 → 本承载行跳过(无可用承载 → undefined)。
    expect(findCarrierInPatch(T7_SHAPE_PATCH, 'eterna', 'not-in-catalog')).toBeUndefined()
    // 完全无 configEditor 面:双面解析仍成立(行清单空 + patch 兜底)。
    const resolved = resolveDefaultModelRoute({ rows: [], patchText: T7_SHAPE_PATCH })
    expect('route' in resolved && resolved.route).toMatchObject({ rowId: 'eterna-llm', provider: 'eterna', model: 'deepseek-flash' })
    const noDefault = resolveDefaultModelRoute({ rows: [], patchText: '# 无行\n' })
    expect('reason' in noDefault && noDefault.reason).toContain('agent-default-model')
    // 可用性:configEditor 缺席 + patch 在场 → 兜底面解析成功(key 缺席仍如实降级)。
    const available = checkAiAvailability(undefined, T7_SHAPE_PATCH, () => 'env')
    expect(available.available).toBe(true)
    expect(available.route?.rowId).toBe('eterna-llm')
    expect(available.keySource).toBe('env')
  })

  it('createKeyPresenceResolver:process.env 优先=env;.env 文件非空值行=dotenv;缺席/空值=undefined——返回值只有来源枚举,无密钥值出口', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'eterna-ai-keypresence-'))
    try {
      writeFileSync(join(dir, '.env'), 'DOTENV_AI_KEY_TEST=secret-value-never-logged\nEMPTY_AI_KEY_TEST=\n', 'utf8')
      const resolve = createKeyPresenceResolver(() => [dir])
      // .env 在场(未导出)→ dotenv;空值行不算在场。
      expect(resolve('DOTENV_AI_KEY_TEST')).toBe('dotenv')
      expect(resolve('EMPTY_AI_KEY_TEST')).toBeUndefined()
      expect(resolve('NOT_SET_ANYWHERE')).toBeUndefined()
      // process.env 优先。
      process.env['DOTENV_AI_KEY_TEST'] = 'env-override'
      try {
        expect(resolve('DOTENV_AI_KEY_TEST')).toBe('env')
      } finally {
        delete process.env['DOTENV_AI_KEY_TEST']
      }
      // .env 缺席的根目录:静默 undefined。
      expect(createKeyPresenceResolver(() => [join(dir, 'no-such-root')])('DOTENV_AI_KEY_TEST')).toBeUndefined()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('aiChatCompletion(同构 wire,三协议请求/响应形态)', () => {
  const base = { baseURL: 'http://gw.test/v1', model: 'deepseek-flash' }

  it('openai-completions:POST {base}/chat/completions,Bearer 头,system/user 双消息;choices 反引', async () => {
    const fetchImpl = recordingFetch(() => jsonResponse(200, { choices: [{ message: { content: '输出文本' } }] }))
    const result = await aiChatCompletion({ ...base, api: 'openai-completions', apiKey: 'k-test', system: 'SYS', user: 'USR', fetchImpl })
    expect(result.ok).toBe(true)
    expect(result.text).toBe('输出文本')
    const call = fetchImpl.calls[0]
    expect(call?.url).toBe('http://gw.test/v1/chat/completions')
    expect((call?.init?.headers as Record<string, string>)['authorization']).toBe('Bearer k-test')
    const body = JSON.parse(call?.init?.body as string) as { messages: { role: string; content: string }[] }
    expect(body.messages).toEqual([{ role: 'system', content: 'SYS' }, { role: 'user', content: 'USR' }])
  })

  it('openai-responses:POST {base}/responses,instructions/input;output_text 反引', async () => {
    const fetchImpl = recordingFetch(() => jsonResponse(200, { output_text: '响应文本' }))
    const result = await aiChatCompletion({ ...base, api: 'openai-responses', system: 'SYS', user: 'USR', fetchImpl })
    expect(result.ok).toBe(true)
    expect(result.text).toBe('响应文本')
    const call = fetchImpl.calls[0]
    expect(call?.url).toBe('http://gw.test/v1/responses')
    const body = JSON.parse(call?.init?.body as string) as { instructions: string; input: string }
    expect(body.instructions).toBe('SYS')
    expect(body.input).toBe('USR')
  })

  it('anthropic-messages:POST {base}/v1/messages,anthropic-version 头,system+messages;文本块拼接', async () => {
    const fetchImpl = recordingFetch(() => jsonResponse(200, { content: [{ type: 'text', text: '第一段' }, { type: 'text', text: '第二段' }] }))
    const result = await aiChatCompletion({ ...base, api: 'anthropic-messages', system: 'SYS', user: 'USR', fetchImpl })
    expect(result.ok).toBe(true)
    expect(result.text).toBe('第一段\n第二段')
    const call = fetchImpl.calls[0]
    // wire = cleanBase(baseURL) + 协议后缀 /v1/messages 字面拼接(llm-doctor 同口径:
    // anthropic-messages 的 baseURL 惯例不带 /v1;本例带 /v1 仅演示字面拼接行为)。
    expect(call?.url).toBe('http://gw.test/v1/v1/messages')
    expect((call?.init?.headers as Record<string, string>)['anthropic-version']).toBe('2023-06-01')
  })

  it('失败面:HTTP 500 → error 携状态与响应摘录;abort → 超时;未知协议 → 明示', async () => {
    const httpError = await aiChatCompletion({
      ...base, api: 'openai-completions', system: 'S', user: 'U',
      fetchImpl: recordingFetch(() => jsonResponse(500, { detail: 'boom' })),
    })
    expect(httpError.ok).toBe(false)
    expect(httpError.error).toContain('HTTP 500')
    expect(httpError.error).toContain('boom')
    // 挂起 fetch(监听 abort,同构真实 fetch 行为)→ 超时归类。
    const hang: AiFetchLike = (_url, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => { reject(new Error('This operation was aborted')) })
    })
    const timedOut = await aiChatCompletion({ ...base, api: 'openai-completions', system: 'S', user: 'U', fetchImpl: hang, timeoutMs: 5 })
    expect(timedOut.ok).toBe(false)
    expect(timedOut.error).toContain('超时')
    const badApi = await aiChatCompletion({ ...base, api: 'unknown-api', system: 'S', user: 'U', fetchImpl: recordingFetch(() => jsonResponse(200, {})) })
    expect(badApi.ok).toBe(false)
    expect(badApi.error).toContain('不支持的协议')
  })
})

describe('AI 端点全链(真实 cordis 根 Context + configEditor 桩 + 同构假 fetch)', () => {
  let dir: string
  let patchPath: string
  let auditPath: string
  let ctx: Context

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'eterna-prompt-studio-ai-'))
    patchPath = join(dir, 'cordis.patch.yml')
    auditPath = join(dir, 'audit.jsonl')
    writeFileSync(patchPath, fixturePatch(PERSONA_V1), 'utf8')
    ctx = new Context()
    ctx.provide('configEditor', fakeEditor(piAiRows()))
  })

  afterEach(async () => {
    await (ctx as unknown as { dispose?: () => void }).dispose?.()
    rmSync(dir, { recursive: true, force: true })
  })

  /** 装配网关:同构假体注入(fetch/key 在场/key 值;默认 happy-path 配置)。 */
  async function makeGateway(overrides: {
    fetchImpl?: AiFetchLike
    keyPresence?: () => 'env' | 'dotenv' | undefined
    resolveApiKey?: (envName: string) => string | undefined
    withEditor?: boolean
    /** 独立 cordis 根(同一根上二次 new LoopPromptGateway 会撞服务注册)。 */
    freshContext?: boolean
    /** 注册表文件解析根覆写(T3.2④:元提示词整文件写入须落临时仓库,绝不动真仓文件)。 */
    repoRoot?: string
  } = {}): Promise<LoopPromptGateway> {
    const host = overrides.freshContext === true ? new Context() : ctx
    if (overrides.freshContext === true && overrides.withEditor !== false) {
      host.provide('configEditor', fakeEditor(piAiRows()))
    }
    const gateway = new LoopPromptGateway(asStudio(overrides.withEditor === false ? new Context() : host), {
      patchPath, sessionsRoot: join(dir, 'sessions'), auditFilePath: auditPath, dryRunVerify: false,
      ...(overrides.repoRoot !== undefined && { repoRoot: overrides.repoRoot }),
    })
    gateway.aiFetch = overrides.fetchImpl ?? jsonResponseFetchWith()
    gateway.aiKeyPresence = overrides.keyPresence ?? (() => 'env')
    gateway.aiResolveApiKey = overrides.resolveApiKey ?? (() => 'test-key')
    const unit = new MemoryUnit()
    const backend = { kv: { open: async () => unit as unknown as import('@deepseek-ai/dsh-storage').KvUnit }, close: async () => undefined }
    await gateway.attachBackend(backend)
    return gateway
  }

  /** openai-completions 应答假体(默认:围栏建议稿)。 */
  function jsonResponseFetchWith(content = '```prompt\n润色后的建议稿全文。\n```'): RecordingFetch {
    return recordingFetch(() => jsonResponse(200, { choices: [{ message: { content } }] }))
  }

  it('① 润色:假 ctx.llm 注入返回建议稿——结构断言(status/draft/meta)+ 吃狗粮(system=注册表元提示词当前值)+ wire 断言', async () => {
    const fetchImpl = jsonResponseFetchWith()
    const gateway = await makeGateway({ fetchImpl })
    const result: AiPolishResult = await gateway.aiPolish({ entryId: 'preset.standard.persona', content: PERSONA_V1, instruction: '更紧凑' })
    expect(result.status).toBe('ok')
    expect(result.draft).toBe('润色后的建议稿全文。')
    expect(result.baseBytes).toBeGreaterThan(0)
    expect(result.draftBytes).toBe(byteLength(result.draft ?? ''))
    expect(result.meta).toMatchObject({
      provider: 'litellm', model: 'deepseek-flash', metaPromptEntryId: AI_META_POLISH_ENTRY_ID, framed: true,
    })
    expect(result.note).toContain('不直接生效')
    // wire:URL/Bearer/请求体(system+user);system = 元提示词注册表条目当前值(真文件)。
    expect(fetchImpl.calls).toHaveLength(1)
    const call = fetchImpl.calls[0]
    expect(call?.url).toBe('http://127.0.0.1:4000/v1/chat/completions')
    expect((call?.init?.headers as Record<string, string>)['authorization']).toBe('Bearer test-key')
    const body = JSON.parse(call?.init?.body as string) as { messages: { role: string; content: string }[] }
    const metaEntry = getPromptRegistryEntry(AI_META_POLISH_ENTRY_ID)
    expect(metaEntry).toBeDefined()
    expect(body.messages[0]?.content).toBe(readEntryText(metaEntry as never, readRepoFile).text)
    expect(body.messages[0]?.content).toContain('```prompt')
    // user 消息:条目元数据 + 润色侧重点 + 受理文本围栏。
    const user = body.messages[1]?.content ?? ''
    expect(user).toContain('条目 id: preset.standard.persona')
    expect(user).toContain('红线策略: required(eterna.red-lines.standard)')
    expect(user).toContain('润色要求: 更紧凑')
    expect(user).toContain('<<<PROMPT')
    expect(user).toContain(PERSONA_V1)
    await gateway.dispose()
  })

  it('① 审核:假 ctx.llm 返回问题清单——aiFindings 结构断言 + ruleFindings 与校验器同源(同一模块导出)', async () => {
    const fetchImpl = jsonResponseFetchWith([
      '前置说明(契约容错:块外文字应被忽略)',
      '```json',
      JSON.stringify([
        { severity: 'error', rule: 'red-line-anchor', message: '缺红线锚点句', suggestion: '补回预算审批句' },
        { severity: 'warning', rule: 'clarity', message: '指令含糊' },
        { severity: 'bogus', message: '未知评级归一为 info' },
        { rule: 'no-message' },
      ]),
      '```',
    ].join('\n'))
    const gateway = await makeGateway({ fetchImpl })
    const result: AiReviewResult = await gateway.aiReview({ entryId: 'preset.standard.persona', content: CONTENT_NO_RED_LINES })
    expect(result.status).toBe('ok')
    // ruleFindings 同源:与直接调用 validateEntryText(同一模块)逐字一致(T3.3 同源断言的落点)。
    const entry = getPromptRegistryEntry('preset.standard.persona')
    expect(result.ruleFindings).toEqual(validateEntryText(entry as never, CONTENT_NO_RED_LINES).issues)
    expect(result.ruleFindings.join(';')).toContain('红线')
    // aiFindings:防御式归一(未知 severity→info;缺 message 项丢弃)。
    expect(result.aiFindings).toHaveLength(3)
    expect(result.aiFindings[0]).toMatchObject({ severity: 'error', rule: 'red-line-anchor' })
    expect(result.aiFindings[1]).toMatchObject({ severity: 'warning' })
    expect(result.aiFindings[2]?.severity).toBe('info')
    expect(result.meta?.metaPromptEntryId).toBe(AI_META_REVIEW_ENTRY_ID)
    expect(result.meta?.framed).toBe(true)
    await gateway.dispose()
  })

  it('① 永不直接生效:润色/审核调用后版本数、patch 字节、在途审批三不变(零写动作)', async () => {
    const gateway = await makeGateway()
    const patchBefore = readFileSync(patchPath, 'utf8')
    const versionsBefore = await gateway.promptVersions({})
    await gateway.aiPolish({ entryId: 'preset.standard.persona', content: PERSONA_V1 })
    await gateway.aiReview({ entryId: 'preset.standard.persona', content: PERSONA_V1 })
    expect((await gateway.promptVersions({})).total).toBe(versionsBefore.total)
    expect(readFileSync(patchPath, 'utf8')).toBe(patchBefore)
    expect(gateway.gate.peek()).toBeNull()
    await gateway.dispose()
  })

  it('② 无 key 降级:keyPresence=undefined → ai-status/润色/审核 unavailable(非 5xx)+ 文案锚点「AI 能力不可用」+ 审计', async () => {
    const gateway = await makeGateway({ keyPresence: () => undefined })
    const status: AiStatusResult = await gateway.aiStatus()
    expect(status.status).toBe('unavailable')
    expect(status.available).toBe(false)
    expect(status.reason).toContain('LITELLM_API_KEY')
    expect(status.note).toContain('AI 能力不可用')
    const polish = await gateway.aiPolish({ entryId: 'preset.standard.persona', content: PERSONA_V1 })
    expect(polish.status).toBe('unavailable')
    expect(polish.issues?.[0]).toContain('LITELLM_API_KEY')
    expect(polish.note).toContain('AI 能力不可用')
    const review = await gateway.aiReview({ entryId: 'preset.standard.persona', content: PERSONA_V1 })
    expect(review.status).toBe('unavailable')
    expect(review.ruleFindings).toEqual(validateEntryText(getPromptRegistryEntry('preset.standard.persona') as never, PERSONA_V1).issues)
    await gateway.audit.flush()
    const details = await auditDetails(auditPath)
    expect(details.map(record => record.action)).toContain('ai-polish.unavailable')
    expect(JSON.stringify(details)).not.toContain('test-key')
    await gateway.dispose()
  })

  it('② llm 服务与路由缺席降级:configEditor 未提供且 patch 无 LLM 行 → unavailable 明示默认模型不可得,不炸宿主', async () => {
    const gateway = await makeGateway({ withEditor: false })
    const status = await gateway.aiStatus()
    expect(status.status).toBe('unavailable')
    expect(status.reason).toContain('agent-default-model')
    const polish = await gateway.aiPolish({ content: PERSONA_V1 })
    expect(polish.status).toBe('unavailable')
    expect(polish.issues?.[0]).toContain('agent-default-model')
    await gateway.dispose()
  })

  it('② patch 兜底面全链(t7 隔离档形态):configEditor 未提供 + insert 块承载行 → 路由经 live patch 解析,润色走通', async () => {
    // fixture patch 换成 t7 形态(eterna-llm 在 insert 块内 + agent-default-model 根级行)。
    writeFileSync(patchPath, [
      '# fixture(t7 形态:LLM 行在 insert 块内,configEditor 行清单不可见)',
      '- insert:',
      '    - id: eterna-llm',
      "      name: '@eterna/llm-openai'",
      '      config:',
      "        baseURL: 'http://127.0.0.1:4000/v1'",
      '        apiKeyEnv: LITELLM_API_KEY',
      "        provider: 'eterna'",
      '        models:',
      '          - id: deepseek-flash',
      '',
      '- id: preset-standard',
      "  name: '@deepseek-ai/dsh-agent-preset'",
      '  config:',
      '    plugins:',
      '      - id: persona',
      "        name: '@deepseek-ai/dsh-persona'",
      '        config:',
      `          prefix: '${PERSONA_V1}'`,
      '- id: agent-default-model',
      '  config:',
      "    provider: 'eterna'",
      "    model: 'deepseek-flash'",
      '',
    ].join('\n'), 'utf8')
    const fetchImpl = jsonResponseFetchWith()
    const gateway = await makeGateway({ withEditor: false, fetchImpl })
    const status = await gateway.aiStatus()
    expect(status.status).toBe('ok')
    expect(status.route).toEqual({ provider: 'eterna', model: 'deepseek-flash', api: 'openai-completions' })
    const polish = await gateway.aiPolish({ content: PERSONA_V1 })
    expect(polish.status).toBe('ok')
    // wire 走 patch 解析出的 baseURL(与 agent 会话同落点)。
    expect(fetchImpl.calls[0]?.url).toBe('http://127.0.0.1:4000/v1/chat/completions')
    await gateway.dispose()
  })

  it('② dotenv 在场但未导出:降级明示「.env 在场但未导出…export 后重试」(不猜值)', async () => {
    const gateway = await makeGateway({ keyPresence: () => 'dotenv', resolveApiKey: () => undefined })
    const polish = await gateway.aiPolish({ content: PERSONA_V1 })
    expect(polish.status).toBe('unavailable')
    expect(polish.issues?.[0]).toContain('.env')
    expect(polish.issues?.[0]).toContain('export')
    await gateway.dispose()
  })

  it('④ 超时(aiTimeoutMs=1 + 挂起 fetch)→ failed + 审计 ai-polish.failed + 零半写(版本数/patch 不变)', async () => {
    const hang: AiFetchLike = (_url, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => { reject(new Error('This operation was aborted')) })
    })
    const gateway = await makeGateway({ fetchImpl: hang })
    gateway.aiTimeoutMs = 1
    const patchBefore = readFileSync(patchPath, 'utf8')
    const totalBefore = (await gateway.promptVersions({})).total
    const polish = await gateway.aiPolish({ content: PERSONA_V1 })
    expect(polish.status).toBe('failed')
    expect(polish.issues?.[0]).toContain('超时')
    await gateway.audit.flush()
    const failed = (await auditDetails(auditPath)).find(record => record.action === 'ai-polish.failed')
    expect(failed?.reason).toContain('超时')
    expect((await gateway.promptVersions({})).total).toBe(totalBefore)
    expect(readFileSync(patchPath, 'utf8')).toBe(patchBefore)
    await gateway.dispose()
  })

  it('④ 异常(HTTP 500)→ failed + 审计;审核 JSON 契约失败 → aiFindings=[] + issues 明示 + 审计 degraded', async () => {
    const gateway = await makeGateway({ fetchImpl: recordingFetch(() => jsonResponse(500, { detail: 'gateway exploded' })) })
    const polish = await gateway.aiPolish({ content: PERSONA_V1 })
    expect(polish.status).toBe('failed')
    expect(polish.issues?.[0]).toContain('HTTP 500')
    // 审核:模型输出非 JSON 契约 → ruleFindings 仍在,aiFindings 空数组 + 明示 issues。
    const gateway2 = await makeGateway({ fetchImpl: jsonResponseFetchWith('我不会按契约输出'), freshContext: true })
    const review = await gateway2.aiReview({ content: PERSONA_V1 })
    expect(review.status).toBe('ok')
    expect(review.aiFindings).toEqual([])
    expect(review.issues?.[0]).toContain('未按元提示词 JSON 契约')
    await gateway2.audit.flush()
    const actions = (await auditDetails(auditPath)).map(record => record.action)
    expect(actions).toContain('ai-review.degraded')
    await gateway.dispose()
    await gateway2.dispose()
  })

  it('端点分态:未知条目 not-found;只读型无底稿 rejected 明示(input.content 可显式传入)', async () => {
    const gateway = await makeGateway()
    const notFound = await gateway.aiPolish({ entryId: 'no.such.entry' })
    expect(notFound.status).toBe('not-found')
    expect(notFound.issues?.[0]).toContain('未知条目 id:no.such.entry')
    const readonly = await gateway.aiPolish({ entryId: 'preset.standard.time-context' })
    expect(readonly.status).toBe('rejected')
    expect(readonly.issues?.[0]).toContain('无可润色底稿')
    // 显式传 content:只读型条目也可对草稿做润色/审核(底稿面与写回落点解耦)。
    const withContent = await gateway.aiPolish({ entryId: 'preset.standard.time-context', content: '当前时间上下文草稿' })
    expect(withContent.status).toBe('ok')
    await gateway.dispose()
  })

  it('③ 元提示词自管:meta 层条目真文件可读回、含输出契约;版本链可种子(可版本化);快照全景含 meta 条目', async () => {
    const gateway = await makeGateway()
    for (const id of [AI_META_POLISH_ENTRY_ID, AI_META_REVIEW_ENTRY_ID]) {
      const entry = getPromptRegistryEntry(id)
      expect(entry, `注册表缺元提示词条目:${id}`).toBeDefined()
      expect(entry?.layer).toBe('meta')
      expect(entry?.kind).toBe('patch-value')
      expect(entry?.effect.radius).toBe('not-composed-anywhere')
      const read = readEntryText(entry as never, readRepoFile)
      expect(read.text, id).toBeDefined()
      expect(read.text?.length, id).toBeGreaterThan(0)
      // 可版本化:attach 后链首已按当前值种子(与其余 patch 值型条目同机制)。
      const chain = await gateway.promptVersions({ entryId: id, limit: 1 }) as VersionsResult
      expect(chain.total, id).toBeGreaterThanOrEqual(1)
    }
    expect(readRepoFile('packages/prompt-studio/ai/polish.md')).toContain('```prompt')
    expect(readRepoFile('packages/prompt-studio/ai/review.md')).toContain('```json')
    // 快照全景含 meta 条目(ledger 互锁之外的运行时在场证明)。
    const snapshot = await gateway.snapshot()
    const ids = snapshot.entries.map(item => item.id)
    expect(ids).toContain(AI_META_POLISH_ENTRY_ID)
    expect(ids).toContain(AI_META_REVIEW_ENTRY_ID)
    await gateway.dispose()
  })

  it('③ 递归保护预演:润色目标为元提示词自身 → 单层调用收敛(恰一次 fetch,无自嵌套)', async () => {
    const fetchImpl = jsonResponseFetchWith('```prompt\n更稳的元提示词。\n```')
    const gateway = await makeGateway({ fetchImpl })
    const result = await gateway.aiPolish({ entryId: AI_META_POLISH_ENTRY_ID })
    expect(result.status).toBe('ok')
    expect(fetchImpl.calls).toHaveLength(1)
    const body = JSON.parse(fetchImpl.calls[0]?.init?.body as string) as { messages: { role: string; content: string }[] }
    // system=润色元提示词自身当前值;user=元提示词条目元数据+全文(mocked 单层即断言,T3.2④ 口径)。
    expect(body.messages[0]?.content).toBe(readEntryText(getPromptRegistryEntry(AI_META_POLISH_ENTRY_ID) as never, readRepoFile).text)
    expect(body.messages[1]?.content).toContain(`条目 id: ${AI_META_POLISH_ENTRY_ID}`)
    await gateway.dispose()
  })

  it('① ai-status happy path:available + 路由三元组 + keySource=env(零模型调用)', async () => {
    const fetchImpl = jsonResponseFetchWith()
    const gateway = await makeGateway({ fetchImpl })
    const status = await gateway.aiStatus()
    expect(status.status).toBe('ok')
    expect(status.available).toBe(true)
    expect(status.route).toEqual({ provider: 'litellm', model: 'deepseek-flash', api: 'openai-completions' })
    expect(status.keySource).toBe('env')
    expect(fetchImpl.calls).toHaveLength(0) // 可用性自检零模型调用
    await gateway.dispose()
  })

  // ── T3.2 润色流(建议稿 → diff 预览 → 「作为提案提交」;测试计划 §5 T3.2(b)①-④) ──

  /** T3.2 建议稿样例(含 persona 三条红线锚点——AI 产出不豁免按条目校验器)。 */
  const AI_DRAFT_V2 = 'AI 建议稿(T3.2):更紧凑的 persona 重述。红线:预算超支>5%必须触发审批;对外付款不得代付;比选必须中立。'

  it('T3.2 ① AI 稿永不直接生效:润色产出建议稿后,版本数/patch 字节/在途审批三不变(建议稿仅存在于响应)', async () => {
    const fetchImpl = jsonResponseFetchWith(`\`\`\`prompt\n${AI_DRAFT_V2}\n\`\`\``)
    const gateway = await makeGateway({ fetchImpl })
    const patchBefore = readFileSync(patchPath, 'utf8')
    const totalBefore = (await gateway.promptVersions({})).total
    const polish: AiPolishResult = await gateway.aiPolish({ entryId: 'preset.standard.persona' })
    expect(polish.status).toBe('ok')
    expect(polish.draft).toBe(AI_DRAFT_V2)
    // 三重断言(口径照抄 t7-e2e 只读证明手法):版本数不变 / patch 文件字节不变 / 无在途审批。
    expect((await gateway.promptVersions({})).total).toBe(totalBefore)
    expect(readFileSync(patchPath, 'utf8')).toBe(patchBefore)
    expect(gateway.gate.peek()).toBeNull()
    // 端点视图复核:snapshot.pendingApproval 仍无在途(与 gate 内部态双保险)。
    const snapshot = await gateway.snapshot()
    expect(snapshot.pendingApproval).toBeNull()
    await gateway.dispose()
  })

  it('T3.2 ② 建议稿→「作为提案提交」→ R3 两段式:一段 approval-required(kind/ruleId/动作名/diff 摘要同源),二段 committed(source=ai-proposal、parentId=写前最新),审计含 aiSource 来源字段', async () => {
    const fetchImpl = jsonResponseFetchWith(`\`\`\`prompt\n${AI_DRAFT_V2}\n\`\`\``)
    const gateway = await makeGateway({ fetchImpl })
    const polish = await gateway.aiPolish({ entryId: 'preset.standard.persona' })
    expect(polish.status).toBe('ok')
    const draft = polish.draft ?? ''
    const latestBefore = ((await gateway.promptVersions({})).versions[0])?.id
    const meta = polish.meta
    const aiMeta = meta === undefined
      ? {}
      : { provider: meta.provider, model: meta.model, metaPromptEntryId: meta.metaPromptEntryId }
    // 一段:R3 审批卡(kind=ai-proposal;ruleId 按 T1.6 泛化解析=persona 条目专属规则)。
    const stage1: AiProposalResult = await gateway.aiProposal({ entryId: 'preset.standard.persona', content: draft, author: 't7-ai', aiMeta })
    expect(stage1.status).toBe('approval-required')
    expect(stage1.approval?.kind).toBe('ai-proposal')
    expect(stage1.approval?.card.matchedRule.ruleId).toBe('eterna.prompt-studio.persona-write')
    expect(stage1.approval?.card.matchedRule.grade).toBe('R3')
    // 卡片动作名=真实端点(不造 loopPrompt/prompt-ai-proposal 假端点名)。
    expect(stage1.approval?.card.whatWillHappen.name).toBe('loopPrompt/ai-proposal')
    // diff 摘要与 diff.ts 同一模块导出(审批卡 diffSummary ≡ diffSummaryText(diffLines(底稿,建议稿)))。
    expect(stage1.approval?.card.impact.files[0]?.diffSummary)
      .toBe(diffSummaryText(diffLines(PERSONA_V1, draft)))
    // 一段后仍零落盘(patch 未含建议稿;在途审批此时才存在)。
    expect(readFileSync(patchPath, 'utf8')).not.toContain('AI 建议稿(T3.2)')
    // 二段:确认执行 → patch 原子写 + 新版本(source=ai-proposal、parentId=写前最新)。
    const stage2: AiProposalResult = await gateway.aiProposal({
      entryId: 'preset.standard.persona', content: draft, author: 't7-ai',
      approvalId: stage1.approval?.approvalId ?? '', approved: true, aiMeta,
    })
    expect(stage2.status).toBe('committed')
    expect(stage2.version?.source).toBe('ai-proposal')
    expect(stage2.version?.entryId).toBe('preset.standard.persona')
    expect(stage2.version?.parentId).toBe(latestBefore)
    expect((await gateway.patch.read()).text).toBe(draft)
    // 审计:approval-requested/committed 均含 aiSource 来源字段(provider/model/元提示词条目 id)。
    await gateway.audit.flush()
    const details = await auditDetails(auditPath)
    const requested = details.find(record => record.action === 'prompt-ai-proposal.approval-requested')
    expect(requested?.aiSource).toEqual({ provider: 'litellm', model: 'deepseek-flash', metaPromptEntryId: AI_META_POLISH_ENTRY_ID })
    const committed = details.find(record => record.action === 'prompt-ai-proposal.committed')
    expect(committed?.aiSource).toEqual({ provider: 'litellm', model: 'deepseek-flash', metaPromptEntryId: AI_META_POLISH_ENTRY_ID })
    expect(committed?.versionId).toBe(stage2.version?.id)
    await gateway.dispose()
  })

  it('T3.2 ② AI 产出不豁免门禁:缺红线建议稿一段即拒收(issues 指明),版本/patch 零变化;来源标注缺失时审计如实记「(未标注)」不拒收', async () => {
    const gateway = await makeGateway()
    const totalBefore = (await gateway.promptVersions({})).total
    const patchBefore = readFileSync(patchPath, 'utf8')
    // 缺红线的建议稿:与保存/导入同一套按条目校验器拒收(AI 产出无任何豁免)。
    const rejected: AiProposalResult = await gateway.aiProposal({
      entryId: 'preset.standard.persona', content: 'AI 建议稿但缺红线锚点。', author: 't7-ai',
    })
    expect(rejected.status).toBe('rejected')
    expect(rejected.issues?.join(';')).toContain('红线')
    expect((await gateway.promptVersions({})).total).toBe(totalBefore)
    expect(readFileSync(patchPath, 'utf8')).toBe(patchBefore)
    // 来源标注缺失:不拒收(溯源元数据非安全边界),走通两段后审计如实记「(未标注)」。
    const stage1: AiProposalResult = await gateway.aiProposal({ entryId: 'preset.standard.persona', content: AI_DRAFT_V2, author: 't7-ai' })
    expect(stage1.status).toBe('approval-required')
    const stage2: AiProposalResult = await gateway.aiProposal({
      entryId: 'preset.standard.persona', content: AI_DRAFT_V2, author: 't7-ai',
      approvalId: stage1.approval?.approvalId ?? '', approved: true,
    })
    expect(stage2.status).toBe('committed')
    await gateway.audit.flush()
    const committed = (await auditDetails(auditPath)).find(record => record.action === 'prompt-ai-proposal.committed')
    expect(committed?.aiSource).toEqual({ provider: '(未标注)', model: '(未标注)', metaPromptEntryId: '(未标注)' })
    await gateway.dispose()
  })

  it('T3.2 ③ diff 预览复用 diff.ts:lineDiffOps(底稿,建议稿) 与 diffLines 统计口径一致(前端 AiDraftDiff 的同一数据面;既有 diff 单测零改动)', async () => {
    // 纯函数面:前端 diff 预览(AiDraftDiff)与审批卡摘要消费同一模块的同一投影。
    const ops = lineDiffOps(PERSONA_V1, AI_DRAFT_V2)
    expect(ops.filter(op => op.type === 'add').length).toBe(diffLines(PERSONA_V1, AI_DRAFT_V2).added)
    expect(ops.filter(op => op.type === 'del').length).toBe(diffLines(PERSONA_V1, AI_DRAFT_V2).removed)
    expect(ops.some(op => op.type === 'add' && op.text.includes('AI 建议稿(T3.2)'))).toBe(true)
    expect(diffLines(AI_DRAFT_V2, AI_DRAFT_V2).isEmpty).toBe(true)
  })

  it('T3.2 ④ 元提示词自管递归保护:润色元提示词自身单层收敛(恰一次模型调用),其建议稿作为提案落盘 source=ai-proposal 且写临时仓库(绝不动真仓文件)', async () => {
    // 临时仓库根镜像元提示词文件(整文件条目写回落点=repoRoot 相对;真仓文件只读)。
    const repoRoot = join(dir, 'repo')
    mkdirSync(join(repoRoot, 'packages', 'prompt-studio', 'ai'), { recursive: true })
    const polishMd = readFileSync(join(REPO_ROOT, 'packages', 'prompt-studio', 'ai', 'polish.md'), 'utf8')
    const metaDraft = `${polishMd}\nT3.2 追加段:建议稿标记(递归保护单测;元提示词自身也走润色流提案)。\n`
    writeFileSync(join(repoRoot, 'packages', 'prompt-studio', 'ai', 'polish.md'), polishMd, 'utf8')
    const fetchImpl = jsonResponseFetchWith(`\`\`\`prompt\n${metaDraft}\n\`\`\``)
    const gateway = await makeGateway({ fetchImpl, repoRoot, freshContext: true })
    // 润色目标=元提示词自身:system 消息即其当前值(吃狗粮),user=条目元数据+全文——
    // 单层调用收敛(mocked llm 恰一次,无自嵌套递归)。
    const polish: AiPolishResult = await gateway.aiPolish({ entryId: AI_META_POLISH_ENTRY_ID })
    expect(polish.status).toBe('ok')
    expect(fetchImpl.calls).toHaveLength(1)
    // 其建议稿作为提案:两段式落盘 source=ai-proposal,写临时仓库的镜像文件。
    const stage1: AiProposalResult = await gateway.aiProposal({ entryId: AI_META_POLISH_ENTRY_ID, content: polish.draft ?? metaDraft, author: 't7-ai' })
    expect(stage1.status).toBe('approval-required')
    expect(stage1.approval?.card.matchedRule.ruleId).toBe(`eterna.prompt-studio.entry-write.${AI_META_POLISH_ENTRY_ID}`)
    const stage2: AiProposalResult = await gateway.aiProposal({
      entryId: AI_META_POLISH_ENTRY_ID, content: polish.draft ?? metaDraft, author: 't7-ai',
      approvalId: stage1.approval?.approvalId ?? '', approved: true,
    })
    expect(stage2.status).toBe('committed')
    expect(stage2.version?.source).toBe('ai-proposal')
    expect(readFileSync(join(repoRoot, 'packages', 'prompt-studio', 'ai', 'polish.md'), 'utf8')).toBe(polish.draft ?? metaDraft)
    // 全程恰一次模型调用(提案提交不再触发 AI——生效通道是 R3 写链路,不是模型)。
    expect(fetchImpl.calls).toHaveLength(1)
    // 真仓文件未被触碰(镜像隔离纪律)。
    expect(readFileSync(join(REPO_ROOT, 'packages', 'prompt-studio', 'ai', 'polish.md'), 'utf8')).toBe(polishMd)
    await gateway.dispose()
  })
})
