/**
 * 角色 prompt section 用例(R22 接线;2026-11-21 交付审计 §2.1 修复方案消费端):
 * role-prompt-section.spec.ts 钉住 **注册面**——Sessions.ensure 把装配层注入的
 * `rolePrompt(role)` 文本经该 agent 自己的 `agent.ctx.systemPrompt.section` 注册:
 * - 双角色各按其文本注册,name = `eterna-tasks:role-<role>`,additive order 0;
 * - 每 agent 恰一次:同一会话重复 ensure(重启 resume 同路径)不重复注册;
 * - provider 现算:section.text 是函数,装配时刻才调——注入值热改后下一次装配
 *   即生效(与 46 号 seedModel 的「每次 ensure 现读」同纪律,但要到装配时点);
 * - 缺席(undefined)= 不注册:会话随宿主 prompt(缺省降级形态);
 * - 结构面缺席/注册抛错时 fail-neutral:ensure 照常完成(权限/标题半边不受影响)。
 */
import { afterEach, beforeEach, expect, it } from 'vitest'
import { MAIN, startHost, type Host } from './fixtures/host.ts'

let h: Host
beforeEach(async () => { h = await startHost() })
afterEach(async () => { await h.stop() })

it('orchestrator:ensure 即在 agent.ctx 注册角色 section(name/order 0/组合文本含 dispatch 与 Policy)', async () => {
  h.rolePromptTexts.orchestrator = 'SHARED\n你是 orchestrator:只路由。\n\n## dispatch\n按工单路由。\n\n## Policy\nPolicy 版本 v1'
  const cwd = h.store.workspaceDir
  await h.sessions.ensure(MAIN, cwd, 'eterna-tasks orchestrator', 'orchestrator')
  const sections = h.roleSections.get(MAIN) ?? []
  expect(sections).toHaveLength(1)
  expect(sections[0]!).toMatchObject({ name: 'eterna-tasks:role-orchestrator', order: 0 })
  expect(sections[0]!.text).toContain('你是 orchestrator')
  expect(sections[0]!.text).toContain('## dispatch')
  expect(sections[0]!.text).toContain('## Policy')
})

it('worker:角色文本独立注册(name=eterna-tasks:role-worker,含 work 纪律)', async () => {
  h.rolePromptTexts.worker = 'SHARED\n你是 worker:做工单。\n\n## work\n只做工单范围内的事。'
  const cwd = h.store.workspaceDir
  await h.sessions.ensure('worker-r22', cwd, '工单标题', 'worker')
  const sections = h.roleSections.get('worker-r22') ?? []
  expect(sections).toHaveLength(1)
  expect(sections[0]!).toMatchObject({ name: 'eterna-tasks:role-worker', order: 0 })
  expect(sections[0]!.text).toContain('你是 worker')
  expect(sections[0]!.text).toContain('## work')
})

it('每 agent 恰一次:重复 ensure(resume 同路径)不重复注册;不同 agent 各自注册', async () => {
  const cwd = h.store.workspaceDir
  h.rolePromptTexts.worker = '你是 worker'
  await h.sessions.ensure('worker-once', cwd, '工单标题', 'worker')
  await h.sessions.ensure('worker-once', cwd, '工单标题', 'worker')
  await h.sessions.ensure('worker-once', cwd, '工单标题', 'worker')
  expect(h.roleSections.get('worker-once')).toHaveLength(1)
  // 另一个 worker 会话各得一次(WeakSet 按 agent 去重,非全局单次)。
  await h.sessions.ensure('worker-second', cwd, '工单标题', 'worker')
  expect(h.roleSections.get('worker-second')).toHaveLength(1)
})

it('provider 现算:注入值热改后,同一 section 的下一次装配即新文本(不需重注册)', async () => {
  h.rolePromptTexts.orchestrator = '版本 A'
  await h.sessions.ensure(MAIN, h.store.workspaceDir, 'eterna-tasks orchestrator', 'orchestrator')
  const raw = h.roleSectionRaw.get(MAIN)
  expect(raw).toBeDefined()
  expect(typeof raw!.text).toBe('function')
  expect((raw!.text as () => string)()).toBe('版本 A')
  // 热改(等价于设置面板改团队段/Policy 随 settings 变):同一 section 装配即新文本。
  h.rolePromptTexts.orchestrator = '版本 B(热改后)'
  expect((raw!.text as () => string)()).toBe('版本 B(热改后)')
})

it('preset 选组:ensure 把 host.presets[role] 传给 create(生产接线同款常量;R22 消费面)', async () => {
  const cwd = h.store.workspaceDir
  await h.sessions.ensure('worker-preset', cwd, '工单标题', 'worker')
  expect(h.selectedPresets.get('worker-preset')).toBe('eterna-tasks-worker')
  await h.sessions.ensure('orch-preset', cwd, 'eterna-tasks orchestrator', 'orchestrator')
  expect(h.selectedPresets.get('orch-preset')).toBe('eterna-tasks-orchestrator')
})

it('缺席降级:rolePrompt 缺席(生产装配未注入/降级形态)时 ensure 不注册任何 section', async () => {
  const cwd = h.store.workspaceDir
  await h.sessions.ensure(MAIN, cwd, 'eterna-tasks orchestrator', 'orchestrator')
  await h.sessions.ensure('worker-absent', cwd, '工单标题', 'worker')
  expect(h.roleSections.size).toBe(0)
  expect(h.permissionPresetBySession.get(MAIN)).toBe('workspace-write')
  expect(h.renamed.get(MAIN)).toBe('eterna-tasks orchestrator')
})

it('结构面缺席:假件 Agent 无 ctx 时 fail-neutral——ensure 照常完成', async () => {
  h.rolePromptTexts.orchestrator = 'SHARED'
  const agent = h.agents.get(MAIN)!
  delete (agent as unknown as { ctx?: unknown }).ctx
  await expect(h.sessions.ensure(MAIN, h.store.workspaceDir, 'eterna-tasks orchestrator', 'orchestrator')).resolves.toBeTruthy()
  expect(h.permissionPresetBySession.get(MAIN)).toBe('workspace-write')
  expect(h.renamed.get(MAIN)).toBe('eterna-tasks orchestrator')
  expect(h.roleSections.size).toBe(0)
})

it('注册抛错(同名 section 已在):吞掉并跳过,ensure 照常完成', async () => {
  const cwd = h.store.workspaceDir
  // 先以缺席注入建会话(agent 已存在、未注册);再置注入值并让 section 抛错
  // (模拟 dsh 同名守卫/宿主异常)——resume 路径的注册失败不阻断 ensure。
  await h.sessions.ensure('worker-throw2', cwd, '工单标题', 'worker')
  expect(h.roleSections.has('worker-throw2')).toBe(false)
  h.rolePromptTexts.worker = '你是 worker'
  h.agents.get('worker-throw2')!.ctx.systemPrompt.section.mockImplementation(() => { throw new Error('duplicate section') })
  await expect(h.sessions.ensure('worker-throw2', cwd, '工单标题', 'worker')).resolves.toBeTruthy()
  expect(h.permissionPresetBySession.get('worker-throw2')).toBe('workspace-write')
  expect(h.renamed.get('worker-throw2')).toBe('工单标题')
  expect(h.roleSections.has('worker-throw2')).toBe(false)
})
