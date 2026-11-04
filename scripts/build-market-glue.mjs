/**
 * T21:生成面向插件市场的自包含 @basis/glue bundle(market/glue-bundle/)。
 *
 * 为什么存在:pnpm 11 默认 blockExoticSubdeps——git 安装的包,其**子依赖**不允许
 * 再用 git/file 等 exotic 协议。仓库里 glue 依赖 @basis/{governance,memory,knowledge}
 * (workspace:*),直接以 packages/glue 为市场 path 安装必失败(先后实测
 * ERR_PNPM_WORKSPACE_PKG_NOT_FOUND 与 ERR_PNPM_EXOTIC_SUBDEP)。市场分发的正解是
 * 自包含包:把三个 sibling 包的 src vendor 进来,glue 插件文件里 4 处 `@basis/*`
 * import 改写为相对路径,外部依赖只留 npm 在册的 @deepseek-ai/* 与 yaml。
 *
 * 产物提交入库(market/glue-bundle),market/index.json 的 glue 条目 path 指向它。
 * 仓库开发形态(packages/* + catalog:/workspace:)零改动。
 *
 * 用法:node scripts/build-market-glue.mjs   (在仓库根执行)
 * 任一一致性断言失败 → 非零退出(门禁用)。
 */
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const out = join(root, 'market', 'glue-bundle')
const sources = {
  governance: join(root, 'packages', 'governance', 'src'),
  memory: join(root, 'packages', 'memory', 'src'),
  knowledge: join(root, 'packages', 'knowledge', 'src'),
}
const glueSrc = join(root, 'packages', 'glue', 'src')

/** 与 glue 插件文件的 bare import 一一对应的改写目标(vendor 根 = src/vendor)。 */
const REWRITES = [
  { from: /from '@basis\/governance'/g, to: "from '../vendor/governance/index.ts'" },
  { from: /from '@basis\/memory'/g, to: "from '../vendor/memory/index.ts'" },
  { from: /from '@basis\/knowledge'/g, to: "from '../vendor/knowledge/index.ts'" },
  // 内联类型引用,如 memory-plugin.ts 的 import('@basis/governance').PiiFilter
  { from: /import\('@basis\/governance'\)/g, to: "import('../vendor/governance/index.ts')" },
  { from: /import\('@basis\/memory'\)/g, to: "import('../vendor/memory/index.ts')" },
  { from: /import\('@basis\/knowledge'\)/g, to: "import('../vendor/knowledge/index.ts')" },
]

const fail = (message) => { console.error(`build-market-glue: ${message}`); process.exit(1) }

// 1) 重建产物目录
rmSync(out, { recursive: true, force: true })
mkdirSync(join(out, 'src', 'plugins'), { recursive: true })
mkdirSync(join(out, 'src', 'vendor'), { recursive: true })

// 2) vendor 三个 sibling 包的 src(原样拷贝,包内相对 import 不变)
let vendoredFiles = 0
for (const [name, dir] of Object.entries(sources)) {
  if (!existsSync(dir)) fail(`缺少源目录 ${dir}`)
  cpSync(dir, join(out, 'src', 'vendor', name), { recursive: true })
  vendoredFiles += 1
}

// 3) glue 自身:index/types 原样;plugins 改写 @basis/* import 后拷贝
cpSync(join(glueSrc, 'index.ts'), join(out, 'src', 'index.ts'))
cpSync(join(glueSrc, 'types.ts'), join(out, 'src', 'types.ts'))
for (const file of ['governance-plugin.ts', 'knowledge-plugin.ts', 'memory-plugin.ts']) {
  const from = join(glueSrc, 'plugins', file)
  if (!existsSync(from)) fail(`缺少 ${from}`)
  let text = readFileSync(from, 'utf8')
  for (const rule of REWRITES) text = text.replace(rule.from, rule.to)
  writeFileSync(join(out, 'src', 'plugins', file), text)
}

// 4) bundle 装配文件:patch 原样拷贝;package.json 自包含(无 @basis/* 子依赖)
cpSync(join(root, 'packages', 'glue', 'cordis.patch.yml'), join(out, 'cordis.patch.yml'))
const manifest = {
  name: '@basis/glue',
  version: '0.0.0',
  private: true,
  type: 'module',
  description: '组合层 glue bundle(市场自包含构建,由 scripts/build-market-glue.mjs 生成):'
    + '把 @basis 的 memory/knowledge/governance 服务装配为真实 DSH 宿主可挂载的插件。'
    + '源码 vendor 自 packages/{glue,governance,memory,knowledge}。',
  exports: {
    '.': './src/index.ts',
    './memory-plugin': './src/plugins/memory-plugin.ts',
    './knowledge-plugin': './src/plugins/knowledge-plugin.ts',
    './governance-plugin': './src/plugins/governance-plugin.ts',
    './package.json': './package.json',
  },
  // 只保留 vendor 源真实 import 的外部依赖(npm 公网在册;勿加 @basis/*——exotic 子依赖会被 pnpm 11 拦)
  dependencies: {
    '@deepseek-ai/cordis': '4.0.6-alpha.1',
    '@deepseek-ai/dsh-system-prompt': '0.2.2-alpha.2',
    '@deepseek-ai/dsh-tools': '0.2.2-alpha.2',
    'yaml': '^2.9.1',
  },
  dsh: { manifestVersion: 1, bundle: { patch: './cordis.patch.yml' } },
}
writeFileSync(join(out, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`)
writeFileSync(join(out, 'README.md'), `# @basis/glue 市场自包含构建\n\n由 \`scripts/build-market-glue.mjs\` 生成,勿手改;源码见 \`packages/{glue,governance,memory,knowledge}\`。\n`)

// 5) 一致性断言:产物里不允许残留 @basis/* 模块引用(字符串常量/注释除外)
function readdirDeep(dir) {
  const files = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) files.push(...readdirDeep(join(dir, entry.name)))
    else files.push(join(dir, entry.name))
  }
  return files
}
let checked = 0
for (const file of readdirDeep(out)) {
  if (!file.endsWith('.ts')) continue
  checked += 1
  const text = readFileSync(file, 'utf8')
  const residue = text.match(/from '@basis\//) ?? text.match(/import\('@basis\//)
  if (residue) fail(`${file} 残留 @basis/* 模块引用`)
}
if (checked < 30) fail(`产物 .ts 文件数异常(${checked} < 30)`)
console.log(`build-market-glue: OK(vendor 包 ${vendoredFiles} 个,检查 .ts ${checked} 个,零 @basis/* import 残留)→ ${out}`)
