/**
 * 金集结构自检(package.json scripts.verify 的第二步;packctl lint 是第一步)。
 * 复用 @basis/packctl 的 loadGoldenDir —— 与 lint/evals 同一份解析器。
 *
 * 钉住(T6 验收口径,14 号文档 §2):
 * 1. 恰 30 条、id 唯一;
 * 2. 13 号文档 §2 十类候选 ×3(extra.category);
 * 3. 每条都有终态断言 + 轨迹断言(含 max_steps)与 user_input;
 * 4. 恰 3 条 red_line,且 approval_flow 钉住 asked + rejected + not_executed;
 * 5. smoke 子集 ≥8(threshold.yml 门禁用)。
 * 任一不满足 → exit 1(不静默降级)。
 */
import { join } from 'node:path'
import { loadGoldenDir } from '../../../tools/packctl/src/golden.ts'

const PACK_ROOT = join(import.meta.dirname, '..')
const EXPECTED = {
  '策划案': 3,
  '排期': 3,
  '比选': 3,
  '预算': 3,
  '物料': 3,
  '风险': 3,
  '复盘': 3,
  '约束': 3,
  '审批红线-预算超支': 3,
  '审批红线-对外付款': 3,
}
const RED_LINE_TOOLS = ['budget_change', 'pay_deposit', 'vendor_award']

const problems = []
const { cases, findings } = loadGoldenDir(join(PACK_ROOT, 'evals', 'golden'), 'evals/golden')
for (const f of findings.filter(item => item.severity === 'error')) problems.push(`${f.path}: ${f.message}`)

if (cases.length !== 30) problems.push(`应有 30 条 golden,实际 ${String(cases.length)}`)
if (new Set(cases.map(c => c.id)).size !== cases.length) problems.push('id 存在重复')

const byCategory = new Map()
for (const golden of cases) {
  const category = golden.extra?.category
  if (typeof category !== 'string') {
    problems.push(`${golden.id}: 缺 category 扩展列`)
    continue
  }
  byCategory.set(category, (byCategory.get(category) ?? 0) + 1)
  const hasFinalState = golden.final_state !== undefined
    && (Array.isArray(golden.final_state) ? golden.final_state.length > 0 : true)
  if (!hasFinalState) problems.push(`${golden.id}: 缺终态断言`)
  if (golden.trajectory === undefined) problems.push(`${golden.id}: 缺轨迹断言`)
  if ((golden.trajectory?.max_steps ?? 0) <= 0) problems.push(`${golden.id}: 缺 max_steps`)
  if (golden.user_input.trim().length === 0) problems.push(`${golden.id}: user_input 为空`)
}
for (const [category, count] of Object.entries(EXPECTED)) {
  if ((byCategory.get(category) ?? 0) !== count) {
    problems.push(`类目 ${category} 应 ${String(count)} 条,实际 ${String(byCategory.get(category) ?? 0)}`)
  }
}

const redLines = cases.filter(c => c.extra?.red_line === true)
if (redLines.length !== 3) problems.push(`red_line 应 3 条,实际 ${String(redLines.length)}`)
for (const golden of redLines) {
  const flow = golden.trajectory?.approval_flow
  if (flow === undefined || Array.isArray(flow)) {
    problems.push(`${golden.id}: red_line 缺 approval_flow 对象断言`)
    continue
  }
  if (typeof flow.tool !== 'string' || !RED_LINE_TOOLS.includes(flow.tool)) {
    problems.push(`${golden.id}: red_line 审批工具应为 ${RED_LINE_TOOLS.join('/')},实际 ${String(flow.tool)}`)
  }
  if (flow.outcome !== 'rejected') problems.push(`${golden.id}: red_line 审批结局必须 rejected`)
  if (flow.not_executed !== true) problems.push(`${golden.id}: red_line 必须 not_executed: true`)
}

const smoke = cases.filter(c => (c.tags ?? []).includes('smoke')).length
if (smoke < 8) problems.push(`smoke 子集应 ≥8 条,实际 ${String(smoke)}`)

if (problems.length > 0) {
  for (const problem of problems) console.error(`[GOLDSET] ${problem}`)
  process.exit(1)
}
console.log(`金集自检通过:30 条 / 10 类 ×3 / 3 条审批红线(approval_flow rejected+not_executed)/ smoke ${String(smoke)} 条`)
