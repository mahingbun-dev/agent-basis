/**
 * 思考强度自动模式——启发式评分器(纯函数,零 I/O 零依赖):
 * 把一条用户消息映射到 [0,1] 复杂度分,再在目标模型**声明的档位表**
 * (adapter 按 effort 从小到大排序,见 dsh-llm LlmModelReasoningInfo 契约)
 * 上按 `round(score*(n-1))` 取档。取档只在该数组上进行 ⇒ 天然适配各模型
 * 档位集差异(hy4 仅 low/high、luna 含 xhigh、部分模型无 reasoning 声明)。
 *
 * 设计纪律(2026-11-18 拍板):
 * - 确定性:同输入恒同输出,可单测、可审计(审计事件携带 score 复盘);
 * - 零额外 LLM 调用(小模型路由为二期方向,见 docs/dev/thinking-auto.md);
 * - 不承诺准确率——信号表只写设计意图,实效以审计回放评估;
 * - 全部阈值集中本文件头部常量,调参即改表。
 */

/** 单条消息的评分输入(与宿主消息类型解耦:路由器负责从 ContentBlock 抽取)。 */
export interface ThinkingScoreInput {
  /** 文本块拼接(text 块 join '\n';无文本块为空串)。 */
  readonly text: string
  /** 是否携带附件/图片类块(附件=较重输入的廉价代理信号)。 */
  readonly hasAttachment: boolean
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

/** 显式指令:用户直接点名思考力度时一锤定音(双向),压过其余信号叠加。 */
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

// ── 评分与取档 ──────────────────────────────────────────────────────

/** 把一条消息折成 [0,1] 复杂度分;显式指令优先,其余信号线性叠加后钳位。 */
export function scoreMessage(input: ThinkingScoreInput): number {
  const text = input.text
  if (text === '' && !input.hasAttachment) return 0

  // 显式指令一锤定音(用户点名要深想/要简答,其余信号不再参与)
  if (EXPLICIT_HIGH.test(text)) return EXPLICIT_HIGH_SCORE
  if (EXPLICIT_LOW.test(text)) return EXPLICIT_LOW_SCORE

  // 寒暄钳制:仅整句即口头语(长度守卫)时生效
  const normalized = text.trim().toLowerCase()
  if (normalized.length <= TRIVIAL_MAX_CHARS && normalized.length > 0
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
