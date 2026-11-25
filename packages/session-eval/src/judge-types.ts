/**
 * 裁判层共享词汇(56 号 §5.3/§5.4):评分记录、评分库快照与裁判配置。
 *
 * 与 `types.ts` 同一纪律:**浏览器半边可直接 import 本文件**——不得引入 node:
 * 模块或服务端依赖(esbuild 客户端构建会把 import 链整条打进来)。
 */

import type { BusinessMetric } from './business-metrics.ts'

/** 裁判路由(provider + model;结果面必须显示,换模型等于换榜单). */
export interface JudgeRoute {
  readonly provider: string
  readonly model: string
}

/** 一次判定的状态机(§5.3;只有 ok 进分母). */
export type JudgeStatus = 'ok' | 'error' | 'skipped' | 'not_applicable' | 'sampled_out' | 'pending'

/** 裁判指标类别(结果类判「做对没有」,过程类判「做得怎么样」). */
export type JudgeCategory = 'outcome' | 'process'

/** 评分目标粒度:结果类评整条会话,过程类评某一轮. */
export type JudgeScope = 'session' | 'turn'

/** 面板/快照里的单条裁判评分(结构面,客户端只读). */
export interface JudgeScoreView {
  /** 指标键(版本随键走,口径变更即换键或加版本号). */
  readonly key: string
  /** 中文指标名. */
  readonly name: string
  readonly category: JudgeCategory
  readonly scope: JudgeScope
  readonly status: JudgeStatus
  /** 判定值:true=通过,false=未通过,null=没有结论(错误/跳过/不适用). */
  readonly value: boolean | null
  /** 展示用文案(不把 null 显示成 0). */
  readonly display: string
  /** true=通过,false=发现问题,null=无结论(三态与 status 一致). */
  readonly pass: boolean | null
  /** 裁判给出的理由(≤200 字;错误时为错误摘要). */
  readonly rationale?: string
  /** 评分目标轮次(过程类必填,结果类缺省). */
  readonly turn?: number
  /** 裁判路由(结果必须可见;未配置时为 null). */
  readonly route: JudgeRoute | null
  /** 裁判调用耗时(毫秒;结果类/过程类都有,错误时也记). */
  readonly latencyMs?: number
  /** 裁判调用 token 总量(计费口径单列,不混入被测会话). */
  readonly tokens?: number
}

/** 裁判触发方式. */
export type JudgeTrigger = 'manual' | 'turn_end' | 'idle'

/** 裁判面板/快照区块. */
export interface JudgeSnapshot {
  /** unconfigured=未配置模型 / disabled=已配置未启用 / ready=可评 / running=有在途 / error=最近一次失败. */
  readonly state: 'unconfigured' | 'disabled' | 'ready' | 'running' | 'error'
  /** 每项裁判指标的最新评分(含未采样/错误的显式状态). */
  readonly scores: readonly JudgeScoreView[]
  /** 在途/排队中的评分任务数. */
  readonly pending: number
  /** 当日裁判用量(与业务用量单列). */
  readonly budget: { readonly usedTokens: number; readonly maxTokensPerDay: number }
  /** 结果类综合结论(关键项全过才算通过;无结论时不伪造通过). */
  readonly overall: { readonly level: 'pass' | 'warn' | 'unrated'; readonly label: string; readonly reasons: readonly string[] }
  /** 状态说明(未配置/未启用/预算用尽等,直接给用户看). */
  readonly note?: string
}

/** 生效配置(全局一份;设置分区读写). */
export interface JudgeConfig {
  /** 总开关:关闭时不自动抽样,turn_end 不触发(手动评测仍可用). */
  readonly enabled: boolean
  /** 裁判路由;null = 未配置(任何裁判调用都拒绝). */
  readonly route: JudgeRoute | null
  /** 自动抽样率(0..1):turn/end 后按概率抽一轮过程裁判. */
  readonly sampling: number
  /** 每日裁判 token 预算(超过后当日不再发新调用). */
  readonly budgetTokensPerDay: number
  /** 空闲终评延迟(L2):turn/end 后无新输入多久触发整条结果类裁判. */
  readonly idleTimeoutMs: number
  /** 按指标键启停(缺省视为启用). */
  readonly metrics: Readonly<Record<string, boolean>>
}

/** 账号覆盖层读面(设置分区「业务指标」;yaml = 当前文件原文的规范化形式). */
export interface BusinessMetricsView {
  readonly version: number
  readonly updatedAt: string
  readonly updatedBy: string
  readonly metrics: readonly BusinessMetric[]
  readonly yaml: string
  /** 文件损坏等说明(顶部提示;此时保存会被拒绝). */
  readonly warning?: string
}

/** 业务指标保存结果(客户端安全形状;不暴露文件系统路径). */
export type BusinessSaveReply =
  | { readonly ok: true; readonly version: number; readonly metric: BusinessMetric; readonly yaml: string }
  | { readonly ok: false; readonly code: 'conflict' | 'invalid' | 'io'; readonly error: string }

/** 设置分区读面:配置 + 可选的指标目录 + 可用 provider 目录 + 账号业务指标覆盖层. */
export interface JudgeSettingsView {
  readonly config: JudgeConfig
  readonly metrics: readonly {
    readonly key: string
    readonly name: string
    readonly category: JudgeCategory
    readonly scope: JudgeScope
    readonly gating: boolean
  }[]
  readonly providers: readonly { readonly id: string; readonly models: readonly string[] }[]
  /** 业务指标覆盖层(登录账号自己的 metrics.yaml). */
  readonly business?: BusinessMetricsView
  /** 配置损坏等说明(设置页顶部提示;保存一次即可修复). */
  readonly note?: string
}

/** 手动评测受理结果(计数 + 跳过原因;不把「排队中」当失败). */
export type JudgeEvaluateReply =
  | { readonly ok: true; readonly accepted: number; readonly pending: number; readonly skipped: readonly string[] }
  | { readonly ok: false; readonly code: 'unconfigured' | 'no_content' | 'budget' | 'invalid' | 'busy'; readonly message: string }

/** 设置保存结果(校验失败给中文原因,不写文件). */
export type JudgeSaveConfigReply =
  | { readonly ok: true; readonly config: JudgeConfig }
  | { readonly ok: false; readonly error: string }

/** 配置缺省值(未配置路由前不产生任何模型调用). */
export const DEFAULT_JUDGE_CONFIG: JudgeConfig = {
  enabled: false,
  route: null,
  sampling: 0.2,
  budgetTokensPerDay: 200_000,
  idleTimeoutMs: 120_000,
  metrics: {},
}

/** 单项评分理由的展示上限(面板正文 3 行内). */
export const JUDGE_RATIONALE_MAX = 200

/** 裁判输出 token 上限(单 JSON 对象;理由 ≤200 字). */
export const JUDGE_MAX_TOKENS = 320
