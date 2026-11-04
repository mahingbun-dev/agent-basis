/**
 * report.md 渲染:总览(通过率)/ 分 tags / 失败原因分类 / 用例明细。
 */
import type { CaseResult, FailureCategory, PackRunResult } from './types.ts'

const FAILURE_CATEGORY_ORDER: readonly FailureCategory[] = ['schema', 'answer', 'final_state', 'trajectory', 'budget', 'harness', 'assert']

export function renderReport(result: PackRunResult): string {
  const total = result.results.length
  const pass = result.results.filter(item => item.status === 'pass').length
  const fail = total - pass
  const lines: string[] = []
  lines.push('# DSH Evals Report', '')
  lines.push(`- pack: ${result.packDir}`)
  lines.push(`- adapter: ${result.adapterId}${result.adapterId === 'auto' ? '(逐 case:golden 的 adapter 字段,缺省 replay)' : ''}`)
  if (result.subset !== undefined) lines.push(`- subset: ${result.subset}`)
  lines.push(`- started_at: ${result.startedAt}`)
  lines.push(`- duration: ${(result.durationMs / 1000).toFixed(1)}s`)
  lines.push('')
  lines.push('## 总览', '')
  lines.push('| total | pass | fail | pass_rate |', '|---|---|---|---|')
  lines.push(`| ${total} | ${pass} | ${fail} | ${total === 0 ? 'n/a' : `${((pass / total) * 100).toFixed(1)}%`} |`)
  lines.push('')
  lines.push('## 分 tags', '')
  const tagStats = tagBreakdown(result.results)
  if (tagStats.length === 0) {
    lines.push('(无 tag)')
  } else {
    lines.push('| tag | total | pass | fail | pass_rate |', '|---|---|---|---|---|')
    for (const row of tagStats) {
      lines.push(`| ${row.tag} | ${row.total} | ${row.pass} | ${row.total - row.pass} | ${((row.pass / row.total) * 100).toFixed(1)}% |`)
    }
  }
  lines.push('')
  lines.push('## 失败原因分类', '')
  const categoryCounts = failureCategoryCounts(result)
  if (categoryCounts.length === 0) {
    lines.push('无失败。')
  } else {
    lines.push('| category | count |', '|---|---|')
    for (const row of categoryCounts) lines.push(`| ${row.category} | ${row.count} |`)
  }
  if (result.loadErrors.length > 0) {
    lines.push('')
    lines.push(`schema 加载失败文件(未计入用例): ${result.loadErrors.length} 个`)
    for (const error of result.loadErrors) lines.push(`- ${error.file}: ${error.message}`)
  }
  lines.push('')
  lines.push('## 用例明细', '')
  lines.push('| id | adapter | status | tags | 失败分类 |', '|---|---|---|---|---|')
  for (const item of result.results) {
    const categories = [...new Set(item.failures.map(failure => failure.category))].join(',') || '-'
    lines.push(`| ${item.caseData.id} | ${item.adapterId} | ${item.status} | ${item.caseData.tags.join(', ') || '-'} | ${categories} |`)
  }
  lines.push('')
  const failed = result.results.filter(item => item.status === 'fail')
  if (failed.length > 0) {
    lines.push('## 失败详情', '')
    for (const item of failed) {
      lines.push(`### ${item.caseData.id}`, '')
      for (const failure of item.failures) lines.push(`- [${failure.category}] ${failure.message}`)
      if (item.notes.length > 0) {
        lines.push('', 'notes:')
        for (const note of item.notes) lines.push(`- ${note}`)
      }
      lines.push('')
    }
  }
  return `${lines.join('\n')}\n`
}

function tagBreakdown(results: readonly CaseResult[]): { tag: string; total: number; pass: number }[] {
  const map = new Map<string, { total: number; pass: number }>()
  for (const item of results) {
    const tags = item.caseData.tags.length > 0 ? item.caseData.tags : ['(untagged)']
    for (const tag of tags) {
      const stat = map.get(tag) ?? { total: 0, pass: 0 }
      stat.total += 1
      if (item.status === 'pass') stat.pass += 1
      map.set(tag, stat)
    }
  }
  return [...map.entries()].map(([tag, stat]) => ({ tag, ...stat })).sort((a, b) => a.tag.localeCompare(b.tag))
}

function failureCategoryCounts(result: PackRunResult): { category: string; count: number }[] {
  const counts = new Map<string, number>()
  for (const item of result.results) {
    for (const category of new Set(item.failures.map(failure => failure.category))) {
      counts.set(category, (counts.get(category) ?? 0) + 1)
    }
  }
  const order = new Map(FAILURE_CATEGORY_ORDER.map((category, index) => [category as string, index]))
  return [...counts.entries()]
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => (order.get(a.category) ?? 99) - (order.get(b.category) ?? 99))
}
