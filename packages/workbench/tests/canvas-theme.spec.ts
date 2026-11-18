/**
 * 信息流实时图主题与画布节制器测试(38 号 T9/G2-D4②;30 号 §7-1②拍板:
 * 主题令牌渲染时经 getComputedStyle 读取 --et-*,画布不吃 CSS——双主题切换
 * 需重绘)。断言面:
 * - readFlowTheme 只读 --et-* 令牌(design-tokens §2:桥接在 body 层,由
 *   注入的 themeStyle 承载;color-mix() 等画布不可求值形态回落 Webflow 缺省);
 * - paintFlowGraph 取色全部来自主题(无字面色);
 * - createFlowCanvasStage:主题变更信号 → 重读令牌 + 重绘;暂停 = 冻结数据
 *   驱动重绘,恢复重绘;hover/点击/拖拽手写交互;单工单回放步进播报。
 */
import { describe, expect, it } from 'vitest'
import {
  createFlowCanvasStage, paintFlowGraph, parseCssColor, readFlowTheme, rgba,
  type FlowTheme,
} from '../src/client/FlowCanvas.tsx'
import { flowGraphView } from '../src/project/flow-graph.ts'
import { replayTrack } from '../src/project/replay.ts'
import { initialMockSnapshot } from '../src/stream/mock-source.ts'

const snapshot = initialMockSnapshot()
const view = flowGraphView(snapshot)

/* ── 假件:令牌声明面 / 画布 2D 上下文 / 画布元素 ── */

class FakeStyle {
  readonly asked: string[] = []
  constructor(private readonly tokens: Record<string, string>) {}
  getPropertyValue(name: string): string {
    this.asked.push(name)
    return this.tokens[name] ?? ''
  }
}

class FakeContext {
  fillStyle = ''
  strokeStyle = ''
  lineWidth = 0
  globalAlpha = 1
  lineCap = ''
  lineJoin = ''
  font = ''
  textAlign = ''
  textBaseline = ''
  lineDashOffset = 0
  readonly ops: { op: string; args: unknown[] }[] = []

  private record(op: string, ...args: unknown[]): void { this.ops.push({ op, args }) }
  save(): void { this.record('save') }
  restore(): void { this.record('restore') }
  scale(x: number, y: number): void { this.record('scale', x, y) }
  translate(x: number, y: number): void { this.record('translate', x, y) }
  clearRect(x: number, y: number, w: number, h: number): void { this.record('clearRect', x, y, w, h) }
  beginPath(): void { this.record('beginPath') }
  closePath(): void { this.record('closePath') }
  moveTo(x: number, y: number): void { this.record('moveTo', x, y) }
  lineTo(x: number, y: number): void { this.record('lineTo', x, y) }
  arc(x: number, y: number, r: number, s: number, e: number): void { this.record('arc', x, y, r, s, e) }
  arcTo(x1: number, y1: number, x2: number, y2: number, r: number): void { this.record('arcTo', x1, y1, x2, y2, r) }
  stroke(): void { this.record('stroke'); this.ops[this.ops.length - 1]!.args = [this.strokeStyle, this.lineWidth] }
  fill(): void { this.record('fill'); this.ops[this.ops.length - 1]!.args = [this.fillStyle] }
  fillText(text: string, x: number, y: number): void { this.record('fillText', text, x, y); this.ops[this.ops.length - 1]!.args = [text, this.fillStyle] }
  setLineDash(segments: readonly number[]): void { this.record('setLineDash', ...segments) }
  measureText(text: string): { width: number } { return { width: text.length * 7 } }
}

class FakeCanvas {
  readonly style = { cursor: '' }
  readonly ctx = new FakeContext()
  readonly listeners = new Map<string, ((event: { clientX: number; clientY: number }) => void)[]>()
  getContext(): FakeContext {
    return this.ctx
  }
  addEventListener(type: string, listener: (event: { clientX: number; clientY: number }) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener])
  }
  removeEventListener(): void {}
  getBoundingClientRect(): { left: number; top: number; width: number; height: number } {
    return { left: 0, top: 0, width: 960, height: 400 }
  }
  emit(type: string, clientX: number, clientY: number): void {
    for (const listener of this.listeners.get(type) ?? []) listener({ clientX, clientY })
  }
  clearOps(): void { this.ctx.ops.length = 0 }
  paints(): number { return this.ctx.ops.filter(op => op.op === 'clearRect').length }
}

/** 哨兵主题(与缺省值全不同,断言取色来源)。 */
const SENTINEL: FlowTheme = {
  surface: { r: 1, g: 2, b: 3, a: 1 },
  border: { r: 4, g: 5, b: 6, a: 1 },
  fg: { r: 7, g: 8, b: 9, a: 1 },
  fg2: { r: 10, g: 11, b: 12, a: 1 },
  muted: { r: 13, g: 14, b: 15, a: 1 },
  meta: { r: 16, g: 17, b: 18, a: 1 },
  accent: { r: 19, g: 20, b: 21, a: 1 },
  warn: { r: 22, g: 23, b: 24, a: 1 },
  danger: { r: 25, g: 26, b: 27, a: 1 },
  font: 'fake-font',
}

describe('配套②:令牌读取(30 号 §7-1②;design-tokens §2 body 层桥接)', () => {
  it('readFlowTheme 只读 --et-* 令牌名(断言读取面封闭)', () => {
    const style = new FakeStyle({
      '--et-surface': '#101010', '--et-border': '#2a2a2a', '--et-fg': '#f5f5f5',
      '--et-fg-2': '#d4d4d4', '--et-muted': '#a3a3a3', '--et-meta': '#8a8a8a',
      '--et-accent': '#3b89ff', '--et-warn': '#ffb020', '--et-danger': '#ff4d5f',
      '--et-font-body': '"Inter", sans-serif',
    })
    const theme = readFlowTheme(style)
    expect(new Set(style.asked)).toEqual(new Set([
      '--et-surface', '--et-border', '--et-fg', '--et-fg-2', '--et-muted',
      '--et-meta', '--et-accent', '--et-warn', '--et-danger', '--et-font-body',
    ]))
    expect(theme.accent).toEqual({ r: 0x3b, g: 0x89, b: 0xff, a: 1 })
    expect(theme.font).toBe('"Inter", sans-serif')
  })

  it('color-mix()/空值等画布不可求值形态回落 Webflow 缺省(桥接断裂仍可读)', () => {
    const theme = readFlowTheme(new FakeStyle({
      '--et-accent': 'color-mix(in oklab, var(--et-accent), transparent 90%)',
      '--et-warn': '',
    }))
    expect(theme.accent).toEqual({ r: 0x14, g: 0x6e, b: 0xf5, a: 1 })
    expect(theme.warn).toEqual({ r: 0x8a, g: 0x5a, b: 0x00, a: 1 })
    expect(readFlowTheme(undefined).surface).toEqual({ r: 0xff, g: 0xff, b: 0xff, a: 1 })
  })

  it('parseCssColor:hex 三/六/八位、rgb()/rgba() 空格与逗号式、垃圾值回落', () => {
    expect(parseCssColor('#fff', '#000000')).toEqual({ r: 255, g: 255, b: 255, a: 1 })
    expect(parseCssColor('#146ef580', '#000000')).toEqual({ r: 20, g: 110, b: 245, a: Number.parseInt('80', 16) / 255 })
    expect(parseCssColor('rgb(1 2 3 / 0.5)', '#000000')).toEqual({ r: 1, g: 2, b: 3, a: 0.5 })
    expect(parseCssColor('rgba(1,2,3,0.5)', '#000000')).toEqual({ r: 1, g: 2, b: 3, a: 0.5 })
    expect(parseCssColor('var(--x)', '#0000ff')).toEqual({ r: 0, g: 0, b: 255, a: 1 })
  })
})

describe('画布绘制取色纪律(F-7:颜色只来自令牌解析值)', () => {
  const PAINT_STATE = { panX: 0, panY: 0, hoverKey: undefined, selectedKey: undefined, replay: undefined, animPhase: 0.5 }

  it('九节点标题 + 卡点气泡文案入画;取色集合 ⊆ 主题解析值(无字面色)', () => {
    const ctx = new FakeContext()
    paintFlowGraph(ctx, view, SENTINEL, PAINT_STATE)
    const palette = new Set(Object.values(SENTINEL).filter((v): v is { r: number; g: number; b: number; a: number } => typeof v === 'object').map(color => rgba(color)))
    const texts = ctx.ops.filter(op => op.op === 'fillText').map(op => op.args[0] as string)
    for (const title of ['Trigger 触发', 'Thread 线程', 'Eval 评估', 'Decision 裁决', 'Ticket 工单', 'Assignment 委派', 'Worker 执行', 'Report 报告', 'Outbox 出箱']) {
      expect(texts).toContain(title)
    }
    expect(texts).toContain('person/* 卡点：3 单等人 · 最长 4 小时')
    expect(texts).toContain('person/* 阶段工单在图上以警示色驻留，答复即消（30 §2-1）')
    const used = ctx.ops
      .filter(op => op.op === 'stroke' || op.op === 'fill' || op.op === 'fillText')
      .map(op => String(op.op === 'fillText' ? op.args[1] : op.args[0]))
    expect(used.length).toBeGreaterThan(0)
    // 取色 = 主题色的 rgba 变体(含 tint 透明度);RGB 三元组必须来自主题
    const triplets = new Set([...palette].map(color => color.slice(5, color.lastIndexOf(','))))
    for (const color of used) {
      expect(color.startsWith('rgba(')).toBe(true)
      expect(triplets.has(color.slice(5, color.lastIndexOf(',')))).toBe(true)
    }
    // 卡点 = 警示色(F-4):stuck 节点描边、气泡描边/文字均走 --et-warn
    expect(used).toContain(rgba(SENTINEL.warn))
    // 活跃边 = 强调色虚线(F-2:200ms 合批推送流动)
    expect(used).toContain(rgba(SENTINEL.accent))
    expect(ctx.ops.some(op => op.op === 'setLineDash' && op.args.join(',') === '6,5')).toBe(true)
  })

  it('回放轨迹:3px 强调线 + 0.8 透明度,progress 截长(原型 03 freplay)', () => {
    const ctx = new FakeContext()
    const track = replayTrack(snapshot, 'T-9c81')!
    paintFlowGraph(ctx, view, SENTINEL, {
      ...PAINT_STATE,
      replay: { points: track.points, progress: 1 },
    })
    const replayStroke = ctx.ops.find(op => op.op === 'stroke' && op.args[0] === rgba(SENTINEL.accent) && op.args[1] === 3)
    expect(replayStroke).toBeDefined()
    // 完整轨迹 7 顶点 → 6 段 lineTo
    const replayPath = ctx.ops.filter(op => op.op === 'lineTo')
    expect(replayPath.length).toBeGreaterThanOrEqual(6)
  })
})

describe('画布节制器:主题变更重绘 / 暂停冻结 / 手写交互 / 回放步进', () => {
  function makeStage(reducedMotion = false): {
    readonly canvas: FakeCanvas
    readonly style: FakeStyle
    readonly stage: ReturnType<typeof createFlowCanvasStage>
    readonly announce: string[]
    readonly fireThemeChange: () => void
    readonly frames: (() => void)[]
    readonly setNow: (ms: number) => void
  } {
    const canvas = new FakeCanvas()
    const style = new FakeStyle({
      '--et-surface': '#ffffff', '--et-border': '#d8d8d8', '--et-fg': '#080808',
      '--et-fg-2': '#363636', '--et-muted': '#5a5a5a', '--et-meta': '#6b6b6b',
      '--et-accent': '#146ef5', '--et-warn': '#8a5a00', '--et-danger': '#d3122b',
      '--et-font-body': 'fake-font',
    })
    const announce: string[] = []
    const frames: (() => void)[] = []
    let themeChange: (() => void) | undefined
    let now = 0
    const stage = createFlowCanvasStage(canvas, {
      onAnnounce: (message) => { announce.push(message) },
      deps: {
        themeStyle: () => style,
        watchTheme: (onChange) => { themeChange = onChange; return () => { themeChange = undefined } },
        requestAnimationFrame: (callback) => { frames.push(callback); return frames.length },
        cancelAnimationFrame: () => {},
        reducedMotion: () => reducedMotion,
        devicePixelRatio: 1,
        now: () => now,
      },
    })
    return {
      canvas, style, stage, announce, frames,
      fireThemeChange: () => { themeChange?.() },
      setNow: (ms) => { now = ms },
    }
  }

  it('主题变更信号 → 重读 getComputedStyle + 重绘(30 号 §7-1②:双主题切换需重绘)', () => {
    const { canvas, style, stage, fireThemeChange } = makeStage()
    stage.setView(view)
    expect(canvas.paints()).toBe(1)
    const readsBefore = style.asked.length
    fireThemeChange()
    expect(style.asked.length).toBe(readsBefore + 10) // 十个令牌全部重读
    expect(canvas.paints()).toBe(2)
    stage.dispose()
  })

  it('暂停 = 冻结数据驱动重绘,恢复按当前快照重绘(O-3 最小实现;用户动作不受冻)', () => {
    const { canvas, stage } = makeStage()
    stage.setView(view)
    expect(canvas.paints()).toBe(1)
    stage.setPaused(true)
    stage.setView(view)
    expect(canvas.paints()).toBe(1) // 暂停中数据到达不重绘
    stage.setPaused(false)
    expect(canvas.paints()).toBe(2) // 恢复追平
    stage.dispose()
  })

  it('hover 手写:节点上指针 = pointer + 重绘;点击选中播报节点副行(F-6 配套①)', () => {
    const { canvas, stage, announce } = makeStage()
    stage.setView(view)
    canvas.clearOps()
    canvas.emit('pointermove', 100, 70) // Trigger 矩形内
    expect(canvas.style.cursor).toBe('pointer')
    expect(canvas.paints()).toBe(1)
    canvas.emit('pointermove', 230, 150) // 间隙
    expect(canvas.style.cursor).toBe('default')
    canvas.emit('pointerup', 100, 70)
    expect(announce).toContain('Trigger 触发（今日 23 次）')
    canvas.emit('pointerleave', 0, 0)
    expect(canvas.style.cursor).toBe('default')
    stage.dispose()
  })

  it('拖拽手写:按住位移 → 画布平移(translate 跟随;3px 阈值内仍可点击)', () => {
    const { canvas, stage } = makeStage()
    stage.setView(view)
    canvas.clearOps()
    canvas.emit('pointerdown', 500, 200)
    canvas.emit('pointermove', 560, 230)
    const translate = canvas.ctx.ops.find(op => op.op === 'translate')
    expect(translate?.args).toEqual([60, 30])
    stage.dispose()
  })

  it('单工单回放:步进推进 + 每步 aria-live 播报(F-10;数据源 audit trace)', () => {
    const { canvas, stage, announce, frames, setNow } = makeStage()
    stage.setView(view)
    const track = replayTrack(snapshot, 'T-9c81')!
    canvas.clearOps()
    stage.startReplay(track, 'T-9c81')
    expect(announce[0]).toBe('T-9c81 回放轨迹：Trigger 触发→Eval 评估→Decision 裁决→Assignment 委派→Worker 执行→Report 报告→Outbox 出箱（共 10 个事件）')
    expect(frames.length).toBeGreaterThan(0)
    // 逐帧推进(600ms/帧,10 步 × 500ms → 5s 走完)
    for (let index = 0; index < 12; index += 1) {
      setNow((index + 1) * 600)
      const pending = frames.splice(0)
      for (const frame of pending) frame()
    }
    expect(announce.filter(message => message.startsWith('回放事件：')).length).toBe(10)
    expect(announce).toContain('回放事件：14:02:11 Trigger → Trigger 触发')
    expect(announce).toContain('回放事件：14:31:05 Outbox → Outbox 出箱')
    expect(canvas.paints()).toBeGreaterThanOrEqual(1)
    stage.dispose()
  })

  it('prefers-reduced-motion:回放整轨立现,步进播报一次给齐,不排动画帧(G-6)', () => {
    const { stage, announce, frames } = makeStage(true)
    stage.setView(view)
    const track = replayTrack(snapshot, 'T-9c81')!
    stage.startReplay(track, 'T-9c81')
    expect(announce.filter(message => message.startsWith('回放事件：')).length).toBe(10)
    expect(frames.length).toBe(0) // 不排 rAF(动效尊重)
    stage.dispose()
  })
})
