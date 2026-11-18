/**
 * tasks↔access 归属桥(A2,2026-11-19;glue 组合层):把 orchestrator 主会话的归属
 * 登记进 access 账本——删归属行后新 boot 自动登记,幂等。
 *
 * 缝(裁决:组合层胜出——realm→账号归属是部署决策,Tier2 tasks 不裁决账号身份,
 * tasks plugin.ts:876-877「masterId 等部署决策照旧归 glue」先例;access 保持租户
 * 无关;tasks 侧不写 access 账本、access 侧不反读 tasks,时序也不允许):
 * - 读 ctx.tasks(reflect 键 'tasks',tasks 装配 provide 的服务):masterId(主会话
 *   引导解析结果,orchestrator-<realm> 约定派生;undefined=未引导,不猜)+ realm
 *   (部署指名账号,super 模板 config.realm=admin 与 access userRootFor 的
 *   <tenantRoot>/<account> 布局对齐——realm 名=登录账号名即对齐);
 * - 读/写 access 账本(reflect 键 'eternaAccessStore',access P3 provide;usage-stats
 *   ledger 同款机会读取):userIdByAccount(realm) 映射登录账号 id,recordSession
 *   落归属行(upsert 幂等),sessionOwner 判已登记即跳过。
 *
 * 装配纪律(cordis):静态 inject ['tasks']=全部注入服务就绪才 apply——tasks 服务
 * 就绪即 tasks 插件 bootTasks 已完成、masterId 引导已定(tasks plugin.ts:845-849
 * 同款纪律);宿主服务读取一律 reflect.get(name, false)(cordis 过滤上下文直读
 * 抛 cannot get property without inject,sessionHostFromContext 同款)。
 *
 * fail-closed 口径(只记 log,绝不炸 boot、不猜身份):账本面缺
 * recordSession/userIdByAccount 任一键(旧 access 包或 access 未挂)→不登记;
 * masterId 未引导→不猜;realm 账号不在用户表(realm 与登录账号名不对齐的部署)
 * →不登记、显式可见。归属行持久:本插件配逆不撤销登记行(撤销=主会话失去归属,
 * /api/session/prompt 即被守卫拒;卸载语义=不再补登记,行保留)。
 */
import type { Context } from '@deepseek-ai/cordis'

export const ETERNA_TASKS_ACCESS_BRIDGE_PLUGIN_NAME = 'eterna-tasks-access-bridge'

/**
 * access 账本面的结构子集(access plugin.ts eternaAccessStore provide 的消费面;
 * 写面仅归属登记 upsert 一键——账本写权限收口在 access 包内,本桥只传参)。
 */
export interface AccessStoreBridgeFace {
  sessionOwner(sessionId: string): number | undefined
  recordSession(sessionId: string, ownerId: number, workspaceId: string | null): void
  userIdByAccount(account: string): number | undefined
}

/** ctx.tasks 服务的结构子集(不 import @eterna/tasks——结构端口,tasks 不被 Tier2 之外裁决)。 */
export interface TasksBridgeFace {
  readonly id: string
  /** 本栈绑定的租户 realm(=部署账号名;userRootFor <tenantRoot>/<account> 布局对齐)。 */
  readonly realm: string
  /** orchestrator 主会话 id(undefined=未引导,不猜主会话)。 */
  readonly masterId: string | undefined
}

export function defineTasksAccessBridgePlugin() {
  return {
    name: ETERNA_TASKS_ACCESS_BRIDGE_PLUGIN_NAME,
    // 静态 inject:tasks 服务就绪才 apply(cordis 语义,「服务 provide 后自动激活」)——
    // 届时 bootTasks 已完成、masterId 引导已定(tasks defineTasksPlugin 注纪律同款)。
    inject: ['tasks'],
    apply(ctx: Context): () => void {
      // 宿主 logger 机会读取(结构面,缺席静默——channels/memory 插件同款口径)。
      const logger = (ctx as unknown as { readonly logger?: { readonly info?: (...args: unknown[]) => void } }).logger
      const reflect = (ctx as unknown as { readonly reflect?: { get(name: string, strict?: boolean): unknown } }).reflect
      // ── ① access 账本面:结构校验 fail-closed(缺任一键=旧 access 包/access 未挂→不登记)──
      const store = (reflect?.get('eternaAccessStore', false) ?? undefined) as AccessStoreBridgeFace | undefined
      if (store === undefined || typeof store.recordSession !== 'function'
        || typeof store.userIdByAccount !== 'function' || typeof store.sessionOwner !== 'function') {
        console.error('[eterna-tasks-access-bridge] eternaAccessStore 缺席或缺 recordSession/userIdByAccount 面,跳过主会话归属登记')
        return () => {}
      }
      // ── ② tasks 服务面:inject 已声明就绪,反射读取兜底(结构子集,不 import 实例)──
      const runtime = (reflect?.get('tasks', false) ?? undefined) as TasksBridgeFace | undefined
      // ── ③ masterId:未引导(裸宿主且无 config/KV)→ 不猜主会话,不登记 ──
      const masterId = runtime?.masterId
      if (typeof masterId !== 'string' || masterId === '') {
        console.error('[eterna-tasks-access-bridge] ctx.tasks.masterId 未引导,不猜主会话,跳过主会话归属登记')
        return () => {}
      }
      // ── ④ realm→登录账号:账号不在用户表 = 部署不对齐,显式可见、不猜 id ──
      const realm = runtime?.realm
      if (typeof realm !== 'string' || realm === '') {
        console.error('[eterna-tasks-access-bridge] ctx.tasks.realm 缺席,无法映射登录账号,跳过主会话归属登记')
        return () => {}
      }
      const userId = store.userIdByAccount(realm)
      if (userId === undefined) {
        console.error(`[eterna-tasks-access-bridge] realm「${realm}」不在 access 用户表(realm 与登录账号名不对齐?),跳过主会话归属登记`)
        return () => {}
      }
      // ── ⑤ 幂等:行已在且归属正确 → 不写(recordSession 是覆写语义 upsert,重复写
      // 无害,但按 A2 验收口径归属正确时不落写)──
      if (store.sessionOwner(masterId) === userId) {
        logger?.info?.(`[eterna-tasks-access-bridge] 主会话 ${masterId} 已归属账号「${realm}」(id=${userId}),跳过登记`)
        return () => {}
      }
      // ── ⑥ 登记归属(workspaceId=null:/api/session/prompt 守卫只查 sessions 行,
      // access tenant.ts:398;无 workspaceId 的请求不进 workspaceOwner 分支)──
      store.recordSession(masterId, userId, null)
      logger?.info?.(`[eterna-tasks-access-bridge] 主会话 ${masterId} 已登记归属账号「${realm}」(id=${userId})`)
      return () => {}
    },
  }
}

// DSH bundle loader 取 default export 插件实例(对齐 interact-plugin.ts:81 形态;
// super 模板挂载行 name '@eterna/glue/tasks-access-bridge-plugin' 即解析到本模块)
export default defineTasksAccessBridgePlugin()
