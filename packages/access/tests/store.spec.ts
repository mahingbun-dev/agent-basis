import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
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
    expect(store.seedAdmin('Mr.Ma', 'MqbSunny0702')).toBe(true)
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
})
