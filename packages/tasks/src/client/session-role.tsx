/**
 * 会话头 super 标记(conversation.session.header.utilities;2026-11-19):
 * 主控会话(orchestrator-*)标「主控」、工单执行会话(worker-*)标「执行」,普通会话不渲染。
 *
 * 数据面:GET /access/api/tasks/session-roles(登录即可,只回 id/title);模块级 30s
 * 缓存 + 在途去重(每个会话头各挂一枚徽标,不能一 mount 一发)。fail-closed:取不到
 * 角色(未登录/任务内核缺席/网络失败)一律不渲染——宁缺不误标。
 */
import { useEffect, useState, type ReactElement } from 'react'
import { Icon } from '@eterna/ui/icons'
import { fetchTasksSessionRoles, type TasksSessionRoles } from './api.ts'
import type { SessionSlotProps } from './client-types.ts'

export type SessionRole = 'orchestrator' | 'worker'

const ROLES_TTL_MS = 30_000

let rolesCache: { readonly at: number; readonly promise: Promise<TasksSessionRoles> } | undefined

/** 缓存失效(测试/登出场景;生产靠 TTL)。 */
export function resetSessionRolesCache(): void {
  rolesCache = undefined
}

/** 角色判定(精确匹配:主会话 id 优先,其次 worker session id 集;其余 undefined)。 */
export function sessionRoleOf(sessionId: string, roles: TasksSessionRoles | undefined): SessionRole | undefined {
  if (roles === undefined) return undefined
  if (roles.masterId !== undefined && sessionId === roles.masterId) return 'orchestrator'
  return roles.workerSessionIds.includes(sessionId) ? 'worker' : undefined
}

/** 角色面(30s TTL + 在途去重;失败清缓存下次重试)。 */
export async function fetchSessionRolesCached(now = Date.now()): Promise<TasksSessionRoles> {
  if (rolesCache === undefined || now - rolesCache.at > ROLES_TTL_MS) {
    rolesCache = { at: now, promise: fetchTasksSessionRoles() }
  }
  try {
    return await rolesCache.promise
  } catch (error) {
    rolesCache = undefined
    throw error
  }
}

export interface SessionRoleBadgeProps {
  readonly sessionId: string
  readonly t: (key: string) => string
}

/** 徽标本体(纯展示;role undefined 不渲染——保持会话头零噪声)。 */
export function SessionRoleBadge({ sessionId, t }: SessionRoleBadgeProps): ReactElement | null {
  const [role, setRole] = useState<SessionRole | undefined>(undefined)
  useEffect(() => {
    let alive = true
    void fetchSessionRolesCached()
      .then((roles) => { if (alive) setRole(sessionRoleOf(sessionId, roles)) })
      .catch(() => { if (alive) setRole(undefined) })
    return () => { alive = false }
  }, [sessionId])
  if (role === undefined) return null
  const master = role === 'orchestrator'
  return (
    <span
      data-eterna-tasks="session-role"
      data-eterna-tasks-role={role}
      title={t(master ? 'badge.masterTitle' : 'badge.workerTitle')}
    >
      <Icon name={master ? 'flow' : 'worker'} size={12} />
      {t(master ? 'badge.master' : 'badge.worker')}
    </span>
  )
}

/** 会话头 utilities 席位入口(框架以 React 组件调用;inject 面提供 t)。 */
export function SessionRoleBadgeEntry(props: SessionSlotProps): ReactElement | null {
  if (typeof props.sessionId !== 'string' || props.sessionId === '' || props.t === undefined) return null
  return <SessionRoleBadge sessionId={props.sessionId} t={props.t} />
}