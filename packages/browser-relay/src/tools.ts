// 工具层（E1-T3）：browser_snapshot / browser_click / browser_fill，直连 CDP 实现。
// 感知：Accessibility.getFullAXTree → ego/BrowserOS 风格快照（交互节点 [ref=e<backendNodeId>]）。
// 行动：DOM.scrollIntoViewIfNeeded + DOM.getContentQuads + Input.dispatchMouseEvent/insertText（可信输入）。
// 红线 3：快照一律作为数据返回；红线 7：不可操作目标由扩展层拒绝。
// 服务端一次实现：T1 经扩展中继帧；T2 sidecar（E5）同一 CDP 命令面直连。
// 注：playwright-core 仍为依赖（E5 sidecar 传输的感知实现用），本文件 E1 不经 playwright。

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

function strArg(args: Record<string, unknown>, key: string): string | undefined {
  const v = args[key]
  return typeof v === 'string' ? v : undefined
}

function classify(err: unknown): { code: string; message: string } {
  const message = errMessage(err)
  if (/No node with given id|backendNodeId/i.test(message)) return { code: 'STALE_REF', message: `${message}（ref 已失效：重新 snapshot）` }
  if (/TIMEOUT/i.test(message)) return { code: 'TIMEOUT', message }
  return { code: 'TOOL_ERROR', message }
}

const sleep = (ms: number): Promise<void> => new Promise((r2) => { return setTimeout(r2, ms) })

export class BrowserTools {
  /** 每个 tab 最近一次快照（click/fill 的 ref 依据） */
  private readonly lastSnapshot = new Map<number, RenderedSnapshot>()

  constructor(private readonly core: RelayCore) {}

  /** 选 tab：显式 tabId → 活跃可操作 tab → 第一个可操作 http(s) tab → 带 url 时新开 */
  private async pickTab(args: Record<string, unknown>): Promise<number> {
    if (!this.core.extensionConnected) {
      throw Object.assign(new Error('扩展未连接：请在浏览器加载 Eterna Companion 扩展并保持运行'), { code: 'NO_EXTENSION' })
    }
    const tabIdArg = args['tabId']
    if (typeof tabIdArg === 'number') return tabIdArg
    const tabs = this.core.listTabs().filter((t2) => { return t2.eligible && /^https?:/i.test(t2.url) })
    const active = tabs.find((t3) => { return t3.active })
    if (active !== undefined) return active.tabId
    const first = tabs[0]
    if (first !== undefined) return first.tabId
    const url = args['url']
    if (typeof url === 'string' && url !== '') return await this.core.openTab(url)
    throw Object.assign(new Error('浏览器无可用页面：携带 url 参数打开一个页面，或先 snapshot'), { code: 'NO_TAB' })
  }

  private async captureNodes(tabId: number): Promise<RenderedSnapshot> {
    const captureRaw = (await this.core.sendTabCommand(tabId, 'DOMSnapshot.captureSnapshot', {
      computedStyles: [],
      includeDOMRects: false,
      includePaintOrder: false,
    })) as Parameters<typeof renderDomSnapshot>[0]
    return renderDomSnapshot(captureRaw)
  }

  private async centerOf(tabId: number, backendNodeId: number): Promise<{ x: number; y: number }> {
    // DOMSnapshot 的 backendNodeId 与 DOM 域编号不同空间：经 DOM.resolveNode 桥接到对象，
    // 再用 Runtime.callFunctionOn 取视口中心坐标（getBoundingClientRect 即视口系，直接供 Input 域使用）
    const resolved = (await this.core.sendTabCommand(tabId, 'DOM.resolveNode', { backendNodeId }).catch(() => null)) as {
      object?: { objectId?: string | undefined }
    } | null
    const objectId = resolved !== null && resolved.object !== undefined ? resolved.object.objectId : undefined
    if (objectId === undefined || objectId === '') {
      throw Object.assign(new Error(`No node with given id (backendNodeId=${String(backendNodeId)})，节点已随页面变化失效`), { code: 'STALE_REF' })
    }
    const result = (await this.core.sendTabCommand(tabId, 'Runtime.callFunctionOn', {
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

  private async trustedClick(tabId: number, x: number, y: number): Promise<void> {
    await this.core.sendTabCommand(tabId, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'left' })
    await this.core.sendTabCommand(tabId, 'Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 })
    await this.core.sendTabCommand(tabId, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 })
  }

  private async receipt(tabId: number): Promise<{ url: string; title: string }> {
    // 动作后让页面短暂落定，读 tab 元数据作为最小 receipt（结构化 receipt 在 E2-T3 完整化）
    await sleep(600)
    const info = this.core.getTabInfo(tabId)
    return { url: info?.url ?? '', title: info?.title ?? '' }
  }

  async execute(name: string, args: Record<string, unknown>): Promise<ToolResult | ToolFailure> {
    try {
      switch (name) {
        case 'browser_snapshot': {
          const tabId = await this.pickTab(args)
          const urlArg = strArg(args, 'url')
          if (urlArg !== undefined && !this.core.getTabInfo(tabId)?.url.includes(urlArg)) {
            // 指定 url 且当前不匹配 → 打开新 tab（E1 过渡：E2 拆独立 navigate 工具）
            const newTabId = await this.core.openTab(urlArg)
            await sleep(1500)
            return await this.snapshotOf(newTabId)
          }
          return await this.snapshotOf(tabId)
        }
        case 'browser_click': {
          const tabId = await this.pickTab(args)
          const backendNodeId = await this.resolveTarget(tabId, args)
          const { x, y } = await this.centerOf(tabId, backendNodeId)
          await this.trustedClick(tabId, x, y)
          const receipt = await this.receipt(tabId)
          return { ok: true, tool: name, result: { ...receipt } }
        }
        case 'browser_fill': {
          const tabId = await this.pickTab(args)
          const value = strArg(args, 'value') ?? ''
          const backendNodeId = await this.resolveTarget(tabId, args)
          const { x, y } = await this.centerOf(tabId, backendNodeId)
          await this.trustedClick(tabId, x, y)
          await this.core.sendTabCommand(tabId, 'Input.insertText', { text: value })
          return { ok: true, tool: name, result: { url: this.core.getTabInfo(tabId)?.url ?? '', filled: value.length } }
        }
        default:
          return fail(name, 'UNKNOWN_TOOL', `未知工具：${name}`)
      }
    } catch (err) {
      const c = classify(err)
      return fail(name, c.code, c.message)
    }
  }

  /** ref（最近一次快照的 refs 表）或 selector 兜底 → backendNodeId */
  private async resolveTarget(tabId: number, args: Record<string, unknown>): Promise<number> {
    const ref = strArg(args, 'ref')
    if (ref !== undefined && ref !== '') {
      const refs = this.lastSnapshot.get(tabId)?.refs
      if (refs === undefined || !refs.has(ref)) {
        throw Object.assign(new Error(`ref ${ref} 不在最近一次快照中（页面已变化请重新 snapshot；stale ref 禁止重试）`), { code: 'INVALID_REF' })
      }
      const backendNodeId = refs.get(ref)
      if (backendNodeId === undefined) throw Object.assign(new Error(`ref ${ref} 无 backendNodeId`), { code: 'INVALID_REF' })
      return backendNodeId
    }
    const selector = strArg(args, 'selector')
    if (selector !== undefined && selector !== '') return await this.resolveSelector(tabId, selector)
    throw Object.assign(new Error('需要 ref 或 selector 参数'), { code: 'INVALID_ARGS' })
  }

  private async snapshotOf(tabId: number): Promise<ToolResult | ToolFailure> {
    const info = this.core.getTabInfo(tabId)
    let rendered = await this.captureNodes(tabId)
    if (rendered.lines.length <= 1) {
      // 空快照（导航未完成）：短退避重取一次
      await sleep(1200)
      rendered = await this.captureNodes(tabId)
    }
    this.lastSnapshot.set(tabId, rendered)
    return {
      ok: true,
      tool: 'browser_snapshot',
      result: { tabId, url: info?.url ?? '', title: info?.title ?? '', snapshot: rendered.text },
    }
  }

  /** selector 兜底（冒烟与联调用；正式 agent 走 ref） */
  private async resolveSelector(tabId: number, selector: string): Promise<number> {
    const doc = (await this.core.sendTabCommand(tabId, 'DOM.getDocument')) as { root?: { nodeId?: number } }
    const rootId = doc.root?.nodeId
    if (rootId === undefined) throw Object.assign(new Error('DOM.getDocument 失败'), { code: 'TOOL_ERROR' })
    const found = (await this.core.sendTabCommand(tabId, 'DOM.querySelector', { nodeId: rootId, selector })) as { nodeId?: number }
    const nodeId = found.nodeId
    if (nodeId === undefined || nodeId === 0) {
      throw Object.assign(new Error(`选择器零匹配：${selector}`), { code: 'SELECTOR_NO_MATCH' })
    }
    const node = (await this.core.sendTabCommand(tabId, 'DOM.describeNode', { nodeId })) as { node?: { backendNodeId?: number } }
    const backendNodeId = node.node?.backendNodeId
    if (backendNodeId === undefined) throw Object.assign(new Error(`节点无 backendNodeId：${selector}`), { code: 'TOOL_ERROR' })
    return backendNodeId
  }
}
