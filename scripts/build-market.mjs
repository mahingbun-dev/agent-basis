/**
 * T21:生成面向插件市场的自包含分发 bundle(market/glue-bundle/ 与 market/pack-bundle/)。
 *
 * 为什么必须"自包含 + 编译成 JS",两层原因(均经实测):
 * 1) pnpm 11 默认 blockExoticSubdeps:git 安装的包,其**子依赖**不允许 git/file 等
 *    exotic 协议。仓库里 glue 依赖 @basis/{governance,memory,knowledge}(workspace:*),
 *    直接以 packages/glue 为 path 安装报 ERR_PNPM_WORKSPACE_PKG_NOT_FOUND;
 *    改成 git 钉标签子依赖又报 ERR_PNPM_EXOTIC_SUBDEP。正解 = vendor 源码自包含。
 * 2) Node 的 type stripping 不支持 node_modules 下的 .ts(ERR_UNSUPPORTED_NODE_MODULES_
 *    TYPE_STRIPPING)。file: 链接(profile packages/ 目录)能跑 .ts,git 安装落在
 *    node_modules 里就必须是 .js。正解 = esbuild 编译,产物只含 .js。
 *
 * 用法:node scripts/build-market.mjs   (在仓库根执行)
 * 任一一致性断言失败 → 非零退出(门禁用)。
 */
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const root = resolve(import.meta.dirname, '..')
// esbuild 是 @basis/panel 的 devDep(catalog:),不在仓库根——从 panel 上下文解析
const esbuildUrl = pathToFileURL(createRequire(join(root, 'packages', 'panel', 'package.json')).resolve('esbuild'))
const { build } = await import(esbuildUrl.href)

const fail = (message) => { console.error(`build-market: ${message}`); process.exit(1) }

function readdirDeep(dir) {
  const files = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) files.push(...readdirDeep(join(dir, entry.name)))
    else files.push(join(dir, entry.name))
  }
  return files
}

/** esbuild 逐文件编译(保留模块结构)。注意:多入口非 bundle 模式下 esbuild 不改写显式
 * `.ts` 相对 import(实测保留 `../vendor/x/index.ts`),需后处理改成 `.js`。 */
async function compileTree(stageDir, outDir) {
  const entries = readdirDeep(stageDir).filter(file => file.endsWith('.ts'))
  if (entries.length === 0) fail(`${stageDir} 无 .ts 入口`)
  await build({
    entryPoints: entries,
    outdir: outDir,
    outbase: stageDir,
    format: 'esm',
    platform: 'node',
    target: 'node20',
    logLevel: 'warning',
  })
  // 后处理:相对 import 的 .ts → .js(esbuild 多入口模式不做这件事)
  for (const file of readdirDeep(outDir)) {
    if (!file.endsWith('.js')) continue
    const text = readFileSync(file, 'utf8')
    const fixed = text.replace(/(\.\.?\/[^'"]+?)\.ts(["'])/g, '$1.js$2')
    if (fixed !== text) writeFileSync(file, fixed)
  }
  // 断言:产物不允许残留相对 .ts import
  for (const file of readdirDeep(outDir)) {
    if (!file.endsWith('.js')) continue
    if (/\.\.?\/[^'"]+?\.ts["']/.test(readFileSync(file, 'utf8'))) fail(`${file} 残留相对 .ts import`)
  }
  return entries.length
}

/** 断言:编译产物 .js 不残留 @basis/* 模块引用(exotic 子依赖禁令的门禁)。 */
function assertNoBasisImports(dir) {
  for (const file of readdirDeep(dir)) {
    if (!file.endsWith('.js')) continue
    const text = readFileSync(file, 'utf8')
    if (/from\s+["']@basis\//.test(text) || /import\(["']@basis\//.test(text)) {
      fail(`${file} 残留 @basis/* 模块引用`)
    }
  }
}

async function buildGlue() {
  const out = join(root, 'market', 'glue-bundle')
  const stage = join(root, 'market', '.stage-glue')
  const sources = {
    governance: join(root, 'packages', 'governance', 'src'),
    memory: join(root, 'packages', 'memory', 'src'),
    knowledge: join(root, 'packages', 'knowledge', 'src'),
  }
  const glueSrc = join(root, 'packages', 'glue', 'src')
  const REWRITES = [
    { from: /from '@basis\/governance'/g, to: "from '../vendor/governance/index.ts'" },
    { from: /from '@basis\/memory'/g, to: "from '../vendor/memory/index.ts'" },
    { from: /from '@basis\/knowledge'/g, to: "from '../vendor/knowledge/index.ts'" },
    { from: /import\('@basis\/governance'\)/g, to: "import('../vendor/governance/index.ts')" },
    { from: /import\('@basis\/memory'\)/g, to: "import('../vendor/memory/index.ts')" },
    { from: /import\('@basis\/knowledge'\)/g, to: "import('../vendor/knowledge/index.ts')" },
  ]

  rmSync(out, { recursive: true, force: true })
  rmSync(stage, { recursive: true, force: true })
  mkdirSync(join(stage, 'src', 'plugins'), { recursive: true })
  mkdirSync(join(stage, 'src', 'vendor'), { recursive: true })

  for (const [name, dir] of Object.entries(sources)) {
    if (!existsSync(dir)) fail(`缺少源目录 ${dir}`)
    cpSync(dir, join(stage, 'src', 'vendor', name), { recursive: true })
  }
  cpSync(join(glueSrc, 'index.ts'), join(stage, 'src', 'index.ts'))
  cpSync(join(glueSrc, 'types.ts'), join(stage, 'src', 'types.ts'))
  for (const file of ['governance-plugin.ts', 'knowledge-plugin.ts', 'memory-plugin.ts']) {
    const from = join(glueSrc, 'plugins', file)
    if (!existsSync(from)) fail(`缺少 ${from}`)
    let text = readFileSync(from, 'utf8')
    for (const rule of REWRITES) text = text.replace(rule.from, rule.to)
    writeFileSync(join(stage, 'src', 'plugins', file), text)
  }

  const compiled = await compileTree(stage, out)
  cpSync(join(root, 'packages', 'glue', 'cordis.patch.yml'), join(out, 'cordis.patch.yml'))
  const manifest = {
    name: '@basis/glue',
    version: '0.0.0',
    private: true,
    type: 'module',
    description: '组合层 glue bundle(市场自包含构建,由 scripts/build-market.mjs 生成,vendor + esbuild 编译):'
      + '把 @basis 的 memory/knowledge/governance 服务装配为真实 DSH 宿主可挂载的插件。'
      + '源码见 packages/{glue,governance,memory,knowledge}。',
    exports: {
      '.': './src/index.js',
      './memory-plugin': './src/plugins/memory-plugin.js',
      './knowledge-plugin': './src/plugins/knowledge-plugin.js',
      './governance-plugin': './src/plugins/governance-plugin.js',
      './package.json': './package.json',
    },
    // @deepseek-ai/* 必须走 peerDependencies(宿主运行时自带,与 @event/pack 同款):
    // 普通依赖会因 nodeLinker:hoisted 顶掉 dsh 自带版本,实测导致宿主 tools/system-prompt
    // 行被兼容性禁用、启动失败。yaml 宿主不提供,保持普通依赖。
    dependencies: {
      'yaml': '^2.9.1',
    },
    peerDependencies: {
      '@deepseek-ai/cordis': '>=4.0.6-alpha.1',
      '@deepseek-ai/dsh-system-prompt': '>=0.2.2-alpha.2',
      '@deepseek-ai/dsh-tools': '>=0.2.2-alpha.2',
    },
    dsh: { manifestVersion: 1, bundle: { patch: './cordis.patch.yml' } },
  }
  writeFileSync(join(out, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  writeFileSync(join(out, 'README.md'), '# @basis/glue 市场自包含构建\n\n由 `scripts/build-market.mjs` 生成(vendor + esbuild → JS),勿手改。\n')
  rmSync(stage, { recursive: true, force: true })

  assertNoBasisImports(out)
  const jsCount = readdirDeep(out).filter(f => f.endsWith('.js')).length
  if (jsCount !== compiled) fail(`glue 编译数不一致(js=${jsCount}, ts=${compiled})`)
  if (!existsSync(join(out, 'src', 'plugins', 'memory-plugin.js'))) fail('glue 缺 memory-plugin.js')
  console.log(`build-market: glue-bundle OK(编译 .ts ${compiled} → .js ${jsCount},零 @basis/* import 残留)`)
}

async function buildPack() {
  const out = join(root, 'market', 'pack-bundle')
  const stage = join(root, 'market', '.stage-pack')
  const pack = join(root, 'packs', 'event-planning')
  const EXCLUDE = dirOrFile => {
    const rel = relative(pack, dirOrFile)
    return rel.startsWith('evals') || rel.startsWith('fixtures') || rel.startsWith('node_modules')
      || rel.endsWith('.test.mjs') || rel === 'tools/package.json' || rel === 'tools/run-tests.mjs'
      || rel === 'package.json' || rel === 'tsconfig.json' || rel === 'vitest.config.ts'
  }

  rmSync(out, { recursive: true, force: true })
  rmSync(stage, { recursive: true, force: true })
  mkdirSync(stage, { recursive: true })

  // 拷贝运行时树:.ts 进 stage 待编译;非 .ts 资产(persona/policies/skills/knowledge/hitl/patch)原样进产物
  for (const file of readdirDeep(pack)) {
    if (EXCLUDE(file)) continue
    const rel = relative(pack, file)
    if (rel.endsWith('.ts')) {
      mkdirSync(join(stage, rel, '..'), { recursive: true })
      cpSync(file, join(stage, rel))
    } else {
      mkdirSync(join(out, rel, '..'), { recursive: true })
      cpSync(file, join(out, rel))
    }
  }

  const compiled = await compileTree(stage, out)
  const manifest = {
    name: '@event/pack',
    version: '0.1.0',
    private: true,
    type: 'module',
    description: '活动策划领域包(市场自包含构建,由 scripts/build-market.mjs 生成,esbuild 编译):'
      + 'persona + skills + 行业工具(含审批红线)+ policies。源码见 packs/event-planning。',
    exports: {
      '.': './tools/index.js',
      './plugin': './plugin.js',
      './package.json': './package.json',
    },
    peerDependencies: {
      '@deepseek-ai/cordis': '>=4.0.6-alpha.1',
      '@deepseek-ai/dsh-tools': '>=0.2.2-alpha.2',
    },
    dsh: { manifestVersion: 1, bundle: { patch: './cordis.patch.yml' } },
  }
  writeFileSync(join(out, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  writeFileSync(join(out, 'README.md'), '# @event/pack 市场自包含构建\n\n由 `scripts/build-market.mjs` 生成(esbuild → JS),勿手改。\n')
  rmSync(stage, { recursive: true, force: true })

  assertNoBasisImports(out)
  if (!existsSync(join(out, 'plugin.js'))) fail('pack 缺 plugin.js')
  for (const asset of ['persona.md', 'hitl.yaml', 'cordis.patch.yml']) {
    if (!existsSync(join(out, asset))) fail(`pack 缺资产 ${asset}`)
  }
  console.log(`build-market: pack-bundle OK(编译 .ts ${compiled},资产齐,零 @basis/* import 残留)`)
}

await buildGlue()
await buildPack()
console.log('build-market: 全部完成')
