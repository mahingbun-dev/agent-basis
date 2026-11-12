/**
 * 客户端 bundle 构建:src/client/index.ts → lib/client.js。
 * 产物形态对齐 dsh 客户端包的闭包工厂工件(与 packages/prompt-studio 同款配方,
 * 见其 scripts/build-client.mjs):外层 window.__ModuleLoader__.load({id, factory}),
 * factory(require) 内是 CJS 模块体;基线外部模块以 require() 引用,运行时注入。
 */
import { build } from 'esbuild'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** dsh web 壳的平台基线模块(packages/client/web/src/platform.ts PLATFORM_MODULES)。 */
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
  entryPoints: [resolve(root, 'src/client/index.tsx')],
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
    js: 'window.__ModuleLoader__.load({\n  id: "@eterna/compaction",\n  factory: (require) => {\n    var module = { exports: {} };\n    var exports = module.exports;\n',
  },
  footer: {
    js: '\n    return module.exports;\n  },\n});\n',
  },
})
