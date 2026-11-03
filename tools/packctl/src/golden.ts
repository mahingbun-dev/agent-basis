/**
 * golden case 加载器(07 号文档 §3.2 字段口径;与 ai-evo Excel/终态校验器/轨迹断言同源)。
 *
 * 双重身份:
 * 1. pack lint 用 validateGoldenCase 校验 `evals/golden/` 非空且可加载(GOLD0xx);
 * 2. 直接导出 loadGoldenCase/loadGoldenDir 供 @basis/evals(T4)消费 —— 「可被 evals 加载」
 *    的判定即本模块本身,避免两套解析器漂移。
 */
import { basename, join } from 'node:path'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { asStringArray, isRecord, parseYaml } from './util.ts'
import { error, warning } from './types.ts'
import type { Finding, GoldenBudget, GoldenCase, GoldenFinalState, GoldenJudge, GoldenTrajectory } from './types.ts'

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
  if (raw.answer !== undefined && typeof raw.answer !== 'string') {
    issues.push(error('GOLD005', relPath, 'answer 必须是字符串'))
  }
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
    ...(typeof raw.answer === 'string' ? { answer: raw.answer } : {}),
    ...(tags !== undefined ? { tags } : {}),
    ...(finalState !== undefined ? { final_state: finalState } : {}),
    ...(trajectory !== undefined ? { trajectory } : {}),
    ...budget,
    ...judge,
    ...(Object.keys(extra).length > 0 ? { extra } : {}),
  }
  return { case: golden, issues }
}

function validateFinalState(value: unknown, relPath: string, issues: Finding[]): GoldenFinalState | undefined {
  if (value === undefined) return undefined
  if (!isRecord(value)) {
    issues.push(error('GOLD005', relPath, 'final_state 必须是映射'))
    return undefined
  }
  const fileAssert = value.file_assert
  if (fileAssert !== undefined) {
    if (!isRecord(fileAssert) || typeof fileAssert.path !== 'string') {
      issues.push(error('GOLD005', relPath, 'final_state.file_assert 必须是 { path: string, contains?: string[] }'))
    }
  }
  const httpAssert = value.http_assert
  if (httpAssert !== undefined && (!isRecord(httpAssert) || typeof httpAssert.url !== 'string')) {
    issues.push(error('GOLD005', relPath, 'final_state.http_assert 必须是 { url: string, ... }'))
  }
  const script = value.script
  if (script !== undefined && (!isRecord(script) || typeof script.command !== 'string')) {
    issues.push(error('GOLD005', relPath, 'final_state.script 必须是 { command: string, expect_exit?: number }'))
  }
  const hasAny = ['file_assert', 'http_assert', 'db_assert', 'script'].some(k => value[k] !== undefined)
  if (!hasAny) {
    issues.push(error('GOLD005', relPath, 'final_state 至少要有一个断言(file_assert/http_assert/db_assert/script)'))
  }
  return value
}

function validateTrajectory(value: unknown, relPath: string, issues: Finding[]): GoldenTrajectory | undefined {
  if (value === undefined) return undefined
  if (!isRecord(value)) {
    issues.push(error('GOLD005', relPath, 'trajectory 必须是映射'))
    return undefined
  }
  for (const key of ['must_call', 'must_not_call', 'approval_flow'] as const) {
    const v = value[key]
    if (v !== undefined && asStringArray(v) === undefined) {
      issues.push(error('GOLD005', relPath, `trajectory.${key} 必须是字符串数组`))
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
