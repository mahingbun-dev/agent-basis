/**
 * Cordis 纪律静态检查(05 号笔记 §9 三纪律在领域包工具源码上的最小静态投影)。
 *
 * 1. CORD001 无旁路全局(coeffect 全声明):禁止 `globalThis` / `process.env` /
 *    裸 `setTimeout|setInterval|setImmediate`(定时器必须走 ctx 的自动回收形态,
 *    否则卸载残留,SOP S2 的 Cordis 回收验证过不了)。行级扫描、跳过注释。
 * 2. CORD002/003 provide 可交换接口形态:tools/ 下每个非 barrel 的 .ts 模块必须导出
 *    `<NAME>_SERVICE_ID` 唯一 ID 常量 + 含 `readonly id: typeof <NAME>_SERVICE_ID`
 *    的导出接口(注册表 + 唯一 ID,@eterna/governance 同款约定:GOVERNANCE_SERVICE_ID)。
 * 3. CORD004 命名空间:SERVICE_ID 值必须在包名 scope 下(`@<industry>/*`,08 号文档 §1.3)。
 * 4. CORD005 注册表唯一:SERVICE_ID 值跨模块不得重复。
 *
 * 局限(README 记录):effect 是否真配逆(逆闭包语义)无法静态判定,由 SOP S2
 * 「卸载无残留」运行时验证与 governance 审计覆盖;本检查只钉形态面。
 */
import { basename } from 'node:path'
import { stripCommentsLineByLine } from './util.ts'
import { error } from './types.ts'
import type { Finding } from './types.ts'
import type { SkillFile } from './pack.ts'

/** 旁路全局黑名单:匹配即 CORD001(coeffect 全声明的静态反面)。
 * 定时器用 (?<!\.) 前置否定:ctx.setTimeout 形态(经 ctx、自动 dispose)不算旁路。 */
const BANNED_GLOBALS: readonly { readonly pattern: RegExp; readonly reason: string }[] = [
  { pattern: /\bglobalThis\b/, reason: '旁路全局对象:一切能力须经 ctx 注入(coeffect 全声明)' },
  { pattern: /\bprocess\.env\b/, reason: '旁路环境变量:配置走插件 Config 声明,不读裸 env' },
  { pattern: /(?<!\.)\bsetTimeout\s*\(/, reason: '裸定时器逃逸 Cordis 回收:请用 ctx.setTimeout(自动 dispose,effect 配逆)' },
  { pattern: /(?<!\.)\bsetInterval\s*\(/, reason: '裸定时器逃逸 Cordis 回收:请用 ctx.setInterval(自动 dispose,effect 配逆)' },
  { pattern: /(?<!\.)\bsetImmediate\s*\(/, reason: '裸即时任务逃逸 Cordis 回收:请走 ctx 调度' },
]

const SERVICE_ID_CONST_RE = /export\s+const\s+([A-Z][A-Z0-9_]*)_SERVICE_ID\s*=\s*['"]([^'"\s]+)['"]/
const SERVICE_ID_IFACE_RE = /readonly\s+id:\s*typeof\s+([A-Z][A-Z0-9_]*)_SERVICE_ID/

export interface ServiceIdExport {
  readonly module: string
  readonly constName: string
  readonly value: string
}

/** 单模块扫描:旁路全局 + 可交换接口形态。barrel(index.ts)只扫全局。 */
export function lintToolModule(source: SkillFile, expectedScope: string | undefined): {
  readonly findings: readonly Finding[]
  readonly serviceIds: readonly ServiceIdExport[]
} {
  const findings: Finding[] = []
  const rel = source.relPath
  const stripped = stripCommentsLineByLine(source.text)
  const code = stripped.map(l => l.text).join('\n')

  for (const { pattern, reason } of BANNED_GLOBALS) {
    for (const line of stripped) {
      const match = pattern.exec(line.text)
      if (match) {
        findings.push(error('CORD001', `${rel}:${String(line.line)}`, `${match[0]}:${reason}`))
      }
    }
  }

  if (basename(rel) === 'index.ts') {
    return { findings, serviceIds: [] }
  }

  const serviceIds: ServiceIdExport[] = []
  const constMatches = [...code.matchAll(new RegExp(SERVICE_ID_CONST_RE.source, 'g'))]
  if (constMatches.length === 0) {
    findings.push(error(
      'CORD002',
      rel,
      `未导出 <NAME>_SERVICE_ID 唯一 ID 常量(provide 可交换接口要求注册表 + 唯一 ID 形态,如 export const ${toScreamingSnake(rel)}_SERVICE_ID = '@scope/name')`,
    ))
  }
  for (const match of constMatches) {
    const constName = match[1] ?? ''
    const value = match[2] ?? ''
    serviceIds.push({ module: rel, constName, value })
    if (!SERVICE_ID_IFACE_RE.test(code) || !code.includes(`readonly id: typeof ${constName}_SERVICE_ID`)) {
      findings.push(error(
        'CORD003',
        rel,
        `导出了 ${constName}_SERVICE_ID 但缺少含 readonly id: typeof ${constName}_SERVICE_ID 的导出接口(可交换接口形态)`,
      ))
    }
    if (expectedScope !== undefined && !value.startsWith(`@${expectedScope}/`)) {
      findings.push(error(
        'CORD004',
        rel,
        `SERVICE_ID "${value}" 不在包命名空间 @${expectedScope}/ 下(接口 ID 必须用 @<industry>/* 作用域,peer range 保守)`,
      ))
    }
  }
  return { findings, serviceIds }
}

/** pack 级:SERVICE_ID 注册表唯一性。 */
export function lintServiceIdRegistry(all: readonly ServiceIdExport[]): readonly Finding[] {
  const seen = new Map<string, string>()
  const findings: Finding[] = []
  for (const item of all) {
    const dupOf = seen.get(item.value)
    if (dupOf !== undefined) {
      findings.push(error('CORD005', item.module, `SERVICE_ID "${item.value}" 与 ${dupOf} 重复(注册表唯一 ID)`))
    } else {
      seen.set(item.value, item.module)
    }
  }
  return findings
}

function toScreamingSnake(relPath: string): string {
  const stem = relPath.split('/').pop()?.replace(/\.ts$/, '') ?? 'TOOL'
  const parts = stem.split(/[-_.]/).filter(p => p.length > 0)
  return (parts.length > 0 ? parts : ['TOOL']).map(p => p.toUpperCase()).join('_')
}
