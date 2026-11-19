/**
 * 任务客户端 API 面:同源 fetch 封装(/access/api/tasks/*,eterna_session cookie 自动携带)。
 * 与 access 客户端 api.ts 同纪律:零外部类型依赖,错误统一成 TasksApiError(status)。
 *
 * 权限契约(access/routes.ts):
 * - session-roles:登录即可(会话头徽标;不含设置内容);
 * - settings GET/POST:admin;403 = 非管理员,503 = 任务内核未装载/未就绪。
 */
import type { TasksSettings } from './settings-model.ts'

export interface TasksSettingsView {
  readonly ok: true
  readonly realm: string
  readonly masterId: string | undefined
  readonly masterTitle: string
  readonly paused: boolean
  readonly policyVersion: string
  readonly settings: TasksSettings
  readonly revisions: Readonly<Record<string, number>>
  readonly workerSessionIds: readonly string[]
  readonly health: { readonly state: string; readonly detail: string }
  readonly stats: {
    readonly tickets: { readonly open: number; readonly active: number; readonly total: number }
    readonly policy: { readonly version: string; readonly rules: number; readonly evalMode: string }
    readonly executor: { readonly maxWorkers: number }
  }
}

export interface TasksSessionRoles {
  readonly masterId: string | undefined
  readonly masterTitle: string
  readonly workerSessionIds: readonly string[]
}

export interface TasksSaveOk {
  readonly ok: true
  readonly saved: boolean
  readonly changed: boolean
  readonly revision: number
  readonly policyVersion: string
  readonly settings: TasksSettings
}

/** 端点错误(HTTP status + 服务端中文说明;0 = 网络层失败,403/503 由设置分区降级展示)。 */
export class TasksApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message)
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch(path, { credentials: 'same-origin', ...init })
  } catch (error) {
    throw new TasksApiError(0, error instanceof Error ? error.message : String(error))
  }
  const body: unknown = await response.json().catch(() => ({}))
  if (!response.ok) {
    const text = (body as { error?: string }).error
    throw new TasksApiError(response.status, text ?? `请求失败（${response.status}）`)
  }
  return body as T
}

/** 设置视图(admin;403/503 按 status 区分展示)。 */
export function fetchTasksSettings(): Promise<TasksSettingsView> {
  return call<TasksSettingsView>('/access/api/tasks/settings')
}

/** 会话角色面(登录即可;徽标 30s 缓存见 session-role.tsx)。 */
export function fetchTasksSessionRoles(): Promise<TasksSessionRoles> {
  return call<TasksSessionRoles & { ok: true }>('/access/api/tasks/session-roles')
}

/** 分块保存(块白名单/校验在 access 与 tasks face 两处;409 = 修订过期)。 */
export function saveTasksBlock(block: string, value: TasksSettings, revision: number): Promise<TasksSaveOk> {
  return call<TasksSaveOk>('/access/api/tasks/settings', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ block, value, revision }),
  })
}
