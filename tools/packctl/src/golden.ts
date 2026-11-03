/**
 * golden case 加载器(07 号文档 §3.2 字段口径;与 ai-evo Excel/终态校验器/轨迹断言同源)。
 *
 * 双重身份:
 * 1. pack lint 用 validateGoldenCase 校验 `evals/golden/` 非空且可加载(GOLD0xx);
 * 2. 直接导出 loadGoldenCase/loadGoldenDir 供 @basis/evals(T4)消费 —— 「可被 evals 加载」
 *    的判定即本模块本身,避免两套解析器漂移。
 *
 * 双形态口径(T6 落地时与 @basis/evals schema.ts 对齐钉住,两类文件都合法):
 * - 模板形态(pack init):final_state 单断言映射 / approval_flow 字符串数组 / answer 字符串;
 * - 条目形态(@basis/evals 可执行,字段对齐 ai-evo):final_state 单键条目数组 /
 *   approval_flow {tool,outcome,not_executed,min_count}(审批红线断言) /
 *   answer {contains|match}。评测执行走 @basis/evals runner,消费条目形态。
 */
import { basename, join } from 'node:path'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { asStringArray, isRecord, parseYaml } from './util.ts'
import { error, warning } from './types.ts'
import type {
  Finding,
  GoldenAnswerAssert,
  GoldenBudget,
  GoldenCase,
  GoldenFinalState,
  GoldenFinalStateEntry,
  GoldenJudge,
  GoldenTrajectory,
} from './types.ts'

const GOLDEN_EXT = /\.(ya?ml)$/i

/** 单条 golden case 的严格加载:返回规范形态,或带 issues 的错误。 */
export function loadGoldenCaseText(text: string, relPath: string): { case?: GoldenCase; issues: readonly Finding[] } {
  const issues: Finding[] = []
  const parsed = parseYaml(text)
  if (!parsed.ok || !isRecord(parsed.value)) {
    return { issues: [error('GOLD002', relPath, `YAML 解析失败: ${parsed.ok ? '顶层不是映射' : parsed.error ?? ''}`)] }
  }
  const raw = parsed.value

  const id = raw.id
  if (typeof id !== 'string' || id.length === 0) {
    issues.push(error('GOLD003', relPath, '缺少必需字段 id(非空字符串)'))
  }
  const userInput = raw.user_input
  if (typeof userInput !== 'string' || userInput.trim().length === 0) {
    issues.push(error('GOLD003', relPath, '缺少必需字段 user_input(非空字符串)'))
  }

  const stem = basename(relPath).replace(GOLDEN_EXT, '')
  if (typeof id === 'string' && id !== stem) {
    issues.push(error('GOLD004', relPath, `id "${id}" 与文件名 "${stem}" 不一致(评测器按文件定位,必须相等)`))
  }

  const finalState = validateFinalState(raw.final_state, relPath, issues)
  const trajectory = validateTrajectory(raw.trajectory, relPath, issues)

  if (raw.tags !== undefined && asStringArray(raw.tags) === undefined) {
    issues.push(error('GOLD005', relPath, 'tags 必须是字符串数组'))
  }
  validateAnswer(raw.answer, relPath, issues)
  if (raw.judge !== undefined && (!isRecord(raw.judge) || typeof raw.judge.rubric !== 'string')) {
    issues.push(error('GOLD005', relPath, 'judge 必须是 { rubric: string }'))
  }
  if (finalState === undefined && trajectory === undefined && raw.judge === undefined) {
    issues.push(warning('GOLD006', relPath, 'final_state/trajectory/judge 全空:该 case 无任何可判定断言(终态优先原则,07 号文档 §1)'))
  }

  if (issues.some(i => i.severity === 'error')) return { issues }

  const extra: Record<string, unknown> = {}
  for (const key of Object.keys(raw)) {
    if (!['id', 'user_input', 'answer', 'tags', 'final_state', 'trajectory', 'budget', 'judge'].includes(key)) {
      extra[key] = raw[key]
    }
  }
  const tags = asStringArray(raw.tags)
  const budget = isRecord(raw.budget) ? { budget: raw.budget as unknown as GoldenBudget } : {}
  const judge = isRecord(raw.judge) && typeof raw.judge.rubric === 'string'
    ? { judge: raw.judge as unknown as GoldenJudge }
    : {}
  const golden: GoldenCase = {
    id: id as string,
    user_input: userInput as string,
    ...(raw.answer !== undefined ? { answer: raw.answer as string | GoldenAnswerAssert } : {}),
    ...(tags !== undefined ? { tags } : {}),
    ...(finalState !== undefined ? { final_state: finalState } : {}),
    ...(trajectory !== undefined ? { trajectory } : {}),
    ...budget,
    ...judge,
    ...(Object.keys(extra).length > 0 ? { extra } : {}),
  }
  return { case: golden, issues }
}

/** answer 双形态:字符串(模板形态)或 {contains|match}(条目形态,@basis/evals AnswerAssert)。 */
function validateAnswer(value: unknown, relPath: string, issues: Finding[]): void {
  if (value === undefined) return
  if (typeof value === 'string') return
  if (!isRecord(value)) {
    issues.push(error('GOLD005', relPath, 'answer 必须是字符串或 { contains | match } 映射'))
    return
  }
  const hasContains = typeof value.contains === 'string'
  const hasMatch = typeof value.match === 'string'
  if (!hasContains && !hasMatch) {
    issues.push(error('GOLD005', relPath, 'answer 映射必须含 contains 或 match 之一(字符串)'))
  }
  if (value.ignore_case !== undefined && typeof value.ignore_case !== 'boolean') {
    issues.push(error('GOLD005', relPath, 'answer.ignore_case 必须是布尔'))
  }
}

/**
 * final_state 双形态:
 * - 映射形态(模板):{ file_assert | http_assert | db_assert | script } 至少一项;
 * - 条目形态(@basis/evals / ai-evo 可执行口径):单键条目数组,顺序执行。
 */
function validateFinalState(
  value: unknown,
  relPath: string,
  issues: Finding[],
): GoldenFinalState | readonly GoldenFinalStateEntry[] | undefined {
  if (value === undefined) return undefined
  if (Array.isArray(value)) {
    if (value.length === 0) {
      issues.push(error('GOLD005', relPath, 'final_state 条目数组不能为空(至少一个断言)'))
      return undefined
    }
    const entries: GoldenFinalStateEntry[] = []
    value.forEach((item, index) => {
      const at = `${relPath} final_state[${String(index)}]`
      if (!isRecord(item) || Object.keys(item).length !== 1) {
        issues.push(error('GOLD005', at, 'final_state 条目必须恰好一个键(file_assert|http_assert|script)'))
        return
      }
      const key = Object.keys(item)[0] ?? ''
      const inner = item[key]
      if (key === 'file_assert') {
        validateFileAssert(inner, at, issues)
        entries.push({ file_assert: inner } as GoldenFinalStateEntry)
      } else if (key === 'http_assert') {
        validateHttpAssert(inner, at, issues)
        entries.push({ http_assert: inner } as GoldenFinalStateEntry)
      } else if (key === 'script') {
        validateScriptAssert(inner, at, issues)
        entries.push({ script: inner } as GoldenFinalStateEntry)
      } else {
        issues.push(error('GOLD005', at, `final_state 条目键应为 file_assert|http_assert|script,实际: ${key}`))
      }
    })
    return entries
  }
  if (!isRecord(value)) {
    issues.push(error('GOLD005', relPath, 'final_state 必须是映射或单键条目数组'))
    return undefined
  }
  const fileAssert = value.file_assert
  if (fileAssert !== undefined) {
    validateFileAssert(fileAssert, `${relPath} final_state.file_assert`, issues)
  }
  const httpAssert = value.http_assert
  if (httpAssert !== undefined) {
    validateHttpAssert(httpAssert, `${relPath} final_state.http_assert`, issues)
  }
  const script = value.script
  if (script !== undefined) {
    validateScriptAssert(script, `${relPath} final_state.script`, issues)
  }
  const hasAny = ['file_assert', 'http_assert', 'db_assert', 'script'].some(k => value[k] !== undefined)
  if (!hasAny) {
    issues.push(error('GOLD005', relPath, 'final_state 至少要有一个断言(file_assert/http_assert/db_assert/script)'))
  }
  return value
}

/** file_assert:双口径 contains(数组=模板形态 / 字符串=条目形态)都接受,path 必填。 */
function validateFileAssert(value: unknown, at: string, issues: Finding[]): void {
  if (!isRecord(value) || typeof value.path !== 'string' || value.path.length === 0) {
    issues.push(error('GOLD005', at, 'file_assert 必须是 { path: string, contains?: string | string[] }'))
    return
  }
  if (value.contains !== undefined && typeof value.contains !== 'string' && !asStringArray(value.contains)) {
    issues.push(error('GOLD005', at, 'file_assert.contains 必须是字符串或字符串数组'))
  }
  if (value.not_contains !== undefined && typeof value.not_contains !== 'string') {
    issues.push(error('GOLD005', at, 'file_assert.not_contains 必须是字符串'))
  }
  if (value.exists !== undefined && typeof value.exists !== 'boolean') {
    issues.push(error('GOLD005', at, 'file_assert.exists 必须是布尔'))
  }
}

/** http_assert:url(模板形态)或 request/respond/assert(@basis/evals HttpAssert)任一形态。 */
function validateHttpAssert(value: unknown, at: string, issues: Finding[]): void {
  if (!isRecord(value)) {
    issues.push(error('GOLD005', at, 'http_assert 必须是映射'))
    return
  }
  const hasUrl = typeof value.url === 'string'
  const hasT4Shape = ['request', 'respond', 'assert'].some(k => value[k] !== undefined)
  if (!hasUrl && !hasT4Shape) {
    issues.push(error('GOLD005', at, 'http_assert 必须是 { url, ... }(模板形态)或 { request|respond|assert }(@basis/evals 形态)'))
  }
  for (const key of ['request', 'respond', 'assert'] as const) {
    if (value[key] !== undefined && !isRecord(value[key])) {
      issues.push(error('GOLD005', at, `http_assert.${key} 必须是映射`))
    }
  }
  if (value.expect_status !== undefined && typeof value.expect_status !== 'number') {
    issues.push(error('GOLD005', at, 'http_assert.expect_status 必须是数字'))
  }
}

function validateScriptAssert(value: unknown, at: string, issues: Finding[]): void {
  if (!isRecord(value) || typeof value.command !== 'string' || value.command.length === 0) {
    issues.push(error('GOLD005', at, 'script 必须是 { command: string, expect_exit?: number }'))
    return
  }
  if (value.expect_exit !== undefined && typeof value.expect_exit !== 'number') {
    issues.push(error('GOLD005', at, 'script.expect_exit 必须是数字'))
  }
  if (value.stdout_contains !== undefined && typeof value.stdout_contains !== 'string') {
    issues.push(error('GOLD005', at, 'script.stdout_contains 必须是字符串'))
  }
}

const APPROVAL_OUTCOMES = ['allowed-once', 'rejected', 'cancelled', 'unavailable'] as const

/**
 * trajectory 双形态:
 * - approval_flow:字符串数组(模板形态)或 { tool, outcome, not_executed, min_count }
 *   (@basis/evals ApprovalFlowAssert,审批红线案例的可执行形态);
 * - calls/must_call/must_not_call:字符串数组;mode 四模式;max_steps 正数。
 */
function validateTrajectory(value: unknown, relPath: string, issues: Finding[]): GoldenTrajectory | undefined {
  if (value === undefined) return undefined
  if (!isRecord(value)) {
    issues.push(error('GOLD005', relPath, 'trajectory 必须是映射'))
    return undefined
  }
  for (const key of ['calls', 'must_call', 'must_not_call'] as const) {
    const v = value[key]
    if (v !== undefined && asStringArray(v) === undefined) {
      issues.push(error('GOLD005', relPath, `trajectory.${key} 必须是字符串数组`))
    }
  }
  const approval = value.approval_flow
  if (approval !== undefined) {
    if (Array.isArray(approval)) {
      if (asStringArray(approval) === undefined) {
        issues.push(error('GOLD005', relPath, 'trajectory.approval_flow 必须是字符串数组或 { tool, outcome, not_executed, min_count } 映射'))
      }
    } else if (isRecord(approval)) {
      if (approval.tool !== undefined && typeof approval.tool !== 'string') {
        issues.push(error('GOLD005', relPath, 'trajectory.approval_flow.tool 必须是字符串'))
      }
      if (approval.outcome !== undefined
        && (typeof approval.outcome !== 'string' || !APPROVAL_OUTCOMES.includes(approval.outcome as typeof APPROVAL_OUTCOMES[number]))) {
        issues.push(error('GOLD005', relPath, `trajectory.approval_flow.outcome 必须是 ${APPROVAL_OUTCOMES.join('|')} 之一(对齐 DSH approval/decided)`))
      }
      if (approval.not_executed !== undefined && typeof approval.not_executed !== 'boolean') {
        issues.push(error('GOLD005', relPath, 'trajectory.approval_flow.not_executed 必须是布尔'))
      }
      if (approval.min_count !== undefined && (typeof approval.min_count !== 'number' || approval.min_count < 1)) {
        issues.push(error('GOLD005', relPath, 'trajectory.approval_flow.min_count 必须是 >=1 的数'))
      }
    } else {
      issues.push(error('GOLD005', relPath, 'trajectory.approval_flow 必须是字符串数组或 { tool, outcome, not_executed, min_count } 映射'))
    }
  }
  if (value.max_steps !== undefined && (typeof value.max_steps !== 'number' || value.max_steps <= 0)) {
    issues.push(error('GOLD005', relPath, 'trajectory.max_steps 必须是正数'))
  }
  const mode = value.mode
  if (mode !== undefined && (typeof mode !== 'string' || !['strict', 'unordered', 'subset', 'superset'].includes(mode))) {
    issues.push(error('GOLD005', relPath, 'trajectory.mode 必须是 strict/unordered/subset/superset(对齐 ai-evo 四模式)'))
  }
  return value
}

// ── 目录级加载(lint 与 evals 共用)─────────────────────────────────────────

export interface GoldenDirResult {
  readonly cases: readonly GoldenCase[]
  readonly findings: readonly Finding[]
}

/**
 * 加载 evals/golden/ 下全部 *.yaml|*.yml:
 * - 目录缺失/为空 → GOLD001 error(06 号模板要求 golden 目录非空);
 * - 单文件解析/字段错误 → GOLD002-GOLD005;
 * - id 跨文件重复 → GOLD007(id 是评测与回灌的关联键)。
 */
export function loadGoldenDir(goldenDir: string, relBase: string): GoldenDirResult {
  const findings: Finding[] = []
  if (!existsSync(goldenDir)) {
    return { cases: [], findings: [error('GOLD001', `${relBase}/`, 'evals/golden/ 目录不存在')] }
  }
  const files = readdirSync(goldenDir).filter(f => GOLDEN_EXT.test(f)).sort()
  if (files.length === 0) {
    return { cases: [], findings: [error('GOLD001', `${relBase}/`, 'evals/golden/ 目录为空(至少 1 条 golden case)')] }
  }
  const cases: GoldenCase[] = []
  const seen = new Map<string, string>()
  for (const file of files) {
    const relPath = `${relBase}/${file}`
    const text = readFileSync(join(goldenDir, file), 'utf8')
    const loaded = loadGoldenCaseText(text, relPath)
    findings.push(...loaded.issues)
    const goldenCase = loaded.case
    if (goldenCase) {
      const dupOf = seen.get(goldenCase.id)
      if (dupOf !== undefined) {
        findings.push(error('GOLD007', relPath, `id "${goldenCase.id}" 与 ${dupOf} 重复`))
      } else {
        seen.set(goldenCase.id, relPath)
      }
      cases.push(goldenCase)
    }
  }
  return { cases, findings }
}
