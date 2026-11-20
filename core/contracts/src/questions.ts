/**
 * 提问卡片契约(interact 消费的结构镜像,原 dsh-user-questions 形态):
 * ask_user_question 工具载荷与提问合并包共用。
 */

/** 一个可选答案。 */
export interface AskUserQuestionOption {
  label: string
  /** 可选的补充说明(能力足够的 UI 渲染)。 */
  description?: string
}

/**
 * 调用方声明的呈现意图(v1 仅 approval 分支;UI 不认识的标签走通用选项流,
 * 应答编码不变 —— intent 只改呈现,不改协议)。
 */
export interface AskUserQuestionIntent {
  readonly kind: 'approval'
  /** 批准动作标签(必须与 options 中的批准项一致)。 */
  readonly approve: string
  /** 拒绝动作标签(必须与 options 中的拒绝项一致)。 */
  readonly reject: string
  /** 审批主体(可选展示)。 */
  readonly subject?: { readonly name: string }
}

/** 一次提问请求中的一个问句。 */
export interface AskUserQuestionItem {
  /** 稳定的调用方 id(应答按 id 回路由)。 */
  id: string
  question: string
  /** 可选补充说明(不进选项标签)。 */
  detail?: string
  /** 可选短标题/分组标签。 */
  header?: string
  /** 可选选项菜单。 */
  options?: AskUserQuestionOption[]
  /** 是否多选;默认单选。 */
  multiSelect?: boolean
  /** 可选呈现意图(能力足够的 UI 按标签呈现;缺省走通用选项流)。 */
  intent?: AskUserQuestionIntent
}
