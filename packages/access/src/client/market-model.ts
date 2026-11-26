/**
 * 技能市场纯逻辑:查询校验、摘要截断、来源选项、错误文案(可离线测试)。
 *
 * 服务端仍是权威(URL 白名单/尺寸/zip 安全);这里只做卡片展示与「别发明显
 * 不合法的请求」。文案键与 `skills-section.tsx` 共用 `skills.market.*`。
 */
import type { RpcResult } from './rpc.ts'
import type { MarketEntryView, MarketSourceView } from './market-api.ts'
import type { SkillScopeValue } from './skills-api.ts'

/** 搜索词上限(服务端截断到 120,前端先挡)。 */
export const MARKET_QUERY_MAX = 120

/** 查询校验:超长 → 文案键;空串合法(浏览展台)。 */
export function marketQueryIssue(query: string): 'skills.market.queryTooLong' | undefined {
  return query.length > MARKET_QUERY_MAX ? 'skills.market.queryTooLong' : undefined
}

/** 卡片摘要:压成单行、截断(超长加省略号,保持卡内正文 ≤2 行)。 */
export function marketSummary(text: string, max = 140): string {
  const flat = text.replace(/\s+/gu, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
}

/** 来源下拉选项文案:`名称(内置)` / `名称`。 */
export function sourceOptionLabel(source: MarketSourceView, builtinSuffix: string): string {
  return source.builtin ? `${source.name}${builtinSuffix}` : source.name
}

/** 安装量文案(无数据返回空串,不占行)。 */
export function installsLabel(installs: number | undefined, template: string): string {
  if (installs === undefined || installs <= 0) return ''
  const text = installs >= 10_000 ? `${(installs / 10_000).toFixed(1)} 万` : String(installs)
  return template.replace('{count}', text)
}

/** 市场失败文案:优先服务端 message,其次 fallback 文案键。 */
export function marketFailureMessage(result: RpcResult<unknown>, fallback: string): string {
  const message = result.error?.message
  return typeof message === 'string' && message !== '' ? message : fallback
}

/** 安装成功提示:`{name}` 单占位替换。 */
export function installedMessage(template: string, name: string): string {
  return template.replaceAll('{name}', name)
}

/** 安装按钮文案键(按目标作用域)。 */
export function installLabelKey(scope: SkillScopeValue): string {
  return scope === 'shared' ? 'skills.market.installShared' : 'skills.market.installMine'
}

/** 条目是否可在当前来源下安装(来源未知/已删除的旧条目直接禁用)。 */
export function entryInstallable(entry: MarketEntryView, sources: readonly MarketSourceView[]): boolean {
  return sources.some(source => source.id === entry.sourceId)
}

/**
 * index 来源条目的版本展示:空版本显示 `—`(不渲染空 pill)。
 */
export function versionLabel(version: string): string {
  return version === '' ? '—' : version
}
