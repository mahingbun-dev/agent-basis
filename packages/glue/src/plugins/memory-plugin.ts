/**
 * memory 插件:createMemory + attachMemory(四工具 + ≤500 token 索引 section)。
 * PII 首选取 ctx.governance.pii(未挂则库内降级);索引头经 promptRegistry 服务读提示词注册表(T2.6,缺席回落内置)。
 * M-M1 T3:索引选项改解析器形态——每次装配现读 portrait.md 缓存(与 sqlite 同目录,19 号 §3-T4;
 * 文件不存在/读取失败/空内容一律省略画像区,宿主行为与无画像时一致)。
 * M-M2 T6:挂载会话尾整固 job(config.consolidation,默认开)——session/event 流上
 * turn/end(completed) 触发三门控+调度+游标(19 号 §4-T6;事件面结论 19a 号 S1):
 * - 全局监听不带 agent scope,同进程所有会话事件都送达(audit/compaction 生产先例);
 * - dsh 无 session/end 事件,turn/end(completed) 代理会话尾推进会话粒度游标;
 * - session/disposed 只作 teardown 兜底:摘事实桶 + abandonSession(abort 语义,
 *   fire-and-forget 勿 await);
 * - 卸载:先摘监听,再 abort 在跑整固并按 60s 上界 drain(宿主 disposer 不可
 *   await,fire-and-forget,drain 完成后自关游标库;audit flush 同款)。
 * M-M2 T7:整固调度器的提取执行体替换为 curator 直调提取体(createExtractionTask,
 * 19 号 §4-T7 + 19a 号 S4 结论 A)——ctx.llm('llm' 行在 eterna-web 生产宿主树恒
 * 在场,verify-eterna-web HOST_KEPT_ROWS 实证)与 ctx.sessions(读盘前等 flush)
 * 均为硬 inject 依赖;curator 模型从 config.consolidation.model 取(缺省 Flash)。
 * M-M2 T9:审批闭环接线(19 号 §4-T9 + 勘察 S2 结论)——审计账本单实例穿线
 * (.eterna/memory-audit.jsonl,与 sqlite 同目录):提取执行体记提案行(含
 * pending 卡片)、门控 skip 记门控行、review 包装器记审批行;Memory 服务以
 * MEMORY_SERVICE_ID('@eterna/memory')provide 到 ctx(注册表+唯一 ID 形态,
 * memory.ts 头注的既定对外形态)——面板裁决端点 eternaPanel/review 经它调
 * Memory.review,不经 sqlite 写路径。
 * M-M3 T10:会话域解析接线(config.domain,默认开)——首条真人类用户消息触发
 * resolveDomain(workspace 显式域跳过打标;否则 curator 打标先归并/候选计数),
 * 解析结果按会话缓存:索引装配经 assemblySessionIdOf 反查注入 domainKey(T3
 * 当前域区),memory_write 的 episodic 域归属经 domainOf 盖章(18 §1.3);
 * DomainRegistryStore 与 memory.sqlite3 同库(tenant-scan 随 dbPath 覆盖),
 * 「每会话至多一次」计数由 domain_hit_sessions 持久去重兜底(进程重启不重复)。
 * 打标 LLM 复用 T7 模型配置面(resolveCuratorRoute/domain.model 缺省回落
 * consolidation.model→Flash,S4-A 同款直调管道);解析成功的会话定格不再重打,
 * 失败(网络/解析)的会话下一条用户消息重试。
 * M-M3 T11:双频次整固(19 号 §5-T11 + 19a 号 S4 结论)——
 * - 轻量(会话尾):提取执行体注入 domainOf(会话绑定域),episodic 会话史行
 *   落域(key=session-<id>、confidence=0.5、source=consolidation);
 * - 重量(周期):S4-B 退路「会话尾触发 + lastDreamAt 时间阈值合并」——每个
 *   completed turn/end 在轻量链落定后调 maybeEnqueueDream(now, intervalMs),
 *   到期(默认 24h,dream.cron 键降级解释为间隔小时数)才把 Dream 四阶段
 *   (Orient/Gather/Consolidate/Prune)并入同一调度器;lastDreamAt 由调度器在
 *   Dream 完成时原子推进(游标 'dream' 行),error/abort 不推进待补跑;
 *   config.dream.enabled=false 即回滚面(不挂 Dream)。
 * M-M3 T12:前端四件的服务面(19 号 §5-T12)——
 * - 配置文件桥(config-bridge,compaction 文件桥同款):.eterna/memory.config.json
 *   承载设置分区「记忆」的可热改键(写入策略档位/画像/域开关)。写入路径每次
 *   writeEntity 现读 writePolicy(memory.ts MemoryOptions.writePolicy 面);索引
 *   装配每次现读 portraitEnabled/domainEnabled(关闸即省略画像区/域区)。
 *   真相源仍是 profile patch 的 MemoryPluginConfig,文件只覆盖热改键;
 * - 会话域切换面(T12-③ 域识别 chip):'eternaMemorySession' 服务 = 当前域视图
 *   (sessionDomainView)+ 切换(overrideDomain:已注册域写 domain_registry
 *   last_used + 会话 override,下次索引装配即用新域)+ 已注册域清单;
 *   overrideDomain 的域键合法性(必须已转正注册)在此校验。
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
// 空类型导入 = dsh-session 对 cordis Events('session/event'/'session/disposed')增广的
// 触发器:不导入则监听签名无法解析(audit/src/plugin.ts:7-10 同款;peer 依赖)。
import type {} from '@deepseek-ai/dsh-session'
import type { Session } from '@deepseek-ai/dsh-session'
import {
  assemblySessionIdOf,
  ConsolidationCursorStore,
  ConsolidationMetaStore,
  createDomainTagger,
  createDreamTask,
  DomainRegistryStore,
  dreamIntervalMs,
  ETERNA_MEMORY_SESSION_SERVICE_ID,
  MemoryAuditLedger,
  MEMORY_SERVICE_ID,
  memoryOverridesPathForDb,
  readMemoryOverridesFile,
  resolveCuratorRoute,
  resolveDomain,
  resolveDshSessionsRoot,
  resolveEffectiveFlags,
  resolvePromptRegistry,
  SessionEndConsolidator,
  SessionGateFactsRegistry,
  userMessageTextOf,
  attachMemory,
  createExtractionTask,
  createMemory,
  createDeniedMemory,
  defaultMemoryAuditPath,
  dshHost,
  findSessionLogPath,
  buildMemoryAccountView,
  MemoryAccountRouter,
  withReviewAudit,
} from '@eterna/memory'
import type {
  ConsolidationLogger, ConsolidationSnapshot, ConsolidationTaskResult, DomainResolution, DomainTagger, DomainTaggerInput, Memory,
  MemoryAssemblyContext, MemoryIndexOptions, MemorySessionResolver,
} from '@eterna/memory'
import type { MemoryDomainConfig, MemoryPluginConfig } from '../types.ts'

export const ETERNA_MEMORY_PLUGIN_NAME = 'eterna-memory'

/** 画像缓存文件名(T4 生成物;与 sqlite 同目录,即 DSH_HOME 语义 workspace 的 .eterna/ 下)。 */
const PORTRAIT_CACHE_FILENAME = 'portrait.md'

export function defineMemoryPlugin(config: MemoryPluginConfig = {}) {
  return {
    name: ETERNA_MEMORY_PLUGIN_NAME,
    inject: { tools: true, systemPrompt: true, governance: false, llm: true, sessions: true } as never,
    apply(ctx: Context): () => void {
      const cwd = process.cwd()
      const gov = (ctx as unknown as { governance?: { pii?: import('@eterna/governance').PiiFilter } }).governance
      const dbPath = config.dbPath ?? join(cwd, '.eterna/memory.sqlite3')
      // T12-① 配置文件桥热改键(每次写入/装配现读,fail-open 回落基线):
      // overrides 与 dbPath 同目录(memoryOverridesPathForDb 唯一真值,dbPath 派生;
      // 宿主 eternaMemory 端点以同一函数派生写路径——缺省布局两端落
      // <cwd>/.eterna/memory.config.json,自定义 dbPath 随之同迁)。
      const overridesFile = memoryOverridesPathForDb(dbPath)
      const hotFlags = () => resolveEffectiveFlags(readMemoryOverridesFile(overridesFile))
      // M-M2 T9:审计账本单实例穿线(提案/门控/审批三类事件,一行一事);
      // review 经 withReviewAudit 包装——任何调用方(面板裁决端点等)都留痕。
      // T13:同一实例注入 createMemory(域解析/纠正埋点与指标读取同源,不双写)。
      const audit = new MemoryAuditLedger({ path: defaultMemoryAuditPath(dbPath), logger: ctx.logger })
      const memory = createMemory({
        workspaceDir: config.notesDir ?? join(cwd, 'NOTES'),
        dbPath,
        ...(gov?.pii !== undefined ? { pii: gov.pii } : {}),
        // 写入策略档位(T12-①,explicit-only/auto-review/full-auto):每次写入现读
        // overrides 文件热生效;映射语义在 memory.ts resolveWriteReviewState。
        writePolicy: () => hotFlags().writePolicy,
        // T13 指标埋点:复用上方单例账本(缺省会另起同路径实例,多实例同文件安全
        // 但日志告警面会丢——glue 显式传入保持单实例口径)。
        audit,
      })
      const auditedMemory = withReviewAudit(memory, audit)
      // Memory 服务按注册表+唯一 ID 形态 provide(memory.ts 头注既定对外形态):
      // 面板 eternaPanel/review 经 ctx.get('@eterna/memory') 调 Memory.review。
      const disposeService = ctx.provide(MEMORY_SERVICE_ID, auditedMemory)
      // M-M3 T10:域注册表与解析接线(config.domain 缺省开;停用即无域上下文,
      // 索引退回单区锚点形态,回滚面 19 §7)。打标模型缺省回落 consolidation.model。
      const domainConfig: MemoryDomainConfig = config.domain ?? {}
      const domainRegistry = domainConfig.enabled === false
        ? null
        : new DomainRegistryStore(dbPath, {
          ...(domainConfig.minSessionsForNewDomain !== undefined
            && { minSessionsForNewDomain: domainConfig.minSessionsForNewDomain }),
        })
      // 打标模型:domain.model 覆写 → consolidation.model(T7 配置面)→ Flash(库内缺省)
      const taggerModel = domainConfig.model ?? config.consolidation?.model
      const domainWire = domainRegistry === null
        ? null
        : wireDomainContext(ctx, domainRegistry, {
          ...(domainConfig.workspaceName !== undefined && { workspaceName: domainConfig.workspaceName }),
          ...(taggerModel !== undefined && { model: taggerModel }),
          // T13:域解析定格写审计行(打标准确率样本;账本写入 fail-open 不炸解析)。
          audit,
        })
      // T12-③ 会话域切换面(域识别 chip 的数据面):以 'eternaMemorySession' 服务
      // 形态对外(宿主 eternaMemory 网关的 sessionDomain/selectDomain 端点经它转发);
      // 域识别未挂载(config.domain.enabled=false)时无此服务——网关端点回 unavailable。
      const disposeSessionFace = domainWire === null
        ? null
        : ctx.provide(ETERNA_MEMORY_SESSION_SERVICE_ID, domainWire.sessionFace)
      const resolveIndexOptions = (assembly?: MemoryAssemblyContext): MemoryIndexOptions => {
        // 会话域上下文(T10):装配面反查会话 id → 域绑定;不可归属/未绑定/未
        // 解析出结果时缺席 → 索引退回单区锚点形态(与 T10 之前逐字节一致)。
        // T12-① 热改键:domainEnabled=false 关闸即省略域区(portraitEnabled=false
        // 同理省略画像区)——每次装配现读 overrides 文件,设置分区保存即生效。
        const flags = hotFlags()
        const sessionId = assemblySessionIdOf(assembly)
        const domainKey = flags.domainEnabled && sessionId !== null ? domainWire?.domainOf(sessionId) : undefined
        return {
          ...(config.indexBudgetTokens !== undefined ? { budgetTokens: config.indexBudgetTokens } : {}),
          ...(domainConfig.indexTokens !== undefined ? { domainBudgetTokens: domainConfig.indexTokens } : {}),
          ...(flags.portraitEnabled ? readPortraitCache(join(dirname(dbPath), PORTRAIT_CACHE_FILENAME)) : {}),
          ...(domainKey !== undefined ? { domainKey } : {}),
        }
      }
      // domainOf 穿线(收窄进 const 后闭包引用,exactOptionalPropertyTypes 安全)
      let domainOfFace: ((sessionId: string) => string | undefined) | undefined
      if (domainWire !== null) {
        const wire = domainWire
        domainOfFace = (sessionId): string | undefined => wire.domainOf(sessionId)
      }
      // ── 多租户分库路由(23 号 M-T1,方案 C)──────────────────────────
      // access store 在场(auto 判定/per-account 显式)时:四工具/索引按会话
      // 账号路由到 workspaces/<账号>/.eterna/(fail-closed:解析失败=Denied,
      // 绝不退回全局库);global 模式/本地 TUI(无 access store)沿用单库。
      const routingConfig = config.routing ?? {}
      const accessFace = (() => {
        try {
          const reflect = ctx as unknown as { reflect?: { get(name: string, strict?: boolean): unknown } }
          const store = reflect.reflect?.get('eternaAccessStore', false) as
            | { sessionOwner(sessionId: string): number | undefined; getUserById(id: number): { account: string } | undefined }
            | undefined
          return store !== undefined && typeof store.sessionOwner === 'function' && typeof store.getUserById === 'function' ? store : undefined
        } catch {
          return undefined
        }
      })()
      const routed = routingConfig.mode === 'per-account' || (routingConfig.mode !== 'global' && accessFace !== undefined)
      const tenantRoot = routingConfig.tenantRoot
        ?? process.env.ETERNA_TENANT_ROOT
        ?? join(process.env.DSH_HOME ?? cwd, 'workspaces')
      let router: MemoryAccountRouter | undefined
      let sessionResolver: MemorySessionResolver | undefined
      let accountOfSession: ((sessionId: string) => string | undefined) | undefined
      const accountLedgers = new Map<string, MemoryAuditLedger>()
      if (routed && accessFace !== undefined) {
        const store = accessFace
        const resolveAccount = (sessionId: string): string | undefined => {
          const userId = store.sessionOwner(sessionId)
          if (userId === undefined) return undefined
          return store.getUserById(userId)?.account
        }
        accountOfSession = resolveAccount
        const accountDir = (account: string): string | undefined => {
          const dir = join(tenantRoot, account)
          return existsSync(dir) ? dir : undefined
        }
        router = new MemoryAccountRouter({
          dirOf: accountDir,
          create: (dir: string): Memory => createMemory({
            workspaceDir: join(dir, 'NOTES'),
            dbPath: join(dir, '.eterna', 'memory.sqlite3'),
            ...(gov?.pii !== undefined ? { pii: gov.pii } : {}),
            writePolicy: () => hotFlags().writePolicy,
          }),
          ...(routingConfig.maxAccounts !== undefined && { maxInstances: routingConfig.maxAccounts }),
          ...(routingConfig.idleCloseMs !== undefined && { idleMs: routingConfig.idleCloseMs }),
        })
        sessionResolver = {
          forSession: (sessionId: string | undefined): Memory | undefined => {
            if (sessionId === undefined) return undefined
            const account = resolveAccount(sessionId)
            if (account === undefined) return undefined
            return router?.forAccount(account)
          },
        }
        // M-T2 账号路由面('eterna-memory-accounts'):panel SRC 端点消费——
        // principal userId → 账号 → 该账号 Memory/库路径;越权在解析面即不可达。
        // global 部署也 provide(账号面空、memory/dbPath 回落全局),panel 统一走此面。
        const provide2 = (ctx as unknown as { provide?: (id: string, value: unknown) => () => void }).provide
        if (provide2 !== undefined) {
          const accountsFace = {
            accountOfUser: (userId: number): string | undefined => {
              if (!routed || accessFace === undefined) return undefined
              return accessFace.getUserById(userId)?.account
            },
            memoryForAccount: (account: string): Memory | undefined => {
              if (!routed) return auditedMemory
              const dir = join(tenantRoot, account)
              if (!existsSync(dir)) return undefined
              return router?.forAccount(account) ?? createDeniedMemory()
            },
            dbPathForAccount: (account: string): string | undefined => {
              if (!routed) return dbPath
              const dir = join(tenantRoot, account)
              return existsSync(dir) ? join(dir, '.eterna', 'memory.sqlite3') : undefined
            },
            // S-6 修复(23 号 M-T2):unary 通道 principal 不带 userId——panel 的
            // 记忆三端点改走 access 守卫面(身份在守卫),守卫经本 face 的账号级
            // 原语完成组装与裁决;view 组装在 memory 包(buildMemoryAccountView)。
            viewForAccount: (account: string): unknown => {
              const dbPathFor = routed
                ? (() => {
                  const dir = join(tenantRoot, account)
                  return existsSync(dir) ? join(dir, '.eterna', 'memory.sqlite3') : undefined
                })()
                : dbPath
              return dbPathFor === undefined ? undefined : buildMemoryAccountView(dbPathFor)
            },
            reviewForAccount: (account: string, id: number, decision: 'approved' | 'rejected'): unknown => {
              const m = routed
                ? (() => {
                  const dir = join(tenantRoot, account)
                  return existsSync(dir) ? router?.forAccount(account) ?? createDeniedMemory() : createDeniedMemory()
                })()
                : auditedMemory
              return m.review(id, decision)
            },
            recordCorrectionFor: (account: string, section: string, keyHint: string): void => {
              const m = routed
                ? (() => {
                  const dir = join(tenantRoot, account)
                  return existsSync(dir) ? router?.forAccount(account) ?? createDeniedMemory() : createDeniedMemory()
                })()
                : auditedMemory
              m.recordCorrection({ section, keyHint })
            },
          }
          provide2('eterna-memory-accounts', accountsFace)
        }
      }
      const detachMemory = attachMemory(dshHost(ctx), auditedMemory, {
        index: resolveIndexOptions,
        promptSource: livePromptSource(ctx),
        ...(domainOfFace !== undefined && { domainOf: domainOfFace }),
        ...(sessionResolver !== undefined && { resolver: sessionResolver }),
      })
      // M-M2 T6+T7 + M-M3 T11:整固 job 挂载(config.consolidation 缺省开;停用即
      // 不接线,回滚面 19 §7)。轻量链注入 domainOf(episodic 会话史落域);重量
      // Dream 按 config.dream 缺省开(间隔= dream.cron 降级语义的小时数)
      const dreamConfig = config.dream ?? {}
      // 键语义解耦(23 号评审 low#18 复盘,2026-11-16):consolidation 只管轻量
      // 提取链;Dream 独立由 dream.enabled 管——只关轻量时整固接线仍挂(Dream
      // 的触发面=会话尾在 consolidator 内),提取任务以 no-op 形态占位(返回
      // nothing-to-save,游标照常推进,保证 Dream 时间阈值合并继续工作)。
      const consolidationOff = config.consolidation?.enabled === false
      const detachConsolidation = consolidationOff && dreamConfig.enabled === false
        ? null
        : wireConsolidation(ctx, dbPath, auditedMemory, audit, {
          ...(config.consolidation?.model !== undefined && { curatorModel: config.consolidation.model }),
          ...(domainOfFace !== undefined && { domainOf: domainOfFace }),
          ...(consolidationOff && { skipExtraction: true }),
          ...(sessionResolver !== undefined && accessFace !== undefined && router !== undefined && {
            routing: {
              accountOfSession: (sessionId: string): string | undefined => accountOfSession!(sessionId),
              memoryForAccount: (account: string): Memory | undefined => router?.forAccount(account),
              ledgerFor: (account: string): MemoryAuditLedger => {
                let ledger = accountLedgers.get(account)
                if (ledger === undefined) {
                  ledger = new MemoryAuditLedger({ path: join(tenantRoot, account, '.eterna', 'memory-audit.jsonl'), logger: ctx.logger })
                  accountLedgers.set(account, ledger)
                }
                return ledger
              },
              /** Dream 遍历面(Q2:活跃账号=租户根下已有记忆库的账号;>20 按日分片)。 */
              allAccounts: (): readonly { account: string; dir: string }[] => {
                try {
                  const all = existsSync(tenantRoot) ? readDirNames(tenantRoot) : []
                  const withDb = all.filter(account => existsSync(join(tenantRoot, account, '.eterna', 'memory.sqlite3'))).sort()
                  if (withDb.length <= 20) return withDb.map(account => ({ account, dir: join(tenantRoot, account) }))
                  const shardCount = Math.ceil(withDb.length / 20)
                  const dayOfMonth = new Date().getUTCDate()
                  return withDb
                    .filter((_, index) => index % shardCount === dayOfMonth % shardCount)
                    .map(account => ({ account, dir: join(tenantRoot, account) }))
                } catch {
                  return []
                }
              },
            },
          }),
          ...(dreamConfig.enabled !== false && {
            dream: {
              intervalMs: dreamIntervalMs(dreamConfig.cron),
              ...(dreamConfig.maxTurns !== undefined && { maxTurns: dreamConfig.maxTurns }),
              ...(config.episodic?.ttlDays !== undefined && { ttlDays: config.episodic.ttlDays }),
              ...(config.episodic?.perDomainLimit !== undefined && { perDomainLimit: config.episodic.perDomainLimit }),
              ...(config.halfLifeDays !== undefined && { halfLifeDays: config.halfLifeDays }),
              ...(config.promotion?.userPromotionSampleRate !== undefined
                && { userPromotionSampleRate: config.promotion.userPromotionSampleRate }),
              ...(config.portrait?.enabled !== undefined && { portraitEnabled: config.portrait.enabled }),
              ...(domainRegistry !== null && { registry: domainRegistry }),
              agentsPath: join(cwd, 'AGENTS.md'),
              notesDir: config.notesDir ?? join(cwd, 'NOTES'),
            },
          }),
        })
      let detached = false
      return (): void => {
        if (detached) return
        detached = true
        domainWire?.detach()
        disposeSessionFace?.()
        detachConsolidation?.()
        detachMemory()
        domainRegistry?.close()
        disposeService()
      }
    },
  }
}

// DSH bundle loader 取 default export 插件实例(对齐 @event/pack plugin.ts 形态)
export default defineMemoryPlugin()

/**
 * 活绑定的注册表读取面(T2.6 登记制):每次装配现取 promptRegistry 服务
 * (提示词工作室插件提供),插件装载顺序无关——工作室晚装载也不影响后续装配轮次;
 * 服务缺席/形状不符/读取异常由 resolvePromptRegistry 与 memory 兜底语义兜住
 * (回落内置行为指令头),宿主照常起。
 */
function livePromptSource(ctx: Context) {
  return {
    resolveRuntimePromptText: (entryId: string): string | undefined =>
      resolvePromptRegistry(ctx)?.resolveRuntimePromptText(entryId),
  }
}

/**
 * portrait.md 缓存读取(M-M1 T3 注入面,T4 生成物):每次索引装配现读(再生成
 * 后无需重启)。文件缺席/读取失败/剥离 frontmatter 后无正文 → 省略画像区
 * (返回空对象,索引退回单区锚点形态);frontmatter 的 version/source_memory_ids
 * 是溯源元数据,不进 systemPrompt。
 */
function readPortraitCache(portraitPath: string): { portrait?: string } {
  let raw: string
  try {
    raw = readFileSync(portraitPath, 'utf8')
  } catch {
    return {}
  }
  const body = raw.replace(/^---\n[\s\S]*?\n---\n?/u, '').trim()
  return body.length > 0 ? { portrait: body } : {}
}

// ---------- M-M2 T6:会话尾整固接线 ----------

/** 目录名清单(仅一级目录名;读失败返回空——Dream 遍历面 fail-open)。 */
function readDirNames(root: string): readonly string[] {
  try {
    return readdirSync(root, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name)
  } catch {
    return []
  }
}

/** 整固接线入参(T6/T7 基础面 + M-M3 T11 轻量 domainOf 与重量 Dream 面)。 */
interface ConsolidationWiring {
  /** 提取执行体所用 curator 模型(T7;config.consolidation.model)。 */
  readonly curatorModel?: string
  /** 会话域归属读取面(T11 轻量:episodic 会话史行落域;wireDomainContext 提供)。 */
  readonly domainOf?: (sessionId: string) => string | undefined
  /** 重量 Dream 面(T11;config.dream.enabled=false 时缺席=不挂 Dream)。 */
  readonly dream?: {
    readonly intervalMs: number
    readonly maxTurns?: number
    readonly ttlDays?: number
    readonly perDomainLimit?: number
    readonly halfLifeDays?: number
    readonly userPromotionSampleRate?: number
    readonly portraitEnabled?: boolean
    readonly registry?: DomainRegistryStore
    /** AGENTS.md 路径(对账材料;工作区根)。 */
    readonly agentsPath?: string
    /** NOTES 根目录(对账材料)。 */
    readonly notesDir?: string
  }
  /**
   * 多租户路由面(23 号 M-T1;routing 模式启用):账号级原语,任务组合在
   * wireConsolidation 内(提取按快照会话逐次解析;Dream 遍历 allAccounts)。
   */
  readonly routing?: {
    accountOfSession(sessionId: string): string | undefined
    memoryForAccount(account: string): Memory | undefined
    ledgerFor(account: string): MemoryAuditLedger
    allAccounts(): readonly { account: string; dir: string }[]
  }
  /**
   * 只停轻量提取链(consolidation.enabled=false 而 Dream 开;23 号评审 low#18
   * 键解耦):提取任务以 no-op 占位(nothing-to-save,游标照常推进),Dream
   * 触发面(会话尾+时间阈值)继续工作。
   */
  readonly skipExtraction?: boolean
}

/**
 * 整固 job 装配:游标库(与 memory.sqlite3 同库,WAL 多连接)+ consolidation
 * 元数据库(画像再生成条件锚点)+ 三门控事实累积器 + 调度器(T7:提取执行体 =
 * curator 直调提取体;T11:dreamTask = 重量 Dream 四阶段执行体);
 * session/event 全局监听(活面累积 + turn/end 触发),session/disposed
 * teardown 兜底。返回 disposer:摘监听 → fire-and-forget abort+有界 drain
 * (drain 完成后自关游标库;宿主 disposer 不可 await)。
 * M-M2 T9:audit 账本穿线——提取执行体落提案行(含 pending 卡片);门控 skip
 * 在触发面落门控行(skip 即已决策,19 号 §4-T6);Dream 落周报行(T11)。
 */
function wireConsolidation(
  ctx: Context,
  dbPath: string,
  memory: Memory,
  audit: MemoryAuditLedger,
  wiring: ConsolidationWiring = {},
): () => void {
  const registry = new SessionGateFactsRegistry()
  const cursor = new ConsolidationCursorStore(dbPath)
  const meta = new ConsolidationMetaStore(dbPath)
  // 多租户路由(23 号 M-T1):routing 在场时提取/Dream 任务按快照逐次组装
  // (每账号独立 memory+ledger+meta;fail-closed:账号解析失败=nothing-to-save
  // 且 detail 记原因,不落任何库);缺席=单库形态(预构建任务,行为不变)。
  const routing = wiring.routing
  const extractionTask = wiring.skipExtraction === true
    ? (): Promise<ConsolidationTaskResult> => Promise.resolve({
      kind: 'nothing-to-save',
      detail: '轻量提取已停(consolidation.enabled=false),仅保留 Dream 链',
    })
    : routing === undefined
      ? createExtractionTask({
        ctx,
        memory,
        logger: ctx.logger,
        audit,
        ...(wiring.domainOf !== undefined && { domainOf: wiring.domainOf }),
        ...(wiring.curatorModel !== undefined && { model: wiring.curatorModel }),
      })
      : (snapshot: ConsolidationSnapshot, signal: AbortSignal): Promise<ConsolidationTaskResult> => {
        const account = routing.accountOfSession(snapshot.sessionId)
        if (account === undefined) {
          return Promise.resolve({ kind: 'nothing-to-save', detail: '多租户:会话账号解析失败,fail-closed 不落库(不重试)' })
        }
        const accountMemory = routing.memoryForAccount(account) ?? createDeniedMemory()
        return createExtractionTask({
          ctx,
          memory: accountMemory,
          logger: ctx.logger,
          audit: routing.ledgerFor(account),
          ...(wiring.domainOf !== undefined && { domainOf: wiring.domainOf }),
          ...(wiring.curatorModel !== undefined && { model: wiring.curatorModel }),
        })(snapshot, signal)
      }
  const dreamFace = wiring.dream
  const dreamTask = dreamFace === undefined
    ? undefined
    : routing === undefined
      ? createDreamTask({
        ctx,
        memory,
        meta,
        logger: ctx.logger,
        audit,
        portraitPath: join(dirname(dbPath), PORTRAIT_CACHE_FILENAME),
        ...dreamFace,
      })
      : async (snapshot: ConsolidationSnapshot, signal: AbortSignal): Promise<ConsolidationTaskResult> => {
        // 逐账号跑(Q2:调用方已分片);单账号失败不中断其余(结果聚合在 detail)
        const dream = dreamFace
        const details: string[] = []
        let anyConsolidated = false
        for (const { account, dir } of routing.allAccounts()) {
          const accountMemory = routing.memoryForAccount(account) ?? createDeniedMemory()
          const accountMeta = new ConsolidationMetaStore(join(dir, '.eterna', 'memory.sqlite3'))
          try {
            const task = createDreamTask({
              ctx,
              memory: accountMemory,
              meta: accountMeta,
              logger: ctx.logger,
              audit: routing.ledgerFor(account),
              portraitPath: join(dir, '.eterna', PORTRAIT_CACHE_FILENAME),
              ...(dream.registry !== undefined ? { registry: dream.registry } : {}),
              ...(dream.agentsPath !== undefined ? { agentsPath: join(dir, 'AGENTS.md') } : {}),
              ...(dream.notesDir !== undefined ? { notesDir: join(dir, 'NOTES') } : {}),
              ...(dream.maxTurns !== undefined && { maxTurns: dream.maxTurns }),
              ...(dream.ttlDays !== undefined && { ttlDays: dream.ttlDays }),
              ...(dream.perDomainLimit !== undefined && { perDomainLimit: dream.perDomainLimit }),
              ...(dream.halfLifeDays !== undefined && { halfLifeDays: dream.halfLifeDays }),
              ...(dream.userPromotionSampleRate !== undefined && { userPromotionSampleRate: dream.userPromotionSampleRate }),
              ...(dream.portraitEnabled !== undefined && { portraitEnabled: dream.portraitEnabled }),
              ...{ intervalMs: dream.intervalMs },
              ...(wiring.curatorModel !== undefined && { model: wiring.curatorModel }),
            })
            const outcome = await task(snapshot, signal)
            if (outcome.kind === 'ran') anyConsolidated = true
            details.push(`${account}:${outcome.kind}`)
          } catch (error) {
            details.push(`${account}:error(${error instanceof Error ? error.message : String(error)})`)
          } finally {
            accountMeta.close()
          }
        }
        return anyConsolidated
          ? { kind: 'ran', detail: `多账号 Dream:${details.join(' ')}` }
          : { kind: 'nothing-to-save', detail: `多账号 Dream 无变更:${details.join(' ')}` }
      }
  const consolidator = new SessionEndConsolidator({
    cursor,
    logger: ctx.logger,
    // T7 提取执行体:curator(默认 Flash)直调 + 冻结提示词 + 提案落库
    //(19 号 §4-T7;模型名来自 config.consolidation.model,provider 目录兜底扫描)
    // T9:提案落库后写一行提案审计(有待审行时组卡片同落;送达=面板审批队列)
    // T11 轻量:domainOf 注入 → episodic 会话史行落域(key=session-<id>)
    task: extractionTask,
    // T11 重量:Dream 四阶段执行体(S4-B 退路的调度面在 consolidator 内)
    ...(dreamTask !== undefined && { dreamTask }),
  })

  const offEvent = ctx.on('session/event', (session, event) => {
    const sessionId = sessionIdOf(session)
    if (sessionId === null) return
    // 会话尾主触发:dsh 无 session/end,turn/end(completed) 代理(S1 结论 B);
    // 非 completed(aborted/blocked/error/…)不是落定收尾,不触发
    if (event.type === 'turn/end') {
      if (event.data.reason.kind !== 'completed') return
      const outcome = consolidator.consolidateOnSessionEnd({
        sessionId,
        // 盘面日志定位在触发时冻结进快照(找不到为 null——turn 边界不保证已
        // flush,T7 读盘前自行等 session/flush)
        logPath: findSessionLogPath(resolveDshSessionsRoot(), sessionId),
        lastTurn: event.data.turn,
        endedAt: event.time,
        facts: registry.factsOf(sessionId),
      })
      // T9 门控行:skip 是已决策(direct-write/no-user-prose/credential-redline),
      // 留痕;already-done/scheduled 不另记行(提案行/游标已覆盖)
      if (outcome.kind === 'skipped') audit.recordGate({ sessionId, reason: outcome.reason })
      // T11 重量:轻量链落定后按时间阈值合并 Dream(S4-B 退路)——不因轻量
      // skip/already-done 而跳过判定(每个 completed 会话尾都是 Dream 的触发点)
      consolidator.maybeEnqueueDream(event.time, wiring.dream?.intervalMs ?? dreamIntervalMs())
      return
    }
    registry.observe(sessionId, event)
  })

  const offDisposed = ctx.on('session/disposed', (session) => {
    const sessionId = sessionIdOf(session)
    if (sessionId === null) return
    registry.clear(sessionId)
    // teardown 兜底:abort 匹配的 running、丢弃匹配的 pending(游标不推进);
    // 收尾在调度器内部 done 链上完成——fire-and-forget,勿 await(S1 结论 B)
    consolidator.abandonSession(sessionId)
  })

  return () => {
    offEvent()
    offDisposed()
    // 先 abort 在跑整固再释放;drain 上界 60s(挂死任务不再等)。宿主 disposer
    // 同步签名不可 await → fire-and-forget(audit 插件 flush 同款)
    void consolidator.dispose().catch(() => {})
    meta.close()
  }
}

/** 会话 id 弱读取(fake/测试与真实 Session 同路径;缺席返回 null,事件不可归属则忽略)。 */
function sessionIdOf(session: Session): string | null {
  const id = (session as { readonly id?: unknown }).id
  return typeof id === 'string' ? id : null
}

/** 会话域视图纯函数(override 优先,其次自动解析 bound 域;sessionFace 两方法共用)。 */
function sessionDomainViewOf(
  states: Map<string, SessionDomainState>,
  sessionId: string,
): { domainKey: string | null; overridden: boolean } {
  const state = states.get(sessionId)
  if (state?.override !== undefined) return { domainKey: state.override, overridden: true }
  const resolution = state?.resolution
  const domainKey = resolution !== undefined && resolution.bound && resolution.domainKey !== null
    ? resolution.domainKey
    : null
  return { domainKey, overridden: false }
}

// ---------- M-M3 T10:会话域解析接线 ----------

/** 会话域接线入参(workspace 显式域 + 打标模型覆写)。 */
interface DomainWireOptions {
  readonly workspaceName?: string
  readonly model?: string
  /** T13 指标埋点:域解析定格审计账本(缺席不记,不影响解析主流程)。 */
  readonly audit?: MemoryAuditLedger
}

/** 单会话域状态:解析定格结果(含 none)、在跑 promise(失败重试去重)与人工切换(T12-③)。 */
interface SessionDomainState {
  resolution?: DomainResolution | undefined
  inFlight?: Promise<void> | undefined
  /** 人工切换的域键(域识别 chip;null 值用独立布尔区分——undefined=未切换)。 */
  override?: string | undefined
}

/**
 * 会话域上下文接线(T10):首条真人类用户消息触发 resolveDomain——workspace
 * 显式域(配置声明)跳过打标直接注册;否则 curator 打标先归并已注册域、无匹配
 * 计数候选(≥minSessionsForNewDomain 独立会话转正,Q2)。结果按会话缓存在进程内:
 * - 索引消费:resolveIndexOptions 经 assemblySessionIdOf 反查 → domainKey 注入
 *   当前域索引区(T3 参数;未绑定/候选期不注入);
 * - episodic 域归属:domainOf 穿线进 attachMemory,memory_write 的 episodic
 *   写入以会话域为权威归属(18 §1.3)。
 * 定格与重试:解析成功(含 none/candidate)即定格,不再重打;失败(打标调用/
 * 输出解析)不缓存结果,下一条用户消息重试——重复计数由 domain_hit_sessions
 * 持久去重兜底,重试不会多计。session/disposed 摘状态。
 * T12-③ 人工切换:override 域键优先于自动解析(domainOf 先查 override);
 * overrideDomain 校验域键必须已转正注册(候选/未知键拒绝),已注册域写
 * domain_registry last_used(touchUsed 口径)+ 记会话 override——下次索引装配
 * 即用新域(19 号 §5-T12.3「切换=写 last_used + 当前索引域更新」)。
 * 返回 disposer:摘监听 + 清状态(注册表由调用方关闭)。
 */
function wireDomainContext(
  ctx: Context,
  registry: DomainRegistryStore,
  options: DomainWireOptions,
): {
  domainOf(sessionId: string): string | undefined
  /** T12-③ 会话域切换面(宿主 eternaMemory 网关消费;以服务形态对外)。 */
  sessionFace: {
    sessionDomainView(sessionId: string): { domainKey: string | null; overridden: boolean }
    overrideDomain(sessionId: string, domainKey: string | null): { domainKey: string | null }
    listRegisteredDomains(): readonly { domainKey: string; label: string }[]
  }
  detach(): void
} {
  const states = new Map<string, SessionDomainState>()
  // ctx.logger 的结构可选视图(fake/测试 ctx 缺席,真实宿主恒在):日志只做观测,
  // 缺席静默(与 SessionEndConsolidator 的 ConsolidationLogger 同款)
  const logger = (ctx as unknown as { readonly logger?: ConsolidationLogger }).logger
  // 打标器懒装配:S4-A3 同款路由(resolveCuratorRoute 目录兜底扫描)首个打标
  // 请求时解析,成功即缓存;失败不缓存(下一条用户消息重试,不固化坏路由)
  let tagger: DomainTagger | undefined
  const ensureTagger = async (): Promise<DomainTagger> => {
    if (tagger !== undefined) return tagger
    const route = await resolveCuratorRoute(ctx, options.model)
    tagger = createDomainTagger(ctx, route)
    return tagger
  }

  const offEvent = ctx.on('session/event', (session, event) => {
    const sessionId = sessionIdOf(session)
    if (sessionId === null) return
    if (event.type !== 'user/message') return
    let state = states.get(sessionId)
    if (state === undefined) {
      state = {}
      states.set(sessionId, state)
    }
    // 已定格(含 none)或在跑:不再触发(每会话一次;失败重试见 catch 分支)
    if (state.resolution !== undefined || state.inFlight !== undefined) return
    const message = userMessageTextOf(event)
    if (message.trim().length === 0) return
    state.inFlight = resolveDomain(
      {
        registry,
        sessionId,
        firstUserMessage: message,
        ...(options.workspaceName !== undefined && { workspaceName: options.workspaceName }),
      },
      async (taggerInput: DomainTaggerInput) => (await ensureTagger())(taggerInput),
    )
      .then((resolution) => {
        state.resolution = resolution
        // T13 指标埋点:解析定格即记一行(含 none/candidate——准确率的分母是全部
        // 定格;人工切换不是打标不记;账本 fail-open,写入失败不炸域解析)。
        options.audit?.recordDomainResolve({
          sessionId,
          domainKey: resolution.domainKey,
          source: resolution.source,
          bound: resolution.bound,
          counted: resolution.counted,
        })
        logger?.info?.(
          `[memory] 会话域解析(${sessionId}):${resolution.domainKey === null
            ? '无域'
            : `${resolution.bound ? '绑定' : '候选'} ${resolution.domainKey}(source=${resolution.source})`}`,
        )
      })
      .catch((error: unknown) => {
        logger?.warn?.(
          `[memory] 会话域解析失败,下一条用户消息重试(${sessionId}):${error instanceof Error ? error.message : String(error)}`,
        )
      })
      .finally(() => {
        state.inFlight = undefined
      })
  })

  const offDisposed = ctx.on('session/disposed', (session) => {
    const sessionId = sessionIdOf(session)
    if (sessionId === null) return
    states.delete(sessionId)
  })

  return {
    /** 会话绑定域(override 优先;无 override 时仅 bound;候选期/未解析/无域=undefined)。 */
    domainOf(sessionId: string): string | undefined {
      const state = states.get(sessionId)
      if (state?.override !== undefined) return state.override
      const resolution = state?.resolution
      return resolution !== undefined && resolution.bound && resolution.domainKey !== null
        ? resolution.domainKey
        : undefined
    },
    /**
     * T12-③ 会话域切换面(域识别 chip 数据面;宿主 eternaMemory 网关转发):
     * - sessionDomainView:当前域视图(override 优先,其次自动解析的 bound 域;
     *   都无 → domainKey=null);
     * - overrideDomain:domainKey=null 清除切换回自动;非 null 必须**已转正注册**
     *   (候选/未知键 RangeError 拒绝),命中即 touchUsed(写 last_used + session_count)
     *   并记会话 override——下次索引装配即用新域。
     * - listRegisteredDomains:已转正域清单(chip 列表;注册表 list(true) 同源)。
     */
    sessionFace: {
      sessionDomainView(sessionId: string): { domainKey: string | null; overridden: boolean } {
        return sessionDomainViewOf(states, sessionId)
      },
      overrideDomain(sessionId: string, domainKey: string | null): { domainKey: string | null } {
        let state = states.get(sessionId)
        if (state === undefined) {
          state = {}
          states.set(sessionId, state)
        }
        if (domainKey === null) {
          delete state.override
          return { domainKey: sessionDomainViewOf(states, sessionId).domainKey }
        }
        const record = registry.resolve(domainKey)
        if (record === null || record.registered === null) {
          throw new RangeError(`[memory] 域 ${domainKey} 未注册(候选中或不存在),不能切换为当前会话域`)
        }
        registry.touchUsed(domainKey)
        state.override = domainKey
        return { domainKey }
      },
      listRegisteredDomains(): readonly { domainKey: string; label: string }[] {
        return registry.list(true).map(item => ({ domainKey: item.domainKey, label: item.label }))
      },
    },
    detach(): void {
      offEvent()
      offDisposed()
      states.clear()
    },
  }
}
