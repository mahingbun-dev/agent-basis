// SEC-002 (runtime half): scan image filesystem / argv / container logs for credential material.
// Prints only maskable metadata (rule, path, masked value), never the secret itself.
// Scope (documented, no host secrets): fresh container from the test image (no host mounts) +
// running lane argv + last 2000 log lines. Env values are NOT flagged: env/.env is the allowed
// credential channel (AGENTS.md); the rule is that credentials must not land in tracked files,
// image layers, argv or logs.
// Third-party vendor trees (node_modules / .pnpm / .git) are excluded: they ship their own
// upstream test fixtures (zod JWT samples, jose key blocks), which are not our credential
// material and cannot contain our secrets. Product-owned paths are scanned unfiltered.
import { spawnSync } from 'node:child_process'

const IMAGE = 'eterna-agent:rc5-test'
const CONTAINER = 'rc5-e1suite'
const SCAN_PATHS = ['/app', '/data', '/opt', '/fixtures', '/repo', '/usr/local/lib/node_modules/@deepseek-ai', '/usr/local/lib/node_modules/@eterna']

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
const placeholder = /(?:\$\{|\$[A-Z_]+|process\.env|<[^>]+>|example|placeholder|changeme|change-me|your[-_]|dummy|fake|test|xxxx|\*\*\*|\.\.\.|redacted|sample|token-here|key-here|secret-here)/i

const grepPattern = [
  '-----BEGIN (RSA |EC |DSA |OPENSSH )?PRIVATE KEY( BLOCK)?-----',
  '\\b(AKIA|ASIA)[0-9A-Z]{16}\\b',
  '\\bgh[pousr]_[A-Za-z0-9]{36,}\\b',
  '\\bgithub_pat_[A-Za-z0-9_]{50,}\\b',
  '\\bsk-[A-Za-z0-9]{20,}\\b',
  '\\bxox[abprs]-[A-Za-z0-9-]{10,}\\b',
  '\\bAIza[0-9A-Za-z_-]{35}\\b',
  '\\beyJ[A-Za-z0-9_-]{8,}\\.eyJ[A-Za-z0-9_-]{8,}\\.[A-Za-z0-9_-]{8,}\\b',
].join('|')

function mask(value) {
  return value.length <= 6 ? `***(${value.length})` : `${value.slice(0, 2)}***${value.slice(-2)}(${value.length})`
}

function scanText(text, label) {
  const hits = []
  for (const line of text.split('\n')) {
    for (const [rule, re] of rules) {
      re.lastIndex = 0
      let m
      while ((m = re.exec(line)) !== null) {
        if (placeholder.test(m[0])) continue
        hits.push({ rule, label, masked: mask(m[0]) })
      }
    }
  }
  return hits
}

const hits = []

// 0) 自检：确认容器内 grep 方言能命中已知假 key（防止“永远 0 命中”的假绿）
const probePattern = 'sk-[A-Za-z0-9]{20,}'
const selfTest = spawnSync('docker', ['run', '--rm', '--entrypoint', 'sh', IMAGE, '-c',
  `echo "sk-ABCDEFGHIJKLMNOPQRSTUVWXYZ12345" > /tmp/probe.txt; grep -InE -- '${probePattern}' /tmp/probe.txt > /dev/null`,
], { encoding: 'utf8', timeout: 60_000 })
const selfOk = selfTest.status === 0
console.log(`self_test=${selfOk}（容器内 grep 对已知假 key 命中）`)

// 1) image filesystem（fresh container，无宿主挂载）
const script = `for p in ${SCAN_PATHS.join(' ')}; do [ -d "$p" ] && grep -rInE --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=.pnpm -- '${grepPattern.replace(/'/g, `'\\''`)}' "$p" 2>/dev/null | head -200; done`
const fsScan = spawnSync('docker', ['run', '--rm', '--entrypoint', 'sh', IMAGE, '-c', script], {
  encoding: 'utf8', timeout: 300_000, maxBuffer: 64 * 1024 * 1024,
})
const fsText = `${fsScan.stdout ?? ''}`
for (const line of fsText.split('\n').filter(Boolean)) {
  const at = line.indexOf(':')
  const label = at > 0 ? line.slice(0, at) : 'image'
  const body = line.slice(at + 1)
  for (const [rule, re] of rules) {
    re.lastIndex = 0
    let m
    while ((m = re.exec(body)) !== null) {
      if (placeholder.test(m[0])) continue
      hits.push({ rule, label: `image:${label}`, masked: mask(m[0]) })
    }
  }
}

// 2) argv（Config.Cmd/Entrypoint + 运行中进程 args）
const inspect = spawnSync('docker', ['inspect', CONTAINER, '--format', '{{json .Config.Entrypoint}} {{json .Config.Cmd}}'], { encoding: 'utf8' })
const top = spawnSync('docker', ['top', CONTAINER, '-eo', 'args'], { encoding: 'utf8' })
hits.push(...scanText(inspect.stdout ?? '', 'argv:config'))
hits.push(...scanText(top.stdout ?? '', 'argv:top'))

// 3) 容器日志（最后 2000 行）
const logs = spawnSync('docker', ['logs', '--tail', '2000', CONTAINER], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
hits.push(...scanText(`${logs.stdout ?? ''}\n${logs.stderr ?? ''}`, 'logs'))

console.log(`runtime scope: image=${IMAGE} paths=${SCAN_PATHS.join(',')}; argv=${CONTAINER}; logs=tail2000`)
console.log(`image grep exit=${fsScan.status ?? -1} bytes=${fsText.length}`)
for (const hit of hits) console.log(`HIT ${hit.rule} ${hit.label} value=${hit.masked}`)
console.log(`summary: hits=${hits.length}`)
process.exit(hits.length === 0 && selfOk && (fsScan.status === 0 || fsScan.status === 1) ? 0 : 1)