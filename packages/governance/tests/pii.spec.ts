import { describe, expect, it } from 'vitest'
import { PiiBlockedError, PiiFilter, defaultPiiPatterns } from '../src/index.ts'

describe('PII 过滤:缺省模式集', () => {
  const filter = new PiiFilter()

  it('识别中国大陆手机号(边界:前后不能还是数字)', () => {
    expect(filter.scan('联系我 13812345678 谢谢').map(f => f.patternId)).toEqual(['cn-mobile'])
    expect(filter.scan('工单号 9138123456781 不算手机号')).toEqual([])
  })

  it('识别 18 位身份证号(含校验位 X)', () => {
    expect(filter.scan('身份证 11010119900307867X').map(f => f.patternId)).toEqual(['cn-id-card'])
  })

  it('识别邮箱与 IPv4', () => {
    expect(filter.scan('邮箱 a.b+tag@example.com.cn').map(f => f.patternId)).toEqual(['email'])
    expect(filter.scan('出口 192.168.1.23 已开放').map(f => f.patternId)).toEqual(['ipv4'])
  })

  it('干净文本返回空', () => {
    expect(filter.scan('预算 30 万,场地在市区,需要停车位的场地')).toEqual([])
  })
})

describe('PII 过滤:脱敏 redact', () => {
  const filter = new PiiFilter()

  it('命中片段替换为 [PII:<id>],其余原文保留', () => {
    const result = filter.redact('张三 13812345678 邮箱 zhang@example.com')
    expect(result.text).toBe('张三 [PII:cn-mobile] 邮箱 [PII:email]')
    expect(result.findings).toHaveLength(2)
  })

  it('同一模式多处命中全部替换', () => {
    const result = filter.redact('13812345678 和 13998887777')
    expect(result.text).toBe('[PII:cn-mobile] 和 [PII:cn-mobile]')
    expect(result.findings).toHaveLength(2)
  })
})

describe('PII 过滤:嵌套值', () => {
  const filter = new PiiFilter()

  it('scanValue 深扫对象键与值(memory_write 的 payload 形态)', () => {
    const findings = filter.scanValue({
      key: 'customer-profile',
      content: '客户手机 13812345678',
      tags: ['vip', '13712345678'],
    })
    expect(findings.map(f => f.patternId)).toEqual(['cn-mobile', 'cn-mobile'])
  })

  it('redactValue 深拷贝结构并只替换字符串', () => {
    const input = { content: '电话 13812345678', nested: { note: '邮箱 x@y.io' }, count: 3, on: true }
    const { value, findings } = filter.redactValue(input)
    expect(value).toEqual({ content: '电话 [PII:cn-mobile]', nested: { note: '邮箱 [PII:email]' }, count: 3, on: true })
    expect(findings).toHaveLength(2)
    expect(input.content).toBe('电话 13812345678') // 原值不动
  })
})

describe('PII 拦截:assertClean(写入前守卫)', () => {
  const filter = new PiiFilter()

  it('命中即抛 PiiBlockedError 并携带 findings(memory/knowledge 写路径据此拒绝写入)', () => {
    expect(() => { filter.assertClean('客户手机号 13812345678', 'memory:customer') }).toThrow(PiiBlockedError)
    try {
      filter.assertClean({ content: '邮箱 a@b.com' })
      expect.unreachable('应当抛错')
    } catch (error) {
      expect(error).toBeInstanceOf(PiiBlockedError)
      const blocked = error as PiiBlockedError
      expect(blocked.findings.map(f => f.patternId)).toEqual(['email'])
      expect(blocked.message).toContain('PII 拦截')
    }
  })

  it('干净值静默通过', () => {
    expect(() => { filter.assertClean({ content: '预算 30 万,含场地与餐饮' }, 'memory:budget') }).not.toThrow()
  })
})

describe('PII 过滤:可插拔模式', () => {
  it('注入行业模式(如合同编号)后可识别,缺省模式不误伤', () => {
    const filter = new PiiFilter([
      ...defaultPiiPatterns(),
      { id: 'contract-no', label: '合同编号', pattern: /HT-\d{6,10}/u },
    ])
    const findings = filter.scan('合同 HT-20260001 已归档,手机 13812345678')
    expect(findings.map(f => f.patternId)).toEqual(['contract-no', 'cn-mobile'])
    expect(filter.redact('编号 HT-20260001').text).toBe('编号 [PII:contract-no]')
  })

  it('空模式列表 = 关闭检测(领域包明确选择时的逃生口)', () => {
    const off = new PiiFilter([])
    expect(off.scan('13812345678')).toEqual([])
    expect(() => { off.assertClean('13812345678') }).not.toThrow()
  })
})
