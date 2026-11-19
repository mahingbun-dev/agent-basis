/**
 * K2.4 公共金集断言【=G2-B2】(36 号 §3 表/§2.4/K2.4 规格)。
 *
 * 结构(36 号 K2.4 原文):`golden/cases/*.json`(能力声明 + 期望产出)× 参数化分支;
 * 每分支喂各自的提供方响应 fixture(deepseek SSE 事件流 / generic tool_calls+tool_result
 * 序列),断言产出与 golden **逐字段相等**——契约试金石:同一能力声明在任意分支得到
 * 同一组规范化块(29 §2.3 实施纪律)。
 *
 * case 文件统一平铺 shape(两代写法经 normalizer 兼容):
 * `{id, capability, scope, description?, params, expected{status, reason?, blocks, toolResult?},
 *   contractVersion?, status?}`;scope='common' 全分支面,'generic'/'deepseek'/… 仅该分支面
 * (提供方特有块形态,如 deepseek 的 attachment_ref file_id 引用)。
 *
 * 用例集:五能力各 ≥1 条 + 降级路径 ≥1 条;用例新增不设上限,修改 golden 必须在 PR 说明
 * (36 §2.1 测试纪律)。已发生的修改:read-url-server-tools 原 scope=common 改 deepseek
 * (Tavily /extract 无 title/publishTime 来源,generic 不得虚构字段;详见该文件内注记)。
 *
 * 分支登记(36 §7):本批 M-K2 = generic + deepseek(K2.1 并行线收口,SSE fixture 落
 * `golden/fixtures/deepseek/`,deepseekBranch 于 BRANCHES 登记——K2.4 接入);glm/mimo
 * 分支为 K3.5(扩为四分支同一断言函数)。**不预置空分支**——分支必须带真 fixture 才登记。
 *
 * golden 状态标注:BLOCK_PROTOCOL_STATUS='draft'(O-2:块字段集评审确认前 golden 为
 * 草案;确认后改 'golden',见 src/blocks/types.ts 文件头注)。
 */
import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  BLOCK_PROTOCOL_STATUS,
  CAPABILITY_IDS,
  CONTRACT_VERSION,
  TavilyClient,
  buildMessagesRequest,
  createCapabilityRequest,
  parseMessageStreamFromSse,
  runGenericCapability,
  serializeBlocks,
  toAttachmentRefBlocks,
  toNormalizedBlocks,
  toReadUrlUserMessage,
  toWebSearchUserMessage,
} from '../src/index.ts'
import type {
  CapabilityId,
  CapabilityOutcome,
  CapabilityRequest,
  GenericChatResponse,
  GenericExecutorDeps,
  ReadUrlParams,
  TavilyFetchResponse,
  WebSearchParams,
} from '../src/index.ts'

/**
 * golden case 文件形态(golden/cases/*.json;统一平铺 shape)。
 * 兼容两代写法:并行线早期 `request:{capability,params}` 包装形态由 normalizer 兼容。
 * scope 语义(分支过滤):'common'=所有分支都必须过(各自喂自己的 fixture);'generic'/'deepseek'/
 * 'glm'/'mimo'=仅该分支面(提供方特有块形态);缺省视为 'common'。
 * contractVersion/status 为可选元数据:出现时必须与 CONTRACT_VERSION/BLOCK_PROTOCOL_STATUS 相等。
 */
interface GoldenCaseRaw {
  readonly id?: string
  readonly capability?: CapabilityId
  readonly scope?: 'common' | 'generic' | 'deepseek' | 'glm' | 'mimo'
  readonly description?: string
  readonly params?: Record<string, unknown>
  readonly request?: { readonly capability: CapabilityId; readonly params?: Record<string, unknown> }
  readonly expected?: {
    readonly status: CapabilityOutcome['status']
    readonly reason?: string
    readonly blocks: readonly unknown[]
    readonly toolResult?: string
  }
  readonly contractVersion?: number
  readonly status?: string
}

interface GoldenCase {
  readonly id: string
  readonly capability: CapabilityId
  readonly scope: 'common' | 'generic' | 'deepseek' | 'glm' | 'mimo'
  readonly description?: string
  readonly params: Record<string, unknown>
  readonly expected: {
    readonly status: CapabilityOutcome['status']
    readonly reason?: string
    readonly blocks: readonly unknown[]
    readonly toolResult?: string
  }
  readonly contractVersion?: number
  readonly goldenStatus?: string
}

/** 归一化:平铺形态优先,`request` 包装形态兜底(并行线早期写法);scope 缺省 'common'。 */
function normalizeGoldenCase(raw: GoldenCaseRaw, fileName: string): GoldenCase {
  const capability = raw.capability ?? raw.request?.capability
  if (capability === undefined) throw new Error(`golden case ${fileName} 缺 capability 字段`)
  const params = raw.params ?? raw.request?.params ?? {}
  if (raw.expected === undefined) throw new Error(`golden case ${fileName} 缺 expected 字段`)
  return {
    id: raw.id ?? fileName.replace(/\.json$/, ''),
    capability,
    scope: raw.scope ?? 'common',
    ...(raw.description !== undefined ? { description: raw.description } : {}),
    params,
    expected: raw.expected,
    ...(raw.contractVersion !== undefined ? { contractVersion: raw.contractVersion } : {}),
    ...(raw.status !== undefined ? { goldenStatus: raw.status } : {}),
  }
}

/** 该用例是否在该分支的运行面(scope 过滤:common 全分支;分支名仅该分支)。 */
function caseRunsOnBranch(golden: GoldenCase, branchId: ParityBranch['id']): boolean {
  return golden.scope === 'common' || golden.scope === branchId
}

/** generic 分支 fixture 形态(golden/fixtures/generic/<case-id>.json)。 */
interface GenericFixture {
  readonly chat?: readonly GenericChatResponse[]
  readonly tavilySearch?: unknown
  readonly tavilySearchError?: { readonly status: number; readonly body: unknown }
  readonly tavilyExtract?: unknown
  readonly tavilyExtractError?: { readonly status: number; readonly body: unknown }
  readonly internal?: { readonly ok: boolean; readonly payload: unknown }
  readonly files?: {
    readonly inputs: readonly { readonly kind: 'image' | 'document'; readonly name: string; readonly bytesBase64: string; readonly mediaType?: string }[]
    readonly limits: { readonly maxBytes: number }
    readonly extractText?: string
  }
}

/** 分支登记形态:带真 fixture 的分支才登记(不预置空壳)。 */
interface ParityBranch {
  readonly id: 'generic' | 'deepseek' | 'glm' | 'mimo'
  run(golden: GoldenCase): Promise<CapabilityOutcome>
}

/** 加载 golden/cases/*.json(归一化;文件名即 id 兜底)。 */
function loadGoldenCases(): GoldenCase[] {
  const dir = new URL('./golden/cases/', import.meta.url)
  return readdirSync(dir)
    .filter(name => name.endsWith('.json'))
    .map(name => normalizeGoldenCase(
      JSON.parse(readFileSync(new URL(`./golden/cases/${name}`, import.meta.url), 'utf8')) as GoldenCaseRaw,
      name,
    ))
}

function loadGenericFixture(id: string): GenericFixture {
  try {
    return JSON.parse(readFileSync(new URL(`./golden/fixtures/generic/${id}.json`, import.meta.url), 'utf8')) as GenericFixture
  } catch {
    return {}
  }
}

/** deepseek 分支 fixture 形态(golden/fixtures/deepseek/<case-id>.json;K2.1 并行线)。 */
interface DeepseekFixture {
  /** Messages SSE 事件流(web_search/read_url 用例;JSON 事件数组,回放时转 SSE 文本)。 */
  readonly events?: readonly unknown[]
  /** files 用例的 file_id 引用(Files API 元数据;上传链路属 K2.2)。 */
  readonly fileRefs?: readonly { readonly fileId: string; readonly filename: string }[]
}

function loadDeepseekFixture(id: string): DeepseekFixture {
  try {
    return JSON.parse(readFileSync(new URL(`./golden/fixtures/deepseek/${id}.json`, import.meta.url), 'utf8')) as DeepseekFixture
  } catch {
    return {}
  }
}

/** 事件对象序列 → SSE 文本(deepseek fixture 回放形态:完整过 SSE 解码 + 帧消费 + applyEvent 归并)。 */
function deepseekEventsToSseText(events: readonly unknown[]): string {
  return events
    .map(event => `event: ${(event as { type?: string }).type}\ndata: ${JSON.stringify(event)}\n\n`)
    .join('')
}

function decodeBase64Bytes(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}

/** generic 分支:fixture 驱动的完整链路(chat 传输脚本 + tavily fetch 路由 + 注入抽取器)。 */
const genericBranch: ParityBranch = {
  id: 'generic',
  async run(golden) {
    const fixture = loadGenericFixture(golden.id)
    const internal = fixture.internal
    const tavilySearch = fixture.tavilySearch
    const tavilySearchError = fixture.tavilySearchError
    const tavilyExtract = fixture.tavilyExtract
    const tavilyExtractError = fixture.tavilyExtractError
    const hasTavily = tavilySearch !== undefined || tavilySearchError !== undefined
      || tavilyExtract !== undefined || tavilyExtractError !== undefined
    let tavily: TavilyClient | undefined
    if (hasTavily) {
      tavily = new TavilyClient({
        apiKey: 'golden-key',
        fetchImpl: async (url): Promise<TavilyFetchResponse> => {
          if (url.endsWith('/search')) {
            if (tavilySearchError !== undefined) {
              return { ok: false, status: tavilySearchError.status, json: async () => tavilySearchError.body }
            }
            return { ok: true, status: 200, json: async () => tavilySearch }
          }
          if (url.endsWith('/extract')) {
            if (tavilyExtractError !== undefined) {
              return { ok: false, status: tavilyExtractError.status, json: async () => tavilyExtractError.body }
            }
            return { ok: true, status: 200, json: async () => tavilyExtract }
          }
          throw new Error(`generic golden fixture 未路由 ${url}`)
        },
      })
    }
    const deps: GenericExecutorDeps = {
      ...(internal !== undefined ? { internal: async (): Promise<{ ok: boolean; payload: unknown }> => internal } : {}),
      ...(tavily !== undefined ? { tavily } : {}),
    }
    const request: CapabilityRequest = createCapabilityRequest(golden.capability, golden.params)
    if (fixture.chat !== undefined) {
      const responses = [...fixture.chat]
      return runGenericCapability(request, deps, {
        transport: async () => {
          const response = responses.shift()
          if (response === undefined) throw new Error(`generic golden fixture chat 响应耗尽(${golden.id})`)
          return structuredClone(response)
        },
        maxRounds: 4,
      })
    }
    if (fixture.files !== undefined) {
      const files = fixture.files
      const inputs = files.inputs.map(input => ({
        kind: input.kind,
        name: input.name,
        bytes: decodeBase64Bytes(input.bytesBase64),
        ...(input.mediaType !== undefined ? { mediaType: input.mediaType } : {}),
      }))
      const extracted = files.extractText
      const depsWithExtractor: GenericExecutorDeps = {
        ...deps,
        ...(extracted !== undefined ? { extractText: async (): Promise<string | null> => extracted } : {}),
      }
      return runGenericCapability(request, depsWithExtractor, {
        filesInputs: inputs,
        filesLimits: files.limits,
      })
    }
    return runGenericCapability(request, deps)
  },
}

/**
 * deepseek 分支(K2.1 对话侧;K2.4 接入登记):serverTools 组装 + SSE fixture 回放 +
 * 规范化块翻译(chat-demo 范式);files 走 file_id 引用翻译(上传链路属 K2.2);
 * tts/asr 显式 unavailable(P-3/O-9,与 generic 分支同一降级结论——common 面用例)。
 */
const deepseekBranch: ParityBranch = {
  id: 'deepseek',
  async run(golden) {
    const request: CapabilityRequest = createCapabilityRequest(golden.capability, golden.params)
    const fixture = loadDeepseekFixture(golden.id)
    switch (request.capability) {
      case 'web_search':
      case 'read_url': {
        // 组装面参与回放(serverTools 翻译;契约经唯一构造口,非法声明在此即抛)。
        const message = request.capability === 'web_search'
          ? toWebSearchUserMessage(request.params as unknown as WebSearchParams)
          : toReadUrlUserMessage(request.params as unknown as ReadUrlParams)
        buildMessagesRequest({ model: 'deepseek-flash', messages: [message], capabilities: [request.capability] })
        const state = parseMessageStreamFromSse(deepseekEventsToSseText(fixture.events ?? []))
        const blocks = toNormalizedBlocks(state)
        const hasError = blocks.some(block => block.type === 'search_step' && block.status === 'error')
        return { capability: request.capability, status: hasError ? 'degraded' : 'ok', blocks }
      }
      case 'files':
        return { capability: 'files', status: 'ok', blocks: toAttachmentRefBlocks(fixture.fileRefs ?? []) }
      case 'tts':
      case 'asr':
        // 语音供给链归 P-3(29 §4 P-3/§7-2;36 号 §8/O-9):显式 unavailable,不假装可用。
        return { capability: request.capability, status: 'unavailable', blocks: [] }
    }
  },
}

/** 分支登记表:本批 generic + deepseek(K2.4 接入,真 fixture 已落 golden/fixtures/deepseek/);glm/mimo(K3.5)带真 fixture 后登记。 */
const BRANCHES: readonly ParityBranch[] = [genericBranch, deepseekBranch]

/**
 * 同一断言函数(所有分支 × 所有 case 共用,K2.4 核心):
 * 产出与 golden 逐字段相等(status/reason?/blocks/toolResult?)+ 块守卫(G2-B3 联动:
 * 序列化零泄漏)+ 契约版本一致 + golden 状态标注与 BLOCK_PROTOCOL_STATUS 联动。
 */
function assertGoldenOutcome(golden: GoldenCase, outcome: CapabilityOutcome): void {
  expect(outcome.capability).toBe(golden.capability)
  expect(outcome.status).toBe(golden.expected.status)
  if (golden.expected.reason !== undefined) {
    expect(outcome.reason).toBe(golden.expected.reason)
  }
  expect(outcome.blocks).toEqual(golden.expected.blocks)
  if (golden.expected.toolResult !== undefined) {
    expect(outcome.toolResult).toBe(golden.expected.toolResult)
  }
  // G2-B3 联动:全部块样例键名白名单内零泄漏(encrypted_content/signature/web_search_usage 等)。
  expect(() => serializeBlocks(outcome.blocks)).not.toThrow()
  // 元数据一致性(可选字段,出现即须相等——draft 标注与契约版本)。
  if (golden.contractVersion !== undefined) {
    expect(golden.contractVersion).toBe(CONTRACT_VERSION)
  }
  if (golden.goldenStatus !== undefined) {
    expect(golden.goldenStatus).toBe(BLOCK_PROTOCOL_STATUS)
  }
}

const goldenCases = loadGoldenCases()

describe('K2.4 金集结构自检', () => {
  it('用例集:五能力各 ≥1 + 降级路径 ≥1(36 号 K2.4;按全用例集计,分支运行面另过滤)', () => {
    expect(goldenCases.length).toBeGreaterThanOrEqual(6)
    const byCapability = new Map<CapabilityId, number>()
    for (const golden of goldenCases) {
      byCapability.set(golden.capability, (byCapability.get(golden.capability) ?? 0) + 1)
    }
    for (const capability of CAPABILITY_IDS) {
      expect(byCapability.get(capability) ?? 0, `能力 ${capability} 至少 1 条用例`).toBeGreaterThanOrEqual(1)
    }
    expect(goldenCases.filter(golden => golden.expected.status !== 'ok').length).toBeGreaterThanOrEqual(1)
  })

  it('scope 合法性:∈ {common,generic,deepseek,glm,mimo};common 用例须可被全分支面消费', () => {
    for (const golden of goldenCases) {
      expect(['common', 'generic', 'deepseek', 'glm', 'mimo']).toContain(golden.scope)
    }
    // generic 分支的运行面:common + generic(K2.4 首批接入;glm/mimo 面随各自批次登记)。
    expect(goldenCases.filter(golden => caseRunsOnBranch(golden, 'generic')).length).toBeGreaterThanOrEqual(6)
    // deepseek 分支的运行面:common + deepseek(K2.4 接入;K3.5 扩 glm/mimo 四分支)。
    expect(goldenCases.filter(golden => caseRunsOnBranch(golden, 'deepseek')).length).toBeGreaterThanOrEqual(6)
  })

  it('分支登记:本批 generic + deepseek(带真 fixture);glm/mimo 随 K3.5 登记', () => {
    expect(BRANCHES.map(branch => branch.id)).toEqual(['generic', 'deepseek'])
  })
})

describe('K2.4 公共金集断言【=G2-B2】(参数化分支 × golden cases,scope 过滤)', () => {
  for (const branch of BRANCHES) {
    const runnable = goldenCases.filter(golden => caseRunsOnBranch(golden, branch.id))
    describe.each(runnable.map(golden => [golden.id, golden] as const))(
      `${branch.id} 分支 · %s`,
      (id, golden) => {
        it(`同一断言函数:${id} 产出与 golden 逐字段相等`, async () => {
          const outcome = await branch.run(golden)
          assertGoldenOutcome(golden, outcome)
        })
      },
    )
  }
})
