/**
 * [active-tickets] 活跃工单清单 section——主 Session 的 system prompt 保底摘要
 * (35 号 A24;28 号 §6 全节「活跃工单清单 section(保底摘要,压缩的互补件)」;34 号 §2.5
 * sections 行「(新增)src/session/sections.ts」)。
 *
 * 设计依据与不变量:
 * - section 键名 `[active-tickets]`,经 prompt section seam 注入(28 §6 首段;同 dsh-memory
 *   渐进披露先例——memory 的 MemoryHost.registerPromptSection seam 同构,注册面为
 *   `ctx.systemPrompt.section(section)`,disposer 进 effect 配逆);plugin.ts 的
 *   defineTasksPlugin 在宿主 system-prompt 服务在场时注册(机会读取,memory-plugin
 *   的 inject systemPrompt 同款消费面),缺席则不注册(注入面归宿主装配,A19/A22 接线点);
 * - 一行一张:id + 标题截断 + stage + 等谁,竖线「｜」分隔(28 §6 示例三行;
 *   34 §2.5 sections 行「标题截断」);示例:`T-3f2a 合同审查｜working｜等 worker`;
 * - 「等谁」三种样态(28 §6 示例;35 号表⑥-3):等 worker / 等你回答（Attention #N，已 Xh）/
 *   排队（n/m 槽）。blocked/failed 且 waitsForPerson 成立的工单按 28 §9 关系图
 *   「『等谁』即 waitsForPerson 的可见化」(35 号表⑥-4)渲染为「等你」——谓词消费,
 *   非新发明样态;person/review、person/delivery 等其余阶段落缺省「等 worker」
 *   (清单是提示不是协议,阶段列已自带精确语义);
 * - 上限 20 行(ACTIVE_TICKETS_MAX_LINES,28 §6「设上限(如 20 行)」;34 §2.5「上限 20 行」;
 *   33 号 §2.2 已登记),超出折叠为 `…+N more, orchestrator_read tickets`(34 §2.5
 *   折叠文案原文)——**降级态:折叠即显式指引工具读取,不静默截断**(35 号表⑥-6);
 * - 刷新时机 = pass 周期(24a 拍板记录·C6;28 §8-3「pass 周期(2s)刷新…清单是提示不是协议,
 *   秒级延迟无害」):text provider 返回 pass 驱动重算的缓存(plugin.ts 的 PassDriver 每轮
 *   pass 后调 refresh),装配时零查询;
 * - 体积受 model-surface 体积预算测试看护(28 §6 末段;33 号 G2-A8;断言在
 *   tests/active-tickets.spec.ts,G2-A8 门禁原文「含 model-surface 体积断言」);
 * - 工单 id 与 Attention id 的展示短形 `T-xxxx`/`#xxxx` 取真实 id 前 4 位十六进制
 *   (28 §6 示例的 `T-3f2a`/`Attention #12` 为 4 字位短 id 形态;本仓 id 为 32 位内容派生
 *   hash——src/core/ids.ts key(),行预算 reason 下取前 4 位做展示短形,全文随时可经
 *   orchestrator_read tickets 读到,清单是提示不是协议);
 * - 「已 Xh」自提问时刻起算:Attention.triggerId 指向的人消息 Input 的 at(ask 提问时刻),
 *   缺席回落 ticket.updatedAt;不可解析则省略时长段(纯函数不猜时刻)。
 *
 * 会话过滤:masterId(TasksOptions;SA dsh-superagent masterId 模式)在场时,text provider
 * 按装配上下文的 agent id fail-closed 过滤——只在主 Session 的装配渲染,worker/其它会话
 * 不出现(28 §6「给主 Session 增加」);装配上下文不可归属 → 空(同 memory
 * assemblySessionIdOf 的防御收窄口径)。masterId 缺席(★A19/A22 替换点:装配接线注入)时
 * 不做会话过滤,过滤交由注册面的 scope(sem)。
 */
import type { PromptSection } from '@deepseek-ai/dsh-system-prompt'
import { ticketStage, waitsForPerson, type Ticket } from '../core/index.ts'

/** section 注册名(dsh PromptSection.name;注册表条目 runtime.tasks.active-tickets 同源)。 */
export const ACTIVE_TICKETS_SECTION_NAME = 'eterna-tasks:active-tickets'
/**
 * section 序位(asc 拼接;取 9050:落在本仓 memory:index(9000)之后、上游 HARNESS_SOURCE
 * (10000)之前——清单是「当前有哪些活」的保底摘要,排在角色纪律与记忆索引之后、收尾段之前;
 * 与 memory:index 同段位区不同名,序位相等时按名排序亦无冲突(dsh PromptSection 契约)。
 */
export const ACTIVE_TICKETS_SECTION_ORDER = 9050
/** 行数上限(28 §6「设上限(如 20 行)」;34 §2.5「上限 20 行」;33 号 §2.2 已登记)。 */
export const ACTIVE_TICKETS_MAX_LINES = 20
/** 标题截断宽度(34 §2.5 sections 行「标题截断」;字符数,CJK 计 1)。 */
export const ACTIVE_TICKETS_TITLE_MAX_CHARS = 24
/** 折叠文案(34 §2.5 折叠文案原文形态:`…+N more, orchestrator_read tickets`)。 */
export const activeTicketsFoldLine = (count: number): string => `…+${count} more, orchestrator_read tickets`
/** 清单头(section 首行,28 §6 示例块的第一行;表⑥-1「section 键名 [active-tickets]」)。 */
export const ACTIVE_TICKETS_HEADING = '[active-tickets]'

/** 展示短形:真实 32 位内容派生 id 的前 4 位十六进制(28 §6 示例 `T-3f2a`/`Attention #12` 形态)。 */
const shortId = (id: string, prefix = ''): string => `${prefix}${id.slice(0, 4)}`

/** ticketStage 的行内阶段串:`working/queued`、`person/answer` 等(stage+action,`/` 连接)。 */
function stageLabel(stage: ReturnType<typeof ticketStage>): string {
  if (stage.stage === 'person') return `person/${stage.action}`
  if (stage.stage === 'working') return stage.action === 'queued' ? 'working/queued' : 'working'
  return stage.stage
}

/** Attention 提问时刻:triggerId 指向的人消息 Input 的 at,缺席回落 updatedAt。 */
function askedAt(ticket: Ticket): string {
  const at = ticket.attention?.triggerId === undefined
    ? undefined
    : ticket.inputs.find(input => input.kind === 'trigger' && input.triggerId === ticket.attention?.triggerId)?.at
  return at ?? ticket.updatedAt
}

/** 「等谁」列(28 §6 示例三行;表⑥-3 三种样态 + 表⑥-4 waitsForPerson 可见化的「等你」)。 */
function waitLabel(ticket: Ticket, options: ActiveTicketsRenderOptions, now: () => number): string {
  const stage = ticketStage(ticket)
  if (stage.stage === 'person' && stage.action === 'answer' && ticket.attention !== undefined) {
    const since = Date.parse(askedAt(ticket))
    const hours = Number.isFinite(since) ? Math.max(0, Math.floor((now() - since) / 3_600_000)) : undefined
    return `等你回答（Attention #${shortId(ticket.attention.id)}${hours === undefined ? '' : `，已 ${hours}h`}）`
  }
  if (stage.stage === 'working' && stage.action === 'queued') {
    return options.maxWorkers === undefined
      ? '排队'
      : `排队（${Math.min(options.usedSlots ?? 0, options.maxWorkers)}/${options.maxWorkers} 槽）`
  }
  // blocked/failed 且 waitsForPerson:工单在等人(谓词可见化,28 §9;表⑥-4)。
  if (waitsForPerson(ticket)) return '等你'
  // working/idle/person/review/person/delivery 等其余阶段:worker 持有或待其动作,缺省等 worker。
  return '等 worker'
}

/** 行渲染选项:槽位信息(★A22 替换点接线后由 WorkerSlots 供给)与时钟(测试注入用)。 */
export interface ActiveTicketsRenderOptions {
  /** 配置的并发槽上限(settings.executor.maxWorkers);缺席时排队工单不展示 n/m。 */
  readonly maxWorkers?: number
  /** 当前占用槽数(WorkerSlots.used());缺省 0。 */
  readonly usedSlots?: number
  /** 时钟(「已 Xh」与时长;缺省 Date.now)。 */
  readonly now?: () => number
}

/**
 * 渲染活跃工单清单全文(纯函数;零 I/O):`[active-tickets]` 头行 + 一行一单
 * (id + 标题截断 + stage + 等谁),上限 20 行超出折叠。已结束工单不入清单(活跃面)。
 * 无活跃工单返回空串——dsh 对空 section 不组装(renderPrompt 丢弃空段),清单缺席即
 * 「当前无活跃工单」,不产出一行占位。
 */
export function renderActiveTickets(tickets: readonly Ticket[], options: ActiveTicketsRenderOptions = {}): string {
  const now = options.now ?? ((): number => Date.now())
  const open = tickets.filter(ticket => !ticket.ended)
  if (open.length === 0) return ''
  const lines = open.map((ticket) => {
    const title = ticket.title.length > ACTIVE_TICKETS_TITLE_MAX_CHARS
      ? `${ticket.title.slice(0, ACTIVE_TICKETS_TITLE_MAX_CHARS)}…`
      : ticket.title
    return `${shortId(ticket.id, 'T-')} ${title}｜${stageLabel(ticketStage(ticket))}｜${waitLabel(ticket, options, now)}`
  })
  if (lines.length > ACTIVE_TICKETS_MAX_LINES) {
    return [ACTIVE_TICKETS_HEADING, ...lines.slice(0, ACTIVE_TICKETS_MAX_LINES), activeTicketsFoldLine(lines.length - ACTIVE_TICKETS_MAX_LINES)].join('\n')
  }
  return [ACTIVE_TICKETS_HEADING, ...lines].join('\n')
}

/** 清单的数据源面(plugin 装配供给;★A22 替换点:usedSlots 接线后由 WorkerSlots 供给)。 */
export interface ActiveTicketsSource {
  /** 活跃工单(store.tickets.active(),最新在前;渲染不重排——顺序即库序)。 */
  readonly tickets: () => readonly Ticket[]
  /** 并发槽上限(settings.executor.maxWorkers 现读)。 */
  readonly maxWorkers: () => number
  /** 当前占用槽数(缺省恒 0,★A22 替换点)。 */
  readonly usedSlots?: () => number
  /** 时钟(缺省 Date.now)。 */
  readonly now?: () => number
  /** 主会话 session id(缺席 = 不做会话过滤,见文件头「会话过滤」)。 */
  readonly masterId?: () => string | undefined
}

/** dsh-system-prompt 的装配上下文形状(tasks 不依赖 dsh-agent,结构收窄——memory MemoryAssemblyContext 同款口径)。 */
interface AssemblyLike {
  /** 装配主体 Agent(基础接口含 session.id / id;不可归属为 undefined)。 */
  readonly agent?: unknown
}

/** 装配上下文 → 会话 id(防御收窄:agent.session.id 优先,回落 agent.id;不可归属返回 null)。 */
function assemblyAgentIdOf(assembly: AssemblyLike | undefined): string | null {
  const agent: unknown = assembly?.agent
  if (typeof agent !== 'object' || agent === null) return null
  const session = (agent as { session?: unknown }).session
  const id = typeof session === 'object' && session !== null ? (session as { id?: unknown }).id : (agent as { id?: unknown }).id
  return typeof id === 'string' ? id : null
}

/** [active-tickets] section(PromptSection + pass 周期刷新面)。 */
export interface ActiveTicketsSection extends PromptSection {
  /** 重算缓存(pass 周期刷新,C6 拍板;plugin.ts 的 PassDriver 每轮 pass 后调用)。 */
  refresh(): void
  /** 当前缓存文本(探针面;与 text provider 返回一致)。 */
  currentText(): string
}

/**
 * 构造 [active-tickets] section:text provider 返回 pass 周期重算的缓存(装配零查询),
 * `interpolate: false` 保真清单里的 `{{…}}` 字面与中文样(memory index section 同款口径)。
 * masterId 在场时按装配上下文的 agent id fail-closed 过滤(文件头「会话过滤」)。
 */
export function activeTicketsSection(source: ActiveTicketsSource): ActiveTicketsSection {
  const used = source.usedSlots
  const render = (): string => renderActiveTickets(source.tickets(), {
    maxWorkers: source.maxWorkers(),
    ...(used !== undefined ? { usedSlots: used() } : {}),
    ...(source.now !== undefined ? { now: source.now } : {}),
  })
  let cached = render()
  return {
    name: ACTIVE_TICKETS_SECTION_NAME,
    order: ACTIVE_TICKETS_SECTION_ORDER,
    interpolate: false,
    refresh: (): void => { cached = render() },
    currentText: (): string => cached,
    text: (assembly: { agent?: unknown }): string => {
      const master = source.masterId?.()
      if (master !== undefined) {
        // fail-closed:装配主体不可归属或不为主会话 → 空(空段不组装,worker 面不出现清单)。
        const agentId = assemblyAgentIdOf(assembly)
        if (agentId === null || agentId !== master) return ''
      }
      return cached
    },
  }
}

/**
 * 从装配依赖构造清单 section(createTasks 装配面;数据源全部现读,refresh 由 pass 驱动)。
 * usedSlots 缺省恒 0(★A22 替换点:DshExecutor 接线后由 slots.used() 供给)。
 */
export function activeTicketsFace(deps: {
  readonly tickets: () => readonly Ticket[]
  readonly maxWorkers: () => number
  readonly usedSlots?: () => number
  readonly now?: () => number
  readonly masterId?: () => string | undefined
}): ActiveTicketsSection {
  return activeTicketsSection(deps)
}
