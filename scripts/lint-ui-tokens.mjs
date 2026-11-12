/**
 * UI 令牌卫生检查(CI/本地可跑):
 * 1. 除令牌/品牌资产文件外,禁止硬编码十六进制色值与 rgb()/hsl() 色值;
 * 2. 禁止使用 13/13.5/15/18/28px 等规范外字号,以及 900/960px 等规范外断点;
 * 3. 禁止引用未在 packages/ui/src/tokens.ts 定义的 --et-* 令牌;
 * 4. 禁止引用上游 dsh-web-frontend 不存在的 --dsw-alias-* 令牌。
 *
 * 用法:node scripts/lint-ui-tokens.mjs
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const SCAN_DIRS = [
  'packages/panel/src',
  'packages/prompt-studio/src/client',
  'packages/access/src',
  'packages/usage-stats/src',
  'packages/compaction/src',
  'packages/llm-doctor/src',
  'packages/ui/src',
  'packages/brand/src',
  'packages/extension-companion/src',
]

/** 允许出现字面色值的文件(令牌源 / 品牌插画 / 独立扩展页的令牌块)。 */
const HEX_ALLOWED = new Set([
  'packages/ui/src/tokens.ts',
  'packages/brand/src/client/index.ts',
  'packages/extension-companion/src/options.html',
])

const TOKENS_FILE = join(root, 'packages/ui/src/tokens.ts')
const HTTP_STYLE = /\/\*[\s\S]*?\*\//gu
const LINE_COMMENT = /(^|[^:])\/\/.*$/gmu

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    const stat = statSync(path)
    if (stat.isDirectory()) walk(path, out)
    else if (/\.(ts|tsx|html)$/u.test(name)) out.push(path)
  }
  return out
}

function stripComments(code) {
  return code.replace(HTTP_STYLE, '').replace(LINE_COMMENT, '$1')
}

function upstreamTokens() {
  const pnpm = join(root, 'node_modules/.pnpm')
  let entry
  try {
    entry = readdirSync(pnpm).find(name => name.startsWith('@deepseek-ai+dsh-web-frontend@'))
  } catch {
    return null
  }
  if (entry === undefined) return null
  const assets = join(pnpm, entry, 'node_modules/@deepseek-ai/dsh-web-frontend/dist/assets')
  const tokens = new Set()
  try {
    for (const file of readdirSync(assets)) {
      if (!file.endsWith('.css')) continue
      for (const match of readFileSync(join(assets, file), 'utf8').matchAll(/--dsw-alias-[a-z0-9-]+/gu)) {
        tokens.add(match[0])
      }
    }
  } catch {
    return null
  }
  return tokens.size > 0 ? tokens : null
}

const definedTokens = new Set(
  [...readFileSync(TOKENS_FILE, 'utf8').matchAll(/(--et-[a-z0-9-]+)\s*:/gu)].map(match => match[1]),
)
const upstream = upstreamTokens()
const fallbackUpstream = new Set([
  '--dsw-alias-bg-mask-1',
  '--dsw-alias-border-l2',
  '--dsw-alias-label-primary-foreground',
  '--dsw-alias-state-business-primary',
  '--dsw-alias-state-error-primary',
  '--dsw-alias-toast-bg',
  '--dsw-alias-toast-label',
])

const issues = []
for (const dir of SCAN_DIRS) {
  for (const file of walk(join(root, dir))) {
    const rel = relative(root, file)
    const raw = readFileSync(file, 'utf8')
    const code = stripComments(raw)
    if (!HEX_ALLOWED.has(rel)) {
      for (const match of code.matchAll(/#[0-9a-fA-F]{3,8}\b/gu)) {
        issues.push(`${rel}: 硬编码色值 ${match[0]}(请改用 --et-* 令牌)`)
      }
      for (const match of code.matchAll(/\b(?:rgba?|hsla?)\(/gu)) {
        issues.push(`${rel}: 硬编码色值 ${match[0]}(请改用 --et-* 令牌)`)
      }
    }
    for (const match of code.matchAll(/font-size:\s*(?:13|13\.5|15|18|28)px/gu)) {
      issues.push(`${rel}: 规范外字号 ${match[0]}(请改用 12/14/16/20/24/32 阶梯)`)
    }
    for (const match of code.matchAll(/@media[^{}]*?(?:max|min)-width:\s*(?:900|960)px/gu)) {
      issues.push(`${rel}: 规范外断点 ${match[0]}(请改用 1100/760/640)`)
    }
    for (const match of code.matchAll(/--et-[a-z0-9-]+/gu)) {
      if (!definedTokens.has(match[0])) issues.push(`${rel}: 未定义的令牌 ${match[0]}`)
    }
    for (const match of code.matchAll(/--dsw-alias-[a-z0-9-]+/gu)) {
      const known = upstream ?? fallbackUpstream
      if (!known.has(match[0])) issues.push(`${rel}: 上游不存在的令牌 ${match[0]}`)
    }
  }
}

if (issues.length > 0) {
  console.error(`UI 令牌检查失败(${issues.length} 项):`)
  for (const issue of [...new Set(issues)].sort()) console.error(`- ${issue}`)
  process.exit(1)
}
console.log(`UI 令牌检查通过:${SCAN_DIRS.length} 个目录,${definedTokens.size} 个 --et-* 令牌。`)
