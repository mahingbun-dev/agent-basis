#!/usr/bin/env node
/**
 * T52 证据脱敏：只对本目录（artifacts/rc5/p7/regression/**）内的日志/报告做
 * token/cookie 值替换，计数写 SANITIZE.md。源码/脚本不在此列。
 */
import { appendFileSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = '/Users/sunny/code/agent-basis-rc5/artifacts/rc5/p7/regression'
const TEXT = /\.(log|md|json|txt|yml|jsonl)$/i
const RULES = [
  [/token=[A-Za-z0-9_-]{12,}/g, 'token=<redacted>'],
  [/(eterna_session=)[^;\s"']+/g, '$1<redacted>'],
  [/(dsh-auth=)[^;\s"']+/g, '$1<redacted>'],
  [/(mcp-session-id:\s*)[^\s"]+/gi, '$1<redacted>'],
  [/("?(?:password|secret|authorization)"?\s*:\s*")[^"]{8,}(")/gi, '$1<redacted>$2'],
]

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    const info = statSync(path)
    if (info.isDirectory()) walk(path, out)
    else if (TEXT.test(name)) out.push(path)
  }
  return out
}

const rows = []
let total = 0
for (const path of walk(ROOT)) {
  if (path.endsWith('SANITIZE') || path.includes('SANITIZE-HISTORY') || path.endsWith('SANITIZE.md')) continue
  const before = readFileSync(path, 'utf8')
  let text = before
  let hits = 0
  for (const [pattern, replacement] of RULES) {
    text = text.replace(pattern, (...args) => {
      hits += 1
      return typeof replacement === 'string' ? replacement : replacement(...args)
    })
  }
  if (hits > 0) {
    writeFileSync(path, text)
    total += hits
    rows.push(`| ${relative(ROOT, path)} | ${hits} |`)
  }
}

// 全量脱敏足迹：统计所有文件里残留的 <redacted> 标记（含多轮脱敏累计）
const footprint = []
let footTotal = 0
for (const path of walk(ROOT)) {
  if (path.endsWith('SANITIZE.md') || path.endsWith('SANITIZE-HISTORY.md')) continue
  const text = readFileSync(path, 'utf8')
  const n = (text.match(/<redacted>/g) ?? []).length
  if (n > 0) {
    footprint.push(`| ${relative(ROOT, path)} | ${n} |`)
    footTotal += n
  }
}

const lines = [
  '# T52 证据脱敏记录',
  '',
  `- 时间：${new Date().toISOString()}`,
  '- 范围：`artifacts/rc5/p7/regression/**` 内 .log/.md/.json/.txt/.yml/.jsonl（脚本与源码不在内）',
  '- 规则：`token=`、`eterna_session=`、`dsh-auth=`、`mcp-session-id:`、password/secret/authorization 值',
  `- 本次运行新增替换：**${total}** 处 / ${rows.length} 个文件（幂等复核时通常为 0）`,
  `- 全量脱敏足迹（累计标记）：**${footTotal}** 处 / ${footprint.length} 个文件`,
  '',
  '## 本次新增',
  '',
  '| 文件 | 替换次数 |',
  '|---|---:|',
  ...(rows.length ? rows : ['| （无新增，所有匹配值已在此前轮次脱敏） | 0 |']),
  '',
  '## 累计足迹',
  '',
  '| 文件 | 脱敏标记数 |',
  '|---|---:|',
  ...footprint,
  '',
  '> 替换只抹去凭据值，保留字段名与上下文；被抹位置的字段名足以复核事件类型。',
  '> 每轮运行记录追加在 `SANITIZE-HISTORY.md`。',
  '',
]
writeFileSync(join(ROOT, 'SANITIZE.md'), lines.join('\n'))
appendFileSync(join(ROOT, 'SANITIZE-HISTORY.md'), `- ${new Date().toISOString()} replacements=${total} files=${rows.length} footprint=${footTotal}/${footprint.length}\n`)
console.log(`sanitized files=${rows.length} replacements=${total} footprint=${footTotal}/${footprint.length}`)