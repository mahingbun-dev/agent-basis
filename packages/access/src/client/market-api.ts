/**
 * 技能市场客户端 API:`/api/skills-manage/market/*` 五个端点的同源封装。
 *
 * 服务端契约见 `skill-market-routes.ts`:全部 POST + RPC 信封;来源写面仅 admin;
 * 安装落点是服务端收口(zip 安全/frontmatter/配额),客户端只回传来源与 slug。
 */
import { postRpc, type RpcResult } from './rpc.ts'
import type { SkillItemView, SkillScopeValue } from './skills-api.ts'

/** 市场来源视图(内置 SkillHub builtin=true,不可删)。 */
export interface MarketSourceView {
  readonly id: string
  readonly name: string
  readonly kind: 'skillhub' | 'index'
  readonly url: string
  readonly builtin: boolean
}

/** 市场条目视图(来源归一后的卡片数据)。 */
export interface MarketEntryView {
  readonly slug: string
  readonly name: string
  readonly summary: string
  readonly version: string
  readonly sourceId: string
  readonly namespace?: string
  readonly homepage?: string
  readonly installs?: number
}

export interface MarketSearchView {
  readonly entries: readonly MarketEntryView[]
  readonly limit: number
}

export interface MarketInstallTarget {
  readonly scope: SkillScopeValue
  readonly sourceId: string
  readonly slug: string
  readonly namespace?: string
  readonly version?: string
}

export interface MarketInstallView {
  readonly item: SkillItemView
}

export const marketApi = {
  sources: (): Promise<RpcResult<{ readonly sources: readonly MarketSourceView[] }>> =>
    postRpc<{ readonly sources: readonly MarketSourceView[] }>('/api/skills-manage/market/list'),
  search: (sourceId: string, query: string, limit?: number): Promise<RpcResult<MarketSearchView>> =>
    postRpc<MarketSearchView>('/api/skills-manage/market/search', {
      sourceId,
      ...(query.trim() === '' ? {} : { query: query.trim() }),
      ...(limit === undefined ? {} : { limit }),
    }),
  install: (target: MarketInstallTarget): Promise<RpcResult<MarketInstallView>> =>
    postRpc<MarketInstallView>('/api/skills-manage/market/install', { ...target }),
  addSource: (name: string, url: string): Promise<RpcResult<{ readonly source: MarketSourceView }>> =>
    postRpc<{ readonly source: MarketSourceView }>('/api/skills-manage/market/source-add', { name, url }),
  removeSource: (id: string): Promise<RpcResult<{ readonly removed: boolean }>> =>
    postRpc<{ readonly removed: boolean }>('/api/skills-manage/market/source-remove', { id }),
}
