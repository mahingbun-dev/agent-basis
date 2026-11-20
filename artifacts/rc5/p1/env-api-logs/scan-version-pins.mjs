#!/usr/bin/env node
/**
 * 版本钉版独立扫描(T08 第 1 项的证据生成器,只读)。
 *
 * 面:全仓 package.json(显式免 v1/ 与 core/)+ pnpm-workspace.yaml catalog。
 * 判定:0.2.1 / 0.2.2-alpha.2|3 / 0.2.2-rc.1 / 4.0.6 的**钉版**
 *       (精确、=、~、^)为 PIN;`>=` 旧下限为 FLOOR(WARN,不冒充钉版)。
 * 输出:一行一命中 + 汇总计数,便于 tee 成证据。
 *
 * 与 scripts/verify-rc5-env.mjs 相互独立:这里是结构化 JSON 解析,
 * 脚本那边是同一口径的文本+清单混合扫描;两边结果应一致(本文件供对账)。
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = process.cwd()
const SKIP = new Set(['node_modules', '.git', 'artifacts', 'v1', 'core', 'coverage', '.zcode', '.secrets'])
const STALE_PIN = /^(?:=|~|\^)?\s*(0\.2\.1|0\.2\.2-(?:alpha\.[23]|rc\.1)|4\.0\.6)(?![0-9])/
const STALE_FLOOR = /^>=?\s*(0\.2\.1|0\.2\.2-(?:alpha\.[23]|rc\.1)|4\.0\.6)(?![0-9])/

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name)
    if (entry.isSymbolicLink()) continue
    if (entry.isDirectory()) {
      if (SKIP.has(entry.name) || entry.name.startsWith('.eterna-home-')) continue
      walk(abs, out)
    } else if (entry.isFile() && entry.name === 'package.json') {
      out.push(abs)
    }
  }
  return out
}

const files = walk(ROOT).sort()
const rows = []
const specs = { dsh: 0, cordis: 0, cosmokit: 0 }
for (const abs of files) {
  const rel = relative(ROOT, abs)
  const pkg = JSON.parse(readFileSync(abs, 'utf8'))
  for (const field of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
    for (const [name, spec] of Object.entries(pkg[field] ?? {})) {
      if (!name.startsWith('@deepseek-ai/dsh') && name !== '@deepseek-ai/cordis' && name !== '@deepseek-ai/cosmokit') continue
      if (name.startsWith('@deepseek-ai/dsh')) specs.dsh += 1
      else if (name === '@deepseek-ai/cordis') specs.cordis += 1
      else specs.cosmokit += 1
      const kind = STALE_PIN.test(spec) ? 'PIN' : STALE_FLOOR.test(spec) ? 'FLOOR' : null
      if (kind !== null) rows.push({ kind, file: rel, field, name, spec })
    }
  }
}
const familySpecs = specs.dsh + specs.cordis + specs.cosmokit

// pnpm-workspace.yaml:catalog 段逐条核对(只认 2 空格缩进的 `'name': version`)。
const yaml = readFileSync(join(ROOT, 'pnpm-workspace.yaml'), 'utf8').split('\n')
const catalogAt = yaml.findIndex(line => /^catalog:\s*$/.test(line))
const catalog = []
for (let i = catalogAt + 1; catalogAt !== -1 && i < yaml.length; i += 1) {
  if (/^\S/.test(yaml[i])) break
  const match = yaml[i].match(/^\s{2}'?(@?[^':\s]+)'?\s*:\s*(\S+)\s*(?:#.*)?$/)
  if (match !== null) catalog.push({ name: match[1], version: match[2] })
}
const dshCatalog = catalog.filter(item => /^@deepseek-ai\/dsh(-|$)/.test(item.name))
const offTarget = dshCatalog.filter(item => item.version !== '0.2.2-rc.5')
const cordis = catalog.find(item => item.name === '@deepseek-ai/cordis')
const cosmokit = catalog.find(item => item.name === '@deepseek-ai/cosmokit')
const yamlTokens = yaml
  .map((line, index) => ({ line: index + 1, text: line }))
  .filter(item => /(^|[^0-9.])(0\.2\.1|0\.2\.2-rc\.1|0\.2\.2-alpha\.[23]|4\.0\.6)([^0-9]|$)/.test(item.text))

const report = {
  manifestScope: '全仓 package.json 免 v1/ core/',
  manifestsScanned: files.length,
  specCounts: specs,
  dshFamilySpecs: familySpecs,
  stalePins: rows.filter(row => row.kind === 'PIN'),
  staleFloors: rows.filter(row => row.kind === 'FLOOR'),
  catalog: {
    dshEntries: dshCatalog.length,
    offTarget,
    cordis: cordis?.version ?? '(missing)',
    cosmokit: cosmokit?.version ?? '(missing)',
    staleTextTokens: yamlTokens,
  },
}
console.log(JSON.stringify(report, null, 2))