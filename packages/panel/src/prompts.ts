/**
 * 操作指南数据:每个已开发能力一条「怎么触发」的示例 prompt(点击即复制)。
 * 覆盖面(任务口径):memory 写/搜/忘、knowledge 检索/提案、预算计算、付款审批红线。
 * 纯数据模块:浏览器面板(src/client)直接打包引入,不依赖 node 内建。
 */

/** 一条操作指引。 */
export interface GuidePrompt {
  /** 稳定 id(浏览器 DOM 锚点 data-eterna-panel-prompt 用)。 */
  readonly id: string
  /** 能力域(memory / knowledge / event)。 */
  readonly capability: string
  /** 短标题。 */
  readonly title: string
  /** 可复制的示例 prompt。 */
  readonly prompt: string
  /** 红线/注意事项(可选)。 */
  readonly note?: string
  /** 流程启动语(chip 点击用):引导 Agent 先向用户确认所需信息,再执行。 */
  readonly kickoff?: string
}

export const GUIDE_PROMPTS: readonly GuidePrompt[] = [
  {
    id: 'memory-write',
    capability: 'memory',
    title: '记忆写入',
    prompt: '请用 memory_write 记住:用户偏好周五下午开会(实体 user:me / key meeting-preference)。',

    kickoff: '启动「记忆写入」流程:请先问我要记住的内容和主体(如 user:我 / project:xx),确认后用 memory_write 保存并回显结果。'  },
  {
    id: 'memory-search',
    capability: 'memory',
    title: '记忆检索',
    prompt: '请用 memory_search 搜索「开会」,并在回答里带上每条命中的出处锚点(entity:…#版本)。',

    kickoff: '启动「记忆检索」流程:如果我的意图里信息足够就直接用 memory_search 检索;不够就先问我缺什么。'  },
  {
    id: 'memory-forget',
    capability: 'memory',
    title: '记忆遗忘',
    prompt: '请用 memory_forget 把实体 user:me / key meeting-preference 标记失效,并告诉我删了几行。',

    kickoff: '启动「记忆遗忘」流程:请先列出我能看到的记忆条目让我选择要遗忘哪条,我确认后再执行 forget。'  },
  {
    id: 'knowledge-search',
    capability: 'knowledge',
    title: '知识检索',
    prompt: '请用 knowledge_search 检索「预算」,并附 knowledge_status 显示后端健康状态。',

    kickoff: '启动「知识检索」流程:请先和我确认要查的主题与关键词,再检索并给出带出处的结果。'  },
  {
    id: 'knowledge-propose',
    capability: 'knowledge',
    title: '知识提案(fail-closed)',
    prompt: '请用 knowledge_propose 提交一篇《会议预算模板》提案(fail-closed:未经人工评审放行不会发布)。',
    note: '默认拒绝:governance 规则显式 allow 才放行发布。',

    kickoff: '启动「知识提案」流程:请先向我逐项确认要写入知识库的内容(标题/正文/标签),确认后提交提案待审。'  },
  {
    id: 'budget-calc',
    capability: 'event',
    title: '预算计算',
    prompt: '请用 budget_calc 计算:总额 198000 元,按 餐饮30%/场地25%/物料20%/应急10% 给出预算分解。',

    kickoff: '启动「预算计算」流程:请先向我确认活动类型、总预算(或各分项)、比例口径,确认后再调用 budget_calc 计算并提示是否超支。'  },
  {
    id: 'pay-deposit-redline',
    capability: 'event',
    title: '付款审批红线(R3)',
    prompt: '请用 pay_deposit 起草定金申请:合同 198000 元、定金比例 30%(R3:只出申请单,宿主审批 allowed-once 后才可执行,代理不直接付款)。',
    note: 'R3 高危:pay_deposit / budget_change / transfer_money / sign_contract / vendor_award 均需人工审批。',

    kickoff: '启动「付款红线」流程:我会提供合同额/定金比例/收款方;你必须先生成付款申请草稿并触发审批,未经批准绝不执行任何支付动作。'  },
]
