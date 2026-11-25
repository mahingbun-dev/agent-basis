/**
 * 金集回放对接(56 号 §5.7 P2-3d / §9.7):runPack --session-eval 把每个 case 的
 * 事件流按在线评分口径再算一遍,写进 CaseResult / sessions.jsonl / report.md。
 *
 * 断言面:内置规则分与业务规则分都落盘;业务规则未过不被本包 pass/fail 吞掉;
 * 评分失败只单列(不改 golden 断言结论)。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { runPack } from '../src/runner.ts'

const PACK = new URL('./fixtures/pack-mini/', import.meta.url).pathname
let outRoot = ''

const METRICS_YAML = `version: 7
metrics:
  - key: group-approval
    name: 群发审批
    description: 群发前必须有审批问询
    category: process
    scope: session
    gating: false
    enabled: true
    version: 1
    trajectory:
      approval_flow: {tool: send_group_message, min_count: 1}
  - key: judge-sample
    name: 回复质量
    description: 裁判型（离线应跳过）
    category: outcome
    scope: session
    gating: false
    enabled: true
    version: 1
    judge:
      window: {max_steps: 5}
      allow_skip: true
      pass: {min_score: 0.8}
      criteria:
        - {text: 回答完整, weight: 1, critical: true}
`

beforeAll(async () => {
  outRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-evals-session-eval-'))
})

afterAll(async () => {
  await fs.rm(outRoot, { recursive: true, force: true })
})

describe('runPack sessionEval:', () => {
  it('smoke 全量评出规则分:内置规则 + 业务规则,裁判型跳过', async () => {
    const outDir = path.join(outRoot, 'scored')
    const result = await runPack({
      packDir: PACK,
      subset: 'smoke',
      outDir,
      sessionEval: { metricsYaml: METRICS_YAML },
    })
    expect(result.results).toHaveLength(4)
    for (const item of result.results) {
      expect(item.sessionEval, item.caseData.id).toBeDefined()
      expect(item.sessionEval?.metricsVersion).toBe(7)
      expect(item.sessionEval?.skipped).toEqual([{ key: 'judge-sample', reason: '裁判型（回放无模型）' }])
      expect(item.sessionEval?.rules.metrics.length).toBeGreaterThan(10)
    }
    const byId = new Map(result.results.map(item => [item.caseData.id, item.sessionEval]))
    // 审批红线被拒:在线规则同样判 warn(审批拒绝 + 被拒调用失败);其余 smoke 无异常 → pass。
    expect(byId.get('approval-redline')?.rules.verdict.level).toBe('warn')
    expect(byId.get('smoke-file-plan')?.rules.verdict.level).toBe('pass')
    const redline = byId.get('approval-redline')?.business.find(metric => metric.key === 'group-approval')
    expect(redline?.value).toBe(true)
    const plain = byId.get('smoke-file-plan')?.business.find(metric => metric.key === 'group-approval')
    expect(plain?.value).toBe(false)
    expect(plain?.status).toBe('ok')
  })

  it('sessions.jsonl:每行带 session_eval 块(结论/规则/业务/跳过)', async () => {
    const outDir = path.join(outRoot, 'lines')
    await runPack({ packDir: PACK, subset: 'smoke', outDir, sessionEval: { metricsYaml: METRICS_YAML } })
    const lines = (await fs.readFile(path.join(outDir, 'sessions.jsonl'), 'utf8')).trim().split('\n')
    const rows = lines.map(line => JSON.parse(line) as Record<string, unknown>)
    const redline = rows.find(row => row.case_id === 'approval-redline')
    const block = redline?.session_eval as Record<string, unknown> | undefined
    expect(block).toBeDefined()
    expect((block?.verdict as Record<string, unknown>).level).toBe('warn')
    expect(Array.isArray(block?.rules)).toBe(true)
    expect(Array.isArray(block?.business)).toBe(true)
    expect(block?.metrics_version).toBe(7)
  })

  it('report.md:新增会话评测节,含结论计数与未过判定项', async () => {
    const outDir = path.join(outRoot, 'report')
    await runPack({ packDir: PACK, subset: 'smoke', outDir, sessionEval: { metricsYaml: METRICS_YAML } })
    const report = await fs.readFile(path.join(outDir, 'report.md'), 'utf8')
    expect(report).toContain('## 会话评测规则分（--session-eval）')
    expect(report).toContain('- metrics.yaml: v7')
    expect(report).toContain('| pass | 3 |')
    expect(report).toContain('| warn | 1 |')
    expect(report).toContain('| smoke-file-plan | pass（确定性检查通过（结果类未评）） | - | 1/1 | 1 |')
  })

  it('未开启评分:CaseResult 无 sessionEval(既有产物形状不变)', async () => {
    const outDir = path.join(outRoot, 'plain')
    const result = await runPack({ packDir: PACK, subset: 'smoke', outDir })
    for (const item of result.results) expect(item.sessionEval).toBeUndefined()
    const line = (await fs.readFile(path.join(outDir, 'sessions.jsonl'), 'utf8')).split('\n')[0] ?? ''
    expect(line).not.toContain('session_eval')
  })

  it('pack 自带 evals/metrics.yaml:不被当作 golden case 加载(0 loadErrors),评分可用', async () => {
    const packCopy = path.join(outRoot, 'pack-with-metrics')
    await fs.cp(PACK, packCopy, { recursive: true })
    await fs.writeFile(path.join(packCopy, 'evals', 'metrics.yaml'), METRICS_YAML, 'utf8')
    const result = await runPack({ packDir: packCopy, subset: 'smoke', outDir: path.join(outRoot, 'with-metrics') })
    // pack-mini 自带一条故意坏的 broken-schema.yaml;这里只断言 metrics.yaml 未被当 case。
    expect(result.loadErrors.filter(error => error.file.endsWith('metrics.yaml'))).toEqual([])
    expect(result.results).toHaveLength(4)
    for (const item of result.results) expect(item.sessionEval).toBeUndefined()
  })

  it('坏 metrics.yaml:评分失败只单列原因,不改变 golden 断言结论', async () => {
    const outDir = path.join(outRoot, 'bad')
    const result = await runPack({
      packDir: PACK,
      subset: 'smoke',
      outDir,
      sessionEval: { metricsYaml: 'version: 0\nmetrics: [' },
    })
    for (const item of result.results) {
      expect(item.sessionEval).toBeUndefined()
      expect(item.sessionEvalError).toContain('YAML 解析失败')
      expect(item.status).toBe('pass')
    }
    const report = await fs.readFile(path.join(outDir, 'report.md'), 'utf8')
    expect(report).toContain('| 未评分 | 4 |')
  })
})
