/**
 * M4 实接投影测试的 tasks 真实装配 fixture(live-events.spec.ts 的 boot 面同款
 * 本地共享;tests/fixtures/tasks host 全量模拟宿主过重,投影测试只需要
 * store→engine 全链 + 可控 stub assessor/executor)。
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect } from 'vitest'
import { createTasks, type SourceScope, type TasksRuntime, type Trigger } from '@eterna/tasks'

/** test Source 监听范围(tasks fixtures/host.ts 同款口径)。 */
export const SOURCE = 'test'
export const MEMBER = 'u-alice'

export const testScope: SourceScope = {
  scope: ({ source }: { source: string }) =>
    source === SOURCE ? { listened: true, observed: true, row: 'main' } : { listened: false, reason: 'not_listened' },
}

/** 每测试一个临时租户根(用例 beforeEach/afterEach 配对调用)。 */
export const makeTenantRoot = (): string => mkdtempSync(join(tmpdir(), 'workbench-live-sections-'))
export const dropTenantRoot = (root: string): void => { rmSync(root, { recursive: true, force: true }) }

/** 真实装配 tasks 运行时(长 pass 周期,手动 pass 驱动;stub assessor/executor)。 */
export const bootTasks = (root: string): TasksRuntime =>
  createTasks({ tenantRoot: root, realm: 'alice', passIntervalMs: 3_600_000, scope: testScope })

/** 人消息触发器(tasks fixtures/host.ts humanTrigger 同款;id 数字位作时间偏移)。 */
export const humanTrigger = (id: string, text: string): Trigger => ({
  id, source: SOURCE, threads: [{ source: SOURCE, id: `thread-${id}` }], actor: { source: SOURCE, id: MEMBER },
  human: true, addressed: 'mention', at: new Date(Date.parse('2026-09-09T00:00:00Z') + Number(id) * 1000).toISOString(),
  text, meta: {},
})

/** 名单放行 MEMBER(settings.settings 面直写;policy gate 查 settings 自带名单)。 */
export const allowMember = (runtime: TasksRuntime): void => {
  runtime.store.saveSettings({ policy: { sources: { [SOURCE]: { allowed: [{ id: MEMBER, name: 'Alice' }] } } } })
}

/**
 * 开一张工单(触发→Eval→显式 accept,R3 四要素齐备;plugin-boot.spec 同款)。
 * @returns 工单 id。
 */
export const openTicket = (runtime: TasksRuntime, triggerId: string): string => {
  allowMember(runtime)
  const trigger = humanTrigger(triggerId, '@bot 做点事')
  expect(runtime.engine.receive(trigger)).toBe('stored')
  runtime.pass()
  // A19 后 assessor 为 MasterAssessor:候选经 Engine 的 candidate 面读取(tasks domain-events.spec 同款)
  const candidate = runtime.engine.candidate(trigger.id)
  expect(candidate).toBeDefined()
  runtime.engine.candidateDelivered(candidate!.evalId)
  return runtime.engine.decide(trigger.id, {
    kind: 'accept',
    title: '做点事',
    scope: 'Do the work.',
    reason: 'explicit request',
    delegation: { objective: 'Do it.', outputFormat: 'A summary.', toolGuidance: 'Use read tools.', taskBoundaries: 'Only the request.' },
  }).ticketId!
}

/** T8 冲突计数查询面(LiveSectionsTasks 形状;store 只读直连)。 */
export const sectionsTasksOf = (runtime: TasksRuntime): {
  db: { prepare(sql: string): { all(...parameters: unknown[]): unknown[] } }
} => ({
  db: { prepare: (sql: string) => runtime.store.db.prepare(sql) },
})
