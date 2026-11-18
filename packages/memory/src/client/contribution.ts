/**
 * 幂等 slot 贡献闸(2026-11-18 修复 turnTail 重复注册 pageerror)。
 *
 * 背景:`@eterna/memory` 的 Sources 行在 `conversation.chat.turnTail` 上做了
 * 「立即 + 延时一拍」双挂载(对 slot 声明面晚就绪宿主的兼容面,见 index.tsx 头注)。
 * 两条路径都会在声明就绪时各跑一次 contribute,而第二次 `slots.register` 因同 id
 * 已存在直接抛
 * `list slot "conversation.chat.turnTail" already has an entry with id "eterna-memory.sources"`
 * ——未捕获异常,每次加载冒一条 pageerror(线上实测)。
 *
 * 语义:只让**首次成功**的 contribute 真正登记;已登记后的 contribute 返回空 disposer
 * (注入链路的撤销语义不变)。首次登记抛错时不闭合闸门,后续重试仍走登记——「已挂载」
 * 与「上次失败」必须区分,否则一次早失败会把兼容重试永久关死。
 * 无 React/宿主依赖,便于单测。
 */

/**
 * 生成可安全多次调用的 contribute 回调。
 * @param register - 官方 slots.register(同 id 二次登记会抛)。
 * @param options - slot 登记选项(含 id;类型随 register 的入参)。
 * @param component - 条目组件。
 * @returns contribute 回调;重复调用只登记一次,登记失败可重试。
 */
export function createIdempotentSlotContribution<Options>(
  register: (options: Options, component: unknown) => () => void,
  options: Options,
  component: unknown,
): () => () => void {
  let mounted = false
  return () => {
    if (mounted) return () => {}
    const dispose = register(options, component)
    mounted = true
    return dispose
  }
}
