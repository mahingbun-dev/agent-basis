/**
 * 思考强度自动模式——启发式评分器(纯函数,零 I/O 零依赖):
 * 把一条用户消息(可选叠加会话上下文信号)映射到 [0,1] 复杂度分,再在目标模型
 * **声明的档位表**(adapter 按 effort 从小到大排序,见 dsh-llm LlmModelReasoningInfo
 * 契约)上按 `round(score*(n-1))` 取档。取档只在该数组上进行 ⇒ 天然适配各模型
 * 档位集差异(hy4 仅 low/high、luna 含 xhigh、部分模型无 reasoning 声明)。
 *
 * 设计纪律(2026-11-18 拍板):
 * - 确定性:同输入恒同输出,可单测、可审计(审计事件携带 score 复盘);
 * - 零额外 LLM 调用(小模型路由为二期方向,见 docs/dev/thinking-auto.md);
 * - 不承诺准确率——信号表只写设计意图,实效以审计回放评估;
 * - 全部阈值集中本文件头部常量,调参即改表;
 * - **V1 兼容**:`signals` 缺省时逐条走旧路径(回放对比的基线即此路径)。
 */
import type { ThinkingSessionSignals } from './thinking-context.ts'

export type { ThinkingSessionSignals }

/** 单条消息的评分输入(与宿主消息类型解耦:路由器负责从 ContentBlock 抽取)。 */
export interface ThinkingScoreInput {
  /** 文本块拼接(text 块 join '\n';无文本块为空串)。 */
  readonly text: string
  /** 是否携带附件/图片类块(附件=较重输入的廉价代理信号)。 */
  readonly hasAttachment: boolean
  /** 会话上下文信号(V2;缺省=V1 行为,供回放基线与降级)。 */
  readonly signals?: ThinkingSessionSignals
}

// ── 信号表(全部阈值集中于此;调参不改逻辑) ──────────────────────────

/** 基线:默认对话从「中档偏下」起步,留出双向调整空间。 */
const BASE_SCORE = 0.2

/** 全句寒暄/口头确认词(仅短消息整句命中才钳低,长句中出现不扣)。 */
const TRIVIAL_PHRASES = [
  '你好', '您好', 'hi', 'hello', '嘿', '在吗', '谢谢', '多谢', 'thanks', 'thank you',
  '好的', '好吧', '收到', '明白了', '了解了', '继续', 'ok', 'okay', '嗯', '哦',
  '再见', '拜拜', '辛苦了', '没问题',
]
/** 命中寒暄钳制后的分数上限(仍允许滑到最低档但不到 0,保留最小推理)。 */
const TRIVIAL_CAP = 0.15
/** 寒暄判定的整句长度上限(字符);超过则视为正文出现口头语,不钳。 */
const TRIVIAL_MAX_CHARS = 32

/** 深度任务词:命中一个 +DEEP_KEYWORD_BONUS,累计封顶 DEEP_KEYWORD_CAP。 */
const DEEP_KEYWORDS = [
  '深入', '透彻', '彻底', '排查', '诊断', '调试', '分析', '对比', '评估', '权衡',
  '架构', '设计', '方案', '规划', '重构', '优化', '性能', '瓶颈', '根因', '原理',
  '为什么', '原因', '机制', '区别', '差异', '优缺点', 'review',
  'debug', 'refactor', 'architecture', 'design', 'analyze', 'root cause', 'trade-off',
  'thorough', 'comprehensive', 'in depth', 'investigate', 'diagnose', 'why',
]
const DEEP_KEYWORD_BONUS = 0.15
const DEEP_KEYWORD_CAP = 0.3

/** 显式指令:用户直接点名思考力度时一锤定音(双向),压过其余信号叠加与偏置。 */
const EXPLICIT_HIGH = /深入思考|仔细思考|深度思考|多想|think (hard|deeply|more)|think step by step|step by step|一步一步|一步步想/
const EXPLICIT_HIGH_SCORE = 0.85
const EXPLICIT_LOW = /简短回答|简略回答|一句话|不用思考|无需思考|直接说|answer briefly|brief answer|be concise|short answer/
const EXPLICIT_LOW_SCORE = 0.1

/** 代码信号:围栏代码块或堆栈痕迹(改代码/查错类任务普遍需要更高推理)。 */
const CODE_PATTERN = /```|Traceback|stack trace|堆栈|调用栈|\bSyntaxError\b|\bTypeError\b|\bNullPointerException\b/
const CODE_BONUS = 0.2

/** 多问句(≥2 个问号)与编号列表(多步任务的外观信号)。 */
const MULTI_QUESTION_BONUS = 0.1
const LIST_PATTERN = /(^|\n)\s*(\d+[.、)]|[①②③④⑤⑥⑦⑧⑨⑩]|[-*+]\s+\[)/
const LIST_BONUS = 0.1

/** 附件/图片块:较重输入(读文件/看截图)加一档倾向。 */
const ATTACHMENT_BONUS = 0.15

/** 长度分档:<40 字符轻问降一点;>500 再升;>2000(超长材料)再升。 */
const SHORT_CHARS = 40
const SHORT_CUT = 0.1
const LONG_CHARS = 500
const LONG_BONUS = 0.1
const HUGE_CHARS = 2000
const HUGE_BONUS = 0.1

// ── 会话上下文信号表(V2,2026-11-18) ────────────────────────────────

/** 工具失败:最近一轮内每个失败 +0.15,累计封顶 +0.3(强「该想深点」信号)。 */
const TOOL_FAILURE_BONUS = 0.15
const TOOL_FAILURE_CAP = 0.3
/** 同一工具连续失败 ≥2:额外 +0.15(反复失败=方案层面有问题,不只是运气)。 */
const SAME_TOOL_BONUS = 0.15
/** 同题追问:与上一条用户消息二元组重叠 ≥0.6 且间隔 ≤10 分钟 → +0.15。 */
const FOLLOW_UP_BONUS = 0.15
const FOLLOW_UP_MIN_OVERLAP = 0.6
const FOLLOW_UP_MAX_GAP_MIN = 10
/** 上下文规模:窗口事件 ≥200 或近 3 条消息文本 ≥20000 字符 → 各 +0.1。 */
const SCALE_EVENTS = 200
const SCALE_CHARS = 20_000
const SCALE_BONUS = 0.1
/** 上轮档位弱先验:±0.05(居中 0.5 归一;回放无增益即删)。 */
const PREV_EFFORT_WEIGHT = 0.05
/** 有效偏置的死区:绝对值低于此视为 0(偏置早已过期)。 */
export const BIAS_DEAD_ZONE = 0.01
/** 偏置半衰期(墙钟):24h。 */
export const BIAS_HALF_LIFE_MS = 24 * 60 * 60 * 1000

/**
 * 偏置衰减(纯函数):按 backend 时间戳做 24h 半衰。
 * @param bias 写入时的偏置值 [-0.5,0.5]。
 * @param updatedAtMs 最近一次反馈的 epoch ms;≤0 表示从未反馈。
 * @param nowMs 读取时刻。
 */
export function decayBias(bias: number, updatedAtMs: number, nowMs: number): number {
  if (updatedAtMs <= 0 || bias === 0) return 0
  const elapsed = Math.max(0, nowMs - updatedAtMs)
  const decayed = bias * 0.5 ** (elapsed / BIAS_HALF_LIFE_MS)
  return Math.abs(decayed) < BIAS_DEAD_ZONE ? 0 : Math.max(-0.5, Math.min(0.5, decayed))
}

// ── 评分与取档 ──────────────────────────────────────────────────────

/** 上下文工作信号(失败/追问):出现时寒暄钳制不再生效("继续"≠闲聊)。 */
function hasWorkSignal(signals: ThinkingSessionSignals | undefined): boolean {
  if (signals === undefined) return false
  return signals.toolFailureStreak > 0
    || signals.sameToolFailureStreak >= 2
    || (signals.followUpOverlap >= FOLLOW_UP_MIN_OVERLAP
      && signals.followUpGapMinutes <= FOLLOW_UP_MAX_GAP_MIN)
}

/** 把一条消息折成 [0,1] 复杂度分;显式指令优先,其余信号线性叠加后钳位。 */
export function scoreMessage(input: ThinkingScoreInput): number {
  const text = input.text
  if (text === '' && !input.hasAttachment) return 0

  // 显式指令一锤定音(用户点名要深想/要简答,其余信号与偏置不再参与)
  if (EXPLICIT_HIGH.test(text)) return EXPLICIT_HIGH_SCORE
  if (EXPLICIT_LOW.test(text)) return EXPLICIT_LOW_SCORE

  // 寒暄钳制:仅整句即口头语(长度守卫)时生效;失败/追问在场时不钳(工作信号优先)
  const normalized = text.trim().toLowerCase()
  if (!hasWorkSignal(input.signals)
    && normalized.length <= TRIVIAL_MAX_CHARS && normalized.length > 0
    && TRIVIAL_PHRASES.some(phrase => normalized === phrase
      || normalized === `${phrase}!` || normalized === `${phrase}！` || normalized === `${phrase}？`
      || normalized === `${phrase}~`)) {
    return TRIVIAL_CAP
  }

  let score = BASE_SCORE
  if (text.length < SHORT_CHARS) score -= SHORT_CUT
  if (text.length > LONG_CHARS) score += LONG_BONUS
  if (text.length > HUGE_CHARS) score += HUGE_BONUS
  if (CODE_PATTERN.test(text)) score += CODE_BONUS
  // 半/全角问号均计入(? U+003F 与 ? U+FF1F)
  const questions = (text.match(/[?？]/gu) ?? []).length
  if (questions >= 2) score += MULTI_QUESTION_BONUS
  if (LIST_PATTERN.test(text)) score += LIST_BONUS
  if (input.hasAttachment) score += ATTACHMENT_BONUS
  let deepHits = 0
  for (const keyword of DEEP_KEYWORDS) {
    if (text.toLowerCase().includes(keyword)) deepHits += 1
    if (deepHits * DEEP_KEYWORD_BONUS >= DEEP_KEYWORD_CAP) break
  }
  score += Math.min(deepHits * DEEP_KEYWORD_BONUS, DEEP_KEYWORD_CAP)

  const signals = input.signals
  if (signals !== undefined) {
    score += Math.min(Math.max(0, signals.toolFailureStreak) * TOOL_FAILURE_BONUS, TOOL_FAILURE_CAP)
    if (signals.sameToolFailureStreak >= 2) score += SAME_TOOL_BONUS
    if (signals.followUpOverlap >= FOLLOW_UP_MIN_OVERLAP
      && signals.followUpGapMinutes <= FOLLOW_UP_MAX_GAP_MIN) score += FOLLOW_UP_BONUS
    if (signals.windowEvents >= SCALE_EVENTS) score += SCALE_BONUS
    if (signals.recentChars >= SCALE_CHARS) score += SCALE_BONUS
    if (signals.previousEffortRank !== undefined) {
      score += (signals.previousEffortRank - 0.5) * 2 * PREV_EFFORT_WEIGHT
    }
    // 偏置最后叠加且不参与"显式指令/寒暄"早返:用户当轮的明确指令优先于历史纠正
    // (语料/外部数据可能缺字段:非有限值按 0,避免 NaN 穿透钳位)
    score += Number.isFinite(signals.bias) ? signals.bias : 0
  }
  return Math.min(1, Math.max(0, score))
}

/**
 * 按分数取档:efforts 必须是 adapter 声明的**从小到大**档位数组
 * (dsh-llm LlmModelReasoningInfo 契约);只在该数组内取 ⇒ 永不产出
 * 模型不支持的档位(UNSUPPORTED_REASONING_EFFORT 不可能出现)。
 * 空数组返回 undefined(路由器视为「该模型无可选档」,跳过本轮改选)。
 */
export function pickEffort<T extends { readonly id: string }>(score: number, efforts: readonly T[]): T | undefined {
  if (efforts.length === 0) return undefined
  const index = Math.round(score * (efforts.length - 1))
  return efforts[Math.min(efforts.length - 1, Math.max(0, index))]
}
