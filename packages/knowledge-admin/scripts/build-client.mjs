/**
 * 知识库管理插件 —— 浏览器半边构建:src/client/index.js → lib/client.js。
 *
 * 本插件客户端为**纯 JavaScript** 闭包工厂工件(不引入 tsconfig/tsc/esbuild 链路):
 *   window.__ModuleLoader__.load({ id, factory(require) { ...; return module.exports } })
 * 基线外部模块(react)由浏览器壳模块表在运行时注入,不打包、不 CDN。
 *
 * 本脚本做产物发布 + 自检:
 *  1. 语法解析(vm.Script,不执行);
 *  2. 工厂契约:__ModuleLoader__.load 外层、id 与包名一致、无顶层 ES import、
 *     不引用 ui-primitives / 其他 Harness Client 包;
 *  3. 通过后写 lib/client.js。
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const source = resolve(root, 'src/client/index.js')
const output = resolve(root, 'lib/client.js')
const ID = '@eterna/knowledge-admin'

const text = readFileSync(source, 'utf8')
const problems = []

if (!text.includes("id: '@eterna/knowledge-admin'")) problems.push(`工厂 id 与包名不一致(应为 ${ID})`)
if (!text.includes('window.__ModuleLoader__.load')) problems.push('缺少 __ModuleLoader__.load 外层')
if (/^\s*import\s/m.test(text)) problems.push('客户端产物不得含顶层 ES import(必须走 require)')
if (/dsh-client-ui-primitives/.test(text)) problems.push('禁止引用 ui-primitives(改用主题令牌自绘)')
if (/\biframe\b/.test(text)) problems.push('禁止 iframe 承载 UI')

try {
  new vm.Script(text, { filename: source })
} catch (error) {
  problems.push(`语法错误:${String(error)}`)
}

if (problems.length > 0) {
  console.error(`[build-client] 失败:\n- ${problems.join('\n- ')}`)
  process.exit(1)
}

mkdirSync(resolve(root, 'lib'), { recursive: true })
writeFileSync(output, text)
console.log(`[build-client] ok ${output} (${text.length} bytes)`)
