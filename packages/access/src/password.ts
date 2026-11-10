/**
 * 口令与账号规则:scrypt(N=16384,r=8,p=1)+每号随机盐,timingSafeEqual 比对。
 * 存储格式 `s1$<saltB64>$<hashB64>`(算法代际前缀,轮换参数可平滑升级)。
 * 账号规则兼容预置管理员 Mr.Ma(点号+大小写):[A-Za-z0-9_.-]{2,32}。
 */
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'

const SCRYPT_N = 16384
const SCRYPT_R = 8
const SCRYPT_P = 1
const KEY_LEN = 32
const SALT_LEN = 16

export const ACCOUNT_PATTERN = /^[A-Za-z0-9_.-]{2,32}$/
export const PASSWORD_MIN = 8
export const PASSWORD_MAX = 128

export class PasswordPolicyError extends Error {
  readonly field: 'account' | 'password'
  constructor(field: 'account' | 'password', message: string) {
    super(message)
    this.field = field
  }
}

export function validateAccount(account: string): void {
  if (!ACCOUNT_PATTERN.test(account)) {
    throw new PasswordPolicyError('account', '账号须为 2-32 位字母/数字/点/下划线/连字符')
  }
}

export function validatePassword(password: string): void {
  if (password.length < PASSWORD_MIN || password.length > PASSWORD_MAX) {
    throw new PasswordPolicyError('password', `密码长度须在 ${PASSWORD_MIN}-${PASSWORD_MAX} 位之间`)
  }
}

export function hashPassword(password: string): string {
  validatePassword(password)
  const salt = randomBytes(SALT_LEN)
  const hash = scryptSync(password, salt, KEY_LEN, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P })
  return `s1$${salt.toString('base64')}$${hash.toString('base64')}`
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split('$')
  if (parts.length !== 3 || parts[0] !== 's1') return false
  const salt = Buffer.from(parts[1] ?? '', 'base64')
  const expected = Buffer.from(parts[2] ?? '', 'base64')
  if (salt.length !== SALT_LEN || expected.length !== KEY_LEN) return false
  const actual = scryptSync(password, salt, KEY_LEN, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P })
  return timingSafeEqual(actual, expected)
}
