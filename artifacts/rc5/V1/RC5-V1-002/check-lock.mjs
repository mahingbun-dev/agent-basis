// V1-002: every v1 workspace package has a lock importer; every @basis/@core
// dependency reference resolves to a workspace link entry in the lockfile.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createRequire } from 'node:module'
const require = createRequire(join('/Users/sunny/code/agent-basis-rc5', 'core/runtime/package.json'))
const { parse } = require('yaml')

const root = '/Users/sunny/code/agent-basis-rc5'
const lock = parse(readFileSync(join(root, 'pnpm-lock.yaml'), 'utf8'))
const importers = lock.importers ?? {}
const scopes = [
  'core/cordis', 'core/contracts', 'core/runtime',
  'packages/system-prompt', 'packages/session', 'packages/tools',
  'packages/llm', 'packages/approval-cli', 'packages/agent-loop',
]
let fail = 0
for (const dir of scopes) {
  const present = importers[dir] !== undefined
  console.log(`importer ${dir}: ${present ? 'present' : 'MISSING'}`)
  if (!present) fail += 1
}
const refs = []
for (const dir of scopes) {
  const manifest = JSON.parse(readFileSync(join(root, dir, 'package.json'), 'utf8'))
  for (const field of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
    for (const [name, spec] of Object.entries(manifest[field] ?? {})) {
      if (!name.startsWith('@basis/') && !name.startsWith('@core/')) continue
      refs.push({ dir, field, name, spec })
      const entry = importers[dir]?.[field]?.[name]
      const ok = entry !== undefined && entry.specifier === 'workspace:*' && String(entry.version).startsWith('link:')
      console.log(`dep ${dir} ${field}.${name}=${spec} -> ${ok ? `lock link:${entry.version}` : 'MISSING/NOT-LINK'}`)
      if (!ok) fail += 1
    }
  }
}
console.log(`summary: importers=${scopes.length} workspace-refs=${refs.length} failures=${fail}`)
process.exit(fail === 0 ? 0 : 1)
