/**
 * prompt-audit 扫描器(设计 10 §7 Skill 行 / Anthropic `/doctor prompt-audit` 模式)。
 *
 * 月度扫描一个 pack 的全部 SKILL.md,产出三类发现与对应 delta 提案(L2 人审):
 * 1. 引用文件缺失 —— 条目正文里的 markdown 相对链接指向不存在的文件 → deprecate 提案;
 * 2. 计数低下 —— harmful ≥ harmfulThreshold(默认 3,ACE 元数据口径)或
 *    零 helpful 且 staleDays(默认 90)未更新 → deprecate 提案;
 * 3. 高相似条目 —— 活跃条目两两词元 dice 相似度 > similarityThreshold(默认 0.9)
 *    → merge_entries 提案(语义去重由人审/curator 模型复核,这里是确定性初筛)。
 *
 * 扫描结果同时产出 audit_scan 信号草稿(设计 10 §2 kind=audit_scan,
 * 入 observe SignalStore 后进 reflector 窗口)。纯函数 + 显式 fs 注入(coeffect 声明)。
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { scanSkills } from '@basis/packctl'
import { parseSkillDoc } from './entry.ts'
import type { SkillDoc, SkillEntry } from './entry.ts'
import type { SkillDelta } from './deltas.ts'

/** 单条扫描发现。 */
export interface AuditFinding {
  readonly kind: 'missing-ref' | 'low-signal' | 'high-similarity'
  readonly skill: string
  /** 涉及条目 id(missing-ref/low-signal 单条;high-similarity 是一对)。 */
  readonly entryIds: readonly string[]
  readonly detail: string
}

/** 一条审计产出的 delta 提案(L2 人审确认后走 gates)。 */
export interface AuditProposal {
  readonly skill: string
  readonly skillPath: string
  readonly finding: AuditFinding
  readonly delta: SkillDelta
}

export interface PromptAuditReport {
  readonly packRoot: string
  readonly findings: readonly AuditFinding[]
  readonly proposals: readonly AuditProposal[]
  /** audit_scan 信号草典(直接可入 observe SignalStore.enqueue)。 */
  readonly signalDrafts: readonly {
    readonly kind: 'audit_scan'
    readonly ref: string
    readonly payload: { readonly summary: string; readonly tags: readonly string[] }
  }[]
}

export interface AuditOptions {
  /** harmful ≥ N → deprecate 提案(ACE 元数据口径,默认 3;设计 10 §7)。 */
  readonly harmfulThreshold?: number
  /** 零 helpful 且超 N 天未更新 → deprecate 提案(默认 90 天)。 */
  readonly staleDays?: number
  /** 词元 dice 相似度 > N → merge 提案(默认 0.9;语义初筛,人审复核)。 */
  readonly similarityThreshold?: number
  /** 「今天」(默认 new Date;测试注入固定日期)。 */
  readonly now?: Date
}

interface SkillDocRef {
  readonly relPath: string
  readonly absDir: string
  readonly doc: SkillDoc
}

/** 扫描 pack(skills/ 全部 SKILL.md)。 */
export function promptAudit(packRoot: string, options: AuditOptions = {}): PromptAuditReport {
  const harmfulThreshold = options.harmfulThreshold ?? 3
  const staleDays = options.staleDays ?? 90
  const similarityThreshold = options.similarityThreshold ?? 0.9
  const now = options.now ?? new Date()

  const scan = scanSkills(packRoot)
  const docs: SkillDocRef[] = []
  for (const skill of scan.skills) {
    const parsed = parseSkillDoc(skill.text)
    if (parsed.ok) {
      // 引用基准 = SKILL.md 所在目录(relPath 相对 pack 根,如 skills/core-workflow/SKILL.md)。
      docs.push({ relPath: skill.relPath, absDir: join(packRoot, dirnameOf(skill.relPath)), doc: parsed.doc })
    }
  }

  const findings: AuditFinding[] = []
  const proposals: AuditProposal[] = []

  for (const ref of docs) {
    const skillName = ref.doc.name
    for (const entry of ref.doc.entries) {
      if (entry.deprecated) continue

      // 1) 引用文件缺失:条目正文中的相对路径 markdown 链接/反引号路径必须存在。
      for (const rel of referencedFiles(entry.body)) {
        if (isExternalOrAnchor(rel)) continue
        const target = join(ref.absDir, rel)
        if (!existsSync(target)) {
          const finding: AuditFinding = {
            kind: 'missing-ref',
            skill: skillName,
            entryIds: [entry.meta.id],
            detail: `条目引用的文件 "${rel}" 不存在(${target})`,
          }
          findings.push(finding)
          proposals.push(deprecateProposal(ref, skillName, finding, entry, now))
        }
      }

      // 2) 计数低下:harmful ≥ 阈值(自动转 deprecate,设计 10 §4.1);
      //    或零 helpful 且 staleDays 未更新(陈旧指令,以删行为主)。
      const harmfulHit = entry.meta.harmful >= harmfulThreshold
      const staleHit = entry.meta.helpful === 0 && entry.meta.harmful === 0 && daysSince(entry.meta.updated, now) >= staleDays
      if (harmfulHit || staleHit) {
        const finding: AuditFinding = {
          kind: 'low-signal',
          skill: skillName,
          entryIds: [entry.meta.id],
          detail: harmfulHit
            ? `harmful=${entry.meta.harmful} ≥ ${harmfulThreshold}(helpful/harmful 持续走低,自动转 deprecate 提案)`
            : `零 helpful 且 ${daysSince(entry.meta.updated, now)} 天未更新(≥ ${staleDays} 天陈旧条目)`,
        }
        findings.push(finding)
        proposals.push(deprecateProposal(ref, skillName, finding, entry, now))
      }
    }

    // 3) 高相似条目:活跃条目两两 dice > 阈值 → merge 提案(并入序号小者)。
    const active = ref.doc.entries.filter(e => !e.deprecated)
    for (let i = 0; i < active.length; i++) {
      for (let j = i + 1; j < active.length; j++) {
        const a = active[i]
        const b = active[j]
        if (a === undefined || b === undefined) continue
        const similarity = diceSimilarity(a.body, b.body)
        if (similarity > similarityThreshold) {
          const into = idLessThan(a.meta.id, b.meta.id) ? a : b
          const from = into === a ? b : a
          const finding: AuditFinding = {
            kind: 'high-similarity',
            skill: skillName,
            entryIds: [into.meta.id, from.meta.id],
            detail: `条目 "${into.meta.id}" 与 "${from.meta.id}" 相似度 ${similarity.toFixed(2)} > ${similarityThreshold}(建议合并去重)`,
          }
          findings.push(finding)
          proposals.push({
            skill: skillName,
            skillPath: ref.relPath,
            finding,
            delta: { type: 'merge_entries', into: into.meta.id, from: [from.meta.id], date: isoDate(now) },
          })
        }
      }
    }
  }

  const signalDrafts = findings.map(finding => ({
    kind: 'audit_scan' as const,
    ref: `audit:${finding.skill}:${finding.entryIds.join('+')}:${finding.kind}`,
    payload: {
      summary: `prompt-audit ${finding.kind}:${finding.detail}`,
      tags: ['prompt-audit', finding.kind, finding.skill],
    },
  }))
  return { packRoot, findings, proposals, signalDrafts }
}

// ── 引用提取(markdown 链接 + 反引号路径;确定性词法,不做语义)──────────

export function referencedFiles(body: string): readonly string[] {
  const out = new Set<string>()
  for (const match of body.matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)) {
    if (match[1] !== undefined) out.add(match[1])
  }
  for (const match of body.matchAll(/`([./][^`\s]+)`/g)) {
    if (match[1] !== undefined) out.add(match[1])
  }
  return [...out]
}

function isExternalOrAnchor(rel: string): boolean {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(rel)) return true // http:// 等外部协议
  if (rel.startsWith('#') || rel.startsWith('mailto:')) return true // 页内锚点/邮件
  return false
}

// ── 相似度(词元 dice 系数;确定性初筛,语义复核在人审/curator)────────────

/** 分词:小写、按非字母数字(CJK 逐字)切分。 */
function tokenize(text: string): readonly string[] {
  const normalized = text.toLowerCase()
  const tokens: string[] = []
  for (const wordPart of normalized.split(/[^\p{L}\p{N}]+/u)) {
    if (/^[\p{Script=Han}]+$/u.test(wordPart)) {
      for (const ch of wordPart) tokens.push(ch) // CJK 逐字
    } else if (wordPart.length > 0) {
      tokens.push(wordPart)
    }
  }
  return tokens
}

/** dice 系数 = 2|A∩B| / (|A|+|B|),多重集合按出现计数。 */
export function diceSimilarity(a: string, b: string): number {
  const ta = tokenize(a)
  const tb = tokenize(b)
  if (ta.length === 0 || tb.length === 0) return 0
  const counts = new Map<string, number>()
  for (const t of ta) counts.set(t, (counts.get(t) ?? 0) + 1)
  let intersection = 0
  for (const t of tb) {
    const left = counts.get(t) ?? 0
    if (left > 0) {
      intersection += 1
      counts.set(t, left - 1)
    }
  }
  return (2 * intersection) / (ta.length + tb.length)
}

// ── 杂项 ────────────────────────────────────────────────────────────────────

function deprecateProposal(
  ref: SkillDocRef,
  skillName: string,
  finding: AuditFinding,
  entry: SkillEntry,
  now: Date,
): AuditProposal {
  return {
    skill: skillName,
    skillPath: ref.relPath,
    finding,
    delta: {
      type: 'deprecate_entry',
      id: entry.meta.id,
      date: isoDate(now),
      reason: finding.detail,
    },
  }
}

function idLessThan(a: string, b: string): boolean {
  return a.localeCompare(b, undefined, { numeric: true }) < 0
}

/** relPath(skills/core-workflow/SKILL.md)→ skills/core-workflow;无目录 → '.'。 */
function dirnameOf(relPath: string): string {
  const idx = relPath.lastIndexOf('/')
  return idx <= 0 ? '.' : relPath.slice(0, idx)
}

function daysSince(date: string, now: Date): number {
  const then = Date.parse(`${date}T00:00:00Z`)
  if (Number.isNaN(then)) return Number.MAX_SAFE_INTEGER // 非法日期按无限陈旧处理(fail-closed)
  return Math.floor((now.getTime() - then) / 86_400_000)
}

function isoDate(now: Date): string {
  return now.toISOString().slice(0, 10)
}

// coeffect:本模块只触碰 packRoot 参数声明的目录树(scanSkills 读 SKILL.md,
// existsSync 做引用存在性检查);无旁路全局、无网络、无数据库。
