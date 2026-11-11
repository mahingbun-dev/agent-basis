/**
 * 客户端 bundle 构建:src/client/index.tsx → lib/client.js。
 * 产物形态对齐 dsh 客户端包工件(window.__ModuleLoader__.load({id, factory}),
 * CJS 闭包;panel 同款配方)。基线外部模块由浏览器壳 PLATFORM_MODULES 注入。
 */
import { build } from 'esbuild'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const BASELINE_EXTERNALS = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-ui-slots',
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
    js: 'window.__ModuleLoader__.load({\n  id: "@eterna/access",\n  factory: (require) => {\n    var module = { exports: {} };\n    var exports = module.exports;\n',
  },
  footer: {
    js: '\n    return module.exports;\n  },\n});\n',
  },
})
