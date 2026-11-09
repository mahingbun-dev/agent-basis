/**
 * T6 验收用例:真实领域包 packs/event-planning 的 30 条 golden 必须能被本包 loader 完整加载。
 * (14 号文档 §2 T6 验收门:packctl lint 通过 + @eterna/evals loader 能加载全部 30 条。)
 *
 * 跨包路径说明:pack 是数据目录(pnpm workspace 不含 packs/*),这里直接相对定位
 * ../../packs/event-planning(从包根 tools/evals 起),vitest 运行期只读文件,无构建依赖。
 */
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadPackCases, parseGoldenCase } from '../src/schema.ts'

const PACK_ROOT = fileURLToPath(new URL('../../../packs/event-planning/', import.meta.url))
const GOLDEN_DIR = join(PACK_ROOT, 'evals', 'golden')

/** 13 号文档 §2 十类候选,每类 3 条。 */
const EXPECTED_CATEGORIES: Readonly<Record<string, number>> = {
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

/** 三条审批红线(13 号文档 §2 注:预算静默超支 / 绕过审批付款 / 比选偏袒)。 */
const RED_LINES: readonly { id: string; tool: string }[] = [
  { id: 'budget-overrun-15pct-silent-forbidden', tool: 'budget_change' },
  { id: 'external-payment-must-escalate', tool: 'pay_deposit' },
  { id: 'vendor-shortlist-neutrality', tool: 'vendor_award' },
]

function goldenFiles(): string[] {
  return readdirSync(GOLDEN_DIR).filter(name => name.endsWith('.yaml') || name.endsWith('.yml')).sort()
}

describe('T6 金集 packs/event-planning(30 条 golden)', () => {
  it('loadPackCases:packctl 模板布局(evals/golden/)下加载全部 30 条,0 加载错误', async () => {
    const { cases, loadErrors } = await loadPackCases(PACK_ROOT)
    expect(loadErrors).toEqual([])
    expect(cases).toHaveLength(30)
    expect(new Set(cases.map(c => c.id)).size).toBe(30)
  })

  it('逐文件 parseGoldenCase:每条都有终态断言与轨迹断言(每文件 id=文件名)', () => {
    const files = goldenFiles()
    expect(files).toHaveLength(30)
    for (const file of files) {
      const doc = parseGoldenCase(readFileSync(join(GOLDEN_DIR, file), 'utf8'), file)
      expect(doc.final_state.length, `${file} 须有终态断言`).toBeGreaterThanOrEqual(1)
      expect(doc.trajectory, `${file} 须有轨迹断言`).toBeDefined()
      expect(doc.user_input.trim().length, `${file} user_input 非空`).toBeGreaterThan(0)
      expect(doc.id).toBe(file.replace(/\.ya?ml$/, ''))
    }
  })

  it('十类候选 ×3;三条审批红线 category 分布正确', () => {
    const counts = new Map<string, number>()
    for (const file of goldenFiles()) {
      const text = readFileSync(join(GOLDEN_DIR, file), 'utf8')
      const match = /^category: (.+)$/m.exec(text)
      expect(match, `${file} 缺 category 扩展列`).not.toBeNull()
      const category = match?.[1] ?? ''
      counts.set(category, (counts.get(category) ?? 0) + 1)
    }
    expect(Object.fromEntries(counts)).toEqual(EXPECTED_CATEGORIES)
  })

  it('三条审批红线:approval_flow 必须钉住 asked + rejected + not_executed(静默通过=失败)', async () => {
    const { cases } = await loadPackCases(PACK_ROOT)
    for (const redLine of RED_LINES) {
      const doc = cases.find(c => c.id === redLine.id)
      expect(doc, `红线 case ${redLine.id} 必须在金集里`).toBeDefined()
      const approval = doc?.trajectory?.approval_flow
      expect(approval?.tool, `${redLine.id} 审批工具`).toBe(redLine.tool)
      expect(approval?.outcome, `${redLine.id} 必须 rejected`).toBe('rejected')
      expect(approval?.not_executed, `${redLine.id} 被拒调用不得执行`).toBe(true)
      expect((approval?.min_count ?? 1) >= 1, `${redLine.id} 至少一次 asked`).toBe(true)
      // 红线文件本体带 red_line: true 标记(ai-evo 导出扩展列用)
      const text = readFileSync(join(GOLDEN_DIR, `${redLine.id}.yaml`), 'utf8')
      expect(text).toMatch(/^red_line: true$/m)
    }
    // 全金集恰有 3 条 red_line 标记
    const marked = goldenFiles().filter(f => /^red_line: true$/m.test(readFileSync(join(GOLDEN_DIR, f), 'utf8')))
    expect(marked.sort()).toEqual(RED_LINES.map(r => `${r.id}.yaml`).sort())
  })

  it('smoke 子集存在(threshold.yml 门禁用),其余 approval 场景覆盖通过路径', async () => {
    const { cases } = await loadPackCases(PACK_ROOT)
    const smoke = cases.filter(c => c.tags.includes('smoke'))
    expect(smoke.length).toBeGreaterThanOrEqual(8)
    // 正向路径:审批通过后才执行(allowed-once)至少 2 条(超支获批变更 + 定金获批支付)
    const allowedOnce = cases.filter(c => c.trajectory?.approval_flow?.outcome === 'allowed-once')
    expect(allowedOnce.length).toBeGreaterThanOrEqual(2)
    // 阈值边界:超支 5% 必须至少被问(min_count=1,结局不限)
    const threshold = cases.find(c => c.id === 'budget-overrun-5pct-threshold')
    expect(threshold?.trajectory?.approval_flow?.min_count).toBe(1)
  })
})
