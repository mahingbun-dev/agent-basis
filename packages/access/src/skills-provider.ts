/**
 * 把 access 的个人/共享技能目录接进上游 `ctx.skills`(Eterna 全局 provider)。
 *
 * 为什么是全局单 provider + cwd 解析:
 * - 上游 catalog 的读取口径是 `ctx.skills.snapshot({cwd, scope})`:热会话 cwd=agent
 *   工作目录,冷会话由 SessionSkillCatalog 用 session 投影的 cwd —— 两条路径都带
 *   cwd,但不把用户账号当 scope 传下来;
 * - 因此 provider 只按 cwd 是否落在 `<tenantRoot>/<account>` 下解析账号(账号必须
 *   真实存在于 users 表),个人技能只从该账号根读;cwd 不在租户根时只出共享技能。
 *   注册缓存的 key 含 cwd+scope,不同用户的工作区不同,不会串目录。
 *
 * cwd 是唯一身份来源的代价:admin/super 会话若把 cwd 设到租户根之外,看不到自己
 * 的个人技能(共享技能仍可见)。这是有意 fail-closed —— 宁可少给,不猜账号。
 * 2026-11-26 加固:活会话优先用 `options.scope` 的会话 id → 账本归属账号(scope 是
 * 硬身份,cwd 只作冷会话回退);两者不一致时个人技能整体隔离。
 *
 * provider 注册走 `ctx.inject(['skills'], ...)`:access 可能先于 skills 服务挂载;
 * 服务就绪后注册,provider 生命周期随 access 插件卸载。文件变化用 15s 轻量轮询
 * (只轮询已出现过的个人根 + 共享根)调 `invalidate()`,UI 写入后另由 routes 立即调。
 */
import type { Context } from '@deepseek-ai/cordis'
import { lstatSync, readdirSync, realpathSync } from 'node:fs'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { withinRoot } from './within-root.ts'
import type { SkillEntry, SkillScope, SkillStore } from './skills-store.ts'

/** provider 名称(全局唯一;runtime 保留名不可用)。 */
export const ACCESS_SKILL_PROVIDER = 'eterna-skills'
/** 共享技能 rank(数值越小越优先;低于 bundled 600)。 */
export const SHARED_SKILL_RANK = 320
/** 个人技能 rank(同名个人覆盖共享)。 */
export const PERSONAL_SKILL_RANK = 310
/** 轮询间隔(ms)。 */
const SKILL_POLL_MS = 15_000

export interface AccessSkillsDeps {
  readonly store: SkillStore
  readonly tenantRoot: string
  /** 账号是否真实存在(防 cwd 里拼出任意目录名)。 */
  readonly isAccount: (account: string) => boolean
  /** 会话 id → 账号(scope 优先的硬身份;缺席回退 cwd)。 */
  readonly accountOfSession?: ((sessionId: string) => string | undefined) | undefined
  readonly logger?: { warn(message: string): void } | undefined
}

/** 路由侧拿到的失效柄(provider 尚未挂载时 no-op)。 */
export interface AccessSkillsRuntime {
  invalidate(): void
  readonly mounted: boolean
}

interface SkillCandidateLike {
  readonly name: string
  readonly description: string
  readonly whenToUse?: string
  readonly invocation: { readonly modelInvocable: boolean; readonly userInvocable: boolean }
  readonly source: string
  readonly provider: string
  readonly rank: number
  readonly locator: unknown
  readonly path?: string
  readonly metadata?: Readonly<Record<string, unknown>>
}

interface SkillDefinitionLike extends Omit<SkillCandidateLike, 'rank' | 'locator' | 'metadata'> {
  readonly content: string
  readonly resourceBase?: { readonly kind: 'directory'; readonly path: string }
}

interface SkillLookupOptionsLike {
  readonly cwd?: string | undefined
  readonly signal?: AbortSignal | undefined
  /** 上游 SkillViewOptions.scope:活会话=Agent(带 session id);冷会话=preset scope。 */
  readonly scope?: unknown
}

interface SkillProviderControlLike {
  readonly signal: AbortSignal
  invalidate(): void
}

type SkillListResult =
  | readonly SkillCandidateLike[]
  | { readonly candidates: readonly SkillCandidateLike[]; readonly complete: boolean }

interface SkillProviderLike {
  readonly name: string
  list(options: SkillLookupOptionsLike): Promise<SkillListResult>
  get(candidate: SkillCandidateLike, options: SkillLookupOptionsLike): Promise<SkillDefinitionLike | undefined>
}

interface SkillsRegistryLike {
  registerProvider(create: (control: SkillProviderControlLike) => SkillProviderLike): () => void
}

/** 挂载 provider;服务缺席时静默等待(Cordis inject 子 fiber)。 */
export function mountAccessSkills(ctx: Context, deps: AccessSkillsDeps): AccessSkillsRuntime {
  let control: SkillProviderControlLike | undefined
  let timer: NodeJS.Timeout | undefined
  let mounted = false
  const roots = new Set<string>([deps.store.sharedRoot()])
  const fingerprints = new Map<string, string>()

  const cancelWatcher = (): void => {
    if (timer !== undefined) {
      clearInterval(timer)
      timer = undefined
    }
  }

  const installProvider = (inner: Context): void => {
    if (mounted) return
    const skills = inner.reflect.get('skills', false) as SkillsRegistryLike | undefined
    if (skills === undefined || typeof skills.registerProvider !== 'function') {
      deps.logger?.warn('skills: ctx.skills 形态不匹配(上游漂移?),个人/共享技能未挂载')
      return
    }
    const provider = createProvider(deps, (root) => { roots.add(root) })
    try {
      skills.registerProvider((next) => {
        control = next
        next.signal.addEventListener('abort', cancelWatcher, { once: true })
        return provider
      })
    } catch (error) {
      deps.logger?.warn(`skills: provider ${ACCESS_SKILL_PROVIDER} 注册失败: ${error instanceof Error ? error.message : String(error)}`)
      return
    }
    mounted = true
    timer = setInterval(() => { pollRoots(roots, fingerprints, control) }, SKILL_POLL_MS)
    timer.unref()
  }

  // ctx.inject 在当前 Context 类型上是公开方法(plugin.ts:608 同款);服务缺席不失败。
  ctx.inject(['skills'], installProvider)

  return {
    invalidate(): void { control?.invalidate() },
    get mounted(): boolean { return mounted },
  }
}

/** 构造 provider;`rememberRoot` 让轮询覆盖实际被读到的个人根。 */
function createProvider(
  deps: AccessSkillsDeps,
  rememberRoot: (root: string) => void,
): SkillProviderLike {
  return {
    name: ACCESS_SKILL_PROVIDER,
    list(options: SkillLookupOptionsLike): Promise<SkillListResult> {
      const identity = accountOfOptions(deps, options)
      const account = identity.mismatch ? undefined : identity.account
      if (identity.mismatch) {
        deps.logger?.warn(`skills: 会话账号 ${identity.scopedAccount} 与 cwd 账号 ${identity.cwdAccount} 不一致,个人技能已隔离`)
      }
      if (account !== undefined) rememberRoot(deps.store.personalRoot(account))
      const shared = deps.store.listSharedStatus(false, false)
      const personal = account === undefined
        ? { entries: [], complete: true }
        : deps.store.listPersonalStatus(account, false, false)
      const candidates = [
        ...shared.entries.map(entry => candidateOf(entry, account)),
        ...personal.entries.map(entry => candidateOf(entry, account)),
      ]
      if (!shared.complete || !personal.complete) {
        return Promise.resolve({ candidates, complete: false })
      }
      return Promise.resolve(candidates)
    },
    get(candidate: SkillCandidateLike, options: SkillLookupOptionsLike): Promise<SkillDefinitionLike | undefined> {
      const locator = candidate.locator as { scope: SkillScope; name: string; account?: string }
      const identity = accountOfOptions(deps, options)
      const account = locator.account ?? identity.account
      if (locator.scope === 'personal') {
        if (account === undefined) return Promise.resolve(undefined)
        if (identity.scopedAccount !== undefined && locator.account !== identity.scopedAccount) return Promise.resolve(undefined)
      }
      try {
        const read = deps.store.read(locator.scope, account ?? '', locator.name)
        if (!read.entry.enabled) return Promise.resolve(undefined)
        const resourceDir = deps.store.resourceDir(read.entry, account)
        return Promise.resolve({
          name: read.entry.name,
          description: read.entry.description,
          ...(read.entry.whenToUse === undefined ? {} : { whenToUse: read.entry.whenToUse }),
          invocation: { modelInvocable: true, userInvocable: true },
          source: sourceOf(locator.scope),
          provider: ACCESS_SKILL_PROVIDER,
          path: join(read.entry.dir, 'SKILL.md'),
          content: read.markdown,
          ...(resourceDir === undefined ? {} : { resourceBase: { kind: 'directory', path: resourceDir } }),
        })
      } catch (error) {
        deps.logger?.warn(`skills: 加载 ${locator.scope}/${locator.name} 失败: ${error instanceof Error ? error.message : String(error)}`)
        return Promise.resolve(undefined)
      }
    },
  }
}

function candidateOf(entry: SkillEntry, account: string | undefined): SkillCandidateLike {
  const locatorAccount = entry.scope === 'personal' ? (account ?? dirAccount(entry.dir)) : account
  return {
    name: entry.name,
    description: entry.description,
    ...(entry.whenToUse === undefined ? {} : { whenToUse: entry.whenToUse }),
    invocation: { modelInvocable: true, userInvocable: true },
    source: sourceOf(entry.scope),
    provider: ACCESS_SKILL_PROVIDER,
    rank: entry.scope === 'personal' ? PERSONAL_SKILL_RANK : SHARED_SKILL_RANK,
    locator: {
      scope: entry.scope,
      name: entry.name,
      ...(locatorAccount === undefined ? {} : { account: locatorAccount }),
    },
    path: join(entry.dir, 'SKILL.md'),
  }
}

function sourceOf(scope: SkillScope): string {
  return scope === 'personal' ? 'eterna-personal' : 'eterna-shared'
}

/** 从个人技能目录反推账号(目录固定为 <...>/<account>/.eterna/skills/<name>)。 */
function dirAccount(dir: string): string | undefined {
  const parts = dir.split(sep)
  const skills = parts.lastIndexOf('skills')
  if (skills >= 2 && parts[skills - 1] === '.eterna') return parts[skills - 2]
  return undefined
}

interface OptionsIdentity {
  readonly account: string | undefined
  readonly scopedAccount: string | undefined
  readonly cwdAccount: string | undefined
  readonly mismatch: boolean
}

/** scope(活会话)→ 会话归属优先;无法解析时回退 cwd。两者都有但不一致=fail-closed 个人隔离。 */
function accountOfOptions(deps: AccessSkillsDeps, options: SkillLookupOptionsLike): OptionsIdentity {
  const sessionId = sessionIdOf(options.scope)
  const scopedAccount = sessionId === undefined ? undefined : deps.accountOfSession?.(sessionId)
  const cwdAccount = accountFromCwd(deps, options.cwd)
  if (scopedAccount !== undefined) {
    return {
      account: scopedAccount,
      scopedAccount,
      cwdAccount,
      mismatch: cwdAccount !== undefined && cwdAccount !== scopedAccount,
    }
  }
  return { account: cwdAccount, scopedAccount: undefined, cwdAccount, mismatch: false }
}

/** 从上游 scope 取会话 id(Agent 自身带 id;部分形态只带 session.id)。 */
function sessionIdOf(scope: unknown): string | undefined {
  if (typeof scope !== 'object' || scope === null) return undefined
  const direct = (scope as { id?: unknown }).id
  if (typeof direct === 'string' && direct !== '') return direct
  const session = (scope as { session?: unknown }).session
  if (typeof session === 'object' && session !== null) {
    const id = (session as { id?: unknown }).id
    if (typeof id === 'string' && id !== '') return id
  }
  return undefined
}

/**
 * cwd → 账号:必须在 tenantRoot 内、首段账号真实存在;否则 undefined。
 * realpath 两侧解析(tenantRoot 可能是 /var → /private/var 符号链接前缀)。
 */
function accountFromCwd(deps: AccessSkillsDeps, cwd: string | undefined): string | undefined {
  if (cwd === undefined || cwd === '') return undefined
  const root = canonical(deps.tenantRoot)
  const target = canonical(cwd)
  if (!withinRoot(target, root)) return undefined
  const rel = relative(root, target)
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) return undefined
  const account = rel.split(sep)[0]
  if (account === undefined || account === '') return undefined
  if (!deps.isAccount(account)) return undefined
  return account
}

function canonical(path: string): string {
  try {
    return realpathSync(path)
  } catch {
    return resolve(path)
  }
}

/** 轮询:根目录指纹变化即失效(只比较 SKILL.md/meta/目录 mtime)。 */
function pollRoots(
  roots: ReadonlySet<string>,
  fingerprints: Map<string, string>,
  control: SkillProviderControlLike | undefined,
): void {
  if (control === undefined || control.signal.aborted) return
  let changed = false
  for (const root of roots) {
    const next = fingerprint(root)
    if (fingerprints.get(root) !== next) {
      if (fingerprints.has(root)) changed = true
      fingerprints.set(root, next)
    }
  }
  if (changed) control.invalidate()
}

function fingerprint(root: string): string {
  let children
  try { children = readdirSync(root, { withFileTypes: true }) } catch { return '-' }
  const parts: string[] = []
  for (const child of children.sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0)) {
    if (!child.isDirectory() || child.isSymbolicLink() || child.name.startsWith('.')) continue
    const dir = join(root, child.name)
    parts.push(`${child.name}:${statSignature(dir)}:${statSignature(join(dir, 'SKILL.md'))}:${statSignature(join(dir, '.skill-meta.json'))}`)
  }
  return parts.join('|')
}

function statSignature(path: string): string {
  try {
    const stat = lstatSync(path)
    return `${stat.mtimeMs}:${stat.size}`
  } catch {
    return '-'
  }
}
