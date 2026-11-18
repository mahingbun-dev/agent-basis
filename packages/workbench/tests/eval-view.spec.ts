/**
 * 评测监控视图投影测试(38 号 T11/G2-D9:金集趋势/路由金集衰减/漂移三投影;
 * 28 号 §5 衰减阈值 2pp 验收口径;原型 03 视图四静态稿数值逐值钉死)。M3 段钉
 * 原型数值;M4 实接段(dsh-evals 结果目录 + observe 漂移信号真值源,38 号 T11
 * 实接半边)以真实落盘 report.md 驱动。
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { decayChart, evalMetricCards, trendChart } from '../src/project/eval-view.ts'
import { evalSection } from '../src/project/live-sections.ts'
import { readEvalRuns } from '../src/project/trace-files.ts'
import { applyWorkbenchEvent } from '../src/project/state.ts'
import { initialMockSnapshot, mockTimeline } from '../src/stream/mock-source.ts'

const snapshot = initialMockSnapshot()

describe('金集通过率趋势(E-1;原型 03 图一逐值)', () => {
  it('标题/叙述/脚注与原型逐字', () => {
    const chart = trendChart(snapshot.eval)
    expect(chart.title).toBe('金集通过率趋势（近 7 次跑批）')
    expect(chart.desc).toBe('近 7 次跑批通过率依次为 90.2、91.0、89.8、91.5、92.0、91.2、92.4；达标线 90%。第 3 次 89.8% 低于达标线，其余均达标。')
    expect(chart.note).toBe('第 3 次 89.8% 触发达标线复核（dsh-evals 回归门）。')
    expect(chart.xFirstLabel).toBe('第 1 次')
    expect(chart.xLastLabel).toBe('第 7 次')
    expect(chart.yLabel).toBe('通过率 %')
  })

  it('坐标几何与原型 SVG 逐值一致:点位串/网格/达标线 y=110', () => {
    const chart = trendChart(snapshot.eval)
    expect(chart.points.map(point => `${point.x},${point.y}`)).toEqual([
      '80,108.2', '145,101', '210,111.8', '275,96.5', '340,92', '405,99.2', '470,88.4',
    ])
    expect(chart.grid).toEqual([
      { y: 200, label: '80' }, { y: 155, label: '85' }, { y: 110, label: '90' },
      { y: 65, label: '95' }, { y: 20, label: '100' },
    ])
    expect(chart.gate).toEqual({ y: 110, label: '达标线 90%' })
    expect(chart.points.filter(point => point.warn).map(point => point.index)).toEqual([2])
  })

  it('eval-run 增量:第 8 点接续,标题/叙述/达标判据随之更新', () => {
    const increment = mockTimeline()[0]!
    if (increment.event.kind !== 'eval-run') throw new Error('timeline[0] 应为 eval-run')
    const next = applyWorkbenchEvent(snapshot, { ...increment.event, seq: 2 })
    const chart = trendChart(next.eval)
    expect(chart.title).toBe('金集通过率趋势（近 8 次跑批）')
    expect(chart.desc).toContain('近 8 次跑批通过率依次为 90.2、91.0、89.8、91.5、92.0、91.2、92.4、92.8；')
    expect(chart.xLastLabel).toBe('第 8 次')
    expect(chart.points[7]).toMatchObject({ x: 470, y: 84.8, warn: false })
    const cards = evalMetricCards(next.eval)
    expect(cards[0]).toEqual({ label: '金集通过率 · 最近跑批', value: '92.8%', sub: '环比 +0.4pp · 金集 30 条' })
    expect(cards[3]!.value).toBe('15 次')
  })
})

describe('路由金集衰减(E-2;28 号 §5 阈值 2pp;原型 03 图二逐值)', () => {
  it('标题/叙述/脚注与原型逐字', () => {
    const chart = decayChart(snapshot.eval)
    expect(chart.title).toBe('路由金集衰减曲线（压缩前后通过率差）')
    expect(chart.desc).toBe('会话深度 1 至 8 的衰减依次为 0.2、0.5、0.4、0.8、0.7、0.9、0.8、1.1 个百分点；阈值 2 个百分点，全程未超标。')
    expect(chart.note).toBe('压缩前后各跑一遍路由金集；衰减超标调摘要档位，不靠 prompt 硬扛（28 §5）。')
    expect(chart.xFirstLabel).toBe('深度 1')
    expect(chart.xLastLabel).toBe('深度 8')
    expect(chart.yLabel).toBe('衰减 pp')
  })

  it('坐标几何与原型 SVG 同构(y 逐值一致;x 均匀铺点,与原型手摆点位差 ≤1px);阈值线 y=56', () => {
    const chart = decayChart(snapshot.eval)
    expect(chart.points.map(point => `${point.x},${point.y}`)).toEqual([
      '80,185.6', '136,164', '191,171.2', '247,142.4', '303,149.6', '359,135.2', '414,142.4', '470,120.8',
    ])
    expect(chart.grid).toEqual([{ y: 200, label: '0' }, { y: 128, label: '1' }, { y: 56, label: '2' }])
    expect(chart.gate).toEqual({ y: 56, label: '阈值 2pp（28 §5）' })
    expect(chart.points.every(point => !point.warn)).toBe(true)
  })

  it('超标分支:深度 5 超 2pp → warn 点 + 叙述改写(数据驱动,不另建指标)', () => {
    const over = decayChart({ ...snapshot.eval, decaySeries: [0.2, 0.5, 0.4, 0.8, 2.3] })
    expect(over.points.filter(point => point.warn).map(point => point.index)).toEqual([4])
    expect(over.desc).toContain('阈值 2 个百分点，深度 5 超过阈值。')
  })
})

describe('四指标卡(E-1~E-4;原型 03 metrics-4 逐字)', () => {
  it('初始四卡:92.4% (+0.6pp)/0.8pp 达标/无警报 14 天/14 次', () => {
    expect(evalMetricCards(snapshot.eval)).toEqual([
      { label: '金集通过率 · 最近跑批', value: '92.4%', sub: '环比 +0.6pp · 金集 30 条' },
      { label: '路由金集衰减', value: '0.8pp', sub: '会话深度 8 · 阈值 ≤ 2pp', badge: '达标' },
      { label: '漂移检测（observe）', value: '无警报', sub: '连续 14 天无漂移' },
      { label: '本周回归跑批', value: '14 次', sub: 'prompt 版本绑定请求（24 §7.6）' },
    ])
  })

  it('衰减超标不带达标徽标;环比负值带负号(数据驱动)', () => {
    const over = evalMetricCards({ ...snapshot.eval, decayLatestPp: 2.1 })
    expect(over[1]!.badge).toBeUndefined()
    const down = evalMetricCards({ ...snapshot.eval, trend: [90, 89.4], passDelta: -0.6 })
    expect(down[0]!.sub).toBe('环比 -0.6pp · 金集 30 条')
  })
})

// ── M4 实接段(38 号 T11 实接半边;G2-D9 数据源投影测试的真值源半边)──────────

describe('M4 实接:dsh-evals 结果真源(readEvalRuns → evalSection;E-1/E-4)', () => {
  let outDir: string
  beforeEach(() => { outDir = mkdtempSync(join(tmpdir(), 'workbench-evals-out-')) })
  afterEach(() => { rmSync(outDir, { recursive: true, force: true }) })

  /** 落一份真实形态的 run report(tools/evals 渲染格式;G2-A9 同源输出)。 */
  const writeRun = (name: string, total: number, pass: number, rate: string, startedAt: string): void => {
    mkdirSync(join(outDir, name), { recursive: true })
    writeFileSync(join(outDir, name, 'report.md'), [
      '# DSH Evals Report', '',
      '- pack: packs/event-planning', '- adapter: replay', `- started_at: ${startedAt}`, '- duration: 0.1s', '',
      '## 总览', '', '| total | pass | fail | pass_rate |', '|---|---|---|---|',
      `| ${total} | ${pass} | ${total - pass} | ${rate} |`, '',
    ].join('\n'), 'utf8')
  }

  it('真实 run 序列 → 趋势/规模/环比/周跑数(口径对齐 dsh-evals,不另建指标)', async () => {
    writeRun('run-2026-11-12T10-00-00Z', 30, 29, '96.7%', '2026-11-12T10:00:00.000Z')
    writeRun('run-2026-11-13T10-00-00Z', 30, 27, '90.0%', '2026-11-13T10:00:00.000Z')
    writeRun('run-2026-11-17T10-00-00Z', 30, 28, '93.3%', '2026-11-17T10:00:00.000Z')
    const runs = await readEvalRuns(outDir)
    expect(runs.map(run => run.passRate)).toEqual([96.7, 90, 93.3])
    const evalSnap = evalSection({ evalRuns: runs, drift: { count: 0 } }, Date.parse('2026-11-18T00:00:00.000Z'))
    expect(evalSnap.trend).toEqual([96.7, 90, 93.3])
    expect(evalSnap.suiteSize).toBe(30)
    expect(evalSnap.passDelta).toBe(3.3) // 最近一次环比(93.3 − 90)
    expect(evalSnap.weeklyRuns).toBe(3) // 7 日窗 [11-11, 11-18) 内 11-12/11-13/11-17 三次
    const chart = trendChart(evalSnap)
    expect(chart.title).toBe('金集通过率趋势（近 3 次跑批）')
    expect(chart.points.filter(point => point.warn)).toEqual([]) // 达标线 90:三次均 ≥ 90,无 warn 点
  })

  it('路由金集两次 run 未产出(G2-A9 在建)→ 空序列如实呈现,不伪报衰减', () => {
    const evalSnap = evalSection({ evalRuns: [], drift: { count: 0 } }, Date.now())
    expect(evalSnap.decaySeries).toEqual([])
    expect(evalSnap.decayThresholdPp).toBe(2)
    const chart = decayChart(evalSnap)
    expect(chart.title).toContain('暂无两次 run')
    expect(chart.note).toContain('G2-A9')
    const cards = evalMetricCards(evalSnap)
    expect(cards[1]).toEqual({ label: '路由金集衰减', value: '暂无', sub: '两次 run（G2-A9）未产出 · 阈值 ≤ 2pp' })
  })

  it('漂移信号真源:无信号 = 无警报 + 如实注记;有信号 = 警报计数 + 距今天数', () => {
    const quiet = evalSection({ evalRuns: [], drift: { count: 0 } }, Date.now())
    expect(quiet.drift).toEqual({ label: '无警报', days: 0 })
    expect(evalMetricCards(quiet)[2]).toEqual({
      label: '漂移检测（observe）', value: '无警报', sub: '信号库无漂移记录（observe 快照接线后计入观察窗）',
    })
    const alert = evalSection({ evalRuns: [], drift: { count: 2, latestAt: Date.now() - 3 * 86_400_000 } }, Date.now())
    expect(alert.drift.label).toBe('警报 2 条')
    expect(evalMetricCards(alert)[2]!.sub).toContain('3 天')
  })

  it('结果目录缺失(目录尚无 run)→ 趋势空态如实,不抛错', () => {
    const evalSnap = evalSection({ evalRuns: [], drift: { count: 0 } }, Date.now())
    expect(evalSnap.trend).toEqual([])
    expect(trendChart(evalSnap).title).toContain('暂无 run 数据')
    expect(evalMetricCards(evalSnap)[0]).toEqual({ label: '金集通过率 · 最近跑批', value: '暂无', sub: 'dsh-evals 结果目录尚无 run 报告' })
  })
})
