/**
 * 会话 id 桥(2026-11-18 收尾):
 * 模型菜单是 body 级命令式挂载,拿不到 slot 的会话标准席位;而 localStorage
 * 的导航快照在多 tab/多会话下可能指向另一会话。本模块由 `SessionBindingProbe`
 * (注册在 conversation.input.overlay,session 作用域)在渲染时写入**真正渲染
 * 当前对话**的会话 id,菜单/ActionStrip 再从这里取。
 *
 * 纪律:
 * - 纯内存、不持久化:桥只是「最近一次渲染的会话」,刷新后由探针重新写入;
 * - 探针缺席(旧壳/合成异常)时调用方自行回退 localStorage(与旧行为一致);
 * - 只在绑定的会话切换时覆盖,不做清空——卸载瞬间清空会让同帧打开的菜单丢会话。
 */
let active: string | null = null

/** 探针写入当前渲染中的会话 id(空串/undefined 视为不写)。 */
export function bindActiveSessionId(sessionId: string | undefined): void {
  if (sessionId === undefined || sessionId === '') return
  active = sessionId
}

/** 读取最近一次渲染的会话 id;探针从未渲染时 null。 */
export function activeSessionId(): string | null {
  return active
}
