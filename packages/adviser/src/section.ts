/**
 * [adviser] 主会话提示词纪律(P8)——告诉主会话「参谋是用户的私人旁注」。
 *
 * ## 为什么必须有这一行
 * 计划书 R1:spawn 出来的参谋**恒进父会话的 subagent catalog**,主会话的
 * `list_agents` 能列出它、`send_message` 也能给它发消息——这是上游 catalog
 * 的固定行为,本插件改不了。若不声明,可能出现两种破坏体验的行为:
 *
 * 1. **主会话主动寻址参谋**(「我去问问参谋」)——用户并不想让主会话自己去
 *    找参谋,参谋是**用户自己的**第二视角;
 * 2. **主会话等待参谋输入**(「等参谋回复再继续」)——参谋不参与主会话的回合,
 *    等它等于永久卡住。
 *
 * 因此本 section 声明三条纪律:参谋是私人旁注 / 不得主动寻址 / 不得等待其输入。
 * 它不是「建议」而是行为约束,措辞要硬。
 *
 * ## 为什么是 systemPrompt section 而不是插件 config 里的 prefix
 * 三入口(P7)是客户端能力、回写(P6)是数据面,而这一条是**装配期文本**;
 * 本仓的装配期文本唯一合法入口是 `ctx.systemPrompt.section`(memory /
 * tasks 同款 seam)。走 prefix 会污染 persona 层(那是给「模型是谁」用的)。
 *
 * ## 登记
 * 提示词必须登记进 `PROMPT_REGISTRY_ENTRIES`(prompt-scan 的 P3 面强制):
 * 条目 id `runtime.adviser.discipline`,anchors 指本文件。
 */
/**
 * 本包对 `PromptSection` 的结构声明。
 *
 * 为什么不 import `@deepseek-ai/dsh-system-prompt`:adviser 的运行时依赖面
 * 刻意压到最小(只有 cordis),装配期文本按结构面消费(memory/tasks 的
 * `PromptSection` 同形)。运行时鸭子一致,构建期零额外依赖。
 */
export interface AdviserPromptSection {
  /** 全局唯一注册名(`SystemPrompt.section` 对重名抛错)。 */
  readonly name: string
  /** 升序拼接;等序按名排序。 */
  readonly order: number
  /** 静态文本(本段无运行时状态)。 */
  readonly text: string
  /** 是否插值 `{{variable}}`;本段显式关闭。 */
  readonly interpolate: boolean
}

/** section 注册名(dsh PromptSection.name;注册表条目 runtime.adviser.discipline 同源)。 */
export const ADVISER_SECTION_NAME = 'eterna-adviser:discipline'

/**
 * section 序位。
 *
 * 取 9060:紧跟 tasks 的 `[active-tickets]`(9050),两者同属「当前有哪些旁路
 * 对象」这一类提示;落在 memory:index(9000)之后、上游 HARNESS_SOURCE(10000)
 * 之前——参谋纪律是运行期事实,应排在角色人设与记忆索引之后、收尾段之前。
 */
export const ADVISER_SECTION_ORDER = 9060

/**
 * 纪律正文。
 *
 * 措辞取舍:
 * - 「私人旁注」定性质(不是团队工具、不是子任务执行者);
 * - 「不得主动寻址」禁 R1 的第一种破坏;
 * - 「不得等待其输入」禁第二种;
 * - 末句说明**用户可以自己开**,避免模型把它当成系统自动创建的组件去解释。
 */
export const ADVISER_DISCIPLINE_TEXT = `[adviser]
用户可以在右侧栏开一个「参谋」会话(标注为 adviser 的子智能体):那是**用户自己的私人旁注**,与你的任务无关。
- 不要主动给参谋发消息,也不要尝试创建、关闭或重命名参谋;
- 不要把参谋当成你委派的子任务,更不要等待它返回结果——它不会参与你的回合;
- 如果用户把参谋的结论贴给你(通常以「附言」或直接消息出现),把它当作**用户的补充说明**照常处理即可。`

/** 构造 section(纯声明,无运行时状态;每次装配返回同一段文本)。 */
export function createAdviserSection(): AdviserPromptSection {
  return {
    name: ADVISER_SECTION_NAME,
    order: ADVISER_SECTION_ORDER,
    text: ADVISER_DISCIPLINE_TEXT,
    // 文本里有 `[adviser]` 与中文标点,但**没有** {{variable}};显式关掉插值,
    // 免得将来正文里出现花括号被误当变量。
    interpolate: false,
  }
}
