/**
 * golden case YAML 加载与 schema 校验。
 *
 * 不引第三方校验器(依赖最小化):手写结构校验,逐字段给出可定位的中文错误。
 * 一个文件一个 case(约定见 README);YAML 解析失败/结构非法 → 抛 SchemaError,
 * runner 把它归入 loadErrors(失败分类 schema),不让单条坏 case 拖垮整包运行。
 */
import { parse as parseYaml } from 'yaml'
import type {
  AcpAdapterConfig,
  AnswerAssert,
  ApprovalFlowAssert,
  ApprovalOutcomeLike,
  BudgetAssert,
  FileAssert,
  FinalStateAssert,
  GoldenCase,
  HttpAssert,
  ReplayAdapterConfig,
  ScriptAssert,
  TrajectoryAssert,
  TrajectoryMode,
} from './types.ts'

/** schema 违例(golden case 文件级;失败分类 schema)。 */
export class SchemaError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SchemaError'
  }
}

const TRAJECTORY_MODES: readonly TrajectoryMode[] = ['strict', 'unordered', 'subset', 'superset']
const APPROVAL_OUTCOMES: readonly ApprovalOutcomeLike[] = ['allowed-once', 'rejected', 'cancelled', 'unavailable']
const CASE_ID_RE = /^[a-z0-9][a-z0-9_-]*$/

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function err(path: string, expect: string, actual: unknown): never {
  throw new SchemaError(`${path} 应为 ${expect},实际: ${JSON.stringify(actual)}`)
}

function requireString(obj: Record<string, unknown>, path: string, field: string): string {
  const value: unknown = obj[field]
  if (typeof value !== 'string' || value.length === 0) err(`${path}.${field}`, '非空字符串', value)
  return value
}

function optionalString(obj: Record<string, unknown>, path: string, field: string): string | undefined {
  const value: unknown = obj[field]
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string') err(`${path}.${field}`, '字符串', value)
  return value
}

function optionalNumber(obj: Record<string, unknown>, path: string, field: string, min: number): number | undefined {
  const value: unknown = obj[field]
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min) {
    err(`${path}.${field}`, `>=${min} 的有限数`, value)
  }
  return value
}

function optionalBoolean(obj: Record<string, unknown>, path: string, field: string): boolean | undefined {
  const value: unknown = obj[field]
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'boolean') err(`${path}.${field}`, '布尔', value)
  return value
}

function optionalStringArray(obj: Record<string, unknown>, path: string, field: string): readonly string[] | undefined {
  const value: unknown = obj[field]
  if (value === undefined || value === null) return undefined
  if (!Array.isArray(value) || value.some((item): item is unknown => typeof item !== 'string' || item.length === 0)) {
    err(`${path}.${field}`, '非空字符串数组', value)
  }
  return value as readonly string[]
}

/** 兼容 exactOptionalPropertyTypes 的可选字段装箱。 */
type Optional<T> = { [K in keyof T]: T[K] | undefined }

function parseAnswerAssert(value: unknown, path: string): AnswerAssert {
  if (!isRecord(value)) err(path, '对象', value)
  const contains = optionalString(value, path, 'contains')
  const match = optionalString(value, path, 'match')
  if (contains === undefined && match === undefined) {
    throw new SchemaError(`${path} 需要 contains 或 match 至少一项`)
  }
  if (match !== undefined) {
    const flags = value.ignore_case === true ? 'i' : ''
    try {
      new RegExp(match, flags)
    } catch (cause) {
      throw new SchemaError(`${path}.match 不是合法正则: ${String(cause)}`)
    }
  }
  const ignoreCase = optionalBoolean(value, path, 'ignore_case')
  const out: Optional<AnswerAssert> = { contains, match, ignore_case: ignoreCase }
  return clean(out)
}

function parseFileAssert(value: unknown, path: string): FileAssert {
  if (!isRecord(value)) err(path, '对象', value)
  const filePath = requireString(value, path, 'path')
  if (filePath.startsWith('/') || filePath.includes('..')) {
    throw new SchemaError(`${path}.path 禁止绝对路径或 .. 逃逸: ${filePath}`)
  }
  const out: Optional<FileAssert> = {
    path: filePath,
    exists: optionalBoolean(value, path, 'exists'),
    contains: optionalString(value, path, 'contains'),
    not_contains: optionalString(value, path, 'not_contains'),
  }
  return clean(out)
}

function parseHttpAssert(value: unknown, path: string): HttpAssert {
  if (!isRecord(value)) err(path, '对象', value)
  const request = value.request
  if (request !== undefined && !isRecord(request)) err(`${path}.request`, '对象', request)
  const respond = value.respond
  if (respond !== undefined && !isRecord(respond)) err(`${path}.respond`, '对象', respond)
  const assertIn = value.assert
  if (assertIn !== undefined && !isRecord(assertIn)) err(`${path}.assert`, '对象', assertIn)
  const requestOut: Optional<HttpAssert['request']> | undefined = request === undefined ? undefined : {
    tool: optionalString(request, `${path}.request`, 'tool'),
    method: optionalString(request, `${path}.request`, 'method'),
    path: optionalString(request, `${path}.request`, 'path'),
    body_contains: optionalString(request, `${path}.request`, 'body_contains'),
  }
  const respondOut: Optional<NonNullable<HttpAssert['respond']>> | undefined = respond === undefined ? undefined : {
    status: optionalNumber(respond, `${path}.respond`, 'status', 100),
    body: optionalString(respond, `${path}.respond`, 'body'),
  }
  const assertOut: Optional<NonNullable<HttpAssert['assert']>> | undefined = assertIn === undefined ? undefined : {
    status: optionalNumber(assertIn, `${path}.assert`, 'status', 100),
    body_contains: optionalString(assertIn, `${path}.assert`, 'body_contains'),
  }
  const out: Optional<HttpAssert> = {
    request: requestOut === undefined ? undefined : clean(requestOut),
    respond: respondOut === undefined ? undefined : clean(respondOut),
    assert: assertOut === undefined ? undefined : clean(assertOut),
  }
  return clean(out)
}

function parseScriptAssert(value: unknown, path: string): ScriptAssert {
  if (!isRecord(value)) err(path, '对象', value)
  const out: Optional<ScriptAssert> = {
    command: requireString(value, path, 'command'),
    stdout_contains: optionalString(value, path, 'stdout_contains'),
  }
  return clean(out)
}

function parseFinalState(value: unknown, path: string): readonly FinalStateAssert[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) err(path, '数组', value)
  return value.map((item, index): FinalStateAssert => {
    const itemPath = `${path}[${index}]`
    if (!isRecord(item)) err(itemPath, '对象', item)
    const keys = Object.keys(item)
    if (keys.length !== 1) {
      throw new SchemaError(`${itemPath} 应恰好一个键(file_assert|http_assert|script),实际: ${keys.join(',')}`)
    }
    const key = keys[0] ?? ''
    if (key === 'file_assert') return { file_assert: parseFileAssert(item[key], `${itemPath}.file_assert`) }
    if (key === 'http_assert') return { http_assert: parseHttpAssert(item[key], `${itemPath}.http_assert`) }
    if (key === 'script') return { script: parseScriptAssert(item[key], `${itemPath}.script`) }
    throw new SchemaError(`${itemPath} 的键应为 file_assert|http_assert|script,实际: ${key}`)
  })
}

function parseApprovalFlow(value: unknown, path: string): ApprovalFlowAssert {
  if (!isRecord(value)) err(path, '对象', value)
  const outcome = optionalString(value, path, 'outcome')
  if (outcome !== undefined && !APPROVAL_OUTCOMES.includes(outcome as ApprovalOutcomeLike)) {
    throw new SchemaError(`${path}.outcome 应为 ${APPROVAL_OUTCOMES.join('|')} 之一,实际: ${outcome}`)
  }
  const out: Optional<ApprovalFlowAssert> = {
    tool: optionalString(value, path, 'tool'),
    outcome: outcome as ApprovalOutcomeLike | undefined,
    not_executed: optionalBoolean(value, path, 'not_executed'),
    min_count: optionalNumber(value, path, 'min_count', 1),
  }
  return clean(out)
}

function parseTrajectory(value: unknown, path: string): TrajectoryAssert {
  if (!isRecord(value)) err(path, '对象', value)
  const mode = optionalString(value, path, 'mode')
  if (mode !== undefined && !TRAJECTORY_MODES.includes(mode as TrajectoryMode)) {
    throw new SchemaError(`${path}.mode 应为 ${TRAJECTORY_MODES.join('|')} 之一,实际: ${mode}`)
  }
  const approvalIn = value.approval_flow
  const out: Optional<TrajectoryAssert> = {
    mode: mode as TrajectoryMode | undefined,
    calls: optionalStringArray(value, path, 'calls'),
    must_call: optionalStringArray(value, path, 'must_call'),
    must_not_call: optionalStringArray(value, path, 'must_not_call'),
    max_steps: optionalNumber(value, path, 'max_steps', 0),
    approval_flow: approvalIn === undefined || approvalIn === null ? undefined : parseApprovalFlow(approvalIn, `${path}.approval_flow`),
  }
  if (out.mode !== undefined && out.mode !== 'subset' && out.calls === undefined) {
    throw new SchemaError(`${path}.mode=${out.mode} 需要 calls 提供期望序列`)
  }
  return clean(out)
}

function parseBudget(value: unknown, path: string): BudgetAssert {
  if (!isRecord(value)) err(path, '对象', value)
  const out: Optional<BudgetAssert> = {
    max_turns: optionalNumber(value, path, 'max_turns', 0),
    max_tokens: optionalNumber(value, path, 'max_tokens', 0),
  }
  return clean(out)
}

function parseReplay(value: unknown, path: string): ReplayAdapterConfig {
  if (!isRecord(value)) err(path, '对象', value)
  const out: Optional<ReplayAdapterConfig> = { fixture: optionalString(value, path, 'fixture') }
  return clean(out)
}

function parseAcp(value: unknown, path: string): AcpAdapterConfig {
  if (!isRecord(value)) err(path, '对象', value)
  const out: Optional<AcpAdapterConfig> = {
    dsh_home: optionalString(value, path, 'dsh_home'),
    provider: optionalString(value, path, 'provider'),
    model: optionalString(value, path, 'model'),
    reasoning_effort: optionalString(value, path, 'reasoning_effort'),
    max_tokens: optionalNumber(value, path, 'max_tokens', 1),
    timeout_seconds: optionalNumber(value, path, 'timeout_seconds', 1),
  }
  return clean(out)
}

function clean<T extends object>(obj: Optional<T>): T {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) out[key] = value
  }
  return out as T
}

/** 解析单个 golden case 的 YAML 文本。 */
export function parseGoldenCase(text: string, sourceFile: string): GoldenCase {
  let doc: unknown
  try {
    doc = parseYaml(text)
  } catch (cause) {
    throw new SchemaError(`${sourceFile}: YAML 解析失败: ${String(cause)}`)
  }
  if (!isRecord(doc)) err(sourceFile, '对象(映射)', doc)
  const id = requireString(doc, sourceFile, 'id')
  if (!CASE_ID_RE.test(id)) {
    throw new SchemaError(`${sourceFile}.id 需匹配 ${CASE_ID_RE},实际: ${id}`)
  }
  const adapter = optionalString(doc, sourceFile, 'adapter')
  if (adapter !== undefined && adapter !== 'replay' && adapter !== 'acp') {
    throw new SchemaError(`${sourceFile}.adapter 应为 replay|acp,实际: ${adapter}`)
  }
  const answerIn = doc.answer
  const replayIn = doc.replay
  const acpIn = doc.acp
  const out: Optional<Omit<GoldenCase, 'sourceFile'>> = {
    id,
    description: optionalString(doc, sourceFile, 'description'),
    user_input: requireString(doc, sourceFile, 'user_input'),
    answer: answerIn === undefined || answerIn === null ? undefined : parseAnswerAssert(answerIn, `${sourceFile}.answer`),
    tags: optionalStringArray(doc, sourceFile, 'tags') ?? [],
    final_state: parseFinalState(doc.final_state, `${sourceFile}.final_state`),
    trajectory: doc.trajectory === undefined || doc.trajectory === null ? undefined : parseTrajectory(doc.trajectory, `${sourceFile}.trajectory`),
    budget: doc.budget === undefined || doc.budget === null ? undefined : parseBudget(doc.budget, `${sourceFile}.budget`),
    adapter,
    replay: replayIn === undefined || replayIn === null ? undefined : parseReplay(replayIn, `${sourceFile}.replay`),
    acp: acpIn === undefined || acpIn === null ? undefined : parseAcp(acpIn, `${sourceFile}.acp`),
  }
  return { ...clean(out), sourceFile }
}

/** packctl(06 号模板)放在 evals/ 根、但不是 golden case 的已知文件名。 */
const NON_CASE_EVALS_FILES = new Set(['threshold.yml'])

function isYamlName(name: string): boolean {
  return name.endsWith('.yaml') || name.endsWith('.yml')
}

/** 从磁盘加载一个 pack 目录下的全部 golden case。
 * 约定(两种目录形态都支持):
 * - 平铺形态:`<pack>/evals/*.{yaml,yml}` 一文件一 case;
 * - packctl 06 号模板形态:`<pack>/evals/golden/*.{yaml,yml}`(threshold.yml 是门禁阈值配置,
 *   不是 case,跳过)。
 * 返回 (cases, loadErrors)。 */
export async function loadPackCases(packDir: string): Promise<{
  cases: GoldenCase[]
  loadErrors: { file: string; message: string }[]
}> {
  const evalsDir = joinPath(packDir, 'evals')
  let entries: string[]
  try {
    entries = await readDir(evalsDir)
  } catch (cause) {
    return { cases: [], loadErrors: [{ file: evalsDir, message: `无法读取 pack evals 目录: ${String(cause)}` }] }
  }
  const yamlFiles = entries
    .filter(name => isYamlName(name) && !NON_CASE_EVALS_FILES.has(name))
    .sort()
  // packctl 模板形态:golden/ 子目录(T6 packs/event-planning 起);无则跳过。
  const goldenDir = joinPath(evalsDir, 'golden')
  try {
    const goldenEntries = await readDir(goldenDir)
    for (const name of goldenEntries.filter(isYamlName).sort()) {
      yamlFiles.push(`golden/${name}`)
    }
  } catch {
    // 无 golden/ 子目录:平铺形态,非错误。
  }
  const cases: GoldenCase[] = []
  const loadErrors: { file: string; message: string }[] = []
  for (const name of yamlFiles) {
    const file = joinPath(evalsDir, name)
    try {
      const text = await readFile(file)
      cases.push(parseGoldenCase(text, file))
    } catch (cause) {
      const message = cause instanceof SchemaError ? cause.message : `${file}: 加载失败: ${String(cause)}`
      loadErrors.push({ file, message })
    }
  }
  const ids = new Set<string>()
  for (const caseData of cases) {
    if (ids.has(caseData.id)) {
      loadErrors.push({ file: caseData.sourceFile, message: `case id 重复: ${caseData.id}` })
    }
    ids.add(caseData.id)
  }
  return { cases: cases.filter(caseData => !loadErrors.some(error => error.file === caseData.sourceFile)), loadErrors }
}

// ---- 极薄 fs 封装(便于测试注入;coeffect 全声明:本模块只经参数与 node:fs 触达外界) ----

export interface FsPort {
  readFile(path: string): Promise<string>
  readDir(path: string): Promise<string[]>
}

const nodeFs: FsPort = {
  async readFile(path) {
    const { readFile } = await import('node:fs/promises')
    return readFile(path, 'utf8')
  },
  async readDir(path) {
    const { readdir } = await import('node:fs/promises')
    return readdir(path)
  },
}

let fsPort: FsPort = nodeFs

/** 测试注入点:替换文件读取实现。 */
export function setFsPort(port: FsPort): void {
  fsPort = port
}

function readFile(path: string): Promise<string> {
  return fsPort.readFile(path)
}

function readDir(path: string): Promise<string[]> {
  return fsPort.readDir(path)
}

function joinPath(dir: string, name: string): string {
  return dir.endsWith('/') ? `${dir}${name}` : `${dir}/${name}`
}
