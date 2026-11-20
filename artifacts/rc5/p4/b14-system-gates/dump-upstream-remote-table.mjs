// T25 证据工具:解析锁版 @deepseek-ai/dsh-mcp-manager 的 Remote 方法表(仅名字/模式,
// 不含配置值)。用法(仓库根):node artifacts/rc5/p4/b14-system-gates/dump-upstream-remote-table.mjs
import { readdirSync, readFileSync, existsSync } from 'node:fs'

const root = 'node_modules/.pnpm'
const dirs = readdirSync(root).filter(n => n.startsWith('@deepseek-ai+dsh-mcp-manager@'))
if (dirs.length === 0) {
  console.error('找不到 @deepseek-ai/dsh-mcp-manager(rc.5 锁版)')
  process.exit(1)
}
for (const dir of dirs) {
  const base = `${root}/${dir}/node_modules/@deepseek-ai/dsh-mcp-manager`
  if (!existsSync(`${base}/package.json`)) continue
  const pkg = JSON.parse(readFileSync(`${base}/package.json`, 'utf8'))
  const lines = readFileSync(`${base}/lib/typert.remote-client.js`, 'utf8').split('\n')
  const keyRe = /^\s{4}'([\w-]+\/[\w-]+)': \{/
  const methods = []
  let current
  let start = -1
  for (let i = 0; i < lines.length; i++) {
    const match = keyRe.exec(lines[i] ?? '')
    if (match === null) continue
    if (current !== undefined) methods.push([current, lines.slice(start, i).join('\n')])
    current = match[1]
    start = i
  }
  if (current !== undefined) methods.push([current, lines.slice(start).join('\n')])
  console.log(`package=${pkg.name} version=${pkg.version} dir=${dir}`)
  for (const [action, segment] of methods) {
    console.log(`  ${action}  mode=${/mode: 'stream'/.test(segment) ? 'stream' : 'unary'}`)
  }
}