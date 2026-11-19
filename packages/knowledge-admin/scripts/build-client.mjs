/**
 * 知识库管理插件 —— 浏览器半边构建:src/client/index.js → lib/client.js。
 *
 * 2026-11-19 融合改造:从"纯拷贝 + vm 语法自检"升级为 esbuild 打包
 * (与 packages/memory、packages/panel 同配方),以便构建期把
 * `@eterna/ui/icon-data`(图标单一事实源)内联进产物,客户端不再手写 SVG。
 *
 * 产物形态仍是 dsh 客户端包的闭包工厂工件:
 *   window.__ModuleLoader__.load({ id, factory(require) { ... } })
 * 基线外部模块(react 家族)由浏览器壳模块表运行时注入,不打包、不 CDN。
 *
 * 本脚本做产物发布 + 自检:
 *  1. esbuild 打包(TS 依赖如 @eterna/ui/icon-data 允许内联;react 外置);
 *  2. 工厂契约:__ModuleLoader__.load 外层、id 与包名一致、无残留下游模块引用;
 *  3. 禁项:ui-primitives / iframe;
 *  4. 通过后写 lib/client.js。
 */
import { build } from 'esbuild'
import { mkdirSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const source = resolve(root, 'src/client/index.js')
const output = resolve(root, 'lib/client.js')
const ID = '@eterna/knowledge-admin'

/** dsh web 壳的平台基线模块(运行时由 __ModuleLoader__ 注入,构建期必须外置)。 */
const BASELINE_EXTERNALS = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  'zod',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-dockkit',
  '@deepseek-ai/dsh-client-locale',
  '@deepseek-ai/dsh-api-gateway',
  '@tanstack/react-virtual',
]

mkdirSync(resolve(root, 'lib'), { recursive: true })

await build({
  entryPoints: [source],
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: ['es2022'],
  outfile: output,
  external: BASELINE_EXTERNALS,
  minify: false,
  legalComments: 'none',
  sourcemap: false,
  logLevel: 'warning',
})

const text = readFileSync(output, 'utf8')
const problems = []

if (!text.includes(`id: '@eterna/knowledge-admin'`) && !text.includes(`id: "@eterna/knowledge-admin"`)) {
  problems.push(`工厂 id 与包名不一致(应为 ${ID})`)
}
if (!text.includes('window.__ModuleLoader__.load')) problems.push('缺少 __ModuleLoader__.load 外层')
// 打包后不允许残留未内联的 @eterna/* 引用(构建图必须自包含;react 家族除外)。
if (/require\(["']@eterna\//.test(text)) problems.push('产物残留 @eterna/* 模块引用(@eterna/ui 应构建期内联)')
if (/dsh-client-ui-primitives/.test(text)) problems.push('禁止引用 ui-primitives(改用主题令牌自绘)')
if (/\biframe\b/.test(text)) problems.push('禁止 iframe 承载 UI')

if (problems.length > 0) {
  console.error(`[build-client] 失败:\n- ${problems.join('\n- ')}`)
  process.exit(1)
}

console.log(`[build-client] ok ${output} (${text.length} bytes)`)