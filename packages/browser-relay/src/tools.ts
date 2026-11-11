// 工具层（E1-T3 → E2 修订 → E4 多用户，2026-11-11）：browser_snapshot / browser_click / browser_fill。
// 感知：DOMSnapshot.captureSnapshot → ego/BrowserOS 风格快照（交互节点 [ref=e<backendNodeId>]）。
// 行动：DOM.resolveNode → callFunctionOn 取视口中心 → Input.dispatchMouseEvent/insertText（可信输入）。
//
// 历史修订：
// 1. ref 全局注册表：ref 记录其所属 tab（G-CORE-02 教训——按 tabId 隔离导致跨 tab 快照的 ref 被误拒）；
// 2. 上下文 tab：无参调用优先落在最近一次快照/动作的 tab（G-CORE-03 教训）；
// 3. 点击回执含 openedTabs（弹出新 tab 如实报告）。
// E4 多用户：refs/上下文 tab 按「命名空间=凭据」隔离——args._eternaToken（access 端
// pre-execute 服务端注入，模型不可伪造）路由到本人浏览器；缺省落主命名空间。
// 红线 3：快照一律作为数据返回；红线 7：不可操作目标由扩展层拒绝。

import { renderDomSnapshot, type RenderedSnapshot } from './dom-snapshot.ts'
import type { RelayCore } from './relay-core.ts'

export interface ToolResult {
  ok: true
  tool: string
  result: Record<string, unknown>
}

export interface ToolFailure {
  ok: false
  tool: string
  error: { code: string; message: string }
}

function fail(tool: string, code: string, message: string): ToolFailure {
  return { ok: false, tool, error: { code, message } }
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function classify(err: unknown): { code: string; message: string } {
  // 业务抛错自带 code（NO_EXTENSION/NO_TAB 等）：优先保留——code 是诊断分类，不该被兜底覆盖
  const code = (err as { code?: unknown }).code
  if (typeof code === 'string' && code !== '') return { code, message: errMessage(err) }
  const message = errMessage(err)
  if (/No node with given id|backendNodeId/i.test(message)) return { code: 'STALE_REF', message: `${message}（ref 已失效：重新 snapshot）` }
  if (/TIMEOUT/i.test(message)) return { code: 'TIMEOUT', message }
  return { code: 'TOOL_ERROR', message }
}

const sleep = (ms: number): Promise<void> => new Promise((r2) => { return setTimeout(r2, ms) })

/** ref 目标：ref 自带所属 tab（同命名空间内）——点击/填写落在 ref 的原生 tab */
interface RefTarget {
  tabId: number
  backendNodeId: number
}

/** 单命名空间的工具侧状态（ref 注册表 + 上下文 tab） */
interface NsTable {
  refs: Map<string, RefTarget>
  contextTabId: number | null
}

export class BrowserTools {
  /** 每命名空间一套（ref=「ns 内最近快照的 e<backendNodeId>」） */
  private readonly nsTables = new Map<string, NsTable>()
  private table(ns: string): NsTable {
    let t = this.nsTables.get(ns)
    if (t === undefined) {
      t = { refs: new Map(), contextTabId: null }
      this.nsTables.set(ns, t)
    }
    return t
  }

  constructor(
    private readonly core: RelayCore,
    /** 安装指引页地址（扩展未连接时报错文案带给模型→转告用户） */
    private readonly guideUrl?: string,
  ) {}

  /** 调用路由命名空间：_eternaToken（服务端注入）→ 用户域；缺省 → 主域 */
  private nsOf(args: Record<string, unknown>): string {
    const credential = args['_eternaToken']
    return this.core.nsFor(typeof credential === 'string' && credential !== '' ? credential : undefined)
  }

  /** 选 tab：显式 tabId → 上下文 tab → 活跃可操作 tab → 第一个可操作 http(s) tab → 带 url 时新开 */
  private async pickTab(ns: string, args: Record<string, unknown>): Promise<number> {
    if (!this.core.nsConnected(ns)) {
      const personal = ns !== this.core.defaultNs
      throw Object.assign(new Error(`浏览器扩展未连接${personal ? '（你的令牌尚未有浏览器接入）' : ''}：请在浏览器安装 Eterna Companion 扩展并保持运行${this.guideUrl !== undefined ? `（安装指引与下载：${this.guideUrl}）` : ''}`), { code: 'NO_EXTENSION' })
    }
    const table = this.table(ns)
    const tabIdArg = args['tabId']
    if (typeof tabIdArg === 'number') {
      table.contextTabId = tabIdArg
      return tabIdArg
    }
    const eligible = (): Array<{ tabId: number; active: boolean }> => {
      return this.core.listTabs(ns)
        .filter((t2) => { return t2.eligible && /^https?:/i.test(t2.url) })
        .map((t3) => { return { tabId: t3.tabId, active: t3.active } })
    }
    const tabs = eligible()
    if (table.contextTabId !== null && tabs.some((t) => { return t.tabId === table.contextTabId })) {
      return table.contextTabId
    }
    const active = tabs.find((t3) => { return t3.active })
    if (active !== undefined) {
      table.contextTabId = active.tabId
      return active.tabId
    }
    const first = tabs[0]
    if (first !== undefined) {
      table.contextTabId = first.tabId
      return first.tabId
    }
    const url = strArg(args, 'url')
    if (url !== undefined && url !== '') {
      const newTabId = await this.core.openTab(ns, url)
      table.contextTabId = newTabId
      return newTabId
    }
    throw Object.assign(new Error('浏览器无可用页面：携带 url 参数打开一个页面，或先 snapshot'), { code: 'NO_TAB' })
  }

  private async captureNodes(ns: string, tabId: number): Promise<RenderedSnapshot> {
    const captureRaw = (await this.core.sendTabCommand(ns, tabId, 'DOMSnapshot.captureSnapshot', {
      computedStyles: [],
      includeDOMRects: false,
      includePaintOrder: false,
    })) as Parameters<typeof renderDomSnapshot>[0]
    return renderDomSnapshot(captureRaw)
  }

  private async centerOf(ns: string, tabId: number, backendNodeId: number): Promise<{ x: number; y: number }> {
    // DOMSnapshot 的 backendNodeId 与 DOM 域编号不同空间：经 DOM.resolveNode 桥接到对象，
    // 再用 Runtime.callFunctionOn 取视口中心坐标（getBoundingClientRect 即视口系，直接供 Input 域使用）
    const resolved = (await this.core.sendTabCommand(ns, tabId, 'DOM.resolveNode', { backendNodeId }).catch(() => null)) as {
      object?: { objectId?: string | undefined }
    } | null
    const objectId = resolved !== null && resolved.object !== undefined ? resolved.object.objectId : undefined
    if (objectId === undefined || objectId === '') {
      throw Object.assign(new Error(`No node with given id (backendNodeId=${String(backendNodeId)})，节点已随页面变化失效`), { code: 'STALE_REF' })
    }
    const result = (await this.core.sendTabCommand(ns, tabId, 'Runtime.callFunctionOn', {
      objectId,
      functionDeclaration:
        'function() { this.scrollIntoView({ block: \'center\', behavior: \'instant\' }); const rect = this.getBoundingClientRect(); return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, w: rect.width, h: rect.height } }',
      returnByValue: true,
    })) as { result?: { value?: { x: number; y: number; w: number; h: number } } }
    const value = result.result?.value
    if (value === undefined || value.w === 0 || value.h === 0) {
      throw Object.assign(new Error(`元素不可交互（无布局框）backendNodeId=${String(backendNodeId)}`), { code: 'STALE_REF' })
    }
    return { x: value.x, y: value.y }
  }

  private async trustedClick(ns: string, tabId: number, x: number, y: number): Promise<void> {
    await this.core.sendTabCommand(ns, tabId, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'left' })
    await this.core.sendTabCommand(ns, tabId, 'Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 })
    await this.core.sendTabCommand(ns, tabId, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 })
  }

  /** 动作回执：落定 URL/标题 + 弹出的新 tab（弹窗/新标签如实报告） */
  private async receipt(ns: string, tabId: number, tabsBefore: Set<number>): Promise<Record<string, unknown>> {
    await sleep(800)
    const info = this.core.getTabInfo(ns, tabId)
    const openedTabs = this.core.listTabs(ns)
      .filter((t) => { return !tabsBefore.has(t.tabId) && t.eligible })
      .map((t) => { return { tabId: t.tabId, url: t.url, title: t.title } })
    return { url: info?.url ?? '', title: info?.title ?? '', openedTabs }
  }

  async execute(name: string, args: Record<string, unknown>): Promise<ToolResult | ToolFailure> {
    const ns = this.nsOf(args)
    try {
      switch (name) {
        case 'browser_snapshot': {
          const tabId = await this.pickTab(ns, args)
          const urlArg = strArg(args, 'url')
          const info = this.core.getTabInfo(ns, tabId)
          if (urlArg !== undefined && !(info?.url ?? '').includes(urlArg)) {
            // 指定 url 且当前上下文 tab 不匹配 → 打开新 tab（E1 过渡：E2 拆独立 navigate 工具）
            const newTabId = await this.core.openTab(ns, urlArg)
            this.table(ns).contextTabId = newTabId
            await sleep(1500)
            return await this.snapshotOf(ns, newTabId)
          }
          return await this.snapshotOf(ns, tabId)
        }
        case 'browser_click': {
          const tabsBefore = new Set(this.core.listTabs(ns).map((t) => { return t.tabId }))
          const target = await this.resolveTarget(ns, args)
          const { x, y } = await this.centerOf(ns, target.tabId, target.backendNodeId)
          await this.trustedClick(ns, target.tabId, x, y)
          const receipt = await this.receipt(ns, target.tabId, tabsBefore)
          this.table(ns).contextTabId = target.tabId
          return { ok: true, tool: name, result: { ...receipt, ref: strArg(args, 'ref') ?? null } }
        }
        case 'browser_fill': {
          const tabsBefore = new Set(this.core.listTabs(ns).map((t) => { return t.tabId }))
          const value = strArg(args, 'value') ?? ''
          const target = await this.resolveTarget(ns, args)
          const { x, y } = await this.centerOf(ns, target.tabId, target.backendNodeId)
          await this.trustedClick(ns, target.tabId, x, y)
          await this.core.sendTabCommand(ns, target.tabId, 'Input.insertText', { text: value })
          const receipt = await this.receipt(ns, target.tabId, tabsBefore)
          this.table(ns).contextTabId = target.tabId
          return { ok: true, tool: name, result: { ...receipt, filled: value.length } }
        }
        default:
          return fail(name, 'UNKNOWN_TOOL', `未知工具：${name}`)
      }
    } catch (err) {
      const c = classify(err)
      return fail(name, c.code, c.message)
    }
  }

  /** ref（命名空间注册表，自带 tab）或 selector 兜底 → { tabId, backendNodeId } */
  private async resolveTarget(ns: string, args: Record<string, unknown>): Promise<RefTarget> {
    const ref = strArg(args, 'ref')
    if (ref !== undefined && ref !== '') {
      const target = this.table(ns).refs.get(ref)
      if (target === undefined) {
        throw Object.assign(new Error(`ref ${ref} 不在最近一次快照中（页面已变化请重新 snapshot；stale ref 禁止重试）`), { code: 'INVALID_REF' })
      }
      return target
    }
    const selector = strArg(args, 'selector')
    if (selector !== undefined && selector !== '') {
      const tabId = await this.pickTab(ns, args)
      return { tabId, backendNodeId: await this.resolveSelector(ns, tabId, selector) }
    }
    throw Object.assign(new Error('需要 ref 或 selector 参数'), { code: 'INVALID_ARGS' })
  }

  private async snapshotOf(ns: string, tabId: number): Promise<ToolResult | ToolFailure> {
    const info = this.core.getTabInfo(ns, tabId)
    let rendered = await this.captureNodes(ns, tabId)
    if (rendered.lines.length <= 1) {
      // 空快照（导航未完成）：短退避重取一次
      await sleep(1200)
      rendered = await this.captureNodes(ns, tabId)
    }
    const table = this.table(ns)
    // ref 注册（先清同 tab 旧条目——同 tab 重快照=文档已变，backendNodeId 会跨文档撞号；
    // 跨 tab 的 ref 保留——跨快照/跨 tab 稳定性，G-CORE-02 教训）
    for (const [k, v] of table.refs) {
      if (v.tabId === tabId) table.refs.delete(k)
    }
    for (const [ref, backendNodeId] of rendered.refs) {
      table.refs.set(ref, { tabId, backendNodeId })
    }
    table.contextTabId = tabId
    return {
      ok: true,
      tool: 'browser_snapshot',
      result: { tabId, url: info?.url ?? '', title: info?.title ?? '', snapshot: rendered.text },
    }
  }

  /** selector 兜底（冒烟与联调用；正式 agent 走 ref） */
  private async resolveSelector(ns: string, tabId: number, selector: string): Promise<number> {
    const doc = (await this.core.sendTabCommand(ns, tabId, 'DOM.getDocument')) as { root?: { nodeId?: number } }
    const rootId = doc.root?.nodeId
    if (rootId === undefined) throw Object.assign(new Error('DOM.getDocument 失败'), { code: 'TOOL_ERROR' })
    const found = (await this.core.sendTabCommand(ns, tabId, 'DOM.querySelector', { nodeId: rootId, selector })) as { nodeId?: number }
    const nodeId = found.nodeId
    if (nodeId === undefined || nodeId === 0) {
      throw Object.assign(new Error(`选择器零匹配：${selector}`), { code: 'SELECTOR_NO_MATCH' })
    }
    const node = (await this.core.sendTabCommand(ns, tabId, 'DOM.describeNode', { nodeId })) as { node?: { backendNodeId?: number } }
    const backendNodeId = node.node?.backendNodeId
    if (backendNodeId === undefined) throw Object.assign(new Error(`节点无 backendNodeId：${selector}`), { code: 'TOOL_ERROR' })
    return backendNodeId
  }
}

function strArg(args: Record<string, unknown>, key: string): string | undefined {
  const v = args[key]
  return typeof v === 'string' ? v : undefined
}
