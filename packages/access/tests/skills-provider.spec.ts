/**
 * 全局 SkillProvider:scope 身份优先(账本归属)、cwd 回退、个人/共享候选、
 * 共享资源按用户缓存、删除/停用过滤、扫描不完整时 complete:false、轮询失效。
 */
import { chmodSync, mkdirSync, mkdtempSync, rmSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ACCESS_SKILL_PROVIDER, mountAccessSkills, PERSONAL_SKILL_RANK, SHARED_SKILL_RANK } from '../src/skills-provider.ts'
import { SkillStore } from '../src/skills-store.ts'

function md(name: string, description = '演示'): string {
  return `---\nname: ${name}\ndescription: ${description}\n---\n\n正文-${name}\n`
}

interface Control {
  readonly signal: AbortSignal
  invalidate(): void
}

interface Candidate {
  readonly name: string
  readonly source: string
  readonly rank: number
  readonly provider: string
  readonly locator: { readonly scope: string; readonly name: string; readonly account?: string }
  readonly path?: string
}

type CandidateList = readonly Candidate[] | { readonly candidates: readonly Candidate[]; readonly complete: boolean }

interface Provider {
  readonly name: string
  list(options: Record<string, unknown>): Promise<CandidateList>
  get(candidate: Candidate, options: Record<string, unknown>): Promise<{ content?: string; resourceBase?: { path: string } } | undefined>
}

describe('mountAccessSkills', () => {
  let root: string
  let store: SkillStore
  let provider: Provider
  let control: Control
  let invalidations: number
  let abort: AbortController

  function mountProvider(): void {
    abort = new AbortController()
    control = { signal: abort.signal, invalidate: () => { invalidations += 1 } }
    let create: ((control: Control) => Provider) | undefined
    const inner = {
      reflect: {
        get: (key: string) => key === 'skills'
          ? { registerProvider: (factory: (c: Control) => Provider) => { create = factory; return () => {} } }
          : undefined,
      },
    }
    const outer = {
      inject: (_names: readonly string[], install: (ctx: unknown) => void) => { install(inner) },
    }
    mountAccessSkills(outer as never, {
      store,
      tenantRoot: join(root, 'tenant'),
      isAccount: account => account === 'alice' || account === 'bob',
      accountOfSession: sessionId => sessionId === 's-alice' ? 'alice' : sessionId === 's-bob' ? 'bob' : undefined,
    })
    expect(create).toBeDefined()
    provider = create!(control)
  }

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'eterna-skills-provider-'))
    mkdirSync(join(root, 'tenant', 'alice'), { recursive: true })
    mkdirSync(join(root, 'tenant', 'bob'), { recursive: true })
    store = new SkillStore({ tenantRoot: join(root, 'tenant'), accessDir: join(root, 'access') })
    invalidations = 0
    mountProvider()
  })

  afterEach(() => {
    abort.abort()
    rmSync(root, { recursive: true, force: true })
    vi.useRealTimers()
  })

  async function list(options: Record<string, unknown> = {}): Promise<readonly Candidate[]> {
    const value = await provider.list(options)
    return 'candidates' in value ? value.candidates : value
  }

  it('provider 名称/来源/rank,个人覆盖共享同名', async () => {
    store.save('personal', 'alice', md('same-skill', '个人'))
    store.save('shared', 'alice', md('same-skill', '共享'))
    store.save('shared', 'alice', md('team-skill', '团队'))
    const candidates = await list({ cwd: join(root, 'tenant', 'alice') })
    expect(provider.name).toBe(ACCESS_SKILL_PROVIDER)
    expect(candidates.map(candidate => `${candidate.source}/${candidate.name}/${candidate.rank}`)).toEqual([
      'eterna-shared/same-skill/320',
      `eterna-shared/team-skill/${SHARED_SKILL_RANK}`,
      `eterna-personal/same-skill/${PERSONAL_SKILL_RANK}`,
    ])
    expect(candidates.find(candidate => candidate.source === 'eterna-personal')?.locator.account).toBe('alice')
  })

  it('活会话 scope 身份优先:scope=alice 且 cwd 指向 bob → 个人隔离只出共享', async () => {
    store.save('personal', 'alice', md('alice-skill'))
    store.save('personal', 'bob', md('bob-skill'))
    store.save('shared', 'alice', md('team-skill'))
    const candidates = await list({ scope: { id: 's-alice' }, cwd: join(root, 'tenant', 'bob') })
    expect(candidates.map(candidate => `${candidate.source}/${candidate.name}`)).toEqual(['eterna-shared/team-skill'])
  })

  it('scope 可解析但无 cwd 时仍出个人技能;未知 scope 回退 cwd', async () => {
    store.save('personal', 'alice', md('alice-skill'))
    const scoped = await list({ scope: { id: 's-alice' } })
    expect(scoped.map(candidate => candidate.name)).toEqual(['alice-skill'])
    const fallback = await list({ scope: { id: 'preset-key' }, cwd: join(root, 'tenant', 'alice') })
    expect(fallback.map(candidate => candidate.name)).toEqual(['alice-skill'])
  })

  it('cwd 不在租户根/首段不是账号 → 只出共享', async () => {
    store.save('shared', 'alice', md('team-skill'))
    store.save('personal', 'alice', md('alice-skill'))
    expect((await list({ cwd: '/tmp' })).map(candidate => candidate.name)).toEqual(['team-skill'])
    expect((await list({ cwd: join(root, 'tenant', 'mallory') })).map(candidate => candidate.name)).toEqual(['team-skill'])
  })

  it('get 返回正文;共享资源缓存落在用户根;个人 locator 跨 scope 拒绝', async () => {
    store.save('personal', 'alice', md('alice-skill'))
    store.save('shared', 'alice', md('team-skill'))
    const personal = (await list({ scope: { id: 's-alice' } })).find(candidate => candidate.name === 'alice-skill')!
    const shared = (await list({ scope: { id: 's-alice' } })).find(candidate => candidate.name === 'team-skill')!
    expect((await provider.get(personal, { scope: { id: 's-alice' } }))?.content).toContain('正文-alice-skill')
    const sharedDefinition = await provider.get(shared, { scope: { id: 's-alice' } })
    expect(sharedDefinition?.resourceBase?.path).toContain(join('alice', '.eterna', 'skill-cache', 'team-skill'))
    expect(await provider.get(personal, { scope: { id: 's-bob' } })).toBeUndefined()
  })

  it('停用/删除后 list 与 get 都不可见', async () => {
    store.save('personal', 'alice', md('alice-skill'))
    const candidate = (await list({ scope: { id: 's-alice' } }))[0]!
    store.toggle('personal', 'alice', 'alice-skill', false)
    expect(await list({ scope: { id: 's-alice' } })).toEqual([])
    expect(await provider.get(candidate, { scope: { id: 's-alice' } })).toBeUndefined()
    store.toggle('personal', 'alice', 'alice-skill', true)
    store.delete('personal', 'alice', 'alice-skill')
    expect(await list({ scope: { id: 's-alice' } })).toEqual([])
  })

  it('扫描失败 → complete:false(不冒充权威空目录)', async () => {
    if (typeof process.getuid === 'function' && process.getuid() === 0) return
    const personalRoot = store.personalRoot('alice')
    store.save('personal', 'alice', md('alice-skill'))
    chmodSync(personalRoot, 0o000)
    try {
      const value = await provider.list({ scope: { id: 's-alice' } })
      expect(Array.isArray(value)).toBe(false)
      expect((value as { complete: boolean }).complete).toBe(false)
    } finally {
      chmodSync(personalRoot, 0o755)
    }
  })

  it('轮询:文件 mtime 变化 → invalidate;abort 后停止', async () => {
    abort.abort()
    vi.useFakeTimers()
    mountProvider()
    const personalRoot = store.personalRoot('alice')
    store.save('personal', 'alice', md('alice-skill'))
    await list({ scope: { id: 's-alice' } })
    // 首次轮询只建立指纹;改动 SKILL.md 后第二次轮询才判定变化
    vi.advanceTimersByTime(15_000)
    utimesSync(join(personalRoot, 'alice-skill', 'SKILL.md'), new Date(), new Date(Date.now() + 5000))
    vi.advanceTimersByTime(15_000)
    expect(invalidations).toBeGreaterThan(0)
    const count = invalidations
    abort.abort()
    utimesSync(join(personalRoot, 'alice-skill', 'SKILL.md'), new Date(), new Date(Date.now() + 10000))
    vi.advanceTimersByTime(30_000)
    expect(invalidations).toBe(count)
  })
})
