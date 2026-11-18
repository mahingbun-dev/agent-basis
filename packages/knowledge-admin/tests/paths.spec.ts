/**
 * 账号路径解析 & 越权 sanitize(验收第 1 项)。
 *
 * 断言的实质:多租户隔离的**唯一**保证是路径解析 + 越权判定这两处事实上正确;
 * 任何一处放宽都等于跨账号读写的泄露面,所以这里逐字段钉死(含 `*` 哨兵与非法账号名)。
 */
import { describe, expect, it } from 'vitest'
import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import {
  GLOBAL_ACCOUNT, accountIsOpen, isValidAccountName, knowledgeAdminHome, listAccountNames,
  resolveAccountPath, resolveGlobalPath, resolveTenantRoot,
} from '../src/paths.ts'
import { KnowledgeAdminService } from '../src/service.ts'
import { accountAllowed } from '../src/types.ts'
import { adminCaller, createRig, userCaller } from './rig.ts'

describe('paths:租户根与分库路径', () => {
  it('ETERNA_TENANT_ROOT 优先于 DSH_HOME/workspaces', () => {
    const rig = createRig()
    try {
      const fromEnv = resolveTenantRoot({ env: { ETERNA_TENANT_ROOT: '/custom/tenants', DSH_HOME: rig.root }, cwd: rig.root })
      expect(fromEnv).toBe('/custom/tenants')
      const fromHome = resolveTenantRoot({ env: { DSH_HOME: rig.root }, cwd: rig.root })
      expect(fromHome).toBe(join(rig.root, 'workspaces'))
      const fromCwd = resolveTenantRoot({ env: {}, cwd: '/tmp/x' })
      expect(fromCwd).toBe('/tmp/x/workspaces')
    } finally {
      rig.cleanup()
    }
  })

  it('账号库 = <tenantRoot>/<account>/knowledge.wiki + .eterna/knowledge.sqlite3', () => {
    const rig = createRig()
    try {
      const paths = { tenantRoot: rig.tenantRoot, env: rig.env, cwd: rig.cwd }
      const alice = resolveAccountPath(paths, 'alice')
      expect(alice).toBeDefined()
      expect(alice?.wikiDir).toBe(join(rig.tenantRoot, 'alice', 'knowledge.wiki'))
      expect(alice?.dbPath).toBe(join(rig.tenantRoot, 'alice', '.eterna', 'knowledge.sqlite3'))
      expect(alice?.global).toBe(false)
      expect(alice?.account).toBe('alice')
    } finally {
      rig.cleanup()
    }
  })

  it('全局库 = <cwd>/knowledge.wiki + <cwd>/.eterna/knowledge.sqlite3,config 覆盖优先', () => {
    const rig = createRig()
    try {
      const paths = { tenantRoot: rig.tenantRoot, env: rig.env, cwd: rig.cwd }
      const global = resolveGlobalPath(paths)
      expect(global.wikiDir).toBe(join(rig.cwd, 'knowledge.wiki'))
      expect(global.dbPath).toBe(join(rig.cwd, '.eterna', 'knowledge.sqlite3'))
      expect(global.account).toBe(GLOBAL_ACCOUNT)
      expect(global.global).toBe(true)

      const overridden = resolveGlobalPath({
        ...paths, wikiDir: '/tmp/w/wk', dbPath: '/tmp/w/db.sqlite3',
      })
      expect(overridden.wikiDir).toBe('/tmp/w/wk')
      expect(overridden.dbPath).toBe('/tmp/w/db.sqlite3')
    } finally {
      rig.cleanup()
    }
  })

  it('非法账号名一律 undefined(路径穿越 / 空 / 点开头 / `*`)', () => {
    const rig = createRig()
    try {
      const paths = { tenantRoot: rig.tenantRoot, env: rig.env, cwd: rig.cwd }
      expect(isValidAccountName('alice')).toBe(true)
      expect(isValidAccountName('a.b_c-d')).toBe(true)
      expect(isValidAccountName('')).toBe(false)
      expect(isValidAccountName('.hidden')).toBe(false)
      expect(isValidAccountName('../etc')).toBe(false)
      expect(isValidAccountName('a/b')).toBe(false)
      expect(isValidAccountName('*')).toBe(false)
      expect(isValidAccountName('x'.repeat(300))).toBe(false)
      expect(resolveAccountPath(paths, '../etc')).toBeUndefined()
      expect(resolveAccountPath(paths, '')).toBeUndefined()
    } finally {
      rig.cleanup()
    }
  })

  it('listAccountNames 只列已开通目录(跳过隐藏/非目录/非法名)', () => {
    const rig = createRig()
    try {
      for (const account of ['alice', 'bob']) mkdirSync(join(rig.tenantRoot, account), { recursive: true })
      mkdirSync(join(rig.tenantRoot, '.cache'), { recursive: true })
      mkdirSync(join(rig.tenantRoot, 'not-opened'), { recursive: true })
      // 账号目录在场即"已开通"(wiki 子目录是否已建不影响枚举;隐藏目录被白名单挡掉)
      const names = listAccountNames({ tenantRoot: rig.tenantRoot, env: rig.env, cwd: rig.cwd })
      expect(names).toEqual(['alice', 'bob', 'not-opened'])
      expect(names).not.toContain('.cache')
      expect(accountIsOpen({ tenantRoot: rig.tenantRoot, env: rig.env, cwd: rig.cwd }, 'alice')).toBe(true)
      // 口径:账号目录在场 = 已开通(glue 同款);wiki 子目录缺席只表示"还没写过内容"
      expect(accountIsOpen({ tenantRoot: rig.tenantRoot, env: rig.env, cwd: rig.cwd }, 'not-opened')).toBe(true)
      expect(accountIsOpen({ tenantRoot: rig.tenantRoot, env: rig.env, cwd: rig.cwd }, 'never-created')).toBe(false)
    } finally {
      rig.cleanup()
    }
  })

  it('adminHome 缺省 = ($DSH_HOME ?? cwd)/knowledge-admin', () => {
    expect(knowledgeAdminHome({ env: { DSH_HOME: '/dsh' }, cwd: '/cwd' })).toBe(join('/dsh', 'knowledge-admin'))
    expect(knowledgeAdminHome({ env: {}, cwd: '/cwd' })).toBe(join('/cwd', 'knowledge-admin'))
  })
})

describe('accountAllowed(纯函数口径)', () => {
  it('非管理员:本人 OK、他人 forbidden、* forbidden、空=本人 OK', () => {
    const caller = userCaller('alice')
    expect(accountAllowed(caller, undefined)).toBeUndefined()
    expect(accountAllowed(caller, '')).toBeUndefined()
    expect(accountAllowed(caller, 'alice')).toBeUndefined()
    expect(accountAllowed(caller, 'bob')).toBe('forbidden')
    expect(accountAllowed(caller, '*')).toBe('forbidden')
  })

  it('管理员:任意账号与 * 均放行', () => {
    const caller = adminCaller()
    expect(accountAllowed(caller, 'bob')).toBeUndefined()
    expect(accountAllowed(caller, '*')).toBeUndefined()
  })
})

describe('服务面越权 sanitize(端到端)', () => {
  it('非管理员读他人账号 → forbidden(且不落任何文件)', async () => {
    const rig = createRig()
    const service = new KnowledgeAdminService(rig.deps())
    try {
      const result = await service.listDocs(userCaller('alice'), { account: 'bob' })
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.code).toBe('forbidden')
      expect(existsSync(join(rig.tenantRoot, 'bob'))).toBe(false)
    } finally {
      service.dispose()
      rig.cleanup()
    }
  })

  it('身份缺失(account 为空)→ unauthorized fail-closed', async () => {
    const rig = createRig()
    const service = new KnowledgeAdminService(rig.deps())
    try {
      const result = await service.overview({ account: '', admin: false, userId: 9 }, {})
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.code).toBe('unauthorized')
    } finally {
      service.dispose()
      rig.cleanup()
    }
  })

  it('管理员可读他人账号;* 哨兵走全局库', async () => {
    const rig = createRig()
    const service = new KnowledgeAdminService(rig.deps())
    try {
      const bob = await service.listDocs(adminCaller(), { account: 'bob' })
      expect(bob.ok).toBe(true)
      const global = await service.listDocs(adminCaller(), { account: GLOBAL_ACCOUNT })
      expect(global.ok).toBe(true)
      if (global.ok) expect(global.value.items).toEqual([])
    } finally {
      service.dispose()
      rig.cleanup()
    }
  })

  it('listAccounts:普通账号只见本人;管理员见全局 + 全部账号', async () => {
    const rig = createRig()
    try {
      mkdirSync(join(rig.tenantRoot, 'bob', 'knowledge.wiki'), { recursive: true })
      const service = new KnowledgeAdminService(rig.deps())
      try {
        const mine = await service.listAccounts(userCaller('alice'), {})
        expect(mine.ok).toBe(true)
        if (mine.ok) {
          expect(mine.value.accounts).toHaveLength(1)
          expect(mine.value.accounts[0]?.account).toBe('alice')
          expect(mine.value.accounts[0]?.self).toBe(true)
        }
        const all = await service.listAccounts(adminCaller(), {})
        expect(all.ok).toBe(true)
        if (all.ok) {
          expect(all.value.accounts.map(a => a.account)).toEqual([GLOBAL_ACCOUNT, 'bob'])
          expect(all.value.accounts[0]?.global).toBe(true)
        }
      } finally {
        service.dispose()
      }
    } finally {
      rig.cleanup()
    }
  })
})
