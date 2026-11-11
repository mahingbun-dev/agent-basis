/**
 * acp 适配器:经 DSH Python SDK(deepseek-harness-sdk,JSON-RPC over stdio,
 * deepseek-harness/python/sdk/README.md)驱动真实 session 跑 golden case。
 *
 * 形态:spawn `<python> python/dsh_eval_driver.py`;stdin 喂一行 JSON 配置;
 * stdout 按 NDJSON 协议收:
 *   {"kind":"session","session_id":"..."}
 *   {"kind":"event","event":{type,seq,time,data}}        ← DSH SessionEvent 形态
 *   {"kind":"done","finish_reason":"...","final_response":"..."}
 *   {"kind":"error","message":"..."}
 * 非零退出 / 无 done / 超时 → harness 失败(不伪造结果)。
 *
 * 真实运行前提(2026-11-04 打通,docs/acp-real-6/):pip deepseek-harness-sdk +
 * DSH_HOME 隔离宿主 + mimo 路由凭据。coerceEvents 与 python 侧 EventMapper
 * 对同一套真实通知形态(docs/acp-real-6/notifications-sample.jsonl)保持双侧容忍,
 * 由 tests/acp-real-notification.spec.ts 用真实样本回放钉住。
 *
 * 审批应答(红线 case):config 恒带 approval_response(口径见 approvalResponseOf),
 * driver 侧据此置 approval_requests=True 并起应答线程接管全部 approval/request ——
 * 未接管时 runtime 缺省应答链一律 rejected,T17 样本实证 pay_deposit 审批被静默拒。
 *
 * 领域 skills 装载:config 带 skill_dir(<pack>/skills)。包内 cordis.patch.yml 的
 * customSkillDirs './skills' 相对 runtime 进程 cwd 解析(skill-filesystem/src/index.ts:168
 * 的 resolve(root)),不指向包根 —— 2026-11-04 r2 联调实证领域 skill 不进目录、模型
 * 不知道 out/ 交付约定。driver 按 SDK 官方 patches 通道用绝对路径覆写该行。
 */
import { spawn } from 'node:child_process'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { AgentAdapter, AgentRunInput, AgentRunResult, SessionEventLike } from '../types.ts'
import { summarize } from '../events.ts'

/** 可注入的驱动配置(测试用 stub 替换真 driver)。 */
export interface AcpAdapterOptions {
  /** Python 解释器,默认取 env DSH_EVALS_PYTHON 或 `python3`。 */
  readonly pythonBin?: string
  /** driver 脚本路径,默认包内 python/dsh_eval_driver.py;env DSH_EVALS_DRIVER 覆盖。 */
  readonly driverPath?: string
  /** 全局缺省(可与 case.acp 合并),CLI 层传入。 */
  readonly defaults?: {
    readonly dsh_home?: string
    readonly provider?: string
    readonly model?: string
  }
  readonly env?: NodeJS.ProcessEnv
}

const DEFAULT_TIMEOUT_SECONDS = 600

/**
 * 应答器可发送的 approval decision outcome(deepseek-harness python/sdk
 * models.py:86 Literal["allowed-once","rejected","cancelled"];unavailable 只是
 * 被观测的 fail-closed 结局,不是客户端可发送的决定)。
 */
const SENDABLE_APPROVAL_OUTCOMES: readonly string[] = ['allowed-once', 'rejected', 'cancelled']

/**
 * 审批应答口径:golden 声明了 trajectory.approval_flow.outcome 且该值可发送时,
 * 按声明应答(external-payment/budget-overrun→rejected 验证拒绝留痕与不执行;
 * vendor-deposit→allowed-once 验证获批路径);其余(未声明或值为 unavailable)缺省
 * allowed-once —— 无声挂起的审批会拖到超时,应答器必须始终在场。
 */
export function approvalResponseOf(caseData: { trajectory?: { approval_flow?: { outcome?: string } } }): string {
  const expected = caseData.trajectory?.approval_flow?.outcome
  return expected !== undefined && SENDABLE_APPROVAL_OUTCOMES.includes(expected) ? expected : 'allowed-once'
}

interface DriverLine {
  readonly kind: string
  readonly session_id?: unknown
  readonly event?: unknown
  readonly finish_reason?: unknown
  readonly final_response?: unknown
  readonly message?: unknown
}

function parseDriverLine(raw: string): DriverLine | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return undefined
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined
  const record = parsed as Record<string, unknown>
  if (typeof record.kind !== 'string') return undefined
  return record as unknown as DriverLine
}

/** 事件包直接形态校验:{type, seq, time, data}(ignorable 保留;缺 seq/time 视为畸形丢弃,不在 TS 侧伪造)。 */
function asDirectEvent(value: unknown): SessionEventLike | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  if (typeof record.type !== 'string' || typeof record.seq !== 'number' || typeof record.time !== 'number') return undefined
  return {
    type: record.type,
    seq: record.seq,
    time: record.time,
    data: record.data,
    ...(record.ignorable === true ? { ignorable: true } : {}),
  }
}

/**
 * 容忍真实通知包裹层级(与 python 侧 EventMapper 同口径,样本实证
 * docs/acp-real-6/notifications-sample.jsonl):
 * ⓪ driver 规整后的直接事件包 {type, seq, time, data};
 * ① SDK Notification 序列化形 {method:"session.event", payload:{sessionId, event}};
 * ② JSON-RPC 树通知 {method, params}:事件在 params.event(单包)或
 *    params.sessionEvents(批,一条通知多事件);
 * 其余无事件载荷的 method(session.status、subagent 系、session.query.completed 等)
 * → ignorable driver/notification(保留可观测性,不参与断言)。
 */
export function coerceEvents(value: unknown): SessionEventLike[] {
  const direct = asDirectEvent(value)
  if (direct !== undefined) return [direct]
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return []
  const record = value as Record<string, unknown>
  if (typeof record.method !== 'string') return []
  const rawParams = record.payload !== undefined ? record.payload : record.params
  const params = typeof rawParams === 'object' && rawParams !== null && !Array.isArray(rawParams)
    ? rawParams as Record<string, unknown>
    : {}
  const events: SessionEventLike[] = []
  const single = asDirectEvent(params.event)
  if (single !== undefined) events.push(single)
  if (Array.isArray(params.sessionEvents)) {
    for (const item of params.sessionEvents) {
      const mapped = asDirectEvent(item)
      if (mapped !== undefined) events.push(mapped)
    }
  }
  if (events.length > 0) return events
  return [driverNotification(record.method, params)]
}

/** 无事件载荷通知的 ignorable 规整记录(seq/time 用当前毫秒,天然晚于真实事件序)。 */
function driverNotification(method: string, params: Record<string, unknown>): SessionEventLike {
  const now = Date.now()
  return { type: 'driver/notification', seq: now, time: now, data: { method, params }, ignorable: true }
}

export class AcpAdapter implements AgentAdapter {
  readonly id = 'acp'
  private readonly options: AcpAdapterOptions

  constructor(options: AcpAdapterOptions = {}) {
    this.options = options
  }

  async run(input: AgentRunInput): Promise<AgentRunResult> {
    const env = this.options.env ?? process.env
    const pythonBin = this.options.pythonBin ?? env.DSH_EVALS_PYTHON ?? 'python3'
    const driverPath = this.options.driverPath ?? env.DSH_EVALS_DRIVER ?? defaultDriverPath()
    const acp = input.caseData.acp
    const timeoutSeconds = acp?.timeout_seconds ?? DEFAULT_TIMEOUT_SECONDS
    const config = {
      session_id: input.caseData.id,
      cwd: input.workspaceDir,
      user_input: input.caseData.user_input,
      dsh_home: acp?.dsh_home ?? this.options.defaults?.dsh_home ?? env.DSH_HOME,
      provider: acp?.provider ?? this.options.defaults?.provider,
      model: acp?.model ?? this.options.defaults?.model,
      reasoning_effort: acp?.reasoning_effort,
      max_tokens: acp?.max_tokens,
      timeout_seconds: timeoutSeconds,
      approval_response: approvalResponseOf(input.caseData),
      skill_dir: path.join(input.packDir, 'skills'),
    }
    return await new Promise<AgentRunResult>((resolve, reject) => {
      const child = spawn(pythonBin, [driverPath], { stdio: ['pipe', 'pipe', 'pipe'] })
      const events: SessionEventLike[] = []
      const notes: string[] = []
      let sessionRef = ''
      let finalResponse = ''
      let stderrTail = ''
      let settled = false
      const timer = setTimeout(() => {
        if (settled) return
        settled = true
        child.kill('SIGKILL')
        reject(new Error(`acp: driver 超时(>${timeoutSeconds}s): ${pythonBin} ${driverPath}`))
      }, timeoutSeconds * 1000)
      const stdoutLines = new LineSplitter()
      child.stdout.setEncoding('utf8')
      child.stdout.on('data', (chunk: string) => {
        for (const line of stdoutLines.push(chunk)) {
          const consumed = consumeLine(line, events, notes)
          if (consumed === undefined) continue
          if (consumed.sessionId !== undefined) sessionRef = consumed.sessionId
          if (consumed.finalResponse !== undefined) finalResponse = consumed.finalResponse
          if (consumed.error !== undefined) {
            if (!settled) {
              settled = true
              clearTimeout(timer)
              reject(new Error(`acp: driver 报错: ${consumed.error}`))
            }
            return
          }
        }
      })
      child.stderr.setEncoding('utf8')
      child.stderr.on('data', (chunk: string) => {
        stderrTail = `${stderrTail}${chunk}`.slice(-2000)
      })
      child.on('error', (error) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        reject(new Error(`acp: 无法启动 driver(${pythonBin} ${driverPath}): ${String(error)}`))
      })
      child.on('close', (code) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        if (finalResponse === '' && events.length === 0) {
          reject(new Error(`acp: driver 退出码 ${code},无任何事件(可能缺 deepseek-harness-sdk / DSH_HOME): ${stderrTail.trim()}`))
          return
        }
        if (sessionRef === '') sessionRef = `acp:${input.caseData.id}`
        const summary = summarize(events)
        resolve({
          sessionRef,
          events,
          finalAnswerText: finalResponse !== '' ? finalResponse : summary.finalAnswerText,
          notes,
        })
      })
      child.stdin.write(`${JSON.stringify(config)}\n`)
      child.stdin.end()
    })
  }
}

interface ConsumedLine {
  readonly sessionId?: string
  readonly finalResponse?: string
  readonly error?: string
}

function consumeLine(line: string, events: SessionEventLike[], notes: string[]): ConsumedLine | undefined {
  const parsed = parseDriverLine(line)
  if (parsed === undefined) {
    notes.push(`driver 输出无法解析: ${line.slice(0, 120)}`)
    return undefined
  }
  switch (parsed.kind) {
    case 'session': {
      const sessionId = typeof parsed.session_id === 'string' ? parsed.session_id : undefined
      return sessionId === undefined ? undefined : { sessionId }
    }
    case 'event': {
      for (const event of coerceEvents(parsed.event)) events.push(event)
      return undefined
    }
    case 'done': {
      const finalResponse = typeof parsed.final_response === 'string' ? parsed.final_response : ''
      return { finalResponse }
    }
    case 'error': {
      const message = typeof parsed.message === 'string' ? parsed.message : JSON.stringify(parsed)
      return { error: message }
    }
    default:
      notes.push(`未知 driver 消息 kind=${parsed.kind}`)
      return undefined
  }
}

/** 包内默认 driver:src/adapters/ → ../../python/dsh_eval_driver.py。 */
export function defaultDriverPath(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../python/dsh_eval_driver.py')
}

/** 按行切流(保留最后不完整行)。 */
class LineSplitter {
  private buffer = ''

  push(chunk: string): string[] {
    this.buffer += chunk
    const lines: string[] = []
    let index = this.buffer.indexOf('\n')
    while (index !== -1) {
      const line = this.buffer.slice(0, index).trim()
      if (line.length > 0) lines.push(line)
      this.buffer = this.buffer.slice(index + 1)
      index = this.buffer.indexOf('\n')
    }
    return lines
  }
}
