/**
 * 客户端 bundle 构建:src/client/index.ts → lib/client.js。
 * 产物形态对齐 dsh 客户端包的闭包工厂工件(tsdown clientBundle 预设的输出形状,
 * 见任一 dsh-client-<name> 包的 lib/client.js):外层 window.__ModuleLoader__.load({id, factory}),
 * factory(require) 内是 CJS 模块体、返回 module.exports;基线外部模块
 * (浏览器壳 PLATFORM_MODULES 种子表)以 require() 引用,由模块表在运行时注入。
 */
import { build } from 'esbuild'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** dsh web 壳的平台基线模块(packages/client/web/src/platform.ts PLATFORM_MODULES),
 * 面板客户端实际引用的子集:react 家族(图标已自绘,不再引用 ui-primitives)。 */
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
  '@tanstack/react-virtual',
]

mkdirSync(resolve(root, 'lib'), { recursive: true })

await build({
  entryPoints: [resolve(root, 'src/client/index.ts')],
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: ['es2022'],
  jsx: 'automatic',
  outfile: resolve(root, 'lib/client.js'),
  external: BASELINE_EXTERNALS,
  minify: false,
  legalComments: 'none',
  sourcemap: false,
  logLevel: 'info',
  banner: {
    js: 'window.__ModuleLoader__.load({\n  id: "@eterna/panel",\n  factory: (require) => {\n    var module = { exports: {} };\n    var exports = module.exports;\n',
  },
  footer: {
    js: '\n    return module.exports;\n  },\n});\n',
  },
})
