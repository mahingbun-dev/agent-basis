/**
 * tenant realm:行业→客户两级 Cordis isolate realm 约定(T13)。
 *
 * 设计依据(设计文档 08 §3 表 #13 / 12 §10.3):「多租户隔离 | Cordis
 * isolate realm 原生 | **A+规范** | 粒度待定(行业/客户)」——本模块把
 * 「粒度待定」钉成两级约定:**行业级 realm(共享 L2 领域包与行业知识)→
 * 客户级 realm(私有记忆/知识/存储),行业是客户的父域**。
 *
 * Cordis 原生机制(承载面 = A,零内核改动):
 * - `ctx.isolate(name, label)`(@deepseek-ai/cordis Context.isolate):
 *   以 label 为键开独立服务作用域;同 label 相连、异 label 相隔离——
 *   客户级隔离的 realm key 即 label 的稳定来源(tenantRealmLabel);
 * - `cordis:group` 装载器行(vendor/group/README.md):嵌套插件行,
 *   子行 id 以 `:` 连接——配置模板用它表达 行业组 → 客户组 两层结构;
 * - dsh agent-preset-registry 已验证该纪律:同 realm 的 provider/consumer
 *   必须同组(packages/preset/agent-preset-registry/src/mount.ts:213
 *   「Preset services require isolate realms」)。
 *
 * realm key 语法(机器可读、人可念):
 * - 行业级:`ind:<industry-slug>`
 * - 客户级:`ind:<industry-slug>:cust:<customer-slug>`
 * - slug:`^[a-z0-9]+(-[a-z0-9]+)*$`(小写字母数字连字符,禁下划线/点)
 *
 * 默认隔离面(ISOLATED_TENANT_SERVICES):memory / knowledge / storage
 * (ctx 服务键)。audit 跨租户共享(全租户统一可审计,不做租户隔离);
 * governance 规则随领域包走,不做租户隔离。
 */
import { parse as parseYaml, stringify } from 'yaml'
import { ExtraConfigError } from './errors.ts'
import type { PluginRow } from './reviewer-preset.ts'

/** realm key 段前缀。 */
export const INDUSTRY_PREFIX = 'ind'
export const CUSTOMER_PREFIX = 'cust'

/** slug 字符集(小写字母数字,连字符分段)。 */
export const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/u

/** 默认按租户隔离的 ctx 服务键(audit 全局共享,不在此列)。 */
export const ISOLATED_TENANT_SERVICES: readonly string[] = ['memory', 'knowledge', 'storage']

/** 行业级 realm。 */
export interface IndustryRealm {
  readonly level: 'industry'
  readonly industry: string
}

/** 客户级 realm(行业是父域)。 */
export interface CustomerRealm {
  readonly level: 'customer'
  readonly industry: string
  readonly customer: string
}

export type TenantRealm = IndustryRealm | CustomerRealm

/** 校验 slug(非法抛 ExtraConfigError,带字段名定位)。 */
function assertSlug(value: string, field: string): void {
  if (!SLUG_PATTERN.test(value)) {
    throw new ExtraConfigError(`tenant realm ${field} 非法(须匹配 ${SLUG_PATTERN.source}):${JSON.stringify(value)}`)
  }
}

/** realm → 机器可读 key:`ind:<industry>` / `ind:<industry>:cust:<customer>`。 */
export function formatRealm(realm: TenantRealm): string {
  assertSlug(realm.industry, 'industry')
  if (realm.level === 'industry') return `${INDUSTRY_PREFIX}:${realm.industry}`
  assertSlug(realm.customer, 'customer')
  return `${INDUSTRY_PREFIX}:${realm.industry}:${CUSTOMER_PREFIX}:${realm.customer}`
}

/** key → realm(语法严格;非法抛 ExtraConfigError)。 */
export function parseRealm(key: string): TenantRealm {
  const parts = key.split(':')
  if (parts.length === 2 && parts[0] === INDUSTRY_PREFIX) {
    return { level: 'industry', industry: checkedSlug(parts[1] ?? '', 'industry') }
  }
  if (parts.length === 4 && parts[0] === INDUSTRY_PREFIX && parts[2] === CUSTOMER_PREFIX) {
    return {
      level: 'customer',
      industry: checkedSlug(parts[1] ?? '', 'industry'),
      customer: checkedSlug(parts[3] ?? '', 'customer'),
    }
  }
  throw new ExtraConfigError(`tenant realm key 语法非法(应为 ind:<slug> 或 ind:<slug>:cust:<slug>):${JSON.stringify(key)}`)
}

function checkedSlug(value: string, field: string): string {
  assertSlug(value, field)
  return value
}

/**
 * realm 的 Cordis isolate label:`Symbol.for('eterna:tenant-realm:<key>')`。
 * 用 Symbol.for(而非局部 symbol)保证跨插件实例/跨 fiber 同 key 相连——
 * 即同租户 provider 与 consumer 天然共享作用域,异租户天然隔离。
 */
export function tenantRealmLabel(realm: TenantRealm): symbol {
  return Symbol.for(`eterna:tenant-realm:${formatRealm(realm)}`)
}

/** tenant 配置文档(YAML 加载后的结构面)。 */
export interface TenantRealmDocument {
  readonly industries: readonly {
    readonly slug: string
    readonly customers: readonly string[]
  }[]
}

/**
 * 加载并校验 tenant realm 配置(YAML)。fail-closed:slug 非法、行业重复、
 * 客户重复(同行业内)、空行业列表、未知字段——任何一项即整份拒收。
 *
 * YAML 形态(见 assets/tenant-realm.template.yml):
 * ```yaml
 * industries:
 *   - slug: event-planning
 *     customers: [acme, beta-corp]
 * ```
 */
export function loadTenantRealmConfig(text: string): TenantRealmDocument {
  let parsed: unknown
  try {
    parsed = parseYaml(text)
  } catch (error) {
    throw new ExtraConfigError(`tenant realm 配置 YAML 解析失败:${error instanceof Error ? error.message : String(error)}`)
  }
  if (!isRecord(parsed) || !Array.isArray(parsed['industries']) || parsed['industries'].length === 0) {
    throw new ExtraConfigError('tenant realm 配置必须是含非空 industries 列表的对象')
  }
  const industries: { slug: string; customers: string[] }[] = []
  const seenIndustries = new Set<string>()
  for (const raw of parsed['industries']) {
    if (!isRecord(raw) || typeof raw['slug'] !== 'string' || !Array.isArray(raw['customers'])) {
      throw new ExtraConfigError(`行业条目必须是 { slug: string, customers: string[] }:${JSON.stringify(raw)}`)
    }
    const unknownKeys = Object.keys(raw).filter(key => key !== 'slug' && key !== 'customers')
    if (unknownKeys.length > 0) throw new ExtraConfigError(`行业条目含未知字段 ${unknownKeys.join(',')}(仅 slug/customers)`)
    const slug = checkedSlug(raw['slug'], 'slug')
    if (seenIndustries.has(slug)) throw new ExtraConfigError(`行业重复:${slug}`)
    seenIndustries.add(slug)
    const customers: string[] = []
    const seenCustomers = new Set<string>()
    for (const customer of raw['customers']) {
      if (typeof customer !== 'string') throw new ExtraConfigError(`客户名必须是字符串:${JSON.stringify(customer)}`)
      const checked = checkedSlug(customer, `行业 ${slug} 的 customer`)
      if (seenCustomers.has(checked)) throw new ExtraConfigError(`行业 ${slug} 内客户重复:${checked}`)
      seenCustomers.add(checked)
      customers.push(checked)
    }
    industries.push({ slug, customers })
  }
  return { industries }
}

/**
 * 由配置生成 `cordis:group` 行树:行业组 → 客户组(嵌套 id 以 `:` 连接,
 * 对齐装载器约定);customerPluginRows 为每个客户组注入的插件行(如租户
 * 隔离的 @eterna/memory 行,带 realm key config)。产出可直接 stringify 进
 * profile patch。
 */
export function buildTenantGroupRows(
  doc: TenantRealmDocument,
  customerPluginRows: (realm: CustomerRealm) => PluginRow[] = () => [],
): PluginRow[] {
  return doc.industries.map(industry => ({
    id: `${INDUSTRY_PREFIX}-${industry.slug}`,
    name: 'cordis:group',
    group: true,
    config: industry.customers.map(customer => ({
      id: `${CUSTOMER_PREFIX}-${customer}`,
      name: 'cordis:group',
      group: true,
      config: customerPluginRows({ level: 'customer', industry: industry.slug, customer }),
    })),
  }))
}

/** 把 cordis:group 行树渲染为 YAML(profile patch 可直接消费)。 */
export function renderTenantGroupYaml(rows: readonly PluginRow[]): string {
  return stringify(rows)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
