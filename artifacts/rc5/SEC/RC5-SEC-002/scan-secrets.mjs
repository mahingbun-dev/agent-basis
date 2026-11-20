// SEC-002 (static half): no credential material in git-tracked files.
// Prints only maskable metadata (rule, path, line, masked prefix/suffix), never the secret itself.
import { spawnSync } from 'node:child_process'
import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
const root = '/Users/sunny/code/agent-basis-rc5'
const listed = spawnSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 })
if (listed.status !== 0) { console.error('git ls-files failed'); process.exit(2) }
const files = listed.stdout.toString('utf8').split('\0').filter(Boolean)
const rules = [
  ['private-key-block', /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY(?: BLOCK)?-----/g],
  ['aws-access-key-id', /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g],
  ['github-token', /\bgh[pousr]_[A-Za-z0-9]{36,}\b/g],
  ['github-fine-grained-pat', /\bgithub_pat_[A-Za-z0-9_]{50,}\b/g],
  ['openai-style-key', /\bsk-[A-Za-z0-9]{20,}\b/g],
  ['slack-token', /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g],
  ['google-api-key', /\bAIza[0-9A-Za-z_-]{35}\b/g],
  ['jwt', /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g],
]
const assign = /\b(api[_-]?key|secret[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|password)\b\s*[:=]\s*['"]([^'"\n]{12,})['"]/gi
const placeholder = /(?:\$\{|\$[A-Z_]+|process\.env|<[^>]+>|example|placeholder|changeme|change-me|your[-_]|dummy|fake|test|xxxx|\*\*\*|\.\.\.|redacted|sample|token-here|key-here|secret-here)/i
const hits = []
const scanned = []
let skippedBinary = 0
for (const rel of files) {
  const abs = join(root, rel)
  let size
  try { size = statSync(abs).size } catch { continue }
  if (size === 0 || size > 2_000_000) continue
  if (/\.(png|jpe?g|gif|webp|ico|pdf|zip|gz|tgz|woff2?|ttf|otf|mp4|mov|sqlite|db)$/i.test(rel)) continue
  let text
  try { text = readFileSync(abs, 'utf8') } catch { continue }
  if (text.includes('\0')) { skippedBinary += 1; continue }
  scanned.push(rel)
  const lines = text.split('\n')
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]
    const add = (rule, value) => {
      const masked = value.length <= 6 ? `***(${value.length})` : `${value.slice(0, 2)}***${value.slice(-2)}(${value.length})`
      hits.push({ rule, path: rel, line: i + 1, masked })
    }
    for (const [rule, re] of rules) {
      re.lastIndex = 0
      let m
      while ((m = re.exec(line)) !== null) add(rule, m[0])
    }
    assign.lastIndex = 0
    let m
    while ((m = assign.exec(line)) !== null) {
      if (placeholder.test(m[2])) continue
      add(`assigned-${m[1].toLowerCase()}`, m[2])
    }
  }
}
console.log(`tracked files=${files.length} scanned_text=${scanned.length} skipped_binary=${skippedBinary}`)
for (const h of hits) console.log(`HIT ${h.rule} ${h.path}:${h.line} value=${h.masked}`)
console.log(`summary: hits=${hits.length}`)
process.exit(hits.length === 0 ? 0 : 1)
