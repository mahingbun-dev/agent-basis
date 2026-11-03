/**
 * 域名白名单判定器单测:通配域名匹配表(任务指定的三测之一)+ 端口/协议/
 * YAML 加载/fail-closed 构造校验。
 */
import { describe, expect, it } from 'vitest'
import { DomainWhitelist, normalizeRuleHost, parseDestination, parseDomainWhitelistYaml } from '../src/domain-whitelist.ts'
import { ExtraConfigError } from '../src/errors.ts'

/** 主匹配表:规则 × URL → 期望。 */
const MATCH_TABLE: readonly { rule: string; url: string; allowed: boolean; note: string }[] = [
  // —— 精确规则 ——
  { rule: 'example.com', url: 'https://example.com/', allowed: true, note: '精确命中(默认端口 443)' },
  { rule: 'example.com', url: 'https://example.com:443/', allowed: true, note: '显式 443 等价默认端口' },
  { rule: 'example.com', url: 'https://www.example.com/', allowed: false, note: '精确规则不吃子域' },
  { rule: 'example.com', url: 'http://example.com:8080/', allowed: true, note: '规则不带 ports → 任意端口放行' },
  // —— 前导通配(任意深度子域,不含 apex)——
  { rule: '*.example.com', url: 'https://api.example.com/', allowed: true, note: '一级子域命中' },
  { rule: '*.example.com', url: 'https://a.b.example.com/', allowed: true, note: '多级子域命中(DNS 域语义)' },
  { rule: '*.example.com', url: 'https://example.com/', allowed: false, note: 'apex 不命中(要 apex 需并列明写)' },
  { rule: '*.example.com', url: 'https://xexample.com/', allowed: false, note: '后缀字面撞车不吃(必须带点边界)' },
  // —— 标签内通配(单标签,不跨点)——
  { rule: 'api-*.example.com', url: 'https://api-v2.example.com/', allowed: true, note: '标签内通配命中' },
  { rule: 'api-*.example.com', url: 'https://api-v2.v3.example.com/', allowed: false, note: '标签内通配不跨点' },
  // —— 端口规则(带 ports 的细则在下方端口组覆盖)——
  { rule: 'deepseek.com', url: 'https://deepseek.com:8443/', allowed: true, note: '无 ports 规则放行非标端口' },
  // —— 大小写与尾点规范化 ——
  { rule: 'Api.Example.COM', url: 'https://API.example.com/', allowed: true, note: '两侧大小写归一' },
  // —— 多规则并存(首个命中者胜)——
  { rule: 'a.com|*.b.com', url: 'https://x.y.b.com/', allowed: true, note: '多规则任一命中' },
]

describe('DomainWhitelist 通配匹配表', () => {
  it.each(MATCH_TABLE)('$rule ↔ $url → $allowed($note)', ({ rule, url, allowed }) => {
    const rules = rule.split('|').map(host => ({ host }))
    const whitelist = new DomainWhitelist(rules)
    expect(whitelist.check(url).allowed).toBe(allowed)
  })

  it('任意深度子域与 apex 并列的行业常用写法', () => {
    const whitelist = new DomainWhitelist([{ host: 'example.com' }, { host: '*.example.com' }])
    expect(whitelist.check('https://example.com/').allowed).toBe(true)
    expect(whitelist.check('https://a.example.com/').allowed).toBe(true)
    expect(whitelist.check('https://a.b.example.com/').allowed).toBe(true)
    expect(whitelist.check('https://evil-example.com/').allowed).toBe(false)
  })
})

describe('DomainWhitelist 端口规则', () => {
  const whitelist = new DomainWhitelist([
    { host: 'api.deepseek.com', ports: [443, 8443] },
    { host: 'mirror.example.com' }, // 任意端口
  ])

  it('列名端口命中', () => {
    expect(whitelist.check('https://api.deepseek.com/').allowed).toBe(true)
    expect(whitelist.check('https://api.deepseek.com:8443/').allowed).toBe(true)
  })

  it('未列名端口拒绝(即使 host 命中)', () => {
    const decision = whitelist.check('https://api.deepseek.com:9443/')
    expect(decision.allowed).toBe(false)
    expect(decision.reason).toContain('不在出网域名白名单')
  })

  it('不带 ports 的规则任意端口放行(含非标端口)', () => {
    expect(whitelist.check('http://mirror.example.com:8081/pkg').allowed).toBe(true)
  })

  it('默认端口推导:http 80 / https 443', () => {
    const w = new DomainWhitelist([{ host: 'a.com', ports: [80] }, { host: 'b.com', ports: [443] }])
    expect(w.check('http://a.com/x').allowed).toBe(true) // 未写端口 → 80
    expect(w.check('https://a.com/x').allowed).toBe(false) // 443 未列名
    expect(w.check('https://b.com/x').allowed).toBe(true)
    expect(w.check('http://b.com/x').allowed).toBe(false)
  })
})

describe('DomainWhitelist fail-closed:协议与解析', () => {
  const whitelist = new DomainWhitelist([{ host: '*.example.com' }])

  it('非 http(s) 协议一律拒绝(file/data/ftp/tcp)', () => {
    for (const url of ['file:///etc/passwd', 'data:text/plain,hi', 'ftp://example.com/x', 'unix:///var/run/x.sock']) {
      const decision = whitelist.check(url)
      expect(decision.allowed, url).toBe(false)
      expect(decision.reason, url).toContain('协议不在 http/https 出网范围')
    }
  })

  it('无法解析的 URL 拒绝(不抛)', () => {
    for (const url of ['', '   ', 'not a url', 'https://', '://x', 'https://[::1:bad']) {
      expect(() => whitelist.check(url)).not.toThrow()
      expect(whitelist.check(url).allowed, JSON.stringify(url)).toBe(false)
    }
  })

  it('IPv6:字面量精确匹配,通配不允许', () => {
    const w = new DomainWhitelist([{ host: '[2001:db8::1]' }])
    expect(w.check('https://[2001:db8::1]/').allowed).toBe(true)
    expect(w.check('https://[2001:db8::2]/').allowed).toBe(false)
    expect(w.check('https://[::1]/').allowed).toBe(false)
    expect(() => new DomainWhitelist([{ host: '*.db8::1]' }])).toThrow(ExtraConfigError)
    expect(() => new DomainWhitelist([{ host: '[2001:*::1]' }])).toThrow(ExtraConfigError)
  })

  it('URL 带尾点 host 仍可命中规则(尾点剥离)', () => {
    expect(whitelist.check('https://a.example.com./').allowed).toBe(true)
  })
})

describe('DomainWhitelist 构造期校验(语法错误即抛)', () => {
  it('空规则列表拒绝', () => {
    expect(() => new DomainWhitelist([])).toThrow(ExtraConfigError)
  })

  it.each([
    ['例:空 host', ''],
    ['尾点', 'example.com.'],
    ['连续点', 'a..com'],
    ['空标签(前导点)', '.example.com'],
    ['非法字符(下划线)', 'api_example.com'],
    ['非法字符(路径)', 'example.com/path'],
  ])('非法 host "%s" 抛 ExtraConfigError', (_label, host) => {
    expect(() => new DomainWhitelist([{ host }])).toThrow(ExtraConfigError)
  })

  it('端口越界与空端口列表抛', () => {
    expect(() => new DomainWhitelist([{ host: 'a.com', ports: [0] }])).toThrow(ExtraConfigError)
    expect(() => new DomainWhitelist([{ host: 'a.com', ports: [65_536] }])).toThrow(ExtraConfigError)
    expect(() => new DomainWhitelist([{ host: 'a.com', ports: [] }])).toThrow(ExtraConfigError)
  })

  it('normalizeRuleHost 规范化(小写+去空白)', () => {
    expect(normalizeRuleHost('  API.Example.COM ')).toBe('api.example.com')
  })
})

describe('parseDestination(低层解析)', () => {
  it('host 小写化、端口推导、IPv6 回填方括号', () => {
    expect(parseDestination('https://API.Example.com/x')).toEqual({ host: 'api.example.com', port: 443 })
    expect(parseDestination('http://a.com:8080/')).toEqual({ host: 'a.com', port: 8080 })
    expect(parseDestination('https://[2001:db8::1]:8443/')).toEqual({ host: '[2001:db8::1]', port: 8443 })
  })

  it('非 http(s) 与坏 URL 返回 undefined', () => {
    expect(parseDestination('file:///etc/x')).toBeUndefined()
    expect(parseDestination('garbage')).toBeUndefined()
  })
})

describe('parseDomainWhitelistYaml(YAML 加载)', () => {
  it('字符串条目 + {host, ports} 对象条目混合加载', () => {
    const whitelist = parseDomainWhitelistYaml([
      '# 注释行',
      'whitelist:',
      '  - api.deepseek.com',
      '  - host: "*.example.com"',
      '    ports: [443]',
    ].join('\n'))
    expect(whitelist.check('https://api.deepseek.com/').allowed).toBe(true)
    expect(whitelist.check('https://x.example.com/').allowed).toBe(true)
    expect(whitelist.check('https://x.example.com:8443/').allowed).toBe(false)
  })

  it('顶层列表形态同样接受', () => {
    const whitelist = parseDomainWhitelistYaml('- a.com\n- b.com\n')
    expect(whitelist.check('https://a.com/').allowed).toBe(true)
  })

  it.each([
    ['空列表', '- []'],
    ['非列表', 'whitelist: 42'],
    ['条目形态非法', '- 42'],
    ['坏语法', 'whitelist: [unclosed'],
  ])('%s 抛 ExtraConfigError', (_label, text) => {
    expect(() => parseDomainWhitelistYaml(text)).toThrow(ExtraConfigError)
  })
})
