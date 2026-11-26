/**
 * Skill 管理客户端 API:`/api/skills-manage/*` 七个端点的同源封装。
 *
 * 服务端契约见 `skills-routes.ts`:全部 POST + RPC 信封(裸 body 会 400);
 * 视图不含磁盘路径与正文,正文只在 read/save/install 的显式响应里出现。
 * 个人作用域由服务端从 cookie 会话解析账号,客户端不传账号。
 */
import { postRpc, type RpcResult } from './rpc.ts'

export type SkillScopeValue = 'personal' | 'shared'

/** 卡片视图(与服务端 `SkillItem` 同构)。 */
export interface SkillItemView {
  readonly scope: SkillScopeValue
  readonly name: string
  readonly description: string
  readonly whenToUse?: string
  readonly enabled: boolean
  /** form / upload-md / upload-zip / installed(旧数据)。 */
  readonly origin: string
  readonly files: number
  readonly bytes: number
  readonly updatedAt: number
}

export interface SkillListView {
  readonly items: readonly SkillItemView[]
  /** 个人技能上限(服务端 SKILL_PERSONAL_MAX,当前 32)。 */
  readonly personalLimit: number
  /** 共享技能上限(服务端 SKILL_SHARED_MAX,当前 64)。 */
  readonly sharedLimit: number
  /** 非 admin 只读共享技能;admin 无此字段。 */
  readonly sharedReadOnly?: boolean
}

export interface SkillReadView {
  readonly item: SkillItemView
  readonly markdown: string
}

export interface SkillMutationView {
  readonly item: SkillItemView
}

/** 保存:name 缺省=新建(名称取 frontmatter);给了 name=编辑且名称必须一致。 */
export const skillsApi = {
  list: (): Promise<RpcResult<SkillListView>> =>
    postRpc<SkillListView>('/api/skills-manage/list'),
  read: (scope: SkillScopeValue, name: string): Promise<RpcResult<SkillReadView>> =>
    postRpc<SkillReadView>('/api/skills-manage/read', { scope, name }),
  save: (scope: SkillScopeValue, markdown: string, name?: string): Promise<RpcResult<SkillMutationView>> =>
    postRpc<SkillMutationView>('/api/skills-manage/save', {
      scope,
      markdown,
      ...(name === undefined ? {} : { name }),
    }),
  installMd: (scope: SkillScopeValue, content: string): Promise<RpcResult<SkillMutationView>> =>
    postRpc<SkillMutationView>('/api/skills-manage/install-md', { scope, content }),
  installZip: (scope: SkillScopeValue, dataBase64: string): Promise<RpcResult<SkillMutationView>> =>
    postRpc<SkillMutationView>('/api/skills-manage/install-zip', { scope, dataBase64 }),
  toggle: (scope: SkillScopeValue, name: string, enabled: boolean): Promise<RpcResult<SkillMutationView>> =>
    postRpc<SkillMutationView>('/api/skills-manage/toggle', { scope, name, enabled }),
  remove: (scope: SkillScopeValue, name: string): Promise<RpcResult<{ readonly ok: boolean }>> =>
    postRpc<{ readonly ok: boolean }>('/api/skills-manage/delete', { scope, name }),
}

/** 失败帧的展示文案(服务端 message 优先,其次调用方给的兜底)。 */
export function skillFailureMessage(
  result: { readonly error?: { readonly message?: string } | undefined },
  fallback: string,
): string {
  const message = result.error?.message
  return message === undefined || message === '' ? fallback : message
}
