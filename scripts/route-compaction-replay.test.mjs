/**
 * route-compaction-replay 的纯函数面单测(node --test 零依赖;scripts/*.test.mjs 同纪律):
 * 裁决解析/双腿判定/退出码阈值/历史与提示词构建(触发原文逐字、压缩只作用历史半边)/
 * byGate 排除/JSONL 产物形态。LLM 注入脚本桩,零网络。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  buildCompactionPrompt, buildHistoryText, buildRoutingPrompt, judgeEntry,
  parseVerdict, decideExit, runRouteCompaction, renderReportMd,
} from './route-compaction-replay.mjs'

/** 与 entries.ts 同形的最小判例构造(只取驱动消费的字段)。 */
const entry = (overrides = {}) => ({
  id: 'RG-90', kind: 'attach',
  trigger: { id: '90', text: '@bot 这个也挂到那个 PR 上吧' },
  setup: { id: 'seed-1', text: '修一下 PR #42 的流水线', ready: true },
  replay: { kind: 'attach', note: '点名单上 PR' },
  ...overrides,
})

test('parseVerdict:取最后一个 route= 词;大小写不敏感;解析不出返回 undefined', () => {
  assert.equal(parseVerdict('分析如下…\nroute=attach'), 'attach')
  assert.equal(parseVerdict('route=accept\n后来改主意 route=Stop'), 'stop')
  assert.equal(parseVerdict('我认为该受理'), undefined)
  assert.equal(parseVerdict('route=unknown'), undefined)
})

test('judgeEntry:两腿裁决都等于记录判才双 pass;∅ 视为 fail', () => {
  const e = entry()
  assert.deepEqual(judgeEntry(e, 'route=attach', '…route=attach'),
    { clean: 'attach', compacted: 'attach', cleanPass: true, compactedPass: true })
  const partial = judgeEntry(e, 'route=accept', 'route=attach')
  assert.equal(partial.cleanPass, false)
  assert.equal(partial.compactedPass, true)
  const absent = judgeEntry(e, '没有裁决词', 'route=attach')
  assert.equal(absent.clean, undefined)
  assert.equal(absent.cleanPass, false)
})

test('decideExit:差值按百分点对阈值;边界相等判无衰减', () => {
  assert.equal(decideExit(1, 0.98, 2), 0)
  assert.equal(decideExit(0.95, 0.97, 2), 0)
  assert.equal(decideExit(1, 0.97, 2), 1)
  assert.equal(decideExit(1, 0.96, 2), 1)
  assert.equal(decideExit(0.5, 0.5, 2), 0)
})

test('buildHistoryText:setup 种子派生转录(受理+ready);无种子=空历史声明', () => {
  const withSeed = buildHistoryText(entry())
  assert.match(withSeed, /trigger seed-1/)
  assert.match(withSeed, /「修一下 PR #42 的流水线」/)
  assert.match(withSeed, /ready/)
  assert.match(withSeed, /受理为工单 seed-1/)
  const bare = buildHistoryText(entry({ setup: undefined }))
  assert.match(bare, /无活跃工单/)
})

test('路由提示词:触发原文逐字在两腿同文;环境块带名单与 bots;相关工单带状态', () => {
  const e = entry({ trigger: { id: '90', text: '帮我把导出按钮的文案改成「导出 CSV」' },
    setup: { id: 'seed-1', text: '种子', ready: false, allowed: ['u-bob'], bots: ['ci-bot'] } })
  const history = buildHistoryText(e)
  const clean = buildRoutingPrompt({ entry: e, history })
  const compacted = buildRoutingPrompt({ entry: e, history: '（摘要）种子工单已受理' })
  for (const prompt of [clean, compacted]) {
    assert.match(prompt, /「帮我把导出按钮的文案改成「导出 CSV」」/)
    assert.match(prompt, /u-bob/)
    assert.match(prompt, /ci-bot/)
    assert.match(prompt, /seed-1/)
    assert.match(prompt, /route=accept、route=attach、route=ignore-bot、route=stop/)
  }
  assert.match(clean, /「种子」/)
  assert.match(compacted, /（摘要）/)
  assert.doesNotMatch(compacted, /「种子」/)
})

test('压缩指令:含逐字保留红线(工单 id/原文/状态)', () => {
  const prompt = buildCompactionPrompt('人消息(trigger s1):「原文」')
  assert.match(prompt, /逐字/)
  assert.match(prompt, /工单 id/)
  assert.match(prompt, /trigger s1/)
})

test('runRouteCompaction:双腿三调用次序(路由→压缩→路由)、byGate 排除、JSONL 与报告产物', async () => {
  const calls = []
  const scripted = prompt => {
    calls.push(prompt)
    if (prompt.startsWith('你是任务主会话的会话压缩器')) return '（摘要）工单 seed-1 已受理并结束。'
    if (prompt.includes('「@bot 这个也挂到那个 PR 上吧」')) return '裁决:挂到工单 seed-1。\nroute=attach'
    return '裁决:受理。\nroute=accept'
  }
  const entries = [
    entry(),
    entry({ id: 'RG-91', kind: 'ignore-bot', trigger: { id: '91', text: 'build ok', human: false, bot: 'ci-bot' },
      replay: { kind: 'ignore', reason: '名单外 bot', byGate: true } }),
    entry({ id: 'RG-92', kind: 'accept', trigger: { id: '92', text: '@bot 再修一个新问题' }, setup: undefined,
      replay: { kind: 'accept', title: 't', scope: 's', reason: 'r', delegation: { objective: 'o', outputFormat: 'f', toolGuidance: 'g', taskBoundaries: 'b' } } }),
  ]
  const outDir = mkdtempSync(join(tmpdir(), 'rcr-'))
  try {
    const outcome = await runRouteCompaction({ entries, llm: scripted, threshold: 2 })
    assert.equal(outcome.cleanLines.length, 2)
    assert.deepEqual(outcome.cleanLines, [
      { case_id: 'rg-90', status: 'pass' },
      { case_id: 'rg-92', status: 'pass' },
    ])
    assert.equal(outcome.rates.clean, 1)
    assert.equal(outcome.rates.compacted, 1)
    assert.equal(outcome.exit, 0)
    assert.deepEqual(outcome.report.gated, ['RG-91'])
    // 两判例 × 两腿 = 4 次路由调用;压缩态腿(RG-90 的第 2 次)用摘要,不是原文历史。
    const routingCalls = calls.filter(prompt => prompt.includes('候选卡'))
    assert.equal(routingCalls.length, 4)
    assert.match(routingCalls[0], /受理为工单 seed-1/)
    assert.doesNotMatch(routingCalls[1], /受理为工单 seed-1/)
    assert.match(routingCalls[1], /（摘要）工单 seed-1 已受理并结束。/)
    assert.match(routingCalls[3], /（摘要）工单 seed-1 已受理并结束。/)
  } finally { rmSync(outDir, { recursive: true, force: true }) }
})

test('runRouteCompaction:压缩态误裁决反映为 fail 且退出码 1;md 报告含逐条表与边界登记', async () => {
  const entries = [entry()]
  const llm = prompt => {
    if (prompt.startsWith('你是任务主会话的会话压缩器')) return '（摘要丢失了种子工单。)'.replace(')', '）')
    // 压缩态腿(第二次路由调用)模型误判为 accept。
    if (prompt.includes('（摘要')) return '这是条新需求。\nroute=accept'
    return '挂到 seed-1。\nroute=attach'
  }
  const outcome = await runRouteCompaction({ entries, llm, threshold: 2 })
  assert.equal(outcome.rates.clean, 1)
  assert.equal(outcome.rates.compacted, 0)
  assert.equal(outcome.exit, 1)
  const md = renderReportMd(outcome.report)
  assert.match(md, /衰减超标/)
  assert.match(md, /\| RG-90 \| attach \| attach \| accept ✗ \|/)
  assert.match(md, /合成转录/)
  assert.ok(!md.includes('Bearer') && !md.includes('master-key'), '报告不得含任何凭据痕迹')
})

test('runRouteCompaction:LLM 抛错即向上冒泡(调用方转退出码 2),不静默吞错', async () => {
  await assert.rejects(
    () => runRouteCompaction({ entries: [entry()], llm: () => Promise.reject(new Error('HTTP 502')) }),
    /HTTP 502/,
  )
})
