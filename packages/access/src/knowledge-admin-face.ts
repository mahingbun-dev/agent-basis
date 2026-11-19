/**
 * 参考实现片段:知识库管理服务面(eterna-knowledge-admin)的**消费契约**。
 *
 * 用途:本文件唯一目的是让 tenant.ts 插入段的类型检查成立——插入段通过
 * `deps.reflect.get('eterna-knowledge-admin', false)` 机会语义取面,消费面是
 * **结构子集**(鸭子一致,与 tenant.ts 对 eterna-panel-accounts / eterna-memory-accounts
 * 的既有读法同源),因此这里把该结构子集写成可编译的 interface 复刻。
 *
 * 红线:本文件不实现任何业务,不碰 sqlite/凭据;业务面由 @eterna/knowledge-admin
 * (knowledge-core 交付)承载。
 */

/** 守卫交给服务面的调用者身份(唯一身份来源=守卫 cookie 解析结果,服务面不得自解)。 */
export interface KnowledgeAdminCaller {
  /** 登录账号名(access users 表 account 列;分库键=目录名,f10n 与 tenantRoot 一致)。 */
  readonly account: string
  /** 是否管理员(access users.role === 'admin')。 */
  readonly admin: boolean
  /** 用户 id(access users.id;服务面记成员/审计外键用)。 */
  readonly userId: number
}

/** 知识库管理服务面(结构子集;方法名以 @eterna/knowledge-admin 契约表为准)。 */
export interface KnowledgeAdminFaceLike {
  [method: string]: ((caller: KnowledgeAdminCaller, args: Record<string, unknown>) => unknown) | undefined
}
