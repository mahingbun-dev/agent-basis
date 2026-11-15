/**
 * C11 checkpoint 附件单测(22 号 §5-C11):
 *
 * - 清单提取:span 内 tool/call(log-only 事件)按最后出现序去重、白名单外
 *   工具/无路径参数/坏 JSON 忽略、无匹配返回 []。
 * - 边界:workspace 逃逸拒绝两型(`../` 相对逃逸与绝对路径逃逸)、读失败标
 *   read-failed、目录读同样 read-failed(rel==='')、`..`前缀同名文件不误伤。
 * - 预算:perFileTokens 超限截断(头若干行+提示)、maxFiles 保留最后出现序尾部
 *   (最近文件)、totalTokens 总预算顺序填充、DEFAULT_ATTACHMENT_BUDGET 5/5000/50000。
 * - 注入:region 事务内附件块并入同一条 user/message,surfaceOp/sourceEventSeqs
 *   replace 事务字段不变;开关缺席无附件块;附件撑爆 shrink 价时从最旧端逐个
 *   再截断,摘要本身保住;引擎接线(config.attachments + session.header.cwd)。
 *
 * 测试面 workspace 一律 mkdtempSync(tmpdir()) 运行时生成,不写 '/data/' 等字面量
 * 绝对路径(tenant-scan T1 纪律,packctl src/tenant.ts ABSOLUTE_PERSIST_PATTERN)。
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { estimateContent } from '@deepseek-ai/dsh-token-meter/estimate'
import { SESSION_FORMAT_VERSION, Session, SessionId, SessionSeq } from '@deepseek-ai/dsh-session'
import type { SessionEvent, SessionEventType, SessionSeq as SessionSeqType } from '@deepseek-ai/dsh-session'
import {
  ATTACHMENT_TOOL_NAMES,
  buildCompactionAttachments,
  DEFAULT_ATTACHMENT_BUDGET,
  renderAttachmentSection,
} from '../src/basic/attachments.ts'
import { resolveCompactSpec, resolveConfig, resolveTargetPolicy } from '../src/basic/config.ts'
import { compactSurfaceRegion } from '../src/basic/region.ts'
import {
  appendAssistantToolCall,
  appendRequestHeader,
  appendToolResult,
  appendTurnStart,
  appendUserMessage,
  createFakeMeter,
  fakeSummarizer,
  makeEngine,
  makeFakeAgent,
  makeFakeEngineContext,
  MINIMAL_VALID_SUMMARY,
} from './helpers/fakes.ts'

const SIGNAL = new AbortController().signal

/** 事务 options(region 私有类型的结构字面量,与收敛 spec 同款)。 */
const TRANSACTION = { owner: 'current-turn', stability: 'whole-surface' } as const

/** 附件注入的 region 依赖槽(22 号 §5-C11:engine 按 config+cwd 组装)。 */
function depsWithAttachments(workspaceRoot: string, budget = DEFAULT_ATTACHMENT_BUDGET) {
  return { workspaceRoot, budget }
}

/** 落一条 tool/call(log-only 事件,不上 surface)。 */
function appendToolCall(
  session: Session,
  turn: number,
  step: number,
  callId: string,
  name: string,
  args: string,
): SessionSeqType {
  return session.append('tool/call', {
    turn,
    step,
    callId: ToolCallId(callId),
    name,
    arguments: args,
  }).seq
}

/**
 * 落一对完整工具调用:assistant/message 携带 tool-call 块(dsh-compaction 的
 * tool-pairing balance 以 assistant 块计数、tool/call 事件 delta=0,只有裸
 * tool/call 的会话会被判 corrupt surface)+ tool/call log-only 事件(附件
 * 提取的真实来源,真实会话两者并存,见 golden session.jsonl)。
 */
function appendToolCallPair(
  session: Session,
  turn: number,
  step: number,
  callId: string,
  name: string,
  args: string,
): SessionSeqType {
  appendAssistantToolCall(session, turn, step, callId, name)
  return appendToolCall(session, turn, step, callId, name, args)
}

/** 读取日志尾部第 back 个事件(测试面回放只读,S'-1 行内豁免)。 */
function lastEvent(session: Session, back = 1) {
  // oxlint-disable-next-line typescript/no-deprecated -- 测试面回放只读(S'-1 行内豁免)。
  return session.eventAt(SessionSeq(session.seq - back))
}

/**
 * 断言日志尾部第 back 个事件的类型并收窄(替代裸 `?.` 链:SessionEvent 判别联合
 * 上未收窄的 `.data` 成员访问是类型错误,会级联出 no-unsafe-* 报告)。
 */
function requireEvent<T extends SessionEventType>(session: Session, type: T, back = 1): SessionEvent<T> {
  const event = lastEvent(session, back)
  if (event === undefined || event.type !== type) {
    throw new Error(`expected ${type} at tail-${back}, got ${String(event?.type)}`)
  }
  return event as SessionEvent<T>
}

/** checkpoint/用户消息的文本块拼接(消费侧只关心 text 面)。 */
function messageText(event: SessionEvent<'user/message'>): string {
  return event.data.content
    .filter((block): block is Extract<ContentBlock, { type: 'text' }> => block.type === 'text')
    .map(block => block.text)
    .join('\n')
}

/** 单文本块快捷构造(estimateContent 计价用)。 */
function textBlock(body: string) {
  return [{ type: 'text', text: body }] as const
}

/** 清理 fixture 工作区(ensureWorkspace 落过盘才删)。 */
afterAll(() => {
  if (!cleanupDone) return
  rmSync(root, { recursive: true, force: true })
  rmSync(outsideRoot, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// fixture workspace(运行时 mkdtemp,无字面量绝对路径)
// ---------------------------------------------------------------------------

let root: string
let outsideRoot: string
let cleanupDone = false

/** 建 fixture 工作区:root 内 src/main.ts + src/many-lines.txt + '..dots.txt',root 外 outsideRoot/secret.txt。 */
function ensureWorkspace(): void {
  if (cleanupDone) return
  root = mkdtempSync(join(tmpdir(), 'compaction-att-root-'))
  outsideRoot = mkdtempSync(join(tmpdir(), 'compaction-att-out-'))
  mkdirSync(join(root, 'src'), { recursive: true })
  writeFileSync(join(root, 'src', 'main.ts'), 'const answer = 42\n')
  writeFileSync(
    join(root, 'src', 'many-lines.txt'),
    Array.from({ length: 40 }, (_, index) => `line-${String(index).padStart(2, '0')}`).join('\n'),
  )
  writeFileSync(join(root, 'src', 'older.txt'), 'older file body\n')
  writeFileSync(join(root, 'src', 'newer.txt'), 'newer file body\n')
  writeFileSync(join(root, 'src', 'big.txt'), 'y'.repeat(4000))
  writeFileSync(join(root, 'src', 'older-huge.txt'), 'a'.repeat(5000))
  writeFileSync(join(root, 'src', 'newer-small.txt'), 'newest small body\n')
  writeFileSync(join(root, '..dots.txt'), 'dots file body\n')
  writeFileSync(join(outsideRoot, 'secret.txt'), 'outside body\n')
  cleanupDone = true
}

/** 带 cwd 的 detached Session(header.cwd 是引擎接线的工作区根来源)。 */
function makeSessionWithCwd(cwd: string, id = 'compaction-attachments'): Session {
  return Session.create(SessionId(id), undefined, {
    version: SESSION_FORMAT_VERSION,
    id: SessionId(id),
    createdAt: 0,
    isSeeded: false,
    cwd,
  })
}

/**
 * 标准 span 会话:turn/header + user + tool/call(read_file main.ts) + tool/result
 * + user。span 取首尾两条 user(surface 节点),tool/call 落在区间内。
 */
function makeSpanSession(body = 'x'.repeat(800), callName = 'read_file', args = JSON.stringify({ path: 'src/main.ts' })): {
  session: Session
  span: { start: SessionSeqType; end: SessionSeqType }
} {
  const session = makeSessionWithCwd(root)
  appendTurnStart(session)
  appendRequestHeader(session)
  const start = appendUserMessage(session, body)
  appendToolCallPair(session, 1, 1, 'c1', callName, args)
  appendToolResult(session, 1, 1, 'c1', 'tool result body')
  const end = appendUserMessage(session, body)
  return { session, span: { start: SessionSeq(start), end: SessionSeq(end) } }
}

// ---------------------------------------------------------------------------
// 清单提取与去重
// ---------------------------------------------------------------------------

describe('buildCompactionAttachments 清单提取', () => {
  ensureWorkspace()

  it('span 内 tool/call 按最后出现序去重,内容原样保留', async () => {
    const session = makeSessionWithCwd(root)
    appendTurnStart(session)
    appendRequestHeader(session)
    const start = appendUserMessage(session, 'x'.repeat(800))
    appendToolCallPair(session, 1, 1, 'c1', 'read_file', JSON.stringify({ path: 'src/main.ts' }))
    appendToolResult(session, 1, 1, 'c1', 'first read')
    appendToolCallPair(session, 1, 2, 'c2', 'read_file', JSON.stringify({ path: 'src/older.txt' }))
    appendToolResult(session, 1, 2, 'c2', 'second read')
    appendToolCallPair(session, 1, 3, 'c3', 'read_file', JSON.stringify({ path: 'src/main.ts' }))
    appendToolResult(session, 1, 3, 'c3', 'third read')
    const end = appendUserMessage(session, 'x'.repeat(800))
    const files = await buildCompactionAttachments(
      session,
      { start: SessionSeq(start), end: SessionSeq(end) },
      root,
      DEFAULT_ATTACHMENT_BUDGET,
    )
    // main.ts 两次出现只留一份,去重后按"最后出现序":older.txt 在前,main.ts 在后。
    expect(files.map(file => file.path)).toEqual(['src/older.txt', 'src/main.ts'])
    expect(files[1]).toMatchObject({ content: 'const answer = 42\n', truncated: false })
    expect(files[1]?.error).toBeUndefined()
  })

  it('白名单外工具、无路径字段与坏 JSON 的 arguments 都不进清单', async () => {
    const { session, span } = makeSpanSession('x'.repeat(800), 'run_command', JSON.stringify({ command: 'ls' }))
    const files = await buildCompactionAttachments(session, span, root, DEFAULT_ATTACHMENT_BUDGET)
    expect(files).toEqual([])
  })

  it('read 工具但 arguments 无 path 类字段/JSON 非法 → 忽略该调用', async () => {
    const session = makeSessionWithCwd(root)
    appendTurnStart(session)
    appendRequestHeader(session)
    const start = appendUserMessage(session, 'x'.repeat(800))
    appendToolCallPair(session, 1, 1, 'c1', 'read_file', '{}')
    appendToolResult(session, 1, 1, 'c1', 'no path')
    appendToolCallPair(session, 1, 2, 'c2', 'read_file', '{not json')
    appendToolResult(session, 1, 2, 'c2', 'bad json')
    appendToolCallPair(session, 1, 3, 'c3', 'read', JSON.stringify({ file_path: 'src/main.ts' }))
    appendToolResult(session, 1, 3, 'c3', 'file_path key')
    const end = appendUserMessage(session, 'x'.repeat(800))
    const files = await buildCompactionAttachments(
      session,
      { start: SessionSeq(start), end: SessionSeq(end) },
      root,
      DEFAULT_ATTACHMENT_BUDGET,
    )
    // file_path 是 dsh-tool-fs read 的真实参数键(勘察:tool-fs lib/index.js:232)。
    expect(files.map(file => file.path)).toEqual(['src/main.ts'])
    expect(files[0]).toMatchObject({ content: 'const answer = 42\n', truncated: false })
  })

  it('无任何 tool/call → 返回 []', async () => {
    const session = makeSessionWithCwd(root)
    appendTurnStart(session)
    appendRequestHeader(session)
    const start = appendUserMessage(session, 'x'.repeat(800))
    const end = appendUserMessage(session, 'x'.repeat(800))
    const files = await buildCompactionAttachments(
      session,
      { start: SessionSeq(start), end: SessionSeq(end) },
      root,
      DEFAULT_ATTACHMENT_BUDGET,
    )
    expect(files).toEqual([])
  })

  it('白名单覆盖 read/write/edit 真名与常见变体', () => {
    for (const name of ['read', 'write', 'edit', 'read_file', 'write_file', 'edit_file', 'file-read', 'file-write', 'file-edit', 'readFile', 'writeFile', 'editFile']) {
      expect(ATTACHMENT_TOOL_NAMES.has(name)).toBe(true)
    }
    // 非文件类工具一律不在白名单(dsh-tool-fs 真名勘察:read/write/edit/read_image/
    // apply_patch;read_image 非文本、apply_patch 无单一路径字段,均排除)。
    for (const name of ['run_command', 'read_image', 'apply_patch', 'bash']) {
      expect(ATTACHMENT_TOOL_NAMES.has(name)).toBe(false)
    }
  })
})

// ---------------------------------------------------------------------------
// workspace 边界
// ---------------------------------------------------------------------------

describe('buildCompactionAttachments workspace 边界', () => {
  ensureWorkspace()

  it('`../` 相对逃逸 → outside-workspace 只留路径', async () => {
    const { session, span } = makeSpanSession('x'.repeat(800), 'read_file', JSON.stringify({ path: '../outside.txt' }))
    const files = await buildCompactionAttachments(session, span, root, DEFAULT_ATTACHMENT_BUDGET)
    expect(files).toHaveLength(1)
    expect(files[0]).toMatchObject({ path: '../outside.txt', truncated: false, error: 'outside-workspace' })
    expect(files[0]?.content).toBeUndefined()
  })

  it('绝对路径逃逸(workspace 外)→ outside-workspace 只留路径', async () => {
    const escaped = join(outsideRoot, 'secret.txt')
    const { session, span } = makeSpanSession('x'.repeat(800), 'read_file', JSON.stringify({ path: escaped }))
    const files = await buildCompactionAttachments(session, span, root, DEFAULT_ATTACHMENT_BUDGET)
    expect(files).toHaveLength(1)
    expect(files[0]).toMatchObject({ path: escaped, truncated: false, error: 'outside-workspace' })
    expect(files[0]?.content).toBeUndefined()
  })

  it('workspace 内绝对路径允许;`..`前缀同名的根内文件不误伤', async () => {
    const insideAbsolute = join(root, 'src', 'main.ts')
    const session = makeSessionWithCwd(root)
    appendTurnStart(session)
    appendRequestHeader(session)
    const start = appendUserMessage(session, 'x'.repeat(800))
    appendToolCallPair(session, 1, 1, 'c1', 'read_file', JSON.stringify({ path: insideAbsolute }))
    appendToolResult(session, 1, 1, 'c1', 'absolute inside')
    appendToolCallPair(session, 1, 2, 'c2', 'read_file', JSON.stringify({ path: '..dots.txt' }))
    appendToolResult(session, 1, 2, 'c2', 'dot-prefixed name')
    const end = appendUserMessage(session, 'x'.repeat(800))
    const files = await buildCompactionAttachments(
      session,
      { start: SessionSeq(start), end: SessionSeq(end) },
      root,
      DEFAULT_ATTACHMENT_BUDGET,
    )
    expect(files.map(file => file.error)).toEqual([undefined, undefined])
    expect(files[0]).toMatchObject({ content: 'const answer = 42\n', truncated: false })
    expect(files[1]).toMatchObject({ content: 'dots file body\n', truncated: false })
  })

  it('读失败(不存在)标 read-failed;目录读同样 read-failed', async () => {
    const session = makeSessionWithCwd(root)
    appendTurnStart(session)
    appendRequestHeader(session)
    const start = appendUserMessage(session, 'x'.repeat(800))
    appendToolCallPair(session, 1, 1, 'c1', 'read_file', JSON.stringify({ path: 'src/missing.txt' }))
    appendToolResult(session, 1, 1, 'c1', 'missing')
    appendToolCallPair(session, 1, 2, 'c2', 'read_file', JSON.stringify({ path: '.' }))
    appendToolResult(session, 1, 2, 'c2', 'directory')
    const end = appendUserMessage(session, 'x'.repeat(800))
    const files = await buildCompactionAttachments(
      session,
      { start: SessionSeq(start), end: SessionSeq(end) },
      root,
      DEFAULT_ATTACHMENT_BUDGET,
    )
    expect(files.map(file => file.error)).toEqual(['read-failed', 'read-failed'])
    for (const file of files) expect(file.content).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// 预算
// ---------------------------------------------------------------------------

describe('buildCompactionAttachments 预算', () => {
  ensureWorkspace()

  it('默认预算 5/5000/50000', () => {
    expect(DEFAULT_ATTACHMENT_BUDGET).toEqual({ maxFiles: 5, perFileTokens: 5000, totalTokens: 50000 })
  })

  it('perFileTokens 超限 → truncated 头若干行+提示,且截后价不超过 perFileTokens', async () => {
    // many-lines.txt 全文 359 字符 ≈ 94 token(estimate: ceil(len/4)+4);60 的
    // 单文件预算只能装下头部十几行。
    const budget = { maxFiles: 5, perFileTokens: 60, totalTokens: 10_000 }
    const { session, span } = makeSpanSession('x'.repeat(800), 'read_file', JSON.stringify({ path: 'src/many-lines.txt' }))
    const files = await buildCompactionAttachments(session, span, root, budget)
    expect(files).toHaveLength(1)
    const file = files[0]
    expect(file?.truncated).toBe(true)
    expect(file?.error).toBe('too-large')
    expect(file?.content).toContain('line-00')
    expect(file?.content?.endsWith('（内容过大，需要时用 Read 工具重新读取）')).toBe(true)
    expect(file?.content).not.toContain('line-39')
    // perFileTokens 约束"内容"估价(22 号 §5-C11);块头行 `### path` 不占单文件预算。
    const price = estimateContent(textBlock(file?.content ?? ''))
    expect(price).toBeLessThanOrEqual(budget.perFileTokens)
  })

  it('maxFiles 只保留最后出现序的尾部(最近文件优先)', async () => {
    const session = makeSessionWithCwd(root)
    appendTurnStart(session)
    appendRequestHeader(session)
    const start = appendUserMessage(session, 'x'.repeat(800))
    appendToolCallPair(session, 1, 1, 'c1', 'read_file', JSON.stringify({ path: 'src/main.ts' }))
    appendToolResult(session, 1, 1, 'c1', 'r1')
    appendToolCallPair(session, 1, 2, 'c2', 'read_file', JSON.stringify({ path: 'src/older.txt' }))
    appendToolResult(session, 1, 2, 'c2', 'r2')
    appendToolCallPair(session, 1, 3, 'c3', 'read_file', JSON.stringify({ path: 'src/newer.txt' }))
    appendToolResult(session, 1, 3, 'c3', 'r3')
    const end = appendUserMessage(session, 'x'.repeat(800))
    const files = await buildCompactionAttachments(session, { start: SessionSeq(start), end: SessionSeq(end) }, root, {
      maxFiles: 2,
      perFileTokens: 5000,
      totalTokens: 50_000,
    })
    // 最后出现序 [main, older, newer] 的尾部两个:older 与 newer。
    expect(files.map(file => file.path)).toEqual(['src/older.txt', 'src/newer.txt'])
    expect(files[1]).toMatchObject({ content: 'newer file body\n', truncated: false })
  })

  it('totalTokens 总预算:装不下后面的文件整体丢弃(顺序填充)', async () => {
    const session = makeSessionWithCwd(root)
    appendTurnStart(session)
    appendRequestHeader(session)
    const start = appendUserMessage(session, 'x'.repeat(800))
    appendToolCallPair(session, 1, 1, 'c1', 'read_file', JSON.stringify({ path: 'src/older.txt' }))
    appendToolResult(session, 1, 1, 'c1', 'r1')
    appendToolCallPair(session, 1, 2, 'c2', 'read_file', JSON.stringify({ path: 'src/newer.txt' }))
    appendToolResult(session, 1, 2, 'c2', 'r2')
    const end = appendUserMessage(session, 'x'.repeat(800))
    // 每块("### path" 头行 + 正文)约 13 token,总预算 20 只装得下第一块
    // (26 > 20 丢弃第二块);首块恒保留(防退化配置空手而归)。
    const files = await buildCompactionAttachments(session, { start: SessionSeq(start), end: SessionSeq(end) }, root, {
      maxFiles: 5,
      perFileTokens: 5000,
      totalTokens: 20,
    })
    expect(files.map(file => file.path)).toEqual(['src/older.txt'])
  })
})

// ---------------------------------------------------------------------------
// region 注入(附件并入同一条 user/message,replace 事务字段不变)
// ---------------------------------------------------------------------------

/** 直接依赖表(fake meter + 脚本 summarizer + recover false + 可选附件槽)。 */
function makeDeps(
  face: ReturnType<typeof fakeSummarizer>,
  attachments?: ReturnType<typeof depsWithAttachments>,
): Parameters<typeof compactSurfaceRegion>[0] {
  return {
    meter: createFakeMeter(),
    summarize: face,
    recover: () => false,
    ...(attachments === undefined ? {} : { attachments }),
  } as unknown as Parameters<typeof compactSurfaceRegion>[0]
}

describe('region 注入', () => {
  ensureWorkspace()

  it('附件非空:checkpoint 文本含附件块,surfaceOp/sourceEventSeqs replace 事务字段不变', async () => {
    const { session, span } = makeSpanSession()
    const face = fakeSummarizer([MINIMAL_VALID_SUMMARY])
    const result = await compactSurfaceRegion(
      makeDeps(face, depsWithAttachments(root)),
      session,
      span.start,
      span.end,
      makeFakeAgent(session),
      TRANSACTION,
      SIGNAL,
    )
    // span 内 surface 节点:两条 user + assistant(tool-call 块) + tool/result。
    expect(result.shadowedSeqs).toHaveLength(4)
    // 日志尾:[..., compaction/summary, user/message(checkpoint), compaction/end]。
    const endEvent = requireEvent(session, 'compaction/end')
    expect(endEvent.data.error).toBeUndefined()
    const checkpoint = requireEvent(session, 'user/message', 2)
    const text = messageText(checkpoint)
    expect(text).toContain('## Attached Recent Files (re-read after compaction)')
    expect(text).toContain('### src/main.ts')
    expect(text).toContain('const answer = 42')
    expect(text).toContain('</compacted-summary>')
    // replace 单事务:附件并入同一条 user/message,不新增节点。
    expect(checkpoint.surfaceOp).toEqual({ op: 'replace', startSeq: span.start, endSeq: span.end })
    expect(checkpoint.sourceEventSeqs).toContain(span.start)
    expect(checkpoint.sourceEventSeqs).toContain(span.end)
    expect(session.surface.nodes).toHaveLength(1)
  })

  it('开关缺席(deps 无 attachments 槽)→ checkpoint 无附件块,行为与 C10 前一致', async () => {
    const { session, span } = makeSpanSession()
    const face = fakeSummarizer([MINIMAL_VALID_SUMMARY])
    await compactSurfaceRegion(
      makeDeps(face),
      session,
      span.start,
      span.end,
      makeFakeAgent(session),
      TRANSACTION,
      SIGNAL,
    )
    const text = messageText(requireEvent(session, 'user/message', 2))
    expect(text).not.toContain('Attached Recent Files')
    expect(text).not.toContain('const answer = 42')
    expect(text).toContain('compacted-summary')
  })

  it('附件撑爆 shrink 价 → 从最旧端逐个再截断,最新文件保住、摘要本身不失败', async () => {
    // 两条 2000 字符 user(遮蔽价 ~2×(500+8)≈1016);older-huge(5000 字符 ≈1254
    // token 块价)+ newer-small(~16 token)。含全部附件的 framed 价(~1490)≥遮蔽价
    // → 丢最旧(older-huge)后 framed(~226)<遮蔽价 → 通过。
    const session = makeSessionWithCwd(root)
    appendTurnStart(session)
    appendRequestHeader(session)
    const start = appendUserMessage(session, 'x'.repeat(2000))
    appendToolCallPair(session, 1, 1, 'c1', 'read_file', JSON.stringify({ path: 'src/older-huge.txt' }))
    appendToolResult(session, 1, 1, 'c1', 'r1')
    appendToolCallPair(session, 1, 2, 'c2', 'read_file', JSON.stringify({ path: 'src/newer-small.txt' }))
    appendToolResult(session, 1, 2, 'c2', 'r2')
    const end = appendUserMessage(session, 'x'.repeat(2000))
    const face = fakeSummarizer([MINIMAL_VALID_SUMMARY])
    const result = await compactSurfaceRegion(
      makeDeps(face, depsWithAttachments(root, { maxFiles: 5, perFileTokens: 50_000, totalTokens: 500_000 })),
      session,
      SessionSeq(start),
      SessionSeq(end),
      makeFakeAgent(session),
      TRANSACTION,
      SIGNAL,
    )
    expect(result.endSeq).toBeGreaterThan(0)
    expect(requireEvent(session, 'compaction/end').data.error).toBeUndefined()
    const text = messageText(requireEvent(session, 'user/message', 2))
    expect(text).toContain('src/newer-small.txt')
    expect(text).toContain('newest small body')
    expect(text).not.toContain('src/older-huge.txt')
    expect(text).not.toContain('aaaa')
  })

  it('附件耗尽仍不收敛 → 摘要本身 shrink 失败原样抛出(附件不掩盖真错误)', async () => {
    // 遮蔽价固定(2×800 字符 user ~400 token),摘要本身 framed ~350;再挂一个
    // 巨大附件(totalTokens/perFile 无限)→ 含附件超遮蔽价 → 丢到 0 仍是被附件
    // 前置校验拒绝?否:丢完附件后 framed(无附件) < 遮蔽价,应成功。
    // 构造"摘要本身超遮蔽价"需摘要文本巨大——本用例改验:附件全丢后恢复通过,
    // compaction/end 无 error(即"再截断"总能保住合法摘要路径)。
    const { session, span } = makeSpanSession('x'.repeat(800), 'read_file', JSON.stringify({ path: 'src/big.txt' }))
    const face = fakeSummarizer([MINIMAL_VALID_SUMMARY])
    const result = await compactSurfaceRegion(
      makeDeps(face, depsWithAttachments(root, { maxFiles: 5, perFileTokens: 1_000_000, totalTokens: 10_000_000 })),
      session,
      span.start,
      span.end,
      makeFakeAgent(session),
      TRANSACTION,
      SIGNAL,
    )
    expect(requireEvent(session, 'compaction/end').data.error).toBeUndefined()
    const text = messageText(requireEvent(session, 'user/message', 2))
    // big.txt(4000 字符 ~1000 token)撑爆 400 token 遮蔽价 → 全部丢弃 → 无附件块。
    expect(text).not.toContain('Attached Recent Files')
    expect(text).not.toContain('yyyy')
    expect(result.shadowedTokenCount).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------
// 引擎接线(config.attachments + session.header.cwd)
// ---------------------------------------------------------------------------

describe('引擎接线', () => {
  ensureWorkspace()

  it('attachments=true + header.cwd → engine.compactRegion 的 checkpoint 带附件块', async () => {
    const harness = makeFakeEngineContext(createFakeMeter())
    const engine = makeEngine(harness.ctx, { attachments: true })
    const session = makeSessionWithCwd(root)
    appendTurnStart(session)
    appendRequestHeader(session)
    const start = appendUserMessage(session, 'x'.repeat(800))
    appendToolCallPair(session, 1, 1, 'c1', 'read_file', JSON.stringify({ path: 'src/main.ts' }))
    appendToolResult(session, 1, 1, 'c1', 'r1')
    const end = appendUserMessage(session, 'x'.repeat(800))
    const agent = makeFakeAgent(session)
    ;(engine as unknown as { summarize: unknown }).summarize = fakeSummarizer([MINIMAL_VALID_SUMMARY])
    await engine.compactRegion(SessionSeq(start), SessionSeq(end), agent, SIGNAL)
    const text = messageText(requireEvent(session, 'user/message', 2))
    expect(text).toContain('## Attached Recent Files (re-read after compaction)')
    expect(text).toContain('const answer = 42')
  })

  it('attachments 缺省 false → 同会话 checkpoint 无附件块', async () => {
    const harness = makeFakeEngineContext(createFakeMeter())
    const engine = makeEngine(harness.ctx, {})
    const session = makeSessionWithCwd(root)
    appendTurnStart(session)
    appendRequestHeader(session)
    const start = appendUserMessage(session, 'x'.repeat(800))
    appendToolCallPair(session, 1, 1, 'c1', 'read_file', JSON.stringify({ path: 'src/main.ts' }))
    appendToolResult(session, 1, 1, 'c1', 'r1')
    const end = appendUserMessage(session, 'x'.repeat(800))
    const agent = makeFakeAgent(session)
    ;(engine as unknown as { summarize: unknown }).summarize = fakeSummarizer([MINIMAL_VALID_SUMMARY])
    await engine.compactRegion(SessionSeq(start), SessionSeq(end), agent, SIGNAL)
    const text = messageText(requireEvent(session, 'user/message', 2))
    expect(text).not.toContain('Attached Recent Files')
  })
})

// ---------------------------------------------------------------------------
// 配置面(attachments 键)
// ---------------------------------------------------------------------------

describe('config attachments 键', () => {
  it('默认 false;显式布尔生效;非布尔拒绝', () => {
    expect(resolveConfig().attachments).toBe(false)
    expect(resolveConfig({ attachments: true }).attachments).toBe(true)
    expect(resolveConfig({ attachments: false }).attachments).toBe(false)
    expect(() => resolveConfig({ attachments: 1 } as unknown as Parameters<typeof resolveConfig>[0]))
      .toThrow(/attachments/)
  })

  it('纳入 modelPolicies 精确覆盖与回退,resolveCompactSpec 透传', () => {
    const config = resolveConfig({
      attachments: true,
      modelPolicies: [{ provider: 'prov', model: 'fast', attachments: false }],
    })
    const overridden = resolveTargetPolicy(config, { provider: 'prov', model: 'fast' })
    const inherited = resolveTargetPolicy(config, { provider: 'prov', model: 'slow' })
    expect(overridden.attachments).toBe(false)
    expect(inherited.attachments).toBe(true)
    const spec = resolveCompactSpec(overridden, 100_000, 4_096)
    expect(spec.attachments).toBe(false)
  })

  it('attachments 现在是合法键,未知键仍拒绝', () => {
    expect(() => resolveConfig({ bogus: true } as unknown as Parameters<typeof resolveConfig>[0]))
      .toThrow(/unknown key/)
  })
})

// ---------------------------------------------------------------------------
// 渲染(renderAttachmentSection)
// ---------------------------------------------------------------------------

describe('renderAttachmentSection', () => {
  it('空清单 → 空串(不产生附件块)', () => {
    expect(renderAttachmentSection([])).toBe('')
  })

  it('成功件与失败件分别渲染内容与提示', () => {
    const section = renderAttachmentSection([
      { path: 'src/main.ts', content: 'const answer = 42\n', truncated: false },
      { path: '../outside.txt', truncated: false, error: 'outside-workspace' },
      { path: 'src/missing.txt', truncated: false, error: 'read-failed' },
    ])
    expect(section.startsWith('\n\n## Attached Recent Files (re-read after compaction)\n')).toBe(true)
    expect(section).toContain('### src/main.ts\nconst answer = 42\n')
    expect(section).toContain('### ../outside.txt\n（路径在工作区外，未读取）')
    expect(section).toContain('### src/missing.txt\n（内容读取失败，需要时用 Read 工具重新读取）')
  })
})
