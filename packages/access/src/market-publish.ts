/**
 * 一键发布(2026-11-19):创造模式个人工具插件 → 官方插件仓库 eterna-plugins(PR 流)。
 *
 * 用户决策(2026-11-19):平台内工具形态;push 所有人可用,但 main 设分支保护——
 * 一律「分支 commit → push → 开 PR」,永不直推 main。
 *
 * 流程(PUBLISHING.md 六步的自动化):
 *   源检查 → 组装 bundle(清单重写 + wrapper 入口 + 补丁行)→ 写入 clone →
 *   两段 commit(索引条目钉 bundle commit 的 SHA)→ validate.mjs → push 分支 →
 *   GitHub API 开 PR。
 *
 * 形状事实(全部实核):
 * - 个人插件契约 = tenant-plugins.ts:126-163(入口 .js/.mjs、apply 导出双形态、
 *   受限 ctx 只有 tools.register)——所以本工具不编译,只做清单重写与 wrapper;
 * - bundle loader 取模块**默认导出插件实例**(eterna-plugins template/index.js
 *   头注;缺 default = 静默不装载),故 wrapper 恒生成 default 导出;
 * - 兼容闸评 engines.dsh 单独裁决(dsh-app-boot evaluatePluginCompatibility;
 *   memory compat-gate-reads-all-patch-referenced-packages),engines 一发即短接
 *   peers 逐个校验,range 取 >=0.2.2-alpha.2 对生产内核 alpha.3 满足;
 * - insert 行必须带 id(eterna-plugins template/cordis.patch.yml 头注的 E2E 教训)。
 *
 * 凭据纪律(AGENTS.md):token 只走 compose .env → 容器 env,push 用
 * `credential.helper` 从环境变量现读——helper 字符串与 argv 恒不含 token 本体。
 */
import { spawn } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { personalPluginDir } from './user-plugins.ts'

/** 目录/工具名共用口径(与 tenant-plugins.ts TOOL_NAME_PATTERN 一致)。 */
const NAME_PATTERN = /^[\w][\w.-]{0,63}$/u

/** 发布面环境(compose 透传;缺省对齐生产容器布局)。 */
export interface MarketPublishEnv {
  readonly repoUrl: string
  readonly repoDir: string
  /** engines.dsh / @deepseek-ai/* peer 的兼容范围(须被生产内核满足)。 */
  readonly dshRange: string
  /** GitHub token(fine-grained:contents:write + pull-requests:write);缺席=停在 push 降级。 */
  readonly token: string | undefined
}

export function marketPublishEnvFromProcess(): MarketPublishEnv {
  return {
    repoUrl: process.env.ETERNA_MARKET_REPO_URL ?? 'https://github.com/mahingbun-dev/eterna-plugins.git',
    // 铁律 T1(tenant-scan):持久化路径以 $DSH_HOME/cwd 为基,禁硬编码容器绝对路径
    // ——部署契约 working_dir=home(DSH_HOME=/data),故缺省落 <home>/market/eterna-plugins。
    repoDir: process.env.ETERNA_MARKET_REPO_DIR ?? join(process.env.DSH_HOME ?? process.cwd(), 'market', 'eterna-plugins'),
    dshRange: process.env.ETERNA_MARKET_DSH_RANGE ?? '>=0.2.2-alpha.2',
    token: process.env.ETERNA_MARKET_GITHUB_TOKEN ?? undefined,
  }
}

export interface RunResult {
  readonly code: number
  readonly stdout: string
  readonly stderr: string
}

export interface MarketPublishDeps {
  /** 进程执行面(execFile 包装;测试可桩)。 */
  run(cmd: string, args: readonly string[], opts: { readonly cwd: string; readonly env?: Record<string, string> }): Promise<RunResult>
  /** JSON POST 面(开 PR;测试可桩)。默认实现带 Authorization,token 恒在 header 不入 body。 */
  postJson(url: string, headers: Record<string, string>, body: unknown): Promise<{ status: number; body: string }>
  nowSeconds(): number
}

export function defaultMarketPublishDeps(): MarketPublishDeps {
  return {
    run(cmd, args, opts) {
      return new Promise((resolveRun) => {
        const child = spawn(cmd, args, {
          cwd: opts.cwd,
          env: opts.env === undefined ? process.env : { ...process.env, ...opts.env },
        })
        let stdout = ''
        let stderr = ''
        child.stdout.setEncoding('utf8')
        child.stderr.setEncoding('utf8')
        child.stdout.on('data', (chunk: string) => {
          stdout += chunk
        })
        child.stderr.on('data', (chunk: string) => {
          stderr += chunk
        })
        child.on('error', (error: Error) => {
          resolveRun({ code: -1, stdout, stderr: `${stderr}${String(error)}` })
        })
        child.on('close', (code) => {
          resolveRun({ code: code ?? -1, stdout, stderr })
        })
      })
    },
    async postJson(url, headers, body) {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'accept': 'application/vnd.github+json', ...headers },
        body: JSON.stringify(body),
      })
      return { status: response.status, body: await response.text() }
    },
    nowSeconds: () => Math.floor(Date.now() / 1000),
  }
}

export interface PublishParams {
  /** 调用者的用户根(<tenantRoot>/<账号>;由工具侧按会话归属解析)。 */
  readonly userRoot: string
  /** 本人 plugins 根下的插件目录名。 */
  readonly pluginDirName: string
  /** 提交作者名(取调用者账号;容器内 git 无全局配置,commit 须显式 -c)。 */
  readonly author?: string
  readonly version?: string
  readonly title?: string
  readonly description?: string
  /** 默认 true;false = 组装+commit 停在本地(不 push 不开 PR)。 */
  readonly push?: boolean
  /** 测试面:跳过 clone 内 validate.mjs(其依赖 devDeps 安装)。 */
  readonly skipValidate?: boolean
}

export interface PublishOutcome {
  readonly ok: boolean
  /** 中文汇总(工具直接返回给会话)。 */
  readonly message: string
  readonly branch?: string
  readonly bundleCommit?: string
  readonly indexCommit?: string
  readonly prUrl?: string
  readonly compareUrl?: string
  readonly pushed?: boolean
}

const fail = (message: string): PublishOutcome => ({ ok: false, message })

interface SourceBundle {
  readonly dirName: string
  readonly pkgName: string
  readonly rowId: string
  readonly version: string
  readonly title: string
  readonly description: string
}

/** 源目录递归收集(剔 .git/.DS_Store/node_modules;.d.ts 豁免)。 */
function walkFiles(root: string, current = '', acc: string[] = []): string[] {
  const abs = current === '' ? root : join(root, current)
  for (const name of readdirSync(abs)) {
    if (name === '.git' || name === '.DS_Store' || name === 'node_modules') continue
    const rel = current === '' ? name : `${current}/${name}`
    const full = join(root, rel)
    if (statSync(full).isDirectory()) { walkFiles(root, rel, acc); continue }
    acc.push(rel)
  }
  return acc
}

/** 组装 bundle 到临时目录;返回清单与入口改写结果。入口改走 wrapper(零用户代码改动):
 *  wrapper 动态适配「default 导出实例」与「命名 apply 导出」两形态,运行时拒绝
 *  越出 tools 的 inject 面(UI/服务型不在一键发布范围)。 */
function assembleBundle(
  srcDir: string,
  spec: SourceBundle,
  env: MarketPublishEnv,
): string {
  const files = walkFiles(srcDir)
  const tsOffender = files.find(f => /\.(ts|mts|cts)$/u.test(f) && !f.endsWith('.d.ts'))
  if (tsOffender !== undefined) {
    throw new Error(`目录含 TypeScript 源 ${tsOffender}:个人层契约要求纯 JS 入口(tenant-plugins.ts 只装载 .js/.mjs)。请先把 TS 编译为 .js 再发布。`)
  }
  const manifestRaw = JSON.parse(readFileSync(join(srcDir, 'package.json'), 'utf8')) as Record<string, unknown>
  if (manifestRaw.dsh !== null && typeof manifestRaw.dsh === 'object' && (manifestRaw.dsh as Record<string, unknown>).client !== undefined) {
    throw new Error('插件声明了 dsh.client(UI 半边):UI 型插件不在一键发布范围,请按 eterna-plugins docs/PUBLISHING.md 手工发布(需客户端工件构建)。')
  }
  const mainRaw = typeof manifestRaw.main === 'string' && manifestRaw.main !== '' ? manifestRaw.main : 'index.js'
  if (!/\.(js|mjs)$/u.test(mainRaw)) {
    throw new Error(`main(${mainRaw})必须指向 .js/.mjs 纯 JS 入口`)
  }
  const entryFile = resolve(srcDir, mainRaw)
  if (!existsSync(entryFile)) throw new Error(`入口文件不存在:${mainRaw}`)
  // 源清单里显式依赖的 @deepseek-ai/* 挪进 peer(发布纪律:dependencies 双装即版本漂移)。
  const sourceDeps = { ...(manifestRaw.dependencies as Record<string, string> | undefined ?? {}) }
  const peers: Record<string, string> = { ...(manifestRaw.peerDependencies as Record<string, string> | undefined ?? {}) }
  // @deepseek-ai/* 只许 peer(双装即版本漂移);以重建对象替代动态 delete(lint 纪律)。
  const deps: Record<string, string> = {}
  for (const [key, range] of Object.entries(sourceDeps)) {
    if (key.startsWith('@deepseek-ai/')) peers[key] = peers[key] ?? env.dshRange
    else deps[key] = range
  }
  const manifest: Record<string, unknown> = {
    name: spec.pkgName,
    version: spec.version,
    description: spec.description,
    type: 'module',
    // wrapper 入口(见 wrapperSource):bundle loader 取 default 导出实例
    main: './__eterna_entry.js',
    exports: { '.': './__eterna_entry.js', './package.json': './package.json' },
    peerDependencies: peers,
    engines: { dsh: env.dshRange },
    dsh: { manifestVersion: 1, bundle: { patch: './cordis.patch.yml' } },
  }
  if (Object.keys(deps).length > 0) manifest.dependencies = deps

  // staging 放 clone 之外(DSH_HOME 语义下的临时目录):落在 clone 内会弄脏
  // git status,污染下一次发布的清洁检查。
  const outDir = join(resolve(env.repoDir, '..'), '.eterna-publish-staging', `${spec.dirName}-${spec.version}`)
  rmSync(outDir, { recursive: true, force: true })
  mkdirSync(outDir, { recursive: true })
  for (const rel of files) {
    const dest = join(outDir, rel)
    mkdirSync(dirname(dest), { recursive: true })
    cpSync(join(srcDir, rel), dest)
  }
  // wrapper:入口相对导入原 main;default 缺席时回退命名 apply(个人模板形态)。
  const entryBase = basename(mainRaw)
  writeFileSync(join(outDir, '__eterna_entry.js'), wrapperSource(entryBase, spec.rowId))
  // 补丁行:源目录自带 cordis.patch.yml 则原样保留(作者自管);缺省生成 insert 行。
  if (!existsSync(join(outDir, 'cordis.patch.yml'))) {
    writeFileSync(join(outDir, 'cordis.patch.yml'),
      `# 由 EternaAgent submit_plugin_to_market 生成:新增行必须 - insert:(带 id)。\n- insert:\n    - id: ${spec.rowId}\n      name: '${spec.pkgName}'\n`)
  }
  // package.json 最后写(覆盖拷贝来的原件)。
  writeFileSync(join(outDir, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  return outDir
}

function wrapperSource(entryBase: string, rowId: string): string {
  return `// 由 EternaAgent submit_plugin_to_market 生成:bundle loader 取默认导出实例。
import * as mod from './${entryBase}'
const raw = mod.default ?? (typeof mod.apply === 'function' ? { apply: mod.apply } : undefined)
if (raw === undefined) throw new Error('入口缺少 default 导出与 apply 导出(两形态皆无 = 无法装载)')
const base = typeof raw === 'function' ? { apply: raw } : raw
const injectKeys = Object.keys(base.inject ?? {}).filter((k) => k !== 'tools')
if (injectKeys.length > 0) throw new Error('inject 含一键发布不支持的注入面(' + injectKeys.join(', ') + '):UI/服务型插件请按 docs/PUBLISHING.md 手工发布')
export default { ...base, name: base.name ?? '${rowId}', inject: { ...(base.inject ?? {}), tools: true } }
`
}

/** 读/合并索引条目;返回新 versions 条目(版本纪律:精确 SemVer、同条目内唯一)。 */
function mergeIndexVersion(
  cloneDir: string,
  spec: SourceBundle,
  env: MarketPublishEnv,
  bundleCommit: string,
  now: number,
): void {
  const indexPath = join(cloneDir, 'market', 'index.json')
  const index = JSON.parse(readFileSync(indexPath, 'utf8')) as {
    format: number
    plugins: Array<{
      name: string
      title: { en: string; zh: string }
      description: { en: string; zh: string }
      homepage?: string
      repository?: { url: string; directory?: string }
      metadata?: { category?: string; keywords?: string[] }
      versions: Array<{ version: string; publishTimestamp: number; source: { type: string; url: string; commit: string; path: string } }>
    }>
  }
  const webUrl = env.repoUrl.replace(/\.git$/u, '')
  let entry = index.plugins.find(p => p.name === spec.pkgName)
  if (entry === undefined) {
    entry = {
      name: spec.pkgName,
      title: { en: spec.title, zh: spec.title },
      description: { en: spec.description, zh: spec.description },
      homepage: webUrl,
      repository: { url: webUrl, directory: `bundles/${spec.dirName}` },
      metadata: { category: 'tool', keywords: [spec.dirName] },
      versions: [],
    }
    index.plugins.push(entry)
  }
  if (entry.versions.some(v => v.version === spec.version)) {
    throw new Error(`版本 ${spec.version} 已存在于索引(@${spec.pkgName});请递增版本后重试`)
  }
  entry.versions.push({
    version: spec.version,
    publishTimestamp: now,
    source: { type: 'git', url: webUrl, commit: bundleCommit, path: `bundles/${spec.dirName}` },
  })
  // 上游解析器按 SemVer 降序取最新——写入即排序,避免依赖运行时容错。
  entry.versions.sort((a, b) => compareSemver(b.version, a.version))
  writeFileSync(indexPath, `${JSON.stringify(index, null, 2)}\n`)
}

function compareSemver(a: string, b: string): number {
  const parse = (v: string) => v.split('.').map(n => Number.parseInt(n, 10) || 0)
  const [pa, pb] = [parse(a), parse(b)]
  for (let i = 0; i < 3; i += 1) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0)
  }
  return 0
}

/** 自动版本:索引已有该条目 → 最新版本 patch+1;新品 → 0.1.0。 */
type OriginIndex = { plugins?: Array<{ name?: string; versions?: Array<{ version: string }> }> } | undefined

function autoVersion(index: OriginIndex, pkgName: string): string {
  const entry = index?.plugins?.find(p => p.name === pkgName)
  const latest = entry?.versions?.[0]?.version
  if (latest === undefined) return '0.1.0'
  const parts = latest.split('.')
  const patch = Number.parseInt(parts[2] ?? '0', 10) || 0
  return `${parts[0] ?? 0}.${parts[1] ?? 0}.${patch + 1}`
}

/** 读 origin/main 上的索引(克隆可能停在旧分支;一切判定以 origin/main 为准)。 */
async function originIndex(deps: MarketPublishDeps, env: MarketPublishEnv): Promise<OriginIndex> {
  const shown = await deps.run('git', ['show', 'origin/main:market/index.json'], { cwd: env.repoDir })
  if (shown.code !== 0) return undefined
  try {
    return JSON.parse(shown.stdout) as { plugins?: Array<{ name?: string; versions?: Array<{ version: string }> }> }
  } catch {
    return undefined
  }
}

async function git(deps: MarketPublishDeps, cloneDir: string, args: readonly string[], env?: Record<string, string>): Promise<RunResult> {
  const result = await deps.run('git', args, env === undefined ? { cwd: cloneDir } : { cwd: cloneDir, env })
  if (result.code !== 0) {
    throw new Error(`git ${args[0]} 失败:${(result.stderr || result.stdout).trim().slice(0, 400)}`)
  }
  return result
}

function copyDir(src: string, dest: string): void {
  rmSync(dest, { recursive: true, force: true })
  mkdirSync(dirname(dest), { recursive: true })
  cpSync(src, dest, { recursive: true })
}

/** 目录级字节对比(无变更短路)。 */
function dirsIdentical(a: string, b: string): boolean {
  const la = walkFiles(a).sort()
  const lb = walkFiles(b).sort()
  if (la.length !== lb.length) return false
  for (const [i, rel] of la.entries()) {
    const other = lb[i]
    if (other === undefined || rel !== other) return false
    if (!readFileSync(join(a, rel)).equals(readFileSync(join(b, other)))) return false
  }
  return true
}

/** 主流程。ok=false 时 message 带可操作的中文指引。 */
export async function publishPersonalPlugin(
  deps: MarketPublishDeps,
  env: MarketPublishEnv,
  params: PublishParams,
): Promise<PublishOutcome> {
  try {
    // 1. 归属钳制:只发布本人 plugins 根下的目录(与 install 工具同口径)。
    const dirName = params.pluginDirName.trim()
    if (!NAME_PATTERN.test(dirName)) return fail(`插件目录名 ${JSON.stringify(dirName)} 不合法(须匹配 ^[\\w][\\w.-]{0,63}$)`)
    const srcDir = personalPluginDir(params.userRoot, dirName)
    if (srcDir === undefined || !existsSync(srcDir)) {
      return fail(`找不到插件目录:${dirName}(它必须已存在于你的 plugins 目录;用 install_personal_plugin 安装过的目录都在其中)`)
    }
    if (!existsSync(join(srcDir, 'package.json'))) return fail(`插件目录缺 package.json:${srcDir}`)

    // 2. clone 就绪(缺席自动克隆;有未提交改动=异常态,拒绝继续)。
    if (!existsSync(join(env.repoDir, '.git'))) {
      mkdirSync(dirname(env.repoDir), { recursive: true })
      const cloned = await deps.run('git', ['clone', env.repoUrl, env.repoDir], { cwd: dirname(env.repoDir) })
      if (cloned.code !== 0) return fail(`克隆插件仓库失败:${(cloned.stderr || cloned.stdout).trim().slice(0, 300)}`)
    }
    const status = await git(deps, env.repoDir, ['status', '--porcelain'])
    if (status.stdout.trim() !== '') return fail(`插件仓库工作区(${env.repoDir})有未提交改动,先清理再发布:\n${status.stdout.trim().slice(0, 300)}`)
    await git(deps, env.repoDir, ['fetch', 'origin'])

    // 3. 版本与命名——一切判定以 origin/main 为准(clone 可能停在旧分支):
    //    git show origin/main:market/index.json 读版本基线,撞版先查(避免 commit①
    //    之后才发现),分支名先于任何工作区变更确定。
    const pkgName = `@eterna/${dirName}`
    const rowId = `eterna-${dirName}`
    const originIdx = await originIndex(deps, env)
    const version = params.version?.trim() || autoVersion(originIdx, pkgName)
    if (!/^\d+\.\d+\.\d+$/u.test(version)) return fail(`版本号 ${JSON.stringify(version)} 必须是精确 SemVer(x.y.z)`)
    if (originIdx?.plugins?.find(p => p.name === pkgName)?.versions?.some(v => v.version === version) === true) {
      return fail(`版本 ${version} 已存在于索引(${pkgName});请递增版本后重试`)
    }
    const srcManifest = JSON.parse(readFileSync(join(srcDir, 'package.json'), 'utf8')) as Record<string, unknown>
    const spec: SourceBundle = {
      dirName,
      pkgName,
      rowId,
      version,
      title: params.title?.trim() || (typeof srcManifest.description === 'string' && srcManifest.description !== '' ? srcManifest.description.slice(0, 60) : dirName),
      description: params.description?.trim() || (typeof srcManifest.description === 'string' && srcManifest.description !== '' ? srcManifest.description : `${dirName} 工具插件(由 EternaAgent 创造模式开发)`),
    }

    // 4. 分支先行(checkout -B 把工作区重置到 origin/main),再组装/落盘——
    //    否则先拷贝再 checkout 会把新 bundle 覆盖回旧内容(顺序缺陷,2026-11-19 自查)。
    const branch = `publish/${dirName}-${version}`
    const remoteBranch = await deps.run('git', ['ls-remote', '--heads', 'origin', branch], { cwd: env.repoDir })
    if (remoteBranch.stdout.trim() !== '') return fail(`分支 ${branch} 在远端已存在(上次发布未合并?)。请先处理该 PR 或删除远端分支,再重试。`)
    await git(deps, env.repoDir, ['checkout', '-B', branch, 'origin/main'])

    // 5. 组装 → 无变更短路(对照 origin/main 现行 bundle)→ 落入 clone。
    const stagingDir = assembleBundle(srcDir, spec, env)
    const destDir = join(env.repoDir, 'bundles', dirName)
    if (existsSync(destDir) && dirsIdentical(stagingDir, destDir)) {
      rmSync(stagingDir, { recursive: true, force: true })
      await git(deps, env.repoDir, ['checkout', 'main']).catch(() => git(deps, env.repoDir, ['checkout', 'origin/main']))
      return fail('bundle 与仓库现行版本逐字节相同(未检测到变更)。改了插件代码后重新发布,或显式传新 version。')
    }
    copyDir(stagingDir, destDir)
    rmSync(stagingDir, { recursive: true, force: true })

    // 6. 两段 commit(索引条目钉 bundle commit 的 SHA)。容器内 git 无全局身份
    //    配置,commit 显式 -c(作者=调用者账号)。
    const author = params.author?.trim() || 'eterna'
    const commitAs = ['-c', `user.name=${author}`, '-c', 'user.email=eterna@local', 'commit']
    await git(deps, env.repoDir, ['add', '-A', `bundles/${dirName}`])
    // git diff --cached --quiet:退出码 0=无差异、1=有差异(git() 对 1 抛错)。
    const hasChanges = await git(deps, env.repoDir, ['diff', '--cached', '--quiet']).then(() => false, () => true)
    if (!hasChanges) return fail('bundle 内容与 origin/main 无差异(未检测到变更),取消发布')
    await git(deps, env.repoDir, [...commitAs, '-m', `feat(${dirName}): v${version} 由 EternaAgent 一键发布`])
    const bundleCommit = (await git(deps, env.repoDir, ['rev-parse', 'HEAD'])).stdout.trim()
    mergeIndexVersion(env.repoDir, spec, env, bundleCommit, deps.nowSeconds())
    await git(deps, env.repoDir, ['add', 'market/index.json'])
    await git(deps, env.repoDir, [...commitAs, '-m', `chore(market): 登记 ${pkgName}@${version}`])
    const indexCommit = (await git(deps, env.repoDir, ['rev-parse', 'HEAD'])).stdout.trim()

    // 7. 校验(clone devDeps 缺席先装;红则回退到 origin/main 并带回全部错误,不 push)。
    if (params.skipValidate !== true) {
      if (!existsSync(join(env.repoDir, 'node_modules', '@deepseek-ai', 'dsh-plugin-market-index'))) {
        const installed = await deps.run('pnpm', ['install', '--frozen-lockfile'], { cwd: env.repoDir })
        if (installed.code !== 0) return fail(`插件仓库依赖安装失败:${(installed.stderr || installed.stdout).trim().slice(0, 300)}`)
      }
      const validated = await deps.run('node', ['scripts/validate.mjs'], { cwd: env.repoDir })
      if (validated.code !== 0) {
        await git(deps, env.repoDir, ['reset', '--hard', 'origin/main'])
        return fail(`仓库校验未通过(未推送)。校验器输出:\n${(validated.stderr || validated.stdout).trim().slice(0, 1200)}`)
      }
    }

    // 8. push 分支(token 经 credential.helper 从环境现读,helper 串与 argv 恒不含
    //    token 本体)。push=false 停在本地分支(自查形态)。
    const compareUrl = `${env.repoUrl.replace(/\.git$/u, '')}/compare/main...${branch}`
    if (params.push === false) {
      return {
        ok: true,
        message: [
          `✅ 已完成本地发布准备:${pkgName}@${version}`,
          `分支:${branch}(bundle commit ${bundleCommit.slice(0, 10)},索引 commit ${indexCommit.slice(0, 10)})`,
          'push=false:未推送。自查 bundles/ 与 market/index.json 后,带 push=true 重发或手动推送。',
        ].join('\n'),
        branch, bundleCommit, indexCommit, compareUrl,
      }
    }
    const pushEnv = env.token === undefined ? undefined : { ETERNA_MARKET_GITHUB_TOKEN: env.token }
    const pushArgs = env.token === undefined
      ? ['push', 'origin', branch]
      : ['-c', 'credential.helper=!f(){ echo "username=x-access-token"; echo "password=$ETERNA_MARKET_GITHUB_TOKEN"; }; f', 'push', 'origin', branch]
    const pushed = await deps.run('git', pushArgs, pushEnv === undefined ? { cwd: env.repoDir } : { cwd: env.repoDir, env: pushEnv })
    if (pushed.code !== 0) {
      const hint = env.token === undefined
        ? '未配置 ETERNA_MARKET_GITHUB_TOKEN(在部署 .env 配置后重启容器即自动开 PR),或手动从下方链接开 PR:'
        : 'push 失败(token 权限不足或网络不可达?),可手动从下方链接开 PR:'
      return { ok: false, message: `分支已提交到本地 clone 但推送失败。${hint}\n${compareUrl}\n${(pushed.stderr || pushed.stdout).trim().slice(0, 400)}`, branch, bundleCommit, indexCommit, compareUrl }
    }

    // 9. 开 PR(base: main;分支保护要求 PR,永不直推 main)。422 = PR 已存在,不算失败。
    let prUrl: string | undefined
    if (env.token !== undefined) {
      const ownerRepo = env.repoUrl.replace(/^https?:\/\/[^/]+\//u, '').replace(/\.git$/u, '')
      const pr = await deps.postJson(
        `https://api.github.com/repos/${ownerRepo}/pulls`,
        { authorization: `Bearer ${env.token}`, 'x-gitHub-api-version': '2022-11-28' },
        { title: `feat(${dirName}): v${version}`, head: branch, base: 'main', body: `一键发布(EternaAgent submit_plugin_to_market)。\n\n- 包:${pkgName}@${version}\n- bundle commit:${bundleCommit}\n- 索引 commit:${indexCommit}\n\nCI(validate)绿后即可合并;合并后在发现页「插件索引」菜单刷新即可安装。` },
      )
      if (pr.status === 201) {
        try { prUrl = (JSON.parse(pr.body) as { html_url?: string }).html_url } catch { /* 保底走 compare 链接 */ }
      } else if (pr.status !== 422) {
        return { ok: true, message: `分支已推送,但开 PR 失败(HTTP ${pr.status}):${pr.body.slice(0, 300)}。可手动:${compareUrl}`, branch, bundleCommit, indexCommit, compareUrl, pushed: true }
      }
    }
    const lines = [
      `✅ 发布流程完成:${pkgName}@${version}`,
      `分支:${branch}(bundle commit ${bundleCommit.slice(0, 10)})`,
      prUrl !== undefined ? `PR:${prUrl}` : `开 PR:${compareUrl}`,
      '后续:CI(validate)绿 → 合并 PR → 产品「插件 → 发现 → 插件索引菜单刷新」→ 安装 → 启用(重启生效)。',
    ]
    return {
      ok: true,
      message: lines.join('\n'),
      branch, bundleCommit, indexCommit, compareUrl, pushed: true,
      ...(prUrl !== undefined ? { prUrl } : {}),
    }
  } catch (error) {
    return fail(`发布失败:${error instanceof Error ? error.message : String(error)}`)
  }
}
