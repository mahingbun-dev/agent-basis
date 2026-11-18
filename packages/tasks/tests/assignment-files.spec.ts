/**
 * worker 产出落 `.ticket/<id>/`、主 Session 读文件非读消息(35 号 A15 验收门禁的
 * assignment-files.spec;= G2-A6 前半;24 号 §5.5-R4;27 号 §2.1-3 subagent 输出落文件)。
 *
 * 判据(模拟宿主 fixture,34 号 §4-E 假件模式):
 * - 接受的工单目录派生在租户 realm 工作区下 `<workspace>/.ticket/<id>/`,worker session
 *   的 cwd 即该目录(R4 一工单一目录;A22「worker session 一律建在租户 realm 工作区内」);
 * - worker 把产出写进该目录后,主 Session 经 `readTicketFile` 读到文件内容——读取路径
 *   只碰文件系统,不经任何消息/回执通道(game of telephone 防线);
 * - Mandate 执行契约(assignment 文本)带 R2 门禁条款:ready 由门禁判定(G2-A4)。
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { GATE_CONTRACT_CLAUSE } from '../src/executor/gates.ts'
import { readTicketFile, ticketDir, TICKET_FILES } from '../src/executor/workspace.ts'
import { humanTrigger, startHost } from './fixtures/host.ts'

it('工单目录派生在租户 realm 工作区的 `.ticket/<id>/`,worker session 建在其中', async () => {
  const h = await startHost()
  try {
    const { ticket } = await h.accept(humanTrigger('1', '@bot 修回归'))
    expect(ticket.execution?.directory).toBe(join(h.store.workspaceDir, '.ticket', ticket.id))
    // launch 已排队并在Effects 静止后执行:worker session 的 cwd = R4 目录
    const agent = h.agents.get(`worker-${ticket.id}`)
    expect(agent?.cwd).toBe(join(h.store.workspaceDir, '.ticket', ticket.id))
  } finally { await h.stop() }
})

it('执行契约(R2 门禁条款)随 assignment 投给 worker:「ready=门禁通过」不可自述绕过', async () => {
  const h = await startHost()
  try {
    const { ticket, sessionId } = await h.accept(humanTrigger('2', '@bot 修回归'))
    expect(ticket.execution?.assignment).toContain(GATE_CONTRACT_CLAUSE)
    // 第一条投给 worker 的消息携带 assignment 文本(含契约条款)。
    const first = h.deliveries.mock.calls.map(([delivery]) => delivery)
      .find(delivery => delivery.sessionId === sessionId)
    expect(first?.text).toContain('readiness is validated, not self-reported')
  } finally { await h.stop() }
})

it('worker 产出写 `.ticket/<id>/`,主 Session 经读文件面取证据——不经消息通道', async () => {
  const h = await startHost()
  try {
    const { ticket } = await h.accept(humanTrigger('3', '@bot 出审查意见'))
    const directory = ticketDir(h.store.workspaceDir, ticket.id)
    mkdirSync(directory, { recursive: true })
    // 模拟 worker 在其工单目录写证据文件(27 号 §2.1-3:subagent 输出落文件系统)。
    writeFileSync(join(directory, TICKET_EVIDENCE), '结论:条款 4.2 风险中;证据 §4.2 原文\n', 'utf8')
    const deliveriesBefore = h.deliveries.mock.calls.length
    const content = await readTicketFile(h.store.workspaceDir, ticket.id, TICKET_EVIDENCE)
    // 读取只碰文件:投递面/回执面零扰动(读文件而非读消息的数据面判据)。
    expect(h.deliveries.mock.calls.length).toBe(deliveriesBefore)
    expect(h.channels.send).not.toHaveBeenCalled()
    expect(content).toContain('条款 4.2')
    expect(content).toContain('证据 §4.2')
  } finally { await h.stop() }
})

/** R4 evidence 产物文件名(workspace.ts TICKET_FILES.evidence)。 */
const TICKET_EVIDENCE = TICKET_FILES.evidence
