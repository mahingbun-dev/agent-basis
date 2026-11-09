/**
 * @eterna/audit —— 审计留痕服务契约(企业插件设计 docs/design/enterprise-plugins.md §3.1)。
 *
 * Cordis 命名双常量显式分名(§3.0-4,杜绝 governance 库的同名不同义分叉):
 * - AUDIT_SERVICE_ID = 'audit' 是 cordis provide 的服务名 = ctx 属性名(provide('audit') → ctx.audit,
 *   reflect.ts:291-306 的 props[name] 语义);
 * - AUDIT_ID = '@eterna/audit' 是库内对象 id 标签(注册表命名空间,非 cordis 服务名)。
 *
 * 三能力面(§2.1):
 * - A trail:AuditProjector(governance 库实例),事件流增量投影到 sink 集;
 * - C query:分页游标查询(强制 limit,防全量物化,§3.1);
 * - report:治理侧直投(预算违规/令牌拒绝等非工具调用事件),actor 插件粒度在此落。
 *
 * B 面(最小权限令牌核验 tokens: TokenVerifier + ctx.tools.guard,§3.5)按设计 §4 路线表
 * 属 P1,本 P0 骨架不含——audit 必须在无 governance/无 tools 服务的宿主上可装载(§3.0-2:
 * inject 是硬依赖表,声明即永续 PENDING),故本包不声明任何 inject。
 */
import type { AuditActor, AuditProjector, AuditRecord, AuditSink, PiiPattern } from '@eterna/governance'
// 空类型导入 = 增广触发器:没有对 '@deepseek-ai/cordis' 的任何导入时,下面的 declare module
// 会被当成「环境模块声明」遮蔽真实模块(Context 变成无 provide/on 的空接口,ctx.audit 反而
// 不可达)。导入后才是真正的 declaration merging(interact/tests/types.seam-pin.ts 同款写法)。
import type {} from '@deepseek-ai/cordis'

/** cordis 服务名 = ctx 属性名(§3.0-1):provide('audit') → ctx.audit。 */
export const AUDIT_SERVICE_ID = 'audit'

/** 库内对象 id 标签(注册表命名空间,非 cordis 服务名)。 */
export const AUDIT_ID = '@eterna/audit'

/** C 面查询过滤器(全部条件可选;同一条件内取 OR,条件之间取 AND)。 */
export interface AuditQuery {
  /** 只取这些 kind;缺省 = 全部。 */
  readonly kinds?: readonly AuditRecord['kind'][]
  /** 只取 tool 名命中任一 glob 的 tool-call 记录(`*`/`?` 通配,语义同 governance matchAnyGlob)。 */
  readonly tool?: readonly string[]
  /** 按成败过滤 tool-call(isError 为真的记录含被拒调用);缺省 = 不过滤。 */
  readonly isError?: boolean
  /** ISO 下界(含):at 缺席的记录不命中。 */
  readonly since?: string
  /** ISO 上界(含)。 */
  readonly until?: string
}

/** C 面单页结果:nextCursor 缺席 = 已到末尾(后面不再有命中记录)。 */
export interface AuditQueryPage {
  readonly records: readonly AuditRecord[]
  readonly nextCursor?: string
}

/**
 * audit 服务本体(provide('audit') 的值;panel 与后续合规报表经 ctx.audit 消费)。
 */
export interface AuditWorld {
  readonly id: typeof AUDIT_ID
  /** A 面:事件投影器(governance 库实例,sink 集 = 每日轮转 FileSink + 可选外部 sink)。 */
  readonly trail: AuditProjector
  /** C 面:留痕分页查询(limit 强制;游标沿文件序 + 行序单调推进)。 */
  query(filter: AuditQuery & { readonly limit: number; readonly cursor?: string }): Promise<AuditQueryPage>
  /** 治理侧直投(actor 粒度在此落;detail.actor 提升为记录级字段)。 */
  report(detail: Readonly<Record<string, unknown>> & { readonly actor?: AuditActor }): readonly AuditRecord[]
}

// 官方 seam:ctx 属性必须经 provide 声明后才能赋值(cordis Context set 陷阱)。
// 服务名 'audit' 经本增广进入 Context 类型面 → ctx.audit 编译期可达。
declare module '@deepseek-ai/cordis' {
  interface Context {
    audit?: AuditWorld
  }
}

/** defineAuditPlugin 配置(全部可选;缺省即按日轮转落 agent cwd 下 .eterna)。 */
export interface AuditPluginConfig {
  /** 审计落盘目录(默认 process.cwd() 下 .eterna;panel 读数同源)。 */
  readonly dir?: string
  /** 每日文件前缀(默认 'audit-',文件名 = <prefix>YYYYMMDD.jsonl)。 */
  readonly filePrefix?: string
  /** 额外 sink(追加在每日文件 sink 之后;如测试用 MemoryAuditSink / 远端转发)。 */
  readonly extraSinks?: readonly AuditSink[]
  /** 工具参数预览截断长度(透传 AuditProjector,默认 200)。 */
  readonly argsPreviewLimit?: number
  /** PII 模式覆盖(默认 governance defaultPiiPatterns;ctx.governance.pii 在场时优先复用其实例,§3.1)。 */
  readonly piiPatterns?: readonly PiiPattern[]
}
