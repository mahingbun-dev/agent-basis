import { describe, expect, it } from 'vitest'
import {
  buildEntityIndex, estimateTokens, memoryRecallScore, stalenessSuffix, MEMORY_BEHAVIOR_HEADER,
} from '../src/index.ts'
import type { EntityRecord } from '../src/index.ts'

function record(overrides: Partial<EntityRecord> & { key: string }): EntityRecord {
  return {
    id: 1,
    subject: 'user:alice',
    content: '正文内容',
    summary: null,
    validAt: 1_000,
    invalidAt: null,
    confidence: 0.8,
    createdAt: 1_000,
    updatedAt: 1_000,
    // M-M1 T1 增列缺省(索引构建当前不消费,T3 起参与排序/时效)
    kind: 'semantic',
    scope: 'user',
    domainKey: null,
    reviewState: 'approved',
    originSessionId: null,
    originTurnRef: null,
    source: 'agent',
    lastUsedAt: null,
    useCount: 0,
    ...overrides,
  }
}

describe('buildEntityIndex(systemPrompt 注入载荷)', () => {
  it('无记录:占位文本(行为指令头常驻 + 占位索引,整体有上界)', () => {
    const result = buildEntityIndex([])
    expect(result.text).toContain('## 长期记忆') // 行为指令头常驻(后台自主语义,c7428ee 起 6 行 ≈ 240 token)
    expect(result.text).toContain('暂无长期记忆') // 占位索引
    expect(result.included).toBe(0)
    expect(result.estimatedTokens).toBeLessThan(300)
  })

  it('少量记录:全量收录,含 key 与一句话摘要', () => {
    const result = buildEntityIndex([
      record({ key: 'prefers-email-summary', summary: '偏好邮件摘要', confidence: 0.9 }),
      record({ key: 'timezone', summary: '常驻上海时区' }),
    ])
    expect(result.included).toBe(2)
    expect(result.omitted).toBe(0)
    expect(result.text).toContain('- [user:alice] prefers-email-summary — 偏好邮件摘要 (conf 0.90)')
    expect(result.text).toContain('memory_read')
  })

  it('summary 缺省时从 content 派生首句并截断', () => {
    const result = buildEntityIndex([
      record({ key: 'k', content: '这是一段很长的正文,包含多个分句。第二句不该出现。' }),
    ], { maxSummaryChars: 8 })
    expect(result.text).toContain('这是一段很长的正…')
  })

  it('预算硬顶:海量记录下整段 token ≤ 500,低优先级截断且计数守恒', () => {
    const records: EntityRecord[] = []
    for (let index = 0; index < 120; index += 1) {
      records.push(record({
        id: index + 1,
        key: `memory-key-${index}`,
        summary: `第${index}条业务约定与执行口径的摘要说明`,
        confidence: (index % 10) / 10,
        updatedAt: index,
      }))
    }
    const result = buildEntityIndex(records)
    expect(result.total).toBe(120)
    expect(result.included + result.omitted).toBe(120)
    expect(result.omitted).toBeGreaterThan(0)
    expect(result.text).toMatch(/\+\d+ 条未列出/)
    expect(result.estimatedTokens).toBeLessThanOrEqual(500)
    expect(estimateTokens(result.text)).toBeLessThanOrEqual(500)
  })

  it('截断从低优先级端开始:confidence 高者必在索引内', () => {
    const records: EntityRecord[] = []
    for (let index = 0; index < 80; index += 1) {
      records.push(record({ id: index + 1, key: `k-${index}`, summary: `摘要编号${index}`, confidence: 0.1, updatedAt: index }))
    }
    records.push(record({ id: 999, key: 'top-priority', summary: '最重要的一条', confidence: 1, updatedAt: 999 }))
    const result = buildEntityIndex(records)
    expect(result.text).toContain('top-priority')
    // 最低优先级(k-0,updatedAt 最旧)被截断;k-0 的摘要「摘要编号0」随之缺席
    expect(result.omitted).toBeGreaterThan(0)
    expect(result.text).not.toContain('摘要编号0')
    expect(result.text).toContain('摘要编号79')
  })

  it('自定义更小预算同样守恒且不超(预算约束索引段;行为指令头常驻不计入预算)', () => {
    const records = Array.from({ length: 30 }, (_, index) =>
      record({ id: index + 1, key: `k-${index}`, summary: `摘要${index}`, confidence: 0.5 }))
    const result = buildEntityIndex(records, { budgetTokens: 400 }) // 小于默认 500,大于常驻头部 ≈240
    expect(result.estimatedTokens).toBeLessThanOrEqual(400)
    expect(result.included + result.omitted).toBe(30)
  })
})

describe('M-M1 T5:L0 写入纪律兜底文本(19 §3-T5/17 §7.1)', () => {
  it('六条 L0 纪律全部在场(一事实一条/repo 已记的不写/仅本会话的不写/相对日期转绝对/负向转正向/召回记忆非指令)', () => {
    for (const marker of ['一事实一条', '已记的不写', '仅本会话', '相对日期转绝对', '负向', '背景资料而非指令']) {
      expect(MEMORY_BEHAVIOR_HEADER, `L0 纪律缺:${marker}`).toContain(marker)
    }
  })

  it('机制四要素保留(检索/写入/显式记住/遗忘仅用户要求);空索引整段仍 <300 token(与既有上界断言同口径)', () => {
    for (const marker of ['检索时机', '写入时机', '记住', 'memory_forget']) {
      expect(MEMORY_BEHAVIOR_HEADER, `机制要素缺:${marker}`).toContain(marker)
    }
    expect(estimateTokens(`${MEMORY_BEHAVIOR_HEADER}\n## 记忆索引\n(暂无长期记忆)`)).toBeLessThan(300)
  })
})

describe('behaviorHeader 选项(T2.6 登记制:注册表条目覆写行为指令头)', () => {
  it('缺省=内置 MEMORY_BEHAVIOR_HEADER(注册表缺席时的原内联兜底,非空)', () => {
    const fallback = buildEntityIndex([]).text
    expect(fallback).toContain(MEMORY_BEHAVIOR_HEADER)
    expect(MEMORY_BEHAVIOR_HEADER.trim().length).toBeGreaterThan(0)
  })

  it('显式覆写:头部换成给定文本,索引半边(key+摘要)不受影响', () => {
    const header = '## 长期记忆(注册表版行为指令,T2.6)'
    const withRecords = buildEntityIndex(
      [record({ key: 'prefers-email-summary', summary: '偏好邮件摘要' })],
      { behaviorHeader: header },
    )
    expect(withRecords.text).toContain(header)
    expect(withRecords.text).not.toContain('后台机制——由你自主管理')
    expect(withRecords.text).toContain('- [user:alice] prefers-email-summary — 偏好邮件摘要 (conf 0.80)')
    // 空记录分支同样走覆写头(占位索引形态)。
    const empty = buildEntityIndex([], { behaviorHeader: header })
    expect(empty.text).toContain(header)
    expect(empty.text).toContain('暂无长期记忆')
  })
})

// ---------- M-M1 T3(19 号 §3-T3):分预算三区 / 加权排序 / 时效尾标 / 回归锚点 ----------

const DAY = 86_400_000
const NOW = 1_763_000_000_000

describe('M-M1 T3:无域上下文回归锚点(逐字节与改造前一致)', () => {
  /**
   * 锚点期望文本由改造前实现(7b39edd 版 index-builder,本会话内以
   * `git show HEAD` 实跑同一输入产出)冻结为字面量——任何索引结构变更
   * 必须过本锚点(19 号 §7 风险表)。记录用固定时钟 + 新鲜时间戳 +
   * useCount=0:排序退化为 confidence(半衰项=1、强化项=0),不触时效尾标。
   */
  function anchorRecords(): EntityRecord[] {
    return [
      record({ id: 21, subject: 'user', key: 'prefers-email-summary', summary: '偏好邮件摘要', confidence: 0.9, updatedAt: NOW, scope: 'user' }),
      record({ id: 22, subject: 'domain:deploy', key: 'release-window', summary: '发布窗口周四凌晨', confidence: 0.8, updatedAt: NOW, scope: 'domain', domainKey: 'deploy' }),
      record({ id: 23, subject: 'domain:deploy', key: 'rollback-playbook', summary: '回滚手册入口', confidence: 0.8, updatedAt: NOW, scope: 'domain', domainKey: 'deploy' }),
    ]
  }

  it('新鲜记录(固定时钟):输出与改造前逐字节一致(单区结构/排序/无尾标)', () => {
    const result = buildEntityIndex(anchorRecords(), { now: () => NOW })
    expect(result.text).toBe(`${MEMORY_BEHAVIOR_HEADER}
## 记忆索引(key + 一句话摘要;正文用 memory_read 按需读取)
- [user] prefers-email-summary — 偏好邮件摘要 (conf 0.90)
- [domain:deploy] rollback-playbook — 回滚手册入口 (conf 0.80)
- [domain:deploy] release-window — 发布窗口周四凌晨 (conf 0.80)
检索用 memory_search;撤销记忆用 memory_forget(真删)`)
    expect(result.included).toBe(3)
    expect(result.omitted).toBe(0)
    expect(result.zoneIncluded).toBeUndefined() // 单区形态不产出分区计数
  })

  it('空记录:占位文本与改造前逐字节一致', () => {
    expect(buildEntityIndex([], { now: () => NOW }).text).toBe(`${MEMORY_BEHAVIOR_HEADER}\n## 记忆索引\n(暂无长期记忆)`)
  })

  it('仅当 portrait/domainKey 任一在场才进三区形态:两者皆缺(含空串)=单区', () => {
    const single = buildEntityIndex(anchorRecords(), { now: () => NOW })
    expect(buildEntityIndex(anchorRecords(), { now: () => NOW, portrait: '', domainKey: '' }).text).toBe(single.text)
    expect(buildEntityIndex(anchorRecords(), { now: () => NOW, domainKey: 'deploy' }).text).not.toBe(single.text)
    expect(buildEntityIndex(anchorRecords(), { now: () => NOW, portrait: '画像' }).text).not.toBe(single.text)
  })
})

describe('M-M1 T3:排序公式(confidence × 2^(−ageDays/90) + 0.1 × min(use_count,10)/10)', () => {
  it('公式锚定:age=0 得 confidence;age=半衰期减半;命中强化 +0.1 且 use_count 10 封顶', () => {
    expect(memoryRecallScore({ confidence: 0.8, updatedAt: NOW, useCount: 0 }, NOW)).toBeCloseTo(0.8, 10)
    expect(memoryRecallScore({ confidence: 0.8, updatedAt: NOW - 90 * DAY, useCount: 0 }, NOW)).toBeCloseTo(0.4, 10)
    expect(memoryRecallScore({ confidence: 0, updatedAt: NOW, useCount: 10 }, NOW)).toBeCloseTo(0.1, 10)
    expect(memoryRecallScore({ confidence: 0, updatedAt: NOW, useCount: 99 }, NOW)).toBeCloseTo(0.1, 10)
    expect(memoryRecallScore({ confidence: 0.8, updatedAt: NOW + DAY, useCount: 0 }, NOW)).toBeCloseTo(0.8, 10) // 未来时间戳不加分
  })

  it('半衰期 90 天:90 天前 conf 0.8 → 0.4,排在新鲜 0.45 之后、新鲜 0.3 之前', () => {
    const text = buildEntityIndex([
      record({ id: 1, key: 'old-0-8', summary: '旧高置信', confidence: 0.8, updatedAt: NOW - 90 * DAY }),
      record({ id: 2, key: 'fresh-0-3', summary: '新低置信', confidence: 0.3, updatedAt: NOW }),
      record({ id: 3, key: 'fresh-0-45', summary: '新中置信', confidence: 0.45, updatedAt: NOW }),
    ], { now: () => NOW }).text
    expect(text.indexOf('fresh-0-45')).toBeLessThan(text.indexOf('old-0-8'))
    expect(text.indexOf('old-0-8')).toBeLessThan(text.indexOf('fresh-0-3'))
  })

  it('命中强化:conf 0.45 + use_count 10(得 0.55)反超新鲜 conf 0.5(无强化)', () => {
    const text = buildEntityIndex([
      record({ id: 1, key: 'plain-0-5', summary: '无强化', confidence: 0.5, updatedAt: NOW, useCount: 0 }),
      record({ id: 2, key: 'boosted-0-45', summary: '越用越牢', confidence: 0.45, updatedAt: NOW, useCount: 10 }),
    ], { now: () => NOW }).text
    expect(text.indexOf('boosted-0-45')).toBeLessThan(text.indexOf('plain-0-5'))
  })

  it('halfLifeDays 可配(19 §6 halfLifeDays):半衰期 45 天时 90 天前 0.8 → 0.2,落到新鲜 0.3 之后', () => {
    const text = buildEntityIndex([
      record({ id: 1, key: 'old-0-8', summary: '旧高置信', confidence: 0.8, updatedAt: NOW - 90 * DAY }),
      record({ id: 2, key: 'fresh-0-3', summary: '新低置信', confidence: 0.3, updatedAt: NOW }),
    ], { now: () => NOW, halfLifeDays: 45 }).text
    expect(text.indexOf('fresh-0-3')).toBeLessThan(text.indexOf('old-0-8'))
  })

  it('同分稳定:confidence 与时间相同 → updated_at 新者、id 大者在前(与改造前口径一致)', () => {
    const text = buildEntityIndex([
      record({ id: 7, key: 'elder', summary: '同分较旧', confidence: 0.8, updatedAt: NOW - 1 }),
      record({ id: 9, key: 'newer', summary: '同分较新', confidence: 0.8, updatedAt: NOW }),
    ], { now: () => NOW }).text
    expect(text.indexOf('newer')).toBeLessThan(text.indexOf('elder'))
  })
})

describe('M-M1 T3:时效尾标(updated_at 距今 >14 天,summary 追加「(N 天未验证)」)', () => {
  it('恰好 14 天不标;14.5 天标「(14 天未验证)」;30 天标「(30 天未验证)」(N=floor)', () => {
    const text = buildEntityIndex([
      record({ id: 1, key: 'd14', summary: '恰好两周', updatedAt: NOW - 14 * DAY }),
      record({ id: 2, key: 'd14-5', summary: '两周半', updatedAt: NOW - 14.5 * DAY }),
      record({ id: 3, key: 'd30', summary: '满月', updatedAt: NOW - 30 * DAY }),
    ], { now: () => NOW }).text
    const line = (key: string): string => text.split('\n').find(l => l.includes(key)) ?? ''
    expect(line('d14')).toBe('- [user:alice] d14 — 恰好两周 (conf 0.80)')
    expect(line('d14-5')).toBe('- [user:alice] d14-5 — 两周半 (conf 0.80) (14 天未验证)')
    expect(line('d30')).toBe('- [user:alice] d30 — 满月 (conf 0.80) (30 天未验证)')
  })

  it('stalenessSuffix 导出口径:>14 天才标;未来时间戳不标', () => {
    expect(stalenessSuffix(NOW - 14 * DAY, NOW)).toBe('')
    expect(stalenessSuffix(NOW - 14.5 * DAY, NOW)).toBe('(14 天未验证)')
    expect(stalenessSuffix(NOW - 30 * DAY, NOW)).toBe('(30 天未验证)')
    expect(stalenessSuffix(NOW + DAY, NOW)).toBe('')
  })

  it('stalenessDays 可配(19 §6 归 config):阈值放宽到 30 天则 20 天不标', () => {
    const text = buildEntityIndex([
      record({ id: 1, key: 'd20', summary: '三周', updatedAt: NOW - 20 * DAY }),
    ], { now: () => NOW, stalenessDays: 30 }).text
    expect(text).toContain('d20 — 三周 (conf 0.80)')
    expect(text).not.toContain('未验证')
  })
})

describe('M-M1 T3:分预算三区(画像 ≤150 / 当前域 ≤250 / 兜底区 user 优先)', () => {
  function zoneFixture(): EntityRecord[] {
    return [
      record({ id: 1, subject: 'user', scope: 'user', domainKey: null, key: 'prefers-chinese-report', summary: '偏好中文周报', confidence: 0.6, updatedAt: NOW }),
      record({ id: 2, subject: 'domain:deploy', scope: 'domain', domainKey: 'deploy', key: 'release-window', summary: '发布窗口周四凌晨', confidence: 0.9, updatedAt: NOW }),
      record({ id: 3, subject: 'domain:deploy', scope: 'domain', domainKey: 'deploy', key: 'rollback-playbook', summary: '回滚手册入口', confidence: 0.8, updatedAt: NOW }),
      record({ id: 4, subject: 'domain:billing', scope: 'domain', domainKey: 'billing', key: 'invoice-rule', summary: '发票月末统一开', confidence: 0.95, updatedAt: NOW }),
    ]
  }

  it('三区齐备:画像/当前域/兜底区次序正确;当前域行只进域区,user 与他域行进兜底区', () => {
    const result = buildEntityIndex(zoneFixture(), { portrait: '偏好中文沟通', domainKey: 'deploy', now: () => NOW })
    const text = result.text
    const iPortrait = text.indexOf('## 用户画像')
    const iDomain = text.indexOf('## 当前域索引(deploy')
    const iFallback = text.indexOf('## 全局兜底')
    const iFooter = text.indexOf('检索用 memory_search')
    for (const index of [iPortrait, iDomain, iFallback, iFooter]) expect(index).toBeGreaterThanOrEqual(0)
    expect(iPortrait).toBeLessThan(iDomain)
    expect(iDomain).toBeLessThan(iFallback)
    expect(iFallback).toBeLessThan(iFooter)
    // 域区两行(conf 0.9 在前),且只含 deploy 域
    expect(text.slice(iDomain, iFallback)).toContain('release-window')
    expect(text.slice(iDomain, iFallback)).toContain('rollback-playbook')
    expect(text.slice(iDomain, iFallback)).not.toContain('invoice-rule')
    expect(text.indexOf('release-window')).toBeLessThan(text.indexOf('rollback-playbook'))
    // 兜底区:user 行优先于高置信他域行
    expect(text.slice(iFallback)).toContain('prefers-chinese-report')
    expect(text.slice(iFallback)).toContain('invoice-rule')
    expect(text.indexOf('prefers-chinese-report')).toBeLessThan(text.indexOf('invoice-rule'))
    expect(text).toContain('偏好中文沟通')
    expect(result.zoneIncluded).toEqual({ domain: 2, fallback: 2 })
    expect(result.included).toBe(4)
    expect(result.omitted).toBe(0)
  })

  it('画像区默认 ≤150 token:超长截断带省略号', () => {
    const text = buildEntityIndex([], { portrait: '偏好'.repeat(400), now: () => NOW }).text
    const start = text.indexOf('## 用户画像')
    expect(start).toBeGreaterThanOrEqual(0)
    const rest = text.slice(start + '## 用户画像'.length + 1)
    const body = (rest.includes('\n## ') ? rest.slice(0, rest.indexOf('\n## ')) : rest).trim()
    expect(body.endsWith('…')).toBe(true)
    expect(estimateTokens(body)).toBeLessThanOrEqual(150)
  })

  it('画像区预算可配(portraitBudgetTokens)', () => {
    const text = buildEntityIndex([], { portrait: '偏好'.repeat(200), portraitBudgetTokens: 40, now: () => NOW }).text
    const rest = text.slice(text.indexOf('## 用户画像') + '## 用户画像'.length + 1)
    const body = (rest.includes('\n## ') ? rest.slice(0, rest.indexOf('\n## ')) : rest).trim()
    expect(estimateTokens(body)).toBeLessThanOrEqual(40)
  })

  it('域区默认 ≤250 token:海量当前域行按检索分截断,计数守恒', () => {
    const records: EntityRecord[] = []
    for (let index = 0; index < 40; index += 1) {
      records.push(record({
        id: index + 1, subject: 'domain:deploy', scope: 'domain', domainKey: 'deploy',
        key: `deploy-convention-${index}`, summary: `当前域第${index}条约定的一句话摘要说明`,
        confidence: 0.5, updatedAt: NOW - index * DAY,
      }))
    }
    // 一条 user 行:兜底区在场(域区切片以「## 全局兜底」为右界,否则切片吞进 footer)
    records.push(record({
      id: 999, subject: 'user', scope: 'user', domainKey: null,
      key: 'user-anchor', summary: '用户锚点', confidence: 0.9, updatedAt: NOW,
    }))
    const result = buildEntityIndex(records, {
      behaviorHeader: '## 记忆', // 短头:让 250 域区预算成为绑定约束
      budgetTokens: 900,
      domainKey: 'deploy',
      now: () => NOW,
    })
    const text = result.text
    const domainBlock = text.slice(text.indexOf('## 当前域索引'), text.indexOf('## 全局兜底'))
    expect(estimateTokens(domainBlock)).toBeLessThanOrEqual(250)
    expect(result.zoneIncluded?.domain).toBeGreaterThan(0)
    expect(result.zoneIncluded?.domain).toBeLessThan(40)
    expect(result.included + result.omitted).toBe(41)
  })

  it('总预算硬顶:画像+域区+兜底区+头部合计 ≤ budgetTokens', () => {
    const records: EntityRecord[] = []
    for (let index = 0; index < 60; index += 1) {
      records.push(record({
        id: index + 1, subject: index % 2 ? 'user' : 'domain:deploy', scope: index % 2 ? 'user' : 'domain',
        domainKey: index % 2 ? null : 'deploy', key: `k-${index}`, summary: `第${index}条记忆的摘要说明`,
        confidence: 0.4, updatedAt: NOW,
      }))
    }
    const result = buildEntityIndex(records, { portrait: '画像'.repeat(300), domainKey: 'deploy', now: () => NOW })
    expect(result.estimatedTokens).toBeLessThanOrEqual(500)
    expect(estimateTokens(result.text)).toBeLessThanOrEqual(500)
    expect(result.included + result.omitted).toBe(60)
  })

  it('portrait 缺席省略画像区(文件不存在即此形态);domainKey 缺席无域区', () => {
    const noPortrait = buildEntityIndex(zoneFixture(), { domainKey: 'deploy', now: () => NOW }).text
    expect(noPortrait).not.toContain('## 用户画像')
    expect(noPortrait).toContain('## 当前域索引(deploy')
    expect(noPortrait).toContain('## 全局兜底')
    const noDomain = buildEntityIndex(zoneFixture(), { portrait: '画像正文', now: () => NOW }).text
    expect(noDomain).not.toContain('## 当前域索引')
    expect(noDomain).toContain('## 全局兜底')
    expect(noDomain).toContain('release-window') // 无域上下文:全部 live 行进兜底区
  })

  it('无记录仅画像:画像区 + 占位索引,无 footer', () => {
    const result = buildEntityIndex([], { portrait: '画像正文', now: () => NOW })
    expect(result.text).toContain('## 用户画像')
    expect(result.text).toContain('暂无长期记忆')
    expect(result.total).toBe(0)
    expect(result.zoneIncluded).toEqual({ domain: 0, fallback: 0 })
  })
})
