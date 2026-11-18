/**
 * 信息流实时图(38 号 T9;30 号 §2 视图 2/§2.1、§7-1/§7-2 拍板):
 *
 * - 渲染 = Canvas(§7-1:性能优先;画布不吃 CSS);
 * - 三配套:① hover/点击/拖拽交互手写(hitTestFlowNode + 指针事件,无 DOM 免费
 *   午餐);② 主题令牌渲染时经 getComputedStyle 读取 --et-*(design-tokens §2
 *   桥接声明位置 = body,深浅主题切换重绘);③ a11y 补偿 = 旁挂可键盘导航的
 *   等价列表视图(原型 04:按工单浏览/按节点浏览,屏幕阅读器与键盘用户走列表
 *   不走画布);
 * - 实时语义(§7-2) = 200ms 合批消费(mock 流共享投影)+ 暂停 + 单工单回放
 *   (数据源 audit trace;全局时间轴回放不做,F-11)。
 *
 * 「暂停」语义按 38 号 O-3 开放问题口径落最小实现:暂停 = 冻结画布的实时
 * 跳动与数据驱动重绘(共享快照照常演进,事件仍并入其他视图);恢复时按当前
 * 共享快照重绘。O-3 拍板(缓存/丢弃/合并、追赶/跳最新)后如需改,只动
 * FlowCanvasStage 的 setPaused 分支。
 *
 * 分层:FlowView = 受控纯组件(渲染树测试直驱);FlowCanvasStage = 画布命令
 * 节制器(依赖注入,无 DOM 环境可测);FlowStage = 壳(hooks 接线)。
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { Icon } from '@eterna/ui/icons'
import {
  FLOW_NODE_TITLE, moveRovingIndex,
  type FlowGraphView, type FlowLegendItem, type FlowNodeView,
} from '../project/flow-graph.ts'
import { flowGraphView, hitTestFlowNode } from '../project/flow-graph.ts'
import { replayNarration, replayTrack, type ReplayStep, type ReplayTrack } from '../project/replay.ts'
import type { FlowNodeKey, WorkbenchSnapshot, WorkbenchTicket } from '../types.ts'
import { Segments } from './KanbanView.tsx'

/* ── 配套②:主题令牌读取(getComputedStyle → --et-*;30 号 §7-1②)── */

/** 画布取色用 CSS 声明面子集(getComputedStyle(element) 的消费面)。 */
export interface FlowThemeSource {
  getPropertyValue(name: string): string
}

/** 解析后的 RGBA 色(画布 tint 合成用;color-mix() 无法在画布求值)。 */
export interface FlowThemeColor {
  readonly r: number
  readonly g: number
  readonly b: number
  readonly a: number
}

export interface FlowTheme {
  readonly surface: FlowThemeColor
  readonly border: FlowThemeColor
  readonly fg: FlowThemeColor
  readonly fg2: FlowThemeColor
  readonly muted: FlowThemeColor
  readonly meta: FlowThemeColor
  readonly accent: FlowThemeColor
  readonly warn: FlowThemeColor
  readonly danger: FlowThemeColor
  readonly font: string
}

/** 解析 CSS 颜色串(hex/rgb/rgba);color-mix() 等画布不可求值形态回落兜位值
 * (tokens.ts 的 Webflow 浅色缺省——令牌桥接断裂时画布仍可读,38 号 §9 风险对策)。 */
export function parseCssColor(value: string, fallback: string): FlowThemeColor {
  const text = value.trim()
  const hex = /^#([0-9a-f]{3,8})$/i.exec(text)
  if (hex !== null) {
    const digits = hex[1]!
    const expanded = digits.length === 3 || digits.length === 4
      ? [...digits].map(char => char + char).join('')
      : digits
    const r = Number.parseInt(expanded.slice(0, 2), 16)
    const g = Number.parseInt(expanded.slice(2, 4), 16)
    const b = Number.parseInt(expanded.slice(4, 6), 16)
    const a = expanded.length >= 8 ? Number.parseInt(expanded.slice(6, 8), 16) / 255 : 1
    if ([r, g, b, a].every(Number.isFinite)) return { r, g, b, a }
  }
  const rgb = /^rgba?\(([^)]+)\)$/i.exec(text)
  if (rgb !== null) {
    const parts = rgb[1]!.split(/[,\s/]+/).filter(part => part !== '')
    if (parts.length >= 3) {
      const to255 = (part: string): number => part.endsWith('%') ? Number.parseFloat(part) / 100 * 255 : Number.parseFloat(part)
      const r = to255(parts[0]!)
      const g = to255(parts[1]!)
      const b = to255(parts[2]!)
      const a = parts[3] === undefined ? 1 : Number.parseFloat(parts[3])
      if ([r, g, b, a].every(Number.isFinite)) return { r, g, b, a }
    }
  }
  const fb = /^#([0-9a-f]{6})$/i.exec(fallback.trim())
  if (fb === null) return { r: 0, g: 0, b: 0, a: 1 }
  return {
    r: Number.parseInt(fb[1]!.slice(0, 2), 16),
    g: Number.parseInt(fb[1]!.slice(2, 4), 16),
    b: Number.parseInt(fb[1]!.slice(4, 6), 16),
    a: 1,
  }
}

/**
 * 令牌兜位值(packages/ui tokens.ts 的 v4「温润如玉」浅色;仅当令牌不可解析
 * 时使用)。改令牌时这里必须同步——画布是 <canvas>,取不到 CSS 变量就退回
 * 这组十六进制,漏改会静默画出 v3 的冷白/电光蓝。
 */
const TOKEN_FALLBACKS = {
  '--et-surface': '#fbfaf6',
  '--et-border': '#dcd8cd',
  '--et-fg': '#1b1e1c',
  '--et-fg-2': '#3c423e',
  '--et-muted': '#5f655f',
  '--et-meta': '#6f756e',
  '--et-accent': '#2b6272',
  '--et-warn': '#94661c',
  '--et-danger': '#a63d2e',
} as const

/** rgba() 串(tint 合成:同色给透明度,原型 color-mix 的画布等价)。 */
export function rgba(color: FlowThemeColor, alpha = color.a): string {
  return `rgba(${color.r}, ${color.g}, ${color.b}, ${alpha})`
}

/**
 * 读取画布主题令牌(30 号 §7-1②;design-tokens §2:--et-* 经 --dsw-alias-*
 * 桥接在 body 层声明——调用方必须传 body 的 computed style,画布才能取到
 * 深色主题值,38 号 §9 风险行)。
 */
export function readFlowTheme(style: FlowThemeSource | undefined): FlowTheme {
  const read = (name: string, fallback: string): FlowThemeColor =>
    parseCssColor(style?.getPropertyValue(name) ?? '', fallback)
  return {
    surface: read('--et-surface', TOKEN_FALLBACKS['--et-surface']),
    border: read('--et-border', TOKEN_FALLBACKS['--et-border']),
    fg: read('--et-fg', TOKEN_FALLBACKS['--et-fg']),
    fg2: read('--et-fg-2', TOKEN_FALLBACKS['--et-fg-2']),
    muted: read('--et-muted', TOKEN_FALLBACKS['--et-muted']),
    meta: read('--et-meta', TOKEN_FALLBACKS['--et-meta']),
    accent: read('--et-accent', TOKEN_FALLBACKS['--et-accent']),
    warn: read('--et-warn', TOKEN_FALLBACKS['--et-warn']),
    danger: read('--et-danger', TOKEN_FALLBACKS['--et-danger']),
    font: style?.getPropertyValue('--et-font-body')?.trim() || 'sans-serif',
  }
}

/* ── 画布绘制(布局 = 原型 03 flow-svg 逐字;颜色全部来自 FlowTheme)── */

/** 画布 2D 上下文消费面子集(测试注入录制型假上下文)。 */
export interface FlowPaintContext {
  save(): void
  restore(): void
  scale(x: number, y: number): void
  translate(x: number, y: number): void
  clearRect(x: number, y: number, width: number, height: number): void
  beginPath(): void
  closePath(): void
  moveTo(x: number, y: number): void
  lineTo(x: number, y: number): void
  arc(x: number, y: number, radius: number, start: number, end: number): void
  arcTo(x1: number, y1: number, x2: number, y2: number, radius: number): void
  stroke(): void
  fill(): void
  fillText(text: string, x: number, y: number): void
  setLineDash(segments: readonly number[]): void
  measureText(text: string): { width: number }
  fillStyle: string
  strokeStyle: string
  lineWidth: number
  globalAlpha: number
  lineCap: string
  lineJoin: string
  font: string
  textAlign: string
  textBaseline: string
  lineDashOffset: number
}

export interface FlowPaintState {
  readonly panX: number
  readonly panY: number
  readonly hoverKey: FlowNodeKey | undefined
  readonly selectedKey: FlowNodeKey | undefined
  /** 回放轨迹(原型 03 freplay:加粗强调线,progress 0..1 按事件序列推进)。 */
  readonly replay: { readonly points: readonly { readonly x: number; readonly y: number }[]; readonly progress: number } | undefined
  /** 活跃边虚线相位(0..1;原型 03 edge-flow 1.2s 周期)。 */
  readonly animPhase: number
}

/** 视区与节点几何(原型 03 flow-svg viewBox/transform 逐字:第一行四节点左→右,
 * 第二行五节点右→左)。 */
const VIEW_W = 960
const VIEW_H = 400
const NODE_W = 140
const NODE_H = 60
const GAP = 6
const EDGE_DASH: readonly number[] = [6, 5]
const BUBBLE_DASH: readonly number[] = [5, 4]
const NODE_KEYS: readonly FlowNodeKey[] = [
  'trigger', 'thread', 'eval', 'decision', 'ticket', 'assignment', 'worker', 'report', 'outbox',
]

function nodeRect(key: FlowNodeKey): { x: number; y: number } {
  const index = NODE_KEYS.indexOf(key)
  const row = index < 4 ? 0 : 1
  const inRow = row === 0 ? index : index - 4
  const x = row === 0 ? 40 + inRow * 240 : 760 - inRow * 180
  const y = row === 0 ? 40 : 210
  return { x, y }
}

function stateColors(state: FlowNodeView['state'], theme: FlowTheme): { stroke: FlowThemeColor; fill: string; dot: FlowThemeColor; width: number } {
  if (state === 'active') return { stroke: theme.accent, fill: rgba(theme.accent, 0.07), dot: theme.accent, width: 1.5 }
  if (state === 'stuck') return { stroke: theme.warn, fill: rgba(theme.warn, 0.1), dot: theme.warn, width: 2 }
  if (state === 'error') return { stroke: theme.danger, fill: rgba(theme.danger, 0.1), dot: theme.danger, width: 1.5 }
  return { stroke: theme.border, fill: rgba(theme.surface), dot: theme.meta, width: 1.5 }
}

function roundedRect(ctx: FlowPaintContext, x: number, y: number, width: number, height: number, radius: number): void {
  ctx.beginPath()
  ctx.moveTo(x + radius, y)
  ctx.arcTo(x + width, y, x + width, y + height, radius)
  ctx.arcTo(x + width, y + height, x, y + height, radius)
  ctx.arcTo(x, y + height, x, y, radius)
  ctx.arcTo(x, y, x + width, y, radius)
  ctx.closePath()
}

function drawArrow(ctx: FlowPaintContext, from: { x: number; y: number }, to: { x: number; y: number }, size: number): void {
  const angle = Math.atan2(to.y - from.y, to.x - from.x)
  ctx.beginPath()
  ctx.moveTo(to.x, to.y)
  ctx.lineTo(to.x - size * Math.cos(angle - Math.PI / 6), to.y - size * Math.sin(angle - Math.PI / 6))
  ctx.lineTo(to.x - size * Math.cos(angle + Math.PI / 6), to.y - size * Math.sin(angle + Math.PI / 6))
  ctx.closePath()
  ctx.fill()
}

function polylineLength(points: readonly { x: number; y: number }[]): number {
  let total = 0
  for (let index = 1; index < points.length; index += 1) {
    total += Math.hypot(points[index]!.x - points[index - 1]!.x, points[index]!.y - points[index - 1]!.y)
  }
  return total
}

/**
 * 画布绘制本体:回放轨迹/事件边/卡点气泡/九节点/hover 提示(原型 03 视图二
 * 静态稿的 Canvas 翻译;F-12 三要素中的画布面——布局、卡点态;图例为 DOM,
 * 见 FlowView)。取色仅经 theme(--et-* 解析值),无字面色。
 */
export function paintFlowGraph(ctx: FlowPaintContext, view: FlowGraphView, theme: FlowTheme, state: FlowPaintState): void {
  const fontOf = (size: number, weight: number): string => `${weight} ${size}px ${theme.font}`
  ctx.save()
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.clearRect(0, 0, VIEW_W, VIEW_H)
  ctx.translate(state.panX, state.panY)

  // 回放轨迹(绘制于节点之下;原型 03 freplay:3px 强调线,progress 截长)
  if (state.replay !== undefined && state.replay.points.length >= 2) {
    const total = polylineLength(state.replay.points)
    const target = total * Math.min(1, Math.max(0, state.replay.progress))
    ctx.strokeStyle = rgba(theme.accent)
    ctx.lineWidth = 3
    ctx.globalAlpha = 0.8
    ctx.setLineDash([])
    ctx.beginPath()
    ctx.moveTo(state.replay.points[0]!.x, state.replay.points[0]!.y)
    let walked = 0
    for (let index = 1; index < state.replay.points.length; index += 1) {
      const from = state.replay.points[index - 1]!
      const to = state.replay.points[index]!
      const segment = Math.hypot(to.x - from.x, to.y - from.y)
      if (walked + segment <= target) {
        ctx.lineTo(to.x, to.y)
        walked += segment
      } else {
        const remain = target - walked
        ctx.lineTo(from.x + (to.x - from.x) * (remain / segment), from.y + (to.y - from.y) * (remain / segment))
        break
      }
    }
    ctx.stroke()
    ctx.globalAlpha = 1
  }

  // 事件边(原型 03 fedge;live = 200ms 合批推送中的虚线动画边)
  for (const edge of view.edges) {
    const from = nodeRect(edge.from)
    const to = nodeRect(edge.to)
    const horizontal = from.y === to.y
    const start = horizontal
      ? (to.x > from.x ? { x: from.x + NODE_W, y: from.y + NODE_H / 2 } : { x: from.x, y: from.y + NODE_H / 2 })
      : { x: from.x + NODE_W / 2, y: from.y + NODE_H }
    const end = horizontal
      ? (to.x > from.x ? { x: to.x - GAP, y: to.y + NODE_H / 2 } : { x: to.x + NODE_W + GAP, y: to.y + NODE_H / 2 })
      : { x: to.x + NODE_W / 2, y: to.y - GAP }
    const color = edge.live ? theme.accent : theme.meta
    ctx.strokeStyle = rgba(color)
    ctx.fillStyle = rgba(color)
    ctx.lineWidth = 1.5
    if (edge.live) {
      ctx.setLineDash(EDGE_DASH)
      ctx.lineDashOffset = -state.animPhase * 11
    } else {
      ctx.setLineDash([])
      ctx.lineDashOffset = 0
    }
    ctx.beginPath()
    ctx.moveTo(start.x, start.y)
    ctx.lineTo(end.x, end.y)
    ctx.stroke()
    drawArrow(ctx, start, end, 7)
  }
  ctx.setLineDash([])
  ctx.lineDashOffset = 0

  // 卡点气泡(person/* 驻留 > 0;原型 03 fbubble 逐字文案/几何)
  if (view.bubble !== undefined) {
    const anchor = nodeRect('assignment')
    const linkX = anchor.x + NODE_W / 2
    ctx.strokeStyle = rgba(theme.meta)
    ctx.lineWidth = 1.5
    ctx.setLineDash([])
    ctx.beginPath()
    ctx.moveTo(linkX, anchor.y + NODE_H)
    ctx.lineTo(linkX, 306)
    ctx.stroke()
    roundedRect(ctx, 440, 310, 420, 64, 4)
    ctx.fillStyle = rgba(theme.warn, 0.08)
    ctx.fill()
    ctx.strokeStyle = rgba(theme.warn)
    ctx.setLineDash(BUBBLE_DASH)
    ctx.stroke()
    ctx.setLineDash([])
    ctx.font = fontOf(14, 600)
    ctx.textAlign = 'center'
    ctx.fillStyle = rgba(theme.warn)
    ctx.fillText(view.bubble.text, 650, 336)
    ctx.font = fontOf(12, 500)
    ctx.fillStyle = rgba(theme.muted)
    ctx.fillText(view.bubble.sub, 650, 358)
  }

  // 九节点(矩形/状态点/标题/副行;hover/selected 手写交互反馈)
  for (const node of view.nodes) {
    const rect = nodeRect(node.key)
    const colors = stateColors(node.state, theme)
    roundedRect(ctx, rect.x, rect.y, NODE_W, NODE_H, 4)
    ctx.fillStyle = colors.fill
    ctx.fill()
    ctx.strokeStyle = rgba(colors.stroke)
    ctx.lineWidth = colors.width
    ctx.stroke()
    if (node.key === state.hoverKey && node.key !== state.selectedKey) {
      roundedRect(ctx, rect.x - 2, rect.y - 2, NODE_W + 4, NODE_H + 4, 6)
      ctx.strokeStyle = rgba(theme.accent, 0.6)
      ctx.lineWidth = 1
      ctx.stroke()
    }
    if (node.key === state.selectedKey) {
      roundedRect(ctx, rect.x - 3, rect.y - 3, NODE_W + 6, NODE_H + 6, 7)
      ctx.strokeStyle = rgba(theme.accent)
      ctx.lineWidth = 2
      ctx.stroke()
    }
    ctx.beginPath()
    ctx.arc(rect.x + 14, rect.y + 16, 4, 0, Math.PI * 2)
    ctx.fillStyle = rgba(colors.dot)
    ctx.fill()
    ctx.textAlign = 'left'
    ctx.font = fontOf(14, 600)
    ctx.fillStyle = rgba(theme.fg)
    ctx.fillText(node.title, rect.x + 26, rect.y + 21)
    ctx.font = fontOf(12, 500)
    ctx.fillStyle = rgba(theme.muted)
    ctx.fillText(node.sub, rect.x + 12, rect.y + 44)
  }

  // hover 提示(原型 04「画布的 hover 提示」:节点名 + 状态/副行,随节点)
  if (state.hoverKey !== undefined) {
    const node = view.nodes.find(item => item.key === state.hoverKey)
    if (node !== undefined) {
      const rect = nodeRect(node.key)
      const line1 = node.title
      const line2 = `${node.stateLabel} · ${node.sub}`
      ctx.font = fontOf(12, 600)
      const width = Math.max(ctx.measureText(line1).width, ctx.measureText(line2).width) + 16
      const boxX = Math.min(Math.max(rect.x, 4), Math.max(4, VIEW_W - width - 4))
      const boxY = rect.y + NODE_H + 8
      roundedRect(ctx, boxX, boxY, width, 40, 4)
      ctx.fillStyle = rgba(theme.surface, 0.96)
      ctx.fill()
      ctx.strokeStyle = rgba(theme.border)
      ctx.lineWidth = 1
      ctx.stroke()
      ctx.font = fontOf(12, 600)
      ctx.fillStyle = rgba(theme.fg)
      ctx.fillText(line1, boxX + 8, boxY + 16)
      ctx.font = fontOf(11, 500)
      ctx.fillStyle = rgba(theme.muted)
      ctx.fillText(line2, boxX + 8, boxY + 31)
    }
  }
  ctx.restore()
}

/* ── 画布命令节制器(配套①:手写 hover/点击/拖拽;配套②:主题变更重绘)── */

/** 画布元素消费面子集(测试注入假画布)。 */
export interface FlowCanvasElement {
  readonly style: { cursor: string }
  getContext(type: '2d'): (FlowPaintContext & { scale(x: number, y: number): void }) | null
  addEventListener(type: string, listener: (event: FlowPointerEvent) => void): void
  removeEventListener(type: string, listener: (event: FlowPointerEvent) => void): void
  getBoundingClientRect(): { readonly left: number; readonly top: number; readonly width: number; readonly height: number }
}

export interface FlowPointerEvent {
  readonly clientX: number
  readonly clientY: number
}

export interface FlowStageDeps {
  /** 令牌读取目标(design-tokens §2:--et-* 桥接在 body 层声明)。 */
  readonly themeStyle: () => FlowThemeSource | undefined
  /** 主题变更监听(默认实现:MutationObserver + prefers-color-scheme;注入可测)。 */
  readonly watchTheme: (onChange: () => void) => () => void
  readonly requestAnimationFrame: (callback: () => void) => number
  readonly cancelAnimationFrame: (handle: number) => void
  readonly reducedMotion: () => boolean
  readonly devicePixelRatio: number
  readonly now: () => number
}

export interface FlowCanvasStage {
  paint(): void
  setView(view: FlowGraphView): void
  setPaused(paused: boolean): void
  startReplay(track: ReplayTrack | undefined, ticketId: string): void
  /** 主题切换重绘(30 号 §7-1②:双主题切换需重绘;暂停态同样重绘——取色错更糟)。 */
  refreshTheme(): void
  dispose(): void
}

export interface FlowStageOptions {
  /** aria-live 播报(回放步进/节点选中;原型 04 状态播报约定)。 */
  readonly onAnnounce?: (message: string) => void
  readonly deps?: Partial<FlowStageDeps>
}

/** 回放步进周期(展示参数;非规格值——prefers-reduced-motion 时整轨立现)。 */
const REPLAY_STEP_MS = 500
/** 活跃边虚线周期(原型 03 edge-flow 1.2s)。 */
const EDGE_FLOW_MS = 1200
/** 拖拽阈值(px,指针抖动不吞点击)。 */
const DRAG_THRESHOLD_PX = 3

/** 默认主题监听:body/html 属性变更(DSH 主题切换)+ 系统深浅变化。 */
function watchDomTheme(onChange: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  const disposers: (() => void)[] = []
  const media = window.matchMedia('(prefers-color-scheme: dark)')
  const onMediaChange = (): void => { onChange() }
  if (typeof media.addEventListener === 'function') {
    media.addEventListener('change', onMediaChange)
    disposers.push(() => { media.removeEventListener('change', onMediaChange) })
  }
  if (typeof MutationObserver === 'function' && typeof document !== 'undefined') {
    const observer = new MutationObserver(() => { onChange() })
    observer.observe(document.documentElement, { attributes: true })
    observer.observe(document.body, { attributes: true })
    disposers.push(() => { observer.disconnect() })
  }
  return () => { for (const dispose of disposers) dispose() }
}

function defaultDeps(): FlowStageDeps {
  const hasWindow = typeof window !== 'undefined'
  return {
    themeStyle: () => {
      if (typeof document === 'undefined' || document.body === null) return undefined
      return window.getComputedStyle(document.body)
    },
    watchTheme: watchDomTheme,
    requestAnimationFrame: hasWindow
      ? callback => window.requestAnimationFrame(callback)
      : callback => setTimeout(callback, 16) as unknown as number,
    cancelAnimationFrame: hasWindow
      ? handle => window.cancelAnimationFrame(handle)
      : handle => { clearTimeout(handle as unknown as ReturnType<typeof setTimeout>) },
    reducedMotion: () => hasWindow && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    devicePixelRatio: hasWindow ? window.devicePixelRatio : 1,
    now: () => Date.now(),
  }
}

function replayStepLine(step: ReplayStep): string {
  return `回放事件：${step.time} ${step.source} → ${FLOW_NODE_TITLE[step.nodeKey]}`
}

function hasLiveEdge(view: FlowGraphView | undefined): boolean {
  return view?.edges.some(edge => edge.live) ?? false
}

/**
 * 画布节制器:持有可变交互态(pan/hover/selected/回放进度/动画相位),数据
 * 到达(setView)与用户动作分别驱动重绘——暂停只冻结前者(O-3 最小实现)。
 */
export function createFlowCanvasStage(canvas: FlowCanvasElement, options: FlowStageOptions = {}): FlowCanvasStage {
  const deps: FlowStageDeps = { ...defaultDeps(), ...options.deps }
  const ctx = canvas.getContext('2d')
  let view: FlowGraphView | undefined
  let theme = readFlowTheme(deps.themeStyle())
  let paused = false
  let disposed = false
  let panX = 0
  let panY = 0
  let hoverKey: FlowNodeKey | undefined
  let selectedKey: FlowNodeKey | undefined
  let replay: { ticketId: string; track: ReplayTrack | undefined; progress: number; announced: number } | undefined
  let animPhase = 0
  let animating = false
  let frameHandle: number | undefined
  let lastTick: number | undefined

  const announce = (message: string): void => { options.onAnnounce?.(message) }

  const paint = (): void => {
    if (disposed || ctx === null || view === undefined) return
    const scale = deps.devicePixelRatio > 1 ? deps.devicePixelRatio : 1
    ctx.save()
    if (scale > 1) ctx.scale(scale, scale)
    paintFlowGraph(ctx, view, theme, {
      panX, panY, hoverKey, selectedKey,
      replay: replay === undefined
        ? undefined
        : { points: replay.track?.points ?? [], progress: replay.progress },
      animPhase,
    })
    ctx.restore()
  }

  const stopLoop = (): void => {
    if (frameHandle !== undefined) {
      deps.cancelAnimationFrame(frameHandle)
      frameHandle = undefined
    }
  }

  const ensureLoop = (): void => {
    if (disposed || paused || deps.reducedMotion() || !animating || frameHandle !== undefined) return
    lastTick = deps.now()
    const tick = (): void => {
      if (disposed || paused || !animating) {
        frameHandle = undefined
        return
      }
      const now = deps.now()
      const dt = lastTick === undefined ? 0 : Math.max(0, now - lastTick)
      lastTick = now
      animPhase = (animPhase + dt / EDGE_FLOW_MS) % 1
      if (replay !== undefined && replay.progress < 1) {
        const steps = replay.track?.steps ?? []
        replay.progress = Math.min(1, replay.progress + dt / Math.max(1, steps.length * REPLAY_STEP_MS))
        const crossed = Math.floor(replay.progress * steps.length)
        for (let index = replay.announced; index < crossed && index < steps.length; index += 1) {
          announce(replayStepLine(steps[index]!))
        }
        replay.announced = Math.max(replay.announced, Math.min(crossed, steps.length))
        if (replay.progress >= 1) animating = hasLiveEdge(view)
      }
      paint()
      frameHandle = deps.requestAnimationFrame(tick)
    }
    frameHandle = deps.requestAnimationFrame(tick)
  }

  const toLayoutPoint = (event: FlowPointerEvent): { x: number; y: number } => {
    const rect = canvas.getBoundingClientRect()
    const scaleX = rect.width === 0 ? 1 : VIEW_W / rect.width
    const scaleY = rect.height === 0 ? 1 : VIEW_H / rect.height
    return {
      x: (event.clientX - rect.left) * scaleX - panX,
      y: (event.clientY - rect.top) * scaleY - panY,
    }
  }

  let dragging: { startX: number; startY: number; panX: number; panY: number; moved: boolean } | undefined

  const onPointerMove = (event: FlowPointerEvent): void => {
    if (disposed) return
    if (dragging !== undefined) {
      const rect = canvas.getBoundingClientRect()
      const scaleX = rect.width === 0 ? 1 : VIEW_W / rect.width
      const scaleY = rect.height === 0 ? 1 : VIEW_H / rect.height
      panX = dragging.panX + (event.clientX - dragging.startX) * scaleX
      panY = dragging.panY + (event.clientY - dragging.startY) * scaleY
      if (Math.hypot(event.clientX - dragging.startX, event.clientY - dragging.startY) > DRAG_THRESHOLD_PX) {
        dragging.moved = true
        canvas.style.cursor = 'grabbing'
      }
      paint()
      return
    }
    const point = toLayoutPoint(event)
    hoverKey = hitTestFlowNode(point.x, point.y)
    canvas.style.cursor = hoverKey === undefined ? 'default' : 'pointer'
    paint()
  }

  const onPointerDown = (event: FlowPointerEvent): void => {
    if (disposed) return
    dragging = { startX: event.clientX, startY: event.clientY, panX, panY, moved: false }
  }

  const onPointerUp = (event: FlowPointerEvent): void => {
    if (disposed) return
    const wasDrag = dragging?.moved === true
    dragging = undefined
    canvas.style.cursor = 'default'
    if (wasDrag) return
    const point = toLayoutPoint(event)
    selectedKey = hitTestFlowNode(point.x, point.y)
    if (selectedKey !== undefined) {
      const node = view?.nodes.find(item => item.key === selectedKey)
      if (node !== undefined) announce(`${node.title}（${node.sub}）`)
    }
    paint()
  }

  const onPointerLeave = (): void => {
    if (disposed) return
    hoverKey = undefined
    dragging = undefined
    canvas.style.cursor = 'default'
    paint()
  }

  const disposeThemeWatch = deps.watchTheme(() => {
    theme = readFlowTheme(deps.themeStyle())
    paint()
  })

  canvas.addEventListener('pointermove', onPointerMove)
  canvas.addEventListener('pointerdown', onPointerDown)
  canvas.addEventListener('pointerup', onPointerUp)
  canvas.addEventListener('pointerleave', onPointerLeave)

  paint()

  return {
    paint,
    setView(next: FlowGraphView): void {
      view = next
      animating = hasLiveEdge(next) || (replay?.progress ?? 1) < 1
      if (paused) return // 暂停:数据驱动重绘冻结(O-3 最小实现),恢复时追平
      paint()
      ensureLoop()
    },
    setPaused(next: boolean): void {
      paused = next
      if (paused) {
        stopLoop()
        return
      }
      paint() // 恢复:按当前共享快照重绘
      ensureLoop()
    },
    startReplay(track: ReplayTrack | undefined, ticketId: string): void {
      replay = { ticketId, track, progress: deps.reducedMotion() ? 1 : 0, announced: 0 }
      announce(replayNarration(track ?? { ticketId, steps: [], nodeKeys: [], points: [] }))
      if (replay.progress >= 1) for (const step of track?.steps ?? []) announce(replayStepLine(step))
      animating = true
      paint()
      ensureLoop()
    },
    refreshTheme(): void {
      theme = readFlowTheme(deps.themeStyle())
      paint()
    },
    dispose(): void {
      disposed = true
      stopLoop()
      disposeThemeWatch()
      canvas.removeEventListener('pointermove', onPointerMove)
      canvas.removeEventListener('pointerdown', onPointerDown)
      canvas.removeEventListener('pointerup', onPointerUp)
      canvas.removeEventListener('pointerleave', onPointerLeave)
    },
  }
}

/* ── 受控纯组件(视图二 + 旁挂等价列表;渲染树测试直驱)── */

export interface FlowViewProps {
  readonly view: FlowGraphView
  readonly tickets: readonly WorkbenchTicket[]
  readonly paused: boolean
  readonly replayTicketId: string
  /** aria-live 文案(播报状态由壳持有;纯组件只渲染文本)。 */
  readonly announce: string
  readonly t: (key: string) => string
  readonly onTogglePause: () => void
  readonly onReplayTicketChange: (ticketId: string) => void
  readonly onReplayStart: () => void
  /** 旁挂列表行内回放入口(原型 04 视图 A 行按钮)。 */
  readonly onRowReplay: (ticketId: string) => void
  /** 画布元素接线(FlowStage 注入;纯渲染面不感知节制器)。 */
  readonly canvasRef?: (element: HTMLCanvasElement | null) => void
}

const LEGEND_SWATCH: Readonly<Record<FlowLegendItem['swatch'], string>> = {
  idle: 'idle',
  active: 'active',
  stuck: 'stuck',
  error: 'error',
  edge: 'edge',
  'edge-live': 'edge-live',
  replay: 'replay',
}

const DOT_BY_COLUMN: Readonly<Record<string, 'wait-person' | 'working' | 'queued' | 'idle'>> = {
  person: 'wait-person',
  working: 'working',
  queued: 'queued',
  idle: 'idle',
}

function stageCodeOf(ticket: WorkbenchTicket): string {
  if (ticket.column === 'person') return ticket.metaLine[1]?.text ?? 'person/*'
  if (ticket.column === 'working') return 'working'
  if (ticket.column === 'queued') return 'working/queued'
  return 'idle'
}

function ticketNodeLabel(ticket: WorkbenchTicket): string {
  return ticket.a11yRow?.node ?? (ticket.column === 'working' ? 'Worker 执行' : ticket.column === 'idle' ? '—' : 'Ticket 工单')
}

function ticketOpenHref(ticket: WorkbenchTicket): string {
  return ticket.column === 'working' ? '#wb-v5' : '#wb-v1'
}

/** 方向键漫游:把焦点移到容器内第 index 行的首个可操作元素(原型 04 键盘约定)。 */
function roveToRow(container: HTMLElement | null, index: number): void {
  const rows = container?.querySelectorAll<HTMLElement>('[data-eterna-workbench="ticket-row"], [data-eterna-workbench="node-item"]')
  const row = rows?.[index]
  row?.querySelector<HTMLElement>('button, a, summary')?.focus()
}

/** 视图二 · 信息流实时图(画布 + 图例 + 旁挂 a11y 等价列表 = 原型 03 视图二 + 原型 04)。 */
export function FlowView(props: FlowViewProps): ReactElement {
  const { view, tickets, paused, replayTicketId, announce, t } = props
  const replayable = new Set(view.replayOptions)
  // 「等人」优先排序(卡点置顶;原型 04 视图 A)
  const ordered = [...tickets].sort((left, right) => Number(right.column === 'person') - Number(left.column === 'person'))

  return (
    <section data-eterna-workbench="view" data-eterna-workbench-view="flow" id="wb-v2" aria-labelledby="wb-h-v2">
      <div data-eterna-workbench="view-head">
        <h2 data-eterna-workbench="view-title" id="wb-h-v2">信息流实时图</h2>
      </div>
      <p data-eterna-workbench="view-desc">实时展示每个任务的处理进度：从发起到交付经过的每个环节。卡在某一步的任务会以警示色标注；下方附带等价的文字列表，方便逐项查看。</p>

      <div data-eterna-workbench="toolbar" role="group" aria-label="实时图控制">
        <button
          type="button"
          data-eterna-workbench="btn-secondary"
          data-eterna-workbench-flow="pause"
          aria-pressed={paused}
          onClick={() => { props.onTogglePause() }}
        ><Icon name="pause" size={16} />{t('toolbar.pause')}</button>
        <label data-eterna-workbench="replay-label" htmlFor="wb-replay-select">{t('toolbar.replay')}</label>
        <select
          id="wb-replay-select"
          data-eterna-workbench="replay-select"
          value={replayTicketId}
          onChange={event => { props.onReplayTicketChange(event.target.value) }}
        >
          {view.replayOptions.length === 0 && <option value="">（无可回放工单）</option>}
          {view.replayOptions.map(ticketId => {
            const ticket = tickets.find(item => item.id === ticketId)
            return <option key={ticketId} value={ticketId}>{`${ticketId} ${ticket?.title ?? ''}`}</option>
          })}
        </select>
        <button
          type="button"
          data-eterna-workbench="btn-secondary"
          data-eterna-workbench-flow="replay-start"
          disabled={view.replayOptions.length === 0}
          onClick={() => { props.onReplayStart() }}
        ><Icon name="replay" size={16} />{t('toolbar.replayStart')}</button>
      </div>

      <div data-eterna-workbench="graph-wrap">
        <canvas
          ref={props.canvasRef}
          data-eterna-workbench="flow-canvas"
          width={960}
          height={400}
          role="img"
          aria-label="信息流实时图：九个领域节点的实时活图（Trigger→…→Outbox），person/* 卡点以警示色驻留；画布内容屏幕阅读器不可读，等价清单见下方「按工单浏览」与「按节点浏览」。"
        />
      </div>

      <h3 data-eterna-workbench="sub-h">图例</h3>
      <ul data-eterna-workbench="legend">
        {view.legend.map(item => (
          <li key={item.label} data-eterna-workbench="legend-item">
            <span data-eterna-workbench="legend-swatch" data-eterna-workbench-swatch={LEGEND_SWATCH[item.swatch]} aria-hidden="true" />
            {item.label}
          </li>
        ))}
      </ul>

      <p data-eterna-workbench="announce" role="status" aria-live="polite">{announce}</p>

      <section data-eterna-workbench="a11y-section" aria-labelledby="wb-h-flow-tickets">
        <div data-eterna-workbench="a11y-head">
          <p data-eterna-workbench="kicker">视图 A</p>
          <h3 data-eterna-workbench="view-title" id="wb-h-flow-tickets">按工单浏览</h3>
        </div>
        <p data-eterna-workbench="a11y-desc">默认「等人」优先排序（卡点置顶）；行内提供回放与打开入口——画布上点击工单节点的等价操作在这里是行内按钮。上下方向键在行间移动。</p>
        <div data-eterna-workbench="table-scroll">
          <table>
            <caption>活跃工单清单（与看板 / 画布同数据）</caption>
            <thead>
              <tr>
                <th scope="col">工单</th>
                <th scope="col">当前节点</th>
                <th scope="col">阶段</th>
                <th scope="col">等待谁</th>
                <th scope="col">停留</th>
                <th scope="col">最近事件</th>
                <th scope="col">操作</th>
              </tr>
            </thead>
            <tbody data-eterna-workbench="ticket-rows">
              {ordered.map((ticket, index) => (
                <tr
                  key={ticket.id}
                  data-eterna-workbench="ticket-row"
                  data-eterna-workbench-ticket={ticket.id}
                  data-eterna-workbench-stuck={ticket.column === 'person' ? 'true' : undefined}
                  onKeyDown={event => {
                    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
                    const target = moveRovingIndex(index, event.key === 'ArrowDown' ? 1 : -1, ordered.length)
                    if (target !== index) roveToRow(event.currentTarget.parentElement, target)
                  }}
                >
                  <th scope="row">
                    <a data-eterna-workbench="ticket-link" href={ticketOpenHref(ticket)}>
                      <span
                        data-eterna-workbench="dot"
                        data-eterna-workbench-dot={DOT_BY_COLUMN[ticket.column] ?? 'idle'}
                        data-eterna-workbench-pulse={ticket.column === 'person' ? 'true' : undefined}
                        aria-hidden="true"
                      />
                      <span data-eterna-workbench-seg-mono="true">{ticket.id}</span>
                      <span>{` ${ticket.title}`}</span>
                    </a>
                    {ticket.column === 'person' && <span data-eterna-workbench="badge" data-eterna-workbench-tone="warn">卡点</span>}
                  </th>
                  <td>{ticketNodeLabel(ticket)}</td>
                  <td><span data-eterna-workbench-seg-mono="true">{stageCodeOf(ticket)}</span></td>
                  <td>{ticket.a11yRow?.waiting ?? ticket.metaLine[2]?.text ?? '—'}</td>
                  <td data-eterna-workbench-num="true">{ticket.a11yRow?.dwell ?? '—'}</td>
                  <td>
                    {ticket.recentNote === undefined ? '—' : (
                      <>
                        <span data-eterna-workbench-num="true">{ticket.recentNote.time}</span>
                        <span>{` ${ticket.recentNote.text}`}</span>
                      </>
                    )}
                  </td>
                  <td data-eterna-workbench="row-actions">
                    {replayable.has(ticket.id) && (
                      <button
                        type="button"
                        data-eterna-workbench="btn"
                        data-eterna-workbench-replay={ticket.id}
                        onClick={() => { props.onRowReplay(ticket.id) }}
                      ><Icon name="replay" size={16} />回放</button>
                    )}
                    <a data-eterna-workbench="btn-ghost" href={ticketOpenHref(ticket)}>
                      <Icon name="arrow-right" size={16} />打开
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section data-eterna-workbench="a11y-section" aria-labelledby="wb-h-flow-nodes">
        <div data-eterna-workbench="a11y-head">
          <p data-eterna-workbench="kicker">视图 B</p>
          <h3 data-eterna-workbench="view-title" id="wb-h-flow-nodes">按节点浏览</h3>
        </div>
        <p data-eterna-workbench="a11y-desc">九个领域节点按流转顺序排列（Trigger→…→Outbox）；每个节点可展开最近事件。</p>
        <ol data-eterna-workbench="node-list">
          {view.nodes.map((node, index) => (
            <li
              key={node.key}
              data-eterna-workbench="node-item"
              data-eterna-workbench-node={node.key}
              data-eterna-workbench-stuck={node.state === 'stuck' ? 'true' : undefined}
              onKeyDown={event => {
                if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
                const target = moveRovingIndex(index, event.key === 'ArrowDown' ? 1 : -1, view.nodes.length)
                if (target !== index) roveToRow(event.currentTarget.parentElement, target)
              }}
            >
              <div data-eterna-workbench="node-item-head">
                <span data-eterna-workbench="node-order" data-eterna-workbench-num="true" aria-hidden="true">{index + 1}</span>
                <h4 data-eterna-workbench="node-name">{node.title}</h4>
                <span
                  data-eterna-workbench="badge"
                  data-eterna-workbench-tone={node.state === 'stuck' ? 'warn' : node.state === 'active' ? 'accent' : node.state === 'error' ? 'danger' : 'muted'}
                >{node.stateLabel}</span>
                <span data-eterna-workbench="node-stat">{node.stat}</span>
              </div>
              <details open={node.state === 'stuck'}>
                <summary><Icon name="chevron-right" size={14} />{node.eventsLabel}</summary>
                <ul data-eterna-workbench="event-list">
                  {node.events.map((line, lineIndex) => (
                    <li key={lineIndex}><Segments segments={line} /></li>
                  ))}
                </ul>
              </details>
            </li>
          ))}
        </ol>
      </section>
    </section>
  )
}

/* ── 壳:hooks 接线(画布元素 → 节制器;暂停/回放/播报状态)── */

export interface FlowStageProps {
  readonly snapshot: WorkbenchSnapshot
  readonly t: (key: string) => string
}

/** 视图二壳:FlowView(纯)+ 画布节制器生命周期 + 暂停/回放/aria-live 播报。 */
export function FlowStage({ snapshot, t }: FlowStageProps): ReactElement {
  const view = useMemo(() => flowGraphView(snapshot), [snapshot])
  const [paused, setPaused] = useState(false)
  const [replayTicketId, setReplayTicketId] = useState(view.replayOptions[0] ?? '')
  const [announce, setAnnounce] = useState('')
  const stageRef = useRef<ReturnType<typeof createFlowCanvasStage> | undefined>(undefined)
  const viewRef = useRef(view)
  viewRef.current = view
  const prevStuckCount = useRef<number | undefined>(undefined)

  const attachCanvas = useCallback((element: HTMLCanvasElement | null): void => {
    if (element === null) {
      stageRef.current?.dispose()
      stageRef.current = undefined
      return
    }
    stageRef.current = createFlowCanvasStage(element as unknown as FlowCanvasElement, {
      onAnnounce: setAnnounce,
    })
    stageRef.current.setView(viewRef.current)
  }, [])

  useEffect(() => { stageRef.current?.setView(view) }, [view])
  useEffect(() => { stageRef.current?.setPaused(paused) }, [paused])
  useEffect(() => () => { stageRef.current?.dispose() }, [])

  // 卡点人数变化播报(原型 04:「Assignment 等待人数 2 → 3」;驻留不重复播报)
  const stuckCount = view.nodes.find(node => node.key === 'assignment')?.events.length ?? 0
  useEffect(() => {
    const previous = prevStuckCount.current
    prevStuckCount.current = stuckCount
    if (previous !== undefined && previous !== stuckCount) {
      setAnnounce(`Assignment 等待人数 ${previous} → ${stuckCount}`)
    }
  }, [stuckCount])

  const startReplay = useCallback((ticketId: string): void => {
    const target = ticketId === '' ? replayTicketId : ticketId
    if (target === '') return
    stageRef.current?.startReplay(replayTrack(snapshot, target), target)
  }, [replayTicketId, snapshot])

  return (
    <FlowView
      view={view}
      tickets={snapshot.tickets}
      paused={paused}
      replayTicketId={replayTicketId}
      announce={announce}
      t={t}
      onTogglePause={() => { setPaused(previous => !previous) }}
      onReplayTicketChange={setReplayTicketId}
      onReplayStart={() => { startReplay('') }}
      onRowReplay={startReplay}
      canvasRef={attachCanvas}
    />
  )
}
