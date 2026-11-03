/**
 * replay 适配器:读 fixture session jsonl,回放事件执行断言。
 *
 * fixture 约定(`<pack>/fixtures/<case-id>.jsonl`,可用 case.replay.fixture 覆盖):
 * - 每行一个 JSON:DSH SessionEvent 形态 `{ type, seq, time, data }`
 *   (packages/core/session/src/types.ts:504-518),或
 *   `plugin:` 前缀的实验插件记录(types.ts:546-566);
 * - `plugin:basis-evals/workspace` 记录携带终态文件快照
 *   `{ files: { <相对路径>: <内容> } }`,回放时物化进 case 工作区,
 *   供 file_assert / script 断言查验——回放模式因此有真实终态可评。
 */
import * as path from 'node:path'
import type { AgentAdapter, AgentRunInput, AgentRunResult, PluginRecordLike, SessionEventLike } from '../types.ts'
import { summarize } from '../events.ts'

export const WORKSPACE_RECORD_TYPE = 'plugin:basis-evals/workspace'

function parseLine(line: string, file: string, lineNo: number): SessionEventLike | PluginRecordLike {
  let parsed: unknown
  try {
    parsed = JSON.parse(line)
  } catch {
    throw new Error(`${file}:${lineNo}: 不是合法 JSON`)
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${file}:${lineNo}: 应为对象,实际 ${JSON.stringify(parsed)}`)
  }
  const record = parsed as Record<string, unknown>
  const type = typeof record.type === 'string' ? record.type : undefined
  const seq = typeof record.seq === 'number' ? record.seq : undefined
  const time = typeof record.time === 'number' ? record.time : undefined
  if (type === undefined || seq === undefined || time === undefined) {
    throw new Error(`${file}:${lineNo}: 缺少 type/seq/time 字段(DSH SessionEvent 形态)`)
  }
  if (type.startsWith('plugin:')) {
    return { type: type as `plugin:${string}`, seq, time, data: record.data }
  }
  const base: SessionEventLike = { type, seq, time, data: record.data }
  return record.ignorable === true ? { ...base, ignorable: true } : base
}

function workspaceFilesOf(records: readonly PluginRecordLike[], file: string): Map<string, string> {
  const files = new Map<string, string>()
  for (const record of records) {
    if (record.type !== WORKSPACE_RECORD_TYPE) continue
    const data = record.data
    if (typeof data !== 'object' || data === null || Array.isArray(data)) {
      throw new Error(`${file}: ${WORKSPACE_RECORD_TYPE} 记录的 data 应为 { files: {...} }`)
    }
    const filesField = (data as Record<string, unknown>).files
    if (typeof filesField !== 'object' || filesField === null || Array.isArray(filesField)) {
      throw new Error(`${file}: ${WORKSPACE_RECORD_TYPE} 记录缺少 files 映射`)
    }
    for (const [rel, content] of Object.entries(filesField as Record<string, unknown>)) {
      if (typeof content !== 'string') {
        throw new Error(`${file}: ${WORKSPACE_RECORD_TYPE}.files[${rel}] 应为字符串内容`)
      }
      files.set(rel, content)
    }
  }
  return files
}

export class ReplayAdapter implements AgentAdapter {
  readonly id = 'replay'

  async run(input: AgentRunInput): Promise<AgentRunResult> {
    const fixtureRel = input.caseData.replay?.fixture ?? `fixtures/${input.caseData.id}.jsonl`
    const fixture = path.isAbsolute(fixtureRel) ? fixtureRel : path.join(input.packDir, fixtureRel)
    let text: string
    try {
      text = await readFile(fixture)
    } catch (cause) {
      throw new Error(`replay: fixture 不可读(${fixture}): ${String(cause)}`)
    }
    const events: SessionEventLike[] = []
    const pluginRecords: PluginRecordLike[] = []
    const lines = text.split('\n')
    for (const [index, line] of lines.entries()) {
      const trimmed = line.trim()
      if (trimmed.length === 0) continue
      const parsed = parseLine(trimmed, fixture, index + 1)
      if (parsed.type.startsWith('plugin:')) pluginRecords.push(parsed as PluginRecordLike)
      else events.push(parsed)
    }
    if (events.length === 0) {
      throw new Error(`replay: fixture 无会话事件(${fixture})`)
    }
    const workspaceFiles = workspaceFilesOf(pluginRecords, fixture)
    await materializeWorkspace(input.workspaceDir, workspaceFiles)
    const summary = summarize(events)
    return {
      sessionRef: fixture,
      events,
      finalAnswerText: summary.finalAnswerText,
      notes: workspaceFiles.size === 0 ? [] : [`物化终态文件 ${workspaceFiles.size} 个(来自 ${WORKSPACE_RECORD_TYPE} 记录)`],
    }
  }
}

async function materializeWorkspace(workspaceDir: string, files: Map<string, string>): Promise<void> {
  const { mkdir, writeFile } = await import('node:fs/promises')
  for (const [rel, content] of files) {
    const target = path.resolve(workspaceDir, rel)
    const root = path.resolve(workspaceDir)
    if (target !== root && !target.startsWith(`${root}${path.sep}`)) {
      throw new Error(`replay: 终态文件路径逃逸工作区: ${rel}`)
    }
    await mkdir(path.dirname(target), { recursive: true })
    await writeFile(target, content, 'utf8')
  }
}

async function readFile(file: string): Promise<string> {
  const { readFile } = await import('node:fs/promises')
  return readFile(file, 'utf8')
}
