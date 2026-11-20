// SEC-003 (static half): telemetry rows are disabled in every product profile,
// and no telemetry/analytics SDK is declared by the workspace.
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
const root = '/Users/sunny/code/agent-basis-rc5'
let fail = 0
const check = (name, ok, detail) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}: ${detail}`); if (!ok) fail += 1 }
const rows = ['otel', 'session-telemetry-otel', 'desktop-product-telemetry', 'product-analytics']
const profiles = [
  ['docker/profile/cordis.patch.yml.template', ['otel', 'session-telemetry-otel', 'desktop-product-telemetry', 'product-analytics']],
  ['docker/profile/cordis.super.patch.yml.template', ['otel', 'session-telemetry-otel', 'desktop-product-telemetry', 'product-analytics']],
  ['docker/profile/cordis.acp.patch.yml.template', ['otel', 'session-telemetry-otel']],
]
for (const [rel, expected] of profiles) {
  const lines = readFileSync(join(root, rel), 'utf8').split('\n')
  for (const id of expected) {
    const at = lines.findIndex(line => line.trim() === `- id: ${id}`)
    let disabled = false
    if (at !== -1) {
      for (let i = at + 1; i < lines.length && lines[i].trim() !== '' && !/^\s*- id:/.test(lines[i]); i += 1) {
        if (/^\s*disabled:\s*true\s*$/.test(lines[i])) disabled = true
      }
    }
    check(`${rel} ${id} disabled`, at !== -1 && disabled, at === -1 ? 'row missing' : `line ${at + 1} disabled=${disabled}`)
  }
}
const sdk = /^(?:@opentelemetry\/|@sentry\/|posthog-js$|posthog-node$|mixpanel|analytics-node$|segment|dd-trace$)/
const manifests = []
const walk = dir => { for (const e of readdirSync(dir, { withFileTypes: true })) { if (e.name === 'node_modules' || e.name === '.git' || e.name === 'artifacts') continue; const abs = join(dir, e.name); if (e.isDirectory()) walk(abs); else if (e.name === 'package.json') manifests.push(abs) } }
walk(root)
const bad = []
for (const abs of manifests) {
  const pkg = JSON.parse(readFileSync(abs, 'utf8'))
  for (const field of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
    for (const name of Object.keys(pkg[field] ?? {})) if (sdk.test(name)) bad.push(`${relative(root, abs)} ${name}`)
  }
}
check('no telemetry/analytics SDK dependency in workspace manifests', bad.length === 0, bad.length === 0 ? `${manifests.length} manifests scanned` : bad.join('; '))
// Product source must not reference telemetry endpoints/SDKs (docs/scripts/profile are out of scope).
const srcHits = []
const walkSrc = dir => { for (const e of readdirSync(dir, { withFileTypes: true })) { if (['node_modules', 'lib', 'dist', 'tests', 'docs', 'artifacts'].includes(e.name)) continue; const abs = join(dir, e.name); if (e.isDirectory()) walkSrc(abs); else if (/\.(ts|tsx|mjs|js)$/.test(e.name)) { const text = readFileSync(abs, 'utf8'); if (/\b(telemetry|posthog|mixpanel|sentry|opentelemetry|dd-trace)\b/i.test(text)) srcHits.push(relative(root, abs)) } } }
for (const d of ['packages', 'core', 'tools']) walkSrc(join(root, d))
check('no telemetry SDK reference in product source', srcHits.length === 0, srcHits.length === 0 ? '0 hits' : srcHits.join(', '))
console.log('NOTE: 运行时抓包未执行(E0 不启容器);本结果只覆盖 profile 配置与依赖/源码静态面。')
console.log(`SUMMARY failures=${fail}`)
process.exit(fail === 0 ? 0 : 1)
