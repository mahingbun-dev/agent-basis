import { describe, expect, it } from 'vitest'
import {
  ACCOUNT_PATTERN, PasswordPolicyError, hashPassword, validateAccount, validatePassword, verifyPassword,
} from '../src/password.ts'

describe('password 密码服务', () => {
  it('哈希可被正确校验', () => {
    const stored = hashPassword('MqbSunny0702')
    expect(stored.startsWith('s1$')).toBe(true)
    expect(verifyPassword('MqbSunny0702', stored)).toBe(true)
    expect(verifyPassword('wrong-password', stored)).toBe(false)
  })

  it('同密码两次哈希盐不同(防彩虹表)', () => {
    expect(hashPassword('password123')).not.toBe(hashPassword('password123'))
  })

  it('篡改存储串校验失败(不抛)', () => {
    expect(verifyPassword('x', 'garbage')).toBe(false)
    expect(verifyPassword('x', 's2$aaa$bbb')).toBe(false)
    expect(verifyPassword('x', 's1$short$hash')).toBe(false)
  })

  it('账号规则:兼容预置管理员 Mr.Ma 形态', () => {
    expect(ACCOUNT_PATTERN.test('Mr.Ma')).toBe(true)
    expect(ACCOUNT_PATTERN.test('zhangsan01')).toBe(true)
    expect(ACCOUNT_PATTERN.test('a')).toBe(false)
    expect(() => { validateAccount('有中文') }).toThrow(PasswordPolicyError)
    expect(() => { validateAccount(''.padEnd(33, 'a')) }).toThrow(PasswordPolicyError)
  })

  it('密码策略:8 位下限', () => {
    expect(() => { validatePassword('short') }).toThrow(PasswordPolicyError)
    expect(() => { validatePassword('longenough8') }).not.toThrow()
  })
})
