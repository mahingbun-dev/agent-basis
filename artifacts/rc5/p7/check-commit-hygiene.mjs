// T52 提交前卫生检查：只读 git 状态/文件，不改任何文件。
// 1) 禁止路径：.secrets/.env/运行态 DB/凭据文件/node_modules/.pnpm-store
// 2) 高置信凭据：私钥块/AWS/GitHub/Slack/Google/JWT/Bearer/Cookie 实值
// 3) 非阻断告警：测试夹具里的固定口令字面量（如 password8；SEC-002 已知项）
// 输出 ASSERT 行与 EXIT；任何 1)/2) 命中即 EXIT=1。
import { execSync } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const fails = []
const warns = []
const ok = (name, cond, detail = '') => {
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${name}${detail ? ' ' + detail : ''}`)
  if (!cond) fails.push(name)
}

const status = execSync('git status --porcelain -uall', { cwd: root, encoding: 'utf8' })
  .split('\n')
  .filter(Boolean)
const paths = status.map((line) => line.slice(3).trim().replace(/^"(.*)"$/, '$1'))

// ---------- 1) 禁止路径 ----------
const allowExample = (p) => /(^|\/)\.env\.example$/.test(p) || /env\.production\.example$/.test(p) || /(^|\/)\.env\.example\./.test(p)
const forbidden = [
  /(^|\/)\.secrets(\/|$)/,
  /(^|\/)\.env$/, /(^|\/)\.env\.(?!example)/,
  /(^|\/)users\.db(-wal|-shm)?$/, /\.(sqlite|sqlite3|db-wal|db-shm)$/,
  /(^|\/)node_modules\//, /(^|\/)\.pnpm-store\//,
  /(^|\/)relay-token$/, /companion-tokens\.json$/, /\.credentials\.yaml$/, /routing-diagnose\.json$/,
]
const badPaths = paths.filter((p) => !allowExample(p) && forbidden.some((re) => re.test(p)))
ok('FORBIDDEN_PATHS_0', badPaths.length === 0, badPaths.slice(0, 20).join(','))

// ---------- 2) 高置信凭据 ----------
const skipExt = /\.(png|jpe?g|gif|webp|ico|pdf|zip|gz|tgz|woff2?|ttf|otf|mp4|mov|sqlite|db|docx|xlsx|pptx)$/i
const secretRules = [
  ['private-key', /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY(?: BLOCK)?-----/],
  ['aws-key', /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/],
  ['github-token', /\bgh[pousr]_[A-Za-z0-9]{36,}\b/],
  ['slack-token', /\bxox[abprs]-[A-Za-z0-9-]{10,}/],
  ['google-key', /\bAIza[0-9A-Za-z_-]{35}\b/],
  ['jwt', /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/],
  ['bearer-value', /Authorization:\s*Bearer\s+([A-Za-z0-9._~+/=-]{16,})/i],
  ['cookie-value', /(?:^|[;]\s*)(?:Cookie|set-cookie):\s*eterna_session=([A-Za-z0-9._%+=/-]{16,})/i],
]
const testPassword = /\bpassword\s*:\s*['"]([^'"\n]{6,})['"]/g
const testValue = /^(?:password\d+|test[-_]?pass(?:word)?\d*|admin\d*|secret\d+|fake[-_]?\w+|dummy[-_]?\w+)$/i
const hits = []
let scanned = 0
let skipped = 0
for (const rel of paths) {
  const abs = join(root, rel)
  if (!existsSync(abs)) {
    skipped++
    continue
  }
  const st = statSync(abs)
  if (st.isDirectory() || st.size === 0 || st.size > 5_000_000 || skipExt.test(rel)) {
    skipped++
    continue
  }
  let text
  try {
    text = readFileSync(abs, 'utf8')
  } catch {
    skipped++
    continue
  }
  if (text.includes('\0')) {
    skipped++
    continue
  }
  scanned++
  const lines = text.split('\n')
  for (let i = 0; i < lines.length; i++) {
    for (const [rule, re] of secretRules) {
      if (re.test(lines[i])) hits.push(`${rule} ${rel}:${i + 1}`)
    }
    testPassword.lastIndex = 0
    let m
    while ((m = testPassword.exec(lines[i])) !== null) {
      if (!testValue.test(m[1])) warns.push(`${rel}:${i + 1}`)
    }
  }
}
ok('HIGH_CONFIDENCE_SECRETS_0', hits.length === 0, hits.slice(0, 20).join(' | '))
console.log(`INFO scanned=${scanned} skipped=${skipped} files=${paths.length}`)
console.log(`WARN test-fixture-password-assignments=${warns.length}${warns.length ? ' e.g. ' + warns.slice(0, 5).join(',') : ''}`)

// ---------- 3) diff 新增行高置信扫描 ----------
let diff = ''
try {
  diff = execSync('git diff -- . ":!artifacts/rc5"', { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
} catch {
  diff = ''
}
const added = diff.split('\n').filter((l) => l.startsWith('+') && !l.startsWith('+++'))
const addedHits = []
for (const line of added) {
  for (const [rule, re] of secretRules) if (re.test(line)) addedHits.push(rule)
}
ok('DIFF_ADDED_SECRETS_0', addedHits.length === 0, addedHits.slice(0, 10).join(','))
console.log(`INFO diff_added_lines=${added.length}`)

console.log(`RESULT=${fails.length === 0 ? 'PASS' : 'FAIL:' + fails.join(',')}`)
process.exit(fails.length === 0 ? 0 : 1)