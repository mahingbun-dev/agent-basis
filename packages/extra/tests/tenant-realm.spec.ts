/**
 * tenant realm 单测:realm key 语法/label 相连性/配置模板加载校验(含真实
 * 模板文件)/cordis:group 行树生成——对齐设计文档 12 §10.3 两级约定。
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parse as parseYaml } from 'yaml'
import {
  ISOLATED_TENANT_SERVICES, buildTenantGroupRows, formatRealm, loadTenantRealmConfig, parseRealm,
  renderTenantGroupYaml, tenantRealmLabel,
} from '../src/tenant-realm.ts'
import type { CustomerRealm } from '../src/tenant-realm.ts'
import { ExtraConfigError } from '../src/errors.ts'

const TEMPLATE_PATH = fileURLToPath(new URL('../assets/tenant-realm.template.yml', import.meta.url))

describe('realm key 语法(format/parse)', () => {
  it('两级 roundtrip', () => {
    expect(formatRealm({ level: 'industry', industry: 'event-planning' })).toBe('ind:event-planning')
    expect(formatRealm({ level: 'customer', industry: 'event-planning', customer: 'acme' })).toBe('ind:event-planning:cust:acme')
    expect(parseRealm('ind:event-planning')).toEqual({ level: 'industry', industry: 'event-planning' })
    expect(parseRealm('ind:event-planning:cust:acme')).toEqual({ level: 'customer', industry: 'event-planning', customer: 'acme' })
    expect(parseRealm(formatRealm({ level: 'customer', industry: 'legal-consulting', customer: 'beta-corp' })))
      .toEqual({ level: 'customer', industry: 'legal-consulting', customer: 'beta-corp' })
  })

  it.each([
    ['缺前缀', 'event-planning'],
    ['客户缺 cust 段', 'ind:event-planning:acme'],
    ['乱序前缀', 'cust:acme'],
    ['slug 大写', 'ind:EventPlanning'],
    ['slug 下划线', 'ind:event_planning'],
    ['多余段', 'ind:a:cust:b:extra'],
    ['空 slug', 'ind:'],
    ['客户空 slug', 'ind:a:cust:'],
  ])('%s 抛 ExtraConfigError', (_label, key) => {
    expect(() => parseRealm(key)).toThrow(ExtraConfigError)
    expect(() => parseRealm(key)).not.toThrow(TypeError)
  })

  it('formatRealm 对非法 slug 同样抛(构造期)', () => {
    expect(() => formatRealm({ level: 'industry', industry: 'Bad Slug' })).toThrow(ExtraConfigError)
    expect(() => formatRealm({ level: 'customer', industry: 'ok', customer: 'BAD' })).toThrow(ExtraConfigError)
  })
})

describe('tenantRealmLabel(Cordis isolate label 相连性)', () => {
  it('同 realm 同 symbol(跨调用/跨实例相连);异 realm 相斥', () => {
    const acme: CustomerRealm = { level: 'customer', industry: 'event-planning', customer: 'acme' }
    const acmeAgain: CustomerRealm = { level: 'customer', industry: 'event-planning', customer: 'acme' }
    const beta: CustomerRealm = { level: 'customer', industry: 'event-planning', customer: 'beta-corp' }
    expect(tenantRealmLabel(acme)).toBe(tenantRealmLabel(acmeAgain))
    expect(tenantRealmLabel(acme)).not.toBe(tenantRealmLabel(beta))
    expect(tenantRealmLabel(acme)).not.toBe(tenantRealmLabel({ level: 'industry', industry: 'event-planning' }))
  })

  it('label 即 Symbol.for 稳定 key(重启/跨模块解析一致)', () => {
    expect(tenantRealmLabel({ level: 'customer', industry: 'a', customer: 'b' }))
      .toBe(Symbol.for('basis:tenant-realm:ind:a:cust:b'))
  })
})

describe('loadTenantRealmConfig(配置加载校验)', () => {
  it('合法配置加载', () => {
    const doc = loadTenantRealmConfig([
      'industries:',
      '  - slug: event-planning',
      '    customers: [acme, beta-corp]',
      '  - slug: legal-consulting',
      '    customers: []',
    ].join('\n'))
    expect(doc.industries).toHaveLength(2)
    expect(doc.industries[0]).toEqual({ slug: 'event-planning', customers: ['acme', 'beta-corp'] })
    expect(doc.industries[1]).toEqual({ slug: 'legal-consulting', customers: [] })
  })

  it('**真实模板文件**原样加载通过(assets/tenant-realm.template.yml)', () => {
    const text = readFileSync(TEMPLATE_PATH, 'utf8')
    const doc = loadTenantRealmConfig(text)
    expect(doc.industries.map(industry => industry.slug)).toEqual(['event-planning', 'legal-consulting'])
    expect(doc.industries[0]!.customers).toEqual(['acme', 'beta-corp'])
  })

  it.each([
    ['行业 slug 非法', 'industries:\n  - slug: Bad_Slug\n    customers: []'],
    ['行业重复', 'industries:\n  - slug: a\n    customers: []\n  - slug: a\n    customers: []'],
    ['客户 slug 非法', 'industries:\n  - slug: a\n    customers: [Bad_Cust]'],
    ['客户重复(同行业)', 'industries:\n  - slug: a\n    customers: [x, x]'],
    ['未知字段', 'industries:\n  - slug: a\n    customers: []\n    extra: 1'],
    ['industries 空', 'industries: []'],
    ['缺 industries', 'other: 1'],
    ['条目缺 customers', 'industries:\n  - slug: a'],
    ['坏 YAML', 'industries: [unclosed'],
  ])('%s → 整份拒收 ExtraConfigError', (_label, text) => {
    expect(() => loadTenantRealmConfig(text)).toThrow(ExtraConfigError)
  })
})

describe('buildTenantGroupRows(cordis:group 行树)', () => {
  const doc = loadTenantRealmConfig('industries:\n  - slug: event-planning\n    customers: [acme, beta-corp]')

  it('行业组 → 客户组两层嵌套;客户组内注入租户作用域插件行', () => {
    const rows = buildTenantGroupRows(doc, realm => [
      { id: 'memory', name: '@basis/memory', config: { realm: formatRealm(realm) } },
    ])
    expect(rows).toHaveLength(1)
    const industryRow = rows[0]!
    expect(industryRow.name).toBe('cordis:group')
    expect(industryRow.group).toBe(true)
    expect(industryRow.id).toBe('ind-event-planning')
    const customerRows = industryRow.config as { id: string; name: string; config: unknown }[]
    expect(customerRows.map(row => row.id)).toEqual(['cust-acme', 'cust-beta-corp'])
    const acmeRows = customerRows[0]!.config as { name: string; config: { realm: string } }[]
    expect(acmeRows[0]!.name).toBe('@basis/memory')
    expect(acmeRows[0]!.config.realm).toBe('ind:event-planning:cust:acme')
    expect(((customerRows[1]!.config as { config: { realm: string } }[])[0]!.config.realm)).toBe('ind:event-planning:cust:beta-corp')
  })

  it('渲染 YAML 可回读,结构保持(cordis:group + 嵌套 id)', () => {
    const yaml = renderTenantGroupYaml(buildTenantGroupRows(doc))
    const back = parseYaml(yaml) as { name: string; group: boolean; config: { id: string }[] }[]
    expect(back[0]!.name).toBe('cordis:group')
    expect(back[0]!.group).toBe(true)
    expect(back[0]!.config.map(row => row.id)).toEqual(['cust-acme', 'cust-beta-corp'])
  })

  it('缺省不注入客户插件行(空骨架)', () => {
    const rows = buildTenantGroupRows(doc)
    expect(((rows[0]!.config as unknown[])[0] as { config: unknown[] }).config).toEqual([])
  })
})

describe('隔离面词汇表', () => {
  it('默认隔离 memory/knowledge/storage;audit 不在列(全局共享)', () => {
    expect([...ISOLATED_TENANT_SERVICES]).toEqual(['memory', 'knowledge', 'storage'])
    expect(ISOLATED_TENANT_SERVICES).not.toContain('audit')
  })
})
