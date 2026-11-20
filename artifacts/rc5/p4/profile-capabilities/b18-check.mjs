import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
const repo = '/Users/sunny/code/agent-basis-rc5'
const web = JSON.parse(readFileSync(join(repo, 'docker/profile/package.json'), 'utf8')).dsh.profile.bundles
const acp = JSON.parse(readFileSync(join(repo, 'docker/profile/package.acp.json'), 'utf8')).dsh.profile.bundles
const dshPkg = JSON.parse(readFileSync(join(repo, 'node_modules/@deepseek-ai/dsh/package.json'), 'utf8'))
const obDir = readdirSync(join(repo, 'node_modules/.pnpm')).find((d) => d.startsWith('@deepseek-ai+dsh-official-bundles@0.2.2-rc.5'))
const obSrc = readFileSync(join(repo, 'node_modules/.pnpm', obDir, 'node_modules/@deepseek-ai/dsh-official-bundles/src/bundles.ts'), 'utf8')
const startIdx = obSrc.indexOf('export const OPTIONAL_BUNDLES')
const eqIdx = obSrc.indexOf('= [', startIdx)
const block = obSrc.slice(eqIdx, obSrc.indexOf(']', eqIdx))
const optional = [...block.matchAll(/'(@deepseek-ai\/[^']+)'/g)].map((m) => m[1])
const pnpm = readdirSync(join(repo, 'node_modules/.pnpm'))
const stripVer = (name) => name.replace(/^@deepseek-ai\//, '@deepseek-ai+')
const installed = (name) => pnpm.some((d) => d.startsWith(`${stripVer(name)}@`))
const expectedWeb = ['@deepseek-ai/dsh-base','@deepseek-ai/dsh-web-app','@deepseek-ai/dsh-deepseek-chat-import','@deepseek-ai/dsh-experimental-session-search','@deepseek-ai/dsh-experimental-plugin-market-bundle','@deepseek-ai/dsh-experimental-terminal-bundle']
const expectedAcp = ['@deepseek-ai/dsh-base','@deepseek-ai/dsh-acp-app']
const checks = [
  ['OPTIONAL_BUNDLES count = 16', optional.length === 16, optional.length],
  ['web bundles exact (base+web-app+chat-import+session-search+plugin-market+terminal)', JSON.stringify(web) === JSON.stringify(expectedWeb), web],
  ['acp bundles exact (base+acp-app)', JSON.stringify(acp) === JSON.stringify(expectedAcp), acp],
  ['every optional bundle is a dependency of installed dsh@0.2.2-rc.5', optional.every((n) => Object.hasOwn(dshPkg.dependencies, n)), optional.filter((n) => !Object.hasOwn(dshPkg.dependencies, n))],
  ['every optional bundle installed in .pnpm store', optional.every(installed), optional.filter((n) => !installed(n))],
  ['default-open optional set = chat-import + session-search + plugin-market (+terminal per B20)', [...optional.filter((n) => web.includes(n))].sort().join('|') === ['@deepseek-ai/dsh-experimental-session-search','@deepseek-ai/dsh-experimental-plugin-market-bundle','@deepseek-ai/dsh-experimental-terminal-bundle','@deepseek-ai/dsh-deepseek-chat-import'].sort().join('|'), optional.filter((n) => web.includes(n))],
  ['default-off optional count = 12', optional.filter((n) => !web.includes(n)).length === 12, optional.filter((n) => !web.includes(n))],
  ['acp includes no optional bundle', optional.every((n) => !acp.includes(n)), acp],
]
let fail = 0
for (const [label, ok, detail] of checks) {
  if (!ok) fail += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label} — ${JSON.stringify(detail)}`)
}
console.log(`\nOPTIONAL_BUNDLES (${optional.length}):`)
for (const n of optional) console.log(`  ${web.includes(n) ? 'OPEN' : 'off '}  ${n}`)
process.exitCode = fail === 0 ? 0 : 1
