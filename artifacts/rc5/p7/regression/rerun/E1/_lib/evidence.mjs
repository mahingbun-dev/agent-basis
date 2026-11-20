/**
 * E1 容器能力套件证据记账：每个用例一个目录，含 cmd.log + result.md。
 *
 * - cmd.log：命令原文（脱敏）+ EXIT + 输出；
 * - result.md：结论 / 预期 / 实际 / 备注 / 附件（截图等）。
 * 凭据纪律：redact() 覆盖 token/cookie/密码/密钥明文；调用方只传状态码与形状。
 */
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
export const EVIDENCE_ROOT = resolve(here, '..')

export const STATUS = { PASS: 'PASS', FAIL: 'FAIL', SKIP: 'SKIP', NOTRUN: 'NOTRUN' }

export function redact(text) {
  if (typeof text !== 'string') return String(text)
  return text
    .replace(/token=[A-Za-z0-9_.-]+/g, 'token=<redacted>')
    .replace(/(eterna_session=)[^;,\s]+/g, '$1<redacted>')
    .replace(/(dsh-auth=)[^;,\s]+/g, '$1<redacted>')
    .replace(/("?(?:password|secret|token|authorization|mimo_api_key)"?\s*[:=]\s*)"?[^",\s]*"?/gi, '$1"<redacted>"')
    .replace(/(mcp-session-id:\s*)[^\s]+/gi, '$1<redacted>')
}

export function shape(value, max = 240) {
  let text
  try {
    text = typeof value === 'string' ? value : JSON.stringify(value)
  } catch {
    text = String(value)
  }
  const clean = redact(text ?? '')
  return clean.length > max ? `${clean.slice(0, max)}…` : clean
}

export class Case {
  constructor(suite, id) {
    this.suite = suite
    this.id = id
    this.dir = join(EVIDENCE_ROOT, suite, id)
    mkdirSync(this.dir, { recursive: true })
    this.cmdPath = join(this.dir, 'cmd.log')
    this.startedAt = new Date().toISOString()
    writeFileSync(this.cmdPath, `# ${suite}/${id}\n# started ${this.startedAt}\n`)
    this.rows = []
  }

  /** 记录一条命令执行（不含真实凭据；display 可写等价说明命令）。 */
  cmd(display, exit, stdout = '', stderr = '') {
    const text = `\n$ ${display}\nEXIT=${exit}\n${redact(String(stdout)).trimEnd()}\n${stderr === '' ? '' : `STDERR:\n${redact(String(stderr)).trimEnd()}\n`}`
    appendFileSync(this.cmdPath, text)
    this.rows.push({ display, exit })
    return this
  }

  /** 记录断言（进 cmd.log，命令列写断言名）。 */
  assert(name, ok, detail = '') {
    appendFileSync(this.cmdPath, `\n[ASSERT] ${name} => ${ok ? 'PASS' : 'FAIL'}${detail === '' ? '' : ` :: ${redact(String(detail))}`}\n`)
    return ok
  }

  note(text) {
    appendFileSync(this.cmdPath, `\n# note: ${redact(String(text))}\n`)
    return this
  }

  /** 收尾写 result.md；返回结果对象。 */
  finish({ status, title, expected, actual, notes = [], artifacts = [] }) {
    this.status = status
    this.finishedAt = new Date().toISOString()
    const lines = [
      `# ${this.id} · ${title}`,
      '',
      `- 套件：${this.suite}`,
      `- 结论：**${status}**`,
      `- 开始/结束：${this.startedAt} / ${this.finishedAt}`,
      '',
      '## 预期',
      '',
      expected,
      '',
      '## 实际',
      '',
      actual,
      '',
    ]
    if (notes.length > 0) lines.push('## 备注', '', ...notes.map(item => `- ${item}`), '')
    if (artifacts.length > 0) lines.push('## 证据附件', '', ...artifacts.map(item => `- \`${item}\``), '')
    if (this.rows.length > 0) {
      lines.push('## 执行命令', '', '```')
      for (const row of this.rows) lines.push(`$ ${row.display}  # EXIT=${row.exit}`)
      lines.push('```', '')
    }
    writeFileSync(join(this.dir, 'result.md'), lines.join('\n'))
    return { id: this.id, status, title }
  }
}

export function summaryOf(rows, { suite, env }) {
  const counts = { PASS: 0, FAIL: 0, SKIP: 0, NOTRUN: 0 }
  for (const row of rows) counts[row.status] = (counts[row.status] ?? 0) + 1
  return {
    suite,
    commit: env?.commit ?? '',
    imageTag: env?.imageTag ?? '',
    imageId: env?.imageId ?? '',
    container: env?.container ?? '',
    base: env?.base ?? '',
    dataRoot: env?.dataRoot ?? '',
    startedAt: env?.startedAt ?? '',
    finishedAt: new Date().toISOString(),
    total: rows.length,
    pass: counts.PASS,
    fail: counts.FAIL,
    skip: counts.SKIP,
    notrun: counts.NOTRUN,
    counts,
    halted: env?.halted ?? false,
    haltReason: env?.haltReason ?? '',
    failures: rows.filter(row => row.status === STATUS.FAIL),
    cases: rows,
  }
}

export function writeSummary(suite, payload) {
  const dir = join(EVIDENCE_ROOT, suite)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const path = join(dir, 'summary.json')
  writeFileSync(path, `${JSON.stringify(payload, null, 2)}\n`)
  return path
}