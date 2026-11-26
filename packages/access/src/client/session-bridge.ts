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
 * - 只在绑定的会话切换时覆盖,不做清空——卸载瞬间清空会让同帧打开的菜单丢会话;
 * - **subagent 子会话不得写入**(2026-11-25 实机):参谋面板/上游子代理聊天同样
 *   渲染 `conversation.input.overlay`,若照单全收,后挂载的子会话会把桥覆盖成
 *   `<父>--adviser-N`;主会话模型菜单随后拿这个 id 调 `selectModel`,被宿主会话
 *   控制器以 `session/agent-busy`(session "…" is owned by subagent routing)拒绝。
 *   判定用上游 `ctx.sessions.subagentAddress`——与 ui-model-selection 的可用性
 *   门同一信号(子会话根本不渲染模型选择触发器)。
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

/** 子会话判定所需的结构子集(上游 ClientSessions;旧壳缺席=不判)。 */
export interface SubagentLookup {
  /** 解析 subagent 地址;返回 undefined 表示普通会话。 */
  readonly subagentAddress?: (sessionId: string) => unknown
}

/**
 * 该会话是否是 subagent 子会话(参谋/子代理)。
 * @param sessions - 上游会话服务(可缺席)。
 * @param sessionId - 待判定会话。
 * @returns 地址可解析=子会话;服务或 id 缺席=false(保持旧行为)。
 */
export function isSubagentSession(sessions: SubagentLookup | undefined, sessionId: string | undefined): boolean {
  if (sessions?.subagentAddress === undefined) return false
  if (sessionId === undefined || sessionId === '') return false
  try {
    return sessions.subagentAddress(sessionId) !== undefined
  } catch {
    // 解析服务内部异常不得把主对话渲染拖垮(探针 inject 在渲染路径上):
    // 保守当作普通会话,保持旧行为。
    return false
  }
}

/**
 * 探针写入闸:普通会话才允许覆盖桥。
 * @param sessionId - 探针拿到的标准席位会话 id。
 * @param subagent - 槽位注入的 subagent 判定。
 * @returns 是否写入。
 */
export function shouldBindActiveSession(sessionId: string | undefined, subagent: boolean | undefined): boolean {
  if (subagent === true) return false
  return sessionId !== undefined && sessionId !== ''
}
