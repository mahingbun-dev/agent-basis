#!/usr/bin/env node
/**
 * T36 B5 客户端 bundle 断言(证据用,只读)。
 * - 10 个包 lib/client.js 存在且非空;
 * - 工件外壳 = window.__ModuleLoader__.load({id: "@eterna/<name>", factory}) + return module.exports;
 * - 工厂内 require() 的模块全部落在 rc.5 PLATFORM_MODULES 种子表;
 * - package.json exports["./client"] → ./lib/client.js,dsh.client.platform = web;
 * - access plugins.tab 契约:本地影子声明含 rc.5 必填 update(),两个页签组件按 PluginTabProps 声明。
 * 退出码 0 = 全部通过。
 */
import { readFileSync, statSync, existsSync } from 'node:fs'
import { createRequire } from 'node:module'

const ROOT = '/Users/sunny/code/agent-basis-rc5'
const PKGS = ['access', 'attachments', 'brand', 'compaction', 'llm-doctor', 'memory', 'panel', 'prompt-studio', 'usage-stats', 'workbench']
/** rc.5 dsh-web-frontend PLATFORM_MODULES 种子表(11 项,2026-11-20 实读 dist 模块表)。 */
const PLATFORM_MODULES = [
  'react', 'react/jsx-runtime', 'react-dom', 'react-dom/client',
  '@deepseek-ai/cordis', 'zod', '@tanstack/react-virtual',
  '@deepseek-ai/dsh-client-store', '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives', '@deepseek-ai/dsh-client-ui-dockkit',
]

let failures = 0
const pass = (id, msg) => { console.log(`PASS ${id} ${msg}`) }
const fail = (id, msg) => { failures += 1; console.log(`FAIL ${id} ${msg}`) }
const check = (id, cond, msg) => { if (cond) pass(id, msg); else fail(id, msg) }

for (const p of PKGS) {
  const pkg = `@eterna/${p}`
  const file = `${ROOT}/packages/${p}/lib/client.js`
  const exists = existsSync(file)
  check(`A1:${p}`, exists, `${file} 存在`)
  if (!exists) continue
  const size = statSync(file).size
  check(`A1:${p}`, size > 1024, `${file} 大小 ${size} bytes`)
  const src = readFileSync(file, 'utf8')
  check(`A2:${p}`, src.startsWith('window.__ModuleLoader__.load({'), `${pkg} 外壳 = __ModuleLoader__.load({`)
  check(`A2:${p}`, src.includes(`id: "${pkg}"`), `${pkg} 工件 id 与包名一致`)
  check(`A2:${p}`, /factory: \(require\) => \{/.test(src), `${pkg} factory(require) 形态`)
  check(`A2:${p}`, src.trimEnd().endsWith('});'), `${pkg} 工件闭合 return module.exports + });`)
  const requires = [...src.matchAll(/require\("([^"]+)"\)/g)].map(m => m[1])
  const outside = [...new Set(requires)].filter(name => !PLATFORM_MODULES.includes(name))
  check(`A3:${p}`, outside.length === 0, `${pkg} require 集 ${JSON.stringify([...new Set(requires)])} ⊆ rc.5 PLATFORM_MODULES`)
  const manifest = JSON.parse(readFileSync(`${ROOT}/packages/${p}/package.json`, 'utf8'))
  check(`A4:${p}`, manifest.exports?.['./client'] === './lib/client.js', `${pkg} exports["./client"] → ./lib/client.js`)
  check(`A4:${p}`, manifest.dsh?.client?.platform === 'web', `${pkg} dsh.client.platform = web`)
}

const contract = `${ROOT}/packages/access/src/client/plugin-manager-contract.d.ts`
check('A5:contract', existsSync(contract), 'plugin-manager-contract.d.ts 存在')
if (existsSync(contract)) {
  const c = readFileSync(contract, 'utf8')
  check('A5:contract', c.includes('readonly update: (target: PluginTabUpdate) => void'), '契约声明 rc.5 必填 update(target: PluginTabUpdate)')
  check('A5:contract', c.includes('readonly install: (target: PluginTabInstall) => void'), '契约声明 install(target: PluginTabInstall)')
  check('A5:contract', c.includes('readonly openPackage: (packageName: string) => void'), '契约声明 openPackage(packageName)')
}
for (const [label, file, fn, guard] of [
  ['my-plugins-section', `${ROOT}/packages/access/src/client/my-plugins-section.tsx`, 'export function MyPluginsTab(props: PluginTabProps & { readonly t: Translate })', 'MyPluginsTabCarriesUpdate'],
  ['plugins-manager', `${ROOT}/packages/access/src/client/plugins-manager.tsx`, 'export function ManageTab(_props: PluginTabProps)', 'ManageTabCarriesUpdate'],
]) {
  const src = readFileSync(file, 'utf8')
  check(`A6:${label}`, src.includes('PluginTabProps') && src.includes("from '@deepseek-ai/dsh-client-ui-plugin-manager'"), `${label} 引入 PluginTabProps 契约`)
  check(`A6:${label}`, src.includes(fn), `${label} 页签按全量 owner props 声明(${fn})`)
  check(`A6:${label}`, src.includes(`export type ${guard}`), `${label} 编译期断言 ${guard} 存在(契约漏 update 即 tsc 红)`)
}

console.log(`\nSUMMARY failures=${failures}`)
process.exit(failures === 0 ? 0 : 1)