/**
 * 全链路测试:自造 fixture pack(pack-mini)经 runPack 跑通
 * 「加载 → 回放 → 终态/轨迹/预算断言 → report.md + sessions.jsonl」,
 * 含一条审批红线 case(期望 approval_flow 被命中)与一条负样本(期望判 FAIL)。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { runPack } from '../src/runner.ts'

const PACK = new URL('./fixtures/pack-mini/', import.meta.url).pathname
let outRoot = ''

beforeAll(async () => {
  outRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-evals-run-'))
})

afterAll(async () => {
  await fs.rm(outRoot, { recursive: true, force: true })
})

describe('runPack:subset=smoke 全链路', () => {
  it('4 条 smoke 全过(含审批红线),产物落盘', async () => {
    const outDir = path.join(outRoot, 'smoke')
    const result = await runPack({ packDir: PACK, subset: 'smoke', outDir })
    expect(result.results.map(item => item.caseData.id).sort()).toEqual([
      'approval-redline',
      'script-check',
      'smoke-file-plan',
      'smoke-http-submit',
    ])
    for (const item of result.results) {
      expect(item.status, `${item.caseData.id}: ${JSON.stringify(item.failures)}`).toBe('pass')
    }
  })

  it('审批红线 case:approval_flow 命中且 not_executed 成立', async () => {
    const outDir = path.join(outRoot, 'redline')
    const result = await runPack({ packDir: PACK, caseId: 'approval-redline', outDir })
    const redline = result.results[0]
    expect(redline?.status).toBe('pass')
    expect(redline?.metrics.approvalAsks).toBe(1)
    expect(redline?.metrics.toolCalls).toContain('send_group_message')
    expect(redline?.finalAnswerText).toContain('草稿')
  })

  it('report.md:总览/分 tags/失败分类/明细', async () => {
    const outDir = path.join(outRoot, 'smoke2')
    await runPack({ packDir: PACK, subset: 'smoke', outDir })
    const report = await fs.readFile(path.join(outDir, 'report.md'), 'utf8')
    expect(report).toContain('| 4 | 4 | 0 | 100.0% |')
    expect(report).toContain('| approval-redline | 1 | 1 | 0 | 100.0% |')
    expect(report).toContain('无失败。')
    expect(report).toContain('schema 加载失败文件(未计入用例): 1 个')
    expect(report).toContain('| approval-redline | replay | pass | smoke, approval-redline | - |')
  })

  it('sessions.jsonl:ai-evo 对齐字段可解析', async () => {
    const outDir = path.join(outRoot, 'smoke3')
    await runPack({ packDir: PACK, subset: 'smoke', outDir })
    const lines = (await fs.readFile(path.join(outDir, 'sessions.jsonl'), 'utf8')).trim().split('\n')
    expect(lines).toHaveLength(4)
    const parsed = lines.map(line => JSON.parse(line) as Record<string, unknown>)
    const redline = parsed.find(row => row.case_id === 'approval-redline')
    expect(redline).toBeDefined()
    expect(redline?.user_input).toContain('群发')
    expect(redline?.answer).toEqual({ contains: '草稿' })
    expect(redline?.tags).toEqual(['smoke', 'approval-redline'])
    expect(redline?.status).toBe('pass')
    const metrics = redline?.metrics as Record<string, unknown>
    expect(metrics.approval_asks).toBe(1)
    expect(metrics.turns).toBe(1)
    expect(typeof redline?.session_ref).toBe('string')
  })

  it('events/<case-id>.jsonl:原始事件流完整另存(一行一事件,与 metrics 同源)', async () => {
    const outDir = path.join(outRoot, 'smoke4')
    const result = await runPack({ packDir: PACK, caseId: 'approval-redline', outDir })
    const raw = await fs.readFile(path.join(outDir, 'events', 'approval-redline.jsonl'), 'utf8')
    const events = raw.trim().split('\n').map(line => JSON.parse(line) as { type: string })
    expect(events.length).toBe(result.results[0]?.metrics.eventCount)
    expect(events.some(event => event.type === 'approval/asked')).toBe(true)
    expect(events.some(event => event.type === 'approval/decided')).toBe(true)
  })
})

describe('runPack:全量(含负样本与 schema 违例)', () => {
  it('负样本判 FAIL 且失败分类为 answer+trajectory+budget', async () => {
    const outDir = path.join(outRoot, 'all')
    const result = await runPack({ packDir: PACK, outDir })
    expect(result.results).toHaveLength(6)
    expect(result.loadErrors).toHaveLength(1)
    const negative = result.results.find(item => item.caseData.id === 'answer-budget-fail')
    expect(negative?.status).toBe('fail')
    const categories = [...new Set(negative?.failures.map(failure => failure.category))].sort()
    expect(categories).toEqual(['answer', 'budget', 'trajectory'])
    expect(negative?.failures.filter(failure => failure.category === 'budget')).toHaveLength(2)
    const messages = negative?.failures.map(failure => failure.message).join('\n')
    expect(messages).toContain('禁用工具 shell 被调用了 1 次')
    expect(messages).toContain('5 轮')
    expect(messages).toMatch(/实际 \d+ tokens/)
    expect(messages).toContain('这句话在最终回答里一定不存在')
  })

  it('report 失败分类统计与详情段落', async () => {
    const outDir = path.join(outRoot, 'all2')
    await runPack({ packDir: PACK, outDir })
    const report = await fs.readFile(path.join(outDir, 'report.md'), 'utf8')
    expect(report).toContain('| 6 | 5 | 1 | 83.3% |')
    expect(report).toContain('| answer | 1 |')
    expect(report).toContain('| budget | 1 |')
    expect(report).toContain('| trajectory | 1 |')
    expect(report).toContain('### answer-budget-fail')
    expect(report).toContain('[budget] budget: 实际 5 轮 > max_turns 2')
  })

  it('strict 模式 case 全量时也通过(未被负样本干扰)', async () => {
    const outDir = path.join(outRoot, 'strict-only')
    const result = await runPack({ packDir: PACK, caseId: 'strict-trajectory', outDir })
    expect(result.results[0]?.status).toBe('pass')
  })
})

describe('runPack:错误路径', () => {
  it('subset 无匹配 → results 为空(由 CLI 判退出码)', async () => {
    const result = await runPack({ packDir: PACK, subset: 'no-such-tag', outDir: path.join(outRoot, 'empty') })
    expect(result.results).toEqual([])
  })

  it('pack 目录不存在 → loadErrors', async () => {
    const result = await runPack({ packDir: '/nonexistent', outDir: path.join(outRoot, 'nopack') })
    expect(result.results).toEqual([])
    expect(result.loadErrors[0]?.message).toMatch(/无法读取/)
  })

  it('强制不存在的 adapterId → harness 失败分类', async () => {
    const outDir = path.join(outRoot, 'badadapter')
    const packDir = path.join(outRoot, 'pack-bad-adapter')
    await fs.mkdir(path.join(packDir, 'evals'), { recursive: true })
    await fs.writeFile(
      path.join(packDir, 'evals', 'weird.yaml'),
      'id: weird\nuser_input: x\nadapter: replay\n',
      'utf8',
    )
    // 直接以强制 adapterId=nonexistent 运行 → getAdapter 抛错 → harness 分类
    const result = await runPack({ packDir, adapterId: 'nonexistent', outDir })
    expect(result.results[0]?.status).toBe('fail')
    expect(result.results[0]?.failures[0]?.category).toBe('harness')
    expect(result.results[0]?.failures[0]?.message).toContain('未知适配器')
  })
})
