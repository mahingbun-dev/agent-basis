/**
 * audit 插件:把 AuditProjector(事件流投影)+ 每日轮转落盘 + 分页查询装配为 ctx.audit 服务。
 * 纯观察型:不产生 allow/ask/deny,不与 governance 争 pre-execute 顺序(设计 §2.2-3、§3.4 表)。
 */
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
// 空类型导入 = dsh-session 对 cordis Events('session/event')增广的触发器:不导入则该
// 声明文件不进本包 tsc 程序,ctx.on('session/event') 的监听签名无法解析
// (interact/tests/types.seam-pin.ts 同款写法)。
import type {} from '@deepseek-ai/dsh-session'
import { AuditProjector, defaultPiiPatterns, PiiFilter } from '@eterna/governance'
import { DailyFileAuditSink } from './daily-sink.ts'
import { queryAuditRecords } from './query.ts'
import { AUDIT_ID, AUDIT_SERVICE_ID } from './service.ts'
import type { AuditPluginConfig, AuditWorld } from './service.ts'

/** bundle 装载行 id(cordis.patch.yml 的 eterna-audit 行)。 */
export const AUDIT_PLUGIN_NAME = 'eterna-audit'

/** 审计落盘目录缺省(agent cwd 下 .eterna;panel 读数与 FileAuditSink 旧约定同源)。 */
export function defaultAuditDir(): string {
  return join(process.cwd(), '.eterna')
}

export function defineAuditPlugin(config: AuditPluginConfig = {}) {
  return {
    name: AUDIT_PLUGIN_NAME,
    apply(ctx: Context): () => void {
      const dir = config.dir ?? defaultAuditDir()
      const filePrefix = config.filePrefix ?? 'audit-'

      // governance 机会读取(不 inject,§3.0-2:inject 是硬依赖表,false 非可选开关,
      // fiber.ts:619-626 逐键 required——声明会把 audit 绑死在 governance 上,违背
      // 「audit 独立可装」)。也不能裸读 ctx 属性:cordis get 陷阱对未声明 inject 的
      // 兄弟插件服务直接抛 "cannot get property ... without inject"(vendor/cordis
      // src/reflect.ts:152;2026-11-09 治理 E2E 实证 eterna-audit fiber failed)。
      // ctx.reflect.get(name, false) 是受认可的无 inject 读取(同一文件 :240「without
      // the inject requirement」;harness 先例 liveshare share-host.ts:134,238),
      // strict=false = 值在 store 即用(机会语义,不等 providing fiber 落定)。
      // 在场复用其 PiiFilter,缺席用自带 defaultPiiPatterns 兜底——审计是合规资产,脱敏不可缺位。
      const gov = ctx.reflect.get('governance', false) as { pii?: PiiFilter } | undefined
      const pii = gov?.pii ?? new PiiFilter(config.piiPatterns ?? defaultPiiPatterns())

      const trail = new AuditProjector({
        sinks: [new DailyFileAuditSink(dir, filePrefix), ...(config.extraSinks ?? [])],
        pii,
        ...(config.argsPreviewLimit !== undefined ? { argsPreviewLimit: config.argsPreviewLimit } : {}),
      })
      const world: AuditWorld = {
        id: AUDIT_ID,
        trail,
        query: filter => queryAuditRecords({ dir, filePrefix, filter }),
        report: detail => trail.reportGovernance(detail),
      }

      // 官方 seam:ctx 属性必须经 provide 声明后才能赋值(cordis Context set 陷阱),
      // 且服务名 = ctx 属性名(§3.0-1):provide('audit') → ctx.audit。
      const provide = ctx.provide(AUDIT_SERVICE_ID, world)

      // A 面:session/event 增量投影(纯观察,无裁决权)。插件级消费无需 inject session
      // (先例 deepseek-harness context/agent-instructions,设计 §3.4 表)。
      const offEvent = ctx.on('session/event', (_session, event) => {
        world.trail.projectEvent(event)
      })

      // effect 逆闭包(§3.3):先摘监听(停止增量,flush 是闭账而非继续收账)→ flush 冲账 → 撤 provide。
      // provide 的 disposer 运行时是 async(reflect.ts:311-321;glue governance-plugin 同款
      // 裸调用),卸载路径 fire-and-forget 不 await,防阻塞宿主;
      // flush 吞错防阻塞宿主(上抛首错的强语义保留给显式冲账调用)。
      return () => {
        offEvent()
        void world.trail.flush().catch(() => {})
        provide()
      }
    },
  }
}

// DSH bundle loader 取 default export 插件实例(漏写 = 静默不装载,硬性规范 1)
export default defineAuditPlugin()
