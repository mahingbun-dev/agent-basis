// rc5 E0 UI static scanner (UI-002/003/004/005/007/008).
// Scope = files added/changed by feat/dsh-rc5-merge vs merge-base 9f40c2a
// under packages/*/src/client/** and packages/ui/src/** (artifacts/rc5/UI/_suite/scope.txt).
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
const root = '/Users/sunny/code/agent-basis-rc5'
const scope = readFileSync(join(root, 'artifacts/rc5/UI/_suite/scope.txt'), 'utf8').trim().split('\n').filter(Boolean)
const caseId = process.argv[2]
let fail = 0
const failIf = (name, ok, detail) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}: ${detail}`); if (!ok) fail += 1 }

// Remove line comments outside quotes and skip whole-line block-comment continuations.
function codeOf(line, rel) {
  if (!/\.(ts|tsx|js|mjs|css)$/.test(rel)) return line
  if (rel.endsWith('.css')) { const at = line.indexOf('/*'); return at === -1 ? line : line.slice(0, at) }
  const trimmed = line.trimStart()
  if (trimmed.startsWith('*') || trimmed.startsWith('/*') || trimmed.startsWith('//')) return ''
  let quote = null
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]
    if (quote !== null) { if (ch === '\\') { i += 1; continue } if (ch === quote) quote = null; continue }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue }
    if (ch === '/' && line[i + 1] === '/') return line.slice(0, i)
    if (ch === '/' && line[i + 1] === '*') return line.slice(0, i)
  }
  return line
}

const eachLine = fn => { for (const rel of scope) { const lines = readFileSync(join(root, rel), 'utf8').split('\n'); lines.forEach((line, i) => fn(rel, i + 1, codeOf(line, rel))) } }

if (caseId === 'UI-002') {
  const ladder = new Set(['8px', '12px', '16px', '22px', '28px', '36px', '9999px'])
  const tokenRe = /var\(--et-radius-(?:xs|sm|md|lg|xl|2xl|pill)\)/g
  const found = []
  eachLine((rel, n, line) => {
    const re = /(?:border-radius|borderRadius)\s*:\s*['"]?([^;,'"}\n]+)/g
    let m
    while ((m = re.exec(line)) !== null) found.push({ rel, n, value: m[1].trim(), line: line.trim() })
  })
  const tokenCount = found.filter(f => /var\(--et-radius-/.test(f.value)).length
  const pxBad = found.filter(f => /\d+px/.test(f.value) && !ladder.has((f.value.match(/\d+px/) ?? [])[0]))
  const pct = found.filter(f => f.value.includes('50%'))
  const zero = found.filter(f => f.value === '0' || f.value === '0px')
  const other = found.filter(f => !/var\(--et-radius-/.test(f.value) && !/\d+px/.test(f.value) && !f.value.includes('50%') && f.value !== '0' && f.value !== '0px')
  console.log(`scope files=${scope.length} radius declarations=${found.length}`)
  console.log(`tokens=${tokenCount} px_literal=${found.length - tokenCount - pct.length - zero.length - other.length} pct_50=${pct.length} zero=${zero.length} other=${other.length}`)
  for (const f of pxBad) console.log(`FAIL non-ladder px ${f.rel}:${f.n} ${f.value}`)
  for (const f of pct) console.log(`NOTE circle 50% (pre-existing, not added by this branch) ${f.rel}:${f.n} ${f.value}`)
  for (const f of zero) console.log(`NOTE square reset 0 ${f.rel}:${f.n} ${f.value}`)
  for (const f of other) console.log(`FAIL unrecognized radius ${f.rel}:${f.n} ${f.value}`)
  console.log('NOTE 嵌套同心弧需逐组件人工核对;本扫描只核对取值阶梯。')
  failIf('no non-ladder px radius', pxBad.length === 0, pxBad.length === 0 ? '0 处' : `${pxBad.length} 处`)
  failIf('no unrecognized radius literal', other.length === 0, other.length === 0 ? '0 处' : `${other.length} 处`)
} else if (caseId === 'UI-003') {
  const allowedNumeric = new Set(['400', '500', '600'])
  const allowedToken = /var\(--et-weight-(?:body|emphasis|display)\)/
  const found = []
  eachLine((rel, n, line) => {
    const re = /(?:font-weight|fontWeight)\s*:\s*['"]?([^;,'"}\n]+)/g
    let m
    while ((m = re.exec(line)) !== null) found.push({ rel, n, value: m[1].trim() })
  })
  const numeric = found.filter(f => /^\d+$/.test(f.value))
  const badNumeric = numeric.filter(f => !allowedNumeric.has(f.value))
  const tokens = found.filter(f => allowedToken.test(f.value))
  const other = found.filter(f => !/^\d+$/.test(f.value) && !allowedToken.test(f.value))
  console.log(`scope files=${scope.length} font-weight declarations=${found.length}`)
  console.log(`tokens=${tokens.length} numeric=${numeric.length} other=${other.length}`)
  for (const f of numeric) console.log(`numeric ${f.rel}:${f.n} ${f.value}`)
  for (const f of badNumeric) console.log(`FAIL weight outside 400/500/600 ${f.rel}:${f.n} ${f.value}`)
  for (const f of other) console.log(`FAIL unrecognized weight ${f.rel}:${f.n} ${f.value}`)
  const tokensFile = readFileSync(join(root, 'packages/ui/src/tokens.ts'), 'utf8')
  failIf('weight tokens are 400/500/600', /--et-weight-body:\s*400/.test(tokensFile) && /--et-weight-emphasis:\s*500/.test(tokensFile) && /--et-weight-display:\s*600/.test(tokensFile), 'tokens.ts:136-138')
  failIf('weights only 400/500/600', badNumeric.length === 0 && other.length === 0, `${badNumeric.length} numeric + ${other.length} other violations`)
  console.log('NOTE 正文不使用 numeric 500;500 仅经 --et-weight-emphasis 用于标题/强调(需目检标题层级)。')
} else if (caseId === 'UI-004') {
  let svg = 0, emoji = 0, iconImports = 0, upstreamIcon = 0
  const emojiRe = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}]/u
  eachLine((rel, n, line) => {
    if (/from '@eterna\/ui\/(?:icons|icon-data)'/.test(line)) iconImports += 1
    if (/from '@deepseek-ai\/[^']*icon/.test(line)) { upstreamIcon += 1; console.log(`FAIL upstream icon import ${rel}:${n} ${line.trim()}`) }
    if (/<svg|createElement\(['"]svg['"]/.test(line)) { svg += 1; console.log(`NOTE inline svg ${rel}:${n} ${line.trim().slice(0, 140)}`) }
    if (emojiRe.test(line)) { emoji += 1; console.log(`FAIL emoji ${rel}:${n} ${line.trim().slice(0, 120)}`) }
  })
  console.log(`scope files=${scope.length} icon_imports=${iconImports} inline_svg=${svg} emoji=${emoji} upstream_icon=${upstreamIcon}`)
  failIf('uses @eterna/ui icons/icon-data', iconImports > 0, `${iconImports} imports`)
  failIf('no emoji functional icons', emoji === 0, `${emoji} hits`)
  failIf('no upstream icon package import', upstreamIcon === 0, `${upstreamIcon} hits`)
  console.log('NOTE 唯一 <svg> 为 brand FAVICON_SVG 数据 URI(品牌资产,AGENTS.md 豁免)。')
} else if (caseId === 'UI-005') {
  const allowed = new Set(['1100', '760', '640'])
  const media = [], match = []
  eachLine((rel, n, line) => {
    const re = /@media\s*\(([^)]*)\)/g
    let m
    while ((m = re.exec(line)) !== null) {
      if (/width/.test(m[1])) media.push({ rel, n, value: m[1].trim() })
    }
    const mm = /matchMedia\(\s*['"`]\(([^)'"`]+)\)/g
    while ((m = mm.exec(line)) !== null) match.push({ rel, n, value: m[1].trim() })
  })
  const bad = [...media, ...match].filter(x => {
    const numbers = [...x.value.matchAll(/(\d+)px/g)].map(n => n[1])
    return numbers.length > 0 && numbers.some(n => !allowed.has(n))
  })
  console.log(`scope files=${scope.length} width_media=${media.length} matchMedia=${match.length}`)
  for (const x of media) console.log(`media ${x.rel}:${x.n} (${x.value})`)
  for (const x of match) console.log(`matchMedia ${x.rel}:${x.n} (${x.value})`)
  for (const x of bad) console.log(`FAIL breakpoint outside 1100/760/640 ${x.rel}:${x.n} (${x.value})`)
  failIf('breakpoints only 1100/760/640', bad.length === 0, bad.length === 0 ? '0 处越界' : `${bad.length} 处`)
  console.log('NOTE 组件 min-width/max-width(max-width:none、min(...)、表格 560px)不是断点,不计入。')
} else if (caseId === 'UI-007') {
  const idx = readFileSync(join(root, 'packages/access/src/client/index.tsx'), 'utf8')
  const section = idx.match(/inject\('settings\.section'[\s\S]{0,500}?id:\s*`\$\{NS\}\.mcp-servers`/)
  const uses = /McpServersSection/.test(idx)
  console.log(`settings.section mcp-servers registration: ${section ? 'present' : 'MISSING'}`)
  console.log(`McpServersSection component used: ${uses}`)
  console.log(`data-eterna-settings-section="mcp-servers": ${readFileSync(join(root, 'packages/access/src/client/mcp-servers-section.tsx'), 'utf8').includes('data-eterna-settings-section="mcp-servers"')}`)
  const routes = readFileSync(join(root, 'packages/access/src/routes.ts'), 'utf8')
  const pageRoutes = [...routes.matchAll(/req\.pathname\s*===\s*'([^']*mcp[^']*)'/gi)].map(m => m[1])
  console.log(`access page routes containing mcp: ${pageRoutes.length === 0 ? 'none' : pageRoutes.join(', ')}`)
  const sections = [...idx.matchAll(/id:\s*`\$\{NS\}\.([a-z-]+)`/g)].map(m => m[1])
  console.log(`registered slot ids: ${[...new Set(sections)].join(', ')}`)
  failIf('MCP registered as settings.section', section !== undefined && uses, section ? 'index.tsx settings.section id=' + '${NS}.mcp-servers' : 'missing')
  failIf('no standalone MCP page route', pageRoutes.length === 0, pageRoutes.length === 0 ? 'routes.ts 无 mcp 页面路由' : pageRoutes.join(', '))
} else if (caseId === 'UI-008') {
  const allowed = new Set(['-1', '1', '40', '100', '200', '1000', '1100', '1500'])
  const found = []
  eachLine((rel, n, line) => {
    const re = /(?:z-index|zIndex)\s*:\s*(-?\d+)/g
    let m
    while ((m = re.exec(line)) !== null) found.push({ rel, n, value: m[1], line: line.trim() })
  })
  const bad = found.filter(x => !allowed.has(x.value))
  console.log(`scope files=${scope.length} z-index declarations=${found.length}`)
  for (const x of found) console.log(`z-index ${x.rel}:${x.n} = ${x.value}`)
  for (const x of bad) console.log(`FAIL z-index outside allowlist ${x.rel}:${x.n} = ${x.value}`)
  const idx = readFileSync(join(root, 'packages/access/src/client/index.tsx'), 'utf8')
  const decision = idx.includes("inject('conversation.input.overlay'")
  const notif = /id:\s*`\$\{NS\}\.notifications`/.test(idx) && idx.includes("inject('settings.section'")
  const styles = readFileSync(join(root, 'packages/access/src/client/styles.ts'), 'utf8')
  const customToast = /\.ea-toast|class(Name)?=[^>]*toast|createToast/.test(styles + idx)
  console.log(`decision layer slot conversation.input.overlay: ${decision}`)
  console.log(`notification center as settings.section notifications: ${notif}`)
  console.log(`custom toast implementation: ${customToast}`)
  console.log(`hero -1 exception documented: ${readFileSync(join(root, 'packages/brand/src/client/styles.ts'), 'utf8').includes('isolation:isolate')}`)
  failIf('z-index only allowlist', bad.length === 0, bad.length === 0 ? '0 处越界' : `${bad.length} 处`)
  failIf('decision layer uses input overlay slot', decision, String(decision))
  failIf('notification center is a settings section', notif, String(notif))
  failIf('no self-built toast', !customToast, customToast ? 'found custom toast' : 'none (host toast)')
} else {
  console.error(`unknown case ${caseId}`)
  process.exit(2)
}
console.log(`SUMMARY ${caseId} failures=${fail}`)
process.exit(fail === 0 ? 0 : 1)
