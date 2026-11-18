/**
 * [active-tickets] 活跃工单清单 section 用例(35 号 A24 验收门禁;33 号 §1.3 G2-A8 原文:
 * 「清单 ≤20 行(超出折叠 …+N more);[active-tickets] section 经 prompt section seam 注入、
 * pass 周期刷新(C6 拍板);体积受 model-surface 预算测试看护 → packages/tasks/tests/
 * active-tickets.spec.ts(含 model-surface 体积断言)」)。
 *
 * 断言面:
 * - 行渲染(28 号 §6 示例三行;35 号表⑥-2/3):一行一单 `T-xxxx 标题｜stage｜等谁`
 *   (id + 标题截断 + stage + 等谁,竖线分隔);「等谁」三样态——等 worker /
 *   等你回答（Attention #xxxx，已 Xh）/ 排队（n/m 槽)——与 waitsForPerson 可见化的
 *   「等你」(表⑥-4,28 §9);标题超 24 字符截断(34 §2.5「标题截断」);
 * - 上限 20 行,超出折叠 `…+N more, orchestrator_read tickets`(34 §2.5 折叠文案原文;
 *   降级态显式指引工具读取,不静默截断,表⑥-6);空活跃面 → 空文本(空段不组装);
 * - section 形态:name/order/interpolate:false(保真 `{{…}}` 字面);masterId 会话过滤
 *   fail-closed(主会话渲染,worker/不可归属面为空——28 §6「给主 Session 增加」);
 * - prompt section seam 注入(defineTasksPlugin + ctx.systemPrompt 机会读取;缺席静默)
 *   与 disposer 配逆;pass 周期刷新(缓存语义:写入后不过 pass 不更新——C6 拍板
 *   「清单是提示不是协议,秒级延迟无害」);
 * - 体积预算(28 §6 末段;G2-A8「含 model-surface 体积断言」):20 行满载渲染 ≤
 *   ACTIVE_TICKETS_BUDGET_CHARS(常量见下,≈实测满载基线 + 余量,SA model-surface
 *   "~5% above baseline" 惯例的本仓变体)。
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import type { AssembleContext } from '@deepseek-ai/dsh-system-prompt'
import { describe, expect, it } from 'vitest'
import type { Ticket } from '../src/core/index.ts'
import { defineTasksPlugin, createTasks } from '../src/plugin.ts'
import {
  ACTIVE_TICKETS_HEADING, ACTIVE_TICKETS_MAX_LINES, ACTIVE_TICKETS_SECTION_NAME, ACTIVE_TICKETS_SECTION_ORDER,
  ACTIVE_TICKETS_TITLE_MAX_CHARS, activeTicketsFoldLine, activeTicketsSection, renderActiveTickets,
  type ActiveTicketsRenderOptions, type ActiveTicketsSection,
} from '../src/session/sections.ts'
import type { TasksWorld } from '../src/plugin.ts'

/** PromptSection.text 为 `string | provider` 联合;本 section 恒为 provider,测试面收窄调用。 */
type Assembly = AssembleContext & { agent?: unknown }
/**
 * 测试桩的装配主体只给 id 形状(真实 AssembleContext.agent 为完整 Agent,SessionId 为
 * 品牌串);断言面只消费 agent 身份,桩形状经本函数单点收窄(unknown → Assembly)。
 */
const assemblyOf = (agent: unknown): Assembly => ({ agent }) as Assembly
const textOf = (section: ActiveTicketsSection, assembly?: Assembly): string =>
  typeof section.text === 'function' ? section.text(assembly ?? {}) : section.text

const BASE: Ticket = {
  id: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6', title: '合同审查', decisionId: 'd', realm: 'alice',
  mandate: { strength: 'explicit', policyVersion: 'v', realm: 'alice', basis: { via: 'listed' }, actor: { source: 'chat', id: 'u-alice' }, scope: '' },
  channels: [], assignments: [{ id: 'a', state: 'running', createdAt: '' }], inputs: [], undelivered: [],
  createdAt: '2026-09-09T00:00:00Z', updatedAt: '2026-09-09T00:00:00Z', origin: { triggerId: 'x', triggerIds: ['x'] },
}
/** 派生工单:id 位移成不同短形,title 覆写,其余按需。 */
const ticket = (n: number, overrides: Partial<Ticket> = {}): Ticket =>
  ({ ...BASE, id: BASE.id.slice(0, -1) + String(n), title: `工单 ${n}`, updatedAt: BASE.createdAt, ...overrides })

const AT = Date.parse('2026-09-09T00:00:00Z')
const at4h = (options: ActiveTicketsRenderOptions = {}): ActiveTicketsRenderOptions => ({ ...options, now: () => AT + 4.5 * 3_600_000 })

describe('[active-tickets] 行渲染(28 §6 示例三行;35 号表⑥-2/3)', () => {
  it('一行一单:id + 标题 + stage + 等谁,竖线分隔;working → 等 worker(示例第 1 行形态)', () => {
    expect(renderActiveTickets([ticket(1)], at4h())).toBe('[active-tickets]\nT-a1b2 工单 1｜working｜等 worker')
  })

  it('person/answer(Attention):等你回答（Attention #xxxx，已 Xh),X 自提问时刻起算(示例第 2 行形态)', () => {
    const asking = ticket(2, {
      title: '报价对比',
      attention: { id: 'fedcba9876543210fedcba9876543210', question: '预算上限?', triggerId: 't9' },
      inputs: [{ id: 'i', kind: 'trigger', triggerId: 't9', at: '2026-09-09T00:00:00Z', human: true }],
    })
    // 提问后 4.5h → floor 4h;无人消息在提问后到达(waitsForPerson 不干扰 answer 优先级)。
    expect(renderActiveTickets([asking], at4h())).toBe('[active-tickets]\nT-a1b2 报价对比｜person/answer｜等你回答（Attention #fedc，已 4h）')
  })

  it('working/queued:排队（n/m 槽),n=占用槽 m=上限(示例第 3 行形态);无槽位信息退「排队」', () => {
    const queued = ticket(3, { title: '活动排期', assignments: [] })
    expect(renderActiveTickets([queued], at4h({ maxWorkers: 4, usedSlots: 2 })))
      .toBe('[active-tickets]\nT-a1b2 活动排期｜working/queued｜排队（2/4 槽）')
    expect(renderActiveTickets([queued], at4h({ maxWorkers: 4, usedSlots: 9 })))
      .toContain('排队（4/4 槽）')
    expect(renderActiveTickets([queued], at4h())).toContain('｜排队')
  })

  it('blocked/failed 且 waitsForPerson → 等你(waitsForPerson 可见化,28 §9;35 号表⑥-4)', () => {
    const blocked = ticket(4, { assignments: [{ id: 'a', state: 'running', createdAt: '', report: { state: 'blocked', summary: '', at: '2026-09-09T00:00:00Z' } }] })
    expect(renderActiveTickets([blocked], at4h())).toContain('｜person/blocked｜等你')
  })

  it('已结束工单不入清单(活跃面);空活跃面 → 空文本(空段不组装)', () => {
    const ended = ticket(5, { ended: { at: '2026-09-09T01:00:00Z', by: 'human', outcome: 'stopped' } })
    expect(renderActiveTickets([ended], at4h())).toBe('')
    expect(renderActiveTickets([], at4h())).toBe('')
  })

  it('标题截断:超 24 字符截断加省略号(34 §2.5「标题截断」)', () => {
    const long = ticket(6, { title: '这是一个超过二十四字符宽度的相当长的工单标题需要被截断处理' })
    expect(long.title.length).toBeGreaterThan(ACTIVE_TICKETS_TITLE_MAX_CHARS)
    const line = renderActiveTickets([long], at4h()).split('\n')[1]!
    expect(line).toContain(`${long.title.slice(0, ACTIVE_TICKETS_TITLE_MAX_CHARS)}…`)
    expect(line).not.toContain(long.title.slice(0, ACTIVE_TICKETS_TITLE_MAX_CHARS + 1))
  })
})

describe('上限与折叠(28 §6「设上限(如 20 行)」;34 §2.5 折叠文案原文)', () => {
  it('恰 20 行以内不折叠;超出折 20 行 + 「…+N more, orchestrator_read tickets」', () => {
    const twenty = Array.from({ length: 20 }, (_, i) => ticket(i + 1))
    const rendered = renderActiveTickets(twenty, at4h())
    expect(rendered.split('\n')).toHaveLength(21) // 头行 + 20 行
    expect(rendered).not.toContain('more, orchestrator_read tickets')

    const twentyFive = Array.from({ length: 25 }, (_, i) => ticket(i + 1))
    const folded = renderActiveTickets(twentyFive, at4h())
    const lines = folded.split('\n')
    expect(lines).toHaveLength(22) // 头行 + 20 行 + 折叠行
    expect(lines[0]).toBe(ACTIVE_TICKETS_HEADING)
    expect(lines.at(-1)).toBe(activeTicketsFoldLine(5))
    expect(lines.at(-1)).toBe('…+5 more, orchestrator_read tickets')
    expect(ACTIVE_TICKETS_MAX_LINES).toBe(20)
  })
})

describe('section 形态与会话过滤(28 §6「给主 Session 增加」;masterId fail-closed)', () => {
  const source = (tickets: readonly Ticket[]): Parameters<typeof activeTicketsSection>[0] => ({
    tickets: () => tickets, maxWorkers: () => 4, usedSlots: () => 1, now: () => AT,
  })

  it('name/order/interpolate:false;refresh 重算缓存,currentText 与 text provider 一致', () => {
    const section = activeTicketsSection(source([ticket(1)]))
    expect(section.name).toBe(ACTIVE_TICKETS_SECTION_NAME)
    expect(section.order).toBe(ACTIVE_TICKETS_SECTION_ORDER)
    expect(section.interpolate).toBe(false)
    expect(typeof section.text).toBe('function')
    expect(section.currentText()).toContain('T-a1b2 工单 1｜working｜等 worker')
    expect(textOf(section)).toBe(section.currentText())
  })

  it('masterId 在场:主会话装配渲染,worker 会话与不可归属装配为空(fail-closed)', () => {
    const master = 'orchestrator-main'
    const scoped = activeTicketsSection({ ...source([ticket(1)]), masterId: () => master })
    expect(textOf(scoped, assemblyOf({ session: { id: master } }))).toContain('T-a1b2')
    expect(textOf(scoped, assemblyOf({ id: master }))).toContain('T-a1b2')
    expect(textOf(scoped, assemblyOf({ session: { id: 'worker-t1' } }))).toBe('')
    expect(textOf(scoped, assemblyOf({}))).toBe('')
    expect(textOf(scoped)).toBe('')
    // masterId 缺席:不做会话过滤(过滤交由注册面 scope,文件头「会话过滤」)。
    const unscoped = activeTicketsSection(source([ticket(1)]))
    expect(textOf(unscoped, assemblyOf({ session: { id: 'worker-t1' } }))).toContain('T-a1b2')
  })
})

describe('prompt section seam 注入与 pass 周期刷新(28 §6;C6 拍板)', () => {
  it('defineTasksPlugin:宿主 system-prompt 在场时经 systemPrompt.section 注入,disposer 配逆', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tasks-active-tickets-'))
    try {
      const registered: unknown[] = []
      const disposed: string[] = []
      const ctx = new Context()
      // 宿主 system-prompt 服务桩(production 由 @deepseek-ai/dsh-system-prompt 提供;
      // registerPromptSection seam 返回 effect disposer,memory dshHost 同款契约)。
      ctx.provide('systemPrompt', { section: (section: unknown): () => void => { registered.push(section); return () => { disposed.push('section') } } })
      const plugin = defineTasksPlugin({ tenantRoot: dir, realm: 'alice', passIntervalMs: 3_600_000 })
      const dispose = plugin.apply(ctx)
      expect(registered).toHaveLength(1)
      expect((registered[0] as { name: string }).name).toBe(ACTIVE_TICKETS_SECTION_NAME)
      // ctx.tasks 服务暴露同一 section(宿主装配自取面;刷新=pass)。
      const tasks: TasksWorld = (ctx as unknown as { tasks: TasksWorld }).tasks
      expect(tasks.activeTickets.name).toBe(ACTIVE_TICKETS_SECTION_NAME)
      dispose()
      expect(disposed).toEqual(['section']) // 关停配逆:section 注入面先撤
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  it('宿主 system-prompt 缺席:插件装载不受影响,section 不注册(注入面归宿主装配)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tasks-active-tickets-'))
    try {
      const ctx = new Context()
      const plugin = defineTasksPlugin({ tenantRoot: dir, realm: 'alice', passIntervalMs: 3_600_000 })
      expect(() => plugin.apply(ctx)).not.toThrow()
      expect((ctx as unknown as { tasks: TasksWorld }).tasks.activeTickets.currentText()).toBe('')
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  it('pass 周期刷新:写入后不过 pass 缓存不更新,一轮 pass 后重算(C6「秒级延迟无害」)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tasks-active-tickets-'))
    const runtime = createTasks({ tenantRoot: dir, realm: 'alice', passIntervalMs: 3_600_000 })
    try {
      expect(runtime.activeTickets.currentText()).toBe('')
      const storeTicket = ticket(1)
      runtime.store.tickets.save({ ...storeTicket, title: '合同审查' })
      // 缓存语义:落库后未过 pass,清单仍是旧值(装配面读缓存,零查询)。
      expect(runtime.activeTickets.currentText()).toBe('')
      runtime.pass()
      expect(runtime.activeTickets.currentText()).toBe('[active-tickets]\nT-a1b2 合同审查｜working｜等 worker')
      // 工单结束 → 下一轮 pass 后从清单消失(活跃面)。
      const live = runtime.store.tickets.get(storeTicket.id)!
      runtime.store.tickets.save({ ...live, ended: { at: '2026-09-09T01:00:00Z', by: 'human', outcome: 'stopped' } })
      runtime.pass()
      expect(runtime.activeTickets.currentText()).toBe('')
      // text provider 与缓存一致。
      expect(textOf(runtime.activeTickets)).toBe(runtime.activeTickets.currentText())
    } finally { runtime.dispose(); rmSync(dir, { recursive: true, force: true }) }
  })
})

describe('model-surface 体积预算(28 §6 末段;G2-A8「含 model-surface 体积断言」)', () => {
  /**
   * 20 行满载的字符预算(按字符;≈最坏行形态实测基线 + 余量,SA model-surface
   * "~5% above baseline" 惯例的本仓变体):每行 = 6(id)+1+24(标题截断)+1+≤16(stage)
   * +1+≤32(等谁)≈81 字符,20 行 + 头行 + 折叠行 ≤ 2048;收窄清单形态时应下调,
   * 上调必须是有意为之并在提交说明里给出理由(28 §6:清单行数随活跃工单线性增长,
   * 上限与预算看护即为防其无限生长)。
   */
  const ACTIVE_TICKETS_BUDGET_CHARS = 2048

  it('20 行满载(最长阶段/等谁形态)在预算内;预算常量不高于空清单形态的 40 倍(防呆)', () => {
    const worst = Array.from({ length: 20 }, (_, i) => ticket(i + 1, {
      title: '一二三四五六七八九十十一十二十三十四十五十六十七十八十九二十',
      attention: { id: 'fedcba9876543210fedcba9876543210', question: '?', triggerId: 't9' },
      inputs: [{ id: 'i', kind: 'trigger', triggerId: 't9', at: '2026-09-09T00:00:00Z', human: true }],
    }))
    const rendered = renderActiveTickets(worst, at4h({ maxWorkers: 16, usedSlots: 16 }))
    const firstLine = rendered.split('\n')[1]!
    expect(firstLine).toContain('person/answer')
    expect(firstLine).toContain('等你回答（Attention #fedc')
    expect(rendered.length, `${rendered.length} 字符(预算 ${ACTIVE_TICKETS_BUDGET_CHARS})`).toBeLessThanOrEqual(ACTIVE_TICKETS_BUDGET_CHARS)
  })
})
