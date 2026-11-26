/**
 * 技能市场端点(2026-11-26):挂在 `/api/skills-manage/market/*`,与技能管理同门。
 *
 * - 来源:list 全员;add/remove 仅 admin(全局来源表,落 access 数据目录);
 * - 浏览:search 全员(query 空=来源展台/热门);
 * - 安装:全员,但 shared 作用域仅 admin;下载后复用 SkillStore.installZip/installMarkdown
 *   (zip 安全 / frontmatter / 名称 grammar / 配额仍是唯一收口),origin 记 market。
 *
 * 审计只记来源 id / slug / 版本 / 字节数,不记正文;响应 no-store(沿用 frame)。
 */
import { okFrame, deniedFrame, frame, skillItemOf, type SkillsCaller, type SkillsDeps, type SkillsRegister } from './skills-routes.ts'
import { SkillMarketError } from './skill-market.ts'
import { SkillStoreError, type SkillScope } from './skills-store.ts'

/** 市场错误 → 稳定错误码(前端只消费 message;code 留 E2E/日志用)。 */
function marketFailure(
  rpcId: string,
  error: unknown,
  caller: SkillsCaller,
  deps: SkillsDeps,
  action: string,
  detail: Record<string, unknown>,
): Response {
  const code = error instanceof SkillMarketError ? error.code : 'internal'
  const message = error instanceof Error ? error.message : String(error)
  deps.audit({
    kind: 'skills.market',
    account: caller.account,
    ok: false,
    detail: { action, reason: code, message: message.slice(0, 256), ...detail },
  })
  return frame(rpcId, { ok: false, error: { code: `skills/market-${code}`, message, details: {} } })
}

/** args 里的字符串参数(非字符串按缺省处理,审计不落对象串)。 */
function textOf(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

export function registerSkillMarketRoutes(deps: SkillsDeps, register: SkillsRegister): void {
  const market = deps.market
  if (market === undefined) return

  const sourceView = (source: { id: string; name: string; kind: string; url: string; builtin?: boolean }): Record<string, unknown> => ({
    id: source.id,
    name: source.name,
    kind: source.kind,
    url: source.url,
    builtin: source.builtin === true,
  })

  register('/api/skills-manage/market/list', (rpcId, _args, caller) => {
    if (!market.available) return deniedFrame(rpcId, '技能市场不可用(数据目录未就绪)')
    deps.audit({ kind: 'skills.market', account: caller.account, ok: true, detail: { action: 'sources' } })
    return okFrame(rpcId, { sources: market.listSources().map(sourceView) })
  })

  register('/api/skills-manage/market/search', async (rpcId, args, caller) => {
    if (!market.available) return deniedFrame(rpcId, '技能市场不可用(数据目录未就绪)')
    try {
      const entries = await market.search(args.sourceId, args.query, args.limit)
      deps.audit({
        kind: 'skills.market',
        account: caller.account,
        ok: true,
        detail: { action: 'search', source: textOf(args.sourceId), queryLength: typeof args.query === 'string' ? args.query.trim().length : 0, count: entries.length },
      })
      return okFrame(rpcId, { entries, limit: 50 })
    } catch (error) {
      return marketFailure(rpcId, error, caller, deps, 'search', { source: textOf(args.sourceId) })
    }
  })

  register('/api/skills-manage/market/install', async (rpcId, args, caller) => {
    const scope: SkillScope | undefined = args.scope === 'personal' || args.scope === 'shared' ? args.scope : undefined
    if (scope === undefined) return deniedFrame(rpcId, '参数不完整(scope)')
    if (scope === 'shared' && caller.role !== 'admin') {
      deps.audit({ kind: 'skills.market', account: caller.account, ok: false, detail: { action: 'install', reason: 'admin-required', scope } })
      return deniedFrame(rpcId, '共享技能仅管理员可安装')
    }
    try {
      const download = await market.download(args.sourceId, {
        slug: args.slug,
        namespace: args.namespace,
        version: args.version,
      })
      const entry = download.kind === 'zip'
        ? deps.skills.installZip(scope, caller.account, download.bytes, 'market')
        : deps.skills.installMarkdown(scope, caller.account, download.bytes.toString('utf8'), 'market')
      deps.runtime.invalidate()
      deps.audit({
        kind: 'skills.market',
        account: caller.account,
        ok: true,
        detail: {
          action: 'install',
          scope,
          source: textOf(args.sourceId),
          slug: textOf(args.slug),
          version: textOf(args.version),
          kind: download.kind,
          bytes: download.bytes.length,
          name: entry.name,
        },
      })
      return okFrame(rpcId, { item: skillItemOf(entry) })
    } catch (error) {
      // store 的业务错误(重名/配额/坏包)沿用 skills/<code>,与手工上传同一口径。
      if (error instanceof SkillStoreError) {
        deps.audit({
          kind: 'skills.market',
          account: caller.account,
          ok: false,
          detail: { action: 'install', scope, reason: error.code, message: error.message.slice(0, 256) },
        })
        return frame(rpcId, { ok: false, error: { code: `skills/${error.code}`, message: error.message, details: {} } })
      }
      return marketFailure(rpcId, error, caller, deps, 'install', {
        scope,
        source: textOf(args.sourceId),
        slug: textOf(args.slug),
      })
    }
  })

  register('/api/skills-manage/market/source-add', (rpcId, args, caller) => {
    if (caller.role !== 'admin') {
      deps.audit({ kind: 'skills.market', account: caller.account, ok: false, detail: { action: 'source-add', reason: 'admin-required' } })
      return deniedFrame(rpcId, '仅管理员可维护市场来源')
    }
    try {
      const source = market.addSource({ name: args.name, url: args.url, kind: args.kind })
      deps.audit({ kind: 'skills.market', account: caller.account, ok: true, detail: { action: 'source-add', source: source.id, name: source.name } })
      return okFrame(rpcId, { source: sourceView(source) })
    } catch (error) {
      return marketFailure(rpcId, error, caller, deps, 'source-add', {})
    }
  })

  register('/api/skills-manage/market/source-remove', (rpcId, args, caller) => {
    if (caller.role !== 'admin') {
      deps.audit({ kind: 'skills.market', account: caller.account, ok: false, detail: { action: 'source-remove', reason: 'admin-required' } })
      return deniedFrame(rpcId, '仅管理员可维护市场来源')
    }
    try {
      market.removeSource(args.id)
      deps.audit({ kind: 'skills.market', account: caller.account, ok: true, detail: { action: 'source-remove', source: textOf(args.id) } })
      return okFrame(rpcId, { removed: true })
    } catch (error) {
      return marketFailure(rpcId, error, caller, deps, 'source-remove', { source: textOf(args.id) })
    }
  })
}
