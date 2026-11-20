/**
 * M-M2 T7 提取执行(19 号 §4-T7):会话尾整固的 LLM 直调提取体——不用子代理,
 * 以 curator 角色(默认 Flash,config 可改)跑冻结提示词,产出结构化提案并落库。
 *
 * 设计依据(19 号 §4-T7 + 17 号 §2.4 Zcode extraction 先例 + 19a 号 S4 结论 A):
 * - **直调形态(S4-A2)**:`ctx.llm.prepareCall({provider, model, maxTokens}, signal)`
 *   → `deepFreeze({...call.config, system=冻结 prompt, 单条 identity-free user 消息})`
 *   → `call.stream(...)`(上游无 agent 一次性直调先例 dsh-session-title-llm 同款;
 *   `...call.config` 必须展开进 options,否则 INVALID_PREPARED_CALL)。不回放会话
 *   前缀、不传 tools/toolHistory(KV-cache 复用是 compaction 的回放专属技巧,
 *   提取是独立调用,直接 system+user 一发)。
 * - **类型面铁律(S4-A3)**:`purpose` 是上游封闭联合('compaction'|'session-title'),
 *   不得私造 'consolidation'——整固 job 无会话,留空即普通会话分类;sessionId/
 *   toolHistory 均可选,不传。
 * - **curator 路由**:只从 config 取模型名(19 §6 `consolidation.model`,缺省
 *   deepseek-flash);provider 经 listProviders/listModels 目录兜底扫描,扫不到回落
 *   'deepseek' 由 prepareCall 最终报错(不静默编造路由)。
 * - **冻结提示词**:EXTRACTION_PROMPT 与 tests/fixtures/extraction-prompt.md 逐字
 *   一致(单测钉住;语义对齐 Zcode:只用会话快照/禁止查证/附现有记忆清单查重/
 *   「Nothing to save」/显式记住-忘记立即执行)。
 * - **会话快照**:读冻结快照的 logPath(session.v4.jsonl.zstd 多帧容器,解码算法
 *   对齐 panel/src/session-logs.ts——panel 依赖 memory,不能反向 import,同源复制);
 *   只取真人类 user 消息与 assistant 文本块(合成注入与 reasoning 不进),截断保最近。
 *   读盘前先经 ctx.sessions 冲刷 durability checkpoint(turn 边界不保证已 flush,S1-B)。
 * - **提案解析**:Nothing 标记(含 Zcode 句点变体)→ nothing-to-save;JSON 数组
 *   防御式逐条校验(坏条目丢弃计数,fail-closed 于结构、容忍于条目);顶层不可
 *   解析 → ExtractionParseError(任务错误语义:游标不推进,待下次会话尾重试)。
 * - **落库**:统一走 Memory.writeEntity(source=consolidation/compaction,provenance
 *   盖章,review_state 按写入口既有规则判定);add/update 的实际决策以写入口四操作
 *   判定为准(模型 op 仅是意向);forget 物理真删(仅限用户显式要求,提示词纪律)。
 *   单条落库失败(PII 拦截/字段校验)跳过该条不炸整批,事实进报告与日志。
 * - **M-M3 T11 轻量扩展(19 号 §5-T11「域打标落库 + episodic 摘要落域」+ 18 §2
 *   episodic 落库形态)**:提案处理完后,为本次会话写一行会话史 episodic 记录——
 *   key=`session-<sessionId>`、subject=`domain:<会话绑定域>`(T10 未绑定的会话
 *   落 'default' 兜底域,不落候选域)、kind=episodic、confidence=0.5、
 *   source=consolidation、review_state 走既有规则(domain+episodic → approved
 *   静默档)。content=会话快照截断保最近(Gm0 单条 ≤2000 字口径)——v1 的
 *   「压缩摘要」取确定性形态(快照已剥 reasoning/合成注入并截断;LLM 压缩摘要
 *   需改冻结提取提示词的输出契约,暂缓);summary=首条真人类用户消息摘题。
 *   域打标落库:T10 已在首条用户消息侧把会话域持久化(domain_hit_sessions),
 *   本行把域归属落到 episodic 记录的 domain_key(18 §1.3「域归属同时写入会话
 *   元数据」)。PII 命中 → 本行跳过不炸任务(fail-closed,同提案纪律)。
 * - **审批卡片与账本(T9,19 号 §4-T9.2/T9.4 + 勘察 S2 结论)**:落库产生的
 *   待审行进报告(pending);提取任务在落库后组记忆审批卡片
 *   (buildMemoryApprovalCard,标题「从本次会话学到…」、Why=出处会话摘要经
 *   PiiGuard 回退、Action=记住/跳过)并连同计数/待审清单写一行提案审计
 *   (MemoryAuditLedger,送达=面板审批队列;官方 user-questions 通道为
 *   memoryApprovalAskRequest 预留切换面,S2 结论 3)。
 * - **Gm1 一致性闸(M-M2 T8,19 号 §4-T8)**:每条 add 提案入库前,对同 scope+kind
 *   的 live 行(查重面 liveRowsForDedup)取最大多词重叠;落在 [0.3, 0.9) → 一次
 *   LLM 矛盾判定(同 curator 路由,判定提示词冻结且与 fixture 逐字一致):
 *   矛盾 → 新提案独立入库 + supersede 旧行 / 互补 → 合并 UPDATE 进既有 key /
 *   无关 → 照 ADD(skipCrossKeyDedup,判定优先于 0.6 强制合并)。判定调用失败
 *   → 该提案拦截不落库(fail-closed,见 applyExtractionProposals 内注释)。
 *
 * - **M-C3 C10 压缩×记忆联动(22 号 §5-C10;2026-11-14)**:checkpoint 节点的
 *   分类约束——user/message 且 source.kind === 'compact-checkpoint'(上游
 *   dsh-compaction isCompactCheckpointSource 同判据)的节点是压缩检查点:快照
 *   识别并以「[压缩检查点(二手摘要)]」标注进材料(其内容仅作 episodic 线索);
 *   冻结提示词明示「二手摘要,无原始证据的断言不得提取为 semantic/procedural」;
 *   含 checkpoint 的会话,本次提取提案一律落 source='compaction'(T2 写入口
 *   强制 pending,full-auto 档也不放宽——摘要来源投毒防线),episodic 会话史行
 *   不受影响(仅作 episodic 线索是其被认可的用途,保持既有落库规则)。
 *
 * 纪律对齐 consolidation:coeffect 声明(ctx/memory/路由/上限构造注入);事件与
 * 输出解析全部防御式(isRecord 弱收窄)——库不信任宿主与模型输出形状。
 */
import { readFileSync } from 'node:fs'
import { zstdDecompressSync } from 'node:zlib'
import type { Context } from '@deepseek-ai/cordis'
import { BlockAssembler, LlmError } from '@deepseek-ai/dsh-llm'
import type { ContentBlock, FinishReason, RequestMessage, TokenUsage } from '@deepseek-ai/dsh-llm'
import { deepFreeze } from '@deepseek-ai/dsh-util-values'
import type { MemoryAuditCard, MemoryAuditLedger, MemoryAuditPendingItem } from './audit.ts'
import { buildMemoryApprovalCard, buildSessionDigest, MEMORY_REVIEW_GRADE } from './approval.ts'
import type { ConsolidationLogger, ConsolidationSnapshot, ConsolidationTask } from './consolidation.ts'
import { coerceDomainKey } from './entity-store.ts'
import type { EntityKind, EntityRecord, EntityWriteInput } from './entity-store.ts'
import { DEFAULT_DOMAIN_TAG_MAX_TOKENS, DOMAIN_TAGGING_PROMPT, buildDomainTaggingUserText } from './domain.ts'
import type { DomainTagger, DomainTaggerInput } from './domain.ts'
import {
  MEMORY_CONTENT_MAX_CHARS, MEMORY_DEDUP_NOOP_OVERLAP, MEMORY_GM1_JUDGE_MIN_OVERLAP,
  mergeMemoryContents, tokenOverlapRatio,
} from './memory.ts'
import type { Memory } from './memory.ts'

// ---------- 冻结提示词(与 tests/fixtures/extraction-prompt.md 逐字一致) ----------

/**
 * 提取提示词(冻结,system 位)。语义对齐 19 号 §4-T7 列表与 Zcode extraction
 * fixture:只用会话快照/禁止引用材料之外或假装查证/先对照现有记忆清单查重/
 * 没什么可记输出 Nothing to save/用户显式记住-忘记立即执行/输出结构化提案
 * [{op,scope,kind,domain_key?,key,content,summary?,confidence?}]。改动必须同步
 * fixture(单测逐字钉住),不得只改一处。
 */
export const EXTRACTION_PROMPT = [
  '# 记忆提取(curator,会话尾整固)',
  '',
  '你是一次性记忆提取器。分析下方「会话快照」,对照「现有记忆清单」,只提出值得跨会话长期保留的记忆提案。你没有工具、没有文件系统访问权,也不需要任何验证:只用给出的材料判断,不得引用或臆造材料之外的信息,不得假装已查证。',
  '',
  '## 提取纪律',
  '',
  '- 只提取确定对后续会话有帮助的内容;拿不准就不提取。用户画像(scope=user)提案尤其保守。',
  '- 仓库文档、AGENTS.md、NOTES 已记录的内容不提取;只对本次会话有意义、没有长期价值的内容不提取。',
  '- 一条记忆一个事实,正文自包含。',
  '- 相对日期(「下周」「昨天」)换算为绝对日期;负向措辞转为正向(记「周报用中文」,不记「周报不用英文」)。',
  '- 以「[压缩检查点(二手摘要)]」标注的内容来自压缩检查点:它是二手摘要,只作理解会话上下文的 episodic 线索;其中没有原始证据(用户原话、工具结果)支撑的断言,不得提取为 semantic/procedural。',
  '- 写入前先对照现有记忆清单查重:内容已被既有条目覆盖时不重复提案;应更新时用 update 并沿用既有条目的 key,不要新建重复条目。',
  '- 用户明确说「记住…」时,立即为该内容产出 add/update 提案;用户明确要求忘记某条记忆时,立即对既有条目产出 forget 提案(引用其 key)。除此之外禁止提出 forget——遗忘只能出于用户显式要求。',
  '',
  '## 输出格式(严格)',
  '',
  '- 没有值得保存的内容时,输出有且仅有一行:Nothing to save',
  '- 有提案时,输出有且仅有一个 JSON 数组,不附带任何其他文字、注释或代码块围栏:',
  '  [{"op":"add","scope":"domain","kind":"semantic","domain_key":"deploy","key":"deploy-blue-green","content":"部署采用蓝绿策略:先起新实例,健康检查通过后切流量。","summary":"部署用蓝绿","confidence":0.8}]',
  '- 字段口径:',
  '  - op:add(新建)/ update(更新既有条目,沿用其 key)/ forget(删除既有条目,引用其 key)',
  '  - scope:user(用户画像层,跨项目的用户偏好与习惯)/ domain(当前工作域的事实与结论)',
  '  - kind:semantic(事实)/ episodic(会话事件记录)/ procedural(怎么做:流程、步骤、方法)',
  '  - domain_key:kebab-case 域键;scope=domain 时必填,scope=user 时省略',
  '  - key:稳定记忆键,不含空白;add 自拟,update/forget 沿用既有条目的 key',
  '  - content:记忆正文,一个事实、自包含;forget 时可省略',
  '  - summary:可选,一句话摘要',
  '  - confidence:可选,0 到 1 的置信度',
].join('\n')

/** Nothing 门逐字标记(19 号 §4-T7;Zcode fixture 原文带句点,解析两态都收)。 */
export const NOTHING_TO_SAVE_MARKER = 'Nothing to save'

// ---------- curator 路由(S4-A3:模型只从 config 取,provider 目录兜底) ----------

/** curator 默认模型(Flash;evolve DEFAULT_MODEL_ROUTES.curator 同款口径)。 */
export const DEFAULT_CURATOR_MODEL = 'deepseek-flash'

/** 目录扫描无命中时的回落 provider(由 prepareCall 最终报错,不静默编造)。 */
export const FALLBACK_CURATOR_PROVIDER = 'deepseek'

/** 一次提取调用的输出 token 上限(提案 JSON 数组的量级)。 */
export const DEFAULT_EXTRACTION_MAX_TOKENS = 2_048

/** curator 路由(provider + model)。 */
export interface ExtractionRoute {
  readonly provider: string
  readonly model: string
}

/**
 * 解析 curator 路由:model 缺省 deepseek-flash;provider 经 listProviders/
 * listModels 目录兜底扫描(S4-A3 可选项)取首家含该模型的注册路由,扫描失败或
 * 无命中回落 'deepseek'——路由错误最终在 prepareCall 处显式报错。
 */
export async function resolveCuratorRoute(ctx: Context, model?: string): Promise<ExtractionRoute> {
  const target = model ?? DEFAULT_CURATOR_MODEL
  const discovered = await discoverProvider(ctx, target)
  return { provider: discovered ?? FALLBACK_CURATOR_PROVIDER, model: target }
}

/** 目录兜底扫描:逐家查模型目录,任何失败都降级(返回 undefined 交由回落)。 */
async function discoverProvider(ctx: Context, model: string): Promise<string | undefined> {
  try {
    for (const provider of ctx.llm.listProviders()) {
      try {
        const models = await ctx.llm.listModels(provider.id)
        if (models.some(entry => entry.id === model)) return provider.id
      } catch {
        // 单家适配器目录查询失败:试下一家(服务整体仍在)
      }
    }
  } catch {
    // 目录服务面异常:回落默认 provider,由 prepareCall 最终报错
  }
  return undefined
}

// ---------- curator 直调(S4-A2:prepareCall 一次性 one-shot) ----------

/** 直调可选项(输出上限与取消信号)。 */
export interface ExtractionCallOptions {
  readonly maxTokens?: number
  readonly signal?: AbortSignal
}

/** 一次成功直调的结果(文本输出 + 路由回显 + 用量审计)。 */
export interface ExtractionCallResult {
  readonly text: string
  readonly route: ExtractionRoute
  readonly maxTokens: number
  readonly usage?: TokenUsage
}

/**
 * 一次性提取直调:冻结 prompt 进 system(GenerateOptions.system 文档明写
 * 「System prompt text for one-shot callers」),会话快照+记忆清单进单条
 * identity-free user 消息(RequestUserInput,无 id/source);无会话所以不带
 * sessionId/toolHistory/purpose。终止映射照 compaction summarizer finishError:
 * error/aborted → LlmError;max-tokens → code=MAX_TOKENS(截断的提案 JSON 不可信)。
 * 实际管道在 runCuratorOneShot(T8 起与 Gm1 判定直调共享),此处只绑定提取提示词与上限。
 */
export async function runExtractionCall(
  ctx: Context,
  route: ExtractionRoute,
  userText: string,
  options: ExtractionCallOptions = {},
): Promise<ExtractionCallResult> {
  const maxTokens = options.maxTokens ?? DEFAULT_EXTRACTION_MAX_TOKENS
  const { text, usage } = await runCuratorOneShot(ctx, route, EXTRACTION_PROMPT, userText, maxTokens, '提取', options)
  return { text, route, maxTokens, ...(usage !== undefined && { usage }) }
}

/**
 * one-shot 直调共享核心(S4-A2 形态;提取/Gm1 判定/T10 域打标同管道、不同冻结
 * 提示词与上限):prepareCall → deepFreeze({...call.config, system=冻结提示词,
 * 单条 identity-free user 消息}) → call.stream → 文本块拼接。label 只进错误信息。
 * 导出面:域打标工厂 createDomainTagger 与提取/Gm1 共用本管道,禁止各写直调。
 */
export async function runCuratorOneShot(
  ctx: Context,
  route: ExtractionRoute,
  system: string,
  userText: string,
  maxTokens: number,
  label: string,
  options: ExtractionCallOptions,
): Promise<{ readonly text: string; readonly usage?: TokenUsage }> {
  const signal = options.signal
  const call = await ctx.llm.prepareCall({ provider: route.provider, model: route.model, maxTokens }, signal)
  const messages: RequestMessage[] = [{ role: 'user', content: [{ type: 'text', text: userText }] }]
  const streamOptions = deepFreeze({
    ...call.config,
    system,
    messages,
    maxTokens,
    ...(signal !== undefined ? { signal } : {}),
  })
  const assembler = new BlockAssembler()
  for await (const chunk of call.stream(streamOptions)) {
    signal?.throwIfAborted()
    assembler.push(chunk)
  }
  signal?.throwIfAborted()
  const error = finishError(assembler.finish, label)
  if (error !== undefined) throw error
  const text = blocksToText(assembler.blocks())
  if (text.trim().length === 0) throw new Error(`[memory] ${label}输出为空文本(模型未产出任何 text 块)`)
  return { text, ...(assembler.usage !== undefined && { usage: assembler.usage }) }
}

/** 终止原因 → fail-closed 错误(compaction summarizer.ts finishError 同款映射)。 */
function finishError(finish: FinishReason, label: string): Error | undefined {
  switch (finish.kind) {
    case 'error':
    case 'aborted': {
      return LlmError.fromFailure(finish.failure)
    }
    case 'max-tokens': {
      const truncated = new Error(`[memory] ${label}输出在 token 上限处截断(输出不完整)`) as Error & { code?: string }
      truncated.code = 'MAX_TOKENS'
      return truncated
    }
    default:
      return undefined
  }
}

/** 文本块投影(非 text 块跳过;提取输出按纯文本契约消费)。 */
function blocksToText(blocks: readonly ContentBlock[]): string {
  return blocks
    .filter((block): block is Extract<ContentBlock, { type: 'text' }> => block.type === 'text')
    .map(block => block.text)
    .join('\n')
}

// ---------- Gm1 一致性闸:LLM 矛盾判定(M-M2 T8,19 号 §4-T8) ----------

/**
 * Gm1 判定提示词(冻结,system 位;与 tests/fixtures/contradiction-judge-prompt.md
 * 逐字一致,单测钉住)。判定三态:矛盾(新顶旧)/互补(合并)/无关(照 ADD);
 * 只依据给出的两段文字,禁止臆造外部信息。改动必须同步 fixture,不得只改一处。
 */
export const CONTRADICTION_JUDGE_PROMPT = [
  '# 记忆一致性判定(curator,Gm1 一致性闸)',
  '',
  '你是记忆一致性判定器。判断下方「新提案」与「既有记忆」两段文字的关系。你没有工具、没有文件系统访问权,也不需要任何验证:只用给出的两段文字判断,不得引用或臆造外部信息,不得假装已查证。',
  '',
  '## 判定口径(输出有且仅有一行)',
  '',
  '- contradiction:两者对同一主题给出不相容的说法,采纳新提案则旧记忆必须作废(例:「周报用中文」与「周报改用英文」)。',
  '- complementary:两者互补,或是对同一事实的补充细化,应合并进既有条目(例:「周报用中文」与「周报用中文并附图表」)。',
  '- unrelated:重叠只是用词巧合,主题不同,新提案应独立保留(例:「周报用中文」与「界面用中文」)。',
  '',
  '## 输出格式(严格)',
  '',
  '只输出 contradiction、complementary、unrelated 三个词之一,不附带任何其他文字、注释或代码块围栏。',
].join('\n')

/** 一次判定直调的输出 token 上限(判定词一枚,余量容忍前后杂文)。 */
export const DEFAULT_JUDGMENT_MAX_TOKENS = 32

/** Gm1 判定结论(19 号 §4-T8:矛盾→新提案入库+supersede 旧行 / 互补→合并 UPDATE / 无关→照 ADD)。 */
export type Gm1Verdict = 'contradiction' | 'complementary' | 'unrelated'

/** 判定词全集(parseGm1Verdict 的收窄面)。 */
const GM1_VERDICTS: readonly Gm1Verdict[] = ['contradiction', 'complementary', 'unrelated']

/**
 * 判定输出解析:防御式收窄三个判定词(小写;容前后杂文,首个出现者胜——模型被
 * 要求只输出一词,杂文容差与 Zcode 判定面同款)。无判定词 → 抛错(上层按判定
 * 失败 fail-closed 拦截该提案,不猜)。
 */
export function parseGm1Verdict(text: string): Gm1Verdict {
  const lowered = text.trim().toLowerCase()
  let found: { verdict: Gm1Verdict; at: number } | undefined
  for (const verdict of GM1_VERDICTS) {
    const at = lowered.indexOf(verdict)
    if (at >= 0 && (found === undefined || at < found.at)) found = { verdict, at }
  }
  if (found === undefined) throw new Error(`[memory] Gm1 判定输出不可解析:${previewOf(lowered)}`)
  return found.verdict
}

/** 判定直调 user 消息正文:新提案与既有记忆两段装配(段落标题进提示词引用面)。 */
export function buildJudgmentUserText(incoming: string, existing: EntityRecord): string {
  return [
    '## 新提案',
    incoming,
    '',
    `## 既有记忆(${existing.subject}/${existing.key})`,
    existing.content,
  ].join('\n')
}

/**
 * Gm1 判定器 seam:一次 LLM 矛盾判定(incoming=提案正文,existing=判定区最大
 * 重叠 live 行)。失败(网络/终止/输出不可解析)上抛,由调用方
 * (applyExtractionProposals)fail-closed 拦截该提案。
 */
export type Gm1Judge = (incoming: string, existing: EntityRecord, signal?: AbortSignal) => Promise<Gm1Verdict>

/** createGm1Judge 构造选项(输出上限可注入,测试用)。 */
export interface Gm1JudgeOptions {
  readonly maxTokens?: number
}

/**
 * 组装真实判定器(同 curator 路由,19 号 §4-T8「一次 LLM 矛盾判定调用(同
 * Flash)」):runCuratorOneShot + 冻结判定提示词 + 三词收窄。signal 逐调用透传
 * (session close abort 语义:中止的判定按失败拦截,不落库)。
 */
export function createGm1Judge(ctx: Context, route: ExtractionRoute, options: Gm1JudgeOptions = {}): Gm1Judge {
  const maxTokens = options.maxTokens ?? DEFAULT_JUDGMENT_MAX_TOKENS
  return async (incoming, existing, signal) => {
    const { text } = await runCuratorOneShot(
      ctx, route, CONTRADICTION_JUDGE_PROMPT, buildJudgmentUserText(incoming, existing), maxTokens, '判定',
      { ...(signal !== undefined && { signal }) },
    )
    return parseGm1Verdict(text)
  }
}

/** Gm1 闸注入面(applyExtractionProposals 第 5 参):判定器 + 中止信号。 */
export interface Gm1Gate {
  readonly judge: Gm1Judge
  readonly signal?: AbortSignal
}

// ---------- T10 域打标工厂(19 号 §5-T10;复用 T7 curator 模型配置面) ----------

/** createDomainTagger 构造选项(输出上限可注入,测试用;缺省 DEFAULT_DOMAIN_TAG_MAX_TOKENS)。 */
export interface DomainTaggerOptions {
  readonly maxTokens?: number
}

/**
 * 组装会话域打标器(19 号 §5-T10「LLM(Flash,冻结 prompt)从 domain_registry
 * 已注册域中选」):同 curator 路由(复用 T7 的 resolveCuratorRoute/模型配置面)
 * + 冻结打标提示词(DOMAIN_TAGGING_PROMPT,domain.ts)。signal 缺席——打标在
 * 会话首条用户消息侧触发,无 session-close abort 链路;解析(parseDomainTagOutput)
 * 由 resolveDomain 统一执行,本工厂只返回模型原文。
 */
export function createDomainTagger(ctx: Context, route: ExtractionRoute, options: DomainTaggerOptions = {}): DomainTagger {
  const maxTokens = options.maxTokens ?? DEFAULT_DOMAIN_TAG_MAX_TOKENS
  return async (input: DomainTaggerInput): Promise<string> => {
    const { text } = await runCuratorOneShot(
      ctx, route, DOMAIN_TAGGING_PROMPT, buildDomainTaggingUserText(input), maxTokens, '打标', {},
    )
    return text
  }
}

// ---------- 提案模型与解析(防御式) ----------

/** 提案操作(add 新建 / update 更新既有 / forget 删除既有)。 */
export type ExtractionProposalOp = 'add' | 'update' | 'forget'

/** 提案作用域(user 画像层 / domain 工作域;org 已禁用,Q1 决议)。 */
export type ExtractionProposalScope = 'user' | 'domain'

/**
 * 一条结构化提取提案(19 号 §4-T7 输出契约)。add/update 的实际落库决策以
 * Memory.writeEntity 写入口四操作判定为准——模型的 op 只是意向,不信任。
 */
export interface MemoryExtractionProposal {
  readonly op: ExtractionProposalOp
  readonly scope: ExtractionProposalScope
  readonly kind: EntityKind
  /** 域键(kebab-case ≤64;scope=domain 时携带,缺省落 'default')。 */
  readonly domainKey?: string
  readonly key: string
  /** 记忆正文(forget 提案仅引用 key,正文可为空串)。 */
  readonly content: string
  readonly summary?: string
  readonly confidence?: number
}

/** 解析结果:Nothing 门 / 通过校验的提案集合(含被丢弃条目计数)。 */
export type ExtractionParseResult =
  | { readonly kind: 'nothing-to-save' }
  | { readonly kind: 'proposals'; readonly proposals: readonly MemoryExtractionProposal[]; readonly dropped: number }

/** 提取输出不可解析(任务失败:游标不推进,待下次会话尾重试)。 */
export class ExtractionParseError extends Error {
  override name = 'ExtractionParseError'
  constructor(detail: string) {
    super(`[memory] 提取输出不可解析:${detail}`)
  }
}

/**
 * 解析 curator 输出:Nothing 标记(含 Zcode 句点变体)→ nothing-to-save;
 * 否则抢救 JSON 数组(裸文/代码块围栏/前后杂文均可,evolve parseJsonLoose 同款
 * 口径的数组版)后逐条防御校验——结构坏(非 JSON/非数组)整体 fail,单条字段
 * 坏只丢弃该条并计数(好条目照常通过)。
 */
export function parseExtractionOutput(text: string): ExtractionParseResult {
  const trimmed = text.trim()
  if (trimmed === NOTHING_TO_SAVE_MARKER || trimmed === `${NOTHING_TO_SAVE_MARKER}.`) {
    return { kind: 'nothing-to-save' }
  }
  const value = parseLooseJsonArray(trimmed)
  if (value === undefined) throw new ExtractionParseError(previewOf(trimmed))
  if (!Array.isArray(value)) throw new ExtractionParseError(`顶层不是 JSON 数组:${previewOf(trimmed)}`)
  const proposals: MemoryExtractionProposal[] = []
  let dropped = 0
  for (const item of value) {
    const proposal = coerceProposal(item)
    if (proposal === null) {
      dropped += 1
      continue
    }
    proposals.push(proposal)
  }
  return { kind: 'proposals', proposals, dropped }
}

/** 抢救式 JSON 解析:原文 → 代码块围栏内 → 首尾中括号切片,逐候选尝试。 */
function parseLooseJsonArray(trimmed: string): unknown {
  const candidates: string[] = [trimmed]
  const fence = /```(?:json)?\s*([\s\S]*?)```/u.exec(trimmed)
  if (fence?.[1] !== undefined) candidates.push(fence[1].trim())
  const firstBracket = trimmed.indexOf('[')
  const lastBracket = trimmed.lastIndexOf(']')
  if (firstBracket >= 0 && lastBracket > firstBracket) candidates.push(trimmed.slice(firstBracket, lastBracket + 1))
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate)
    } catch {
      // 尝试下一个候选形态
    }
  }
  return undefined
}

/** 错误信息用的输出预览(截长,避免异常文本淹没日志)。 */
function previewOf(text: string): string {
  const chars = Array.from(text)
  return chars.length <= 80 ? chars.join('') : `${chars.slice(0, 80).join('')}…`
}

/** key 上限(与 entity-store FIELD_LIMITS.key 同值,前置校验免得写入口炸整批)。 */
const PROPOSAL_KEY_MAX = 128

/** 单条提案防御校验:字段齐、枚举合法、key 无空白且不超长;不合格返回 null 丢弃。 */
function coerceProposal(item: unknown): MemoryExtractionProposal | null {
  if (!isRecord(item)) return null
  const { op, scope, kind } = item
  if (op !== 'add' && op !== 'update' && op !== 'forget') return null
  if (scope !== 'user' && scope !== 'domain') return null
  if (kind !== 'semantic' && kind !== 'episodic' && kind !== 'procedural') return null
  const key = item['key']
  if (typeof key !== 'string' || key.length === 0 || key.length > PROPOSAL_KEY_MAX || /\s/u.test(key)) return null
  const rawContent = item['content']
  const content = typeof rawContent === 'string' ? rawContent : ''
  // forget 只引用既有 key;add/update 必须携带非空正文
  if (op !== 'forget' && content.trim().length === 0) return null
  const rawSummary = item['summary']
  const summary = typeof rawSummary === 'string' && rawSummary.trim().length > 0 ? rawSummary.trim() : undefined
  const rawConfidence = item['confidence']
  let confidence: number | undefined
  if (typeof rawConfidence === 'number' && Number.isFinite(rawConfidence)) {
    confidence = Math.min(1, Math.max(0, rawConfidence))
  } else if (rawConfidence !== undefined) {
    return null
  }
  const domainKey = scope === 'domain' ? coerceDomainKey(item['domain_key']) : undefined
  return {
    op,
    scope,
    kind,
    ...(domainKey !== undefined && { domainKey }),
    key,
    content,
    ...(summary !== undefined && { summary }),
    ...(confidence !== undefined && { confidence }),
  }
}

// ---------- 会话快照(session log → 提取材料) ----------

/**
 * 压缩 checkpoint 的 message source 判据(C10,22 号 §5-C10):上游
 * dsh-compaction `isCompactCheckpointSource` 同款——持久化 source 携带
 * `kind: 'compact-checkpoint'` 标记(另有 compactionId/sourceCommandId 关联
 * 字段,判据只看标记,不依赖关联字段形状)。防御式弱收窄,坏形状返回 false。
 */
export function isCompactionCheckpointSource(source: unknown): boolean {
  return isRecord(source) && source['kind'] === 'compact-checkpoint'
}

/** checkpoint 节点进快照的来源标注前缀(冻结提示词纪律行引用同一措辞,改动两处同步)。 */
export const CHECKPOINT_TRANSCRIPT_PREFIX = '[压缩检查点(二手摘要)] '

/**
 * 会话日志是否含压缩 checkpoint 节点(C10 提案来源判据):防御式逐行解析,
 * 任一 user/message 的 source 为 compact-checkpoint 即 true。以整份日志为准
 * (截断只影响快照材料量,不缩小二手摘要暴露面——fail-safe)。
 */
export function sessionLogHasCheckpoint(logText: string): boolean {
  for (const line of logText.split('\n')) {
    if (line.length === 0) continue
    let event: unknown
    try {
      event = JSON.parse(line)
    } catch {
      continue
    }
    if (!isRecord(event) || event['type'] !== 'user/message') continue
    const data = event['data']
    if (isRecord(data) && isCompactionCheckpointSource(data['source'])) return true
  }
  return false
}

/** 快照截断的默认消息条数上限(只取最近 N 条 user/assistant 消息)。 */
export const EXTRACTION_RECENT_MESSAGES = 60

/** 快照默认字符上限(超限丢最旧,保最近)。 */
export const EXTRACTION_MAX_TRANSCRIPT_CHARS = 24_000

/** 单个日志文件最大读取字节(对齐 panel MAX_LOG_BYTES;torn 尾帧按算法忽略)。 */
export const MAX_SESSION_LOG_BYTES = 8 * 1024 * 1024

/** zstd 魔数(LE):0xFD2FB528(panel/src/session-logs.ts 同值)。 */
const ZSTD_MAGIC = 4247762216

interface FrameRange { readonly start: number; readonly end: number }

/**
 * 扫描完整 zstd 帧(字节级走查,不解压);EOF 落在帧内 = torn 尾巴,忽略。
 * 算法逐行对齐 panel/src/session-logs.ts scanZstdFrames(deepseek-harness
 * persistence-jsonl 同源);panel 依赖 memory 不能反向 import,此处同源复制。
 */
function scanZstdFrames(buffer: Buffer): readonly FrameRange[] {
  const frames: FrameRange[] = []
  let offset = 0
  while (offset < buffer.length) {
    const start = offset
    if (buffer.length - offset < 4 || buffer.readUInt32LE(offset) !== ZSTD_MAGIC) break
    offset += 4
    if (offset === buffer.length) break
    const descriptor = buffer.readUInt8(offset)
    offset += 1
    if ((descriptor & 24) !== 0) break
    const contentSizeFlag = descriptor >>> 6
    const singleSegment = (descriptor & 32) !== 0
    const checksum = (descriptor & 4) !== 0
    const dictionaryFlag = descriptor & 3
    const dictionaryBytes = dictionaryFlag === 3 ? 4 : dictionaryFlag
    const contentSizeBytes = contentSizeFlag === 0 ? singleSegment ? 1 : 0 : 1 << contentSizeFlag
    const remainingHeaderBytes = (singleSegment ? 0 : 1) + dictionaryBytes + contentSizeBytes
    if (buffer.length - offset < remainingHeaderBytes) break
    offset += remainingHeaderBytes
    let lastBlock = false
    for (;;) {
      if (buffer.length - offset < 3) {
        lastBlock = true
        break
      }
      const blockHeader = buffer.readUIntLE(offset, 3)
      offset += 3
      lastBlock = (blockHeader & 1) !== 0
      const blockType = blockHeader >>> 1 & 3
      const blockSize = blockHeader >>> 3
      if (blockType === 3) {
        lastBlock = false
        break
      }
      const payloadBytes = blockType === 1 ? 1 : blockSize
      if (buffer.length - offset < payloadBytes) {
        lastBlock = true
        break
      }
      offset += payloadBytes
      if (lastBlock) break
    }
    if (!lastBlock) break
    if (checksum) {
      if (buffer.length - offset < 4) break
      offset += 4
    }
    frames.push({ start, end: offset })
  }
  return frames
}

/** 解码多帧 zstd 容器(每帧独立 one-shot 解压,拼接为完整日志文本)。 */
export function decodeZstdLog(buffer: Buffer): string {
  const parts: string[] = []
  for (const frame of scanZstdFrames(buffer)) {
    parts.push(zstdDecompressSync(buffer.subarray(frame.start, frame.end)).toString('utf8'))
  }
  return parts.join('')
}

/** 快照构建选项(条数/字符上限均可注入,测试与宿主可调)。 */
export interface SessionTranscriptOptions {
  readonly recentMessages?: number
  readonly maxChars?: number
}

/**
 * 会话日志(JSONL 事件流)→ 提取用会话快照:只认真人类 user 消息
 * (source.kind === 'user',与三门控 prose 口径同源)、压缩 checkpoint 节点
 * (C10:标注「二手摘要」进材料,内容仅作 episodic 线索)与 assistant 文本块
 * (reasoning 不进);其余合成注入(file-change/skill/cron)不是用户表达,不进。
 * 坏行/非 JSON 行忽略不炸;截断丢最旧并在首行注明丢弃条数。
 */
export function buildSessionTranscript(logText: string, options: SessionTranscriptOptions = {}): string {
  const recent = options.recentMessages ?? EXTRACTION_RECENT_MESSAGES
  const maxChars = options.maxChars ?? EXTRACTION_MAX_TRANSCRIPT_CHARS
  const entries: string[] = []
  for (const line of logText.split('\n')) {
    if (line.length === 0) continue
    let event: unknown
    try {
      event = JSON.parse(line)
    } catch {
      continue
    }
    if (!isRecord(event)) continue
    const data = event['data']
    if (!isRecord(data)) continue
    if (event['type'] === 'user/message') {
      if (isRecord(data['source']) && data['source']['kind'] === 'user') {
        const text = textBlocksOf(data['content'])
        if (text.length > 0) entries.push(`[用户] ${text}`)
        continue
      }
      // C10:压缩 checkpoint 节点(二手摘要)以独立标注进快照——提取器据冻结
      // 提示词的分类纪律约束其用途(仅 episodic 线索;不得据此提 semantic/procedural)
      if (isCompactionCheckpointSource(data['source'])) {
        const text = textBlocksOf(data['content'])
        if (text.length > 0) entries.push(`${CHECKPOINT_TRANSCRIPT_PREFIX}${text}`)
      }
      continue
    }
    if (event['type'] === 'assistant/message') {
      const message = data['message']
      if (isRecord(message)) {
        const text = textBlocksOf(message['content'])
        if (text.length > 0) entries.push(`[助手] ${text}`)
      }
    }
  }
  let kept = entries.slice(-recent)
  let droppedCount = entries.length - kept.length
  while (kept.length > 0 && kept.reduce((total, entry) => total + entry.length, 0) > maxChars) {
    kept = kept.slice(1)
    droppedCount += 1
  }
  if (droppedCount > 0) return [`(更早的 ${droppedCount} 条消息已截断)`, ...kept].join('\n')
  return kept.join('\n')
}

/** content 块数组的文本块拼接(非 text 块不贡献;块间以空格相连)。 */
function textBlocksOf(content: unknown): string {
  if (!Array.isArray(content)) return ''
  const parts: string[] = []
  for (const block of content) {
    if (isRecord(block) && block['type'] === 'text' && typeof block['text'] === 'string') {
      if (block['text'].trim().length > 0) parts.push(block['text'].trim())
    }
  }
  return parts.join(' ')
}

// ---------- 现有记忆 manifest(提案前查重面) ----------

/** manifest 默认行数上限(live 行按置信度降序来,超出截断并注明)。 */
export const EXTRACTION_MANIFEST_MAX_ROWS = 200

/** manifest 摘要预览上限(字符)。 */
const MANIFEST_EXCERPT_CHARS = 40

/**
 * live 记忆行 → 现有记忆清单文本(Zcode「附现有 manifest 要求查重」同款):
 * 每行 `- [scope/kind] key:摘要(confidence …)`;空清单给 `(无)` 占位
 * (占位保持清单段落恒在,提示词引用不悬空)。
 */
export function buildMemoryManifest(records: readonly EntityRecord[], maxRows: number = EXTRACTION_MANIFEST_MAX_ROWS): string {
  if (records.length === 0) return '(无)'
  const lines: string[] = []
  for (const record of records.slice(0, maxRows)) {
    const scope = record.scope === 'user' ? 'user' : `domain:${record.domainKey ?? 'default'}`
    lines.push(`- [${scope}/${record.kind}] ${record.key}:${record.summary ?? excerptOf(record.content)}(confidence ${record.confidence.toFixed(2)})`)
  }
  if (records.length > maxRows) lines.push(`- ……(另有 ${records.length - maxRows} 条省略)`)
  return lines.join('\n')
}

/** 摘要缺省时从正文取预览(首 N 字符)。 */
function excerptOf(content: string): string {
  const chars = Array.from(content.trim())
  return chars.length <= MANIFEST_EXCERPT_CHARS ? chars.join('') : `${chars.slice(0, MANIFEST_EXCERPT_CHARS).join('')}…`
}

/** 直调 user 消息正文:会话快照 + 现有记忆清单两段装配(段落标题进提示词引用面)。 */
export function buildExtractionUserText(input: { readonly transcript: string; readonly manifest: string }): string {
  return [
    '## 会话快照(只依据以下材料提取)',
    input.transcript.length === 0 ? '(本段会话无用户/助手文本)' : input.transcript,
    '',
    '## 现有记忆清单(提案前查重;update/forget 须沿用其中 key)',
    input.manifest,
  ].join('\n')
}

// ---------- 提案落库(writeEntity 统一写入口) ----------

/** 落库来源:整固提取(consolidation)与 compaction 摘要提案(compaction,强制 pending)。 */
export type ExtractionSource = 'consolidation' | 'compaction'

/** 提案 provenance(整固任务盖章:出处会话 + 会话尾轮次)。 */
export interface ProposalProvenance {
  readonly sessionId: string
  readonly turnRef: string
  readonly source: ExtractionSource
}

/** 落库报告(决策计数 + 被跳过条目的原因,进任务 detail 与审计日志)。 */
export interface ProposalApplyReport {
  readonly add: number
  readonly update: number
  readonly noop: number
  /** forget 实际物理删除的行数合计(不存在的 key 计 0 不炸)。 */
  readonly forgotten: number
  /** Gm1 矛盾判定顶替软失效(supersede)的旧行数;非 Gm1 路径恒 0。 */
  readonly superseded: number
  readonly skipped: number
  readonly skipReasons: readonly string[]
  /**
   * 本次落库产生的待审行(T9 审批闭环数据源:卡片组卡 + 面板审批队列 +
   * 提案审计行的 pending 清单)。判定口径 = writeEntity 返回行的
   * reviewState === 'pending'(写入口分级卡控的产物;noop 未写行不入)。
   */
  readonly pending: readonly EntityRecord[]
}

/**
 * 提案落库(异步:T8 起整固链路在入库前过 Gm1 一致性闸):统一走
 * Memory.writeEntity(source=consolidation/compaction,provenance 盖章,
 * review_state 由写入口既有规则判定);add/update 的实际决策以写入口四操作
 * 判定为准。gm1 缺席(非整固调用面/单测)时不过一致性闸,行为与 T7 一致。
 *
 * Gm1 一致性闸(19 号 §4-T8):仅对 add 提案——对同 scope+kind 的 live 行
 * (查重面)取最大多词重叠,落在 [MEMORY_GM1_JUDGE_MIN_OVERLAP, NOOP) →
 * 一次 LLM 判定:矛盾 → 新提案独立入库(skipCrossKeyDedup)+ supersede 旧行;
 * 互补 → 合并 UPDATE 进既有 key(mergeMemoryContents,Gm0 2000 字裁剪);
 * 无关 → 照 ADD(skipCrossKeyDedup——判定优先于写入口 0.6 强制合并启发式)。
 *
 * 单条失败(PII 拦截/字段校验/Gm0 超长/单域超限)跳过该条不炸整批:被拦内容
 * 绝不落盘,其余好条目照常入库,失败事实进报告与 warn 日志。
 *
 * Gm1 判定调用失败 → 该提案**拦截不落库(fail-closed)**,不降级照 ADD:
 * 18 号 §3.2 PII fail-closed 的精神是「安全机制失效时宁可不放行未检查的
 * 内容」——重叠 30–90% 的提案正是本闸要对账的矛盾/重复高危区,判定缺席时
 * 放行等于在最需要对账的时刻弃守;且误放一条矛盾记忆会污染既有 user/domain
 * 层、需人工 supersede/reject 清理,而漏记一条的代价只是该内容仍留在会话日志
 * (用户下次提到仍可被提取),代价不对称,故选拦截。逐条拦截不炸整批(与 PII
 * 单条跳过同构:不中断任务,游标照常推进),失败事实进 skipReasons 与 warn。
 */
export async function applyExtractionProposals(
  memory: Memory,
  proposals: readonly MemoryExtractionProposal[],
  provenance: ProposalProvenance,
  logger?: ConsolidationLogger,
  gm1?: Gm1Gate,
): Promise<ProposalApplyReport> {
  const counts = { add: 0, update: 0, noop: 0, forgotten: 0, superseded: 0, skipped: 0 }
  const skipReasons: string[] = []
  const pending: EntityRecord[] = []
  const tally = (result: { readonly decision: 'add' | 'update' | 'noop' }): void => {
    if (result.decision === 'add') counts.add += 1
    else if (result.decision === 'update') counts.update += 1
    else counts.noop += 1
  }
  // T9:落库行收口(review_state 分级卡控的待审行进报告——审批队列与卡片组卡
  // 的唯一数据源;noop 未写行、forget 物理删无行,都不进)
  const write = (input: EntityWriteInput): { readonly decision: 'add' | 'update' | 'noop' } => {
    const result = memory.writeEntity(input)
    if (result.record.reviewState === 'pending') pending.push(result.record)
    return result
  }
  for (const proposal of proposals) {
    try {
      if (proposal.op === 'forget') {
        counts.forgotten += memory.forget(subjectOf(proposal), proposal.key).forgotten
        continue
      }
      if (proposal.op === 'add' && gm1 !== undefined) {
        const candidate = findGm1Candidate(memory, proposal)
        if (candidate !== undefined) {
          let verdict: Gm1Verdict
          try {
            verdict = await gm1.judge(proposal.content, candidate.row, gm1.signal)
          } catch (error) {
            // fail-closed 拦截(取舍见函数头注释);其余提案照常
            counts.skipped += 1
            const reason = error instanceof Error ? error.message : String(error)
            skipReasons.push(`${proposal.key}:Gm1 判定失败拦截(fail-closed):${reason}`)
            logger?.warn?.(`[memory] Gm1 判定调用失败,提案拦截不落库(${proposal.key}):${reason}`)
            continue
          }
          if (verdict === 'contradiction') {
            // 矛盾:新提案独立入库 + 旧行 Gm1 软失效(先写后 supersede——若候选行
            // 恰为同键行,同键顶替已使其失效,supersede 返回 null 幂等无害)
            tally(write({ ...writeInputOf(proposal, provenance), skipCrossKeyDedup: true }))
            if (memory.supersede(candidate.row.id) !== null) counts.superseded += 1
            continue
          }
          if (verdict === 'complementary') {
            // 互补:合并 UPDATE 进既有 key(正文确定性合并 + Gm0 2000 字裁剪;
            // 完全被涵盖时合并正文=既有 → 写入口同键 noop,语义自洽)
            const { row } = candidate
            const merged = mergeMemoryContents(row.content, proposal.content)
            const summary = proposal.summary ?? row.summary
            tally(write({
              subject: row.subject,
              key: row.key,
              content: merged,
              ...(summary !== null && { summary }),
              confidence: Math.max(row.confidence, proposal.confidence ?? 0.8),
              kind: row.kind,
              scope: row.scope,
              ...(row.domainKey !== null && { domainKey: row.domainKey }),
              source: provenance.source,
              originSessionId: provenance.sessionId,
              originTurnRef: provenance.turnRef,
            }))
            continue
          }
          // 无关:照 ADD(skipCrossKeyDedup——高重叠对(≥0.6)不再被强制合并)
          tally(write({ ...writeInputOf(proposal, provenance), skipCrossKeyDedup: true }))
          continue
        }
      }
      // 判定区外(<0.3 / ≥0.9)或非 add 提案:走写入口四操作(既有 T7 语义)
      tally(write(writeInputOf(proposal, provenance)))
    } catch (error) {
      counts.skipped += 1
      const reason = error instanceof Error ? error.message : String(error)
      skipReasons.push(`${proposal.key}:${reason}`)
      logger?.warn?.(`[memory] 提取提案落库被跳过(${proposal.key}):${reason}`)
    }
  }
  return { ...counts, pending, skipReasons }
}

/**
 * Gm1 判定区检测(纯读):add 提案对同 scope+kind(+域)live 行的最大多词重叠
 * 落在 [0.3, NOOP=0.9) → 返回最大重叠行。≥0.9 交 Gm0 NOOP 拒写(判了也进
 * 不了库,不花调用);<0.3 视作无关照 ADD(19 号 §4-T8「重叠 30–90% 区间做
 * 一次 LLM 矛盾判定」)。扫描面与写入口查重同源(liveRowsForDedup,含
 * pending 行),取首个最大重叠(排序稳定)。
 */
function findGm1Candidate(
  memory: Memory,
  proposal: MemoryExtractionProposal,
): { readonly row: EntityRecord; readonly ratio: number } | undefined {
  let best: { row: EntityRecord; ratio: number } | undefined
  for (const row of memory.entities.liveRowsForDedup({
    subject: subjectOf(proposal),
    scope: proposal.scope,
    kind: proposal.kind,
    ...(proposal.domainKey !== undefined && { domainKey: proposal.domainKey }),
  })) {
    const ratio = tokenOverlapRatio(row.content, proposal.content)
    if (ratio >= MEMORY_GM1_JUDGE_MIN_OVERLAP && ratio < MEMORY_DEDUP_NOOP_OVERLAP && (best === undefined || ratio > best.ratio)) {
      best = { row, ratio }
    }
  }
  return best
}

/** 提案 → writeEntity 入参(provenance 盖章;review_state 由写入口分级判定)。 */
function writeInputOf(proposal: MemoryExtractionProposal, provenance: ProposalProvenance): EntityWriteInput {
  return {
    subject: subjectOf(proposal),
    key: proposal.key,
    content: proposal.content,
    ...(proposal.summary !== undefined && { summary: proposal.summary }),
    ...(proposal.confidence !== undefined && { confidence: proposal.confidence }),
    kind: proposal.kind,
    scope: proposal.scope,
    ...(proposal.domainKey !== undefined && { domainKey: proposal.domainKey }),
    source: provenance.source,
    originSessionId: provenance.sessionId,
    originTurnRef: provenance.turnRef,
  }
}

/** 提案 → subject(新编码:user / domain:<域键>;缺省域键落 'default')。 */
function subjectOf(proposal: MemoryExtractionProposal): string {
  return proposal.scope === 'user' ? 'user' : `domain:${proposal.domainKey ?? 'default'}`
}

// ---------- T7 提取执行体(ConsolidationTask seam 实现) ----------

/** ctx.sessions 的冲刷消费面(结构收窄;真实宿主由 dsh-session 增广满足)。 */
interface SessionsFlushFace {
  get(id: string): unknown
  flush(session: unknown): Promise<boolean>
}

/**
 * 读盘前等 durability checkpoint(turn 边界不保证已 flush,19a 号 S1-B):活会话
 * 经 ctx.sessions.flush 冲刷;服务缺席或会话不 live(已 dispose,卸载时已 drain)
 * 跳过等待。flush 异常上抛 = 任务失败,游标不推进待重试。
 */
async function flushSessionLog(ctx: Context, sessionId: string): Promise<void> {
  const sessions = (ctx as { readonly sessions?: SessionsFlushFace }).sessions
  if (sessions === undefined) return
  const session = sessions.get(sessionId)
  if (session === undefined) return
  await sessions.flush(session)
}

/** T7 提取执行体构造选项(coeffect 注入:ctx/memory/路由/上限/截断参数)。 */
export interface ExtractionTaskOptions {
  readonly ctx: Context
  readonly memory: Memory
  /** curator 模型名(19 §6 consolidation.model;缺省 Flash)。 */
  readonly model?: string
  /** 显式整路由覆写(优先于 model;部署侧已知 provider 时免目录扫描)。 */
  readonly route?: ExtractionRoute
  readonly maxTokens?: number
  /** Gm1 判定直调的输出 token 上限(缺省 DEFAULT_JUDGMENT_MAX_TOKENS;测试注小值)。 */
  readonly judgmentMaxTokens?: number
  /**
   * 落库来源(缺省 consolidation;compaction 摘要提案 → 强制 pending)。
   * C10:会话日志含压缩 checkpoint 时提案一律落 source='compaction'(强制
   * pending),本配置被该判据覆盖——投毒防线不随调用方配置放宽。
   */
  readonly source?: ExtractionSource
  readonly logger?: ConsolidationLogger
  readonly recentMessages?: number
  readonly maxTranscriptChars?: number
  readonly manifestMaxRows?: number
  /**
   * 会话域归属读取面(M-M3 T11 轻量扩展,与 attachMemory 的 domainOf 同形):
   * episodic 会话史行按此落域(glue 穿线 wireDomainContext 的绑定域;未绑定/
   * 缺席回落 'default' 兜底域)。缺席=不落 episodic 会话史行(T10 之前形态)。
   */
  readonly domainOf?: (sessionId: string) => string | undefined
  /**
   * 记忆审计账本(T9,19 号 §4-T9.4):提供时每次落库后写一行提案审计
   * (计数 + 待审清单;有待审行时组卡片并把渲染 detail 一并落账)。缺席时
   * 不落账(T6/T7 原形态)。落账失败 fail-open(账本自身 warn,不炸任务——
   * 提案已落库,抛错会令游标不推进而整段重跑提取)。
   */
  readonly audit?: MemoryAuditLedger
  /** 卡片影响面的记忆库展示路径(缺省 '.eterna/memory.sqlite3')。 */
  readonly storeLabel?: string
}

/**
 * T7 提取执行体(替换 T6 骨架的 SKELETON_CONSOLIDATION_TASK,seam 形态不变):
 * 快照 logPath 读盘(缺席 → nothing-to-save,已处理不重试)→ 冲刷 → 会话快照
 * (无文本 → nothing-to-save)→ manifest → curator 直调 → 解析 → 落库
 * → T9 提案审计(账本提供时:一行提案事件,有待审行时组卡片同落)
 * → M-M3 T11 轻量扩展:episodic 会话史行落域(见函数头)。
 * 抛错(解析失败/LLM 终止异常/读盘失败)= 任务失败,游标不推进待重试(T6 语义)。
 */
export function createExtractionTask(options: ExtractionTaskOptions): ConsolidationTask {
  return async (snapshot, signal) => {
    if (snapshot.logPath === null) {
      return { kind: 'nothing-to-save', detail: '会话日志缺席,无从提取(已处理,不重试)' }
    }
    await flushSessionLog(options.ctx, snapshot.sessionId)
    let logText: string
    try {
      logText = decodeZstdLog(readFileSync(snapshot.logPath).subarray(0, MAX_SESSION_LOG_BYTES))
    } catch (error) {
      throw new Error(`[memory] 会话日志读取失败(${snapshot.logPath}):${error instanceof Error ? error.message : String(error)}`)
    }
    // C10(22 号 §5-C10):日志含压缩 checkpoint → 本次提取的提案一律按二手摘要
    // 来源落库(source='compaction' → 写入口强制 pending,full-auto 档也不放宽,
    // memory.ts resolveWriteReviewState)。判据以整份日志为准(fail-safe:截断
    // 只影响快照材料量,不缩小二手摘要暴露面),且优先于 options.source 显式配置
    // ——投毒防线不随调用方配置放宽。episodic 会话史行不走本来源(仅作 episodic
    // 线索是其被认可用途,保持既有落库规则)。
    const proposalSource: ExtractionSource = sessionLogHasCheckpoint(logText)
      ? 'compaction'
      : (options.source ?? 'consolidation')
    const transcript = buildSessionTranscript(logText, {
      ...(options.recentMessages !== undefined && { recentMessages: options.recentMessages }),
      ...(options.maxTranscriptChars !== undefined && { maxChars: options.maxTranscriptChars }),
    })
    if (transcript.length === 0) {
      return { kind: 'nothing-to-save', detail: '会话快照无用户/助手文本,无从提取' }
    }
    const manifest = buildMemoryManifest(options.memory.entities.listLive(), options.manifestMaxRows)
    const route = options.route ?? await resolveCuratorRoute(options.ctx, options.model)
    const call = await runExtractionCall(
      options.ctx,
      route,
      buildExtractionUserText({ transcript, manifest }),
      { ...(options.maxTokens !== undefined && { maxTokens: options.maxTokens }), signal },
    )
    const parsed = parseExtractionOutput(call.text)
    let report: ProposalApplyReport | undefined
    if (parsed.kind === 'proposals') {
      // T8:提案入库前过 Gm1 一致性闸(同 curator 路由判定;signal 透传——
      // session close 中止的判定按失败拦截该提案,游标不推进语义不受影响)
      report = await applyExtractionProposals(options.memory, parsed.proposals, {
        sessionId: snapshot.sessionId,
        turnRef: `turn:${snapshot.lastTurn}`,
        source: proposalSource,
      }, options.logger, {
        judge: createGm1Judge(options.ctx, route, {
          ...(options.judgmentMaxTokens !== undefined && { maxTokens: options.judgmentMaxTokens }),
        }),
        signal,
      })
      recordProposalAudit(options, snapshot.sessionId, snapshot.lastTurn, report, transcript, proposalSource)
    }
    // M-M3 T11 轻量扩展:episodic 会话史行落域(Nothing 门不拦——18 §2
    // 「每会话一行」的落库形态,无关提取产出多少);T-A3:正文 curator 压缩摘要
    const episodicWritten = await writeSessionEpisodicSummary(options, snapshot, transcript, route, signal)
    if (parsed.kind === 'nothing-to-save' && episodicWritten === false) {
      return { kind: 'nothing-to-save', detail: `Nothing to save(${route.provider}/${route.model})` }
    }
    const episodicDetail = episodicWritten === false
      ? ';episodic 会话史跳过(PII/校验)'
      : episodicWritten === 'llm' ? ';episodic 会话史落域(摘要)' : ';episodic 会话史落域(原文回落)'
    const proposalDetail = parsed.kind === 'proposals' && report !== undefined
      ? `提案 ${parsed.proposals.length} 条(弃 ${parsed.dropped},跳 ${report.skipped})`
        + `:add ${report.add} / update ${report.update} / noop ${report.noop} / forget ${report.forgotten} / supersede ${report.superseded}`
      : 'Nothing to save'
    return {
      kind: 'ran',
      detail: `${proposalDetail}${episodicDetail}`
        + `(${route.provider}/${route.model})`,
    }
  }
}

/** episodic 会话史行的摘要摘题上限(与 manifest 摘要预览同量级)。 */
const EPISODIC_SUMMARY_MAX_CHARS = 60

// ---------- T-A3:episodic 会话史 curator 压缩摘要(冻结提示词;2026-11-16) ----------

/** LLM 摘要正文上限(Gm0 2000 内的轻量行;超长截断仍可用)。 */
const EPISODIC_LLM_SUMMARY_MAX_CHARS = 500
/** 摘要输入的会话材料上限(最近尾;完整材料走提取调用,摘要只保脉络)。 */
const EPISODIC_SUMMARY_INPUT_MAX_CHARS = 1_600
/** episodic 摘要直调 max tokens(≤500 字散文,256 足够)。 */
export const EPISODIC_SUMMARY_MAX_TOKENS = 256

/**
 * episodic 会话史摘要冻结提示词(T-A3,与 tests/fixtures/episodic-summary-prompt.md
 * 逐字一致,单测钉住):把会话记录压成一段客观脉络摘要——原始会话尾机械截断
 * (fitRecentTranscript)降级为直调失败时的回落路径。
 */
export const EPISODIC_SUMMARY_PROMPT = [
  '# 会话史摘要(curator,轻量链 episodic 行)',
  '',
  '你会看到一段终端会话记录([用户]/[助手] 行)。把它压缩成一段客观的会话史摘要,供记忆域索引后续检索。',
  '',
  '纪律:',
  '- 只写会话中实际发生的事:用户要做什么、做了哪些操作、得到什么结果;',
  '- 不提建议、不评价、不臆测会话之外的内容;',
  '- 「[压缩检查点(二手摘要)]」标注的内容是二手摘要,只作背景线索,不得把其中的断言复述为本次会话的事实;',
  '- 一段连续中文散文,≤500 字,不分行、不加标题、不加列表;',
  '- 只输出摘要正文,不输出任何其它文字(前后都不加说明)。',
].join('\n')

/** 摘要输入文本(会话记录最近尾;fitRecentTranscript 复用,保最近丢最旧)。 */
function buildEpisodicSummaryUserText(transcript: string): string {
  return fitRecentTranscript(transcript, EPISODIC_SUMMARY_INPUT_MAX_CHARS)
}

/**
 * 摘要输出防御:空/全空白 → undefined(回落原文);「Nothing to save」类空提
 * 取习语 → undefined(本管道 curator 的训练习语,模型空转时最常见的回答,绝
 * 不可当摘要入库);超 500 字截断(模型忽略上限时仍可用,截断标记与摘题同款)。
 */
function parseEpisodicSummaryOutput(text: string): string | undefined {
  const trimmed = text.trim()
  if (trimmed.length === 0) return undefined
  if (/^nothing to save\b/iu.test(trimmed) || trimmed === '无' || trimmed === '没有') return undefined
  const chars = Array.from(trimmed)
  return chars.length <= EPISODIC_LLM_SUMMARY_MAX_CHARS ? trimmed : `${chars.slice(0, EPISODIC_LLM_SUMMARY_MAX_CHARS).join('')}…`
}

/**
 * M-M3 T11 轻量扩展 + T-A3(2026-11-16):episodic 会话史行落域(见
 * ExtractionTaskOptions.domainOf 与文件头注释)。正文经 curator 压缩成 ≤500 字
 * 会话史摘要(EPISODIC_SUMMARY_PROMPT 冻结提示词);直调失败/空输出回落
 * fitRecentTranscript 原文尾(行为与 T-A3 之前一致)。写失败(PII 拦截/字段
 * 校验/Gm0 容量)→ warn 跳过返回 false,不炸任务(该会话的材料仍在会话日志,
 * 下次提到仍可被提取)。
 * @returns false=未落库;'llm'=摘要正文;'fallback'=原文尾回落
 */
async function writeSessionEpisodicSummary(
  options: ExtractionTaskOptions,
  snapshot: ConsolidationSnapshot,
  transcript: string,
  route: ExtractionRoute,
  signal: AbortSignal,
): Promise<boolean | 'llm' | 'fallback'> {
  if (options.domainOf === undefined) return false
  const domainKey = options.domainOf(snapshot.sessionId) ?? 'default'
  const subject = `domain:${domainKey}`
  const key = `session-${snapshot.sessionId}`
  // T-A3:curator 压缩摘要;失败/空 → 原文尾回落(软失败,不影响落库)
  let content = fitRecentTranscript(transcript, MEMORY_CONTENT_MAX_CHARS)
  let summarized = false
  try {
    const { text } = await runCuratorOneShot(
      options.ctx,
      route,
      EPISODIC_SUMMARY_PROMPT,
      buildEpisodicSummaryUserText(transcript),
      EPISODIC_SUMMARY_MAX_TOKENS,
      'episodic 摘要',
      { signal },
    )
    const parsed = parseEpisodicSummaryOutput(text)
    if (parsed !== undefined) {
      content = parsed
      summarized = true
    }
  } catch (error) {
    options.logger?.warn?.(
      `[memory] episodic 摘要直调失败,回落原文截断:${error instanceof Error ? error.message : String(error)}`,
    )
  }
  try {
    const summary = firstUserHeadline(transcript)
    options.memory.writeEntity({
      subject,
      key,
      content,
      ...(summary !== undefined && { summary }),
      kind: 'episodic',
      scope: 'domain',
      domainKey,
      confidence: 0.5,
      source: options.source ?? 'consolidation',
      originSessionId: snapshot.sessionId,
      originTurnRef: `turn:${snapshot.lastTurn}`,
    })
    return summarized ? 'llm' : 'fallback'
  } catch (error) {
    options.logger?.warn?.(
      `[memory] episodic 会话史行落库跳过(${subject}/${key}):${error instanceof Error ? error.message : String(error)}`,
    )
    return false
  }
}

/**
 * 会话史正文截断(保最近——会话史的重心在尾部;Gm0 单条 ≤2000 字口径):
 * 起点劈在高代理项上时跳过半个码元,再削掉残半行避免首行残缺。
 */
function fitRecentTranscript(transcript: string, maxChars: number): string {
  if (transcript.length <= maxChars) return transcript
  let start = transcript.length - maxChars
  const head = transcript.charCodeAt(start)
  if (head >= 0xdc00 && head <= 0xdfff) start += 1
  const cut = transcript.slice(start)
  const newline = cut.indexOf('\n')
  return newline >= 0 && newline + 1 < cut.length ? cut.slice(newline + 1) : cut
}

/** 会话史摘要 = 首条真人类用户消息摘题(无则空串;manifest/索引按缺省派生兜底)。 */
function firstUserHeadline(transcript: string): string | undefined {
  const line = transcript.split('\n').find(entry => entry.startsWith('[用户] '))
  if (line === undefined) return undefined
  const text = line.slice('[用户] '.length).trim()
  if (text.length === 0) return undefined
  const chars = Array.from(text)
  return chars.length <= EPISODIC_SUMMARY_MAX_CHARS ? text : `${chars.slice(0, EPISODIC_SUMMARY_MAX_CHARS).join('')}…`
}

/**
 * T9 提案审计(19 号 §4-T9.2/T9.4):落库完成后写一行 `proposal` 事件——
 * 计数 + skip 原因 + 本次产生的待审清单;有待审行时组记忆审批卡片
 * (标题「从本次会话学到…」、Why=出处会话摘要经 PiiGuard 回退、影响面=记忆库
 * 文件)并把 renderedDetail 落进卡片投影。送达 = 面板审批队列(M-M2 退路);
 * 官方 user-questions 通道不在此投递——切换点见 memoryApprovalAskRequest
 * (上游发行包纳入 client-ui-approval/user-questions 后,此处改为
 * `ctx.userQuestions.ask(memoryApprovalAskRequest(card, id))` 即启用)。
 *
 * fail-open:账本缺席跳过;组卡/落账的任何异常只 warn 不抛——提案已落库,
 * 抛错会让调度器按任务失败处理(游标不推进)而整段重跑提取。
 */
function recordProposalAudit(
  options: ExtractionTaskOptions,
  sessionId: string,
  turn: number,
  report: ProposalApplyReport,
  transcript: string,
  source: ExtractionSource,
): void {
  const audit = options.audit
  if (audit === undefined) return
  try {
    const pendingItems: MemoryAuditPendingItem[] = report.pending.map(record => ({
      id: record.id,
      subject: record.subject,
      key: record.key,
      summary: record.summary ?? '',
    }))
    let card: MemoryAuditCard | undefined
    if (pendingItems.length > 0) {
      const approvalCard = buildMemoryApprovalCard({
        sessionId,
        turnRef: `turn:${turn}`,
        sessionDigest: buildSessionDigest(transcript, options.memory.piiGuard),
        items: pendingItems,
        ...(options.storeLabel !== undefined && { storeLabel: options.storeLabel }),
      })
      card = {
        title: approvalCard.why.name,
        ruleId: approvalCard.matchedRule.ruleId,
        grade: MEMORY_REVIEW_GRADE,
        detail: approvalCard.renderedDetail,
      }
    }
    audit.recordProposal({
      sessionId,
      turn,
      source,
      add: report.add,
      update: report.update,
      noop: report.noop,
      forgotten: report.forgotten,
      superseded: report.superseded,
      skipped: report.skipped,
      skipReasons: report.skipReasons,
      pending: pendingItems,
      ...(card !== undefined && { card }),
    })
  } catch (error) {
    options.logger?.warn?.(`[memory] 提案审计落账失败(不炸任务,提案已落库):${error instanceof Error ? error.message : String(error)}`)
  }
}

/** 弱类型收窄(governance/audit.ts isRecord 同款)。 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
