/**
 * 附件入口字典(zh/en):产品可见文案经 ctx.locale 标准席位(dsh 客户端本地化规约)。
 */

export const NS = 'eternaAttachments'

export type AttachmentsLocaleKey =
  | 'attach'
  | 'attach.hint'

export const zh: Record<AttachmentsLocaleKey, string> = {
  attach: '附件',
  'attach.hint': '添加图片或文件,发送后 Agent 可直接读取处理',
}

export const en: Record<AttachmentsLocaleKey, string> = {
  attach: 'Attach',
  'attach.hint': 'Add images or files; the agent can read them after you send',
}
