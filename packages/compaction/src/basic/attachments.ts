/**
 * C11 checkpoint attachments (22 号 §5-C11): rebuild recently touched workspace
 * files into the compaction checkpoint so the resumed model sees their
 * post-compaction state without re-deriving it from the summary prose.
 *
 * 提取面:span(`{start,end}` 两个 surface 节点 seq 之间的日志闭区间)内扫
 * `tool/call` 事件——log-only 事件(dsh-session types.d.ts:362-368,不上
 * surface),落在被遮蔽区间的调用即"该区间里真实发生过的文件读写",与其
 * tool/result 是否已被 L1/stale 替换无关。区间内日志 seq 连续(dsh-session
 * 保证 sequence numbers stay contiguous),数值循环 + `eventAt` 读法与
 * region.ts 既有 shadowedSeqs 读法同类(Existing Session history read;
 * migration deferred),豁免注释同款。
 *
 * 读文件面:node:fs 同步读、宿主进程内、无 LLM(22 号 §5-C11 钉死)。导出
 * 签名保持 `Promise<FileAttachment[]>` 接缝,但实现为非 async 函数同步求值
 * ——src/** 的 typescript/require-await 基线禁止无 await 的 async 函数,
 * 而同步体恰是规格注释「内部同步读 fs」的本意;region 侧 `await` 该
 * Promise 仅多一个微任务,提交前的 assertStable(region.ts)覆盖该间隙。
 *
 * 边界纪律:resolve 后必须落在 workspaceRoot 内(path.relative 精确前缀
 * 检查,`..` 前缀同名文件不误伤);词法检查不追符号链接(真符号链接逃逸
 * 属已知限制,默认 attachments=false 兜底)。预算三级:maxFiles 文件数、
 * perFileTokens 单文件估价(超出截头+提示)、totalTokens 总预算(顺序
 * 填充装不下即止,首块恒保留防退化配置空手而归)。
 *
 * @module @eterna/compaction/basic/attachments
 */

import { readFileSync } from 'node:fs'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { deepFreeze } from '@deepseek-ai/dsh-util-values'
import { estimateContent } from '@deepseek-ai/dsh-token-meter/estimate'
import { SessionSeq } from '@deepseek-ai/dsh-session'
import type { Session } from '@deepseek-ai/dsh-session'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'

/** Attachment budget: file count, per-file price, and section total. */
export interface AttachmentBudget {
  /** 最多并入的文件数(最后出现序的尾部,即最近文件优先)。 */
  readonly maxFiles: number
  /** 单文件内容估价上限,超出截头若干行并附再读提示。 */
  readonly perFileTokens: number
  /** 附件块总估价上限,装不下的文件整体丢弃。 */
  readonly totalTokens: number
}

/** One rebuilt workspace file for the checkpoint attachment section. */
export interface FileAttachment {
  /** 工具调用里原始路径(不做改写,便于模型对照)。 */
  readonly path: string
  /** 文件内容;失败态(outside-workspace/read-failed)与超限提示场景可缺省。 */
  readonly content?: string
  /** true = 内容为截头。 */
  readonly truncated: boolean
  /**
   * 失败/截断原因:outside-workspace(逃逸只留路径)、read-failed(读失败
   * 只留路径)、too-large(超 perFileTokens,内容为截头+提示)。
   */
  readonly error?: 'too-large' | 'read-failed' | 'outside-workspace'
}

/** 22 号 §5-C11 默认预算 5/5000/50000。 */
export const DEFAULT_ATTACHMENT_BUDGET: AttachmentBudget = deepFreeze({
  maxFiles: 5,
  perFileTokens: 5000,
  totalTokens: 50000,
})

/**
 * 文件类工具名白名单(22 号 §5-C11「初版取 read/file-read/file-write/file-edit
 * 类」;按真实来源核对:dsh-tool-fs 注册 read/write/edit/read_image/apply_patch
 * ——read_image 非文本、apply_patch 无单一路径字段,均排除;golden 真实日志见
 * read_file/write_file 变体)。
 */
export const ATTACHMENT_TOOL_NAMES: ReadonlySet<string> = new Set([
  'read',
  'write',
  'edit',
  'read_file',
  'write_file',
  'edit_file',
  'file-read',
  'file-write',
  'file-edit',
  'readFile',
  'writeFile',
  'editFile',
])

/** arguments 里视为目标路径的字段(dsh-tool-fs read 用 file_path、write/edit 用 path)。 */
const PATH_ARGUMENT_KEYS: readonly string[] = ['path', 'file_path', 'filePath', 'fileName', 'file_name', 'file']

/** checkpoint 附件块标题(22 号 §5-C11 逐字)。 */
const ATTACHMENT_SECTION_TITLE = '## Attached Recent Files (re-read after compaction)'

/** 超单文件预算的截断提示(22 号 §5-C11 逐字)。 */
const TOO_LARGE_HINT = '（内容过大，需要时用 Read 工具重新读取）'

const READ_FAILED_HINT = '（内容读取失败，需要时用 Read 工具重新读取）'

const OUTSIDE_WORKSPACE_HINT = '（路径在工作区外，未读取）'

/** One span-local attachment candidate keyed for last-occurrence dedup. */
interface AttachmentCall {
  readonly rawPath: string
  readonly dedupKey: string
}

/** Fixed-density text price shared with the meter's checkpoint pricing. */
function textTokens(body: string): number {
  return estimateContent([{ type: 'text', text: body }] satisfies ContentBlock[])
}

/** The rendered per-file block body: content when present, else the failure note. */
function attachmentBody(file: FileAttachment): string {
  if (file.content !== undefined) return file.content
  switch (file.error) {
    case 'read-failed': return READ_FAILED_HINT
    case 'outside-workspace': return OUTSIDE_WORKSPACE_HINT
    default: return TOO_LARGE_HINT
  }
}

/** Price of one rendered per-file block, the unit the total budget fills with. */
function attachmentBlockTokens(file: FileAttachment): number {
  return textTokens(`### ${file.path}\n${attachmentBody(file)}`)
}

/** Extract the first present path-like string field from raw tool arguments. */
function extractTargetPath(argumentsJson: string): string | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(argumentsJson)
  } catch {
    return undefined
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined
  const record = parsed as Record<string, unknown>
  for (const key of PATH_ARGUMENT_KEYS) {
    const value = record[key]
    if (typeof value === 'string' && value.trim().length > 0) return value.trim()
  }
  return undefined
}

/**
 * Scan the span's log range for whitelisted `tool/call` events and dedup their
 * target paths by last occurrence (Map re-insert order).
 */
function collectAttachmentCalls(
  session: Session,
  span: { start: SessionSeq; end: SessionSeq },
  workspaceRoot: string,
): AttachmentCall[] {
  const byPath = new Map<string, AttachmentCall>()
  for (let seq: number = span.start; seq <= span.end; seq += 1) {
    // span 端点是现行 surface 节点 seq,区间日志 seq 连续;读法循 region.ts
    // 既有 shadowedSeqs 读法(Existing Session history read; migration deferred)。
    // oxlint-disable-next-line typescript/no-deprecated -- 存量历史读,迁移暂缓(见模块头注)。
    const event = session.eventAt(SessionSeq(seq))
    if (event === undefined || event.type !== 'tool/call') continue
    if (!ATTACHMENT_TOOL_NAMES.has(event.data.name)) continue
    const rawPath = extractTargetPath(event.data.arguments)
    if (rawPath === undefined) continue
    const dedupKey = resolve(workspaceRoot, rawPath)
    // 重复路径按最后出现序去重:删旧插新,Map 保持末次插入序。
    byPath.delete(dedupKey)
    byPath.set(dedupKey, { rawPath, dedupKey })
  }
  return [...byPath.values()]
}

/**
 * Lexical containment of one raw path inside the workspace root. `rel === ''`
 * (the root itself) is inside; reading it fails as a directory. `..`-prefixed
 * file names are not escapes — only a real `..` segment or an absolute
 * remainder is.
 */
function resolveWithinWorkspace(rawPath: string, workspaceRoot: string): string | undefined {
  const absolute = resolve(workspaceRoot, rawPath)
  const rel = relative(workspaceRoot, absolute)
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return undefined
  return absolute
}

/** Keep the leading lines whose rendered price (with the trailing hint) fits the per-file budget. */
function headWithinBudget(content: string, perFileTokens: number): string {
  let head = ''
  for (const line of content.split('\n')) {
    const candidate = head === '' ? line : `${head}\n${line}`
    if (textTokens(`${candidate}\n\n${TOO_LARGE_HINT}`) > perFileTokens) break
    head = candidate
  }
  return head
}

/** Read one deduped call into a FileAttachment, applying containment and budgets. */
function readAttachmentCall(call: AttachmentCall, workspaceRoot: string, budget: AttachmentBudget): FileAttachment {
  const target = resolveWithinWorkspace(call.rawPath, workspaceRoot)
  if (target === undefined) {
    return { path: call.rawPath, truncated: false, error: 'outside-workspace' }
  }
  let content: string
  try {
    content = readFileSync(target, 'utf8')
  } catch {
    return { path: call.rawPath, truncated: false, error: 'read-failed' }
  }
  if (textTokens(content) > budget.perFileTokens) {
    const head = headWithinBudget(content, budget.perFileTokens)
    return {
      path: call.rawPath,
      content: head === '' ? TOO_LARGE_HINT : `${head}\n\n${TOO_LARGE_HINT}`,
      truncated: true,
      error: 'too-large',
    }
  }
  return { path: call.rawPath, content, truncated: false }
}

/**
 * Build the checkpoint attachment list for one compacted span: scan the span's
 * `tool/call` events, dedup by last occurrence, keep the most recent
 * `budget.maxFiles` paths, and read each surviving file inside the workspace
 * boundary under the per-file and total token budgets. No matching calls
 * returns `[]`; failed reads keep their path with the failure identity.
 *
 * 实现为同步求值(非 async;见模块头注)——fs 读在宿主进程内一步完成,
 * Promise 签名仅供 region 的 await 接缝使用。
 *
 * @param session - session whose log the span indexes into.
 * @param span - inclusive surface-node seq range being compacted.
 * @param workspaceRoot - the session workspace root (engine passes `session.header.cwd`).
 * @param budget - file-count and token budgets (defaults: {@link DEFAULT_ATTACHMENT_BUDGET}).
 * @returns attachments in last-occurrence order (most recent last), budgeted.
 */
export function buildCompactionAttachments(
  session: Session,
  span: { start: SessionSeq; end: SessionSeq },
  workspaceRoot: string,
  budget: AttachmentBudget,
): Promise<FileAttachment[]> {
  const calls = collectAttachmentCalls(session, span, workspaceRoot)
  if (calls.length === 0) return Promise.resolve([])
  // maxFiles 取最后出现序的尾部:附件面语义是"最近动过的文件"。
  const selected = calls.slice(-budget.maxFiles)
  const included: FileAttachment[] = []
  let usedTokens = 0
  for (const call of selected) {
    const file = readAttachmentCall(call, workspaceRoot, budget)
    const blockTokens = attachmentBlockTokens(file)
    // 首块恒保留(退化预算配置仍给出可用的再读线索);其后装不下即止。
    if (included.length > 0 && usedTokens + blockTokens > budget.totalTokens) break
    included.push(file)
    usedTokens += blockTokens
  }
  return Promise.resolve(included)
}

/**
 * Render the checkpoint attachment section: `''` for an empty list (no block
 * lands), otherwise the section title followed by one `### <path>` block per
 * file with its content or the failure/truncation note.
 */
export function renderAttachmentSection(attachments: readonly FileAttachment[]): string {
  if (attachments.length === 0) return ''
  const blocks = attachments.map(file => `### ${file.path}\n${attachmentBody(file)}`)
  return `\n\n${ATTACHMENT_SECTION_TITLE}\n${blocks.join('\n\n')}`
}
