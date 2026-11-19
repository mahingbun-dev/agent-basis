/**
 * 角色模型播种用例(46 号《角色模型选择策略》;A25 role-models 的消费端验收):
 * role-models.spec.ts 钉住 **配置面**(eval.model/executor.model 的 schema 与缺省 null),
 * 本文件钉住 **消费面**——Sessions.ensure 按角色把 settings 里的模型经宿主
 * `agent.model.select` 播到会话下一步:
 * - 未配置(null)= 不播种:会话随宿主默认模型(UI 里选的默认),任何 select 都不发生;
 * - 已配置 = 覆写:orchestrator 走 eval.model、worker 走 executor.model,三键
 *   (provider/model/reasoningEffort)原样落定,首轮第一步即捕获;
 * - 每次 ensure 现读:复用(resume)路径同样重播,设置热改后下一次 ensure 生效;
 * - 结构面缺席/select 抛错时 fail-neutral:不阻断 ensure(权限/标题半边照旧)。
 */
import { afterEach, beforeEach, expect, it } from 'vitest'
import { MAIN, humanTrigger, startHost, type Host } from './fixtures/host.ts'

let h: Host
beforeEach(async () => { h = await startHost() })
afterEach(async () => { await h.stop() })

it('未配置角色模型:ensure 不播种(随宿主会话默认),不产生任何 model.select', async () => {
  const cwd = h.store.workspaceDir
  await h.sessions.ensure(MAIN, cwd, 'eterna-tasks orchestrator', 'orchestrator')
  await h.sessions.ensure('worker-none', cwd, '工单标题', 'worker')
  expect(h.modelSelections.size).toBe(0)
  expect(h.agents.get(MAIN)!.model.select).not.toHaveBeenCalled()
})

it('orchestrator 角色:eval.model 经 agent.model.select 落到主会话下一步,三键原样(含 reasoningEffort)', async () => {
  const model = { provider: 'pi-ai', model: 'deepseek-pro', reasoningEffort: 'high' }
  h.roleModels.orchestrator = model
  await h.sessions.ensure(MAIN, h.store.workspaceDir, 'eterna-tasks orchestrator', 'orchestrator')
  // 主会话(ensure 前已由宿主建立)同样播种——复用/重启路径与新建路径同走 seedModel。
  expect(h.modelSelections.get(MAIN)).toEqual(model)
  expect(h.agents.get(MAIN)!.model.select).toHaveBeenCalledTimes(1)
})

it('worker 角色:executor.model 在工单派发建 worker session 时播种(真实 dispatch 路径)', async () => {
  const model = { provider: 'pi-ai', model: 'glm-flash' }
  h.roleModels.worker = model
  // orchestrator 未配置:eval.model=null,主会话不受 worker 配置影响。
  const { sessionId } = await h.accept(humanTrigger('1', '@bot 修一下回归'))
  expect(h.modelSelections.get(sessionId)).toEqual(model)
  expect(h.modelSelections.get(MAIN)).toBeUndefined()
})

it('每次 ensure 现读:设置热改后同一会话的下一次 ensure 即换档(不需要重启)', async () => {
  const cwd = h.store.workspaceDir
  h.roleModels.worker = { provider: 'pi-ai', model: 'model-a' }
  await h.sessions.ensure('worker-hot', cwd, '工单标题', 'worker')
  expect(h.modelSelections.get('worker-hot')).toEqual({ provider: 'pi-ai', model: 'model-a' })
  // 热改(等价于 orchestrator_settings_save 改 executor 块):下一次 ensure 现读新值。
  h.roleModels.worker = { provider: 'pi-ai', model: 'model-b', reasoningEffort: 'low' }
  await h.sessions.ensure('worker-hot', cwd, '工单标题', 'worker')
  expect(h.modelSelections.get('worker-hot')).toEqual({ provider: 'pi-ai', model: 'model-b', reasoningEffort: 'low' })
  expect(h.agents.get('worker-hot')!.model.select).toHaveBeenCalledTimes(2)
})

it('结构面缺席或 select 抛错:fail-neutral——ensure 照常完成,权限/标题半边不受影响', async () => {
  const cwd = h.store.workspaceDir
  h.roleModels.orchestrator = { provider: 'pi-ai', model: 'missing-surface' }
  // 假件 Agent 无 model 面:跳过播种,ensure 不抛。
  const agent = h.agents.get(MAIN)!
  delete (agent as unknown as { model?: unknown }).model
  await expect(h.sessions.ensure(MAIN, cwd, 'eterna-tasks orchestrator', 'orchestrator')).resolves.toBeTruthy()
  expect(h.permissionPresetBySession.get(MAIN)).toBe('workspace-write')
  expect(h.renamed.get(MAIN)).toBe('eterna-tasks orchestrator')
  expect(h.modelSelections.size).toBe(0)

  // select 抛错:吞掉并 warn,ensure 照常完成。
  await h.sessions.ensure('worker-throw', cwd, '工单标题', 'worker')
  h.roleModels.worker = { provider: 'pi-ai', model: 'throwing' }
  h.agents.get('worker-throw')!.model.select.mockImplementation(() => { throw new Error('select boom') })
  await expect(h.sessions.ensure('worker-throw', cwd, '工单标题', 'worker')).resolves.toBeTruthy()
  expect(h.permissionPresetBySession.get('worker-throw')).toBe('workspace-write')
})
