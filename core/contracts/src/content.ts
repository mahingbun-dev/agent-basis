/**
 * 模型面内容块(v1 仅文本;与 dsh-llm TextBlock 契约一致)。
 * 工具 output.render 与 egress 拒绝渲染都产出本形态。
 */
export interface TextBlock {
  type: 'text'
  text: string
}

export type ContentBlock = TextBlock
