/**
 * prompt-audit 扫描器单测:引用文件缺失 / 计数低下(harmful≥3、90 天零 helpful)/
 * 高相似条目合并建议 / audit_scan 信号草稿。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { initPack } from '@basis/packctl'
import { diceSimilarity, promptAudit, referencedFiles } from '../src/index.ts'

let root = ''
let packDir = ''

/** 审计专用 SKILL.md:001 引用存在的 checklist;002 引用不存在的文件;003 harmful=3;004/005 高相似;006 陈旧零计数。 */
const AUDIT_SKILL_MD = `---
name: core-workflow
description: 审计演示 skill。
metadata:
  evo:
    entries:
      - { id: S-core-workflow-001, helpful: 2, harmful: 0, updated: 2026-10-01, origin: init }
      - { id: S-core-workflow-002, helpful: 2, harmful: 0, updated: 2026-10-01, origin: init }
      - { id: S-core-workflow-003, helpful: 1, harmful: 3, updated: 2026-10-01, origin: init }
      - { id: S-core-workflow-004, helpful: 2, harmful: 0, updated: 2026-10-01, origin: init }
      - { id: S-core-workflow-005, helpful: 2, harmful: 0, updated: 2026-10-01, origin: init }
      - { id: S-core-workflow-006, helpful: 0, harmful: 0, updated: 2026-01-01, origin: init }
---
## 步骤

<!-- E: S-core-workflow-001 -->
正常条目:自查见 [检查表](references/checklist.md)。
<!-- /E -->

<!-- E: S-core-workflow-002 -->
引用了不存在的文件:[模板](references/missing-template.md)。
<!-- /E -->

<!-- E: S-core-workflow-003 -->
有害条目:重复误导执行的规则。
<!-- /E -->

<!-- E: S-core-workflow-004 -->
交付前逐项核对预算表与场次表,确认口径一致后再提交。
<!-- /E -->

<!-- E: S-core-workflow-005 -->
交付前逐项核对预算表与场次表,确认口径一致后再提交。
<!-- /E -->

<!-- E: S-core-workflow-006 -->
陈旧条目:很久没有命中也没有害处的旧指令。
<!-- /E -->
`

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'basis-evolve-audit-'))
  const init = initPack('evodemo', { rootDir: root })
  if (init.result === undefined) throw new Error('init 失败')
  packDir = init.result.packDir
  await fs.writeFile(path.join(packDir, 'skills/core-workflow/SKILL.md'), AUDIT_SKILL_MD, 'utf8')
})

afterAll(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

describe('引用提取与相似度(纯函数)', () => {
  it('markdown 链接 + 反引号相对路径全量提取(外链过滤在扫描层)', () => {
    const refs = referencedFiles('见 [检查表](references/checklist.md) 与 \`./tpl/a.md\`;外链 [x](https://a.b/c) 与 [y](#sec) 由扫描层过滤')
    expect(refs).toEqual(['references/checklist.md', 'https://a.b/c', '#sec', './tpl/a.md'])
  })

  it('dice 相似度:同文=1、异文低、CJK 生效', () => {
    expect(diceSimilarity('交付前逐项核对预算表', '交付前逐项核对预算表')).toBe(1)
    expect(diceSimilarity('交付前逐项核对预算表', '完全无关的另一句话')).toBeLessThan(0.5)
    expect(diceSimilarity('预算表核对', '核对预算表')).toBeGreaterThan(0.6)
  })
})

describe('promptAudit', () => {
  const report = () => promptAudit(packDir, { now: new Date('2026-11-03T00:00:00Z') })

  it('引用缺失 → missing-ref + deprecate 提案', () => {
    const result = report()
    const finding = result.findings.find(f => f.kind === 'missing-ref')
    expect(finding).toBeDefined()
    expect(finding?.entryIds).toEqual(['S-core-workflow-002'])
    expect(finding?.detail).toContain('missing-template.md')
    const proposal = result.proposals.find(p => p.finding.kind === 'missing-ref')
    expect(proposal?.delta).toMatchObject({ type: 'deprecate_entry', id: 'S-core-workflow-002' })
    // 引用存在的条目(001)不报
    expect(result.findings.some(f => f.entryIds.includes('S-core-workflow-001'))).toBe(false)
  })

  it('计数低下:harmful≥3 与 90 天零 helpful 双路径 → deprecate 提案', () => {
    const result = report()
    const low = result.findings.filter(f => f.kind === 'low-signal')
    expect(low.map(f => f.entryIds[0]).sort()).toEqual(['S-core-workflow-003', 'S-core-workflow-006'])
    expect(low.find(f => f.entryIds[0] === 'S-core-workflow-003')?.detail).toContain('harmful=3')
    expect(low.find(f => f.entryIds[0] === 'S-core-workflow-006')?.detail).toContain('零 helpful')
  })

  it('高相似 → high-similarity + merge_entries 提案(并入序号小者)', () => {
    const result = report()
    const similar = result.findings.find(f => f.kind === 'high-similarity')
    expect(similar?.entryIds).toEqual(['S-core-workflow-004', 'S-core-workflow-005'])
    const proposal = result.proposals.find(p => p.finding.kind === 'high-similarity')
    expect(proposal?.delta).toMatchObject({ type: 'merge_entries', into: 'S-core-workflow-004', from: ['S-core-workflow-005'] })
  })

  it('阈值可调:harmful/stale/similarity 阈值全部放宽后只剩真实存在的 missing-ref', () => {
    const result = promptAudit(packDir, { harmfulThreshold: 5, staleDays: 3650, similarityThreshold: 1.1, now: new Date('2026-11-03T00:00:00Z') })
    // low-signal / high-similarity 被阈值关掉;002 的引用缺失是客观事实,不随阈值消失
    expect(result.findings.filter(f => f.kind !== 'missing-ref')).toEqual([])
    expect(result.findings.map(f => f.kind)).toEqual(['missing-ref'])
  })

  it('audit_scan 信号草稿:kind/ref/payload 齐备可直接入 observe SignalStore', () => {
    const result = report()
    expect(result.signalDrafts.length).toBe(result.findings.length)
    expect(result.signalDrafts.every(d => d.kind === 'audit_scan')).toBe(true)
    const first = result.signalDrafts[0]
    expect(first?.ref).toContain('audit:core-workflow:')
    expect(first?.payload.tags).toContain('prompt-audit')
    expect(first?.payload.summary).toContain('prompt-audit')
  })

  it('废弃条目跳过:归档节内不参与审计', async () => {
    const skillPath = path.join(packDir, 'skills/core-workflow/SKILL.md')
    const original = await fs.readFile(skillPath, 'utf8')
    // 把 003(有害条目)挪进归档节:直接构造已归档形态
    const archived = original
      .replace('updated: 2026-10-01, origin: init }\n      - { id: S-core-workflow-003, helpful: 1, harmful: 3, updated: 2026-10-01, origin: init }', 'updated: 2026-10-01, origin: init }')
      .replace('      - { id: S-core-workflow-002, helpful: 2, harmful: 0, updated: 2026-10-01, origin: init }', '      - { id: S-core-workflow-002, helpful: 2, harmful: 0, updated: 2026-10-01, origin: init }\n      - { id: S-core-workflow-003, helpful: 1, harmful: 3, updated: 2026-10-01, origin: init, deprecated_at: 2026-10-02 }')
      .replace('<!-- E: S-core-workflow-003 -->\n有害条目:重复误导执行的规则。\n<!-- /E -->', '')
      .concat('\n## 已废弃(Evo Archive)\n\n<!-- E: S-core-workflow-003 -->\n有害条目:重复误导执行的规则。\n<!-- /E -->\n')
    await fs.writeFile(skillPath, archived, 'utf8')
    const result = promptAudit(packDir, { now: new Date('2026-11-03T00:00:00Z') })
    expect(result.findings.some(f => f.kind === 'low-signal' && f.entryIds.includes('S-core-workflow-003'))).toBe(false)
    await fs.writeFile(skillPath, original, 'utf8')
  })
})
