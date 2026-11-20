import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { hashPassword } from '../src/password.ts'
import {
  accountCandidates, LastAdminError, OldPasswordMismatchError, SelfDeleteError,
  UserNotFoundError, UserStore,
} from '../src/store.ts'

describe('UserStore 用户存储', () => {
  let dir: string
  let store: UserStore

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'eterna-access-store-'))
    store = new UserStore(join(dir, 'users.db'))
  })
  afterEach(() => {
    store.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('seedAdmin:仅空表播种,幂等,无 env 不播种', () => {
    expect(store.seedAdmin('Mr.Ma', 'Test-only-pass-9')).toBe(true)
    expect(store.seedAdmin('Mr.Ma', 'x')).toBe(false)
    const empty = new UserStore(join(dir, 'empty.db'))
    try {
      expect(empty.seedAdmin(undefined, undefined)).toBe(false)
      expect(empty.listUsers()).toEqual([])
    } finally {
      empty.close()
    }
  })

  it('verifyLogin:成功/密码错/账号不存在一律区分对待(错误不泄漏存在性)', () => {
    store.createUserWithSuffix({ account: 'alice', password: 'password8', nickname: 'Alice' })
    expect(store.verifyLogin('alice', 'password8')?.nickname).toBe('Alice')
    expect(store.verifyLogin('alice', 'wrong-pass')).toBeNull()
    expect(store.verifyLogin('nobody', 'password8')).toBeNull()
  })

  it('D11:基名可用直用;重名后缀从 01 递增', () => {
    const first = store.createUserWithSuffix({ account: 'zhangsan', password: 'password8' })
    expect(first.finalAccount).toBe('zhangsan')
    expect(first.user.nickname).toBe('zhangsan')
    const second = store.createUserWithSuffix({ account: 'zhangsan', password: 'password8' })
    expect(second.finalAccount).toBe('zhangsan01')
    const third = store.createUserWithSuffix({ account: 'zhangsan', password: 'password8' })
    expect(third.finalAccount).toBe('zhangsan02')
  })

  it('D11:手工占用的同后缀号自动跳过', () => {
    store.createUserWithSuffix({ account: 'zhangsan', password: 'password8' })
    store.createUserWithSuffix({ account: 'zhangsan01', password: 'password8' })
    const next = store.createUserWithSuffix({ account: 'zhangsan', password: 'password8' })
    expect(next.finalAccount).toBe('zhangsan02')
  })

  it('D11:超 32 位截基座保后缀,后缀始终完整', () => {
    const longBase = 'a'.repeat(32)
    store.createUserWithSuffix({ account: longBase, password: 'password8' })
    const second = store.createUserWithSuffix({ account: longBase, password: 'password8' })
    expect(second.finalAccount.length).toBeLessThanOrEqual(32)
    expect(second.finalAccount.endsWith('01')).toBe(true)
  })

  it('D11:基名已含后缀形态的重名照常递增,基名与后缀号互不干扰', () => {
    store.createUserWithSuffix({ account: 'wang', password: 'password8' })
    store.createUserWithSuffix({ account: 'wang01', password: 'password8' })
    expect(store.createUserWithSuffix({ account: 'wang', password: 'password8' }).finalAccount).toBe('wang02')
  })

  it('候选序列生成器:基名→两位零填充→三位自然进位;超长截基座保后缀', () => {
    const gen = accountCandidates('zhangsan')
    expect(gen.next().value).toBe('zhangsan')
    expect(gen.next().value).toBe('zhangsan01')
    expect(gen.next().value).toBe('zhangsan02')
    expect(gen.next().value).toBe('zhangsan03')
    const long = accountCandidates('a'.repeat(32))
    long.next() // 基名
    expect(long.next().value).toBe('a'.repeat(30) + '01')
    expect(long.next().value).toBe('a'.repeat(30) + '02')
    const gen99 = accountCandidates('w')
    for (let i = 0; i <= 99; i++) gen99.next()
    expect(gen99.next().value).toBe('w100')
  })

  it('setPassword:验旧密;成功后 password_version 递增(旧会话吊销原语)', () => {
    const { user } = store.createUserWithSuffix({ account: 'bob', password: 'password8' })
    expect(store.getPasswordVersion(user.id)).toBe(1)
    expect(() => { store.setPassword(user.id, 'wrong-pass', 'password9') }).toThrow(OldPasswordMismatchError)
    store.setPassword(user.id, 'password8', 'password9')
    expect(store.getPasswordVersion(user.id)).toBe(2)
    expect(store.verifyLogin('bob', 'password9')?.passwordVersion).toBe(2)
    expect(store.verifyLogin('bob', 'password8')).toBeNull()
  })

  it('deleteUser 护栏:不能删自己;最后一个 admin 不可删;普通用户可删', () => {
    const admin = store.createUserWithSuffix({ account: 'root', password: 'password8', role: 'admin' }).user
    const user = store.createUserWithSuffix({ account: 'carol', password: 'password8' }).user
    expect(() => { store.deleteUser(admin.id, admin.id) }).toThrow(SelfDeleteError)
    expect(() => { store.deleteUser(admin.id, user.id) }).toThrow(LastAdminError)
    store.deleteUser(user.id, admin.id)
    expect(store.getUserById(user.id)).toBeUndefined()
    expect(() => { store.deleteUser(user.id, admin.id) }).toThrow(UserNotFoundError)
    // 第二个 admin 出现后,可删其一
    const admin2 = store.createUserWithSuffix({ account: 'root2', password: 'password8', role: 'admin' }).user
    store.deleteUser(admin.id, admin2.id)
    expect(store.getUserById(admin.id)).toBeUndefined()
  })

  it('deleteUser 级联清理名下 sessions/workspaces(owner_id 外键引用 users,不清则 FK 炸 500)', () => {
    const admin = store.createUserWithSuffix({ account: 'root', password: 'password8', role: 'admin' }).user
    const user = store.createUserWithSuffix({ account: 'zhangsan', password: 'password8' }).user
    // 复现生产路径:用户用过产品 → 守卫登记 session 与 workspace 归属
    store.recordSession('sess-1', user.id, 'ws-1')
    store.recordSession('sess-2', user.id, null)
    store.recordWorkspace('ws-1', user.id, '/home/zhangsan')
    expect(() => { store.deleteUser(user.id, admin.id) }).not.toThrow()
    expect(store.getUserById(user.id)).toBeUndefined()
    // 登记行随人走:session 注销、workspace 归属注销
    expect(store.sessionOwner('sess-1')).toBeUndefined()
    expect(store.sessionOwner('sess-2')).toBeUndefined()
    expect(store.workspaceOwner('ws-1')).toBeUndefined()
    // 仅挂 session(无 workspace)的用户同样可删
    const other = store.createUserWithSuffix({ account: 'alice', password: 'password8' }).user
    store.recordSession('sess-alice', other.id, null)
    expect(() => { store.deleteUser(other.id, admin.id) }).not.toThrow()
    expect(store.sessionOwner('sess-alice')).toBeUndefined()
  })

  it('workspaceIdByOwnerPath/ownsAnyWorkspace:登录开通与改判的幂等判定', () => {
    const user = store.createUserWithSuffix({ account: 'zhangsan', password: 'password8' }).user
    const other = store.createUserWithSuffix({ account: 'lisi', password: 'password8' }).user
    expect(store.ownsAnyWorkspace(user.id)).toBe(false)
    expect(store.workspaceIdByOwnerPath(user.id, '/home/zhangsan')).toBeUndefined()
    store.recordWorkspace('ws-1', user.id, '/home/zhangsan')
    expect(store.ownsAnyWorkspace(user.id)).toBe(true)
    expect(store.workspaceIdByOwnerPath(user.id, '/home/zhangsan')).toBe('ws-1')
    // 路径相同属主不同 → 不串号(改判只认自己的记账)
    store.recordWorkspace('ws-2', other.id, '/home/zhangsan')
    expect(store.workspaceIdByOwnerPath(user.id, '/home/zhangsan')).toBe('ws-1')
    expect(store.workspaceIdByOwnerPath(other.id, '/home/zhangsan')).toBe('ws-2')
  })

  it('userIdByAccount:按账号名查 id,命中/未命中(A2 归属登记的 realm→账号映射读取面,不验密)', () => {
    const { user } = store.createUserWithSuffix({ account: 'admin', password: 'password8', role: 'admin' })
    expect(store.userIdByAccount('admin')).toBe(user.id)
    // 未命中(部署 realm 与登录账号名不对齐时,消费方按 undefined 显式可见)
    expect(store.userIdByAccount('nobody')).toBeUndefined()
  })

  it('recordSession:同 id 二写不炸且覆写(INSERT…ON CONFLICT upsert;归属改判语义)', () => {
    const alice = store.createUserWithSuffix({ account: 'alice', password: 'password8' }).user
    const bob = store.createUserWithSuffix({ account: 'bob', password: 'password8' }).user
    store.recordSession('sess-x', alice.id, null)
    expect(store.sessionOwner('sess-x')).toBe(alice.id)
    expect(() => { store.recordSession('sess-x', bob.id, 'ws-bob') }).not.toThrow()
    expect(store.sessionOwner('sess-x')).toBe(bob.id)
    // 二写不增行(主键唯一,upsert)
    expect(store.sessionsOfOwner(bob.id)).toEqual(['sess-x'])
    expect(store.sessionsOfOwner(alice.id)).toEqual([])
  })

  it('头像 BLOB 往返与重置;昵称策略', () => {
    const { user } = store.createUserWithSuffix({ account: 'dave', password: 'password8' })
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3])
    store.setAvatar(user.id, png, 'image/png')
    expect(store.getAvatar(user.id)?.mime).toBe('image/png')
    expect(store.getAvatar(user.id)?.data[0]).toBe(0x89)
    store.setAvatar(user.id, null, null)
    expect(store.getAvatar(user.id)).toBeUndefined()
    expect(() => { store.setNickname(user.id, '') }).toThrow()
    expect(() => { store.setNickname(user.id, 'x'.repeat(33)) }).toThrow()
    store.setNickname(user.id, '大卫')
    expect(store.getUserById(user.id)?.nickname).toBe('大卫')
  })

  it('listUsers 汇总不含敏感字段,hasAvatar 正确', () => {
    const { user } = store.createUserWithSuffix({ account: 'erin', password: 'password8' })
    store.setAvatar(user.id, new Uint8Array([1]), 'image/png')
    const summary = store.listUsers().find(u => u.account === 'erin')
    expect(summary?.hasAvatar).toBe(true)
    expect(JSON.stringify(summary)).not.toContain('password')
  })

  // ── WS-C(37 号 M-1):角色值域扩 approver + 存量库 CHECK 迁移 ──────────────

  it('WS-C:新库建 approver 用户成功且读回 role=approver;setUserRole 写面直改', () => {
    const { user } = store.createUserWithSuffix({ account: 'auditor', password: 'password8', role: 'approver' })
    expect(store.getUserById(user.id)?.role).toBe('approver')
    expect(store.verifyLogin('auditor', 'password8')?.role).toBe('approver')
    expect(store.listUsers().find(u => u.id === user.id)?.role).toBe('approver')
    // M-3 角色写面(requireRow + UPDATE,语义护栏在 routes 层)
    store.setUserRole(user.id, 'user')
    expect(store.getUserById(user.id)?.role).toBe('user')
    store.setUserRole(user.id, 'approver')
    expect(store.getUserById(user.id)?.role).toBe('approver')
    expect(() => { store.setUserRole(99999, 'user') }).toThrow(UserNotFoundError)
  })

  it('WS-C 迁移:旧 CHECK 存量库 → new UserStore 触发重建,数据/FK 完整且可写 approver', () => {
    // 手工构造旧形态库(两值 CHECK;admin/user 各一 + 子表 FK 行),复用 mkdtemp 先例
    const legacyPath = join(dir, 'legacy.db')
    const legacy = new DatabaseSync(legacyPath)
    legacy.exec(`CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account TEXT NOT NULL UNIQUE,
      nickname TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      password_version INTEGER NOT NULL DEFAULT 1,
      role TEXT NOT NULL CHECK(role IN ('admin','user')),
      avatar BLOB,
      avatar_mime TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`)
    legacy.exec('CREATE TABLE sessions (session_id TEXT PRIMARY KEY, owner_id INTEGER NOT NULL REFERENCES users(id), workspace_id TEXT)')
    legacy.exec('CREATE TABLE workspaces (workspace_id TEXT PRIMARY KEY, owner_id INTEGER NOT NULL REFERENCES users(id), path TEXT NOT NULL)')
    legacy.prepare("INSERT INTO users (account, nickname, password_hash, role) VALUES ('root', '老管理员', ?, 'admin')").run(hashPassword('password8'))
    legacy.prepare("INSERT INTO users (account, nickname, password_hash, role) VALUES ('u1', '用户一', ?, 'user')").run(hashPassword('password8'))
    legacy.exec("INSERT INTO sessions (session_id, owner_id) VALUES ('s-legacy', 2)")
    legacy.exec("INSERT INTO workspaces (workspace_id, owner_id, path) VALUES ('w-legacy', 2, '/tmp/u1')")
    legacy.close()
    // 触发迁移:构造器内建表后幂等迁移
    const migrated = new UserStore(legacyPath)
    try {
      // 旧三列数据完整读回(含 admin/user 各一)
      const admin = migrated.verifyLogin('root', 'password8')
      const user = migrated.verifyLogin('u1', 'password8')
      expect(admin).toMatchObject({ account: 'root', nickname: '老管理员', role: 'admin' })
      expect(user).toMatchObject({ account: 'u1', role: 'user' })
      // 已迁移库可写 approver
      const approver = migrated.createUserWithSuffix({ account: 'auditor', password: 'password8', role: 'approver' })
      expect(approver.user.role).toBe('approver')
      // FK 完整:子表行不变 + foreign_key_check 空
      expect(migrated.sessionOwner('s-legacy')).toBe(user!.id)
      expect(migrated.workspaceOwner('w-legacy')).toBe(user!.id)
      const probe = new DatabaseSync(legacyPath)
      try {
        expect(probe.prepare('PRAGMA foreign_key_check').all()).toEqual([])
        const sql = (probe.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='users'").get() as { sql: string }).sql
        expect(sql).toContain("'approver'")
      } finally {
        probe.close()
      }
    } finally {
      migrated.close()
    }
  })

  it('WS-C 迁移幂等:对已迁移库再 new UserStore 无副作用(sqlite_master SQL 不再变)', () => {
    const oncePath = join(dir, 'once.db')
    const legacy = new DatabaseSync(oncePath)
    legacy.exec(`CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account TEXT NOT NULL UNIQUE,
      nickname TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      password_version INTEGER NOT NULL DEFAULT 1,
      role TEXT NOT NULL CHECK(role IN ('admin','user')),
      avatar BLOB,
      avatar_mime TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`)
    legacy.close()
    const first = new UserStore(oncePath)
    first.close()
    const probeA = new DatabaseSync(oncePath)
    const sqlAfterFirst = (probeA.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='users'").get() as { sql: string }).sql
    probeA.close()
    const second = new UserStore(oncePath)
    second.createUserWithSuffix({ account: 'someone', password: 'password8' })
    second.close()
    const probeB = new DatabaseSync(oncePath)
    const sqlAfterSecond = (probeB.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='users'").get() as { sql: string }).sql
    probeB.close()
    expect(sqlAfterSecond).toBe(sqlAfterFirst)
  })

  it('WS-C:非法 role 仍被新 CHECK 拒绝(constraint error 冒泡,fail-loud)', () => {
    expect(() => {
      store.createUserWithSuffix({ account: 'badrole', password: 'password8', role: 'root' as never })
    }).toThrow(/CHECK constraint failed/)
  })
})
