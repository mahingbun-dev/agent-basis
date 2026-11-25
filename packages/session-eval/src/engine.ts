/**
 * 裁判编排引擎(56 号 §5.4):队列 / 采样 / 预算 / 触发 / 评分库 / 面板快照。
 *
 * 四档触发(§4.3 在线档位):
 * - **手动**(`evaluate`,面板「立即评测」):结果类整条 + 末轮过程类,需已配置路由;
 * - **L1 轮末**(`turn_end`):`turn/end` 后按 `sampling` 概率抽该轮,跑 3 项过程裁判;
 * - **L2 空闲终评**(`idle`):轮结束后 `idleTimeoutMs` 无新输入 → 跑 3 项结果裁判;
 *   有新输入(turn/start、user/message)即撤销计时(整条评比逐步评准,§5.4)。
 *
 * 成本纪律:
 * - 队列**独立于会话回合**(不阻塞 agent),并发上限 {@link JUDGE_CONCURRENCY};
 * - 每日 token 预算硬闸(用尽即不再发新调用;面板 note 如实说明);
 * - 裁判用量单列(`judge_usage`),不混入被测会话成本;
 * - 同一 (会话, 指标, 目标) 在途去重;完成后重评**覆盖**(不堆历史)。
 *
 * 关闭纪律(`enabled=false`):自动触发(抽样/空闲)不生效,手动评测仍可用
 * (用户显式点击是一次授权,不因关闭自动评测而失效)。
 */
import type { SessionEventLike } from './types.ts'
import {
  DEFAULT_JUDGE_CONFIG, JUDGE_RATIONALE_MAX,
  type BusinessSaveReply,
  type BusinessParseReply, type CalibrationMetricView, type CalibrationView, type JudgeConfig,
  type JudgeEvaluateReply, type JudgeLabelReply, type JudgeRoute, type JudgeSaveConfigReply,
  type JudgeScope, type JudgeScoreView, type JudgeSettingsView, type JudgeSnapshot, type JudgeTrigger,
} from './judge-types.ts'
import { BUILTIN_JUDGE_METRICS, findJudgeMetric, type JudgeMetricDef } from './judge-metrics.ts'
import { projectJudgeInput } from './judge-input.ts'
import { runJudge, type JudgeLlmPort, type JudgeRunResult } from './judge-call.ts'
import { JudgeScoreStore, openJudgeStore, type StoredJudgeLabel, type StoredJudgeScore } from './score-store.ts'
import { parseJudgeConfig, readJudgeConfig, writeJudgeConfig, type JudgeConfigRead } from './judge-config.ts'
import { isBusinessJudgeMetric, runBusinessJudge, type BusinessJudgeMetric } from './business-judge.ts'
import { buildBusinessRuleFacts, isBusinessRuleMetric, runBusinessRule, type BusinessRuleMetric } from './business-rules.ts'
import { serializeBusinessMetrics, type BusinessMetricsFile } from './business-metrics.ts'
import { readBusinessFile, saveBusinessMetric as saveBusinessMetricFile } from './business-store.ts'
import { parseBusinessMetrics as parseBusinessMetricsText } from './business-yaml.ts'

/** 队列并发上限(§5.4 表「队列」;D8 先按 5,P2 用真实数据定)。 */
export const JUDGE_CONCURRENCY = 5

/** 会话 id 长度上限(与 service.ts 同口径). */
const SESSION_ID_MAX = 200

/** 校准门槛(56 号 §10-D5):≥20 条人工样本且一致率 ≥85% 才显示为已校准。 */
export const CALIBRATION_MIN_SAMPLES = 20
export const CALIBRATION_MIN_AGREEMENT = 0.85

/** provider 目录项(设置分区的模型选择面). */
export interface JudgeProviderCatalog {
  readonly id: string
  readonly models: readonly string[]
}

/** 引擎端口(服务面从宿主编织;测试注入假件). */
export interface JudgeEnginePorts {
  /** 读会话事件快照;会话未加载返回 undefined. */
  readEvents(sessionId: string): readonly SessionEventLike[] | undefined
  /** 一次性直调端口(host 接 ctx.llm). */
  readonly llm: JudgeLlmPort
  /** provider/model 目录(设置分区的下拉;失败降级空列表). */
  listProviders(): Promise<readonly JudgeProviderCatalog[]>
  /** 时钟(测试注入). */
  now?(): number
  /** 抽样随机源(测试注入). */
  random?(): number
  /** 账号覆盖层 metrics.yaml 路径(宿主给 businessMetricsPath;缺席时业务指标不可用). */
  businessPath?(account: string): string
}

/** 引擎构造参数. */
export interface JudgeEngineOptions {
  readonly configPath: string
  readonly storePath: string
  readonly ports: JudgeEnginePorts
  /** 队列并发上限覆写(测试用;缺省 {@link JUDGE_CONCURRENCY}). */
  readonly concurrency?: number
}

/** 任务指标(内置裁判 / 业务 rubric). */
type JudgeTaskMetric = JudgeMetricDef | BusinessJudgeMetric | BusinessRuleMetric

/** 队列任务. */
interface JudgeTask {
  readonly id: string
  readonly sessionId: string
  readonly metric: JudgeTaskMetric
  readonly turn: number | undefined
  readonly trigger: JudgeTrigger
}

/** 手动评测选项. */
export interface JudgeEvaluateOptions {
  readonly scope?: 'all' | 'outcome' | 'process'
  /** 过程裁判的目标轮(缺省 = 末轮). */
  readonly turn?: number
  /** 已登录账号(access 校验归属后传入):业务指标按该账号覆盖层执行. */
  readonly account?: string
}

/** ISO 日期键(UTC;与 usage-stats dayOf 同口径). */
function dayKey(time: number): string {
  return new Date(time).toISOString().slice(0, 10)
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined
}

/**
 * 裁判编排引擎。
 */
export class JudgeEngine {
  readonly #configPath: string
  readonly #storePath: string
  readonly #ports: JudgeEnginePorts
  readonly #concurrency: number
  /** 懒开的评分库(失败留空 + 原因,面板如实说明). */
  #store: JudgeScoreStore | undefined
  #storeError: string | undefined
  #storeTried = false
  /** 待执行队列(FIFO). */
  readonly #queue: JudgeTask[] = []
  /** 在途任务(排队 + 执行中;键 = 去重键). */
  readonly #inflight = new Map<string, JudgeTask>()
  /** 空闲终评计时器(每会话一个;新输入即撤销). */
  readonly #idleTimers = new Map<string, ReturnType<typeof setTimeout>>()
  /** 卸载信号(中止在途调用). */
  readonly #abort = new AbortController()
  /** 最近一次引擎级失败(库/文件异常;写进面板 note). */
  #lastError: string | undefined

  constructor(options: JudgeEngineOptions) {
    this.#configPath = options.configPath
    this.#storePath = options.storePath
    this.#ports = options.ports
    this.#concurrency = options.concurrency ?? JUDGE_CONCURRENCY
  }

  /** 当前时钟. */
  #now(): number {
    return this.#ports.now?.() ?? Date.now()
  }

  /** 抽样随机源. */
  #random(): number {
    return this.#ports.random?.() ?? Math.random()
  }

  /** 现读配置(文件损坏回默认值 + warning). */
  #config(): JudgeConfigRead {
    try {
      return readJudgeConfig(this.#configPath)
    } catch {
      return { config: DEFAULT_JUDGE_CONFIG, warning: '裁判配置读取失败，已回默认值。' }
    }
  }

  /** 懒开评分库(只尝试一次;失败记原因). */
  #openStore(): JudgeScoreStore | undefined {
    if (this.#storeTried) return this.#store
    this.#storeTried = true
    try {
      this.#store = openJudgeStore(this.#storePath)
    } catch {
      this.#storeError = '评分库不可读（可能损坏），评分暂不可用；删除该库文件后会自动重建。'
      this.#store = undefined
    }
    return this.#store
  }

  /** 列某会话评分(库异常 → 空列表 + 原因). */
  #listScores(sessionId: string): readonly StoredJudgeScore[] {
    const store = this.#openStore()
    if (store === undefined) return []
    try {
      return store.list(sessionId)
    } catch {
      this.#lastError = '评分库查询失败，本次快照不含已存评分。'
      return []
    }
  }

  /** 当日已用裁判 token(库异常按 0 计,但 note 说明). */
  #usage(now: number): number {
    const store = this.#openStore()
    if (store === undefined) return 0
    try {
      return store.usage(dayKey(now))
    } catch {
      this.#lastError = '裁判用量读取失败，预算按 0 计。'
      return 0
    }
  }

  /** 某会话在途/排队任务数. */
  pendingFor(sessionId: string): number {
    let count = 0
    for (const task of this.#inflight.values()) {
      if (task.sessionId === sessionId) count += 1
    }
    return count
  }

  /** 全部在途/排队任务数. */
  pendingTotal(): number {
    return this.#inflight.size
  }

  /**
   * 面板快照:评分视图 + 预算 + 综合结论。
   * @param sessionId - 会话 id(调用方已完成归属校验).
   * @param now - 快照时刻(测试注入).
   * @returns 裁判区;未配置/停用/预算用尽都如实进 `state` 与 `note`(不伪报分数)。
   */
  snapshot(sessionId: string, now?: number): Promise<JudgeSnapshot> {
    const at = now ?? this.#now()
    const configRead = this.#config()
    const config = configRead.config
    const rows = this.#listScores(sessionId)
    const scores = buildScoreViews(config, rows, this.#labelsFor(sessionId))
    const pending = this.pendingFor(sessionId)
    const used = this.#usage(at)
    const overall = buildOverall(config, rows)
    const latestError = latestRow(rows.filter(row => row.status === 'error'), 'session')
      ?? latestRow(rows.filter(row => row.status === 'error'), 'turn')
    const notes: string[] = []
    if (configRead.warning !== undefined) notes.push(configRead.warning)
    if (round(used) >= config.budgetTokensPerDay) {
      notes.push(`今日裁判预算已用尽（${used} / ${config.budgetTokensPerDay} tokens），自动与手动评测暂停。`)
    }
    if (config.route === null) notes.push('未配置裁判模型：可在 设置 → 评测 里选择 provider 与模型。')
    else if (!config.enabled) notes.push('自动评测已关闭；可在 设置 → 评测 打开，或点「立即评测」手动出分。')
    if (this.#storeError !== undefined) notes.push(this.#storeError)
    if (this.#lastError !== undefined) notes.push(this.#lastError)
    const state: JudgeSnapshot['state'] = config.route === null
      ? 'unconfigured'
      : pending > 0
        ? 'running'
        : latestError !== undefined
          ? 'error'
          : config.enabled
            ? 'ready'
            : 'disabled'
    return Promise.resolve({
      state,
      scores,
      pending,
      budget: { usedTokens: used, maxTokensPerDay: config.budgetTokensPerDay },
      overall,
      ...notes.length === 0 ? {} : { note: notes.join(' ') },
    })
  }

  /**
   * 设置分区读面(配置 + 指标目录 + 模型目录)。
   * @returns 设置视图;`note` 携带配置损坏说明。
   */
  async settings(account?: string): Promise<JudgeSettingsView> {
    const configRead = this.#config()
    let providers: readonly JudgeProviderCatalog[] = []
    try {
      providers = await this.#ports.listProviders()
    } catch {
      providers = []
    }
    const business = this.#businessView(account)
    return {
      config: configRead.config,
      metrics: BUILTIN_JUDGE_METRICS.map(metric => ({
        key: metric.key,
        name: metric.name,
        category: metric.category,
        scope: metric.scope,
        gating: metric.gating,
      })),
      providers,
      ...business === undefined ? {} : { business },
      calibration: this.#calibrationView(),
      ...configRead.warning === undefined ? {} : { note: configRead.warning },
    }
  }

  /** 账号覆盖层读面(未登录/无路径 → undefined;损坏文件带 warning). */
  #businessView(account: string | undefined): JudgeSettingsView['business'] | undefined {
    if (account === undefined || this.#ports.businessPath === undefined) return undefined
    let read: ReturnType<typeof readBusinessFile>
    try {
      read = readBusinessFile(this.#ports.businessPath(account))
    } catch {
      return undefined
    }
    const yaml = read.warning === undefined ? serializeBusinessMetrics(read.file) : read.raw ?? ''
    return {
      version: read.file.version,
      updatedAt: read.file.updatedAt,
      updatedBy: read.file.updatedBy,
      metrics: read.file.metrics,
      yaml,
      ...read.warning === undefined ? {} : { warning: read.warning },
    }
  }

  /**
   * 保存一条业务指标(仅当前账号的覆盖层;版本冲突拒绝覆盖)。
   * @param account - 已登录账号(access 传入).
   * @param input - 指标对象.
   * @param baseVersion - 前端读到的文件版本.
   */
  saveBusinessMetric(account: string, input: unknown, baseVersion: number): Promise<BusinessSaveReply> {
    if (this.#ports.businessPath === undefined) {
      return Promise.resolve({ ok: false, code: 'io', error: '业务指标存储未接线（宿主未提供账号路径）。' })
    }
    let path: string
    try {
      path = this.#ports.businessPath(account)
    } catch {
      return Promise.resolve({ ok: false, code: 'invalid', error: '账号不合法，无法写入业务指标。' })
    }
    return Promise.resolve(saveBusinessMetricFile(path, input, { baseVersion, updatedBy: account, now: this.#now() }))
  }

  /**
   * 解析导入的 metrics.yaml(纯解析,不落盘;行级错误原样返回)。
   * @param text - 粘贴/上传的文件原文.
   * @returns 条目与文件元信息,或带中文原因(含行号)的失败.
   */
  parseBusinessMetrics(text: string): Promise<BusinessParseReply> {
    const parsed = parseBusinessMetricsText(text)
    if (!parsed.ok) return Promise.resolve(parsed)
    return Promise.resolve({
      ok: true,
      version: parsed.file.version,
      updatedAt: parsed.file.updatedAt,
      updatedBy: parsed.file.updatedBy,
      metrics: parsed.file.metrics,
    })
  }

  /**
   * 人工复核一条模型评分(56 号 P2-3 校准):agrees=false = 判错了。
   * @param sessionId - 会话 id(调用方已完成归属校验).
   * @param input - {metric, turn?, agrees}.
   * @param account - 标注人(登录账号,access 传入).
   * @returns 保存后的标注;只有「模型裁判 + ok 结论」的评分可标注.
   */
  label(sessionId: string, input: unknown, account: string): Promise<JudgeLabelReply> {
    const id = typeof sessionId === 'string' ? sessionId.trim() : ''
    if (id === '' || id.length > SESSION_ID_MAX || account.trim() === '') {
      return Promise.resolve({ ok: false, code: 'invalid', error: '参数不合法：缺少会话或标注人。' })
    }
    const record = typeof input === 'object' && input !== null && !Array.isArray(input)
      ? input as Record<string, unknown>
      : undefined
    const metricKey = typeof record?.metric === 'string' ? record.metric.trim() : ''
    const agrees = record?.agrees
    const turn = record?.turn
    if (metricKey === '' || typeof agrees !== 'boolean'
      || (turn !== undefined && (typeof turn !== 'number' || !Number.isInteger(turn) || turn < 1))) {
      return Promise.resolve({ ok: false, code: 'invalid', error: '参数不合法：metric / agrees / turn。' })
    }
    let row: StoredJudgeScore | undefined
    try {
      row = this.#listScores(id).find(candidate => candidate.metricKey === metricKey
        && (turn === undefined ? candidate.targetTurn === null : candidate.targetTurn === turn))
    } catch {
      return Promise.resolve({ ok: false, code: 'io', error: '评分库不可读。' })
    }
    if (row === undefined || row.status !== 'ok' || row.value === null || row.provider === null || row.model === null) {
      return Promise.resolve({ ok: false, code: 'not_found', error: '没有可复核的模型评分：先运行该指标再标注。' })
    }
    const store = this.#openStore()
    if (store === undefined) return Promise.resolve({ ok: false, code: 'io', error: '评分库不可读（可能损坏）。' })
    try {
      store.saveLabel({
        sessionId: id,
        metricKey: row.metricKey,
        metricName: row.metricName,
        category: row.category,
        scope: row.scope,
        targetTurn: row.targetTurn,
        judgeValue: row.value,
        agrees,
        labeledBy: account.trim(),
        labeledAt: this.#now(),
      })
    } catch {
      return Promise.resolve({ ok: false, code: 'io', error: '人工复核写入失败。' })
    }
    return Promise.resolve({ ok: true, label: agrees ? 'agrees' : 'disagrees' })
  }

  /** 会话内人工复核映射(只用于回显;评分重评后值变了就不回显). */
  #labelsFor(sessionId: string): ReadonlyMap<string, LabelMark> {
    const store = this.#openStore()
    if (store === undefined) return new Map()
    try {
      return new Map(store.labels(sessionId).map(label => [
        labelKeyOf(label.metricKey, label.scope, label.targetTurn),
        { agrees: label.agrees, judgeValue: label.judgeValue },
      ]))
    } catch {
      this.#lastError = '人工复核读取失败，本次快照不含标注。'
      return new Map()
    }
  }

  /** 校准读面:内置指标全列(无样本也列出),业务指标只列有标注的. */
  #calibrationView(): CalibrationView {
    const store = this.#openStore()
    let labels: readonly StoredJudgeLabel[] = []
    if (store !== undefined) {
      try {
        labels = store.allLabels()
      } catch {
        this.#lastError = '人工复核读取失败，校准视图为空。'
      }
    }
    const byKey = new Map<string, StoredJudgeLabel[]>()
    for (const label of labels) {
      const bucket = byKey.get(label.metricKey)
      if (bucket === undefined) byKey.set(label.metricKey, [label])
      else bucket.push(label)
    }
    const metrics: CalibrationMetricView[] = BUILTIN_JUDGE_METRICS.map((metric) => {
      const bucket = byKey.get(metric.key) ?? []
      byKey.delete(metric.key)
      return { key: metric.key, name: metric.name, category: metric.category, ...calibrationOf(bucket) }
    })
    for (const [key, bucket] of [...byKey.entries()].sort(([left], [right]) => left.localeCompare(right))) {
      const first = bucket[0]
      if (first === undefined) continue
      metrics.push({ key, name: first.metricName, category: first.category, ...calibrationOf(bucket) })
    }
    const totals = calibrationOf(labels)
    return {
      metrics,
      totals: {
        labeled: totals.labeled, agrees: totals.agrees, agreement: totals.agreement,
        matrix: totals.matrix, status: totals.status,
      },
      thresholds: { minSamples: CALIBRATION_MIN_SAMPLES, minAgreement: CALIBRATION_MIN_AGREEMENT },
    }
  }

  /**
   * 保存配置(严格校验 + 路由目录自检 + 原子写)。
   * @param input - 设置分区提交的配置对象.
   * @returns 保存结果;校验失败返回中文原因(不写文件)。
   */
  async saveConfig(input: unknown): Promise<JudgeSaveConfigReply> {
    const parsed = parseJudgeConfig(input)
    if (!parsed.ok) return parsed
    // 保存自检(§5.4):路由可枚举时,provider 必须注册、model 必须在目录里。
    // 目录查询失败(适配器离线/枚举不支持)不拦保存——首次评测会显式报错。
    if (parsed.config.route !== null) {
      const route = parsed.config.route
      let providers: readonly JudgeProviderCatalog[] | undefined
      try {
        providers = await this.#ports.listProviders()
      } catch {
        providers = undefined
      }
      if (providers !== undefined && providers.length > 0) {
        const provider = providers.find(entry => entry.id === route.provider)
        if (provider === undefined) {
          return { ok: false, error: `模型路由不可用：provider "${route.provider}" 未注册。` }
        }
        if (provider.models.length > 0 && !provider.models.includes(route.model)) {
          return { ok: false, error: `模型 "${route.model}" 不在 provider "${route.provider}" 的目录中。` }
        }
      }
    }
    try {
      writeJudgeConfig(this.#configPath, parsed.config)
      return { ok: true, config: parsed.config }
    } catch {
      return { ok: false, error: '配置写入失败：评测数据目录不可写。' }
    }
  }

  /**
   * 手动评测(面板「立即评测」)。
   * @param sessionId - 会话 id.
   * @param options - 范围与目标轮.
   * @returns 受理数量与跳过原因;未配置/无内容/预算用尽为业务失败(不抛)。
   */
  evaluate(sessionId: string, options: JudgeEvaluateOptions = {}): Promise<JudgeEvaluateReply> {
    try {
      return Promise.resolve(this.#evaluateNow(sessionId, options))
    } catch {
      // 消费端口抛错(事件读取竞态等)收敛成业务失败,不给面板递堆栈。
      return Promise.resolve({ ok: false, code: 'invalid', message: '评测请求异常（内部读取失败）。' })
    }
  }

  /** 同步受理核心(公开面只包一层 Promise;受理本身不做 IO 等待). */
  #evaluateNow(sessionId: string, options: JudgeEvaluateOptions): JudgeEvaluateReply {
    const id = typeof sessionId === 'string' ? sessionId.trim() : ''
    if (id === '' || id.length > SESSION_ID_MAX) return { ok: false, code: 'invalid', message: '会话 id 不合法。' }
    const config = this.#config().config
    const events = this.#ports.readEvents(id)
    if (events === undefined || events.length === 0) {
      return { ok: false, code: 'no_content', message: '会话不在内存或尚无内容，无法评测。' }
    }
    const input = projectJudgeInput(events)
    if (input.task === '' && input.turns.length === 0) {
      return { ok: false, code: 'no_content', message: '会话尚无可用轨迹内容，无法评测。' }
    }
    const now = this.#now()
    // 模型类裁判(内置 + rubric)的闸;规则型是确定性断言,不受路由/预算限制。
    const judgeBlocked = config.route === null
      ? 'unconfigured'
      : this.#usage(now) >= config.budgetTokensPerDay ? 'budget' : undefined
    const scope = options.scope ?? 'all'
    const lastTurn = input.turns.length === 0 ? undefined : input.turns[input.turns.length - 1]?.turn
    const skipped: string[] = []
    let accepted = 0
    let builtinBlocked = false
    for (const metric of BUILTIN_JUDGE_METRICS) {
      if (config.metrics[metric.key] === false) continue
      if (scope === 'outcome' && metric.scope !== 'session') continue
      if (scope === 'process' && metric.scope !== 'turn') continue
      if (judgeBlocked !== undefined) {
        builtinBlocked = true
        continue
      }
      const turn = metric.scope === 'turn' ? options.turn ?? lastTurn : undefined
      if (metric.scope === 'turn' && turn === undefined) {
        skipped.push(`${metric.name}：没有可评的轮次`)
        continue
      }
      if (this.#enqueue(metric, id, turn, 'manual')) accepted += 1
      else skipped.push(`${metric.name}：相同评分已在队列中`)
    }
    if (builtinBlocked) {
      skipped.push(judgeBlocked === 'budget' ? '内置裁判：当日预算已用尽' : '内置裁判：未配置裁判模型')
    }
    const business = this.#businessForEvaluate(options.account)
    for (const metric of business.metrics) {
      if (!metric.enabled) continue
      if (scope === 'outcome' && metric.scope !== 'session') continue
      if (scope === 'process' && metric.scope !== 'turn') continue
      const turn = metric.scope === 'turn' ? options.turn ?? lastTurn : undefined
      if (metric.scope === 'turn' && turn === undefined) {
        skipped.push(`${metric.name}：没有可评的轮次`)
        continue
      }
      const runnable = isBusinessJudgeMetric(metric) ? metric : isBusinessRuleMetric(metric) ? metric : undefined
      if (runnable === undefined) continue
      if (!isBusinessRuleMetric(runnable) && judgeBlocked !== undefined) {
        skipped.push(`${metric.name}：${judgeBlocked === 'budget' ? '当日预算已用尽' : '未配置裁判模型'}`)
        continue
      }
      if (this.#enqueue(runnable, id, turn, 'manual')) accepted += 1
      else skipped.push(`${metric.name}：相同评分已在队列中`)
    }
    if (business.warning !== undefined) skipped.push(`业务指标文件不可读：${business.warning}`)
    if (accepted === 0) {
      if (judgeBlocked === 'unconfigured') {
        return { ok: false, code: 'unconfigured', message: '尚未配置裁判模型：请到 设置 → 评测 里选择模型后重试。' }
      }
      if (judgeBlocked === 'budget') {
        return { ok: false, code: 'budget', message: '今日裁判预算已用尽：明日恢复，或在 设置 → 评测 里调高预算。' }
      }
      return skipped.length === 0
        ? { ok: false, code: 'no_content', message: '没有可执行的裁判指标（指标可能均已停用）。' }
        : { ok: false, code: 'busy', message: `裁判已在队列中：${skipped.join('；')}` }
    }
    return { ok: true, accepted, pending: this.pendingFor(id), skipped }
  }

  /** 账号覆盖层的可执行指标(未传账号/路径未接线 → 空;损坏文件带 warning). */
  #businessForEvaluate(account: string | undefined): { readonly metrics: readonly BusinessMetricsFile['metrics'][number][]; readonly warning?: string } {
    if (account === undefined || this.#ports.businessPath === undefined) return { metrics: [] }
    try {
      const read = readBusinessFile(this.#ports.businessPath(account))
      return {
        metrics: read.file.metrics,
        ...read.warning === undefined ? {} : { warning: read.warning },
      }
    } catch {
      return { metrics: [], warning: '账号路径不可用' }
    }
  }

  /**
   * 会话事件观察入口(host 接 `ctx.on('session/event')`)。
   * 只处理三种事件:turn/end 触发抽样与空闲计时;turn/start、user/message 撤销空闲计时。
   * 任何异常都不上抛(评测观察永不阻断会话)。
   * @param session - 宿主会话(读 `.id`).
   * @param event - 会话事件(读 `.type` / `.data`).
   */
  handleEvent(session: unknown, event: unknown): void {
    try {
      const sessionId = asString(asRecord(session)?.id)
      const type = asString(asRecord(event)?.type)
      if (sessionId === undefined || type === undefined) return
      if (type === 'turn/start' || type === 'user/message') {
        this.#clearIdle(sessionId)
        return
      }
      if (type !== 'turn/end') return
      const data = asRecord(asRecord(event)?.data)
      const turn = asNumber(data?.turn)
      const config = this.#config().config
      if (config.route === null) return
      if (config.enabled && turn !== undefined && config.sampling > 0 && this.#random() < config.sampling) {
        for (const metric of BUILTIN_JUDGE_METRICS) {
          if (metric.scope !== 'turn' || config.metrics[metric.key] === false) continue
          this.#enqueue(metric, sessionId, turn, 'turn_end')
        }
      }
      if (config.enabled) this.#scheduleIdle(sessionId, config.idleTimeoutMs)
    } catch {
      // 观察面静默:评测是增强面,不因自身异常影响会话主流程。
    }
  }

  /** 撤销某会话的空闲计时器. */
  #clearIdle(sessionId: string): void {
    const timer = this.#idleTimers.get(sessionId)
    if (timer === undefined) return
    clearTimeout(timer)
    this.#idleTimers.delete(sessionId)
  }

  /** 排一次空闲终评(同会话重设即覆盖旧计时). */
  #scheduleIdle(sessionId: string, delayMs: number): void {
    this.#clearIdle(sessionId)
    const timer = setTimeout(() => {
      this.#idleTimers.delete(sessionId)
      this.#idleOutcome(sessionId)
    }, delayMs)
    // 计时器不该把进程钉在事件循环里(node 专有;浏览器侧不会走到)。
    ;(timer as { unref?: () => void }).unref?.()
    this.#idleTimers.set(sessionId, timer)
  }

  /** 空闲终评:内容自上次结果类评分后有变化才跑(避免重复计费). */
  #idleOutcome(sessionId: string): void {
    try {
      const config = this.#config().config
      if (!config.enabled || config.route === null) return
      if (this.pendingFor(sessionId) > 0) {
        // 已有在途评分(多半是过程类):等它结束后再检查一次,不并发抢预算。
        this.#scheduleIdle(sessionId, 5_000)
        return
      }
      const events = this.#ports.readEvents(sessionId)
      if (events === undefined || events.length === 0) return
      const lastEvent = latestEventTime(events)
      const fresh = this.#listScores(sessionId).some(row =>
        row.scope === 'session' && row.status === 'ok' && (lastEvent === undefined || row.createdAt >= lastEvent))
      if (fresh) return
      for (const metric of BUILTIN_JUDGE_METRICS) {
        if (metric.scope !== 'session' || config.metrics[metric.key] === false) continue
        this.#enqueue(metric, sessionId, undefined, 'idle')
      }
    } catch {
      // 空闲终评失败静默(下一次轮末会重新计时)。
    }
  }

  /** 入队(同键在途去重);返回是否受理. */
  #enqueue(metric: JudgeTaskMetric, sessionId: string, turn: number | undefined, trigger: JudgeTrigger): boolean {
    if (this.#abort.signal.aborted) return false
    const id = `${sessionId}\u0000${metric.key}\u0000${turn === undefined ? 'session' : `turn:${turn}`}`
    if (this.#inflight.has(id)) return false
    const task: JudgeTask = { id, sessionId, metric, turn, trigger }
    this.#inflight.set(id, task)
    this.#queue.push(task)
    this.#pump()
    return true
  }

  /** 起任务(受并发上限约束). */
  #pump(): void {
    while (this.pendingTotal() - this.#queue.length < this.#concurrency && this.#queue.length > 0) {
      const task = this.#queue.shift()
      if (task === undefined) return
      void this.#run(task)
    }
  }

  /** 执行一个任务(预算/路由/内容三闸;任何异常收敛为不入库). */
  async #run(task: JudgeTask): Promise<void> {
    try {
      // 规则型:确定性断言,不需要路由,不占裁判预算(零模型成本)。
      const ruleMetric = isBusinessRuleMetric(task.metric) ? task.metric : undefined
      let route: JudgeRoute | null = null
      if (ruleMetric === undefined) {
        const config = this.#config().config
        const configured = config.route
        if (configured === null) return
        if (this.#usage(this.#now()) >= config.budgetTokensPerDay) return
        route = configured
      }
      const events = this.#ports.readEvents(task.sessionId)
      if (events === undefined || events.length === 0) return
      const input = projectJudgeInput(events)
      if (input.task === '' && input.turns.length === 0) return
      if (task.metric.scope === 'turn') {
        if (task.turn === undefined) return
        if (!input.turns.some(turn => turn.turn === task.turn)) return
      }
      const judgeOptions = {
        ...task.turn === undefined ? {} : { turn: task.turn },
        signal: this.#abort.signal,
      }
      let result: JudgeRunResult
      if (isBusinessRuleMetric(task.metric)) {
        result = runBusinessRule(task.metric, buildBusinessRuleFacts(events), task.turn)
      } else if (route === null) {
        // 上方闸已拦;这里只为类型收敛(不改变行为)。
        return
      } else if (isBusinessJudgeMetric(task.metric)) {
        result = await runBusinessJudge(task.metric, input, route, this.#ports.llm, judgeOptions)
      } else {
        result = await runJudge(task.metric, input, route, this.#ports.llm, judgeOptions)
      }
      if (this.#abort.signal.aborted) return
      const createdAt = this.#now()
      const store = this.#openStore()
      if (store === undefined) return
      store.upsert({
        sessionId: task.sessionId,
        metricKey: task.metric.key,
        metricName: task.metric.name,
        category: task.metric.category,
        scope: task.metric.scope,
        targetTurn: task.metric.scope === 'turn' ? task.turn ?? null : null,
        status: result.status,
        value: result.value,
        rationale: result.rationale === '' ? null : result.rationale.slice(0, JUDGE_RATIONALE_MAX),
        provider: route === null ? null : route.provider,
        model: route === null ? null : route.model,
        latencyMs: result.latencyMs,
        tokens: result.tokens ?? null,
        gating: task.metric.gating,
        metricVersion: isBusinessJudgeMetric(task.metric) || isBusinessRuleMetric(task.metric)
          ? task.metric.version
          : null,
        createdAt,
      })
      if (result.tokens !== undefined) store.addUsage(dayKey(createdAt), result.tokens)
    } catch {
      // 库写失败/事件读取竞态:不落库,面板无分(不伪造成 error 评分,error 评分只来自裁判调用)。
      this.#lastError = '裁判结果落库失败，本次评分未保存。'
    } finally {
      this.#inflight.delete(task.id)
      this.#pump()
    }
  }

  /** 卸载:撤计时器、中止在途调用、关库. */
  dispose(): void {
    for (const timer of this.#idleTimers.values()) clearTimeout(timer)
    this.#idleTimers.clear()
    this.#abort.abort()
    this.#queue.length = 0
    this.#inflight.clear()
    try {
      this.#store?.close()
    } catch {
      // 关库失败不影响卸载。
    }
    this.#store = undefined
  }
}

/** 取指定 scope 里最近一条评分行(targetTurn 最大,同轮取 createdAt 最新). */
function latestRow(rows: readonly StoredJudgeScore[], scope?: 'session' | 'turn'): StoredJudgeScore | undefined {
  let best: StoredJudgeScore | undefined
  for (const row of rows) {
    if (scope !== undefined && row.scope !== scope) continue
    if (best === undefined) { best = row; continue }
    if ((row.targetTurn ?? 0) > (best.targetTurn ?? 0)) { best = row; continue }
    if ((row.targetTurn ?? 0) === (best.targetTurn ?? 0) && row.createdAt >= best.createdAt) best = row
  }
  return best
}

/** 指标 → 最近一条评分行. */
function latestForMetric(rows: readonly StoredJudgeScore[], metric: JudgeMetricDef): StoredJudgeScore | undefined {
  return latestRow(rows.filter(row => row.metricKey === metric.key), metric.scope)
}

/** 最近事件时间(无 time 字段 → undefined). */
function latestEventTime(events: readonly SessionEventLike[]): number | undefined {
  let latest: number | undefined
  for (const event of events) {
    if (typeof event.time !== 'number' || !Number.isFinite(event.time)) continue
    if (latest === undefined || event.time > latest) latest = event.time
  }
  return latest
}

/** 评分状态 → 面板展示文案(没有分数就显示状态,不显示 0). */
function displayOf(row: StoredJudgeScore | undefined, config: JudgeConfig, metric: JudgeMetricDef): { display: string; status: JudgeScoreView['status'] } {
  if (row !== undefined) {
    switch (row.status) {
      case 'ok':
        return { display: row.value === true ? '通过' : '未过', status: 'ok' }
      case 'not_applicable':
        return { display: '不适用', status: 'not_applicable' }
      case 'error':
        return { display: '出错', status: 'error' }
      case 'skipped':
        return { display: '跳过', status: 'skipped' }
      case 'sampled_out':
        return { display: '未采样', status: 'sampled_out' }
      case 'pending':
        return { display: '排队中', status: 'pending' }
    }
  }
  if (config.metrics[metric.key] === false) return { display: '已停用', status: 'skipped' }
  if (config.route === null) return { display: '未配置裁判', status: 'skipped' }
  return { display: '待评', status: 'pending' }
}

/** 一条评分行 → 视图(内置与业务共用;业务行的名称/类别/范围随定义版本落库). */
function viewOfRow(
  row: StoredJudgeScore,
  fallbackRoute: JudgeScoreView['route'],
  labels?: ReadonlyMap<string, LabelMark>,
): JudgeScoreView {
  const route = row.provider !== null && row.model !== null ? { provider: row.provider, model: row.model } : fallbackRoute
  return {
    key: row.metricKey,
    name: row.metricName,
    category: row.category,
    scope: row.scope,
    status: row.status,
    value: row.status === 'ok' ? row.value : null,
    display: rowDisplay(row),
    pass: row.status === 'ok' ? row.value : null,
    ...row.rationale === null ? {} : { rationale: row.rationale },
    ...row.targetTurn === null ? {} : { turn: row.targetTurn },
    route,
    ...row.latencyMs === null ? {} : { latencyMs: row.latencyMs },
    ...row.tokens === null ? {} : { tokens: row.tokens },
    ...labelFields(row, labels),
  }
}

/** 已落库行的展示文案(没有分数就显示状态). */
function rowDisplay(row: StoredJudgeScore): string {
  switch (row.status) {
    case 'ok': return row.value === true ? '通过' : '未过'
    case 'not_applicable': return '不适用'
    case 'error': return '出错'
    case 'skipped': return '跳过'
    case 'sampled_out': return '未采样'
    case 'pending': return '排队中'
  }
}

/** 组装裁判视图:六项内置(缺行给显式状态)+ 业务已评条目(按 key 取最近一条). */
function buildScoreViews(
  config: JudgeConfig,
  rows: readonly StoredJudgeScore[],
  labels?: ReadonlyMap<string, LabelMark>,
): JudgeScoreView[] {
  const views: JudgeScoreView[] = BUILTIN_JUDGE_METRICS.map((metric) => {
    const row = latestForMetric(rows, metric)
    const { display, status } = displayOf(row, config, metric)
    const route = row !== undefined && row.provider !== null && row.model !== null
      ? { provider: row.provider, model: row.model }
      : config.route
    return {
      key: metric.key,
      name: metric.name,
      category: metric.category,
      scope: metric.scope,
      status,
      value: row?.status === 'ok' ? row.value : null,
      display,
      pass: row?.status === 'ok' ? row.value : null,
      ...row?.rationale === null || row?.rationale === undefined ? {} : { rationale: row.rationale },
      ...row?.targetTurn === null || row?.targetTurn === undefined ? {} : { turn: row.targetTurn },
      route,
      ...row?.latencyMs === null || row?.latencyMs === undefined ? {} : { latencyMs: row.latencyMs },
      ...row?.tokens === null || row?.tokens === undefined ? {} : { tokens: row.tokens },
      ...row === undefined ? {} : labelFields(row, labels),
    }
  })
  const businessKeys = [...new Set(rows.filter(row => findJudgeMetric(row.metricKey) === undefined).map(row => row.metricKey))]
  for (const key of businessKeys) {
    const row = latestRow(rows.filter(candidate => candidate.metricKey === key))
    if (row !== undefined) views.push(viewOfRow(row, config.route, labels))
  }
  return views
}

/** 人工复核回显标记(agrees + 标注当时的裁判值). */
interface LabelMark {
  readonly agrees: boolean
  readonly judgeValue: boolean
}

/** 评分/标注的身份键(会话内唯一):metric + scope + turn. */
function labelKeyOf(metricKey: string, scope: JudgeScope, turn: number | null): string {
  return JSON.stringify([metricKey, scope, scope === 'turn' ? turn : null])
}

/** 可复核 + 回显字段:只有「模型裁判 + ok 结论」可标注;评分重评后值变了不回显旧标注. */
function labelFields(
  row: StoredJudgeScore,
  labels: ReadonlyMap<string, LabelMark> | undefined,
): { readonly labelable?: boolean; readonly label?: 'agrees' | 'disagrees' } {
  const labelable = row.status === 'ok' && row.value !== null && row.provider !== null && row.model !== null
  if (!labelable) return {}
  const mark = labels?.get(labelKeyOf(row.metricKey, row.scope, row.targetTurn))
  if (mark === undefined || mark.judgeValue !== row.value) return { labelable: true }
  return { labelable: true, label: mark.agrees ? 'agrees' : 'disagrees' }
}

/** 一致率 / 混淆矩阵 / 校准状态 / 偏松偏紧(纯函数). */
function calibrationOf(labels: readonly StoredJudgeLabel[]): {
  readonly labeled: number
  readonly agrees: number
  readonly agreement: number | null
  readonly matrix: CalibrationMetricView['matrix']
  readonly status: CalibrationMetricView['status']
  readonly bias: CalibrationMetricView['bias']
} {
  let humanPassJudgePass = 0
  let humanPassJudgeFail = 0
  let humanFailJudgePass = 0
  let humanFailJudgeFail = 0
  let agrees = 0
  for (const label of labels) {
    if (label.agrees) agrees += 1
    if (label.judgeValue) {
      if (label.agrees) humanPassJudgePass += 1
      else humanFailJudgePass += 1
    } else if (label.agrees) humanFailJudgeFail += 1
    else humanPassJudgeFail += 1
  }
  const labeled = labels.length
  const agreement = labeled === 0 ? null : agrees / labeled
  const status: CalibrationMetricView['status'] = labeled === 0
    ? 'not_started'
    : labeled < CALIBRATION_MIN_SAMPLES
      ? 'insufficient'
      : (agreement ?? 0) >= CALIBRATION_MIN_AGREEMENT ? 'calibrated' : 'uncalibrated'
  const bias: CalibrationMetricView['bias'] = humanFailJudgePass > humanPassJudgeFail
    ? 'lenient'
    : humanPassJudgeFail > humanFailJudgePass ? 'strict' : 'balanced'
  return {
    labeled,
    agrees,
    agreement,
    matrix: { humanPassJudgePass, humanPassJudgeFail, humanFailJudgePass, humanFailJudgeFail },
    status,
    bias,
  }
}

/** 结果类综合结论(关键项全过才算通过;不适用按豁免计,缺评如实说未评). */
function buildOverall(config: JudgeConfig, rows: readonly StoredJudgeScore[]): JudgeSnapshot['overall'] {
  if (config.route === null) {
    return {
      level: 'unrated',
      label: '结果类：未配置裁判',
      reasons: ['未选择裁判模型，结果类指标不会产生评分。'],
    }
  }
  const gating = BUILTIN_JUDGE_METRICS.filter(metric =>
    metric.category === 'outcome' && metric.gating && config.metrics[metric.key] !== false)
  const judged = gating.map(metric => ({ metric, row: latestForMetric(rows, metric) }))
    .filter(entry => entry.row?.status === 'ok' || entry.row?.status === 'not_applicable')
  const builtinKeys = new Set(BUILTIN_JUDGE_METRICS.map(metric => metric.key))
  const businessRows = rows.filter(row => !builtinKeys.has(row.metricKey) && row.category === 'outcome')
  const businessGating = businessRows.filter(row => row.gating === true)
  const businessFailures = businessGating.filter(row => row.status === 'ok' && row.value === false)
  const failures = [
    ...judged.filter(entry => entry.row?.status === 'ok' && entry.row.value === false)
      .map(entry => ({ name: entry.metric.name })),
    ...businessFailures.map(row => ({ name: row.metricName })),
  ]
  const waived = [
    ...judged.filter(entry => entry.row?.status === 'not_applicable').map(entry => ({ name: entry.metric.name })),
    ...businessGating.filter(row => row.status === 'not_applicable').map(row => ({ name: row.metricName })),
  ]
  const softFails = BUILTIN_JUDGE_METRICS
    .filter(metric => metric.category === 'outcome' && !metric.gating && config.metrics[metric.key] !== false)
    .map(metric => ({ metric, row: latestForMetric(rows, metric) }))
    .filter(entry => entry.row?.status === 'ok' && entry.row.value === false)
  const reasons = [
    ...failures.map(entry => `${entry.name}未通过`),
    ...softFails.map(entry => `${entry.metric.name}未通过（非关键项，不进结论门控）`),
    ...businessRows.filter(row => row.gating !== true && row.status === 'ok' && row.value === false)
      .map(row => `${row.metricName}未通过（非关键项，不进结论门控）`),
    ...waived.map(entry => `${entry.name}不适用`),
  ]
  if (failures.length > 0) {
    return { level: 'warn', label: `结果类：${failures.length} 项关键项未过`, reasons }
  }
  if (judged.length < gating.length) {
    const missing = gating.filter(metric => !judged.some(entry => entry.metric.key === metric.key))
    reasons.push(...missing.map(metric => `${metric.name}尚未评`))
    return {
      level: 'unrated',
      label: `结果类：关键项未评全（${judged.length}/${gating.length}）`,
      reasons,
    }
  }
  return {
    level: 'pass',
    label: '结果类：通过',
    reasons: reasons.length > 0 ? reasons : ['关键项全部通过。'],
  }
}

/** 用量取整(预算比较用整数 token). */
function round(value: number): number {
  return Number.isFinite(value) ? Math.round(value) : 0
}
