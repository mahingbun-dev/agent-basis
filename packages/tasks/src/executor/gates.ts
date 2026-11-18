/**
 * R2 分层门禁——deliverable 结构校验每单必跑 + 金集 replay 仅发布门禁与高风险抽样触发
 * (35 号 A15;24 号 §5.5-R2「`ready` 必须过门禁,worker 自述作废」;24a 拍板记录·A2 分层验收;
 * 26 §7-2 分层建议经 A2 拍板采纳;33 号 §1.3 G2-A4 全条)。
 *
 * 分层(24a A2 拍板原文):
 * - **结构校验层**:deliverable 结构校验纯函数,**每单必跑**(纯程序,近零成本)——不过则记
 *   `failed('gate:structure')`(35 号 A15 交付原文),缺段不 ready;
 * - **金集 replay 层**:仅**发布门禁**全跑(pack 流水线 `dsh-evals run --adapter replay`,即
 *   G2-A4② 判据命令)+ 运行时对**高风险工单抽样**(settings.gates.highRiskRules 命中其
 *   Mandate basis.rules 的工单;触发配置入库且不可被 worker 自述绕过——G2-A4)。
 *
 * 「ready=门禁通过」写进 Mandate 执行契约:executor/dsh.ts 的 `ticketExecution` 把
 * `GATE_CONTRACT_CLAUSE` 追加进 assignment 文本,worker 侧自述 ready 不作废门禁判定。
 *
 * ★执行面接线点:本文件的 `TicketGates.report` 是 worker `ready` 报告的唯一收口——35 号 A20
 * 的 worker `report` 工具调用它(A9 交付原文「ready 报告在 Engine 内部不改,门禁挂 executor 侧」);
 * 结构校验不过即以 `failed('gate:structure')` 记账,ready 永远不经未校验路径落库。
 *
 * ★replay 适配点(24a A2;35 号 A15):`ReplayGate` 端口的 glue 适配器调 `@eterna/evolve`
 * gates 的 replay 适配器(`runGate1`→`runPack adapterId='replay'`);本包不 import evolve——
 * 接线经端口注入(34 号 §1 依赖方向行,channels/allowed 同款纪律)。
 *
 * ★deliverable schema 归属(35 号 §12-5;26 §7-1 待拍板):`.ticket/<id>/` 必备产物的文件名
 * 与格式未拍板,本文件以 `DeliverableSpec` 类型 seam 钉住消费面形状、内置 R4 三产物默认
 * (workspace.ts `TICKET_FILES`),领域包覆盖经装配端口注入;**不预设 pack YAML 格式**。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Ticket, WorkerReport } from '../core/index.ts'
import type { EngineForExecutor } from '../core/index.ts'
import { ticketDir, TICKET_FILES } from './workspace.ts'

/** 结构门不过时 `failed` 报告携带的缘由标记(35 号 A15 交付原文 `failed('gate:structure')`)。 */
export const GATE_STRUCTURE_REASON = 'gate:structure'

/** deliverable 的单文件要求:必备文件名 + 可选的必备段(段 = 文件中的必含小节)。 */
export interface DeliverableFileSpec {
  /** 工单目录内相对路径(如 `progress.md`)。 */
  readonly file: string
  /**
   * 必含段名清单(26 §4.1 deliverable 段「报告结构 / 必含字段」的消费面;缺段不 ready)。
   * 段匹配语义 = 该文件中存在以 `## <段名>` 起头的行(内置默认的 Markdown 结构;格式细节
   * 待 G2-A18 拍板后由领域包覆盖)。
   */
  readonly sections?: readonly string[]
}

/**
 * 一次工单的 deliverable 结构定义(消费面形状,类型 seam):领域包 deliverable 段(26 §4.1)
 * 经装配端口供给,缺省用 R4 三产物默认。schema 未拍板(G2-A18 占位)前不预设 YAML 格式。
 */
export interface DeliverableSpec {
  readonly files: readonly DeliverableFileSpec[]
}

/** 内置默认 deliverable:R4 点名的 progress/决策/evidence 三产物非空即可(24 §5.5-R4)。 */
export const DEFAULT_DELIVERABLE_SPEC: DeliverableSpec = {
  files: [
    { file: TICKET_FILES.progress },
    { file: TICKET_FILES.decision },
    { file: TICKET_FILES.evidence },
  ],
}

/** 一条结构门违例:哪个文件、什么问题(缺文件/空文件/缺段)。 */
export interface GateFinding {
  readonly file: string
  readonly problem: 'missing' | 'empty' | 'section'
  readonly section?: string
}

/**
 * deliverable 结构校验**纯函数**(24a A2「纯程序,近零成本」):对 `read(file)` 取到的内容
 * 逐文件断言存在、非空、必含段齐备;零 I/O——磁盘面经 `ticketFileReader` 适配器注入。
 * @returns 全部违例;空数组即过门禁。
 */
export function checkDeliverable(read: (file: string) => string | undefined, spec: DeliverableSpec): GateFinding[] {
  const findings: GateFinding[] = []
  for (const { file, sections } of spec.files) {
    const content = read(file)
    if (content === undefined) { findings.push({ file, problem: 'missing' }); continue }
    if (!content.trim()) { findings.push({ file, problem: 'empty' }); continue }
    for (const section of sections ?? []) {
      if (!content.split('\n').some(line => line.trim() === `## ${section}`)) findings.push({ file, problem: 'section', section })
    }
  }
  return findings
}

/** 给 worker 的结构门违例清单文本(failed 摘要用;逐条可执行——缺什么补什么)。 */
export const formatFindings = (findings: readonly GateFinding[]): string =>
  findings.map(finding => finding.problem === 'missing' ? `${finding.file} is missing`
    : finding.problem === 'empty' ? `${finding.file} is empty`
      : `${finding.file} lacks the required section "${finding.section}"`).join('; ')

/** 结构门的内容读取适配器:工单目录内文件的同步读取;不存在返回 undefined。 */
export function ticketFileReader(workspaceDir: string, ticketId: string): (file: string) => string | undefined {
  const directory = ticketDir(workspaceDir, ticketId)
  return (file: string): string | undefined => {
    try { return readFileSync(join(directory, file), 'utf8') }
    catch { return undefined }
  }
}

/**
 * 高风险抽样判定(24a A2「金集 replay 仅发布门禁与高风险抽样触发」):工单的 Mandate
 * basis.rules(settings.gates.highRiskRules 中 hitl.yaml R3 红线规则 id,26 §4.1)命中任一
 * 即抽中;名单为空 = 不抽样。纯函数、确定性——抽样面可审计,不掷骰子。
 */
export function sampleReplay(ticket: Pick<Ticket, 'mandate'>, highRiskRules: readonly string[]): boolean {
  const matched = ticket.mandate.basis.rules ?? []
  return highRiskRules.some(rule => matched.includes(rule))
}

/**
 * 金集 replay 端口(24a A2;35 号 A15):运行时高风险抽样触发的一次回放。glue 适配器调
 * `@eterna/evolve` gates 的 replay 适配器(`runGate1`→`runPack adapterId='replay'`);
 * 发布门禁全跑同样经它(全跑 = 不抽样、逐单触发,或离线流水线直跑 dsh-evals)。
 */
export interface ReplayGate {
  run(options: { packDir: string; subset?: string }): Promise<{ pass: boolean; detail: string }>
}

/** 端口未接线时的 replay 面(A21 UNWIRED_CHANNELS 同款):如实报 not-wired,不放行也不误报失败。 */
export const UNWIRED_REPLAY_GATE: ReplayGate = {
  run: (): Promise<{ pass: boolean; detail: string }> => Promise.resolve({ pass: false, detail: 'replay gate not wired(装配面未注入 ReplayGate 适配器)' }),
}

/**
 * R2 门禁执行契约条款(24 §5.5-R2「『ready=门禁通过』写进 Mandate 执行契约,不可被 worker
 * 自述绕过」——G2-A4):executor/dsh.ts `ticketExecution` 把它追加进每张工单的 assignment
 * 文本。与 assignment 其余文本同语言(模型面英文;A23 中文化时随 prompts 一并本地化)。
 */
export const GATE_CONTRACT_CLAUSE = '\n\nGate contract: readiness is validated, not self-reported. Before reporting ready, write the required '
  + 'ticket files (progress, decisions, evidence) into this ticket directory — the orchestrator checks the deliverable structure and only a '
  + 'passing gate makes ready count; a failed check records the ticket as failed (gate:structure). Golden-set replay applies at the release '
  + 'gate and to sampled high-risk tickets, not to your self-assessment.'

/**
 * 一张工单的门禁记账结果:`ready` 报告过门禁后的落库去向。
 */
export type GateReportResult =
  | { readonly gated: false; readonly ticket: ReturnType<EngineForExecutor['report']> }
  | { readonly gated: true; readonly passed: true; readonly ticket: ReturnType<EngineForExecutor['report']> }
  | { readonly gated: true; readonly passed: false; readonly findings: readonly GateFinding[]; readonly ticket: ReturnType<EngineForExecutor['report']> }

/**
 * 工单门禁——R2 结构校验的 executor 侧收口(35 号 A15;A9「门禁挂 executor 侧」)。
 *
 * `report()` 拦截 worker 的 `ready` 报告:先跑结构校验(每单必跑,不分档),过了才以 ready
 * 落库;不过即以 `failed('gate:structure')` 落库,ready 永不经未校验路径写进 Engine——
 * worker 自述绕不过(24 §5.5-R2)。其余五态报告原样放行(门禁只判 ready)。
 *
 * ★接线点:35 号 A20 的 worker `report` 工具以本类收口;A22 装配替换 StubExecutor 后,
 * 高风险抽样可经 `sampled()` + 注入的 `ReplayGate` 触发回放(结果只作门禁记账,不改报告状态)。
 */
export class TicketGates {
  private readonly spec: DeliverableSpec
  private readonly highRiskRules: readonly string[]
  private readonly replay: ReplayGate | undefined
  constructor(options: { spec?: DeliverableSpec; highRiskRules?: readonly string[]; replay?: ReplayGate } = {}) {
    this.spec = options.spec ?? DEFAULT_DELIVERABLE_SPEC
    this.highRiskRules = options.highRiskRules ?? []
    this.replay = options.replay
  }
  /** 该工单是否抽中金集 replay(高风险抽样判定;发布门禁全跑由 pack 流水线与适配器承担)。 */
  sampled(ticket: Pick<Ticket, 'mandate'>): boolean { return sampleReplay(ticket, this.highRiskRules) }
  /** 触发一次金集 replay(已注入适配器时);返回其判定,未注入返回 undefined(如实不误报)。 */
  replayOnce(ticket: Pick<Ticket, 'mandate'>, packDir: string): Promise<{ pass: boolean; detail: string } | undefined> {
    if (!this.sampled(ticket) || this.replay === undefined) return Promise.resolve(undefined)
    return this.replay.run({ packDir })
  }
  /**
   * worker 报告的唯一收口:`ready` 先过结构门,其余五态原样落库。
   * @param io 落库面(Engine 的 report 命令)与工单目录解析(workspaceDir——realm 工作区)。
   */
  report(ticketId: string, report: WorkerReport,
    io: { engine: Pick<EngineForExecutor, 'report'>; workspaceDir: string }): GateReportResult {
    if (report.state !== 'ready') return { gated: false, ticket: io.engine.report(ticketId, report) }
    const findings = checkDeliverable(ticketFileReader(io.workspaceDir, ticketId), this.spec)
    if (findings.length === 0) return { gated: true, passed: true, ticket: io.engine.report(ticketId, report) }
    // 不过即 failed('gate:structure'):ready 落库前被拦下,worker 自述作废(24 §5.5-R2)。
    const ticket = io.engine.report(ticketId, {
      state: 'failed',
      summary: `${GATE_STRUCTURE_REASON}: deliverable check failed — ${formatFindings(findings)}. Write the required files, then report ready again.`,
    })
    return { gated: true, passed: false, findings, ticket }
  }
}
