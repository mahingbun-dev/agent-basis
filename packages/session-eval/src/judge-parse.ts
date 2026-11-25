/**
 * 裁判输出的严格校验(56 号 §5.2「输出必须经严格校验;校验不过记 error 而不是猜」)。
 *
 * 为什么不用 zod:本仓没有 zod 依赖,且裁判契约只有一个 JSON 对象、三个枚举值——
 * 手写校验器把「多余字段也拒绝」写清楚比引一个库更可读;测试逐条钉住行为。
 *
 * 严格性:
 * - 输出必须能解析为 JSON 对象(允许模型包裹一层 ```json 代码块——但只剥围栏,不修复内容);
 * - 字段**有且只有** `verdict` 与 `rationale`(多余键 = 校验失败);
 * - verdict 只能是 pass / fail / na;rationale 必须是 1..200 字的中文/任意文字;
 * - 任何不符 → {@link JudgeOutputError}(由编排层落 `error` 状态,不重试)。
 */

/** 裁判判定三态(与输出契约一致). */
export type JudgeVerdict = 'pass' | 'fail' | 'na'

/** 校验通过的裁判输出. */
export interface ParsedJudgeOutput {
  readonly verdict: JudgeVerdict
  readonly rationale: string
}

/** 裁判输出不合约(落 error 状态;不自动重试). */
export class JudgeOutputError extends Error {
  constructor(message: string) {
    super(`[session-eval] 裁判输出不合契约:${message}`)
    this.name = 'JudgeOutputError'
  }
}

/** 单个理由的字符上限(与提示词一致). */
const RATIONALE_MAX = 200

/** 剥一层代码块围栏(```json … ``` 或 ``` … ```),其余原样. */
function stripFence(text: string): string {
  const trimmed = text.trim()
  if (!trimmed.startsWith('```')) return trimmed
  const firstBreak = trimmed.indexOf('\n')
  if (firstBreak === -1) return trimmed
  const withoutOpen = trimmed.slice(firstBreak + 1)
  const close = withoutOpen.lastIndexOf('```')
  return close === -1 ? withoutOpen.trim() : withoutOpen.slice(0, close).trim()
}

/**
 * 校验裁判输出。
 * @param text - 模型输出的原始文本.
 * @returns 判定与理由.
 * @throws {JudgeOutputError} 不合约时(说明具体哪一条不满足)。
 */
export function parseJudgeOutput(text: string): ParsedJudgeOutput {
  const body = stripFence(text)
  if (body === '') throw new JudgeOutputError('输出为空')
  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch {
    throw new JudgeOutputError(`不是合法 JSON:${body.slice(0, 120)}`)
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new JudgeOutputError('顶层必须是 JSON 对象')
  }
  const record = parsed as Record<string, unknown>
  const keys = Object.keys(record).sort()
  if (keys.length !== 2 || keys[0] !== 'rationale' || keys[1] !== 'verdict') {
    throw new JudgeOutputError(`字段必须恰为 verdict 与 rationale(实得 ${keys.join(',') || '空'})`)
  }
  const verdict = record.verdict
  if (verdict !== 'pass' && verdict !== 'fail' && verdict !== 'na') {
    throw new JudgeOutputError(`verdict 只能是 pass/fail/na(实得 ${String(verdict)})`)
  }
  const rationale = record.rationale
  if (typeof rationale !== 'string' || rationale.trim() === '') {
    throw new JudgeOutputError('rationale 必须是非空字符串')
  }
  const trimmed = rationale.trim()
  if (trimmed.length > RATIONALE_MAX) throw new JudgeOutputError(`rationale 超过 ${RATIONALE_MAX} 字`)
  return { verdict, rationale: trimmed }
}

/** 判定 → 评分状态与值(value:true=通过;na 不进分母). */
export function verdictToScore(verdict: JudgeVerdict): { readonly status: 'ok' | 'not_applicable'; readonly value: boolean | null } {
  switch (verdict) {
    case 'pass':
      return { status: 'ok', value: true }
    case 'fail':
      return { status: 'ok', value: false }
    case 'na':
      return { status: 'not_applicable', value: null }
  }
}
