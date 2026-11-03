import { describe, expect, it } from 'vitest'
import { BuiltinPiiGuard, isPiiBlockedError, PiiBlockedError } from '../src/index.ts'

describe('BuiltinPiiGuard(governance 未就绪时的降级实现)', () => {
  const guard = new BuiltinPiiGuard()

  it('命中中国大陆手机号即拦截', () => {
    expect(() => {
      guard.assertClean('联系电话 13812345678')
    }).toThrow(PiiBlockedError)
  })

  it('命中身份证号/邮箱/IPv4 即拦截', () => {
    expect(() => {
      guard.assertClean('身份证 110101199003077758')
    }).toThrow(/PII 拦截/)
    expect(() => {
      guard.assertClean('邮箱 alice@example.com')
    }).toThrow(/PII 拦截/)
    expect(() => {
      guard.assertClean('服务器 10.0.8.12')
    }).toThrow(/PII 拦截/)
  })

  it('干净文本放行不抛错', () => {
    expect(() => {
      guard.assertClean('用户偏好邮件周报摘要')
    }).not.toThrow()
  })

  it('扫描嵌套对象的键与值(fail-closed)', () => {
    expect(() => {
      guard.assertClean({ key: 'contact', value: { phone: '13812345678' } })
    }).toThrow(PiiBlockedError)
    expect(() => {
      guard.assertClean({ 'email-1@example.com': 'x' })
    }).toThrow(PiiBlockedError)
  })

  it('label 进入错误信息定位', () => {
    let caught: unknown
    try {
      guard.assertClean('13812345678', 'entity:user:alice/phone')
    } catch (error) {
      caught = error
    }
    expect(isPiiBlockedError(caught)).toBe(true)
    expect((caught as Error).message).toContain('entity:user:alice/phone')
  })

  it('正常 11 位数字但非 1[3-9] 开头不误报', () => {
    expect(() => {
      guard.assertClean('订单号 22345678901')
    }).not.toThrow()
  })
})
