/**
 * 客户端 bundle 构建:src/client/index.ts → lib/client.js。
 * 产物形态 = dsh 闭包工厂工件(banner id 必须与 Loader 行 name 一致:@eterna/brand)。
 */
import { build } from 'esbuild'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** rc.5 平台基线模块:与 dsh-web-frontend@0.2.2-rc.5 的 PLATFORM_MODULES 种子表
 *  逐字一致(2026-11-20 实读 dist 模块表);未引用的条目对产物无影响。 */
const BASELINE_EXTERNALS = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  'zod',
  '@tanstack/react-virtual',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-dockkit',
]

mkdirSync(resolve(root, 'lib'), { recursive: true })

await build({
  entryPoints: [resolve(root, 'src/client/index.ts')],
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: ['es2022'],
  outfile: resolve(root, 'lib/client.js'),
  external: BASELINE_EXTERNALS,
  charset: 'utf8',
  minify: false,
  legalComments: 'none',
  sourcemap: false,
  logLevel: 'info',
  banner: {
    js: 'window.__ModuleLoader__.load({\n  id: "@eterna/brand",\n  factory: (require) => {\n    var module = { exports: {} };\n    var exports = module.exports;\n',
  },
  footer: {
    js: '\n    return module.exports;\n  },\n});\n',
  },
})
