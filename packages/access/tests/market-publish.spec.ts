/**
 * 一键发布(market-publish.ts)行为矩阵:真 git 本地裸仓走完整发布流(无网无
 * GitHub 依赖;validate 以 skipValidate 跳过——其正确性由 eterna-plugins 仓 CI
 * 与生产验收承担),负路径(TS 源/UI 型/越权目录/撞版/远端分支已存在)逐一断言;
 * token 凭据纪律用桩 run/postJson 钉死(argv 与 PR body 恒不含 token 本体)。
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultMarketPublishDeps, marketPublishEnvFromProcess, publishPersonalPlugin, type MarketPublishEnv, type MarketPublishDeps } from '../src/market-publish.ts'

const GIT = (args: string[], cwd: string): string =>
  execFileSync('git', args, { cwd, encoding: 'utf8' })

describe('一键发布:submit_plugin_to_market 核心流', () => {
  let dir: string
  let userRoot: string
  let bare: string
  let env: MarketPublishEnv

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'eterna-mkt-'))
    userRoot = join(dir, 'workspaces', 'alice')
    mkdirSync(join(userRoot, 'plugins'), { recursive: true })
    // 本地裸仓当 origin(git clone <path> 直用);种子 main 至少含 market/index.json。
    bare = join(dir, 'origin.git')
    execFileSync('git', ['init', '--bare', '-b', 'main', bare])
    const seed = join(dir, 'seed')
    execFileSync('git', ['init', '-b', 'main', seed])
    mkdirSync(join(seed, 'market'), { recursive: true })
    writeFileSync(join(seed, 'market', 'index.json'), JSON.stringify({ format: 1, title: { en: 't', zh: 't' }, description: { en: 'd', zh: 'd' }, metadata: { categories: { tool: { title: { en: 'T', zh: 'T' } } } }, plugins: [] }, null, 2))
    GIT(['add', '-A'], seed)
    execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-m', 'seed'], { cwd: seed })
    execFileSync('git', ['push', bare, 'main'], { cwd: seed })
    rmSync(seed, { recursive: true, force: true })
    env = { repoUrl: bare, repoDir: join(dir, 'clone'), dshRange: '>=0.2.2-rc.5', token: undefined }
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  /** 把已推送的发布分支 ff-merge 进 bare 的 main(模拟 PR 合并;origin/main 随之前进)。 */
  function mergeBranchToMain(branch: string): void {
    const work = join(dir, 'merge-work')
    rmSync(work, { recursive: true, force: true })
    execFileSync('git', ['clone', bare, work])
    execFileSync('git', ['fetch', 'origin', branch], { cwd: work })
    execFileSync('git', ['merge', '--ff-only', 'FETCH_HEAD'], { cwd: work })
    execFileSync('git', ['push', 'origin', 'main'], { cwd: work })
    rmSync(work, { recursive: true, force: true })
  }

  /** 个人模板形态的源插件(export function apply;纯 JS 契约形态)。 */
  function writeSourcePlugin(name: string, body = ''): void {
    const src = join(userRoot, 'plugins', name)
    mkdirSync(src, { recursive: true })
    writeFileSync(join(src, 'package.json'), JSON.stringify({ name, version: '0.0.0', type: 'module', main: 'index.js', description: `${name} 测试插件` }, null, 2))
    writeFileSync(join(src, 'index.js'), `export function apply(ctx) {\n  ctx.tools.register({ name: '${name}_hello', execute: () => 'hi' })\n}\n${body}`)
  }

  it('首发全流程:组装/清单重写/两段 commit/push 到裸仓/compare 链接', async () => {
    writeSourcePlugin('my-tool')
    const outcome = await publishPersonalPlugin(defaultMarketPublishDeps(), env, { userRoot, pluginDirName: 'my-tool', author: 'alice', skipValidate: true })
    expect(outcome.ok).toBe(true)
    expect(outcome.branch).toBe('publish/my-tool-0.1.0')
    expect(outcome.pushed).toBe(true)
    // 清单重写:name/version/main(wrapper)/engines/peer 纪律/补丁行。
    const manifest = JSON.parse(readFileSync(join(env.repoDir, 'bundles', 'my-tool', 'package.json'), 'utf8')) as Record<string, unknown>
    expect(manifest.name).toBe('@eterna/my-tool')
    expect(manifest.version).toBe('0.1.0')
    expect(manifest.main).toBe('./__eterna_entry.js')
    expect(manifest.engines).toEqual({ dsh: '>=0.2.2-rc.5' })
    expect(manifest.private).toBeUndefined()
    expect(manifest.peerDependencies).toEqual({})
    const patch = readFileSync(join(env.repoDir, 'bundles', 'my-tool', 'cordis.patch.yml'), 'utf8')
    expect(patch).toContain('- insert:')
    expect(patch).toContain('id: eterna-my-tool')
    expect(patch).toContain("name: '@eterna/my-tool'")
    // wrapper 适配个人模板形态(命名 apply → default 实例)。
    const wrapper = readFileSync(join(env.repoDir, 'bundles', 'my-tool', '__eterna_entry.js'), 'utf8')
    expect(wrapper).toContain("import * as mod from './index.js'")
    expect(wrapper).toContain("name: base.name ?? 'eterna-my-tool'")
    // 索引条目:bundle commit 钉版 + path + 类型。
    const index = JSON.parse(readFileSync(join(env.repoDir, 'market', 'index.json'), 'utf8')) as { plugins: Array<{ name: string; versions: Array<{ version: string; source: { commit: string; path: string; type: string } }> }> }
    expect(index.plugins).toHaveLength(1)
    expect(index.plugins[0]?.name).toBe('@eterna/my-tool')
    expect(index.plugins[0]?.versions).toHaveLength(1)
    expect(index.plugins[0]?.versions[0]?.version).toBe('0.1.0')
    expect(index.plugins[0]?.versions[0]?.source.commit).toBe(outcome.bundleCommit)
    expect(index.plugins[0]?.versions[0]?.source.path).toBe('bundles/my-tool')
    expect(index.plugins[0]?.versions[0]?.source.type).toBe('git')
    // 两段 commit:bundle 与索引分属两个提交;提交作者=发布者账号(容器无全局 git 身份)。
    expect(outcome.indexCommit).not.toBe(outcome.bundleCommit)
    const author = GIT(['log', '-1', '--format=%an', 'market/index.json'], env.repoDir).trim()
    expect(author).toBe('alice')
    // push 已落裸仓;无 token → compare 链接。
    expect(GIT(['ls-remote', '--heads', bare], dir)).toContain('publish/my-tool-0.1.0')
    expect(outcome.compareUrl).toContain('/compare/main...publish/my-tool-0.1.0')
    expect(outcome.message).toContain('publish/my-tool-0.1.0')
  })

  it('二次发布自动递增版本;索引多版本按 SemVer 降序', async () => {
    writeSourcePlugin('my-tool')
    expect((await publishPersonalPlugin(defaultMarketPublishDeps(), env, { userRoot, pluginDirName: 'my-tool', skipValidate: true })).ok).toBe(true)
    // 模拟 PR 合并:main 前进到 0.1.0(origin/main 索引才有自动版本的基线)。
    mergeBranchToMain('publish/my-tool-0.1.0')
    writeSourcePlugin('my-tool', '// v2 变更')
    const second = await publishPersonalPlugin(defaultMarketPublishDeps(), env, { userRoot, pluginDirName: 'my-tool', skipValidate: true })
    expect(second.ok).toBe(true)
    expect(second.branch).toBe('publish/my-tool-0.1.1')
    const index = JSON.parse(readFileSync(join(env.repoDir, 'market', 'index.json'), 'utf8')) as { plugins: Array<{ versions: Array<{ version: string; source: { commit: string } }> }> }
    expect(index.plugins[0]?.versions.map(v => v.version)).toEqual(['0.1.1', '0.1.0'])
    expect(index.plugins[0]?.versions[0]?.source.commit).toBe(second.bundleCommit)
  })

  it('撞版先查:显式已存在版本在 commit 之前被拒', async () => {
    writeSourcePlugin('my-tool')
    expect((await publishPersonalPlugin(defaultMarketPublishDeps(), env, { userRoot, pluginDirName: 'my-tool', skipValidate: true })).ok).toBe(true)
    mergeBranchToMain('publish/my-tool-0.1.0')
    writeSourcePlugin('my-tool', '// 变更')
    const dup = await publishPersonalPlugin(defaultMarketPublishDeps(), env, { userRoot, pluginDirName: 'my-tool', version: '0.1.0', skipValidate: true })
    expect(dup.ok).toBe(false)
    expect(dup.message).toContain('已存在于索引')
    expect(GIT(['status', '--porcelain'], env.repoDir).trim()).toBe('')
  })

  it('远端同名分支已存在 → 拒绝(上次 PR 未合并)', async () => {
    writeSourcePlugin('my-tool')
    expect((await publishPersonalPlugin(defaultMarketPublishDeps(), env, { userRoot, pluginDirName: 'my-tool', skipValidate: true })).ok).toBe(true)
    writeSourcePlugin('my-tool', '// 变更')
    const dup = await publishPersonalPlugin(defaultMarketPublishDeps(), env, { userRoot, pluginDirName: 'my-tool', version: '0.1.0', skipValidate: true })
    expect(dup.ok).toBe(false)
    expect(dup.message).toContain('远端已存在')
  })

  it('负路径:TS 源拒发/UI 型拒发/越权目录拒发/缺 package.json 拒发', async () => {
    // TS 源(个人层契约只装载 .js/.mjs;发布面同口径拒绝)
    const ts = join(userRoot, 'plugins', 'ts-plugin')
    mkdirSync(ts, { recursive: true })
    writeFileSync(join(ts, 'package.json'), JSON.stringify({ name: 'ts-plugin', main: 'index.js' }))
    writeFileSync(join(ts, 'index.js'), 'export function apply() {}\n')
    writeFileSync(join(ts, 'helper.ts'), 'export const x = 1\n')
    const tsOutcome = await publishPersonalPlugin(defaultMarketPublishDeps(), env, { userRoot, pluginDirName: 'ts-plugin' })
    expect(tsOutcome.ok).toBe(false)
    expect(tsOutcome.message).toContain('TypeScript')
    // UI 型(dsh.client)不在一键发布范围
    const ui = join(userRoot, 'plugins', 'ui-plugin')
    mkdirSync(ui, { recursive: true })
    writeFileSync(join(ui, 'package.json'), JSON.stringify({ name: 'ui-plugin', main: 'index.js', dsh: { client: { inject: ['x'], platform: 'web' } } }))
    writeFileSync(join(ui, 'index.js'), 'export function apply() {}\n')
    const uiOutcome = await publishPersonalPlugin(defaultMarketPublishDeps(), env, { userRoot, pluginDirName: 'ui-plugin' })
    expect(uiOutcome.ok).toBe(false)
    expect(uiOutcome.message).toContain('UI')
    // 越权路径(resolve 逃出本人 plugins 根)
    const outside = await publishPersonalPlugin(defaultMarketPublishDeps(), env, { userRoot, pluginDirName: '../escape' })
    expect(outside.ok).toBe(false)
    expect(outside.message).toContain('不合法')
    // 缺 package.json
    mkdirSync(join(userRoot, 'plugins', 'empty-plugin'), { recursive: true })
    const emptyOutcome = await publishPersonalPlugin(defaultMarketPublishDeps(), env, { userRoot, pluginDirName: 'empty-plugin' })
    expect(emptyOutcome.ok).toBe(false)
    expect(emptyOutcome.message).toContain('package.json')
    // 不存在的目录
    const missing = await publishPersonalPlugin(defaultMarketPublishDeps(), env, { userRoot, pluginDirName: 'no-such' })
    expect(missing.ok).toBe(false)
    expect(missing.message).toContain('找不到插件目录')
    expect(existsSync(join(env.repoDir, 'bundles'))).toBe(false)
  })

  it('凭据纪律:token 只在 env 与 Authorization header,argv/PR body 恒不含本体;PR 用 API 开', async () => {
    writeSourcePlugin('my-tool')
    // 预置 clone 骨架(桩 run 不做真 git;仅需要 market/index.json 可读写)。
    mkdirSync(join(env.repoDir, '.git'), { recursive: true })
    mkdirSync(join(env.repoDir, 'market'), { recursive: true })
    writeFileSync(join(env.repoDir, 'market', 'index.json'), JSON.stringify({ format: 1, plugins: [] }))
    const calls: Array<{ cmd: string; args: readonly string[]; env: Record<string, string> | undefined }> = []
    const posts: Array<{ url: string; headers: Record<string, string>; body: unknown }> = []
    const token = 'gh_super_secret_token_value'
    const deps: MarketPublishDeps = {
      run: async (cmd, args, opts) => {
        calls.push({ cmd, args, env: opts.env })
        if (args[0] === 'ls-remote') return { code: 0, stdout: '', stderr: '' }
        if (args[0] === 'status') return { code: 0, stdout: '', stderr: '' }
        if (args[0] === 'show') return { code: 0, stdout: JSON.stringify({ format: 1, plugins: [] }), stderr: '' }
        if (args[0] === 'diff' && args[1] === '--cached') return { code: 1, stdout: '', stderr: '' } // 有差异
        return { code: 0, stdout: 'ok', stderr: '' }
      },
      postJson: async (url, headers, body) => {
        posts.push({ url, headers, body })
        return { status: 201, body: JSON.stringify({ html_url: 'https://github.com/x/y/pull/1' }) }
      },
      nowSeconds: () => 1763400000,
    }
    const outcome = await publishPersonalPlugin(deps, { ...env, repoUrl: 'https://github.com/acme/repo.git', token }, { userRoot, pluginDirName: 'my-tool' })
    expect(outcome.ok).toBe(true)
    expect(outcome.prUrl).toBe('https://github.com/x/y/pull/1')
    // push 的 argv 含 credential.helper,但只引用环境变量名,不含 token 本体。
    const push = calls.find(c => c.args.includes('push'))
    expect(push).toBeDefined()
    const pushArgv = JSON.stringify(push?.args ?? [])
    expect(pushArgv).toContain('$ETERNA_MARKET_GITHUB_TOKEN')
    expect(pushArgv).not.toContain(token)
    expect(push?.env?.ETERNA_MARKET_GITHUB_TOKEN).toBe(token)
    // PR 调用:token 在 Authorization header;URL 与 body 不含 token。
    expect(posts).toHaveLength(1)
    expect(posts[0]?.url).toBe('https://api.github.com/repos/acme/repo/pulls')
    expect(posts[0]?.headers.authorization).toBe(`Bearer ${token}`)
    expect(JSON.stringify(posts[0]?.body)).not.toContain(token)
    expect(posts[0]?.body).toMatchObject({ head: 'publish/my-tool-0.1.0', base: 'main' })
  })

  it('校验红:回退到 origin/main、不 push、带回校验输出', async () => {
    writeSourcePlugin('my-tool')
    const realDeps = defaultMarketPublishDeps()
    let validateCalls = 0
    const deps: MarketPublishDeps = {
      run: async (cmd, args, opts) => {
        if (cmd === 'node' && args[0] === 'scripts/validate.mjs') {
          validateCalls += 1
          return { code: 1, stdout: '', stderr: '✗ 插件 x:清单 name 与索引不一致' }
        }
        if (cmd === 'pnpm') return { code: 0, stdout: '', stderr: '' }
        return realDeps.run(cmd, args, opts)
      },
      postJson: (url, headers, body) => realDeps.postJson(url, headers, body),
      nowSeconds: () => 1763400000,
    }
    const outcome = await publishPersonalPlugin(deps, env, { userRoot, pluginDirName: 'my-tool' })
    expect(validateCalls).toBe(1)
    expect(outcome.ok).toBe(false)
    expect(outcome.message).toContain('校验未通过')
    // 工作区回退干净;远端没有分支。
    expect(GIT(['status', '--porcelain'], env.repoDir).trim()).toBe('')
    expect(GIT(['ls-remote', '--heads', bare], dir)).not.toContain('publish/my-tool')
  })

  it('push=false:停在本地分支,不 push 不开 PR', async () => {
    writeSourcePlugin('my-tool')
    const realDeps = defaultMarketPublishDeps()
    const deps: MarketPublishDeps = {
      run: async (cmd: string, args: readonly string[], opts: { cwd: string }) => {
        if (args[0] === 'push') throw new Error('push 不应被调用')
        return realDeps.run(cmd, args, opts)
      },
      postJson: async () => { throw new Error('PR 不应被调用') },
      nowSeconds: () => 1763400000,
    }
    const outcome = await publishPersonalPlugin(deps, env, { userRoot, pluginDirName: 'my-tool', push: false, skipValidate: true })
    expect(outcome.ok).toBe(true)
    expect(outcome.pushed).toBeUndefined()
    expect(outcome.branch).toBe('publish/my-tool-0.1.0')
    // 本地分支与提交在,远端无。
    expect(GIT(['rev-parse', '--verify', 'publish/my-tool-0.1.0'], env.repoDir).trim()).not.toBe('')
    expect(GIT(['ls-remote', '--heads', bare], dir)).not.toContain('publish/my-tool')
  })

  it('clone 缺席自动克隆;clone 不干净拒绝继续', async () => {
    writeSourcePlugin('my-tool')
    const first = await publishPersonalPlugin(defaultMarketPublishDeps(), env, { userRoot, pluginDirName: 'my-tool', push: false, skipValidate: true })
    expect(first.ok).toBe(true)
    expect(existsSync(join(env.repoDir, '.git'))).toBe(true)
    writeFileSync(join(env.repoDir, 'stray.txt'), 'dirty')
    const dirty = await publishPersonalPlugin(defaultMarketPublishDeps(), env, { userRoot, pluginDirName: 'my-tool', skipValidate: true })
    expect(dirty.ok).toBe(false)
    expect(dirty.message).toContain('未提交改动')
  })
})

describe('marketPublishEnvFromProcess:compose 空串口径', () => {
  it('compose ${VAR:-} 的未设置空串按缺席处理:默认值不被空串顶掉', () => {
    vi.stubEnv('ETERNA_MARKET_REPO_URL', '')
    vi.stubEnv('ETERNA_MARKET_REPO_DIR', '  ')
    vi.stubEnv('ETERNA_MARKET_DSH_RANGE', '')
    vi.stubEnv('ETERNA_MARKET_GITHUB_TOKEN', '')
    vi.stubEnv('DSH_HOME', '/tmp/dsh-home-env-spec')
    try {
      const env = marketPublishEnvFromProcess()
      expect(env.repoUrl).toBe('https://github.com/mahingbun-dev/eterna-plugins.git')
      expect(env.repoDir).toBe('/tmp/dsh-home-env-spec/market/eterna-plugins')
      expect(env.dshRange).toBe('>=0.2.2-rc.5')
      // 空 token 必须退化为 undefined(否则凭据 helper 用空密码 push,报错误导)。
      expect(env.token).toBeUndefined()
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('显式值优先且去首尾空白', () => {
    vi.stubEnv('ETERNA_MARKET_REPO_URL', ' https://example.com/x.git ')
    vi.stubEnv('ETERNA_MARKET_GITHUB_TOKEN', ' tok-123 ')
    try {
      const env = marketPublishEnvFromProcess()
      expect(env.repoUrl).toBe('https://example.com/x.git')
      expect(env.token).toBe('tok-123')
    } finally {
      vi.unstubAllEnvs()
    }
  })
})
