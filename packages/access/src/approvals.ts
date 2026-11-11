/**
 * P4-T7(2026-11-11):通用审批流(应用层;数据面在 UserStore——users.db 同库新表)。
 * 审批模型:type+payload JSON 泛化;首个消费方=plugin-promote(转内置)。
 * 消息提醒=站内 notifications(不出内网,工程纪律)。
 */
import type { TenantDeps } from './tenant.ts'

/** 审批请求行。 */
export interface ApprovalRow {
  readonly id: number
  readonly type: string
  readonly payload: unknown
  readonly requesterId: number
  readonly status: 'pending' | 'approved' | 'rejected'
  readonly note: string | null
}

function rowToApproval(r: Record<string, unknown>): ApprovalRow {
  return {
    id: Number(r.id), type: String(r.type), payload: JSON.parse(String(r.payload)),
    requesterId: Number(r.requester_id), status: String(r.status) as ApprovalRow['status'],
    note: typeof r.note === 'string' ? r.note : null,
  }
}

/** 应用层审批流(消费 UserStore 数据面方法)。 */
export class ApprovalFlow {
  constructor(private readonly deps: TenantDeps) {}

  /** 发起审批(个人;同插件同请求者 pending 去重)。返回请求 id;重复=undefined。 */
  register(type: string, payload: unknown, requesterId: number): number | undefined {
    if (this.deps.store.approvalPendingId(type, requesterId) !== undefined) return undefined
    const id = this.deps.store.approvalRegister(type, payload, requesterId)
    this.deps.store.notifyAdmins('approval.pending', `收到「${type}」审批请求(#${id}),请在设置→审批队列处理`)
    return id
  }

  /** 决策(admin;decide 后通知发起人)。 */
  decide(id: number, deciderId: number, approve: boolean, note: string): boolean {
    return this.deps.store.approvalDecide(id, deciderId, approve, note)
  }

  /** 待审详情(转内置执行面取 payload)。 */
  row(id: number): { type: string; payload: string } | undefined {
    return this.deps.store.approvalRow(id)
  }

  /** 队列(admin 视角:pending 全量)。 */
  listPending(): ApprovalRow[] {
    return this.deps.store.approvalsPending().map(rowToApproval)
  }

  /** 我的请求(发起人视角)。 */
  listMine(userId: number): ApprovalRow[] {
    return this.deps.store.approvalsMine(userId).map(rowToApproval)
  }

  notifications(userId: number): Array<Record<string, unknown>> {
    return this.deps.store.notificationsOf(userId)
  }

  unreadCount(userId: number): number {
    return this.deps.store.notificationsUnread(userId)
  }

  markAllRead(userId: number): void {
    this.deps.store.notificationsMarkAllRead(userId)
  }

  /** 级联销毁(T8)。 */
  forgetUser(userId: number): void {
    this.deps.store.approvalsForget(userId)
  }
}

/** 确保 approvals/notifications 表存在(UserStore 数据面;插件启动时调用)。 */
export function ensureApprovalSchema(store: { ensureApprovalSchema(): void }): void {
  store.ensureApprovalSchema()
}
