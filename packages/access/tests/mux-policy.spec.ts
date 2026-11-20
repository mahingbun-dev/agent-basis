/**
 * T2(2026-11-11):mux 租户策略绑定——账本为唯一事实源。
 * alice 2 会话+1 工作区 → 1 GLOBAL + 2 session + 1 workspace 绑定;bob 0 资源 → 仅 GLOBAL。
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SessionService } from '../src/session.ts'
import { UserStore } from '../src/store.ts'
import { ADMIN_ONLY_STREAM_ACTIONS, ADMIN_ONLY_UNARY_ACTIONS, bindingsFor, GLOBAL_EVENT_ACTIONS, GLOBAL_STREAM_ACTIONS, GLOBAL_UNARY_ACTIONS, SESSION_EVENT_ACTIONS, SESSION_STREAM_ACTIONS, SESSION_UNARY_ACTIONS, TERMINAL_UNARY_ACTIONS, WORKSPACE_STREAM_ACTIONS, WORKSPACE_UNARY_ACTIONS, visibilityScopeOf } from '../src/mux.ts'

/** 非 admin 的全局一元动作 = 全员清单减去管理员专属 UI 门(T6.1 收窄面)。 */
const memberUnary = GLOBAL_UNARY_ACTIONS.filter(action => !ADMIN_ONLY_UNARY_ACTIONS.includes(action))

/** 管理员专属门(UI 一元门 + 系统 MCP 流门)统一视为收窄面。 */
const adminOnlyActions = [...ADMIN_ONLY_UNARY_ACTIONS, ...ADMIN_ONLY_STREAM_ACTIONS]

/** 内容绑定对比视图:剥掉管理员专属门,只比内容动作与资源(WS-C 零放宽口径)。 */
const contentView = (bindings: ReturnType<typeof bindingsFor>): unknown =>
  bindings.map(binding => ({
    ...binding,
    role: { ...binding.role, actions: binding.role.actions.filter(action => !adminOnlyActions.includes(action)) },
  }))

describe('T2:mux 策略绑定', () => {
  let dir: string
  let store: UserStore
  let session: SessionService
  let aliceId: number
  let bobId: number

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'eterna-mux-policy-'))
    store = new UserStore(join(dir, 'users.db'))
    session = new SessionService(Buffer.from('mux-secret-mux-secret-000000'))
    const alice = store.createUserWithSuffix({ account: 'alice', password: 'password8' })
    const bob = store.createUserWithSuffix({ account: 'bob', password: 'password8' })
    aliceId = alice.user.id
    bobId = bob.user.id
    store.recordSession('s-a1', aliceId, null)
    store.recordSession('s-a2', aliceId, null)
    store.recordWorkspace('w-a1', aliceId, join(dir, 'workspaces', 'alice'))
  })
  afterEach(() => {
    store.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('alice:GLOBAL+2 session+1 workspace,动作清单完整', () => {
    const deps = { store, session }
    const bindings = bindingsFor(deps, aliceId)
    expect(bindings).toHaveLength(4)
    const global = bindings.filter(b => b.resource.kind === 'global')
    expect(global).toHaveLength(1)
    // alice 默认 role=user:全局动作=全员清单减去管理员专属门(一元 UI 门 + 系统 MCP 流门)
    const memberStream = GLOBAL_STREAM_ACTIONS.filter(action => !ADMIN_ONLY_STREAM_ACTIONS.includes(action))
    expect(global[0]?.role.actions).toEqual([...memberStream, ...memberUnary, ...GLOBAL_EVENT_ACTIONS])
    const sessions = bindings.filter(b => b.resource.kind === 'session')
    expect(sessions.map(b => (b.resource as { id: string }).id).sort()).toEqual(['s-a1', 's-a2'])
    // 会话角色含 workspace/follow(workspace 视图 sessionIds 逐项 allows 用,见 mux.ts 注释)
    expect(sessions[0]?.role.actions).toEqual([
      ...SESSION_STREAM_ACTIONS, ...TERMINAL_UNARY_ACTIONS, ...WORKSPACE_STREAM_ACTIONS, ...SESSION_UNARY_ACTIONS, ...SESSION_EVENT_ACTIONS,
    ])
    // TERM-004(2026-11-20):终端六一元动作资源逐会话(agent lookup→session /
    // list 具名 sessionId),必须授在会话绑定——缺项=本人终端恒 no-allow;
    // 授 global 永不命中 sameResource(remote-access evaluate)。
    for (const action of TERMINAL_UNARY_ACTIONS) expect(sessions[0]?.role.actions).toContain(action)
    const workspaces = bindings.filter(b => b.resource.kind === 'workspace')
    expect(workspaces.map(b => (b.resource as { id: string }).id)).toEqual(['w-a1'])
    expect(workspaces[0]?.role.actions).toEqual([...WORKSPACE_STREAM_ACTIONS, ...WORKSPACE_UNARY_ACTIONS])
    // 防漂移:工作区行「+」是资源级门 useWorkspaceAccess(workspaceId,'session/create'),
    // 客户端 answer() 不落回 global 绑定——workspace 角色必须实名含 session/create,
    // 缺项=加号不渲染(2026-11-12 第三轮回归根因)。
    expect(workspaces[0]?.role.actions).toContain('session/create')
    // 防漂移:输入栏附件门是会话资源级门 useAccess('fileUploads/upload')
    // (InputBar.tsx:65),缺项=「+」菜单"文件"命令不渲染、粘贴/拖拽全拒
    // (2026-11-12 附件功能整体不可见根因)。
    expect(sessions[0]?.role.actions).toContain('fileUploads/upload')
  })

  it('bob:零资源 → 仅 GLOBAL(其余资源默认 deny)', () => {
    const deps = { store, session }
    const bindings = bindingsFor(deps, bobId)
    expect(bindings).toHaveLength(1)
    expect(bindings[0]?.resource.kind).toBe('global')
  })

  it('归属变更后重读即反映(账本实时,无缓存漂移)', () => {
    const deps = { store, session }
    expect(bindingsFor(deps, aliceId).filter(b => b.resource.kind === 'session')).toHaveLength(2)
    store.recordSession('s-a3', aliceId, null)
    expect(bindingsFor(deps, aliceId).filter(b => b.resource.kind === 'session')).toHaveLength(3)
  })

  // ── WS-C(37 号 M-2):角色感知 + 可见性谓词 + 零放宽不变式 ──────────────────

  it('WS-C ①:visibilityScopeOf 三档映射 + 未知值 fail-closed 判 self', () => {
    expect(visibilityScopeOf('user')).toBe('self')
    expect(visibilityScopeOf('approver')).toBe('tenant-pending')
    expect(visibilityScopeOf('admin')).toBe('all')
    expect(visibilityScopeOf('nobody' as never)).toBe('self')
  })

  it('WS-C ②:approver 与 user/admin 的 bindingsFor 内容面逐项全等(零放宽不变式;唯一豁免=管理员专属 UI 门收窄)', () => {
    const deps = { store, session }
    // 同一资源集跨三角色轮转对比(approver 化 → admin 化 → 回 user),逐项 deep-equal。
    // T6.1 后 admin 多出 ADMIN_ONLY_UNARY_ACTIONS(插件页整页门),只收窄不放宽——
    // 内容面(流动作/会话/工作区)三方仍逐项全等,剥离 UI 门后比较。
    const asUser = bindingsFor(deps, aliceId)
    store.setUserRole(aliceId, 'approver')
    const asApprover = bindingsFor(deps, aliceId)
    store.setUserRole(aliceId, 'admin')
    const asAdmin = bindingsFor(deps, aliceId)
    store.setUserRole(aliceId, 'user')
    expect(contentView(asApprover)).toEqual(contentView(asUser))
    expect(contentView(asAdmin)).toEqual(contentView(asUser))
    // admin 专属面明示:仅 admin 含插件页整页门,且绝不额外获得任何内容动作
    const actionsOf = (bindings: ReturnType<typeof bindingsFor>) => (bindings.find(b => b.resource.kind === 'global') as { role: { actions: readonly string[] } }).role.actions
    expect(actionsOf(asAdmin)).toEqual([...GLOBAL_STREAM_ACTIONS, ...GLOBAL_UNARY_ACTIONS, ...GLOBAL_EVENT_ACTIONS])
    expect(actionsOf(asApprover)).not.toContain('pluginManager/listBundles')
    expect(actionsOf(asUser)).not.toContain('pluginManager/listBundles')
    // rc.5 B14:系统层 MCP watch 仅 admin
    expect(actionsOf(asAdmin)).toContain('mcpManager/watch')
    expect(actionsOf(asApprover)).not.toContain('mcpManager/watch')
    expect(actionsOf(asUser)).not.toContain('mcpManager/watch')
    // rc.5 B14:系统层 MCP restart/probe(一元管理门)仅 admin;普通用户只走个人层
    for (const action of ['mcpManager/restart', 'mcpManager/probe']) {
      expect(actionsOf(asAdmin), `${action} 应下发给 admin`).toContain(action)
      expect(actionsOf(asApprover), `${action} 不应下发给审批人`).not.toContain(action)
      expect(actionsOf(asUser), `${action} 不应下发给普通用户`).not.toContain(action)
    }
    // 不变量明示:任何角色档都只见本人资源(跨租户待人项是工作台数据面,不经 mux 内容绑定)
    const stranger = store.createUserWithSuffix({ account: 'stranger', password: 'password8' }).user
    store.recordSession('s-stranger', stranger.id, null)
    store.setUserRole(aliceId, 'approver')
    const approverBindings = bindingsFor(deps, aliceId)
    expect(approverBindings.filter(b => b.resource.kind === 'session').map(b => (b.resource as { id: string }).id))
      .not.toContain('s-stranger')
  })

  it('T6.1 管理员专属 UI 门:pluginManager/listBundles 仅 admin 下发(插件页整页门),清单 ⊆ 全员门', () => {
    const deps = { store, session }
    const unaryOf = (userId: number) => (bindingsFor(deps, userId)
      .find(b => b.resource.kind === 'global') as { role: { actions: readonly string[] } }).role.actions
    expect(ADMIN_ONLY_UNARY_ACTIONS).toContain('pluginManager/listBundles')
    // 清单纪律:必须是全员门的子集(只收窄,不得引入清单外动作)
    for (const action of ADMIN_ONLY_UNARY_ACTIONS) expect(GLOBAL_UNARY_ACTIONS).toContain(action)
    for (const action of ADMIN_ONLY_STREAM_ACTIONS) expect(GLOBAL_STREAM_ACTIONS).toContain(action)
    // 管理员专属门不得含任何会话/工作区资源动作(只谈全局面)
    for (const action of ADMIN_ONLY_STREAM_ACTIONS) expect(SESSION_STREAM_ACTIONS).not.toContain(action)
    // 非 admin 两档(审批人同 user)不下发
    const bobRole = store.getUserById(bobId)!.role
    expect(bobRole).toBe('user')
    expect(unaryOf(bobId)).not.toContain('pluginManager/listBundles')
    store.setUserRole(bobId, 'approver')
    expect(unaryOf(bobId)).not.toContain('pluginManager/listBundles')
    store.setUserRole(bobId, 'admin')
    expect(unaryOf(bobId)).toContain('pluginManager/listBundles')
    store.setUserRole(bobId, 'user')
    // 其余全员门不受影响(设置弹窗/新建会话/日程入口)
    for (const action of ['settings/describe', 'session/create', 'schedule/list']) {
      expect(unaryOf(bobId)).toContain(action)
    }
  })

  it('WS-C ③:角色动态性——setUserRole 后再调 bindings 回调,绑定与谓词随新角色(即时生效 node 面)', () => {
    const deps = { store, session }
    // 与 installMuxIsolation 的注册形态同构:回调内现查(principal → bindings),
    // 不在安装时缓存角色(G2-C5;上游每 decide/allows 直调回调——TS-37-1 已核实)
    const policy = { bindings: (principal: { userId: number }) => bindingsFor(deps, principal.userId) }
    expect(visibilityScopeOf(store.getUserById(bobId)!.role)).toBe('self')
    expect(policy.bindings({ userId: bobId })).toHaveLength(1) // bob 零资源 → 仅 GLOBAL
    store.setUserRole(bobId, 'approver')
    store.recordSession('s-bob', bobId, null)
    // 换角色+记账后不重建策略、不重装 Peer——下一次回调调用即见新账本与谓词
    const after = policy.bindings({ userId: bobId })
    expect(after.filter(b => b.resource.kind === 'session').map(b => (b.resource as { id: string }).id)).toEqual(['s-bob'])
    expect(visibilityScopeOf(store.getUserById(bobId)!.role)).toBe('tenant-pending')
    store.setUserRole(bobId, 'user')
    expect(visibilityScopeOf(store.getUserById(bobId)!.role)).toBe('self')
    expect(policy.bindings({ userId: bobId })).toEqual(after) // 内容绑定不随档位变化(零放宽不变式)
  })
})
