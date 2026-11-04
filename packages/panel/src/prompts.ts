/**
 * 操作指南数据:每个已开发能力一条「怎么触发」的示例 prompt(点击即复制)。
 * 覆盖面(任务口径):memory 写/搜/忘、knowledge 检索/提案、预算计算、付款审批红线。
 * 纯数据模块:浏览器面板(src/client)直接打包引入,不依赖 node 内建。
 */

/** 一条操作指引。 */
export interface GuidePrompt {
  /** 稳定 id(浏览器 DOM 锚点 data-basis-panel-prompt 用)。 */
  readonly id: string
  /** 能力域(memory / knowledge / event)。 */
  readonly capability: string
  /** 短标题。 */
  readonly title: string
  /** 可复制的示例 prompt。 */
  readonly prompt: string
  /** 红线/注意事项(可选)。 */
  readonly note?: string
}

export const GUIDE_PROMPTS: readonly GuidePrompt[] = [
  {
    id: 'memory-write',
    capability: 'memory',
    title: '记忆写入',
    prompt: '请用 memory_write 记住:用户偏好周五下午开会(实体 user:me / key meeting-preference)。',
  },
  {
    id: 'memory-search',
    capability: 'memory',
    title: '记忆检索',
    prompt: '请用 memory_search 搜索「开会」,并在回答里带上每条命中的出处锚点(entity:…#版本)。',
  },
  {
    id: 'memory-forget',
    capability: 'memory',
    title: '记忆遗忘',
    prompt: '请用 memory_forget 把实体 user:me / key meeting-preference 标记失效,并告诉我删了几行。',
  },
  {
    id: 'knowledge-search',
    capability: 'knowledge',
    title: '知识检索',
    prompt: '请用 knowledge_search 检索「预算」,并附 knowledge_status 显示后端健康状态。',
  },
  {
    id: 'knowledge-propose',
    capability: 'knowledge',
    title: '知识提案(fail-closed)',
    prompt: '请用 knowledge_propose 提交一篇《会议预算模板》提案(fail-closed:未经人工评审放行不会发布)。',
    note: '默认拒绝:governance 规则显式 allow 才放行发布。',
  },
  {
    id: 'budget-calc',
    capability: 'event',
    title: '预算计算',
    prompt: '请用 budget_calc 计算:总额 198000 元,按 餐饮30%/场地25%/物料20%/应急10% 给出预算分解。',
  },
  {
    id: 'pay-deposit-redline',
    capability: 'event',
    title: '付款审批红线(R3)',
    prompt: '请用 pay_deposit 起草定金申请:合同 198000 元、定金比例 30%(R3:只出申请单,宿主审批 allowed-once 后才可执行,代理不直接付款)。',
    note: 'R3 高危:pay_deposit / budget_change / transfer_money / sign_contract / vendor_award 均需人工审批。',
  },
]
