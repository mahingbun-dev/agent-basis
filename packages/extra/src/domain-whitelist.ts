/**
 * egress 完整版 ①:域名白名单判定器(通配域名匹配 + 端口)。
 *
 * 设计依据(设计文档 08 §3 表 #10 / 12 §4.4 决策 D-A):
 * - governance egress-lite 是**工具级**白名单(哪些工具可触网)+ proxy 注入
 *   载荷,防护等级"引导非强制";egress 完整版(T13)在其之上补**域名级**判定,
 *   供强合规场景升级(12 §4.4 说明列:「强合规行业出现时再升级沙箱层」,
 *   本模块是升级路径的插件侧半场——判定器纯函数,可被任何执行层复用)。
 *
 * 规则语法(host,点分标签;标签内字面量或通配):
 * - `example.com`            → 精确匹配(仅该 host)。
 * - `*.example.com`          → 前导通配:匹配 example.com 的**任意深度**子域
 *   (a.example.com、a.b.example.com),不含 apex(业界代理白名单通行语义,
 *   对齐 curl NO_PROXY 的 `.example.com` 子域语义但要 apex 需并列明写)。
 * - `api-*.example.com`      → 标签内通配:`*` 在标签内部匹配该标签内任意
 *   字符(不跨点),如 api-v2.example.com。
 * - `**`                      → 全放(显式弃权):匹配任意 host——部署方裁定不做
 *   域名级管控时唯一合法写法(2026-11-13 产品裁定:个人部署不逐域加白)。必须
 *   显式出现在配置文件里才生效,缺省规则集永不包含它(fail-closed 缺省不变)。
 * - IPv6 字面量:`[::1]` / `[2001:db8::1]`(URL host 段带方括号形态)只做
 *   精确匹配,不允许通配(防 `*` 豁免内网段)。
 *
 * 端口:
 * - 规则不带 `ports` → 该 host 任意端口放行(含默认端口)。
 * - 规则带 `ports` → 仅列名端口放行;端口 1-65535,不区分协议。
 *
 * fail-closed 约定:不可解析 URL、非 http(s) 协议、host 为空 → 一律拒绝
 * (防 file:/data:/unix: 等非 HTTP 出口绕过域名管控)。
 */
import { parse as parseYaml } from 'yaml'
import { ExtraConfigError } from './errors.ts'

/** 一条域名白名单规则。 */
export interface DomainRule {
  /** host 模式(小写;支持上述通配语法;IPv6 用 `[...]` 形态)。 */
  readonly host: string
  /** 允许的端口列表;缺省 = 任意端口。 */
  readonly ports?: readonly number[]
}

/** 域名级判定结果。 */
export interface DomainDecision {
  readonly allowed: boolean
  /** 命中的规则(allowed=true 时给出;拒绝时 undefined)。 */
  readonly matchedRule?: DomainRule
  /** 判定说明(拒绝原因/命中规则描述),进审计与模型可见反馈。 */
  readonly reason: string
}

/** 标签内通配编译:字面量标签精确;含 `*` 的标签编译为段内通配(不跨点)。 */
function labelPattern(label: string): string {
  if (label === '*') return '[^.]+' // 整标签通配(单标签占位;前导多级语义单独处理)
  let source = ''
  for (const ch of label) {
    if (ch === '*') source += '[^.]*'
    else source += /[a-z0-9-]/u.test(ch) ? ch : escapeHostChar(ch)
  }
  return source
}

function escapeHostChar(ch: string): string {
  return /[.*+?^${}()|[\]\\]/u.test(ch) ? `\\${ch}` : ch
}

/** 校验规则 host 语法并规范化(小写、去尾点);非法即抛(fail-closed,构造期)。 */
export function normalizeRuleHost(host: string): string {
  const lowered = host.trim().toLowerCase()
  if (lowered === '') throw new ExtraConfigError(`域名规则 host 不能为空:${host}`)
  if (lowered.endsWith('.')) throw new ExtraConfigError(`域名规则 host 不允许尾点(FQDN 点):${host}`)
  // IPv6 字面量:只接受全字面量(方括号内),禁止通配。
  if (lowered.startsWith('[')) {
    if (!/^\[[0-9a-f:]+(?:%[a-z0-9]+)?\]$/u.test(lowered)) {
      throw new ExtraConfigError(`IPv6 域名规则只允许字面量(不支持通配):${host}`)
    }
    return lowered
  }
  const labels = lowered.split('.')
  for (const label of labels) {
    if (label === '') throw new ExtraConfigError(`域名规则 host 有空标签(连续点):${host}`)
    if (!/^[a-z0-9-*]+(-[a-z0-9-*]+)*$/u.test(label)) {
      throw new ExtraConfigError(`域名规则标签含非法字符(仅 a-z 0-9 - 与 *):${host}`)
    }
  }
  return lowered
}

/** 单规则编译产物:前导通配后缀(若有)+ 逐标签正则。 */
interface CompiledRule {
  readonly rule: DomainRule
  /** `*.suffix` 形态的后缀(任意深度子域匹配);非前导通配时 undefined。 */
  readonly leadingWildcardSuffix: string | undefined
  /** 逐标签锚定正则(非前导通配规则使用)。 */
  readonly regex: RegExp | undefined
  /** 端口集合;undefined = 任意端口。 */
  readonly portSet: ReadonlySet<number> | undefined
}

function compileRule(rule: DomainRule): CompiledRule {
  const host = normalizeRuleHost(rule.host)
  let leadingWildcardSuffix: string | undefined
  let regex: RegExp | undefined
  if (host === '**') {
    // 全放(显式弃权,语法见头注):锚定正则匹配任意非空 host——判定器其余
    // fail-closed 面(协议白名单/端口语义/host 规范化)不受影响。
    regex = /^.+$/u
    return { rule: { ...rule, host }, leadingWildcardSuffix, regex, portSet: undefined }
  }
  if (host.startsWith('*.')) {
    // `*.example.com` → 任意深度子域:host 以 `.example.com` 结尾且前缀非空。
    leadingWildcardSuffix = host.slice(1) // ".example.com"
  } else {
    const pattern = host.split('.').map(labelPattern).join('\\.')
    regex = new RegExp(`^${pattern}$`, 'u')
  }
  let portSet: ReadonlySet<number> | undefined
  if (rule.ports !== undefined) {
    if (rule.ports.length === 0) throw new ExtraConfigError(`域名规则 ports 为空列表(等价全拒,请显式写明意图):${rule.host}`)
    const ports = [...rule.ports]
    for (const port of ports) {
      if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new ExtraConfigError(`域名规则端口越界(1-65535):${rule.host} → ${port}`)
      }
    }
    portSet = new Set(ports)
  }
  return { rule: { ...rule, host }, leadingWildcardSuffix, regex, portSet }
}

/** 解析后的目的地(host 已规范化 + 显式端口)。 */
export interface Destination {
  /** 规范化 host:小写、去尾点;IPv6 保留 `[...]` 方括号形态。 */
  readonly host: string
  /** 端口(1-65535;URL 未写端口时按协议默认:http 80 / https 443)。 */
  readonly port: number
}

/** 允许出网的协议及其默认端口(其余协议一律拒绝)。 */
const ALLOWED_SCHEME_DEFAULT_PORTS: Readonly<Record<string, number>> = { http: 80, https: 443 }

/**
 * 从 URL 文本解析目的地。fail-closed:无法解析、协议不在 {http, https}、
 * host 为空 → 返回 undefined(reason 由调用方给)。
 */
export function parseDestination(url: string): Destination | undefined {
  let parsed: URL
  try {
    parsed = new URL(url.trim())
  } catch {
    return undefined
  }
  const scheme = parsed.protocol.replace(/:$/u, '').toLowerCase()
  const defaultPort = ALLOWED_SCHEME_DEFAULT_PORTS[scheme]
  if (defaultPort === undefined) return undefined
  const rawHost = parsed.hostname.toLowerCase().replace(/\.$/u, '')
  if (rawHost === '') return undefined
  const port = parsed.port === '' ? defaultPort : Number.parseInt(parsed.port, 10)
  if (!Number.isInteger(port) || port < 1 || port > 65_535) return undefined
  // WHATWG URL 对 IPv6 hostname 保留方括号形态——与规则侧 `[...]` 形态天然
  // 对齐,无需再包;裸冒号(不可能出现在合法 URL hostname)防御性补括号。
  const host = rawHost.startsWith('[') ? rawHost : rawHost.includes(':') ? `[${rawHost}]` : rawHost
  return { host, port }
}

/**
 * 域名白名单判定器。不可变规则集;构造期校验语法(fail-closed);实例可全局共享。
 */
export class DomainWhitelist {
  readonly #rules: readonly CompiledRule[]

  constructor(rules: readonly DomainRule[]) {
    if (rules.length === 0) throw new ExtraConfigError('域名白名单不能为空列表(空表 = 全拒,应显式选择 fail-closed 包装器策略而非空表)')
    this.#rules = rules.map(rule => compileRule(rule))
  }

  /** 只读规则表(已规范化)。 */
  get rules(): readonly DomainRule[] {
    return this.#rules.map(compiled => compiled.rule)
  }

  /** 判定一个 (host, port) 目的地(跳过 URL 解析的低层入口;host 语法同规则)。 */
  checkDestination(host: string, port: number): DomainDecision {
    // 运行期输入不做构造期抛错:规范化失败 = 拒绝(fail-closed,判定器永不 throw)。
    let normalized: string
    try {
      normalized = normalizeRuleHost(host)
    } catch (error) {
      return { allowed: false, reason: `目标 host 形态非法,拒绝出网:${host}(${error instanceof Error ? error.message : String(error)})` }
    }
    for (const compiled of this.#rules) {
      const hostMatches = compiled.leadingWildcardSuffix !== undefined
        ? normalized.endsWith(compiled.leadingWildcardSuffix) && normalized.length > compiled.leadingWildcardSuffix.length
        : compiled.regex?.test(normalized) === true
      if (!hostMatches) continue
      if (compiled.portSet !== undefined && !compiled.portSet.has(port)) continue
      const portNote = compiled.portSet === undefined ? '任意端口' : `端口 ${[...compiled.portSet].sort((a, b) => a - b).join('/')}`
      return {
        allowed: true,
        matchedRule: compiled.rule,
        reason: `命中白名单规则 ${compiled.rule.host}(${portNote})`,
      }
    }
    return {
      allowed: false,
      reason: `目标 ${normalized}:${port} 不在出网域名白名单(${this.#rules.length} 条规则)`,
    }
  }

  /** 判定一个 URL 文本:解析 → 协议校验 → 域名+端口判定。 */
  check(url: string): DomainDecision {
    const destination = parseDestination(url)
    if (destination === undefined) {
      return {
        allowed: false,
        reason: `URL 无法解析或协议不在 http/https 出网范围:${url}`,
      }
    }
    return this.checkDestination(destination.host, destination.port)
  }
}

/** YAML 条目形态:`"*.example.com"` 字符串或 `{ host, ports }` 对象。 */
export type DomainRuleYaml = string | { readonly host: string; readonly ports?: readonly number[] }

/**
 * 从 YAML 文本加载白名单(与 governance 策略文件同源的加载形态:
 * 顶层可为列表,或 `{ whitelist: [...] }` 映射)。语法/结构错误即抛。
 */
export function parseDomainWhitelistYaml(text: string): DomainWhitelist {
  let parsed: unknown
  try {
    parsed = parseYaml(text)
  } catch (error) {
    throw new ExtraConfigError(`域名白名单 YAML 解析失败:${error instanceof Error ? error.message : String(error)}`)
  }
  const entries = Array.isArray(parsed) ? parsed : readWhitelistField(parsed)
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new ExtraConfigError('域名白名单 YAML 必须是非空列表(或含非空 whitelist 列表的对象)')
  }
  const rules: DomainRule[] = []
  for (const entry of entries) {
    if (typeof entry === 'string') {
      rules.push({ host: entry })
    } else if (isHostEntry(entry)) {
      rules.push(entry.ports === undefined ? { host: entry.host } : { host: entry.host, ports: [...entry.ports] })
    } else {
      throw new ExtraConfigError(`域名白名单条目形态非法(应为 "host" 字符串或 {host, ports}):${JSON.stringify(entry)}`)
    }
  }
  return new DomainWhitelist(rules)
}

function readWhitelistField(value: unknown): unknown {
  if (typeof value !== 'object' || value === null) return undefined
  const whitelist = (value as Record<string, unknown>)['whitelist']
  return Array.isArray(whitelist) ? whitelist : undefined
}

function isHostEntry(value: unknown): value is { host: string; ports?: readonly number[] } {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  if (typeof record['host'] !== 'string') return false
  if (record['ports'] === undefined) return true
  return Array.isArray(record['ports']) && record['ports'].every(p => typeof p === 'number')
}
