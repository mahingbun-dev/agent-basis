/**
 * R4 工单工作区——`<realm 工作区>/.ticket/<id>/` 一工单一目录的产物布局与主 Session 读文件面
 * (35 号 A15;24 号 §5.5-R4 原文「`.ticket/<id>/` 写 progress/决策/evidence,主 Session 读文件
 * 而非读消息」)。
 *
 * 设计依据:24 §5.5-R4(Cognition:跨 agent 隐式决策冲突无解;Anthropic:subagent 输出落文件
 * 系统可避免「game of telephone」)、§5.2 表 Executor 行(不照搬 worktree);26 §4.1 deliverable
 * 段(交付物定义)与 27 §2.1-3(subagent 输出落文件);34 §2.4 workspace 行;35 号 A15 交付原文。
 *
 * 目录名以 24 §5.5-R4 原文 `.ticket/<id>/` 为准——34 号 §2.4 的 `.tickets/` 变体是同一设计文档
 * 内部笔误,35 号 §12-11 已登记,本文统一按 R4 原文实现,不自行裁定。
 *
 * ★产物文件名归属(35 号 §12-5 开放问题):`.ticket/<id>/` 必备产物的文件名与格式由领域包
 * (26 号声明段)定还是 tasks 内置默认 + 包覆盖——依赖 26 §7-1 五段 schema 拍板(G2-A18 占位)。
 * 本文件按「内置默认」落地 R4 点名的三类产物(progress/决策/evidence;英文文件名常量),领域包
 * 可经 gates.ts 的 `DeliverableSpec` 类型 seam 覆盖(`requiredFiles`),不预设 pack YAML 格式。
 *
 * 主 Session 读面:`readTicketFile` 供 A20 的 `orchestrator_read` 工具消费(34 §2.5 tools 行),
 * 以路径钳制(防目录穿越出工单目录)只读工单目录内文件——orchestrator 读文件不读消息。
 */
import { readFile } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'

/** R4 工单目录的一级目录名(24 §5.5-R4 原文 `.ticket/<id>/`;35 号 §12-11 勘误口径)。 */
export const TICKETS_DIR = '.ticket'

/**
 * 某工单的 R4 目录:`<workspace>/.ticket/<id>/`(executor/dsh.ts `ticketExecution` 的
 * `directory` 即由本函数派生;worker session 与全部产物文件都在其内)。
 */
export const ticketDir = (workspaceDir: string, ticketId: string): string => join(workspaceDir, TICKETS_DIR, ticketId)

/** R4 点名的三类产物(24 §5.5-R4:progress/决策/evidence 落文件)与其内置默认文件名。 */
export const TICKET_FILES = {
  /** 进展:worker 持续写入的 progress 台账。 */
  progress: 'progress.md',
  /** 决策:过程中做过的取舍与其理由(game of telephone 防线)。 */
  decision: 'decision.md',
  /** 证据:结论所依据的取证材料(可追溯)。 */
  evidence: 'evidence.md',
} as const
/** 三类产物的种类键。 */
export type TicketFileKind = keyof typeof TICKET_FILES

/** 某工单目录内一类产物文件的绝对路径(`kind` 为内置默认三类;任意文件名经 `custom`)。 */
export const ticketFile = (workspaceDir: string, ticketId: string, kind: TicketFileKind): string =>
  join(ticketDir(workspaceDir, ticketId), TICKET_FILES[kind])

/**
 * 主 Session 的工单文件读面(A20 `orchestrator_read` 的数据半边):读工单目录内 `name`
 * 文件的 UTF-8 内容。**只读文件不读消息**(24 §5.5-R4):主 Session 对 worker 产出的唯一
 * 正规读取路径。
 *
 * 路径钳制(防目录穿越):解析后的绝对路径必须仍落在该工单目录内,越界一律拒绝——
 * 与 A22「worker session 一律建在租户 realm 工作区内」同款 within-root 纪律。
 * @returns 文件内容;文件不存在时 undefined。
 * @throws `name` 越出工单目录时(目录穿越拒绝,不静默钳制)。
 */
export async function readTicketFile(workspaceDir: string, ticketId: string, name: string): Promise<string | undefined> {
  const root = resolve(ticketDir(workspaceDir, ticketId))
  const target = resolve(root, name)
  // resolve 后逐段比较前缀(resolve 已归一 `..`/符号段);`sep` 收尾防止 `x` 误配 `xy`。
  if (target !== root && !target.startsWith(root + sep)) throw new Error(`Ticket file path escapes the ticket directory: ${name}`)
  return await readFile(target, 'utf8').catch((error: unknown) => {
    if ((error as { code?: unknown }).code === 'ENOENT') return undefined
    throw error
  })
}
